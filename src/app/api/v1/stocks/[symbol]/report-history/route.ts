import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { stockReportHistory } from "@/db/schema";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";

function getSession(req: NextRequest) { const existing = req.cookies.get("vnstock_session")?.value; const valid = Boolean(existing && /^[a-f0-9-]{36}$/i.test(existing)); return { id: valid ? existing as string : randomUUID(), isNew: !valid }; }
function withCookie(res: NextResponse, id: string, isNew: boolean) { if (isNew) res.cookies.set("vnstock_session", id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 31536000, path: "/" }); return res; }

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) { const limited = checkRateLimit(req, 60); if (limited) return limited; const symbol = (await ctx.params).symbol.toUpperCase(); if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400); const s = getSession(req); try { const rows = await db.select().from(stockReportHistory).where(and(eq(stockReportHistory.sessionId, s.id), eq(stockReportHistory.symbol, symbol))).orderBy(desc(stockReportHistory.generatedAt)).limit(50); return withCookie(ok({ symbol, items: rows, count: rows.length }), s.id, s.isNew); } catch (err) { return handleError(err, `report-history:${symbol}`); } }

export async function POST(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) { const limited = checkRateLimit(req, 30); if (limited) return limited; const symbol = (await ctx.params).symbol.toUpperCase(); if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400); const s = getSession(req); try { const body = await req.json() as { reportVersion?: string; reportType?: string; storageKey?: string | null; payload?: Record<string, unknown> }; if (!body.reportVersion || !body.payload) return fail("report payload không hợp lệ", 400); const [saved] = await db.insert(stockReportHistory).values({ sessionId: s.id, symbol, reportVersion: body.reportVersion.slice(0, 60), reportType: (body.reportType ?? "analysis").slice(0, 30), storageKey: body.storageKey?.slice(0, 300) ?? null, payload: body.payload }).returning(); return withCookie(ok(saved), s.id, s.isNew); } catch (err) { return handleError(err, `report-history:${symbol}`); } }
