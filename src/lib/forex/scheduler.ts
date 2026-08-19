import { forProvider } from "@/lib/logger";
import { FOREX_PAIRS } from "./data";
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

export function startForexScheduler() {
  if (g.__orcaForexScheduler) return;
  g.__orcaForexScheduler = true;
  log.info("scheduler_started", {
    pairs: FOREX_PAIRS.length,
    pricesMs: 5000,
    ohlcvMs: 60000,
    analysisMs: 300000,
  });

  const pairs = () => void job("pairs", initializeForexPairs);
  const prices = () => void job("prices", syncForexPrices);
  const ohlcv = () =>
    void job("ohlcv", async () => {
      for (const p of FOREX_PAIRS) await syncForexOhlcv(p.symbol, "1h", 300).catch(() => null);
    });
  const analysis = () =>
    void job("analysis", async () => {
      for (const p of FOREX_PAIRS) await runForexAnalysis(p.symbol, "1h").catch(() => null);
    });

  setTimeout(pairs, 3000);
  setTimeout(prices, 8000);
  setTimeout(ohlcv, 18000);
  setTimeout(analysis, 35000);
  setInterval(pairs, 24 * 3600_000);
  setInterval(prices, 5000);
  setInterval(ohlcv, 60000);
  setInterval(analysis, 300000);
}
