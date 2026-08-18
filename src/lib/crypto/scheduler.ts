import { forProvider } from "@/lib/logger";
import { POPULAR, runCryptoAnalysis, syncCryptoMarket, syncCryptoOhlcv, updateCryptoSentiment } from "./service";

const log = forProvider("crypto-scheduler");
const globalState = globalThis as typeof globalThis & { __orcaCryptoScheduler?: boolean; __orcaCryptoJobs?: Set<string> };
if (!globalState.__orcaCryptoJobs) globalState.__orcaCryptoJobs = new Set();

async function job(name: string, task: () => Promise<unknown>) {
  if (globalState.__orcaCryptoJobs!.has(name)) return;
  globalState.__orcaCryptoJobs!.add(name);
  const started = Date.now();
  try { await task(); log.info("job_ok", { name, durationMs: Date.now() - started }); }
  catch (err) { log.error("job_failed", { name, error: err instanceof Error ? err.message : String(err) }); }
  finally { globalState.__orcaCryptoJobs!.delete(name); }
}

export function startCryptoScheduler() {
  if (globalState.__orcaCryptoScheduler) return;
  globalState.__orcaCryptoScheduler = true;
  log.info("scheduler_started", { priceMs: 5000, coinsMs: 12 * 3600_000, ohlcvMs: 60_000, sentimentMs: 15 * 60_000, analysisMs: 5 * 60_000 });

  const price = () => void job("prices", () => syncCryptoMarket(50));
  const coins = () => void job("coins", () => syncCryptoMarket(1000, true));
  const ohlcv = () => void job("ohlcv", async () => { for (const s of POPULAR.slice(0, 8)) await syncCryptoOhlcv(s, "1h", 300).catch(() => null); });
  const sentiment = () => void job("sentiment", async () => { for (const s of POPULAR.slice(0, 5)) await updateCryptoSentiment(s).catch(() => null); });
  const analysis = () => void job("analysis", async () => { for (const s of POPULAR.slice(0, 8)) await runCryptoAnalysis(s, "1h").catch(() => null); });

  setTimeout(coins, 4_000); setTimeout(price, 8_000); setTimeout(ohlcv, 15_000); setTimeout(sentiment, 25_000); setTimeout(analysis, 35_000);
  setInterval(price, 5_000); setInterval(coins, 12 * 3600_000); setInterval(ohlcv, 60_000); setInterval(sentiment, 15 * 60_000); setInterval(analysis, 5 * 60_000);
}
