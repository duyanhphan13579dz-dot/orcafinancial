import { NextRequest, NextResponse } from "next/server";
import { ingestFinancialSources } from "@/lib/financial-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-financial-audit-secret") === secret;
}

function parseSymbols(value: string | null): string[] {
  const raw = value ?? process.env.FINANCIAL_INGEST_SYMBOLS ?? process.env.FINANCIAL_AUDIT_SYMBOLS ?? "VNM,HPG,FPT,VCB";
  return raw.split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{1,15}$/.test(symbol)).slice(0, 100);
}

export async function GET(request: NextRequest) {
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) return NextResponse.json({ ok: false, error: "Financial ingestion secret is not configured." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  try {
    const symbols = parseSymbols(request.nextUrl.searchParams.get("symbols"));
    const limit = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "8") || 8));
    const result = await ingestFinancialSources(symbols, limit);
    return NextResponse.json({ ...result, durationMs: Date.now() - startedAt }, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Financial ingestion failed.", durationMs: Date.now() - startedAt }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
