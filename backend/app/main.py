"""
Clarity Analytics API — Unified Backend
=======================================
Pillar 01 (Call Analysis) + Pillar 02 (Text/Chat Sentiment) in one service.

Run:
    uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import call_analytics, calls, health, messages, sentiment, text_analytics, chat_analytics
from app.services.local_db import DB_PATH, ping as db_ping

settings = get_settings()

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Cache warmer — re-runs the default-filter dashboard queries every 4 minutes
# (just inside the 5-min TTLs) so no user ever pays a cold hit. Gated on recent
# traffic: an idle server warms once at startup then stops re-querying.
# ---------------------------------------------------------------------------

_WARM_EVERY_S = 240
_IDLE_AFTER_S = 600
_last_request_at = time.time()


async def _warm_cycle() -> None:
    from app.services import call_analytics_service as calls_svc
    from app.services import text_analytics_service as text_svc
    from app.services.db_chat_analytics import get_contact_rate
    from app.services.db_text import query_classifications

    coros = [
        # Support Messages page, default window ("all") + default SLA thresholds
        text_svc.get_sentiment_trend(),
        text_svc.get_top_negative_triggers(),
        text_svc.get_cross_channel(),
        text_svc.get_zone_heatmap(),
        text_svc.get_message_overview(),
        text_svc.get_sla_breaches(),
        query_classifications(page=1, page_size=1000),
        # Call Intelligence page
        calls_svc.get_calls(1, 1000),
        calls_svc.get_analytics_summary(),
        # CX dashboard contact-rate (pinned to the only month with order data)
        get_contact_rate("2026-06-01", "2026-06-30"),
    ]
    try:
        from app.services import cancellation_service as cancel_svc
        from app.services import predictor_service as predictor
        coros += [
            cancel_svc.get_trend(None, None, None),
            cancel_svc.get_by_merchant(None, None, None),
            cancel_svc.get_by_zone(None, None, None),
            cancel_svc.get_by_time(None, None, None),
            cancel_svc.get_by_dow(None, None, None),
            cancel_svc.get_by_order_size(None, None, None),
            cancel_svc.get_by_actor(None, None, None),
            cancel_svc.get_crosstabs(None, None, None),
            cancel_svc.get_by_vertical(None, None),
            # Reads the pre-seeded predictions; only orders with no stored score
            # would reach Gemini, and the generator seeds every live order.
            predictor.live_queue(500, engine="gemini"),
        ]
    except Exception:  # noqa: BLE001 — ML deps not installed; warm the rest
        pass

    results = await asyncio.gather(*coros, return_exceptions=True)
    failed = [r for r in results if isinstance(r, Exception)]
    if failed:
        logger.warning("Cache warm: %d/%d queries failed (%s)", len(failed), len(results), failed[0])
    else:
        logger.info("Cache warm: %d entries refreshed.", len(results))


async def _warm_loop() -> None:
    while True:
        try:
            await _warm_cycle()
        except Exception:  # noqa: BLE001
            logger.exception("Cache warm cycle crashed; retrying next tick.")
        await asyncio.sleep(_WARM_EVERY_S)
        # Idle gate: keep sleeping until someone is actually using the API.
        while time.time() - _last_request_at > _IDLE_AFTER_S:
            await asyncio.sleep(_WARM_EVERY_S)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not DB_PATH.exists():
        logger.error(
            "Local warehouse missing at %s — run: python scripts/generate_mock_db.py", DB_PATH
        )
    elif db_ping():
        logger.info("Local warehouse ready at %s", DB_PATH)
    warmer = asyncio.create_task(_warm_loop())  # don't block startup on the first warm
    logger.info("Clarity Unified API ready on port %d", settings.app_port)
    yield
    warmer.cancel()


app = FastAPI(
    title="Clarity Analytics API",
    description=(
        "Unified backend for call-centre transcript analysis (Pillar 01) "
        "and text/chat sentiment classification (Pillar 02)."
    ),
    version="3.0.0",
    lifespan=lifespan,
)

@app.middleware("http")
async def _touch_activity(request: Request, call_next):
    global _last_request_at
    _last_request_at = time.time()
    return await call_next(request)


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
