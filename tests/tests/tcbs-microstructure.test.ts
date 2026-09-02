/**
 * Nhà cung cấp TCBS microstructure đã bị gỡ. Test cũ gọi
 * `tcbsMockMicrostructure()` — hàm đó không còn tồn tại trong
 * src/lib/connectors/tcbs-microstructure.ts (module chỉ còn type).
 *
 * Thay vào đó test này khoá lại hành vi hiện tại của endpoint: khi chưa có
 * nhà cung cấp đã xác minh, API trả về payload "unavailable" có cấu trúc
 * đầy đủ chứ không bịa sổ lệnh hay dòng tiền khối ngoại.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as microstructureModule from "@/lib/connectors/tcbs-microstructure";
import { GET } from "@/app/api/v1/stocks/[symbol]/microstructure/route";

// Route gọi getQuote() chỉ để làm ấm cache; cô lập để test không đụng DB/mạng.
// (vi.mock được vitest đưa lên trước các import.)
vi.mock("@/lib/market", () => ({
  getQuote: vi.fn(async () => {
    throw new Error("no verified provider");
  }),
}));

function request(symbol: string) {
  return {
    req: new NextRequest(`http://localhost/api/v1/stocks/${symbol}/microstructure`),
    ctx: { params: Promise.resolve({ symbol }) },
  };
}

describe("TCBS microstructure mock đã bị gỡ bỏ", () => {
  it("module không còn hàm sinh dữ liệu sổ lệnh giả", () => {
    const runtimeExports = Object.entries(microstructureModule).filter(
      ([, value]) => typeof value === "function",
    );
    expect(runtimeExports).toEqual([]);
  });

  it("endpoint trả về trạng thái unavailable có cấu trúc, không bịa số", async () => {
    const { req, ctx } = request("vnm");
    const response = await GET(req, ctx);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        symbol: string;
        orderBook: {
          bids: unknown[];
          asks: unknown[];
          bidValue: number;
          askValue: number;
          imbalancePct: number | null;
          spread: number | null;
          status: string;
          source: string;
          confidence: number;
        };
        foreignFlow: {
          buyValue: number | null;
          sellValue: number | null;
          netValue: number | null;
          foreignRoomPct: number | null;
          status: string;
          source: string;
          confidence: number;
        };
        generatedAt: number;
      };
      meta: { source: string; confidence: number };
    };

    // symbol được chuẩn hoá viết hoa
    expect(body.data.symbol).toBe("VNM");

    expect(body.data.orderBook.status).toBe("unavailable");
    expect(body.data.orderBook.source).toBe("none");
    expect(body.data.orderBook.confidence).toBe(0);
    expect(body.data.orderBook.bids).toEqual([]);
    expect(body.data.orderBook.asks).toEqual([]);
    expect(body.data.orderBook.bidValue).toBe(0);
    expect(body.data.orderBook.askValue).toBe(0);
    expect(body.data.orderBook.imbalancePct).toBeNull();
    expect(body.data.orderBook.spread).toBeNull();

    expect(body.data.foreignFlow.status).toBe("unavailable");
    expect(body.data.foreignFlow.source).toBe("none");
    expect(body.data.foreignFlow.confidence).toBe(0);
    expect(body.data.foreignFlow.netValue).toBeNull();
    expect(body.data.foreignFlow.buyValue).toBeNull();
    expect(body.data.foreignFlow.foreignRoomPct).toBeNull();

    expect(body.meta).toMatchObject({ source: "none", confidence: 0 });
  });

  it("từ chối symbol không hợp lệ bằng 400 thay vì trả dữ liệu rỗng", async () => {
    const { req, ctx } = request("bad-symbol");
    const response = await GET(req, ctx);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid symbol");
  });
});
