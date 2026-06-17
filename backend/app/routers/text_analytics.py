import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    CrossChannelResponse, IntentDistributionResponse, MerchantSentimentResponse,
    SentimentTrendResponse, TopTriggersResponse, ZoneHeatmapResponse,
)
from app.services import text_analytics_service as svc

router = APIRouter(prefix="/api/v1/analytics", tags=["text-analytics"])
logger = logging.getLogger(__name__)


@router.get("/sentiment-trend", response_model=SentimentTrendResponse)
async def sentiment_trend():
    try:
        return await svc.get_sentiment_trend()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/top-negative-triggers", response_model=TopTriggersResponse)
async def top_negative_triggers(
    merchant: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    time_of_day: Optional[str] = Query(None, description="morning | afternoon | evening | night"),
):
    if time_of_day not in {"morning", "afternoon", "evening", "night", None}:
        raise HTTPException(status_code=422, detail="time_of_day must be: morning, afternoon, evening, or night")
    try:
        return await svc.get_top_negative_triggers(merchant=merchant, zone=zone, time_of_day=time_of_day)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/cross-channel", response_model=CrossChannelResponse)
async def cross_channel():
    try:
        return await svc.get_cross_channel()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/intent-distribution", response_model=IntentDistributionResponse)
async def intent_distribution():
    try:
        return await svc.get_intent_distribution()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/merchant-sentiment", response_model=MerchantSentimentResponse)
async def merchant_sentiment():
    try:
        return await svc.get_merchant_sentiment()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/zone-heatmap", response_model=ZoneHeatmapResponse)
async def zone_heatmap():
    try:
        return await svc.get_zone_heatmap()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
