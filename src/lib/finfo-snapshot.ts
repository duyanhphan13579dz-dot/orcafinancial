/**
 * BẢN SAO LƯU (snapshot) KQKD hợp nhất của VIC, copy NGUYÊN VĂN từ
 * /v4/financial_statements (modelType 2, reportType QUARTER) của VNDirect
 * finfo vào ngày 2026-09-03 — dùng CHỈ khi gọi trực tiếp lên nguồn thất bại
 * (mạng/CORS), để bảng vẫn xem được tại chỗ như người dùng yêu cầu.
 * Khi nguồn sống reachable, giá trị live luôn thắng; snapshot chỉ lấp chỗ
 * thiếu. Không phải số bịa: mọi ô dưới đây là numericValue nguyên văn từ
 * JSON nguồn (kèm kỳ và ngày công bố gốc).
 */

export const FINFO_SNAPSHOT_AS_OF = "2026-09-03";

/** symbol → fiscalDate → [itemCode, numericValue (VND)] (chỉ tiêu KQKD hợp nhất). */
export const FINFO_STATEMENTS_SNAPSHOT: Record<string, Record<string, Array<[number, number]>>> = {
  VIC: {
    // Công bố 2026-07-31
    "2026-06-30": [
      [21000, 1.17964878e14],
      [21001, 1.17936034e14],
      [22100, 9.0454822e13],
      [23100, 2.7481212e13],
      [23110, 1.5274246e13],
      [23800, 2.2168856e13],
      [23003, 1.476396e13],
      [23000, 1.0002615e13],
      [23500, 4.761345e12],
    ],
    // Công bố 2026-04-28
    "2026-03-31": [
      [21000, 1.04371179e14],
      [21001, 1.04352018e14],
      [22100, 7.8414392e13],
      [23100, 2.5937626e13],
      [23110, 5.084455e12],
      [23800, 1.1536718e13],
      [23003, 5.610779e12],
      [23000, 7.276018e12],
      [23500, -1.665239e12],
    ],
    // Cả năm 2025, công bố 2026-01-30 (hiệu chỉnh 2026-03-26)
    "2025-12-31": [
      [21000, 1.62238595e14],
      [21001, 1.6222662e14],
      [22100, 1.24874331e14],
      [23100, 3.7352289e13],
      [23110, 1.2113489e13],
      [23800, 1.1254075e13],
      [23003, 3.499674e12],
      [23000, 4.671896e12],
      [23500, -1.172222e12],
    ],
    // Công bố 2025-10-31
    "2025-09-30": [
      [21000, 3.9143023e13],
      [21001, 3.9135103e13],
      [22100, 4.6425078e13],
      [23100, -7.289975e12],
      [23110, 4.829457e12],
      [23800, 4.024377e12],
      [23003, 3.025338e12],
      [23000, 6.40184e11],
      [23500, 2.385154e12],
    ],
  },
};
