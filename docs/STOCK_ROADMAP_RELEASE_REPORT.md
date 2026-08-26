# Stock Intelligence Roadmap — Release Report

## Release scope

This release implements the remaining Stock Intelligence foundation in sequential milestones. The implementation is deliberately conservative when source data is not verified: synthetic financial statements remain `estimate/degraded`, forecast outputs remain estimates, and AI forecast is gated by historical signal availability.

## Delivered milestones

| Commit | Milestone | Delivered |
|---|---|---|
| `aa8f091` | Audit baseline | Roadmap/module audit and dependency order. |
| `cefe8fd` | Data foundation | Canonical periods for Q/H/9M/FY, provenance currency/unit, optional actual-source adapter and synthetic fallback disclosure. |
| `8573b4d` | Forecast/scenario | Deterministic revenue/EBITDA/net-income/EPS forecast, bull/base/bear cases, probability-weighted expected value. |
| `35c228f` | Risk/trade plan | Volatility, market, liquidity, financial, valuation and event risk breakdown; support/resistance-based trade plan with invalidation and risk/reward. |
| `6ddbdba` | News intelligence | Category, impact, sentiment trend, duplicate-event clustering and optional price-reaction fields. |
| `77c9c40` | Backtest | Moving-average signal history, accuracy, win rate, average return, drawdown, Sharpe and profit factor. |
| `e197f45` | Guarded AI forecast | Multi-horizon probability output gated by forecast and backtest history; historical accuracy separated from prediction confidence. |
| `dca675b` | Personalization/report contract | Risk profile/horizon personalization, watchlist insights alerts and canonical research-report payload contract. |

## New API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/stocks/[symbol]/forecast` | Forecast and bull/base/bear scenarios. |
| `GET /api/v1/stocks/[symbol]/risk` | Risk assessment and trade plan. |
| `GET /api/v1/stocks/[symbol]/news-intelligence` | News events, categories, impact and sentiment trend. |
| `GET /api/v1/stocks/[symbol]/backtest` | Historical signal backtest. |
| `GET /api/v1/stocks/[symbol]/ai-forecast` | Guarded multi-horizon AI-style forecast with accuracy disclosure. |
| `GET /api/v1/watchlist/insights` | Personalized watchlist alerts by risk profile and horizon. |

## Verification

`tsc --noEmit` passed. Full ESLint passed with zero errors and one pre-existing non-Hooks warning in `src/components/settings/SecurityPanel.tsx` for `<img>`. Direct `next build` passed and emitted all new routes. The repository's `pnpm run build` wrapper could not complete because the environment's dependency policy blocked ignored package build scripts; the application-level Next build itself passed. Drizzle schema push could not run because `DATABASE_URL` is not available in the sandbox.

## Known limitations

The repository still does not have a configured Vietstock/FMP/filing credential. Vietstock documents an API/sync DataFeed covering Vietnamese balance sheets, income statements, cash flows, disclosure/audit dates, company data and news, but no connector is enabled in this project. FMP documents API-key-protected standardized statements, but `FMP_API_KEY` is not configured. Therefore the runtime fallback remains synthetic and must not be represented as audited actual data.

Backtest currently evaluates a moving-average signal on available historical bars; it is not yet a production-grade event-driven simulator with fees, slippage, survivorship controls, corporate actions, walk-forward splits or persisted signal database. The AI forecast is a guarded quantitative layer rather than an external LLM call because the repository has no server-side LLM helper configured for this project. These limitations are disclosed in the API responses.

## Working tree hygiene

The release commits intentionally exclude unrelated working-tree changes in `src/lib/commodities/fx.ts`, `src/lib/commodities/time.ts`, and `pnpm-workspace.yaml`.


## Final closeout — 26 August 2026

The Stock Intelligence roadmap is now closed through items 1–21. The final integration includes the canonical report payload, Vietnamese PDF research report, polygon-based stock heatmap, persistence for portfolio/preferences/alerts/thesis/decision/report history, and the completed cross-module, moat and investment-thesis layers.

The analysis report now follows a professional Vietnamese structure: enterprise identity and introduction; input–process–output value chain; historical quarterly/yearly business results; financial health including revenue, profit, margins, cash flow, ROA, ROE, ROS, EBITDA and debt/equity where available; current P/E and P/B; forecast scenarios and valuation; technical snapshot chart; macro/industry/economic-cycle context; and a final stock assessment. The cover branding is `ORCA FINANCIAL` / `INTELLIGENT INVESTMENT`.

The PDF route is cache-versioned at `analysis-report-pdf-v5` so layout and translation changes cannot be masked by stale Redis entries. The final local VNM smoke test produced a valid seven-page A4 PDF. Page-level text counts were 551, 2954, 2159, 1998, 3741, 1359 and 1236 characters; no blank page was generated and the targeted English-fragment scan was empty. Dynamic row values now pass through the same Vietnamese normalization layer as paragraphs and bullets.

Product Polish is complete for the current roadmap scope. The stock header retains responsive action wrapping and provides watchlist, report download and `Chia sẻ`; Web Share is used when available and clipboard fallback is used otherwise. The existing mobile header and bottom navigation remain in place.

## Production requirements and limitations

A production deployment must provide `DATABASE_URL` for Drizzle/PostgreSQL persistence and should provide Redis credentials for shared L2 caching. A provider-grade filings/data connector such as Vietstock/FMP or an equivalent source is still required if the deployment must present audited reported financial statements; otherwise the application must retain its source, confidence and degraded/synthetic disclosure. The built-in backtest remains a transparent moving-average evaluation rather than a live execution simulator.


## Review-driven report quality revision — 27 August 2026

Following the VNM report quality review, the report pipeline was strengthened in the areas that directly affect decision reliability. The company-profile narrative now uses the correct billion-VND unit. Financial periods in the PDF are marked as estimates when the upstream source is synthetic/degraded. Valuation output is gated by `valuationConfidence`, so a low-confidence report states that fair value is insufficient for conclusion instead of presenting a strong target-price claim.

The forecast engine now normalizes scenario probabilities, records each scenario's weighted contribution, exposes valuation confidence and publishes an assumption bridge covering revenue growth, margin, EPS/multiple and cash-flow caveats. The PDF also exposes health-score weighting/methodology and a DuPont decomposition from available indicators. Moat factors no longer default unknown dimensions to 50/100; they carry `score`, `coverage` and confidence, and the report renders unknown dimensions as `Chưa xác định`. Causal-chain and investment-thesis narratives are cleaned and localized before rendering.

The reviewed VNM sample generated as a valid eight-page A4 PDF with no empty page and an empty targeted-English scan. The report now explicitly distinguishes model estimates from audited actuals and separates a technical `Nắm giữ` state from any low-confidence valuation conclusion.
