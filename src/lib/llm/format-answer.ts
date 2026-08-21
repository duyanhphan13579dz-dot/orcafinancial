/**
 * ORCA answer formatter.
 *
 * Responsibilities:
 * 1. Clean model formatting.
 * 2. Remove accidental internal/system terminology.
 * 3. Provide a useful deterministic advisor response when no LLM
 *    provider is available.
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

  if (unit === "tỷ" || unit === "tỉ") {
    return value * 1_000_000_000;
  }

  if (unit === "triệu" || unit === "tr") {
    return value * 1_000_000;
  }

  if (unit === "nghìn" || unit === "ngàn") {
    return value * 1_000;
  }

  if (unit === "k") {
    return value * 1_000;
  }

  return value;
}

function extractDays(text: string): number | null {
  const normalized = text.toLowerCase();

  const direct = normalized.match(
    /(\d+)\s*(ngày|ngay)/,
  );

  if (direct) {
    const days = Number(direct[1]);
    return Number.isFinite(days) ? days : null;
  }

  if (
    normalized.includes("tuần sau") ||
    normalized.includes("tuan sau")
  ) {
    return 7;
  }

  if (
    normalized.includes("cuối tuần") ||
    normalized.includes("cuoi tuan")
  ) {
    return 7;
  }

  return null;
}

function fallbackPersonalFinance(
  question: string,
): string {
  const q = question.toLowerCase();

  /*
   * Short-term cash management.
   */
  if (
    /còn\s*\d|tài khoản\s*còn|tiền\s*còn|sống\s*đến|tiêu\s*đến|đủ\s*đến/.test(
      q,
    )
  ) {
    const money = parseMoney(q);
    const days = extractDays(q);

    if (money && days) {
      const reserve = Math.max(
        20_000,
        Math.round(money * 0.2),
      );

      const spendable = Math.max(
        0,
        money - reserve,
      );

      const daily = spendable / days;

      return (
        `Nếu bạn còn ${formatVnd(money)} và cần dùng trong khoảng ${days} ngày, ` +
        `mức chi tối đa về lý thuyết là khoảng ${formatVnd(money / days)}/ngày. ` +
        `Tôi khuyên giữ khoảng ${formatVnd(reserve)} làm khoản dự phòng, ` +
        `khi đó ngân sách chi tiêu còn khoảng ${formatVnd(spendable)}, ` +
        `tương đương khoảng ${formatVnd(daily)}/ngày. ` +
        `Trong thời gian này hãy ưu tiên 3 nhóm: ăn uống thiết yếu, đi lại và khoản bắt buộc; ` +
        `tạm dừng mua sắm không cần thiết. ` +
        `Nếu bạn cho tôi biết còn bao nhiêu ngày chính xác và mỗi ngày phải chi tiền ăn/đi lại khoảng bao nhiêu, ` +
        `tôi có thể chia ngân sách thành kế hoạch từng ngày. ` +
        `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
      );
    }
  }

  /*
   * Monthly income.
   */
  if (
    q.includes("lương") ||
    q.includes("thu nhập") ||
    q.includes("thu nhap")
  ) {
    const money = parseMoney(q);

    if (money) {
      const essentials = money * 0.5;
      const lifestyle = money * 0.3;
      const saving = money * 0.2;

      return (
        `Với thu nhập khoảng ${formatVnd(money)}/tháng, ` +
        `tôi sẽ lấy 50/30/20 làm điểm xuất phát: khoảng ${formatVnd(essentials)} cho nhu cầu thiết yếu, ` +
        `${formatVnd(lifestyle)} cho nhu cầu cá nhân và ${formatVnd(saving)} cho tiết kiệm/đầu tư. ` +
        `Đây không phải tỷ lệ cứng. Nếu tiền thuê nhà hoặc khoản trả nợ đang cao, ` +
        `nên ưu tiên hai khoản này trước rồi mới phân bổ phần còn lại. ` +
        `Bạn chỉ cần cho tôi biết tiền thuê nhà, khoản trả nợ và chi phí sinh hoạt mỗi tháng, ` +
        `tôi sẽ lập ngân sách cụ thể cho mức lương này. ` +
        `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
      );
    }
  }

  /*
   * Large cash balance.
   */
  if (
    /có\s*\d|đang\s*có\s*\d|100\s*triệu|tiền\s*nhàn|tiền\s*mặt/.test(
      q,
    )
  ) {
    const money = parseMoney(q);

    if (money) {
      return (
        `Nếu ${formatVnd(money)} là khoản tiền bạn đang có, tôi chưa khuyên đưa toàn bộ số tiền vào đầu tư ngay. ` +
        `Trước tiên cần tách tiền thành 3 lớp: quỹ dự phòng, tiền cho mục tiêu trong 12 tháng và phần vốn có thể đầu tư dài hạn. ` +
        `Ví dụ nếu chi phí thiết yếu của bạn là 10 triệu/tháng thì quỹ dự phòng 6 tháng tương đương 60 triệu. ` +
        `Phần còn lại mới nên được đánh giá theo mục tiêu và mức chịu rủi ro. ` +
        `Nếu bạn cho tôi biết chi phí sinh hoạt/tháng, khoản nợ hiện tại và thời gian bạn cần dùng số tiền này, ` +
        `tôi sẽ giúp bạn xây phương án phân bổ cụ thể. ` +
        `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
      );
    }
  }

  return (
    `Tôi có thể tư vấn bài toán tài chính này, nhưng để đưa ra con số sát với tình huống của bạn tôi cần thêm dữ liệu. ` +
    `Bạn hãy cho tôi 3 thông tin: thu nhập/tháng, chi phí cố định/tháng và khoản nợ hiện tại nếu có. ` +
    `Từ đó tôi sẽ tính ngân sách, khả năng tiết kiệm và thứ tự ưu tiên tài chính cho bạn. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

function fallbackCorporateFinance(
  question: string,
): string {
  return (
    `Với bài toán tài chính doanh nghiệp, tôi sẽ ưu tiên kiểm tra theo thứ tự: ` +
    `1) dòng tiền hoạt động, 2) vốn lưu động, 3) nợ và khả năng trả lãi, ` +
    `4) biên lợi nhuận và 5) ROE/ROA. ` +
    `Nếu bạn cung cấp doanh thu, EBITDA hoặc EBIT, tổng nợ, chi phí lãi vay và dòng tiền hoạt động, ` +
    `tôi có thể tính các tỷ lệ chính và chỉ ra điểm rủi ro của doanh nghiệp. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

function fallbackWealthManagement(
  question: string,
): string {
  return (
    `Với Wealth Management, tôi không khuyên chọn tỷ lệ tài sản chỉ dựa trên số tiền hiện có. ` +
    `Trước tiên cần xác định 4 biến: tổng tài sản ròng, chi phí sinh hoạt/tháng, ` +
    `mục tiêu sử dụng tiền trong 1–3 năm và mức chịu rủi ro. ` +
    `Sau đó mới phân bổ giữa tiền mặt, tài sản thu nhập cố định và tài sản tăng trưởng. ` +
    `Nếu bạn cho tôi 4 thông tin này, tôi có thể xây một khung phân bổ tài sản cụ thể. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

function fallbackMarket(
  question: string,
  raw: string,
): string {
  /*
   * Try to preserve the real Data Engine numbers without exposing
   * internal labels.
   */

  const vcbMatch = raw.match(
    /Với\s+([A-Z]{3}),\s+khuyến nghị kỹ thuật hiện tại là\s+([^.(]+).*?Giá gần nhất\s+([^,]+),\s+biến động 1 ngày\s+([^%]+)%\s+và 1 tháng\s+([^%]+)%/i,
  );

  if (vcbMatch) {
    const symbol = vcbMatch[1];
    const recommendation = vcbMatch[2].trim();
    const price = vcbMatch[3].trim();
    const oneDay = vcbMatch[4].trim();
    const oneMonth = vcbMatch[5].trim();

    return (
      `${symbol} hiện có giá gần nhất ${price}, biến động ${oneDay}% trong 1 ngày và ${oneMonth}% trong 1 tháng. ` +
      `Tín hiệu kỹ thuật hiện tại đang nghiêng về ${recommendation}, nhưng đây chỉ là tín hiệu xác suất chứ không phải cam kết giá sẽ tăng. ` +
      `Tôi sẽ ưu tiên kiểm tra thêm xu hướng, RSI/MACD, vùng hỗ trợ/kháng cự và định giá cơ bản trước khi kết luận điểm mua. ` +
      `Nếu bạn muốn, tôi có thể phân tích ${symbol} theo 3 lớp: kỹ thuật, cơ bản và định giá rồi đưa ra kịch bản tăng/giảm. ` +
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
      `Để đánh giá thị trường tốt hơn, tôi sẽ xem tiếp độ rộng, thanh khoản và nhóm ngành dẫn dắt thay vì chỉ nhìn điểm số. ` +
      `Bạn có thể hỏi tôi cụ thể về VN-Index, nhóm ngành hoặc một mã cổ phiếu để tôi đi sâu hơn. ` +
      `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
    );
  }

  return (
    `Tôi đã nhận được câu hỏi thị trường của bạn. ` +
    `Để đưa ra kết luận đáng tin cậy, tôi cần sử dụng giá, xu hướng kỹ thuật và dữ liệu cơ bản hiện có thay vì đoán số liệu. ` +
    `Bạn có thể gửi mã cổ phiếu hoặc chỉ số cụ thể để tôi phân tích sâu hơn. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

/**
 * Fallback used when every configured LLM provider is unavailable.
 *
 * It intentionally produces a human-facing answer rather than exposing
 * backend deterministic context.
 */
export function buildAdvisorFallback(
  question: string,
  rawContext: string,
): string {
  const lower = question.toLowerCase();

  if (
    lower.includes("personal_finance") ||
    /lương|thu nhập|chi tiêu|tiết kiệm|nợ|còn\s*\d|tài khoản|tiền/.test(
      lower,
    )
  ) {
    return fallbackPersonalFinance(question);
  }

  if (
    lower.includes("corporate") ||
    /doanh nghiệp|công ty|bctc|ebitda|ebit|roe|roa|dòng tiền doanh nghiệp/.test(
      lower,
    )
  ) {
    return fallbackCorporateFinance(question);
  }

  if (
    lower.includes("wealth") ||
    /tài sản ròng|phân bổ tài sản|danh mục|hưu trí|đa dạng hóa/.test(
      lower,
    )
  ) {
    return fallbackWealthManagement(question);
  }

  if (
    /vn-index|vn30|hnx|upcom|cổ phiếu|chứng khoán|btc|bitcoin|crypto|forex|vàng/.test(
      lower,
    )
  ) {
    return fallbackMarket(question, rawContext);
  }

  return (
    `Tôi có thể hỗ trợ bạn về tài chính cá nhân, doanh nghiệp, quản lý tài sản hoặc thị trường. ` +
    `Hãy đưa cho tôi câu hỏi cụ thể cùng số liệu bạn đang có; tôi sẽ tính toán và đưa ra phương án theo thứ tự ưu tiên. ` +
    `Đây là phân tích tham khảo, không thay thế tư vấn tài chính cá nhân chuyên nghiệp.`
  );
}

/**
 * Clean model text so the UI reads like a normal chat.
 */
export function smoothAgentAnswer(raw: string): string {
  if (!raw) return raw;

  let text = raw
    .replace(/\r\n/g, "\n")
    .trim();

  // Remove accidental internal system labels.
  text = text.replace(
    /^(Câu hỏi người dùng|Phân loại intent|DỮ LIỆU REAL-TIME TỪ DATA ENGINE|DỮ LIỆU REAL-TIME|HỒ SƠ TÀI CHÍNH [^:]+|Tổng quan thị trường \(Data Engine\))\s*:/gim,
    "",
  );

  // Remove common internal metadata if a model echoes it.
  text = text.replace(
    /\b(?:rule-engine|deterministic|agent_chat|providersConfigured|Data Engine context)\b/gi,
    "",
  );

  // Headings.
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Horizontal rules.
  text = text.replace(/^\s*([-*_]){3,}\s*$/gm, "");

  // Keep numbered lists readable.
  text = text.replace(
    /^\s*[-*+]\s+/gm,
    "",
  );

  // Markdown emphasis.
  text = text.replace(
    /\*\*([^*]+)\*\*/g,
    "$1",
  );

  text = text.replace(
    /__([^_]+)__/g,
    "$1",
  );

  text = text.replace(
    /(?<![*\w])\*([^*]+)\*(?![*\w])/g,
    "$1",
  );

  // Inline code.
  text = text.replace(
    /`([^`]+)`/g,
    "$1",
  );

  // Clean whitespace.
  text = text
    .split("\n")
    .map((line) =>
      line.replace(/[ \t]+$/g, ""),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
