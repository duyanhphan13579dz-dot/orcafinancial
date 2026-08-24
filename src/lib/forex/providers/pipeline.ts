/**
 * Multi-source quote pipeline (Phase 1):
 *
 *   Primary (Yahoo race)
 *        ↓
 *   Validate
 *        ↓
 *   Secondary (open.er-api / Frankfurter) — parallel when possible
 *        ↓
 *   Cross-check (divergence → DEGRADED)
 *        ↓
 *   Merge → Cache path in service
 */

import { ProviderError } from "@/lib/connectors/core";
import { FOREX_PAIRS } from "../data";
import { forProvider } from "@/lib/logger";
import type { ForexQuote } from "../connectors";
import { fetchSecondarySnapshot } from "./secondary";

const log = forProvider("forex-pipeline");

/** Relative divergence above this marks quote DEGRADED (0.35%). */
export const CROSS_CHECK_DIVERGENCE = 0.0035;

export interface PipelineResult {
  quotes: ForexQuote[];
  source: string;
  primarySource: string | null;
  secondarySource: string | null;
  crossChecked: number;
  diverged: number;
  primaryOnly: number;
  secondaryOnly: number;
  mode: "primary" | "secondary" | "merged";
}

function validateQuote(q: ForexQuote): boolean {
  return (
    typeof q.price === "number" &&
    Number.isFinite(q.price) &&
    q.price > 0 &&
    !!q.symbol &&
    q.timestamp instanceof Date &&
    !Number.isNaN(q.timestamp.getTime())
  );
}

function relativeDiff(a: number, b: number): number {
  const mid = (Math.abs(a) + Math.abs(b)) / 2;
  if (mid === 0) return 0;
  return Math.abs(a - b) / mid;
}

/**
 * Merge primary + secondary maps with cross-check.
 * Primary wins on price when both present; divergence flags degraded.
 * Secondary fills gaps when primary missing (Yahoo partial outage).
 */
export function mergeWithCrossCheck(
  primary: Map<string, ForexQuote>,
  secondary: Map<string, ForexQuote> | null,
  primarySource: string,
  secondarySource: string | null,
): PipelineResult {
  const out = new Map<string, ForexQuote>();
  let crossChecked = 0;
  let diverged = 0;
  let primaryOnly = 0;
  let secondaryOnly = 0;

  const symbols = new Set([
    ...primary.keys(),
    ...(secondary ? secondary.keys() : []),
  ]);

  for (const sym of symbols) {
    const p = primary.get(sym);
    const s = secondary?.get(sym);

    if (p && validateQuote(p) && s && validateQuote(s)) {
      crossChecked += 1;
      const diff = relativeDiff(p.price, s.price);
      const degraded = p.degraded === true || diff > CROSS_CHECK_DIVERGENCE;
      if (diff > CROSS_CHECK_DIVERGENCE) {
        diverged += 1;
        log.warn("cross_check_divergence", {
          symbol: sym,
          primary: p.price,
          secondary: s.price,
          diffPct: Number((diff * 100).toFixed(3)),
        });
      }
      out.set(sym, {
        ...p,
        // Prefer primary mid; keep bid/ask from primary
        degraded,
        source:
          diff > CROSS_CHECK_DIVERGENCE
            ? `${p.source}|xcheck:${s.source}`
            : p.source,
      });
    } else if (p && validateQuote(p)) {
      primaryOnly += 1;
      out.set(sym, p);
    } else if (s && validateQuote(s)) {
      secondaryOnly += 1;
      out.set(sym, { ...s, degraded: true });
    }
  }

  // Ensure derived pairs exist if legs were filled from secondary-only
  for (const def of FOREX_PAIRS) {
    if (!def.derived || out.has(def.symbol)) continue;
    const l = out.get(def.derived.left);
    const r = out.get(def.derived.right);
    if (!l || !r || !r.price) continue;
    const price =
      def.derived.op === "multiply" ? l.price * r.price : l.price / r.price;
    if (!Number.isFinite(price) || price <= 0) continue;
    out.set(def.symbol, {
      symbol: def.symbol,
      price,
      bid: null,
      ask: null,
      change: null,
      changePercent: null,
      source: `${l.source}+derived`,
      timestamp: new Date(
        Math.min(l.timestamp.getTime(), r.timestamp.getTime()),
      ),
      degraded: true,
    });
    secondaryOnly += 1;
  }

  const quotes = FOREX_PAIRS.map((p) => out.get(p.symbol)).filter(
    (q): q is ForexQuote => Boolean(q) && validateQuote(q!),
  );

  const mode: PipelineResult["mode"] =
    primary.size > 0 && secondary && secondary.size > 0
      ? "merged"
      : primary.size > 0
        ? "primary"
        : "secondary";

  const source =
    mode === "merged"
      ? `${primarySource}+${secondarySource}`
      : mode === "primary"
        ? primarySource
        : (secondarySource ?? "secondary");

  return {
    quotes,
    source,
    primarySource,
    secondarySource,
    crossChecked,
    diverged,
    primaryOnly,
    secondaryOnly,
    mode,
  };
}

/**
 * Run secondary in parallel with an already-resolved primary map.
 * Never throws for secondary failure — returns primary-only merge.
 */
export async function enrichWithSecondary(
  primaryQuotes: ForexQuote[],
  primarySource: string,
): Promise<PipelineResult> {
  const primary = new Map(primaryQuotes.map((q) => [q.symbol, q]));

  let secondary: Map<string, ForexQuote> | null = null;
  let secondarySource: string | null = null;

  try {
    const sec = await fetchSecondarySnapshot();
    secondary = sec.bySymbol;
    secondarySource = sec.source;
  } catch (e) {
    log.warn("secondary_unavailable", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const result = mergeWithCrossCheck(
    primary,
    secondary,
    primarySource,
    secondarySource,
  );

  log.info("pipeline_ok", {
    mode: result.mode,
    quotes: result.quotes.length,
    crossChecked: result.crossChecked,
    diverged: result.diverged,
    primaryOnly: result.primaryOnly,
    secondaryOnly: result.secondaryOnly,
    source: result.source,
  });

  if (result.quotes.length < 3) {
    throw new ProviderError(
      "forex-pipeline",
      `Pipeline produced only ${result.quotes.length} quotes`,
    );
  }

  return result;
}

/** Secondary-only path when Yahoo completely fails. */
export async function secondaryOnlySnapshot(): Promise<PipelineResult> {
  const sec = await fetchSecondarySnapshot();
  const empty = new Map<string, ForexQuote>();
  return mergeWithCrossCheck(empty, sec.bySymbol, "none", sec.source);
}
