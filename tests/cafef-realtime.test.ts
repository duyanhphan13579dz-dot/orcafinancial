import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectCafefQuotes,
  extractCafefQuote,
  fetchCafefRealtimeQuotes,
} from "@/lib/connectors/cafef-realtime";

describe("cafef realtime parser", () => {
  afterEach(() => vi.restoreAllMocks());

  it("extracts a quote from a flat CafeF-shaped record (EN keys)", () => {
    const q = extractCafefQuote(
      {
        Symbol: "vnm",
        LastPrice: 65.5,
        ChangePercent: 1.2,
        HighPrice: 66,
        LowPrice: 64.8,
        Volume: 123456,
        RefPrice: 64.7,
      },
      123,
    );
    expect(q).not.toBeNull();
    expect(q!.symbol).toBe("VNM");
    expect(q!.price).toBe(65.5);
    expect(q!.changePct).toBe(1.2);
    expect(q!.source).toBe("cafef");
  });

  it("extracts from Vietnamese keys and string numbers", () => {
    const q = extractCafefQuote(
      {
        StockSymbol: "FPT",
        GiaDongCua: "98.5",
        ThayDoi: "-0.5",
        KhoiLuongKhopLenh: "1,000,000",
      },
      1,
    );
    expect(q).not.toBeNull();
    expect(q!.price).toBe(98.5);
    expect(q!.volume).toBe(1_000_000);
  });

  it("ignores non-quote records", () => {
    expect(extractCafefQuote({ foo: "bar" }, 1)).toBeNull();
    expect(extractCafefQuote({ Symbol: "VNM", LastPrice: -5 }, 1)).toBeNull();
  });

  it("collects quotes from nested {Data:{Data:[]}} envelope", () => {
    const quotes = collectCafefQuotes(
      { Data: { Data: [{ Symbol: "VNM", LastPrice: 65 }, { Symbol: "FPT", LastPrice: 98 }] } },
      5,
    );
    expect(quotes.map((q) => q.symbol).sort()).toEqual(["FPT", "VNM"]);
  });

  it("fetch filters to requested symbols and sends msh-iframe origin", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.headers && (init.headers as Record<string, string>).origin)).toBe(
        "https://msh-iframe.cafef.vn",
      );
      return new Response(
        JSON.stringify({
          data: [
            { Symbol: "VNM", LastPrice: 65.5 },
            { Symbol: "OTHER", LastPrice: 10 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const result = await fetchCafefRealtimeQuotes(["vnm"], fetchMock as unknown as typeof fetch);
    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].symbol).toBe("VNM");
    expect(result.quotes[0].source).toBe("cafef");
  });

  it("returns empty with warning on HTTP error", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await fetchCafefRealtimeQuotes(["VNM"], fetchMock as unknown as typeof fetch);
    expect(result.quotes).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("500"))).toBe(true);
  });
});
