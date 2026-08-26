import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getHistory } from "@/lib/market";
import { buildRiskAssessment } from "@/lib/stock-intelligence/risk-engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const { bars, source, confidence } = await getHistory(symbol, Math.floor(Date.now() / 1000) - 86400 * 400, Math.floor(Date.now() / 1000), "D");
    const result = buildRiskAssessment({ symbol, price: bars.at(-1)?.close ?? null, closes: bars.map((bar) => bar.close), volumes: bars.map((bar) => bar.volume) });
    return ok(result, { source, confidence, dataAsOf: bars.at(-1)?.time ?? null, disclaimer: "Risk và trade plan là mô hình nghiên cứu, không phải khuyến nghị cá nhân. Stop loss, target và invalidation cần được kiểm chứng với dữ liệu thực tế và khẩu vị rủi ro của người dùng." }, { cacheSeconds: 120 });
  } catch (error) {
    return handleError(error, `risk:${symbol}`);
  }
}
