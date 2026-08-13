# Clarity Analytics — Engineering Handbook

Single source of truth for running and understanding the codebase. Replaces the
old `backend/README.md`, `docs/HANDOFF.md`, and `frontend/AUTH_SETUP.md`
(recoverable from git history). Product/design intent lives in
[`../PRODUCT.md`](../PRODUCT.md); the CX-facing narrative in
[`clarity-how-it-works.html`](clarity-how-it-works.html).

Last verified against code: 2026-07-28.

> **Data source:** the app no longer reads BigQuery. It reads one of two
> warehouses, selected by `WAREHOUSE_BACKEND` and fronted by
> [`app/services/warehouse.py`](../backend/app/services/warehouse.py):
>
> - `sqlite` *(default)* — the local file `backend/data/clarity.db`, built by
>   [`scripts/generate_mock_db.py`](../backend/scripts/generate_mock_db.py) from
>   synthesised data, frozen at 2026-07-28. See §1.1.
> - `postgres` — the simulated live warehouse in
>   [`warehouse/`](../warehouse/README.md), a stand-in for the organisation's
>   real one.
>
> The SQL is identical for both; `warehouse.py` documents how. Any change to a
> query must keep `backend/scripts/warehouse_parity.py` green — it diffs every
> endpoint's JSON across the two backends. Design and phasing:
> [`live-data-simulation.md`](live-data-simulation.md).

---

## 1. Codebase overview

Monorepo, two apps + docs:

```
clarity-analytics/
├── backend/          FastAPI (Python 3.12+, Docker image python:3.12-slim), port 8001
│   ├── app/
│   │   ├── main.py             app + router registration + warehouse check (lifespan)
│   │   ├── config.py           pydantic-settings (.env): Gemini + batching knobs
│   │   ├── models/             enums.py, schemas.py, cancellation.py (Pydantic)
│   │   ├── routers/            HTTP endpoints per feature
│   │   ├── services/           local_db.py (SQLite) + db_*.py data access + business logic
│   │   └── utils/              clock.py (frozen "now"), helpers, feature_engineering
│   ├── data/clarity.db          the local SQLite warehouse (generated, git-ignored)
│   ├── scripts/                generate_mock_db.py, explore_cancellations.py
│   ├── tests/                  pytest (local_db shims, call cache/service, cancellation, classifier)
│   └── artifacts/              precomputed cancellation reports + (optional) trained model
├── frontend/         Next.js 16 / React 19 (pnpm), port 3000
│   ├── app/                    / (CX overview), /messages, /cancellations, /cx-dashboard,
│   │                           /settings, /help, /login
│   ├── components/clarity/      dashboard components (tables, charts, topbar, sidebar…)
│   └── lib/                    api.ts (backend client), i18n.tsx (EN/AR), time-filter-context,
│                               settings-context (SLA thresholds, auto-refresh), time-range.ts,
│                               frozen-clock.ts (the app-wide fixed "today")
└── docs/             this file + clarity-how-it-works.html
```

### 1.1 The local warehouse

All analytics read one SQLite file, `backend/data/clarity.db`, opened through
[`services/local_db.py`](../backend/app/services/local_db.py). It keeps the table and
column names the BigQuery `reports` dataset had — `vendor_kpi`, `vendor_items_kpi`,
`chat_history`, `call_analysis`, `messages`, `classifications`, `labels`, `skipped_chats`,
`cancellation_predictions` — so the query layer reads the same, just against a local file.
Timestamps are stored as `YYYY-MM-DD HH:MM:SS` text.

```bash
cd backend && python scripts/generate_mock_db.py     # ~34 MB, under a minute
python scripts/generate_mock_db.py --orders 10000    # smaller/faster for a quick loop
python scripts/generate_mock_db.py --skip-artifacts  # DB only, leave artifacts/ alone
```

The generator is seeded, so a rebuild is byte-identical. It also regenerates the
cancellation exploration JSONs and the drivers report in `artifacts/` from the data it
just wrote, so the narrative on the Cancellations page can never describe rows that aren't
there. The DB is git-ignored and built during `docker build`.

**SQL dialect.** SQLite has no `COUNTIF`, `SAFE_DIVIDE`, `APPROX_TOP_COUNT`, `QUALIFY`,
`FORMAT_DATE`, `REGEXP_CONTAINS` or `TIMESTAMP_DIFF`. `local_db` registers Python UDFs
(`regexp_contains`, `mode_value`, `iso_week`, `week_start`, `day_name`, `split_first`) and
exposes fragment builders (`countif`, `safe_divide`, `hour_of`, `hours_between`); `QUALIFY`
became a `ROW_NUMBER()` subquery and `UNNEST(JSON_VALUE_ARRAY(x))` became `json_each(x)`.
[`tests/test_local_db.py`](../backend/tests/test_local_db.py) pins all of it.

### 1.2 Frozen clock

The dataset ends on a fixed day, so the app treats **every real day as 2026-07-28**.
Anything asking "what is now?" goes through
[`app/utils/clock.py`](../backend/app/utils/clock.py) (backend) or
[`lib/frozen-clock.ts`](../frontend/lib/frozen-clock.ts) (frontend) — **keep the two dates
in sync**. WTD/MTD/QTD/YTD, the custom range picker, SLA "still open" maths and
notification ages therefore stay anchored to populated data instead of drifting empty as
real time passes. The one deliberate exception is the "last updated Xs ago" refresh
indicator, which stays on the wall clock because it measures a real fetch.

To move the dataset forward, change both dates and re-run the generator.

### The three pillars

| Pillar | What it does | Key tables |
|---|---|---|
| 01 — Call intelligence | Gemini analysis of call-centre transcripts | `call_analysis`, `vendor_kpi`, `vendor_items_kpi` |
| 02 — Support Messages | Classified support chats: sentiment / intent / negative trigger — see §4 | `chat_history` (source), `messages`, `classifications`, `skipped_chats`, `labels` |
| 03 — Cancellation prediction | Gemini risk scoring + driver narratives & Q&A (plan of record). A full XGBoost/SHAP path also exists in code but the team dropped model maintenance (2026-07), so nothing is trained and it runs Gemini-only in practice. | `vendor_kpi` (features), `artifacts/*.json` |

Pillar 03 is registered defensively in [`app/main.py`](../backend/app/main.py) — if ML
deps aren't importable the rest of the API still boots. Its `/predict*` endpoints take
`engine=auto|model|gemini`: **auto** uses the trained model if `artifacts/cancellation_model.joblib`
exists, else Gemini; **model** 503s when untrained; **gemini** always works. If no model
is trained, the pillar runs Gemini-only.

### Running it

```bash
# backend (needs backend/.env — see .env.example: GEMINI_API_KEY)
cd backend && pip install -r requirements.txt
python scripts/generate_mock_db.py          # once — builds data/clarity.db
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# frontend
cd frontend && pnpm dev        # http://localhost:3000
```

The lifespan hook only checks the warehouse is present — the generator owns the schema, so
there are no migrations and nothing is created at boot.

Interactive API docs: `http://localhost:8001/docs`. Tests: `pytest tests/ -v`.

### Docker (backend)

```bash
docker build -t clarity-api backend/       # generates data/clarity.db during the build
docker run -p 8001:8001 -e GEMINI_API_KEY=your_key clarity-api
```

### Auth

| System | How |
|---|---|
| Data | none — local SQLite file, no credentials |
| Gemini | `GEMINI_API_KEY` in `backend/.env` |

Gemini is only reached by the live classification endpoint, the cancellation Q&A chat, and
risk scoring for orders with no stored prediction. The generator pre-seeds a prediction for
every live order, so the dashboards load without a single LLM call.

### Configuration ([`app/config.py`](../backend/app/config.py))

| Setting | Default | Notes |
|---|---|---|
| `gemini_api_key` | — (required) | |
| `gemini_model` | `gemini-3.5-flash` | Pillar 01 calls + cancellation narratives |
| `gemini_classify_model` | `gemini-3.1-flash-lite` | Pillar 02 classification (~6× cheaper); stored per-row as `model_version` |
| `gemini_thinking_level` | `minimal` | Gemini 3.x bills reasoning tokens as **output**; at `medium` each tiny classification carried ~800 reasoning tokens (~12× the answer). **Never raise for classification.** |
| `gemini_concurrency` | 5 | Global asyncio semaphore around Gemini calls |
| `classify_batch_size` / `classify_batch_delay_s` | 10 / 0.5 | Classification-job batching |

The database path isn't configurable — it's `backend/data/clarity.db`, resolved in
[`services/local_db.py`](../backend/app/services/local_db.py).

### Frontend cross-cutting features (all pillars)

- **Global time filter** — WTD/MTD/QTD/YTD/All via `TimeFilterProvider`; record feeds filtered client-side, aggregates re-queried server-side with `start`/`end` date params.
- **Vertical filter** — Food/Groceries/… resolved server-side by mapping merchant → majority platform in `vendor_kpi` ([`services/verticals.py`](../backend/app/services/verticals.py)).
- **i18n** — full EN/AR toggle with RTL flip ([`lib/i18n.tsx`](../frontend/lib/i18n.tsx)); `useT` for UI strings, `useTV` for data values.
- **Settings context** — SLA thresholds (chat SLA default 4 h, general/ticket SLA 24 h), sentiment-spike threshold, auto-refresh cadence. Passed to the backend as query params — the backend has no persisted settings.
- **Auth** — see §6.

---

## 2. Support Messages pillar — data model

Source of truth is `reports.chat_history` (populated upstream by the Clarity platform,
not this repo). Each row is one support conversation:

- `chat_id`, `customer_id`, `order_id`, `type`, `device_id`, `locale`
- `messages` — a JSON **string**: an array of `{message, from_bot, agent_id, reply_options, …}` objects
- `created_at` (conversation start, **UTC**), `closed_at` (end), `closed_by` (agent name or system keyword), `is_phone_call`

Four derived tables, built by [`scripts/generate_mock_db.py`](../backend/scripts/generate_mock_db.py):

**`reports.messages`** — one row per analysed conversation

| Column | Meaning |
|---|---|
| `message_id` | **= `chat_id`** — dedup key for the whole pipeline |
| `customer_id` | from `chat_history` |
| `content` | *cleaned* customer-only text (see §4 step 2) |
| `source_channel` | `app` / `whatsapp` / `ticket` — derived (§4 step 4) |
| `merchant_name`, `zone` | enrichment from `vendor_kpi` via `order_id` |
| `created_at` / `closed_at` | start / end; **handling time = closed_at − created_at** (SLA basis) |
| `ingested_at` | when the pipeline wrote the row |
| `agent_name` | human agent who closed the chat; `NULL` ⇒ bot/customer-only |

**`reports.classifications`** — one row per Gemini verdict (joined on `message_id`; latest by `classified_at` wins): `classification_id` (uuid4), `message_id`, `sentiment`, `sentiment_confidence`, `intent`, `intent_confidence`, `negative_trigger`, `model_version`, `classified_at`.

**`reports.skipped_chats`** — chats examined but unanalysable (button-tap-only / timed-out sessions with no genuine customer text). Without this table they'd sit at the front of the newest-first scan forever and starve real work.

**`reports.labels`** — human ground truth (`true_sentiment`, `true_intent`) for the accuracy endpoint. Currently populated manually only.

Classification vocabulary ([`models/enums.py`](../backend/app/models/enums.py)):
- sentiment: `positive | neutral | negative`
- intent: `complaint | refund | order_query | cancellation_request | praise | escalation`
- channel: `app | whatsapp | ticket`

---

## 3. Scripts (`backend/scripts/`)

Both run from `backend/` and self-bootstrap (`sys.path` insert + `load_dotenv()`), sharing
the app's config/services.

### 3.1 `generate_mock_db.py` — builds everything

The only data-producing job in the repo. Synthesises orders, order items, chats, calls,
support messages, classifications, labels and cancellation predictions into
`data/clarity.db`, then rebuilds the `artifacts/` JSONs from what it wrote. Seeded, so a
rebuild is reproducible; see §1.1 for flags.

It is also where the shape of the data lives — merchant/vertical list, Qatar zones,
cancellation reasons and their weights, the EN/AR support-message corpus, and the call
transcripts. Change the constants at the top of the file and re-run to reshape any chart.

Cancellation risk is modelled, not random: it scales with zone, merchant, order value,
late-night hours, weekend and vertical, so the breakdowns have real signal instead of
noise. Predictions are pre-seeded for every live order, which is what keeps the risk queue
off the Gemini API.

### 3.2 `explore_cancellations.py` — refresh the cancellation artifacts

Re-runs the exploration queries from `cancellation_service` (the same functions the API
uses) and writes their JSONs. `--with-report` also regenerates the drivers report **via
Gemini**, which costs money — the generator writes a templated report from the same
aggregates for free, so only reach for this when you specifically want the LLM narrative.

```bash
python scripts/explore_cancellations.py
python scripts/explore_cancellations.py --with-report   # spends Gemini tokens
```

> **Removed with BigQuery (2026-07-28):** `run_chat_pipeline.py` (+ `.cmd` and the
> `ClarityChatPipeline` scheduled task), `drain_backlog.py`, `drain_backlog_batch.py`,
> `run_batch_classify.py`, `backfill_message_sla.py`, `backfill_message_enrichment.py`,
> `seed_text_messages.py`, `train_cancellation_model.py`, and the Colab training notebook.
> They existed to pull from, backfill, or train on the warehouse. Recoverable from git
> history if the warehouse ever comes back.

## 4. How each message is analysed

End-to-end path of one support conversation, `chat_history` → Messages dashboard. The
recurring ingest job was removed along with BigQuery, so today the generator writes
`messages` + `classifications` directly; the shape below is still exactly what the
serving layer reads, and `POST /api/v1/sentiment/classify` still runs steps 3–5 live.

### Step 1 — Selection

Conversations come from `chat_history` (one row per support conversation) and are scoped
to analysable traffic: `is_phone_call = false`, `messages IS NOT NULL`, `locale` containing
`ar` or `en`, and not already present in `messages` or `skipped_chats`. `zone` and
`merchant_name` are enriched from `vendor_kpi` via `order_id`.

### Step 2 — Cleaning

A conversation is reduced to *genuine customer text only*: bot turns and agent turns are
dropped, and a customer turn that exactly matches one of the preceding bot's
`reply_options` is a button tap rather than authored text, so it goes too. What's left is
joined with newlines; under 10 characters means there was nothing to analyse and the chat
is recorded in `skipped_chats` (reason `no_genuine_text`) so it permanently leaves the
unprocessed set.

### Step 3 — Gemini classification ([`services/text_classifier.py`](../backend/app/services/text_classifier.py) + [`gemini_service.py`](../backend/app/services/gemini_service.py))

`classify_chat_messages(cleaned_text)` formats `_CHAT_PROMPT`: Gemini is told it's a support analyst for Clarity (food/grocery delivery, Qatar), given the cleaned customer text (EN/AR/mixed, as-is), asked for strict JSON:

```json
{
  "sentiment": "positive | neutral | negative",
  "confidence": 0.0,
  "intent": "complaint | refund | order_query | cancellation | praise | escalation",
  "negative_trigger": "<short phrase, or null if not negative>"
}
```

Transport (`call_with_retry`, `google-genai` SDK): one shared client (temperature 0.1, `response_mime_type: application/json`, `thinking_level` from settings — **keep `minimal`**), model `gemini_classify_model`, gated by a global semaphore of `gemini_concurrency` (5), run in a thread pool, **one retry** then counted as failed (stays unprocessed, retried next run). Within a batch, up to `batch_size` chats run concurrently via `asyncio.gather`.

Normalisation (`_normalise_chat`):
- sentiment outside enum → `neutral`; intent outside enum → `order_query`; `cancellation` → `cancellation_request`.
- confidence clamped to [0, 1]. `intent_confidence` **hardcoded 1.0** for chat rows (the chat prompt doesn't ask for it; the per-message prompt does).
- `negative_trigger` forced `NULL` unless sentiment is `negative`; trimmed to 200 chars.

### Step 4 — Row assembly

Per classification, two rows:

- **messages**: `message_id = chat_id`, cleaned text as `content`, `customer_id`/`zone`/
  `merchant_name` from step 1, `created_at`/`closed_at` from the chat, `ingested_at`, plus
  ([`utils/helpers.py`](../backend/app/utils/helpers.py)):
  - `source_channel = derive_channel(type, device_id)`: "whatsapp" in `type` → `whatsapp`;
    "app" in `type` or any `device_id` → `app`; else `ticket`.
  - `agent_name = derive_agent_name(closed_by)`: `NULL` for `{cron, customer, bot, system,
    agent}` closers, else the closer's name.
- **classifications**: fresh uuid4, normalised Gemini fields, `model_version`, `classified_at`.

### Step 5 — Write ([`services/db_text.py`](../backend/app/services/db_text.py))

`insert_classifications` runs **before** `insert_messages`. Order matters — idempotency is
the anti-join on `messages`, so a failure *after* the messages insert would drop the chat
from the unprocessed set without its classification. Classifications-first inverts that
into a harmless dangling classification, and the latest `classified_at` wins on read.

### Step 6 — Serving (routers)

- **`GET /api/v1/sentiment/results`** ([`routers/sentiment.py`](../backend/app/routers/sentiment.py)) — the message feed: `classifications JOIN messages`, newest-classified first, filter by sentiment/intent/zone/merchant/date, paginated (≤200/page).
- **`GET /api/v1/analytics/*`** ([`routers/text_analytics.py`](../backend/app/routers/text_analytics.py) → [`text_analytics_service.py`](../backend/app/services/text_analytics_service.py)) — full-corpus aggregates, all accept optional `start`/`end` (YYYY-MM-DD) and `vertical`:
  - `sentiment-trend` — weekly (Monday-start) counts + percentages.
  - `top-negative-triggers` — top 5. Gemini's `negative_trigger` is free-form, so a SQL `CASE` of `REGEXP_CONTAINS` rules canonicalises synonyms into ~11 buckets **before** grouping (rule order matters, specific before broad). Each row carries top merchants/zones/vertical + a time-of-day split.
  - `cross-channel` — messages vs. calls sentiment/intents; call intents mapped via `_CALL_TO_TEXT_INTENT`.
  - `intent-distribution`, `merchant-sentiment`, `zone-heatmap` — grouped counts.
  - `message-overview` — the stat-card/SLA endpoint: total, negative %, top intent/channel/vertical, sentiment by Qatar day part (morning 6–11, afternoon 12–17, evening 18–21, night 22–5), and **SLA breaches per channel**. Handling time = `closed_at − created_at` (falls back to `now − created_at` for open chats); a `ticket` breaches against `general_sla_hours` (24), every other channel against `chat_sla_hours` (4) — both from the frontend Settings page.
- **`GET /api/v1/sentiment/accuracy`** — `classifications` vs human `labels` (overall + per-class + confusion matrix). Empty until labels are added.
- **Chat-analytics** ([`routers/chat_analytics.py`](../backend/app/routers/chat_analytics.py), prefix `/api/messages`) — contact-rate and related chat aggregates.
- **Manual ingestion** ([`routers/messages.py`](../backend/app/routers/messages.py), prefix `/api/v1/messages`): `upload` (JSON) and `upload/csv` run `preprocess()` = PII redaction (emails/phones → `[REDACTED_*]`) + whitespace/NFC normalisation, assign uuid4 ids, insert *without* classification (classify afterwards). **The chat pipeline does NOT apply this PII redaction** — cleaned chat text is stored verbatim.

### Step 7 — Frontend ([`app/messages/page.tsx`](../frontend/app/messages/page.tsx), [`lib/api.ts`](../frontend/lib/api.ts))

`fetchAllMessagesData()` loads in parallel: the raw feed (`/sentiment/results`, 200/page, **capped at 1000 rows**) plus the aggregate panels. Two-tier:

- The **feed** (table + stat-card *fallbacks*) is filtered client-side by the global time range + vertical, so toggles re-scope instantly.
- The **stat cards, time-of-day chart, SLA banner** prefer the `message-overview` numbers (computed in SQL over *all* rows); anything from the capped feed is only a sample. Client-side computation is kept purely as a fallback when the backend is unreachable.

The page raises two threshold alerts (sentiment spike WoW ≥ configured %, SLA breaches per channel) and supports deep links `/messages?msg=<id>` from the notification bell.

### Pipeline at a glance

```
chat_history                    one row per support conversation
        │
        ▼
[1] selection                   locale ar/en, not already in messages/skipped_chats,
        │                       vendor_kpi enrichment (zone, merchant)
        ▼
[2] cleaning                    customer text only; drop bot/agent turns + button taps
        │                       <10 chars → skipped_chats (leaves the queue forever)
        ▼
[3] classification              Gemini (temp 0.1, JSON mode, semaphore=5, 1 retry)
        │                       → sentiment, confidence, intent, negative_trigger
        ▼
[4+5] classifications + messages          message_id = chat_id (dedup key)
        ▼
[6] FastAPI  /sentiment/results (feed) · /analytics/* (full-corpus aggregates, SLA)
        ▼
[7] /messages page   1000-row client-filtered feed + SQL-computed overview/alerts
```

---

## 5. Gotchas & operational notes

- **Frozen clock:** "now" is pinned to 2026-07-28 in **two** places that must agree —
  `backend/app/utils/clock.py` and `frontend/lib/frozen-clock.ts`. Change one without the
  other and the server aggregates and the client-side feed filter disagree about what MTD
  means. See §1.2.
- **The DB is disposable, the generator is the source of truth.** `data/clarity.db` is
  git-ignored. Never hand-edit it — change `scripts/generate_mock_db.py` and re-run, or the
  next rebuild silently discards your edit.
- **Timezone mismatch:** `chat_history.created_at` is **UTC**; `vendor_kpi` order timestamps
  are **Qatar local (UTC+3)**. Any cross-table time comparison must shift chat times +3 h
  (the contact-rate query does). Within the messages pillar everything stays UTC, so
  day-part buckets are UTC-based.
- **SQLite dialect traps:** `COUNTIF`/`SAFE_DIVIDE`/`QUALIFY`/`APPROX_TOP_COUNT` don't
  exist — use the helpers in `local_db` rather than hand-rolling, and add a case to
  `tests/test_local_db.py` for any new UDF. `group_concat(DISTINCT x)` replaced
  `ARRAY_AGG`, so it can't take a separator and splits on `,` — don't put commas in a value
  you intend to aggregate that way.
- **`message_id` is overloaded:** numeric string = real chat (`chat_id`), uuid4 = manual
  upload/generated row. Anti-join idempotency only protects chat-sourced rows.
- **UI cap:** the feed fetches at most 1000 messages; only `message-overview`/aggregate
  endpoints reflect the full corpus.
- **Two prompts exist:** the chat-level `_CHAT_PROMPT` (no intent confidence) and the
  single-message `_PROMPT` (manual uploads; few-shot + intent confidence). Keep their
  vocabularies in sync with `TextIntentEnum`.
- **Cost guardrails:** classification runs on `gemini_classify_model` (flash-lite) with
  `thinking_level=minimal`. Raising the thinking level or using a pro-tier model multiplies
  cost ~100× for no measurable accuracy gain here. The dashboards themselves make no Gemini
  calls — only `/api/v1/sentiment/classify`, `/api/cancellation/chat`, and scoring an order
  with no stored prediction do.
- **`negative_trigger` is free-form** in storage; canonicalisation happens only at query
  time in `_canonical_trigger()` (`db_text.py`). New synonym patterns go there, specific
  before broad.
- **EOL SDK:** `google-generativeai` is still pinned only because `chat_service.py` (the
  live `/api/cancellation/chat` endpoint) uses it. Migrate to `google-genai` before
  dropping it.
- **Secrets:** `backend/.env` holds `GEMINI_API_KEY`; never commit it. `.env.example`
  documents the keys. There are no cloud data credentials any more.

---

## 6. Auth

The dashboard is gated behind sign-in. **Only `@example.com` accounts can log in;
there is no sign-up flow** — login-only, enforced server-side.

> **CURRENT STATE: placeholder login active (since 2026-06-17).** We do not yet have
> Google OAuth credentials (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` blank — waiting on
> a managed OAuth client from IT). Until then a NextAuth **Credentials** provider accepts
> **any `@example.com` email + a shared password**:
>
> ```
> DEV_LOGIN_PASSWORD=clarity        # in frontend/.env — share with the team
> NEXT_PUBLIC_AUTH_BYPASS=false    # full bypass OFF; the login screen is real
> ```
>
> Sign in at `/login` with e.g. `t.mutahir@example.com` and the password. The domain
> check is enforced server-side in the Credentials `authorize()`
> ([`auth.ts`](../frontend/auth.ts)). The Google button only appears once `AUTH_GOOGLE_ID`
> is set. A legacy full bypass (`NEXT_PUBLIC_AUTH_BYPASS=true`) skips the login screen
> entirely — left in place but off by default.

**How it works:** Auth.js (NextAuth v5) with the Google provider
([`auth.config.ts`](../frontend/auth.config.ts), [`auth.ts`](../frontend/auth.ts)). The
`signIn` callback rejects any account whose verified email isn't on `example.com`.
[`middleware.ts`](../frontend/middleware.ts) protects every route (unauthenticated → `/login`;
logged-in hitting `/login` → app). Role (Employee/Manager) chosen at login drives the
topbar notification bell. The signed-in user + **Sign out** appear in the top-right menu.

**Switching to Google SSO:**

1. Google Cloud Console → **Create credentials → OAuth client ID → Web application**.
2. Add redirect URI `http://localhost:3000/api/auth/callback/google` (+ the prod callback when deployed).
3. Put `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` in `frontend/.env`.
4. Remove the `Credentials` provider in [`auth.ts`](../frontend/auth.ts) (and optionally `DEV_LOGIN_PASSWORD`), restart. The Google button reappears automatically.
5. `AUTH_SECRET` is already generated; in production set a fresh one and set `AUTH_URL` to the deployed URL.

> Tip: lock the OAuth consent screen to example.com by configuring it as an **Internal**
> app in the example.com Workspace. `hd=example.com` is already sent on every sign-in;
> the server-side domain check is the real enforcement regardless.
