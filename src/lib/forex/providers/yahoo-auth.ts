/**
 * Yahoo Finance cookie + crumb session for endpoints that require auth
 * (notably /v7/finance/quote since ~2024).
 *
 * Flow:
 *   1. GET https://fc.yahoo.com  → Set-Cookie
 *   2. GET https://query1.finance.yahoo.com/v1/test/getcrumb  → crumb string
 *   3. Reuse cookie+crumb until TTL or 401 Invalid Crumb
 */

import { forProvider } from "@/lib/logger";

const log = forProvider("yahoo-auth");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CRUMB_TTL_MS = 12 * 60_000;
const AUTH_TIMEOUT_MS = 4_000;

interface YahooAuthState {
  cookie: string;
  crumb: string;
  obtainedAt: number;
  host: "query1" | "query2";
}

let authState: YahooAuthState | null = null;
let authPromise: Promise<YahooAuthState> | null = null;

function isValidCrumb(crumb: string): boolean {
  const t = crumb.trim();
  if (!t || t.length < 4 || t.length > 200) return false;
  if (/too many requests|unauthorized|invalid|error|<html/i.test(t)) return false;
  return true;
}

function parseSetCookie(res: Response): string {
  // Node fetch may expose getSetCookie(); browsers only have get("set-cookie")
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const parts: string[] = [];
  if (typeof anyHeaders.getSetCookie === "function") {
    for (const c of anyHeaders.getSetCookie()) {
      const nv = c.split(";")[0]?.trim();
      if (nv) parts.push(nv);
    }
  } else {
    const raw = res.headers.get("set-cookie");
    if (raw) {
      for (const segment of raw.split(/,(?=[^;]+?=)/)) {
        const nv = segment.split(";")[0]?.trim();
        if (nv) parts.push(nv);
      }
    }
  }
  return parts.join("; ");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function mintAuth(host: "query1" | "query2"): Promise<YahooAuthState> {
  const base = host === "query1" ? "https://query1.finance.yahoo.com" : "https://query2.finance.yahoo.com";

  // Step 1: obtain consent / session cookies
  let cookie = "";
  try {
    const fc = await fetchWithTimeout("https://fc.yahoo.com", {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
      },
      redirect: "follow",
    });
    cookie = parseSetCookie(fc);
  } catch (e) {
    log.warn("fc_yahoo_failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // Also hit finance homepage if fc gave nothing
  if (!cookie) {
    try {
      const home = await fetchWithTimeout("https://finance.yahoo.com", {
        method: "GET",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      cookie = parseSetCookie(home);
    } catch (e) {
      log.warn("finance_home_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Step 2: getcrumb (cookie optional but improves success rate)
  const crumbRes = await fetchWithTimeout(`${base}/v1/test/getcrumb`, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  // Merge any additional cookies from getcrumb
  const extra = parseSetCookie(crumbRes);
  if (extra) {
    cookie = cookie ? `${cookie}; ${extra}` : extra;
  }

  if (!crumbRes.ok) {
    const body = await crumbRes.text().catch(() => "");
    throw new Error(
      `getcrumb HTTP ${crumbRes.status}: ${body.slice(0, 120)}`,
    );
  }

  const crumb = (await crumbRes.text()).trim();
  if (!isValidCrumb(crumb)) {
    throw new Error(`invalid crumb payload: ${crumb.slice(0, 80)}`);
  }

  const state: YahooAuthState = {
    cookie,
    crumb,
    obtainedAt: Date.now(),
    host,
  };
  log.info("yahoo_auth_ok", {
    host,
    crumbLen: crumb.length,
    hasCookie: Boolean(cookie),
  });
  return state;
}

/**
 * Get cached or fresh Yahoo auth. Pass forceRefresh after 401.
 */
export async function getYahooAuth(
  opts: { forceRefresh?: boolean; preferHost?: "query1" | "query2" } = {},
): Promise<YahooAuthState> {
  if (
    !opts.forceRefresh &&
    authState &&
    Date.now() - authState.obtainedAt < CRUMB_TTL_MS
  ) {
    return authState;
  }

  if (authPromise && !opts.forceRefresh) return authPromise;

  authPromise = (async () => {
    const hosts: Array<"query1" | "query2"> = opts.preferHost
      ? [opts.preferHost, opts.preferHost === "query1" ? "query2" : "query1"]
      : ["query1", "query2"];

    const errors: string[] = [];
    for (const h of hosts) {
      try {
        const state = await mintAuth(h);
        authState = state;
        return state;
      } catch (e) {
        errors.push(`${h}:${e instanceof Error ? e.message : String(e)}`);
      }
    }
    authState = null;
    throw new Error(`yahoo_auth_failed: ${errors.join(" | ")}`);
  })().finally(() => {
    authPromise = null;
  });

  return authPromise;
}

export function invalidateYahooAuth() {
  authState = null;
  log.info("yahoo_auth_invalidated");
}

export function yahooBrowserHeaders(auth?: YahooAuthState | null): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (auth?.cookie) h.Cookie = auth.cookie;
  return h;
}

export function classifyYahooError(
  status: number,
  bodySnippet: string,
): {
  code: "INVALID_CRUMB" | "RATE_LIMIT" | "UNAUTHORIZED" | "HTTP_ERROR" | "EMPTY";
  retryAuth: boolean;
  message: string;
} {
  const text = bodySnippet.slice(0, 300);
  if (status === 429 || /too many requests/i.test(text)) {
    return { code: "RATE_LIMIT", retryAuth: false, message: "Yahoo rate limited (429)" };
  }
  if (status === 401 || /invalid crumb/i.test(text)) {
    return { code: "INVALID_CRUMB", retryAuth: true, message: "Yahoo Invalid Crumb (401)" };
  }
  if (status === 401 || /invalid cookie|unauthorized/i.test(text)) {
    return { code: "UNAUTHORIZED", retryAuth: true, message: "Yahoo Unauthorized" };
  }
  if (status === 404 || /not found/i.test(text)) {
    return { code: "EMPTY", retryAuth: false, message: "Yahoo not found" };
  }
  return {
    code: "HTTP_ERROR",
    retryAuth: status === 401 || status === 403,
    message: `Yahoo HTTP ${status}: ${text.slice(0, 120)}`,
  };
}

export { UA as YAHOO_UA };
