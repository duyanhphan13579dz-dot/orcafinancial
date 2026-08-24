/**
 * Secondary FX quote providers (free, no API key).
 * Used for fallback when Yahoo is down and for cross-check on majors.
 */

import {
  fetchWithRetry,
  getBreaker,
  ProviderError,
  readJsonSafe,
} from "@/lib/connectors/core";
import { FOREX_PAIRS, type ForexPairDef } from "../data";
import { forProvider } from "@/lib/logger";
import type { ForexQuote } from "../types";

const log = forProvider("forex-secondary");
const ER_API = "open-er-api";
const FRANKFURTER = "frankfurter";
const TIMEOUT_MS = 3_500;

interface ErApiResponse {
  result?: string;
  base_code?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

interface FrankfurterResponse {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

function buildFromUsdRates(
  rates: Record<string, number>,
  ts: Date,
  source: string,
): Map<string, ForexQuote> {
  const map = new Map<string, ForexQuote>();

  const put = (def: ForexPairDef, price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    map.set(def.symbol, {
      symbol: def.symbol,
      price,
      bid: null,
      ask: null,
      change: null,
      changePercent: null,
      source,
      timestamp: ts,
      degraded: true,
    });
  };

  for (const def of FOREX_PAIRS) {
    if (def.derived || !def.yahooSymbol) continue;
    if (def.category === "gold" || def.category === "oil" || def.category === "index") {
      continue;
    }

    const base = def.baseCurrency;
    const quote = def.quoteCurrency;

    if (base === "USD" && rates[quote]) {
      put(def, rates[quote]);
      continue;
    }
    if (quote === "USD" && rates[base]) {
      put(def, 1 / rates[base]);
      continue;
    }
  }

  for (const def of FOREX_PAIRS) {
    if (!def.derived) continue;
    const l = map.get(def.derived.left);
    const r = map.get(def.derived.right);
    if (!l || !r || !r.price) continue;
    const price =
      def.derived.op === "multiply" ? l.price * r.price : l.price / r.price;
    if (!Number.isFinite(price) || price <= 0) continue;
    map.set(def.symbol, {
      symbol: def.symbol,
      price,
      bid: null,
      ask: null,
      change: null,
      changePercent: null,
      source: `${source}+derived`,
      timestamp: new Date(Math.min(l.timestamp.getTime(), r.timestamp.getTime())),
      degraded: true,
    });
  }

  return map;
}

async function fetchOpenErApi(): Promise<Map<string, ForexQuote>> {
  const url = "https://open.er-api.com/v6/latest/USD";
  const res = await fetchWithRetry(url, {
    provider: ER_API,
    timeoutMs: TIMEOUT_MS,
    retries: 0,
  });
  const data = await readJsonSafe<ErApiResponse>(res, ER_API, url);
  if (data.result !== "success" || !data.rates) {
    throw new ProviderError(ER_API, "open.er-api returned no rates");
  }
  const ts = data.time_last_update_unix
    ? new Date(data.time_last_update_unix * 1000)
    : new Date();
  const map = buildFromUsdRates(data.rates, ts, ER_API);
  if (map.size < 3) {
    throw new ProviderError(ER_API, `Only ${map.size} secondary quotes`);
  }
  log.info("open_er_api_ok", { count: map.size });
  return map;
}

async function fetchFrankfurter(): Promise<Map<string, ForexQuote>> {
  const url = "https://api.frankfurter.app/latest?from=USD";
  const res = await fetchWithRetry(url, {
    provider: FRANKFURTER,
    timeoutMs: TIMEOUT_MS,
    retries: 0,
  });
  const data = await readJsonSafe<FrankfurterResponse>(res, FRANKFURTER, url);
  if (!data.rates) {
    throw new ProviderError(FRANKFURTER, "Frankfurter returned no rates");
  }
  const ts = data.date ? new Date(`${data.date}T16:00:00Z`) : new Date();
  const map = buildFromUsdRates(data.rates, ts, FRANKFURTER);
  if (map.size < 2) {
    throw new ProviderError(FRANKFURTER, `Only ${map.size} frankfurter quotes`);
  }
  log.info("frankfurter_ok", { count: map.size });
  return map;
}

export async function fetchSecondarySnapshot(): Promise<{
  quotes: ForexQuote[];
  source: string;
  bySymbol: Map<string, ForexQuote>;
}> {
  const attempts = [
    getBreaker(ER_API)
      .exec(() => fetchOpenErApi())
      .then((bySymbol) => ({ bySymbol, source: ER_API })),
    getBreaker(FRANKFURTER)
      .exec(() => fetchFrankfurter())
      .then((bySymbol) => ({ bySymbol, source: FRANKFURTER })),
  ];

  const errors: string[] = [];
  return await new Promise((resolve, reject) => {
    let pending = attempts.length;
    let settled = false;
    for (const p of attempts) {
      p.then((v) => {
        if (!settled && v.bySymbol.size >= 2) {
          settled = true;
          resolve({
            quotes: [...v.bySymbol.values()],
            source: v.source,
            bySymbol: v.bySymbol,
          });
        } else if (!settled) {
          errors.push(`${v.source}:sparse`);
          pending -= 1;
          if (pending === 0) {
            reject(
              new ProviderError(
                "forex-secondary",
                `all secondary failed: ${errors.join(" | ")}`,
              ),
            );
          }
        }
      }).catch((e) => {
        errors.push(String(e));
        pending -= 1;
        if (pending === 0 && !settled) {
          reject(
            new ProviderError(
              "forex-secondary",
              `all secondary failed: ${errors.join(" | ")}`,
            ),
          );
        }
      });
    }
  });
}

export { ER_API, FRANKFURTER };
