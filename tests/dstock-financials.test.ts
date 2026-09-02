import { describe, expect, it } from "vitest";
import {
  buildPeriods,
  parseRows,
  pickFreeCashFlow,
} from "@/lib/dstock-financials";

describe("dstock parseRows", () => {
  it("parses a finfo-api payload into rows and skips malformed hits", () => {
    const payload = {
      data: {
        hits: [
          { _source: { fiscalDate: "2026-06-30", itemName: "1. Doanh thu thuần", itemCode: "01", numericValue: 1480_000_000_000 } },
          { _source: { fiscalDate: "2026-06-30", itemName: "2. Giá vốn hàng bán", itemCode: "02", numericValue: 1230_000_000_000 } },
          { _source: { fiscalDate: "2026-06-30", itemName: "3. Lợi nhuận gộp", itemCode: "03", numericValue: null } },
          { _source: { fiscalDate: "", itemName: "drop me", itemCode: "x", numericValue: 1 } },
          { mystery: true },
        ],
      },
    };
    const rows = parseRows(payload);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ fiscalDate: "2026-06-30", itemName: "1. Doanh thu thuần", itemCode: "01", numericValue: 1480_000_000_000 });
    expect(rows[1].numericValue).toBe(1230_000_000_000);
    expect(rows[2].numericValue).toBeNull();
  });

  it("returns [] for a payload with no hits", () => {
    expect(parseRows({ data: {} })).toEqual([]);
    expect(parseRows({})).toEqual([]);
    expect(parseRows(null)).toEqual([]);
  });
});

describe("dstock pickFreeCashFlow", () => {
  it("falls back to OCF + investing when capex not reported", () => {
    expect(pickFreeCashFlow({ operatingCashFlow: 500, investingCashFlow: -200 })).toBe(300);
  });

  it("uses OCF - capex when capex is reported and no investing summary", () => {
    expect(pickFreeCashFlow({ operatingCashFlow: 500, capex: 120 })).toBe(380);
  });

  it("returns null when operatingCashFlow is missing", () => {
    expect(pickFreeCashFlow({ investingCashFlow: -200 })).toBeNull();
    expect(pickFreeCashFlow({})).toBeNull();
  });
});

describe("dstock buildPeriods", () => {
  it("composes income+balance+cashflow into quarterly periods, sorted newest first", () => {
    const income = new Map<string, Record<string, number>>([
      ["2026-06-30", { revenue: 1480, netIncome: 180, eps: 2.5 }],
      ["2025-12-31", { revenue: 3000, netIncome: 220, eps: 3.1 }],
    ]);
    const balance = new Map<string, Record<string, number>>([
      ["2026-06-30", { totalAssets: 12000, equity: 8000, totalLiabilities: 4000 }],
      ["2025-12-31", { totalAssets: 11000, equity: 7800, totalLiabilities: 3200 }],
    ]);
    const cashflow = new Map<string, Record<string, number>>([
      ["2026-06-30", { operatingCashFlow: 400, investingCashFlow: -100, netChangeCash: 200 }],
      ["2025-12-31", { operatingCashFlow: 600, capex: 150, netChangeCash: 300 }],
    ]);

    const { periods, fields } = buildPeriods(income, balance, cashflow, "quarterly", "income", 8);
    expect(periods).toHaveLength(2);
    expect(periods[0].period).toBe("Q2/2026");
    expect(periods[0].fiscalYear).toBe(2026);
    expect(periods[0].quarter).toBe(2);
    expect(periods[0].data.revenue).toBe(1480);
    expect(periods[0].data.totalAssets).toBe(12000);
    expect(periods[0].data.operatingCashFlow).toBe(400);
    // 2026-06-30 has no capex -> free cash flow = OCF + investing
    expect(periods[0].data.freeCashFlow).toBe(300);
    // 2025-12-31 has capex -> free cash flow = OCF - capex
    expect(periods[1].data.freeCashFlow).toBe(450);
    expect(periods[1].period).toBe("Q4/2025");

    // netIncome is present in both so it should be a listed field
    expect(fields).toContain("revenue");
    expect(fields).toContain("netIncome");
  });

  it("keeps only year-end quarters for yearly view and sorts newest first", () => {
    const income = new Map<string, Record<string, number>>([
      ["2026-03-31", { revenue: 700 }],
      ["2025-12-31", { revenue: 3000, netIncome: 220 }],
      ["2024-12-31", { revenue: 2800, netIncome: 200 }],
    ]);
    const { periods } = buildPeriods(income, new Map(), new Map(), "yearly", "income", 8);
    expect(periods.map((p) => p.period)).toEqual(["FY/2025", "FY/2024"]);
  });

  it("respects the limit and strips all-zero periods", () => {
    const income = new Map<string, Record<string, number>>([
      ["2026-06-30", { revenue: 0 }],
      ["2026-03-31", { revenue: 500 }],
      ["2025-12-31", { revenue: 3000 }],
    ]);
    const { periods } = buildPeriods(income, new Map(), new Map(), "quarterly", "income", 1);
    // The all-zero Q2 is dropped; only the newest non-zero period remains.
    expect(periods).toHaveLength(1);
    expect(periods[0].period).toBe("Q1/2026");
  });
});
