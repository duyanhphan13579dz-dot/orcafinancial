/**
 * Commodity data sources — SINGLE-SOURCE-PER-CYCLE architecture.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ CORE RULE                                                           │
 * │ Both sources are scanned continuously so we always know their live  │
 * │ health, BUT every persisted snapshot comes from exactly ONE source. │
 * │ Prices are never averaged, blended or merged across sources.        │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Selection algorithm per cycle:
 *   1. Scan PRIMARY and SECONDARY in parallel (health probing).
 *   2. If PRIMARY returned a usable snapshot → persist PRIMARY, discard SECONDARY.
 *   3. Else if SECONDARY returned a usable snapshot → persist SECONDARY.
 *   4. Else → persist nothing; log and retry next cycle (never fabricate).
 *
 * "Usable" = HTTP OK + parsed + at least MIN_ROWS mapped symbols.
 *
 * Priority is configurable via env so operators can flip the order without a
 * code change:
 *   COMMODITY_PRIMARY_SOURCE=simplize | vietnambiz
 */

import { fetchWithRetry, getBreaker, ProviderError } from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";
import { vnNow } from "./time";

export type SourceId = "simplize" | "vietnambiz";

export interface CommodityQuote {
  symbol: string;
  price: number;
  currency: "VND" | "USD" | "JPY" | "CNY";
  unit: string;
  /** Publication timestamp reported by the source (VN time), if any. */
  sourceUpdatedAt: Date | null;
  prevClose?: number | null;
  changePct1d?: number | null;
  changePct7d?: number | null;
  changePct30d?: number | null;
  changePctYtd?: number | null;
  changePct1y?: number | null;
  high52w?: number | null;
  low52w?: number | null;
}

/** Result of scanning ONE source during ONE cycle. */
export interface SourceSnapshot {
  source: SourceId;
  ok: boolean;
  quotes: CommodityQuote[];
  latencyMs: number;
  scannedAt: Date;
  error?: string;
}

const log = forProvider("commodity-sources");

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
} as const;

/** A snapshot with fewer rows than this is treated as a failed scrape. */
const MIN_ROWS = 5;

export function getPrimarySource(): SourceId {
  const raw = (process.env.COMMODITY_PRIMARY_SOURCE ?? "simplize").toLowerCase().trim();
  return raw === "vietnambiz" ? "vietnambiz" : "simplize";
}
export function getSecondarySource(): SourceId {
  return getPrimarySource() === "simplize" ? "vietnambiz" : "simplize";
}

/* ═══════════════════════════════════════════════════════════════════════
 * Unit normalisation — every quote becomes (value, currency) in whole units
 * ═══════════════════════════════════════════════════════════════════════ */

export function normaliseUnit(rawValue: number, unit: string): { value: number; currency: CommodityQuote["currency"] } {
  const u = (unit || "").trim();
  const lower = u.toLowerCase();

  // "Nghìn đồng/lượng", "Nghìn/lít" → thousands of VND
  if (lower.includes("nghìn") || lower.includes("nghin")) {
    return { value: rawValue * 1000, currency: "VND" };
  }
  // Plain VND
  if (lower.includes("vnđ") || lower.includes("vnd") || lower.includes("đồng")) {
    // Some farm-gate rows are labelled VNĐ/kg but quoted in thousands.
    const value = rawValue > 0 && rawValue < 1000 ? rawValue * 1000 : rawValue;
    return { value, currency: "VND" };
  }
  // US cents — "USd/BU", "US cent/lb", "USd/Lbs"
  if (u.startsWith("USd") || lower.includes("us cent") || lower.includes("cent/")) {
    return { value: rawValue / 100, currency: "USD" };
  }
  if (lower.includes("usd")) return { value: rawValue, currency: "USD" };
  if (lower.includes("jpy") || lower.includes("yên") || lower.includes("yen")) {
    return { value: rawValue, currency: "JPY" };
  }
  if (lower.includes("cny") || lower.includes("nhân dân tệ")) {
    return { value: rawValue, currency: "CNY" };
  }
  return { value: rawValue, currency: "USD" };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Parse "dd/MM/yyyy" (VietnamBiz `time_update`) as a VN-local date. */
function parseVnDate(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  // VN is UTC+7 — construct the UTC instant matching VN midnight.
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), -7, 0, 0));
}

/* ═══════════════════════════════════════════════════════════════════════
 * SOURCE A — simplize.vn/hang-hoa
 * ═══════════════════════════════════════════════════════════════════════ */

const SIMPLIZE_MAP: Record<string, string> = {
  "GOLD-SJC-BUY": "GOLD_SJC_BUY",
  "GOLD-SJC-SELL": "GOLD_SJC_SELL",
  "STEEL-D10": "STEEL_D10",
  RON95: "GAS_RON95",
  RON92: "GAS_RON92",
  DIESEL: "DIESEL_DO",
  "PIG-VIETNAM": "PIG_NORTH",
  "TOM-THE-VIETNAM": "SHRIMP_CARD",
  "CA-TRA-VIETNAM": "CATFISH_TRA",
  "WTI-CRUDE-OIL": "WTI_CRUDE",
  "NATURAL-GAS": "GAS_NATURAL",
  "NEWCASTLE-COAL": "COAL_COKING",
  GOLD: "GOLD_WORLD",
  SLIVER: "SILVER",
  SILVER: "SILVER",
  COPPER: "COPPER",
  NICKEL: "NICKEL",
  "IRON-ORE": "IRON_ORE",
  "IRON-HRC": "STEEL_HRC",
  CORN: "CORN",
  SOYBEAN: "SOYBEAN",
  RICE: "RICE",
  UREA: "FERTILIZER_UREA",
  "COFFEE-ARABICA": "COFFEE_ARABICA",
  "COFFEE-ROBUSTA": "COFFEE_ROBUSTA",
  COTTON: "COTTON",
  SUGAR: "SUGAR",
  "WHOLE-MILK": "MILK_WMP",
  "SKIM-MILK": "MILK_SMP",
  "RUBBER-TSR20-TOKYO": "RUBBER_TSR20",
  "RUBBER-RSS3-TOKYO": "RUBBER_RSS3",
  "PIG-CHINA": "PIG_CHINA",
};

interface SimplizeRow {
  symbol?: string;
  indexClose?: number;
  indexClosePrev?: number;
  close52wHigh?: number;
  close52wLow?: number;
  pctChange?: number;
  pricePctChg7d?: number;
  pricePctChg30d?: number;
  pricePctChgYtd?: number;
  pricePctChg1y?: number;
  unit?: string;
  esIndexType?: string;
}

/** Walk balanced braces so nested objects/strings don't truncate a match. */
function extractSimplizeRows(html: string): SimplizeRow[] {
  const rows: SimplizeRow[] = [];
  const needle = '{"ticker":"';
  let cursor = 0;

  while (true) {
    const start = html.indexOf(needle, cursor);
    if (start === -1) break;
    cursor = start + needle.length;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = start; i < html.length && i < start + 4000; i++) {
      const ch = html[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) continue;

    const slice = html.slice(start, end);
    if (!slice.includes('"esIndexType":"commodity"')) continue;
    try {
      rows.push(JSON.parse(slice) as SimplizeRow);
    } catch {
      try { rows.push(JSON.parse(slice.replace(/\\"/g, '"')) as SimplizeRow); } catch { /* skip */ }
    }
  }

  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = r.symbol ?? "";
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function scanSimplize(): Promise<SourceSnapshot> {
  const started = Date.now();
  const scannedAt = vnNow();
  try {
    return await getBreaker("simplize-commodities").exec(async () => {
      const url = "https://simplize.vn/hang-hoa";
      const res = await fetchWithRetry(url, {
        provider: "simplize-commodities",
        timeoutMs: 15_000,
        retries: 2,
        headers: BROWSER_HEADERS,
      });
      const html = await res.text();
      const rows = extractSimplizeRows(html);
      const quotes: CommodityQuote[] = [];

      for (const r of rows) {
        const internal = SIMPLIZE_MAP[(r.symbol ?? "").trim()];
        if (!internal) continue;
        if (typeof r.indexClose !== "number" || !Number.isFinite(r.indexClose) || r.indexClose <= 0) continue;

        const { value, currency } = normaliseUnit(r.indexClose, r.unit ?? "");
        const prev =
          typeof r.indexClosePrev === "number" && r.indexClosePrev > 0
            ? normaliseUnit(r.indexClosePrev, r.unit ?? "").value
            : null;

        let d1 = numOrNull(r.pctChange);
        if ((d1 === null || d1 === 0) && prev && prev > 0) {
          const derived = ((value - prev) / prev) * 100;
          if (Number.isFinite(derived)) d1 = derived;
        }

        quotes.push({
          symbol: internal,
          price: value,
          currency,
          unit: r.unit ?? "",
          sourceUpdatedAt: scannedAt, // Simplize is intraday-live
          prevClose: prev,
          changePct1d: d1,
          changePct7d: numOrNull(r.pricePctChg7d),
          changePct30d: numOrNull(r.pricePctChg30d),
          changePctYtd: numOrNull(r.pricePctChgYtd),
          changePct1y: numOrNull(r.pricePctChg1y),
          high52w: typeof r.close52wHigh === "number" ? normaliseUnit(r.close52wHigh, r.unit ?? "").value : null,
          low52w: typeof r.close52wLow === "number" ? normaliseUnit(r.close52wLow, r.unit ?? "").value : null,
        });
      }

      if (quotes.length < MIN_ROWS) {
        throw new ProviderError("simplize", `only ${quotes.length} rows mapped (min ${MIN_ROWS})`);
      }
      return { source: "simplize" as const, ok: true, quotes, latencyMs: Date.now() - started, scannedAt };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("simplize_scan_failed", { error: msg, latencyMs: Date.now() - started });
    return { source: "simplize", ok: false, quotes: [], latencyMs: Date.now() - started, scannedAt, error: msg };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * SOURCE B — data.vietnambiz.vn/goods
 *
 * Ships a full __NEXT_DATA__ payload with 66 rows across 6 categories.
 * Row shape: { time_update, title, type, unit, value, value_d/w/m/y }.
 * The value_* delta fields are currently null upstream, so change % is
 * derived from our own stored history when this source is selected.
 * ═══════════════════════════════════════════════════════════════════════ */

const VIETNAMBIZ_MAP: Array<{ match: RegExp; symbol: string }> = [
  // Precious metals
  { match: /^giá vàng trong nước$/i, symbol: "GOLD_SJC_SELL" },
  { match: /^giá vàng$/i, symbol: "GOLD_WORLD" },
  { match: /^giá bạc$/i, symbol: "SILVER" },
  { match: /^giá đồng$/i, symbol: "COPPER" },
  // Energy
  { match: /^dầu wti$/i, symbol: "WTI_CRUDE" },
  { match: /^khí thiên nhiên$/i, symbol: "GAS_NATURAL" },
  { match: /^than newcastle$/i, symbol: "COAL_COKING" },
  { match: /xăng ron\s*95-ii/i, symbol: "GAS_RON95" },
  { match: /e5 ron\s*92/i, symbol: "GAS_RON92" },
  { match: /^xăng diezen$/i, symbol: "DIESEL_DO" },
  // Metals / construction
  { match: /^hrc trung quốc$/i, symbol: "STEEL_HRC" },
  { match: /^quặng sắt trung quốc$/i, symbol: "IRON_ORE" },
  { match: /^than cốc trung quốc$/i, symbol: "COAL_COKING" },
  { match: /^nikken trung quốc$/i, symbol: "NICKEL" },
  // Agriculture / livestock
  { match: /^giá heo hơi trong nước$/i, symbol: "PIG_NORTH" },
  { match: /^tôm thẻ$/i, symbol: "SHRIMP_CARD" },
  { match: /^đường$/i, symbol: "SUGAR" },
  { match: /^cà phê$/i, symbol: "COFFEE_ROBUSTA" },
  { match: /^gạo tpxk$/i, symbol: "RICE" },
  { match: /^vải cotton mỹ$/i, symbol: "COTTON" },
  // Chemicals
  { match: /^ure trung đông$/i, symbol: "FERTILIZER_UREA" },
  // Rubber
  { match: /^cao su nhật bản$/i, symbol: "RUBBER_RSS3" },
];

interface VnBizRow {
  time_update?: string;
  title?: string;
  unit?: string;
  value?: number | string;
  value_d?: number | null;
  value_w?: number | null;
  value_m?: number | null;
  value_y?: number | null;
}

export async function scanVietnamBiz(): Promise<SourceSnapshot> {
  const started = Date.now();
  const scannedAt = vnNow();
  try {
    return await getBreaker("vietnambiz-goods").exec(async () => {
      const url = "https://data.vietnambiz.vn/goods";
      const res = await fetchWithRetry(url, {
        provider: "vietnambiz-goods",
        timeoutMs: 25_000, // page is ~5 MB and slow (~9 s)
        retries: 1,
        headers: BROWSER_HEADERS,
      });
      const html = await res.text();

      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) throw new ProviderError("vietnambiz", "__NEXT_DATA__ payload not found");

      let payload: { props?: { pageProps?: { data?: Record<string, unknown> } } };
      try {
        payload = JSON.parse(m[1]);
      } catch (e) {
        throw new ProviderError("vietnambiz", `__NEXT_DATA__ parse failed: ${e instanceof Error ? e.message : e}`);
      }

      const data = payload.props?.pageProps?.data;
      if (!data || typeof data !== "object") {
        throw new ProviderError("vietnambiz", "pageProps.data missing");
      }

      const quotes: CommodityQuote[] = [];
      const claimed = new Set<string>();

      for (const rows of Object.values(data)) {
        if (!Array.isArray(rows)) continue;
        for (const raw of rows as VnBizRow[]) {
          const title = String(raw.title ?? "").trim();
          const value = numOrNull(raw.value);
          if (!title || value === null || value <= 0) continue;

          const hit = VIETNAMBIZ_MAP.find((x) => x.match.test(title));
          if (!hit) continue;
          // First match wins — categories can repeat a concept (e.g. coal).
          if (claimed.has(hit.symbol)) continue;
          claimed.add(hit.symbol);

          const unit = String(raw.unit ?? "");
          const { value: v, currency } = normaliseUnit(value, unit);

          quotes.push({
            symbol: hit.symbol,
            price: v,
            currency,
            unit,
            sourceUpdatedAt: parseVnDate(raw.time_update),
            prevClose: null,
            // Upstream deltas are null today; leave null so the service layer
            // derives them from our own history instead of inventing numbers.
            changePct1d: numOrNull(raw.value_d),
            changePct7d: numOrNull(raw.value_w),
            changePct30d: numOrNull(raw.value_m),
            changePct1y: numOrNull(raw.value_y),
            changePctYtd: null,
            high52w: null,
            low52w: null,
          });
        }
      }

      if (quotes.length < MIN_ROWS) {
        throw new ProviderError("vietnambiz", `only ${quotes.length} rows mapped (min ${MIN_ROWS})`);
      }
      return { source: "vietnambiz" as const, ok: true, quotes, latencyMs: Date.now() - started, scannedAt };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("vietnambiz_scan_failed", { error: msg, latencyMs: Date.now() - started });
    return { source: "vietnambiz", ok: false, quotes: [], latencyMs: Date.now() - started, scannedAt, error: msg };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Cycle orchestration — scan BOTH, persist exactly ONE
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ScanCycleResult {
  /** The snapshot chosen for persistence — null when both sources failed. */
  selected: SourceSnapshot | null;
  /** Why that source won (for logs / admin UI). */
  reason: string;
  /** Health of every source this cycle, regardless of selection. */
  probes: SourceSnapshot[];
}

export async function runScanCycle(): Promise<ScanCycleResult> {
  const primary = getPrimarySource();
  const secondary = getSecondarySource();

  // Scan both in parallel: continuous health visibility for both sources,
  // while selection still yields a single authoritative dataset.
  const [simplize, vietnambiz] = await Promise.all([scanSimplize(), scanVietnamBiz()]);
  const byId: Record<SourceId, SourceSnapshot> = { simplize, vietnambiz };

  const p = byId[primary];
  const s = byId[secondary];

  let selected: SourceSnapshot | null = null;
  let reason: string;

  if (p.ok) {
    selected = p;
    reason = `primary "${primary}" healthy (${p.quotes.length} quotes, ${p.latencyMs}ms)`;
  } else if (s.ok) {
    selected = s;
    reason = `primary "${primary}" failed (${p.error}); fell back to "${secondary}" (${s.quotes.length} quotes)`;
  } else {
    reason = `both sources failed — primary: ${p.error}; secondary: ${s.error}`;
  }

  log.info("scan_cycle", {
    primary,
    secondary,
    selectedSource: selected?.source ?? null,
    selectedQuotes: selected?.quotes.length ?? 0,
    reason,
    simplize: { ok: simplize.ok, rows: simplize.quotes.length, ms: simplize.latencyMs },
    vietnambiz: { ok: vietnambiz.ok, rows: vietnambiz.quotes.length, ms: vietnambiz.latencyMs },
  });

  return { selected, reason, probes: [simplize, vietnambiz] };
}
