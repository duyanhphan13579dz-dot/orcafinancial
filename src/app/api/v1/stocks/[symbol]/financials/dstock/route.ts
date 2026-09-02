import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { fetchDstockFinancials, type DstockPeriod, type DstockStatementType } from "@/lib/dstock-financials";

export const dynamic = "force-dynamic";

/**
 * Financial statements pulled directly from the VNDirect "doanh nghiệp"
 * report source (dstock.vndirect.com.vn). The route handler runs on the
 * server, which has outbound internet, so it can read the VNDirect `finfo-api`
 * feed that backs those report pages (the browser cannot due to CORS).
 *
 * The response includes `sourceUrl` pointing to the actual dstock report page
 * (`/bang-can-doi-ke-toan/SYM`, `/bao-cao-ket-qua-kinh-doanh/SYM`,
 * `/bao-cao-luu-chuyen-tien-te/SYM`) so the UI can show a viewable source.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  const sp = req.nextUrl.searchParams;
  const typeRaw = sp.get("type") ?? "income";
  const type = (["income", "balance", "cashflow"] as const).includes(typeRaw as any)
    ? (typeRaw as DstockStatementType)
    : "income";
  const period = (sp.get("period") ?? "quarterly") as DstockPeriod;
  const limit = Math.min(12, Math.max(1, Number(sp.get("limit") ?? "8") || 8));

  try {
    const result = await fetchDstockFinancials(symbol, type, period, limit);

    if (result.periods.length === 0) {
      return ok(
        { available: false, ...result },
        {
          source: "vndirect",
          providerBacked: false,
          kind: "unavailable",
          disclosure:
            "Không lấy được báo cáo tài chính từ nguồn doanh nghiệp (VNDirect) cho mã này. Hệ thống không hiển thị số liệu synthetic.",
          warnings: result.warnings,
        },
        { cacheSeconds: 120 },
      );
    }

    return ok(
      { available: true, ...result },
      {
        source: "vndirect",
        providerBacked: true,
        kind: "provider-actual",
        confidence: 0.9,
        sourceUrl: result.sourceUrl,
        actualCount: result.periods.length,
        estimateCount: 0,
        disclosure:
          "Bảng lấy trực tiếp từ nguồn doanh nghiệp VNDirect (dstock.vndirect.com.vn). Nguồn mở đối chiếu được ở cột 'Mở nguồn gốc'.",
      },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `financials-dstock:${symbol}`);
  }
}
