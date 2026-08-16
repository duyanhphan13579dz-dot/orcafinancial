# VNStock Terminal — Nền tảng tài chính AI cho thị trường Việt Nam

Fullstack Next.js (App Router) + PostgreSQL (Drizzle ORM). **Mọi dữ liệu đều là dữ liệu thật** từ nguồn ngoài — không mock, không fabricate.

## Nguyên tắc

1. **No mock data** — giá, chỉ số, tin tức, crypto đều fetch live từ provider thật.
2. **No fake API** — provider lỗi → fallback chain; tất cả lỗi → API trả 502/503, không bịa số liệu.
3. **No placeholder UI** — mọi component nối trực tiếp với API backend.
4. **Connector wrapping** — retry + backoff + timeout + `CircuitBreaker` (4 fail → open 90s → fallback).
5. **Frontend không bao giờ gọi nguồn ngoài** — chỉ qua `/api/v1/*`.
6. **Structured logging** — JSON logs + `job_logs`/`agent_logs` trong DB.
7. **Rate limit** — sliding window per-IP trên mọi endpoint.

## Modules

### 1. Data Engine (Core)
- **Providers:** VNDirect dchart (primary), Yahoo Finance (fallback), CoinGecko (crypto), VnExpress/CafeF/Vietstock RSS (news).
- **Circuit breaker:** mỗi provider có breaker riêng, state closed/half-open/open, observable qua `/admin/connectors`.
- **TTL cache:** in-memory, tuỳ endpoint (10s quotes, 60s daily history, 90s news sync).
- **Validation/confidence:** mỗi quote/bar kèm `{source, confidence}` metadata.

### 2. Financial Health Engine
- **6 nhóm chỉ số** (tổng trọng số = 1): Liquidity (0.10), Leverage (0.20), Profitability (0.25), Efficiency (0.15), Growth (0.15), Cashflow (0.15).
- **Các chỉ số mới:** D/E, EBITDA/Tổng tài sản, EBITDA/Lãi vay, FCF/EBIT.
- **Rating:** A (≥80) → B (≥60) → C (≥40) → D (≥20) → E.
- Mỗi nhóm có điểm 0–100 và giải thích chi tiết.

### 3. Fundamental Analyst
- **Báo cáo 4 quý:** avgPrice, returnPct, volatility, Sharpe proxy.
- **Chỉ số:** EPS, ROE, ROA, ROS, CAGR 3 năm.
- **DuPont Decomposition:** ROE = NetMargin × AssetTurnover × EquityMultiplier.
- **Định giá 8 mô hình:**
  - P/E, P/B, EV/EBITDA, P/CF
  - **DDM** (Dividend Discount Model)
  - **DCF 3 kịch bản** (bi quan, cơ sở, lạc quan) với WACC 10%
  - **Graham Number** = √(22.5 × EPS × BVPS)
  - **Reverse DCF** — tìm implied growth rate từ giá hiện tại
- **Intrinsic value range:** tổng hợp tất cả mô hình → vùng giá trị nội tại.
- **Verdict:** Định giá thấp / Hợp lý / Định giá cao.

### 4. Sentiment Score (Vietnamese NLP)
- **Rule-based NLP** với ~120 từ/cụm từ tiếng Việt tài chính (tăng mạnh, bán tháo, lãi lớn…).
- **Intensity weights** (0.05–0.40) cho mỗi từ.
- **Context-aware:** phát hiện phủ định (không, chưa, chẳng), cường điệu (rất, cực), giảm nhẹ (hơi, nhẹ).
- **Multi-word priority:** cụm dài match trước (ví dụ "tăng mạnh" > "tăng").
- Scoring: -1.0 (rất tiêu cực) … 0.0 (trung lập) … +1.0 (rất tích cực).
- Chạy tự động trên mọi tin RSS khi ingest → lưu vào DB.
- API: sentiment trung bình 24h per symbol + sentiment thị trường chung.

### 5. Technical Analyst — Pattern Detection

#### Mô hình nến Nhật (14 patterns):
| Pattern | Tiếng Việt | Loại | Reliability |
|---------|-----------|------|-------------|
| Doji | Doji | Neutral | 50% |
| Dragonfly Doji | Doji Chuồn Chuồn | Bullish | 60% |
| Gravestone Doji | Doji Bia Mộ | Bearish | 60% |
| Hammer | Nến Búa | Bullish | 65% |
| Inverted Hammer | Búa Ngược | Bullish | 55% |
| Shooting Star | Sao Băng | Bearish | 65% |
| Hanging Man | Người Treo Cổ | Bearish | 60% |
| Bullish Engulfing | Nhấn Chìm Tăng | Bullish | 75% |
| Bearish Engulfing | Nhấn Chìm Giảm | Bearish | 75% |
| Bullish/Bearish Harami | Harami | ±55% | 55% |
| Morning Star | Sao Mai | Bullish | 80% |
| Evening Star | Sao Hôm | Bearish | 80% |
| Three White Soldiers | Ba Chàng Lính | Bullish | 75% |
| Three Black Crows | Ba Con Quạ | Bearish | 75% |
| Spinning Top | Con Quay | Neutral | 40% |
| Marubozu | Marubozu | ± | 70% |

#### Mẫu hình giá (7 patterns):
| Pattern | Tiếng Việt | Loại | Reliability |
|---------|-----------|------|-------------|
| Double Top | Hai Đỉnh | Bearish | 70% |
| Double Bottom | Hai Đáy | Bullish | 70% |
| Head and Shoulders | Vai Đầu Vai | Bearish | 80% |
| Inverse H&S | Vai Đầu Vai Ngược | Bullish | 80% |
| Ascending Triangle | Tam Giác Tăng | Bullish | 65% |
| Descending Triangle | Tam Giác Giảm | Bearish | 65% |
| Cup and Handle | Cốc Tay Cầm | Bullish | 70% |

Mỗi pattern có `target price` tính từ pattern height / neckline.

## API Contract (`/api/v1`)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/search?q=&type=` | Autocomplete (DB + VNDirect) |
| GET | `/stocks/:symbol` | Quote + company profile |
| GET | `/stocks/:symbol/history?timeframe=` | OHLCV bars |
| GET | `/stocks/:symbol/analysis` | Technical analysis + khuyến nghị |
| GET | `/stocks/:symbol/fundamental` | **Báo cáo cơ bản 4 quý, EPS, ROE, DuPont, DCF 3 kịch bản, Graham, DDM, Reverse DCF** |
| GET | `/stocks/:symbol/technical?timeframe=` | **Mẫu hình nến + mẫu hình giá** |
| GET | `/stocks/:symbol/sentiment` | **Sentiment NLP 24h (symbol + market)** |
| GET | `/market/overview` | Chỉ số, breadth, movers, crypto |
| GET | `/news?page=&limit=&symbol=` | Tin RSS thật + sentiment scores |
| POST | `/agent/chat` | AI Agent (tích hợp tất cả 5 modules) |
| GET/POST/DELETE | `/watchlist` | Session watchlist |
| GET | `/admin/connectors` | Circuit breaker + job logs |

## Pages

| Route | Mô tả |
|-------|-------|
| `/` | Dashboard: ticker tape, chỉ số, breadth, bảng giá, tin |
| `/stocks/[symbol]` | 5 tabs: Tổng quan (chart+health+patterns+sentiment), Phân tích KT, Cơ bản (DuPont+DCF+Graham), Mẫu hình, Tin tức |
| `/news` | Tin với sentiment scores |
| `/watchlist` | Danh sách theo dõi |
| `/agent` | Chat AI (tự động kết hợp tất cả modules) |
| `/system` | Circuit breaker status + job logs |

## Resilience & Operations

Hệ thống được thiết kế để **không crash** khi upstream tạm thời không khả dụng:

### Cơ chế bảo vệ
- **Exponential backoff + jitter** cho mọi HTTP call (`1s → 2s → 4s`, cấu hình qua env).
- **Circuit breaker** cấu hình được: mở sau N lỗi liên tiếp, cooldown T ms, sau đó chuyển sang fallback provider.
- **Fallback chain** cho mọi loại dữ liệu: `vndirect → yahoo` (history/quote), `coingecko → binance-vision` (crypto), 3 nguồn RSS song song (news).
- **Data validator** từ chối record không hợp lệ (giá ≤ 0, high < low, volume < 0, missing required fields) trước khi insert — log raw record bị từ chối.
- **Stale-data registry**: khi mọi provider cho một (kind, symbol) đều fail, dữ liệu được gắn cờ `stale` và hiển thị trên dashboard admin thay vì crash API.
- **DB retry wrapper** (`safeDbQuery`) retry 3 lần với backoff cho các lỗi transient (P1001, P1002, P1008, connection reset, timeout).
- **Structured JSON logging** với ring buffer 500 entries in-memory; mỗi fetch log URL, method, HTTP status, attempt, durationMs, error code, provider; parse failure log raw response snippet (500 ký tự).
- **Alert dispatcher** chạy mỗi 60s, gửi log severity CRITICAL + Slack webhook khi connector DOWN quá 5 phút; auto-resolve khi UP trở lại; mọi dispatch được lưu vào bảng `connector_alerts`.
- **Manual probe & reset** qua `POST /api/v1/admin/connectors/{name}/test` và `/reset`.

### Biến môi trường
| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `CIRCUIT_BREAKER_THRESHOLD` | 5 | Số lỗi liên tiếp trước khi mở circuit |
| `CIRCUIT_BREAKER_TIMEOUT` | 60000 | Thời gian circuit mở (ms) |
| `CONNECTOR_RETRY_ATTEMPTS` | 3 | Số lần retry mỗi HTTP call |
| `CONNECTOR_RETRY_BASE_MS` | 1000 | Base delay cho exponential backoff |
| `CONNECTOR_FETCH_TIMEOUT_MS` | 10000 | Timeout mỗi request |
| `CONNECTOR_STALE_AFTER_MS` | 900000 | Sau bao lâu không success thì coi là DOWN |
| `CONNECTOR_DEGRADED_AFTER_MS` | 300000 | Sau bao lâu không success thì coi là DEGRADED |
| `CONNECTOR_ALERT_AFTER_MS` | 300000 | Thời gian DOWN trước khi dispatch alert |
| `CONNECTOR_ALERT_TICK_MS` | 60000 | Chu kỳ kiểm tra alert |
| `SLACK_WEBHOOK_URL` | — | Nếu set, alert được push vào Slack |
| `LOG_DEBUG` | — | Set `1` để ghi log mức debug |

### Endpoint giám sát
- `GET /api/health` — trạng thái tổng thể (DB + upstream + stale flags). Trả 503 nếu DB down hoặc có connector DOWN.
- `GET /api/v1/admin/connectors` — chi tiết mọi connector: circuit state, success rate, uptime, cumulative downtime, recent logs, alert timeline, stale flags, config readout.
- `GET /api/v1/admin/logs?provider=&level=&limit=` — truy vấn ring buffer log có filter.
- `GET /api/v1/admin/alerts` — open + recent + DB-persisted alerts.
- `POST /api/v1/admin/connectors/{name}/test` — chạy probe thủ công để kiểm tra provider đang sống.
- `POST /api/v1/admin/connectors/{name}/reset` — reset circuit breaker thủ công.
- `/system` — OPS console UI với ambient status banner, connector cards với micro-interactions, alert timeline, stale flags, structured log viewer.

### Deployment checklist
- Kiểm tra DNS & outbound firewall từ container (VNDirect/Yahoo/CoinGecko/Binance Vision/RSS feeds).
- Đồng bộ timezone container (`TZ=Asia/Ho_Chi_Minh`) để report scheduler chạy đúng giờ.
- Đảm bảo `DATABASE_URL` trỏ tới service name trong Docker network (không phải `127.0.0.1`).
- Cấu hình connection pool qua `?connection_limit=10` trong `DATABASE_URL` nếu dùng Prisma/Drizzle pg.
- Tăng CPU/memory limit cho container worker nếu scheduler chạy nhiều job song song.
- Set `SLACK_WEBHOOK_URL` để nhận cảnh báo khi có sự cố upstream kéo dài.

## Database — PostgreSQL tự host hoặc Supabase

Mặc định dự án chạy với PostgreSQL tự host (`DATABASE_URL` trỏ tới
`127.0.0.1` hoặc service `postgres` trong Docker network). Lớp kết nối
(`src/db/index.ts`) **tự động nhận diện** khi `DATABASE_URL` trỏ tới
Supabase (bật SSL, giảm connection pool khi qua PgBouncer) — không cần
sửa code để chuyển đổi giữa hai loại hạ tầng.

Xem hướng dẫn chuyển đổi đầy đủ (tạo project, migrate schema bằng Drizzle
Kit, di chuyển dữ liệu bằng `pg_dump`/`pg_restore`, tích hợp Supabase
Auth/Realtime tùy chọn, Docker Compose riêng cho Supabase cloud) tại:

**[`docs/SUPABASE_MIGRATION.md`](./docs/SUPABASE_MIGRATION.md)**

Script hỗ trợ migrate dữ liệu: `scripts/migrate-to-supabase.sh`.

> Lưu ý: Supabase đã ngừng hỗ trợ extension TimescaleDB (loại khỏi bundle
> Postgres 17). Schema hiện tại của dự án không dùng TimescaleDB hypertable
> nên việc chuyển đổi không ảnh hưởng tính năng nào — chi tiết trong tài
> liệu trên.

## License

MIT
