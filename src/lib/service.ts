import { eq } from "drizzle-orm";
import { db } from "@/db";
import { safeDbQuery } from "@/lib/connectors/core";
import {
  personalFinanceProfiles,
  type PersonalFinanceProfile,
  type PersonalDebtItem,
  type PersonalGoalItem,
} from "./schema";

const RISK_LEVELS = new Set(["conservative", "moderate", "aggressive"]);

export type PersonalFinancePatch = Partial<{
  monthlyIncome: number;
  monthlyExpenses: number;
  emergencyFundCurrent: number;
  dependents: number;
  riskTolerance: string;
  investmentHorizonYears: number;
  monthlyInvestmentCapacity: number;
  debts: PersonalDebtItem[];
  goals: PersonalGoalItem[];
  notes: string;
}>;

export async function getPersonalFinanceProfile(userId: string): Promise<PersonalFinanceProfile | null> {
  const rows = await safeDbQuery("pf_profile_read", () =>
    db.select().from(personalFinanceProfiles).where(eq(personalFinanceProfiles.userId, userId)).limit(1),
  ).catch(() => []);
  return rows[0] ?? null;
}

/** Validates a raw request body into a typed patch. Never throws — returns an error string instead. */
export function validatePersonalFinancePatch(body: Record<string, unknown>): {
  patch: PersonalFinancePatch;
  error: string | null;
} {
  const patch: PersonalFinancePatch = {};

  const numFields = ["monthlyIncome", "monthlyExpenses", "emergencyFundCurrent", "monthlyInvestmentCapacity"] as const;
  for (const f of numFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < 0) return { patch, error: `${f} phải là số không âm` };
      patch[f] = n;
    }
  }

  if (body.dependents !== undefined) {
    const n = Number(body.dependents);
    if (!Number.isInteger(n) || n < 0 || n > 20) return { patch, error: "dependents phải là số nguyên 0-20" };
    patch.dependents = n;
  }

  if (body.investmentHorizonYears !== undefined) {
    const n = Number(body.investmentHorizonYears);
    if (!Number.isInteger(n) || n < 0 || n > 60) return { patch, error: "investmentHorizonYears không hợp lệ (0-60)" };
    patch.investmentHorizonYears = n;
  }

  if (body.riskTolerance !== undefined) {
    if (typeof body.riskTolerance !== "string" || !RISK_LEVELS.has(body.riskTolerance)) {
      return { patch, error: "riskTolerance phải là conservative | moderate | aggressive" };
    }
    patch.riskTolerance = body.riskTolerance;
  }

  if (body.debts !== undefined) {
    if (!Array.isArray(body.debts)) return { patch, error: "debts phải là mảng" };
    const debts: PersonalDebtItem[] = [];
    for (const raw of body.debts) {
      if (typeof raw !== "object" || raw === null) return { patch, error: "mỗi khoản nợ phải là object" };
      const item = raw as Record<string, unknown>;
      const balance = Number(item.balance);
      const rate = Number(item.interestRatePct);
      const payment = Number(item.monthlyPayment);
      if (!Number.isFinite(balance) || !Number.isFinite(rate) || !Number.isFinite(payment)) {
        return { patch, error: "mỗi khoản nợ cần balance/interestRatePct/monthlyPayment là số hợp lệ" };
      }
      debts.push({
        name: String(item.name ?? "Khoản nợ").slice(0, 100),
        balance,
        interestRatePct: rate,
        monthlyPayment: payment,
      });
    }
    patch.debts = debts.slice(0, 30);
  }

  if (body.goals !== undefined) {
    if (!Array.isArray(body.goals)) return { patch, error: "goals phải là mảng" };
    const goals: PersonalGoalItem[] = [];
    for (const raw of body.goals) {
      if (typeof raw !== "object" || raw === null) return { patch, error: "mỗi mục tiêu phải là object" };
      const item = raw as Record<string, unknown>;
      const targetAmount = Number(item.targetAmount);
      const targetYear = Number(item.targetYear);
      if (!Number.isFinite(targetAmount) || !Number.isInteger(targetYear)) {
        return { patch, error: "mỗi mục tiêu cần targetAmount (số) và targetYear (năm) hợp lệ" };
      }
      goals.push({ name: String(item.name ?? "Mục tiêu").slice(0, 100), targetAmount, targetYear });
    }
    patch.goals = goals.slice(0, 20);
  }

  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") return { patch, error: "notes phải là chuỗi" };
    patch.notes = body.notes.slice(0, 2000);
  }

  return { patch, error: null };
}

export async function upsertPersonalFinanceProfile(
  userId: string,
  patch: PersonalFinancePatch,
): Promise<PersonalFinanceProfile> {
  const existing = await getPersonalFinanceProfile(userId);
  const merged = {
    monthlyIncome: patch.monthlyIncome ?? existing?.monthlyIncome ?? 0,
    monthlyExpenses: patch.monthlyExpenses ?? existing?.monthlyExpenses ?? 0,
    emergencyFundCurrent: patch.emergencyFundCurrent ?? existing?.emergencyFundCurrent ?? 0,
    dependents: patch.dependents ?? existing?.dependents ?? 0,
    riskTolerance: patch.riskTolerance ?? existing?.riskTolerance ?? "moderate",
    investmentHorizonYears: patch.investmentHorizonYears ?? existing?.investmentHorizonYears ?? 5,
    monthlyInvestmentCapacity: patch.monthlyInvestmentCapacity ?? existing?.monthlyInvestmentCapacity ?? 0,
    debts: patch.debts ?? existing?.debts ?? [],
    goals: patch.goals ?? existing?.goals ?? [],
    notes: patch.notes ?? existing?.notes ?? "",
  };

  const rows = await safeDbQuery("pf_profile_upsert", () =>
    db
      .insert(personalFinanceProfiles)
      .values({ userId, ...merged, updatedAt: new Date() })
      .onConflictDoUpdate({ target: personalFinanceProfiles.userId, set: { ...merged, updatedAt: new Date() } })
      .returning(),
  );
  return rows[0];
}
