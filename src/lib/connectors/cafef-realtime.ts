/**
 * Giá realtime từ CafeF — endpoint bắt trực tiếp từ DevTools của người dùng:
 *
 *   https://msh-datacenter.cafef.vn/price/api/v1/CompanyCompact/RealTimeChartHeader?index=1;2
 *
 * Lưu ý quan trọng:
 * - Response header `Access-Control-Allow-Origin: https://msh-iframe.cafef.vn`
 *   nên BROWSER của người dùng không gọi được từ origin khác. Module này chạy
 *   TRONG SERVER (Next API route) — CORS không áp dụng cho server → gọi được.
 * - Để tối đa khả năng được chấp nhận, request bắt chước đúng header mà widget
 *   msh-iframe của CafeF gửi (Origin/Referer/User-Agent như DevTools ghi lại).
 *
 * KHÔNG bịa dữ liệu: không parse được thì trả mảng rỗng, feed sẽ tự fallback.
 * Parser "khoan dung": nhận nhiều shape JSON (mảng trần, {data:[...]},
 * {Data:{Data:[...]}}…) và nhiều tên khóa (EN + VI) vì chưa có tài liệu chính
 * thức của endpoint này.
 */
import type { RealtimeQuote } from "@/lib/realtime-market-feed";

export const CAFEF_REALTIME_DEFAULT_URL =
  "https://msh-datacenter.cafef.vn/price/api/v1/CompanyCompact/RealTimeChartHeader";
export const CAFEF_REALTIME_DEFAULT_QUERY = "index=1;2";

type Json = Record<string, unknown>;

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    const parsed = Number(t.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNum(record: Json, keys: string[]): number | null {
  for (const key of keys) {
    const v = num(record[key]);
    if (v != null) return v;
  }
  // một số shape lồng giá vào object con 1 tầng
  for (const val of Object.values(record)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const v = firstNum(val as Json, keys);
      if (v != null) return v;
    }
  }
  return null;
}

function firstStr(record: Json, keys: string[]): string | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

const SYMBOL_KEYS = [
  "symbol", "Symbol", "ticker", "Ticker", "code", "Code", "secCode", "SecCode",
  "stockCode", "StockCode", "securityCode", "SecuritySymbol", "StockSymbol",
  "symbolCode", "s", "S", "sc",
];
const PRICE_KEYS = [
  "price", "Price", "last", "Last", "lastPrice", "LastPrice", "close", "Close",
  "currentPrice", "CurrentPrice", "priceCurrent", "p", "c", "GiaDongCua",
  "GiaDieuChinh", "ClosePrice",
];
const PCT_KEYS = [
  "changePct", "changePercent", "ChangePercent", "percentChange", "PercentChange",
  "pctChange", "percent", "Percent", "changeRate", "RateChange", "ThayDoi",
];
const OPEN_KEYS = ["open", "Open", "openPrice", "OpenPrice", "GiaMoCua"];
const HIGH_KEYS = ["high", "High", "highPrice", "HighPrice", "GiaCaoNhat"];
const LOW_KEYS = ["low", "Low", "lowPrice", "LowPrice", "GiaThapNhat"];
const VOLUME_KEYS = [
  "volume", "Volume", "vol", "Vol", "totalVolume", "matchVolume",
  "KhoiLuongKhopLenh", "volumeTrade",
];
const PREV_KEYS = [
  "prevClose", "PrevClose", "previousClose", "refPrice", "RefPrice",
  "priorClose", "closeYesterday",
];

export function extractCafefQuote(
  record: Json,
  timestamp: number,
): RealtimeQuote | null {
  const symbol = firstStr(record, SYMBOL_KEYS);
  const price = firstNum(record, PRICE_KEYS);
  if (!symbol || price == null || price <= 0) return null;
  if (!/^[A-Z0-9^=.]{1,15}$/.test(symbol)) return null;
  return {
    symbol,
    price,
    changePct: firstNum(record, PCT_KEYS),
    open: firstNum(record, OPEN_KEYS),
    high: firstNum(record, HIGH_KEYS),
    low: firstNum(record, LOW_KEYS),
    volume: firstNum(record, VOLUME_KEYS),
    prevClose: firstNum(record, PREV_KEYS),
    source: "cafef",
    timestamp,
  };
}

/** Quét sâu JSON (tối đa `maxDepth`) để gom mọi object trông giống một quote. */
export function collectCafefQuotes(
  payload: unknown,
  timestamp: number,
  max = 800,
  maxDepth = 6,
): RealtimeQuote[] {
  const out: RealtimeQuote[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (out.length >= max || depth > maxDepth) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Json;
      const quote = extractCafefQuote(record, timestamp);
      if (quote && !seen.has(quote.symbol)) {
        seen.add(quote.symbol);
        out.push(quote);
      }
      for (const val of Object.values(record)) {
        if (val && typeof val === "object") walk(val, depth + 1);
        if (out.length >= max) return;
      }
    }
  };
  walk(payload, 0);
  return out;
}

export interface CafefRealtimeResult {
  quotes: RealtimeQuote[];
  sourceUrl: string;
  warnings: string[];
}

export async function fetchCafefRealtimeQuotes(
  symbols: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<CafefRealtimeResult> {
  const baseUrl =
    process.env.CAFEF_REALTIME_URL?.trim() || CAFEF_REALTIME_DEFAULT_URL;
  const query =
    process.env.CAFEF_REALTIME_QUERY?.trim() || CAFEF_REALTIME_DEFAULT_QUERY;

  let url: URL;
  try {
    url = new URL(baseUrl);
    for (const [k, v] of new URLSearchParams(query)) url.searchParams.set(k, v);
  } catch {
    return { quotes: [], sourceUrl: baseUrl, warnings: ["CAFEF_REALTIME_URL không hợp lệ"] };
  }

  try {
    const res = await fetchImpl(url.toString(), {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        origin: "https://msh-iframe.cafef.vn",
        referer: "https://msh-iframe.cafef.vn/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return {
        quotes: [],
        sourceUrl: url.toString(),
        warnings: [`CafeF realtime HTTP ${res.status}`],
      };
    }
    const payload = (await res.json()) as unknown;
    const timestamp = Date.now();
    const all = collectCafefQuotes(payload, timestamp);
    const wanted = new Set(symbols.map((s) => s.toUpperCase()));
    const matched = all.filter((q) => wanted.has(q.symbol));
    // Nếu bảng trả về toàn thị trường nhưng không trùng mã nào được yêu cầu
    // (hoặc yêu cầu rỗng) thì vẫn trả về những gì parse được — UI tự lọc.
    const quotes = matched.length > 0 ? matched : all;
    return { quotes, sourceUrl: url.toString(), warnings: [] };
  } catch (e) {
    return {
      quotes: [],
      sourceUrl: url.toString(),
      warnings: [e instanceof Error ? e.message : "cafef realtime failed"],
    };
  }
}
