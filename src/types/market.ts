export type MarketStatus = "up" | "down" | "flat";
export type MarketRegime =
  | "BULLISH_TREND"
  | "BEARISH_TREND"
  | "SELECTIVE_ROTATION"
  | "BROAD_RISK_OFF"
  | "NEUTRAL";

export interface MarketQuote {
  symbol: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number | null;
  changePct: number | null;
  source: string;
  confidence: number;
}

export interface MarketIndex extends MarketQuote {
  code: string;
  name: string;
  exchange: string;
  primary?: boolean;
}

export interface BreadthSnapshot {
  advancing: number;
  advancers: number;
  unchanged: number;
  declining: number;
  decliners: number;
  sample: number;
  ratio: number;
  scope: "featured" | "market";
}

export interface SectorSnapshot {
  id: string;
  label: string;
  shortLabel: string;
  averageChangePct: number | null;
  strength: number | null;
  advancing: number;
  unchanged: number;
  declining: number;
  volume: number;
  stocks: MarketQuote[];
}

export interface MarketPulse {
  trend: MarketStatus;
  trendScore: number;
  breadth: MarketStatus;
  breadthScore: number;
  liquidity: MarketStatus;
  liquidityScore: number;
  foreignFlow: "buying" | "selling" | "unknown";
  risk: "low" | "medium" | "high";
  regime: MarketRegime;
  regimeLabel: string;
  summary: string;
}

export interface MarketNewsItem {
  id: number;
  title: string;
  link: string;
  sourceName: string;
  symbols: string;
  publishedAt: string;
  imageUrl: string | null;
}

export interface CryptoSnapshot {
  id: string;
  symbol: string;
  priceUsd: number;
  change24hPct: number;
  source: string;
}

export interface MarketDataQuality {
  generatedAt: string;
  ageSeconds: number;
  partial: boolean;
  missingSymbols: string[];
  stale: boolean;
  sources: string[];
  confidence: number;
}

export interface MarketSnapshot {
  indices: MarketIndex[];
  breadth: BreadthSnapshot;
  marketBreadth: BreadthSnapshot;
  largeCapBreadth: BreadthSnapshot;
  sectors: SectorSnapshot[];
  pulse: MarketPulse;
  liquidity: { totalVolume: number; averageVolume: number; status: MarketStatus };
  foreignFlow: { status: "buying" | "selling" | "unknown"; value: number | null };
  topGainers: MarketQuote[];
  topLosers: MarketQuote[];
  topVolume: MarketQuote[];
  quotes: MarketQuote[];
  crypto: CryptoSnapshot[];
  news: MarketNewsItem[];
  quality: MarketDataQuality;
  generatedAt: string;
}

export const SECTOR_DEFINITIONS = [
  { id: "banking", label: "Ngân hàng", shortLabel: "BANK", symbols: ["VCB", "TCB", "BID", "CTG", "MBB", "STB", "HDB"] },
  { id: "securities", label: "Chứng khoán", shortLabel: "SEC", symbols: ["SSI", "VND"] },
  { id: "real-estate", label: "Bất động sản", shortLabel: "REAL ESTATE", symbols: ["VIC", "VHM", "VRE"] },
  { id: "steel", label: "Thép", shortLabel: "STEEL", symbols: ["HPG", "HSG", "NKG"] },
  { id: "construction", label: "Xây dựng", shortLabel: "BUILD", symbols: ["GVR", "POW"] },
  { id: "retail", label: "Bán lẻ", shortLabel: "RETAIL", symbols: ["MWG", "MSN"] },
  { id: "technology", label: "Công nghệ", shortLabel: "TECH", symbols: ["FPT"] },
] as const;
