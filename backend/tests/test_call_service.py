"""Unit tests for Pillar 01 call_service normalisation (no Gemini API calls)."""

import pytest

from app.services.call_service import _normalise, VALID_INTENTS, VALID_SENTIMENTS


class TestCallServiceNormalise:
    def test_valid_result(self):
        raw = {
            "intents": ["complaint", "refund_request"],
            "sentiment": "negative",
            "sentiment_confidence": 0.88,
            "entities": {"order_ids": ["12345"], "restaurant_names": [], "areas": [], "product_names": [], "qar_amounts": []},
            "summary": "Customer complained about late delivery",
        }
        result = _normalise(raw)
        assert result["sentiment"] == "negative"
        assert "complaint" in result["intents"]
        assert 0.0 <= result["sentiment_confidence"] <= 1.0

    def test_invalid_sentiment_defaults_neutral(self):
        raw = {
            "intents": ["general_inquiry"],
            "sentiment": "INVALID",
            "sentiment_confidence": 0.5,
            "entities": {"order_ids": [], "restaurant_names": [], "areas": [], "product_names": [], "qar_amounts": []},
            "summary": "",
        }
        assert _normalise(raw)["sentiment"] == "neutral"

    def test_invalid_intent_filtered_out(self):
        raw = {
            "intents": ["not_real", "complaint"],
            "sentiment": "negative",
            "sentiment_confidence": 0.7,
            "entities": {"order_ids": [], "restaurant_names": [], "areas": [], "product_names": [], "qar_amounts": []},
            "summary": "",
        }
        result = _normalise(raw)
        assert "not_real" not in result["intents"]
        assert "complaint" in result["intents"]

    def test_empty_intents_defaults_general_inquiry(self):
        raw = {
            "intents": [],
            "sentiment": "neutral",
            "sentiment_confidence": 0.5,
            "entities": {"order_ids": [], "restaurant_names": [], "areas": [], "product_names": [], "qar_amounts": []},
            "summary": "",
        }
        assert _normalise(raw)["intents"] == ["general_inquiry"]

    def test_confidence_clamped(self):
        raw = {
            "intents": ["praise"],
            "sentiment": "positive",
            "sentiment_confidence": 9.9,
            "entities": {"order_ids": [], "restaurant_names": [], "areas": [], "product_names": [], "qar_amounts": []},
            "summary": "",
        }
        assert _normalise(raw)["sentiment_confidence"] == 1.0

    def test_string_intent_coerced_to_list(self):
        raw = {
            "intents": "complaint",
            "sentiment": "negative",
            "sentiment_confidence": 0.8,
            "entities": {"order_ids": [], "restaurant_names": [], "areas": [], "product_names": [], "qar_amounts": []},
            "summary": "",
        }
        result = _normalise(raw)
        assert isinstance(result["intents"], list)
        assert "complaint" in result["intents"]
