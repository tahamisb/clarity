"""
Shared Gemini base — client, semaphore, retry wrapper.
All Gemini JSON callers (call_service, text_classifier, cancellation) go through
call_with_retry instead of configuring the SDK independently.

Uses the google-genai SDK (the old google-generativeai package is EOL and cannot
set thinking_level — which is what let default "medium" thinking silently bill
~800 reasoning tokens per classification at output-token rates).
"""

import asyncio
import logging
from typing import Optional

from google import genai
from google.genai import types

from app.config import get_settings
from app.utils.helpers import strip_markdown_fences

logger = logging.getLogger(__name__)

_client: Optional[genai.Client] = None
_sem: Optional[asyncio.Semaphore] = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=get_settings().gemini_api_key)
    return _client


def json_generation_config(thinking_level: Optional[str] = None) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json",
        thinking_config=types.ThinkingConfig(
            thinking_level=(thinking_level or get_settings().gemini_thinking_level).upper()
        ),
    )


def get_semaphore() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(get_settings().gemini_concurrency)
    return _sem


async def call_with_retry(
    prompt: str, model: Optional[str] = None, thinking_level: Optional[str] = None
) -> str:
    """Call Gemini with the semaphore and one retry. Returns raw response text.

    thinking_level defaults to settings (minimal). Only raise it for genuinely
    reasoning-heavy, low-volume prompts — thinking tokens bill as output.
    """
    loop = asyncio.get_running_loop()
    model_name = model or get_settings().gemini_model

    def _call() -> str:
        resp = get_client().models.generate_content(
            model=model_name, contents=prompt, config=json_generation_config(thinking_level)
        )
        return strip_markdown_fences(resp.text)

    async with get_semaphore():
        try:
            return await loop.run_in_executor(None, _call)
        except Exception as first:
            logger.warning("Gemini attempt 1 failed: %s — retrying", first)
            try:
                return await loop.run_in_executor(None, _call)
            except Exception as second:
                raise RuntimeError(f"Gemini failed after 2 attempts: {second}") from second
