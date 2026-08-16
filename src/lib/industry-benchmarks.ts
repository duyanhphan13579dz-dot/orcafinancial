/**
 * Vietnamese market industry benchmarks.
 *
 * Benchmark values are calibrated to real typical ranges for HOSE/HNX-listed
 * companies in each sector. They are used to synthesize internally consistent
 * quarterly financial statements from real price/volume data when audited
 * financials are not yet ingested by the connector layer.
 */

export interface SectorBenchmark {
  sector: string;
  industry: string;
  netMargin: number;            // net income / revenue (decimal)
  grossMargin: number;          // gross profit / revenue
  operatingMargin: number;      // operating income / revenue
  assetTurnover: number;        // revenue / total assets (annual)
  leverage: number;             // total liabilities / total assets
  currentRatio: number;         // current assets / current liabilities
  inventoryDays: number;        // days inventory outstanding
  receivableDays: number;
  revenuePerEmployee: number;   // VND million
  capexToRevenue: number;
  dividendPayout: number;       // payout ratio
  effectiveTaxRate: number;
  depreciationPctFA: number;    // depreciation as % of fixed assets
  cashPctAssets: number;
  beta: number;
  description: string;
}

export const SECTOR_BENCHMARKS: Record<string, SectorBenchmark> = {
  "consumer_staples": {
    sector: "Tiêu dùng thiết yếu",
    industry: "Thực phẩm & Đồ uống",
    netMargin: 0.11,
    grossMargin: 0.38,
    operatingMargin: 0.15,
    assetTurnover: 1.1,
    leverage: 0.45,
    currentRatio: 1.6,
    inventoryDays: 70,
    receivableDays: 30,
    revenuePerEmployee: 3500,
    capexToRevenue: 0.06,
    dividendPayout: 0.55,
    effectiveTaxRate: 0.18,
    depreciationPctFA: 0.08,
    cashPctAssets: 0.12,
    beta: 0.7,
    description: "Doanh nghiệp sản xuất và phân phối hàng tiêu dùng thiết yếu có dòng tiền ổn định, biên lợi nhuận tương đối cao và chính sách cổ tức đều đặn.",
  },
  "real_estate": {
    sector: "Bất động sản",
    industry: "Phát triển BĐS",
    netMargin: 0.18,
    grossMargin: 0.34,
    operatingMargin: 0.24,
    assetTurnover: 0.25,
    leverage: 0.62,
    currentRatio: 1.3,
    inventoryDays: 900,
    receivableDays: 120,
    revenuePerEmployee: 12000,
    capexToRevenue: 0.02,
    dividendPayout: 0.25,
    effectiveTaxRate: 0.18,
    depreciationPctFA: 0.04,
    cashPctAssets: 0.08,
    beta: 1.35,
    description: "Doanh nghiệp phát triển bất động sản có đòn bẩy cao, lợi nhuận biến động theo chu kỳ dự án, và chịu ảnh hưởng lớn từ chính sách tín dụng.",
  },
  "steel": {
    sector: "Nguyên vật liệu",
    industry: "Thép & Kim loại",
    netMargin: 0.05,
    grossMargin: 0.14,
    operatingMargin: 0.07,
    assetTurnover: 1.1,
    leverage: 0.58,
    currentRatio: 1.2,
    inventoryDays: 75,
    receivableDays: 45,
    revenuePerEmployee: 4200,
    capexToRevenue: 0.08,
    dividendPayout: 0.25,
    effectiveTaxRate: 0.17,
    depreciationPctFA: 0.09,
    cashPctAssets: 0.06,
    beta: 1.45,
    description: "Ngành thép có biên lợi nhuận mỏng, nhạy cảm với giá nguyên liệu và biến động kinh tế vĩ mô; đòi hỏi vốn cố định lớn.",
  },
  "banking": {
    sector: "Tài chính",
    industry: "Ngân hàng",
    netMargin: 0.22,
    grossMargin: 0.60,
    operatingMargin: 0.30,
    assetTurnover: 0.05,
    leverage: 0.88,
    currentRatio: 0.0,
    inventoryDays: 0,
    receivableDays: 0,
    revenuePerEmployee: 2200,
    capexToRevenue: 0.02,
    dividendPayout: 0.20,
    effectiveTaxRate: 0.17,
    depreciationPctFA: 0.10,
    cashPctAssets: 0.10,
    beta: 1.25,
    description: "Ngân hàng có cấu trúc tài chính đặc thù với tỷ lệ đòn bẩy cao theo quy định Basel, thu nhập từ lãi và phi lãi, cho vay là tài sản sinh lời chính.",
  },
  "securities": {
    sector: "Tài chính",
    industry: "Chứng khoán",
    netMargin: 0.20,
    grossMargin: 0.55,
    operatingMargin: 0.28,
    assetTurnover: 0.20,
    leverage: 0.55,
    currentRatio: 1.3,
    inventoryDays: 0,
    receivableDays: 30,
    revenuePerEmployee: 1800,
    capexToRevenue: 0.04,
    dividendPayout: 0.35,
    effectiveTaxRate: 0.18,
    depreciationPctFA: 0.12,
    cashPctAssets: 0.30,
    beta: 1.6,
    description: "Công ty chứng khoán có lợi nhuận biến động mạnh theo thanh khoản thị trường, hoạt động chính gồm môi giới, tự doanh, bảo lãnh phát hành.",
  },
  "retail": {
    sector: "Bán lẻ",
    industry: "Bán lẻ hiện đại",
    netMargin: 0.04,
    grossMargin: 0.22,
    operatingMargin: 0.06,
    assetTurnover: 1.8,
    leverage: 0.55,
    currentRatio: 1.1,
    inventoryDays: 55,
    receivableDays: 10,
    revenuePerEmployee: 1600,
    capexToRevenue: 0.07,
    dividendPayout: 0.15,
    effectiveTaxRate: 0.19,
    depreciationPctFA: 0.12,
    cashPctAssets: 0.07,
    beta: 1.0,
    description: "Bán lẻ có vòng quay tài sản cao, biên mỏng, cạnh tranh khốc liệt về giá, mở rộng mạng lưới yêu cầu vốn lớn.",
  },
  "technology": {
    sector: "Công nghệ",
    industry: "CNTT & Viễn thông",
    netMargin: 0.12,
    grossMargin: 0.32,
    operatingMargin: 0.15,
    assetTurnover: 0.95,
    leverage: 0.42,
    currentRatio: 1.5,
    inventoryDays: 30,
    receivableDays: 60,
    revenuePerEmployee: 2200,
    capexToRevenue: 0.08,
    dividendPayout: 0.45,
    effectiveTaxRate: 0.15,
    depreciationPctFA: 0.15,
    cashPctAssets: 0.18,
    beta: 0.9,
    description: "Công ty công nghệ có tài sản vô hình lớn, tái đầu tư R&D cao, biên cải thiện với quy mô, dòng tiền linh hoạt.",
  },
  "energy": {
    sector: "Năng lượng",
    industry: "Dầu khí & Điện",
    netMargin: 0.12,
    grossMargin: 0.30,
    operatingMargin: 0.18,
    assetTurnover: 0.65,
    leverage: 0.48,
    currentRatio: 1.4,
    inventoryDays: 60,
    receivableDays: 45,
    revenuePerEmployee: 8500,
    capexToRevenue: 0.12,
    dividendPayout: 0.50,
    effectiveTaxRate: 0.20,
    depreciationPctFA: 0.10,
    cashPctAssets: 0.10,
    beta: 1.1,
    description: "Doanh nghiệp năng lượng có tài sản cố định lớn, dòng tiền tương đối ổn định, chịu ảnh hưởng của giá dầu/khí và chính sách nhà nước.",
  },
  "logistics": {
    sector: "Công nghiệp",
    industry: "Vận tải & Logistics",
    netMargin: 0.06,
    grossMargin: 0.20,
    operatingMargin: 0.09,
    assetTurnover: 0.75,
    leverage: 0.55,
    currentRatio: 1.2,
    inventoryDays: 0,
    receivableDays: 60,
    revenuePerEmployee: 2200,
    capexToRevenue: 0.15,
    dividendPayout: 0.30,
    effectiveTaxRate: 0.18,
    depreciationPctFA: 0.15,
    cashPctAssets: 0.08,
    beta: 1.1,
    description: "Vận tải và logistics có tài sản là phương tiện thiết bị lớn, khấu hao cao, lợi nhuận nhạy cảm với giá xăng dầu và cước.",
  },
  "conglomerate": {
    sector: "Đa ngành",
    industry: "Tập đoàn đa ngành",
    netMargin: 0.09,
    grossMargin: 0.25,
    operatingMargin: 0.13,
    assetTurnover: 0.55,
    leverage: 0.55,
    currentRatio: 1.3,
    inventoryDays: 150,
    receivableDays: 70,
    revenuePerEmployee: 4500,
    capexToRevenue: 0.07,
    dividendPayout: 0.30,
    effectiveTaxRate: 0.18,
    depreciationPctFA: 0.08,
    cashPctAssets: 0.10,
    beta: 1.2,
    description: "Tập đoàn đa ngành có cơ cấu phức tạp, đa dạng hóa dòng doanh thu nhưng cũng đi kèm rủi ro quản trị và phân bổ vốn.",
  },
  "utilities": {
    sector: "Tiện ích công cộng",
    industry: "Điện, Nước",
    netMargin: 0.10,
    grossMargin: 0.28,
    operatingMargin: 0.15,
    assetTurnover: 0.40,
    leverage: 0.55,
    currentRatio: 1.2,
    inventoryDays: 45,
    receivableDays: 50,
    revenuePerEmployee: 3200,
    capexToRevenue: 0.14,
    dividendPayout: 0.50,
    effectiveTaxRate: 0.18,
    depreciationPctFA: 0.09,
    cashPctAssets: 0.08,
    beta: 0.7,
    description: "Doanh nghiệp tiện ích công cộng có dòng tiền ổn định, vốn đầu tư ban đầu lớn, thường được hưởng giá trần hoặc cơ chế điều tiết giá.",
  },
};

/** Map featured VN symbols to their sector benchmark key. */
export const SYMBOL_SECTOR_MAP: Record<string, string> = {
  // Consumer Staples
  VNM: "consumer_staples",
  MCM: "consumer_staples",
  SAB: "consumer_staples",
  // Real Estate
  VHM: "real_estate",
  VIC: "conglomerate",
  VRE: "real_estate",
  NVL: "real_estate",
  PDR: "real_estate",
  KDH: "real_estate",
  // Steel / Materials
  HPG: "steel",
  HSG: "steel",
  NKG: "steel",
  GVR: "materials",
  // Banking
  VCB: "banking",
  TCB: "banking",
  BID: "banking",
  CTG: "banking",
  MBB: "banking",
  STB: "banking",
  HDB: "banking",
  ACB: "banking",
  TPB: "banking",
  VPB: "banking",
  // Securities
  SSI: "securities",
  VND: "securities",
  VCI: "securities",
  SHS: "securities",
  // Tech
  FPT: "technology",
  CMG: "technology",
  // Retail
  MWG: "retail",
  PNJ: "retail",
  // Energy
  GAS: "energy",
  PLX: "energy",
  POW: "utilities",
  PVD: "energy",
  // Conglomerate
  MSN: "conglomerate",
};

export function getBenchmarkForSymbol(symbol: string): SectorBenchmark {
  const key = SYMBOL_SECTOR_MAP[symbol];
  if (key && SECTOR_BENCHMARKS[key]) return SECTOR_BENCHMARKS[key];
  // Default to conglomerate for unknown symbols
  return SECTOR_BENCHMARKS.conglomerate;
}
