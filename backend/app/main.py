"""
Rafeeq Analytics API — Unified Backend
=======================================
Pillar 01 (Call Analysis) + Pillar 02 (Text/Chat Sentiment) in one service.

Run:
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"""

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import call_analytics, calls, chat, health, messages, sentiment, text_analytics, chat_analytics
from app.services.bq_calls import ensure_call_table
from app.services.bq_text import bootstrap_text_tables

settings = get_settings()

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Bootstrapping BigQuery tables…")
    await ensure_call_table()      # Pillar 01: reports.call_analysis
    await bootstrap_text_tables()  # Pillar 02: text_sentiment.*
    logger.info("Rafeeq Unified API ready on port %d", settings.app_port)
    yield


app = FastAPI(
    title="Rafeeq Analytics API",
    description=(
        "Unified backend for call-centre transcript analysis (Pillar 01) "
        "and text/chat sentiment classification (Pillar 02)."
    ),
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pillar 01 — original paths (frontend compatibility)
app.include_router(health.router)
app.include_router(calls.router)
app.include_router(call_analytics.router)
app.include_router(chat.router)

# Pillar 02 — versioned API paths
app.include_router(messages.router)
app.include_router(sentiment.router)
app.include_router(text_analytics.router)
app.include_router(chat_analytics.router)

# Pillar 03 — cancellation prediction (ML + Gemini)
# Imported defensively: the cancellation feature pulls in ML libraries
# (pandas/numpy/xgboost/…). If they aren't installed yet, the rest of the API
# must still boot — run `pip install -r requirements.txt` to enable it.
try:
    from app.routers import cancellation
    app.include_router(cancellation.router)
    logger.info("Cancellation prediction feature registered.")
except Exception as exc:  # noqa: BLE001
    logger.warning("Cancellation feature disabled — install ML dependencies (%s).", exc)
