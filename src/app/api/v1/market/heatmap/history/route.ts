import { NextRequest } from "next/server";
import { asc, and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { priceSnapshotHistory } from "@/db/schema";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getHistory } from "@/lib/market";

export const dynamic = "force-dynamic";

type HistoryBar = { time: number; open: number; high: number; low: number; close: number; volume: number };

const TIMEFRAME_DAYS: Record<string, number> = {
  "1D": 5,
  "1W": 30,
  "1M": 120,
  "3M": 400,
  YTD: 500,
  "1Y": 1100,
};

function aggregateBars(bars: HistoryBar[], timeframe: string): HistoryBar[] {
  if (timeframe === "1D") return bars;
  const grouped = new Map<string, HistoryBar[]>();
  for (const bar of bars) {
    const date = new Date(bar.time * 1000);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    let key = `${year}`;
    if (timeframe === "1W") {
      const monday = new Date(Date.UTC(year, month, date.getUTCDate()));
      const day = monday.getUTCDay() || 7;
      monday.setUTCDate(monday.getUTCDate() - day + 1);
      key = monday.toISOString().slice(0, 10);
    } else if (timeframe === "1M" || timeframe === "YTD") key = `${year}-${String(month + 1).padStart(2, "0")}`;
    else if (timeframe === "3M") key = `${year}-Q${Math.floor(month / 3) + 1}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(bar);
    grouped.set(key, bucket);
  }
  return [...grouped.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.time - b.time);
    return { time: sorted[0].time, open: sorted[0].open, high: Math.max(...sorted.map((bar) => bar.high)), low: Math.min(...sorted.map((bar) => bar.low)), close: sorted[sorted.length - 1].close, volume: sorted.reduce((sum, bar) => sum + bar.volume, 0) };
  });
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim() ?? "";
  const timeframe = (req.nextUrl.searchParams.get("timeframe") ?? "1M").toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  if (!(timeframe in TIMEFRAME_DAYS)) return fail("Invalid timeframe", 400);
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = new Date((to - 86400 * TIMEFRAME_DAYS[timeframe]) * 1000);
    const historyRows = await db
      .select()
      .from(priceSnapshotHistory)
      .where(and(eq(priceSnapshotHistory.symbol, symbol), gte(priceSnapshotHistory.time, from)))
      .orderBy(asc(priceSnapshotHistory.time))
      .limit(2000);
    const rawBars: HistoryBar[] = historyRows.length >= 2
      ? historyRows.map((row) => ({ time: Math.floor(row.time.getTime() / 1000), open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume }))
      : (await getHistory(symbol, to - 86400 * TIMEFRAME_DAYS[timeframe], to, "D")).bars;
    const bars = aggregateBars(rawBars, timeframe);
    const source = historyRows.length >= 2 ? "price_snapshot_history" : "market-history-fallback";
    const confidence = historyRows.length >= 2 ? Math.min(...historyRows.map((row) => Number(row.confidence))) : 0.85;
    return ok({ symbol, timeframe, bars }, { source, confidence, points: bars.length, timestamp: new Date().toISOString() }, { cacheSeconds: 30 });
  } catch (err) {
    return handleError(err, `heatmap_history:${symbol}`);
  }
}
