"""Unit tests for Pillar 02 text_classifier normalisation and helpers."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.text_classifier import _normalise
from app.utils.helpers import clean_text, redact_pii, strip_markdown_fences


class TestTextClassifierNormalise:
    def test_valid_negative(self):
        raw = {"sentiment": "negative", "sentiment_confidence": 0.92,
               "intent": "complaint", "intent_confidence": 0.88, "negative_trigger": "late delivery"}
        r = _normalise(raw)
        assert r["sentiment"] == "negative"
        assert r["intent"] == "complaint"
        assert r["negative_trigger"] == "late delivery"

    def test_invalid_sentiment_defaults_neutral(self):
        raw = {"sentiment": "GARBAGE", "sentiment_confidence": 0.5,
               "intent": "praise", "intent_confidence": 0.9, "negative_trigger": None}
        assert _normalise(raw)["sentiment"] == "neutral"

    def test_invalid_intent_defaults_order_query(self):
        raw = {"sentiment": "neutral", "sentiment_confidence": 0.7,
               "intent": "not_real", "intent_confidence": 0.6, "negative_trigger": None}
        assert _normalise(raw)["intent"] == "order_query"

    def test_trigger_cleared_when_not_negative(self):
        raw = {"sentiment": "positive", "sentiment_confidence": 0.9,
               "intent": "praise", "intent_confidence": 0.95, "negative_trigger": "should be removed"}
        assert _normalise(raw)["negative_trigger"] is None

    def test_trigger_kept_when_negative(self):
        raw = {"sentiment": "negative", "sentiment_confidence": 0.88,
               "intent": "refund", "intent_confidence": 0.85, "negative_trigger": "double charge"}
        assert _normalise(raw)["negative_trigger"] == "double charge"

    def test_confidence_clamped_above_1(self):
        raw = {"sentiment": "positive", "sentiment_confidence": 1.5,
               "intent": "praise", "intent_confidence": 2.0, "negative_trigger": None}
        r = _normalise(raw)
        assert r["sentiment_confidence"] == 1.0
        assert r["intent_confidence"] == 1.0


class TestHelpers:
    def test_redact_email(self):
        assert "john@test.com" not in redact_pii("email me at john@test.com")
        assert "[REDACTED_EMAIL]" in redact_pii("email me at john@test.com")

    def test_redact_phone(self):
        result = redact_pii("call +974 5551 2345")
        assert "+974 5551 2345" not in result

    def test_clean_text_collapses_spaces(self):
        assert clean_text("hello   world") == "hello world"

    def test_clean_text_preserves_arabic(self):
        arabic = "أين طلبي؟"
        assert clean_text(arabic) == arabic

    def test_strip_markdown_fences(self):
        assert strip_markdown_fences('```json\n{"k":"v"}\n```') == '{"k":"v"}'
        assert strip_markdown_fences('{"k":"v"}') == '{"k":"v"}'


class TestTextAnalyticsAggregation:
    @pytest.mark.asyncio
    async def test_accuracy_empty(self):
        with patch("app.services.text_analytics_service.bq.query_accuracy_rows", new_callable=AsyncMock) as m:
            m.return_value = []
            from app.services.text_analytics_service import get_accuracy
            r = await get_accuracy()
        assert r.total_labelled == 0
        assert r.sentiment_accuracy == 0.0

    @pytest.mark.asyncio
    async def test_accuracy_partial(self, sample_label_rows):
        with patch("app.services.text_analytics_service.bq.query_accuracy_rows", new_callable=AsyncMock) as m:
            m.return_value = sample_label_rows
            from app.services.text_analytics_service import get_accuracy
            r = await get_accuracy()
        assert r.sentiment_accuracy == pytest.approx(0.75, abs=0.01)
        assert r.intent_accuracy == 1.0

    @pytest.mark.asyncio
    async def test_sentiment_trend_aggregation(self):
        rows = [
            {"week_start": "2024-01-01", "sentiment": "positive", "cnt": 10},
            {"week_start": "2024-01-01", "sentiment": "negative", "cnt": 5},
            {"week_start": "2024-01-01", "sentiment": "neutral",  "cnt": 5},
        ]
        with patch("app.services.text_analytics_service.bq.query_sentiment_trend", new_callable=AsyncMock) as m:
            m.return_value = rows
            from app.services.text_analytics_service import get_sentiment_trend
            r = await get_sentiment_trend()
        assert len(r.weeks) == 1
        assert r.weeks[0].total == 20
        assert r.weeks[0].positive_pct == 50.0
