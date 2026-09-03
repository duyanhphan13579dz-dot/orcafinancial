/**
 * VNDirect finfo PUBLIC client — dùng chung cho server lẫn browser.
 *
 * Sự thật rút ra từ khảo sát trực tiếp API (2026-09-03):
 *  - /v4/financial_statements trả dạng long-format KHÔNG có tên chỉ tiêu
 *    (chỉ itemCode + numericValue) nên không thể gắn nhãn tiếng Việt an toàn.
 *  - /v4/ratios?q=code:{SYM}~reportDate:{YYYY-MM-DD}&size=2000 trả ~245 chỉ
 *    tiêu CÓ itemName tiếng Việt chính thức của VNDirect, trong đó có đủ các
 *    dòng cốt lõi của 3 báo cáo (doanh thu, lợi nhuận gộp, LNST, tổng tài
 *    sản, vốn chủ, CFO, EPS, BVPS…). Giá trị tiền tệ tính bằng VND; chỉ số
 *    trên mỗi cổ phiếu (EPS/BVPS) tính bằng VND/cp.
 *  - Hậu tố _YD = lũy kế từ đầu năm đến reportDate (chuẩn BCTC quý VN),
 *    _AQ = số dư tại thời điểm reportDate, _QR = riêng quý.
 * Vì vậy /v4/ratios là nguồn MẶC ĐỊNH để dựng bảng BCTC có nhãn xác minh
 * được; financial_statements chỉ dùng khi có ánh xạ itemCode chính thức.
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

/** Ánh xạ ratioCode → ô chuẩn hóa. `tỷ` = chia 1e9; per-share giữ nguyên VND. */
export const RATIO_FIELD_MAP: Record<
  string,
  { section: "income" | "balance" | "cashflow"; field: string; perShare?: boolean }
> = {
  TOTAL_SALES_YD: { section: "income", field: "revenue" },
  NET_SALES_YD: { section: "income", field: "netRevenue" },
  GROSS_PROFIT_YD: { section: "income", field: "grossProfit" },
  OPERATING_PROFIT_YD: { section: "income", field: "operatingIncome" },
  NET_PROFIT_YD: { section: "income", field: "netIncome" },
  OPERATING_EBITDA_YD: { section: "income", field: "ebitda" },
  EPS_YD: { section: "income", field: "eps", perShare: true },
  TOTAL_ASSETS_AQ: { section: "balance", field: "totalAssets" },
  CURRENT_ASSETS_AQ: { section: "balance", field: "currentAssets" },
  INVENTORY_AQ: { section: "balance", field: "inventory" },
  OWNERS_EQUITY_AQ: { section: "balance", field: "equity" },
  TOTAL_CAP_AQ: { section: "balance", field: "totalLiabilitiesEquity" },
  BVPS_AQ: { section: "balance", field: "bookValuePerShare", perShare: true },
  CFO_YD: { section: "cashflow", field: "operatingCashFlow" },
};

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

export function finfoRatiosUrl(symbol: string, reportDate: string): string {
  return `${FINFO_API_BASE}/v4/ratios?q=code:${symbol.toUpperCase()}~reportDate:${reportDate}&size=2000`;
}

/**
 * Dựng một quý chuẩn hóa từ mảng rows /v4/ratios của MỘT reportDate.
 * Trả về null nếu không có dòng nào map được.
 */
export function quarterFromRatioRows(rows: FinfoRatioRow[], reportDate: string): FinfoQuarter | null {
  const p = periodFromReportDate(reportDate);
  if (!p) return null;
  const q: FinfoQuarter = { ...p, reportDate, income: {}, balance: {}, cashflow: {} };
  const raw: Record<string, number> = {};
  for (const row of rows) {
    const rc = row?.ratioCode;
    const map = rc ? RATIO_FIELD_MAP[rc] : undefined;
    const v = typeof row?.value === "number" && Number.isFinite(row.value) ? row.value : null;
    if (!map || v == null) continue;
    raw[map.field] = v;
    q[map.section][map.field] = map.perShare ? v : v / TY;
  }
  // Giá vốn = doanh thu thuần − lãi gộp (đồng nhất với itemName từng cấu phần).
  if (raw.netRevenue != null && raw.grossProfit != null) {
    q.income.costOfGoodsSold = (raw.netRevenue - raw.grossProfit) / TY;
  }
  // Tổng nợ = tổng nguồn vốn − vốn chủ (đẳng thức kế toán).
  if (raw.totalLiabilitiesEquity != null && raw.equity != null) {
    q.balance.totalLiabilities = (raw.totalLiabilitiesEquity - raw.equity) / TY;
  }
  const filled = Object.keys(q.income).length + Object.keys(q.balance).length + Object.keys(q.cashflow).length;
  return filled > 0 ? q : null;
}

/**
 * Kéo BCTC nhiều kỳ từ finfo ratios. fetchImpl tiêm được để test và để
 * browser gọi thẳng khi server không có lối ra mạng.
 */
export async function fetchFinfoRatioQuarters(
  symbol: string,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<{ quarters: FinfoQuarter[]; urls: string[]; warnings: string[] }> {
  const dates = lastQuarterEnds(Math.max(1, limit));
  const urls = dates.map((d) => finfoRatiosUrl(symbol, d));
  const warnings: string[] = [];
  const settled = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetchImpl(url, {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(9_000),
        });
        if (!res.ok) {
          warnings.push(`finfo ratios HTTP ${res.status}`);
          return null;
        }
        const payload = (await res.json()) as { data?: FinfoRatioRow[] };
        const date = dates[urls.indexOf(url)];
        return quarterFromRatioRows(payload?.data ?? [], date);
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : "finfo ratios failed");
        return null;
      }
    }),
  );
  const quarters = settled
    .filter((x): x is FinfoQuarter => x != null)
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.period.localeCompare(a.period));
  return { quarters, urls, warnings };
}
