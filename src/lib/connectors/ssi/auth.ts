/**
 * SSI FastConnect authentication — market-data scope only.
 *
 * The token request deliberately omits `otp`, producing a token that can read
 * REST market data and subscribe to the WebSocket DATA channel but cannot place
 * or modify orders. Because no human OTP step is involved, the token can be
 * cached and refreshed unattended — which is what keeps this usable from
 * serverless functions.
 *
 * Endpoints:
 *   POST /api/v3/auth/token    { apiKey, apiSecret }            -> token pair
 *   POST /api/v3/auth/refresh  { refreshToken }                 -> token pair
 *
 * `GET /api/v3/auth/requestOtp` is NOT used: it only exists to obtain a
 * trading-capable token.
 */

import { ProviderError, fetchWithRetry, readJsonSafe } from "@/lib/connectors/core";
import { sharedCacheGet, sharedCacheSet } from "@/lib/connectors/redis-cache";
import { forProvider } from "@/lib/logger";
import { SSI_PROVIDER, SSI_TIMEOUTS, ssiConfig } from "@/lib/connectors/ssi/config";

const log = forProvider(SSI_PROVIDER);

const TOKEN_CACHE_KEY = "ssi:auth:token:v1";

export interface SsiToken {
  tokenType: string;
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  refreshToken: string;
  /** Epoch milliseconds. */
  refreshExpiresAt: number;
}

interface TokenResponse {
  tokenType?: unknown;
  accessToken?: unknown;
  expiresAt?: unknown;
  refreshToken?: unknown;
  refreshExpiresAt?: unknown;
}

function assertToken(payload: unknown, context: string): SsiToken {
  const raw = payload as TokenResponse | null;
  const accessToken = typeof raw?.accessToken === "string" ? raw.accessToken : "";
  const refreshToken = typeof raw?.refreshToken === "string" ? raw.refreshToken : "";
  const expiresAt = typeof raw?.expiresAt === "number" ? raw.expiresAt : Number(raw?.expiresAt);
  const refreshExpiresAt =
    typeof raw?.refreshExpiresAt === "number" ? raw.refreshExpiresAt : Number(raw?.refreshExpiresAt);

  if (!accessToken || !refreshToken || !Number.isFinite(expiresAt) || !Number.isFinite(refreshExpiresAt)) {
    throw new ProviderError(SSI_PROVIDER, `malformed token response (${context})`, {
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
      expiresAt,
      refreshExpiresAt,
    });
  }

  return {
    tokenType: typeof raw?.tokenType === "string" ? raw.tokenType : "Bearer",
    accessToken,
    expiresAt,
    refreshToken,
    refreshExpiresAt,
  };
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const config = ssiConfig();
  if (!config) throw new ProviderError(SSI_PROVIDER, "SSI credentials not configured");

  const url = `${config.restBaseUrl}${path}`;
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // SSI defaults to `en` when absent; be explicit.
      "Accept-Language": "vi",
    },
    body: JSON.stringify(body),
    timeoutMs: SSI_TIMEOUTS.rest,
    retries: 1,
    provider: SSI_PROVIDER,
    noRetryOnClientError: true,
  });

  if (!response.ok) {
    throw new ProviderError(SSI_PROVIDER, `${path} HTTP ${response.status}`, { path });
  }
  return readJsonSafe(response, SSI_PROVIDER, url);
}

/** Exchange apiKey/apiSecret for a fresh token pair (no OTP). */
async function requestToken(): Promise<SsiToken> {
  const config = ssiConfig();
  if (!config) throw new ProviderError(SSI_PROVIDER, "SSI credentials not configured");

  const payload = await postJson("/api/v3/auth/token", {
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
  });
  const token = assertToken(payload, "auth/token");
  log.info("ssi_auth_token_issued", { expiresAt: token.expiresAt });
  return token;
}

/** Exchange a still-valid refresh token for a new token pair. */
async function refreshToken(refreshTokenValue: string): Promise<SsiToken> {
  const payload = await postJson("/api/v3/auth/refresh", { refreshToken: refreshTokenValue });
  const token = assertToken(payload, "auth/refresh");
  log.info("ssi_auth_token_refreshed", { expiresAt: token.expiresAt });
  return token;
}

/** True when the token still has more than `refreshSkewMs` of life left. */
function tokenIsFresh(token: SsiToken): boolean {
  return Boolean(token.accessToken) && Date.now() + SSI_TIMEOUTS.refreshSkewMs < token.expiresAt;
}

function canRefresh(token: SsiToken): boolean {
  return Boolean(token.refreshToken) && Date.now() < token.refreshExpiresAt;
}

async function loadCachedToken(): Promise<SsiToken | null> {
  try {
    const cached = await sharedCacheGet<SsiToken>(TOKEN_CACHE_KEY);
    return cached ?? null;
  } catch {
    return null;
  }
}

async function persistToken(token: SsiToken): Promise<void> {
  // Never let the cache outlive the refresh token, otherwise a stale entry
  // could be served after the refresh window has closed.
  const ttlMs = Math.max(1_000, token.refreshExpiresAt - Date.now());
  await sharedCacheSet(TOKEN_CACHE_KEY, token, Math.min(ttlMs, 30 * 24 * 60 * 60_000));
}

/**
 * Single-flight guard.
 *
 * Concurrent serverless invocations must not trigger parallel token refreshes:
 * SSI rotates the refresh token on every refresh, so racing requests would
 * invalidate each other.
 */
let inflight: Promise<SsiToken> | null = null;

async function resolveToken(): Promise<SsiToken> {
  const cached = await loadCachedToken();
  if (cached != null && tokenIsFresh(cached)) return cached;

  if (cached != null && canRefresh(cached)) {
    try {
      const refreshed = await refreshToken(cached.refreshToken);
      await persistToken(refreshed);
      return refreshed;
    } catch (error) {
      log.warn("ssi_auth_refresh_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to a full re-authenticate.
    }
  }

  const fresh = await requestToken();
  await persistToken(fresh);
  return fresh;
}

/**
 * Return a valid access token, refreshing or re-authenticating as needed.
 * Throws `ProviderError` when SSI is not configured — callers should treat
 * that as "provider unavailable" and fall through to the next source.
 */
export async function getSsiAccessToken(): Promise<string> {
  if (!inflight) {
    inflight = resolveToken().finally(() => {
      inflight = null;
    });
  }
  const token = await inflight;
  return token.accessToken;
}

/** Force the next call to obtain a new token (used by ops probes). */
export async function resetSsiToken(): Promise<void> {
  await sharedCacheSet(TOKEN_CACHE_KEY, null as unknown as SsiToken, 1);
}

export async function ssiAuthStatus(): Promise<{
  configured: boolean;
  tokenCached: boolean;
  expiresAt: number | null;
  msUntilExpiry: number | null;
}> {
  const configured = ssiConfig() !== null;
  const cached = await loadCachedToken();
  return {
    configured,
    tokenCached: Boolean(cached?.accessToken),
    expiresAt: cached?.expiresAt ?? null,
    msUntilExpiry: cached ? cached.expiresAt - Date.now() : null,
  };
}
