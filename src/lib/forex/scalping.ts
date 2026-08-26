import type { Ohlcv } from "@/lib/connectors/core";
import type { ForexPairDef } from "./data";

export const FOREX_SCALPING_TIMEFRAMES = ["1m", "5m", "15m"] as const;
export type ForexScalpingTimeframe = (typeof FOREX_SCALPING_TIMEFRAMES)[number];
export type ForexScalpingDirection = "BUY" | "SELL" | "WAIT";
export type ForexScalpingStrategy = "MODULE_A" | "MODULE_B" | "MODULE_C";
export type ForexScalpingState = "DISCOVERED" | "QUALIFIED" | "AWAITING_CONFIRMATION" | "TRIGGERED" | "WATCH_ONLY" | "INVALIDATED" | "HALTED";
export type ForexPairGroup = "MAJOR" | "MINOR_CROSS" | "COMMODITY_CURRENCY" | "EMERGING_OR_EXOTIC" | "BROKER_SYNTHETIC";

export interface ForexScalpingConfig {
  parameterVersion: string;
  accountCurrency: string;
  accountEquity: number;
  riskPerTrade: number;
  maxOpenRisk: number;
  maxDailyLoss: number;
  minSetupScore: number;
  minDataCoverage: number;
  minimumRAfterCosts: number;
  commissionPerLot: number;
  slippageFractionOfStop: number;
  maxSetupAgeM5: number;
  maxSlAtrM1: number;
  maxRectangleAtrM15: number;
  minTickVolumeRatio: number;
  breakoutBufferAtr: number;
  minBodyRatio: number;
  rolloverBufferMinutes: number;
  maxSpreadPipsByGroup: Record<ForexPairGroup, number>;
}

export const DEFAULT_FOREX_SCALPING_CONFIG: ForexScalpingConfig = {
  parameterVersion: "forex-scalping-1.0.0",
  accountCurrency: "USD",
  accountEquity: 10_000,
  riskPerTrade: 0.0015,
  maxOpenRisk: 0.0075,
  maxDailyLoss: 0.0125,
  minSetupScore: 65,
  minDataCoverage: 0.99,
  minimumRAfterCosts: 1.2,
  commissionPerLot: 0,
  slippageFractionOfStop: 0.25,
  maxSetupAgeM5: 6,
  maxSlAtrM1: 2.5,
  maxRectangleAtrM15: 1.5,
  minTickVolumeRatio: 1.1,
  breakoutBufferAtr: 0.05,
  minBodyRatio: 0.6,
  rolloverBufferMinutes: 20,
  maxSpreadPipsByGroup: {
    MAJOR: 1.2,
    MINOR_CROSS: 2.0,
    COMMODITY_CURRENCY: 1.8,
    EMERGING_OR_EXOTIC: 4.0,
    BROKER_SYNTHETIC: 3.0,
  },
};

export interface ForexScalpingMeta {
  broker: string;
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  accountCurrency: string;
  digits: number;
  point: number;
  pipSize: number;
  contractSize: number;
  minLot: number;
  lotStep: number;
  maxLot: number;
  group: ForexPairGroup;
  marketStatus: "ACTIVE" | "BLOCKED" | "CLOSE_ONLY" | "REDUCE_ONLY";
  pipValueApproximate: boolean;
}

export interface ForexScalpingMarketData {
  meta: ForexScalpingMeta;
  bars: Record<ForexScalpingTimeframe, Ohlcv[]>;
  quote: { price: number; bid: number | null; ask: number | null; spreadPips: number | null; timestamp?: string } | null;
  quoteToAccountRate?: number;
  newsLock?: boolean;
  newsState?: string;
  sessionAllowed?: boolean;
  sessionLabel?: string;
  secondsToRollover?: number | null;
  minRolloverBufferSeconds?: number;
  dailyLoss?: number;
  openRisk?: number;
  nowMs?: number;
}

export interface ForexDataQuality {
  coverage: Record<ForexScalpingTimeframe, number>;
  latestAgeSec: Record<ForexScalpingTimeframe, number | null>;
  gaps: string[];
  score: number;
  ok: boolean;
}

export interface ForexRiskPlan {
  riskAmount: number;
  pipDistance: number;
  pipValuePerLot: number;
  costPerLot: number;
  riskPerLot: number;
  lotSize: number;
  notional: number;
  estimatedCommission: number;
  estimatedSlippage: number;
  valid: boolean;
  reason: string | null;
}

export interface ForexScalpingCandidate {
  strategy: ForexScalpingStrategy;
  symbol: string;
  direction: Exclude<ForexScalpingDirection, "WAIT">;
  state: ForexScalpingState;
  score: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePips: number;
  riskRewardAfterCosts: number;
  reasons: string[];
  hardBlocks: string[];
  risk: ForexRiskPlan;
  currencyExposure: Record<string, number>;
  expiresAt: string;
  timeframes: ForexScalpingTimeframe[];
}

export interface ForexScalpingResult {
  symbol: string;
  generatedAt: string;
  signal: ForexScalpingDirection;
  state: ForexScalpingState;
  paperOnly: true;
  executionEnabled: false;
  dataQuality: ForexDataQuality;
  candidates: ForexScalpingCandidate[];
  bestCandidate: ForexScalpingCandidate | null;
  blockers: string[];
  config: Pick<ForexScalpingConfig, "parameterVersion" | "minSetupScore" | "riskPerTrade" | "maxOpenRisk">;
}

const TF_SECONDS: Record<ForexScalpingTimeframe, number> = { "1m": 60, "5m": 300, "15m": 900 };
const EPS = 1e-12;

function finite(n: unknown): n is number { return typeof n === "number" && Number.isFinite(n); }
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function median(values: number[]) { const xs = values.filter(finite).sort((a, b) => a - b); if (!xs.length) return 0; const m = Math.floor(xs.length / 2); return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; }
function roundDown(value: number, step: number) { return step > 0 ? Math.floor((value + EPS) / step) * step : value; }
function closedBars(bars: Ohlcv[], tf: ForexScalpingTimeframe, nowMs: number) {
  const now = Math.floor(nowMs / 1000);
  return bars.filter((b) => finite(b.time) && b.time + TF_SECONDS[tf] <= now && finite(b.open) && finite(b.high) && finite(b.low) && finite(b.close)).sort((a, b) => a.time - b.time);
}
function trueRange(bar: Ohlcv, previousClose: number) { return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)); }
function atr(bars: Ohlcv[], period = 14) { if (bars.length < period + 1) return null; return median(bars.slice(-period).map((b, i, xs) => trueRange(b, i ? xs[i - 1].close : bars[bars.length - period - 1].close))); }
function bodyRatio(b: Ohlcv) { return Math.abs(b.close - b.open) / Math.max(b.high - b.low, EPS); }
function volumeRatio(current: Ohlcv, previous: Ohlcv[]) { const vols = previous.map((b) => b.volume).filter((v): v is number => finite(v) && v > 0); return vols.length ? (current.volume ?? 0) / Math.max(median(vols), EPS) : null; }
function pipDistance(a: number, b: number, meta: ForexScalpingMeta) { return Math.abs(a - b) / meta.pipSize; }
function bufferPrice(price: number, atrValue: number | null, meta: ForexScalpingMeta, config: ForexScalpingConfig) { return Math.max(0.5 * meta.pipSize, (atrValue ?? price * 0.001) * config.breakoutBufferAtr); }

function dataQuality(data: ForexScalpingMarketData, nowMs: number, config: ForexScalpingConfig): ForexDataQuality {
  const coverage = {} as Record<ForexScalpingTimeframe, number>;
  const latestAgeSec = {} as Record<ForexScalpingTimeframe, number | null>;
  const gaps: string[] = [];
  let score = 0;
  for (const tf of FOREX_SCALPING_TIMEFRAMES) {
    const bars = closedBars(data.bars[tf] ?? [], tf, nowMs);
    const minBars = tf === "1m" ? 40 : 30;
    let missing = 0;
    for (let i = 1; i < bars.length; i++) { const delta = bars[i].time - bars[i - 1].time; if (delta > TF_SECONDS[tf] * 1.5) missing += Math.max(1, Math.round(delta / TF_SECONDS[tf]) - 1); }
    coverage[tf] = bars.length ? clamp((bars.length - missing) / Math.max(minBars, bars.length), 0, 1) : 0;
    const last = bars.at(-1);
    latestAgeSec[tf] = last ? Math.max(0, Math.floor(nowMs / 1000) - last.time - TF_SECONDS[tf]) : null;
    if (!last || bars.length < minBars) gaps.push(`${tf}: thiếu nến đóng (${bars.length}/${minBars})`);
    if (coverage[tf] < config.minDataCoverage) gaps.push(`${tf}: coverage ${(coverage[tf] * 100).toFixed(1)}%`);
    if ((latestAgeSec[tf] ?? Infinity) > TF_SECONDS[tf] * 2) gaps.push(`${tf}: dữ liệu quá cũ`);
    if (bars.length >= minBars && coverage[tf] >= config.minDataCoverage) score += 5;
  }
  if (data.meta.marketStatus !== "ACTIVE") gaps.push(`broker_status=${data.meta.marketStatus}`);
  const maxSpread = config.maxSpreadPipsByGroup[data.meta.group];
  if (data.quote?.spreadPips != null && data.quote.spreadPips > maxSpread) gaps.push(`spread ${data.quote.spreadPips.toFixed(2)}p > ${maxSpread.toFixed(2)}p`);
  if (data.quote && (!finite(data.quote.price) || (data.quote.bid != null && data.quote.bid <= 0) || (data.quote.ask != null && data.quote.ask <= 0))) gaps.push("bid/ask không hợp lệ");
  return { coverage, latestAgeSec, gaps: [...new Set(gaps)], score: clamp(score, 0, 15), ok: gaps.length === 0 && score >= 15 };
}

function riskPlan(direction: Exclude<ForexScalpingDirection, "WAIT">, entry: number, stopLoss: number, takeProfit: number, data: ForexScalpingMarketData, config: ForexScalpingConfig): ForexRiskPlan {
  const meta = data.meta;
  const stopPips = pipDistance(entry, stopLoss, meta);
  const rate = data.quoteToAccountRate ?? 1;
  const pipValue = meta.contractSize * meta.pipSize * rate;
  const spreadPips = data.quote?.spreadPips ?? 0;
  const estimatedSlippage = stopPips * config.slippageFractionOfStop * pipValue;
  const costPerLot = spreadPips * pipValue + config.commissionPerLot + estimatedSlippage;
  const riskPerLot = stopPips * pipValue + costPerLot;
  const riskAmount = Math.max(0, config.accountEquity * config.riskPerTrade);
  const lotSize = roundDown(riskAmount / Math.max(riskPerLot, EPS), meta.lotStep);
  const notional = lotSize * entry * meta.contractSize;
  const estimatedCommission = lotSize * config.commissionPerLot;
  const grossReward = pipDistance(entry, takeProfit, meta) * pipValue * lotSize;
  const netReward = Math.max(0, grossReward - costPerLot * lotSize);
  const rr = riskPerLot * lotSize > 0 ? netReward / (riskPerLot * lotSize) : 0;
  const wrongDirection = direction === "BUY" ? stopLoss >= entry || takeProfit <= entry : stopLoss <= entry || takeProfit >= entry;
  let reason: string | null = null;
  if (wrongDirection || !finite(entry) || !finite(stopLoss) || lotSize <= 0) reason = "entry/SL/TP hoặc lot không hợp lệ";
  else if (lotSize < meta.minLot) reason = "lot dưới minLot";
  else if (rr < config.minimumRAfterCosts) reason = `R:R sau chi phí ${rr.toFixed(2)} < ${config.minimumRAfterCosts}`;
  return { riskAmount, pipDistance: stopPips, pipValuePerLot: pipValue, costPerLot, riskPerLot, lotSize, notional, estimatedCommission, estimatedSlippage: estimatedSlippage * lotSize, valid: reason === null, reason };
}

function score(data: ForexScalpingMarketData, quality: ForexDataQuality, structure: number, momentum: number, tp: number, nowMs: number, config: ForexScalpingConfig) {
  const maxSpread = config.maxSpreadPipsByGroup[data.meta.group];
  const spreadScore = data.quote?.spreadPips == null ? 8 : clamp(20 - data.quote.spreadPips / Math.max(maxSpread, EPS) * 20, 0, 20);
  const session = data.sessionAllowed === false || data.newsLock ? 0 : 15;
  const age = data.quote?.timestamp ? Math.max(0, nowMs - Date.parse(data.quote.timestamp)) : 0;
  return Number(clamp(quality.score + spreadScore + structure + momentum + tp + session - (age > 60_000 ? 5 : 0), 0, 100).toFixed(1));
}

function candidateBase(strategy: ForexScalpingStrategy, direction: Exclude<ForexScalpingDirection, "WAIT">, entry: number, stopLoss: number, takeProfit: number, data: ForexScalpingMarketData, config: ForexScalpingConfig, quality: ForexDataQuality, reasons: string[], tfs: ForexScalpingTimeframe[], nowMs: number, structure: number, momentum: number, tp: number): ForexScalpingCandidate {
  const risk = riskPlan(direction, entry, stopLoss, takeProfit, data, config);
  const hardBlocks = [...quality.gaps];
  if (data.newsLock) hardBlocks.push(`NEWS_LOCK${data.newsState ? `:${data.newsState}` : ""}`);
  if (data.sessionAllowed === false) hardBlocks.push("session không được cấu hình cho cặp");
  if (data.secondsToRollover != null && data.secondsToRollover < (data.minRolloverBufferSeconds ?? config.rolloverBufferMinutes * 60)) hardBlocks.push("gần rollover");
  if (data.dailyLoss != null && data.dailyLoss >= config.maxDailyLoss) hardBlocks.push("daily loss đã chạm trần");
  if (data.openRisk != null && data.openRisk + config.riskPerTrade > config.maxOpenRisk) hardBlocks.push("vượt max open risk");
  if (data.meta.pipValueApproximate) hardBlocks.push("pip value đang là ước tính — paper/watch only");
  if (risk.reason) hardBlocks.push(risk.reason);
  const candidateScore = score(data, quality, structure, momentum, tp, nowMs, config);
  const state: ForexScalpingState = candidateScore >= config.minSetupScore && hardBlocks.length === 0 ? "QUALIFIED" : "WATCH_ONLY";
  return { strategy, symbol: data.meta.symbol, direction, state, score: candidateScore, entry, stopLoss, takeProfit, stopDistancePips: Number(risk.pipDistance.toFixed(2)), riskRewardAfterCosts: Number((risk.riskPerLot > 0 ? (pipDistance(entry, takeProfit, data.meta) * Math.max(data.quoteToAccountRate ?? 1, EPS) * data.meta.pipSize * data.meta.contractSize - risk.costPerLot) / risk.riskPerLot : 0).toFixed(2)), reasons, hardBlocks: [...new Set(hardBlocks)], risk, currencyExposure: { [data.meta.baseCurrency]: direction === "BUY" ? risk.riskAmount : -risk.riskAmount, [data.meta.quoteCurrency]: direction === "BUY" ? -risk.riskAmount : risk.riskAmount }, expiresAt: new Date(nowMs + config.maxSetupAgeM5 * 5 * 60_000).toISOString(), timeframes: tfs };
}

function moduleA(data: ForexScalpingMarketData, config: ForexScalpingConfig, quality: ForexDataQuality, nowMs: number): ForexScalpingCandidate | null {
  const m15 = closedBars(data.bars["15m"] ?? [], "15m", nowMs); const m5 = closedBars(data.bars["5m"] ?? [], "5m", nowMs); const m1 = closedBars(data.bars["1m"] ?? [], "1m", nowMs);
  if (m15.length < 20 || m5.length < 20 || m1.length < 30) return null;
  const impulse = m15.at(-2)!; const atr15 = atr(m15); const bodies = m15.slice(-12, -2).map((b) => Math.abs(b.close - b.open)); const medianBody = median(bodies); const vr = volumeRatio(impulse, m15.slice(-12, -2));
  if (Math.abs(impulse.close - impulse.open) < 1.5 * Math.max(medianBody, EPS) || bodyRatio(impulse) < config.minBodyRatio || (impulse.high - impulse.low) < 0.8 * Math.max(atr15 ?? impulse.high - impulse.low, EPS) || (vr != null && vr < config.minTickVolumeRatio)) return null;
  const direction = impulse.close >= impulse.open ? "BUY" : "SELL"; const level = direction === "BUY" ? impulse.high : impulse.low; const buffer = bufferPrice(impulse.close, atr(m5), data.meta, config); const breakout = m5.slice(-8).find((b) => direction === "BUY" ? b.close > level + buffer : b.close < level - buffer); if (!breakout) return null;
  const trigger = m1.slice(-8).find((b) => direction === "BUY" ? b.low <= level + buffer && b.close > level && b.close > b.open && bodyRatio(b) >= 0.45 : b.high >= level - buffer && b.close < level && b.close < b.open && bodyRatio(b) >= 0.45); if (!trigger) return null;
  const entry = data.quote?.price ?? trigger.close; const recent = m1.slice(-12); const stopLoss = direction === "BUY" ? Math.min(...recent.map((b) => b.low), impulse.low) - buffer : Math.max(...recent.map((b) => b.high), impulse.high) + buffer; const stop = pipDistance(entry, stopLoss, data.meta); if (stop > (atr(m1) ?? Math.abs(entry - stopLoss)) / data.meta.pipSize * config.maxSlAtrM1) return null; const takeProfit = direction === "BUY" ? entry + (entry - stopLoss) * 1.35 : entry - (stopLoss - entry) * 1.35;
  return candidateBase("MODULE_A", direction, entry, stopLoss, takeProfit, data, config, quality, ["M15 impulse đã đóng", "M5 breakout đóng ngoài biên", "M1 retest/trigger đã đóng"], ["15m", "5m", "1m"], nowMs, 20, 15, 15);
}

function moduleB(data: ForexScalpingMarketData, config: ForexScalpingConfig, quality: ForexDataQuality, nowMs: number): ForexScalpingCandidate | null {
  const m5 = closedBars(data.bars["5m"] ?? [], "5m", nowMs); const m15 = closedBars(data.bars["15m"] ?? [], "15m", nowMs); if (m5.length < 20 || m15.length < 20) return null;
  const recent = m5.slice(-20); const signed = recent.reduce((sum, b) => sum + (b.close >= b.open ? 1 : -1) * (b.volume ?? 0), 0); const total = recent.reduce((sum, b) => sum + (b.volume ?? 0), 0); if (total <= 0) return null;
  const flow = signed / total; const rangeHigh = Math.max(...m15.slice(-8).map((b) => b.high)); const rangeLow = Math.min(...m15.slice(-8).map((b) => b.low)); const entry = data.quote?.price ?? m5.at(-1)!.close; const range = Math.max(rangeHigh - rangeLow, EPS); const direction: Exclude<ForexScalpingDirection, "WAIT"> | null = flow > 0.12 && entry <= rangeLow + range * 0.4 ? "BUY" : flow < -0.12 && entry >= rangeHigh - range * 0.4 ? "SELL" : null; if (!direction) return null;
  const last = m5.at(-1)!; const vr = volumeRatio(last, recent.slice(0, -1)); if (vr != null && vr < config.minTickVolumeRatio) return null; const buffer = bufferPrice(entry, atr(m5), data.meta, config); const stopLoss = direction === "BUY" ? rangeLow - buffer : rangeHigh + buffer; const takeProfit = direction === "BUY" ? entry + Math.abs(entry - stopLoss) * 1.3 : entry - Math.abs(entry - stopLoss) * 1.3;
  return candidateBase("MODULE_B", direction, entry, stopLoss, takeProfit, data, config, quality, [`tick_volume_delta_proxy=${flow.toFixed(3)}`, "range edge reaction", "displacement/range proxy — không phải CVD thị trường"], ["15m", "5m"], nowMs, 16, 16, 14);
}

function moduleC(data: ForexScalpingMarketData, config: ForexScalpingConfig, quality: ForexDataQuality, nowMs: number): ForexScalpingCandidate | null {
  const m15 = closedBars(data.bars["15m"] ?? [], "15m", nowMs); const m5 = closedBars(data.bars["5m"] ?? [], "5m", nowMs); if (m15.length < 25 || m5.length < 20) return null;
  const last = m15.at(-1)!; const previous = m15.slice(-9, -1); const priorLow = Math.min(...previous.map((b) => b.low)); const priorHigh = Math.max(...previous.map((b) => b.high)); const atr15 = atr(m15); const buffer = bufferPrice(last.close, atr15, data.meta, config); const sweepLong = last.low < priorLow && last.close > priorLow && (last.close - last.low) / Math.max(last.high - last.low, EPS) >= 0.55; const sweepShort = last.high > priorHigh && last.close < priorHigh && (last.high - last.close) / Math.max(last.high - last.low, EPS) >= 0.55; const direction: Exclude<ForexScalpingDirection, "WAIT"> | null = sweepLong ? "BUY" : sweepShort ? "SELL" : null; if (!direction) return null;
  const confirm = m5.slice(-6).some((b) => direction === "BUY" ? b.close > priorLow + buffer : b.close < priorHigh - buffer); if (!confirm) return null; const entry = data.quote?.price ?? m5.at(-1)!.close; const stopLoss = direction === "BUY" ? last.low - buffer : last.high + buffer; if (atr15 && Math.abs(entry - stopLoss) > atr15 * config.maxRectangleAtrM15) return null; const takeProfit = direction === "BUY" ? entry + Math.abs(entry - stopLoss) * 1.3 : entry - Math.abs(entry - stopLoss) * 1.3;
  return candidateBase("MODULE_C", direction, entry, stopLoss, takeProfit, data, config, quality, ["M15 liquidity sweep", "M5 rectangle edge confirmation", "tick volume proxy được ghi nhãn"], ["15m", "5m"], nowMs, 19, 15, 14);
}

export function forexPairMeta(def: ForexPairDef, overrides: Partial<ForexScalpingMeta> = {}): ForexScalpingMeta {
  const jpy = def.quoteCurrency === "JPY" || def.baseCurrency === "JPY"; const digits = jpy ? 3 : 5; const group: ForexPairGroup = def.category === "usd_cross" ? "MAJOR" : def.category === "vnd_pair" ? "EMERGING_OR_EXOTIC" : def.category === "gold" || def.category === "oil" ? "COMMODITY_CURRENCY" : "MINOR_CROSS";
  return { broker: "Biquote · MetaTrader 5", symbol: def.symbol, baseCurrency: def.baseCurrency, quoteCurrency: def.quoteCurrency, accountCurrency: "USD", digits, point: 10 ** -digits, pipSize: jpy ? 0.01 : 0.0001, contractSize: 100_000, minLot: 0.01, lotStep: 0.01, maxLot: 100, group, marketStatus: "ACTIVE", pipValueApproximate: def.derived === undefined && def.quoteCurrency === "USD" ? false : true, ...overrides };
}

export function runForexScalping(input: ForexScalpingMarketData, overrides: Partial<ForexScalpingConfig> = {}): ForexScalpingResult {
  const config = { ...DEFAULT_FOREX_SCALPING_CONFIG, ...overrides, maxSpreadPipsByGroup: { ...DEFAULT_FOREX_SCALPING_CONFIG.maxSpreadPipsByGroup, ...overrides.maxSpreadPipsByGroup } }; const nowMs = input.nowMs ?? Date.now(); const quality = dataQuality(input, nowMs, config);
  const candidates = [moduleA(input, config, quality, nowMs), moduleB(input, config, quality, nowMs), moduleC(input, config, quality, nowMs)].filter((x): x is ForexScalpingCandidate => Boolean(x)).sort((a, b) => b.score - a.score);
  const blockers = [...quality.gaps]; if (input.newsLock) blockers.push("NEWS_LOCK"); if (input.sessionAllowed === false) blockers.push("SESSION_BLOCK"); if (input.meta.pipValueApproximate) blockers.push("pip value chưa có broker/account conversion chính xác"); if (input.meta.marketStatus !== "ACTIVE") blockers.push(`broker_status=${input.meta.marketStatus}`);
  const bestCandidate = candidates[0] ?? null; const executable = bestCandidate?.state === "QUALIFIED" || bestCandidate?.state === "TRIGGERED"; return { symbol: input.meta.symbol, generatedAt: new Date(nowMs).toISOString(), signal: executable ? bestCandidate!.direction : "WAIT", state: bestCandidate?.state ?? (blockers.length ? "WATCH_ONLY" : "DISCOVERED"), paperOnly: true, executionEnabled: false, dataQuality: quality, candidates, bestCandidate, blockers: [...new Set(blockers)], config: { parameterVersion: config.parameterVersion, minSetupScore: config.minSetupScore, riskPerTrade: config.riskPerTrade, maxOpenRisk: config.maxOpenRisk } };
}

export function normalizeForexScalpingBars(bars: Ohlcv[], timeframe: ForexScalpingTimeframe, nowMs = Date.now()): Ohlcv[] { const seen = new Set<number>(); return closedBars(bars, timeframe, nowMs).filter((b) => { if (seen.has(b.time)) return false; seen.add(b.time); return b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close) && b.volume >= 0; }); }
