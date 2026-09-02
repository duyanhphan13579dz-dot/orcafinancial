/**
 * TCBS market-data mock đã bị gỡ khỏi codebase: src/lib/connectors/tcbs-mock.ts
 * chỉ còn stub "always disabled" để market.ts biên dịch được.
 *
 * Các test này khoá lại hợp đồng đó: bảng giá không bao giờ được sinh ra từ
 * dữ liệu giả, ở bất kỳ môi trường nào. Đây là ràng buộc của chính sách
 * "Verified Financial Data" — thà báo unavailable còn hơn bịa số.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTcbsMockEnabled, tcbsMockQuote } from "@/lib/connectors/tcbs-mock";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TCBS market-data mock đã bị gỡ bỏ", () => {
  it("luôn tắt, kể cả khi cố bật bằng biến môi trường", () => {
    expect(isTcbsMockEnabled()).toBe(false);

    for (const flag of ["ENABLE_TCBS_MOCK", "TCBS_MOCK", "ALLOW_SYNTHETIC_FINANCIALS"]) {
      for (const value of ["true", "1", "yes"]) {
        vi.stubEnv(flag, value);
        expect(isTcbsMockEnabled()).toBe(false);
      }
    }

    vi.stubEnv("NODE_ENV", "development");
    expect(isTcbsMockEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isTcbsMockEnabled()).toBe(false);
  });

  it("không sinh dữ liệu giả: gọi là ném lỗi, không trả về Quote", () => {
    expect(() => tcbsMockQuote("VNM")).toThrow(/TCBS mock is disabled \(VNM\)/);
    // symbol được đưa nguyên trạng vào thông báo để truy vết
    expect(() => tcbsMockQuote("fpt")).toThrow(/\(fpt\)/);
  });
});
