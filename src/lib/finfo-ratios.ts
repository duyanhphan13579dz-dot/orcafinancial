/**
 * VNDirect finfo PUBLIC client — dùng chung cho server lẫn browser.
 *
 * Khảo sát trực tiếp API (2026-09-03):
 *  - /v4/financial_statements trả long-format KHÔNG tên chỉ tiêu → không gắn
 *    nhãn tiếng Việt an toàn được.
 *  - /v4/ratios?q=code:{SYM}~reportDate:{YYYY-MM-DD}&size=2000 trả ~245 chỉ
 *    tiêu CÓ itemName tiếng Việt chính thức của VNDirect, đủ dòng cốt lõi của
 *    3 báo cáo. Hậu tố: _YD = lũy kế từ đầu năm, _QR = RIÊNG quý, _AQ = số dư
 *    tại thời điểm, _TR = 4 quý liền kề.
 *
 * QUY TẮC CƠ SỞ SỐ LIỆU (theo yêu cầu người dùng, đối chiếu BCTC chuẩn):
 *  - Chế độ "quarter": bảng quý phải là số RIÊNG quý → ưu tiên mã _QR; nếu
 *    thiếu _QR thì lấy hiệu hai số _YD liền kề cùng năm (phép trừ chính xác
 *    giữa hai giá trị đã công bố, KHÔNG suy đoán); Q1 dùng chính _YD.
 *  - Chế độ "year": dùng _YD tại 31/12.
 *  - Bảng cân đối luôn dùng _AQ (thời điểm).
 *  - Không có số → bỏ trống (UI hiển thị "–"), tuyệt đối không bịa.
 * Giá trị tiền tệ = VND; EPS/BVPS = VND/cp.
 */

export const FINFO_API_BASE = "https://api-finfo.vndirect.com.vn";

export interface FinfoRatioRow {
  code?: string;
  group?: string;
  reportDate?: string;
  ratioCode?: string;
  itemCode?: string | number;
  itemName?: string;
  value?: number | null;
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

/** Mỗi ô chuẩn hóa: mã _QR (riêng quý), mã _YD (lũy kế/năm), perShare giữ VND. */
interface FieldSpec {
  section: Section;
  field: string;
  qr?: string;
  yd?: string;
  perShare?: boolean;
}

export const FIELD_SPECS: FieldSpec[] = [
  // Kết quả kinh doanh
  { section: "income", field: "totalRevenue", qr: "TOTAL_SALES_QR", yd: "TOTAL_SALES_YD" },
  { section: "income", field: "revenue", qr: "NET_SALES_QR", yd: "NET_SALES_YD" },
  { section: "income", field: "costOfGoodsSold", qr: "COGS_QR" },
  { section: "income", field: "grossProfit", qr: "GROSS_PROFIT_QR", yd: "GROSS_PROFIT_YD" },
  { section: "income", field: "operatingIncome", qr: "OPERATING_PROFIT_QR", yd: "OPERATING_PROFIT_YD" },
  { section: "income", field: "netIncome", qr: "NET_PROFIT_QR", yd: "NET_PROFIT_YD" },
  { section: "income", field: "ebitda", qr: "OPERATING_EBITDA_QR", yd: "OPERATING_EBITDA_YD" },
  { section: "income", field: "eps", yd: "EPS_YD", perShare: true },
  // Bảng cân đối (thời điểm). KHÔNG dùng TOTAL_CAP_AQ ("Tổng vốn") làm tổng
  // nguồn vốn: với VIC nó ≠ tổng tài sản (210.740 tỷ vs 1.308.938 tỷ).
  { section: "balance", field: "currentAssets", yd: "CURRENT_ASSETS_AQ" },
  { section: "balance", field: "inventory", yd: "INVENTORY_AQ" },
  { section: "balance", field: "totalAssets", yd: "TOTAL_ASSETS_AQ" },
  { section: "balance", field: "equity", yd: "OWNERS_EQUITY_AQ" },
  { section: "balance", field: "totalLiabilitiesEquity", yd: "TOTAL_ASSETS_AQ" },
  { section: "balance", field: "bookValuePerShare", yd: "BVPS_AQ", perShare: true },
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

function valuesByCode(rows: FinfoRatioRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row?.ratioCode && typeof row.value === "number" && Number.isFinite(row.value)) {
      map.set(row.ratioCode, row.value);
    }
  }
  return map;
}

/**
 * Dựng các quý chuẩn hóa từ rows /v4/ratios của nhiều reportDate.
 * mode "quarter" → số riêng quý; "year" → lũy kế năm (chỉ dùng cho kỳ 31/12).
 */
export function quartersFromRatioRows(
  rowsByDate: Map<string, FinfoRatioRow[]>,
  mode: "quarter" | "year",
): FinfoQuarter[] {
  const dates = [...rowsByDate.keys()].sort((a, b) => b.localeCompare(a));
  const out: FinfoQuarter[] = [];
  for (const date of dates) {
    const p = periodFromReportDate(date);
    if (!p) continue;
    if (mode === "year" && !date.endsWith("12-31")) continue;
    const cur = valuesByCode(rowsByDate.get(date) ?? []);
    const prevDate = prevQuarterEnd(date);
    const prev = prevDate && rowsByDate.has(prevDate) ? valuesByCode(rowsByDate.get(prevDate)!) : null;
    const q: FinfoQuarter = { ...p, reportDate: date, income: {}, balance: {}, cashflow: {} };

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
      q[spec.section][spec.field] = spec.perShare ? v : v / TY;
    }

    // Tổng nợ = tổng tài sản − vốn chủ (đẳng thức kế toán, cả hai đều công bố).
    if (q.balance.totalAssets != null && q.balance.equity != null) {
      q.balance.totalLiabilities = q.balance.totalAssets - q.balance.equity;
    }
    const filled =
      Object.keys(q.income).length + Object.keys(q.balance).length + Object.keys(q.cashflow).length;
    if (filled > 0) out.push(q);
  }
  return out;
}

/**
 * Kéo BCTC nhiều kỳ từ finfo ratios. fetchImpl tiêm được để test và để
 * browser gọi thẳng khi server không có lối ra mạng.
 */
export async function fetchFinfoRatioQuarters(
  symbol: string,
  limit: number,
  fetchImpl: typeof fetch,
  mode: "quarter" | "year" = "quarter",
): Promise<{ quarters: FinfoQuarter[]; urls: string[]; warnings: string[] }> {
  // quarter mode cần thêm quý liền trước cùng năm để lấy hiệu lũy kế khi thiếu _QR.
  const baseDates = lastQuarterEnds(Math.max(1, limit));
  const extra = new Set<string>();
  if (mode === "quarter") {
    for (const d of baseDates) {
      const pd = prevQuarterEnd(d);
      if (pd && !baseDates.includes(pd)) extra.add(pd);
    }
  }
  const dates = [...baseDates, ...extra].sort((a, b) => b.localeCompare(a));
  const urls = dates.map((d) => finfoRatiosUrl(symbol, d));
  const warnings: string[] = [];
  const rowsByDate = new Map<string, FinfoRatioRow[]>();
  await Promise.all(
    dates.map(async (date, i) => {
      try {
        const res = await fetchImpl(urls[i], {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(9_000),
        });
        if (!res.ok) {
          warnings.push(`finfo ratios HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as { data?: FinfoRatioRow[] };
        rowsByDate.set(date, payload?.data ?? []);
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : "finfo ratios failed");
      }
    }),
  );
  const quarters = quartersFromRatioRows(rowsByDate, mode)
    .filter((q) => baseDates.includes(q.reportDate))
    .slice(0, limit);
  return { quarters, urls: baseDates.map((d) => finfoRatiosUrl(symbol, d)), warnings };
}
