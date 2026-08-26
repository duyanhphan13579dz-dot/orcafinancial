import { isNull } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    name: text("name").notNull(),
    exchange: varchar("exchange", { length: 20 }).notNull().default(""),
    type: varchar("type", { length: 40 }).notNull().default("stock"),
    industry: varchar("industry", { length: 80 }).notNull().default(""),
    sector: varchar("sector", { length: 80 }).notNull().default(""),
    source: varchar("source", { length: 40 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_symbol_uq").on(t.symbol), index("companies_name_idx").on(t.name)],
);

export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    description: text("description").notNull().default(""),
    industry: varchar("industry", { length: 80 }).notNull().default(""),
    sector: varchar("sector", { length: 80 }).notNull().default(""),
    employees: integer("employees"),
    website: varchar("website", { length: 200 }),
    listingDate: varchar("listing_date", { length: 20 }),
    marketCap: doublePrecision("market_cap"),
    sharesOutstanding: doublePrecision("shares_outstanding"),
    beta: doublePrecision("beta"),
    foreignOwnershipPct: doublePrecision("foreign_ownership_pct"),
    isGenerated: boolean("is_generated").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_profiles_symbol_uq").on(t.symbol)],
);

export const companySwot = pgTable(
  "company_swot",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    strengths: jsonb("strengths").notNull().$type<string[]>(),
    weaknesses: jsonb("weaknesses").notNull().$type<string[]>(),
    opportunities: jsonb("opportunities").notNull().$type<string[]>(),
    threats: jsonb("threats").notNull().$type<string[]>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_swot_symbol_uq").on(t.symbol)],
);

export const financialStatements = pgTable(
  "financial_statements",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(),
    period: varchar("period", { length: 5 }).notNull(),
    fiscalYear: integer("fiscal_year").notNull(),
    data: jsonb("data").notNull(),
    source: varchar("source", { length: 40 }).notNull().default("synthetic-sector-model"),
    confidence: doublePrecision("confidence").notNull().default(0.75),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fs_stmt_uq").on(t.symbol, t.type, t.period, t.fiscalYear),
    index("fs_symbol_idx").on(t.symbol),
    index("fs_year_idx").on(t.fiscalYear),
  ],
);

export const news = pgTable(
  "news",
  {
    id: serial("id").primaryKey(),
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    link: text("link").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    sourceName: varchar("source_name", { length: 60 }).notNull(),
    symbols: text("symbols").notNull().default(""),
    sentiment: doublePrecision("sentiment").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("news_guid_uq").on(t.guid),
    index("news_published_idx").on(t.publishedAt),
    index("news_symbols_idx").on(t.symbols),
  ],
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume").notNull().default(0),
    changePct: doublePrecision("change_pct").notNull().default(0),
    source: varchar("source", { length: 40 }).notNull(),
    confidence: doublePrecision("confidence").notNull().default(0.9),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("price_snapshots_symbol_uq").on(t.symbol), index("price_snapshots_time_idx").on(t.time), index("price_snapshots_updated_idx").on(t.updatedAt)],
);

export const priceSnapshotHistory = pgTable(
  "price_snapshot_history",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume").notNull().default(0),
    changePct: doublePrecision("change_pct").notNull().default(0),
    source: varchar("source", { length: 40 }).notNull(),
    confidence: doublePrecision("confidence").notNull().default(0.9),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_snapshot_history_symbol_time_uq").on(t.symbol, t.time),
    index("price_snapshot_history_symbol_time_idx").on(t.symbol, t.time),
  ],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watchlist_session_symbol_uq").on(t.sessionId, t.symbol)],
);

export const jobLogs = pgTable(
  "job_logs",
  {
    id: serial("id").primaryKey(),
    job: varchar("job", { length: 60 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    detail: text("detail").notNull().default(""),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_logs_created_idx").on(t.createdAt)],
);

export const fundamentalAnalysis = pgTable(
  "fundamental_analysis",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    data: jsonb("data").notNull(),
    source: varchar("source", { length: 40 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fundamental_analysis_symbol_uq").on(t.symbol)],
);

export const companyValueChains = pgTable(
  "company_value_chains",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    primaryActivities: jsonb("primary_activities").notNull().$type<
      Array<{ name: string; nameVi: string; description: string; icon: string }>
    >(),
    supportActivities: jsonb("support_activities").notNull().$type<
      Array<{ name: string; nameVi: string; description: string; icon: string }>
    >(),
    modelVersion: varchar("model_version", { length: 20 }).notNull().default("porter-v1"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_value_chains_symbol_uq").on(t.symbol)],
);

export const stockDecisionHistory = pgTable(
  "stock_decision_history",
  {
    id: serial("id").primaryKey(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    verdict: varchar("verdict", { length: 20 }).notNull(),
    score: doublePrecision("score").notNull(),
    risk: varchar("risk", { length: 20 }).notNull(),
    trend: varchar("trend", { length: 20 }).notNull(),
    modelVersion: varchar("model_version", { length: 40 }).notNull(),
    predictionConfidence: doublePrecision("prediction_confidence").notNull().default(0),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_decision_history_symbol_idx").on(t.symbol, t.createdAt), index("stock_decision_history_session_idx").on(t.sessionId, t.createdAt)],
);
export const connectorAlerts = pgTable(
  "connector_alerts",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 60 }).notNull(),
    level: varchar("level", { length: 20 }).notNull(),
    message: text("message").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    slackOk: boolean("slack_ok"),
  },
  (t) => [
    index("connector_alerts_provider_idx").on(t.provider),
    index("connector_alerts_dispatched_idx").on(t.dispatchedAt),
    index("connector_alerts_open_idx").on(t.provider).where(isNull(t.resolvedAt)),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 20 }).notNull(),
    reportDate: varchar("report_date", { length: 10 }).notNull(),
    contentHtml: text("content_html").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    reportId: varchar("report_id", { length: 80 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reports_type_date_uq").on(t.type, t.reportDate), uniqueIndex("reports_report_id_uq").on(t.reportId), index("reports_date_idx").on(t.reportDate)],
);

export {
  impactTypeEnum,
  commodityGroupEnum,
  exchangeRates,
  commodities,
  commodityPrices,
  commodityStockImpact,
} from "@/lib/commodities/schema";

export {
  cryptoCoins,
  cryptoPrices,
  cryptoOhlcv,
  cryptoSentiment,
  cryptoAnalysis,
} from "@/lib/crypto/schema";

export {
  forexPairs,
  forexPrices,
  forexOhlcv,
  forexAnalysis,
  forexJournal,
  forexPositions,
} from "@/lib/forex/schema";

export { personalFinanceProfiles } from "@/lib/personal-finance/schema";

export { corporateFinanceStatements } from "@/lib/corporate-finance/schema";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  name: varchar("name", { length: 255 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  phoneNumber: varchar("phone_number", { length: 30 }),
  provider: varchar("provider", { length: 20 }).notNull().default("local"),
  emailVerified: boolean("email_verified").notNull().default(false),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  twoFactorSecret: varchar("two_factor_secret", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("users_email_idx").on(t.email),
]);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: varchar("token", { length: 500 }).notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("refresh_tokens_token_idx").on(t.token),
  index("refresh_tokens_user_idx").on(t.userId),
]);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: varchar("theme", { length: 20 }).notNull().default("dark"),
  accentColor: varchar("accent_color", { length: 20 }).notNull().default("#00d4ff"),
  language: varchar("language", { length: 10 }).notNull().default("vi"),
  fontScale: varchar("font_scale", { length: 10 }).notNull().default("md"),
  dashboardLayout: jsonb("dashboard_layout").$type<Record<string, unknown>>(),
  emailMorning: boolean("email_morning").notNull().default(true),
  morningTime: varchar("morning_time", { length: 5 }).notNull().default("07:30"),
  emailSummary: boolean("email_summary").notNull().default(true),
  summaryTime: varchar("summary_time", { length: 5 }).notNull().default("15:15"),
  emailAlerts: boolean("email_alerts").notNull().default(false),
  emailNews: boolean("email_news").notNull().default(false),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  inAppNotifications: boolean("in_app_notifications").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 500 }).notNull().unique(),
  userAgent: varchar("user_agent", { length: 400 }),
  ipAddress: varchar("ip_address", { length: 60 }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("user_sessions_user_idx").on(t.userId),
  index("user_sessions_token_idx").on(t.token),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 60 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ipAddress: varchar("ip_address", { length: 60 }),
  userAgent: varchar("user_agent", { length: 400 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_logs_user_idx").on(t.userId),
  index("audit_logs_created_idx").on(t.createdAt),
]);

/** Per-user AI Agent conversation threads. */
export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull().default("Cuộc trò chuyện mới"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_conversations_user_idx").on(t.userId),
    index("agent_conversations_updated_idx").on(t.updatedAt),
  ],
);

/** Individual chat turns (user prompt + agent response). */
export const agentLogs = pgTable(
  "agent_logs",
  {
    id: serial("id").primaryKey(),
    sessionId: varchar("session_id", { length: 64 }).notNull().default(""),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => agentConversations.id, {
      onDelete: "cascade",
    }),
    prompt: text("prompt").notNull(),
    response: text("response").notNull(),
    model: varchar("model", { length: 60 }).notNull().default("rule-engine"),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_logs_created_idx").on(t.createdAt),
    index("agent_logs_user_idx").on(t.userId),
    index("agent_logs_conversation_idx").on(t.conversationId),
  ],
);
