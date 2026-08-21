import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { safeDbQuery } from "@/lib/connectors/core";
import { corporateFinanceStatements, type CorporateFinanceStatement } from "./schema";

const PERIODS = new Set(["Y", "Q1", "Q2", "Q3", "Q4"]);

const NUMERIC_FIELDS = [
  "revenue",
  "cogs",
  "operatingExpenses",
  "ebitda",
  "netIncome",
  "totalAssets",
  "totalLiabilities",
  "totalEquity",
  "cash",
  "shortTermDebt",
  "longTermDebt",
  "operatingCashFlow",
  "investingCashFlow",
  "financingCashFlow",
] as const;

export type CorporateFinanceInput = {
  companyName: string;
  industry?: string;
  fiscalYear: number;
  period?: string;
  notes?: string;
} & Partial<Record<(typeof NUMERIC_FIELDS)[number], number>>;

export function validateCorporateStatement(body: Record<string, unknown>): {
  input: CorporateFinanceInput | null;
  error: string | null;
} {
  if (typeof body.companyName !== "string" || body.companyName.trim().length === 0) {
    return { input: null, error: "companyName là bắt buộc" };
  }
  const fiscalYear = Number(body.fiscalYear);
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1990 || fiscalYear > 2100) {
    return { input: null, error: "fiscalYear không hợp lệ" };
  }
  let period = "Y";
  if (body.period !== undefined) {
    if (typeof body.period !== "string" || !PERIODS.has(body.period)) {
      return { input: null, error: "period phải là Y | Q1 | Q2 | Q3 | Q4" };
    }
    period = body.period;
  }

  const input: CorporateFinanceInput = {
    companyName: body.companyName.trim().slice(0, 200),
    industry: typeof body.industry === "string" ? body.industry.slice(0, 100) : "",
    fiscalYear,
    period,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
  };

  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isFinite(n)) return { input: null, error: `${f} phải là số hợp lệ` };
      input[f] = n;
    }
  }

  return { input, error: null };
}

/** Upsert on the (userId, companyName, fiscalYear, period) unique key. */
export async function upsertCorporateStatement(
  userId: string,
  input: CorporateFinanceInput,
): Promise<CorporateFinanceStatement> {
  const values = {
    userId,
    companyName: input.companyName,
    industry: input.industry ?? "",
    fiscalYear: input.fiscalYear,
    period: input.period ?? "Y",
    notes: input.notes ?? "",
    ...Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, input[f] ?? 0])),
    updatedAt: new Date(),
  };

  const rows = await safeDbQuery("cf_stmt_upsert", () =>
    db
      .insert(corporateFinanceStatements)
      .values(values)
      .onConflictDoUpdate({
        target: [
          corporateFinanceStatements.userId,
          corporateFinanceStatements.companyName,
          corporateFinanceStatements.fiscalYear,
          corporateFinanceStatements.period,
        ],
        set: values,
      })
      .returning(),
  );
  return rows[0];
}

export async function listCorporateStatements(
  userId: string,
  companyName?: string,
): Promise<CorporateFinanceStatement[]> {
  return safeDbQuery("cf_stmt_list", () =>
    db
      .select()
      .from(corporateFinanceStatements)
      .where(
        companyName
          ? and(eq(corporateFinanceStatements.userId, userId), eq(corporateFinanceStatements.companyName, companyName))
          : eq(corporateFinanceStatements.userId, userId),
      )
      .orderBy(desc(corporateFinanceStatements.fiscalYear)),
  ).catch(() => []);
}

/** Latest statement for a company (or the user's most-recently-updated company if none given), plus the prior period for YoY comparison. */
export async function getLatestCorporateStatements(
  userId: string,
  companyName?: string,
): Promise<{ latest: CorporateFinanceStatement; prior: CorporateFinanceStatement | null } | null> {
  let targetCompany = companyName;
  if (!targetCompany) {
    const recent = await safeDbQuery("cf_stmt_recent_company", () =>
      db
        .select({ companyName: corporateFinanceStatements.companyName })
        .from(corporateFinanceStatements)
        .where(eq(corporateFinanceStatements.userId, userId))
        .orderBy(desc(corporateFinanceStatements.updatedAt))
        .limit(1),
    ).catch(() => []);
    if (!recent.length) return null;
    targetCompany = recent[0].companyName;
  }

  const rows = await listCorporateStatements(userId, targetCompany);
  if (!rows.length) return null;
  return { latest: rows[0], prior: rows[1] ?? null };
}

export async function deleteCorporateStatement(userId: string, id: string): Promise<boolean> {
  const rows = await safeDbQuery("cf_stmt_delete", () =>
    db
      .delete(corporateFinanceStatements)
      .where(and(eq(corporateFinanceStatements.id, id), eq(corporateFinanceStatements.userId, userId)))
      .returning({ id: corporateFinanceStatements.id }),
  ).catch(() => []);
  return rows.length > 0;
}
