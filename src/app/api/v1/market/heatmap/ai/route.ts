import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { cached } from "@/lib/connectors/core";
import { getMarketHeatmap } from "@/lib/heatmap/service";
import { chatWithFallback } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  try {
    const result = await cached("market:heatmap:ai:v1", 60_000, async () => {
      const heatmap = await getMarketHeatmap();
      const valid = heatmap.items.filter((item) => item.changePercent != null);
      const sectorMap = new Map<string, { change: number; count: number; value: number }>();
      for (const item of valid) {
        const current = sectorMap.get(item.sector) ?? { change: 0, count: 0, value: 0 };
        current.change += item.changePercent ?? 0;
        current.count += 1;
        current.value += item.tradingValue;
        sectorMap.set(item.sector, current);
      }
      const sectors = [...sectorMap.entries()].map(([name, value]) => ({ name, averageChange: Number((value.change / value.count).toFixed(2)), stocks: value.count, tradingValue: value.value })).sort((a, b) => b.averageChange - a.averageChange);
      const topLiquidity = [...valid].sort((a, b) => b.tradingValue - a.tradingValue).slice(0, 8).map((item) => ({ symbol: item.symbol, sector: item.sector, changePercent: item.changePercent, tradingValue: item.tradingValue }));
      const advancing = valid.filter((item) => (item.changePercent ?? 0) > 0.01).length;
      const declining = valid.filter((item) => (item.changePercent ?? 0) < -0.01).length;
      const fallback = `Dòng tiền đang ${sectors[0]?.name ? `tập trung vào nhóm ${sectors[0].name}` : "phân tán"}. Breadth: ${advancing} mã tăng và ${declining} mã giảm. Market Bias: ${advancing > declining * 1.2 ? "Bullish" : declining > advancing * 1.2 ? "Bearish" : "Phân hóa"}.`;
      const prompt = JSON.stringify({ marketStatus: heatmap.marketStatus, breadth: { advancing, declining, total: valid.length }, sectors: sectors.slice(0, 8), topLiquidity });
      const llm = await chatWithFallback([
        { role: "system", content: "Bạn là ORCA AI Market Strategist. Viết insight thị trường Việt Nam bằng tiếng Việt, tối đa 4 câu, chỉ sử dụng dữ liệu được cung cấp, không bịa số liệu và không đưa khuyến nghị mua bán. Kết thúc bằng Market Bias: Bullish, Bearish hoặc Phân hóa." },
        { role: "user", content: `Phân tích heatmap hiện tại từ dữ liệu JSON sau:\n${prompt}` },
      ], { maxTokens: 500, temperature: 0.2, timeoutMs: 12_000 });
      return { insight: llm?.text?.trim() || fallback, provider: llm?.provider ?? "rule-engine", model: llm?.model ?? null, generatedAt: new Date().toISOString(), basedOn: { marketStatus: heatmap.marketStatus, breadth: { advancing, declining, total: valid.length }, sectors: sectors.slice(0, 8) } };
    });
    return ok(result, { source: result.provider === "rule-engine" ? "heatmap-rule-engine" : `heatmap-llm:${result.provider}`, cachedSeconds: 60 }, { cacheSeconds: 60 });
  } catch (err) {
    return handleError(err, "heatmap_ai");
  }
}
