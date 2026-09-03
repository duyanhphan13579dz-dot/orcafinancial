/**
 * Luồng giá REALTIME cho màn hình thị trường, đẩy qua Server-Sent Events.
 *
 * Phía server chạy `createRealtimeMarketFeed` với chuỗi dự phòng
 * vndirect → vci → kbs; nếu không websocket nào sống thì tự thăm dò REST
 * (getQuotes). Mỗi lần có giá mới, server đẩy một event `quote` xuống client.
 *
 * Client chỉ việc mở EventSource và cập nhật bảng giá — không phải tự nối
 * websocket, không phải polling.
 */
import { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/api";
import { getQuotes } from "@/lib/market";
import {
  createRealtimeMarketFeed,
  type RealtimeQuote,
} from "@/lib/realtime-market-feed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_SYMBOLS = ["VNM", "VIC", "VHM", "HPG", "FPT", "MWG", "VCB", "TCB", "BID", "SSI"];

async function loadRestQuotes(symbols: string[]): Promise<RealtimeQuote[]> {
  const quotes = await getQuotes(symbols, { persist: false, allowStale: true, fast: true });
  const now = Date.now();
  return quotes
    .filter((q) => q.close > 0)
    .map((q) => ({
      symbol: q.symbol,
      price: q.close,
      changePct: q.changePct,
      open: q.open,
      high: q.high,
      low: q.low,
      volume: q.volume,
      prevClose: q.prevClose,
      source: "rest",
      timestamp: now,
    }));
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;

  const requested = req.nextUrl.searchParams.get("symbols");
  const symbols = (requested ? requested.split(/[,\s]+/).filter(Boolean) : DEFAULT_SYMBOLS)
    .map((s) => s.toUpperCase())
    .slice(0, 40);

  const encoder = new TextEncoder();
  let push: ((chunk: Uint8Array) => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // client đã ngắt
        }
      };

      const send = (event: string, data: unknown) => {
        push?.(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const feed = createRealtimeMarketFeed({
        symbols,
        restPollMs: 15_000,
        restLoader: loadRestQuotes,
        onStatus: (status) => send("status", status),
        onQuote: (quote) => send("quote", quote),
      });

      send("hello", { symbols, providers: ["vndirect", "vci", "kbs", "rest"] });

      // giữ kết nối: khi client đóng thì dọn feed
      const cleanup = () => feed.destroy();
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      // client ngắt giữa chừng
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
