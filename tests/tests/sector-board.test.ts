import { describe, expect, it } from "vitest";
import { SECTOR_DEFINITIONS } from "@/types/market";

describe("sector board universe", () => {
  it("contains an expanded set of sectors with at least six stocks per sector", () => {
    expect(SECTOR_DEFINITIONS.length).toBeGreaterThanOrEqual(10);

    for (const sector of SECTOR_DEFINITIONS) {
      expect(sector.symbols.length, `${sector.id} should have at least six symbols`).toBeGreaterThanOrEqual(6);
      expect(new Set(sector.symbols).size, `${sector.id} should not duplicate symbols`).toBe(sector.symbols.length);
    }
  });
});
