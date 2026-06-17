"""
Shared Gemini base — model instance, semaphore, retry wrapper.
Both call_service and text_classifier use this instead of configuring genai independently.
"""

import asyncio
import logging
from typing import Optional

import google.generativeai as genai

from app.config import get_settings
from app.utils.helpers import strip_markdown_fences

logger = logging.getLogger(__name__)

_model: Optional[genai.GenerativeModel] = None
_sem: Optional[asyncio.Semaphore] = None


def get_model() -> genai.GenerativeModel:
    global _model
    if _model is None:
        s = get_settings()
        genai.configure(api_key=s.gemini_api_key)
        _model = genai.GenerativeModel(
            model_name=s.gemini_model,
            generation_config={"temperature": 0.1, "response_mime_type": "application/json"},
        )
    return _model


def get_semaphore() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(get_settings().gemini_concurrency)
    return _sem


async def call_with_retry(prompt: str) -> str:
    """Call Gemini with the semaphore and one retry. Returns raw response text."""
    loop = asyncio.get_running_loop()
    model = get_model()

    def _call() -> str:
        resp = model.generate_content(prompt)
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
