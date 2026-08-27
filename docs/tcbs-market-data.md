# TCBS Market Data Provider

## Phạm vi

`TCBSMarketDataAdapter` nhận quote market-data từ endpoint TCBS được cấp quyền và chuẩn hóa về interface `Quote` của Orca Financial. Module Ngành dùng các trường `open`, `high`, `low`, `close`, `volume`, `prevClose`, `changePct`, `time`, `source` và `confidence` để tính breadth, sức mạnh ngành và tổng khối lượng.

Adapter hỗ trợ payload một quote, mảng quote, `data` là mảng/object hoặc `quote` là object. Các tên trường được chấp nhận gồm `symbol/code/ticker`, `timestamp/time/updatedAt`, `open/openPrice`, `high/highPrice`, `low/lowPrice`, `close/last/lastPrice`, `volume/totalVolume` và `prevClose/referencePrice/refPrice`.

## Cấu hình

```text
TCBS_MARKET_DATA_URL=https://<licensed-tcbs-market-data-endpoint>
TCBS_MARKET_DATA_TOKEN=<token-if-required>
```

Endpoint phải là REST/JSON market-data endpoint đã được TCBS cấp quyền. Repo không đoán endpoint, không bypass đăng nhập, CAPTCHA, rate limit hoặc giao thức của TCBS.

## Thứ tự provider

Khi `TCBS_MARKET_DATA_URL` có giá trị, `getQuote()` ưu tiên TCBS. Nếu TCBS lỗi hoặc payload không hợp lệ, hệ thống ghi log `quote_tcbs_failed`, sau đó thử snapshot gần nhất, VNDirect và Yahoo Finance theo luồng fallback hiện tại. Nếu TCBS chưa cấu hình, hành vi cũ với VNDirect vẫn giữ nguyên.

Quote được cache theo TTL thị trường hiện tại. `source` trả về `tcbs-market-data` và `confidence=0.98` sau khi qua `DataValidator.quote`. Thời điểm 13 chữ số được quy đổi từ milliseconds về seconds; thời điểm 10 chữ số được giữ là Unix seconds.

## Điều kiện nghiệm thu

Trước khi bật production, cần kiểm tra endpoint trả quote realtime hoặc gần realtime, có timestamp của upstream, có `prevClose`/reference price, khối lượng giao dịch và phản hồi nhất quán cho toàn bộ mã trong `SECTOR_SYMBOLS`. Cần kiểm tra thêm quota, độ trễ, giới hạn batch và quyền sử dụng dữ liệu trên module Ngành.

Nếu cần WebSocket, không nên mở connection trong request serverless. Hãy dùng worker bền vững để nhận stream, ghi snapshot vào database/cache và để module Ngành đọc snapshot có trạng thái `live`, `stale` hoặc `degraded`.
