import { describe, expect, it } from "vitest";
import { isDepthEventContiguous } from "./binance-orderbook-sequence";

describe("Binance depth sequence protocol", () => {
  it("accepts the first event that bridges the REST snapshot", () => {
    expect(isDepthEventContiguous(100, { U: 99, u: 105 })).toBe(true);
  });

  it("accepts an overlapping contiguous event", () => {
    expect(isDepthEventContiguous(105, { U: 103, u: 110 })).toBe(true);
  });

  it("ignores events already covered by the local book", () => {
    expect(isDepthEventContiguous(110, { U: 100, u: 110 })).toBe(true);
  });

  it("rejects a forward gap that requires resync", () => {
    expect(isDepthEventContiguous(110, { U: 112, u: 115 })).toBe(false);
  });
});
