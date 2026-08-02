"""
Pillar 02 — customer support message classification via Gemini.
"""

import json
import logging
from typing import Optional

from app.config import get_settings
from app.models.enums import TextIntentEnum, TextSentimentEnum
from app.services.gemini_service import call_with_retry

logger = logging.getLogger(__name__)

_VALID_SENTIMENTS = {e.value for e in TextSentimentEnum}
_VALID_INTENTS = {e.value for e in TextIntentEnum}

_PROMPT = """\
You are a customer support message classifier for Clarity, a food and grocery delivery platform in Qatar.

Classify the following customer message. The message may be in English, Arabic, or a mix — analyse it as-is.
Return ONLY valid JSON with exactly these fields (no markdown, no explanation):
- sentiment: one of "positive", "neutral", "negative"
- sentiment_confidence: float 0.0 to 1.0
- intent: one of "complaint", "refund", "order_query", "cancellation_request", "praise"
- intent_confidence: float 0.0 to 1.0
- negative_trigger: if sentiment is "negative", a short English phrase describing the trigger (e.g., "late delivery", "wrong item", "rude driver"). null if not negative.

EXAMPLES:

Message: "Where is my order? It's been 2 hours and nobody is answering!"
{{"sentiment":"negative","sentiment_confidence":0.95,"intent":"order_query","intent_confidence":0.90,"negative_trigger":"late delivery"}}

Message: "Thank you, the driver was very polite and the food arrived hot"
{{"sentiment":"positive","sentiment_confidence":0.96,"intent":"praise","intent_confidence":0.93,"negative_trigger":null}}

Message: "I want to cancel my order please"
{{"sentiment":"neutral","sentiment_confidence":0.72,"intent":"cancellation_request","intent_confidence":0.95,"negative_trigger":null}}

Message: "I was charged twice for the same order, please refund me"
{{"sentiment":"negative","sentiment_confidence":0.88,"intent":"refund","intent_confidence":0.92,"negative_trigger":"double charge"}}

Message: "أين طلبي؟ مضى أكثر من ساعة ولم يصل"
{{"sentiment":"negative","sentiment_confidence":0.91,"intent":"order_query","intent_confidence":0.89,"negative_trigger":"late delivery"}}

Now classify this message:
Message: "{message_text}"
"""


def _normalise(raw: dict) -> dict:
    sentiment = str(raw.get("sentiment", "neutral")).lower()
    if sentiment not in _VALID_SENTIMENTS:
        sentiment = "neutral"

    intent = str(raw.get("intent", "order_query")).lower()
    if intent not in _VALID_INTENTS:
        intent = "order_query"

    s_conf = max(0.0, min(1.0, float(raw.get("sentiment_confidence", 0.5))))
    i_conf = max(0.0, min(1.0, float(raw.get("intent_confidence", 0.5))))

    trigger: Optional[str] = raw.get("negative_trigger")
    if sentiment != "negative":
        trigger = None
    elif trigger is not None:
        trigger = str(trigger).strip()[:200] or None

    return {
        "sentiment": sentiment,
        "sentiment_confidence": s_conf,
        "intent": intent,
        "intent_confidence": i_conf,
        "negative_trigger": trigger,
    }


async def classify_message(text: str) -> dict:
    raw_text = await call_with_retry(
        _PROMPT.format(message_text=text), model=get_settings().gemini_classify_model
    )
    return _normalise(json.loads(raw_text))

_CHAT_PROMPT = """\
You are a customer support analyst for Clarity, a food and grocery delivery platform in Qatar.

Analyse the following customer support messages and return ONLY a valid JSON object with no extra text, no markdown, no explanation.

Customer messages:
\"\"\"
{cleaned_customer_text}
\"\"\"

Return exactly this JSON structure:
{{
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": <number between 0 and 1>,
  "intent": "complaint" | "refund" | "order_query" | "cancellation" | "praise" | "escalation",
  "negative_trigger": "<short phrase describing the main issue, or null if not negative>"
}}
"""

def _normalise_chat(raw: dict) -> dict:
    # ~0.1% of responses arrive as a single-element array wrapping the object
    if isinstance(raw, list):
        raw = next((x for x in raw if isinstance(x, dict)), {})
    sentiment = str(raw.get("sentiment", "neutral")).lower()
    if sentiment not in _VALID_SENTIMENTS:
        sentiment = "neutral"

    intent_raw = str(raw.get("intent", "order_query")).lower()
    # Map cancellation to our enum's cancellation_request for compatibility
    if intent_raw == "cancellation":
        intent_raw = "cancellation_request"
        
    if intent_raw not in _VALID_INTENTS:
        intent_raw = "order_query"

    s_conf = max(0.0, min(1.0, float(raw.get("confidence", 0.5))))

    trigger: Optional[str] = raw.get("negative_trigger")
    if sentiment != "negative":
        trigger = None
    elif trigger is not None:
        trigger = str(trigger).strip()[:200] or None

    return {
        "sentiment": sentiment,
        "sentiment_confidence": s_conf,
        "intent": intent_raw,
        "intent_confidence": 1.0,  # Chat prompt doesn't ask for intent_confidence, default to 1.0
        "negative_trigger": trigger,
    }


async def classify_chat_messages(cleaned_text: str) -> dict:
    raw_text = await call_with_retry(
        _CHAT_PROMPT.format(cleaned_customer_text=cleaned_text),
        model=get_settings().gemini_classify_model,
    )
    return _normalise_chat(json.loads(raw_text))

