# The simulated warehouse

A Postgres instance that stands in for the organisation's live data warehouse.
It holds a **continuously simulated business** — orders arriving, cancellations
happening, support conversations opening and closing — shaped like the real
thing, so every product on the VPS can be demonstrated running on live data
without touching the organisation's actual systems.

Design and phasing: [`../docs/live-data-simulation.md`](../docs/live-data-simulation.md).
This directory holds the database, the schema, the seeder, the live ticker and
the scenario console. The application side lives in the backend:
`app/services/warehouse.py`, `app/services/pg_warehouse.py`,
`app/services/live_pipeline.py`, and the parity gate
`backend/scripts/warehouse_parity.py`.

Clarity still defaults to its SQLite snapshot. To point it here:

```bash
cd warehouse && docker compose up -d
cd .. && docker compose -f docker-compose.yml -f docker-compose.warehouse.yml up -d
```

The framing that drives every decision here: **this is not part of the app.**
It is a separate service, on a network boundary, with tables named after the
organisation's real BigQuery tables, and the products get read-only
credentials. If the app can tell the difference between this and production,
the exercise has failed.

---

## Layout

```
warehouse/
├── docker-compose.yml     postgres + ticker + scenario control + the CLI
├── sql/                   applied once, in filename order, on first boot
│   ├── 000_roles.sh         reader roles (a shell script: passwords come from env)
│   ├── 010_schemas.sql      warehouse / compat / sim / app
│   ├── 020_functions.sql    the BigQuery shims, again — see below
│   ├── 030_tables.sql       real Postgres types this time
│   ├── 040_indexes.sql
│   ├── 050_compat_views.sql the integration seam
│   ├── 060_sim_control.sql  cursor, scenarios, run log
│   └── 070_grants.sql       read-only means read-only
└── sim/                   the Python package
    ├── corpus.py            merchants, zones, transcripts (ported verbatim)
    ├── generate.py          the generators, window-parameterised, native types
    ├── seed.py              build a full history
    ├── load_sqlite.py       copy the legacy snapshot in, for parity testing
    ├── tick.py              the live ticker: arrivals, lifecycle, consequences
    ├── control.py           scenario-injection HTTP API
    ├── verify.py            prove the two datasets match
    └── writer.py            COPY-based bulk writes + simulator bookkeeping
```

## Four schemas

| Schema      | What it holds | Who can read it |
|-------------|---------------|-----------------|
| `warehouse` | The org-shaped tables, properly typed | products (SELECT) |
| `compat`    | Views re-rendering `warehouse` in the legacy SQLite shapes | products (SELECT) |
| `sim`       | Simulator control state | nobody but the simulator |
| `app`       | Product runtime writes that aren't warehouse data (the waitlist) | Clarity (read/write) |

### Why `compat` exists

The products currently read a SQLite file where timestamps are
`'YYYY-MM-DD HH:MM:SS'` TEXT, booleans are `0`/`1`, money is a float and arrays
are JSON strings. `warehouse` uses `timestamptz`, `boolean`, `numeric` and
`jsonb` — the right types. `compat` renders the former from the latter.

That means Clarity can switch from SQLite to Postgres **without rewriting a
single query or changing the JSON it puts on the wire**, because
`clarity_reader`'s `search_path` is `compat, warehouse, app, public` and an
unqualified `FROM messages` lands on the view.

The views are temporary. Each product migrates to native types on its own
schedule by dropping `compat` from its connection's `search_path`. And when the
real warehouse arrives, `compat` is where its column mapping goes — which is
why the seam is worth having even while the views are nearly pass-through.

### Why the BigQuery shims are back

`backend/app/services/local_db.py` registers six Python UDFs on every SQLite
connection (`regexp_contains`, `iso_week`, `week_start`, `day_name`,
`split_first`, `mode_value`) so the original BigQuery SQL could survive the
port to SQLite. `sql/020_functions.sql` defines the same six names in Postgres,
with `text` overloads because that is what `compat` exposes.

Same names, same semantics, same SQL text — which is most of the reason the
Phase 1 backend port is small.

---

## Running it

### On the VPS (and anywhere Docker is available)

```bash
cd warehouse
cp .env.example .env       # fill in three passwords
docker compose up -d       # database only; the simulator sits behind a profile
docker compose run --rm simulator seed --to today --per-day 2500
docker compose run --rm simulator status
```

Product stacks reach it by joining the network — no published port involved:

```yaml
# in the product's docker-compose.yml
services:
  backend:
    networks: [default, warehouse_net]
networks:
  warehouse_net:
    external: true
```

…and connecting to `postgresql://clarity_reader:…@warehouse:5432/warehouse`.

The published port stays bound to `127.0.0.1` in **both** deployments. On the
VPS that is still enough to reach `psql` over SSH, while keeping the database
off the public internet.

### On this machine, without Docker

Homebrew works just as well for development:

```bash
brew install postgresql@17
brew services start postgresql@17
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"

createdb warehouse
export CLARITY_READER_PASSWORD=dev POSTGRES_USER=$USER POSTGRES_DB=warehouse
for f in warehouse/sql/*.sh;  do bash "$f"; done
for f in warehouse/sql/*.sql; do psql -v ON_ERROR_STOP=1 -d warehouse -f "$f"; done
```

Then, from `warehouse/` with `psycopg` installed:

```bash
export POSTGRES_DSN="postgresql:///warehouse"
python -m sim load-sqlite
python -m sim verify
```

---

## The two ways to fill it

### `seed` — generate a history

```bash
python -m sim seed --to today --per-day 2500      # ends now: what Phase 2 wants
python -m sim seed --to 2026-07-28 --orders 60000 # the legacy dataset's shape
```

Ported from `backend/scripts/generate_mock_db.py`, with three deliberate
changes:

- **Native types.** Rows are dicts of real values, not 36-element tuples of
  strings — the original positional tuple was a column-insertion bug waiting to
  happen.
- **The window is a parameter.** The original hard-coded
  `2025-01-01 → FROZEN_TODAY`. Passing the window is what lets the history end
  at *today*, which is the entire point of the project.
- **Real timezone maths.** Orders are Qatar-local (as the source system records
  them); everything else is a true UTC instant derived from the order. The
  original approximated this with a literal `hour - 3`.

Volumes can be given as a total (`--orders`) or as a density (`--per-day`,
which scales support volume with it). Today's snapshot works out at ~105
orders/day, which is too thin to look alive; 2 000–3 000 is the target.

### `load-sqlite` — copy the existing snapshot in

```bash
python -m sim load-sqlite ../backend/data/clarity.db
python -m sim verify
```

This is the **reference dataset for the Phase 1 port**. The acceptance test for
switching Clarity's backend is "every endpoint returns identical JSON on SQLite
and on Postgres" — which requires identical data, and regenerating from a
rewritten generator would not give that. So the snapshot is copied across
verbatim instead, and `verify` proves it landed intact before anyone starts
diffing endpoints.

---

## Things worth knowing

**Re-applying schema changes.** `sql/` runs once, when the data directory is
empty. Changing it means `docker compose down -v && docker compose up -d`,
which drops everything. There are no migrations yet; a warehouse that is
regenerated on demand does not need them, and adding them before the schema
settles would be premature.

**Timezones.** Storage is UTC. Business logic is `Asia/Qatar` (UTC+3, no DST).
Orders keep their Qatar-local `order_placement_date`/`order_placement_time`
pair exactly as the source system records them, plus a derived `placed_at`
that is a real instant.

*Known follow-up:* `compat` renders timestamps in UTC, so hour-of-day views
read three hours early against generated data. The legacy snapshot hid this by
storing local time under a UTC label. The fix belongs in one place — `hour_of()`
and the frontend's time bucketing, converting to `Asia/Qatar` — and is Phase 2
work, not something to paper over by generating incorrect data.

**`mode_value` tie-breaking.** SQLite's Python UDF breaks ties by first-seen;
the Postgres aggregate breaks them by value. A group-by whose top value is
exactly tied can differ between the backends. It is the one known divergence,
and it is worth knowing about before it shows up as a mysterious endpoint diff.

**IDs come from sequences** (`sim.order_id_seq`, `sim.chat_id_seq`), not from
`max(id) + 1`. The live ticker and the seeder both mint ids, and `max(id) + 1`
both races and breaks after a retention prune.

**`sim_emitted_at`** is NULL on seeded history and set on rows the live ticker
writes, so a demo can always answer "which of this arrived just now?".

## Verifying a change to this directory

**Anything under `sql/` — run this first:**

```bash
./check_schema.sh          # applies sql/ to a throwaway database, as initdb does
```

The files are applied with ON_ERROR_STOP inside the container, so one bad
statement aborts that file and every file after it. That is not hypothetical:
a duplicated CREATE FUNCTION once left a cluster with shim functions and no
tables at all.



Anything that touches `sql/` or `sim/` should be checked against the backend,
not just against itself:

```bash
cd warehouse && python -m sim load-sqlite && python -m sim verify   # data matches
cd ../backend && DATABASE_URL=... python scripts/warehouse_parity.py  # app matches
```

The second one is the real gate: it runs every read endpoint against both
backends and diffs the JSON. A shim that is subtly wrong passes `verify` and
fails there.

## The live ticker

```bash
docker compose up -d                 # the ticker starts with the stack
docker compose logs -f ticker
```

Orders arrive on the hourly demand curve, advance through
accepted → preparing → ready → out for delivery → delivered/cancelled, and
generate the support contacts they cause. Safe to restart at any point: the
cursor in `sim.tick_cursor` means it resumes where it stopped and backfills the
gap, so the charts have no dent.

Rate and cadence are `SIM_ORDERS_PER_DAY` and `SIM_TICK_SECONDS`.
`SIM_RETENTION_DAYS` bounds how much history is kept.

## Scenarios — the demo console

```bash
# from the command line
docker compose run --rm simulator scenario merchant_outage \
    --target "Turkey Central" --minutes 45 --magnitude 4
docker compose run --rm simulator scenario --clear

# or over HTTP (loopback only, no auth — never publish this port)
curl -X POST localhost:8090/scenarios -H 'Content-Type: application/json' \
     -d '{"kind":"zone_courier_shortage","target":"Al Khor","duration_min":30}'
curl localhost:8090/status
curl -X DELETE localhost:8090/scenarios      # the "reset the demo" button
```

Four kinds: `merchant_outage`, `zone_courier_shortage`, `sentiment_storm`,
`volume_spike`. A minute or two after injecting one, the negative-trend card,
the zone heatmap and the cancellation risk queue all react — without anyone
touching the app.

This lives with the simulator on purpose. A product that knows when the
interesting data is coming is being staged, not demonstrated; Clarity only ever
sees orders and complaints arriving from a warehouse.

## Careful: the ticker and the parity gate

The backend parity gate compares the two warehouses row for row, so a ticker
writing new orders mid-comparison shows up as off-by-one diffs that look like
porting bugs. Stop it, reload, then compare:

```bash
docker compose stop ticker
docker compose run --rm simulator load-sqlite
cd ../backend && python scripts/warehouse_parity.py
docker compose start ticker
```
