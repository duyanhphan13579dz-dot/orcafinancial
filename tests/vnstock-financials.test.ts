import { describe, expect, it } from "vitest";
import { __internals } from "@/lib/connectors/vnstock-financials";
import { matchLines } from "@/lib/connectors/live-financials-client";

/**
 * vnstock (vnstocks.com free tier) financial connector tests.
 *
 * The sandbox host has no outbound internet, so these use fixtures that mirror
 * the exact response contract of the VCI (Vietcap IQ) and KBS broker feeds that
 * the `vnstock` Python library calls. The point is to validate the *parsing* of
 * those feeds into the app's canonical financial fields — the same thing vnstock
 * computes — without relying on live network access.
 */

const { vciPeriodLabel, buildLinesFromRow, kbsPeriodLabels, splitPeriod, maxPeriods } = __internals;

/* ────────────────────────────────────────────────────────────
 * VCI response contract — mirrors `iq.vietcap.com.vn/.../financial-statement`
 * and its `/metrics` companion. `lengthReport: 5` = full year; 1..4 = quarter.
 * Field values are raw VND.
 * ──────────────────────────────────────────────────────────── */

const VCI_METRICS = [
  { field: "isa16", titleEn: "Net interest income", titleVi: "Thu nhập lãi thuần", parent: null, level: 1 },
  { field: "isa20", titleEn: "Net income", titleVi: "Lợi nhuận sau thuế", parent: null, level: 1 },
  { field: "isb25", titleEn: "Operating income", titleVi: "Lợi nhuận thuần từ HĐKD", parent: null, level: 1 },
  { field: "bsa53", titleEn: "TOTAL ASSETS", titleVi: "TỔNG TÀI SẢN", parent: null, level: 1 },
  { field: "bsb103", titleEn: "Loans and advances to customers, net", titleVi: "Cho vay khách hàng", parent: null, level: 1 },
  { field: "bsa78", titleEn: "Equity", titleVi: "Vốn chủ sở hữu", parent: null, level: 1 },
  { field: "bsa96", titleEn: "Total liabilities", titleVi: "Tổng nợ phải trả", parent: null, level: 1 },
  { field: "bsa2", titleEn: "Cash and precious metals", titleVi: "Tiền mặt, vàng bạc, đá quý", parent: null, level: 1 },
  { field: "osa1", titleEn: "Operating cash flow", titleVi: "Lưu chuyển tiền thuần từ HĐKD", parent: null, level: 1 },
];

// One full-year row (ACB-like). lengthReport=5 means FY.
const VCI_YEAR_ROW = {
  organCode: "ACB",
  ticker: "ACB",
  yearReport: 2020,
  lengthReport: 5,
  publicDate: "2021-02-26T00:00:00",
  isa16: 9.595888e12, // net interest income (~thu nhập lãi thuần)
  isb25: 1.8161309e13, // operating income
  isa20: 7.682823e12, // net income
  bsa53: 3.83514439e14, // total assets
  bsb103: 2.66164852e14, // loans
  bsa78: 3.08129391e14, // equity
  bsa96: 7.5385048e13, // total liabilities
  bsa2: 6.437812e12, // cash
  osa1: 1.5e12, // operating cash flow
};

// One quarter row (Q1/2021).
const VCI_QUARTER_ROW = {
  organCode: "ACB",
  ticker: "ACB",
  yearReport: 2021,
  lengthReport: 1,
  isa20: 1.2e12,
  bsa53: 3.9e14,
};

describe("vnstock VCI period labels", () => {
  it("maps lengthReport=5 to a full year FY period", () => {
    expect(vciPeriodLabel(VCI_YEAR_ROW)).toEqual({ period: "FY/2020", fiscalYear: 2020, quarter: 0 });
  });

  it("maps lengthReport=1..4 to quarterly periods", () => {
    expect(vciPeriodLabel(VCI_QUARTER_ROW)).toEqual({ period: "Q1/2021", fiscalYear: 2021, quarter: 1 });
  });

  it("rejects rows without a valid year", () => {
    expect(vciPeriodLabel({ lengthReport: 5 } as never)).toBeNull();
  });
});

describe("vnstock field-code decoding", () => {
  it("decodes coded columns into named lines using the metrics map", () => {
    const metricMap = new Map(VCI_METRICS.map((m) => [m.field, m]));
    const lines = buildLinesFromRow(VCI_YEAR_ROW, metricMap);
    // Only fields that exist in the metrics map produce lines.
    const totalAssets = lines.find((l) => l.name.includes("tong tai san"));
    expect(totalAssets).toBeDefined();
    expect(totalAssets!.value).toBeCloseTo(3.83514439e14);
    // Coded columns without a metrics entry (e.g. sa2) are skipped.
    expect(lines.some((l) => l.name.includes("sa1"))).toBe(false);
  });
});

describe("vnstock matches canonical financial fields (VCI feed)", () => {
  it("extracts income/balance fields that the app's health scoring relies on", () => {
    const metricMap = new Map(VCI_METRICS.map((m) => [m.field, m]));
    const lines = buildLinesFromRow(VCI_YEAR_ROW, metricMap);
    const targets = {
      income: [
        ["netIncome", ["loi nhuan sau thue"], "single"],
        ["operatingIncome", ["loi nhuan thuan tu hoat dong kinh doanh"], "single"],
      ] as const,
      balance: [
        ["totalAssets", ["tong tai san"], "single"],
        ["equity", ["von chu so huu"], "single"],
        ["totalLiabilities", ["tong no phai tra"], "single"],
        ["cashAndEquivalents", ["tien mat"], "single"],
      ] as const,
    };
    const perShare = new Set<string>();
    const income = matchLines(lines, targets.income as never, perShare);
    expect(income.netIncome).toBeGreaterThan(0);
    expect(income.operatingIncome).toBeGreaterThan(0);

    const balance = matchLines(lines, targets.balance as never, perShare);
    expect(balance.totalAssets).toBeCloseTo(3.83514439e14 / 1e9); // toBillions
    expect(balance.equity).toBeCloseTo(3.08129391e14 / 1e9);
    expect(balance.totalLiabilities).toBeCloseTo(7.5385048e13 / 1e9);
  });
});

describe("vnstock KBS period labels", () => {
  it("parses Head entries into FY / quarter labels keyed by ID order", () => {
    const head = [
      { ID: 1, YearPeriod: "2020", TermName: "Năm 2020", AuditedStatus: 1, United: 1 },
      { ID: 2, YearPeriod: "2019", TermName: "Năm 2019", AuditedStatus: 1, United: 1 },
    ];
    const labels = kbsPeriodLabels(head);
    expect(labels[0]).toEqual({ label: "FY/2020", iso: "2020-FY" });
    expect(labels[1]).toEqual({ label: "FY/2019", iso: "2019-FY" });
  });

  it("handles Vietnamese quarter names", () => {
    const head = [
      { ID: 1, YearPeriod: "2021", TermName: "Quý 1", AuditedStatus: 1, United: 1 },
      { ID: 2, YearPeriod: "2021", TermName: "Quý 2", AuditedStatus: 1, United: 1 },
    ];
    const labels = kbsPeriodLabels(head);
    expect(labels[0].label).toBe("Q1/2021");
    expect(labels[1].label).toBe("Q2/2021");
  });
});

describe("vnstock helpers", () => {
  it("splits period labels", () => {
    expect(splitPeriod("Q1/2021")).toEqual(["Q1/2021", 2021]);
    expect(splitPeriod("FY/2020")).toEqual(["FY/2020", 2020]);
  });

  it("caps periods by tier (Community/free = 8, Guest = 4)", () => {
    expect(maxPeriods()).toBeGreaterThanOrEqual(4);
  });
});
