/**
 * Live economic calendar providers.
 *
 * Priority:
 *  1. ForexFactory weekly JSON (nfs.faireconomy.media) — no key
 *  2. Finnhub /calendar/economic — optional FINNHUB_API_KEY
 *  3. Curated recurring schedule (offline fallback)
 */

import type { MacroEvent, MacroImpact, MacroRegion } from "./macro";
import {
  recordCacheHit,
  recordCacheMiss,
  recordProviderError,
  recordProviderSuccess,
} from "./observability";

const CACHE_TTL_MS = 15 * 60_000;
let cache: { events: MacroEvent[]; source: string; at: number } | null = null;

const COUNTRY_MAP: Record<
  string,
  { region: MacroRegion; flag: string; currencies: string[] }
> = {
  USD: { region: "US", flag: "🇺🇸", currencies: ["USD", "DXY", "XAU"] },
  US: { region: "US", flag: "🇺🇸", currencies: ["USD", "DXY", "XAU"] },
  EUR: { region: "EU", flag: "🇪🇺", currencies: ["EUR"] },
  EU: { region: "EU", flag: "🇪🇺", currencies: ["EUR"] },
  GBP: { region: "UK", flag: "🇬🇧", currencies: ["GBP"] },
  UK: { region: "UK", flag: "🇬🇧", currencies: ["GBP"] },
  JPY: { region: "JP", flag: "🇯🇵", currencies: ["JPY"] },
  JP: { region: "JP", flag: "🇯🇵", currencies: ["JPY"] },
  CNY: { region: "CN", flag: "🇨🇳", currencies: ["CNY"] },
  CN: { region: "CN", flag: "🇨🇳", currencies: ["CNY"] },
  AUD: { region: "GLOBAL", flag: "🇦🇺", currencies: ["AUD"] },
  NZD: { region: "GLOBAL", flag: "🇳🇿", currencies: ["NZD"] },
  CAD: { region: "GLOBAL", flag: "🇨🇦", currencies: ["CAD"] },
  CHF: { region: "GLOBAL", flag: "🇨🇭", currencies: ["CHF"] },
};

function mapImpact(raw: string | number | undefined | null): MacroImpact {
  if (raw == null) return "LOW";
  const s = String(raw).toLowerCase();
  if (s === "holiday" || s === "none") return "LOW";
  if (s.includes("high") || s === "3" || s === "red") return "HIGH";
  if (s.includes("med") || s === "2" || s === "orange") return "MEDIUM";
  if (s.includes("low") || s === "1" || s === "yellow") return "LOW";
  return "LOW";
}

function upgradeExtreme(title: string, impact: MacroImpact): MacroImpact {
  const t = title.toLowerCase();
  const extreme =
    /non[-\s]?farm|nfp|fomc|fed\s*(rate|interest|funds)|ecb\s*(rate|main)|boe\s*(rate|bank rate)|boj\s*(rate|policy)|cpi|pce|gdp/.test(
      t,
    );
  if (extreme && (impact === "HIGH" || impact === "MEDIUM")) {
    if (/non[-\s]?farm|nfp|fomc|fed\s*(rate|interest|funds)/.test(t)) return "EXTREME";
    return "HIGH";
  }
  return impact;
}

function categoryOf(title: string): string {
  const t = title.toLowerCase();
  if (/payroll|employment|jobless|unemployment|nfp/.test(t)) return "employment";
  if (/cpi|ppi|pce|inflation|price index/.test(t)) return "inflation";
  if (/fomc|fed |ecb|boe|boj|rate decision|interest rate|policy/.test(t))
    return "central_bank";
  if (/gdp|retail|pmi|ism|industrial|growth/.test(t)) return "growth";
  if (/speech|speaks|testimony|minutes/.test(t)) return "speech";
  return "other";
}

function toMacroEvent(raw: {
  id?: string;
  title: string;
  country: string;
  at: Date;
  impact: MacroImpact;
  forecast?: string | null;
  previous?: string | null;
  actual?: string | null;
}): MacroEvent | null {
  if (!Number.isFinite(raw.at.getTime())) return null;
  const key = raw.country.toUpperCase();
  const meta = COUNTRY_MAP[key] ?? {
    region: "GLOBAL" as MacroRegion,
    flag: "🌐",
    currencies: [key],
  };
  const impact = upgradeExtreme(raw.title, raw.impact);
  const minutesUntil = Math.round((raw.at.getTime() - Date.now()) / 60_000);
  return {
    id: raw.id ?? `${key}-${raw.at.toISOString()}-${raw.title.slice(0, 40)}`,
    title: raw.title,
    region: meta.region,
    flag: meta.flag,
    impact,
    at: raw.at.toISOString(),
    minutesUntil,
    currencies: meta.currencies,
    category: categoryOf(raw.title),
    forecast: raw.forecast ?? null,
    previous: raw.previous ?? null,
    actual: raw.actual ?? null,
  };
}

interface FfRow {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

async function fetchForexFactory(): Promise<MacroEvent[]> {
  const t0 = Date.now();
  try {
    const url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; OrcaFinancial/1.0; +https://github.com/duyanhphan13579dz-dot/orcafinancial)",
      },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(8_000),
    } as RequestInit);

    if (!res.ok) throw new Error(`ff_http_${res.status}`);
    const rows = (await res.json()) as FfRow[];
    if (!Array.isArray(rows)) throw new Error("ff_invalid_shape");

    const out: MacroEvent[] = [];
    for (const r of rows) {
      if (!r.title || !r.date) continue;
      const at = new Date(r.date);
      const ev = toMacroEvent({
        id: `ff-${r.country}-${r.date}-${r.title}`.replace(/\s+/g, "_").slice(0, 120),
        title: r.title,
        country: r.country ?? "USD",
        at,
        impact: mapImpact(r.impact),
        forecast: r.forecast || null,
        previous: r.previous || null,
        actual: r.actual || null,
      });
      if (ev) out.push(ev);
    }
    recordProviderSuccess("forexfactory-calendar", Date.now() - t0);
    return out;
  } catch (err) {
    recordProviderError(
      "forexfactory-calendar",
      err instanceof Error ? err.message : String(err),
      Date.now() - t0,
    );
    throw err;
  }
}

interface FinnhubRow {
  event?: string;
  country?: string;
  time?: string;
  impact?: string;
  estimate?: number | string | null;
  prev?: number | string | null;
  actual?: number | string | null;
  unit?: string;
}

async function fetchFinnhub(): Promise<MacroEvent[]> {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) throw new Error("finnhub_no_key");

  const t0 = Date.now();
  try {
    const from = new Date();
    const to = new Date(Date.now() + 14 * 86400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${fmt(from)}&to=${fmt(to)}&token=${key}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 900 },
    } as RequestInit);
    if (!res.ok) throw new Error(`finnhub_http_${res.status}`);

    const body = (await res.json()) as { economicCalendar?: FinnhubRow[] };
    const rows = body.economicCalendar ?? [];
    const out: MacroEvent[] = [];
    for (const r of rows) {
      if (!r.event || !r.time) continue;
      const iso = r.time.includes("T") ? r.time : r.time.replace(" ", "T") + "Z";
      const at = new Date(iso);
      const ev = toMacroEvent({
        id: `fh-${r.country}-${r.time}-${r.event}`.replace(/\s+/g, "_").slice(0, 120),
        title: r.event,
        country: r.country ?? "US",
        at,
        impact: mapImpact(r.impact),
        forecast: r.estimate != null ? String(r.estimate) : null,
        previous: r.prev != null ? String(r.prev) : null,
        actual: r.actual != null ? String(r.actual) : null,
      });
      if (ev) out.push(ev);
    }
    recordProviderSuccess("finnhub-calendar", Date.now() - t0);
    return out;
  } catch (err) {
    recordProviderError(
      "finnhub-calendar",
      err instanceof Error ? err.message : String(err),
      Date.now() - t0,
    );
    throw err;
  }
}

function firstFriday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const day = d.getUTCDay();
  return 1 + ((5 - day + 7) % 7);
}

function midMonthWednesday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month - 1, 1));
  const day = d.getUTCDay();
  return 1 + ((3 - day + 7) % 7) + 7;
}

function utcDate(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min, 0));
}

export function buildCuratedCalendar(now = new Date()): MacroEvent[] {
  const events: MacroEvent[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const months = [
    { y, m },
    m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 },
  ];

  for (const { y: yy, m: mm } of months) {
    const nfpDay = firstFriday(yy, mm);
    events.push(
      toMacroEvent({
        id: `curated-nfp-${yy}-${mm}`,
        title: "Non-Farm Payrolls (NFP)",
        country: "USD",
        at: utcDate(yy, mm, nfpDay, 12, 30),
        impact: "EXTREME",
      })!,
    );
    events.push(
      toMacroEvent({
        id: `curated-cpi-${yy}-${mm}`,
        title: "US CPI",
        country: "USD",
        at: utcDate(yy, mm, Math.min(13, 28), 12, 30),
        impact: "HIGH",
      })!,
    );
    events.push(
      toMacroEvent({
        id: `curated-fomc-${yy}-${mm}`,
        title: "FOMC Rate Decision",
        country: "USD",
        at: utcDate(yy, mm, midMonthWednesday(yy, mm), 18, 0),
        impact: "EXTREME",
      })!,
    );
    events.push(
      toMacroEvent({
        id: `curated-ecb-${yy}-${mm}`,
        title: "ECB Rate Decision",
        country: "EUR",
        at: utcDate(yy, mm, Math.min(10, 28), 12, 15),
        impact: "HIGH",
      })!,
    );
  }

  return events
    .filter(Boolean)
    .map((e) => ({
      ...e,
      minutesUntil: Math.round((new Date(e.at).getTime() - now.getTime()) / 60_000),
    }))
    .filter((e) => e.minutesUntil > -180 && e.minutesUntil < 60 * 24 * 14)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);
}

function refreshMinutes(events: MacroEvent[]): MacroEvent[] {
  const t = Date.now();
  return events
    .map((e) => ({
      ...e,
      minutesUntil: Math.round((new Date(e.at).getTime() - t) / 60_000),
    }))
    .filter((e) => e.minutesUntil > -180 && e.minutesUntil < 60 * 24 * 14)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);
}

function dedupe(events: MacroEvent[]): MacroEvent[] {
  const seen = new Set<string>();
  const out: MacroEvent[] = [];
  for (const e of events) {
    const k = `${e.title}|${e.at.slice(0, 16)}|${e.region}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export async function fetchLiveMacroCalendar(): Promise<{
  events: MacroEvent[];
  source: string;
}> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    recordCacheHit("macro-calendar");
    return { events: refreshMinutes(cache.events), source: `${cache.source}+cache` };
  }
  recordCacheMiss("macro-calendar");

  const sources: string[] = [];
  const merged: MacroEvent[] = [];

  try {
    const ff = await fetchForexFactory();
    if (ff.length) {
      merged.push(...ff);
      sources.push(`forexfactory(${ff.length})`);
    }
  } catch {
    sources.push("forexfactory:fail");
  }

  if (merged.length < 5 || process.env.FINNHUB_API_KEY) {
    try {
      const fh = await fetchFinnhub();
      if (fh.length) {
        merged.push(...fh);
        sources.push(`finnhub(${fh.length})`);
      }
    } catch {
      sources.push("finnhub:skip");
    }
  }

  let events = dedupe(refreshMinutes(merged));
  let source = sources.join("+") || "none";

  if (events.length < 3) {
    const curated = buildCuratedCalendar();
    events = dedupe([...events, ...curated]);
    source = `${source}+curated`;
  }

  cache = { events, source, at: Date.now() };
  return { events: refreshMinutes(events), source };
}
