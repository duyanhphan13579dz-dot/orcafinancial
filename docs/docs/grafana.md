# Grafana (removed)

Grafana/Prometheus dashboard packaging was removed to keep the stack lean.

Prometheus text metrics still exist if needed later:

- `GET /api/metrics`
- `GET /api/v1/forex/metrics`

Restore monitoring from git history (`docker-compose.monitoring.yml`, `monitoring/`) when required.
