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


## Final closeout addendum — 26 August 2026

Các hạng mục roadmap 1–21 đã được triển khai và tích hợp vào trải nghiệm Stock Intelligence. Những phần đã hoàn tất gồm canonical data contract, financial period engine, phân tách actual/estimate/target, validation và freshness metadata, ORCA Score, risk/forecast/news/cross-module engines, moat và investment thesis, backtest và guarded forecast, persistence cho portfolio/preferences/alerts/thesis/decision/report history, shared caching, polygon treemap heatmap, canonical research-report payload và PDF phân tích chuyên nghiệp.

Product Polish trong phạm vi hiện tại cũng đã được chốt: mobile shell/navigation đã có; stock detail có watchlist, tải `BÁO CÁO PHÂN TÍCH` và nút `Chia sẻ`. Nút chia sẻ dùng Web Share API trên thiết bị hỗ trợ và sao chép URL trên trình duyệt không hỗ trợ.

Bản PDF VNM cuối được sinh thành công với bảy trang A4, font nhúng/fallback an toàn, không có trang trắng cuối, section 8 tận dụng khoảng trống trước đây ở trang 5, có technical snapshot chart, cover `INTELLIGENT INVESTMENT`, nội dung tiếng Việt ở cả static labels và dynamic narratives, và dòng kết luận là nhận định cổ phiếu. Kiểm tra text không còn các cụm tiếng Anh mục tiêu như `STOCK INTELLIGENCE`, `Cross-module`, `Investment thesis`, `Financial score`, `Expected value`, `Market regime`, `stop loss`, `current price`, `competitive advantage` và `DATA SYNCING`.

Giới hạn còn lại là giới hạn vận hành/dữ liệu: môi trường production cần `DATABASE_URL`; provider filings/Vietstock/FMP chưa được cấu hình nên fallback synthetic/benchmark phải tiếp tục hiển thị provenance và confidence, không được gọi là audited actual; Redis chỉ hoạt động đầy đủ khi có credentials. Backtest hiện là moving-average evaluation có disclosure, chưa phải execution simulator có phí, slippage, survivorship/corporate-action controls và walk-forward validation.


## Report-quality review addendum — 27 August 2026

The latest VNM quality review has been converted into implementation changes rather than remaining as recommendations. The report now applies unit-consistent market-cap wording, per-period estimate labeling, valuation-confidence gating, normalized scenario arithmetic with displayed weighted contributions, forecast assumption bridge, health-score methodology, DuPont decomposition, evidence coverage for moat dimensions, cleaned causal chains and localized investment-thesis points. The technical state `Nắm giữ` is now presented separately from a low-confidence valuation conclusion.

The final sample PDF generated after this revision is a valid eight-page A4 document. The confidence-gated executive summary states that valuation is not sufficiently reliable for a conclusion at the observed 45% data confidence; it does not promote the 38.77/other model fair value into a definitive target. The text scan found no targeted raw English fragments, and all extracted pages contain substantive content.


## Financial health scoring audit addendum — 27 August 2026

The Basic module formula audit identified and corrected a material architecture issue: it had a legacy price-return proxy scorer separate from the statement-based health engine. `generateFundamentalReport` now uses the canonical quarterly financial sequence and `evaluateHealthDetail` for its six health groups.

The audit also corrected missing-data behavior, removed the duplicate OCF/net-income contribution in the cash-flow group, added ROIC and working-capital intensity, and implemented the standard DuPont identity. The documented group weights remain 10% liquidity, 20% leverage, 15% efficiency, 25% profitability, 15% growth and 15% cash flow, totaling 100%. Automated tests cover weight reconstruction, DuPont arithmetic and available-indicator scoring.


## Reporting-period integrity correction — 27 August 2026

A period-integrity review found that the synthetic quarterly generator used the in-progress calendar quarter as if it were already reportable. On 27/08/2026 this incorrectly produced Q3/2026, although Vinamilk's official investor-relations calendar lists 30/07/2026 for Q2/2026 and 30/10/2026 for Q3/2026.

The correction anchors fallback quarterly statements to the last completed quarter, filters future-dated actual records in the canonical source loader, and filters persisted future rows in `ensureQuarterlyFinancials`. Q3/2026 may only appear as an explicitly labeled estimate/forecast after a forecast path is requested; it cannot appear as actual reported data before its reporting period is valid. Source verification is recorded in `docs/vnm_reporting_period_source_check_2026-08-27.md`.


## Post-cutoff UI and integration verification — 27 August 2026

The stock integration suite was rerun after the reporting-period cutoff change: 6 test files passed with 20 tests passed. TypeScript, ESLint and whitespace checks also passed; the only ESLint finding remains the pre-existing `next/image` warning in `SecurityPanel.tsx`.

The local stock detail route was checked through the browser and correctly enforced authentication. Because the local browser session was unauthenticated, visual data-panel smoke testing could not be completed against a logged-in VNM page; the limitation is recorded in `docs/vnm_ui_period_audit_2026-08-27.md`. Static data-flow review confirms that stock detail uses `ensureQuarterlyFinancials`, which now excludes future persisted rows and generates only the last completed quarter. The repository search found no code path that labels Q3/2026 as actual; remaining Q3/2026 references are historical documentation or source-format examples.
