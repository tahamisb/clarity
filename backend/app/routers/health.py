import asyncio
import logging

import google.generativeai as genai
from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import HealthResponse
from app.services import bq_text

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
