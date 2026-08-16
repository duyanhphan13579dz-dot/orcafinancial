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

async function handleRefresh(req: NextRequest) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;

  const startedAt = Date.now();

  try {
    // 1. Khởi tạo danh mục 31 hàng hóa và ma trận cổ phiếu
    await initializeCommodities();
    await initializeStockImpacts();

    // 2. Fetch tỷ giá và giá hàng hóa thế giới
    const { prices, exchangeRates, errors } = await fetchAllCommoditiesData();

    // 3. Lưu tỷ giá ngoại tệ
    const ratesSaved = await saveExchangeRates(exchangeRates);

    // 4. Lưu giá hàng hóa (quy đổi VND)
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

export async function POST(req: NextRequest) {
  return handleRefresh(req);
}

export async function GET(req: NextRequest) {
  return handleRefresh(req);
}
