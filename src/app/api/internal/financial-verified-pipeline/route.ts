import { NextRequest, NextResponse } from "next/server";
import { runVerifiedPipeline, quarantineSyntheticFacts } from "@/lib/financial-verified-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 3 — Verified pipeline runner
 * GET|POST /api/internal/financial-verified-pipeline?symbols=HPG,VNM&limit=8&skipIngest=1&quarantine=1
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

function parseSymbols(value: string | null): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{1,15}$/.test(s))
    .slice(0, 50);
}

export async function GET(request: NextRequest) {
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Financial audit secret is not configured." }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const symbols = parseSymbols(sp.get("symbols"));
  const limit = Math.min(20, Math.max(1, Number(sp.get("limit") ?? "8") || 8));
  const skipIngest = sp.get("skipIngest") === "1" || sp.get("skipIngest") === "true";
  const quarantine = sp.get("quarantine") === "1" || sp.get("quarantine") === "true";

  try {
    let quarantineResult: { updated: number } | undefined;
    if (quarantine) {
      quarantineResult = await quarantineSyntheticFacts();
    }
    const result = await runVerifiedPipeline({ symbols, limit, skipIngest });
    return NextResponse.json(
      { ...result, quarantine: quarantineResult },
      { status: result.ok ? 200 : 409 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Verified pipeline failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
