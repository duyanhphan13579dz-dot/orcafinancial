import { afterEach, describe, expect, it, vi } from "vitest";
import { pingDb, waitForDatabaseReady } from "@/db";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("database outage boundary", () => {
  it.skipIf(Boolean(process.env.DATABASE_URL))("fails fast when DATABASE_URL is missing", async () => {
    const started = Date.now();
    const result = await pingDb({ attempts: 3, timeoutMs: 8_000 });

    expect(result).toEqual({ ok: false, latencyMs: 0, error: "DATABASE_URL_missing", attempts: 0 });
    expect(Date.now() - started).toBeLessThan(100);
    await expect(waitForDatabaseReady()).resolves.toBe(false);
  });
});

describe("Redis outage boundary", () => {
  it("falls back to local L1 cache when Redis is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const key = `test:redis-outage:${Date.now()}`;
    let loads = 0;

    const first = await sharedCacheGetOrSet(key, 1_000, async () => {
      loads += 1;
      return { source: "local-fallback" };
    });
    const second = await sharedCacheGetOrSet(key, 1_000, async () => {
      loads += 1;
      return { source: "should-not-load" };
    });

    expect(first.value).toEqual({ source: "local-fallback" });
    expect(second.value).toEqual({ source: "local-fallback" });
    expect(first.hit).toBe("miss");
    expect(second.hit).toBe("l1");
    expect(loads).toBe(1);
  });
});
