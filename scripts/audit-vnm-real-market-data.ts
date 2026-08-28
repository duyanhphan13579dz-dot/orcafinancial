import fs from "node:fs";
import path from "node:path";
import { vndirectHistory, yahooHistory } from "@/lib/connectors/providers";
import { analyze } from "@/lib/analysis";
import { detectCandlestickPatterns, detectChartPatterns } from "@/lib/technical-patterns";
import { buildTechnicalSentiment } from "@/lib/stock-intelligence/technical-sentiment";

async function main() {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * 400;
  let source = "vndirect-dchart";
  let bars;
  try {
    bars = await vndirectHistory("VNM", from, to, "D");
  } catch (error) {
    source = "yahoo-finance";
    bars = await yahooHistory("VNM", from, to, "D");
    console.warn(`VNDirect failed; used Yahoo fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
  const analysis = analyze("VNM", bars);
  const candlestickPatterns = detectCandlestickPatterns(bars).filter((item) => item.barIndex >= bars.length - 30);
  const chartPatterns = detectChartPatterns(bars);
  const technicalSentiment = buildTechnicalSentiment(analysis, chartPatterns, candlestickPatterns);
  const output = {
    symbol: "VNM", source, retrievedAt: new Date().toISOString(), from, to, barsAnalyzed: bars.length,
    firstBar: bars[0], lastBar: bars.at(-1), bars,
    indicators: { rsi14: analysis.rsi14, macd: analysis.macd, sma20: analysis.sma20, sma50: analysis.sma50, bollinger: analysis.bollinger, supportResistance: analysis.supportResistance, volatilityPct: analysis.volatilityPct, maxDrawdownPct: analysis.maxDrawdownPct, volumeVsAvg20: analysis.volumeVsAvg20 },
    technicalSentiment, chartPatterns, candlestickPatterns,
  };
  const outputPath = path.join(process.cwd(), "artifacts", "vnm-real-market-audit.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outputPath, symbol: "VNM", source, barsAnalyzed: bars.length, firstBar: output.firstBar, lastBar: output.lastBar, indicators: output.indicators, sentiment: technicalSentiment.sentiment, labelVi: technicalSentiment.labelVi, chartPatterns: chartPatterns.length, candlestickPatterns: candlestickPatterns.length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
