/**
 * Kiểm chứng lớp realtime market feed với WebSocket GIẢ — không cần mạng.
 *
 * Khoá ba hành vi cốt lõi:
 *   1. Thứ tự dự phòng đúng là vndirect → vci → kbs rồi mới tới REST.
 *   2. Nguồn nào phát dữ liệu đầu tiên được chọn và gắn đúng `source`.
 *   3. Không bao giờ sinh giá giả khi mọi nguồn đều chết.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRealtimeMarketFeed,
  type RealtimeQuote,
  type RealtimeStatusEvent,
} from "@/lib/realtime-market-feed";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
  }
  // ── công cụ mô phỏng ──
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: string) {
    this.onmessage?.({ data });
  }
  die() {
    this.readyState = 3;
    this.onclose?.();
  }
}

afterEach(() => {
  FakeWebSocket.instances = [];
  vi.unstubAllEnvs();
});

const SYMBOLS = ["VNM", "HPG", "FPT"];

function makeFeed(overrides: Partial<Parameters<typeof createRealtimeMarketFeed>[0]> = {}) {
  const quotes: RealtimeQuote[] = [];
  const statuses: RealtimeStatusEvent[] = [];
  const restCalls: string[][] = [];
  const handle = createRealtimeMarketFeed({
    symbols: SYMBOLS,
    onQuote: (q) => quotes.push(q),
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    connectTimeoutMs: 50,
    restPollMs: 30,
    restLoader: async (symbols) => {
      restCalls.push(symbols);
      return symbols.map((symbol) => ({
        symbol,
        price: 100,
        changePct: 0.5,
        open: null,
        high: null,
        low: null,
        volume: null,
        prevClose: null,
        source: "rest",
        timestamp: Date.now(),
      }));
    },
    ...overrides,
  });
  return { handle, quotes, statuses, restCalls };
}

describe("thứ tự dự phòng vndirect → vci → kbs", () => {
  it("chỉ có vndirect mặc định: vndirect chết thì rơi thẳng xuống REST", () => {
    const { handle, statuses, restCalls } = makeFeed();

    // chỉ vndirect được bật → đúng 1 socket được tạo
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("vndirect");

    FakeWebSocket.instances[0].die();

    // rơi xuống REST vì vci/kbs chưa cấu hình
    expect(statuses.some((s) => s.status === "rest-fallback")).toBe(true);
    expect(restCalls.length).toBeGreaterThan(0);
    handle.destroy();
  });

  it("khi cấu hình VCI: vndirect chết thì chuyển sang vci đúng thứ tự", () => {
    vi.stubEnv("VCI_REALTIME_WS", "wss://ws.vci.example/realtime");
    const { handle, quotes, statuses } = makeFeed();

    expect(FakeWebSocket.instances[0].url).toContain("vndirect");
    FakeWebSocket.instances[0].die();

    // socket thứ hai là vci
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain("vci");

    // vci mở và phát dữ liệu
    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].message(
      JSON.stringify({ symbol: "VNM", price: "62.3", changePct: "-0.32" }),
    );

    expect(quotes).toHaveLength(1);
    expect(quotes[0].source).toBe("vci");
    expect(quotes[0].price).toBe(62.3);
    expect(statuses.some((s) => s.provider === "vci" && s.status === "connected")).toBe(true);
    handle.destroy();
  });

  it("thứ tự đầy đủ vndirect → vci → kbs khi cả ba đều cấu hình và hai nguồn đầu chết", () => {
    vi.stubEnv("VCI_REALTIME_WS", "wss://ws.vci.example/realtime");
    vi.stubEnv("KBS_REALTIME_WS", "wss://ws.kbs.example/realtime");
    const { handle, quotes } = makeFeed();

    FakeWebSocket.instances[0].die(); // vndirect chết
    FakeWebSocket.instances[1].die(); // vci chết
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(FakeWebSocket.instances[2].url).toContain("kbs");

    FakeWebSocket.instances[2].open();
    FakeWebSocket.instances[2].message(JSON.stringify([{ s: "FPT", c: "73.2" }]));
    expect(quotes[0].source).toBe("kbs");
    expect(quotes[0].symbol).toBe("FPT");
    handle.destroy();
  });
});

describe("nguồn phát dữ liệu đầu tiên được chọn", () => {
  it("vndirect sống thì dùng vndirect và KHÔNG bật REST", async () => {
    const { handle, quotes, statuses, restCalls } = makeFeed();
    const socket = FakeWebSocket.instances[0];

    socket.open();
    socket.message(JSON.stringify({ symbol: "HPG", price: 22.1, changePct: -0.45, volume: 1_000_000 }));

    expect(quotes).toHaveLength(1);
    expect(quotes[0].source).toBe("vndirect");
    expect(quotes[0].symbol).toBe("HPG");
    expect(statuses.some((s) => s.provider === "vndirect" && s.status === "connected")).toBe(true);

    // chờ một chu kỳ REST; vì ws đang sống nên REST không được gọi
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(restCalls).toHaveLength(0);
    handle.destroy();
  });

  it("gửi thông điệp subscribe sau khi mở", () => {
    const { handle } = makeFeed();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    expect(socket.sent.length).toBeGreaterThan(0);
    expect(socket.sent[0]).toContain("VNM");
    handle.destroy();
  });
});

describe("không sinh số giả", () => {
  it("mọi nguồn chết và REST lỗi thì không có quote nào được phát", async () => {
    const { handle, quotes } = makeFeed({
      restLoader: async () => {
        throw new Error("REST down");
      },
    });
    FakeWebSocket.instances[0].die();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(quotes).toHaveLength(0);
    handle.destroy();
  });
});

describe("ánh xạ thông điệp", () => {
  it("đọc nhiều dạng nhãn giá và bỏ thông điệp không phải giá", () => {
    const { handle, quotes } = makeFeed();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    // mảng nhiều quote
    socket.message(JSON.stringify([
      { s: "VNM", c: "62.3", P: "-0.32" },
      { s: "VCB", close: 60.1, changePct: 0 },
    ]));
    expect(quotes).toHaveLength(2);
    expect(quotes[0].price).toBe(62.3);
    expect(quotes[1].symbol).toBe("VCB");

    // thông điệp điều khiển không có giá → bị bỏ
    const before = quotes.length;
    socket.message(JSON.stringify({ type: "ping" }));
    expect(quotes.length).toBe(before);

    // object lồng trong `data`
    socket.message(JSON.stringify({ data: { ticker: "fpt", last: "73.2" } }));
    expect(quotes[quotes.length - 1].symbol).toBe("FPT");
    expect(quotes[quotes.length - 1].price).toBe(73.2);
    handle.destroy();
  });
});
