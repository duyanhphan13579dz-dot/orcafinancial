import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { watchlistItems } from "@/db/schema";
import { checkRateLimit, handleError } from "@/lib/api";
import { getQuotes } from "@/lib/market";
import { buildPersonalizedInsights, type Horizon, type RiskProfile } from "@/lib/stock-intelligence/personalization";

export const dynamic = "force-dynamic";
function sessionId(req: NextRequest): string { const value = req.cookies.get("vnstock_session")?.value; return value && /^[a-f0-9-]{36}$/.test(value) ? value : randomUUID(); }
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const session = sessionId(req);
  try {
    const profile = { riskProfile: (req.nextUrl.searchParams.get("risk") as RiskProfile | null) ?? "balanced", horizon: (req.nextUrl.searchParams.get("horizon") as Horizon | null) ?? "medium", includeEstimateData: req.nextUrl.searchParams.get("includeEstimate") === "true" };
    const items = await db.select().from(watchlistItems).where(eq(watchlistItems.sessionId, session));
    const quotes = items.length ? await getQuotes(items.map((item) => item.symbol)) : [];
    const result = buildPersonalizedInsights(items.map((item) => { const quote = quotes.find((candidate) => candidate.symbol === item.symbol); return { symbol: item.symbol, price: quote?.close ?? null, changePct: quote?.changePct ?? null, volatilityPct: null, volumeRatio: null, thesisScore: null, fairValue: null }; }), profile);
    const response = NextResponse.json({ data: result, meta: { timestamp: new Date().toISOString() } });
    if (!req.cookies.get("vnstock_session")) response.cookies.set("vnstock_session", session, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
    return response;
  } catch (error) { return handleError(error, "watchlist_insights"); }
}
