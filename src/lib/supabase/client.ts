"use client";

/**
 * Browser-side Supabase client — OPTIONAL.
 *
 * The app's core data layer (Drizzle + `pg.Pool` in `src/db/index.ts`)
 * continues to work unmodified whether the underlying Postgres is
 * self-hosted or Supabase-hosted; this client is purely additive for teams
 * that want to opt into Supabase's bundled services from the browser:
 *
 *   - Supabase Auth   (magic link / OAuth / email-password sign-in)
 *   - Supabase Realtime (Postgres CDC subscriptions, presence, broadcast)
 *   - Supabase Storage  (file uploads)
 *
 * It is intentionally lazy and null-safe: if `NEXT_PUBLIC_SUPABASE_URL` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set (e.g. you're running against
 * plain self-hosted PostgreSQL), `getSupabaseBrowserClient()` returns
 * `null` instead of throwing, so importing this module never breaks the
 * build or the app for users who don't use Supabase.
 *
 * See docs/SUPABASE_MIGRATION.md for the full setup guide, including how
 * to find these two values in the Supabase dashboard
 * (Project Settings → API).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    cached = null;
    return null;
  }

  cached = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  return cached;
}

/**
 * Convenience hook-free helper: subscribe to real-time changes on a table.
 * Returns an unsubscribe function; no-op if Supabase isn't configured.
 *
 * Example (optional upgrade path for realtime price ticks — the app
 * currently polls `/api/v1/market/overview` on an interval, which keeps
 * working regardless of whether you adopt this):
 *
 *   useEffect(() => {
 *     return subscribeToTable("stock_prices", (payload) => {
 *       console.log("price changed", payload);
 *     });
 *   }, []);
 */
export function subscribeToTable(
  table: string,
  onChange: (payload: unknown) => void,
  schema = "public",
): () => void {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`realtime:${schema}:${table}`)
    .on("postgres_changes", { event: "*", schema, table }, onChange)
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
