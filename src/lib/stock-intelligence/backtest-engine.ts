export type BacktestSignal = "BUY" | "SELL" | "HOLD";

export interface SignalRecord { index: number; time: number; signal: BacktestSignal; entryPrice: number; exitPrice: number | null; returnPct: number | null; correct: boolean | null; modelVersion: string; }
export interface BacktestResult { symbol: string; modelVersion: string; signalHistory: SignalRecord[]; metrics: { recommendationAccuracy: number; averageReturn: number; winRate: number; maxDrawdown: number; sharpe: number; profitFactor: number; totalSignals: number }; dataConfidence: number; status: "ready" | "insufficient_data"; disclaimer: string; }

const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const stdev = (values: number[]) => { const mean = avg(values); return values.length > 1 ? Math.sqrt(avg(values.map((value) => (value - mean) ** 2))) : 0; };

export function runMovingAverageBacktest(input: { symbol: string; bars: Array<{ time: number; close: number }>; shortWindow?: number; longWindow?: number; horizon?: number; modelVersion?: string; }): BacktestResult {
  const shortWindow = input.shortWindow ?? 20;
  const longWindow = input.longWindow ?? 50;
  const horizon = input.horizon ?? 10;
  const modelVersion = input.modelVersion ?? "ORCA Signal v1.0";
  const bars = input.bars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
  if (bars.length < longWindow + horizon + 5) return { symbol: input.symbol, modelVersion, signalHistory: [], metrics: { recommendationAccuracy: 0, averageReturn: 0, winRate: 0, maxDrawdown: 0, sharpe: 0, profitFactor: 0, totalSignals: 0 }, dataConfidence: 0.2, status: "insufficient_data", disclaimer: "Cần đủ lịch sử giá trước khi đánh giá signal." };
  const records: SignalRecord[] = [];
  for (let i = longWindow; i < bars.length - horizon; i += 1) {
    const shortMean = avg(bars.slice(i - shortWindow, i).map((bar) => bar.close));
    const longMean = avg(bars.slice(i - longWindow, i).map((bar) => bar.close));
    const signal: BacktestSignal = shortMean > longMean * 1.01 ? "BUY" : shortMean < longMean * 0.99 ? "SELL" : "HOLD";
    if (signal === "HOLD") continue;
    const entryPrice = bars[i].close;
    const exitPrice = bars[i + horizon].close;
    const direction = signal === "BUY" ? 1 : -1;
    const returnPct = (exitPrice / entryPrice - 1) * direction;
    records.push({ index: i, time: bars[i].time, signal, entryPrice, exitPrice, returnPct, correct: returnPct > 0, modelVersion });
  }
  const returns = records.map((record) => record.returnPct ?? 0);
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) { equity *= 1 + value; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0); }
  const gains = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0).map(Math.abs);
  const sharpe = stdev(returns) > 0 ? (avg(returns) / stdev(returns)) * Math.sqrt(252 / Math.max(1, horizon)) : 0;
  return { symbol: input.symbol, modelVersion, signalHistory: records, metrics: { recommendationAccuracy: Number((records.length ? records.filter((record) => record.correct).length / records.length : 0).toFixed(4)), averageReturn: Number(avg(returns).toFixed(4)), winRate: Number((records.length ? gains.length / records.length : 0).toFixed(4)), maxDrawdown: Number(maxDrawdown.toFixed(4)), sharpe: Number(sharpe.toFixed(4)), profitFactor: Number((losses.length ? gains.reduce((sum, value) => sum + value, 0) / losses.reduce((sum, value) => sum + value, 0) : gains.length ? 99 : 0).toFixed(4)), totalSignals: records.length }, dataConfidence: bars.length >= 252 ? 0.85 : 0.6, status: "ready", disclaimer: "Backtest lịch sử không bảo đảm kết quả tương lai; kết quả phụ thuộc cửa sổ, phí giao dịch, trượt giá và universe dữ liệu." };
}
