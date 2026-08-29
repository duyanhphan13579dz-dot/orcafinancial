import { describe, expect, it } from "vitest";
import {
  filterRealtimeDataUpToCutoff,
  getRealtimeContext,
  isFuturePeriod,
} from "@/lib/realtime-time";

describe("Realtime Time Engine", () => {
  it("correctly breaks down current date parts into year, quarter, month, day, hour, minute, second", () => {
    // Test date: August 29, 2026 14:30:45 UTC
    const date = new Date("2026-08-29T14:30:45.000Z");
    const ctx = getRealtimeContext(date);

    expect(ctx.year).toBe(2026);
    expect(ctx.month).toBe(8);
    expect(ctx.day).toBe(29);
    expect(ctx.hour).toBe(14);
    expect(ctx.minute).toBe(30);
    expect(ctx.second).toBe(45);
    expect(ctx.quarter).toBe(3); // August = Month 8 = Q3
    expect(ctx.currentQuarterPeriod).toBe("Q3/2026");
    expect(ctx.latestCompletedPeriod).toBe("Q2/2026");
    expect(ctx.latestCompletedQuarter).toEqual({ fiscalYear: 2026, quarter: 2 });
  });

  it("calculates latest completed quarter correctly across different months", () => {
    // Q1 (Jan 15): latest completed is Q4 of previous year
    const janDate = new Date("2026-01-15T10:00:00.000Z");
    const janCtx = getRealtimeContext(janDate);
    expect(janCtx.quarter).toBe(1);
    expect(janCtx.latestCompletedQuarter).toEqual({ fiscalYear: 2025, quarter: 4 });

    // Q2 (May 10): latest completed is Q1 of current year
    const mayDate = new Date("2026-05-10T10:00:00.000Z");
    const mayCtx = getRealtimeContext(mayDate);
    expect(mayCtx.quarter).toBe(2);
    expect(mayCtx.latestCompletedQuarter).toEqual({ fiscalYear: 2026, quarter: 1 });

    // Q4 (Nov 20): latest completed is Q3 of current year
    const novDate = new Date("2026-11-20T10:00:00.000Z");
    const novCtx = getRealtimeContext(novDate);
    expect(novCtx.quarter).toBe(4);
    expect(novCtx.latestCompletedQuarter).toEqual({ fiscalYear: 2026, quarter: 3 });
  });

  it("accurately identifies future vs past/completed periods", () => {
    // Cutoff date: Aug 29, 2026 (latest completed is Q2/2026)
    const asOf = new Date("2026-08-29T00:00:00.000Z");

    // Past completed periods
    expect(isFuturePeriod("Q1/2026", 2026, asOf)).toBe(false);
    expect(isFuturePeriod("Q2/2026", 2026, asOf)).toBe(false);
    expect(isFuturePeriod("Q4/2025", 2025, asOf)).toBe(false);

    // In-progress or future periods
    expect(isFuturePeriod("Q3/2026", 2026, asOf)).toBe(true);
    expect(isFuturePeriod("Q4/2026", 2026, asOf)).toBe(true);
    expect(isFuturePeriod("Q1/2027", 2027, asOf)).toBe(true);
  });

  it("filters realtime data stream up to exact cutoff timestamp", () => {
    const cutoff = new Date("2026-08-29T12:00:00.000Z");

    const data = [
      { id: 1, timestamp: "2026-08-29T10:00:00.000Z" },
      { id: 2, timestamp: "2026-08-29T11:59:59.000Z" },
      { id: 3, timestamp: "2026-08-29T12:00:00.000Z" },
      { id: 4, timestamp: "2026-08-29T12:00:01.000Z" }, // Future relative to cutoff
      { id: 5, timestamp: "2026-08-29T14:00:00.000Z" }, // Future relative to cutoff
    ];

    const filtered = filterRealtimeDataUpToCutoff(data, (item) => item.timestamp, cutoff);
    expect(filtered.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("ensures quarterly financial generation starts at exact latest completed quarter (Q2/2026 as of Aug 30, 2026)", async () => {
    const { generateQuarterlyFinancials } = await import("@/lib/financial-statements");
    const fakeBars = Array.from({ length: 100 }, (_, i) => ({
      time: 1700000000 + i * 86400,
      open: 50,
      high: 52,
      low: 49,
      close: 51,
      volume: 1000000,
    }));

    const quarters = generateQuarterlyFinancials("VNM", fakeBars, 4);
    expect(quarters.length).toBe(4);
    expect(quarters[0].period).toBe("Q2/2026");
    expect(quarters[0].fiscalYear).toBe(2026);
    expect(quarters[0].quarter).toBe(2);
    expect(quarters[1].period).toBe("Q1/2026");
    expect(quarters[2].period).toBe("Q4/2025");
    expect(quarters[3].period).toBe("Q3/2025");
  });
});
