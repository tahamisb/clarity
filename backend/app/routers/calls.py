"""
Pillar 01 — call analysis endpoints.
Paths kept identical to the original backend so the existing frontend needs no changes.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException

from app.models.schemas import AnalyseRequest, BatchAnalyseRequest, PredictRequest
from app.services.call_service import analyse_transcript
from app.services.db_calls import enrich_orders, save_call_analysis
from app.services.call_analytics_service import clear_cache

router = APIRouter(tags=["calls"])
logger = logging.getLogger(__name__)

_GEMINI_SEM = asyncio.Semaphore(5)


async def _process(transcript: str) -> dict:
    analysis = await analyse_transcript(transcript)

    enriched_orders: list = []
    if analysis["entities"]["order_ids"]:
        enriched_orders = await enrich_orders(analysis["entities"]["order_ids"])

    result = {
        "call_id": str(uuid.uuid4()),
        "transcript": transcript,
        "intents": analysis["intents"],
        "sentiment": analysis["sentiment"],
        "sentiment_confidence": analysis["sentiment_confidence"],
        "entities": analysis["entities"],
        "summary": analysis["summary"],
        "reason": analysis["reason"],
        "enriched_orders": enriched_orders,
        "analysed_at": datetime.now(timezone.utc).isoformat(),
    }
    asyncio.create_task(save_call_analysis(result))
    clear_cache()  # new rows written → drop stale aggregates/call-list pages
    return result


@router.post("/analyse")
async def analyse(req: AnalyseRequest):
    return await _process(req.transcript)


@router.post("/analyse/batch")
async def analyse_batch(req: BatchAnalyseRequest):
    total = len(req.transcripts)
    logger.info("Batch started — %d transcript(s)", total)
    results = await asyncio.gather(*[_process(t) for t in req.transcripts], return_exceptions=True)

    output = []
    for idx, r in enumerate(results):
        if isinstance(r, Exception):
            logger.error("Batch item %d failed: %s", idx, r)
            output.append({"transcript_index": idx, "error": str(r)})
        else:
            output.append(r)

    ok = sum(1 for r in output if "error" not in r)
    logger.info("Batch complete — %d/%d succeeded", ok, total)
    return {"total": len(output), "errors": total - ok, "results": output}


@router.post("/predict")
async def predict(req: PredictRequest):
    analysis = await analyse_transcript(req.transcript)
    return {
        "intents": analysis["intents"],
        "sentiment": analysis["sentiment"],
        "sentiment_confidence": analysis["sentiment_confidence"],
    }
