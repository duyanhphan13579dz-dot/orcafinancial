import { FOREX_PAIRS } from "./data";
import { forProvider } from "@/lib/logger";
import {
  initializeForexPairs,
  runForexAnalysis,
  syncForexOhlcv,
  syncForexPrices,
  tickMergeFromLiveSnapshot,
} from "./service";
import { OHLCV_REFRESH_MS, PRICE_REFRESH_MS } from "./realtime";

const log = forProvider("forex-scheduler");
const g = globalThis as typeof globalThis & {
  __orcaForexScheduler?: boolean;
  __orcaForexJobs?: Set<string>;
};
if (!g.__orcaForexJobs) g.__orcaForexJobs = new Set();

async function job(name: string, fn: () => Promise<unknown>) {
  if (g.__orcaForexJobs!.has(name)) return;
  g.__orcaForexJobs!.add(name);
  const s = Date.now();
  try {
    await fn();
    log.info("job_ok", { name, durationMs: Date.now() - s });
  } catch (e) {
    log.error("job_failed", {
      name,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    g.__orcaForexJobs!.delete(name);
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<unknown>,
) {
  const queue = items.slice();
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (queue.length) {
        const item = queue.shift()!;
        await fn(item).catch(() => null);
      }
    },
  );
  await Promise.all(workers);
}

/** Priority pairs get more TF coverage. */
const HOT_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "XAUUSD",
  "USDVND",
  "DXY",
  "EURVND",
];

export function startForexScheduler() {
  if (g.__orcaForexScheduler) return;
  g.__orcaForexScheduler = true;

  log.info("scheduler_started_phase2", {
    pairs: FOREX_PAIRS.length,
    priceMs: PRICE_REFRESH_MS.scheduler,
    policy: Object.fromEntries(
      Object.entries(OHLCV_REFRESH_MS).map(([tf, p]) => [tf, p.scheduler]),
    ),
  });

  const pairs = () => void job("pairs", initializeForexPairs);

  /** Price + immediate tick-merge into in-memory candles. */
  const prices = () =>
    void job("prices", async () => {
      await syncForexPrices();
      tickMergeFromLiveSnapshot();
    });

  /** Incremental OHLCV by timeframe cadence (not all TF every 45s). */
  const ohlcvTf = (tf: string) =>
    void job(`ohlcv:${tf}`, async () => {
      const symbols =
        tf === "1h" || tf === "1d"
          ? FOREX_PAIRS.map((p) => p.symbol)
          : HOT_PAIRS;
      await mapPool(symbols, 3, (symbol) =>
        syncForexOhlcv(symbol, tf, tf === "1m" ? 80 : 120),
      );
    });

  const analysis = (tf: string) =>
    void job(`analysis:${tf}`, async () => {
      const symbols = tf === "1h" ? FOREX_PAIRS.map((p) => p.symbol) : HOT_PAIRS;
      await mapPool(symbols, 2, (symbol) => runForexAnalysis(symbol, tf));
    });

  // Bootstrap
  setTimeout(pairs, 2_000);
  setTimeout(prices, 4_000);
  setTimeout(() => ohlcvTf("1h"), 10_000);
  setTimeout(() => ohlcvTf("15m"), 18_000);
  setTimeout(() => ohlcvTf("1d"), 28_000);
  setTimeout(() => analysis("1h"), 40_000);

  // Price: 1–5s band → 4s
  setInterval(pairs, 24 * 3600_000);
  setInterval(prices, PRICE_REFRESH_MS.scheduler);

  // Current candle is kept live via tick-merge on every price job.
  // Full bar history refresh by TF:
  setInterval(() => ohlcvTf("1m"), OHLCV_REFRESH_MS["1m"].scheduler);
  setInterval(() => ohlcvTf("5m"), OHLCV_REFRESH_MS["5m"].scheduler);
  setInterval(() => ohlcvTf("15m"), OHLCV_REFRESH_MS["15m"].scheduler);
  setInterval(() => ohlcvTf("1h"), OHLCV_REFRESH_MS["1h"].scheduler);
  setInterval(() => ohlcvTf("4h"), OHLCV_REFRESH_MS["4h"].scheduler);
  setInterval(() => ohlcvTf("1d"), OHLCV_REFRESH_MS["1d"].scheduler);

  // Analysis cadence follows higher TF (less noisy)
  setInterval(() => analysis("1h"), 4 * 60_000);
  setInterval(() => analysis("4h"), 12 * 60_000);
  setInterval(() => analysis("1d"), 30 * 60_000);
}
