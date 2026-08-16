import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { fetchAllCommoditiesData } from "@/lib/commodities/connectors";
import {
  saveExchangeRates,
  saveCommodityPrices,
  initializeCommodities,
  initializeStockImpacts,
} from "@/lib/commodities/service";
import { forProvider } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = forProvider("commodities-refresh-api");

/**
 * POST /api/v1/commodities/refresh
 * 
 * Manually trigger commodities data fetch and save.
 * Rate limited to prevent abuse.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 10); // Only 10 requests per minute
  if (limited) return limited;
  
  const startedAt = Date.now();
  
  try {
    // Initialize commodities list and stock mappings (idempotent)
    await initializeCommodities();
    await initializeStockImpacts();
    
    // Fetch all data
    const { prices, exchangeRates, errors } = await fetchAllCommoditiesData();
    
    // Save exchange rates first
    const ratesSaved = await saveExchangeRates(exchangeRates);
    
    // Save commodity prices (with VND conversion)
    const pricesSaved = await saveCommodityPrices(prices);
    
    const durationMs = Date.now() - startedAt;
    
    log.info("commodities_refresh_complete", {
      pricesFetched: prices.length,
      pricesSaved,
      ratesSaved,
      errors: errors.length,
      durationMs,
    });
    
    return ok({
      success: true,
      pricesFetched: prices.length,
      pricesSaved,
      ratesSaved,
      errors,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err, "commodities_refresh");
  }
}
