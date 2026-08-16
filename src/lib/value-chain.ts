/**
 * Porter Value Chain generator — deterministic, sector-keyed.
 *
 * Produces a primary-activity pipeline (5 nodes) and a support-activity rail (4 nodes)
 * tailored to the company's sector/industry. Each activity carries a Vietnamese name,
 * an English canonical name, a one-line description, and an emoji glyph used in the UI.
 * The generator is fully deterministic for a given (symbol, sector) tuple, so the same
 * company always renders the same chain — which is what we want for a cached DB row.
 *
 * This is intentionally rule-based (not LLM) so it works offline, is instant, and
 * never introduces "upstream data unavailable" failure modes.
 */

import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";

export interface ValueActivity {
  name: string;
  nameVi: string;
  description: string;
  icon: string;
}

export interface ValueChain {
  primary: ValueActivity[];
  support: ValueActivity[];
  modelVersion: string;
  sector: string;
  industry: string;
}

const TEMPLATES: Record<string, { primary: ValueActivity[]; support: ValueActivity[] }> = {
  consumer_staples: {
    primary: [
      { name: "Inbound Logistics", nameVi: "Thu mua nguyên liệu", description: "Hợp tác trang trại & nhà cung cấp; kiểm soát chất lượng đầu vào theo tiêu chuẩn nội bộ.", icon: "🌾" },
      { name: "Operations", nameVi: "Sản xuất & đóng gói", description: "Vận hành dây chuyền tự động đạt chuẩn ISO/HACCP; tối ưu tỷ lệ hao hụt.", icon: "🏭" },
      { name: "Outbound Logistics", nameVi: "Phân phối", description: "Mạng lưới kho lạnh + kênh siêu thị/đại lý toàn quốc; giao hàng trong 24-48h.", icon: "🚚" },
      { name: "Marketing & Sales", nameVi: "Marketing & bán hàng", description: "Chiến dịch sức khỏe gia đình; hiện diện thương hiệu trên TV, digital, POS.", icon: "📣" },
      { name: "Service", nameVi: "Chăm sóc khách hàng", description: "Đường dây nóng, khảo sát hài lòng, xử lý khiếu nại nhanh.", icon: "💬" },
    ],
    support: [
      { name: "R&D", nameVi: "Nghiên cứu & phát triển sản phẩm", description: "Công thức mới, dòng organic, sản phẩm chức năng theo xu hướng sức khỏe.", icon: "🔬" },
      { name: "Cold-chain SCM", nameVi: "Quản trị chuỗi cung ứng lạnh", description: "Hệ thống bảo quản nhiệt độ nghiêm ngặt từ nhà máy tới điểm bán.", icon: "❄️" },
      { name: "ERP & Data", nameVi: "Hệ thống ERP & phân tích dữ liệu", description: "Quản trị tồn kho, dự báo cầu, tối ưu khuyến mại theo vùng.", icon: "💾" },
      { name: "HR & Training", nameVi: "Nhân sự & đào tạo", description: "Chương trình đào tạo đại lý, đội ngũ bán hàng và vận hành nhà máy.", icon: "🎓" },
    ],
  },
  banking: {
    primary: [
      { name: "Deposit Origination", nameVi: "Huy động vốn", description: "Mạng lưới chi nhánh + ngân hàng số; sản phẩm tiền gửi linh hoạt.", icon: "🏦" },
      { name: "Credit Underwriting", nameVi: "Thẩm định & cấp tín dụng", description: "Mô hình chấm điểm tín dụng nội bộ; phân khúc khách hàng doanh nghiệp & cá nhân.", icon: "📋" },
      { name: "Loan Servicing", nameVi: "Quản lý khoản vay", description: "Giám sát giải ngân, thu nợ, cơ cấu nợ; hệ thống cảnh báo sớm nợ xấu.", icon: "🔄" },
      { name: "Treasury & Markets", nameVi: "Kinh doanh vốn & ngoại hối", description: "Quản trị danh mục trái phiếu, giao dịch FX, phái sinh phòng hộ.", icon: "📈" },
      { name: "Customer Advisory", nameVi: "Tư vấn & bancassurance", description: "Chéo bán bảo hiểm, quỹ, sản phẩm phái sinh cho khách hàng ưu tiên.", icon: "🤝" },
    ],
    support: [
      { name: "Risk & Compliance", nameVi: "Quản trị rủi ro & tuân thủ", description: "Khung Basel III, AML/KYC, kiểm toán nội bộ, mô hình IRB.", icon: "🛡️" },
      { name: "Core Banking IT", nameVi: "Hệ thống core banking", description: "Nền tảng giao dịch lõi, API open banking, mobile banking.", icon: "🖥️" },
      { name: "Data & AI", nameVi: "Dữ liệu & trí tuệ nhân tạo", description: "Chấm điểm tín dụng ML, phát hiện gian lận realtime, cá nhân hóa ưu đãi.", icon: "🧠" },
      { name: "HR & Governance", nameVi: "Quản trị nhân sự & HĐQT", description: "Chính sách lương-thưởng gắn KPI, đào tạo cán bộ tín dụng.", icon: "👥" },
    ],
  },
  real_estate: {
    primary: [
      { name: "Land Bank & M&A", nameVi: "Quỹ đất & M&A", description: "Săn quỹ đất sạch; thâu tóm dự án; pháp lý đền bù giải phóng mặt bằng.", icon: "🗺️" },
      { name: "Design & Permitting", nameVi: "Thiết kế & pháp lý", description: "Quy hoạch 1/500, giấy phép xây dựng, PCCC, đánh giá tác động môi trường.", icon: "📐" },
      { name: "Construction", nameVi: "Thi công xây dựng", description: "Tổng thầu + nhà thầu phụ; kiểm soát tiến độ, chi phí, chất lượng.", icon: "🏗️" },
      { name: "Sales & Leasing", nameVi: "Bán hàng & cho thuê", description: "Mạng môi giới, chính sách thanh toán, marketing dự án.", icon: "🏷️" },
      { name: "Property Management", nameVi: "Quản lý vận hành", description: "Ban quản lý, bảo trì, an ninh, tiện ích cư dân & thương mại.", icon: "🧰" },
    ],
    support: [
      { name: "Capital Structuring", nameVi: "Cấu trúc vốn", description: "Trái phiếu doanh nghiệp, tín dụng ngân hàng, quỹ đầu tư, hợp tác chiến lược.", icon: "💰" },
      { name: "Legal & Regulatory", nameVi: "Pháp lý & quan hệ cơ quan", description: "Theo sát Luật Đất đai, Nhà ở, Kinh doanh BĐS; xin chấp thuận đầu tư.", icon: "⚖️" },
      { name: "BIM & PropTech", nameVi: "BIM & công nghệ BĐS", description: "Mô hình thông tin xây dựng; nền tảng booking & quản lý cư dân.", icon: "🛰️" },
      { name: "HR & Safety", nameVi: "Nhân sự & an toàn lao động", description: "Đào tạo công trường, quy trình HSE, KPI dự án.", icon: "🦺" },
    ],
  },
  steel: {
    primary: [
      { name: "Raw Material Sourcing", nameVi: "Thu mua nguyên liệu", description: "Quặng sắt, than cốc, phế liệu — hợp đồng kỳ hạn để phòng hộ giá.", icon: "⛏️" },
      { name: "Smelting & Rolling", nameVi: "Luyện & cán thép", description: "Lò cao / lò điện hồ quang; cán nóng, cán nguội, mạ kẽm.", icon: "🔥" },
      { name: "Quality Control", nameVi: "Kiểm soát chất lượng", description: "Phòng lab cơ-lý-hóa; chứng chỉ tiêu chuẩn quốc tế (JIS, ASTM, TCVN).", icon: "🔍" },
      { name: "Distribution", nameVi: "Phân phối", description: "Hệ thống đại lý vùng, kho trung chuyển, giao hàng dự án.", icon: "🚛" },
      { name: "Technical Service", nameVi: "Dịch vụ kỹ thuật", description: "Tư vấn chủng loại, gia công cắt uốn theo yêu cầu công trình.", icon: "🛠️" },
    ],
    support: [
      { name: "Hedging & Treasury", nameVi: "Phòng hộ & tài chính", description: "Hợp đồng tương lai quặng/than; quản trị rủi ro tỷ giá USD nhập khẩu.", icon: "📉" },
      { name: "R&D Metallurgy", nameVi: "R&D luyện kim", description: "Thép hợp kim cao, thép xây dựng mác cao, thép chế tạo cơ khí.", icon: "🧪" },
      { name: "Energy & ESG", nameVi: "Năng lượng & môi trường", description: "Thu hồi nhiệt thải, điện mặt trời mái nhà, xử lý xỉ & nước thải.", icon: "♻️" },
      { name: "Logistics IT", nameVi: "Hệ thống logistics", description: "Tối ưu vận tải biển & đường bộ; định vị lô hàng realtime.", icon: "📡" },
    ],
  },
  technology: {
    primary: [
      { name: "R&D & Product", nameVi: "Nghiên cứu & phát triển", description: "Đội ngũ kỹ sư phần cứng & phần mềm; framework nội bộ; bằng sáng chế.", icon: "💡" },
      { name: "Delivery & Integration", nameVi: "Triển khai & tích hợp", description: "Dự án CNTT cho chính phủ, ngân hàng, viễn thông; mô hình agile.", icon: "🧩" },
      { name: "Managed Services", nameVi: "Dịch vụ vận hành thuê ngoài", description: "SOC, NOC, cloud managed services, SLA 99.9%.", icon: "🛰️" },
      { name: "Global Export", nameVi: "Xuất khẩu phần mềm", description: "Offshore centers tại Nhật, Mỹ, EU; hợp đồng khung nhiều năm.", icon: "🌐" },
      { name: "Customer Success", nameVi: "Thành công khách hàng", description: "Đội CS chuyên ngành; chương trình up-sell & cross-sell giải pháp.", icon: "🎯" },
    ],
    support: [
      { name: "Talent & Academy", nameVi: "Nhân tài & học viện", description: "Đại học nội bộ; chương trình Fresher; chứng chỉ quốc tế.", icon: "🎓" },
      { name: "Cloud & DevOps", nameVi: "Hạ tầng cloud & DevOps", description: "Multi-cloud, CI/CD, bảo mật DevSecOps, observability.", icon: "☁️" },
      { name: "IP & Compliance", nameVi: "Sở hữu trí tuệ & tuân thủ", description: "Bảo hộ sáng chế; tuân thủ GDPR, ISO 27001, SOC 2.", icon: "📜" },
      { name: "Data Platform", nameVi: "Nền tảng dữ liệu", description: "Data lake, MLOps, AI platform nội bộ cho mọi đơn vị.", icon: "🧠" },
    ],
  },
  retail: {
    primary: [
      { name: "Merchandising", nameVi: "Mua hàng & danh mục", description: "Đàm phán nhà cung cấp; quản trị SKU theo vòng đời sản phẩm.", icon: "🛒" },
      { name: "Store Network", nameVi: "Mạng lưới cửa hàng", description: "Siêu thị, cửa hàng tiện lợi, điện máy — mở mới theo mô hình cluster.", icon: "🏬" },
      { name: "Logistics & DC", nameVi: "Kho & phân phối", description: "Trung tâm phân phối vùng; cross-dock; giao hàng chặng cuối.", icon: "📦" },
      { name: "Omnichannel Sales", nameVi: "Bán hàng đa kênh", description: "App, web, click & collect, giao 2h; tích hợp tồn kho realtime.", icon: "📱" },
      { name: "Customer Loyalty", nameVi: "Khách hàng thân thiết", description: "Chương trình điểm thưởng, thẻ thành viên, ưu đãi cá nhân hoá.", icon: "💎" },
    ],
    support: [
      { name: "Data & AI", nameVi: "Dữ liệu & AI", description: "Dự báo cầu, tối ưu giá động, gợi ý giỏ hàng, ngăn chặn thất thoát.", icon: "🧠" },
      { name: "Supply Chain Finance", nameVi: "Tài chính chuỗi cung ứng", description: "Thanh toán sớm nhà cung cấp; factoring; tín dụng tiêu dùng.", icon: "💳" },
      { name: "HR & Training", nameVi: "Nhân sự & đào tạo", description: "Đào tạo nhân viên cửa hàng, quản lý ca, KPI dịch vụ.", icon: "🧑🏫" },
      { name: "Store Tech", nameVi: "Công nghệ cửa hàng", description: "POS, self-checkout, camera AI đếm khách, kệ điện tử.", icon: "📟" },
    ],
  },
  energy: {
    primary: [
      { name: "Upstream / Sourcing", nameVi: "Khai thác / mua khí", description: "Hợp đồng bao tiêu khí, mỏ dầu khí liên doanh, nhập LNG.", icon: "🛢️" },
      { name: "Processing", nameVi: "Chế biến & lọc hoá dầu", description: "Nhà máy xử lý khí, đạm, điện; vận hành an toàn 24/7.", icon: "⚗️" },
      { name: "Transmission", nameVi: "Vận chuyển & phân phối", description: "Hệ thống đường ống, trạm nén, lưới điện truyền tải.", icon: "🔌" },
      { name: "Commercial", nameVi: "Kinh doanh thương mại", description: "Hợp đồng mua bán điện/khí dài hạn; thị trường bán buôn.", icon: "📊" },
      { name: "Maintenance & HSE", nameVi: "Bảo dưỡng & an toàn", description: "Bảo dưỡng định kỳ, turnaround, quy trình HSE nghiêm ngặt.", icon: "🧯" },
    ],
    support: [
      { name: "Regulatory Affairs", nameVi: "Pháp lý & cơ chế giá", description: "Làm việc với cơ quan điều tiết; đề xuất cơ chế giá khí/điện.", icon: "📑" },
      { name: "Energy Transition", nameVi: "Chuyển dịch năng lượng", description: "Điện gió, mặt trời, hydro, CCS — danh mục giảm phát thải.", icon: "🌱" },
      { name: "SCADA & OT", nameVi: "SCADA & công nghệ vận hành", description: "Hệ thống giám sát điều khiển, an ninh mạng OT.", icon: "📡" },
      { name: "Talent & Safety", nameVi: "Nhân sự kỹ thuật cao", description: "Đào tạo kỹ sư vận hành, chứng chỉ quốc tế, an toàn lao động.", icon: "👷" },
    ],
  },
  securities: {
    primary: [
      { name: "Retail Brokerage", nameVi: "Môi giới khách hàng cá nhân", description: "Nền tảng giao dịch, margin, đội ngũ môi giới tư vấn.", icon: "📊" },
      { name: "Institutional Sales", nameVi: "Khách hàng tổ chức", description: "Dịch vụ cho quỹ, bảo hiểm, khối ngoại; execution chất lượng cao.", icon: "🏛️" },
      { name: "Proprietary Trading", nameVi: "Tự doanh", description: "Danh mục cổ phiếu, trái phiếu, phái sinh; quản trị rủi ro VaR.", icon: "🎯" },
      { name: "Investment Banking", nameVi: "Ngân hàng đầu tư", description: "Tư vấn IPO, phát hành riêng lẻ, M&A, trái phiếu doanh nghiệp.", icon: "💼" },
      { name: "Wealth Management", nameVi: "Quản lý gia sản", description: "Sản phẩm cấu trúc, quỹ, tư vấn danh mục cho khách HNWI.", icon: "💎" },
    ],
    support: [
      { name: "Risk & Margin", nameVi: "Quản trị rủi ro & margin", description: "Hệ thống call margin tự động, giới hạn vị thế, stress test.", icon: "🛡️" },
      { name: "Trading Tech", nameVi: "Hạ tầng giao dịch", description: "Matching engine latency thấp, API cho algo trader, FIX gateway.", icon: "⚡" },
      { name: "Research", nameVi: "Phân tích & nghiên cứu", description: "Đội ngũ analyst ngành, mô hình định giá, báo cáo chiến lược.", icon: "📑" },
      { name: "Compliance", nameVi: "Tuân thủ & kiểm soát nội bộ", description: "Giám sát giao dịch bất thường, ngăn xung đột lợi ích.", icon: "⚖️" },
    ],
  },
  conglomerate: {
    primary: [
      { name: "Portfolio Strategy", nameVi: "Chiến lược danh mục", description: "Phân bổ vốn giữa các mảng; M&A; thoái vốn mảng không cốt lõi.", icon: "🎯" },
      { name: "Operating Units", nameVi: "Vận hành các đơn vị thành viên", description: "Mỗi đơn vị P&L độc lập, chia sẻ dịch vụ tập đoàn.", icon: "🏢" },
      { name: "Shared Services", nameVi: "Dịch vụ dùng chung", description: "Mua sắm tập trung, IT, pháp lý, tài chính tập đoàn.", icon: "🧩" },
      { name: "Brand & Ecosystem", nameVi: "Thương hiệu & hệ sinh thái", description: "Chéo bán sản phẩm giữa các đơn vị; chương trình khách hàng thân thiết hợp nhất.", icon: "🔗" },
      { name: "Stakeholder Relations", nameVi: "Quan hệ cổ đông & đối tác", description: "IR, quan hệ nhà nước, hợp tác chiến lược quốc tế.", icon: "🤝" },
    ],
    support: [
      { name: "Capital Allocation", nameVi: "Phân bổ vốn & treasury", description: "Tối ưu WACC tập đoàn; phát hành trái phiếu, cổ phiếu chiến lược.", icon: "💰" },
      { name: "Governance", nameVi: "Quản trị tập đoàn", description: "HĐQT độc lập, ủy ban kiểm toán, chính sách ESG cấp tập đoàn.", icon: "🏛️" },
      { name: "Group IT & Data", nameVi: "IT & dữ liệu tập đoàn", description: "Data platform hợp nhất, ERP dùng chung, an ninh mạng.", icon: "🖥️" },
      { name: "Leadership Pipeline", nameVi: "Đội ngũ lãnh đạo kế cận", description: "Chương trình quy hoạch CEO đơn vị thành viên, luân chuyển nhân tài.", icon: "🌱" },
    ],
  },
  utilities: {
    primary: [
      { name: "Generation / Sourcing", nameVi: "Sản xuất / mua đầu vào", description: "Nhà máy thuỷ điện, nhiệt điện, nước; hợp đồng mua nhiên liệu.", icon: "⚡" },
      { name: "Transmission", nameVi: "Truyền tải", description: "Lưới điện cao thế, đường ống nước thô, trạm biến áp.", icon: "🔌" },
      { name: "Distribution", nameVi: "Phân phối tới khách hàng", description: "Lưới trung/hạ thế; đồng hồ thông minh; đọc chỉ số tự động.", icon: "🏘️" },
      { name: "Billing & Collection", nameVi: "Hoá đơn & thu tiền", description: "Hệ thống tính giá bậc thang, thu qua ví điện tử, ngân hàng.", icon: "🧾" },
      { name: "Customer Care", nameVi: "Chăm sóc khách hàng", description: "Tổng đài 24/7, ứng dụng báo mất điện/mất nước, CSKH khu vực.", icon: "📞" },
    ],
    support: [
      { name: "Regulatory & Tariff", nameVi: "Cơ chế giá & pháp lý", description: "Làm việc với cơ quan điều tiết; đề xuất biểu giá, cơ chế PPA.", icon: "📜" },
      { name: "Asset Management", nameVi: "Quản lý tài sản", description: "Bảo trì dựa trên điều kiện (CBM), giám sát rung/nhiệt IoT.", icon: "🔧" },
      { name: "Grid Digitalisation", nameVi: "Số hoá lưới điện", description: "SCADA, DMS, dự báo phụ tải ML, tích hợp năng lượng tái tạo.", icon: "📡" },
      { name: "ESG & Safety", nameVi: "Môi trường & an toàn", description: "Giảm phát thải, an toàn điện, ứng phó thiên tai.", icon: "🌿" },
    ],
  },
};

const FALLBACK = TEMPLATES.conglomerate;

export function generateValueChain(symbol: string, sectorKey?: string): ValueChain {
  const benchmark = getBenchmarkForSymbol(symbol);
  const key = sectorKey ?? benchmarkKeyFor(benchmark.sector, benchmark.industry);
  const tpl = TEMPLATES[key] ?? FALLBACK;
  return {
    primary: tpl.primary,
    support: tpl.support,
    modelVersion: "porter-v1",
    sector: benchmark.sector,
    industry: benchmark.industry,
  };
}

function benchmarkKeyFor(sector: string, industry: string): string {
  const s = `${sector} ${industry}`.toLowerCase();
  if (s.includes("ngân hàng") || s.includes("banking")) return "banking";
  if (s.includes("chứng khoán") || s.includes("securities")) return "securities";
  if (s.includes("bất động sản") || s.includes("real estate")) return "real_estate";
  if (s.includes("thép") || s.includes("steel") || s.includes("kim loại")) return "steel";
  if (s.includes("công nghệ") || s.includes("cntt") || s.includes("technology")) return "technology";
  if (s.includes("bán lẻ") || s.includes("retail")) return "retail";
  if (s.includes("năng lượng") || s.includes("dầu khí")) return "energy";
  if (s.includes("tiện ích") || s.includes("utilities") || s.includes("điện") || s.includes("nước")) return "utilities";
  if (s.includes("thực phẩm") || s.includes("đồ uống") || s.includes("tiêu dùng")) return "consumer_staples";
  if (s.includes("đa ngành") || s.includes("conglomerate")) return "conglomerate";
  return "conglomerate";
}
