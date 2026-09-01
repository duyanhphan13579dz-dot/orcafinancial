# Phase 3 + Phase 4 — Verified Pipeline & Release Controls

Date: 2026-09-01  
Depends on: Phase 0 containment, Phase 1 forensic audit, Phase 2 canonical model

## Phase 3 — Verified Pipeline

Target flow (Master Plan §IV–V):

```
Official filing / Vietstock / TCBS
  → Raw immutable (financial_source_documents)
  → Normalize (canonical VND, reportScope, sourcePriority)
  → Validation (accounting / period / unit / provenance)
  → Verified facts (financial_normalized_facts, is_synthetic=false)
  → Public API (verified only)
  → UI
```

### Modules

| Module | Role |
|--------|------|
| `src/lib/financial-provenance.ts` | Provenance model + completeness gate |
| `src/lib/financial-validation-engine.ts` | Accounting, period, unit, source checks |
| `src/lib/financial-verified-pipeline.ts` | Orchestrator: ingest → validate → quarantine |
| `src/lib/financial-ingestion.ts` | Provider adapters (Phase 0/2 metadata writes) |

### Endpoint

```
GET|POST /api/internal/financial-verified-pipeline
  ?symbols=HPG,VNM,FPT,VCB
  &limit=8
  &skipIngest=1
  &quarantine=1
Authorization: Bearer $FINANCIAL_AUDIT_SECRET
```

- Default symbols: golden set (`HPG`, `VNM`, `FPT`, `VCB`)
- `quarantine=1` marks synthetic normalized rows as rejected
- `skipIngest=1` validates existing DB only

## Phase 4 — Testing & Release Controls

### Modules

| Module | Role |
|--------|------|
| `src/lib/golden-dataset.ts` | Seeds + `compareGoldenMetric` / regression summary |
| `src/lib/financial-release-gate.ts` | Go-live checklist (§XIV) |
| `tests/financial-phase34.test.ts` | Unit/regression tests |

### Endpoint

```
GET /api/internal/financial-release-gate?symbol=HPG
Authorization: Bearer $FINANCIAL_AUDIT_SECRET
```

`skipDb=1` runs static checks only (CI without DB).

### Go-live checklist (automated)

1. `ALLOW_SYNTHETIC_FINANCIALS` off
2. Source priority model intact
3. Accounting / period / unit validators pass smoke tests
4. Synthetic detector works
5. Golden dataset defined (fill `expectedValue` from filings)
6. DB: no active synthetic facts/statements (warning until cleaned)
7. DB: has verified accepted facts (warning until ingested)

### Operator sequence

1. Deploy Phase 3+4 code
2. Ensure secrets: `FINANCIAL_AUDIT_SECRET` or `CRON_SECRET`
3. Configure provider env: `VIETSTOCK_DATAFEED_URL`, `TCBS_API_KEY`, …
4. `POST /api/internal/financial-verified-pipeline?symbols=HPG&quarantine=1`
5. `GET /api/internal/financial-audit/HPG`
6. Fill `GOLDEN_METRICS[].expectedValue` from official BCTC
7. `GET /api/internal/financial-release-gate?symbol=HPG`
8. `pnpm test` (includes `tests/financial-phase34.test.ts`)
9. Only when gate `ok: true` and golden filled — market as Verified

### Public policy (unchanged from Phase 0)

- Public `/api/v1/stocks/[symbol]/financials` never returns synthetic
- Empty verified set → empty table + explicit warning, not fabricated BCTC
