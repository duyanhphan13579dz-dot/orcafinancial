import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connectors/providers", () => ({
  vndirectHistory: vi.fn(async () => [
    { time: 1, open: 99, high: 101, low: 98, close: 100, volume: 5 },
    { time: 2, open: 100, high: 112, low: 99, close: 110, volume: 6 },
  ]),
}));

import { freshIndexQuotes } from "@/lib/index-quotes";
import { vndirectHistory } from "@/lib/connectors/providers";

describe("freshIndexQuotes — nguồn duy nhất cho chỉ số", () => {
  it("maps the latest daily bar with changePct vs prev close", async () => {
    const quotes = await freshIndexQuotes(["VNINDEX"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].symbol).toBe("VNINDEX");
    expect(quotes[0].close).toBe(110);
    expect(quotes[0].prevClose).toBe(100);
    expect(quotes[0].changePct).toBeCloseTo(10, 5);
    expect(quotes[0].source).toBe("vndirect-dchart");
  });

  it("caches for 60s so every consumer reads the same number", async () => {
    const before = vi.mocked(vndirectHistory).mock.calls.length;
    await freshIndexQuotes(["VNINDEX"]);
    await freshIndexQuotes(["VNINDEX"]);
    expect(vi.mocked(vndirectHistory).mock.calls.length).toBe(before);
  });

  it("ignores non-index codes", async () => {
    expect(await freshIndexQuotes(["VNM"])).toHaveLength(0);
  });
});
