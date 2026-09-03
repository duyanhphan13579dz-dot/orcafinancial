/**
 * Lớp dữ liệu thị trường REALTIME qua WebSocket với chuỗi dự phòng cố định:
 *
 *   vndirect → vci → kbs   (và cuối cùng là thăm dò REST nếu không ws nào nối được)
 *
 * Vì sao cần chuỗi dự phòng: không có nhà cung cấp websocket miễn phí nào của
 * thị trường VN đảm bảo luôn sống. Khi một nguồn đứt, lớp này tự chuyển sang
 * nguồn kế tiếp mà UI không phải làm gì.
 *
 * Thiết kế để KIỂM THỬ ĐƯỢC: WebSocket được TIÊM qua `WebSocketImpl`, đồng hồ
 * qua `now`, nên test chạy hoàn toàn offline với socket giả — không cần mạng.
 *
 * Endpoint của từng provider đọc từ biến môi trường (có default cho vndirect).
 * vci/kbs CHƯA có cổng websocket công khai miễn phí được xác minh nên mặc định
 * để trống → provider bị bỏ qua cho tới khi bạn cấu hình `VCI_REALTIME_WS` /
 * `KBS_REALTIME_WS`. Thứ tự ưu tiên vẫn luôn là vndirect → vci → kbs.
 *
 * KHÔNG bịa dữ liệu: nếu một provider không nối được và REST cũng chết, feed
 * chỉ báo trạng thái, không sinh giá giả.
 */

export type RealtimeProviderName = "vndirect" | "vci" | "kbs" | "rest";

export interface RealtimeQuote {
  symbol: string;
  price: number;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  prevClose: number | null;
  source: RealtimeProviderName;
  timestamp: number;
}

export type RealtimeFeedStatus = "connecting" | "connected" | "rest-fallback" | "disconnected";

export interface RealtimeStatusEvent {
  provider: RealtimeProviderName | null;
  status: RealtimeFeedStatus;
  reason?: string;
}

/* ────────────────────────────────────────────────────────────
 * Ánh xạ thông điệp từng provider → RealtimeQuote[]
 * ──────────────────────────────────────────────────────────── */

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Dạng thông điệp "giá" phổ biến: một object có mã + giá. Trả về null nếu không
 * phải thông điệp giá (để bỏ qua các thông điệp điều khiển / thông báo).
 */
function extractQuote(record: Record<string, unknown>, source: RealtimeProviderName, timestamp: number): RealtimeQuote | null {
  const symbol =
    typeof record.symbol === "string" ? record.symbol
    : typeof record.s === "string" ? record.s
    : typeof record.code === "string" ? record.code
    : typeof record.ticker === "string" ? record.ticker
    : null;

  const price =
    num(record.price) ?? num(record.last) ?? num(record.close) ?? num(record.c) ?? num(record.p) ?? num(record.lastPrice);

  if (!symbol || price === null || price <= 0) return null;

  return {
    symbol: symbol.toUpperCase(),
    price,
    changePct: num(record.changePct) ?? num(record.changePercent) ?? num(record.P) ?? num(record.pc) ?? num(record.change_pct),
    open: num(record.open) ?? num(record.o),
    high: num(record.high) ?? num(record.h),
    low: num(record.low) ?? num(record.l),
    volume: num(record.volume) ?? num(record.v) ?? num(record.totalVolume),
    prevClose: num(record.prevClose) ?? num(record.reference) ?? num(record.fc),
    source,
    timestamp,
  };
}

export interface RealtimeProviderAdapter {
  name: Exclude<RealtimeProviderName, "rest">;
  /** true khi được cấu hình / cho phép. */
  enabled: () => boolean;
  /** URL websocket; null nếu không có. */
  buildUrl: (symbols: string[]) => string | null;
  /** Thông điệp gửi đi sau khi mở (subscribe); null nếu không cần. */
  buildSubscribe?: (symbols: string[]) => string | null;
  /** Chuyển một thông điệp thô → các quote; mảng rỗng nếu không phải dữ liệu giá. */
  mapMessage: (raw: string, timestamp: number) => RealtimeQuote[];
}

/**
 * Map một thông điệp JSON có thể là: một quote, một mảng quote, hoặc một object
 * có trường chứa danh sách (data / quotes / items / d).
 */
function mapJsonQuotes(raw: string, source: Exclude<RealtimeProviderName, "rest">, timestamp: number): RealtimeQuote[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: RealtimeQuote[] = [];
  const push = (record: unknown) => {
    if (record && typeof record === "object") {
      const q = extractQuote(record as Record<string, unknown>, source, timestamp);
      if (q) out.push(q);
    }
  };
  if (Array.isArray(parsed)) {
    for (const item of parsed) push(item);
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const nested = record.data ?? record.quotes ?? record.items ?? record.d;
    if (Array.isArray(nested)) {
      for (const item of nested) push(item);
    } else if (nested && typeof nested === "object") {
      // { data: { …quote } } → đọc object lồng, không đọc vỏ ngoài.
      push(nested);
    } else {
      push(record);
    }
  }
  return out;
}

export const REALTIME_PROVIDERS: RealtimeProviderAdapter[] = [
  {
    name: "vndirect",
    enabled: () => true,
    buildUrl: () => process.env.VNDIRECT_REALTIME_WS ?? "wss://websocket.vndirect.com.vn/notisocket/noti",
    buildSubscribe: (symbols) => JSON.stringify({ cmd: "subscribe", symbols }),
    mapMessage: (raw, ts) => mapJsonQuotes(raw, "vndirect", ts),
  },
  {
    name: "vci",
    enabled: () => Boolean(process.env.VCI_REALTIME_WS),
    buildUrl: () => process.env.VCI_REALTIME_WS ?? null,
    buildSubscribe: (symbols) => JSON.stringify({ action: "subscribe", symbols }),
    mapMessage: (raw, ts) => mapJsonQuotes(raw, "vci", ts),
  },
  {
    name: "kbs",
    enabled: () => Boolean(process.env.KBS_REALTIME_WS),
    buildUrl: () => process.env.KBS_REALTIME_WS ?? null,
    buildSubscribe: (symbols) => JSON.stringify({ type: "sub", symbols }),
    mapMessage: (raw, ts) => mapJsonQuotes(raw, "kbs", ts),
  },
];

/* ────────────────────────────────────────────────────────────
 * Orchestrator
 * ──────────────────────────────────────────────────────────── */

export interface RealtimeFeedOptions {
  symbols: string[];
  onQuote: (quote: RealtimeQuote) => void;
  onStatus?: (event: RealtimeStatusEvent) => void;
  /** Khoảng cách thăm dò REST khi không có ws. */
  restPollMs?: number;
  /** Thời gian chờ một ws bắt đầu phát dữ liệu trước khi coi là chết. */
  connectTimeoutMs?: number;
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
  /** Hàm nạp giá qua REST cho fallback; tiêm để test không đụng mạng. */
  restLoader?: (symbols: string[]) => Promise<RealtimeQuote[]>;
}

interface FeedHandle {
  destroy: () => void;
}

/**
 * Tạo feed realtime. Thử từng provider theo thứ tự vndirect → vci → kbs; nguồn
 * nào phát dữ liệu đầu tiên được chọn. Nếu không ws nào sống thì bật thăm dò
 * REST. Khi ws đang chạy chết hẳn, quay lại đầu chuỗi.
 */
export function createRealtimeMarketFeed(options: RealtimeFeedOptions): FeedHandle {
  const symbols = options.symbols;
  const WebSocketImpl = options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  const now = options.now ?? (() => Date.now());
  const connectTimeoutMs = options.connectTimeoutMs ?? 6_000;
  const restPollMs = options.restPollMs ?? 15_000;

  let destroyed = false;
  let activeSocket: WebSocket | null = null;
  let activeProvider: Exclude<RealtimeProviderName, "rest"> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let restTimer: ReturnType<typeof setInterval> | null = null;
  let restRunning = false;
  let gotData = false;

  function emitStatus(event: RealtimeStatusEvent) {
    options.onStatus?.(event);
  }

  function stopRest() {
    if (restTimer) {
      clearInterval(restTimer);
      restTimer = null;
    }
  }

  function startRest() {
    if (destroyed || restTimer || !options.restLoader) return;
    emitStatus({ provider: "rest", status: "rest-fallback", reason: "không có websocket nào khả dụng" });
    const poll = async () => {
      if (destroyed || restRunning || activeProvider) return;
      restRunning = true;
      try {
        const quotes = await options.restLoader!(symbols);
        if (!destroyed && !activeProvider) {
          for (const q of quotes) options.onQuote(q);
        }
      } catch {
        // REST cũng chết — không sinh số giả, chỉ bỏ lượt này.
      } finally {
        restRunning = false;
      }
    };
    void poll();
    restTimer = setInterval(poll, restPollMs);
  }

  function closeSocket() {
    if (activeSocket) {
      const socket = activeSocket;
      activeSocket = null;
      try {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      } catch {
        // bỏ qua lỗi khi đóng
      }
    }
  }

  /** Thử kết nối provider tại `index`; nếu hết thì bật REST. */
  function tryProvider(index: number) {
    if (destroyed) return;
    if (index >= REALTIME_PROVIDERS.length) {
      activeProvider = null;
      startRest();
      return;
    }

    const adapter = REALTIME_PROVIDERS[index];
    if (!adapter.enabled()) {
      tryProvider(index + 1);
      return;
    }
    const url = adapter.buildUrl(symbols);
    if (!url || !WebSocketImpl) {
      tryProvider(index + 1);
      return;
    }

    emitStatus({ provider: adapter.name, status: "connecting" });
    let settled = false;

    let socket: WebSocket;
    try {
      socket = new WebSocketImpl(url);
    } catch {
      tryProvider(index + 1);
      return;
    }
    activeSocket = socket;

    const bailToNext = () => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      closeSocket();
      tryProvider(index + 1);
    };

    connectTimer = setTimeout(() => {
      if (!gotData) bailToNext();
    }, connectTimeoutMs);

    socket.onopen = () => {
      if (destroyed) return;
      const message = adapter.buildSubscribe?.(symbols) ?? null;
      if (message) {
        try {
          socket.send(message);
        } catch {
          // một số cổng không cần subscribe
        }
      }
    };

    socket.onmessage = (event) => {
      if (destroyed) return;
      const data = typeof event.data === "string" ? event.data : "";
      const quotes = adapter.mapMessage(data, now());
      if (quotes.length === 0) return;
      gotData = true;
      if (activeProvider !== adapter.name) {
        activeProvider = adapter.name;
        if (connectTimer) clearTimeout(connectTimer);
        stopRest();
        emitStatus({ provider: adapter.name, status: "connected" });
      }
      for (const quote of quotes) options.onQuote(quote);
    };

    const onDead = () => {
      if (destroyed) return;
      if (!gotData) {
        bailToNext();
        return;
      }
      // Đã từng sống: thử lại chính provider này, nếu không được thì về đầu chuỗi.
      activeProvider = null;
      closeSocket();
      emitStatus({ provider: adapter.name, status: "disconnected", reason: "mất kết nối" });
      startRest();
      setTimeout(() => {
        if (!destroyed) tryProvider(0);
      }, 2_000);
    };
    socket.onclose = onDead;
    socket.onerror = onDead;
  }

  tryProvider(0);

  return {
    destroy() {
      destroyed = true;
      if (connectTimer) clearTimeout(connectTimer);
      stopRest();
      closeSocket();
    },
  };
}
