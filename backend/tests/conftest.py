import os
import shutil
import tempfile
from pathlib import Path

import pytest

_SNAPSHOT = Path(__file__).resolve().parent.parent / "data" / "clarity.db"


def pytest_configure(config):  # noqa: ARG001 — pytest hook signature
    """Run the whole session against a throwaway copy of the warehouse.

    Some tests write: the waitlist test POSTs a signup, which lands in
    `data/clarity.db`. That file is the reference dataset the Postgres parity
    gate is measured against, so every test run was quietly drifting it — six
    junk rows per run, and then a comparison that reports differences nobody
    introduced.

    Copying it here costs ~35 MB of temp space per session and removes the
    whole class of problem. `local_db` reads $SQLITE_PATH at import, so this
    has to be set before any app module loads — hence pytest_configure rather
    than a fixture.
    """
    if not _SNAPSHOT.exists() or os.environ.get("SQLITE_PATH"):
        return
    scratch = Path(tempfile.mkdtemp(prefix="clarity-tests-")) / _SNAPSHOT.name
    shutil.copy2(_SNAPSHOT, scratch)
    for suffix in ("-wal", "-shm"):
        side = _SNAPSHOT.with_name(_SNAPSHOT.name + suffix)
        if side.exists():
            shutil.copy2(side, scratch.with_name(scratch.name + suffix))
    os.environ["SQLITE_PATH"] = str(scratch)
    config._clarity_scratch_dir = scratch.parent  # noqa: SLF001


def pytest_unconfigure(config):
    scratch_dir = getattr(config, "_clarity_scratch_dir", None)
    if scratch_dir:
        shutil.rmtree(scratch_dir, ignore_errors=True)


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
