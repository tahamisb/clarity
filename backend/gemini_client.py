import asyncio
import json
import logging
import os

import google.generativeai as genai

logger = logging.getLogger(__name__)

genai.configure(api_key=os.environ["GEMINI_API_KEY"])

# Use gemini-3.5-flash (update MODEL_NAME here if you want a different version)
MODEL_NAME = "gemini-3.5-flash"

_model = genai.GenerativeModel(
    model_name=MODEL_NAME,
    generation_config={
        "temperature": 0.1,
        "response_mime_type": "application/json",
    },
)

_chat_model = genai.GenerativeModel(
    model_name=MODEL_NAME,
    generation_config={
        "temperature": 0.7,
    },
)

VALID_INTENTS = {
    "order_status",
    "refund_request",
    "complaint",
    "cancellation",
    "escalation",
    "praise",
    "delivery_issue",
    "wrong_item",
    "payment_issue",
    "account_issue",
    "general_inquiry",
}
VALID_SENTIMENTS = {"positive", "neutral", "negative"}

# Prompt is sent as user content — system instructions are embedded.
# response_mime_type="application/json" in generation_config enforces JSON output.
ANALYSIS_PROMPT = """\
You are an AI analyst for Rafeeq, a food-delivery company in Qatar. Analyse the call-centre transcript below and return structured data.

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


def _call_gemini(transcript: str) -> dict:
    response = _model.generate_content(ANALYSIS_PROMPT + transcript)
    text = response.text.strip()

    # Strip markdown fences in case they slip through despite response_mime_type
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1 if lines[0].startswith("```") else 0
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end]).strip()

    return json.loads(text)


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

    confidence = float(raw.get("sentiment_confidence", 0.5))
    confidence = max(0.0, min(1.0, confidence))

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
    loop = asyncio.get_running_loop()
    raw = await loop.run_in_executor(None, _call_gemini, transcript)
    return _normalise(raw)

def _call_gemini_chat(messages: list, context_data: dict) -> str:
    # Build system context
    system_prompt = (
        "You are an intelligent conversational assistant for Rafeeq, a food-delivery company in Qatar. "
        "You have access to the following live dashboard analytics data:\n\n"
        f"{json.dumps(context_data, indent=2)}\n\n"
        "Use this data to answer the user's questions accurately and concisely. "
        "If they ask about something not in the data, try to be helpful but mention your data is limited to the provided analytics."
    )
    
    # Initialize a chat session
    # Gemini requires the history to be formatted as {"role": "user"|"model", "parts": ["text"]}
    history = [{"role": "user", "parts": [system_prompt]}, {"role": "model", "parts": ["Understood. I will use the provided data to assist the user."]}]
    
    for msg in messages[:-1]: # exclude the last user message
        role = "model" if msg.get("role") == "bot" else "user"
        
        parts = []
        if msg.get("text"):
            parts.append(msg["text"])
        
        # Handle images if passed in the message
        if msg.get("image"):
            # The image could be base64. We need to pass it properly to Gemini.
            # Format: 'image/jpeg', 'base64_data'
            # For simplicity, assuming the frontend sends `image: { mime_type, data }`
            img_data = msg["image"]
            parts.append({
                "mime_type": img_data.get("mime_type", "image/jpeg"),
                "data": img_data.get("data", "")
            })
            
        history.append({"role": role, "parts": parts})
    
    chat = _chat_model.start_chat(history=history)
    
    # Process the last message
    last_msg = messages[-1]
    parts = []
    if last_msg.get("text"):
        parts.append(last_msg["text"])
    if last_msg.get("image"):
        img_data = last_msg["image"]
        parts.append({
            "mime_type": img_data.get("mime_type", "image/jpeg"),
            "data": img_data.get("data", "")
        })
        
    response = chat.send_message(parts)
    return response.text

async def chat_with_data(messages: list, context_data: dict) -> str:
    loop = asyncio.get_running_loop()
    response_text = await loop.run_in_executor(None, _call_gemini_chat, messages, context_data)
    return response_text

