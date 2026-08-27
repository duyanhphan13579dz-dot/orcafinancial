import { NextRequest, NextResponse } from "next/server";
import { runFinancialPeriodAudit } from "@/lib/financial-period-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-financial-audit-secret");
  return authorization === `Bearer ${secret}` || headerSecret === secret;
}

export async function GET(request: NextRequest) {
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Financial audit secret is not configured." }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const symbolsParam = request.nextUrl.searchParams.get("symbols");
    const symbols = symbolsParam
      ? symbolsParam.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean).slice(0, 100)
      : undefined;
    const result = await runFinancialPeriodAudit(symbols);
    return NextResponse.json({ ...result, durationMs: Date.now() - startedAt }, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Financial period audit failed.", durationMs: Date.now() - startedAt }, { status: 500 });
  }
}
