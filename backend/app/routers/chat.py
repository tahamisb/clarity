import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.call_analytics_service import (
    get_analytics_summary,
    get_area_insights,
    get_restaurant_insights,
)
from app.services.bq_chat_analytics import (
    get_messages_stats,
    get_top_triggers,
    get_sentiment_trend,
    get_cross_channel,
)
from app.services.vendor_kpi_service import get_vendor_kpi_context
from app.services.chat_service import chat_with_data

router = APIRouter(tags=["chat"])
logger = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: str  # "user" or "bot"
    text: str
    image: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


async def _safe(coro, fallback):
    try:
        return await coro
    except Exception as exc:
        logger.warning("Chat context fetch failed: %s", exc)
        return fallback


@router.post("/chat")
async def chat(req: ChatRequest):
    """
    Conversational endpoint powered by Gemini.
    Fetches all analytics sources in parallel and injects them as grounded context.
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages list cannot be empty")

    # Fetch all data in parallel — failures are non-fatal
    (
        call_summary,
        area_insights,
        restaurant_insights,
        message_stats,
        top_triggers,
        sentiment_trend,
        cross_channel,
        vendor_kpi,
    ) = await asyncio.gather(
        _safe(get_analytics_summary(), {}),
        _safe(get_area_insights(), {}),
        _safe(get_restaurant_insights(), {}),
        _safe(get_messages_stats(), {}),
        _safe(get_top_triggers(), []),
        _safe(get_sentiment_trend(), []),
        _safe(get_cross_channel(), []),
        _safe(get_vendor_kpi_context(), {}),
    )

    context_data = {
        "call_analytics": call_summary,
        "area_insights": area_insights,
        "restaurant_insights_from_calls": restaurant_insights,
        "text_message_stats": message_stats,
        "top_negative_triggers": top_triggers,
        "sentiment_trend_by_week": sentiment_trend,
        "cross_channel_intent_comparison": cross_channel,
        "vendor_kpi": vendor_kpi,
    }

    messages = [m.model_dump() for m in req.messages]

    try:
        text = await chat_with_data(messages, context_data)
        return {"text": text}
    except Exception as exc:
        logger.exception("Chatbot request failed")
        raise HTTPException(status_code=500, detail=str(exc))
