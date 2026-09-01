import { NextRequest, NextResponse } from "next/server";
import { runFinancialForensicAudit } from "@/lib/financial-forensic-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 1 — Forensic audit endpoint
 * GET /api/internal/financial-audit/[symbol]
 * Auth: Bearer FINANCIAL_AUDIT_SECRET or CRON_SECRET
 *
 * Traces SOURCE → RAW → NORMALIZED → DB → API for the given ticker.
 * Recommended first symbol: HPG
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-financial-audit-secret");
  return authorization === `Bearer ${secret}` || headerSecret === secret;
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Financial audit secret is not configured." },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { symbol: raw } = await ctx.params;
  const symbol = raw?.toUpperCase?.() ?? "";
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) {
    return NextResponse.json({ ok: false, error: "Invalid symbol" }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const result = await runFinancialForensicAudit(symbol);
    return NextResponse.json(
      { ...result, durationMs: Date.now() - startedAt },
      { status: result.ok ? 200 : 409 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        symbol,
        error: error instanceof Error ? error.message : "Forensic audit failed.",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
