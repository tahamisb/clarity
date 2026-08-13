"""
The AI pipeline, running against arriving data.

Until now the analytics were real but the intelligence was not: the generator
wrote `classifications` pre-baked, so the dashboards displayed sentiment that
had never been through a model. This closes that loop. The simulator emits
**raw** rows — a message, a chat, a transcript — and these workers pick them up
and label them, which is the actual production path: ingest → classify → serve.

That matters more than it sounds. It is the difference between "here is what a
sentiment dashboard would look like" and "this is our classifier, running, on
data it has never seen, and the number on screen came out of it thirty seconds
ago". It also exercises the parts that only break in production — prompt
failures, rate limits, malformed responses, cost.

Two guards make it safe to leave running:

  **A budget.** Classification is per-message and the simulator produces
  messages forever, so an unbounded worker is an unbounded bill. The cap is a
  daily count, checked before every call.

  **A fallback.** With no API key, or once the budget is spent, a deterministic
  keyword classifier takes over. Its output is labelled `model_version` so it
  is never mistaken for the real thing, and the dashboard keeps working —
  degrading to a worse classifier beats degrading to no data.

Both workers only run against a live warehouse. Against the frozen snapshot
there is nothing new to classify and they would just burn quota re-reading a
file.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date

from app.config import get_settings
from app.services import warehouse as db
from app.utils import clock

logger = logging.getLogger(__name__)
_settings = get_settings()

FALLBACK_VERSION = "keyword-fallback-v1"


# ---------------------------------------------------------------------------
# Deterministic fallback
# ---------------------------------------------------------------------------

# Ordered: the first match wins, so the more specific patterns come first.
# Deliberately covers the Arabic side too — half the corpus is Arabic, and a
# fallback that silently rates every Arabic message "neutral" would skew the
# whole sentiment chart rather than just being a bit less accurate.
_NEGATIVE_PATTERNS: tuple[tuple[str, str, str], ...] = (
    (r"refund|استرجاع|مبلغي", "refund", "refund issue"),
    (r"charged twice|overcharg|double charge|خصم مرتين", "refund", "overcharged"),
    (r"promo|coupon|voucher|كوبون", "refund", "promo code failed"),
    (r"late|delay|still not here|hasn'?t arrived|متأخر|ما وصل", "complaint", "delayed delivery"),
    (r"cold|soggy|stale|بايت|بارد", "complaint", "food quality issue"),
    (r"missing|incomplete|ناقص", "complaint", "missing items"),
    (r"wrong item|wrong order|someone else'?s|غلط", "complaint", "wrong item delivered"),
    (r"rude|impolite|refused|غير محترم", "complaint", "driver issue"),
    (r"wrong address|went to the wrong|عنوان", "complaint", "wrong delivery location"),
    (r"out of stock|unavailable|نفد", "complaint", "item unavailable"),
    (r"never arrived|not received|marked delivered", "complaint", "order not received"),
    (r"cancel", "cancellation_request", "order cancellation"),
    (r"no resolution|three times|manager|escalat", "complaint", "unresolved complaint"),
)

_POSITIVE_RE = re.compile(
    r"thank|thanks|great|excellent|perfect|best|polite|fast|appreciated"
    r"|شكرا|ممتاز|رائع|بسرعة",
    re.IGNORECASE,
)
_CANCEL_RE = re.compile(r"cancel|إلغاء", re.IGNORECASE)
_REFUND_RE = re.compile(r"refund|استرجاع", re.IGNORECASE)


def classify_fallback(text: str) -> dict:
    """Keyword classification — no network, no cost, fully deterministic."""
    lowered = (text or "").lower()

    for pattern, intent, trigger in _NEGATIVE_PATTERNS:
        if re.search(pattern, lowered, re.IGNORECASE):
            return {
                "sentiment": "negative",
                # Confidence is deliberately modest: this is a keyword match,
                # and claiming 0.95 would make the fallback indistinguishable
                # from the model in the confidence distributions.
                "sentiment_confidence": 0.62,
                "intent": intent,
                "intent_confidence": 0.58,
                "negative_trigger": trigger,
            }

    if _POSITIVE_RE.search(lowered):
        return {
            "sentiment": "positive", "sentiment_confidence": 0.66,
            "intent": "praise", "intent_confidence": 0.60, "negative_trigger": None,
        }

    intent = ("cancellation_request" if _CANCEL_RE.search(lowered)
              else "refund" if _REFUND_RE.search(lowered)
              else "order_query")
    return {
        "sentiment": "neutral", "sentiment_confidence": 0.55,
        "intent": intent, "intent_confidence": 0.55, "negative_trigger": None,
    }


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------

class DailyBudget:
    """A per-day call cap, reset on the business date.

    In-process, so a restart refills it. That is the right trade for a demo
    deployment: the failure mode of an over-strict budget (dashboard stops
    updating) is worse than of a slightly loose one (a few hundred extra
    lite-model calls).
    """

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._day: date | None = None
        self._used = 0

    def _roll(self) -> None:
        today = clock.today()
        if self._day != today:
            self._day, self._used = today, 0

    @property
    def remaining(self) -> int:
        self._roll()
        return max(0, self.limit - self._used)

    def take(self, n: int = 1) -> bool:
        self._roll()
        if self._used + n > self.limit:
            return False
        self._used += n
        return True

    def state(self) -> dict:
        self._roll()
        return {"limit": self.limit, "used": self._used, "remaining": self.remaining}


_budget = DailyBudget(_settings.classify_daily_budget)


def budget_state() -> dict:
    return _budget.state()


# ---------------------------------------------------------------------------
# Classification worker
# ---------------------------------------------------------------------------

def _unclassified_sync(limit: int) -> list[dict]:
    """Messages with no classification row yet, oldest first.

    Oldest-first on purpose: a backlog should drain in arrival order, so the
    dashboard fills in chronologically instead of showing a scatter of
    classified and unclassified rows.
    """
    return db.query(
        """
        SELECT m.message_id, m.content
        FROM messages m
        LEFT JOIN classifications c ON c.message_id = m.message_id
        WHERE c.message_id IS NULL AND m.content IS NOT NULL
        ORDER BY m.created_at
        LIMIT :limit
        """,
        {"limit": limit},
    )


async def classify_pending(limit: int) -> dict:
    """Classify up to `limit` unlabelled messages. Returns what it did."""
    loop = asyncio.get_running_loop()
    pending = await loop.run_in_executor(None, _unclassified_sync, limit)
    if not pending:
        return {"pending": 0}

    use_model = bool(_settings.gemini_api_key) and _budget.remaining > 0
    rows, by_model, by_fallback = [], 0, 0

    for msg in pending:
        result, version = None, FALLBACK_VERSION
        if use_model and _budget.take():
            try:
                from app.services.text_classifier import classify_message  # noqa: PLC0415

                result = await classify_message(msg["content"])
                version = _settings.gemini_classify_model
                by_model += 1
            except Exception as exc:  # noqa: BLE001
                # One bad response must not stall the queue behind it; this
                # message falls through to the deterministic path.
                logger.warning("classify failed for %s: %s", msg["message_id"], exc)
        if result is None:
            result = classify_fallback(msg["content"])
            by_fallback += 1

        rows.append({
            # Deterministic id derived from the message, so a retry after a
            # partial write collides on the primary key instead of producing a
            # second classification for the same message.
            "classification_id": f"clf-live-{msg['message_id']}",
            "message_id": msg["message_id"],
            "sentiment": result["sentiment"],
            "sentiment_confidence": result["sentiment_confidence"],
            "intent": result["intent"],
            "intent_confidence": result["intent_confidence"],
            "negative_trigger": result["negative_trigger"],
            # Which path produced this row. The accuracy endpoint groups by it,
            # so fallback output is never silently credited to the model.
            "model_version": version,
            "classified_at": clock.now_sql(),
        })

    await loop.run_in_executor(None, db.insert_rows, "classifications", rows)
    return {"pending": len(pending), "model": by_model, "fallback": by_fallback}


# ---------------------------------------------------------------------------
# Workers
# ---------------------------------------------------------------------------

async def _classify_loop() -> None:
    interval = _settings.classify_interval_s
    while True:
        try:
            stats = await classify_pending(_settings.classify_batch_size)
            if stats.get("pending"):
                logger.info("classified %s", stats)
        except Exception:  # noqa: BLE001
            logger.exception("classification worker cycle failed")
        await asyncio.sleep(interval)


async def _score_loop() -> None:
    """Score in-flight orders so the risk queue is model output, not fixtures."""
    interval = _settings.score_interval_s
    while True:
        try:
            from app.services import predictor_service as predictor  # noqa: PLC0415

            result = await predictor.live_queue(_settings.score_batch_size, engine="auto")
            if result.get("count"):
                logger.info(
                    "scored %d in-flight orders via %s", result["count"], result.get("engine")
                )
        except Exception:  # noqa: BLE001
            logger.exception("scoring worker cycle failed")
        await asyncio.sleep(interval)


def should_run() -> bool:
    """Only against a live warehouse.

    On the frozen snapshot every message is already classified and nothing new
    arrives, so the workers would spin without ever having work — and any bug
    in them would burn quota against a static file.
    """
    return not clock.FROZEN and _settings.live_pipeline_enabled


def start(loop_registry: list) -> None:
    if not should_run():
        logger.info(
            "Live AI pipeline off (clock=%s, enabled=%s)",
            clock.MODE, _settings.live_pipeline_enabled,
        )
        return
    loop_registry.append(asyncio.create_task(_classify_loop()))
    loop_registry.append(asyncio.create_task(_score_loop()))
    logger.info(
        "Live AI pipeline on — classify every %ss (budget %d/day, %s), score every %ss",
        _settings.classify_interval_s, _settings.classify_daily_budget,
        _settings.gemini_classify_model if _settings.gemini_api_key else "no API key, fallback only",
        _settings.score_interval_s,
    )
