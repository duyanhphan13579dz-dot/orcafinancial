import { pool } from "@/db";

/**
 * Idempotent DDL for AI Agent conversation history.
 * Safe to call on every boot / cold start.
 */
let ensured = false;
let ensurePromise: Promise<void> | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS agent_conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL DEFAULT 'Cuộc trò chuyện mới',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_conversations_user_idx ON agent_conversations (user_id);
CREATE INDEX IF NOT EXISTS agent_conversations_updated_idx ON agent_conversations (updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_logs (
  id serial PRIMARY KEY,
  session_id varchar(64) NOT NULL DEFAULT '',
  prompt text NOT NULL,
  response text NOT NULL,
  model varchar(60) NOT NULL DEFAULT 'rule-engine',
  latency_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_logs_created_idx ON agent_logs (created_at);

ALTER TABLE agent_logs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE agent_logs ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES agent_conversations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS agent_logs_user_idx ON agent_logs (user_id);
CREATE INDEX IF NOT EXISTS agent_logs_conversation_idx ON agent_logs (conversation_id);
`;

export async function ensureAgentTables(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    let client;
    try {
      client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ensure_agent_pool_connect_timeout")), 12_000),
        ),
      ]);

      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
      } catch {
        // may already exist or lack privileges on Supabase
      }

      await client.query(DDL);
      ensured = true;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: "agent_tables_ensured",
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          provider: "database",
          msg: "agent_tables_ensure_failed",
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
