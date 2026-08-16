/**
 * Company / Financials / SWOT service layer.
 *
 * Ensures single point of truth: synthesizes financial statements + profile + SWOT
 * when not present in DB, persists them, and returns normalized responses.
 */

import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyProfiles, companySwot, companyValueChains, financialStatements } from "@/db/schema";
import { generateValueChain, type ValueChain } from "@/lib/value-chain";
import { safeDbQuery, type Ohlcv } from "@/lib/connectors/core";
import {
  generateCompanyProfile,
  generateSwot,
  type CompanyProfile,
  type SwotAnalysis,
} from "@/lib/company-profile";
import { formatPeriodFromComposite } from "@/lib/format";
import {
  generateQuarterlyFinancials,
  getStatementFields,
  type FinancialQuarter,
  type StatementType,
} from "@/lib/financial-statements";
import { getHistory } from "@/lib/market";
import { getNewsSentiment } from "@/lib/market";
import { logger } from "@/lib/logger";

/** Fetch (or generate) the full quarterly financial data for a symbol. */
export async function ensureQuarterlyFinancials(symbol: string, numQuarters = 4): Promise<FinancialQuarter[]> {
  // Check if we already have enough persisted
  const existing = await db
    .select()
    .from(financialStatements)
    .where(eq(financialStatements.symbol, symbol))
    .orderBy(desc(financialStatements.fiscalYear), desc(financialStatements.period));

  const byKey = new Map<string, { type: StatementType; period: string; fiscalYear: number; data: any }>();
  for (const row of existing) {
    byKey.set(`${row.type}-${row.period}-${row.fiscalYear}`, row as any);
  }

  // If we have all 3 types × 4 quarters = 12 rows, use them.
  const needed = numQuarters * 3;
  let quarters: FinancialQuarter[];
  if (existing.length >= needed) {
    // Reconstruct from DB rows, always normalising the composite period label
    // to "Q{quarter}/{fiscalYear}" so downstream consumers don't have to stitch.
    const periodsSeen = new Map<string, Partial<FinancialQuarter>>();
    for (const row of existing) {
      const quarterNum = parseInt(row.period.replace(/^Q/i, ""), 10) || 0;
      const key = `${row.period}-${row.fiscalYear}`;
      const p = periodsSeen.get(key) ?? ({
        period: `Q${quarterNum}/${row.fiscalYear}`,
        quarter: quarterNum,
        fiscalYear: row.fiscalYear,
      } as Partial<FinancialQuarter>);
      if (row.type === "income") p.income = row.data as any;
      if (row.type === "balance") p.balance = row.data as any;
      if (row.type === "cashflow") p.cashflow = row.data as any;
      periodsSeen.set(key, p);
    }
    quarters = [...periodsSeen.values()]
      .filter((q): q is FinancialQuarter => typeof q.fiscalYear === "number" && typeof q.quarter === "number")
      .sort((a, b) => {
        if (a.fiscalYear !== b.fiscalYear) return b.fiscalYear - a.fiscalYear;
        return b.quarter - a.quarter;
      });
    if (quarters.length >= numQuarters && quarters.every((q) => q.income && q.balance && q.cashflow)) {
      return quarters.slice(0, numQuarters);
    }
  }

  // Otherwise regenerate from real bars
  const to = Math.floor(Date.now() / 1000);
  const { bars } = await getHistory(symbol, to - 86400 * 1100, to, "D");
  if (bars.length < 60) throw new Error(`Insufficient history for ${symbol} to model financials (need ≥60 bars, got ${bars.length})`);

  quarters = generateQuarterlyFinancials(symbol, bars, numQuarters);

  // Persist asynchronously
  void persistQuarterlyFinancials(symbol, quarters).catch((err) =>
    logger.error("persist_financials_failed", { symbol, error: String(err) }),
  );

  return quarters;
}

async function persistQuarterlyFinancials(symbol: string, quarters: FinancialQuarter[]) {
  for (const q of quarters) {
    const period = `Q${q.quarter}`;
    await db
      .insert(financialStatements)
      .values([
        { symbol, type: "income", period, fiscalYear: q.fiscalYear, data: q.income, source: "sector-synthetic-v1", confidence: 0.75 },
        { symbol, type: "balance", period, fiscalYear: q.fiscalYear, data: q.balance, source: "sector-synthetic-v1", confidence: 0.7 },
        { symbol, type: "cashflow", period, fiscalYear: q.fiscalYear, data: q.cashflow, source: "sector-synthetic-v1", confidence: 0.72 },
      ])
      .onConflictDoUpdate({
        target: [financialStatements.symbol, financialStatements.type, financialStatements.period, financialStatements.fiscalYear],
        set: { data: sql`excluded.data`, updatedAt: new Date(), source: "sector-synthetic-v1" },
      });
  }
}

/** Get a single statement type (income/balance/cashflow) for N quarters. */
export async function getStatements(
  symbol: string,
  type: StatementType,
  period: "quarterly" | "yearly" = "quarterly",
  limit = 4,
): Promise<{
  symbol: string;
  type: StatementType;
  periods: Array<{
    period: string;
    fiscalYear: number;
    displayPeriod: string;
    displayPeriodVi: string;
    shortTag: string;
    data: Record<string, number>;
  }>;
  fields: string[];
}> {
  const quarters = await ensureQuarterlyFinancials(symbol, period === "yearly" ? Math.min(limit * 4, 4) : limit);
  const periods = quarters.map((q) => {
    const raw = type === "income" ? q.income : type === "balance" ? q.balance : q.cashflow;
    const filtered: Record<string, number> = {};
    for (const key of getStatementFields(type)) {
      (filtered as any)[key] = (raw as any)[key] ?? 0;
    }
    const labels = formatPeriodFromComposite(q.period);
    return {
      period: q.period,
      fiscalYear: q.fiscalYear,
      displayPeriod: labels.displayPeriod,
      displayPeriodVi: labels.displayPeriodVi,
      shortTag: labels.shortTag,
      data: filtered,
    };
  });

  return {
    symbol,
    type,
    periods,
    fields: getStatementFields(type),
  };
}

/** Get or generate company profile. */
export async function getProfile(symbol: string): Promise<CompanyProfile> {
  const existing = await db.select().from(companyProfiles).where(eq(companyProfiles.symbol, symbol)).limit(1);
  if (existing.length > 0) {
    const row = existing[0];
    // Try to enrich with real company name
    const companyRow = await db.select().from(companies).where(eq(companies.symbol, symbol)).limit(1);
    return {
      symbol,
      name: companyRow[0]?.name ?? symbol,
      exchange: companyRow[0]?.exchange ?? "",
      sector: row.sector,
      industry: row.industry,
      description: row.description,
      employees: row.employees ?? 0,
      website: row.website ?? "",
      listingDate: row.listingDate ?? "",
      marketCapBillionVnd: Number(row.marketCap ?? 0),
      sharesOutstandingMillions: Number(row.sharesOutstanding ?? 0),
      beta: Number(row.beta ?? 1),
      benchmarkDescription: row.description,
      isGenerated: true as const,
    };
  }

  const to = Math.floor(Date.now() / 1000);
  const { bars } = await getHistory(symbol, to - 86400 * 400, to, "D");
  if (bars.length < 20) throw new Error(`Insufficient data for ${symbol}`);

  // Get shares outstanding from most recent financial synthesis
  const quarters = await ensureQuarterlyFinancials(symbol, 1);
  const shares = quarters[0]?.income.sharesOutstanding ?? 1000;

  // Look up company name from companies table
  const companyRow = await db.select().from(companies).where(eq(companies.symbol, symbol)).limit(1);
  const name = companyRow[0]?.name ?? symbol;
  const exchange = companyRow[0]?.exchange ?? "HOSE";

  const profile = generateCompanyProfile(symbol, name, exchange, bars, shares);

  // Persist
  void db
    .insert(companyProfiles)
    .values({
      symbol,
      description: profile.description,
      industry: profile.industry,
      sector: profile.sector,
      employees: profile.employees,
      website: profile.website,
      listingDate: profile.listingDate,
      marketCap: profile.marketCapBillionVnd,
      sharesOutstanding: profile.sharesOutstandingMillions,
      beta: profile.beta,
      foreignOwnershipPct: null,
      isGenerated: true,
    })
    .onConflictDoUpdate({
      target: companyProfiles.symbol,
      set: {
        description: profile.description,
        industry: profile.industry,
        sector: profile.sector,
        employees: profile.employees,
        marketCap: profile.marketCapBillionVnd,
        sharesOutstanding: profile.sharesOutstandingMillions,
        updatedAt: new Date(),
      },
    })
    .catch((err) => logger.error("persist_profile_failed", { symbol, error: String(err) }));

  return profile;
}

/** Get or generate SWOT. */
export async function getSwot(symbol: string, forceRegenerate = false): Promise<SwotAnalysis> {
  if (!forceRegenerate) {
    const existing = await db.select().from(companySwot).where(eq(companySwot.symbol, symbol)).limit(1);
    if (existing.length > 0) {
      return existing[0] as any;
    }
  }
  const to = Math.floor(Date.now() / 1000);
  const { bars } = await getHistory(symbol, to - 86400 * 400, to, "D");
  if (bars.length < 60) throw new Error(`Insufficient history for ${symbol}`);
  const quarters = await ensureQuarterlyFinancials(symbol, 2);
  const sentiment = await getNewsSentiment(symbol).catch(() => ({ sentimentScore: 0 }));
  const swot = generateSwot(symbol, quarters, sentiment.sentimentScore, bars);

  void db
    .insert(companySwot)
    .values({ symbol, strengths: swot.strengths, weaknesses: swot.weaknesses, opportunities: swot.opportunities, threats: swot.threats })
    .onConflictDoUpdate({
      target: companySwot.symbol,
      set: { strengths: swot.strengths, weaknesses: swot.weaknesses, opportunities: swot.opportunities, threats: swot.threats, updatedAt: new Date() },
    })
    .catch((err) => logger.error("persist_swot_failed", { symbol, error: String(err) }));

  return swot;
}

/** Get or generate Porter value chain for a company. Cached in DB forever (deterministic). */
export async function getValueChain(symbol: string, forceRegenerate = false): Promise<ValueChain> {
  if (!forceRegenerate) {
    try {
      const existing = await safeDbQuery("value_chain_read", () =>
        db.select().from(companyValueChains).where(eq(companyValueChains.symbol, symbol)).limit(1),
      );
      if (existing.length > 0) {
        const row = existing[0];
        const bench = (await import("@/lib/industry-benchmarks")).getBenchmarkForSymbol(symbol);
        return {
          primary: row.primaryActivities,
          support: row.supportActivities,
          modelVersion: row.modelVersion,
          sector: bench.sector,
          industry: bench.industry,
        };
      }
    } catch (err) {
      logger.warn("value_chain_read_failed", { symbol, error: String(err) });
    }
  }

  const chain = generateValueChain(symbol);

  void safeDbQuery("value_chain_write", () =>
    db
      .insert(companyValueChains)
      .values({
        symbol,
        primaryActivities: chain.primary,
        supportActivities: chain.support,
        modelVersion: chain.modelVersion,
      })
      .onConflictDoUpdate({
        target: companyValueChains.symbol,
        set: {
          primaryActivities: chain.primary,
          supportActivities: chain.support,
          modelVersion: chain.modelVersion,
          updatedAt: new Date(),
        },
      }),
  ).catch((err: unknown) => logger.error("persist_value_chain_failed", { symbol, error: String(err) }));

  return chain;
}
