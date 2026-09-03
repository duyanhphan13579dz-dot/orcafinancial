import { describe, expect, it } from "vitest";
import { generateFundamentalReport } from "@/lib/fundamental";
import type { Ohlcv } from "@/lib/connectors/core";

function makeBars(n: number): Ohlcv[] {
  const bars: Ohlcv[] = [];
  let price = 50;
  for (let i = 0; i < n; i += 1) {
    price = Math.max(10, price + Math.sin(i / 21) * 0.6 + 0.01);
    bars.push({
      time: 1_600_000_000 + i * 86400,
      open: price - 0.2,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 1_000_000 + i,
    });
  }
  return bars;
}

describe("ROADMAP G2/G3 — legacy fallback không còn proxy giá", () => {
  it("không có BCTC → EPS/P/E/P/B/DCF/DDM/Graham/null, health UNAVAILABLE", () => {
    const report = generateFundamentalReport("VNM", makeBars(900));
    expect(report.eps).toBeNull();
    expect(report.roe).toBeNull();
    expect(report.roa).toBeNull();
    expect(report.cagr3y).toBeNull();
    expect(report.dupont).toBeNull();

    expect(report.valuation.pe).toBeNull();
    expect(report.valuation.pb).toBeNull();
    expect(report.valuation.dcf).toBeNull();
    expect(report.valuation.ddm).toBeNull();
    expect(report.valuation.grahamNumber).toBeNull();
    expect(report.valuation.intrinsicValueRange).toBeNull();
    expect(report.valuation.sensitivity).toHaveLength(0);
    expect(report.valuation.verdictVi).toContain("Không đủ dữ liệu");

    expect(report.financialHealth.rating).toBe("UNAVAILABLE");
    expect(report.financialHealth.indicators.roe).toBeNull();
  });

  it("disclaimer nêu rõ không proxy từ giá", () => {
    const report = generateFundamentalReport("VNM", makeBars(900));
    expect(report.disclaimer).toContain("null/unavailable");
    expect(report.dataSource).toContain("không proxy từ giá");
  });
});
