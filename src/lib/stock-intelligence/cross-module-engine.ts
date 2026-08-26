import type { MarketSnapshot } from "@/types/market";
import type { CommodityImpactOnStock } from "@/lib/commodities/service";
import type { SectorBenchmark } from "@/lib/industry-benchmarks";

export interface CrossModuleSignal {
  module: "market" | "industry" | "commodity" | "fx" | "macro";
  direction: "positive" | "negative" | "neutral" | "unknown";
  score: number | null;
  headline: string;
  evidence: string;
  confidence: number;
}
export interface CausalLink { from: string; to: string; direction: "up" | "down" | "mixed"; strength: number; explanation: string; }
export interface CausalChain { title: string; impact: "positive" | "negative" | "mixed"; confidence: number; links: CausalLink[]; }
export interface CrossModuleContext {
  symbol: string;
  generatedAt: string;
  market: { regime: string; regimeLabel: string; breadthScore: number; trendScore: number; risk: string; confidence: number };
  industry: { sector: string; industry: string; sectorChangePct: number | null; sectorStrength: number | null; rankProxy: number | null; confidence: number };
  signals: CrossModuleSignal[];
  causalChains: CausalChain[];
  aggregateScore: number | null;
  dataConfidence: number;
  missingModules: string[];
  disclosure: string;
}

function clamp(n: number, min = -100, max = 100) { return Math.max(min, Math.min(max, n)); }
function direction(score: number | null): CrossModuleSignal["direction"] { if (score == null) return "unknown"; return score > 8 ? "positive" : score < -8 ? "negative" : "neutral"; }

export function buildCrossModuleContext(input: { symbol: string; market: MarketSnapshot; benchmark: SectorBenchmark; commodityImpacts: CommodityImpactOnStock[]; fxUsdVnd?: number | null; macro?: { score: number; headline: string; evidence: string } | null }): CrossModuleContext {
  const sector = input.market.sectors.find((item) => item.label === input.benchmark.sector || item.shortLabel === input.benchmark.sector);
  const marketScore = clamp(input.market.pulse.trendScore * 0.55 + input.market.pulse.breadthScore * 0.45);
  const industryScore = sector?.strength ?? sector?.averageChangePct ?? null;
  const commodityScore = input.commodityImpacts.length ? clamp(input.commodityImpacts.reduce((sum, item) => sum + (item.impactType === "positive" ? 1 : item.impactType === "negative" ? -1 : 0) * item.impactScore, 0) / input.commodityImpacts.length) : null;
  const signals: CrossModuleSignal[] = [
    { module: "market", score: marketScore, direction: direction(marketScore), headline: `Thị trường ${input.market.pulse.regimeLabel}`, evidence: `${input.market.pulse.summary}; breadth score ${input.market.pulse.breadthScore}.`, confidence: input.market.quality.confidence },
    { module: "industry", score: industryScore == null ? null : clamp(industryScore), direction: direction(industryScore), headline: `Ngành ${input.benchmark.industry}`, evidence: sector ? `Sector change ${sector.averageChangePct ?? "N/A"}%, strength ${sector.strength ?? "N/A"}.` : "Chưa có snapshot ngành tương ứng.", confidence: sector ? input.market.quality.confidence : 0.35 },
    { module: "commodity", score: commodityScore, direction: direction(commodityScore), headline: input.commodityImpacts.length ? `${input.commodityImpacts.length} commodity impact đang được theo dõi` : "Chưa có commodity mapping", evidence: input.commodityImpacts.slice(0, 3).map((item) => `${item.name}: ${item.reason ?? item.impactType}`).join("; ") || "Không có dữ liệu impact từ data-engine.", confidence: input.commodityImpacts.length ? 0.75 : 0.2 },
    { module: "fx", score: input.fxUsdVnd == null ? null : 0, direction: input.fxUsdVnd == null ? "unknown" : "neutral", headline: input.fxUsdVnd == null ? "FX chưa khả dụng" : `USD/VND ${input.fxUsdVnd.toLocaleString("vi-VN")}`, evidence: input.fxUsdVnd == null ? "Chưa có tỷ giá từ data-engine tại thời điểm tạo context." : "Tỷ giá được lấy từ commodity FX service; chưa có chuỗi biến động đủ dài để suy ra hướng.", confidence: input.fxUsdVnd == null ? 0 : 0.55 },
    { module: "macro", score: input.macro?.score ?? null, direction: direction(input.macro?.score ?? null), headline: input.macro?.headline ?? "Macro chưa khả dụng", evidence: input.macro?.evidence ?? "Chưa có macro connector được cung cấp cho stock context.", confidence: input.macro ? 0.6 : 0 },
  ];
  const usable = signals.filter((signal) => signal.score != null);
  const aggregateScore = usable.length ? Math.round(usable.reduce((sum, signal) => sum + (signal.score ?? 0), 0) / usable.length) : null;
  const missingModules = signals.filter((signal) => signal.score == null).map((signal) => signal.module);
  const chains = buildCausalChains(input.benchmark, input.commodityImpacts, input.market.pulse.regime, sector?.averageChangePct ?? null);
  return { symbol: input.symbol, generatedAt: new Date().toISOString(), market: { regime: input.market.pulse.regime, regimeLabel: input.market.pulse.regimeLabel, breadthScore: input.market.pulse.breadthScore, trendScore: input.market.pulse.trendScore, risk: input.market.pulse.risk, confidence: input.market.quality.confidence }, industry: { sector: input.benchmark.sector, industry: input.benchmark.industry, sectorChangePct: sector?.averageChangePct ?? null, sectorStrength: sector?.strength ?? null, rankProxy: null, confidence: sector ? input.market.quality.confidence : 0.35 }, signals, causalChains: chains, aggregateScore, dataConfidence: usable.length ? usable.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length : 0, missingModules, disclosure: "Cross-module context chỉ sử dụng snapshot market, sector benchmark, commodity mapping và FX data có sẵn trong data-engine. Module chưa có nguồn được ghi rõ là unknown; không suy diễn dữ liệu thiếu." };
}

function buildCausalChains(benchmark: SectorBenchmark, impacts: CommodityImpactOnStock[], regime: string, sectorChangePct: number | null): CausalChain[] {
  const chains: CausalChain[] = [];
  if (impacts.length) {
    const strongest = [...impacts].sort((a, b) => Math.abs(b.impactScore) - Math.abs(a.impactScore))[0];
    const positive = strongest.impactType === "positive";
    chains.push({ title: `${strongest.name} → biên lợi nhuận → định giá`, impact: positive ? "positive" : strongest.impactType === "negative" ? "negative" : "mixed", confidence: 0.68, links: [
      { from: strongest.name, to: positive ? "Input/catalyst hỗ trợ" : "Input cost hoặc demand headwind", direction: positive ? "up" : "down", strength: Math.min(1, Math.abs(strongest.impactScore) / 100), explanation: strongest.reason ?? "Commodity mapping từ data-engine." },
      { from: positive ? "Input/catalyst hỗ trợ" : "Input cost hoặc demand headwind", to: "EBITDA margin", direction: positive ? "up" : "down", strength: 0.55, explanation: `Tác động được điều chỉnh theo benchmark ngành ${benchmark.industry}.` },
      { from: "EBITDA margin", to: "EPS / fair value", direction: positive ? "up" : "down", strength: 0.42, explanation: "Đây là causal inference định lượng sơ bộ, không phải attribution từ báo cáo quản trị." },
    ] });
  }
  chains.push({ title: `Market regime ${regime} → risk premium → recommendation`, impact: regime === "BULLISH_TREND" ? "positive" : regime === "BROAD_RISK_OFF" || regime === "BEARISH_TREND" ? "negative" : "mixed", confidence: 0.62, links: [
    { from: "VN market regime", to: "Risk appetite", direction: regime === "BULLISH_TREND" ? "up" : regime === "BROAD_RISK_OFF" || regime === "BEARISH_TREND" ? "down" : "mixed", strength: 0.65, explanation: "Market regime được lấy từ breadth, trend và liquidity snapshot." },
    { from: "Risk appetite", to: "Valuation multiple", direction: regime === "BULLISH_TREND" ? "up" : regime === "BROAD_RISK_OFF" || regime === "BEARISH_TREND" ? "down" : "mixed", strength: 0.38, explanation: "Causal relationship là mô hình hóa theo regime, chưa phải nhân quả thống kê đã kiểm định." },
    { from: "Valuation multiple", to: "Fair value", direction: regime === "BULLISH_TREND" ? "up" : regime === "BROAD_RISK_OFF" || regime === "BEARISH_TREND" ? "down" : "mixed", strength: 0.35, explanation: "Tác động valuation được dùng làm context, không thay thế valuation engine." },
  ] });
  if (sectorChangePct != null) chains.push({ title: `Industry momentum → revenue outlook`, impact: sectorChangePct > 0.5 ? "positive" : sectorChangePct < -0.5 ? "negative" : "mixed", confidence: 0.55, links: [{ from: "Sector momentum", to: "Demand/revenue outlook", direction: sectorChangePct > 0.5 ? "up" : sectorChangePct < -0.5 ? "down" : "mixed", strength: Math.min(1, Math.abs(sectorChangePct) / 5), explanation: `Sector change ${sectorChangePct.toFixed(2)}% từ market snapshot.` }, { from: "Demand/revenue outlook", to: "EPS", direction: sectorChangePct > 0.5 ? "up" : sectorChangePct < -0.5 ? "down" : "mixed", strength: 0.28, explanation: "Cần kiểm chứng bằng doanh thu phân khúc và guidance actual." }] });
  return chains;
}
