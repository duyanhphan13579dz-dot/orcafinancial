/**
 * Phase 10 — Economic & Macro Engine
 *
 * Live calendar via calendar-providers (ForexFactory / Finnhub / curated).
 * Computes upcoming HIGH/EXTREME events and event-risk for a symbol.
 */

import {
  buildCuratedCalendar,
  fetchLiveMacroCalendar,
} from "./calendar-providers";

export type MacroImpact = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
export type MacroRegion = "US" | "EU" | "UK" | "JP" | "CN" | "GLOBAL";

export interface MacroEvent {
  id: string;
  title: string;
  region: MacroRegion;
  flag: string;
  impact: MacroImpact;
  /** ISO timestamp UTC */
  at: string;
  /** minutes until event (negative = past) */
  minutesUntil: number;
  currencies: string[];
  category: string;
  /** Optional release numbers from live feed */
  forecast?: string | null;
  previous?: string | null;
  actual?: string | null;
}

export interface MacroContext {
  asOf: string;
  source: string;
  upcoming: MacroEvent[];
  nextHighImpact: MacroEvent | null;
  /** Aggregate risk for the requested symbol */
  eventRisk: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  eventRiskNote: string;
  /** Soft recommendation overlay */
  recommendationOverlay: string | null;
  /** Suggested action: keep | caution | wait */
  stance: "keep" | "caution" | "wait";
}

/** Sync helper — uses curated only (tests / SSR fallback). */
export function buildMacroCalendar(now = new Date()): MacroEvent[] {
  return buildCuratedCalendar(now);
}

function symbolCurrencies(symbol: string): string[] {
  const s = symbol.toUpperCase();
  if (s === "DXY") return ["USD", "DXY"];
  if (s.startsWith("XAU")) return ["XAU", "USD"];
  if (s.length >= 6) return [s.slice(0, 3), s.slice(3, 6)];
  return [s];
}

function impactRank(i: MacroImpact): number {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, EXTREME: 4 }[i];
}

function scoreContext(
  symbol: string,
  upcoming: MacroEvent[],
  source: string,
  now = new Date(),
): MacroContext {
  const curs = symbolCurrencies(symbol);

  const relevant = upcoming.filter(
    (e) =>
      e.minutesUntil >= -30 &&
      e.currencies.some((c) => curs.includes(c) || c === "GLOBAL"),
  );

  const nextHigh =
    relevant.find((e) => e.impact === "EXTREME" || e.impact === "HIGH") ??
    relevant[0] ??
    null;

  let eventRisk: MacroContext["eventRisk"] = "NONE";
  let stance: MacroContext["stance"] = "keep";
  let note = "No major relevant macro event in the near window";
  let overlay: string | null = null;

  if (nextHigh) {
    const mins = nextHigh.minutesUntil;
    const rank = impactRank(nextHigh.impact);
    const nums =
      nextHigh.forecast || nextHigh.previous
        ? ` [prev ${nextHigh.previous ?? "—"} / fcast ${nextHigh.forecast ?? "—"}${nextHigh.actual ? ` / act ${nextHigh.actual}` : ""}]`
        : "";

    if (mins >= 0 && mins <= 45 && rank >= 3) {
      eventRisk = nextHigh.impact === "EXTREME" ? "EXTREME" : "HIGH";
      stance = "wait";
      note = `⚠️ ${nextHigh.title} in ${mins} min — high event risk${nums}`;
      overlay = "MACRO RISK HIGH — prefer WAIT / reduce size";
    } else if (mins >= 0 && mins <= 180 && rank >= 3) {
      eventRisk = "HIGH";
      stance = "caution";
      note = `High-impact ${nextHigh.title} in ${Math.round(mins / 60)}h${nums}`;
      overlay = "MACRO RISK HIGH";
    } else if (mins >= 0 && mins <= 24 * 60 && rank >= 3) {
      eventRisk = "MEDIUM";
      stance = "caution";
      note = `${nextHigh.title} within 24h (${nextHigh.impact})${nums}`;
      overlay = "Macro event within 24h — size carefully";
    } else if (mins < 0 && mins > -60 && rank >= 3) {
      eventRisk = "HIGH";
      stance = "caution";
      note = `${nextHigh.title} just released — volatility spike window${nums}`;
      overlay = "Post-event volatility — wait for structure";
    } else if (rank >= 2 && mins >= 0 && mins < 48 * 60) {
      eventRisk = "LOW";
      note = `Next: ${nextHigh.title} in ~${Math.round(mins / 60)}h${nums}`;
    }
  }

  return {
    asOf: now.toISOString(),
    source,
    upcoming: upcoming.slice(0, 20),
    nextHighImpact: nextHigh,
    eventRisk,
    eventRiskNote: note,
    recommendationOverlay: overlay,
    stance,
  };
}

/** Synchronous context (curated only) — backward compatible. */
export function buildMacroContext(symbol: string, now = new Date()): MacroContext {
  return scoreContext(symbol, buildCuratedCalendar(now), "curated", now);
}

/** Preferred: live calendar + risk scoring. */
export async function buildMacroContextLive(
  symbol: string,
  now = new Date(),
): Promise<MacroContext> {
  try {
    const { events, source } = await fetchLiveMacroCalendar();
    return scoreContext(symbol, events, source, now);
  } catch {
    return scoreContext(symbol, buildCuratedCalendar(now), "curated-fallback", now);
  }
}

/** Apply macro stance onto an existing recommendation. */
export function applyMacroToRecommendation(
  recommendation: "BUY" | "SELL" | "NEUTRAL",
  confidence: number,
  macro: MacroContext,
): {
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  confidence: number;
  reasons: string[];
} {
  const reasons: string[] = [`[Macro] ${macro.eventRiskNote}`];
  let rec = recommendation;
  let conf = confidence;

  if (macro.stance === "wait" && recommendation !== "NEUTRAL") {
    rec = "NEUTRAL";
    conf = Math.min(conf, 0.48);
    reasons.push("[Macro] Forced WAIT — high-impact event imminent");
  } else if (macro.stance === "caution" && recommendation !== "NEUTRAL") {
    conf = Math.max(0.35, conf - 0.08);
    reasons.push("[Macro] Confidence −8% due to event risk");
  }

  if (macro.recommendationOverlay) {
    reasons.push(`[Macro] ${macro.recommendationOverlay}`);
  }

  return {
    recommendation: rec,
    confidence: Number(conf.toFixed(2)),
    reasons,
  };
}
