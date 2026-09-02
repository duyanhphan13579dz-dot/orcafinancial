/**
 * Kiểm chứng bộ đọc CSV CafeF.
 *
 * CSV dưới đây mô phỏng đúng dạng CafeF xuất: nhãn tiếng Việt có đánh số mục
 * ở cột đầu, các kỳ báo cáo ở các cột sau, đơn vị "tỷ đồng" ở dòng đầu, và
 * số viết theo kiểu Việt Nam (dấu chấm phân cách hàng nghìn).
 */
import { describe, expect, it } from "vitest";
import { parseCafefCsv, parseNumericCell } from "@/lib/cafef-csv";
import { buildFundamentalContext } from "@/lib/fundamental-engine";
import { computeFundamentalAnalytics } from "@/lib/fundamental-analytics-service";
import type { FundamentalInputs } from "@/lib/fundamental-analytics-service";

/** Số RIÊNG từng quý (không luỹ kế) — có tính mùa vụ, Q4 đỉnh Q3 trũng. */
const STANDALONE_CSV = `Báo cáo tài chính - CTCP Sữa Việt Nam
Đơn vị tính: tỷ đồng
Chỉ tiêu	Q4/2025	Q3/2025	Q2/2025	Q1/2025
1. Doanh thu thuần	13.240	10.710	11.580	10.640
2. Giá vốn hàng bán	8.315	6.726	7.272	6.682
3. Lợi nhuận gộp	4.925	3.984	4.308	3.958
4. Chi phí bán hàng	1.520	1.240	1.330	1.225
5. Chi phí quản lý doanh nghiệp	612	498	540	505
6. Lợi nhuận thuần từ hoạt động kinh doanh	2.793	2.246	2.438	2.228
7. Chi phí lãi vay	168	136	147	135
8. Tổng lợi nhuận kế toán trước thuế	2.683	2.158	2.341	2.136
9. Chi phí thuế TNDN hiện hành	537	432	468	427
10. Lợi nhuận sau thuế thu nhập doanh nghiệp	2.146	1.726	1.873	1.709
11. Lãi cơ bản trên cổ phiếu	4.318	3.472	3.768	3.438
TÀI SẢN
Tiền và các khoản tương đương tiền	1.205	975	1.054	968
Đầu tư tài chính ngắn hạn	278	225	243	223
Các khoản phải thu ngắn hạn	2.317	1.874	2.027	1.862
Hàng tồn kho	2.145	1.735	1.876	1.724
Tài sản ngắn hạn	7.145	5.808	6.200	5.777
Tài sản cố định	25.421	20.563	22.234	20.429
TỔNG CỘNG TÀI SẢN	35.086	28.381	30.687	28.196
NỢ PHẢI TRẢ	15.859	12.828	13.871	12.745
Nợ ngắn hạn	4.763	3.854	4.148	3.824
Vay và nợ thuê tài chính ngắn hạn	1.986	1.607	1.737	1.596
Vay và nợ thuê tài chính dài hạn	4.942	4.000	4.324	3.973
VỐN CHỦ SỞ HỮU	19.227	15.553	16.816	15.451
Lợi nhuận sau thuế chưa phân phối	7.499	6.062	6.554	6.022
Phải trả người bán	3.112	2.517	2.722	2.501
LƯU CHUYỂN TIỀN TỆ
Khấu hao TSCĐ	1.105	894	967	889
Lưu chuyển tiền thuần từ hoạt động kinh doanh	2.918	2.351	2.551	2.325
Mua sắm tài sản cố định và các tài sản dài hạn khác	-635	-514	-556	-511
Lưu chuyển tiền thuần từ hoạt động đầu tư	-635	-514	-556	-511
Cổ tức, lợi nhuận đã trả cho chủ sở hữu	-966	-777	-843	-769
Lưu chuyển tiền thuần từ hoạt động tài chính	-966	-777	-843	-769`;

/** Cùng dữ liệu nhưng trình bày LUỸ KẾ (YTD) như CafeF chế độ "Lũy kế". */
const CUMULATIVE_CSV = `Đơn vị tính: tỷ đồng
Chỉ tiêu	Q4/2025	Q3/2025	Q2/2025	Q1/2025
Doanh thu thuần	46.170	32.930	22.220	10.640
Lợi nhuận gộp	17.175	12.250	8.266	3.958
Tổng lợi nhuận kế toán trước thuế	9.318	6.635	4.477	2.136
Lợi nhuận sau thuế thu nhập doanh nghiệp	7.454	5.308	3.582	1.709
Lãi cơ bản trên cổ phiếu	14.996	10.678	7.206	3.438
TỔNG CỘNG TÀI SẢN	35.086	28.381	30.687	28.196
VỐN CHỦ SỞ HỮU	19.227	15.553	16.816	15.451`;

describe("parseNumericCell — đọc số theo kiểu Việt Nam", () => {
  it("dấu chấm là phân cách hàng nghìn khi mỗi nhóm sau đúng 3 chữ số", () => {
    expect(parseNumericCell("13.240")).toBe(13240);
    expect(parseNumericCell("1.234.567")).toBe(1234567);
    expect(parseNumericCell("9.999.999")).toBe(9999999);
  });

  it("dấu chấm là thập phân khi nhóm đầu dài hơn 3 chữ số hoặc nhóm sau thiếu 3 chữ số", () => {
    expect(parseNumericCell("1234.567")).toBeCloseTo(1234.567, 3);
    expect(parseNumericCell("1.5")).toBeCloseTo(1.5, 3);
    expect(parseNumericCell("4.318")).toBe(4318);
  });

  it("hỗn hợp: dấu đứng sau là dấu thập phân", () => {
    expect(parseNumericCell("1.234,5")).toBeCloseTo(1234.5, 3);
    expect(parseNumericCell("1,234.5")).toBeCloseTo(1234.5, 3);
  });

  it("số âm trong ngoặc, ô trống và dấu gạch", () => {
    expect(parseNumericCell("(635)")).toBe(-635);
    expect(parseNumericCell("")).toBeNull();
    expect(parseNumericCell("-")).toBeNull();
    expect(parseNumericCell("–")).toBeNull();
    expect(parseNumericCell("N/A")).toBeNull();
  });

  it("giữ nguyên số âm có dấu trừ", () => {
    expect(parseNumericCell("-635")).toBe(-635);
  });
});

describe("parseCafefCsv — số riêng từng quý", () => {
  const parsed = parseCafefCsv(STANDALONE_CSV, { symbol: "vnm" });

  it("tìm đúng 4 kỳ và giữ nguyên thứ tự newest-first", () => {
    expect(parsed.periods).toEqual(["Q4/2025", "Q3/2025", "Q2/2025", "Q1/2025"]);
    expect(parsed.quarters.map((q) => q.period)).toEqual([
      "Q4/2025",
      "Q3/2025",
      "Q2/2025",
      "Q1/2025",
    ]);
    expect(parsed.symbol).toBe("VNM");
  });

  it("nhận ra đây là số RIÊNG quý, không tự tách gì cả", () => {
    expect(parsed.detectedBasis).toBe("standalone");
    expect(parsed.warnings.some((w) => w.includes("LUỸ KẾ"))).toBe(false);
  });

  it("đọc đúng giá trị và đơn vị tỷ đồng", () => {
    const q4 = parsed.quarters[0];
    expect(q4.fiscalYear).toBe(2025);
    expect(q4.quarter).toBe(4);
    expect(q4.income.revenue).toBe(13240);
    expect(q4.income.costOfGoodsSold).toBe(8315);
    expect(q4.income.grossProfit).toBe(4925);
    expect(q4.income.operatingIncome).toBe(2793);
    expect(q4.income.interestExpense).toBe(168);
    expect(q4.income.pretaxIncome).toBe(2683);
    expect(q4.income.incomeTax).toBe(537);
    expect(q4.income.netIncome).toBe(2146);
    // CafeF ghi 4.318 đ/CP → engine dùng 4.318 nghìn VND/CP
    expect(q4.income.eps).toBeCloseTo(4.318, 3);
    expect(parsed.detectedUnit).toMatch(/tỷ|ty/i);
  });

  it("không nhầm “LNST chưa phân phối” với “LNST”", () => {
    const q4 = parsed.quarters[0];
    expect(q4.income.netIncome).toBe(2146);
    expect(q4.balance.retainedEarnings).toBe(7499);
    expect(q4.balance.retainedEarnings).not.toBe(q4.income.netIncome);
  });

  it("đọc bảng cân đối và nợ vay ngắn/dài hạn riêng", () => {
    const q4 = parsed.quarters[0];
    expect(q4.balance.totalAssets).toBe(35086);
    expect(q4.balance.equity).toBe(19227);
    expect(q4.balance.cashAndEquivalents).toBe(1205);
    expect(q4.balance.inventory).toBe(2145);
    expect(q4.balance.receivables).toBe(2317);
    expect(q4.balance.payables).toBe(3112);
    expect(q4.balance.shortTermDebt).toBe(1986);
    expect(q4.balance.longTermDebt).toBe(4942);
  });

  it("giữ capex là số âm đúng như BCTC, và suy ra EBITDA khi file không có", () => {
    const q4 = parsed.quarters[0];
    expect(q4.cashflow.capex).toBe(-635);
    expect(q4.cashflow.operatingCashFlow).toBe(2918);
    expect(q4.cashflow.depreciation).toBe(1105);
    // EBITDA = EBIT + khấu hao
    expect(q4.income.ebitda).toBeCloseTo(2793 + 1105, 2);
  });

  it("báo cáo nhãn đã nhận dạng, không bịa số cho nhãn lạ", () => {
    const targets = parsed.matched.map((m) => m.target);
    expect(targets).toContain("income.revenue");
    expect(targets).toContain("income.netIncome");
    expect(targets).toContain("balance.totalAssets");
    expect(targets).toContain("cashflow.operatingCashFlow");
    // dòng chú thích không có số thì không bị liệt vào unmatched
    expect(parsed.unmatched).not.toContain("TÀI SẢN");
  });

  it("engine tính được trọn bộ từ dữ liệu vừa đọc", () => {
    const inputs: FundamentalInputs = {
      symbol: "VNM",
      quarters: parsed.quarters,
      source: "cafef-csv",
      providerBacked: true,
      price: 68.5,
      beta: 1.04,
      priceSource: "manual",
      loadWarnings: [],
      loadedAt: new Date().toISOString(),
    };
    const analytics = computeFundamentalAnalytics(inputs);
    expect(analytics.available).toBe(true);
    expect(analytics.inputs.basis).toBe("standalone");
    expect(analytics.inputs.ltmMethod).toBe("sum-4q");

    // LTM doanh thu = tổng 4 quý riêng lẻ
    expect(analytics.statement!.ltm!.revenue).toBeCloseTo(
      13240 + 10710 + 11580 + 10640,
      1,
    );
    // ROE tái lập được từ bảng nguồn
    const roe = (analytics.statement!.ltm!.netIncome! / analytics.statement!.balances.equity!) * 100;
    const roeMetric = analytics
      .performance!.groups.find((g) => g.key === "returns")!
      .metrics.find((m) => m.key.startsWith("roe"))!;
    expect(Math.abs(roe - roeMetric.value!)).toBeLessThan(0.5);

    expect(analytics.health).not.toBeNull();
    expect(analytics.valuation).not.toBeNull();
    expect(analytics.valuation!.wacc.costOfEquity).toBeGreaterThan(0);
  });

  it("context dựng được từ dữ liệu CSV mà không thiếu kỳ", () => {
    const ctx = buildFundamentalContext("VNM", parsed.quarters);
    expect(ctx.basis).toBe("standalone");
    expect(ctx.normalized).toHaveLength(4);
    expect(ctx.ltm.quartersUsed).toBe(4);
    expect(ctx.ltm.annualized).toBe(false);
  });
});

describe("parseCafefCsv — tự phát hiện và tách luỹ kế", () => {
  const parsed = parseCafefCsv(CUMULATIVE_CSV, { symbol: "VNM" });

  it("nhận ra dữ liệu là luỹ kế và cảnh báo rõ ràng", () => {
    expect(parsed.detectedBasis).toBe("cumulative-ytd");
    expect(parsed.warnings.some((w) => w.includes("LUỸ KẾ"))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("Riêng(Qn) = Luỹ kế(Qn) − Luỹ kế(Qn−1)"))).toBe(true);
  });

  it("tách về số riêng quý đúng bằng hiệu hai kỳ luỹ kế", () => {
    const byPeriod = new Map(parsed.quarters.map((q) => [q.period, q]));
    const q1 = byPeriod.get("Q1/2025")!;
    const q2 = byPeriod.get("Q2/2025")!;
    const q3 = byPeriod.get("Q3/2025")!;
    const q4 = byPeriod.get("Q4/2025")!;

    // Riêng(Q1) = Luỹ kế(Q1)
    expect(q1.income.revenue).toBe(10640);
    // Riêng(Qn) = Luỹ kế(Qn) − Luỹ kế(Qn−1)
    expect(q2.income.revenue).toBe(22220 - 10640);
    expect(q3.income.revenue).toBe(32930 - 22220);
    expect(q4.income.revenue).toBe(46170 - 32930);
    expect(q4.income.netIncome).toBe(7454 - 5308);
  });

  it("không tách bảng cân đối kế toán (là số dư thời điểm)", () => {
    const q2 = parsed.quarters.find((q) => q.period === "Q2/2025")!;
    expect(q2.balance.totalAssets).toBe(30687);
    expect(q2.balance.equity).toBe(16816);
  });

  it("tổng 4 quý riêng lẻ sau khi tách bằng đúng luỹ kế cả năm", () => {
    const total = parsed.quarters.reduce((sum, q) => sum + (q.income.revenue ?? 0), 0);
    expect(total).toBe(46170);
  });
});

describe("parseCafefCsv — dữ liệu hỏng", () => {
  it("không tìm thấy cột kỳ thì báo rõ, không trả số bừa", () => {
    const result = parseCafefCsv("Doanh thu\tLợi nhuận\n100\t10\n");
    expect(result.quarters).toEqual([]);
    expect(result.warnings.some((w) => w.includes("Không tìm thấy dòng tiêu đề"))).toBe(true);
  });

  it("CSV rỗng thì báo rỗng", () => {
    const result = parseCafefCsv("   \n  \n");
    expect(result.quarters).toEqual([]);
    expect(result.warnings[0]).toContain("rỗng");
  });

  it("thiếu trường quan trọng thì cảnh báo chứ không điền 0", () => {
    const result = parseCafefCsv(
      "Đơn vị tính: tỷ đồng\nChỉ tiêu\tQ2/2025\tQ1/2025\nDoanh thu thuần\t100\t90\n",
    );
    expect(result.quarters[0].income.revenue).toBe(100);
    expect(result.quarters[0].income.netIncome).toBeUndefined();
    expect(result.quarters[0].balance.totalAssets).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("Lợi nhuận sau thuế"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Tổng tài sản"))).toBe(true);
  });

  it("hỗ trợ CSV phân tách bằng dấu phẩy và nhãn có dấu", () => {
    const result = parseCafefCsv(
      `Đơn vị tính: tỷ đồng
Chỉ tiêu,Q2/2025,Q1/2025
Doanh thu thuần,11580,10640
Lợi nhuận sau thuế thu nhập doanh nghiệp,1873,1709
TỔNG CỘNG TÀI SẢN,30687,28196
VỐN CHỦ SỞ HỮU,16816,15451`,
    );
    expect(result.quarters).toHaveLength(2);
    expect(result.quarters[0].income.revenue).toBe(11580);
    expect(result.quarters[0].income.netIncome).toBe(1873);
    expect(result.quarters[0].balance.totalAssets).toBe(30687);
  });

  it("nhận nhãn dạng “Quý 2/2025”", () => {
    const result = parseCafefCsv(
      "Chỉ tiêu\tQuý 2/2025\tQuý 1/2025\nDoanh thu thuần\t100\t90\nLợi nhuận sau thuế\t10\t9",
    );
    expect(result.periods).toEqual(["Q2/2025", "Q1/2025"]);
  });
});

/* ────────────────────────────────────────────────────────────
 * Đường code mà trang preview chạy trong trình duyệt:
 * parseCafefCsv → buildFundamentalContext → 3 khối + buildStatementSource.
 * (src/lib/preview-compute.ts gọi đúng chuỗi hàm này.)
 * ──────────────────────────────────────────────────────────── */
import { buildStatementSource } from "@/lib/fundamental-source";
import { computeAdvancedHealth } from "@/lib/fundamental-health";
import { computeValuation } from "@/lib/fundamental-valuation";

describe("chuỗi hàm preview chạy được trọn bộ từ CSV CafeF", () => {
  it("CSV riêng quý → đủ 3 khối phân tích + bảng nguồn, không cần DB", () => {
    const { quarters } = parseCafefCsv(STANDALONE_CSV, { symbol: "VNM" });
    const ctx = buildFundamentalContext("VNM", quarters);
    const statement = buildStatementSource("VNM", ctx, {
      source: "CSV CafeF",
      providerBacked: true,
      loadedAt: new Date().toISOString(),
    });
    const health = computeAdvancedHealth(ctx);
    const valuation = computeValuation(ctx, { price: 68.5, beta: 1.04 });

    expect(statement.rows).toHaveLength(4);
    expect(statement.ltm?.revenue).toBeCloseTo(46170, 1);
    expect(health.altman?.zScore).not.toBeNull();
    expect(health.piotroski?.score).not.toBeNull();
    expect(valuation.wacc.value).toBeGreaterThan(0);
    expect(valuation.wacc.costOfEquity).toBeGreaterThan(0);
    // ValuationResult phơi giá mục tiêu ở `targetPrice` + danh sách `methods`,
    // không có trường `blended`.
    expect(valuation.methods.length).toBeGreaterThanOrEqual(3);
    expect(valuation.methods.map((m) => m.key)).toContain("dcf");
    // targetPrice là dải {low, mid, high} nghìn VND
    expect(valuation.targetPrice.mid).not.toBeNull();
    expect(valuation.targetPrice.mid!).toBeGreaterThan(0);
    expect(valuation.targetPrice.low!).toBeLessThanOrEqual(valuation.targetPrice.mid!);
    expect(valuation.targetPrice.high!).toBeGreaterThanOrEqual(valuation.targetPrice.mid!);
    expect(["HẤP DẪN", "TÍCH LŨY", "HỢP LÝ", "ĐẮT", "RẤT ĐẮT", "N/A"]).toContain(valuation.rating);
    // bảng nguồn và khối phân tích dùng cùng một cửa sổ LTM
    expect(statement.ltm?.periodEnd).toBe(ctx.ltm.periodEnd);
  });
});
