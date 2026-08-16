import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { searchSymbols, getNews } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const type = req.nextUrl.searchParams.get("type") ?? "all";
  if (!q) return fail("Missing query parameter q", 400);
  if (q.length > 60) return fail("Query too long", 400);

  const started = Date.now();
  try {
    const [stocks, newsResult] = await Promise.all([
      type === "news" ? Promise.resolve([]) : searchSymbols(q),
      type === "stock"
        ? Promise.resolve(null)
        : getNews({ symbol: q.toUpperCase().length <= 5 ? q.toUpperCase() : q, limit: 5 }).catch(() => null),
    ]);
    return ok(
      { stocks, news: newsResult?.items ?? [] },
      { latencyMs: Date.now() - started, source: "vndirect-dchart+db" },
    );
  } catch (err) {
    return handleError(err, "search");
  }
}
