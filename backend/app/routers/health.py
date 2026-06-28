import asyncio
import logging

import google.generativeai as genai
from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import HealthResponse
from app.services import bq_text
from app.services.call_analytics_service import clear_cache as clear_call_cache
from app.services.cancellation_service import clear_cache as clear_cancel_cache

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


async def _check_gemini() -> str:
    try:
        settings = get_settings()
        genai.configure(api_key=settings.gemini_api_key)
        loop = asyncio.get_running_loop()
        models = await loop.run_in_executor(None, lambda: list(genai.list_models()))
        return "ok" if models else "no models returned"
    except Exception as exc:
        return f"error: {exc}"


@router.post("/api/cache/clear")
async def clear_caches():
    """Drop the analytics TTL caches so the next dashboard fetch re-queries
    BigQuery. Called by the frontend's refresh path (manual button + auto-refresh)
    so a refresh always reflects the latest rows, not the 5-min-stale aggregate.
    ponytail: nukes the shared in-process cache for all callers; fine for an
    internal dashboard — repopulates on the next fetch. Per-request bypass if it
    ever needs to not affect concurrent users."""
    clear_call_cache()
    clear_cancel_cache()
    return {"status": "cleared"}


@router.get("/health")
async def health_legacy():
    """Legacy health endpoint (Pillar 01 frontend compatibility)."""
    return {"status": "ok"}


@router.get("/api/v1/health", response_model=HealthResponse)
async def health():
    """Full health check — BigQuery and Gemini reachability."""
    bq_ok, gemini_status = await asyncio.gather(bq_text.ping(), _check_gemini())
    return HealthResponse(
        status="ok" if bq_ok and gemini_status == "ok" else "degraded",
        bigquery="ok" if bq_ok else "error",
        gemini=gemini_status,
    )
