import { pool } from "@/db";

/**
 * Idempotent DDL for daily reports table.
 * drizzle-kit push may not have run against production Supabase.
 */
let ensured = false;
let ensurePromise: Promise<void> | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS reports (
  id serial PRIMARY KEY,
  type varchar(20) NOT NULL,
  report_date varchar(10) NOT NULL,
  content_html text NOT NULL,
  title varchar(200) NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reports_type_date_uq
  ON reports (type, report_date);

CREATE INDEX IF NOT EXISTS reports_date_idx
  ON reports (report_date);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_id varchar(80);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS reports_report_id_uq
  ON reports (report_id)
  WHERE report_id IS NOT NULL;
`;

export async function ensureReportsTable(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    let client;
    try {
      client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ensure_reports_pool_timeout")), 10_000),
        ),
      ]);
      await client.query(DDL);
      ensured = true;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: "reports_table_ensured",
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          provider: "database",
          msg: "reports_table_ensure_failed",
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
