/**
 * Vietnamese financial sentiment analyzer — rule-based NLP.
 *
 * Scoring: -1.0 (very negative) … 0.0 (neutral) … +1.0 (very positive).
 * Uses a curated dictionary of Vietnamese financial terms with intensity weights,
 * negation detection, and emoji/context multipliers.
 */

// ── Positive lexicon (word → weight 0.05–0.40) ──
const POSITIVE: [string, number][] = [
  // Giá / thị trường
  ["tăng mạnh", 0.35], ["tăng trần", 0.40], ["bùng nổ", 0.35],
  ["phục hồi", 0.25], ["hồi phục", 0.25], ["bật tăng", 0.30],
  ["tăng vọt", 0.35], ["tăng sốc", 0.30], ["tích cực", 0.25],
  ["khởi sắc", 0.25], ["lạc quan", 0.25], ["đón sóng", 0.20],
  ["đột phá", 0.30], ["kỷ lục", 0.20], ["vượt đỉnh", 0.30],
  ["dẫn dắt", 0.15], ["sáng", 0.10], ["xanh", 0.10],
  ["cổ phiếu tăng", 0.25], ["thắng lớn", 0.30], ["dòng tiền vào", 0.25],
  ["mua ròng", 0.20], ["giải ngân", 0.15], ["nâng hạng", 0.25],
  // Tài chính / kết quả
  ["lợi nhuận", 0.15], ["lãi lớn", 0.30], ["lãi ròng", 0.20],
  ["tăng trưởng", 0.20], ["vượt kế hoạch", 0.25], ["kết quả tốt", 0.25],
  ["cổ tức", 0.15], ["chia cổ tức", 0.20], ["thưởng cổ phiếu", 0.15],
  ["doanh thu tăng", 0.20], ["biên lợi nhuận", 0.10],
  // Vĩ mô
  ["kinh tế tăng", 0.15], ["gdp tăng", 0.15], ["fdi tăng", 0.15],
  ["ổn định", 0.10], ["kiểm soát lạm phát", 0.15],
  // Hành động nhà đầu tư
  ["nên mua", 0.30], ["khuyến nghị mua", 0.30], ["cơ hội", 0.15],
  ["tiềm năng", 0.15], ["triển vọng", 0.15], ["hấp dẫn", 0.15],
  ["đáy", 0.10], ["tích lũy", 0.10],
  // Đơn giản
  ["tăng", 0.10], ["lãi", 0.10], ["tốt", 0.10], ["cao", 0.05],
];

// ── Negative lexicon ──
const NEGATIVE: [string, number][] = [
  // Giá / thị trường
  ["giảm mạnh", 0.35], ["giảm sàn", 0.40], ["lao dốc", 0.35],
  ["bán tháo", 0.35], ["rơi tự do", 0.35], ["sập", 0.30],
  ["đỏ lửa", 0.25], ["đỏ rực", 0.25], ["giảm sốc", 0.30],
  ["mất điểm", 0.15], ["tiêu cực", 0.25], ["bi quan", 0.25],
  ["hoảng loạn", 0.30], ["bất ổn", 0.20], ["rủi ro", 0.20],
  ["rung lắc", 0.10], ["chao đảo", 0.15], ["mất thanh khoản", 0.25],
  ["khối ngoại bán", 0.15], ["bán ròng", 0.20], ["rút vốn", 0.25],
  // Tài chính / kết quả
  ["lỗ lớn", 0.35], ["thua lỗ", 0.30], ["lỗ ròng", 0.25],
  ["lỗ", 0.15], ["nợ xấu", 0.30], ["nợ tăng", 0.20],
  ["doanh thu giảm", 0.20], ["suy giảm", 0.20], ["phá sản", 0.40],
  // Vĩ mô
  ["lạm phát", 0.10], ["lạm phát tăng", 0.20], ["tăng lãi suất", 0.15],
  ["suy thoái", 0.30], ["kinh tế giảm", 0.20], ["gdp giảm", 0.15],
  // Hành động nhà đầu tư
  ["khuyến nghị bán", 0.30], ["nên bán", 0.30], ["cảnh báo", 0.15],
  ["thoái vốn", 0.15], ["cắt lỗ", 0.20],
  // Đơn giản
  ["giảm", 0.10], ["yếu", 0.10], ["xấu", 0.15], ["thấp", 0.05],
];

// Negation words that flip polarity
const NEGATORS = ["không", "chưa", "chẳng", "đừng", "chớ", "thiếu", "ít", "khó"];

// Intensifiers that amplify the next scored word
const INTENSIFIERS = ["rất", "cực", "vô cùng", "quá", "siêu", "đặc biệt"];

// Dampeners
const DAMPENERS = ["hơi", "nhẹ", "chút", "tương đối"];

export function analyzeSentiment(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  const lower = text.toLowerCase().replace(/\s+/g, " ");
  let totalScore = 0;
  let matches = 0;

  // Check multi-word phrases first (longer → more specific → higher priority)
  const sortedPos = [...POSITIVE].sort((a, b) => b[0].length - a[0].length);
  const sortedNeg = [...NEGATIVE].sort((a, b) => b[0].length - a[0].length);
  const consumed = new Set<number>(); // character positions already matched

  const tryMatch = (phrase: string, weight: number, polarity: 1 | -1) => {
    let idx = 0;
    while (true) {
      const pos = lower.indexOf(phrase, idx);
      if (pos === -1) break;
      // Check overlap with already consumed positions
      const end = pos + phrase.length;
      let overlaps = false;
      for (let i = pos; i < end; i++) {
        if (consumed.has(i)) { overlaps = true; break; }
      }
      if (!overlaps) {
        // Mark consumed
        for (let i = pos; i < end; i++) consumed.add(i);
        // Check context (negation/intensifier) in the ~20 chars before the match
        const contextBefore = lower.slice(Math.max(0, pos - 20), pos);
        let multiplier = 1.0;
        for (const neg of NEGATORS) {
          if (contextBefore.includes(neg)) { multiplier *= -0.8; break; }
        }
        for (const amp of INTENSIFIERS) {
          if (contextBefore.includes(amp)) { multiplier *= 1.4; break; }
        }
        for (const damp of DAMPENERS) {
          if (contextBefore.includes(damp)) { multiplier *= 0.6; break; }
        }
        totalScore += polarity * weight * multiplier;
        matches++;
      }
      idx = pos + 1;
    }
  };

  for (const [phrase, w] of sortedPos) tryMatch(phrase, w, 1);
  for (const [phrase, w] of sortedNeg) tryMatch(phrase, w, -1);

  if (matches === 0) return 0;

  // Normalize: scale by match count but cap to [-1, 1]
  const raw = totalScore / Math.sqrt(matches); // sqrt dampens high-count articles
  return Math.max(-1, Math.min(1, raw));
}

/**
 * Label a score for human-readable display.
 */
export function sentimentLabel(score: number): string {
  if (score >= 0.4) return "Rất tích cực";
  if (score >= 0.15) return "Tích cực";
  if (score > -0.15) return "Trung lập";
  if (score > -0.4) return "Tiêu cực";
  return "Rất tiêu cực";
}

export function sentimentColor(score: number): string {
  if (score >= 0.15) return "text-emerald-400";
  if (score > -0.15) return "text-amber-400";
  return "text-rose-400";
}
