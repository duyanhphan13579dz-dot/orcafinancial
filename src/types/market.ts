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

export type OvernightMarketKind = "index" | "future" | "commodity" | "fx" | "rates";
export type OvernightMarketStatus = "live" | "delayed" | "stale" | "unavailable";

export interface OvernightMarketItem {
  symbol: string;
  label: string;
  kind: OvernightMarketKind;
  value: number | null;
  changePct: number | null;
  unit: string;
  source: string;
  status: OvernightMarketStatus;
  updatedAt: string | null;
}

export interface OvernightMarketSnapshot {
  items: OvernightMarketItem[];
  stale: boolean;
  partial: boolean;
  missingSymbols: string[];
  generatedAt: string;
  sources: string[];
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
  /** Expanded quote universe used by the sector board; kept separate from the compact dashboard heatmap. */
  sectorQuotes: MarketQuote[];
  quotes: MarketQuote[];
  crypto: CryptoSnapshot[];
  overnight: OvernightMarketSnapshot;
  news: MarketNewsItem[];
  quality: MarketDataQuality;
  generatedAt: string;
}

export const SECTOR_DEFINITIONS = [
  { id: "banking", label: "Ngân hàng", shortLabel: "BANK", symbols: ["VCB", "TCB", "BID", "CTG", "MBB", "STB", "HDB", "ACB", "VPB", "SHB", "EIB", "LPB"] },
  { id: "securities", label: "Chứng khoán", shortLabel: "SEC", symbols: ["SSI", "VND", "VCI", "HCM", "MBS", "FTS", "BSI", "CTS", "ORS", "VDS"] },
  { id: "real-estate", label: "Bất động sản", shortLabel: "REAL ESTATE", symbols: ["VIC", "VHM", "VRE", "DXG", "DIG", "NVL", "KDH", "NLG", "PDR", "CEO"] },
  { id: "steel", label: "Thép & vật liệu", shortLabel: "STEEL", symbols: ["HPG", "HSG", "NKG", "TLH", "SMC", "VGS", "POM", "VIS"] },
  { id: "construction", label: "Xây dựng & hạ tầng", shortLabel: "BUILD", symbols: ["CTD", "HBC", "CII", "HHV", "FCN", "PC1", "LCG", "C4G"] },
  { id: "retail", label: "Bán lẻ", shortLabel: "RETAIL", symbols: ["MWG", "FRT", "DGW", "PET", "PNJ", "VGC", "VEA", "HTM"] },
  { id: "technology", label: "Công nghệ & viễn thông", shortLabel: "TECH", symbols: ["FPT", "CMG", "ELC", "CTR", "ITD", "VGI", "FOX", "SIP"] },
  { id: "energy", label: "Năng lượng & tiện ích", shortLabel: "ENERGY", symbols: ["GAS", "POW", "PLX", "PVD", "PVS", "NT2", "REE", "BSR"] },
  { id: "chemicals", label: "Hóa chất & cao su", shortLabel: "CHEM", symbols: ["GVR", "DGC", "DPM", "DCM", "CSV", "BMP", "DRC", "AAA"] },
  { id: "logistics", label: "Cảng & logistics", shortLabel: "LOGISTICS", symbols: ["GMD", "VSC", "HAH", "SCS", "VTP", "HVN", "ACV", "VJC"] },
  { id: "food-beverage", label: "Thực phẩm & đồ uống", shortLabel: "F&B", symbols: ["VNM", "MSN", "SAB", "QNS", "PAN", "DBC", "SBT", "KDC"] },
  { id: "insurance", label: "Bảo hiểm", shortLabel: "INSURANCE", symbols: ["BVH", "MIG", "PVI", "BMI", "BIC", "VNR", "ABI", "PTI"] },
] as const;
