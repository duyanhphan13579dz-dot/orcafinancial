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
