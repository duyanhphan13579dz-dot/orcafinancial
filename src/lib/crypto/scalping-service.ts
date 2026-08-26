import { fetchOrderFlowIntelligence } from "./order-flow";
import {
  getCryptoCoin,
  syncCryptoOhlcv,
} from "./service";
import {
  classifyAsset,
  DEFAULT_SCALPING_CONFIG,
  runCryptoScalping,
  type ScalpingConfig,
  type ScalpingMarketData,
  type ScalpingResult,
} from "./scalping";

export async function getCryptoScalpingResult(
  symbol: string,
  options: {
    includeOrderFlow?: boolean;
    overrides?: Partial<ScalpingConfig>;
  } = {},
): Promise<ScalpingResult> {
  const normalized = symbol.trim().toUpperCase();
  const includeOrderFlow = options.includeOrderFlow !== false;
  const [coinResult, barsResult] = await Promise.all([
    getCryptoCoin(normalized).catch(() => null),
    Promise.all(
      (["1m", "5m", "15m"] as const).map(async (timeframe) => [
        timeframe,
        await syncCryptoOhlcv(normalized, timeframe, timeframe === "1m" ? 120 : 160),
      ] as const),
    ),
  ]);

  const bars = Object.fromEntries(
    barsResult.map(([timeframe, result]) => [timeframe, result.bars]),
  ) as ScalpingMarketData["bars"];
  const price = coinResult?.price?.price ?? bars["1m"]?.at(-1)?.close ?? null;
  const volume24hUsd = coinResult?.price?.volume24h ?? null;
  const orderFlow = includeOrderFlow
    ? await fetchOrderFlowIntelligence(normalized, { volume24hUsd, depthLimit: 20, tradeLimit: 40 }).catch(() => null)
    : null;
  const spreadRatio = orderFlow?.orderBook?.spreadBps != null
    ? orderFlow.orderBook.spreadBps / 10_000
    : null;
  const marketType = "linear_perpetual" as const;
  const meta = {
    exchange: "binance",
    marketType,
    symbol: normalized,
    baseAsset: normalized.replace(/USDT$/i, ""),
    quoteAsset: "USDT",
    priceTick: DEFAULT_SCALPING_CONFIG.priceTick,
    quantityStep: DEFAULT_SCALPING_CONFIG.quantityStep,
    minNotional: DEFAULT_SCALPING_CONFIG.minNotional,
    group: classifyAsset({ volume24hUsd, spreadRatio }),
    marketStatus: "ACTIVE" as const,
  };
  const data: ScalpingMarketData = {
    meta,
    bars,
    price,
    volume24hUsd,
    spreadRatio,
    orderFlow,
    // The engine stays paper/watch-only until a separate BTC market-context
    // provider is explicitly supplied. It must never infer this from price.
    btcContextSafe: normalized === "BTC",
  };
  return runCryptoScalping(data, options.overrides);
}

export async function scanCryptoScalping(
  symbols: string[],
  options: {
    includeOrderFlow?: boolean;
    concurrency?: number;
    overrides?: Partial<ScalpingConfig>;
  } = {},
): Promise<ScalpingResult[]> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)));
  const results: ScalpingResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const index = cursor++;
      try {
        results[index] = await getCryptoScalpingResult(unique[index], options);
      } catch (error) {
        results[index] = {
          symbol: unique[index],
          generatedAt: new Date().toISOString(),
          signal: "WAIT",
          state: "HALTED",
          paperOnly: true,
          executionEnabled: false,
          dataQuality: {
            coverage: { "1m": 0, "5m": 0, "15m": 0 },
            latestAgeSec: { "1m": null, "5m": null, "15m": null },
            gaps: [error instanceof Error ? error.message : String(error)],
            score: 0,
            ok: false,
          },
          group: "NEW_OR_EVENT_RISK",
          candidates: [],
          bestCandidate: null,
          blockers: ["scalping data pipeline failed"],
          config: {
            parameterVersion: DEFAULT_SCALPING_CONFIG.parameterVersion,
            minSetupScore: DEFAULT_SCALPING_CONFIG.minSetupScore,
            riskPerTrade: DEFAULT_SCALPING_CONFIG.riskPerTrade,
            maxOpenRisk: DEFAULT_SCALPING_CONFIG.maxOpenRisk,
          },
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
  return results.filter(Boolean);
}
