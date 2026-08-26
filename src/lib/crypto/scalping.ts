import type { Ohlcv } from "@/lib/connectors/core";
import type { OrderFlowIntelligence } from "./types";

export const SCALPING_TIMEFRAMES = ["1m", "5m", "15m"] as const;
export type ScalpingTimeframe = (typeof SCALPING_TIMEFRAMES)[number];
export type ScalpingDirection = "LONG" | "SHORT" | "WAIT";
export type ScalpingStrategy = "MODULE_A" | "MODULE_B" | "MODULE_C";
export type ScalpingState =
  | "DISCOVERED"
  | "QUALIFIED"
  | "AWAITING_CONFIRMATION"
  | "TRIGGERED"
  | "WATCH_ONLY"
  | "INVALIDATED"
  | "HALTED";
export type AssetGroup =
  | "LARGE_LIQUID"
  | "MID_LIQUID"
  | "HIGH_VOLATILITY"
  | "LOW_LIQUIDITY"
  | "NEW_OR_EVENT_RISK";

export interface ScalpingConfig {
  parameterVersion: string;
  accountEquity: number;
  riskPerTrade: number;
  maxOpenRisk: number;
  maxDailyLoss: number;
  minSetupScore: number;
  minDataCoverage: number;
  maxSpreadRatio: number;
  maxSlippageRatio: number;
  minVolume24hUsd: number;
  minimumRAfterCosts: number;
  feeRate: number;
  maxSetupAgeM5: number;
  maxSlAtrM1: number;
  maxRectangleAtrM15: number;
  priceTick: number;
  quantityStep: number;
  minNotional: number;
}

export const DEFAULT_SCALPING_CONFIG: ScalpingConfig = {
  parameterVersion: "crypto-scalping-1.0.0",
  accountEquity: 10_000,
  riskPerTrade: 0.0015,
  maxOpenRisk: 0.0075,
  maxDailyLoss: 0.0125,
  minSetupScore: 65,
  minDataCoverage: 0.99,
  maxSpreadRatio: 0.001,
  maxSlippageRatio: 0.0025,
  minVolume24hUsd: 1_000_000,
  minimumRAfterCosts: 1.2,
  feeRate: 0.0004,
  maxSetupAgeM5: 6,
  maxSlAtrM1: 2.5,
  maxRectangleAtrM15: 1.5,
  priceTick: 0,
  quantityStep: 0,
  minNotional: 5,
};

export interface ScalpingSymbolMeta {
  exchange: string;
  marketType: "spot" | "linear_perpetual" | "inverse";
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  priceTick: number;
  quantityStep: number;
  minNotional: number;
  group: AssetGroup;
  marketStatus: "ACTIVE" | "BLOCKED" | "REDUCE_ONLY" | "CLOSE_ONLY";
}

export interface ScalpingMarketData {
  meta: ScalpingSymbolMeta;
  bars: Record<ScalpingTimeframe, Ohlcv[]>;
  price: number | null;
  volume24hUsd: number | null;
  spreadRatio: number | null;
  orderFlow?: OrderFlowIntelligence | null;
  btcContextSafe?: boolean;
  nowMs?: number;
}

export interface DataQuality {
  coverage: Record<ScalpingTimeframe, number>;
  latestAgeSec: Record<ScalpingTimeframe, number | null>;
  gaps: string[];
  score: number;
  ok: boolean;
}

export interface RiskPlan {
  riskAmount: number;
  riskPerUnit: number;
  quantity: number;
  notional: number;
  estimatedFees: number;
  estimatedSlippage: number;
  valid: boolean;
  reason: string | null;
}

export interface ScalpingCandidate {
  strategy: ScalpingStrategy;
  symbol: string;
  direction: Exclude<ScalpingDirection, "WAIT">;
  state: ScalpingState;
  score: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardAfterCosts: number;
  reasons: string[];
  hardBlocks: string[];
  risk: RiskPlan;
  expiresAt: string | null;
  timeframes: ScalpingTimeframe[];
}

export interface ScalpingResult {
  symbol: string;
  generatedAt: string;
  signal: ScalpingDirection;
  state: ScalpingState;
  paperOnly: true;
  executionEnabled: false;
  dataQuality: DataQuality;
  group: AssetGroup;
  candidates: ScalpingCandidate[];
  bestCandidate: ScalpingCandidate | null;
  blockers: string[];
  config: Pick<ScalpingConfig, "parameterVersion" | "minSetupScore" | "riskPerTrade" | "maxOpenRisk">;
}

const TF_SECONDS: Record<ScalpingTimeframe, number> = { "1m": 60, "5m": 300, "15m": 900 };
const EPS = 1e-12;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function median(values: number[]): number {
  const clean = values.filter((v) => finite(v)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function roundDown(value: number, step: number): number {
  if (!finite(value) || value <= 0) return 0;
  if (!finite(step) || step <= 0) return value;
  return Math.floor((value + EPS) / step) * step;
}

function closedBars(bars: Ohlcv[], timeframe: ScalpingTimeframe, nowMs: number): Ohlcv[] {
  const cutoff = Math.floor(nowMs / 1000);
  return bars
    .filter((bar) => {
      const time = Number(bar.time);
      return finite(time) && time + TF_SECONDS[timeframe] <= cutoff;
    })
    .sort((a, b) => a.time - b.time);
}

function trueRange(bar: Ohlcv, previousClose: number): number {
  return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

function atr(bars: Ohlcv[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const ranges: number[] = [];
  for (let i = 1; i < bars.length; i++) ranges.push(trueRange(bars[i], bars[i - 1].close));
  return median(ranges.slice(-period)) || null;
}

function bodyRatio(bar: Ohlcv): number {
  return Math.abs(bar.close - bar.open) / Math.max(bar.high - bar.low, EPS);
}

function candleBodies(bars: Ohlcv[]): number[] {
  return bars.map((bar) => Math.abs(bar.close - bar.open));
}

function dataQuality(data: ScalpingMarketData, nowMs: number, config: ScalpingConfig = DEFAULT_SCALPING_CONFIG): DataQuality {
  const coverage = {} as Record<ScalpingTimeframe, number>;
  const latestAgeSec = {} as Record<ScalpingTimeframe, number | null>;
  const gaps: string[] = [];
  let score = 0;

  for (const tf of SCALPING_TIMEFRAMES) {
    const bars = closedBars(data.bars[tf] ?? [], tf, nowMs);
    const minBars = tf === "1m" ? 40 : 30;
    const expected = Math.max(minBars, bars.length);
    let missing = 0;
    for (let i = 1; i < bars.length; i++) {
      const delta = bars[i].time - bars[i - 1].time;
      if (delta > TF_SECONDS[tf] * 1.5) missing += Math.max(1, Math.round(delta / TF_SECONDS[tf]) - 1);
    }
    coverage[tf] = expected ? clamp((bars.length - missing) / expected, 0, 1) : 0;
    const latest = bars[bars.length - 1];
    latestAgeSec[tf] = latest ? Math.max(0, Math.floor(nowMs / 1000) - latest.time - TF_SECONDS[tf]) : null;
    if (coverage[tf] < config.minDataCoverage) gaps.push(`${tf}: coverage ${(coverage[tf] * 100).toFixed(1)}%`);
    if (!latest || (latestAgeSec[tf] ?? Infinity) > TF_SECONDS[tf] * 2) gaps.push(`${tf}: dữ liệu quá cũ`);
    if (bars.length >= minBars && coverage[tf] >= DEFAULT_SCALPING_CONFIG.minDataCoverage) score += 5;
  }

  if (data.meta.marketStatus !== "ACTIVE") gaps.push(`market_status=${data.meta.marketStatus}`);
  if (data.spreadRatio != null && data.spreadRatio > config.maxSpreadRatio) gaps.push("spread vượt ngưỡng");
  if (data.volume24hUsd != null && data.volume24hUsd < config.minVolume24hUsd) gaps.push("thanh khoản 24h thấp");
  const ok = gaps.length === 0 && score >= 15;
  return { coverage, latestAgeSec, gaps, score: clamp(score * 4, 0, 15), ok };
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  for (const value of values.slice(period)) result = alpha * value + (1 - alpha) * result;
  return result;
}

function breakoutBuffer(price: number, atrValue: number | null, tick: number): number {
  return Math.max(tick > 0 ? 2 * tick : 0, (atrValue ?? price * 0.001) * 0.05, price * 0.00005);
}

function riskPlan(
  direction: Exclude<ScalpingDirection, "WAIT">,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  data: ScalpingMarketData,
  config: ScalpingConfig,
): RiskPlan {
  const distance = Math.abs(entry - stopLoss);
  const costPerUnit = entry * (config.feeRate * 2 + Math.max(data.spreadRatio ?? 0, 0));
  const riskPerUnit = distance + costPerUnit;
  const riskAmount = Math.max(0, config.accountEquity * config.riskPerTrade);
  const quantity = roundDown(riskAmount / Math.max(riskPerUnit, EPS), data.meta.quantityStep || config.quantityStep);
  const notional = quantity * entry;
  const estimatedFees = notional * config.feeRate * 2;
  const estimatedSlippage = notional * Math.max(data.spreadRatio ?? 0, 0);
  const grossReward = Math.abs(takeProfit - entry);
  const netReward = Math.max(0, grossReward - costPerUnit);
  const rr = riskPerUnit > 0 ? netReward / riskPerUnit : 0;
  const wrongDirection = direction === "LONG" ? stopLoss >= entry || takeProfit <= entry : stopLoss <= entry || takeProfit >= entry;
  if (wrongDirection || !finite(entry) || !finite(stopLoss) || quantity <= 0) {
    return { riskAmount, riskPerUnit, quantity, notional, estimatedFees, estimatedSlippage, valid: false, reason: "entry/SL/TP hoặc quantity không hợp lệ" };
  }
  if (notional < (data.meta.minNotional || config.minNotional)) {
    return { riskAmount, riskPerUnit, quantity, notional, estimatedFees, estimatedSlippage, valid: false, reason: "notional dưới minNotional" };
  }
  if (rr < config.minimumRAfterCosts) {
    return { riskAmount, riskPerUnit, quantity, notional, estimatedFees, estimatedSlippage, valid: false, reason: `R:R sau chi phí ${rr.toFixed(2)} < ${config.minimumRAfterCosts}` };
  }
  return { riskAmount, riskPerUnit, quantity, notional, estimatedFees, estimatedSlippage, valid: true, reason: null };
}

function scoreCandidate(
  dataQualityScore: number,
  liquidityScore: number,
  structureScore: number,
  momentumScore: number,
  costScore: number,
  correlationScore: number,
): number {
  return Number(clamp(dataQualityScore + liquidityScore + structureScore + momentumScore + costScore + correlationScore, 0, 100).toFixed(1));
}

function candidateBase(
  strategy: ScalpingStrategy,
  direction: Exclude<ScalpingDirection, "WAIT">,
  data: ScalpingMarketData,
  config: ScalpingConfig,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  score: number,
  reasons: string[],
  timeframes: ScalpingTimeframe[],
  nowMs: number,
): ScalpingCandidate {
  const risk = riskPlan(direction, entry, stopLoss, takeProfit, data, config);
  const hardBlocks = [...dataQuality(data, nowMs, config).gaps];
  if (!data.btcContextSafe) hardBlocks.push("BTC market context chưa được xác nhận — paper/watch only");
  if (!risk.valid && risk.reason) hardBlocks.push(risk.reason);
  const qualified = score >= config.minSetupScore && hardBlocks.length === 0;
  const state: ScalpingState = qualified ? "QUALIFIED" : "WATCH_ONLY";
  const rr = risk.riskPerUnit > 0 ? Math.abs(takeProfit - entry) / risk.riskPerUnit : 0;
  const expiresAt = new Date(nowMs + config.maxSetupAgeM5 * 5 * 60_000).toISOString();
  return {
    strategy,
    symbol: data.meta.symbol,
    direction,
    state,
    score,
    entry,
    stopLoss,
    takeProfit,
    riskRewardAfterCosts: Number(rr.toFixed(2)),
    reasons,
    hardBlocks,
    risk,
    expiresAt,
    timeframes,
  };
}

function moduleA(data: ScalpingMarketData, config: ScalpingConfig, nowMs: number): ScalpingCandidate | null {
  const m15 = closedBars(data.bars["15m"] ?? [], "15m", nowMs);
  const m5 = closedBars(data.bars["5m"] ?? [], "5m", nowMs);
  const m1 = closedBars(data.bars["1m"] ?? [], "1m", nowMs);
  if (m15.length < 20 || m5.length < 20 || m1.length < 30) return null;
  const impulse = m15[m15.length - 2];
  const atr15 = atr(m15, 14);
  const bodies = candleBodies(m15.slice(-12, -2));
  const medianBody = median(bodies);
  const impulseRange = impulse.high - impulse.low;
  const volumeMedian = median(m15.slice(-12, -2).map((bar) => bar.volume));
  const impulseOk = Math.abs(impulse.close - impulse.open) >= 1.5 * Math.max(medianBody, EPS)
    && bodyRatio(impulse) >= 0.6
    && impulseRange >= 0.8 * Math.max(atr15 ?? impulseRange, EPS)
    && impulse.volume >= 1.1 * Math.max(volumeMedian, EPS);
  if (!impulseOk) return null;

  const direction: Exclude<ScalpingDirection, "WAIT"> = impulse.close >= impulse.open ? "LONG" : "SHORT";
  const level = direction === "LONG" ? impulse.high : impulse.low;
  const buffer = breakoutBuffer(impulse.close, atr(m5), data.meta.priceTick || config.priceTick);
  const breakout = m5.slice(-8).find((bar) => direction === "LONG" ? bar.close > level + buffer : bar.close < level - buffer);
  if (!breakout) return null;
  const trigger = m1.slice(-8).find((bar) => direction === "LONG"
    ? bar.low <= level + buffer && bar.close > level && bar.close > bar.open && bodyRatio(bar) >= 0.45
    : bar.high >= level - buffer && bar.close < level && bar.close < bar.open && bodyRatio(bar) >= 0.45);
  if (!trigger) return null;

  const entry = data.price ?? trigger.close;
  const recent = m1.slice(-12);
  const stopLoss = direction === "LONG"
    ? Math.min(...recent.map((bar) => bar.low), impulse.low) - buffer
    : Math.max(...recent.map((bar) => bar.high), impulse.high) + buffer;
  const risk = Math.abs(entry - stopLoss);
  if (risk > (atr(m1) ?? risk) * config.maxSlAtrM1) return null;
  const takeProfit = direction === "LONG" ? entry + risk * 1.35 : entry - risk * 1.35;
  const liquidity = data.volume24hUsd == null ? 10 : clamp(20 * Math.log10(Math.max(data.volume24hUsd, 1) / config.minVolume24hUsd) / 2, 0, 20);
  const cost = data.spreadRatio == null ? 8 : clamp(15 - data.spreadRatio / config.maxSpreadRatio * 15, 0, 15);
  const corr = data.btcContextSafe ? 10 : 4;
  const score = scoreCandidate(dataQuality(data, nowMs, config).score, liquidity, 18, 19, cost, corr);
  return candidateBase("MODULE_A", direction, data, config, entry, stopLoss, takeProfit, score, ["M15 impulse candle", "M5 breakout xác nhận", "M1 retest/trigger đã đóng"], ["15m", "5m", "1m"], nowMs);
}

function moduleB(data: ScalpingMarketData, config: ScalpingConfig, nowMs: number): ScalpingCandidate | null {
  const flow = data.orderFlow;
  const m5 = closedBars(data.bars["5m"] ?? [], "5m", nowMs);
  const m15 = closedBars(data.bars["15m"] ?? [], "15m", nowMs);
  if (!flow?.available || !flow.orderBook || flow.recentTrades.length < 10 || m5.length < 20 || m15.length < 20) return null;
  const orderBook = flow.orderBook;
  const total = flow.recentTrades.reduce((sum, trade) => sum + trade.notional, 0);
  const buy = flow.recentTrades.filter((trade) => trade.side === "BUY").reduce((sum, trade) => sum + trade.notional, 0);
  const sell = Math.max(0, total - buy);
  const netFlowRatio = total > 0 ? (buy - sell) / total : 0;
  const bookBias = orderBook.imbalance.bias;
  const direction = netFlowRatio > 0.12 && bookBias === "BUY_DOMINANT" ? "LONG" : netFlowRatio < -0.12 && bookBias === "SELL_DOMINANT" ? "SHORT" : null;
  if (!direction) return null;
  const rangeHigh = Math.max(...m15.slice(-8).map((bar) => bar.high));
  const rangeLow = Math.min(...m15.slice(-8).map((bar) => bar.low));
  const entry = data.price ?? m5[m5.length - 1].close;
  const range = Math.max(rangeHigh - rangeLow, EPS);
  const nearEdge = direction === "LONG" ? entry <= rangeLow + range * 0.35 : entry >= rangeHigh - range * 0.35;
  if (!nearEdge) return null;
  const buffer = breakoutBuffer(entry, atr(m5), data.meta.priceTick || config.priceTick);
  const stopLoss = direction === "LONG" ? rangeLow - buffer : rangeHigh + buffer;
  const risk = Math.abs(entry - stopLoss);
  const takeProfit = direction === "LONG" ? entry + risk * 1.3 : entry - risk * 1.3;
  const liquidity = orderBook.spreadBps == null ? 10 : clamp(20 - orderBook.spreadBps / 5, 0, 20);
  const momentum = clamp(10 + Math.abs(netFlowRatio) * 20 + Math.abs(orderBook.imbalance.bidPct - orderBook.imbalance.askPct) * 10, 0, 20);
  const score = scoreCandidate(dataQuality(data, nowMs, config).score, liquidity, 16, momentum, 14, data.btcContextSafe ? 10 : 4);
  return candidateBase("MODULE_B", direction, data, config, entry, stopLoss, takeProfit, score, ["CVD/aggressor flow đồng thuận", `Order-book ${bookBias.toLowerCase()}`, "Giá ở gần biên range thanh khoản"], ["15m", "5m"], nowMs);
}

function moduleC(data: ScalpingMarketData, config: ScalpingConfig, nowMs: number): ScalpingCandidate | null {
  const m15 = closedBars(data.bars["15m"] ?? [], "15m", nowMs);
  const m5 = closedBars(data.bars["5m"] ?? [], "5m", nowMs);
  if (m15.length < 25 || m5.length < 20) return null;
  const last = m15[m15.length - 1];
  const previous = m15.slice(-9, -1);
  const priorLow = Math.min(...previous.map((bar) => bar.low));
  const priorHigh = Math.max(...previous.map((bar) => bar.high));
  const atr15 = atr(m15);
  const buffer = breakoutBuffer(last.close, atr15, data.meta.priceTick || config.priceTick);
  const sweepLong = last.low < priorLow && last.close > priorLow && (last.close - last.low) / Math.max(last.high - last.low, EPS) >= 0.55;
  const sweepShort = last.high > priorHigh && last.close < priorHigh && (last.high - last.close) / Math.max(last.high - last.low, EPS) >= 0.55;
  const direction: Exclude<ScalpingDirection, "WAIT"> | null = sweepLong ? "LONG" : sweepShort ? "SHORT" : null;
  if (!direction) return null;
  const confirm = m5.slice(-6).some((bar) => direction === "LONG" ? bar.close > priorLow + buffer : bar.close < priorHigh - buffer);
  if (!confirm) return null;
  const entry = data.price ?? m5[m5.length - 1].close;
  const stopLoss = direction === "LONG" ? last.low - buffer : last.high + buffer;
  const risk = Math.abs(entry - stopLoss);
  if (atr15 && risk > atr15 * config.maxRectangleAtrM15) return null;
  const takeProfit = direction === "LONG" ? entry + risk * 1.3 : entry - risk * 1.3;
  const score = scoreCandidate(dataQuality(data, nowMs, config).score, 14, 19, 17, 13, data.btcContextSafe ? 10 : 4);
  return candidateBase("MODULE_C", direction, data, config, entry, stopLoss, takeProfit, score, ["M15 liquidity sweep", "M5 rectangle edge confirmation", "SL theo cực trị sweep + buffer"], ["15m", "5m"], nowMs);
}

export function classifyAsset(data: Pick<ScalpingMarketData, "volume24hUsd" | "spreadRatio">): AssetGroup {
  const volume = data.volume24hUsd ?? 0;
  const spread = data.spreadRatio ?? 1;
  if (spread > 0.003 || volume < 100_000) return "LOW_LIQUIDITY";
  if (spread <= 0.0005 && volume >= 100_000_000) return "LARGE_LIQUID";
  if (spread <= 0.001 && volume >= 10_000_000) return "MID_LIQUID";
  return "HIGH_VOLATILITY";
}

export function runCryptoScalping(
  input: ScalpingMarketData,
  overrides: Partial<ScalpingConfig> = {},
): ScalpingResult {
  const config = { ...DEFAULT_SCALPING_CONFIG, ...overrides };
  const nowMs = input.nowMs ?? Date.now();
  const quality = dataQuality(input, nowMs, config);
  const candidates = [moduleA(input, config, nowMs), moduleB(input, config, nowMs), moduleC(input, config, nowMs)]
    .filter((candidate): candidate is ScalpingCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score);
  const blockers = [...quality.gaps];
  if (input.meta.marketStatus !== "ACTIVE") blockers.push("market không ở trạng thái ACTIVE");
  if (input.btcContextSafe === false) blockers.push("BTC context đang RISK_OFF hoặc không an toàn");
  if (input.btcContextSafe === undefined) blockers.push("chưa có BTC context — không được auto-execute");
  const bestCandidate = candidates[0] ?? null;
  const executableCandidate = bestCandidate?.state === "QUALIFIED" || bestCandidate?.state === "TRIGGERED";
  const signal: ScalpingDirection = executableCandidate ? bestCandidate!.direction : "WAIT";
  const state: ScalpingState = bestCandidate?.state ?? (blockers.length ? "WATCH_ONLY" : "DISCOVERED");
  return {
    symbol: input.meta.symbol,
    generatedAt: new Date(nowMs).toISOString(),
    signal,
    state,
    paperOnly: true,
    executionEnabled: false,
    dataQuality: quality,
    group: input.meta.group || classifyAsset(input),
    candidates,
    bestCandidate,
    blockers: [...new Set(blockers)],
    config: {
      parameterVersion: config.parameterVersion,
      minSetupScore: config.minSetupScore,
      riskPerTrade: config.riskPerTrade,
      maxOpenRisk: config.maxOpenRisk,
    },
  };
}

export function normalizeScalpingBars(bars: Ohlcv[], timeframe: ScalpingTimeframe, nowMs = Date.now()): Ohlcv[] {
  const seen = new Set<number>();
  return closedBars(bars, timeframe, nowMs).filter((bar) => {
    if (seen.has(bar.time)) return false;
    seen.add(bar.time);
    return bar.high >= Math.max(bar.open, bar.close)
      && bar.low <= Math.min(bar.open, bar.close)
      && bar.volume >= 0;
  });
}
