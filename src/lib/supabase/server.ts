/**
 * Server-side Supabase client — OPTIONAL, service-role privileged.
 *
 * Use this ONLY inside API routes / server components — never expose the
 * service role key to the browser. It bypasses Row Level Security (RLS),
 * so treat it like any other server-only secret (same rules as
 * ANTHROPIC_API_KEY / DATABASE_URL — see the "Secret Rotation Guide"
 * section of README.md).
 *
 * Like the browser client, this is fully optional: if
 * `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL` are not set,
 * `getSupabaseServerClient()` returns `null` so the app keeps working
 * against a plain self-hosted PostgreSQL without any code changes.
 *
 * Typical use cases once you migrate to Supabase:
 *   - Supabase Auth admin operations (invite users, revoke sessions)
 *   - Supabase Storage server-side uploads
 *   - Broadcasting Realtime events from a backend job (e.g. the report
 *     scheduler in src/lib/reports/scheduler.ts could broadcast "new
 *     report ready" events instead of relying on client polling)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseServerClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    cached = null;
    return null;
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** True when the app has valid Supabase credentials configured (used by /api/health/upstream). */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
