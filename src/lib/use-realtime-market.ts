"use client";

/**
 * Hook nhận giá realtime từ `/api/v1/market/realtime` (Server-Sent Events).
 *
 * Server đã chạy chuỗi websocket vndirect → vci → kbs (kèm REST fallback); hook
 * này chỉ mở EventSource và giữ bảng giá mới nhất theo mã, để UI không phải tự
 * nối websocket hay polling.
 */

import { useEffect, useState } from "react";

export interface LiveQuote {
  symbol: string;
  price: number;
  changePct: number | null;
  volume: number | null;
  source: "vndirect" | "vci" | "kbs" | "rest";
  timestamp: number;
}

export interface LiveFeedStatus {
  provider: "vndirect" | "vci" | "kbs" | "rest" | null;
  status: "connecting" | "connected" | "rest-fallback" | "disconnected";
  reason?: string;
}

export function useRealtimeMarket(symbols: string[]) {
  const key = symbols.join(",");
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [status, setStatus] = useState<LiveFeedStatus | null>(null);

  useEffect(() => {
    if (!key) return;
    const source = new EventSource(`/api/v1/market/realtime?symbols=${encodeURIComponent(key)}`);

    const onQuote = (event: MessageEvent) => {
      try {
        const quote = JSON.parse(event.data) as LiveQuote;
        setQuotes((prev) => ({ ...prev, [quote.symbol]: quote }));
      } catch {
        // bỏ thông điệp hỏng
      }
    };
    const onStatus = (event: MessageEvent) => {
      try {
        setStatus(JSON.parse(event.data) as LiveFeedStatus);
      } catch {
        // bỏ thông điệp hỏng
      }
    };

    source.addEventListener("quote", onQuote);
    source.addEventListener("status", onStatus);
    // EventSource tự reconnect khi đứt; không cần xử lý onerror thủ công.

    return () => {
      source.removeEventListener("quote", onQuote);
      source.removeEventListener("status", onStatus);
      source.close();
    };
  }, [key]);

  return { quotes, status };
}
