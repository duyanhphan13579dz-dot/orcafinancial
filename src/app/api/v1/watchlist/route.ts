import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { watchlistItems } from "@/db/schema";
import { checkRateLimit, fail, handleError } from "@/lib/api";
import { getQuotes } from "@/lib/market";

export const dynamic = "force-dynamic";

function getSession(req: NextRequest): { sessionId: string; isNew: boolean } {
  const existing = req.cookies.get("vnstock_session")?.value;
  if (existing && /^[a-f0-9-]{36}$/.test(existing)) return { sessionId: existing, isNew: false };
  return { sessionId: randomUUID(), isNew: true };
}

function withSession(res: NextResponse, sessionId: string, isNew: boolean) {
  if (isNew) {
    res.cookies.set("vnstock_session", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return res;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { sessionId, isNew } = getSession(req);
  try {
    const items = await db.select().from(watchlistItems).where(eq(watchlistItems.sessionId, sessionId));
    const quotes = items.length > 0 ? await getQuotes(items.map((i) => i.symbol)) : [];
    const res = NextResponse.json({
      data: {
        items: items.map((i) => ({
          symbol: i.symbol,
          addedAt: i.addedAt,
          quote: quotes.find((q) => q.symbol === i.symbol) ?? null,
        })),
      },
      meta: { timestamp: new Date().toISOString() },
    });
    return withSession(res, sessionId, isNew);
  } catch (err) {
    return handleError(err, "watchlist_get");
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { sessionId, isNew } = getSession(req);
  try {
    const body = (await req.json()) as { symbol?: string };
    const symbol = body.symbol?.toUpperCase().trim() ?? "";
    if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
    await db.insert(watchlistItems).values({ sessionId, symbol }).onConflictDoNothing();
    const res = NextResponse.json({ data: { symbol, added: true }, meta: { timestamp: new Date().toISOString() } });
    return withSession(res, sessionId, isNew);
  } catch (err) {
    return handleError(err, "watchlist_post");
  }
}

export async function DELETE(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { sessionId, isNew } = getSession(req);
  try {
    const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "";
    if (!symbol) return fail("Missing symbol", 400);
    await db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.sessionId, sessionId), eq(watchlistItems.symbol, symbol)));
    const res = NextResponse.json({ data: { symbol, removed: true }, meta: { timestamp: new Date().toISOString() } });
    return withSession(res, sessionId, isNew);
  } catch (err) {
    return handleError(err, "watchlist_delete");
  }
}
