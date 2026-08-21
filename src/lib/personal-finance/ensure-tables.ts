import { pool } from "@/db";

/**
 * Idempotent DDL for the personal finance profile table.
 * Runs once per process from instrumentation.ts, after ensureAuthTables()
 * (so the `users` table + pgcrypto extension already exist for the FK).
 */
let ensured = false;
let ensurePromise: Promise<void> | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS personal_finance_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_income double precision NOT NULL DEFAULT 0,
  monthly_expenses double precision NOT NULL DEFAULT 0,
  emergency_fund_current double precision NOT NULL DEFAULT 0,
  dependents integer NOT NULL DEFAULT 0,
  risk_tolerance varchar(20) NOT NULL DEFAULT 'moderate',
  investment_horizon_years integer NOT NULL DEFAULT 5,
  monthly_investment_capacity double precision NOT NULL DEFAULT 0,
  debts jsonb NOT NULL DEFAULT '[]',
  goals jsonb NOT NULL DEFAULT '[]',
  notes varchar(2000) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pf_profiles_updated_idx ON personal_finance_profiles (updated_at);
`;

export async function ensurePersonalFinanceTables(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    let client;
    try {
      client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ensure_pf_pool_connect_timeout")), 12_000),
        ),
      ]);
      await client.query(DDL);
      ensured = true;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: "personal_finance_tables_ensured",
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          provider: "database",
          msg: "personal_finance_tables_ensure_failed",
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
