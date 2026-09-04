# SSI FastConnect — Tích hợp Market Data

Tài liệu phạm vi và quy tắc tích hợp **SSI FastConnect** vào ORCA FINANCIAL.

Nguồn: <https://developers.ssi.com.vn/>

## Phạm vi đã chốt

ORCA chỉ dùng **dữ liệu thị trường**. Không dùng bất kỳ API giao dịch nào.

| Nhóm API | Dùng? | Ghi chú |
|---|---|---|
| `POST /api/v3/auth/token` (**không** truyền `otp`) | Có | Token chỉ có quyền đọc dữ liệu |
| `POST /api/v3/auth/refresh` | Có | Tự gia hạn, không cần con người |
| `POST /api/v3/auth/requestOtp` | Không | Chỉ phục vụ giao dịch |
| REST `data/*` | Có | `ohlc`, `securitiesByBoard`, `securitiesSummary`, `indexList`, `indexSummary`, `masterdata` |
| WS channel `DATA` | Có | `trade`, `quote`, `room`, `put`, `oddlot`, `market` |
| WS channel `TRADING` | Không | Gắn với tài khoản, cần OTP |
| `trading/*`, `account-info`, `position`, `accountBalance`, `ppmmrAccount`, `maxbuysell`, `orderBook` | Không | Brokerage |
| Lệnh điều kiện FCO | Không | Là lệnh |
| Header `X-Signature` (RSA + SHA256), `private_key` | Không | Chỉ dùng khi **đặt lệnh** |

Hệ quả: **không cần OTP, không cần SmartOTP/iBoard, không cần lưu private key**.
Token refresh hoàn toàn tự động nên tương thích với môi trường serverless.

## Endpoint production

| Thành phần | URL |
|---|---|
| REST | `https://api.ssi.com.vn` |
| WebSocket | `wss://stream.ssi.com.vn` |

Môi trường UAT chưa được công bố công khai — nhiều khả năng phải kiểm thử trên production.
Vì chỉ đọc dữ liệu nên rủi ro thấp, nhưng vẫn phải tôn trọng rate limit
(`X-RATELIMIT-LIMIT/REMAINING/RESET`, HTTP `429`).

## Điều kiện sử dụng cần lưu ý

- Bảo mật `apiKey` / `apiSecret` / access token; không commit vào source.
- Rate limit áp dụng theo từng API key.
- Tài khoản API có thể bị khoá do vi phạm điều khoản, security alert, yêu cầu từ UBCKNN,
  hoặc theo yêu cầu của khách hàng.

## Giới hạn dữ liệu

| Loại | Phạm vi |
|---|---|
| OHLCV daily | Từ ngày mã bắt đầu giao dịch |
| OHLCV intraday (`1m`,`3m`,`5m`,`15m`,`30m`,`1h`) | 1 năm gần nhất |
| File CSV | Đường dẫn hiệu lực 30 phút |

## Những điều SSI **không** cung cấp

- **Số lệnh tại mỗi mức giá.** Topic `quote` trả `bids`/`asks` dạng `List<String[2]>`
  = `[price, quantity]`. Không có `orderCount`. Không được ước tính giá trị này —
  để `null` và render `—`.
- **Báo cáo tài chính.** Pipeline BCTC (`src/lib/financial-*`, `cafef`/`vietstock`/`filing`)
  giữ nguyên, không đổi.
- Tin tức, sentiment, crypto, forex, hàng hoá, macro — giữ nguyên provider hiện tại.

### Cái bẫy tên gọi

SSI có endpoint tên `orderBook`, nhưng đó là **sổ lệnh của tài khoản** (danh sách lệnh đã
đặt), thuộc nhóm Trading và cần OTP. Nó **không phải** market depth (bảng giá bid/ask).

## Contract nội bộ

`src/lib/connectors/microstructure.ts` chứa các kiểu provider-agnostic:
`OrderBookLevel`, `OrderBookSnapshot`, `ForeignFlowSnapshot`, `StockMicrostructureSnapshot`.

`OrderBookLevel.orderCount` là optional và `null` với SSI — xem mục trên.

## Quy tắc kiến trúc

1. **Không mở WebSocket trong request handler serverless.**
   Dùng worker bền vững nhận stream, ghi snapshot vào database/cache;
   `getMarketOverview()` đọc snapshot có trạng thái `live`/`stale`/`degraded`.
2. Token phải được cache (Redis/DB) và refresh bằng **single-flight lock** để nhiều
   request đồng thời không refresh trùng.
3. Đăng ký connector `ssi-fastconnect` trong `REGISTRY`
   (`src/app/api/v1/admin/connectors/route.ts`) để có circuit breaker, stale flag
   và probe trong `/system`.
4. SSI làm **primary**; giữ VNDirect/Yahoo làm fallback. Provider lỗi đi qua fallback
   chain; nếu không còn nguồn hợp lệ thì trả `degraded`/`stale`, **không** bịa số liệu.
5. Sau reconnect phải subscribe lại toàn bộ topic. Heartbeat mỗi 30 giây (PING/PONG).
   Dùng `LIST_SUBSCRIPTION` để audit scope.
6. Topic `quote` sẽ chuyển sang incremental (chỉ trả giá trị thay đổi) trong bản nâng cấp
   sau — thiết kế apply-delta ngay từ đầu.

## Biến môi trường

Xem khối `SSI FastConnect` trong `.env.example`. Tóm tắt:

```text
SSI_CLIENT_ID=
SSI_API_KEY=
SSI_API_SECRET=
SSI_REST_BASE_URL=      # để trống = https://api.ssi.com.vn
SSI_WS_URL=             # để trống = wss://stream.ssi.com.vn
```

Tuỳ chọn: `SSI_TOKEN_CACHE_TTL_MS`, `SSI_TOKEN_REFRESH_SKEW_MS`,
`SSI_REST_TIMEOUT_MS`, `SSI_WS_ENABLED`.

## Cấu trúc mã

| File | Vai trò |
|---|---|
| `src/lib/connectors/ssi/config.ts` | Đọc env, format ngày, parse số/chuỗi |
| `src/lib/connectors/ssi/auth.ts` | Token cache + refresh single-flight (không OTP) |
| `src/lib/connectors/ssi/client.ts` | REST `data/*` — ohlc, securitiesByBoard, securitiesSummary, indexList, indexSummary, masterdata |
| `src/lib/connectors/ssi/stream.ts` | WebSocket channel `DATA`, tự reconnect & resubscribe |
| `scripts/ssi-stream-worker.ts` | Worker bền vững, ghi `price_snapshots` |
| `src/lib/connectors/microstructure.ts` | Contract order book / foreign flow |

## Điểm tích hợp sẵn có

`getQuote()` trong `src/lib/market.ts` đã ưu tiên snapshot tươi trong DB trước khi
gọi VNDirect. Vì vậy **worker chỉ cần ghi vào `price_snapshots`** là dashboard tự
nhận dữ liệu SSI — không cần sửa luồng quote.

## Chạy worker

```bash
npm run ssi:stream          # cần SSI_WS_ENABLED=true
npm run ssi:probe           # kiểm tra nhanh REST + token
```

Worker không phụ thuộc host: chạy được trên Fly.io, Railway, Render, Cloud Run,
VPS hoặc Docker. Chỉ cần `DATABASE_URL` (Redis tuỳ chọn).

## Những điều cần xác minh khi có API key thật

1. **WebSocket DATA có thực sự không cần OTP?** Tài liệu có chỗ chưa thống nhất
   (tutorial 10 nói không cần; bảng SDK nói client `Stream` cần OTP). Test bằng
   token không OTP → subscribe `trade.SSI`.
2. **Envelope inbound của WebSocket** — docs mô tả field nhưng không mô tả chính
   xác envelope. `normalizeSsiDataEvent()` đọc theo hình dạng payload và đẩy frame
   chưa nhận diện được qua `onRaw`. Kiểm tra log để xác nhận.
3. **Khung auth khi mở socket** — `SsiMarketStream` gửi frame
   `{client_id, api_key, api_secret, access_token}` theo docs khi có `SSI_CLIENT_ID`.
   Xác nhận gateway có cần frame này hay chỉ cần header/token.
4. **Số mức giá của topic `quote`** — sample docs hiện 5 mức.
5. **Rate limit thực tế** (`X-RATELIMIT-*`, HTTP 429) trước khi mở rộng universe.

## Trạng thái

- [x] Gỡ bỏ hoàn toàn luồng TCBS market-data khỏi `src/` và `.env.example`
- [x] Tách contract microstructure ra file provider-agnostic
- [x] Khai báo biến môi trường SSI trong `.env.example`
- [x] Auth + token cache + refresh single-flight
- [x] Adapter REST `data/*`
- [x] Đăng ký connector trong REGISTRY / probe `/system`
- [x] Worker WebSocket channel `DATA`
- [ ] Xác minh 5 điểm trên bằng API key thật
- [ ] Nối `ForeignFlowSnapshot` vào `/stocks/[symbol]/microstructure`
- [ ] Nối `OrderBookSnapshot` (topic `quote`) vào panel sổ lệnh
- [ ] Thay `SECTOR_DEFINITIONS` bằng `icbCode`/`icbName`
- [ ] Dùng `indexSummary` breadth → `scope: "market"`

> Luồng BCTC (TCBS → Vietstock) vẫn giữ nguyên có chủ ý: SSI không cung cấp báo
> cáo tài chính. Xem `docs/financial-source-pipeline.md`.
