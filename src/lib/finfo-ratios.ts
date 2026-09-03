/**
 * VNDirect finfo PUBLIC client — dùng chung cho server lẫn browser.
 *
 * Khảo sát trực tiếp API (2026-09-03, đối chiếu BCTC chuẩn của người dùng):
 *  - /v4/financial_statements?q=code:{SYM}~reportType:QUARTER (income: modelType 2 non-bank, 102 ngân hàng)
 *    ~fiscalDate:{YYYY-MM-DD} = BÁO CÁO KẾT QUẢ KINH DOANH HỢP NHẤT, số RIÊNG
 *    quý (verified với VIC Q1+Q2/2026: itemCode 23003 = LNST hợp nhất
 *    14.764/5.611 tỷ; 23800 = LNTT 22.169/11.537; 23000 = LNST công ty mẹ
 *    10.003/7.276; 23500 = lợi ích CĐ thiểu số 4.761/−1.665).
 *  - /v4/ratios?q=code:{SYM}~reportDate:{YYYY-MM-DD}&size=2000 có itemName
 *    tiếng Việt chính thức; các mã _AQ (bảng cân đối) khớp BCTC hợp nhất
 *    (VIC 2026-06-30: TOTAL_ASSETS_AQ 1.308.938 tỷ ✓, OWNERS_EQUITY_AQ
 *    180.707 ✓, INVENTORY_AQ 261.745 ✓). Lưu ý: NET_PROFIT_*, EPS_*, BVPS_AQ
 *    trên /v4/ratios là CƠ SỞ CÔNG TY MẸ → KHÔNG dùng cho lợi nhuận.
 *
 * QUY TẮC CƠ SỞ SỐ LIỆU (theo yêu cầu người dùng):
 *  - Nguồn lợi nhuận = modelType 2 của /v4/financial_statements = HỢP NHẤT,
 *    đã là số riêng quý → không cần suy diễn.
 *  - Bảng cân đối = _AQ (số dư cuối kỳ, hợp nhất).
 *  - Dòng tiền = CFO_QR, thiếu thì hiệu hai số lũy kế đã công bố.
 *  - Không có số → bỏ trống (UI hiển thị "–"), tuyệt đối không bịa.
 * Giá trị tiền tệ = tỷ VND.
 */

import { FINFO_SNAPSHOT_AS_OF, FINFO_STATEMENTS_SNAPSHOT } from "@/lib/finfo-snapshot";

export const FINFO_API_BASE = "https://api-finfo.vndirect.com.vn";

/** Phiên bản parser BCTC — bump khi đổi cơ sở số liệu để DB tự nạp lại. */
export const FINFO_PARSER_VERSION = "consol-v5";

export interface FinfoRatioRow {
  code?: string;
  group?: string;
  reportDate?: string;
  ratioCode?: string;
  itemCode?: string | number;
  itemName?: string;
  value?: number | null;
}

export interface FinfoStatementRow {
  code?: string;
  itemCode?: number;
  reportType?: string;
  modelType?: number;
  numericValue?: number | null;
  fiscalDate?: string;
}

export interface FinfoQuarter {
  period: string;
  fiscalYear: number;
  reportDate: string;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

type Section = "income" | "balance" | "cashflow";

/** Mỗi ô chuẩn hóa: mã _QR (riêng quý), mã _YD (lũy kế/năm). */
interface FieldSpec {
  section: Section;
  field: string;
  qr?: string;
  yd?: string;
}

/**
 * Chỉ tiêu KQKD HỢP NHẤT từ /v4/financial_statements (reportType QUARTER =
 * số riêng quý; tại 31/12 = lũy kế cả năm).
 *  - modelType 2  = doanh nghiệp thường;
 *  - modelType 102 = NGÂN HÀNG (template riêng: không giá vốn/LN gộp; doanh
 *    thu thuần = 421900 — verified khớp itemName "Doanh thu thuần quý" của
 *    /v4/ratios mã NET_SALES_QR trên TCB; các mã lợi nhuận 23xxx dùng chung).
 * (modelType 101/103 = cân đối/lưu chuyển tiền tệ ngân hàng — không dùng ở đây.)
 */
export const FINFO_INCOME_ITEM_CODES: Record<string, number[]> = {
  totalRevenue: [21000],
  revenue: [21001, 421900],
  costOfGoodsSold: [22100],
  grossProfit: [23100],
  operatingIncome: [23110],
  pretaxIncome: [23800],
  netIncome: [23003],
  netIncomeParent: [23000],
  minorityInterest: [23500],
};

/**
 * Bảng CĐKT HỢP NHẤT (modelType 1, doanh nghiệp thường). Mã chỉ tiêu = số
 * dòng TT200 × 100, verified trên VIC bằng đẳng thức kế toán cả 4 kỳ:
 * 11000+12000=12700; 13100+13300=13000; 13000+14000=12700.
 * Ngân hàng (model 101) dùng template mã khác — chưa map, tránh đoán mò.
 */
export const FINFO_BALANCE_ITEM_CODES: Record<string, number> = {
  cashAndEquivalents: 11100, // 110 Tiền và tương đương tiền
  shortTermInvestments: 11200, // 120 Đầu tư tài chính ngắn hạn
  receivables: 11300, // 130 Các khoản phải thu ngắn hạn
  inventory: 11400, // 140 Hàng tồn kho
  currentAssets: 11000, // 100 Tài sản ngắn hạn
  fixedAssets: 12200, // 220 Tài sản cố định
  longTermInvestments: 12400, // 240 Đầu tư tài chính dài hạn
  totalAssets: 12700, // 270 TỔNG CỘNG TÀI SẢN
  currentLiabilities: 13100, // 310 Nợ ngắn hạn
  longTermDebt: 13300, // 330 Nợ dài hạn
  totalLiabilities: 13000, // 300 NỢ PHẢI TRẢ
  equity: 14000, // 400 VỐN CHỦ SỞ HỮU
};

/**
 * LCTT HỢP NHẤT (modelType 3, doanh nghiệp thường): 32000 = lưu chuyển
 * thuần từ HĐKD (dòng 20), 32100 = chi mua TSCĐ (dòng 21), 33000 = lưu
 * chuyển thuần từ HĐ đầu tư (dòng 30), 33600 = cổ tức đã trả (dòng 36).
 * Verified trên VIC: 32000+33000+34000=35000; tiền cuối kỳ 37000 = 11100 CĐKT.
 */
export const FINFO_CASHFLOW_ITEM_CODES: Record<string, number> = {
  operatingCashFlow: 32000,
  capex: 32100,
  investingCashFlow: 33000,
  dividendsPaid: 33600,
};
/** "Phát hành/hoàn trả nợ" = tiền vay thu được (33300) + trả nợ gốc vay (33400). */
export const FINFO_CASHFLOW_DEBT_CODES = [33300, 33400];

export const FIELD_SPECS: FieldSpec[] = [
  // EBITDA lấy từ /v4/ratios (dẫn xuất từ lợi nhuận HĐKD hợp nhất).
  { section: "income", field: "ebitda", qr: "OPERATING_EBITDA_QR", yd: "OPERATING_EBITDA_YD" },
  // Bảng cân đối (số dư thời điểm, hợp nhất). KHÔNG dùng TOTAL_CAP_AQ
  // ("Tổng vốn"): với VIC nó ≠ tổng nguồn vốn (210.740 vs 1.308.938 tỷ).
  { section: "balance", field: "currentAssets", yd: "CURRENT_ASSETS_AQ" },
  { section: "balance", field: "inventory", yd: "INVENTORY_AQ" },
  { section: "balance", field: "totalAssets", yd: "TOTAL_ASSETS_AQ" },
  { section: "balance", field: "equity", yd: "OWNERS_EQUITY_AQ" },
  { section: "balance", field: "totalLiabilitiesEquity", yd: "TOTAL_ASSETS_AQ" },
  // Lưu chuyển tiền tệ
  { section: "cashflow", field: "operatingCashFlow", qr: "CFO_QR", yd: "CFO_YD" },
];

const TY = 1e9;

/** Các ngày cuối quý đã hoàn tất, mới nhất trước. */
export function lastQuarterEnds(count: number, now = new Date()): string[] {
  const ends: Array<[number, number]> = [
    [3, 31],
    [6, 30],
    [9, 30],
    [12, 31],
  ];
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let idx = 3;
  while (out.length < count) {
    const [m, d] = ends[idx];
    if (new Date(Date.UTC(y, m - 1, d)) < now) {
      out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    idx -= 1;
    if (idx < 0) {
      idx = 3;
      y -= 1;
    }
  }
  return out;
}

export function periodFromReportDate(reportDate: string): { period: string; fiscalYear: number } | null {
  const m = reportDate.match(/^(20\d{2})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const mm = Number(m[2]);
  const q = mm <= 3 ? 1 : mm <= 6 ? 2 : mm <= 9 ? 3 : 4;
  return { period: `Q${q}/${m[1]}`, fiscalYear: Number(m[1]) };
}

/** Ngày cuối quý liền trước cùng năm (để lấy hiệu lũy kế), null nếu Q1. */
export function prevQuarterEnd(reportDate: string): string | null {
  const p = periodFromReportDate(reportDate);
  if (!p) return null;
  const m = reportDate.match(/^(20\d{2})-(\d{2})-\d{2}$/)!;
  const q = Number(m[2]) <= 3 ? 1 : Number(m[2]) <= 6 ? 2 : Number(m[2]) <= 9 ? 3 : 4;
  if (q === 1) return null;
  const ends: Record<number, string> = { 2: "03-31", 3: "06-30", 4: "09-30" };
  return `${m[1]}-${ends[q]}`;
}

export function finfoRatiosUrl(symbol: string, reportDate: string): string {
  return `${FINFO_API_BASE}/v4/ratios?q=code:${symbol.toUpperCase()}~reportDate:${reportDate}&size=2000`;
}

export function finfoStatementsUrl(symbol: string, fiscalDate: string): string {
  // Không lọc modelType: non-bank dùng model 2, ngân hàng dùng model 102.
  return `${FINFO_API_BASE}/v4/financial_statements?q=code:${symbol.toUpperCase()}~reportType:QUARTER~fiscalDate:${fiscalDate}&size=2000`;
}

/**
 * MỌI kỳ kể từ fromDate trong MỘT request (đã kiểm chứng 2026-09-03: trả đủ
 * 2026-06-30, 2026-03-31, 2025-12-31, 2025-09-30…). Giảm 4 request/kỳ xuống
 * còn 1 — bớt bị nguồn chặn khi gọi bùng phát. KHÔNG dùng cách này cho
 * /v4/ratios vì endpoint đó lẫn cả dòng ngày giao dịch (size bị cắt mất quý).
 */
export function finfoStatementsRangeUrl(symbol: string, fromDate: string): string {
  return `${FINFO_API_BASE}/v4/financial_statements?q=code:${symbol.toUpperCase()}~reportType:QUARTER~fiscalDate:gte:${fromDate}&size=3000`;
}

function valuesByCode(rows: FinfoRatioRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row?.ratioCode && typeof row.value === "number" && Number.isFinite(row.value)) {
      map.set(row.ratioCode, row.value);
    }
  }
  return map;
}

/** modelType chứa KQKD: 2 = doanh nghiệp, 102 = ngân hàng. */
export const FINFO_INCOME_MODEL_TYPES = new Set([2, 102]);

/** KQKD hợp nhất (tỷ VND) từ rows modelType 2/102 của /v4/financial_statements. */
export function incomeFromStatementRows(rows: FinfoStatementRow[]): Record<string, number> {
  const byItem = new Map<number, number>();
  for (const row of rows) {
    if (
      row?.modelType != null &&
      FINFO_INCOME_MODEL_TYPES.has(row.modelType) &&
      typeof row.itemCode === "number" &&
      typeof row.numericValue === "number" &&
      Number.isFinite(row.numericValue)
    ) {
      byItem.set(row.itemCode, row.numericValue);
    }
  }
  const out: Record<string, number> = {};
  for (const [field, codes] of Object.entries(FINFO_INCOME_ITEM_CODES)) {
    for (const code of codes) {
      const v = byItem.get(code);
      if (v != null) {
        out[field] = v / TY;
        break;
      }
    }
  }
  return out;
}

/** Bảng cân đối hợp nhất (tỷ VND) từ rows modelType 1 của /v4/financial_statements. */
export function balanceFromStatementRows(rows: FinfoStatementRow[]): Record<string, number> {
  const byItem = new Map<number, number>();
  for (const row of rows) {
    if (
      row?.modelType === 1 &&
      typeof row.itemCode === "number" &&
      typeof row.numericValue === "number" &&
      Number.isFinite(row.numericValue)
    ) {
      byItem.set(row.itemCode, row.numericValue);
    }
  }
  const out: Record<string, number> = {};
  for (const [field, code] of Object.entries(FINFO_BALANCE_ITEM_CODES)) {
    const v = byItem.get(code);
    if (v != null) out[field] = v / TY;
  }
  return out;
}

/** LCTT hợp nhất (tỷ VND) từ rows modelType 3 của /v4/financial_statements. */
export function cashflowFromStatementRows(rows: FinfoStatementRow[]): Record<string, number> {
  const byItem = new Map<number, number>();
  for (const row of rows) {
    if (
      row?.modelType === 3 &&
      typeof row.itemCode === "number" &&
      typeof row.numericValue === "number" &&
      Number.isFinite(row.numericValue)
    ) {
      byItem.set(row.itemCode, row.numericValue);
    }
  }
  const out: Record<string, number> = {};
  for (const [field, code] of Object.entries(FINFO_CASHFLOW_ITEM_CODES)) {
    const v = byItem.get(code);
    if (v != null) out[field] = v / TY;
  }
  const debtParts = FINFO_CASHFLOW_DEBT_CODES.map((c) => byItem.get(c));
  if (debtParts.every((v) => v != null)) {
    out.debtIssuance = debtParts.reduce<number>((s, v) => s + (v ?? 0), 0) / TY;
  }
  return out;
}

/**
 * Dựng các quý chuẩn hóa (mới nhất trước) từ rows của hai endpoint finfo.
 * mode "quarter" → số riêng quý; "year" → lũy kế năm (chỉ dùng cho kỳ 31/12,
 * khi đó modelType 2 tại 31/12 chính là số cả năm).
 */
export function quartersFromFinfoRows(
  ratiosByDate: Map<string, FinfoRatioRow[]>,
  statementsByDate: Map<string, FinfoStatementRow[]>,
  mode: "quarter" | "year",
): FinfoQuarter[] {
  const dates = [...new Set([...ratiosByDate.keys(), ...statementsByDate.keys()])].sort((a, b) =>
    b.localeCompare(a),
  );
  const out: FinfoQuarter[] = [];
  for (const date of dates) {
    const p = periodFromReportDate(date);
    if (!p) continue;
    if (mode === "year" && !date.endsWith("12-31")) continue;
    const cur = valuesByCode(ratiosByDate.get(date) ?? []);
    const prevDate = prevQuarterEnd(date);
    const prev = prevDate && ratiosByDate.has(prevDate) ? valuesByCode(ratiosByDate.get(prevDate)!) : null;
    const q: FinfoQuarter = {
      ...p,
      reportDate: date,
      income: incomeFromStatementRows(statementsByDate.get(date) ?? []),
      balance: {},
      cashflow: {},
    };

    for (const spec of FIELD_SPECS) {
      let v: number | null = null;
      if (spec.section === "balance") {
        v = cur.get(spec.yd!) ?? null; // _AQ: số dư thời điểm
      } else if (mode === "year") {
        v = cur.get(spec.yd!) ?? null;
      } else {
        v = cur.get(spec.qr ?? "") ?? null;
        if (v == null && spec.yd) {
          const ydCur = cur.get(spec.yd) ?? null;
          if (prevDate == null) {
            v = ydCur; // Q1: lũy kế = riêng quý
          } else if (ydCur != null && prev) {
            const ydPrev = prev.get(spec.yd) ?? null;
            if (ydPrev != null) v = ydCur - ydPrev; // hiệu 2 số lũy kế đã công bố
          }
        }
      }
      if (v == null) continue; // không có số thật → để trống, UI hiện "–"
      q[spec.section][spec.field] = v / TY;
    }

    // Tổng nợ = tổng tài sản − vốn chủ (đẳng thức kế toán, cả hai đều công bố).
    if (q.balance.totalAssets != null && q.balance.equity != null) {
      q.balance.totalLiabilities = q.balance.totalAssets - q.balance.equity;
    }

    // Lấp các đề mục còn thiếu từ chính BCTC (model 1 cân đối, model 3 LCTT).
    // Ratios luôn thắng (giữ chuẩn TOTAL_ASSETS_AQ/OWNERS_EQUITY_AQ đã đối
    // chiếu với terminal); statements chỉ bổ sung ô ratios không có.
    const stmtRows = statementsByDate.get(date) ?? [];
    const stmtBalance = balanceFromStatementRows(stmtRows);
    for (const [f, v] of Object.entries(stmtBalance)) {
      if (q.balance[f] == null) q.balance[f] = v;
    }
    if (q.balance.totalLiabilitiesEquity == null && stmtBalance.totalAssets != null) {
      q.balance.totalLiabilitiesEquity = stmtBalance.totalAssets;
    }
    const stmtCashflow = cashflowFromStatementRows(stmtRows);
    for (const [f, v] of Object.entries(stmtCashflow)) {
      if (q.cashflow[f] == null) q.cashflow[f] = v;
    }
    const filled =
      Object.keys(q.income).length + Object.keys(q.balance).length + Object.keys(q.cashflow).length;
    if (filled > 0) out.push(q);
  }
  return out;
}

/** Các ngày 31/12 đã hoàn tất, mới nhất trước (cho chế độ năm). */
export function lastYearEnds(count: number, now = new Date()): string[] {
  const out: string[] = [];
  let y = now.getUTCFullYear();
  while (out.length < count) {
    // 31/12 của năm y chỉ "hoàn tất" khi đã sang năm sau
    if (now.getUTCFullYear() > y || (now.getUTCFullYear() === y && now.getUTCMonth() === 11 && now.getUTCDate() >= 31)) {
      out.push(`${y}-12-31`);
    }
    y -= 1;
  }
  return out;
}

/**
 * Kéo BCTC HỢP NHẤT nhiều kỳ từ finfo. fetchImpl tiêm được để test và để
 * browser gọi thẳng khi server không có lối ra mạng.
 *
 * Chiến lược request (bền vững, ít bị chặn):
 *  - KQKD hợp nhất: MỘT truy vấn dải fiscalDate:gte (không có dòng ngày).
 *  - ratios (cân đối _AQ + CFO): gọi theo từng ngày cuối quý vì endpoint này
 *    lẫn dòng ngày giao dịch nên không dùng truy vấn dải được; kèm quý liền
 *    trước quý cũ nhất để tính hiệu lũy kế cho cột cuối.
 *  - Mỗi request lỗi được retry 1 lần; chạy ≤3 luồng song song.
 *  - Nếu truy vấn dải trả về trống (môi trường lạ) → fallback gọi từng kỳ.
 */
export async function fetchFinfoRatioQuarters(
  symbol: string,
  limit: number,
  fetchImpl: typeof fetch,
  mode: "quarter" | "year" = "quarter",
): Promise<{ quarters: FinfoQuarter[]; urls: string[]; warnings: string[] }> {
  const baseDates =
    mode === "year" ? lastYearEnds(Math.max(1, limit)) : lastQuarterEnds(Math.max(1, limit));
  // Với MỌI quý trong bảng: nếu quý liền trước cùng năm không nằm trong
  // bảng, vẫn kéo ratios của nó để tính hiệu lũy kế (CFO…) — nếu không cột
  // cũ nhất sẽ mất dòng tiền và bị loại khỏi bảng (loadPreferred yêu cầu đủ
  // income+balance+cashflow). Income không cần vì modelType 2 đã là số riêng quý.
  const extraDates =
    mode === "year"
      ? []
      : [
          ...new Set(
            baseDates
              .map((d) => prevQuarterEnd(d))
              .filter((d): d is string => Boolean(d) && !baseDates.includes(d!)),
          ),
        ];
  const ratioDates = [...baseDates, ...extraDates];
  const warnings: string[] = [];
  const ratiosByDate = new Map<string, FinfoRatioRow[]>();
  const statementsByDate = new Map<string, FinfoStatementRow[]>();
  const statementsRangeUrl = finfoStatementsRangeUrl(symbol, baseDates[baseDates.length - 1]);
  const statementUrls = baseDates.map((d) => finfoStatementsUrl(symbol, d));
  const ratioUrls = ratioDates.map((d) => finfoRatiosUrl(symbol, d));

  const getJson = async <T,>(url: string): Promise<T[] | null> => {
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(9_000),
      });
      if (!res.ok) {
        warnings.push(`finfo HTTP ${res.status}`);
        return null;
      }
      const payload = (await res.json()) as { data?: T[] };
      return payload?.data ?? [];
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : "finfo failed");
      return null;
    }
  };

  // Mạng/HTTP lỗi → thử lại 1 lần (rớt 1 kỳ là bảng mất cả cột, nên phải bền).
  const getJsonRetry = async <T,>(url: string): Promise<T[] | null> => {
    const first = await getJson<T>(url);
    if (first !== null) return first;
    await new Promise((r) => setTimeout(r, 700));
    return getJson<T>(url);
  };

  // Giới hạn 3 luồng song song để không bị nguồn chặn khi gọi bùng phát
  // nhiều kỳ (nguyên nhân từng khiến các quý xa rơi mất ở môi trường thật).
  const runPool = async (tasks: Array<() => Promise<void>>): Promise<void> => {
    let next = 0;
    const workers = Array.from({ length: Math.min(3, tasks.length) }, async () => {
      while (next < tasks.length) {
        const task = tasks[next];
        next += 1;
        await task();
      }
    });
    await Promise.all(workers);
  };

  await runPool([
    async () => {
      const rows = await getJsonRetry<FinfoStatementRow>(statementsRangeUrl);
      for (const row of rows ?? []) {
        const d = row?.fiscalDate;
        if (typeof d === "string" && baseDates.includes(d)) {
          statementsByDate.set(d, [...(statementsByDate.get(d) ?? []), row]);
        }
      }
    },
    ...ratioDates.map(
      (date, i) => async () => {
        const ratios = await getJsonRetry<FinfoRatioRow>(ratioUrls[i]);
        if (ratios) ratiosByDate.set(date, ratios);
      },
    ),
  ]);

  // Truy vấn dải trống (môi trường lạ) → fallback gọi từng kỳ như cũ.
  if (statementsByDate.size === 0) {
    await runPool(
      baseDates.map(
        (date, i) => async () => {
          const statements = await getJsonRetry<FinfoStatementRow>(statementUrls[i]);
          if (statements && statements.length > 0) statementsByDate.set(date, statements);
        },
      ),
    );
  }

  // Kỳ nào vẫn thiếu KQKD (nguồn sống bị chặn) → lấp bằng bản sao lưu có
  // nhãn ngày, để bảng xem được tại chỗ; live luôn thắng khi reachable.
  const snap = FINFO_STATEMENTS_SNAPSHOT[symbol.toUpperCase()];
  if (snap) {
    for (const date of baseDates) {
      if (statementsByDate.has(date)) continue;
      const rows = snap[date];
      if (!rows) continue;
      statementsByDate.set(
        date,
        rows.map(([modelType, itemCode, numericValue]) => ({
          itemCode,
          numericValue,
          modelType,
          reportType: "QUARTER",
          fiscalDate: date,
        })),
      );
      warnings.push(`BCTC ${date}: dùng bản sao lưu ${FINFO_SNAPSHOT_AS_OF} (nguồn sống bị chặn)`);
    }
  }

  const quarters = quartersFromFinfoRows(ratiosByDate, statementsByDate, mode)
    .filter((q) => baseDates.includes(q.reportDate))
    .slice(0, limit);
  return { quarters, urls: [statementsRangeUrl, ...ratioUrls], warnings };
}
