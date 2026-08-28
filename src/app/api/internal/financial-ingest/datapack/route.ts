import { NextRequest, NextResponse } from "next/server";
import { ingestSourceDocuments } from "@/lib/financial-ingestion";
import type { SourceDocument } from "@/lib/financial-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  return Boolean(secret && (request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-financial-audit-secret") === secret));
}

export async function POST(request: NextRequest) {
  if (!process.env.FINANCIAL_AUDIT_SECRET && !process.env.CRON_SECRET) return NextResponse.json({ ok: false, error: "Ingestion secret is not configured." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { documents?: SourceDocument[] } | null;
  const documents = body?.documents ?? [];
  if (!documents.length || documents.some((document) => document.source !== "tcbs" || document.documentType !== "financial_statement" || !document.documentUrl || !document.sourceContent || !Array.isArray(document.facts))) {
    return NextResponse.json({ ok: false, error: "Only complete TCBS financial-statement documents with source content and facts are accepted." }, { status: 400 });
  }
  const result = await ingestSourceDocuments(documents);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
