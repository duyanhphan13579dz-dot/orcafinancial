/**
 * Phân tích chi tiết một chỉ số thị trường (VNINDEX / HNX / UPCOM).
 *
 * Nguồn dữ liệu THẬT:
 * - Bars lịch sử + intraday: vndirect dchart (công khai, gọi từ server).
 * - Động lực: báo giá thật của các mã vốn hóa lớn thành phần (getQuotes).
 * - Khối ngoại: CHƯA có nguồn miễn phí được xác minh → trả status
 *   "unavailable" thay vì bịa số (Verified Financial Data policy).
 */
import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { vndirectHistory } from "@/lib/connectors/providers";
import { getQuotes } from "@/lib/market";
import { assessIndex, computeIndexStats, rankDrivers } from "@/lib/index-analysis";

export const dynamic = "force-dynamic";

const INDEX_META: Record<string, { name: string; exchange: string; constituents: string[] }> = {
  VNINDEX: {
    name: "VN-Index",
    exchange: "HOSE",
    constituents: [
      "VCB", "VIC", "VHM", "VNM", "FPT", "HPG", "MWG", "TCB", "BID", "CTG",
      "VRE", "SSI", "GAS", "MSN", "VJC", "STB", "VPB", "HDB",
    ],
  },
  HNX: {
    name: "HNX-Index",
    exchange: "HNX",
    constituents: ["SHS", "CEO", "PVS", "MBS", "VCS", "LAS", "TNG", "IDC"],
  },
  UPCOM: {
    name: "UPCOM-Index",
    exchange: "UPCOM",
    constituents: ["ACV", "BSR", "QNS", "VGI", "MSR", "VTP", "LTG", "MCH"],
  },
};

const RANGE_DAYS: Record<string, number> = {
  "1M": 40,
  "3M": 100,
  "6M": 195,
  "1Y": 370,
  "3Y": 1100,
  "5Y": 1900,
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const meta = INDEX_META[code];
  if (!meta) return fail(`Chỉ số không hỗ trợ: ${raw}. Hỗ trợ: VNINDEX, HNX, UPCOM.`, 404);

  const range = req.nextUrl.searchParams.get("range") ?? "6M";
  const days = RANGE_DAYS[range] ?? RANGE_DAYS["6M"];
  const now = Math.floor(Date.now() / 1000);

  try {
    type Bars = Awaited<ReturnType<typeof vndirectHistory>>;
    const [daily, yearBars, intraday] = await Promise.all([
      vndirectHistory(code, now - days * 86400, now, "D", { timeoutMs: 8_000, retries: 1 }).catch(
        () => [] as Bars,
      ),
      days >= 370
        ? Promise.resolve([] as Bars)
        : vndirectHistory(code, now - 370 * 86400, now, "D", { timeoutMs: 8_000, retries: 1 }).catch(() => [] as Bars),
      vndirectHistory(code, now - 2 * 86400, now, "1", { timeoutMs: 8_000, retries: 1 }).catch(() => [] as Bars),
    ]);

    const statsBars = yearBars.length > daily.length ? yearBars : daily;
    const stats = computeIndexStats(statsBars);
    const assessment = assessIndex(stats);

    let drivers: ReturnType<typeof rankDrivers> = {
      gainers: [],
      losers: [],
      note: "Chưa lấy được báo giá thành phần.",
    };
    try {
      const quotes = await getQuotes(meta.constituents, {
        persist: false,
        allowStale: true,
        fast: true,
      });
      drivers = rankDrivers(
        quotes.map((q) => ({ symbol: q.symbol, close: q.close, changePct: q.changePct, volume: q.volume })),
      );
    } catch {
      // giữ drivers rỗng — không bịa
    }

    return ok(
      {
        code,
        name: meta.name,
        exchange: meta.exchange,
        range,
        source: "vndirect-dchart",
        intraday,
        history: daily,
        stats,
        assessment,
        drivers,
        foreign: {
          status: "unavailable",
          buyValue: null,
          sellValue: null,
          netValue: null,
          note: "Chưa có nguồn khối ngoại miễn phí được xác minh cho chỉ số. Dán XHR khối ngoại (DevTools) để wire nguồn thật — hệ thống không hiển thị số liệu giả.",
        },
      },
      { cacheSeconds: 30 },
    );
  } catch (err) {
    return handleError(err, `index-analysis:${code}`);
  }
}
