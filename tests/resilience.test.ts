import { afterEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker, ProviderError, cachedWithStaleFallback, fetchWithRetry } from "@/lib/connectors/core";
import { withDeadline } from "@/lib/market";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CircuitBreaker", () => {
  it("opens after consecutive failures and rejects calls without touching the provider", async () => {
    const breaker = new CircuitBreaker("test-provider", 2, 1_000);
    const provider = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(breaker.exec(provider)).rejects.toThrow("network down");
    await expect(breaker.exec(provider)).rejects.toThrow("network down");
    await expect(breaker.exec(provider)).rejects.toMatchObject({ meta: { state: "open" } });

    expect(provider).toHaveBeenCalledTimes(2);
    expect(breaker.status().state).toBe("open");
  });

  it("allows one half-open probe and reopens cooldown after a failed probe", async () => {
    const breaker = new CircuitBreaker("half-open-provider", 1, 20);
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(breaker.exec(failing)).rejects.toThrow("offline");
    await new Promise((resolve) => setTimeout(resolve, 25));

    let rejectProbe!: (error: Error) => void;
    const probe = breaker.exec(() => new Promise<void>((_, reject) => { rejectProbe = reject; }));
    await expect(breaker.exec(async () => undefined)).rejects.toMatchObject({ meta: { state: "half-open" } });
    rejectProbe(new Error("still offline"));
    await expect(probe).rejects.toThrow("still offline");
    expect(breaker.status().state).toBe("open");
  });
});

describe("provider timeout isolation", () => {
  it("aborts a slow provider at the configured timeout while another provider can succeed", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("slow")) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const [slow, healthy] = await Promise.allSettled([
      fetchWithRetry("https://slow.example", { provider: "slow", timeoutMs: 250, retries: 0 }),
      fetchWithRetry("https://healthy.example", { provider: "healthy", timeoutMs: 500, retries: 0 }),
    ]);

    expect(slow.status).toBe("rejected");
    expect(healthy.status).toBe("fulfilled");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("deadline and stale cache", () => {
  it("returns fallback on deadline without waiting for the slow dependency", async () => {
    const started = Date.now();
    const result = await withDeadline(new Promise<string>(() => undefined), 25, "stale", "test-dependency");

    expect(result).toBe("stale");
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("serves stale data and single-flights a failed background refresh", async () => {
    const key = `test:stale:${Date.now()}`;
    let loads = 0;
    const first = await cachedWithStaleFallback(key, 20, async () => {
      loads += 1;
      return { value: "fresh" };
    });
    expect(first).toEqual({ value: { value: "fresh" }, stale: false });

    await new Promise((resolve) => setTimeout(resolve, 250));
    const refresh = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("upstream timeout")), 20));
    const loader = vi.fn(async () => {
      loads += 1;
      return refresh;
    });

    const [a, b] = await Promise.all([
      cachedWithStaleFallback(key, 20, loader),
      cachedWithStaleFallback(key, 20, loader),
    ]);

    expect(a).toEqual({ value: { value: "fresh" }, stale: true });
    expect(b).toEqual({ value: { value: "fresh" }, stale: true });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loads).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

it("keeps ProviderError metadata available for degraded callers", () => {
  const error = new ProviderError("test", "degraded", { state: "open" });
  expect(error).toMatchObject({ provider: "test", meta: { state: "open" } });
});

describe("overview module isolation", () => {
  it("keeps healthy quote data when auxiliary crypto and news modules fail", async () => {
    const quoteModule = Promise.resolve({ status: "fresh", symbols: ["VIC", "HPG"] });
    const cryptoModule = withDeadline(
      new Promise<{ status: string }>(() => undefined),
      25,
      { status: "stale" },
      "crypto",
    );
    const newsModule = withDeadline(
      Promise.reject(new Error("RSS unavailable")).catch(() => ({ status: "unavailable" })),
      25,
      { status: "unavailable" },
      "news",
    );

    const [quotes, crypto, news] = await Promise.all([quoteModule, cryptoModule, newsModule]);

    expect(quotes).toEqual({ status: "fresh", symbols: ["VIC", "HPG"] });
    expect(crypto).toEqual({ status: "stale" });
    expect(news).toEqual({ status: "unavailable" });
  });
});
