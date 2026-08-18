# Live Data Simulation — design

**Written:** 2026-08-13. **Status:** all six phases are built and verified — see
[`../warehouse/`](../warehouse/) and §8–§13.

## The problem this solves

Every product on the VPS today reads a *frozen snapshot*. Clarity's warehouse is
a 35 MB SQLite file baked into the backend image, and the whole app pretends
"now" is `2026-07-28 21:45 UTC` (`backend/app/utils/clock.py`, mirrored in
`frontend/lib/frozen-clock.ts`) because the data stops there. As of today the
demo is 16 days stale and drifts one day further every day.

That frozen clock is load-bearing: WTD/MTD/QTD/YTD presets, the custom range
picker, SLA "still open" maths and the "live risk queue" all anchor to it. So
the demo can never show the one thing a buyer actually wants to see — *the
dashboard moving*.

We cannot connect to the organisation's real warehouse. So we build a stand-in:
a Postgres instance running a **continuous simulation of the business**, shaped
like the real warehouse, that every VPS project reads over a normal database
connection. When real data becomes available, the integration change is a
connection string and a schema mapping — not a rewrite.

Two things follow from that framing, and they drive every decision below:

1. **The simulator is not part of the app.** It is a separate service with its
   own credentials, behind a network boundary, writing tables named after the
   organisation's tables. Clarity gets a *read-only* role. The app must not be
   able to tell the difference between this and production.
2. **Fidelity of shape beats fidelity of content.** Nobody needs the invented
   orders to be real. They need arrival rates, daily/weekly seasonality,
   cancellation correlations and sentiment mixes to behave like the real thing,
   so the dashboards, thresholds and the cancellation model all exercise the
   code paths they will exercise on live data.

---

## 1. Where it runs — the one decision needed up front

The ask was "Postgres hosted locally on this machine". That works for
development, but the VPS (`76.13.188.48`, `interns26.cloud`) cannot reach a
laptop, and a demo warehouse that sleeps when the lid closes is worse than a
frozen snapshot.

**Recommendation: one compose definition, two deployments.**

```
docker-compose.warehouse.yml      warehouse (postgres:17) + simulator (python)

  ├─ this machine   →  localhost:5432   development, generator work, schema changes
  └─ VPS /opt/warehouse →  internal docker network only, never published
```

The compose file is identical in both places; only `.env` differs. Develop
against the local one, deploy the same thing next to the app stacks on the VPS.
Postgres publishes **no host port** on the VPS — it joins an external Docker
network (`warehouse_net`) that each project's stack attaches to, so it is
reachable at `warehouse:5432` from the app containers and from nowhere else.

If a single canonical local database is genuinely wanted, the alternative is a
Tailscale (or Cloudflare) tunnel from the VPS to this machine — one extra
moving part, and the demo breaks when the laptop sleeps. Not recommended for
anything a customer will see.

```
                      ┌──────────────── VPS ────────────────┐
  browser ──:443────► │ caddy ─┬─► clarity-frontend :3000    │
                      │        └─► clarity-backend  :8001 ──┐│
                      │            nabd-*             ────┐ ││
                      │                                   ▼ ▼│
                      │  warehouse_net ──► postgres :5432    │
                      │                       ▲              │
                      │                    simulator         │
                      └──────────────────────────────────────┘
```

---

## 2. The database

### 2.1 Schemas and roles

| Schema      | Contents                                                              | Who writes |
|-------------|-----------------------------------------------------------------------|------------|
| `warehouse` | The org-shaped tables the products read: `vendor_kpi`, `vendor_items_kpi`, `chat_history`, `messages`, `classifications`, `labels`, `call_analysis`, `cancellation_predictions`, `skipped_chats` | simulator only |
| `sim`       | Simulator control state: tick cursor, RNG seeds, active scenarios, content corpora, entity registry (merchants, zones, customers) | simulator only |
| `app`       | Per-product runtime writes that are *not* warehouse data — Clarity's `waitlist`, future user prefs | each product |

Three roles: `sim_writer` (owns everything), `clarity_reader` (SELECT on
`warehouse`, full rights on `app`), and one reader per additional project. The
read-only grant is the point — it makes "we are a consumer of a warehouse"
structurally true rather than a claim, and it makes a demo-day accident
impossible.

Keep the **table and column names exactly as they are today**. They were named
after the organisation's BigQuery tables, so the SQL in `backend/app/services/db_*.py`
is already written against the real vocabulary. Changing them now would mean
changing them back later.

### 2.2 Types — fix what SQLite forced

The current schema stores timestamps as `'YYYY-MM-DD HH:MM:SS'` TEXT, money as
REAL, booleans as INTEGER, and arrays as comma-joined strings. Postgres should
use the real types:

| Today (SQLite)                    | Postgres                          | Why |
|-----------------------------------|-----------------------------------|-----|
| `created_at TEXT`                 | `created_at timestamptz`          | correct ordering, interval maths, DST-free Qatar rendering |
| `total_order_value REAL`          | `numeric(10,2)`                   | QAR totals stop drifting on sums |
| `is_pro_user INTEGER`             | `boolean`                         | honest, and indexes better |
| `intents TEXT` (comma-joined)     | `text[]`                          | kills `split_agg()` and the regex matching around it |
| `messages TEXT` (JSON blob)       | `jsonb`                           | queryable transcript turns |
| `order_status TEXT`               | `text` + CHECK, or an enum        | the state machine has a fixed vocabulary |

Timestamps are stored **UTC**; the demand curve and all "business day" logic are
computed in `Asia/Qatar` (UTC+3, no DST). Getting this backwards puts the lunch
peak at 09:00 on the chart.

Indexes the current dashboards need: `vendor_kpi (order_placement_date)`,
`vendor_kpi (order_status, order_placement_date)`, `vendor_kpi (zone_name)`,
`vendor_kpi (restaurant_name)`, `messages (created_at)`, `classifications
(classified_at)`, `classifications (message_id)`, `call_analysis (analysed_at)`,
`cancellation_predictions (predicted_at, risk_level)`. Partition `vendor_kpi`
and `vendor_items_kpi` by month if volume goes past a few million rows —
retention pruning then becomes a `DROP PARTITION` instead of a mass delete.

### 2.3 Views as the integration seam

Products read `warehouse.v_orders`, `warehouse.v_messages`, … — thin views over
the physical tables, initially `SELECT *`. When the real warehouse arrives, the
views are where the column mapping and unit conversion live, and no application
SQL changes. This costs nothing to add now and is the difference between a
one-day integration and a two-week one.

---

## 3. The simulator

A single long-running Python service (`simulator/`), reusing the distributions,
merchant/zone reference data and content corpora already written in
`backend/scripts/generate_mock_db.py` — that file is 880 lines of carefully
tuned Qatar-specific realism and should be *ported*, not rewritten.

Three modes:

```
sim seed   --from 2025-01-01 --to now    build history so trends/YTD have data
sim run                                   the live ticker (the default process)
sim reset  --to <date>                    rebuild deterministically
```

### 3.1 The cycles

"Cyclical" operates at four nested levels, and each one is visible somewhere in
the product:

**Intra-day (seconds → hours).** The existing `pick_hour()` weights become an
arrival *rate*. Every tick (default 10 s) the simulator computes expected orders
for that interval from `base_daily_volume × hour_weight(local_hour) / 8640`,
draws a Poisson sample, and inserts that many orders stamped with the real
current timestamp. At 13:00 Doha the dashboard is busy; at 04:00 it is nearly
still. This is the thing that makes a refresh feel alive.

**Weekly.** `day_weight()` already encodes the Qatar Thu–Sat peak. Kept as-is.

**Seasonal / annual.** Ramadan dip, summer slump, the steady growth trend. On a
365-day cycle, so a demo in March next year still shows a Ramadan dip.

**Content.** A fixed corpus of Arabic/English transcripts, complaint texts,
cancellation reasons and feedback comments, recycled with slot substitution
(merchant, area, order ID, QAR amount). No LLM calls at ingest time, no runaway
cost, and the bilingual realism the product promises.

### 3.2 Order lifecycle, not row dumps

Orders are not inserted terminal. Each tick also advances a state machine over
open orders:

```
placed → vendor_accepted → preparing → dispatched → delivered
   │            │              │            │
   └────────────┴──────────────┴────────────┴──► cancelled (reason, actor)
```

Transition delays are sampled from the same distributions
`generate_mock_db.py` uses for `vendor_to_accept_order_min`, `preparing_time_min`
and `since_create_til_delivred_min`. Cancellation probability is conditioned on
the features the predictor already consumes (zone, merchant, hour, basket size,
distance, whether the vendor has been slow lately) — so the cancellation model
is scoring *genuinely predictive* live features rather than noise, and the risk
queue on `/cancellations` fills and drains on its own.

Chats, calls and support messages are spawned as *consequences* of order events
(late delivery → complaint message; cancellation → chat), at rates matching
today's contact-rate figures. That correlation is what makes cross-channel
views (`get_cross_channel`, the zone heatmap) tell a coherent story instead of
showing three independent random walks.

### 3.3 Restart, catch-up and retention

- **Cursor.** `sim.tick_cursor` records the last simulated instant. On boot the
  simulator backfills the gap at high speed (capped at 24 h; beyond that it
  fast-forwards and logs a hole) so a restarted container doesn't leave a
  visible dent in the charts.
- **Determinism.** RNG seeded per `(date, tick_index)`, so a replay of the same
  window produces the same rows. Re-runnable bug reports; reproducible demos.
- **Retention.** A nightly job keeps a rolling 18-month window: prune older
  than the horizon, refresh the materialised aggregates, `ANALYZE`. The database
  size stops growing and the dataset is never stale — it can run unattended for
  a year.

### 3.4 Scenario injection — the demo superpower

A `sim.scenarios` table plus a small admin API:

```
POST /sim/scenarios  { kind: "merchant_outage", target: "Turkey Central",
                       duration_min: 45, magnitude: 3.0 }
```

Kinds worth having: `merchant_outage` (accept times blow up, cancellations spike
for one merchant), `zone_courier_shortage` (one zone's delivery times and "no
driver available" cancels surge), `sentiment_storm` (negative-trigger rate
jumps on one channel), `volume_spike` (match-day / weather demand).

This is what turns a dashboard tour into a demonstration: trigger an outage in
West Bay, and two minutes later the negative-trend card, the zone heatmap and
the risk queue all light up on their own — exactly the "leader spots a rising
issue before it escalates" story in `PRODUCT.md`. Cheap to build, and it is the
part of this project a customer will remember.

### 3.5 Volume

Today: 60 000 orders over 574 days ≈ 105/day — too thin to look live. Target
**2 000–3 000 orders/day** (an order every ~20 s at peak, ~1.6 M rows over 18
months, roughly 2–3 GB with items). Postgres handles this comfortably with the
indexes above, and it is the difference between a counter that visibly moves and
one that doesn't.

---

## 4. Integrating Clarity

Ordered so that each phase is independently verifiable and none of them requires
a big-bang cutover.

### Phase 1 — Warehouse adapter (no behaviour change)

`backend/app/services/local_db.py` is already the right abstraction: 15 call
sites use `query()`, `query_one()`, `placeholders()`, `split_agg()` and the SQL
fragment builders `countif()`, `safe_divide()`, `hour_of()`, `hours_between()`.
Those builders exist because of the BigQuery→SQLite port, and they pay for
themselves now.

Rename to `warehouse.py`, keep the interface, add a Postgres backend selected by
`WAREHOUSE_BACKEND=postgres|sqlite` (default `sqlite`, so nothing breaks until
we flip it). Backend-specific pieces:

| Concern | SQLite (today) | Postgres |
|---|---|---|
| Connection | thread-local `sqlite3` | `psycopg` + `psycopg_pool` (FastAPI runs these on a threadpool — a pool is required, not optional) |
| Params | `?` positional (13 sites) | `%(name)s` |
| `countif(c)` | `SUM(CASE WHEN … )` | `COUNT(*) FILTER (WHERE c)` |
| `safe_divide` | `CAST(a AS REAL)/NULLIF(b,0)` | `a::numeric / NULLIF(b,0)` |
| `hour_of(c)` | `CAST(strftime('%H',c) AS INT)` | `EXTRACT(HOUR FROM c AT TIME ZONE 'Asia/Qatar')` |
| `hours_between(a,b)` | `(julianday(a)-julianday(b))*24` | `EXTRACT(EPOCH FROM (a-b))/3600.0` |
| `group_concat(DISTINCT x)` | as-is (4 sites) | `string_agg(DISTINCT x, ',')` — add an `agg_concat()` builder |
| `date(c)` / `datetime(c)` | as-is (19 sites) | add `day_of()` / `ts_of()` builders |

**Two tricks that shrink this a lot.**

*Named parameters.* Convert the 13 `?` sites to `:name`. SQLite accepts `:name`
natively; the Postgres adapter rewrites `:name → %(name)s` once, centrally. One
convention, both backends, no per-site branching.

*Recreate the BigQuery shims as real Postgres functions.* `local_db.py`
registers six Python UDFs (`regexp_contains`, `iso_week`, `week_start`,
`day_name`, `split_first`, `mode_value`) purely so the BigQuery SQL text could
survive the port. Define functions with the **same names** in Postgres —

```sql
CREATE FUNCTION regexp_contains(text, text) RETURNS boolean AS $$ SELECT $1 ~ $2 $$ LANGUAGE sql IMMUTABLE;
CREATE FUNCTION iso_week(date)  RETURNS text AS $$ SELECT to_char($1,'IYYY-"W"IW') $$ LANGUAGE sql IMMUTABLE;
CREATE FUNCTION week_start(timestamptz) RETURNS date AS $$ SELECT date_trunc('week',$1)::date $$ LANGUAGE sql IMMUTABLE;
CREATE FUNCTION day_name(date)  RETURNS text AS $$ SELECT to_char($1,'FMDay') $$ LANGUAGE sql IMMUTABLE;
CREATE FUNCTION split_first(text, text) RETURNS text AS $$ SELECT split_part($1,$2,1) $$ LANGUAGE sql IMMUTABLE;
-- mode_value: custom aggregate wrapping mode() WITHIN GROUP semantics
```

— and every query using them works unchanged on both backends. Only the
dialect-specific *fragments* above need per-backend implementations, and they
are already centralised in eight functions.

**The acceptance test for this phase, and it is the important one:** seed
Postgres with *the same* deterministic dataset the SQLite file holds, keep the
frozen clock on, then diff every API endpoint's JSON between the two backends.
Identical output means the port is correct and nothing downstream has to be
re-verified later. Do this before changing a single thing about time.

**One gotcha to plan for:** today timestamps reach the frontend as raw
`'YYYY-MM-DD HH:MM:SS'` strings. Postgres returns `datetime` objects that
serialise as ISO-8601 with an offset. Normalise in the adapter's row factory
first (preserving the existing wire format), then migrate the frontend to ISO as
a separate, visible change. Silently changing the wire format mid-port will
produce date bugs that look like simulator bugs.

### Phase 2 — Unfreeze the clock

`clock.py` and `frozen-clock.ts` keep their interfaces; `now()` starts returning
the real time and `SQL_NOW` becomes `now()`. Keep a `CLOCK_OVERRIDE` env var so
the SQLite snapshot demo still works for offline presentations. 13 backend call
sites, 5 frontend files.

Also in this phase: the hardcoded `get_contact_rate("2026-06-01","2026-06-30")`
in `main.py`'s cache warmer becomes relative to today, and the frozen-date
constants in `docs/README.md` get updated.

### Phase 3 — Live feel in the UI

A live warehouse behind a five-minute cache still looks frozen. `ttl_cache.py`
uses a flat `TTL_S = 300` for every query.

- Make the TTL a function of the window: **30 s** for anything touching today,
  300 s for closed historical periods. Cache keys already include the bound
  arguments, so a "today" range key naturally rolls over.
- Add `GET /api/v1/live/stream` (SSE) publishing new-row counts per table, or —
  simpler and adequate — 20 s polling on the summary endpoints.
- A **freshness indicator** in the topbar: "live · updated 8s ago", degrading to
  an explicit stale state if the simulator stops. It must go stale rather than
  quietly lie; a dead simulator that nobody notices is the likeliest demo
  failure.
- New rows animate into the message and call tables rather than appearing on a
  full reload (`prefers-reduced-motion` respected, per `PRODUCT.md`).

### Phase 4 — Run the AI pipeline live

The highest-value phase for the "we're ready for real data" argument.

Today the mock generator writes `classifications` pre-baked. Instead, have the
simulator write **only raw rows** (`chat_history`, `messages`, call transcripts)
and let a backend worker classify new arrivals on a schedule — the actual
production path: ingest → classify → serve. Sentiment on the dashboard then
appears a few seconds after the message does, produced by the real Gemini call
with the real prompt.

Guard it: a daily token budget, and automatic fallback to the deterministic
`text_classifier.py` when the key is absent or the budget is spent. At ~3 000
orders/day the contact rate implies a few hundred classifications/day on
`gemini-3.1-flash-lite` — small, but it must be bounded rather than trusted.

Same for `cancellation_predictions`: `predictor_service.py` scores open orders
on a schedule instead of reading pre-written rows, so the risk queue is genuinely
model output.

### Phase 5 — Second product, same warehouse

Nabd (and anything after it) gets its own read-only role against the same
`warehouse` schema. One simulated company, several products reading it — which
is both the cheapest architecture and the most convincing story: these tools
share a customer-intelligence backbone.

---

## 5. What this proves on demo day

- The dashboards move while you watch them, on real wall-clock time.
- Trigger a merchant outage and watch three independent views react without
  anyone touching the app.
- The AI classification and the cancellation model run against arriving data,
  not fixtures.
- Integrating the organisation's real warehouse means changing a connection
  string and remapping views — demonstrable, because the app already talks to
  Postgres over a network boundary with read-only credentials and has no idea
  the data is synthetic.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Silent simulator death — dashboards freeze mid-demo | `/health` exposes last-tick age and rows-in-last-hour; UI shows an explicit stale state; compose `restart: unless-stopped` + healthcheck |
| Port changes numbers subtly | Phase 1 diffs every endpoint against SQLite with identical data before any time change |
| Wire-format change breaks dates | Adapter preserves the existing timestamp string format; frontend migrates separately |
| Timezone errors put peaks in the wrong hour | Store UTC, compute all business logic in `Asia/Qatar`; assert the demand curve peaks at 13:00 and 20:00 local in a test |
| Cost creep from live Gemini calls | Daily budget cap + deterministic fallback classifier |
| Unbounded growth | 18-month rolling window, monthly partitions, nightly prune |
| Laptop-hosted DB unreachable from VPS | Deploy the same compose stack on the VPS; local instance is for development |

## 7. Rough sequencing

| Phase | Work | Independently shippable |
|---|---|---|
| 0 | ✅ **Done.** Postgres + schema + the generator ported to seed it | yes — nothing consumes it yet |
| 1 | ✅ **Done.** Warehouse adapter, dialect shims, endpoint-diff gate | yes — behaviour identical |
| 2 | ✅ **Done.** Unfreeze clock, rolling-window seed ending *now* | yes |
| 3 | ✅ **Done.** Live ticker + lifecycle + retention | yes — this is "live" |
| 4 | ✅ **Done.** Live UI: window-aware TTLs, freshness badge | yes |
| 5 | ✅ **Done.** Live classification + live scoring | yes |
| 6 | ✅ **Done.** Scenario injection; second-reader path ready | yes |

Phases 0–2 alone remove the frozen clock and the staleness problem. Phase 3 is
where it becomes a live-data demonstration.

---

## 8. Phase 0, as built

Lives in [`../warehouse/`](../warehouse/); that directory's README is the
operational guide. Measured on this machine (Postgres 17, Homebrew — Docker is
not installed here, so the compose stack is the VPS path and brew is the local
one):

| | |
|---|---|
| Schema | 4 schemas, 11 tables, 26 indexes, 7 SQL shims, 10 compat views, 2 read-only roles |
| Legacy snapshot load | 248 567 rows in **3.7 s** |
| Full seed, 574 days ending today at 2 500 orders/day | 5.9 M rows in **90 s**, **1.2 GB** |
| Live risk queue at 09:55 on a Thursday | 81 in-flight orders, 8 high-risk |
| Parity against the SQLite snapshot | **21/21 checks match** |

Verified beyond row counts: the app's real query text — `day_name`,
`split_first`, `week_start`, `mode_value`, `regexp_contains`, `strftime`
(`%w`, `%Y-%m`) — runs unchanged against the compat views as `clarity_reader`,
and a write attempt from that role is refused.

Two things were found and fixed while building, both worth recording because
they are the kind of thing that only shows up once real data exists:

- **The seed filled the whole final day.** A dataset that "ends today" was
  generating tonight's orders this morning, so the dashboard would open showing
  a completed day's volume for a day three hours old, and every "today so far"
  comparison would read wrong. The window now carries a cutoff instant: today
  arrives partial, and conversations whose close time has not come yet stay
  open. Today shows 514 orders against ~2 580 for full days, which is right for
  09:55.
- **In-flight orders were a flat fraction of daily volume** — 625 open orders
  at quarter to ten on a quiet morning, which looks obviously fake on the risk
  queue. Sized by Little's law instead (arrival rate at the current hour ×
  ~1 h in flight), it lands at 81, and it will swell to ~280 at the evening
  peak on its own.

Known limitations, carried into the next phases:

- `compat` renders timestamps in UTC, so hour-of-day views read three hours
  early against newly generated data. The legacy snapshot hid this by storing
  local time under a UTC label. The fix belongs in `hour_of()` and the
  frontend's bucketing, and is Phase 2 work — not something to paper over by
  generating incorrect data.
- `mode_value` breaks ties by value in Postgres and by first-seen in SQLite, so
  a group-by with an exactly tied top value can differ between backends. The
  one known divergence.
- `sql/` is applied once on an empty data directory. Schema changes mean
  `docker compose down -v`. No migrations yet — a warehouse that is regenerated
  on demand does not need them, and adding them before the schema settles would
  be premature.

---

## 9. Phase 1, as built

Clarity now reads either backend, chosen by one environment variable. The
default is unchanged, so the current deploy is unaffected:

```
WAREHOUSE_BACKEND=sqlite     data/clarity.db, the frozen snapshot (default)
WAREHOUSE_BACKEND=postgres   DATABASE_URL, the simulated live warehouse
```

Switching on the VPS is an overlay, not an edit:

```bash
cd warehouse && docker compose up -d
cd .. && docker compose -f docker-compose.yml -f docker-compose.warehouse.yml up -d
```

**The gate.** `backend/scripts/warehouse_parity.py` boots the app twice in one
process, once per backend, hits 46 read endpoints and diffs the JSON — with the
frozen clock still on and both backends holding the same data (`sim
load-sqlite`, which copies the snapshot rather than regenerating it). Result:

```
45 identical, 1 rounding-only, 0 differ
```

Plus 66 unit tests passing, 19 of them new, covering the SQL translator.

The suite fails loudly if an endpoint returns a matching non-200 on both
backends — two identical 404s are not parity, they are a suite that has
silently stopped testing anything. The first version of it "passed" that way.

**What made the port small.** `local_db.py` was already the right seam, so the
application changes are one facade (`warehouse.py`), one driver
(`pg_warehouse.py`), and 15 import lines. Everything else was kept identical by
either shimming a function in Postgres under its SQLite name — `regexp_contains`,
`iso_week`, `week_start`, `day_name`, `split_first`, `mode_value`, `strftime`,
`datetime`, `group_concat`, `json_each`, `json_extract`, `round(float, int)` —
or by reading through the `compat` views. Only five expressions genuinely
differ, and they were already centralised in fragment builders.

Two shims were deliberately *not* written:

- **`date(text)`.** `date` is a Postgres type name, so `date(expr)` parses as a
  cast when the argument is an untyped literal but binds to a user function
  when it is a text column. Defining it makes
  `date(col) >= date('2026-01-01')` compare text against date and fail — the
  shim causes the bug it appears to fix. Postgres's own cast is correct at
  every call site; bare ISO columns are compared as strings instead, which also
  keeps the index usable.
- **`countif`.** Postgres's `COUNT(*) FILTER (WHERE …)` returns 0 over an empty
  result set where `SUM(CASE …)` returns NULL, so an empty filter would put `0`
  on one backend and `null` on the other. Both backends use the SUM form.

**What the port found.** Most of the real bugs were not dialect issues:

- **Nondeterministic ordering, ~20 queries.** `ORDER BY cancelled DESC` with no
  tie-break, `NTILE(4) OVER (ORDER BY total_order_value)` bucketing tied
  baskets differently, `ROW_NUMBER()` picking a different representative row,
  `group_concat` in unspecified order. Neither engine promises an order here;
  they simply disagreed. This is a latent bug either way — a top-20 list that
  reshuffles for reasons unrelated to the data — so every one of them now has a
  total ordering.
- **A rounded value used as a sort key.** The SLA list ordered by `hours`,
  rounded to 1dp, so a rounding disagreement reordered rows rather than
  shifting a digit. It now sorts on the unrounded duration, and
  `hours_between` computes whole seconds ÷ 3600.0 on *both* backends so the key
  is bit-identical.
- **Writes were hitting the compat views.** `search_path` puts `compat` first,
  and a view with computed columns is not insertable — so persisting a call
  analysis failed with "cannot insert into column … of view", which reads like
  a permissions error and is not one. Writes now name their schema explicitly.
- **Timestamps shifted by the server's timezone.** The app writes bare
  `'YYYY-MM-DD HH:MM:SS'` strings, which Postgres interprets in the *session*
  timezone; on a machine set to Asia/Qatar every written timestamp landed three
  hours early. The pool now pins `TIME ZONE 'UTC'` per connection rather than
  trusting server config.
- **`flagged` was written as `0`/`1`** into a boolean column. SQLite did not
  care; Postgres refuses to coerce.
- **`HAVING` referenced SELECT aliases** in five queries. SQLite allows it;
  nothing else does.

**Accepted divergence.** SQLite's `ROUND` works on the exact binary value of
the double (`2.675 → 2.67`, because the stored double is `2.67499…`); Postgres
rounds the shortest decimal representation (`2.675 → 2.68`). Postgres is the
more defensible answer and is where this is heading, so it is not emulated
away — but the gate counts and prints those cases rather than hiding them
behind a tolerance. One endpoint shows one such value.

**Unrelated issue found.** The pytest suite POSTs to the waitlist, which writes
into `backend/data/clarity.db` — so running the tests mutates the warehouse
snapshot. Harmless today, but it means test runs and parity runs interfere.
Worth pointing at a temp copy.

**Not in scope here.** The frozen clock is untouched: `clock.py` still pins
"now" to 2026-07-28. Doing the port and the time change together would have
made any failure ambiguous. That is Phase 2.

---

## 10. Phase 2, as built — the clock

The frozen clock is gone, replaced by one that knows which warehouse it is
talking to:

```
CLOCK_MODE=auto      frozen on the sqlite snapshot, live on postgres (default)
CLOCK_MODE=live      force real time
CLOCK_MODE=frozen    force a fixed instant (CLOCK_FROZEN_AT)
```

`auto` is the important one. The snapshot's data ends 2026-07-28, so against it
"now" must be that day or every calendar preset selects an empty window. The
simulated warehouse runs to the present, so against it "now" must be the real
clock. Tying the default to the data source means neither can be set wrong by
forgetting a variable.

The frontend has the same split (`frontend/lib/clock.ts`, replacing
`frozen-clock.ts`), driven by `NEXT_PUBLIC_CLOCK_FROZEN_AT`. The two are
flipped **together** by `docker-compose.warehouse.yml`, because the frontend
computes the windows it asks the backend for: flip one and the charts come back
empty with no error. `GET /api/v1/health` now reports the backend's clock so a
mismatch is a one-request diagnosis.

Two things had to change to make "live" actually mean live:

- **`SQL_NOW` was a Python constant** interpolated at import. Correct while
  frozen, and quietly wrong otherwise: a long-running server would measure SLA
  ages against the instant it booted, so "still open for 3h" would never reach
  4h. It is now `db.sql_now()`, a SQL expression the database evaluates per
  query.
- **The cache warmer was pinned to June 2026** — "the only month with order
  data", which stops being true immediately.

**Timezone.** `BUSINESS_TIMEZONE` (Asia/Qatar in the live overlay) fixes the
hour-of-day bug flagged in Phase 0: message timestamps are stored UTC, so
extracting the hour raw put Doha's dinner peak at 16:00. Measured before and
after on the same data:

```
UTC (before)        top hours: 16, 15, 09
Asia/Qatar (after)  top hours: 19, 18, 12     ← dinner and lunch, as they should be
```

## 11. Phase 3, as built — the ticker

`sim run` is what makes this a simulation rather than a dataset. Every tick it
draws a Poisson count of new orders from the hourly demand curve, advances
in-flight orders through their lifecycle, emits the support contacts those
orders cause, and closes conversations whose handling time has elapsed.

Three design decisions carry most of the weight:

- **The plan is written up front.** When an order is created its whole future —
  accept, prepare, dispatch, deliver or cancel, and any support contact — is
  decided and stored in `sim.order_plan`. A tick is then one set-based UPDATE
  applying whatever came due, so replaying a window gives identical outcomes.
- **Ticks are driven by the cursor, not the loop.** Each pass advances from
  `sim.tick_cursor` to now in bounded steps, so a restart, a slow tick or a
  laptop that slept all self-heal. Past a 24-hour gap it fast-forwards and logs
  it rather than manufacturing a week of history at boot.
- **Support contacts are consequences.** Cancellations and slow orders generate
  far more of them, which is what makes the cross-channel views tell one story
  rather than showing three independent random walks.

Measured on an 8-hour catch-up: 483 orders, 380 delivered, 29 cancelled, the
rest in flight, plus 15 messages, 9 chats and 2 calls — and conversations
closing on schedule.

One bug worth recording: the ticker minted `msg-000001` on top of a seeded row
and died on the primary key, because `sim.message_seq` was never advanced past
the seed. Sequences are now re-parked at every seed, load **and** ticker start.

## 12. Phase 4, as built — the UI

**Cache TTLs are window-aware.** A flat five minutes was right for a frozen
file and wrong for a live one in a specific, demo-killing way: the numbers stop
moving. A query whose window includes today now expires in 20s; a closed
historical period keeps the 300s TTL, because those rows are immutable. Under
the frozen clock every window is historical and the old behaviour returns
exactly.

**`GET /api/v1/live` reports data freshness** — the age of the newest row per
stream, not the health of the service. Those come apart in the way that
matters: if the pipeline stops, every service stays green, every query still
returns, and the charts quietly freeze. The topbar badge polls it and degrades
`live → lagging → stale`. Verified both directions: with the ticker stopped it
reported `lagging`, with it running `live · newest order 7s ago`.

That endpoint needed its own timezone fix — order timestamps are Qatar-local
while everything else is UTC, so the first version reported every order as 0
seconds old.

## 13. Phase 5 and 6, as built — live AI, and scenarios

**The AI runs on arriving data.** The simulator writes *raw* rows only; a
backend worker classifies them and another scores in-flight orders. That is the
real production path — ingest → classify → serve — rather than a dashboard
displaying sentiment that never went through a model. Guarded by a daily budget
(the simulator produces messages forever, so an uncapped worker is an uncapped
bill) and a deterministic keyword fallback, labelled `keyword-fallback-v1` so it
is never credited to the model. Verified: 17 unlabelled messages picked up and
correctly classified in one cycle.

**A third scoring engine** had to exist. The repository ships no trained model,
so the risk queue was permanently empty unless someone supplied a Gemini key.
`scorecard` is a transparent log-odds score over rates the warehouse already
knows — the merchant's and zone's recent cancellation rates, hour, basket size,
customer type. Every input is observed data, not a peek at the simulator's
plan. Its output on live orders: median 9% (the platform base rate), max 59%,
9 high / 5 medium / 220 low — and the riskiest order was the internal test
account with its 16× cancellation bias, driven by `vendor_cancel_rate_30d`.
`auto` now prefers model → scorecard and never silently escalates to a paid
API.

**Scenario injection** (`sim control`, or `sim scenario` on the command line)
is the demo console: merchant outage, zone courier shortage, sentiment storm,
volume spike. It belongs to the *simulator*, not to any product — a product
that knows when the interesting data is coming is being staged, not
demonstrated. Clarity only ever sees orders and complaints arriving.

Measured with an outage on Turkey Central and a courier shortage in Al Khor
running together, over an hour of simulated time:

| segment | orders | cancel rate | avg accept |
|---|---|---|---|
| Al Khor (courier shortage) | 18 | 22.2% | 38.1 min |
| Turkey Central (outage) | 8 | 12.5% | 57.0 min |
| everything else | 424 | 3.3% | 6.5 min |

…with `Items out of stock at vendor` and `No driver available` appearing in the
reason mix, as those scenarios imply.

The first version scaled cancellation timing off the *inflated* lifecycle, so
an outage that stretched prep times to 80 minutes did not produce its
cancellations for three hours — the opposite of what an outage looks like, and
useless to watch. Cancellations now fire early, which is also how they happen.

**A second product** needs no new work: `nabd_reader` already exists with the
same read-only grant, and the compose overlay pattern is one file.

## 14. What the parity gate caught about itself

The gate was mutating its own reference data. Several endpoints persist as a
side effect — the risk queue stores the scores it computes — so a run left 418
extra prediction rows in both datasets, and the *next* run reported off-by-one
differences that looked exactly like a porting bug.

It now runs the SQLite side against a throwaway copy and rolls the Postgres
side back afterwards. The rollback is keyed on an id watermark, not a
timestamp: the run executes under the frozen clock, so every row it writes is
dated 2026-07-28 and a `written_at >= run_start` filter matches nothing —
a cleanup that looks like it works and silently lets the data drift.

Two consecutive runs now produce byte-identical reports, which is the property
that makes the gate worth trusting:

```
45 identical, 1 rounding-only, 0 differ
```

That work also surfaced a genuine schema bug: `cancellation_predictions` was
unique on `(order_id, predicted_at)`, so the scorecard and the trained model
could not both score the same order at the same instant. The engine is now part
of the key.


---

## 15. Scale — what the 60k snapshot hid

Everything above was verified against the 60k-row snapshot, where a full table
scan is instant. The first VPS deploy on the seeded 1.4M-row dataset had
**every date-filtered endpoint time out**. Three separate causes, none of them
visible at small scale:

| | 1.4M rows, before | after |
|---|---|---|
| `WHERE order_placement_date >= …` through the compat view | 1341 ms | 1.4 ms |
| `mode_value(platform_name)` in a GROUP BY | > 25 s | 2.4 s |
| `strftime('%Y-%m', order_placement_date)` | 31.9 s | 1.1 s |
| the monthly cancellation trend endpoint | timed out | 2.1 s |

- **The compat views rendered every date with `to_char()`**, so no predicate
  could use an index — and `to_char` is STABLE, not IMMUTABLE, so an expression
  index could not recover it either. They return native `date`/`timestamptz`
  now; the driver formats them on the way out, so the wire format is unchanged.
- **`mode_value` accumulated every value into an array per group**, which is
  O(rows) memory per group. It counts into a jsonb object instead.
- **`strftime` on a date delegated to the text overload**, costing two
  conversions and a re-parse per row. It formats the typed value directly.

Cold endpoint times are now 0.3–6.5 s locally and 0.5–7.4 s on the 2-core VPS,
and the startup warmer keeps the dashboard views hot.

**Density is a deployment knob.** `SIM_ORDERS_PER_DAY` trades realism against
the hardware: 2500/day (1.4M rows over the window) locally, 1200/day (690k) on
the VPS, where two cores make a cold aggregate roughly twice as slow. Both look
live; the lower one just scans less.

### The schema was never applied from scratch

Every statement under `sql/` had been applied by hand with `CREATE OR REPLACE`
during development, so the files had never once run top-to-bottom against an
empty database. Two duplicate definitions had accumulated, and the container's
initdb runs with `ON_ERROR_STOP` — so the first duplicate aborted
`020_functions.sql` and every file after it. The cluster came up with shim
functions and **no tables**, and the ticker crash-looped against a schema that
did not exist.

`warehouse/check_schema.sh` now applies `sql/` to a throwaway database exactly
as a fresh container does. It found the second duplicate immediately. Run it
before pushing anything under `sql/`.
