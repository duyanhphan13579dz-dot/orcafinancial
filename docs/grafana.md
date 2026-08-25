# Grafana + Prometheus — ORCA Forex Engine

## Quick start (Docker)

```bash
# App + DB
docker compose up -d --build

# Monitoring
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

| Service    | URL |
|------------|-----|
| App        | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Grafana    | http://localhost:3001 (admin / orca) |
| Metrics    | http://localhost:3000/api/metrics |
| Forex metrics | http://localhost:3000/api/v1/forex/metrics |

Dashboard **ORCA Forex Engine** is auto-provisioned under folder `ORCA Financial`.

## Metrics catalog

| Metric | Type | Description |
|--------|------|-------------|
| `orca_forex_up` | gauge | 1 if engine not down |
| `orca_forex_status{component}` | gauge | 2 healthy / 1 degraded / 0 down / -1 unknown |
| `orca_forex_provider_success_total{provider}` | counter | Successes |
| `orca_forex_provider_error_total{provider}` | counter | Errors |
| `orca_forex_provider_success_rate{provider}` | gauge | 0–100 % |
| `orca_forex_provider_latency_avg_ms{provider}` | gauge | Avg latency |
| `orca_forex_provider_latency_last_ms{provider}` | gauge | Last latency |
| `orca_forex_cache_hit_rate{cache}` | gauge | Cache hit % |
| `orca_forex_analysis_latency_avg_ms` | gauge | Analysis avg ms |
| `orca_forex_ohlcv_freshness_avg_ms` | gauge | Candle age sample |
| `orca_db_status` | gauge | DB health |
| `orca_db_latency_last_ms` | gauge | DB ping latency |

## Scrape production (Vercel)

In-process counters reset on cold starts. Prefer self-hosted `web` for continuous series, or scrape periodically:

```yaml
# monitoring/prometheus/prometheus.yml — add:
  - job_name: orca-prod
    metrics_path: /api/metrics
    scheme: https
    static_configs:
      - targets: ["your-app.vercel.app"]
```

Redeploy Prometheus after editing the config:

```bash
docker compose -f docker-compose.monitoring.yml exec prometheus \
  wget -qO- --post-data='' http://127.0.0.1:9090/-/reload
```

## Security

- Change `GRAFANA_ADMIN_PASSWORD` in `.env`
- Do not expose Prometheus/Grafana publicly without auth
- Metrics endpoints are unauthenticated by design (standard Prometheus); put them behind a private network or basic auth at the reverse proxy if needed.
