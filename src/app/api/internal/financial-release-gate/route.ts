import { NextRequest, NextResponse } from "next/server";
import { runFinancialReleaseGate } from "@/lib/financial-release-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4 — Release / go-live gate
 * GET /api/internal/financial-release-gate?symbol=HPG&skipDb=1
 * Auth: Bearer FINANCIAL_AUDIT_SECRET | CRON_SECRET
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-financial-audit-secret") === secret
  );
}

export async function GET(request: NextRequest) {
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Financial audit secret is not configured." }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
  const skipDb = request.nextUrl.searchParams.get("skipDb") === "1" || request.nextUrl.searchParams.get("skipDb") === "true";

  try {
    const result = await runFinancialReleaseGate({ symbol, skipDb });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Release gate failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
