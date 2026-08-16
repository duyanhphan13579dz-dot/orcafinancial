import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getStockCommodityImpacts } from "@/lib/commodities/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/commodities/impact?symbol=HPG
 * 
 * Returns commodities that impact a specific stock.
 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  
  try {
    const url = new URL(req.url);
    const stockSymbol = url.searchParams.get("symbol");
    
    if (!stockSymbol) {
      return fail("Missing 'symbol' parameter (e.g., ?symbol=HPG)", 400);
    }
    
    const impacts = await getStockCommodityImpacts(stockSymbol);
    
    return ok({
      stock: stockSymbol.toUpperCase(),
      impacts,
      count: impacts.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err, "commodity_stock_impact");
  }
}
