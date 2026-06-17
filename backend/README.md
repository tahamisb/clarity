# Rafeeq Analytics API — Unified Backend

Single FastAPI service combining both pillars on **port 8000**.

| Pillar | What it does |
|---|---|
| 01 — Calls | Classify call-centre transcripts (intents, sentiment, entity extraction) |
| 02 — Text | Classify app/WhatsApp/ticket messages (sentiment, intent, negative triggers) |

---

## Quick Start

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env      # add GEMINI_API_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Tables are created automatically on first startup.

---

## Auth

| System | How |
|---|---|
| BigQuery | ADC — `gcloud auth application-default login` |
| Gemini | `GEMINI_API_KEY` in `.env` |

---

## Seed + Classify (Pillar 02)

```bash
python scripts/seed_text_messages.py --count 200
python scripts/run_batch_classify.py
python scripts/run_batch_classify.py --dry-run   # preview only
```

---

## API Docs

Interactive docs: `http://localhost:8000/docs`

### Pillar 01 — Calls (original paths, frontend-compatible)

| Method | Path | Description |
|---|---|---|
| GET  | `/health` | Simple health check |
| POST | `/analyse` | Analyse a single transcript |
| POST | `/analyse/batch` | Analyse up to 100 transcripts |
| POST | `/predict` | Quick sentiment + intent (no BQ enrichment) |
| GET  | `/analytics/summary` | Intent distribution, sentiment trend, top topics |
| GET  | `/analytics/area-insights` | Complaints by geographic area |
| GET  | `/analytics/restaurant-insights` | Complaints by restaurant |

### Pillar 02 — Text/Chat Messages

| Method | Path | Description |
|---|---|---|
| GET  | `/api/v1/health` | Full health check (BQ + Gemini) |
| POST | `/api/v1/messages/upload` | Ingest batch of messages (JSON) |
| POST | `/api/v1/messages/upload/csv` | Ingest from CSV file |
| GET  | `/api/v1/messages` | List messages (filter: channel, zone, dates) |
| GET  | `/api/v1/messages/{id}` | Single message + classification |
| POST | `/api/v1/sentiment/classify` | Trigger Gemini classification |
| GET  | `/api/v1/sentiment/results` | Classification results with filters |
| GET  | `/api/v1/sentiment/accuracy` | Accuracy vs. labelled ground truth |
| GET  | `/api/v1/analytics/sentiment-trend` | Weekly % positive/neutral/negative |
| GET  | `/api/v1/analytics/top-negative-triggers` | Top 5 triggers (filter: merchant, zone, time) |
| GET  | `/api/v1/analytics/cross-channel` | Pillar 01 calls ↔ Pillar 02 text comparison |
| GET  | `/api/v1/analytics/intent-distribution` | Intent breakdown |
| GET  | `/api/v1/analytics/merchant-sentiment` | Sentiment per merchant |
| GET  | `/api/v1/analytics/zone-heatmap` | Negative sentiment by delivery zone |

---

## Tests

```bash
pytest tests/ -v
```

---

## Docker

```bash
docker build -t rafeeq-api .
docker run -p 8000:8000 \
  -e GEMINI_API_KEY=your_key \
  -v ~/.config/gcloud:/root/.config/gcloud:ro \
  rafeeq-api
```

---

## Project Structure

```
backend/
├── app/
│   ├── config.py               # Settings (pydantic-settings, loads .env)
│   ├── main.py                 # FastAPI app entry point
│   ├── models/
│   │   ├── enums.py            # Sentiment, intent, channel enums
│   │   └── schemas.py          # All Pydantic request/response models
│   ├── routers/
│   │   ├── health.py           # /health + /api/v1/health
│   │   ├── calls.py            # Pillar 01: /analyse, /predict
│   │   ├── call_analytics.py   # Pillar 01: /analytics/*
│   │   ├── messages.py         # Pillar 02: /api/v1/messages/*
│   │   ├── sentiment.py        # Pillar 02: /api/v1/sentiment/*
│   │   └── text_analytics.py   # Pillar 02: /api/v1/analytics/*
│   ├── services/
│   │   ├── bq_client.py        # Shared BigQuery client singleton
│   │   ├── bq_calls.py         # Pillar 01 BQ: table mgmt, save, enrich
│   │   ├── bq_text.py          # Pillar 02 BQ: all text dataset operations
│   │   ├── gemini_service.py   # Shared: model, semaphore, retry wrapper
│   │   ├── call_service.py     # Pillar 01: transcript classification prompt
│   │   ├── text_classifier.py  # Pillar 02: message classification prompt
│   │   ├── call_analytics_service.py  # Pillar 01 analytics queries
│   │   └── text_analytics_service.py  # Pillar 02 analytics aggregation
│   └── utils/
│       └── helpers.py          # PII redaction, text cleaning, datetime utils
├── tests/
├── scripts/
│   ├── seed_text_messages.py
│   └── run_batch_classify.py
├── requirements.txt
├── Dockerfile
└── .env.example
```
