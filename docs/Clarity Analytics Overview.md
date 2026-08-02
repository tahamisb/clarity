# Clarity Analytics — Project Overview

**What it is.** An internal customer-experience analytics platform for Clarity, a Qatar-based
food-delivery company. It turns raw customer interactions — call-centre transcripts, support
chats, and order history — into decisions: sentiment and intent per interaction, trends and
negative-signal triggers across channel/merchant/zone, and per-order cancellation risk. One
tool serving CX leadership (what needs attention now), frontline agents (understand this
customer fast), and ops/exec stakeholders (customer health at a glance).

**Stack.** FastAPI (Python 3.12) on port 8001 + Next.js 16 / React 19 / Tailwind 4 on port
3000, in one monorepo. Google Gemini does the language work. All analytics read a single
local SQLite warehouse, `backend/data/clarity.db`, generated deterministically by
`scripts/generate_mock_db.py` from synthesised-but-realistic Qatar data (real merchant
names, delivery zones, QAR amounts, Arabic transcripts). BigQuery was removed in July 2026,
so there are no cloud credentials and no migrations. Because the dataset ends on a fixed
day, the whole app treats **every day as 2026-07-28** via a shared frozen clock.

## The three pillars

| # | Pillar | What it delivers |
|---|---|---|
| 01 | **Call Intelligence** | Gemini analysis of call transcripts → sentiment, intent, entities, summaries. Call log with detail modal, intent breakdown, area & restaurant insights, Qatar coverage map, pipeline view. |
| 02 | **Support Messages** | Every support chat cleaned, classified (sentiment / intent / negative trigger), and enriched with merchant + zone. Sentiment trend, top negative triggers, cross-channel comparison (app / WhatsApp / ticket), zone heatmap, SLA-breach tracking, flag/resolve status, negative-customer CSV export. |
| 03 | **Cancellation Prediction** | Gemini risk scoring per live order plus driver analytics — trend, by merchant / zone / hour / day-of-week / order size / cancelling actor, crosstabs, a generated drivers report, and a grounded Q&A chat over the data. (An XGBoost/SHAP path exists in code but model maintenance was dropped in July 2026; it runs Gemini-only.) |

Above them sits a **CX Dashboard**: a single executive view combining total interactions,
contact rate, overall sentiment score, cancellation rate, escalation rate, a composite
health score, and auto-written insight lines ("negatives peaked in week N, driven by X"),
each panel linking through to its pillar.

## Cross-cutting features

- **Global time filter** — WTD / MTD / QTD / YTD / All / custom range, applied app-wide.
- **Vertical filter** — Restaurants / Grocery / Market / Health & Wellness, resolved from merchant data.
- **Full EN ⇄ AR bilingual UI** — complete dictionary, RTL layout flip, self-hosted Cairo font.
- **Settings** — SLA thresholds (chat 4 h, ticket 24 h), sentiment-spike threshold, auto-refresh cadence; passed to the backend as query params.
- **Role-based notifications** — Employee/Manager role at login drives a bell panel of derived SLA, cancellation, and helpfulness alerts.
- **Excel-style column filters**, dark/light theme, liquid-glass Clarity design system, WCAG 2.1 AA target.
- **Performance** — 5-minute TTL caches with a background warmer that refreshes default-filter queries every 4 minutes and idles when nobody is using the API, so dashboards load without a cold hit or an LLM call.

## Scope & boundaries

**In scope:** read-only analytics and prediction over existing interaction data; a demo-ready
self-contained deployment (`docker build` produces the warehouse); pytest coverage of the
SQL shims, call cache/service, cancellation and classifier logic.

**Not in scope / known gaps:** the app does not ingest live production data (the upstream
platform owns `chat_history`); no write-back into operational systems; auth is currently a
shared-password dev bypass pending Google OAuth credentials; human ground-truth labels for
the accuracy endpoint are populated manually; ML model training is retired.

*Engineering detail: [`docs/README.md`](README.md). Product & design intent: [`PRODUCT.md`](../PRODUCT.md).*
