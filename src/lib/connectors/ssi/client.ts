/**
 * SSI FastConnect REST market-data client.
 *
 * Wraps the five `GET /api/v3/data/*` endpoints this project uses:
 *   ohlc              — candles, `1m|3m|5m|15m|30m|1h|1d`
 *   securitiesByBoard — symbol universe incl. ICB sector codes
 *   securitiesSummary — per-symbol daily rollup incl. foreign flow
 *   indexList         — available indices
 *   indexSummary      — per-index rollup incl. EXCHANGE-WIDE BREADTH
 *   masterdata        — ceiling / floor / reference price
 *
 * Every numeric field arrives as a string and is normalised here. Anything
 * that cannot be parsed comes back as `null` rather than a guessed value —
 * the repo's rule is to surface "unavailable", never to fabricate.
 */

import {
  CONNECTOR_CONFIG,
  DataValidator,
  ProviderError,
  fetchWithRetry,
  readJsonSafe,
  type Ohlcv,
  type Quote,
} from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";
import { getSsiAccessToken } from "@/lib/connectors/ssi/auth";
import {
  SSI_PROVIDER,
  SSI_TIMEOUTS,
  formatSsiDate,
  num,
  parseSsiDate,
  ssiConfig,
  type SsiBoard,
  type SsiTimeframe,
} from "@/lib/connectors/ssi/config";

const log = forProvider(SSI_PROVIDER);

/** Confidence assigned to quotes sourced from SSI primary market data. */
const SSI_QUOTE_CONFIDENCE = 0.97;

async function ssiGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const config = ssiConfig();
  if (!config) throw new ProviderError(SSI_PROVIDER, "SSI credentials not configured");

  const token = await getSsiAccessToken();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  const url = `${config.restBaseUrl}${path}${query ? `?${query}` : ""}`;

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "vi",
      Authorization: `Bearer ${token}`,
    },
    timeoutMs: SSI_TIMEOUTS.rest,
    retries: CONNECTOR_CONFIG.retryAttempts,
    provider: SSI_PROVIDER,
    noRetryOnClientError: true,
  });

  if (!response.ok) {
    throw new ProviderError(SSI_PROVIDER, `${path} HTTP ${response.status}`, { path });
  }
  return (await readJsonSafe(response, SSI_PROVIDER, url)) as T;
}

// ---------------------------------------------------------------------------
// data/ohlc
// ---------------------------------------------------------------------------

export interface SsiOhlcRow {
  symbol: string | null;
  time: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  value: number | null;
}

interface RawOhlcResponse {
  data?: Array<Record<string, unknown>>;
  pageIndex?: number;
  pageSize?: number;
}

/**
 * Candles for one symbol.
 * Intraday history is capped at the last year; daily goes back to listing.
 */
export async function ssiOhlc(
  symbol: string,
  from: Date | number | string,
  to: Date | number | string,
  timeFrame: SsiTimeframe = "1d",
  pageIndex = 1,
  pageSize = 100,
): Promise<SsiOhlcRow[]> {
  const withTime = timeFrame !== "1d";
  const payload = await ssiGet<RawOhlcResponse>("/api/v3/data/ohlc", {
    symbol,
    from: formatSsiDate(from, withTime),
    to: formatSsiDate(to, withTime),
    timeFrame,
    pageIndex,
    pageSize,
  });

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row) => ({
    symbol: typeof row.symbol === "string" ? row.symbol : null,
    time: parseSsiDate(row.tradingDate),
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    close: num(row.close),
    volume: num(row.volume),
    value: num(row.value),
  }));
}

/** Validated candles in the repo's internal `Ohlcv` shape. */
export async function ssiOhlcv(
  symbol: string,
  from: Date | number | string,
  to: Date | number | string,
  timeFrame: SsiTimeframe = "1d",
): Promise<Ohlcv[]> {
  const rows = await ssiOhlc(symbol, from, to, timeFrame);
  const bars: Ohlcv[] = [];
  for (const row of rows) {
    const bar = DataValidator.ohlcv(
      {
        time: row.time ?? NaN,
        open: row.open ?? NaN,
        high: row.high ?? NaN,
        low: row.low ?? NaN,
        close: row.close ?? NaN,
        volume: row.volume ?? NaN,
      },
      { provider: SSI_PROVIDER, symbol },
    );
    if (bar) bars.push(bar);
  }
  return bars;
}

// ---------------------------------------------------------------------------
// data/masterdata — ceiling / floor / reference price
// ---------------------------------------------------------------------------

export interface SsiMasterData {
  symbol: string;
  exchange: string | null;
  tradingDate: number | null;
  ceiling: number | null;
  floor: number | null;
  refPrice: number | null;
}

interface RawMasterDataResponse {
  data?: Array<Record<string, unknown>>;
}

/**
 * Band limits for the market (or a date range).
 * Used both for display and as a hard validation gate on incoming quotes.
 */
export async function ssiMasterData(
  from?: Date | number | string,
  to?: Date | number | string,
  pageIndex = 1,
  pageSize = 100,
): Promise<SsiMasterData[]> {
  const payload = await ssiGet<RawMasterDataResponse>("/api/v3/data/masterdata", {
    from: from ? formatSsiDate(from) : undefined,
    to: to ? formatSsiDate(to) : undefined,
    pageIndex,
    pageSize,
  });

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((row) => ({
      symbol: String(row.symbol ?? "").toUpperCase(),
      exchange: typeof row.exchange === "string" ? row.exchange : null,
      tradingDate: parseSsiDate(row.tradingDate),
      ceiling: num(row.ceiling),
      floor: num(row.floor),
      refPrice: num(row.refPrice),
    }))
    .filter((row) => row.symbol.length > 0);
}

// ---------------------------------------------------------------------------
// data/securitiesByBoard — universe + ICB classification
// ---------------------------------------------------------------------------

export interface SsiSecurity {
  symbol: string;
  nameVi: string | null;
  nameEn: string | null;
  board: string | null;
  lotSize: number | null;
  listedShare: number | null;
  firstTradingDate: number | null;
  lastTradingDate: number | null;
  /** ICB industry classification — replaces the hardcoded sector lists. */
  icbCode: string | null;
  icbName: string | null;
  /** Covered-warrant fields (nullable for equities). */
  cwUnderlyingSymbol: string | null;
  cwExercisePrice: number | null;
  cwExecutionRatio: string | null;
  openInterest: number | null;
  settlementPrice: number | null;
}

/**
 * Symbol universe. Provide exactly one of `symbol`, `board` or `index`.
 * `?board=HOSE` returns the full HOSE universe.
 */
export async function ssiSecuritiesByBoard(filter: {
  symbol?: string;
  board?: SsiBoard;
  index?: string;
}): Promise<SsiSecurity[]> {
  const payload = await ssiGet<Array<Record<string, unknown>>>("/api/v3/data/securitiesByBoard", {
    symbol: filter.symbol,
    board: filter.board,
    index: filter.index,
  });

  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol: String(row.symbol ?? "").toUpperCase(),
      nameVi: typeof row.symbolNameVi === "string" ? row.symbolNameVi : null,
      nameEn: typeof row.symbolNameEn === "string" ? row.symbolNameEn : null,
      board: typeof row.board === "string" ? row.board : null,
      lotSize: num(row.lotSize),
      listedShare: num(row.listedShare),
      firstTradingDate: parseSsiDate(row.firstTradingDate),
      lastTradingDate: parseSsiDate(row.lastTradingDate),
      icbCode: typeof row.icbCode === "string" ? row.icbCode : null,
      icbName: typeof row.icbName === "string" ? row.icbName : null,
      cwUnderlyingSymbol: typeof row.cwUnderlyingSymbol === "string" ? row.cwUnderlyingSymbol : null,
      cwExercisePrice: num(row.cwExercisePrice),
      cwExecutionRatio: typeof row.cwExecutionRatio === "string" ? row.cwExecutionRatio : null,
      openInterest: num(row.openInterest),
      settlementPrice: num(row.settlementPrice),
    }))
    .filter((row) => row.symbol.length > 0);
}

// ---------------------------------------------------------------------------
// data/securitiesSummary — daily rollup + FOREIGN FLOW
// ---------------------------------------------------------------------------

export interface SsiSecuritiesSummary {
  symbol: string | null;
  tradingDate: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  average: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  totalMatch: number | null;
  totalMatchValue: number | null;
  totalBuy: number | null;
  totalSell: number | null;
  totalTradeBuy: number | null;
  totalTradeSell: number | null;
  /** Foreign flow — the fields this project has been missing. */
  foreignBuyVolume: number | null;
  foreignBuyValue: number | null;
  foreignSellVolume: number | null;
  foreignSellValue: number | null;
  /** Net foreign value, derived from the two fields above. */
  foreignNetValue: number | null;
  remainForeignRoom: number | null;
  totalForeignRoom: number | null;
  /** Percentage of foreign room remaining, derived. */
  foreignRoomPct: number | null;
  totalDeal: number | null;
  totalDealValue: number | null;
}

interface RawSummaryResponse {
  data?: Array<Record<string, unknown>>;
}

/**
 * Daily trading rollup for one symbol (or index).
 * This is the endpoint that unblocks foreign flow, which is currently
 * hard-coded to `unknown` in `src/lib/market.ts`.
 */
export async function ssiSecuritiesSummary(
  filter: { symbol?: string; index?: string },
  from: Date | number | string,
  to: Date | number | string,
  pageIndex = 1,
  pageSize = 100,
): Promise<SsiSecuritiesSummary[]> {
  const payload = await ssiGet<RawSummaryResponse>("/api/v3/data/securitiesSummary", {
    symbol: filter.symbol,
    index: filter.index,
    from: formatSsiDate(from),
    to: formatSsiDate(to),
    pageIndex,
    pageSize,
  });

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row) => {
    const buyValue = num(row.totalForeignBuyValue);
    const sellValue = num(row.totalForeignSellValue);
    const remainRoom = num(row.remainForeignRoom);
    const totalRoom = num(row.totalForeignRoom);

    return {
      symbol: typeof row.symbol === "string" ? row.symbol.toUpperCase() : null,
      tradingDate: parseSsiDate(row.tradingDate),
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      close: num(row.close),
      average: num(row.average),
      priceChange: num(row.priceChange),
      priceChangePct: num(row.priceChangePercentage),
      totalMatch: num(row.totalMatch),
      totalMatchValue: num(row.totalMatchValue),
      totalBuy: num(row.totalBuy),
      totalSell: num(row.totalSell),
      totalTradeBuy: num(row.totalTradeBuy),
      totalTradeSell: num(row.totalTradeSell),
      foreignBuyVolume: num(row.totalForeignBuy),
      foreignBuyValue: buyValue,
      foreignSellVolume: num(row.totalForeignSell),
      foreignSellValue: sellValue,
      foreignNetValue: buyValue != null && sellValue != null ? buyValue - sellValue : null,
      remainForeignRoom: remainRoom,
      totalForeignRoom: totalRoom,
      foreignRoomPct:
        remainRoom != null && totalRoom != null && totalRoom > 0 ? (remainRoom / totalRoom) * 100 : null,
      totalDeal: num(row.totalDeal),
      totalDealValue: num(row.totalDealValue),
    };
  });
}

/** Latest daily summary for a symbol, or `null` when unavailable. */
export async function ssiLatestSummary(symbol: string): Promise<SsiSecuritiesSummary | null> {
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 86_400_000);
  const rows = await ssiSecuritiesSummary({ symbol }, from, to, 1, 20);
  if (!rows.length) return null;
  return rows.reduce((latest, row) =>
    (row.tradingDate ?? 0) > (latest.tradingDate ?? 0) ? row : latest,
  );
}

/** Map the latest summary into the repo's internal `Quote` shape. */
export function summaryToQuote(summary: SsiSecuritiesSummary, symbol: string): Quote | null {
  if (summary.close == null) return null;
  const prevClose = summary.priceChange != null ? summary.close - summary.priceChange : null;
  return DataValidator.quote(
    {
      symbol,
      time: summary.tradingDate ?? Math.floor(Date.now() / 1000),
      open: summary.open ?? summary.close,
      high: summary.high ?? summary.close,
      low: summary.low ?? summary.close,
      close: summary.close,
      volume: summary.totalMatch ?? 0,
      prevClose,
      changePct: summary.priceChangePct,
      source: SSI_PROVIDER,
      confidence: SSI_QUOTE_CONFIDENCE,
    },
    { provider: SSI_PROVIDER },
  );
}

// ---------------------------------------------------------------------------
// data/indexList + data/indexSummary
// ---------------------------------------------------------------------------

export interface SsiIndex {
  index: string;
  indexName: string | null;
  board: string | null;
}

export async function ssiIndexList(board?: SsiBoard): Promise<SsiIndex[]> {
  const payload = await ssiGet<Array<Record<string, unknown>>>("/api/v3/data/indexList", { board });
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      index: String(row.index ?? "").toUpperCase(),
      indexName: typeof row.indexName === "string" ? row.indexName : null,
      board: typeof row.board === "string" ? row.board : null,
    }))
    .filter((row) => row.index.length > 0);
}

export interface SsiIndexSummary {
  tradingDate: number | null;
  indexValue: number | null;
  indexChange: number | null;
  indexChangePct: number | null;
  totalTrade: number | null;
  totalTradeValue: number | null;
  totalMatch: number | null;
  totalMatchValue: number | null;
  totalDeal: number | null;
  totalDealValue: number | null;
  /**
   * Exchange-wide breadth. A single call replaces counting the ~20-symbol
   * featured universe, which is why `scope` can finally become "market".
   */
  advancing: number | null;
  declining: number | null;
  unchanged: number | null;
  ceiling: number | null;
  floor: number | null;
  /** Proprietary (tự doanh) flow. */
  propBuyValue: number | null;
  propSellValue: number | null;
  propNetValue: number | null;
}

/**
 * Per-index daily rollup including exchange-wide breadth.
 * Provide exactly one of `board` or `index`.
 */
export async function ssiIndexSummary(
  filter: { board?: SsiBoard; index?: string },
  tradingDate?: Date | number | string,
): Promise<SsiIndexSummary[]> {
  const payload = await ssiGet<Array<Record<string, unknown>>>("/api/v3/data/indexSummary", {
    board: filter.board,
    index: filter.index,
    tradingDate: tradingDate ? formatSsiDate(tradingDate) : undefined,
  });

  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => {
    const propBuy = num(row.totalPropBuyValue);
    const propSell = num(row.totalPropSellValue);
    return {
      tradingDate: parseSsiDate(row.tradingDate),
      indexValue: num(row.indexValue),
      indexChange: num(row.indexChange),
      indexChangePct: num(row.indexChangePercentage),
      totalTrade: num(row.totalTrade),
      totalTradeValue: num(row.totalTradeValue),
      totalMatch: num(row.totalMatch),
      totalMatchValue: num(row.totalMatchValue),
      totalDeal: num(row.totalDeal),
      totalDealValue: num(row.totalDealValue),
      advancing: num(row.totalAdvanceStock),
      declining: num(row.totalDeclineStock),
      unchanged: num(row.totalNoChangeStock),
      ceiling: num(row.totalCeilingStock),
      floor: num(row.totalFloorStock),
      propBuyValue: propBuy,
      propSellValue: propSell,
      propNetValue: propBuy != null && propSell != null ? propBuy - propSell : null,
    };
  });
}

/** Latest index summary, or `null`. */
export async function ssiLatestIndexSummary(index: string): Promise<SsiIndexSummary | null> {
  const rows = await ssiIndexSummary({ index });
  if (!rows.length) return null;
  return rows.reduce((latest, row) =>
    (row.tradingDate ?? 0) > (latest.tradingDate ?? 0) ? row : latest,
  );
}

/** Lightweight connectivity probe for the ops console. */
export async function ssiProbe(): Promise<{ ok: boolean; latencyMs: number; indices: number; error?: string }> {
  const started = Date.now();
  try {
    const indices = await ssiIndexList();
    log.info("ssi_probe_ok", { latencyMs: Date.now() - started, indices: indices.length });
    return { ok: true, latencyMs: Date.now() - started, indices: indices.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("ssi_probe_failed", { latencyMs: Date.now() - started, error: message });
    return { ok: false, latencyMs: Date.now() - started, indices: 0, error: message };
  }
}
