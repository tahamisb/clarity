"""
Pillar 01 — call transcript classification via Gemini.

Implements the same logic as the old gemini_client.py, now using the shared gemini_service.
"""

import json
import logging
import re

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
- Choose one or more intents from the allowed list. Use general_inquiry ONLY when the
  transcript genuinely has no identifiable subject — always prefer a specific intent.
- "reason" MUST name the concrete thing the customer called about (the trigger), in
  3-8 words, e.g. "Order delivered to the wrong building", "Charged twice for one order",
  "Driver never collected the order". NEVER answer with a generic label like "General
  inquiry", "Support call", "Customer service" or a restatement of the intent.

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
  "reason": "<3-8 words naming the specific reason for the call>",
  "summary": "<one concise sentence describing what the call was about>"
}

TRANSCRIPT:
"""


# Filler that makes a reason read as generic rather than specific.
_GENERIC_REASON = re.compile(
    r"^(general|generic|support|customer service|customer care|misc\w*|other|"
    r"inquiry|enquiry|general inquiry|general enquiry|n/?a|unknown)$",
    re.IGNORECASE,
)
_LEAD_FILLER = re.compile(
    r"^(the\s+)?(customer|caller|client)\s+(called|phoned|contacted\s+\w+)\s+"
    r"(to|about|regarding|because)\s+|^general\s+|^routine\s+",
    re.IGNORECASE,
)


def derive_reason(reason: str, summary: str, intent: str) -> str:
    """Specific, human-readable reason for the call.

    Prefers the model's `reason`; falls back to the leading clause of the summary
    (which names the trigger), then to the intent label. Never returns "General".
    """
    for candidate in (reason, summary):
        text = (candidate or "").strip()
        if not text:
            continue
        # Leading clause only — "Duplicate charge reported; refund issued." → "Duplicate charge reported"
        text = re.split(r"[;.]", text)[0].strip()
        text = _LEAD_FILLER.sub("", text).strip(" .,-")
        if text and not _GENERIC_REASON.match(text):
            return text[0].upper() + text[1:]
    return intent.replace("_", " ").title()


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
        "reason": derive_reason(str(raw.get("reason", "")), raw.get("summary", ""), intents[0]),
    }


async def analyse_transcript(transcript: str) -> dict:
    raw_text = await call_with_retry(_PROMPT + transcript)
    return _normalise(json.loads(raw_text))
