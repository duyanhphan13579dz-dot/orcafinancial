/**
 * Corporate Finance Module Schema — Drizzle ORM
 *
 * Table:
 * - corporate_finance_statements: số liệu BCTC do người dùng nhập tay theo
 *   từng công ty/kỳ (năm hoặc quý). Dùng làm ngữ cảnh thật cho AI Agent khi
 *   trả lời câu hỏi corporate_finance, thay cho khung lý thuyết tĩnh.
 *
 * Phạm vi hiện tại: nhập số liệu có cấu trúc (không OCR/parse PDF BCTC tự
 * động — có thể bổ sung sau bằng cách tái dùng pdf-reading/xlsx skill để
 * trích số liệu rồi POST vào endpoint này).
 *
 * Lưu ý FK: user_id KHÔNG dùng `.references()` ở tầng Drizzle (tránh
 * circular import với `@/db/schema`); ràng buộc khóa ngoại được tạo ở tầng
 * SQL thô trong `ensure-tables.ts`.
 */

import {
  pgTable,
  uuid,
  varchar,
  integer,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const corporateFinanceStatements = pgTable(
  "corporate_finance_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    companyName: varchar("company_name", { length: 200 }).notNull(),
    industry: varchar("industry", { length: 100 }).notNull().default(""),
    fiscalYear: integer("fiscal_year").notNull(),
    /** Y | Q1 | Q2 | Q3 | Q4 */
    period: varchar("period", { length: 5 }).notNull().default("Y"),

    revenue: doublePrecision("revenue").notNull().default(0),
    cogs: doublePrecision("cogs").notNull().default(0),
    operatingExpenses: doublePrecision("operating_expenses").notNull().default(0),
    ebitda: doublePrecision("ebitda").notNull().default(0),
    netIncome: doublePrecision("net_income").notNull().default(0),

    totalAssets: doublePrecision("total_assets").notNull().default(0),
    totalLiabilities: doublePrecision("total_liabilities").notNull().default(0),
    totalEquity: doublePrecision("total_equity").notNull().default(0),
    cash: doublePrecision("cash").notNull().default(0),
    shortTermDebt: doublePrecision("short_term_debt").notNull().default(0),
    longTermDebt: doublePrecision("long_term_debt").notNull().default(0),

    operatingCashFlow: doublePrecision("operating_cash_flow").notNull().default(0),
    investingCashFlow: doublePrecision("investing_cash_flow").notNull().default(0),
    financingCashFlow: doublePrecision("financing_cash_flow").notNull().default(0),

    notes: varchar("notes", { length: 2000 }).notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cf_stmt_uq").on(t.userId, t.companyName, t.fiscalYear, t.period),
    index("cf_stmt_user_idx").on(t.userId),
    index("cf_stmt_company_idx").on(t.companyName),
  ],
);

export type CorporateFinanceStatement = typeof corporateFinanceStatements.$inferSelect;
