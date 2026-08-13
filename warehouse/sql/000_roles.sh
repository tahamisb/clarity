#!/bin/bash
# Roles. A shell script rather than .sql because passwords come from the
# environment and psql cannot interpolate env vars inside a plain .sql file.
#
# Runs first (name order) inside /docker-entrypoint-initdb.d, so every later
# script can GRANT to these roles.
set -euo pipefail

: "${CLARITY_READER_PASSWORD:?set CLARITY_READER_PASSWORD in warehouse/.env}"
NABD_READER_PASSWORD="${NABD_READER_PASSWORD:-$CLARITY_READER_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	-- Products connect as these. They get SELECT on the warehouse and nothing
	-- else; the simulator is the only writer. This is the whole point of the
	-- exercise: the app must be unable to tell this apart from a real
	-- read-only warehouse credential, and must be unable to corrupt the demo.
	CREATE ROLE clarity_reader LOGIN PASSWORD '${CLARITY_READER_PASSWORD}';
	CREATE ROLE nabd_reader    LOGIN PASSWORD '${NABD_READER_PASSWORD}';

	-- Group role: grant once here, inherit everywhere.
	CREATE ROLE warehouse_readers NOLOGIN;
	GRANT warehouse_readers TO clarity_reader, nabd_reader;
EOSQL
