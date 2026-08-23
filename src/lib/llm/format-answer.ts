/**
 * ORCA answer formatter.
 */

function formatVnd(n: number): string {
  return `${Math.round(n).toLocaleString("vi-VN")}đ`;
}

function parseMoney(text: string): number | null {
  const normalized = text.toLowerCase().replace(/,/g, ".").trim();
  const match = normalized.match(
    /(\d+(?:\.\d+)?)\s*(tỷ|tỉ|triệu|tr|nghìn|ngàn|k|đ|vnd|vnđ|đồng)?/,
  );
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2];
  if (unit === "tỷ" || unit === "tỉ") return value * 1_000_000_000;
  if (unit === "triệu" || unit === "tr") return value * 1_000_000;
  if (unit === "nghìn" || unit === "ngàn") return value * 1_000;
  if (unit === "k") return value * 1_000;
  return value;
}

function extractDays(text: string): number | null {
  const normalized = text.toLowerCase();
  const direct = normalized.match(/(\d+)\s*(ngày|ngay)/);
  if (direct) {
    const days = Number(direct[1]);
    return Number.isFinite(days) ? days : null;
  }
  if (normalized.includes("tuần sau") || normalized.includes("tuan sau")) return 7;
  if (normalized.includes("cuối tuần") || normalized.includes("cuoi tuan")) return 7;
  return null;
}

function fallbackPersonalFinance(question: string): string {
  const q = question.toLowerCase();

  if (/còn\s*\d|tài khoản\s*còn|tiền\s*còn|sống\s*đến|tiêu\s*đến|đủ\s*đến/.test(q)) {
    const money = parseMoney(q);
    const days = extractDays(q);
    if (money && days) {
      const reserve = Math.max(20_000, Math.round(money * 0.2));
      const spendable = Math.max(0, money - reserve);
      const daily = spendable / days;
      return (
        `Nếu bạn còn ${formatVnd(money)} và cần dùng trong khoảng ${days} ngày, ` +
        `mức chi tối đa về lý thuyết là khoảng ${formatVnd(money / days)}/ngày. ` +
        `Tôi khuyên giữ khoảng ${formatVnd(reserve)} làm khoản dự phòng, ` +
        `khi đó ngân sách chi tiêu còn khoảng ${formatVnd(spendable)}, ` +
        `tương đương khoảng ${formatVnd(daily)}/ngày. ` +
        `Trong thời gian này hãy ưu tiên 3 nhóm: ăn uống thiết yếu, đi lại và khoản bắt buộc; ` +
        `tạm dừng mua sắm không cần thiết. ` +
        `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
      );
    }
  }

  if (q.includes("lương") || q.includes("thu nhập") || q.includes("thu nhap")) {
    const money = parseMoney(q);
    if (money) {
      const essentials = money * 0.5;
      const lifestyle = money * 0.3;
      const saving = money * 0.2;
      return (
        `Với thu nhập khoảng ${formatVnd(money)}/tháng, ` +
        `tôi sẽ lấy 50/30/20 làm điểm xuất phát: khoảng ${formatVnd(essentials)} cho nhu cầu thiết yếu, ` +
        `${formatVnd(lifestyle)} cho nhu cầu cá nhân và ${formatVnd(saving)} cho tiết kiệm/đầu tư. ` +
        `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
      );
    }
  }

  return (
    `Tôi có thể tư vấn bài toán tài chính này, nhưng để đưa ra con số sát với tình huống của bạn tôi cần thêm dữ liệu. ` +
    `Bạn hãy cho tôi 3 thông tin: thu nhập/tháng, chi phí cố định/tháng và khoản nợ hiện tại nếu có. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

function fallbackCorporateFinance(_question: string): string {
  return (
    `Với bài toán tài chính doanh nghiệp, tôi sẽ ưu tiên kiểm tra theo thứ tự: ` +
    `1) dòng tiền hoạt động, 2) vốn lưu động, 3) nợ và khả năng trả lãi, ` +
    `4) biên lợi nhuận và 5) ROE/ROA. ` +
    `Nếu bạn cung cấp doanh thu, EBITDA hoặc EBIT, tổng nợ, chi phí lãi vay và dòng tiền hoạt động, ` +
    `tôi có thể tính các tỷ lệ chính và chỉ ra điểm rủi ro của doanh nghiệp. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

function fallbackWealthManagement(_question: string): string {
  return (
    `Với Wealth Management, tôi không khuyên chọn tỷ lệ tài sản chỉ dựa trên số tiền hiện có. ` +
    `Trước tiên cần xác định 4 biến: tổng tài sản ròng, chi phí sinh hoạt/tháng, ` +
    `mục tiêu sử dụng tiền trong 1–3 năm và mức chịu rủi ro. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

/** Humanize data-engine context when LLM is offline. */
function fallbackMarket(question: string, raw: string): string {
  // Match composeDeterministicAnswer format
  const tech =
    raw.match(
      /Với\s+([A-Z]{2,5}),\s+khuyến nghị kỹ thuật\s+([^(.]+?)\s*\(độ tin cậy\s*([^)]+)\)\.\s*Giá\s+([^,]+),\s*1D\s+([^%]+)%\s*,\s*1M\s+([^%]+)%/i,
    ) ||
    raw.match(
      /Với\s+([A-Z]{2,5}),\s+khuyến nghị kỹ thuật hiện tại là\s+([^.(]+).*?Giá gần nhất\s+([^,]+),\s+biến động 1 ngày\s+([^%]+)%\s+và 1 tháng\s+([^%]+)%/i,
    );

  if (tech) {
    const symbol = tech[1];
    const recommendation = tech[2].trim();
    // Format A: conf, price, 1d, 1m | Format B: price, 1d, 1m
    const price = tech.length >= 7 ? tech[4].trim() : tech[3].trim();
    const oneDay = tech.length >= 7 ? tech[5].trim() : tech[4].trim();
    const oneMonth = tech.length >= 7 ? tech[6].trim() : tech[5].trim();
    const conf = tech.length >= 7 ? tech[3].trim() : "";

    let rsi = "";
    const rsiM = raw.match(/RSI\(14\)\s+([^,]+)/i);
    if (rsiM) rsi = ` RSI(14) khoảng ${rsiM[1].trim()}.`;

    return (
      `${symbol}: giá gần nhất ${price}, biến động ${oneDay}% trong 1 ngày và ${oneMonth}% trong 1 tháng. ` +
      `Tín hiệu kỹ thuật nghiêng về ${recommendation}` +
      (conf ? ` (độ tin cậy khoảng ${conf})` : "") +
      `.${rsi} ` +
      `Đây chỉ là tín hiệu xác suất, không phải cam kết giá sẽ đi theo hướng đó. ` +
      `Nên xem thêm xu hướng, vùng hỗ trợ/kháng cự và định giá cơ bản trước khi quyết định. ` +
      `Bạn có thể hỏi tiếp kịch bản tăng/giảm hoặc so sánh với mã khác. ` +
      `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
    );
  }

  const marketMatch = raw.match(
    /VN-Index\s+ở mức\s+([^;]+);\s*HNX-Index\s+ở mức\s+([^;]+);\s*UPCOM-Index\s+ở mức\s+([^.\n]+)/i,
  );
  if (marketMatch) {
    return (
      `Theo dữ liệu hiện tại, VN-Index đang ở mức ${marketMatch[1]}, ` +
      `HNX-Index ở ${marketMatch[2]} và UPCOM-Index ở ${marketMatch[3]}. ` +
      `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
    );
  }

  // Context has symbol mentions but no parse — still better than generic
  if (/Với\s+[A-Z]{2,5}/.test(raw) || raw.length > 200) {
    const cleaned = raw
      .replace(/Chủ đề gợi ý \(nội bộ\):[^\n]+/gi, "")
      .replace(/Nội dung khách hỏi:[^\n]+/gi, "")
      .replace(/\n{2,}/g, " ")
      .trim()
      .slice(0, 900);
    if (cleaned.length > 80) {
      return (
        `${cleaned} ` +
        `Đây là phân tích tham khảo dựa trên dữ liệu kỹ thuật/cơ bản sẵn có (chế độ dự phòng khi LLM tạm thời không phản hồi). ` +
        `Không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
      );
    }
  }

  const ticker = question.toUpperCase().match(/\b([A-Z]{3})\b/);
  return (
    `Tôi đã nhận yêu cầu phân tích${ticker ? ` ${ticker[1]}` : " thị trường"}. ` +
    `Hiện chưa lấy đủ giá/chỉ báo realtime (có thể do nguồn dữ liệu hoặc database đang chậm). ` +
    `Bạn thử lại sau vài giây, hoặc hỏi cụ thể: giá, RSI, hỗ trợ/kháng cự. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

export function buildAdvisorFallback(question: string, rawContext: string): string {
  const lower = question.toLowerCase();
  const hasTicker = /\b[A-Z]{3}\b/.test(question.toUpperCase());
  const isMarket =
    hasTicker ||
    /phân\s*tích|phan\s*tich|vn-index|vn30|hnx|upcom|cổ\s*phiếu|chứng\s*khoán|btc|bitcoin|crypto|forex|vàng|thị\s*trường/.test(
      lower,
    );

  if (
    lower.includes("personal_finance") ||
    (/lương|thu nhập|chi tiêu|tiết kiệm|nợ|còn\s*\d|tài khoản|tiền/.test(lower) && !isMarket)
  ) {
    return fallbackPersonalFinance(question);
  }

  if (
    lower.includes("corporate") ||
    /doanh nghiệp|công ty|bctc|ebitda|ebit|roe|roa|dòng tiền doanh nghiệp/.test(lower)
  ) {
    return fallbackCorporateFinance(question);
  }

  if (
    lower.includes("wealth") ||
    /tài sản ròng|phân bổ tài sản|danh mục|hưu trí|đa dạng hóa/.test(lower)
  ) {
    return fallbackWealthManagement(question);
  }

  if (isMarket) {
    return fallbackMarket(question, rawContext);
  }

  // Prefer non-empty data context over pure generic
  if (rawContext && rawContext.length > 120) {
    return fallbackMarket(question, rawContext);
  }

  return (
    `Tôi có thể hỗ trợ bạn về tài chính cá nhân, doanh nghiệp, quản lý tài sản hoặc thị trường. ` +
    `Hãy đưa cho tôi câu hỏi cụ thể cùng số liệu bạn đang có; tôi sẽ tính toán và đưa ra phương án theo thứ tự ưu tiên. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

export function smoothAgentAnswer(raw: string): string {
  if (!raw) return raw;

  let text = raw.replace(/\r\n/g, "\n").trim();

  text = text.replace(
    /^(Câu hỏi người dùng|Phân loại intent|DỮ LIỆU REAL-TIME TỪ DATA ENGINE|DỮ LIỆU REAL-TIME|HỒ SƠ TÀI CHÍNH [^:]+|Tổng quan thị trường \(Data Engine\))\s*:/gim,
    "",
  );

  text = text.replace(
    /\b(?:rule-engine|deterministic|agent_chat|providersConfigured|Data Engine context)\b/gi,
    "",
  );

  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*([-*_]){3,}\s*$/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");

  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
