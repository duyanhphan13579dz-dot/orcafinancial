import { createHash } from "crypto";
import { sharedCacheGet, sharedCacheSet } from "@/lib/connectors/redis-cache";
import { logger } from "@/lib/logger";

/**
 * Agent answer cache (Redis L2 + memory L1).
 * - Identical market questions within TTL skip GLM (sub-second warm).
 * - Personal / wealth personalized answers are NOT cached (user-specific).
 */

export type CachedAgentAnswer = {
  answer: string;
  model: string;
  intent: string;
  symbols: string[];
  cachedAt: number;
};

const DEFAULT_TTL_MS = Number(process.env.AGENT_RESPONSE_TTL_MS) || 180_000; // 3 min
const inflight = new Map<string, Promise<CachedAgentAnswer | null>>();

function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function agentCacheKey(message: string, symbols: string[] = []): string {
  const base = normalizeQuestion(message);
  const sym = [...symbols].map((s) => s.toUpperCase()).sort().join(",");
  const raw = `${base}|${sym}`;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
  return `agent:ans:v1:${hash}`;
}

/** Skip cache for user-specific / money-number questions. */
export function shouldCacheAgentAnswer(
  intent: string,
  personalized: boolean,
  message: string,
): boolean {
  if (personalized) return false;
  if (intent === "personal_finance" || intent === "wealth" || intent === "corporate_finance") {
    // Allow cache only if no money figures (generic how-to)
    if (/(?:\d+(?:[.,]\d+)?)\s*(?:k|nghìn|triệu|tr|tỷ|tỉ|đ|vnđ|vnd|\$)/i.test(message)) {
      return false;
    }
  }
  return true;
}

export async function getCachedAgentAnswer(
  message: string,
  symbols: string[] = [],
): Promise<CachedAgentAnswer | null> {
  const key = agentCacheKey(message, symbols);
  try {
    const hit = await sharedCacheGet<CachedAgentAnswer>(key);
    if (hit?.answer) {
      logger.info("agent_cache_hit", { key, ageMs: Date.now() - (hit.cachedAt || 0) });
      return hit;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function setCachedAgentAnswer(
  message: string,
  symbols: string[],
  payload: Omit<CachedAgentAnswer, "cachedAt">,
  ttlMs = DEFAULT_TTL_MS,
): Promise<void> {
  const key = agentCacheKey(message, symbols);
  const value: CachedAgentAnswer = { ...payload, cachedAt: Date.now() };
  try {
    await sharedCacheSet(key, value, ttlMs);
    logger.info("agent_cache_set", { key, ttlMs, model: payload.model });
  } catch (err) {
    logger.warn("agent_cache_set_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Single-flight: concurrent identical questions share one LLM call.
 */
export async function withAgentSingleFlight(
  message: string,
  symbols: string[],
  factory: () => Promise<CachedAgentAnswer>,
): Promise<CachedAgentAnswer> {
  const key = agentCacheKey(message, symbols);
  const existing = inflight.get(key);
  if (existing) {
    const shared = await existing;
    if (shared) return shared;
  }

  const p = (async () => {
    try {
      return await factory();
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}
