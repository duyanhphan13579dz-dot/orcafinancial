#!/usr/bin/env bash
#
# migrate-to-supabase.sh — one-shot data migration helper from an existing
# PostgreSQL database (local, Docker, or any other host) into a Supabase
# project's Postgres database.
#
# This script does NOT run automatically as part of the build/deploy — it
# is a manual operator tool. Run it yourself once you have created a
# Supabase project and have its connection string (Project Settings →
# Database → Connection string → "URI", use the DIRECT connection, not the
# pooled one, for pg_dump/pg_restore).
#
# Usage:
#   export SOURCE_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/app_db"
#   export SUPABASE_DATABASE_URL="postgresql://postgres:YOUR-PASSWORD@db.xxxxxxxx.supabase.co:5432/postgres"
#   ./scripts/migrate-to-supabase.sh
#
# Prerequisites: `pg_dump` and `pg_restore` (or `psql`) matching your
# Postgres major version must be installed locally (`apt install postgresql-client`
# / `brew install libpq`).

set -euo pipefail

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  echo "ERROR: SOURCE_DATABASE_URL is not set." >&2
  echo "  export SOURCE_DATABASE_URL=postgresql://user:pass@host:5432/dbname" >&2
  exit 1
fi

if [[ -z "${SUPABASE_DATABASE_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DATABASE_URL is not set." >&2
  echo "  export SUPABASE_DATABASE_URL=postgresql://postgres:PASSWORD@db.xxxxxxxx.supabase.co:5432/postgres" >&2
  echo "  (Use the DIRECT connection string from Supabase, not the PgBouncer/pooled one.)" >&2
  exit 1
fi

DUMP_FILE="orca_dump_$(date +%Y%m%d_%H%M%S).dump"

echo "──────────────────────────────────────────────────────────────────"
echo " ORCA FINANCIAL → Supabase data migration"
echo "──────────────────────────────────────────────────────────────────"
echo " Source:  ${SOURCE_DATABASE_URL%%@*}@***"
echo " Target:  ${SUPABASE_DATABASE_URL%%@*}@***"
echo " Dump:    ${DUMP_FILE}"
echo "──────────────────────────────────────────────────────────────────"
read -r -p "Proceed? This will write data into the Supabase target DB. [y/N] " CONFIRM
if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo "[1/3] Dumping schema + data from source (custom format, compressed)..."
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --no-acl \
  --file="${DUMP_FILE}" \
  "${SOURCE_DATABASE_URL}"
echo "      Done → ${DUMP_FILE} ($(du -h "${DUMP_FILE}" | cut -f1))"

echo "[2/3] Restoring into Supabase (schema + data)..."
# --no-owner/--no-privileges: Supabase's `postgres` role doesn't own the
# objects your local role does; stripping ownership avoids GRANT/ALTER
# OWNER errors. --clean --if-exists makes the restore idempotent if you
# need to re-run it.
pg_restore \
  --no-owner \
  --no-privileges \
  --no-acl \
  --clean \
  --if-exists \
  --dbname="${SUPABASE_DATABASE_URL}" \
  "${DUMP_FILE}" || {
    echo "NOTE: pg_restore may report warnings for roles/extensions Supabase" >&2
    echo "      manages itself (e.g. 'role postgres already exists'). These" >&2
    echo "      are expected and safe to ignore as long as your application" >&2
    echo "      tables were restored — verify with the row-count check below." >&2
  }

echo "[3/3] Verifying row counts (source vs. target) for each table..."
TABLES=$(psql "${SOURCE_DATABASE_URL}" -Atc \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")

printf "%-28s %12s %12s\n" "TABLE" "SOURCE" "SUPABASE"
printf "%-28s %12s %12s\n" "----------------------------" "------------" "------------"
for t in ${TABLES}; do
  SRC_COUNT=$(psql "${SOURCE_DATABASE_URL}" -Atc "SELECT count(*) FROM \"${t}\";" 2>/dev/null || echo "ERR")
  DST_COUNT=$(psql "${SUPABASE_DATABASE_URL}" -Atc "SELECT count(*) FROM \"${t}\";" 2>/dev/null || echo "ERR")
  printf "%-28s %12s %12s\n" "${t}" "${SRC_COUNT}" "${DST_COUNT}"
done

echo
echo "Migration complete. Next steps:"
echo "  1. Update DATABASE_URL in .env to point at Supabase (see .env.example)."
echo "  2. Run: npx drizzle-kit push   (reconciles schema, safe no-op if already restored identically)"
echo "  3. Restart the app and check GET /api/health + /api/health/upstream."
echo "  4. Once verified, you may delete ${DUMP_FILE} or archive it as a backup."
