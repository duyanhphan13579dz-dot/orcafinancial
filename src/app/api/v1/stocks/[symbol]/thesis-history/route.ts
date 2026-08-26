import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { stockThesisVersions } from "@/db/schema";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";

function session(req: NextRequest) { const existing = req.cookies.get("vnstock_session")?.value; return { id: existing && /^[a-f0-9-]{36}$/i.test(existing) ? existing : randomUUID(), isNew: !(existing && /^[a-f0-9-]{36}$/i.test(existing)) }; }
function withCookie(res: NextResponse, id: string, isNew: boolean) { if (isNew) res.cookies.set("vnstock_session", id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 31536000, path: "/" }); return res; }
function symbolOf(raw: string) { const symbol = raw.toUpperCase(); return /^[A-Z0-9]{1,15}$/.test(symbol) ? symbol : null; }

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) { const limited = checkRateLimit(req, 60); if (limited) return limited; const symbol = symbolOf((await ctx.params).symbol); if (!symbol) return fail("Invalid symbol", 400); const s = session(req); try { const rows = await db.select().from(stockThesisVersions).where(and(eq(stockThesisVersions.sessionId, s.id), eq(stockThesisVersions.symbol, symbol))).orderBy(desc(stockThesisVersions.createdAt)).limit(50); return withCookie(ok({ symbol, items: rows, count: rows.length }), s.id, s.isNew); } catch (err) { return handleError(err, `thesis-history:${symbol}`); } }

export async function POST(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) { const limited = checkRateLimit(req, 30); if (limited) return limited; const symbol = symbolOf((await ctx.params).symbol); if (!symbol) return fail("Invalid symbol", 400); const s = session(req); try { const body = await req.json() as { version?: string; approval?: "SYSTEM_DRAFT" | "USER_APPROVED"; stance?: string; score?: number | null; dataConfidence?: number; payload?: Record<string, unknown> }; if (!body.version || !body.stance || typeof body.payload !== "object") return fail("thesis payload không hợp lệ", 400); const [saved] = await db.insert(stockThesisVersions).values({ sessionId: s.id, symbol, version: body.version.slice(0, 60), approval: body.approval === "USER_APPROVED" ? "USER_APPROVED" : "SYSTEM_DRAFT", stance: body.stance.slice(0, 30), score: typeof body.score === "number" ? body.score : null, dataConfidence: typeof body.dataConfidence === "number" ? body.dataConfidence : 0, payload: body.payload }).returning(); return withCookie(ok(saved), s.id, s.isNew); } catch (err) { return handleError(err, `thesis-history:${symbol}`); } }
