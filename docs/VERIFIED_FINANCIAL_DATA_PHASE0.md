# Phase 0 — Emergency Containment: Verified Financial Data

Date: 2026-09-01  
Policy: *Thiếu dữ liệu tốt hơn dữ liệu giả* / Missing data is better than fabricated data.

## What changed

1. **`generateQuarterlyFinancials`** (`src/lib/financial-statements.ts`)
   - Throws unless `ALLOW_SYNTHETIC_FINANCIALS=true` (or `NODE_ENV=test`).
   - Production must never synthesize income / balance / cashflow from price + benchmarks.

2. **`ensureQuarterlyFinancials`** (`src/lib/company-service.ts`)
   - Reads DB only.
   - Filters out any `sector-synthetic-*` rows.
   - Never calls the synthesis engine.
   - Never persists synthetic rows (`persistQuarterlyFinancials` is a no-op guard).

3. **Public API** `GET /api/v1/stocks/[symbol]/financials`
   - Uses preferred / verified normalized facts only (or FMP actual if configured).
   - Does **not** attach `SyntheticFinancialAdapter` as fallback.
   - When no verified data: returns empty statements, `status: "unavailable"`, clear disclosure.
   - Blocks estimate-only / synthetic payloads from being served as financial reports.

4. **`financial-ingestion` preferred loaders**
   - Removed synthetic fallback when normalized facts are insufficient.

5. **`SyntheticFinancialAdapter`**
   - Returns `[]` unless `ALLOW_SYNTHETIC_FINANCIALS` is enabled.

6. **UI** (`financial-statements.tsx`)
   - Disclaimer updated: only verified numbers; empty table when unverified.

7. **Fundamental report**
   - Does not require synthetic quarters; falls back to price-proxy health only, with null EPS/ratios proxies when no statements.

## Operator checklist

- [ ] Confirm `ALLOW_SYNTHETIC_FINANCIALS` is unset/false in production.
- [ ] Run financial-data-cleanup job to quarantine/delete legacy `sector-synthetic-*` rows.
- [ ] Re-ingest priority tickers (HPG, VCB, FPT, VNM, SSI, VIC, MWG, GAS) via verified providers.
- [ ] Proceed to Phase 1 forensic audit (trace HPG source → raw → normalized → DB → API → UI).

## Next phases (from Master Plan)

- Phase 1: Forensic audit endpoint + golden dataset seeds  
- Phase 2: Canonical unit (absolute VND), source priority, `isSynthetic`, report scope  
- Phase 3: Full verified pipeline (raw immutable → normalize → validate → verified DB)  
- Phase 4: Regression gates before deploy  
