import { NextRequest, NextResponse } from "next/server";
import { runFinancialDataCleanup } from "@/lib/financial-data-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-financial-audit-secret") === secret;
}

function parseSymbols(value: string | null): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{1,15}$/.test(symbol)).slice(0, 100);
}

async function handle(request: NextRequest) {
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Financial audit secret is not configured." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  try {
    const symbols = parseSymbols(request.nextUrl.searchParams.get("symbols"));
    const apply = request.nextUrl.searchParams.get("apply") === "true";
    const result = await runFinancialDataCleanup({ symbols, dryRun: !apply });
    return NextResponse.json({ ...result, durationMs: Date.now() - startedAt }, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Financial data cleanup failed.", durationMs: Date.now() - startedAt }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
