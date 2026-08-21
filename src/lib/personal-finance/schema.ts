/**
 * Personal Finance Module Schema — Drizzle ORM
 *
 * Table:
 * - personal_finance_profiles: hồ sơ tài chính cá nhân của người dùng
 *   (thu nhập, chi tiêu, nợ, mục tiêu, khẩu vị rủi ro). Đây là dữ liệu
 *   thật dùng làm ngữ cảnh cho AI Agent khi trả lời câu hỏi personal_finance/
 *   wealth, thay cho khung lý thuyết tĩnh trước đây.
 *
 * Lưu ý FK: user_id KHÔNG dùng `.references()` ở tầng Drizzle để tránh
 * circular import với `@/db/schema` (nơi định nghĩa bảng `users`). Ràng buộc
 * khóa ngoại vẫn được tạo ở tầng SQL thô trong `ensure-tables.ts`, theo đúng
 * quy ước idempotent-DDL-on-boot đã dùng cho auth/market tables.
 */

import { pgTable, uuid, doublePrecision, integer, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export interface PersonalDebtItem {
  name: string;
  balance: number;
  interestRatePct: number;
  monthlyPayment: number;
}

export interface PersonalGoalItem {
  name: string;
  targetAmount: number;
  targetYear: number;
}

export const personalFinanceProfiles = pgTable(
  "personal_finance_profiles",
  {
    userId: uuid("user_id").primaryKey(),
    monthlyIncome: doublePrecision("monthly_income").notNull().default(0),
    monthlyExpenses: doublePrecision("monthly_expenses").notNull().default(0),
    emergencyFundCurrent: doublePrecision("emergency_fund_current").notNull().default(0),
    dependents: integer("dependents").notNull().default(0),
    /** conservative | moderate | aggressive */
    riskTolerance: varchar("risk_tolerance", { length: 20 }).notNull().default("moderate"),
    investmentHorizonYears: integer("investment_horizon_years").notNull().default(5),
    monthlyInvestmentCapacity: doublePrecision("monthly_investment_capacity").notNull().default(0),
    debts: jsonb("debts").notNull().$type<PersonalDebtItem[]>(),
    goals: jsonb("goals").notNull().$type<PersonalGoalItem[]>(),
    notes: varchar("notes", { length: 2000 }).notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pf_profiles_updated_idx").on(t.updatedAt)],
);

export type PersonalFinanceProfile = typeof personalFinanceProfiles.$inferSelect;
