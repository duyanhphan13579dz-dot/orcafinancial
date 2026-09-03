/**
 * NGUỒN DUY NHẤT cho báo giá chỉ số (VNINDEX/VN30/HNX/UPCOM): bar ngày mới
 * nhất của vndirect dchart, cache nhớ 60s.
 *
 * Vì sao: trước đây dashboard lấy chỉ số qua getQuotes (có thể đọc snapshot cũ
 * trong DB / fallback yahoo lệch số), còn trang chi tiết gọi dchart trực tiếp
 * → hai nơi hiện hai con số khác nhau. Giờ mọi nơi (snapshot, SSE REST, trang
 * chi tiết) đều dùng chung hàm này → nhất quán.
 */
import { vndirectHistory } from "@/lib/connectors/providers";
import type { Quote } from "@/lib/connectors/core";

export const INDEX_CODES = ["VNINDEX", "VN30", "HNX", "UPCOM"] as const;
export type IndexCode = (typeof INDEX_CODES)[number];

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; quote: Quote }>();

export function isIndexCode(symbol: string): boolean {
  return (INDEX_CODES as readonly string[]).includes(symbol.toUpperCase());
}

export async function freshIndexQuotes(codes: string[]): Promise<Quote[]> {
  const now = Date.now();
  const results = await Promise.all(
    codes.map(async (raw) => {
      const code = raw.toUpperCase();
      if (!(INDEX_CODES as readonly string[]).includes(code)) return null;
      const hit = cache.get(code);
      if (hit && now - hit.at < TTL_MS) return hit.quote;
      try {
        const to = Math.floor(now / 1000);
        const from = to - 86400 * 10;
        const bars = await vndirectHistory(code, from, to, "D", {
          timeoutMs: 6_000,
          retries: 1,
        });
        if (bars.length === 0) return hit?.quote ?? null;
        const last = bars[bars.length - 1];
        const prev = bars.length > 1 ? bars[bars.length - 2] : null;
        const quote: Quote = {
          symbol: code,
          time: last.time,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
          volume: last.volume,
          prevClose: prev?.close ?? null,
          changePct: prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null,
          source: "vndirect-dchart",
          confidence: 0.95,
        };
        cache.set(code, { at: now, quote });
        return quote;
      } catch {
        return hit?.quote ?? null;
      }
    }),
  );
  return results.filter((q): q is Quote => q !== null);
}
