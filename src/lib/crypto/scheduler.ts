import { forProvider } from "@/lib/logger";
import {
  POPULAR,
  runCryptoAnalysis,
  syncCryptoMarket,
  syncCryptoOhlcv,
  updateCryptoSentiment,
} from "./service";

const log = forProvider("crypto-scheduler");
const globalState = globalThis as typeof globalThis & {
  __orcaCryptoScheduler?: boolean;
  __orcaCryptoJobs?: Set<string>;
};
if (!globalState.__orcaCryptoJobs) globalState.__orcaCryptoJobs = new Set();

async function job(name: string, task: () => Promise<unknown>) {
  if (globalState.__orcaCryptoJobs!.has(name)) return;
  globalState.__orcaCryptoJobs!.add(name);
  const started = Date.now();
  try {
    await task();
    log.info("job_ok", { name, durationMs: Date.now() - started });
  } catch (err) {
    log.error("job_failed", {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    globalState.__orcaCryptoJobs!.delete(name);
  }
}

/** Parallel map with concurrency limit. */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<unknown>,
) {
  const queue = items.slice();
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (queue.length) {
        const item = queue.shift()!;
        await fn(item).catch(() => null);
      }
    },
  );
  await Promise.all(workers);
}

export function startCryptoScheduler() {
  if (globalState.__orcaCryptoScheduler) return;
  globalState.__orcaCryptoScheduler = true;
  log.info("scheduler_started", {
    priceMs: 5000,
    coinsMs: 12 * 3600_000,
    ohlcvMs: 45_000,
    sentimentMs: 15 * 60_000,
    analysisMs: 5 * 60_000,
  });

  const price = () => void job("prices", () => syncCryptoMarket(50));
  const coins = () => void job("coins", () => syncCryptoMarket(1000, true));

  // Warm popular symbols + multiple TFs in parallel so chart switches are instant
  const ohlcv = () =>
    void job("ohlcv", async () => {
      const targets: Array<{ symbol: string; tf: string }> = [];
      for (const s of POPULAR) {
        targets.push({ symbol: s, tf: "1h" });
      }
      // Top coins also warm 15m / 1d / 5m for faster timeframe switches
      for (const s of ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"]) {
        targets.push(
          { symbol: s, tf: "15m" },
          { symbol: s, tf: "1d" },
          { symbol: s, tf: "5m" },
        );
      }
      await mapPool(targets, 4, (t) => syncCryptoOhlcv(t.symbol, t.tf, 300));
    });

  const sentiment = () =>
    void job("sentiment", async () => {
      await mapPool(POPULAR.slice(0, 8), 3, (s) => updateCryptoSentiment(s));
    });

  const analysis = () =>
    void job("analysis", async () => {
      await mapPool(POPULAR.slice(0, 10), 3, (s) => runCryptoAnalysis(s, "1h"));
    });

  setTimeout(coins, 4_000);
  setTimeout(price, 8_000);
  setTimeout(ohlcv, 12_000);
  setTimeout(sentiment, 25_000);
  setTimeout(analysis, 35_000);
  setInterval(price, 5_000);
  setInterval(coins, 12 * 3600_000);
  setInterval(ohlcv, 45_000);
  setInterval(sentiment, 15 * 60_000);
  setInterval(analysis, 5 * 60_000);
}
