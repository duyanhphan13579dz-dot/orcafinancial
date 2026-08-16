import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getNews } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  try {
    const result = await getNews({
      page: Number(sp.get("page") ?? "1") || 1,
      limit: Number(sp.get("limit") ?? "20") || 20,
      symbol: sp.get("symbol")?.toUpperCase() || undefined,
    });
    return ok(result, { source: "vnexpress+cafef+vietstock (RSS)", confidence: 1 });
  } catch (err) {
    return handleError(err, "news");
  }
}
