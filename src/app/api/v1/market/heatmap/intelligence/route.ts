import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { cached } from "@/lib/connectors/core";
import { getMarketHeatmap } from "@/lib/heatmap/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  try {
    const result = await cached("market:heatmap:intelligence:v1", 12_000, async () => {
      const heatmap = await getMarketHeatmap();
      const valid = heatmap.items.filter((item) => item.changePercent != null);
      const advancing = valid.filter((item) => (item.changePercent ?? 0) > 0.01);
      const declining = valid.filter((item) => (item.changePercent ?? 0) < -0.01);
      const sectorMap = new Map<string, { name: string; count: number; advancing: number; declining: number; averageChange: number; tradingValue: number; momentum: number }>();
      for (const item of valid) {
        const current = sectorMap.get(item.sector) ?? { name: item.sector, count: 0, advancing: 0, declining: 0, averageChange: 0, tradingValue: 0, momentum: 0 };
        current.count += 1;
        current.advancing += (item.changePercent ?? 0) > 0.01 ? 1 : 0;
        current.declining += (item.changePercent ?? 0) < -0.01 ? 1 : 0;
        current.averageChange += item.changePercent ?? 0;
        current.tradingValue += item.tradingValue;
        current.momentum += (item.changePercent ?? 0) * Math.log10(Math.max(1, item.volume ?? 0));
        sectorMap.set(item.sector, current);
      }
      const sectors = [...sectorMap.values()].map((sector) => ({ ...sector, averageChange: sector.averageChange / sector.count, momentum: sector.momentum / sector.count })).sort((a, b) => b.momentum - a.momentum);
      const volumeAverage = valid.length ? valid.reduce((sum, item) => sum + (item.volume ?? 0), 0) / valid.length : 0;
      const unusualVolume = valid.filter((item) => (item.volume ?? 0) > volumeAverage * 1.8).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 10).map((item) => ({ symbol: item.symbol, sector: item.sector, changePercent: item.changePercent, volume: item.volume, tradingValue: item.tradingValue }));
      const regime = advancing.length > declining.length * 1.2 ? "BULLISH" : declining.length > advancing.length * 1.2 ? "BEARISH" : "MIXED";
      return { regime, breadth: { advancing: advancing.length, declining: declining.length, unchanged: valid.length - advancing.length - declining.length, total: valid.length }, sectors, moneyIn: sectors.filter((sector) => sector.averageChange > 0).slice(0, 5), moneyOut: sectors.filter((sector) => sector.averageChange < 0).slice(-5).reverse(), unusualVolume, generatedAt: new Date().toISOString() };
    });
    return ok(result, { source: "heatmap-market-intelligence", realtime: true }, { cacheSeconds: 12 });
  } catch (err) {
    return handleError(err, "heatmap_intelligence");
  }
}
