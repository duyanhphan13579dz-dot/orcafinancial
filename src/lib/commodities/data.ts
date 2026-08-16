/**
 * Commodities Data — Danh sách 31 hàng hóa cần theo dõi
 * 
 * Mỗi hàng hóa có:
 * - symbol: Mã nội bộ (uppercase, underscore-separated)
 * - name: Tên tiếng Việt
 * - nameEn: Tên tiếng Anh
 * - group: Nhóm (precious_metals, energy, agriculture, livestock, dairy, rubber, fertilizer)
 * - unit: Đơn vị tính
 * - currency: Đơn vị tiền tệ gốc
 * - source: Nguồn dữ liệu ưu tiên
 * - displayOrder: Thứ tự hiển thị
 * - stockImpacts: Danh sách cổ phiếu bị ảnh hưởng
 */

export interface CommodityDef {
  symbol: string;
  name: string;
  nameEn: string;
  group: "precious_metals" | "industrial_metals" | "energy" | "agriculture" | "livestock" | "dairy" | "rubber" | "fertilizer";
  unit: string;
  currency: "VND" | "USD" | "JPY" | "CNY";
  source: string;
  displayOrder: number;
  stockImpacts: Array<{ symbol: string; impactType: "positive" | "negative" | "neutral"; reason: string }>;
}

export const COMMODITIES_LIST: CommodityDef[] = [
  // ── Precious Metals (Vàng, Bạc) ────────────────────────────────────────
  {
    symbol: "GOLD_SJC_BUY",
    name: "Vàng SJC (mua vào)",
    nameEn: "Gold SJC (buy)",
    group: "precious_metals",
    unit: "VND/lượng",
    currency: "VND",
    source: "sjc.com.vn",
    displayOrder: 1,
    stockImpacts: [
      { symbol: "PNJ", impactType: "positive", reason: "Giá vàng tăng cải thiện biên lợi nhuận bán lẻ vàng" },
      { symbol: "SJC", impactType: "positive", reason: "Công ty vàng bạc trực tiếp hưởng lợi" },
    ],
  },
  {
    symbol: "GOLD_SJC_SELL",
    name: "Vàng SJC (bán ra)",
    nameEn: "Gold SJC (sell)",
    group: "precious_metals",
    unit: "VND/lượng",
    currency: "VND",
    source: "sjc.com.vn",
    displayOrder: 2,
    stockImpacts: [
      { symbol: "PNJ", impactType: "neutral", reason: "Biên mua-bán quan trọng hơn giá tuyệt đối" },
    ],
  },
  {
    symbol: "GOLD_WORLD",
    name: "Vàng thế giới",
    nameEn: "Gold (XAU/USD)",
    group: "precious_metals",
    unit: "USD/ounce",
    currency: "USD",
    source: "investing.com",
    displayOrder: 3,
    stockImpacts: [
      { symbol: "PNJ", impactType: "positive", reason: "Giá vàng thế giới tăng hỗ trợ tâm lý thị trường trong nước" },
    ],
  },
  {
    symbol: "SILVER",
    name: "Bạc",
    nameEn: "Silver (XAG/USD)",
    group: "precious_metals",
    unit: "USD/ounce",
    currency: "USD",
    source: "investing.com",
    displayOrder: 4,
    stockImpacts: [],
  },

  // ── Industrial Metals (Thép, Đồng, Nickel, Quặng sắt) ─────────────────
  {
    symbol: "STEEL_D10",
    name: "Thép D10",
    nameEn: "Steel D10",
    group: "industrial_metals",
    unit: "VND/kg",
    currency: "VND",
    source: "thepvn.com",
    displayOrder: 5,
    stockImpacts: [
      { symbol: "HPG", impactType: "positive", reason: "Thép trong nước tăng cải thiện doanh thu" },
      { symbol: "HSG", impactType: "positive", reason: "Hoa Sen Group hưởng lợi từ giá thép tăng" },
      { symbol: "NKG", impactType: "positive", reason: "Nam Kim Steel trực tiếp hưởng lợi" },
    ],
  },
  {
    symbol: "STEEL_HRC",
    name: "Thép HRC",
    nameEn: "Steel HRC",
    group: "industrial_metals",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 6,
    stockImpacts: [
      { symbol: "HPG", impactType: "positive", reason: "HRC là sản phẩm chủ lực của Hòa Phát" },
      { symbol: "HSG", impactType: "neutral", reason: "Ảnh hưởng gián tiếp qua giá nguyên liệu" },
    ],
  },
  {
    symbol: "IRON_ORE",
    name: "Quặng sắt",
    nameEn: "Iron Ore",
    group: "industrial_metals",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 7,
    stockImpacts: [
      { symbol: "HPG", impactType: "negative", reason: "Quặng sắt tăng làm tăng chi phí nguyên liệu" },
    ],
  },
  {
    symbol: "COAL_COKING",
    name: "Than cốc",
    nameEn: "Coking Coal",
    group: "industrial_metals",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 8,
    stockImpacts: [
      { symbol: "HPG", impactType: "negative", reason: "Than cốc tăng làm tăng chi phí sản xuất thép" },
    ],
  },
  {
    symbol: "COPPER",
    name: "Đồng",
    nameEn: "Copper",
    group: "industrial_metals",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 9,
    stockImpacts: [],
  },
  {
    symbol: "NICKEL",
    name: "Nickel",
    nameEn: "Nickel",
    group: "industrial_metals",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 10,
    stockImpacts: [],
  },

  // ── Energy (Dầu thô, Xăng dầu, Khí thiên nhiên) ───────────────────────
  {
    symbol: "WTI_CRUDE",
    name: "Dầu thô WTI",
    nameEn: "WTI Crude Oil",
    group: "energy",
    unit: "USD/thùng",
    currency: "USD",
    source: "investing.com",
    displayOrder: 11,
    stockImpacts: [
      { symbol: "PLX", impactType: "positive", reason: "Dầu tăng cải thiện tồn kho giá trị" },
      { symbol: "PVD", impactType: "positive", reason: "Dịch vụ khoan dầu hưởng lợi" },
      { symbol: "PVS", impactType: "positive", reason: "Dịch vụ kỹ thuật dầu khí tăng trưởng" },
      { symbol: "BSR", impactType: "neutral", reason: "Biên lọc hóa dầu quan trọng hơn giá dầu" },
    ],
  },
  {
    symbol: "GAS_NATURAL",
    name: "Khí thiên nhiên",
    nameEn: "Natural Gas",
    group: "energy",
    unit: "USD/mmBTU",
    currency: "USD",
    source: "investing.com",
    displayOrder: 12,
    stockImpacts: [
      { symbol: "PVG", impactType: "positive", reason: "Phân phối khí trực tiếp hưởng lợi" },
      { symbol: "PGC", impactType: "positive", reason: "Kinh doanh khí hóa lỏng" },
    ],
  },
  {
    symbol: "GAS_RON95",
    name: "Xăng RON95",
    nameEn: "Gasoline RON95",
    group: "energy",
    unit: "VND/lít",
    currency: "VND",
    source: "petrolimex.com.vn",
    displayOrder: 13,
    stockImpacts: [
      { symbol: "PLX", impactType: "neutral", reason: "Giá bán lẻ điều chỉnh theo cơ chế nhà nước" },
    ],
  },
  {
    symbol: "GAS_RON92",
    name: "Xăng RON92",
    nameEn: "Gasoline RON92",
    group: "energy",
    unit: "VND/lít",
    currency: "VND",
    source: "petrolimex.com.vn",
    displayOrder: 14,
    stockImpacts: [],
  },
  {
    symbol: "DIESEL_DO",
    name: "Dầu DO",
    nameEn: "Diesel DO",
    group: "energy",
    unit: "VND/lít",
    currency: "VND",
    source: "petrolimex.com.vn",
    displayOrder: 15,
    stockImpacts: [],
  },

  // ── Agriculture (Ngô, Đậu nành, Gạo, Cà phê, Bông, Đường, Phân URE) ──
  {
    symbol: "CORN",
    name: "Ngô",
    nameEn: "Corn",
    group: "agriculture",
    unit: "USc/bushel",
    currency: "USD",
    source: "investing.com",
    displayOrder: 16,
    stockImpacts: [
      { symbol: "DBC", impactType: "negative", reason: "Ngô tăng làm tăng chi phí thức ăn chăn nuôi" },
      { symbol: "BAF", impactType: "negative", reason: "Chi phí nguyên liệu tăng" },
    ],
  },
  {
    symbol: "SOYBEAN",
    name: "Đậu nành",
    nameEn: "Soybean",
    group: "agriculture",
    unit: "USc/bushel",
    currency: "USD",
    source: "investing.com",
    displayOrder: 17,
    stockImpacts: [
      { symbol: "DBC", impactType: "negative", reason: "Đậu nành tăng làm tăng chi phí thức ăn chăn nuôi" },
    ],
  },
  {
    symbol: "RICE",
    name: "Gạo",
    nameEn: "Rice",
    group: "agriculture",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 18,
    stockImpacts: [
      { symbol: "VHG", impactType: "positive", reason: "Giá gạo xuất khẩu tăng" },
      { symbol: "AGM", impactType: "positive", reason: "Xuất khẩu gạo hưởng lợi" },
    ],
  },
  {
    symbol: "COFFEE_ARABICA",
    name: "Cà phê Arabica",
    nameEn: "Coffee Arabica",
    group: "agriculture",
    unit: "USc/lb",
    currency: "USD",
    source: "investing.com",
    displayOrder: 19,
    stockImpacts: [],
  },
  {
    symbol: "COFFEE_ROBUSTA",
    name: "Cà phê Robusta",
    nameEn: "Coffee Robusta",
    group: "agriculture",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 20,
    stockImpacts: [],
  },
  {
    symbol: "COTTON",
    name: "Bông",
    nameEn: "Cotton",
    group: "agriculture",
    unit: "USc/lb",
    currency: "USD",
    source: "investing.com",
    displayOrder: 21,
    stockImpacts: [
      { symbol: "STK", impactType: "neutral", reason: "Ảnh hưởng gián tiếp qua chi phí nguyên liệu" },
      { symbol: "TCM", impactType: "negative", reason: "Bông tăng làm tăng giá vốn" },
    ],
  },
  {
    symbol: "SUGAR",
    name: "Đường",
    nameEn: "Sugar",
    group: "agriculture",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 22,
    stockImpacts: [
      { symbol: "SBT", impactType: "positive", reason: "Giá đường tăng cải thiện doanh thu" },
      { symbol: "QNS", impactType: "positive", reason: "Đường Quảng Ngãi hưởng lợi" },
    ],
  },
  {
    symbol: "FERTILIZER_UREA",
    name: "Phân URE",
    nameEn: "Urea Fertilizer",
    group: "fertilizer",
    unit: "USD/tấn",
    currency: "USD",
    source: "investing.com",
    displayOrder: 23,
    stockImpacts: [
      { symbol: "DPM", impactType: "positive", reason: "Phân đạm Phú Mỹ trực tiếp hưởng lợi" },
      { symbol: "DCM", impactType: "positive", reason: "Đạm Cà Mau hưởng lợi từ giá urea tăng" },
    ],
  },

  // ── Livestock (Heo hơi, Tôm, Cá tra) ───────────────────────────────────
  {
    symbol: "PIG_NORTH",
    name: "Heo hơi miền Bắc",
    nameEn: "Live Pig (North Vietnam)",
    group: "livestock",
    unit: "VND/kg",
    currency: "VND",
    source: "hoinhanongdan.vn",
    displayOrder: 24,
    stockImpacts: [
      { symbol: "DBC", impactType: "positive", reason: "Giá heo hơi tăng cải thiện biên chăn nuôi" },
      { symbol: "BAF", impactType: "positive", reason: "Hưởng lợi từ giá heo hơi tăng" },
      { symbol: "HNG", impactType: "positive", reason: "Hoàng Anh Gia Lai có mảng chăn nuôi heo" },
    ],
  },
  {
    symbol: "SHRIMP_CARD",
    name: "Tôm thẻ (tại ao)",
    nameEn: "Whiteleg Shrimp (farm gate)",
    group: "livestock",
    unit: "VND/kg",
    currency: "VND",
    source: "thuysanvietnam.com.vn",
    displayOrder: 25,
    stockImpacts: [
      { symbol: "VHC", impactType: "positive", reason: "Vĩnh Hoàn hưởng lợi từ giá tôm xuất khẩu" },
      { symbol: "ANV", impactType: "positive", reason: "Nam Việt có mảng tôm" },
    ],
  },
  {
    symbol: "CATFISH_TRA",
    name: "Cá tra (tại ao)",
    nameEn: "Pangasius (farm gate)",
    group: "livestock",
    unit: "VND/kg",
    currency: "VND",
    source: "thuysanvietnam.com.vn",
    displayOrder: 26,
    stockImpacts: [
      { symbol: "VHC", impactType: "positive", reason: "Giá cá tra nguyên liệu ổn định giúp kiểm soát chi phí" },
      { symbol: "ANV", impactType: "positive", reason: "Nam Việt hưởng lợi" },
      { symbol: "FMC", impactType: "positive", reason: "Cá tra là sản phẩm chủ lực" },
    ],
  },
  {
    symbol: "PIG_CHINA",
    name: "Heo hơi Trung Quốc",
    nameEn: "Live Pig (China)",
    group: "livestock",
    unit: "CNY/kg",
    currency: "CNY",
    source: "agriculture.gov.cn",
    displayOrder: 27,
    stockImpacts: [
      { symbol: "HNG", impactType: "neutral", reason: "Giá heo Trung Quốc ảnh hưởng xuất khẩu" },
    ],
  },

  // ── Dairy (Sữa bột) ────────────────────────────────────────────────────
  {
    symbol: "MILK_WMP",
    name: "Sữa bột nguyên kem",
    nameEn: "Whole Milk Powder",
    group: "dairy",
    unit: "USD/tấn",
    currency: "USD",
    source: "globaldairytrade.info",
    displayOrder: 28,
    stockImpacts: [
      { symbol: "VNM", impactType: "negative", reason: "Sữa nguyên liệu tăng làm tăng giá vốn" },
      { symbol: "MCM", impactType: "negative", reason: "Mộc Châu Milk chịu áp lực chi phí" },
    ],
  },
  {
    symbol: "MILK_SMP",
    name: "Sữa bột tách béo",
    nameEn: "Skim Milk Powder",
    group: "dairy",
    unit: "USD/tấn",
    currency: "USD",
    source: "globaldairytrade.info",
    displayOrder: 29,
    stockImpacts: [
      { symbol: "VNM", impactType: "negative", reason: "Chi phí nguyên liệu tăng" },
    ],
  },

  // ── Rubber (Cao su) ────────────────────────────────────────────────────
  {
    symbol: "RUBBER_TSR20",
    name: "Cao su TSR20 Tokyo",
    nameEn: "Rubber TSR20 (Tokyo)",
    group: "rubber",
    unit: "JPY/kg",
    currency: "JPY",
    source: "jpx.co.jp",
    displayOrder: 30,
    stockImpacts: [
      { symbol: "DRI", impactType: "positive", reason: "Cao su Đà Lạt trực tiếp hưởng lợi" },
      { symbol: "TRC", impactType: "positive", reason: "Cao su Phước Hòa hưởng lợi" },
      { symbol: "PHR", impactType: "positive", reason: "Phú Hòa Tân có diện tích cao su lớn" },
      { symbol: "CSM", impactType: "positive", reason: "Cao su Sao Mai hưởng lợi" },
    ],
  },
  {
    symbol: "RUBBER_RSS3",
    name: "Cao su RSS3 Tokyo",
    nameEn: "Rubber RSS3 (Tokyo)",
    group: "rubber",
    unit: "JPY/kg",
    currency: "JPY",
    source: "jpx.co.jp",
    displayOrder: 31,
    stockImpacts: [
      { symbol: "DRI", impactType: "positive", reason: "Cao su Đà Lạt hưởng lợi" },
      { symbol: "HRC", impactType: "positive", reason: "Hưng Phước hưởng lợi" },
    ],
  },
];

/**
 * Helper: Lấy danh sách cổ phiếu bị ảnh hưởng bởi một commodity
 */
export function getStockImpactsForCommodity(symbol: string) {
  const commodity = COMMODITIES_LIST.find((c) => c.symbol === symbol);
  return commodity?.stockImpacts ?? [];
}

/**
 * Helper: Lấy danh sách commodities ảnh hưởng đến một cổ phiếu
 */
export function getCommoditiesForStock(stockSymbol: string) {
  return COMMODITIES_LIST.filter((c) =>
    c.stockImpacts.some((i) => i.symbol === stockSymbol.toUpperCase())
  ).map((c) => ({
    commodity: c,
    impact: c.stockImpacts.find((i) => i.symbol === stockSymbol.toUpperCase())!,
  }));
}
