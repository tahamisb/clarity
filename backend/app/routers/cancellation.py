"""
Cancellation-prediction endpoints — predictions (ML + Gemini), analytics
(exploration data + Gemini drivers report), interactive Gemini chat, and model
management. Mirrors the existing router conventions: thin handlers that delegate
to services and return plain dicts.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.cancellation import (
    BatchPredictRequest,
    CancellationChatRequest,
    PredictRequest,
)
from app.services import cancellation_service as svc
from app.services import zones
from app.services import predictor_service as predictor
from app.services import verticals
from app.services.predictor_service import ModelUnavailable

router = APIRouter(prefix="/api/cancellation", tags=["cancellation"])
logger = logging.getLogger(__name__)


def _model_guard(exc: ModelUnavailable):
    raise HTTPException(status_code=503, detail=str(exc))


# ===========================================================================
# Predictions
# ===========================================================================

# engine: "auto" (model if trained, else Gemini), "model" (ML only, 503 if untrained),
# or "gemini" (LLM estimate — works without a trained model).
_ENGINES = "^(auto|model|gemini)$"


@router.post("/predict")
async def predict(req: PredictRequest, engine: str = Query("auto", pattern=_ENGINES)):
    try:
        return await predictor.predict_one(req.order.model_dump(), engine=engine, with_gemini=True)
    except ModelUnavailable as exc:
        _model_guard(exc)


@router.post("/predict/batch")
async def predict_batch(req: BatchPredictRequest, engine: str = Query("auto", pattern=_ENGINES)):
    try:
        return await predictor.predict_batch([o.model_dump() for o in req.orders], engine=engine)
    except ModelUnavailable as exc:
        _model_guard(exc)


@router.get("/predict/live-queue")
async def live_queue(limit: int = Query(500, ge=1, le=500), engine: str = Query("auto", pattern=_ENGINES)):
    try:
        return await predictor.live_queue(limit, engine=engine)
    except ModelUnavailable as exc:
        _model_guard(exc)


# ===========================================================================
# Analytics
#
# All analytics endpoints accept an optional [start, end] date window
# (YYYY-MM-DD) so every chart/table re-aggregates over the selected range.
# Omitting both returns the full history.
# ===========================================================================

def _window(start: Optional[str], end: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Validate the date bounds (YYYY-MM-DD) and return them untouched."""
    for label, value in (("start", start), ("end", end)):
        if value is None:
            continue
        try:
            date.fromisoformat(value)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{label} must be a YYYY-MM-DD date")
    return start, end


def _vertical(vertical: Optional[str]) -> Optional[str]:
    """Whitelist-validate the vertical filter (safe to interpolate downstream)."""
    if vertical is not None and not verticals.is_valid(vertical):
        raise HTTPException(status_code=422, detail=f"vertical must be one of {list(verticals.VERTICALS)}")
    return vertical


def _zone(zone: Optional[str]) -> Optional[str]:
    """Whitelist-validate the zone filter (safe to interpolate downstream).

    An empty string or "all" means no zone predicate, not a zone named "".
    """
    if zone is None or zone == "" or zone == "all":
        return None
    if not zones.is_valid(zone):
        raise HTTPException(status_code=422, detail=f"unknown zone: {zone}")
    return zone


@router.get("/analytics/zones")
async def analytics_zones():
    """Zone vocabulary for the filter dropdowns — shared by every dashboard."""
    return {"zones": list(zones.all_zones())}


@router.get("/analytics/trend")
async def analytics_trend(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                          vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_trend(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/by-merchant")
async def analytics_by_merchant(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                                vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_by_merchant(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/by-zone")
async def analytics_by_zone(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                            vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_by_zone(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/by-time")
async def analytics_by_time(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                            vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_by_time(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/by-hour")
async def analytics_by_hour(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                            vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return {"by_hour": await svc.get_by_hour(*_window(start, end), _vertical(vertical), _zone(zone))}


@router.get("/analytics/by-day")
async def analytics_by_day(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                           vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_by_dow(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/by-order-size")
async def analytics_by_order_size(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                                  vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_by_order_size(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/by-actor")
async def analytics_by_actor(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                             vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_by_actor(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/crosstabs")
async def analytics_crosstabs(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                              vertical: Optional[str] = Query(None),
                            zone: Optional[str] = Query(None)):
    return await svc.get_crosstabs(*_window(start, end), _vertical(vertical), _zone(zone))


@router.get("/analytics/by-vertical")
async def analytics_by_vertical(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                                zone: Optional[str] = Query(None)):
    return await svc.get_by_vertical(*_window(start, end), _zone(zone))


@router.get("/analytics/drivers-report")
async def analytics_drivers_report(force: bool = Query(False)):
    return await svc.get_drivers_report(force=force)


@router.get("/analytics/threshold-analysis")
async def analytics_threshold():
    data = svc.load_threshold_analysis()
    if data is None:
        return {"available": False, "detail": "Train the model to generate threshold analysis."}
    return data


@router.get("/analytics/feature-importance")
async def analytics_feature_importance():
    data = svc.load_feature_importance()
    if data is None:
        return {"available": False, "detail": "Train the model to generate feature importance."}
    return data


@router.post("/analytics/refresh")
async def analytics_refresh():
    return await svc.refresh_all()


# ===========================================================================
# Gemini analysis
# ===========================================================================

@router.post("/chat")
async def chat(req: CancellationChatRequest):
    try:
        answer = await svc.answer_question(req.text)
        return {"answer": answer}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Cancellation chat failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/explain/{order_id}")
async def explain(order_id: str, engine: str = Query("auto", pattern=_ENGINES)):
    try:
        result = await predictor.explain_order(order_id, engine=engine)
    except ModelUnavailable as exc:
        _model_guard(exc)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found.")
    return result


# ===========================================================================
# Model management
# ===========================================================================

@router.get("/model/info")
async def model_info():
    return predictor.model_info()


@router.get("/model/health")
async def model_health():
    return predictor.model_health()


@router.post("/model/retrain")
async def model_retrain():
    """Retraining needs the production warehouse; scoring here is Gemini-only."""
    raise HTTPException(
        status_code=501,
        detail="Model retraining is unavailable on the local dataset — scoring runs on the Gemini engine.",
    )
