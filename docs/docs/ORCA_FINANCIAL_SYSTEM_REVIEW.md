# Báo cáo rà soát hệ thống ORCA FINANCIAL

**Phạm vi:** Repository `duyanhphan13579dz-dot/orcafinancial`, nhánh `main`, commit hiện tại `40b1e31`.

**Mục tiêu:** Đọc cấu trúc mã nguồn và mô tả cách website tài chính vận hành ở cấp hệ thống, đặc biệt là trải nghiệm tổng quan thị trường tại trang chủ, luồng dữ liệu, khả năng chịu lỗi, các ranh giới bảo mật và những việc nên ưu tiên tiếp theo.

> **Kết luận ngắn:** ORCA FINANCIAL đã có nền tảng khá đầy đủ của một financial intelligence platform: Next.js App Router, data engine backend-only, nhiều lớp cache, snapshot database, fallback provider, circuit breaker, phân tích cổ phiếu, crypto, forex, hàng hóa, báo cáo và AI Agent. Điểm mạnh lớn nhất là tư duy resilience và việc không để frontend gọi thẳng nguồn ngoài. Điểm cần xử lý trước khi mở rộng sản phẩm là **authorization ở các route dữ liệu cá nhân/vận hành, tính minh bạch của dữ liệu stale/fallback, và việc đồng bộ các TTL/cache để tránh dashboard “polling nhanh nhưng dữ liệu không mới hơn”**.

## 1. Bản đồ hệ thống

ORCA được tổ chức thành ba lớp chính. Lớp giao diện nằm trong `src/app` và `src/components`; lớp domain/service nằm trong `src/lib`; lớp persistence nằm trong `src/db` cùng các schema theo module. Đây là phân tách hợp lý cho Next.js App Router: page chịu trách nhiệm composition và trải nghiệm, service chịu trách nhiệm nghiệp vụ, còn API route làm adapter mỏng.

| Lớp | Thành phần tiêu biểu | Vai trò |
|---|---|---|
| Presentation | `src/app/layout.tsx`, `DashboardHome.tsx`, stock/crypto/forex pages | Shell dùng chung, navigation, dashboard, trang phân tích chi tiết và polling phía client |
| API boundary | `src/app/api/v1/**/route.ts` | Rate limit, gọi service, chuẩn hóa envelope `{ data, meta }`, chuyển lỗi upstream thành HTTP 502 |
| Domain services | `src/lib/market.ts`, `fundamental.ts`, `analysis.ts`, `crypto/*`, `forex/*`, `commodities/*`, `reports/*` | Lấy dữ liệu, tính toán chỉ số, phân tích và orchestration theo lĩnh vực |
| Connector layer | `src/lib/connectors/core.ts`, `providers.ts` | Retry, timeout, circuit breaker, validation, fallback, cache và concurrency control |
| Persistence | `src/db/index.ts`, `src/db/schema.ts` | PostgreSQL/Drizzle, snapshots, lịch sử giá, tin tức, báo cáo, auth và dữ liệu module |
| Operations | `/system`, `/api/health`, connector/admin endpoints, structured logs | Quan sát connector, database, stale flags, alert timeline và job logs |

Các module nghiệp vụ hiện không chỉ dừng ở chứng khoán Việt Nam. README và cây mã nguồn cho thấy hệ thống còn bao gồm **market overview, stock analysis, financial health, fundamental valuation, technical patterns, sentiment, news, crypto, forex, commodities, screener, reports, AI Agent, personal finance và corporate finance**. Vì vậy, thách thức kiến trúc hiện tại không còn là “làm thêm màn hình”, mà là duy trì ranh giới dữ liệu, quyền truy cập và semantics nhất quán khi số module tăng lên.

## 2. Luồng hệ thống tổng quan tại trang chủ

Trang `/` có hai trạng thái trải nghiệm. `src/app/page.tsx` đọc cookie `refreshToken` ở server và chọn `LandingPage` cho khách chưa đăng nhập hoặc `DashboardHome` cho người đã đăng nhập. Cách này tránh việc trang chủ phải chờ một vòng gọi `/api/v1/auth/me` ở client trước khi render; dashboard bắt đầu các poll dữ liệu sau khi component mount. Middleware áp dụng cùng một kiểu kiểm tra nông ở edge/page boundary trong `src/middleware.ts`.

Luồng request chính có thể tóm tắt như sau:

```text
Browser mở /
  -> middleware kiểm tra public path / refreshToken hoặc Bearer
  -> page.tsx chọn LandingPage hoặc DashboardHome
  -> DashboardHome.usePoll()
      -> client cache + inflight dedupe
      -> GET /api/v1/market/overview
          -> checkRateLimit()
          -> getMarketOverview()
              -> service cache / Redis wrapper
              -> song song: index quotes + featured quotes + crypto
                  -> fresh DB snapshots nếu còn mới
                  -> nếu thiếu: VNDirect primary
                  -> lỗi: Yahoo fallback
                  -> crypto: CoinGecko -> Binance Vision
              -> breadth + movers + generatedAt
          -> ok({ data, meta })
  -> DashboardHome render ticker, indices, breadth, crypto, board, news
```

`DashboardHome.tsx` gọi `/market/overview` mỗi 15 giây và `/news?limit=8` mỗi 60 giây. Hook `usePoll` có cache mềm/cứng, deduplicate request đang bay, refresh nền và bỏ qua interval khi tab không visible. Đây là thiết kế tốt cho dashboard: lần render sau có thể dùng dữ liệu đã cache, trong khi UI vẫn cập nhật mà không tạo request trùng.

Tuy nhiên, cần phân biệt rõ **tần suất kiểm tra** với **độ mới dữ liệu**. `DashboardHome` poll mỗi 15 giây, route gửi cache hint 3 giây, nhưng `getMarketOverview()` mặc định cache payload 60 giây. Vì vậy, phần lớn các lần poll trong cùng một phút có thể chỉ nhận lại payload cũ. Đây không nhất thiết là lỗi; nó là trade-off có chủ ý để bảo vệ provider và database. Nhưng tên gọi “real-time” trong UI nên được thay bằng “cập nhật định kỳ” hoặc phải hiển thị `generatedAt`/tuổi dữ liệu để người dùng hiểu đúng.

## 3. Data Engine và chất lượng dữ liệu

`src/lib/market.ts` là service trung tâm của dashboard. Danh sách mặc định gồm 20 mã vốn hóa/lớn phổ biến, cùng ba chỉ số VN-Index, HNX-Index và UPCOM-Index. Trong cache miss, index quotes, featured quotes và crypto được tải bằng `Promise.all`. Equity quote được giới hạn concurrency qua `mapPool`, sau đó tính số mã tăng, giảm, đứng giá và sắp xếp top movers.

| Dữ liệu | Primary | Fallback | Cache/persistence | Ý nghĩa trên dashboard |
|---|---|---|---|---|
| Chỉ số và cổ phiếu | VNDirect dchart | Yahoo Finance | DB snapshot + price history + service cache | Ticker, index cards, bảng giá, breadth |
| Crypto | CoinGecko | Binance Vision | Connector cache | Khối crypto nhỏ trên dashboard |
| Tin tức | VnExpress, CafeF, Vietstock RSS | Nguồn RSS còn sống | DB news + list cache | Tin mới nhất và liên kết bài gốc |
| Sentiment | Rule-based/hybrid LLM ở domain tương ứng | Phụ thuộc dữ liệu news | DB sentiment trong news/analysis | Nhãn và điểm cảm xúc trong các view |

Lớp connector trong `src/lib/connectors/core.ts` có các thành phần đáng chú ý: `fetchWithRetry` với exponential backoff và jitter; `CircuitBreaker` theo từng provider; `DataValidator` cho OHLCV, quote và news; `safeDbQuery`; cache dedupe theo key; stale shadow cache; sliding-window rate limit; và `mapPool` giới hạn concurrency. `providers.ts` gắn các cơ chế này vào VNDirect, Yahoo, CoinGecko, Binance Vision và RSS.

Đây là một điểm mạnh kiến trúc quan trọng. Hệ thống không chỉ “catch lỗi”, mà còn có cách **giảm áp lực lên upstream**, **ngăn lặp request vô hạn**, **từ chối record sai**, và **ghi nhận trạng thái connector**. `src/db/index.ts` bổ sung pool PostgreSQL, Supabase/PgBouncer detection, startup readiness, self-ping và health state.

Có ba giới hạn cần làm rõ trong sản phẩm. Thứ nhất, breadth hiện được tính trên 20 mã `FEATURED_SYMBOLS`, không phải toàn thị trường. Label hiện tại đã ghi “top N mã”, đây là cách giảm rủi ro diễn giải sai; nên giữ nguyên hoặc đổi tên thành “Breadth nhóm theo dõi”. Thứ hai, `getQuotes` dùng `Promise.allSettled` và bỏ các mã bị lỗi, nên dashboard có thể render thành công một payload thiếu mã mà không cho người dùng biết symbol nào bị loại. Thứ ba, metadata `source` và `confidence` tồn tại trong payload quote nhưng phần dashboard đã đọc chủ yếu chỉ hiển thị source; nên hiển thị thêm badge `fallback`, `stale` hoặc tuổi dữ liệu khi confidence thấp.

## 4. Giao diện tổng quan và trải nghiệm người dùng

Shell dùng chung trong `src/app/layout.tsx` có desktop header hai hàng, search bar, user menu, navigation ngang, mobile header/bottom navigation, AuthProvider và theme loader. Visual language nhất quán với định vị terminal tài chính: nền xanh đậm, cyan accent, typography display/sans/mono và số liệu dạng tabular.

Dashboard hiện bao gồm ticker tape, bốn quick links, index cards, breadth bar, crypto panel, bảng giá, và news panel. Cấu trúc này phù hợp với hành vi “scan nhanh”: người dùng nhìn thấy trạng thái thị trường trước, sau đó đi sâu vào watchlist, screener, reports hoặc AI Agent.

Trang chi tiết cổ phiếu trong `src/app/stocks/[symbol]/page.tsx` mở rộng hệ thống theo hướng tab-gated loading. Có bảy tab đang khai báo: `Tổng quan`, `Phân tích KT`, `Cơ bản`, `Mẫu hình`, `Tài chính`, `Công ty`, `Tin tức`. Các chart và panel nặng được dynamic import với `ssr:false`; các endpoint fundamental, technical, health detail và chart chỉ được poll khi tab phù hợp được chọn. Đây là tối ưu đúng hướng cho bundle và thời gian tương tác.

Có một điểm không đồng bộ tài liệu: README mô tả trang cổ phiếu có “5 tabs”, trong khi code hiện có 7 tabs. Cần sửa tài liệu hoặc xác nhận lại product taxonomy để tránh onboarding và QA theo một contract sai.

## 5. Bảo mật và boundary quyền truy cập

Middleware bảo vệ hầu hết path không public, nhưng việc middleware kiểm tra `refreshToken` chỉ dựa trên việc cookie tồn tại và có độ dài lớn hơn 10; việc xác thực token thực tế nằm ở `getAuthedUser()` trong `src/lib/auth/guard.ts`. Đây là pattern có thể chấp nhận cho routing sớm nếu mọi route nhạy cảm luôn gọi guard, nhưng không thể xem middleware hiện tại là authorization hoàn chỉnh.

Rà soát các route cho thấy một rủi ro nghiêm trọng hơn: `src/app/api/v1/forex/journal/route.ts` nhận `userId` trực tiếp từ query/body rồi truyền vào service. `src/lib/forex/journal.ts` cũng mặc định dùng `anonymous` nếu không có userId. Route này không gọi `getAuthedUser`, không có rate limit và cho phép đọc/ghi journal theo định danh do client cung cấp. Đây là **IDOR/unauthorized data access risk** nếu endpoint được expose trong môi trường thật. Các route journal theo id, portfolio, performance, alerts và một số route trigger/report cần được rà soát cùng nguyên tắc.

Tương tự, `src/app/api/v1/reports/trigger/morning/route.ts` cho phép POST trigger report và chỉ áp dụng rate limit; trong phần đã đọc không có guard người dùng hoặc secret nội bộ. Nếu đây là endpoint vận hành, nó nên được tách khỏi user API và bảo vệ bằng service token/cron secret; nếu là tính năng người dùng, cần authorization rõ ràng và idempotency.

| Mức độ | Phát hiện | Tác động | Ưu tiên |
|---|---|---|---|
| Critical/High | Journal nhận `userId` từ request, thiếu auth/rate limit | Có thể đọc/ghi dữ liệu giao dịch của user khác hoặc spam endpoint | P0 |
| High | Manual report trigger thiếu boundary vận hành rõ ràng | Có thể kích hoạt job nặng/LLM nhiều lần, tăng chi phí và gây quá tải | P0 |
| High | Một số forex routes thiếu rate limit theo rà soát route | Dễ bị abuse hoặc tạo tải upstream | P0 |
| Medium | Middleware chỉ kiểm tra token “trông hợp lệ” | Token rác vượt edge gate; tăng tải handler và tạo cảm giác bảo vệ không nhất quán | P1 |
| Medium | `Cache-Control: public` được dùng chung trong `ok()` | Nguy cơ cache nhầm nếu áp dụng helper cho payload cá nhân | P1 |
| Medium | Dữ liệu thiếu symbol bị im lặng loại khỏi overview | Người dùng có thể hiểu payload partial là toàn vẹn | P1 |

## 6. Các vấn đề vận hành và tính đúng đắn dữ liệu

Cơ chế snapshot hiện tại là hợp lý cho latency: đọc snapshot mới trong 45 giây, còn quote thiếu thì mới gọi upstream, rồi ghi current snapshot và history theo kiểu fire-and-forget. Trade-off là request nhanh hơn nhưng persistence không còn nằm trong critical path. Trên môi trường serverless, các thao tác fire-and-forget sau khi response hoàn tất có thể không được đảm bảo chạy đến cùng. Những lỗi này đã được log, nhưng nên có metric hoặc job reconciliation để phát hiện khoảng trống history.

`cached()` dùng shared cache và inflight dedupe; stale shadow lại là in-memory. Điều này có nghĩa stale fallback không nhất thiết tồn tại sau cold start hoặc giữa các instance. Nếu mục tiêu là resilience thực sự trên serverless nhiều instance, stale value nên được lưu trong Redis/DB kèm timestamp và source, thay vì chỉ ở memory.

Có hai định nghĩa `safeDbQuery`: một ở `src/lib/connectors/core.ts` và một ở `src/db/index.ts`. Chúng có regex, default backoff và semantics hơi khác nhau. Việc trùng tên làm tăng nguy cơ module này retry còn module kia không retry như kỳ vọng. Nên hợp nhất thành một implementation hoặc đổi tên theo tầng (`safeDbQueryConnector`, `safeDbQueryDatabase`) và thống nhất error taxonomy.

Một điểm cần kiểm chứng trong môi trường deploy là `getMarketOverview` ghi `jobLogs` trong mỗi cache miss. Khi nhiều instance cùng cold-start hoặc Redis unavailable, job log có thể tăng nhanh. Nên có retention policy/index strategy cho `job_logs`, cũng như sampling cho các job thành công nếu hệ thống tăng traffic.

## 7. Đề xuất lộ trình cải thiện

### P0 — Bảo vệ dữ liệu và endpoint vận hành

Đầu tiên, mọi route có dữ liệu cá nhân hoặc mutation phải lấy `userId` từ `getAuthedUser(req)`, không nhận identity từ body/query. Journal, portfolio, performance, alerts, watchlist, preferences, agent conversation và personal/corporate finance cần áp dụng cùng một helper authorization. Với mỗi resource theo id, phải kiểm tra ownership trước khi đọc, cập nhật hoặc xóa.

Tiếp theo, tách các manual trigger và scheduler endpoint khỏi user-facing API. Có thể dùng `CRON_SECRET`/service authorization, giới hạn method, idempotency theo `reportDate`, và rate limit riêng. Không nên coi việc route nằm dưới `/api/v1` là đủ để bảo vệ thao tác vận hành.

### P1 — Làm rõ semantics dữ liệu

Bổ sung vào envelope và UI các trường `asOf`, `ageSeconds`, `isStale`, `source`, `confidence`, `partial` và `missingSymbols`. Dashboard nên hiển thị rõ “cập nhật lúc…”, “fallback Yahoo”, hoặc “đang dùng dữ liệu stale” thay vì chỉ hiển thị source trong bảng desktop.

Đồng bộ TTL theo mục tiêu UX. Một cấu hình dễ hiểu là quote snapshot 45 giây, overview cache 30–60 giây, client poll 15 giây và UI có nhãn “last updated”. Nếu muốn dashboard thực sự gần real-time, cần giảm service TTL hoặc dùng streaming/websocket cho vùng dữ liệu phù hợp; không nên chỉ giảm polling interval.

### P1 — Chuẩn hóa connector và persistence

Hợp nhất hai `safeDbQuery`, chuẩn hóa error codes và đưa stale shadow vào shared cache có timestamp. Với fire-and-forget snapshot writes, thêm queue/reconciliation hoặc một scheduled persistence worker. Trên serverless, nếu không có worker dài hạn, nên cân nhắc ghi các record tối thiểu trong request hoặc đẩy event sang queue/storage bền vững.

### P2 — Product clarity và observability

Đổi label breadth thành “Breadth nhóm theo dõi” hoặc mở rộng dữ liệu để thực sự đại diện toàn thị trường. Đồng bộ README với bảy stock tabs. Bổ sung dashboard metric cho `quotesRequested`, `quotesSucceeded`, `quotesMissing`, provider fallback count, stale age và cache hit ratio. Các chỉ số này sẽ giúp phân biệt “UI chậm” với “upstream chậm” và “payload thiếu do provider lỗi”.

## 8. Kết luận

ORCA FINANCIAL đang đi đúng hướng về mặt nền tảng: backend data engine có tính tổ chức, nguồn ngoài được bao bọc, UI tổng quan có cấu trúc scan nhanh, stock detail có lazy loading, và hệ thống đã nghĩ đến degraded state thay vì chỉ xử lý happy path. Đây là nền tốt để phát triển thành một sản phẩm phân tích tài chính đa tài sản.

Tuy nhiên, khi hệ thống đã có journal, portfolio, personal finance, corporate finance, reports và AI Agent, **authorization phải được nâng lên thành một lớp kiến trúc bắt buộc ở mọi mutation/read riêng tư**, không thể dựa chủ yếu vào middleware hoặc convention. Sau khi đóng P0, ưu tiên kế tiếp là làm rõ tuổi và độ tin cậy dữ liệu trên UI, rồi mới tiếp tục tối ưu provider hoặc bổ sung module. Cách này sẽ giảm rủi ro sản phẩm lớn nhất: người dùng nhìn thấy một dashboard đẹp và phản hồi nhanh nhưng không biết dữ liệu đang partial, fallback, stale hoặc thuộc sai user boundary.

## Tài liệu tham chiếu trong repository

[1]: ../README.md "ORCA FINANCIAL README"
[2]: ../src/app/page.tsx "Root page branching"
[3]: ../src/app/layout.tsx "Root application layout"
[4]: ../src/middleware.ts "Global middleware and route gate"
[5]: ../src/components/DashboardHome.tsx "Dashboard overview UI"
[6]: ../src/lib/client.ts "Client API cache and polling"
[7]: ../src/app/api/v1/market/overview/route.ts "Market overview API route"
[8]: ../src/lib/market.ts "Market domain service"
[9]: ../src/lib/connectors/core.ts "Connector core and resilience utilities"
[10]: ../src/lib/connectors/providers.ts "External market/news providers"
[11]: ../src/db/index.ts "Database bootstrap and health"
[12]: ../src/db/schema.ts "Database schema"
[13]: ../src/app/stocks/[symbol]/page.tsx "Stock detail page"
[14]: ../src/lib/auth/guard.ts "Server-side auth guard"
[15]: ../src/app/api/v1/forex/journal/route.ts "Forex journal API route"
[16]: ../src/lib/forex/journal.ts "Forex journal service"
[17]: ../src/app/api/v1/reports/trigger/morning/route.ts "Manual morning report trigger"
