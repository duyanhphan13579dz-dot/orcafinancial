import { and, desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { ensureFinancialIngestionTables } from "@/db/ensure-financial-ingestion-tables";
import { financialLlmOutputs } from "@/db/schema";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  const type = req.nextUrl.searchParams.get("type");
  const analysisType = type === "financials" ? "financials" : "basic";
  try {
    await ensureFinancialIngestionTables();
    const rows = await db.select({ output: financialLlmOutputs.output, model: financialLlmOutputs.model, periodKey: financialLlmOutputs.periodKey, sourceDocumentIds: financialLlmOutputs.sourceDocumentIds, updatedAt: financialLlmOutputs.updatedAt }).from(financialLlmOutputs).where(and(eq(financialLlmOutputs.symbol, symbol), eq(financialLlmOutputs.analysisType, analysisType), eq(financialLlmOutputs.status, "valid"))).orderBy(desc(financialLlmOutputs.updatedAt)).limit(1);
    if (!rows[0]) return ok({ available: false, symbol, analysisType, output: null }, { source: "financial-llm", providerBacked: false }, { cacheSeconds: 60 });
    return ok({ available: true, symbol, analysisType, output: rows[0].output, model: rows[0].model, periodKey: rows[0].periodKey, sourceDocumentIds: rows[0].sourceDocumentIds, updatedAt: rows[0].updatedAt }, { source: "financial-llm", providerBacked: true }, { cacheSeconds: 60 });
  } catch (error) {
    return handleError(error, `financial-analysis:${symbol}`);
  }
}
