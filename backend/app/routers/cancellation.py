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
from app.services import predictor_service as predictor
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
async def live_queue(limit: int = Query(50, ge=1, le=200), engine: str = Query("auto", pattern=_ENGINES)):
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


@router.get("/analytics/trend")
async def analytics_trend(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_trend(*_window(start, end))


@router.get("/analytics/by-merchant")
async def analytics_by_merchant(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_by_merchant(*_window(start, end))


@router.get("/analytics/by-zone")
async def analytics_by_zone(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_by_zone(*_window(start, end))


@router.get("/analytics/by-time")
async def analytics_by_time(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_by_time(*_window(start, end))


@router.get("/analytics/by-day")
async def analytics_by_day(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_by_dow(*_window(start, end))


@router.get("/analytics/by-order-size")
async def analytics_by_order_size(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_by_order_size(*_window(start, end))


@router.get("/analytics/by-actor")
async def analytics_by_actor(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_by_actor(*_window(start, end))


@router.get("/analytics/crosstabs")
async def analytics_crosstabs(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return await svc.get_crosstabs(*_window(start, end))


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
    """
    Kick off the training script as a detached background process. Training is a
    long-running offline job (BigQuery pull + Optuna), so this returns immediately.
    """
    script = Path(__file__).resolve().parents[2] / "scripts" / "train_cancellation_model.py"
    if not script.exists():
        raise HTTPException(status_code=500, detail=f"Training script not found at {script}")
    try:
        subprocess.Popen(
            [sys.executable, str(script)],
            cwd=str(script.parents[1]),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to start training: {exc}")
    return {"status": "started", "detail": "Training launched in the background. Poll /model/info for completion."}
