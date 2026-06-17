import pytest


@pytest.fixture
def sample_call_transcripts():
    return [
        {
            "transcript": "My order hasn't arrived after 2 hours!",
            "expected_sentiment": "negative",
        },
        {
            "transcript": "The driver was great, food was perfect, thank you!",
            "expected_sentiment": "positive",
        },
        {
            "transcript": "Can I get a refund for order 12345?",
            "expected_sentiment": "neutral",
        },
    ]


@pytest.fixture
def sample_text_messages():
    return [
        {"text": "Where is my order?! 2 hours and nothing!", "expected_sentiment": "negative", "expected_intent": "order_query"},
        {"text": "Amazing service, arrived in 20 minutes!", "expected_sentiment": "positive", "expected_intent": "praise"},
        {"text": "I'd like to cancel my order", "expected_sentiment": "neutral", "expected_intent": "cancellation_request"},
    ]


@pytest.fixture
def sample_label_rows():
    return [
        {"true_sentiment": "negative", "true_intent": "order_query",          "pred_sentiment": "negative", "pred_intent": "order_query"},
        {"true_sentiment": "positive", "true_intent": "praise",               "pred_sentiment": "positive", "pred_intent": "praise"},
        {"true_sentiment": "negative", "true_intent": "complaint",            "pred_sentiment": "neutral",  "pred_intent": "complaint"},
        {"true_sentiment": "neutral",  "true_intent": "cancellation_request", "pred_sentiment": "neutral",  "pred_intent": "cancellation_request"},
    ]
