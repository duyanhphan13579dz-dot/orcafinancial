/**
 * Phân tích chỉ số tài chính — thuần định lượng, tính từ bars lịch sử THẬT
 * (vndirect dchart) và báo giá THẬT của các mã thành phần. Không dùng LLM,
 * không bịa số: thiếu dữ liệu thì trả null / "unknown".
 */
import type { Ohlcv } from "@/lib/connectors/core";

export interface IndexStats {
  last: number;
  prevClose: number | null;
  changeAbs: number | null;
  changePct: number | null;
  high: number;
  low: number;
  volume: number;
  ma20: number | null;
  ma50: number | null;
  week52High: number | null;
  week52Low: number | null;
  /** % thay đổi trong ~1 tháng giao dịch */
  mom1mPct: number | null;
  /** % thay đổi trong ~3 tháng giao dịch */
  mom3mPct: number | null;
  /** % cách đỉnh 52 tuần (âm = dưới đỉnh) */
  off52wHighPct: number | null;
  /** biến động năm (stdev ln-return 20 phiên * sqrt(252)) */
  volatilityAnnPct: number | null;
  avgVolume20d: number | null;
  barsUsed: number;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function computeIndexStats(bars: Ohlcv[]): IndexStats | null {
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return null;
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const closes = sorted.map((b) => b.close);
  const ma20 = avg(closes.slice(-20));
  const ma50 = avg(closes.slice(-50));
  const year = closes.slice(-252);
  const week52High = year.length ? Math.max(...year) : null;
  const week52Low = year.length ? Math.min(...year) : null;
  const mom = (back: number): number | null => {
    if (closes.length < back + 1) return null;
    const base = closes[closes.length - 1 - back];
    if (base <= 0) return null;
    return ((last.close - base) / base) * 100;
  };
  const rets: number[] = [];
  for (let i = Math.max(1, closes.length - 21); i < closes.length; i += 1) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  let volatilityAnnPct: number | null = null;
  if (rets.length >= 5) {
    const m = rets.reduce((s, v) => s + v, 0) / rets.length;
    const varr = rets.reduce((s, v) => s + (v - m) * (v - m), 0) / (rets.length - 1);
    volatilityAnnPct = Math.sqrt(varr) * Math.sqrt(252) * 100;
  }
  const changeAbs = last.close - prev.close;
  return {
    last: last.close,
    prevClose: prev.close,
    changeAbs,
    changePct: prev.close > 0 ? (changeAbs / prev.close) * 100 : null,
    high: last.high,
    low: last.low,
    volume: last.volume,
    ma20,
    ma50,
    week52High,
    week52Low,
    mom1mPct: mom(21),
    mom3mPct: mom(63),
    off52wHighPct:
      week52High && week52High > 0 ? ((last.close - week52High) / week52High) * 100 : null,
    volatilityAnnPct,
    avgVolume20d: avg(sorted.slice(-20).map((b) => b.volume)),
    barsUsed: sorted.length,
  };
}

export interface IndexSignal {
  label: string;
  value: string;
  tone: "up" | "down" | "flat";
}

export interface IndexAssessment {
  trend: "up" | "down" | "sideways";
  trendLabel: string;
  risk: "low" | "medium" | "high";
  summary: string;
  signals: IndexSignal[];
}

const fmt = (v: number | null, digits = 2): string =>
  v == null ? "—" : v.toLocaleString("vi-VN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function assessIndex(stats: IndexStats | null): IndexAssessment {
  if (!stats) {
    return {
      trend: "sideways",
      trendLabel: "Chưa đủ dữ liệu",
      risk: "medium",
      summary: "Chưa đủ bars lịch sử để đánh giá. Hệ thống không suy đoán khi thiếu dữ liệu thật.",
      signals: [],
    };
  }
  const signals: IndexSignal[] = [];
  let trendScore = 0;

  if (stats.ma20 != null) {
    const above = stats.last > stats.ma20;
    trendScore += above ? 1 : -1;
    signals.push({
      label: "So với MA20",
      value: above ? `Trên MA20 (${fmt(stats.ma20)})` : `Dưới MA20 (${fmt(stats.ma20)})`,
      tone: above ? "up" : "down",
    });
  }
  if (stats.ma20 != null && stats.ma50 != null) {
    const golden = stats.ma20 > stats.ma50;
    trendScore += golden ? 1 : -1;
    signals.push({
      label: "Cấu trúc MA20/MA50",
      value: golden ? "MA20 nằm trên MA50 — xu hướng ngắn hạn tích cực" : "MA20 nằm dưới MA50 — xu hướng ngắn hạn tiêu cực",
      tone: golden ? "up" : "down",
    });
  }
  if (stats.mom1mPct != null) {
    signals.push({
      label: "Động lượng 1 tháng",
      value: `${stats.mom1mPct >= 0 ? "+" : ""}${fmt(stats.mom1mPct)}%`,
      tone: stats.mom1mPct > 0.5 ? "up" : stats.mom1mPct < -0.5 ? "down" : "flat",
    });
    trendScore += stats.mom1mPct > 0.5 ? 1 : stats.mom1mPct < -0.5 ? -1 : 0;
  }
  if (stats.off52wHighPct != null) {
    signals.push({
      label: "Vị trí so với đỉnh 52 tuần",
      value: `${fmt(stats.off52wHighPct)}% so với đỉnh`,
      tone: stats.off52wHighPct > -3 ? "up" : stats.off52wHighPct < -15 ? "down" : "flat",
    });
  }
  if (stats.volatilityAnnPct != null) {
    signals.push({
      label: "Biến động năm (20 phiên)",
      value: `${fmt(stats.volatilityAnnPct, 1)}%`,
      tone: stats.volatilityAnnPct > 25 ? "down" : "flat",
    });
  }

  const trend: IndexAssessment["trend"] = trendScore >= 2 ? "up" : trendScore <= -2 ? "down" : "sideways";
  const trendLabel =
    trend === "up" ? "XU HƯỚNG TĂNG" : trend === "down" ? "XU HƯỚNG GIẢM" : "TÍCH LŨ / ĐI NGANG";
  const risk: IndexAssessment["risk"] =
    trend === "down" && (stats.mom3mPct ?? 0) < -5
      ? "high"
      : trend === "sideways"
        ? "medium"
        : (stats.volatilityAnnPct ?? 0) > 25
          ? "medium"
          : "low";

  const parts: string[] = [];
  parts.push(
    trend === "up"
      ? `Chỉ số đang trong nhịp tăng: đóng cửa trên các đường trung bình động chủ đạo.`
      : trend === "down"
        ? `Chỉ số đang trong nhịp giảm: đóng cửa dưới các đường trung bình động chủ đạo.`
        : `Chỉ số đang tích lũy: giá dao động quanh các đường trung bình động.`,
  );
  if (stats.mom1mPct != null) {
    parts.push(
      stats.mom1mPct >= 0
        ? `Động lượng 1 tháng dương (+${fmt(stats.mom1mPct)}%).`
        : `Động lượng 1 tháng âm (${fmt(stats.mom1mPct)}%).`,
    );
  }
  if (stats.off52wHighPct != null) {
    parts.push(
      stats.off52wHighPct > -3
        ? `Đang ở vùng đỉnh 52 tuần — cần lưu ý rủi ro chốt lời.`
        : `Đang cách đỉnh 52 tuần ${fmt(Math.abs(stats.off52wHighPct))}% .`,
    );
  }
  parts.push(
    risk === "high"
      ? "Rủi ro ngắn hạn ở mức CAO — ưu tiên quản trị danh mục."
      : risk === "medium"
        ? "Rủi ro ngắn hạn ở mức TRUNG BÌNH — quan sát phản ứng tại MA20/MA50."
        : "Rủi ro ngắn hạn ở mức THẤP — cấu trúc xu hướng chưa bị phá vỡ.",
  );

  return { trend, trendLabel, risk, summary: parts.join(" "), signals };
}

export interface DriverQuote {
  symbol: string;
  close: number;
  changePct: number | null;
  volume: number;
}

export interface IndexDrivers {
  gainers: DriverQuote[];
  losers: DriverQuote[];
  note: string;
}

/**
 * "Động lực" của chỉ số ước lượng từ biến động của các mã vốn hóa lớn thành phần
 * (xếp theo |% thay đổi|). Chưa có rổ trọng số chính thức nên ghi rõ là ước lượng.
 */
export function rankDrivers(quotes: DriverQuote[]): IndexDrivers {
  const valid = quotes.filter((q) => q.changePct != null);
  const sorted = [...valid].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  return {
    gainers: sorted.filter((q) => (q.changePct ?? 0) > 0).slice(0, 5),
    losers: sorted.filter((q) => (q.changePct ?? 0) < 0).slice(-5).reverse(),
    note: "Ước lượng từ biến động các mã vốn hóa lớn thành phần (chưa áp rổ trọng số chính thức của chỉ số).",
  };
}
