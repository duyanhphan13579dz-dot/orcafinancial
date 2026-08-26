import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getNews } from "@/lib/market";
import { buildNewsIntelligence, type NewsItemInput } from "@/lib/stock-intelligence/news-intelligence";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const rawNews = await getNews({ page: 1, limit: 100, symbol });
    const rows = (rawNews as { items?: unknown[]; news?: unknown[] }).items ?? (rawNews as { news?: unknown[] }).news ?? [];
    const items: NewsItemInput[] = rows.flatMap((row, index) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const title = typeof item.title === "string" ? item.title : "";
      const publishedAt = typeof item.publishedAt === "string" ? item.publishedAt : typeof item.pubDate === "string" ? item.pubDate : new Date().toISOString();
      if (!title) return [];
      return [{ id: typeof item.id === "string" || typeof item.id === "number" ? item.id : `${symbol}-${index}-${publishedAt}`, title, description: typeof item.description === "string" ? item.description : "", publishedAt, sourceName: typeof item.sourceName === "string" ? item.sourceName : undefined, symbols: typeof item.symbols === "string" ? item.symbols : undefined, sentiment: typeof item.sentiment === "number" ? item.sentiment : null }];
    });
    const result = buildNewsIntelligence(items, symbol);
    return ok(result, { source: "vnexpress+cafef+vietstock (RSS)", dataAsOf: result.events[0]?.publishedAt ?? null, disclaimer: "News impact và price reaction là phân tích sự kiện; tương quan sau tin không chứng minh quan hệ nhân quả." }, { cacheSeconds: 60 });
  } catch (error) {
    return handleError(error, `news-intelligence:${symbol}`);
  }
}
