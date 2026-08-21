import { pool } from "@/db";

/**
 * Idempotent DDL for the corporate finance statements table.
 * Runs once per process from instrumentation.ts, after ensureAuthTables()
 * (so the `users` table + pgcrypto extension already exist for gen_random_uuid()/FK).
 */
let ensured = false;
let ensurePromise: Promise<void> | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS corporate_finance_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name varchar(200) NOT NULL,
  industry varchar(100) NOT NULL DEFAULT '',
  fiscal_year integer NOT NULL,
  period varchar(5) NOT NULL DEFAULT 'Y',
  revenue double precision NOT NULL DEFAULT 0,
  cogs double precision NOT NULL DEFAULT 0,
  operating_expenses double precision NOT NULL DEFAULT 0,
  ebitda double precision NOT NULL DEFAULT 0,
  net_income double precision NOT NULL DEFAULT 0,
  total_assets double precision NOT NULL DEFAULT 0,
  total_liabilities double precision NOT NULL DEFAULT 0,
  total_equity double precision NOT NULL DEFAULT 0,
  cash double precision NOT NULL DEFAULT 0,
  short_term_debt double precision NOT NULL DEFAULT 0,
  long_term_debt double precision NOT NULL DEFAULT 0,
  operating_cash_flow double precision NOT NULL DEFAULT 0,
  investing_cash_flow double precision NOT NULL DEFAULT 0,
  financing_cash_flow double precision NOT NULL DEFAULT 0,
  notes varchar(2000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_name, fiscal_year, period)
);

CREATE INDEX IF NOT EXISTS cf_stmt_user_idx ON corporate_finance_statements (user_id);
CREATE INDEX IF NOT EXISTS cf_stmt_company_idx ON corporate_finance_statements (company_name);
`;

export async function ensureCorporateFinanceTables(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    let client;
    try {
      client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ensure_cf_pool_connect_timeout")), 12_000),
        ),
      ]);
      await client.query(DDL);
      ensured = true;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: "corporate_finance_tables_ensured",
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          provider: "database",
          msg: "corporate_finance_tables_ensure_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    } finally {
      client?.release();
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}
