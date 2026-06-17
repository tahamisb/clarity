import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.config import get_settings
from app.models.schemas import (
    AccuracyResponse, ClassificationWithMessage, ClassifyRequest, ClassifyResponse,
    MessageResponse, SentimentResultsResponse, TextClassificationResponse,
)
from app.services import bq_text as bq
from app.services.text_analytics_service import get_accuracy
from app.services.text_classifier import classify_message
from app.utils.helpers import utcnow_iso

router = APIRouter(prefix="/api/v1/sentiment", tags=["sentiment"])
logger = logging.getLogger(__name__)


async def _classify_one(message_id: str, content: str, model_version: str) -> dict:
    result = await classify_message(content)
    return {
        "classification_id": str(uuid.uuid4()),
        "message_id": message_id,
        **result,
        "model_version": model_version,
        "classified_at": utcnow_iso(),
    }


@router.post("/classify", response_model=ClassifyResponse, status_code=status.HTTP_202_ACCEPTED)
async def classify(req: ClassifyRequest):
    settings = get_settings()
    target_ids = req.message_ids or await bq.get_unclassified_message_ids(limit=500)
    if not target_ids:
        return ClassifyResponse(total=0, classified=0, failed=0, failed_message_ids=[])

    messages = await bq.get_messages_by_ids(target_ids)
    msg_map = {m["message_id"]: m["content"] for m in messages}
    model_version = settings.gemini_model
    classified, failed_ids = 0, []

    for i in range(0, len(target_ids), req.batch_size):
        batch = target_ids[i : i + req.batch_size]
        tasks, valid_ids = [], []
        for mid in batch:
            content = msg_map.get(mid)
            if not content:
                failed_ids.append(mid)
                continue
            valid_ids.append(mid)
            tasks.append(_classify_one(mid, content, model_version))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        good_rows: list[dict] = []
        for mid, r in zip(valid_ids, results):
            if isinstance(r, Exception):
                logger.error("classify %s: %s", mid, r)
                failed_ids.append(mid)
            else:
                good_rows.append(r)
                classified += 1

        if good_rows:
            try:
                await bq.insert_classifications(good_rows)
            except Exception as exc:
                logger.error("BQ insert batch failed: %s", exc)
                failed_ids.extend(r["message_id"] for r in good_rows)
                classified -= len(good_rows)

        if i + req.batch_size < len(target_ids):
            await asyncio.sleep(settings.classify_batch_delay_s)

    return ClassifyResponse(total=len(target_ids), classified=classified,
                            failed=len(failed_ids), failed_message_ids=failed_ids)


@router.get("/results", response_model=SentimentResultsResponse)
async def get_results(
    sentiment: Optional[str] = Query(None),
    intent: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    merchant: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    try:
        total, rows = await bq.query_classifications(
            sentiment=sentiment, intent=intent, zone=zone, merchant=merchant,
            from_date=from_date, to_date=to_date, page=page, page_size=page_size,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    items = []
    for r in rows:
        clf = TextClassificationResponse(
            classification_id=r["classification_id"], message_id=r["message_id"],
            sentiment=r["sentiment"], sentiment_confidence=float(r["sentiment_confidence"]),
            intent=r["intent"], intent_confidence=float(r["intent_confidence"]),
            negative_trigger=r.get("negative_trigger"), model_version=r["model_version"],
            classified_at=str(r["classified_at"]),
        )
        msg = MessageResponse(
            message_id=r["message_id"], customer_id=r.get("customer_id"), content=r["content"],
            source_channel=r["source_channel"], merchant_name=r.get("merchant_name"),
            zone=r.get("zone"), created_at=str(r.get("msg_created_at", "")),
            ingested_at=str(r.get("msg_ingested_at", "")),
        )
        items.append(ClassificationWithMessage(classification=clf, message=msg))

    return SentimentResultsResponse(total=total, page=page, page_size=page_size, items=items)


@router.get("/accuracy", response_model=AccuracyResponse)
async def accuracy():
    try:
        return await get_accuracy()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
