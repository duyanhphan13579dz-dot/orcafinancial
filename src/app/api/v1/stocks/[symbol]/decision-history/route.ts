import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { db } from "@/db";
import { stockDecisionHistory } from "@/db/schema";

function getSession(req: NextRequest): { id: string; isNew: boolean } {
  const existing = req.cookies.get("vnstock_session")?.value;
  if (existing && /^[a-f0-9-]{36}$/i.test(existing)) return { id: existing, isNew: false };
  return { id: randomUUID(), isNew: true };
}

function withSession(response: NextResponse, sessionId: string, isNew: boolean) {
  if (isNew) response.cookies.set("vnstock_session", sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return response;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  const session = getSession(req);
  try {
    const rows = await db.select().from(stockDecisionHistory).where(and(eq(stockDecisionHistory.sessionId, session.id), eq(stockDecisionHistory.symbol, symbol))).orderBy(desc(stockDecisionHistory.createdAt)).limit(50);
    return withSession(ok({ symbol, items: rows, count: rows.length }), session.id, session.isNew);
  } catch (err) {
    return handleError(err, `decision-history:${symbol}`);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  const session = getSession(req);
  try {
    const body = await req.json() as { verdict?: string; score?: number; risk?: string; trend?: string; modelVersion?: string; predictionConfidence?: number; payload?: Record<string, unknown> };
    if (!body.verdict || typeof body.score !== "number" || !body.risk || !body.trend) return fail("decision payload không hợp lệ", 400);
    const [saved] = await db.insert(stockDecisionHistory).values({ sessionId: session.id, symbol, verdict: body.verdict.slice(0, 20), score: body.score, risk: body.risk.slice(0, 20), trend: body.trend.slice(0, 20), modelVersion: (body.modelVersion ?? "unknown").slice(0, 40), predictionConfidence: typeof body.predictionConfidence === "number" ? body.predictionConfidence : 0, payload: body.payload ?? {} }).returning();
    return withSession(ok(saved), session.id, session.isNew);
  } catch (err) {
    return handleError(err, `decision-history:${symbol}`);
  }
}
