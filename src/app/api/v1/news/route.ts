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
    const response = ok(
      result,
      { source: "vnexpress+cafef+vietstock (RSS)", confidence: 1 },
      { cacheSeconds: 30 },
    );
    // Edge/CDN: short max-age, long SWR so repeat navigations are instant
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    return response;
  } catch (err) {
    return handleError(err, "news");
  }
}
