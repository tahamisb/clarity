"""
Rafeeq Call Analysis API
========================
FastAPI backend for call-centre transcript analysis.

Start with:
    uvicorn main:app --reload --port 8000
"""

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from dotenv import load_dotenv

load_dotenv()  # must run before any module that reads env vars is imported

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from analytics import get_analytics_summary, get_area_insights, get_restaurant_insights
from bigquery_client import ensure_table, enrich_orders, save_analysis
from gemini_client import analyse_transcript, chat_with_data

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
# urllib3 complains when many threads share one BigQuery client — harmless, silence it
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)


# Limit concurrent Gemini calls — avoids hammering the API and exhausting threads
_GEMINI_SEM = asyncio.Semaphore(5)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_table()
    yield


app = FastAPI(
    title="Rafeeq Call Analysis API",
    description="Analyse call-centre transcripts with Gemini and enrich via BigQuery.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class AnalyseRequest(BaseModel):
    transcript: str

    @field_validator("transcript")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("transcript cannot be empty")
        return v


class BatchAnalyseRequest(BaseModel):
    transcripts: List[str]

    @field_validator("transcripts")
    @classmethod
    def check_size(cls, v: list) -> list:
        if not v:
            raise ValueError("transcripts list is empty")
        if len(v) > 100:
            raise ValueError("maximum 100 transcripts per batch request")
        return v


class PredictRequest(BaseModel):
    transcript: str

    @field_validator("transcript")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("transcript cannot be empty")
        return v
        return v

class ChatMessage(BaseModel):
    role: str
    text: str
    image: Optional[Dict[str, Any]] = None

class ChatRequest(BaseModel):
    messages: List[ChatMessage]


# ---------------------------------------------------------------------------
# Core processing helper
# ---------------------------------------------------------------------------

async def _process(transcript: str) -> dict:
    async with _GEMINI_SEM:          # max 5 concurrent Gemini calls
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
        "enriched_orders": enriched_orders,
        "analysed_at": datetime.now(timezone.utc).isoformat(),
    }

    asyncio.create_task(save_analysis(result))
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyse")
async def analyse(req: AnalyseRequest):
    """
    Analyse a single transcript.

    Runs Gemini classification + entity extraction, then cross-references any
    extracted order IDs against BigQuery to return enriched order details.
    """
    return await _process(req.transcript)


@app.post("/analyse/batch")
async def analyse_batch(req: BatchAnalyseRequest):
    total = len(req.transcripts)
    logger.info("Batch started — %d transcript(s)", total)

    tasks = [_process(t) for t in req.transcripts]
    results = await asyncio.gather(*tasks, return_exceptions=True)

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


@app.post("/predict")
async def predict(req: PredictRequest):
    """
    Quick intent + sentiment classification without BigQuery enrichment.

    Suitable for real-time scoring during live calls.
    """
    analysis = await analyse_transcript(req.transcript)
    return {
        "intents": analysis["intents"],
        "sentiment": analysis["sentiment"],
        "sentiment_confidence": analysis["sentiment_confidence"],
    }


@app.get("/analytics/summary")
async def analytics_summary():
    """
    Aggregate metrics across all analysed calls stored in BigQuery.

    Returns intent distribution, sentiment trend by week, and top-10 topics
    ranked by frequency and by negative-sentiment concentration.
    """
    return await get_analytics_summary()


@app.get("/analytics/area-insights")
async def area_insights():
    """
    Complaint and sentiment patterns by geographic area.

    Combines areas extracted from transcripts with customer zones from vendor_kpi
    (matched via extracted order IDs) to surface delivery hotspots.
    """
    return await get_area_insights()


@app.get("/analytics/restaurant-insights")
async def restaurant_insights():
    """
    Support-call patterns grouped by restaurant.

    Combines restaurant names from transcripts with vendor_kpi data matched via
    order IDs, showing complaint rates, wrong-item rates, and average ratings.
    """
    return await get_restaurant_insights()

@app.post("/chat")
async def chat(req: ChatRequest):
    """
    Conversational endpoint powered by Gemini 3.5 Flash.
    Injects current dashboard analytics into context.
    """
    try:
        summary = await get_analytics_summary()
    except Exception as e:
        logger.error(f"Failed to fetch analytics summary for chat: {e}")
        summary = {}
        
    try:
        area = await get_area_insights()
    except Exception as e:
        logger.error(f"Failed to fetch area insights for chat: {e}")
        area = []
        
    try:
        restaurant = await get_restaurant_insights()
    except Exception as e:
        logger.error(f"Failed to fetch restaurant insights for chat: {e}")
        restaurant = []
        
    context_data = {
        "analytics_summary": summary,
        "area_insights": area,
        "restaurant_insights": restaurant,
    }
    
    messages = [m.model_dump() for m in req.messages]
    
    try:
        response_text = await chat_with_data(messages, context_data)
        return {"text": response_text}
    except Exception as e:
        logger.exception("Chatbot request failed")
        raise HTTPException(status_code=500, detail=str(e))

