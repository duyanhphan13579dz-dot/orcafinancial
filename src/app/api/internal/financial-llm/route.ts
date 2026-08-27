import { NextRequest, NextResponse } from "next/server";
import { generateFinancialLlmOutput, type FinancialAnalysisType } from "@/lib/financial-llm";

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
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) return NextResponse.json({ ok: false, error: "Financial LLM secret is not configured." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  const symbols = parseSymbols(request.nextUrl.searchParams.get("symbols"));
  const requestedType = request.nextUrl.searchParams.get("type");
  const types: FinancialAnalysisType[] = requestedType === "basic" || requestedType === "financials" ? [requestedType] : ["basic", "financials"];
  const outputs: Array<{ symbol: string; type: string; cached?: boolean; factCount?: number; error?: string }> = [];
  for (const symbol of symbols) {
    for (const type of types) {
      try {
        const result = await generateFinancialLlmOutput(symbol, type);
        outputs.push({ symbol, type, cached: result.cached, factCount: result.factCount });
      } catch (error) {
        outputs.push({ symbol, type, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const failed = outputs.filter((item) => item.error);
  return NextResponse.json({ ok: failed.length === 0, checkedAt: new Date().toISOString(), symbols, outputs, durationMs: Date.now() - startedAt }, { status: failed.length ? 409 : 200 });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
