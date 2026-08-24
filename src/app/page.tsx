import { cookies } from "next/headers";
import { LandingPage } from "@/components/LandingPage";
import { DashboardHome } from "@/components/DashboardHome";

/**
 * `/` used to be a client component that blocked its entire render on
 * `useAuth().loading` — every visitor (including anonymous ones who only
 * ever see the static marketing page) paid a client round-trip to
 * `/api/v1/auth/me` before anything painted, and logged-in users had that
 * same auth check running *before* DashboardHome's own market-data fetch
 * could even start (a serial waterfall instead of parallel).
 *
 * `middleware.ts` already inspects the `refreshToken` cookie on every
 * request to decide access — we reuse that exact same shallow check here,
 * server-side, so the correct branch (LandingPage vs DashboardHome) is
 * chosen before the response is ever sent to the browser:
 *   - Anonymous visitors get the marketing page fully server-rendered
 *     (better LCP, and crawlers/social previews see real content instead
 *     of an empty shell).
 *   - Logged-in users get DashboardHome immediately, and its internal
 *     `usePoll` hooks (market overview, news) start fetching on mount
 *     with no auth check blocking them first.
 *
 * DashboardHome remains a "use client" component (it needs the polling
 * hooks) — Next.js renders it as a client boundary inside this server
 * component without issue. `useAuth()` elsewhere in the app (nav, user
 * menu, logout) is untouched; this only removes the auth check as a
 * *gate* on the root page's first paint.
 */
export default async function HomePage() {
  const cookieStore = await cookies();
  const refresh = cookieStore.get("refreshToken")?.value;
  const loggedIn = Boolean(refresh && refresh.length > 10);

  return loggedIn ? <DashboardHome /> : <LandingPage />;
}
