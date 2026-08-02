"""
Pillar 01 — call transcript classification via Gemini.

Implements the same logic as the old gemini_client.py, now using the shared gemini_service.
"""

import json
import logging

from app.services.gemini_service import call_with_retry

logger = logging.getLogger(__name__)

VALID_INTENTS = {
    "order_status", "refund_request", "complaint", "cancellation", "escalation",
    "praise", "delivery_issue", "wrong_item", "payment_issue", "account_issue", "general_inquiry",
}
VALID_SENTIMENTS = {"positive", "neutral", "negative"}

_PROMPT = """\
You are an AI analyst for Clarity, a food-delivery company in Qatar. Analyse the call-centre transcript below and return structured data.

RULES:
- Intent and sentiment labels MUST always be in English regardless of the transcript language.
- The transcript may be in Arabic, English, or a mix — analyse it as-is.
- Extract order IDs in any format (e.g. "order 12345", "#12345", Arabic numerals "١٢٣٤٥").
- Use empty arrays [] for entity fields where nothing relevant is found.
- sentiment_confidence is a float between 0.0 and 1.0.
- Choose one or more intents from the allowed list; prefer specificity over general_inquiry.

ALLOWED INTENTS (use one or more):
order_status, refund_request, complaint, cancellation, escalation, praise,
delivery_issue, wrong_item, payment_issue, account_issue, general_inquiry

ALLOWED SENTIMENTS (use exactly one):
positive, neutral, negative

RESPOND WITH ONLY this JSON structure (no markdown, no explanation):
{
  "intents": ["<intent>"],
  "sentiment": "<sentiment>",
  "sentiment_confidence": 0.85,
  "entities": {
    "order_ids": [],
    "restaurant_names": [],
    "areas": [],
    "product_names": [],
    "qar_amounts": []
  },
  "summary": "<one concise sentence describing what the call was about>"
}

TRANSCRIPT:
"""


def _normalise(raw: dict) -> dict:
    intents = raw.get("intents", [])
    if isinstance(intents, str):
        intents = [intents]
    intents = [i.lower() for i in intents if i.lower() in VALID_INTENTS]
    if not intents:
        intents = ["general_inquiry"]

    sentiment = raw.get("sentiment", "neutral").lower()
    if sentiment not in VALID_SENTIMENTS:
        sentiment = "neutral"

    confidence = max(0.0, min(1.0, float(raw.get("sentiment_confidence", 0.5))))

    entities = raw.get("entities", {})
    return {
        "intents": intents,
        "sentiment": sentiment,
        "sentiment_confidence": confidence,
        "entities": {
            "order_ids": [str(x) for x in entities.get("order_ids", [])],
            "restaurant_names": list(entities.get("restaurant_names", [])),
            "areas": list(entities.get("areas", [])),
            "product_names": list(entities.get("product_names", [])),
            "qar_amounts": list(entities.get("qar_amounts", [])),
        },
        "summary": str(raw.get("summary", "")),
    }


async def analyse_transcript(transcript: str) -> dict:
    raw_text = await call_with_retry(_PROMPT + transcript)
    return _normalise(json.loads(raw_text))
