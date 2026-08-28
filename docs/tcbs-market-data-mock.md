# Mock TCBS Market Data

Mock TCBS chỉ phục vụ phát triển giao diện và kiểm thử module Ngành trong thời gian OAuth MCP chưa hoạt động. Provider dùng fixture deterministic theo mã, không gọi mạng và không ghi đè dữ liệu nguồn thật.

## Bật trong development

```bash
TCBS_MARKET_DATA_MOCK=true pnpm dev
```

Khi cờ này bật, `getQuote()` ưu tiên `tcbs-market-data-mock` trước provider TCBS thật và các fallback khác. Dữ liệu có `source=tcbs-market-data-mock`, `confidence=0.35` để giao diện có thể hiển thị trạng thái simulated/development.

## Bảo vệ production

`isTcbsMockEnabled()` luôn trả về false khi `NODE_ENV=production`, kể cả khi biến môi trường bị đặt nhầm thành `true`. Không được dùng mock để tạo báo cáo đầu tư, lưu financial statements hoặc gắn nhãn live.

## Dữ liệu được mô phỏng

Mỗi quote có symbol, thời gian, OHLC, volume, prevClose, changePct, source và confidence. Các fixture VNM, SSI, HPG, FPT, VCB và VIC có giá trị cố định; mã khác được tạo bằng hash deterministic, không dùng số ngẫu nhiên.

## Khi thay bằng TCBS thật

Tắt `TCBS_MARKET_DATA_MOCK`, cấu hình `TCBS_MARKET_DATA_URL`/token hoặc worker MCP hợp lệ, rồi kiểm tra `source` chuyển sang `tcbs-market-data` và timestamp đến từ TCBS. Mock không được để làm fallback cho dữ liệu live production.
