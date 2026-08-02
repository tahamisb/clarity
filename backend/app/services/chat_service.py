"""
Conversational Gemini service for the /chat endpoint.
Uses a separate model instance without JSON mode so responses are natural text.
"""

import asyncio
import json
import logging
from typing import Any, Optional

import google.generativeai as genai  # noqa: F401 — used via genai.configure / GenerativeModel

from app.config import get_settings

logger = logging.getLogger(__name__)

_chat_model: Optional[genai.GenerativeModel] = None


def _get_chat_model() -> genai.GenerativeModel:
    global _chat_model
    if _chat_model is None:
        s = get_settings()
        genai.configure(api_key=s.gemini_api_key)
        _chat_model = genai.GenerativeModel(
            model_name=s.gemini_model,
            generation_config={"temperature": 0.7},
        )
    return _chat_model


SYSTEM_PROMPT = """\
You are **Clarity Intelligence**, an expert analytics assistant for Clarity — a food-delivery platform operating across Qatar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA ACCESS — READ THIS CAREFULLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You do NOT have direct database access. You cannot run SQL queries.
All data you see has already been pre-queried and injected into this conversation.
You MUST ONLY reference facts that appear in the provided JSON context.
NEVER invent table names, column names, queries, or statistics that are not in the data.
If data is missing, say "I don't have that data available" — do not guess.

REAL DATA SOURCES (for your awareness only — do not invent queries against these):
• `long-ceiling-343505.reports.call_analysis`  — Gemini-analysed call-centre transcripts
    Fields: call_id, transcript, primary_intent, sentiment, sentiment_confidence,
            areas (JSON array), order_ids (JSON array), restaurant_names (JSON array),
            summary, analysed_at
• `long-ceiling-343505.reports.vendor_kpi`  — raw order/vendor operational data
    Fields: id, restaurant_name, customer_location, order_status, cancelled_by_txt,
            cancel_comment, preparing_time_min, Driver_to_vendor_min,
            outForDelivrey_to_delivred_min, since_create_til_delivred_min,
            total_order_value, feedback_delivery_rating, order_placement_date
• `long-ceiling-343505.reports.messages`  — inbound customer text/chat messages
    Fields: message_id, customer_id, content, source_channel, merchant_name, zone, created_at
• `long-ceiling-343505.reports.classifications`  — Gemini sentiment/intent on each message
    Fields: classification_id, message_id, sentiment, intent, negative_trigger, classified_at

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATTING RULES — follow strictly
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Always respond in rich GitHub-Flavored Markdown.
- Use **bold** for key numbers, KPIs, restaurant names, and critical findings.
- Use GFM tables (header row + alignment pipes) for any comparative or multi-column data.
- Use `###` headings to separate major sections; `####` for subsections.
- Use `>` blockquotes for the single most important insight or recommendation per response.
- Use bullet lists for enumeration; numbered lists for ranked items.
- One tight paragraph max before switching to a list or table.
- NEVER output raw JSON, Python dicts, or SQL in your reply.
- Numbers: always include units (%, min, QAR, orders) so context is clear.
"""


def _call_chat_sync(messages: list[dict], context_data: dict) -> str:
    model = _get_chat_model()

    context_json = json.dumps(context_data, indent=2, default=str)
    system_with_data = (
        f"{SYSTEM_PROMPT}\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "LIVE DASHBOARD DATA (pre-queried)\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{context_json}\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "END OF DATA — base ALL answers strictly on the above.\n"
    )

    # Seed history with system context as a user/model exchange
    history: list[dict] = [
        {"role": "user", "parts": [system_with_data]},
        {"role": "model", "parts": ["Understood. I'm ready to assist with Clarity analytics insights."]},
    ]

    # Append all previous messages except the last (which is sent via send_message)
    for msg in messages[:-1]:
        role = "model" if msg.get("role") == "bot" else "user"
        parts: list[Any] = []

        if msg.get("text"):
            parts.append(msg["text"])

        if msg.get("image"):
            img = msg["image"]
            parts.append({"mime_type": img.get("mime_type", "image/jpeg"), "data": img.get("data", "")})

        if parts:
            history.append({"role": role, "parts": parts})

    chat = model.start_chat(history=history)

    last = messages[-1]
    last_parts: list[Any] = []

    if last.get("text"):
        last_parts.append(last["text"])

    if last.get("image"):
        img = last["image"]
        last_parts.append({"mime_type": img.get("mime_type", "image/jpeg"), "data": img.get("data", "")})

    response = chat.send_message(last_parts)
    return response.text


async def chat_with_data(messages: list[dict], context_data: dict) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _call_chat_sync, messages, context_data)
