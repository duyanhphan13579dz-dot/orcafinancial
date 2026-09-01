# Phase 1 + Phase 2 — Forensic Audit & Data Model Remediation

Date: 2026-09-01  
Depends on: Phase 0 emergency containment (synthetic disabled on production paths)

## Phase 1 — Forensic Audit

### Endpoint

```
GET /api/internal/financial-audit/[symbol]
Authorization: Bearer $FINANCIAL_AUDIT_SECRET
```

Recommended first symbol: **HPG**

### Pipeline layers traced

1. `source_document` — `financial_source_documents` (raw, immutable)
2. `normalized_fact` — `financial_normalized_facts` (verified preferred)
3. `financial_statements_db` — legacy table (flags synthetic)
4. `canonical_api` — what public path would serve under Phase 0 policy

### Outputs

- Metric traces across layers (revenue, netIncome, totalAssets, …)
- First mismatch detection
- Accounting identity validation
- Golden dataset comparison (structure; fill expected values from official filings)

### Library

- `src/lib/financial-forensic-audit.ts`
- `src/lib/golden-dataset.ts`

## Phase 2 — Data Model Remediation

### New / extended fields

| Table | Columns |
|-------|---------|
| `financial_normalized_facts` | `is_synthetic`, `source_priority`, `canonical_unit`, `data_version` |
| `financial_statements` | `is_synthetic`, `source_priority`, `report_scope`, `verification_status` |

DDL is applied idempotently via `ensureFinancialIngestionTables()`.

### Source priority

```
OFFICIAL_FILING       100
PROFESSIONAL_DATA      90
VERIFIED_PROVIDER      80
UNVERIFIED_PROVIDER    40
SYNTHETIC               0
```

`pickPreferredRecord()` never lets synthetic win when a non-synthetic candidate exists.

### Canonical unit

- Prefer absolute **VND** in DB (`canonical_unit`)
- `toCanonicalVnd(raw, unit)` for conversion with explicit multiplier
- Frontend formats only — does not invent business unit conversion

### Validation engine

- Gross profit identity
- Balance sheet identity (Assets ≈ Liabilities + Equity)
- Soft FCF identity
- Sign anomalies

## Operator steps

1. Deploy; confirm secrets `FINANCIAL_AUDIT_SECRET` / `CRON_SECRET`
2. `GET /api/internal/financial-audit/HPG`
3. Read `firstMismatch` + `summary.recommendation`
4. Fill `GOLDEN_METRICS` expected values from official HPG filings
5. Run cleanup job for remaining `sector-synthetic-*` rows
6. Re-ingest golden symbols with verified providers

## Tests

```
pnpm vitest run tests/financial-phase12.test.ts
```
