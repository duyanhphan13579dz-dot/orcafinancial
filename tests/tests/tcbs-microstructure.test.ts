import { describe, expect, it } from "vitest";
import { tcbsMockMicrostructure } from "@/lib/connectors/tcbs-microstructure";

describe("TCBS microstructure mock", () => {
  it("returns deterministic five-level order book and foreign flow", () => {
    const first = tcbsMockMicrostructure("FPT", 142.3, 1_700_000_000);
    const second = tcbsMockMicrostructure("FPT", 142.3, 1_700_000_000);
    expect(first).toEqual(second);
    expect(first.orderBook.bids).toHaveLength(5);
    expect(first.orderBook.asks).toHaveLength(5);
    expect(first.orderBook.source).toBe("tcbs-market-data-mock");
    expect(first.foreignFlow.netValue).toBeCloseTo(
      (first.foreignFlow.buyValue ?? 0) - (first.foreignFlow.sellValue ?? 0),
      2,
    );
  });

  it("keeps asks above bids and exposes development confidence", () => {
    const snapshot = tcbsMockMicrostructure("VCB", 92.1, 1_700_000_000);
    expect(snapshot.orderBook.asks[0].price).toBeGreaterThan(snapshot.orderBook.bids[0].price);
    expect(snapshot.orderBook.confidence).toBeLessThan(0.5);
    expect(snapshot.foreignFlow.buyValue).toBeGreaterThan(0);
    expect(snapshot.foreignFlow.sellValue).toBeGreaterThan(0);
  });
});
