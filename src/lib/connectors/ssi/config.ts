/**
 * SSI FastConnect configuration.
 *
 * SCOPE: market data only. Order placement, conditional orders (FCO), account,
 * position and balance APIs are intentionally not part of this module.
 *
 * Consequences of that scope:
 *  - The token request omits `otp`, so the token can read market data and
 *    subscribe to the WebSocket DATA channel, but cannot trade.
 *  - No RSA private key and no `X-Signature` header are involved; those apply
 *    to order placement only.
 *  - The token can therefore be refreshed unattended, which is what makes this
 *    compatible with serverless runtimes.
 *
 * Docs: https://developers.ssi.com.vn/
 */

export const SSI_PROVIDER = "ssi-fastconnect";

export const SSI_DEFAULTS = {
  restBaseUrl: "https://api.ssi.com.vn",
  wsUrl: "wss://stream.ssi.com.vn",
} as const;

/** Timeframes accepted by `GET /api/v3/data/ohlc`. */
export const SSI_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "1d"] as const;
export type SsiTimeframe = (typeof SSI_TIMEFRAMES)[number];

/** Boards accepted by the securities / index endpoints. */
export const SSI_BOARDS = ["HOSE", "HNX", "UPCOM"] as const;
export type SsiBoard = (typeof SSI_BOARDS)[number];

export interface SsiConfig {
  clientId: string;
  apiKey: string;
  apiSecret: string;
  restBaseUrl: string;
  wsUrl: string;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read SSI configuration from the environment.
 * Returns `null` when the credential pair is missing, which leaves the
 * existing VNDirect → Yahoo fallback chain untouched.
 */
export function ssiConfig(): SsiConfig | null {
  const apiKey = process.env.SSI_API_KEY?.trim();
  const apiSecret = process.env.SSI_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;

  return {
    clientId: process.env.SSI_CLIENT_ID?.trim() ?? "",
    apiKey,
    apiSecret,
    restBaseUrl: (process.env.SSI_REST_BASE_URL?.trim() || SSI_DEFAULTS.restBaseUrl).replace(/\/$/, ""),
    wsUrl: process.env.SSI_WS_URL?.trim() || SSI_DEFAULTS.wsUrl,
  };
}

export function isSsiConfigured(): boolean {
  return ssiConfig() !== null;
}

export const SSI_TIMEOUTS = {
  /** Per-request timeout for REST market data calls. */
  rest: envInt("SSI_REST_TIMEOUT_MS", 8_000),
  /** How long a cached token is reused before its expiry is re-checked. */
  tokenCacheTtlMs: envInt("SSI_TOKEN_CACHE_TTL_MS", 60_000),
  /** Refresh this many ms before actual expiry. */
  refreshSkewMs: envInt("SSI_TOKEN_REFRESH_SKEW_MS", 5 * 60_000),
  /** Heartbeat interval for the WebSocket DATA channel (server pings every 30s). */
  heartbeatMs: envInt("SSI_WS_HEARTBEAT_MS", 30_000),
} as const;

/** Enable the persistent WebSocket worker (default off until a host exists). */
export function isSsiWsEnabled(): boolean {
  const raw = process.env.SSI_WS_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Format a date for SSI query parameters.
 * Daily endpoints expect `YYYY/MM/DD`; intraday endpoints expect
 * `YYYY/MM/DD HH:mm:ss`.
 */
export function formatSsiDate(input: Date | number | string, withTime = false): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(input)}`);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`;
  if (!withTime) return day;
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** SSI returns almost every numeric field as a string. */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Convert `YYYY/MM/DD` or `YYYY/MM/DD HH:mm:ss` to epoch seconds. */
export function parseSsiDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
