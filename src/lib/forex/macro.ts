/**
 * Phase 10 — Economic & Macro Engine
 *
 * Curated major-event calendar (no paid calendar API required).
 * Computes upcoming HIGH/EXTREME events and event-risk for a symbol.
 */

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
}

export interface MacroContext {
  asOf: string;
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

function utcDate(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min, 0));
}

/** First Friday of month (NFP). */
function firstFriday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const day = d.getUTCDay();
  const offset = (5 - day + 7) % 7;
  return 1 + offset;
}

/** Second / mid-month Wednesday approximation for FOMC (illustrative). */
function midMonthWednesday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const day = d.getUTCDay();
  const firstWed = 1 + ((3 - day + 7) % 7);
  return firstWed + 7; // second Wednesday
}

/** Build ~14 days of major events from recurring schedule. */
export function buildMacroCalendar(now = new Date()): MacroEvent[] {
  const events: MacroEvent[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;

  const months = [
    { y, m },
    m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 },
  ];

  for (const { y: yy, m: mm } of months) {
    // NFP — first Friday 12:30 UTC (≈ 8:30 ET)
    const nfpDay = firstFriday(yy, mm);
    events.push({
      id: `nfp-${yy}-${mm}`,
      title: "Non-Farm Payrolls (NFP)",
      region: "US",
      flag: "🇺🇸",
      impact: "EXTREME",
      at: utcDate(yy, mm, nfpDay, 12, 30).toISOString(),
      minutesUntil: 0,
      currencies: ["USD", "EUR", "GBP", "JPY", "XAU"],
      category: "employment",
    });

    // CPI — around 13th, 12:30 UTC
    const cpiDay = Math.min(13, 28);
    events.push({
      id: `cpi-${yy}-${mm}`,
      title: "US CPI",
      region: "US",
      flag: "🇺🇸",
      impact: "HIGH",
      at: utcDate(yy, mm, cpiDay, 12, 30).toISOString(),
      minutesUntil: 0,
      currencies: ["USD", "XAU", "EUR"],
      category: "inflation",
    });

    // PPI — day after CPI-ish
    events.push({
      id: `ppi-${yy}-${mm}`,
      title: "US PPI",
      region: "US",
      flag: "🇺🇸",
      impact: "MEDIUM",
      at: utcDate(yy, mm, Math.min(cpiDay + 1, 28), 12, 30).toISOString(),
      minutesUntil: 0,
      currencies: ["USD"],
      category: "inflation",
    });

    // FOMC decision — second Wed approx 18:00 UTC
    const fomcDay = midMonthWednesday(yy, mm);
    events.push({
      id: `fomc-${yy}-${mm}`,
      title: "FOMC Rate Decision",
      region: "US",
      flag: "🇺🇸",
      impact: "EXTREME",
      at: utcDate(yy, mm, fomcDay, 18, 0).toISOString(),
      minutesUntil: 0,
      currencies: ["USD", "EUR", "GBP", "JPY", "XAU", "DXY"],
      category: "central_bank",
    });

    // ECB — first Thursday-ish 12:15 UTC
    const ecbDay = Math.min(7 + ((4 - new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() + 7) % 7), 14);
    events.push({
      id: `ecb-${yy}-${mm}`,
      title: "ECB Rate Decision",
      region: "EU",
      flag: "🇪🇺",
      impact: "HIGH",
      at: utcDate(yy, mm, ecbDay, 12, 15).toISOString(),
      minutesUntil: 0,
      currencies: ["EUR", "USD"],
      category: "central_bank",
    });

    // BOE — mid month Thursday
    events.push({
      id: `boe-${yy}-${mm}`,
      title: "BOE Rate Decision",
      region: "UK",
      flag: "🇬🇧",
      impact: "HIGH",
      at: utcDate(yy, mm, Math.min(fomcDay, 21), 12, 0).toISOString(),
      minutesUntil: 0,
      currencies: ["GBP", "USD"],
      category: "central_bank",
    });

    // BOJ — around 19th 03:00 UTC
    events.push({
      id: `boj-${yy}-${mm}`,
      title: "BOJ Policy Decision",
      region: "JP",
      flag: "🇯🇵",
      impact: "HIGH",
      at: utcDate(yy, mm, 19, 3, 0).toISOString(),
      minutesUntil: 0,
      currencies: ["JPY", "USD"],
      category: "central_bank",
    });

    // Retail Sales — mid month
    events.push({
      id: `retail-${yy}-${mm}`,
      title: "US Retail Sales",
      region: "US",
      flag: "🇺🇸",
      impact: "MEDIUM",
      at: utcDate(yy, mm, 15, 12, 30).toISOString(),
      minutesUntil: 0,
      currencies: ["USD"],
      category: "growth",
    });

    // GDP flash — end of month-ish quarterly (simplify monthly placeholder)
    if (mm % 3 === 1) {
      events.push({
        id: `gdp-${yy}-${mm}`,
        title: "US GDP",
        region: "US",
        flag: "🇺🇸",
        impact: "HIGH",
        at: utcDate(yy, mm, 26, 12, 30).toISOString(),
        minutesUntil: 0,
        currencies: ["USD", "DXY"],
        category: "growth",
      });
    }
  }

  const t = now.getTime();
  return events
    .map((e) => ({
      ...e,
      minutesUntil: Math.round((new Date(e.at).getTime() - t) / 60_000),
    }))
    .filter((e) => e.minutesUntil > -180 && e.minutesUntil < 60 * 24 * 14)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);
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

export function buildMacroContext(symbol: string, now = new Date()): MacroContext {
  const upcoming = buildMacroCalendar(now);
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

    if (mins >= 0 && mins <= 45 && rank >= 3) {
      eventRisk = nextHigh.impact === "EXTREME" ? "EXTREME" : "HIGH";
      stance = "wait";
      note = `⚠️ ${nextHigh.title} in ${mins} min — high event risk`;
      overlay = "MACRO RISK HIGH — prefer WAIT / reduce size";
    } else if (mins >= 0 && mins <= 180 && rank >= 3) {
      eventRisk = "HIGH";
      stance = "caution";
      note = `High-impact ${nextHigh.title} in ${Math.round(mins / 60)}h`;
      overlay = "MACRO RISK HIGH";
    } else if (mins >= 0 && mins <= 24 * 60 && rank >= 3) {
      eventRisk = "MEDIUM";
      stance = "caution";
      note = `${nextHigh.title} within 24h (${nextHigh.impact})`;
      overlay = "Macro event within 24h — size carefully";
    } else if (mins < 0 && mins > -60 && rank >= 3) {
      eventRisk = "HIGH";
      stance = "caution";
      note = `${nextHigh.title} just released — volatility spike window`;
      overlay = "Post-event volatility — wait for structure";
    } else if (rank >= 2 && mins >= 0 && mins < 48 * 60) {
      eventRisk = "LOW";
      note = `Next: ${nextHigh.title} in ~${Math.round(mins / 60)}h`;
    }
  }

  return {
    asOf: now.toISOString(),
    upcoming: upcoming.slice(0, 12),
    nextHighImpact: nextHigh,
    eventRisk,
    eventRiskNote: note,
    recommendationOverlay: overlay,
    stance,
  };
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
