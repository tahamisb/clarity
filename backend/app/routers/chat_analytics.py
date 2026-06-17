import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from app.services import bq_chat_analytics as svc

router = APIRouter(prefix="/api/messages", tags=["chat-analytics"])
logger = logging.getLogger(__name__)

@router.get("/stats")
async def get_stats():
    try:
        return await svc.get_messages_stats()
    except Exception as exc:
        logger.error(f"Error in /stats: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/list")
async def get_list(
    channel: Optional[str] = Query(None),
    intent: Optional[str] = Query(None),
    sentiment: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    time_of_day: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    try:
        return await svc.get_messages_list(channel, intent, sentiment, zone, time_of_day, page, limit)
    except Exception as exc:
        logger.error(f"Error in /list: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/triggers")
async def get_triggers():
    try:
        return await svc.get_top_triggers()
    except Exception as exc:
        logger.error(f"Error in /triggers: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/sentiment-trend")
async def get_sentiment_trend():
    try:
        return await svc.get_sentiment_trend()
    except Exception as exc:
        logger.error(f"Error in /sentiment-trend: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/cross-channel")
async def get_cross_channel():
    try:
        return await svc.get_cross_channel()
    except Exception as exc:
        logger.error(f"Error in /cross-channel: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/{chat_id}")
async def get_chat(chat_id: str):
    try:
        chat = await svc.get_chat_detail(chat_id)
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
        return chat
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error in /{chat_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
