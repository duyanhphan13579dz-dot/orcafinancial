import { describe, expect, it } from "vitest";
import { arr2mi } from "@/lib/connectors/vndirect-realtime-index";

// Reference layout (VNDIRECT/price-feed parser.py `arr2mi`):
// [marketID, totalTrade, totalShareTraded, totalValueTraded,
//  advance, decline, noChange, indexValue, changed, tradingTime,
//  tradingDate, floorCode, marketIndex, priorMarketIndex,
//  highestIndex, lowestIndex, shareTraded, status, sequence,
//  predictionMarketIndex]
const MI_VNINDEX = [
  "10", 12234, 512345678, 11_222_045_000_000,
  342, 198, 61, 1832.4, 0.56, "14:59:30",
  "2026-09-02", "HOSE", "VNINDEX", 1831.84,
  1833.27, 1819.16, 543_900_000, "NORMAL", 123456, 1835.1,
];

describe("VNDirect realtime index arr2mi", () => {
  it("parses a VNINDEX MI message into its indexed fields", () => {
    const row = arr2mi(MI_VNINDEX);
    expect(row).not.toBeNull();
    expect(row!.marketID).toBe("10");
    expect(row!.indexValue).toBe(1832.4);
    expect(row!.changed).toBe(0.56);
    expect(row!.priorMarketIndex).toBe(1831.84);
    expect(row!.highestIndex).toBe(1833.27);
    expect(row!.lowestIndex).toBe(1819.16);
    expect(row!.shareTraded).toBe(543_900_000);
    expect(row!.totalValueTraded).toBe(11_222_045_000_000);
    expect(row!.advance).toBe(342);
    expect(row!.decline).toBe(198);
    expect(row!.noChange).toBe(61);
    expect(row!.tradingDate).toBe("2026-09-02");
  });

  it("returns null for a market ID with no value or too short an array", () => {
    expect(arr2mi([])).toBeNull();
    expect(arr2mi(["10", 1, 2])).toBeNull();
    // Empty marketID is dropped.
    expect(arr2mi([null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])).toBeNull();
  });

  it("coerces numeric strings and tolerates null money/volume fields", () => {
    const row = arr2mi([
      "02", "100", "200", "300",
      "10", "20", "5", "271.25", "1.1", "14:30:00",
      "2026-09-02", "HNX", "HNXINDEX", "270.15",
      "272.5", "269.53", "50000000", "NORMAL", "7", "272",
    ]);
    expect(row).not.toBeNull();
    expect(row!.marketID).toBe("02");
    expect(row!.indexValue).toBe(271.25);
    expect(row!.changed).toBe(1.1);
    expect(row!.shareTraded).toBe(50_000_000);
  });
});
