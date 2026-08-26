# Orca Stock Intelligence — Technical Specification v1.0

## Audit kết luận

Repository hiện có Stock dashboard Next.js với các route quote, history, technical, fundamental, financial statements, financial health, sentiment và reports. Market layer đã có cache theo TTL, fallback provider, snapshot DB và giới hạn request. Tuy nhiên, financial statements hiện được tổng hợp từ OHLCV bằng benchmark ngành; chưa có một canonical contract mang period type, source, timestamp, freshness và confidence xuyên suốt các module. Financial Health nhận trực tiếp các quarter tổng hợp và chưa công khai hard rule `current state = latest reported actual` trong contract API. Decision logic hiện nằm rải rác giữa analysis, fundamental và sentiment.

## Phạm vi v1 triển khai

| Dependency | Deliverable | Mục tiêu |
|---|---|---|
| Phase 1 | Canonical stock data model, period engine, provenance, validation | Tách Actual/Estimate/Target và làm rõ kỳ dữ liệu |
| Phase 2 | Single-flight cache, provider metadata, stale protection | Tránh request trùng và minh bạch freshness |
| Phase 3 | Financial health current-state contract | Chỉ dùng latest reported period cho current health |
| Phase 4 | ORCA decision engine | Score có breakdown, confidence, verdict, multi-horizon và giải thích |
| UX | Executive Summary | Quyết định ở Level 1, lý do ở Level 2, metadata dữ liệu ở đầu trang |

Các phase còn lại của roadmap (forecast/scenario, backtest, AI và PDF đầy đủ) sẽ tiêu thụ canonical contract này thay vì tự tính lại. Không đưa thêm dữ liệu giả hoặc tuyên bố accuracy khi chưa có historical signal database và censoring hợp lệ.

## Quy tắc bất biến

1. `actual`, `estimate` và `target` là ba `PeriodKind` khác nhau và không được trộn trong cùng một series.
2. Financial Health được gắn với `latestReportedPeriod` và chỉ đọc dữ liệu Actual.
3. Mọi payload dữ liệu phải mang `source`, `retrievedAt`, `period`, `status` và `confidence`.
4. `dataConfidence` (độ tin cậy dữ liệu) khác `predictionConfidence` (độ tin cậy dự báo).
5. Khi không đủ dữ liệu, module trả về `insufficient_data` thay vì suy diễn.
6. Score chỉ là phân tích định lượng; không phải lời khuyên tài chính cá nhân.

## Acceptance criteria

Stock API có executive summary thống nhất; response có metadata freshness; period engine xác định latest quarter, previous quarter, same quarter prior year, YTD, TTM và latest FY; validation phát hiện missing/duplicate/wrong period/impossible value; cache chống request trùng; Financial Health ghi rõ current period; UI hiển thị verdict, score, confidence, risk, trend, valuation và lý do.


## Addendum v1.1 — Stock Intelligence completion

The implementation has progressed from the original foundation specification to a complete Stock Intelligence product layer. All downstream engines consume shared stock-analysis contracts rather than independently rebuilding the same source fields.

| Layer | Final contract / behavior |
|---|---|
| Data foundation | Canonical financial periods, source/provenance, currency/unit, timestamps, freshness and confidence metadata are carried through analysis payloads. |
| Intelligence | ORCA Score, risk, forecast/scenario, news clustering, backtest, guarded forecast, causal cross-module context, moat and thesis are exposed as distinct explainable modules. |
| Persistence | Portfolio holdings, user preferences, alert rules/events, thesis versions, decision history and report history are represented in the database schema. |
| Product | Stock detail includes responsive tabs, mobile navigation, watchlist, report download and share/copy-link actions; market overview uses weighted polygon treemap geometry. |
| Reporting | `stock-analysis-pdf.ts` renders the canonical analysis payload into a Vietnamese 10-section A4 report with technical snapshot chart, localized dynamic narratives, stable spacing and no forced empty trailing pages. |
| Performance | Shared cache and stale/single-flight protections are used for heavy stock endpoints. The report endpoint uses a versioned cache key (`analysis-report-pdf-v5`) so content/layout changes invalidate old report artifacts. |

## Final invariants

The current reported state must remain distinct from modeled estimates and target values. Any synthetic or benchmark-derived fallback must retain degraded/estimate provenance and must not be labeled audited actual. Historical backtest accuracy must remain separate from forward prediction confidence. Moat and thesis statements must preserve evidence/confidence caveats when company-specific filings, segment data, retention or market-share data are unavailable. The final report conclusion must assess the stock itself and must not be replaced by a system-data disclosure.

## Operational requirements

Production-grade persistence requires `DATABASE_URL`. Shared L2 caching requires the configured Redis connection. Provider-grade reported financials require an enabled filings/data connector; without it, the fallback and confidence disclosures remain mandatory. The report route requires an authenticated session and returns a PDF attachment only after the canonical payload has been assembled successfully.
