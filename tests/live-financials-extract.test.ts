import { describe, expect, it } from "vitest";
import {
  asNumber,
  fiscalPeriod,
  fold,
  INCOME_TARGETS,
  matchLines,
  toBillions,
  toPerShareThousands,
} from "@/lib/connectors/live-financials-client";

/* ------------------------------------------------------------------
 * Sanity of the Vietnamese fold/normalization used for line matching.
 * ------------------------------------------------------------------ */
describe("fold", () => {
  it("strips diacritics and lowercases VAS labels", () => {
    expect(fold("3. Doanh thu thuần về bán hàng và cung cấp dịch vụ")).toBe(
      "3 doanh thu thuan ve ban hang va cung cap dich vu",
    );
    expect(fold("Lợi nhuận sau thuế thu nhập doanh nghiệp")).toContain("loi nhuan sau thue");
    expect(fold("Chí phí hoạt động")).toBe("chi phi hoat dong");
  });

  it("treats 'đ' as 'd'", () => {
    expect(fold("Đầu tư dài hạn")).toBe("dau tu dai han");
  });
});

/* ------------------------------------------------------------------
 * Unit conversion — money in VND → billions; per-share → thousands.
 * ------------------------------------------------------------------ */
describe("unit conversion", () => {
  it("converts VND amounts to billions", () => {
    expect(toBillions(12_000_000_000_000)).toBe(12000);
    expect(toBillions(-500_000_000_000)).toBe(-500);
  });

  it("keeps already-billions values untouched", () => {
    expect(toBillions(1234.5)).toBe(1234.5);
  });

  it("converts per-share VND to thousands", () => {
    expect(toPerShareThousands(12_500)).toBe(12.5);
    expect(toPerShareThousands(-3_000)).toBe(-3);
    expect(toPerShareThousands(1_250)).toBe(1.25);
  });
});

/* ------------------------------------------------------------------
 * fiscalPeriod mapping
 * ------------------------------------------------------------------ */
describe("fiscalPeriod", () => {
  it("maps quarter-end dates to quarter labels", () => {
    expect(fiscalPeriod("2025-03-31", "quarterly")).toEqual({ period: "Q1/2025", fiscalYear: 2025, quarter: 1 });
    expect(fiscalPeriod("2025-06-30", "quarterly")).toEqual({ period: "Q2/2025", fiscalYear: 2025, quarter: 2 });
    expect(fiscalPeriod("2025-09-30", "quarterly")).toEqual({ period: "Q3/2025", fiscalYear: 2025, quarter: 3 });
    expect(fiscalPeriod("2025-12-31", "quarterly")).toEqual({ period: "Q4/2025", fiscalYear: 2025, quarter: 4 });
  });

  it("maps only year-end dates for yearly", () => {
    expect(fiscalPeriod("2025-12-31", "yearly")).toEqual({ period: "FY/2025", fiscalYear: 2025, quarter: 0 });
    expect(fiscalPeriod("2025-06-30", "yearly")).toBeNull();
  });
});

/* ------------------------------------------------------------------
 * Realistic VNDirect-style income statement rows.
 * The itemName labels mirror the official VAS numbering that VNDirect
 * returns; the values are in raw VND. We must extract the headline
 * consolidated rows and avoid the minority-interest / parent sub-lines.
 * ------------------------------------------------------------------ */
const VND_INCOME_ROWS = [
  { name: "1. Doanh thu bán hàng và cung cấp dịch vụ", value: 1_500_000_000_000 },
  { name: "2. Các khoản giảm trừ doanh thu", value: 20_000_000_000 },
  { name: "3. Doanh thu thuần về bán hàng và cung cấp dịch vụ", value: 1_480_000_000_000 },
  { name: "4. Giá vốn hàng bán", value: 900_000_000_000 },
  { name: "5. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ", value: 580_000_000_000 },
  { name: "6. Doanh thu hoạt động tài chính", value: 40_000_000_000 },
  { name: "7. Chi phí tài chính", value: 30_000_000_000 },
  { name: "- Trong đó: Chi phí lãi vay", value: 25_000_000_000 },
  { name: "8. Chi phí bán hàng", value: 90_000_000_000 },
  { name: "9. Chi phí quản lý doanh nghiệp", value: 70_000_000_000 },
  { name: "10. Lợi nhuận thuần từ hoạt động kinh doanh", value: 430_000_000_000 },
  { name: "11. Thu nhập khác", value: 5_000_000_000 },
  { name: "12. Chi phí khác", value: 3_000_000_000 },
  { name: "13. Lợi nhuận khác", value: 2_000_000_000 },
  { name: "14. Tổng lợi nhuận kế toán trước thuế", value: 432_000_000_000 },
  { name: "15. Chi phí thuế TNDN hiện hành", value: 86_000_000_000 },
  { name: "16. Chi phí thuế TNDN hoãn lại", value: 2_000_000_000 },
  { name: "17. Lợi nhuận sau thuế thu nhập doanh nghiệp", value: 344_000_000_000 },
  { name: "18. Lợi nhuận sau thuế của cổ đông không kiểm soát", value: 10_000_000_000 },
  { name: "19. Lợi nhuận sau thuế của công ty mẹ", value: 334_000_000_000 },
  { name: "20. Lãi cơ bản trên cổ phiếu", value: 1_250 },
];

describe("matchLines — VNDirect income", () => {
  it("extracts the headline consolidated income figures (billions)", () => {
    const out = matchLines(VND_INCOME_ROWS, INCOME_TARGETS, new Set(["eps"]));
    expect(out.revenue).toBe(1480);
    expect(out.costOfGoodsSold).toBe(900);
    expect(out.grossProfit).toBe(580);
    expect(out.operatingExpenses).toBe(160); // 90 (bán hàng) + 70 (quản lý)
    expect(out.operatingIncome).toBe(430);
    expect(out.interestExpense).toBe(25);
    expect(out.otherIncome).toBe(5); // Thu nhập khác
    expect(out.pretaxIncome).toBe(432);
    expect(out.incomeTax).toBe(86); // hiện hành, NOT hoãn lại (excluded)
    expect(out.netIncome).toBe(344); // headline, NOT minority/parent
    expect(out.eps).toBe(1.25); // 1,250 VND → 1.25 nghìn VND
  });

  it("never mixes minority / parent rows into netIncome", () => {
    const out = matchLines(VND_INCOME_ROWS, INCOME_TARGETS, new Set(["eps"]));
    expect(out.netIncome).not.toBe(10);
    expect(out.netIncome).not.toBe(334);
  });
});

/* ------------------------------------------------------------------
 * asNumber robustness
 * ------------------------------------------------------------------ */
describe("asNumber", () => {
  it("parses comma-grouped strings and numbers", () => {
    expect(asNumber("1,234,567")).toBe(1234567);
    expect(asNumber(-42)).toBe(-42);
    expect(asNumber("abc")).toBeNull();
    expect(asNumber(null)).toBeNull();
  });
});
