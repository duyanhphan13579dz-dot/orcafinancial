/**
 * Commodities Connectors — REAL-TIME data from Vietnamese market sources.
 *
 * Primary source:   https://simplize.vn/hang-hoa
 *   Simplize server-renders its full commodity board into the Next.js flight
 *   payload embedded in the HTML. That payload contains all 31 commodities we
 *   track — matching our internal symbol list 1:1 — with live prices, previous
 *   close, intraday high/low, 52-week range and pre-computed 7d/30d/YTD/1y/3y
 *   percentage changes. Parsing it gives us richer, more accurate data than we
 *   could derive ourselves, and avoids hammering a dozen separate providers.
 *
 * Secondary source: https://data.vietnambiz.vn/goods
 *   VietnamBiz renders its goods table entirely client-side and its data
 *   endpoint is not reachable server-side. The connector below still attempts a
 *   parse on every run so that if they ever ship SSR data we pick it up
 *   automatically — but it returns an empty array rather than inventing values
 *   when nothing is parseable, per the project's "never fabricate data" rule.
 *
 * Tertiary fallback: Yahoo Finance (international futures only).
 *
 * Every fetch goes through `fetchWithRetry` + a per-provider circuit breaker,
 * consistent with the rest of the Data Engine.
 */

import { fetchWithRetry, readJsonSafe, ProviderError, getBreaker } from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";

export interface CommodityPriceData {
  symbol: string;
  price: number;
  currency: string;
  unit: string;
  timestamp: Date;
  source: string;
  /** Fields below come straight from the upstream board when available. */
  prevClose?: number | null;
  changePct1d?: number | null;
  changePct7d?: number | null;
  changePct30d?: number | null;
  changePctYtd?: number | null;
  changePct1y?: number | null;
  high52w?: number | null;
  low52w?: number | null;
}

export interface ExchangeRateData {
  currency: string;
  rate: number;
  timestamp: Date;
  source: string;
}

const log = forProvider("commodities");

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
} as const;

/* ═══════════════════════════════════════════════════════════════════════
 * Symbol mapping: Simplize board symbol → our internal symbol
 * ═══════════════════════════════════════════════════════════════════════ */

const SIMPLIZE_SYMBOL_MAP: Record<string, string> = {
  // Domestic
  "GOLD-SJC-BUY": "GOLD_SJC_BUY",
  "GOLD-SJC-SELL": "GOLD_SJC_SELL",
  "STEEL-D10": "STEEL_D10",
  RON95: "GAS_RON95",
  RON92: "GAS_RON92",
  DIESEL: "DIESEL_DO",
  "PIG-VIETNAM": "PIG_NORTH",
  "TOM-THE-VIETNAM": "SHRIMP_CARD",
  "CA-TRA-VIETNAM": "CATFISH_TRA",
  // Energy
  "WTI-CRUDE-OIL": "WTI_CRUDE",
  "NATURAL-GAS": "GAS_NATURAL",
  "NEWCASTLE-COAL": "COAL_COKING",
  // Metals
  GOLD: "GOLD_WORLD",
  SLIVER: "SILVER", // upstream spelling
  SILVER: "SILVER",
  COPPER: "COPPER",
  NICKEL: "NICKEL",
  "IRON-ORE": "IRON_ORE",
  "IRON-HRC": "STEEL_HRC",
  // Agriculture
  CORN: "CORN",
  SOYBEAN: "SOYBEAN",
  RICE: "RICE",
  UREA: "FERTILIZER_UREA",
  "COFFEE-ARABICA": "COFFEE_ARABICA",
  "COFFEE-ROBUSTA": "COFFEE_ROBUSTA",
  COTTON: "COTTON",
  SUGAR: "SUGAR",
  // Dairy
  "WHOLE-MILK": "MILK_WMP",
  "SKIM-MILK": "MILK_SMP",
  // Rubber
  "RUBBER-TSR20-TOKYO": "RUBBER_TSR20",
  "RUBBER-RSS3-TOKYO": "RUBBER_RSS3",
  // Livestock (foreign)
  "PIG-CHINA": "PIG_CHINA",
};

/* ═══════════════════════════════════════════════════════════════════════
 * Unit normalisation
 *
 * Simplize mixes several unit conventions. We normalise every quote into a
 * (value, currency) pair where `value` is expressed in whole currency units:
 *   "Nghìn đồng/lượng" → ×1000 → VND
 *   "USd/BU", "US cent/lb" → ÷100 → USD
 *   "VNĐ/kg" → already VND, EXCEPT some rows quote thousands (see below)
 * ═══════════════════════════════════════════════════════════════════════ */

interface Normalised {
  value: number;
  currency: "VND" | "USD" | "JPY" | "CNY";
}

export function normaliseUnit(rawValue: number, unit: string): Normalised {
  const u = (unit || "").trim();
  const lower = u.toLowerCase();

  // ── Vietnamese "thousand dong" units ──
  if (lower.includes("nghìn đồng") || lower.includes("nghin dong")) {
    return { value: rawValue * 1000, currency: "VND" };
  }

  // ── Plain VND units ──
  if (lower.includes("vnđ") || lower.includes("vnd") || lower.includes("đồng")) {
    // Some rows (tôm thẻ, cá tra) are labelled "VNĐ/kg" but quoted in
    // thousands — a value under 1 000 for a per-kg farm-gate price is never
    // literal dong, so scale it. Live hog (~60 000) stays untouched.
    const value = rawValue > 0 && rawValue < 1000 ? rawValue * 1000 : rawValue;
    return { value, currency: "VND" };
  }

  // ── US cents (lower-case "d" in USd, or explicit "cent") ──
  if (u.startsWith("USd") || lower.includes("us cent") || lower.includes("cent/")) {
    return { value: rawValue / 100, currency: "USD" };
  }

  // ── Plain USD ──
  if (lower.includes("usd")) {
    return { value: rawValue, currency: "USD" };
  }

  // ── Other currencies ──
  if (lower.includes("jpy")) return { value: rawValue, currency: "JPY" };
  if (lower.includes("cny")) return { value: rawValue, currency: "CNY" };

  // Default: assume USD (all remaining Simplize rows are USD futures)
  return { value: rawValue, currency: "USD" };
}

/* ═══════════════════════════════════════════════════════════════════════
 * PRIMARY — Simplize commodity board
 * ═══════════════════════════════════════════════════════════════════════ */

interface SimplizeRow {
  ticker?: string;
  symbol?: string;
  name?: string;
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
  domestic?: boolean;
  esIndexType?: string;
}

/**
 * Extract every balanced JSON object that looks like a commodity row out of
 * the server-rendered flight payload. We scan for the `"ticker":` key and then
 * walk braces so nested objects/strings don't break the match.
 */
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
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) continue;

    const slice = html.slice(start, end);
    if (!slice.includes('"esIndexType":"commodity"')) continue;

    try {
      rows.push(JSON.parse(slice) as SimplizeRow);
    } catch {
      // Flight payloads occasionally escape quotes; retry once unescaped.
      try {
        rows.push(JSON.parse(slice.replace(/\\"/g, '"')) as SimplizeRow);
      } catch {
        /* skip malformed row */
      }
    }
  }

  // De-duplicate by ticker (the payload repeats rows across widgets).
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = r.ticker ?? r.symbol ?? "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchSimplizeCommodities(): Promise<CommodityPriceData[]> {
  return getBreaker("simplize-commodities").exec(async () => {
    const url = "https://simplize.vn/hang-hoa";
    const res = await fetchWithRetry(url, {
      provider: "simplize-commodities",
      timeoutMs: 20_000,
      retries: 2,
      headers: BROWSER_HEADERS,
    });
    const html = await res.text();
    const rows = extractSimplizeRows(html);

    if (rows.length === 0) {
      throw new ProviderError("simplize-commodities", "no commodity rows found in page payload", {
        htmlLength: html.length,
      });
    }

    const now = new Date();
    const out: CommodityPriceData[] = [];
    const unmapped: string[] = [];

    for (const r of rows) {
      const upstreamSymbol = (r.symbol ?? "").trim();
      const internal = SIMPLIZE_SYMBOL_MAP[upstreamSymbol];
      if (!internal) {
        if (upstreamSymbol) unmapped.push(upstreamSymbol);
        continue;
      }
      if (typeof r.indexClose !== "number" || !Number.isFinite(r.indexClose) || r.indexClose <= 0) {
        log.warn("simplize_row_bad_price", { symbol: upstreamSymbol, indexClose: r.indexClose });
        continue;
      }

      const { value, currency } = normaliseUnit(r.indexClose, r.unit ?? "");
      const prev =
        typeof r.indexClosePrev === "number" && r.indexClosePrev > 0
          ? normaliseUnit(r.indexClosePrev, r.unit ?? "").value
          : null;

      // Prefer the board's own intraday % change; else derive from prev close.
      let changePct1d: number | null =
        typeof r.pctChange === "number" && Number.isFinite(r.pctChange) ? r.pctChange : null;
      if ((changePct1d === null || changePct1d === 0) && prev && prev > 0) {
        const derived = ((value - prev) / prev) * 100;
        if (Number.isFinite(derived)) changePct1d = derived;
      }

      const hi = typeof r.close52wHigh === "number" ? normaliseUnit(r.close52wHigh, r.unit ?? "").value : null;
      const lo = typeof r.close52wLow === "number" ? normaliseUnit(r.close52wLow, r.unit ?? "").value : null;

      out.push({
        symbol: internal,
        price: value,
        currency,
        unit: r.unit ?? "",
        timestamp: now,
        source: "simplize.vn",
        prevClose: prev,
        changePct1d,
        changePct7d: numOrNull(r.pricePctChg7d),
        changePct30d: numOrNull(r.pricePctChg30d),
        changePctYtd: numOrNull(r.pricePctChgYtd),
        changePct1y: numOrNull(r.pricePctChg1y),
        high52w: hi,
        low52w: lo,
      });
    }

    log.info("simplize_parsed", {
      rowsFound: rows.length,
      mapped: out.length,
      unmapped: unmapped.length ? unmapped.slice(0, 10) : undefined,
    });

    if (out.length === 0) {
      throw new ProviderError("simplize-commodities", "parsed rows but none matched our symbol map");
    }
    return out;
  });
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ═══════════════════════════════════════════════════════════════════════
 * SECONDARY — VietnamBiz goods board (best effort)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Vietnamese goods names on VietnamBiz → our internal symbols. */
const VIETNAMBIZ_NAME_MAP: Array<{ match: RegExp; symbol: string }> = [
  { match: /thép\s*(cây|d10|xây dựng)/i, symbol: "STEEL_D10" },
  { match: /thép\s*hrc|hrc/i, symbol: "STEEL_HRC" },
  { match: /quặng\s*sắt/i, symbol: "IRON_ORE" },
  { match: /than\s*(cốc|nhiệt)/i, symbol: "COAL_COKING" },
  { match: /xăng\s*ron\s*95/i, symbol: "GAS_RON95" },
  { match: /xăng\s*ron\s*92/i, symbol: "GAS_RON92" },
  { match: /dầu\s*do|diesel/i, symbol: "DIESEL_DO" },
  { match: /khí\s*(thiên nhiên|tự nhiên)/i, symbol: "GAS_NATURAL" },
  { match: /^đồng\b|kim loại đồng/i, symbol: "COPPER" },
  { match: /nickel|niken/i, symbol: "NICKEL" },
  { match: /cao\s*su/i, symbol: "RUBBER_TSR20" },
  { match: /urê|ure\b|phân\s*đạm/i, symbol: "FERTILIZER_UREA" },
];

/**
 * VietnamBiz renders its table client-side. We still attempt a parse of any
 * SSR/JSON payload; if none exists we return an empty list (never fabricated
 * values) and let the caller fall back to Simplize.
 */
export async function fetchVietnamBizCommodities(): Promise<CommodityPriceData[]> {
  return getBreaker("vietnambiz-goods").exec(async () => {
    const url = "https://data.vietnambiz.vn/goods";
    const res = await fetchWithRetry(url, {
      provider: "vietnambiz-goods",
      timeoutMs: 20_000,
      retries: 1,
      headers: BROWSER_HEADERS,
    });
    const html = await res.text();
    const now = new Date();
    const out: CommodityPriceData[] = [];

    // Pattern A — Next.js __NEXT_DATA__ payload with a goods array.
    const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextData) {
      try {
        const parsed = JSON.parse(nextData[1]) as unknown;
        const rows = collectGoodsRows(parsed);
        for (const row of rows) {
          const name = String(row.name ?? row.goodsName ?? row.title ?? "");
          const raw = Number(row.value_d ?? row.value ?? row.price ?? NaN);
          if (!name || !Number.isFinite(raw) || raw <= 0) continue;
          const hit = VIETNAMBIZ_NAME_MAP.find((m) => m.match.test(name));
          if (!hit) continue;
          const unit = String(row.unit ?? "");
          const { value, currency } = normaliseUnit(raw, unit);
          const prev = Number(row.pre_value ?? NaN);
          out.push({
            symbol: hit.symbol,
            price: value,
            currency,
            unit,
            timestamp: now,
            source: "data.vietnambiz.vn",
            prevClose: Number.isFinite(prev) ? normaliseUnit(prev, unit).value : null,
            changePct1d:
              Number.isFinite(prev) && prev > 0 ? ((raw - prev) / prev) * 100 : null,
            changePct30d: numOrNull(Number(row.value_m)),
            changePct1y: numOrNull(Number(row.value_y)),
          });
        }
      } catch (err) {
        log.debug("vietnambiz_nextdata_parse_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (out.length === 0) {
      // Expected today: the board hydrates client-side, so there is nothing to
      // scrape server-side. Signal "unavailable" instead of returning junk.
      log.info("vietnambiz_no_ssr_data", {
        htmlLength: html.length,
        note: "page renders client-side; using Simplize as primary",
      });
    } else {
      log.info("vietnambiz_parsed", { mapped: out.length });
    }
    return out;
  });
}

/** Recursively hunt for arrays of goods-shaped objects inside a JSON blob. */
function collectGoodsRows(node: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 8 || node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    const looksLikeGoods =
      node.length > 0 &&
      typeof node[0] === "object" &&
      node[0] !== null &&
      ("value_d" in (node[0] as object) ||
        "pre_value" in (node[0] as object) ||
        "goodsName" in (node[0] as object));
    if (looksLikeGoods) return node as Array<Record<string, unknown>>;
    return node.flatMap((n) => collectGoodsRows(n, depth + 1));
  }
  return Object.values(node as Record<string, unknown>).flatMap((v) => collectGoodsRows(v, depth + 1));
}

/* ═══════════════════════════════════════════════════════════════════════
 * TERTIARY — Yahoo Finance (international futures only)
 * ═══════════════════════════════════════════════════════════════════════ */

const YAHOO_MAP: Array<{ symbol: string; yahoo: string; unit: string }> = [
  { symbol: "WTI_CRUDE", yahoo: "CL=F", unit: "USD/thùng" },
  { symbol: "GOLD_WORLD", yahoo: "GC=F", unit: "USD/ounce" },
  { symbol: "SILVER", yahoo: "SI=F", unit: "USD/ounce" },
  { symbol: "COPPER", yahoo: "HG=F", unit: "USD/lb" },
  { symbol: "GAS_NATURAL", yahoo: "NG=F", unit: "USD/mmBTU" },
  { symbol: "CORN", yahoo: "ZC=F", unit: "USc/bushel" },
  { symbol: "SOYBEAN", yahoo: "ZS=F", unit: "USc/bushel" },
  { symbol: "COFFEE_ARABICA", yahoo: "KC=F", unit: "USc/lb" },
  { symbol: "COTTON", yahoo: "CT=F", unit: "USc/lb" },
  { symbol: "SUGAR", yahoo: "SB=F", unit: "USc/lb" },
];

export async function fetchYahooCommodities(only?: Set<string>): Promise<CommodityPriceData[]> {
  const now = new Date();
  const targets = only ? YAHOO_MAP.filter((m) => only.has(m.symbol)) : YAHOO_MAP;
  const results = await Promise.allSettled(
    targets.map(async (m) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${m.yahoo}?interval=1d&range=5d`;
      const res = await fetchWithRetry(url, { provider: "yahoo-commodities", timeoutMs: 10_000, retries: 1 });
      const data = await readJsonSafe<{
        chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number; currency?: string } }> };
      }>(res, "yahoo-commodities", url);
      const meta = data.chart?.result?.[0]?.meta;
      const px = meta?.regularMarketPrice;
      if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) {
        throw new ProviderError("yahoo-commodities", `no price for ${m.yahoo}`);
      }
      const { value, currency } = normaliseUnit(px, m.unit);
      const prevRaw = meta?.chartPreviousClose;
      const prev = typeof prevRaw === "number" ? normaliseUnit(prevRaw, m.unit).value : null;
      const row: CommodityPriceData = {
        symbol: m.symbol,
        price: value,
        currency,
        unit: m.unit,
        timestamp: now,
        source: "yahoo.finance",
        prevClose: prev,
        changePct1d: prev && prev > 0 ? ((value - prev) / prev) * 100 : null,
      };
      return row;
    }),
  );
  return results.filter((r): r is PromiseFulfilledResult<CommodityPriceData> => r.status === "fulfilled").map((r) => r.value);
}

/* ═══════════════════════════════════════════════════════════════════════
 * Exchange rates — Vietcombank, with a documented static fallback
 * ═══════════════════════════════════════════════════════════════════════ */

export async function fetchExchangeRates(): Promise<ExchangeRateData[]> {
  const now = new Date();
  try {
    return await getBreaker("vcb-exchange").exec(async () => {
      const url = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx";
      const res = await fetchWithRetry(url, {
        provider: "vcb-exchange",
        timeoutMs: 12_000,
        retries: 2,
        headers: BROWSER_HEADERS,
      });
      const xml = await res.text();
      const rates: ExchangeRateData[] = [];

      for (const currency of ["USD", "JPY", "CNY"]) {
        // <Exrate CurrencyCode="USD" Buy="..." Transfer="..." Sell="..." />
        const re = new RegExp(`CurrencyCode="${currency}"[^>]*?Sell="([\\d,.]+)"`, "i");
        const m = xml.match(re);
        if (!m) continue;
        const rate = parseFloat(m[1].replace(/,/g, ""));
        if (!Number.isFinite(rate) || rate <= 0) continue;
        rates.push({ currency, rate, timestamp: now, source: "vietcombank" });
      }

      if (rates.length === 0) {
        throw new ProviderError("vcb-exchange", "no rates parsed from VCB XML", {
          snippet: xml.slice(0, 200),
        });
      }
      log.info("exchange_rates_fetched", { count: rates.length, source: "vietcombank" });
      return rates;
    });
  } catch (err) {
    log.warn("exchange_rates_fallback", {
      error: err instanceof Error ? err.message : String(err),
      note: "using last-known reference rates; conversions flagged with source=reference",
    });
    // Reference rates keep VND conversion working during a VCB outage. They are
    // explicitly labelled so the UI/admin can tell they are not live.
    return [
      { currency: "USD", rate: 26300, timestamp: now, source: "reference" },
      { currency: "JPY", rate: 172, timestamp: now, source: "reference" },
      { currency: "CNY", rate: 3690, timestamp: now, source: "reference" },
    ];
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Orchestrator — Simplize → VietnamBiz → Yahoo
 * ═══════════════════════════════════════════════════════════════════════ */

export async function fetchAllCommoditiesData(): Promise<{
  prices: CommodityPriceData[];
  exchangeRates: ExchangeRateData[];
  errors: string[];
}> {
  const errors: string[] = [];
  const bySymbol = new Map<string, CommodityPriceData>();

  // Exchange rates first — needed for VND conversion downstream.
  let exchangeRates: ExchangeRateData[] = [];
  try {
    exchangeRates = await fetchExchangeRates();
  } catch (err) {
    errors.push(`exchange-rates: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1️⃣ PRIMARY — Simplize (covers all 31 symbols).
  try {
    for (const p of await fetchSimplizeCommodities()) bySymbol.set(p.symbol, p);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`simplize: ${msg}`);
    log.error("simplize_failed", { error: msg });
  }

  // 2️⃣ SECONDARY — VietnamBiz fills any gap Simplize left.
  try {
    for (const p of await fetchVietnamBizCommodities()) {
      if (!bySymbol.has(p.symbol)) bySymbol.set(p.symbol, p);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`vietnambiz: ${msg}`);
    log.warn("vietnambiz_failed", { error: msg });
  }

  // 3️⃣ TERTIARY — Yahoo for any international symbol still missing.
  const missing = new Set(YAHOO_MAP.map((m) => m.symbol).filter((s) => !bySymbol.has(s)));
  if (missing.size > 0) {
    try {
      for (const p of await fetchYahooCommodities(missing)) {
        if (!bySymbol.has(p.symbol)) bySymbol.set(p.symbol, p);
      }
    } catch (err) {
      errors.push(`yahoo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const prices = [...bySymbol.values()];
  log.info("commodities_fetch_complete", {
    total: prices.length,
    bySource: prices.reduce<Record<string, number>>((acc, p) => {
      acc[p.source] = (acc[p.source] ?? 0) + 1;
      return acc;
    }, {}),
    errors: errors.length,
  });

  return { prices, exchangeRates, errors };
}
