import { pool } from "@/db";

/**
 * Idempotent DDL for auth-related tables.
 *
 * drizzle-kit push runs at build time, but:
 * - Vercel build may use a different DATABASE_URL than runtime
 * - previous drizzle.config.json had a hardcoded URL that could diverge
 * - serverless cold starts should not assume migrations already ran
 *
 * This runs once per process (guarded by a module flag) and is safe to
 * call from instrumentation on boot.
 */
let ensured = false;
let ensurePromise: Promise<void> | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  password_hash varchar(255),
  name varchar(255),
  avatar_url varchar(500),
  phone_number varchar(30),
  provider varchar(20) NOT NULL DEFAULT 'local',
  email_verified boolean NOT NULL DEFAULT false,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  two_factor_secret varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token varchar(500) NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_token_idx ON refresh_tokens (token);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme varchar(20) NOT NULL DEFAULT 'dark',
  accent_color varchar(20) NOT NULL DEFAULT '#00d4ff',
  language varchar(10) NOT NULL DEFAULT 'vi',
  font_scale varchar(10) NOT NULL DEFAULT 'md',
  dashboard_layout jsonb,
  email_morning boolean NOT NULL DEFAULT true,
  morning_time varchar(5) NOT NULL DEFAULT '07:30',
  email_summary boolean NOT NULL DEFAULT true,
  summary_time varchar(5) NOT NULL DEFAULT '15:15',
  email_alerts boolean NOT NULL DEFAULT false,
  email_news boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  in_app_notifications boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token varchar(500) NOT NULL UNIQUE,
  user_agent varchar(400),
  ip_address varchar(60),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_token_idx ON user_sessions (token);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action varchar(60) NOT NULL,
  metadata jsonb,
  ip_address varchar(60),
  user_agent varchar(400),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at);
`;

export async function ensureAuthTables(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const client = await pool.connect();
    try {
      // pgcrypto / gen_random_uuid is available on modern Postgres & Supabase
      await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
      await client.query(DDL);
      ensured = true;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: "auth_tables_ensured",
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          provider: "database",
          msg: "auth_tables_ensure_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      // Do not mark ensured — next request can retry
      throw err;
    } finally {
      client.release();
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}
