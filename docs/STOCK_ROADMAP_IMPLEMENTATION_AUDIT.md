# Stock Intelligence Roadmap — Implementation Audit

## Audit date

2026-08-26.

## Current baseline

Repository `orcafinancial` đã có nền tảng Stock Intelligence ban đầu gồm quote, technical analysis, financial analysis, financial health, valuation-related endpoints, company profile, news/sentiment, watchlist, reports và một số lớp cache/provider. Canonical model, period metadata, validation, ORCA decision engine và Executive Summary đã được thêm trong các commit trước.

## Implemented before this continuation

| Roadmap area | Current state | Limitation |
|---|---|---|
| Canonical data model | Implemented in `src/lib/stock-intelligence/canonical.ts` | Period parser hiện chủ yếu nhận nhãn Q1–Q4; YTD/TTM vẫn là nhãn quy ước, chưa được tính từ bộ báo cáo gốc đầy đủ. |
| Validation | Implemented in `validation.ts` | Có kiểm tra missing, duplicate, impossible values, balance mismatch và provider conflict; chưa có validator toàn diện cho currency, EPS/revenue reconciliation, timestamps và duplicate news events. |
| ORCA decision engine | Implemented in `decision-engine.ts` | Market context còn placeholder; risk score đang suy ra đơn giản từ volatility; chưa có history/model version persistence. |
| Executive Summary | API/UI implemented | Đã phân biệt data confidence với prediction confidence; financial data hiện vẫn có thể là estimate/degraded khi thiếu filing gốc. |
| Financial metadata | Implemented in financial and health routes | Cần tiếp tục chuẩn hóa dữ liệu actual từ provider/filing và kiểm tra các kỳ không tương đồng. |
| Reports | Existing report/PDF pipeline exists | Chưa lấy toàn bộ nội dung từ canonical Stock Intelligence; cần refactor report contract để website/PDF dùng cùng payload. |
| Watchlist | Existing authenticated/session watchlist exists | Chưa có alert engine cho price, technical, pattern, volume, fundamental, news và valuation. |

## Missing roadmap areas

1. Financial source adapter và ingestion cho actual statements, kèm provenance/currency/period normalization.
2. Central stock data engine: provider fallback, health, stale-data protection, background refresh và cache persistence.
3. Forecast engine cho revenue, profit, margin và EPS.
4. Bull/base/bear scenario engine và probability-weighted fair value.
5. Risk engine, trade plan và invalidation logic.
6. News intelligence: event classification, impact, categories, sentiment trend, price reaction và duplicate-event clustering.
7. Cross-module/casual intelligence: macro, FX, commodities, industry và market regime → stock.
8. Moat, growth drivers, competitive position và investment thesis.
9. Signal database, backtest, prediction-vs-actual tracking, model versioning và regime analysis.
10. AI forecast chỉ sau khi có signal history/backtest; phải có insufficient-data guardrail và historical accuracy disclosure.
11. Canonical research report/PDF hoàn chỉnh.
12. Watchlist alerts, portfolio, risk profile, horizon personalization, saved reports, comparison và product polish.

## Data-source finding

Repository hiện không cho thấy adapter financial statements gốc đã được cấu hình rõ ràng như SEC/EDGAR, FMP, Capital IQ, FactSet, Daloopa hoặc một connector filings tương đương. Financial statement fallback hiện có dấu hiệu dựa vào `synthetic-sector-model`; vì vậy không được gắn nhãn actual cho dữ liệu đó. Giai đoạn data foundation phải giữ nguyên disclosure `estimate/degraded` cho đến khi có nguồn actual kiểm chứng được.

## Execution order

Triển khai theo dependency: (1) actual financial ingestion/period correctness; (2) data engine và freshness; (3) forecast/scenario/valuation; (4) risk/trade plan; (5) news/cross-module/thesis; (6) signal history/backtest; (7) AI forecast; (8) canonical report; (9) watchlist/portfolio/personalization; (10) integration/performance/security validation.

## Release discipline

Mỗi phase phải có typecheck, ESLint, targeted tests hoặc deterministic sanity checks, `git diff --check`, một commit riêng và push lên `main`. Thay đổi ngoài phạm vi đang tồn tại trong working tree phải không được stage: `src/lib/commodities/fx.ts`, `src/lib/commodities/time.ts` và `pnpm-workspace.yaml`.
