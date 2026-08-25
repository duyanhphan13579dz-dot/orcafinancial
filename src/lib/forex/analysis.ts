import type { Ohlcv } from "@/lib/connectors/core";
import { bollinger, emaSeries, macd, rsi, supportResistance } from "@/lib/analysis";
import { detectCandlestickPatterns, detectChartPatterns } from "@/lib/technical-patterns";

function atr(b: Ohlcv[], p = 14) {
  if (b.length < p + 1) return null;
  const x = [];
  for (let i = 1; i < b.length; i++)
    x.push(
      Math.max(
        b[i].high - b[i].low,
        Math.abs(b[i].high - b[i - 1].close),
        Math.abs(b[i].low - b[i - 1].close),
      ),
    );
  return x.slice(-p).reduce((a, c) => a + c, 0) / p;
}

function adx(b: Ohlcv[], p = 14) {
  if (b.length < p * 2 + 1) return null;
  const tr: number[] = [],
    pd: number[] = [],
    md: number[] = [];
  for (let i = 1; i < b.length; i++) {
    tr.push(
      Math.max(
        b[i].high - b[i].low,
        Math.abs(b[i].high - b[i - 1].close),
        Math.abs(b[i].low - b[i - 1].close),
      ),
    );
    const u = b[i].high - b[i - 1].high,
      d = b[i - 1].low - b[i].low;
    pd.push(u > d && u > 0 ? u : 0);
    md.push(d > u && d > 0 ? d : 0);
  }
  const dx = [];
  for (let i = p - 1; i < tr.length; i++) {
    const t = tr.slice(i - p + 1, i + 1).reduce((a, c) => a + c, 0),
      a = pd.slice(i - p + 1, i + 1).reduce((x, c) => x + c, 0),
      m = md.slice(i - p + 1, i + 1).reduce((x, c) => x + c, 0);
    if (t) {
      const pi = (100 * a) / t,
        mi = (100 * m) / t;
      if (pi + mi) dx.push((100 * Math.abs(pi - mi)) / (pi + mi));
    }
  }
  return dx.length >= p ? dx.slice(-p).reduce((a, c) => a + c, 0) / p : null;
}

export function analyzeForex(bars: Ohlcv[]) {
  if (bars.length < 30) throw new Error("Insufficient forex OHLCV data");
  const closes = bars.map((b) => b.close),
    current = closes.at(-1)!;
  const e20 = emaSeries(closes, 20).at(-1)!,
    e50 = emaSeries(closes, 50).at(-1)!,
    e200 = closes.length >= 200 ? emaSeries(closes, 200).at(-1)! : null;
  const rr = rsi(closes),
    mm = macd(closes),
    bb = bollinger(closes),
    aa = atr(bars),
    xx = adx(bars);
  const sr = supportResistance(bars);

  let buy = 0,
    sell = 0;
  const reasons: string[] = [];
  if (rr !== null) {
    if (rr < 35) {
      buy++;
      reasons.push(`RSI ${rr.toFixed(1)} gần quá bán`);
    } else if (rr > 70) {
      sell++;
      reasons.push(`RSI ${rr.toFixed(1)} quá mua`);
    }
  }
  if (mm) {
    if (mm.histogram > 0) {
      buy++;
      reasons.push("MACD histogram dương");
    } else {
      sell++;
      reasons.push("MACD histogram âm");
    }
  }
  if (current > e20 && e20 > e50) {
    buy += 2;
    reasons.push("Giá > EMA20 > EMA50");
  } else if (current < e20 && e20 < e50) {
    sell += 2;
    reasons.push("Giá < EMA20 < EMA50");
  }
  if (e200 !== null) {
    if (current > e200) buy++;
    else sell++;
  }
  if (sr) {
    const nearSupport = (current - sr.support) / current < 0.002;
    const nearResist = (sr.resistance - current) / current < 0.002;
    if (nearSupport) {
      buy += 0.5;
      reasons.push("Giá gần hỗ trợ");
    }
    if (nearResist) {
      sell += 0.5;
      reasons.push("Giá gần kháng cự");
    }
  }

  const candles = detectCandlestickPatterns(bars)
      .filter((p) => p.barIndex >= bars.length - 15)
      .slice(-10),
    charts = detectChartPatterns(bars).slice(-8);
  buy +=
    candles.filter((p) => p.type === "bullish").length * 0.3 +
    charts.filter((p) => p.type === "bullish").length * 0.5;
  sell +=
    candles.filter((p) => p.type === "bearish").length * 0.3 +
    charts.filter((p) => p.type === "bearish").length * 0.5;
  const diff = buy - sell;
  const recommendation =
    diff >= 2 && (rr === null || rr < 70)
      ? "BUY"
      : diff <= -2 && (rr === null || rr > 30)
        ? "SELL"
        : "NEUTRAL";

  const risk = aa ? Math.max(aa * 1.5, current * 0.001) : current * 0.005;
  // Prefer structure-aware SL when S/R available
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;
  let takeProfit2: number | null = null;

  if (recommendation === "BUY") {
    const structSl = sr ? Math.min(current - risk, sr.support - risk * 0.15) : current - risk;
    stopLoss = structSl;
    takeProfit = current + risk * 2;
    takeProfit2 = current + risk * 3.5;
    if (sr?.resistance && sr.resistance > current) {
      takeProfit = Math.min(takeProfit, sr.resistance);
      takeProfit2 = Math.max(takeProfit2, sr.resistance + risk * 0.5);
    }
  } else if (recommendation === "SELL") {
    const structSl = sr ? Math.max(current + risk, sr.resistance + risk * 0.15) : current + risk;
    stopLoss = structSl;
    takeProfit = current - risk * 2;
    takeProfit2 = current - risk * 3.5;
    if (sr?.support && sr.support < current) {
      takeProfit = Math.max(takeProfit, sr.support);
      takeProfit2 = Math.min(takeProfit2, sr.support - risk * 0.5);
    }
  }

  return {
    indicators: {
      rsi14: rr,
      macd: mm?.macd ?? null,
      macdSignal: mm?.signal ?? null,
      macdHistogram: mm?.histogram ?? null,
      ema20: e20,
      ema50: e50,
      ema200: e200,
      bollinger: bb,
      atr14: aa,
      adx14: xx,
      support: sr?.support ?? null,
      resistance: sr?.resistance ?? null,
    },
    levels: {
      support: sr?.support ?? null,
      resistance: sr?.resistance ?? null,
      entry: current,
      stopLoss,
      takeProfit,
      takeProfit2,
    },
    candlestickPatterns: candles,
    chartPatterns: charts,
    recommendation,
    entryPrice: current,
    stopLoss,
    takeProfit,
    takeProfit2,
    confidence: Number(
      Math.min(0.92, 0.5 + Math.abs(diff) * 0.08 + (xx && xx > 25 ? 0.08 : 0)).toFixed(2),
    ),
    reasons,
    disclaimer: "Tín hiệu định lượng tham khảo, không phải lời khuyên đầu tư.",
  };
}
