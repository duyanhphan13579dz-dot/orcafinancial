# ORCA FINANCIAL

**ORCA FINANCIAL** là nền tảng phân tích thị trường và intelligence tài chính đa tài sản dành cho nhà đầu tư Việt Nam. Hệ thống kết hợp dữ liệu thị trường thật, phân tích định lượng, phân tích cơ bản/kỹ thuật, sentiment tiếng Việt, AI Agent, báo cáo tự động và các công cụ theo dõi danh mục trong một trải nghiệm terminal hiện đại.

> **Mục tiêu sản phẩm:** Giúp nhà đầu tư hiểu thị trường Việt Nam đang diễn ra chuyện gì trong 5–10 giây đầu tiên, sau đó drill-down theo thứ tự **thị trường → ngành → cổ phiếu → tin tức → AI**.

> **Nguyên tắc dữ liệu:** ORCA không dùng mock data cho giá, chỉ số, crypto hoặc tin tức. Provider lỗi sẽ đi qua fallback chain; nếu không còn nguồn hợp lệ, hệ thống trả trạng thái degraded/stale hoặc lỗi upstream thay vì tự bịa số liệu.

## Mục lục

- [Tổng quan sản phẩm](#tổng-quan-sản-phẩm)
- [Các tính năng hiện có](#các-tính-năng-hiện-có)
- [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
- [Dashboard tổng quan](#dashboard-tổng-quan)
- [MarketSnapshot và Data Engine](#marketsnapshot-và-data-engine)
- [Các module nghiệp vụ](#các-module-nghiệp-vụ)
- [Luồng dữ liệu](#luồng-dữ-liệu)
- [Cấu trúc repository](#cấu-trúc-repository)
- [API](#api)
- [Database](#database)
- [Resilience và observability](#resilience-và-observability)
- [Authentication và security](#authentication-và-security)
- [Cài đặt local](#cài-đặt-local)
- [Chạy bằng Docker](#chạy-bằng-docker)
- [Environment variables](#environment-variables)
- [Kiểm thử và chất lượng mã](#kiểm-thử-và-chất-lượng-mã)
- [Deployment](#deployment)
- [Các giới hạn hiện tại](#các-giới-hạn-hiện-tại)
- [License](#license)

## Tổng quan sản phẩm

ORCA FINANCIAL chạy trên **Next.js App Router**, React và TypeScript ở frontend/backend boundary, PostgreSQL với Drizzle ORM ở persistence layer, cùng các connector chuyên biệt cho nguồn dữ liệu ngoài. Frontend chỉ gọi các endpoint nội bộ dưới `/api/v1/*`; việc gọi VNDirect, Yahoo Finance, CoinGecko, Binance Vision, RSS hoặc LLM được thực hiện ở server-side service layer.

Sản phẩm hiện bao phủ các nhóm sau:

| Khu vực | Nội dung |
|---|---|
| Market overview | Market Header, ticker, Market Pulse, breadth, sector rotation, market board, heatmap, movers, crypto và news timeline |
| Stock intelligence | Quote, lịch sử OHLCV, technical analysis, candlestick/chart patterns, financial health, fundamental valuation, SWOT, value chain và sentiment |
| Multi-asset | Crypto market, futures, on-chain, whale/order flow, crypto sentiment, forex intelligence, commodities và FX conversion |
| Investor tools | Watchlist theo session, stock quick view, screener, reports, AI Agent và trade journal |
| Finance workspace | Personal finance profile và corporate finance statements |
| Operations | Connector console, health check, stale registry, structured logs, job logs, alert timeline và manual probes |
| Account | Local authentication, Google OAuth helpers, refresh token, 2FA/TOTP, sessions, preferences, audit log và data export |

## Các tính năng hiện có

### Dashboard tổng quan thế hệ mới

Dashboard tại `/` là một **single-screen market intelligence workspace**. Giao diện kết hợp visual language terminal dark của ORCA với mật độ dữ liệu kiểu bảng điện hiện đại:

| Khu vực | Chức năng |
|---|---|
| Market ticker | Dòng mã và biến động liên tục, liên kết trực tiếp tới stock detail |
| Market Header | VN-Index là chỉ số chính; hiển thị các index cards, crypto cards, volume, source, trạng thái live/partial/stale và biên độ OHLC mini |
| ORCA Market Pulse | Quantitative regime, trend, breadth, liquidity, foreign flow, risk và summary giải thích |
| Breadth comparison | Phân biệt market breadth từ snapshot universe với large-cap/tracked breadth |
| Sector Market Board | Mini board theo Ngân hàng, Chứng khoán, Bất động sản, Thép, Xây dựng, Bán lẻ và Công nghệ |
| Heatmap | Màu hóa mã theo biến động; click mã mở Stock Quick View |
| Top movers | Các mã tăng/giảm mạnh nhất và nhóm volume cao nhất từ snapshot |
| ORCA AI Insight | Khu vực intelligence cố định, giải thích từ structured MarketSnapshot thay vì cho LLM đoán trực tiếp từ raw data |
| Watchlist | Danh mục của tôi, thêm/xóa mã ngay từ quick view và liên kết tới `/watchlist` |
| News timeline | Tin RSS thật, source, timestamp, symbol tags và liên kết bài gốc |

Dashboard không tạo request riêng cho từng component. Các vùng chính tiêu thụ **một MarketSnapshot tổng hợp**, trong khi cache client và inflight dedupe giảm request trùng lặp.

### Stock detail

Trang `/stocks/[symbol]` tổ chức dữ liệu thành các tab `Tổng quan`, `Phân tích KT`, `Cơ bản`, `Mẫu hình`, `Tài chính`, `Công ty` và `Tin tức`. Chart và panel nặng được code-split bằng dynamic import; các endpoint chỉ được gọi khi tab tương ứng cần dữ liệu.

Stock detail hỗ trợ:

- Quote, profile và lịch sử OHLCV theo timeframe.
- RSI, MACD, SMA, Bollinger Bands, support/resistance, volatility và drawdown.
- 14 nhóm mô hình nến Nhật và 7 nhóm chart pattern, kèm loại bullish/bearish/neutral, reliability, mô tả và target khi có thể tính.
- Báo cáo tài chính 4 quý, EPS, ROE, ROA, ROS và CAGR 3 năm.
- DuPont decomposition: `ROE = Net Margin × Asset Turnover × Equity Multiplier`.
- Định giá P/E, P/B, EV/EBITDA, P/CF, DDM, DCF ba kịch bản, Graham Number và Reverse DCF.
- Financial Health Engine với sáu nhóm Liquidity, Leverage, Profitability, Efficiency, Growth và Cashflow.
- SWOT, Porter value chain, industry benchmarks và sentiment 24 giờ.

### Crypto intelligence

Module crypto tại `/crypto` và `/crypto/[symbol]` dùng CoinGecko làm nguồn chính và Binance Vision làm fallback cho giá. Các domain service hiện có bao phủ price, OHLCV, analysis, recommendation, futures, sentiment, AI context, on-chain signals, whale activity, order flow, launchpad và intel snapshot. Realtime connector hỗ trợ các luồng Binance websocket khi môi trường vận hành cho phép.

### Forex intelligence

Module forex tại `/forex` và `/forex/[symbol]` bao phủ:

- Giá realtime, OHLCV và nhiều timeframe.
- Multi-timeframe analysis, trend/momentum, trade setup và recommendation.
- Macro context, economic calendar, provider pipeline và secondary providers.
- FX intelligence card, AI analyst, performance metrics, portfolio và position tracking.
- Trade journal với entry/exit, stop loss, take profit, leverage, size, emotion, tags, PnL, R-multiple và thống kê performance.
- Alert evaluation cho các điều kiện liên quan đến setup và risk.

### Commodities

Module `/commodities` hỗ trợ danh sách mặt hàng, giá quy đổi VND, lịch sử giá, impact lên cổ phiếu/ngành, tỷ giá chuyển đổi, source status và ingestion scheduler. Pipeline có cơ chế scan source, chọn source winner, validate record, tính thay đổi và lưu dữ liệu theo bucket thời gian.

### Heatmap, screener và reports

`/heatmap` là không gian phân tích market heatmap riêng, có realtime service, history, intelligence và AI route. Dashboard tổng quan dùng cùng hướng drill-down để liên kết heatmap với sector board và stock quick view.

`/screener` hỗ trợ các phương pháp CANSLIM, Minervini, Wyckoff và Elliott cùng các utility dùng chung.

`/reports` hỗ trợ Morning Brief và Market Summary. Report generator có lưu trữ report HTML, summary generation, LLM narrative, scheduler và manual trigger endpoints. Nội dung report phải được xem là phân tích hỗ trợ quyết định, không phải lời khuyên đầu tư.

### AI Agent và RAG

`/agent` là workspace hội thoại tài chính. Agent có history, response cache, crypto enrichment, prompt/routing layer, formatter và các provider LLM như Groq/OpenRouter. RAG layer chứa các playbook về doanh nghiệp, personal finance, money general và wealth; agent có thể kết hợp dữ liệu thị trường với context domain trước khi tạo câu trả lời.

LLM không được xem là nguồn dữ liệu giá. Pipeline khuyến nghị là:

```text
Live market providers
        ↓
Validation + snapshot + quantitative engines
        ↓
MarketSnapshot / structured analysis
        ↓
AI explanation, report narrative hoặc agent answer
```

### Watchlist, account và finance workspace

Watchlist hiện lưu theo `vnstock_session` cookie để hỗ trợ trải nghiệm nhanh trên dashboard. Account layer lưu user, refresh token, session, preferences, audit log và 2FA. Các page `/settings`, `/watchlist`, `/agent`, `/reports` và các workspace tài chính được bảo vệ bởi middleware cùng server-side guard phù hợp.

## Kiến trúc hệ thống

```text
┌─────────────────────────────────────────────────────────────┐
│ Next.js App Router                                          │
│ pages · components · client polling/cache · responsive UI   │
└──────────────────────────────┬──────────────────────────────┘
                               │ /api/v1/*
┌──────────────────────────────▼──────────────────────────────┐
│ API boundary                                                 │
│ rate limit · auth boundary · envelope · public errors        │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Domain services                                              │
│ market · stocks · fundamental · technical · crypto · forex   │
│ commodities · heatmap · reports · agent · finance · screener │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Connector and reliability layer                              │
│ retry · timeout · circuit breaker · fallback · validator     │
│ shared cache · stale registry · concurrency pool · logging   │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
┌──────────────▼──────────────┐  ┌─────────────▼─────────────┐
│ PostgreSQL / Drizzle         │  │ External data providers    │
│ snapshots · history · news   │  │ VNDirect · Yahoo · CoinGecko│
│ auth · reports · finance    │  │ Binance · RSS · LLM         │
└─────────────────────────────┘  └───────────────────────────┘
```

### Stack

| Thành phần | Công nghệ |
|---|---|
| Web framework | Next.js 16 App Router |
| UI | React 19, TypeScript, Tailwind CSS 4 |
| Charts | `lightweight-charts`, `recharts`, custom SVG mini-ranges |
| Database | PostgreSQL, `pg`, Drizzle ORM và Drizzle Kit |
| Cache | Client LRU/inflight cache, shared Redis wrapper, service caches và DB snapshots |
| Auth | JWT access token, httpOnly refresh token, bcryptjs, jose, 2FA/TOTP helpers, Google OAuth helpers |
| External market data | VNDirect dchart, Yahoo Finance, CoinGecko, Binance Vision |
| News | VnExpress RSS, CafeF RSS, Vietstock RSS |
| LLM | Groq/OpenRouter routing layer |
| Deployment | Docker Compose, Vercel-compatible configuration và Supabase/PostgreSQL option |

## MarketSnapshot và Data Engine

`src/types/market.ts` định nghĩa contract dùng chung `MarketSnapshot`. Service `src/lib/market.ts` là nơi assemble snapshot; dashboard không tự ghép dữ liệu từ nhiều API độc lập.

```text
MarketSnapshot
├── indices
├── breadth
├── marketBreadth
├── largeCapBreadth
├── sectors                 # dữ liệu ngành Việt Nam
├── overnight               # chỉ số/futures/hàng hóa/FX qua đêm
├── pulse
├── liquidity
├── foreignFlow
├── topGainers
├── topLosers
├── topVolume
├── quotes
├── crypto
├── news
├── quality
└── generatedAt
```

### Market Header và Pulse

VN-Index được đánh dấu `primary`. Các index cards có quote, change percentage, volume, source và OHLC range. Crypto được đưa vào cùng vùng header để người dùng nhìn thấy bức tranh multi-asset nhưng vẫn giữ visual weight chính cho VN-Index.

### Sector Board và Overnight Markets

`SectorBoard` đã được tách thành component dùng chung tại `src/components/market/SectorBoard.tsx`. `SectorBoardModule` tại `src/components/market/SectorBoardModule.tsx` cung cấp workspace độc lập ở `/sector-board`, hiển thị toàn bộ nhóm ngành, sector strength, số mã tăng/giảm, volume và drill-down sang phân tích cổ phiếu. Dashboard tổng quan chỉ giữ liên kết đến workspace này, không còn tải toàn bộ board inline.

Vùng hiển thị được giải phóng trên overview hiện dành cho `OvernightMarkets` tại `src/components/market/OvernightMarkets.tsx`. Module này trình bày các nhóm `Global indices`, `Commodities`, `FX` và `Rates & risk`, gồm S&P 500, Nasdaq 100, Dow Jones, Nikkei 225, Hang Seng, VIX, Gold/Brent/WTI/Copper futures, USD Index, EUR/USD, USD/JPY và US 10Y. Dữ liệu lấy qua Yahoo chart thật, hiển thị timestamp và trạng thái `DELAYED`, `STALE` hoặc `N/A`; không coi giá đóng cửa hoặc giá delayed là realtime.

Hai module vẫn nằm trong một `MarketSnapshot` tổng hợp nhưng có **loader, cache TTL và deadline riêng**. Overnight loader chạy song song với breadth/news, có timeout mặc định 1,2 giây, circuit breaker và stale fallback; lỗi Yahoo hoặc một mã riêng lẻ chỉ làm item đó `unavailable/partial`, không làm mất quote và sector data trong overview.

Market Pulse là quantitative engine. Nó kết hợp index change, breadth ratio, sector average và liquidity availability để tạo:

- `trend`: up, down hoặc flat.
- `breadth`: up, down hoặc flat.
- `liquidity`: up hoặc flat theo dữ liệu volume hiện có.
- `risk`: low, medium hoặc high.
- `regime`: bullish trend, broad risk-off, selective rotation hoặc neutral.

Foreign flow hiện có contract trong snapshot nhưng có thể trả `unknown` khi upstream chưa cung cấp dữ liệu hợp lệ. Hệ thống không tự suy diễn foreign flow.

### Cache và snapshot

| Tầng | Mặc định | Mục đích |
|---|---:|---|
| Client soft TTL | tối đa 15 giây theo polling interval | Hiển thị cache ngay và refresh nền |
| Client hard TTL | 5 phút | Tránh mất trạng thái khi request tạm lỗi |
| Overview service cache | 60 giây | Giảm tải upstream và chống request storm |
| Quote service cache | 20 giây | Giảm lặp gọi quote |
| Daily history cache | 120 giây | Phục vụ chart ngày |
| Intraday history cache | 30 giây | Phục vụ chart trong phiên |
| Overnight market cache | 45 giây | Giảm lặp gọi Yahoo cho chỉ số/futures/FX/rates |
| Overnight hard deadline | 1,2 giây | Cô lập nguồn quốc tế chậm khỏi overview |
| DB fresh snapshot | 45 giây | Ưu tiên dữ liệu gần đây trước khi gọi provider |
| RSS provider cache | 5 phút | Giảm áp lực lên RSS feeds |

### Provider chain

| Dữ liệu | Primary | Fallback |
|---|---|---|
| Equity quote/history/index | VNDirect dchart | Yahoo Finance |
| International indices/futures/FX/rates | Yahoo Finance | Snapshot stale/unavailable theo từng mã |
| Crypto price | CoinGecko | Binance Vision |
| News | VnExpress, CafeF, Vietstock | Feed nào còn sống sẽ được dùng; nếu toàn bộ lỗi thì đánh dấu stale |
| LLM | Theo `LLM_PROVIDER_ORDER` | Provider tiếp theo trong routing order |

`DataValidator` từ chối OHLCV có price không hợp lệ, quan hệ high/low sai, volume âm, timestamp sai hoặc field bắt buộc thiếu. Quote và news cũng được validate trước khi sử dụng hoặc insert.

## Các module nghiệp vụ

| Module | Files chính | Trách nhiệm |
|---|---|---|
| Market | `src/lib/market.ts` | Overview, search, quote, history, news sync/list, sentiment tổng hợp |
| Sector Board | `src/components/market/SectorBoard.tsx`, `SectorBoardModule.tsx` | Workspace ngành độc lập tại `/sector-board`, strength, breadth và drill-down |
| Overnight Markets | `src/components/market/OvernightMarkets.tsx`, `getOvernightMarketSnapshot()` | Chỉ số quốc tế, futures, hàng hóa, FX, US 10Y và degraded states |
| Stock analysis | `src/lib/analysis.ts`, `fundamental.ts`, `technical-patterns.ts` | Technical, fundamental, valuation, pattern và recommendation |
| Financial health | `src/lib/financial-health-detail.ts`, `src/lib/industry-benchmarks.ts` | Scoring theo nhóm chỉ số, breakdown và industry comparison |
| Company intelligence | `company-profile.ts`, `company-service.ts`, `value-chain.ts` | Profile, SWOT, value chain và company context |
| Sentiment | `src/lib/sentiment.ts`, `src/lib/llm/sentiment-llm.ts` | Rule-based tiếng Việt và hybrid scoring |
| Crypto | `src/lib/crypto/*` | Price, chart, sentiment, futures, on-chain, whale, order flow, launchpad và AI enrichment |
| Forex | `src/lib/forex/*` | Realtime, multi-timeframe, macro, calendar, trade setup, journal, portfolio và performance |
| Commodities | `src/lib/commodities/*` | Source scanning, FX conversion, ingestion, history, impact và scheduler |
| Heatmap | `src/lib/heatmap/*` | Heatmap realtime/history/intelligence và AI route |
| Screener | `src/lib/screener/*` | CANSLIM, Minervini, Wyckoff, Elliott và shared utilities |
| Reports | `src/lib/reports/*` | Morning Brief, Market Summary, narrative, HTML, store và scheduler |
| AI/RAG | `src/lib/agent/*`, `src/lib/rag/*`, `src/lib/llm/*` | Conversation history, response cache, routing, prompts, playbooks và retrieval |
| Personal finance | `src/lib/personal-finance/*` | Profile/context và finance workspace |
| Corporate finance | `src/lib/corporate-finance/*` | Statements, context và service |
| Operations | `src/lib/connectors/*`, `alerts.ts`, `logger.ts` | Resilience, health, logs, stale flags và alert dispatch |

## Luồng dữ liệu

### Dashboard overview

```text
GET /
  → middleware kiểm tra public/session gate
  → page.tsx chọn LandingPage hoặc DashboardHome
  → usePoll('/market/overview')
  → client cache/inflight dedupe
  → API rate limit
  → getMarketOverview()
  → DB fresh snapshots hoặc provider chain
  → breadth + sectors + pulse + movers + quality
  → MarketSnapshot
  → header/pulse/board/heatmap/AI/news render
```

### Stock detail

```text
StockPage(symbol)
  → quote polling
  → analysis polling
  → tab-gated fundamental/technical/financial/profile/news polling
  → dynamic chart/panel chunks
  → quick navigation hoặc Stock Quick View từ dashboard
```

### News ingest

```text
RSS feeds song song
  → retry + circuit breaker + parser + validator
  → ticker matching
  → Vietnamese sentiment scoring
  → news table
  → news list/sentiment/market timeline
```

## Cấu trúc repository

```text
.
├── src/
│   ├── app/                    # Pages và API routes của Next.js
│   │   ├── api/v1/             # REST-like internal API boundary
│   │   ├── stocks/[symbol]/    # Stock intelligence workspace
│   │   ├── crypto/             # Crypto workspace
│   │   ├── forex/              # Forex workspace
│   │   ├── commodities/        # Commodities workspace
│   │   ├── heatmap/            # Heatmap workspace
│   │   ├── reports/            # Report workspace
│   │   ├── screener/           # Screening workspace
│   │   ├── agent/              # AI Agent workspace
│   │   ├── watchlist/          # Watchlist
│   │   ├── system/             # Operations console
│   │   └── settings/           # Account/settings
│   ├── components/             # Shared UI và dashboard components
│   ├── db/                     # PostgreSQL bootstrap, schema, ensure tables
│   ├── lib/                    # Domain services, connectors, auth, cache, AI
│   ├── types/                  # Shared contracts, gồm MarketSnapshot
│   ├── instrumentation.ts      # Startup instrumentation/schedulers
│   └── middleware.ts           # Global public/session gate
├── docs/                       # Migration và system review documents
├── monitoring/                 # Prometheus/Grafana configuration
├── scripts/                    # Migration/operational scripts
├── Dockerfile
├── docker-compose.yml
├── docker-compose.monitoring.yml
├── docker-compose.supabase.yml
├── drizzle.config.ts
├── next.config.ts
├── vercel.json
├── .env.example
└── package.json
```

## API

Mọi endpoint nghiệp vụ nằm dưới `/api/v1`. Response thành công theo envelope `{ data, meta }`; error response chứa thông báo public-safe và metadata timestamp/context.

### Market và stock

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/market/overview` | MarketSnapshot cho dashboard |
| GET | `/api/v1/market/heatmap` | Heatmap thị trường |
| GET | `/api/v1/market/heatmap/history` | Lịch sử heatmap |
| GET | `/api/v1/market/heatmap/intelligence` | Intelligence cho heatmap |
| GET | `/api/v1/search?q=&type=` | Search/autocomplete mã và company |
| GET | `/api/v1/stocks/:symbol` | Quote và company cơ bản |
| GET | `/api/v1/stocks/:symbol/history` | OHLCV history |
| GET | `/api/v1/stocks/:symbol/analysis` | Technical analysis và recommendation |
| GET | `/api/v1/stocks/:symbol/fundamental` | Fundamental, health và valuation |
| GET | `/api/v1/stocks/:symbol/technical` | Candlestick và chart patterns |
| GET | `/api/v1/stocks/:symbol/financials` | Financial statements |
| GET | `/api/v1/stocks/:symbol/financial-health-detail` | Health breakdown |
| GET | `/api/v1/stocks/:symbol/fundamental-chart` | Fundamental chart data |
| GET | `/api/v1/stocks/:symbol/profile` | Company profile |
| GET | `/api/v1/stocks/:symbol/sentiment` | Sentiment symbol/market 24 giờ |
| GET | `/api/v1/stocks/:symbol/swot/generate` | SWOT generation |
| GET | `/api/v1/stocks/:symbol/value-chain` | Porter value chain |
| GET | `/api/v1/news` | News list, pagination, filter symbol |
| GET/POST/DELETE | `/api/v1/watchlist` | Read/add/remove watchlist theo session |

### Crypto

Các route chính nằm dưới `/api/v1/crypto` và bao gồm `coins`, `prices`, `launchpad`, `:symbol`, `price`, `ohlcv`, `analysis`, `recommendation`, `bundle`, `futures`, `onchain`, `orderflow`, `whale`, `sentiment`, `sentiment-intel`, `intel` và `ai-brief`.

### Forex

Các route chính nằm dưới `/api/v1/forex` và bao gồm `pairs`, `prices`, `:symbol`, `price`, `ohlcv`, `analysis`, `recommendation`, `bundle`, `analyst`, `calendar`, `health`, `metrics`, `performance`, `portfolio`, `journal` và journal item operations.

### Commodities, reports, screener và finance

| Nhóm | Routes |
|---|---|
| Commodities | `/api/v1/commodities`, `/:symbol`, `history`, `impact`, `refresh`, `sources/status` |
| Reports | `/api/v1/reports`, `morning`, `summary`, `scheduler`, `trigger/morning`, `trigger/summary` |
| Screener | `/api/v1/screener/:method` |
| Personal finance | `/api/v1/personal-finance/profile` |
| Corporate finance | `/api/v1/corporate-finance/statements`, `statements/:id` |
| AI Agent | `/api/v1/agent/chat` |

### Auth, users và operations

| Nhóm | Routes |
|---|---|
| Auth | `/api/v1/auth/login`, `register`, `logout`, `me` |
| 2FA | `/api/v1/users/2fa/setup`, `verify`, `disable` |
| User | `/api/v1/users/me`, `preferences`, `sessions`, `sessions/:id`, `change-password`, `audit-logs`, `export-data` |
| Health | `/api/health`, `/api/health/upstream` |
| Connectors | `/api/v1/admin/connectors`, `connectors/:name/test`, `connectors/:name/reset` |
| Logs/alerts | `/api/v1/admin/logs`, `/api/v1/admin/alerts` |

## Database

Database được định nghĩa bằng Drizzle schema và có thể chạy PostgreSQL tự host hoặc Supabase. `src/db/index.ts` tự nhận diện Supabase/PgBouncer, thiết lập SSL, connection pool, startup readiness, health state và self-ping.

Các nhóm bảng chính:

| Nhóm | Bảng tiêu biểu |
|---|---|
| Company/market | `companies`, `company_profiles`, `price_snapshots`, `price_snapshot_history`, `financial_statements`, `fundamental_analysis` |
| News/analysis | `news`, `company_swot`, `company_value_chains`, `reports` |
| Operations | `job_logs`, `connector_alerts` |
| Identity | `users`, `refresh_tokens`, `user_sessions`, `user_preferences`, `audit_logs` |
| AI | `agent_conversations`, `agent_logs` |
| Commodities | `commodities`, `commodity_prices`, `commodity_stock_impact`, `exchange_rates` |
| Crypto | `crypto_coins`, `crypto_prices`, `crypto_ohlcv`, `crypto_sentiment`, `crypto_analysis` |
| Forex | `forex_pairs`, `forex_prices`, `forex_ohlcv`, `forex_analysis`, `forex_journal`, `forex_positions` |
| Finance | `personal_finance_profiles`, `corporate_finance_statements` |
| Watchlist | `watchlist_items` |

Snapshot tables dùng unique constraint theo symbol hoặc symbol/time để tránh insert trùng. News dùng GUID unique. User-related tables dùng foreign key và cascade/set-null semantics tùy quan hệ.

### Supabase migration

Xem [`docs/SUPABASE_MIGRATION.md`](./docs/SUPABASE_MIGRATION.md) để chuyển từ PostgreSQL tự host sang Supabase, gồm tạo project, cấu hình connection string, migrate schema/data bằng Drizzle và `pg_dump`/`pg_restore`. Script hỗ trợ nằm tại `scripts/migrate-to-supabase.sh`.

## Resilience và observability

ORCA coi upstream failure là trạng thái sản phẩm cần quan sát, không phải exception được bỏ qua.

### Reliability primitives

- Exponential backoff có jitter cho HTTP connector.
- Timeout riêng cho từng request.
- Circuit breaker theo provider với các trạng thái `closed`, `open`, `half-open`; half-open chỉ cho phép một probe để tránh thundering herd.
- Fallback chain theo loại dữ liệu.
- Data validation trước khi insert hoặc trả về frontend.
- `safeDbQuery` retry cho transient database errors.
- Shared cache, inflight dedupe và stale-while-revalidate để chống request storm và giữ snapshot cũ khi refresh lỗi.
- Hard deadline cho Market Overview: trả partial/stale fallback trong khoảng mục tiêu thay vì chờ provider/DB vô hạn.
- Database fail-fast khi thiếu cấu hình, bảo vệ late `pool.connect()` khỏi connection leak và chống gọi `pool.end()` lặp khi shutdown.
- Fast-fail quote path riêng cho overview; chart/detail vẫn giữ timeout đầy đủ.
- Concurrency-limited `mapPool` cho quote/search/news workers.
- Background scheduler là opt-in qua `RUN_BACKGROUND_SCHEDULERS=1`, tránh mỗi web/serverless instance tự chạy duplicate workers.
- Stale registry khi mọi provider cho một kind/symbol đều lỗi.
- Structured JSON logs và in-memory ring buffer tối đa 500 entries.
- Alert dispatcher cho connector DOWN kéo dài, có persistence và Slack webhook tùy chọn.

### Operations console

Trang `/system` hiển thị connector cards, aggregate status, success rate, uptime, cumulative downtime, circuit state, recent logs, alert timeline, stale flags và configuration readout. Có manual probe/reset để operator kiểm tra hoặc mở lại connector.

### Health endpoints

- `GET /api/health`: kiểm tra database, upstream và stale flags; trả 503 khi database down hoặc connector DOWN theo policy.
- `GET /api/health/upstream`: trạng thái upstream.
- `GET /api/v1/admin/connectors`: trạng thái chi tiết connector.
- `GET /api/v1/admin/logs?provider=&level=&limit=`: structured log viewer.
- `GET /api/v1/admin/alerts`: open/recent/persisted alerts.
- `POST /api/v1/admin/connectors/{name}/test`: manual probe.
- `POST /api/v1/admin/connectors/{name}/reset`: manual circuit reset.

### Performance contract cho Market Overview

Dashboard tổng quan được thiết kế theo mô hình **cache-first, stale-tolerant và single-flight**. Request đầu tiên ưu tiên snapshot hiện tại trong database/cache; khi cache miss, các quote được fetch theo batch có giới hạn concurrency. News, market breadth mở rộng và crypto là dữ liệu phụ có deadline riêng, không được phép giữ toàn bộ UI trong trạng thái chờ. Nếu upstream hoặc database vượt deadline, API trả snapshot partial/stale có metadata `quality.stale`, `quality.partial`, `quality.ageSeconds` và `quality.sources` để frontend hiển thị trạng thái đúng.

Trong production/serverless, không nên chạy scheduler trên mọi web instance. Hãy dành một process worker riêng với `RUN_BACKGROUND_SCHEDULERS=1`; web instances giữ `RUN_BACKGROUND_SCHEDULERS=0`. Cách này ngăn alert dispatcher, report scheduler, commodities, crypto và forex jobs tranh chấp pool database với request dashboard.

### Environment tuning

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `CIRCUIT_BREAKER_THRESHOLD` | `5` | Số lỗi liên tiếp trước khi mở circuit |
| `CIRCUIT_BREAKER_TIMEOUT` | `60000` | Cooldown circuit, ms |
| `CONNECTOR_RETRY_ATTEMPTS` | `2` | Số retry mỗi HTTP call; lớp fetch áp trần an toàn 5 lần |
| `CONNECTOR_RETRY_BASE_MS` | `700` | Base delay backoff |
| `CONNECTOR_FETCH_TIMEOUT_MS` | `8000` | HTTP timeout; lớp fetch áp trần 250 ms–30 giây |
| `CONNECTOR_STALE_AFTER_MS` | `900000` | Thời gian coi connector là stale/down |
| `CONNECTOR_DEGRADED_AFTER_MS` | `300000` | Thời gian chuyển degraded |
| `CONNECTOR_QUOTE_CONCURRENCY` | `5` | Số quote fetch song song |
| `CONNECTOR_SEARCH_CONCURRENCY` | `3` | Search concurrency |
| `CONNECTOR_NEWS_INSERT_CONCURRENCY` | `8` | News insert concurrency |
| `CONNECTOR_ALERT_AFTER_MS` | `300000` | Down duration trước alert |

## Authentication và security

Middleware public các path marketing, auth UI/API, health probe và static internals; các page/API còn lại cần session gate. Server-side auth guard xác thực bearer access token hoặc lookup httpOnly `refreshToken` trong database.

Security primitives hiện có gồm:

- Password hashing bằng bcrypt.
- JWT access token ngắn hạn.
- Refresh token lưu database với expiry.
- TOTP/2FA challenge ngắn hạn.
- `Authorization: Bearer` và cookie session.
- Audit log cho các thao tác user.
- Public-safe API errors, không lộ SQL/connection details.
- Sliding-window rate limit theo IP trên các route có áp dụng.
- Input validation cho symbol, payload và query parameters.

Khi bổ sung route mới, phải xác định rõ route là public, authenticated user, resource-owner hoặc internal service. **Không nhận `userId` từ request body/query cho dữ liệu cá nhân nếu có thể lấy identity từ server-side session.** Manual report trigger và scheduler endpoint nên được bảo vệ bằng service/cron secret riêng.

## Cài đặt local

### Yêu cầu

- Node.js 22 hoặc tương thích.
- npm hoặc pnpm.
- PostgreSQL 16+ nếu chạy database local.
- Redis-compatible shared cache được khuyến nghị khi chạy nhiều instance hoặc production.

### Cài đặt

```bash
git clone https://github.com/duyanhphan13579dz-dot/orcafinancial.git
cd orcafinancial
cp .env.example .env
npm install
```

Điền tối thiểu `DATABASE_URL` và `JWT_SECRET` trong `.env`. Nếu muốn dữ liệu thị trường/crypto/news hoạt động đầy đủ, cần cho phép outbound HTTPS từ môi trường chạy tới provider tương ứng.

### Database và dev server

```bash
npm run db:push
npm run dev
```

Sau đó mở `http://localhost:3000`. Người dùng chưa đăng nhập sẽ thấy landing page; người dùng đã có session sẽ thấy dashboard tổng quan.

### Scripts

| Command | Mục đích |
|---|---|
| `npm run dev` | Chạy Next.js development server |
| `npm run build` | Push schema bằng Drizzle Kit và build production |
| `npm run start` | Chạy production server sau build |
| `npm run db:push` | Push schema hiện tại vào database |
| `npm run typecheck` | TypeScript check không emit |
| `npm run lint` | ESLint toàn repository |
| `npm test` | Chạy unit/resilience tests bằng Vitest |
| `npm run test:watch` | Chạy Vitest ở chế độ watch |

## Chạy bằng Docker

Docker Compose cung cấp PostgreSQL, PgBouncer tùy chọn và web service:

```bash
cp .env.example .env
# điền JWT_SECRET, provider keys và Redis nếu cần
docker compose up -d --build

# Tùy chọn: chạy scheduler trên worker riêng, không làm nặng web instance
docker compose --profile worker up -d --build
```

Các service mặc định:

| Service | Port | Vai trò |
|---|---:|---|
| `postgres` | `5432` | PostgreSQL persistent volume |
| `pgbouncer` | `6432` | Transaction pooler |
| `web` | `3000` | ORCA FINANCIAL production server; scheduler tắt mặc định |
| `worker` | — | Optional profile; chạy report/alert/commodities/crypto/forex schedulers |

`docker-compose.monitoring.yml` bổ sung monitoring stack. `docker-compose.supabase.yml` phục vụ các kịch bản dùng Supabase thay cho database local.

## Environment variables

### Database và cache

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
DATABASE_POOL_MAX=5
DATABASE_POOL_TIMEOUT_MS=10000
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
DATABASE_STARTUP_RETRIES=10
DATABASE_STARTUP_RETRY_DELAY_MS=2000
DATABASE_SELF_PING_INTERVAL_MS=30000
DATABASE_DOWN_ALERT_AFTER_MS=120000
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
REDIS_REQUIRED=1
RUN_BACKGROUND_SCHEDULERS=0
```

### Market/cache

```dotenv
MARKET_OVERVIEW_TTL_MS=60000
MARKET_QUOTE_TTL_MS=20000
MARKET_HIST_D_TTL_MS=120000
MARKET_HIST_INTRA_TTL_MS=30000
MARKET_OVERVIEW_AUX_TIMEOUT_MS=450
MARKET_OVERVIEW_TOTAL_TIMEOUT_MS=2500
OVERNIGHT_MARKET_TTL_MS=45000
OVERNIGHT_MARKET_TIMEOUT_MS=1200
CACHE_REFRESH_BACKOFF_MS=15000
```

### Connector

```dotenv
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
CONNECTOR_RETRY_ATTEMPTS=2
CONNECTOR_RETRY_BASE_MS=700
CONNECTOR_FETCH_TIMEOUT_MS=8000
CONNECTOR_STALE_AFTER_MS=900000
CONNECTOR_DEGRADED_AFTER_MS=300000
CONNECTOR_ALERT_AFTER_MS=300000
CONNECTOR_QUOTE_CONCURRENCY=5
CONNECTOR_SEARCH_CONCURRENCY=3
CONNECTOR_NEWS_INSERT_CONCURRENCY=8
```

### LLM và agent

```dotenv
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
LLM_PROVIDER_ORDER=groq,openrouter
LLM_STRICT=1
AGENT_RESPONSE_TTL_MS=180000
```

### Commodities, calendar và alerts

```dotenv
COMMODITY_PRIMARY_SOURCE=simplize
COMMODITY_SCAN_INTERVAL_MS=60000
COMMODITY_RETENTION_DAYS=30
COMMODITY_PRUNE_INTERVAL_MS=21600000
FINNHUB_API_KEY=
SLACK_WEBHOOK_URL=
LOG_DEBUG=1
```

Không commit `.env` hoặc secret thật vào repository. Production cần đặt secret trong platform secret manager/Vercel/Supabase/Docker secret mechanism tương ứng.

## Kiểm thử và chất lượng mã

Trước mỗi commit nên chạy:

```bash
npm run typecheck
npm test
npm run lint
git diff --check
```

Repository sử dụng **Vitest** cho unit và resilience tests. Bộ test trong `tests/` không yêu cầu database, Redis hoặc upstream thật; các boundary được mock để kiểm thử timeout, abort, circuit breaker, stale cache, single-flight, DB fail-fast, Redis L1 fallback và cô lập module phụ.

Các kịch bản bắt buộc của Market Overview gồm provider timeout không chặn provider khỏe; crypto/news degraded không làm mất quote; circuit mở sau lỗi liên tiếp và chỉ cho một half-open probe; cache stale trả ngay trong khi refresh nền lỗi; Redis thiếu vẫn dùng L1; database thiếu cấu hình fail-fast.

Khi kiểm tra riêng dashboard/data contract, có thể chạy:

```bash
npx eslint src/components/DashboardHome.tsx src/lib/market.ts src/types/market.ts
```

Cần kiểm tra cả happy path và degraded path: database down, provider timeout, provider trả payload sai, Redis unavailable, quote partial, news feed empty và cold start. UI phải thể hiện loading, empty, error, partial và stale state một cách rõ ràng.

## Deployment

### Vercel hoặc serverless

- Cấu hình `DATABASE_URL` tới Supabase hoặc managed PostgreSQL.
- Dùng PgBouncer/pooler và giữ `DATABASE_POOL_MAX` nhỏ phù hợp serverless.
- Cấu hình Redis shared cache trong production nhiều instance.
- Kiểm tra outbound firewall/DNS tới VNDirect, Yahoo, CoinGecko, Binance Vision và RSS.
- Đặt `JWT_SECRET` dài tối thiểu 32 ký tự.
- Cấu hình `SLACK_WEBHOOK_URL` nếu cần alert connector.
- Kiểm tra `maxDuration` cho agent/report endpoints.
- Kiểm tra `/api/health` sau deploy và xác nhận schema đã được apply.

### Docker

Production Docker Compose dùng health-gated startup: PostgreSQL healthy trước PgBouncer, PgBouncer healthy trước web. Container web expose port `3000` và có healthcheck gọi `/api/health`.

### Scheduler

Các scheduler cho commodities, crypto, reports, database self-ping và alert dispatcher được khởi động qua instrumentation/runtime theo cấu hình. Với môi trường serverless, không giả định process luôn sống lâu; các job cần tính bền vững nên được kích hoạt bởi platform cron/worker và bảo vệ bằng service authorization.

## Các giới hạn hiện tại

README này phản ánh implementation hiện tại, nhưng một số dữ liệu phụ thuộc vào mức độ phủ của upstream và database:

1. **Market breadth:** breadth toàn market chỉ được tính khi có đủ fresh snapshots trong universe hiện có. Nếu chưa có universe rộng, snapshot tự gắn `scope: featured` và UI phải nói rõ đó là tracked breadth.
2. **Foreign flow:** contract đã sẵn sàng nhưng có thể trả `unknown` khi chưa có provider hợp lệ.
3. **Sector classification:** sector board hiện dựa trên danh sách symbol classification được cấu hình trong `SECTOR_DEFINITIONS`; giá/volume/change vẫn lấy từ quote thật.
4. **Stale shadow:** một số stale fallback vẫn phụ thuộc process memory nếu shared cache không có dữ liệu bền vững.
5. **Realtime semantics:** polling và service cache tạo trải nghiệm cập nhật định kỳ, không đồng nghĩa tick-by-tick realtime cho mọi widget.
6. **AI Insight dashboard:** vùng insight hiện là quantitative/structured explanation layer; AI Agent và LLM narrative là module riêng, không nên gộp hai semantics này thành lời khẳng định dự báo.
7. **Authorization migration:** các route dữ liệu cá nhân hoặc internal trigger cần tiếp tục được audit theo resource ownership và service authorization trước production scale.
8. **Persistence fire-and-forget:** một số snapshot/log write được thực hiện ngoài critical response path để giảm latency; production nên có reconciliation/queue nếu yêu cầu audit/history tuyệt đối.

> **Disclaimer:** ORCA FINANCIAL cung cấp dữ liệu và công cụ phân tích nhằm mục đích thông tin. Không nội dung nào trong hệ thống là lời khuyên đầu tư, khuyến nghị mua/bán, tư vấn tài chính, pháp lý hoặc cam kết lợi nhuận.

## Tài liệu liên quan

- [`docs/ORCA_FINANCIAL_SYSTEM_REVIEW.md`](./docs/ORCA_FINANCIAL_SYSTEM_REVIEW.md): báo cáo rà soát kiến trúc và rủi ro hệ thống.
- [`docs/SUPABASE_MIGRATION.md`](./docs/SUPABASE_MIGRATION.md): hướng dẫn chuyển database sang Supabase.
- [`docs/grafana.md`](./docs/grafana.md): hướng dẫn monitoring Grafana.
- [GitHub repository](https://github.com/duyanhphan13579dz-dot/orcafinancial): source code và commit history.

## License

MIT. Xem [`LICENSE`](./LICENSE).


### Quarterly financial-period audit

The deployment includes a protected endpoint at `/api/internal/financial-period-audit`. Vercel Cron runs it daily at 02:00 UTC during days 1–20 of January, April, July, October and December (`0 2 1-20 1,4,7,10,12 *`). This gives the audit a 20-day publication window around each expected reporting update rather than relying on one single run. The job checks the last completed quarter, rejects future-dated actual records, verifies that persisted rows do not contain future quarters, and records the result in `job_logs`.

Set `CRON_SECRET` in the production environment so the platform cron request is authenticated. An optional `FINANCIAL_AUDIT_SECRET` can be used for a separate scheduler. `FINANCIAL_AUDIT_SYMBOLS` controls the comma-separated audit universe and defaults to `VNM,HPG,FPT,VCB`. A successful run returns HTTP 200; a detected period-integrity error returns HTTP 409 and records the offending symbols and periods. Provider-unavailable data is reported as estimate/degraded rather than being promoted to audited actual.


### Supabase/PostgreSQL connection hardening

The database layer is configured for serverless-safe connection usage. For Supabase production, prefer the transaction pooler connection string on port `6543` with `pgbouncer=true`; keep `DATABASE_POOL_MAX` small (default `2`) and do not create a new `Pool` per request. Connections are recycled after a bounded number of uses/lifetime, idle connections are closed promptly, and TCP keep-alive is enabled.

The following environment variables control the safeguards:

```env
DATABASE_POOL_MAX=2
DATABASE_POOL_TIMEOUT_MS=8000
DATABASE_POOL_IDLE_TIMEOUT_MS=15000
DATABASE_POOL_MAX_USES=500
DATABASE_POOL_MAX_LIFETIME_SECONDS=300
DATABASE_CONNECT_TIMEOUT_SECONDS=8
DATABASE_STATEMENT_TIMEOUT_MS=15000
DATABASE_IDLE_TRANSACTION_TIMEOUT_MS=30000
```

The shared query wrapper retries transient PostgreSQL/Supabase failures such as connection reset, `53300` too many clients, pool exhaustion and pooled timeout, using capped exponential backoff with jitter. The `/api/health` response exposes only safe pool counters (`totalCount`, `idleCount`, `waitingCount`, `max`) and database latency; it never exposes credentials. A sustained non-zero `waitingCount` should be treated as a capacity signal: reduce request fan-out, use cached reads, or increase Supabase pooler capacity rather than blindly increasing per-instance pool size.

The Supabase project should be monitored through Database Advisors and logs. Unused-index notices are informational and should not be removed solely because of a short observation window. Schema changes must be applied through reviewed migrations; this hardening change does not delete data or disable the existing financial-period safeguards.
