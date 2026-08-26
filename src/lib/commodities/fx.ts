/**
 * FX rates for commodity VND conversion.
 *
 * Primary: Vietcombank public XML feed (official, updated intraday).
 * Fallback: last-known reference rates, explicitly tagged `source="reference"`
 * so the admin UI can distinguish live vs. stale conversions. We never silently
 * pretend a stale rate is live.
 */

import { fetchWithRetry, getBreaker, ProviderError } from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";

export interface ExchangeRateData {
  currency: string;
  rate: number;
  timestamp: Date;
  source: string;
}

const log = forProvider("fx");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8",
} as const;

const REFERENCE_RATES: Array<Omit<ExchangeRateData, "timestamp">> = [
  { currency: "USD", rate: 26330, source: "reference" },
  { currency: "JPY", rate: 169.48, source: "reference" },
  { currency: "CNY", rate: 3939.54, source: "reference" },
];

export async function fetchExchangeRates(): Promise<ExchangeRateData[]> {
  const now = new Date();
  try {
    return await getBreaker("vcb-exchange").exec(async () => {
      const url = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx";
      const res = await fetchWithRetry(url, {
        provider: "vcb-exchange",
        timeoutMs: 12_000,
        retries: 2,
        headers: HEADERS,
      });
      const xml = await res.text();
      const rates: ExchangeRateData[] = [];

      for (const currency of ["USD", "JPY", "CNY"]) {
        const m = xml.match(new RegExp(`CurrencyCode="${currency}"[^>]*?Sell="([\\d,.]+)"`, "i"));
        if (!m) continue;
        const rate = parseFloat(m[1].replace(/,/g, ""));
        if (!Number.isFinite(rate) || rate <= 0) continue;
        rates.push({ currency, rate, timestamp: now, source: "vietcombank" });
      }

      if (rates.length === 0) {
        throw new ProviderError("vcb-exchange", "no rates parsed", { snippet: xml.slice(0, 200) });
      }
      log.info("fx_fetched", { count: rates.length, source: "vietcombank" });
      return rates;
    });
  } catch (err) {
    log.warn("fx_fallback_reference", {
      error: err instanceof Error ? err.message : String(err),
    });
    return REFERENCE_RATES.map((r) => ({ ...r, timestamp: now }));
  }
}
