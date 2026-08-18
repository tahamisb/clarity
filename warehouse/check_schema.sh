#!/usr/bin/env bash
# Apply sql/ to a throwaway database, exactly as a fresh container does.
#
# Exists because a duplicated CREATE FUNCTION shipped once and nobody noticed:
# every statement had been applied by hand with CREATE OR REPLACE, so the files
# were never run top-to-bottom on an empty database. The container's initdb
# runs with ON_ERROR_STOP, so that one duplicate aborted 020_functions.sql and
# every file after it — the cluster came up with shim functions and no tables
# at all, and the ticker crash-looped against a schema that did not exist.
#
# Run before pushing anything under sql/.
set -euo pipefail

DB="schema_check_$$"
PSQL_BIN="$(command -v psql || echo /opt/homebrew/opt/postgresql@17/bin/psql)"
export PATH="$(dirname "$PSQL_BIN"):$PATH"

cleanup() { dropdb --if-exists "$DB" 2>/dev/null || true; }
trap cleanup EXIT

createdb "$DB"
# The reader roles are cluster-wide, so 000_roles.sh cannot be re-run against a
# scratch database. Stub them instead — this checks the SQL, not the roles.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='warehouse_readers') THEN
    CREATE ROLE warehouse_readers NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='clarity_reader') THEN
    CREATE ROLE clarity_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nabd_reader') THEN
    CREATE ROLE nabd_reader NOLOGIN;
  END IF;
END \$\$;"

for f in "$(dirname "$0")"/sql/*.sql; do
  printf '  %-28s' "$(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
  echo "ok"
done

tables=$(psql -tAd "$DB" -c "SELECT count(*) FROM pg_tables WHERE schemaname='warehouse';")
views=$(psql -tAd "$DB" -c "SELECT count(*) FROM pg_views WHERE schemaname='compat';")
echo "  → ${tables} warehouse tables, ${views} compat views"
[ "$tables" -ge 9 ] && [ "$views" -ge 9 ] || { echo "  FAILED: schema incomplete"; exit 1; }
echo "  schema applies cleanly from scratch"
