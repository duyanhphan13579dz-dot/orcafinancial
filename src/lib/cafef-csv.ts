/**
 * Bộ đọc báo cáo tài chính định dạng CSV do CafeF xuất ra.
 *
 * Vì sao cần: người dùng tải file "Báo cáo tài chính" từ CafeF dưới dạng
 * bảng (Excel/CSV) với nhãn tiếng Việt ở cột đầu và các kỳ báo cáo ở các cột
 * sau. Module này chuyển bảng đó sang `FinancialQuarter[]` mà engine
 * fundamental dùng được.
 *
 * Hai nguyên tắc bắt buộc:
 *
 * 1. **Số riêng từng quý, không lấy luỹ kế.** CafeF có cả hai chế độ. Nếu dữ
 *    liệu đưa vào hoá ra là luỹ kế (YTD), module sẽ tách về riêng quý bằng
 *    `toStandaloneQuarters` và ghi rõ vào `warnings` — không âm thầm dùng số
 *    luỹ kế như số riêng quý, vì đó chính là lỗi làm ROE phóng đại gấp nhiều
 *    lần.
 *
 * 2. **Không bịa số.** Nhãn nào không nhận ra thì đưa vào `unmatched`; trường
 *    nào thiếu thì để `undefined` để engine trả về `null`. Không bao giờ điền
 *    0 thay cho "không có".
 *
 * Module này THUẦN (không I/O) nên chạy được cả ở server lẫn trong trình
 * duyệt — trang preview cho phép dán CSV và xem kết quả ngay mà không cần
 * mạng hay database.
 */

import {
  detectStatementBasis,
  toStandaloneQuarters,
  type NormalizedQuarter,
} from "@/lib/fundamental-engine";
import type { FinancialQuarter } from "@/lib/financial-statements";

/* ────────────────────────────────────────────────────────────
 * Nhận dạng nhãn dòng
 * ──────────────────────────────────────────────────────────── */

type FieldTarget =
  | "income.revenue"
  | "income.costOfGoodsSold"
  | "income.grossProfit"
  | "income.operatingExpenses"
  | "income.operatingIncome"
  | "income.interestExpense"
  | "income.otherIncome"
  | "income.pretaxIncome"
  | "income.incomeTax"
  | "income.netIncome"
  | "income.ebitda"
  | "income.depreciation"
  | "income.eps"
  | "balance.cashAndEquivalents"
  | "balance.shortTermInvestments"
  | "balance.receivables"
  | "balance.inventory"
  | "balance.currentAssets"
  | "balance.fixedAssets"
  | "balance.totalAssets"
  | "balance.currentLiabilities"
  | "balance.shortTermDebt"
  | "balance.longTermDebt"
  | "balance.totalLiabilities"
  | "balance.equity"
  | "balance.retainedEarnings"
  | "balance.payables"
  | "cashflow.depreciation"
  | "cashflow.operatingCashFlow"
  | "cashflow.capex"
  | "cashflow.investingCashFlow"
  | "cashflow.dividendsPaid"
  | "cashflow.financingCashFlow"
  | "cashflow.netChangeCash";

/** Bỏ dấu tiếng Việt để so nhãn bền hơn giữa các lần CafeF đổi cách viết. */
function deaccent(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface LabelRule {
  target: FieldTarget;
  /** Mọi nhóm phải xuất hiện (sau khi bỏ dấu). */
  all: string[];
  /** Chỉ cần một trong số này xuất hiện. */
  any?: string[];
  /** Nếu xuất hiện thì KHÔNG nhận (để loại dòng dễ nhầm). */
  none?: string[];
}

/**
 * Thứ tự quan trọng: dòng cụ thể phải đứng trước dòng tổng quát, vì nhãn đầu
 * tiên khớp sẽ thắng. Ví dụ "LNST chưa phân phối" phải khớp trước "LNST".
 */
const LABEL_RULES: LabelRule[] = [
  /*
   * THỨ TỰ RẤT QUAN TRỌNG: nhãn cụ thể phải đứng trước nhãn tổng quát, vì
   * nhãn đầu tiên khớp sẽ thắng. Hai cái bẫy đã gặp khi viết module này:
   *  • "Lợi nhuận sau THUẾ THU NHẬP DOANH NGHIỆP" chứa "thuế thu nhập doanh
   *    nghiệp" → sẽ bị khớp thành chi phí thuế nếu rule thuế đứng trước.
   *  • "MUA SẮM tài sản cố định…" (dòng lưu chuyển tiền tệ) chứa "tài sản cố
   *    định" → sẽ bị khớp thành TSCĐ trên bảng cân đối nếu rule BCĐKT trước.
   * Nên nhóm LƯU CHUYỂN TIỀN TỆ và LNST được đặt lên đầu.
   */

  /* ── Lưu chuyển tiền tệ (đặt trước vì nhãn chứa từ khoá của BCĐKT) ── */
  { target: "cashflow.depreciation", all: ["khau hao"] },
  { target: "cashflow.operatingCashFlow", all: ["luu chuyen tien thuan tu hoat dong kinh doanh"] },
  { target: "cashflow.capex", all: ["mua sam tai san co dinh"] },
  {
    target: "cashflow.capex",
    all: ["chi", "tai san", "dai han"],
    none: ["loi nhuan", "khau hao", "thue"],
  },
  { target: "cashflow.investingCashFlow", all: ["luu chuyen tien thuan tu hoat dong dau tu"] },
  { target: "cashflow.dividendsPaid", all: ["co tuc", "loi nhuan da tra"] },
  { target: "cashflow.financingCashFlow", all: ["luu chuyen tien thuan tu hoat dong tai chinh"] },
  { target: "cashflow.netChangeCash", all: ["tien va tuong duong tien cuoi ky"] },

  /* ── Kết quả kinh doanh ── */
  { target: "income.eps", all: ["lai co ban tren co phieu"] },
  { target: "income.eps", all: ["eps"] },
  { target: "income.revenue", all: ["doanh thu thuan"], none: ["hoat dong tai chinh", "khac"] },
  { target: "income.revenue", all: ["doanh thu"], any: ["ban hang", "cung cap dich vu"] },
  { target: "income.costOfGoodsSold", all: ["gia von"] },
  { target: "income.grossProfit", all: ["loi nhuan gop"] },
  { target: "income.interestExpense", all: ["chi phi lai vay"] },
  { target: "income.otherIncome", all: ["loi nhuan khac"] },
  { target: "income.operatingIncome", all: ["loi nhuan thuan tu hoat dong kinh doanh"] },
  { target: "income.operatingIncome", all: ["loi nhuan hoat dong kinh doanh"] },
  { target: "income.pretaxIncome", all: ["tong loi nhuan ke toan truoc thue"] },
  // LNST phải đứng TRƯỚC quy tắc thuế: nhãn đầy đủ của nó có chứa "thuế TNDN".
  {
    target: "income.netIncome",
    all: ["loi nhuan sau thue"],
    none: ["chua phan phoi", "co dong khong kiem soat"],
  },
  { target: "income.pretaxIncome", all: ["loi nhuan", "truoc thue"], none: ["chua phan phoi"] },
  { target: "income.incomeTax", all: ["chi phi thue"] },
  {
    target: "income.incomeTax",
    all: ["thue", "thu nhap doanh nghiep"],
    none: ["loi nhuan", "hoan lai"],
  },

  /* ── Bảng cân đối kế toán ── */
  { target: "balance.cashAndEquivalents", all: ["tien va cac khoan tuong duong tien"] },
  { target: "balance.cashAndEquivalents", all: ["tien"], none: ["luu chuyen", "tra", "co tuc"] },
  { target: "balance.shortTermInvestments", all: ["dau tu tai chinh ngan han"] },
  { target: "balance.receivables", all: ["phai thu"], any: ["ngan han", "khach hang"] },
  { target: "balance.inventory", all: ["hang ton kho"] },
  { target: "balance.currentAssets", all: ["tai san ngan han"], none: ["khac"] },
  {
    target: "balance.fixedAssets",
    all: ["tai san co dinh"],
    none: ["mua sam", "luu chuyen", "khau hao"],
  },
  { target: "balance.totalAssets", all: ["tong cong tai san"] },
  { target: "balance.totalAssets", all: ["tong tai san"] },
  { target: "balance.shortTermDebt", all: ["vay va no thue tai chinh ngan han"] },
  { target: "balance.shortTermDebt", all: ["vay ngan han"] },
  { target: "balance.longTermDebt", all: ["vay va no thue tai chinh dai han"] },
  { target: "balance.longTermDebt", all: ["vay dai han"] },
  { target: "balance.currentLiabilities", all: ["no ngan han"], none: ["vay"] },
  { target: "balance.retainedEarnings", all: ["loi nhuan sau thue chua phan phoi"] },
  { target: "balance.equity", all: ["von chu so huu"], none: ["khac"] },
  { target: "balance.totalLiabilities", all: ["no phai tra"] },
  { target: "balance.totalLiabilities", all: ["tong cong nguon von"] },
  { target: "balance.payables", all: ["phai tra nguoi ban"] },
];

/**
 * EBITDA hiếm khi có sẵn trong BCTC chuẩn → suy ra khi thiếu:
 * EBITDA = EBIT + khấu hao. Chỉ dùng khi cả hai đều có.
 */
function deriveEbitda(quarter: FinancialQuarter): void {
  const income = quarter.income as unknown as Record<string, unknown>;
  if (income.ebitda !== undefined) return;
  const ebit = income.operatingIncome;
  const depreciation = income.depreciation ?? quarter.cashflow.depreciation;
  if (typeof ebit === "number" && typeof depreciation === "number") {
    income.ebitda = ebit + depreciation;
  }
}

/* ────────────────────────────────────────────────────────────
 * Tách bảng
 * ──────────────────────────────────────────────────────────── */

function detectDelimiter(line: string): string {
  const counts: Array<[string, number]> = [
    ["\t", (line.match(/\t/g) ?? []).length],
    [";", (line.match(/;/g) ?? []).length],
    [",", (line.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : "\t";
}

function splitCsvLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

/** Chuẩn hoá nhãn: bỏ dấu, bỏ ký tự đánh dấu mục kiểu "1.", "2.1", "−". */
function normalizeLabel(raw: string): string {
  return deaccent(
    raw
      .replace(/^\s*[\d.]+\s*/, "")
      .replace(/^[-–—•*\s]+/, ""),
  );
}

const PERIOD_PATTERNS = [
  /^q\s*([1-4])\s*[\/.\-]\s*(\d{4})$/i,
  /^qu[yý]\s*([1-4])\s*[\/.\-]?\s*(\d{4})$/i,
  /^([1-4])\s*[\/.\-]\s*(\d{4})$/,
];

function parsePeriodCell(cell: string): { quarter: number; year: number } | null {
  const value = cell.trim();
  for (const pattern of PERIOD_PATTERNS) {
    const m = value.match(pattern);
    if (m) return { quarter: parseInt(m[1], 10), year: parseInt(m[2], 10) };
  }
  return null;
}

/**
 * Phân biệt dấu phân cách hàng nghìn với dấu thập phân.
 *
 * "1.234.567" → hàng nghìn (mỗi nhóm sau nhóm đầu đúng 3 chữ số, nhóm đầu ≤ 3
 * chữ số). "1234.567" → thập phân (nhóm đầu 4 chữ số thì không thể là nhóm
 * hàng nghìn). "1.5" → thập phân (nhóm sau không đủ 3 chữ số).
 */
function isThousandSeparated(groups: string[]): boolean {
  if (groups.length < 2) return false;
  if (groups[0].length === 0 || groups[0].length > 3) return false;
  return groups.slice(1).every((group) => group.length === 3);
}

/**
 * Đổi chuỗi số trong bảng sang number.
 *
 * CafeF/Excel xuất theo nhiều kiểu: "1.234,5", "1,234.5", "(123)" cho số âm,
 * "-" hoặc rỗng cho "không có". Quy tắc: dấu phân cách xuất hiện CUỐI CÙNG là
 * dấu thập phân; số trong ngoặc đơn là số âm. Trả về null khi ô trống.
 */
export function parseNumericCell(raw: string): number | null {
  const text = raw.trim();
  if (!text || text === "-" || text === "–" || text === "—" || text.toLowerCase() === "na") return null;

  const negative = /^\(.*\)$/.test(text);
  let body = text.replace(/[()]/g, "").replace(/[^\d.,\-]/g, "");
  if (!body || body === "-" || body === "." || body === ",") return null;

  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    // dấu nào đứng sau là dấu thập phân
    if (lastComma > lastDot) {
      body = body.replace(/\./g, "").replace(",", ".");
    } else {
      body = body.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    body = isThousandSeparated(body.split(",")) ? body.replace(/,/g, "") : body.replace(",", ".");
  } else if (lastDot >= 0) {
    body = isThousandSeparated(body.split(".")) ? body.replace(/\./g, "") : body;
  }

  body = body.replace(/,/g, "");
  const value = Number(body);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/* ────────────────────────────────────────────────────────────
 * API chính
 * ──────────────────────────────────────────────────────────── */

export interface CafefCsvOptions {
  symbol?: string;
  /**
   * `standalone` (mặc định): dữ liệu CSV là số riêng từng quý. Nếu phát hiện
   * thực tế là luỹ kế, module sẽ tách về riêng quý và cảnh báo.
   */
  basis?: "standalone" | "auto";
  /** Bỏ qua các dòng nhãn không nhận ra (mặc định: ghi vào `unmatched`). */
  strict?: boolean;
  /**
   * Đơn vị của dòng EPS trong file. CafeF xuất EPS theo **đồng/cổ phiếu**
   * (ví dụ 4.318 đ/CP) trong khi engine dùng **nghìn VND/cổ phiếu** (4.318).
   * Mặc định "dong" → tự chia 1000. Đặt "nghin" nếu file đã ở nghìn VND.
   */
  epsUnit?: "dong" | "nghin";
}

export interface CafefCsvResult {
  symbol: string;
  quarters: FinancialQuarter[];
  /** Các kỳ tìm thấy, newest-first. */
  periods: string[];
  /** Đơn vị ghi trong file nếu phát hiện được. */
  detectedUnit: string | null;
  /** Nhãn đã map được → trường engine. */
  matched: Array<{ label: string; target: FieldTarget }>;
  /** Nhãn trong file chưa map được. */
  unmatched: string[];
  /** Dạng dữ liệu phát hiện được trước khi tách quý. */
  detectedBasis: "standalone" | "cumulative-ytd" | "unknown";
  warnings: string[];
}

/** Đưa NormalizedQuarter (đã tách riêng quý) về đúng shape FinancialQuarter. */
function toFinancialQuarter(quarter: NormalizedQuarter): FinancialQuarter {
  return {
    period: quarter.period,
    quarter: quarter.quarter,
    fiscalYear: quarter.fiscalYear,
    income: quarter.income,
    balance: quarter.balance,
    cashflow: quarter.cashflow,
  } as unknown as FinancialQuarter;
}

function setField(
  bucket: Record<string, unknown>,
  key: string,
  value: number | null,
): void {
  if (value === null) return;
  // Không ghi đè giá trị đã có từ dòng khớp chính xác hơn đứng trước.
  if (bucket[key] !== undefined) return;
  bucket[key] = value;
}

export function parseCafefCsv(
  csv: string,
  options: CafefCsvOptions = {},
): CafefCsvResult {
  const symbol = (options.symbol ?? "").toUpperCase();
  const epsUnit = options.epsUnit ?? "dong";
  const warnings: string[] = [];
  const matched: Array<{ label: string; target: FieldTarget }> = [];
  const unmatched: string[] = [];

  const rawLines = csv
    .split(/\r\n|\n|\r/)
    .map((line) => line.replace(/^\uFEFF/, ""))
    .filter((line) => line.trim().length > 0);

  if (rawLines.length === 0) {
    return {
      symbol,
      quarters: [],
      periods: [],
      detectedUnit: null,
      matched,
      unmatched,
      detectedBasis: "unknown",
      warnings: ["File CSV rỗng."],
    };
  }

  const delimiter = detectDelimiter(rawLines[0].includes("\t") ? rawLines[0] : rawLines.join(" "));
  const rows = rawLines.map((line) => splitCsvLine(line, delimiter));

  // Đơn vị thường nằm ở vài dòng đầu.
  const unitLine = rawLines
    .slice(0, 6)
    .find((line) => /đơn vị|don vi|tỷ đồng|ty dong|triệu đồng|trieu dong/i.test(line));
  const detectedUnit = unitLine
    ? (unitLine.match(/(tỷ đồng|ty dong|triệu đồng|trieu dong|đồng|dong)/i)?.[0] ?? null)
    : null;
  if (unitLine && !/tỷ|ty dong/i.test(unitLine)) {
    warnings.push(
      `File ghi đơn vị "${detectedUnit}" nhưng engine giả định TỶ ĐỒNG — hãy kiểm tra lại trước khi dùng.`,
    );
  }

  // Tìm dòng tiêu đề chứa các cột kỳ báo cáo.
  let headerIndex = -1;
  let periodColumns: Array<{ index: number; quarter: number; year: number }> = [];
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const found: Array<{ index: number; quarter: number; year: number }> = [];
    rows[i].forEach((cell, index) => {
      const parsed = parsePeriodCell(cell);
      if (parsed) found.push({ index, ...parsed });
    });
    if (found.length >= 2) {
      headerIndex = i;
      periodColumns = found;
      break;
    }
  }

  if (headerIndex < 0 || periodColumns.length === 0) {
    return {
      symbol,
      quarters: [],
      periods: [],
      detectedUnit,
      matched,
      unmatched,
      detectedBasis: "unknown",
      warnings: [
        "Không tìm thấy dòng tiêu đề chứa các kỳ báo cáo (dạng Q1/2026, Quý 2/2026…). " +
          "Hãy chắc chắn bạn tải bản theo QUÝ, không phải bản theo năm.",
      ],
    };
  }

  // Gom dữ liệu theo kỳ.
  const periods = periodColumns.map((c) => `Q${c.quarter}/${c.year}`);
  const buckets = periodColumns.map(() => ({
    income: {} as Record<string, unknown>,
    balance: {} as Record<string, unknown>,
    cashflow: {} as Record<string, unknown>,
  }));

  const matchedTargets = new Set<FieldTarget>();

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const rawLabel = cells[0] ?? "";
    const label = normalizeLabel(rawLabel);
    if (!label) continue;

    const rule = LABEL_RULES.find(
      (candidate) =>
        candidate.all.every((token) => label.includes(token)) &&
        (candidate.any === undefined || candidate.any.some((token) => label.includes(token))) &&
        (candidate.none === undefined || !candidate.none.some((token) => label.includes(token))),
    );

    if (!rule) {
      // Chỉ báo những dòng CÓ số — dòng chú thích không đáng lưu ý.
      const hasNumbers = periodColumns.some((c) => parseNumericCell(cells[c.index] ?? "") !== null);
      if (hasNumbers && !unmatched.includes(rawLabel.trim())) unmatched.push(rawLabel.trim());
      continue;
    }

    if (!matchedTargets.has(rule.target)) {
      matchedTargets.add(rule.target);
      matched.push({ label: rawLabel.trim(), target: rule.target });
    }

    const [group, key] = rule.target.split(".") as [
      "income" | "balance" | "cashflow",
      string,
    ];
    // CafeF ghi EPS bằng đồng/CP; engine tính P/E, Graham, DDM bằng nghìn VND.
    const scale = rule.target === "income.eps" && epsUnit === "dong" ? 1 / 1000 : 1;
    periodColumns.forEach((column, position) => {
      const raw = parseNumericCell(cells[column.index] ?? "");
      setField(
        buckets[position][group] as Record<string, unknown>,
        key,
        raw === null ? null : raw * scale,
      );
    });
  }

  // Dựng FinancialQuarter cho từng kỳ.
  const quarters: FinancialQuarter[] = periodColumns.map((column, position) => {
    const bucket = buckets[position];
    const income = bucket.income as Record<string, unknown>;

    // Chi phí hoạt động = LN gộp − EBIT (chỉ khi có đủ).
    if (
      income.operatingExpenses === undefined &&
      typeof income.grossProfit === "number" &&
      typeof income.operatingIncome === "number"
    ) {
      income.operatingExpenses = income.grossProfit - income.operatingIncome;
    }

    const quarter: FinancialQuarter = {
      period: `Q${column.quarter}/${column.year}`,
      quarter: column.quarter,
      fiscalYear: column.year,
      income: bucket.income,
      balance: bucket.balance,
      cashflow: bucket.cashflow,
    } as unknown as FinancialQuarter;

    deriveEbitda(quarter);
    return quarter;
  });

  // Sắp xếp newest-first — đúng thứ tự phần còn lại của hệ thống giả định.
  const sorted = [...quarters].sort(
    (a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter,
  );

  const detectedBasis = detectStatementBasis(sorted);
  let finalQuarters = sorted;

  if (detectedBasis === "cumulative-ytd") {
    warnings.push(
      "Dữ liệu trong file là LUỸ KẾ (YTD), không phải số riêng từng quý. " +
        "Đã tự tách về riêng quý: Riêng(Qn) = Luỹ kế(Qn) − Luỹ kế(Qn−1). " +
        "Nếu bạn muốn số riêng quý gốc, hãy chọn chế độ \"Số liệu quý\" khi tải từ CafeF.",
    );
    finalQuarters = toStandaloneQuarters(sorted, detectedBasis).map(toFinancialQuarter);
  }

  const requiredMissing = [
    ["income.revenue", "Doanh thu thuần"],
    ["income.netIncome", "Lợi nhuận sau thuế"],
  ] as const;
  for (const [path, viLabel] of requiredMissing) {
    if (!matchedTargets.has(path as FieldTarget)) {
      warnings.push(`Thiếu "${viLabel}" — nhiều chỉ số sẽ hiện "Chưa có dữ liệu".`);
    }
  }
  if (!matchedTargets.has("balance.totalAssets")) {
    warnings.push('Thiếu "Tổng tài sản" — ROA, đòn bẩy và Altman Z\' không tính được.');
  }
  if (!matchedTargets.has("balance.equity")) {
    warnings.push('Thiếu "Vốn chủ sở hữu" — ROE, ROIC và P/B không tính được.');
  }

  if (options.strict && unmatched.length > 0) {
    warnings.push(`${unmatched.length} nhãn chưa được nhận dạng (xem danh sách unmatched).`);
  }

  return {
    symbol,
    quarters: finalQuarters,
    periods,
    detectedUnit,
    matched,
    unmatched,
    detectedBasis,
    warnings,
  };
}
