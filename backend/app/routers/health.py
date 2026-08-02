import asyncio
import logging

from fastapi import APIRouter

from app.models.schemas import HealthResponse
from app.services import db_text
from app.services import ttl_cache
from app.services.call_analytics_service import clear_cache as clear_call_cache
from app.services.cancellation_service import clear_cache as clear_cancel_cache
from app.services.gemini_service import get_client as get_gemini_client

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


async def _check_gemini() -> str:
    try:
        loop = asyncio.get_running_loop()
        models = await loop.run_in_executor(None, lambda: list(get_gemini_client().models.list()))
        return "ok" if models else "no models returned"
    except Exception as exc:
        return f"error: {exc}"


@router.post("/api/cache/clear")
async def clear_caches():
    """Drop the analytics TTL caches so the next dashboard fetch re-queries the
    warehouse. Called only by the frontend's manual Refresh button (auto-refresh
    rides the warm caches).
    ponytail: nukes the shared in-process cache for all callers; fine for an
    internal dashboard — repopulates on the next fetch. Per-request bypass if it
    ever needs to not affect concurrent users."""
    clear_call_cache()
    clear_cancel_cache()
    ttl_cache.clear_all()
    return {"status": "cleared"}


@router.get("/health")
async def health_legacy():
    """Legacy health endpoint (Pillar 01 frontend compatibility)."""
    return {"status": "ok"}


@router.get("/api/v1/health", response_model=HealthResponse)
async def health():
    """Full health check — local warehouse and Gemini reachability."""
    db_ok, gemini_status = await asyncio.gather(db_text.ping(), _check_gemini())
    return HealthResponse(
        status="ok" if db_ok and gemini_status == "ok" else "degraded",
        database="ok" if db_ok else "error",
        gemini=gemini_status,
    )
