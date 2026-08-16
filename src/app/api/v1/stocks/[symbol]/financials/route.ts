import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getStatements } from "@/lib/company-service";
import type { StatementType } from "@/lib/financial-statements";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  const sp = req.nextUrl.searchParams;
  const typeRaw = sp.get("type") ?? "income";
  const period = (sp.get("period") ?? "quarterly") as "quarterly" | "yearly";
  const limit = Math.min(8, Math.max(1, Number(sp.get("limit") ?? "4") || 4));
  const type = (["income", "balance", "cashflow"] as const).includes(typeRaw as any)
    ? (typeRaw as StatementType)
    : "income";

  try {
    const result = await getStatements(symbol, type, period, limit);
    return ok(result, {
      source: "sector-synthetic-v1 (calibrated to real price/volume + VN sector benchmarks)",
      confidence: 0.72,
      disclaimer:
        "Báo cáo tài chính được mô hình hóa từ dữ liệu giá/khối lượng thực và benchmark ngành Việt Nam. Thay thế cho dữ liệu kiểm toán khi connector báo cáo chính thức chưa có.",
    });
  } catch (err) {
    return handleError(err, `financials:${symbol}`);
  }
}
