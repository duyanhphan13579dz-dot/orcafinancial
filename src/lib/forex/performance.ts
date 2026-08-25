/**
 * Phase 14 — Performance Analytics
 * Win rate, R:R, profit factor by pair / timeframe / confidence bucket.
 */

import { listClosedTrades, type JournalEntry } from "./journal";

export interface BucketStat {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgR: number | null;
  profitFactor: number | null;
  totalPnl: number;
}

export interface PerformanceReport {
  asOf: string;
  totalSignals: number;
  winRate: number;
  avgRR: number | null;
  profitFactor: number | null;
  totalPnl: number;
  byPair: BucketStat[];
  byTimeframe: BucketStat[];
  byConfidence: BucketStat[];
  byEmotion: BucketStat[];
  recent: JournalEntry[];
  calibrationNote: string;
}

function bucketize(trades: JournalEntry[], keyFn: (t: JournalEntry) => string): BucketStat[] {
  const map = new Map<string, JournalEntry[]>();
  for (const t of trades) {
    const k = keyFn(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }

  const stats: BucketStat[] = [];
  for (const [key, list] of map) {
    const wins = list.filter((t) => t.result === "WIN").length;
    const losses = list.filter((t) => t.result === "LOSS").length;
    const be = list.filter((t) => t.result === "BREAKEVEN").length;
    const decided = wins + losses;
    const rs = list.map((t) => t.rMultiple).filter((x): x is number => x != null);
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    const grossWin = list
      .filter((t) => (t.pnlUsd ?? 0) > 0)
      .reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
    const grossLoss = Math.abs(
      list
        .filter((t) => (t.pnlUsd ?? 0) < 0)
        .reduce((s, t) => s + (t.pnlUsd ?? 0), 0),
    );
    const pf =
      grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null;
    stats.push({
      key,
      trades: list.length,
      wins,
      losses,
      breakeven: be,
      winRate: decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : 0,
      avgR: avgR != null ? Number(avgR.toFixed(2)) : null,
      profitFactor:
        pf == null ? null : Number.isFinite(pf) ? Number(pf.toFixed(2)) : 99,
      totalPnl: Number(
        list.reduce((s, t) => s + (t.pnlUsd ?? 0), 0).toFixed(2),
      ),
    });
  }

  return stats.sort((a, b) => b.trades - a.trades);
}

function confidenceBucket(c: number | null): string {
  if (c == null) return "unknown";
  const pct = c <= 1 ? c * 100 : c;
  if (pct < 50) return "<50%";
  if (pct < 60) return "50–60%";
  if (pct < 70) return "60–70%";
  if (pct < 80) return "70–80%";
  if (pct < 90) return "80–90%";
  return "90%+";
}

export async function buildPerformanceReport(userId?: string): Promise<PerformanceReport> {
  const trades = await listClosedTrades(userId);
  const wins = trades.filter((t) => t.result === "WIN").length;
  const losses = trades.filter((t) => t.result === "LOSS").length;
  const decided = wins + losses;
  const rs = trades.map((t) => t.rMultiple).filter((x): x is number => x != null);
  const avgRR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  const grossWin = trades
    .filter((t) => (t.pnlUsd ?? 0) > 0)
    .reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const grossLoss = Math.abs(
    trades
      .filter((t) => (t.pnlUsd ?? 0) < 0)
      .reduce((s, t) => s + (t.pnlUsd ?? 0), 0),
  );
  const pf =
    grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : null;

  const byConfidence = bucketize(trades, (t) => confidenceBucket(t.confidence));
  const highConf = byConfidence.find((b) => b.key === "80–90%" || b.key === "90%+");
  const calibrationNote =
    trades.length < 20
      ? "Chưa đủ mẫu (<20 closed trades) để calibrate confidence tin cậy."
      : highConf && highConf.winRate < 65
        ? `Confidence cao đang overfit — win rate bucket cao chỉ ${highConf.winRate}%. Cần siết gate.`
        : highConf && highConf.winRate >= 75
          ? `Confidence calibrate tốt: bucket cao thắng ${highConf.winRate}%.`
          : "Tiếp tục thu thập journal để tinh chỉnh confidence bands.";

  return {
    asOf: new Date().toISOString(),
    totalSignals: trades.length,
    winRate: decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : 0,
    avgRR: avgRR != null ? Number(avgRR.toFixed(2)) : null,
    profitFactor: pf == null ? null : Number(Number(pf).toFixed(2)),
    totalPnl: Number(trades.reduce((s, t) => s + (t.pnlUsd ?? 0), 0).toFixed(2)),
    byPair: bucketize(trades, (t) => t.symbol),
    byTimeframe: bucketize(trades, (t) => t.timeframe),
    byConfidence,
    byEmotion: bucketize(trades, (t) => t.emotion ?? "unknown"),
    recent: trades.slice(0, 15),
    calibrationNote,
  };
}
