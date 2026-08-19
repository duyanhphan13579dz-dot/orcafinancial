import { FOREX_PAIRS } from "./data";
import { forProvider } from "@/lib/logger";
import { initializeForexPairs, runForexAnalysis, syncForexOhlcv, syncForexPrices } from "./service";

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
    log.error("job_failed", { name, error: e instanceof Error ? e.message : String(e) });
  } finally {
    g.__orcaForexJobs!.delete(name);
  }
}

/** Parallel map with concurrency limit. */
async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await fn(item).catch(() => null);
    }
  });
  await Promise.all(workers);
}

export function startForexScheduler() {
  if (g.__orcaForexScheduler) return;
  g.__orcaForexScheduler = true;
  log.info("scheduler_started", {
    pairs: FOREX_PAIRS.length,
    pricesMs: 5000,
    ohlcvMs: 45000,
    analysisMs: 240000,
  });

  const pairs = () => void job("pairs", initializeForexPairs);
  const prices = () => void job("prices", syncForexPrices);

  // Warm popular timeframes in parallel (concurrency 4)
  const ohlcv = () =>
    void job("ohlcv", async () => {
      const targets: Array<{ symbol: string; tf: string }> = [];
      for (const p of FOREX_PAIRS) {
        targets.push({ symbol: p.symbol, tf: "1h" });
      }
      // Top liquid pairs also warm 15m / 1d for faster chart switches
      for (const s of ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "USDVND", "DXY"]) {
        targets.push({ symbol: s, tf: "15m" }, { symbol: s, tf: "1d" });
      }
      await mapPool(targets, 4, (t) => syncForexOhlcv(t.symbol, t.tf, 300));
    });

  const analysis = () =>
    void job("analysis", async () => {
      await mapPool(FOREX_PAIRS, 3, (p) => runForexAnalysis(p.symbol, "1h"));
    });

  setTimeout(pairs, 2000);
  setTimeout(prices, 5000);
  setTimeout(ohlcv, 12000);
  setTimeout(analysis, 28000);
  setInterval(pairs, 24 * 3600_000);
  setInterval(prices, 5000);
  setInterval(ohlcv, 45_000);
  setInterval(analysis, 240_000);
}
