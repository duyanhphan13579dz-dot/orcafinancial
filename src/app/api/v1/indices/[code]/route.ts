import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getIndexMicrostructure } from "@/lib/connectors/index-microstructure";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase().trim();
  if (!/^[A-Z0-9]{2,15}$/.test(code)) return fail("Mã chỉ số không hợp lệ", 400);

  try {
    const data = await getIndexMicrostructure(code);
    return ok(data, { source: "vndirect-vietstock", confidence: 0.95 }, { cacheSeconds: 10 });
  } catch (error) {
    return handleError(error, `index_microstructure:${code}`);
  }
}
