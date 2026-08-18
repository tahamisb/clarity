"""
Load the legacy SQLite snapshot into Postgres, converting types.

This exists for one reason: the backend port (Phase 1) has to be verifiable.
The acceptance test is "run every API endpoint against SQLite and against
Postgres with the SAME data and diff the JSON". Regenerating from the seeded
RNG would not give the same data — the generator was rewritten — so the
reference dataset is copied across verbatim instead.

Conversion rules, and the reasoning behind the one that matters:

  TEXT 'YYYY-MM-DD HH:MM:SS'  →  timestamptz, **interpreted as UTC**

The snapshot is internally inconsistent about timezones: order placement is
Qatar-local, while chats were deliberately shifted to UTC and message
timestamps behave like local time wearing a UTC label. Rather than guess a
correction per table, the loader interprets every stored string as UTC and the
compat views render back to UTC — so the round-trip is exact and the diff test
measures the port, not a timezone opinion. Correct timezone handling starts
with newly *generated* data (see generate.py); realigning the display side is
Phase 2 work, tracked in the README.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import psycopg

from . import writer

logger = logging.getLogger(__name__)

QATAR = ZoneInfo("Asia/Qatar")
UTC = timezone.utc


# ---------------------------------------------------------------------------
# Scalar conversions
# ---------------------------------------------------------------------------

def _ts(value: Any) -> datetime | None:
    """'YYYY-MM-DD HH:MM:SS' → aware UTC datetime."""
    if value in (None, ""):
        return None
    text = str(value).strip().replace("T", " ")
    return datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)


def _date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _time(value: Any) -> time | None:
    if value in (None, ""):
        return None
    return datetime.strptime(str(value)[:8], "%H:%M:%S").time()


def _bool(value: Any) -> bool | None:
    return None if value is None else bool(value)


def _json(value: Any) -> Any:
    """Stored as a JSON string; hand it through untouched — the writer passes
    JSON text straight to COPY. Invalid JSON is dropped rather than aborting a
    two-million-row load over one bad row."""
    if value in (None, ""):
        return None
    try:
        json.loads(value)
    except (TypeError, ValueError):
        logger.warning("dropping unparseable JSON value: %.80s", value)
        return None
    return value


# ---------------------------------------------------------------------------
# Per-table row mappers
# ---------------------------------------------------------------------------

def _order(r: sqlite3.Row) -> dict:
    d, t = _date(r["order_placement_date"]), _time(r["order_placement_time"])
    return {
        "id": r["id"],
        "vendor_id": r["vendor_id"],
        "customer_id": r["customer_id"],
        "order_status": r["order_status"],
        "order_placement_date": d,
        "order_placement_time": t,
        # Derived, not round-tripped: the placement pair is Qatar-local.
        "placed_at": (
            datetime.combine(d, t, tzinfo=QATAR).astimezone(UTC) if d and t else None
        ),
        "total_order_value": r["total_order_value"],
        "order_sub_total_value": r["order_sub_total_value"],
        "delivery_charge": r["delivery_charge"],
        "vendor_to_customer_dist": r["vendor_to_customer_dist"],
        "driver_vendor_dist": r["driver_vendor_dist"],
        "is_pre_order": _bool(r["is_pre_order"]),
        "new_customer": _bool(r["new_customer"]),
        "is_pro_user": _bool(r["is_pro_user"]),
        "is_pro_vendor": _bool(r["is_pro_vendor"]),
        "is_treasure": _bool(r["is_treasure"]),
        "is_discount": _bool(r["is_discount"]),
        "used_coupon": r["used_coupon"],
        "payment_type": r["payment_type"],
        "customer_device_type": r["customer_device_type"],
        "platform_name": r["platform_name"],
        "cuisine": r["cuisine"],
        "zone_name": r["zone_name"],
        "customer_zone": r["customer_zone"],
        "restaurant_name": r["restaurant_name"],
        "location": r["location"],
        "clarity_time_to_accept_order_min": r["clarity_time_to_accept_order_min"],
        "vendor_to_accept_order_min": r["vendor_to_accept_order_min"],
        "preparing_time_min": r["preparing_time_min"],
        "since_create_til_delivred_min": r["since_create_til_delivred_min"],
        "cancel_comment": r["cancel_comment"],
        "cancelled_by_txt": r["cancelled_by_txt"],
        "cancelled_by_int": r["cancelled_by_int"],
        "feedback_order_rating": r["feedback_order_rating"],
        "feedback_delivery_rating": r["feedback_delivery_rating"],
        "feedback_comment": r["feedback_comment"],
        "sim_emitted_at": None,
    }


def _item(r: sqlite3.Row) -> dict:
    return {
        "order_id": r["order_id"],
        "product_name": r["product_name"],
        "cat_name": r["cat_name"],
        "count": r["count"],
        "total_value": r["total_value"],
    }


def _chat(r: sqlite3.Row) -> dict:
    return {
        "chat_id": r["chat_id"],
        "customer_id": r["customer_id"],
        "order_id": r["order_id"],
        "type": r["type"],
        "device_id": r["device_id"],
        "locale": r["locale"],
        "messages": _json(r["messages"]),
        "created_at": _ts(r["created_at"]),
        "closed_at": _ts(r["closed_at"]),
        "closed_by": r["closed_by"],
        "is_phone_call": _bool(r["is_phone_call"]),
    }


def _message(r: sqlite3.Row) -> dict:
    return {
        "message_id": r["message_id"],
        "customer_id": r["customer_id"],
        "content": r["content"],
        "source_channel": r["source_channel"],
        "merchant_name": r["merchant_name"],
        "zone": r["zone"],
        "created_at": _ts(r["created_at"]),
        "ingested_at": _ts(r["ingested_at"]),
        "closed_at": _ts(r["closed_at"]),
        "agent_name": r["agent_name"],
        "sim_emitted_at": None,
    }


def _classification(r: sqlite3.Row) -> dict:
    return {
        "classification_id": r["classification_id"],
        "message_id": r["message_id"],
        "sentiment": r["sentiment"],
        "sentiment_confidence": r["sentiment_confidence"],
        "intent": r["intent"],
        "intent_confidence": r["intent_confidence"],
        "negative_trigger": r["negative_trigger"],
        "model_version": r["model_version"],
        "classified_at": _ts(r["classified_at"]),
    }


def _label(r: sqlite3.Row) -> dict:
    return {
        "message_id": r["message_id"],
        "true_sentiment": r["true_sentiment"],
        "true_intent": r["true_intent"],
        "labelled_by": r["labelled_by"],
        "labelled_at": _ts(r["labelled_at"]),
    }


def _skipped(r: sqlite3.Row) -> dict:
    return {"chat_id": r["chat_id"], "reason": r["reason"], "skipped_at": _ts(r["skipped_at"])}


def _call(r: sqlite3.Row) -> dict:
    return {
        "call_id": r["call_id"],
        "transcript": r["transcript"],
        "intents": _json(r["intents"]),
        "primary_intent": r["primary_intent"],
        "sentiment": r["sentiment"],
        "sentiment_confidence": r["sentiment_confidence"],
        "order_ids": _json(r["order_ids"]),
        "restaurant_names": _json(r["restaurant_names"]),
        "areas": _json(r["areas"]),
        "product_names": _json(r["product_names"]),
        "qar_amounts": _json(r["qar_amounts"]),
        "summary": r["summary"],
        # Added to the snapshot by a local_db migration, so it may be absent
        # from an older file — keys() rather than [] to avoid an IndexError.
        "call_reason": r["call_reason"] if "call_reason" in r.keys() else None,
        "analysed_at": _ts(r["analysed_at"]),
        "sim_emitted_at": None,
    }


def _prediction(r: sqlite3.Row) -> dict:
    return {
        "order_id": r["order_id"],
        "engine": r["engine"],
        "probability": r["probability"],
        "risk_level": r["risk_level"],
        "flagged": _bool(r["flagged"]),
        "threshold": r["threshold"],
        "top_risk_factors": _json(r["top_risk_factors"]),
        "gemini_explanation": r["gemini_explanation"],
        "recommended_action": r["recommended_action"],
        "restaurant_name": r["restaurant_name"],
        "zone_name": r["zone_name"],
        "predicted_at": _ts(r["predicted_at"]),
    }


def _waitlist(r: sqlite3.Row) -> dict:
    return {
        "email": r["email"],
        "company": r["company"],
        "note": r["note"],
        "plan": r["plan"],
        "created_at": _ts(r["created_at"]),
    }


# (sqlite table, postgres table, mapper). Parents before children — the FK on
# vendor_items_kpi and the ones on classifications/labels need their targets.
TABLES = (
    ("vendor_kpi", "warehouse.vendor_kpi", _order),
    ("vendor_items_kpi", "warehouse.vendor_items_kpi", _item),
    ("chat_history", "warehouse.chat_history", _chat),
    ("messages", "warehouse.messages", _message),
    ("classifications", "warehouse.classifications", _classification),
    ("labels", "warehouse.labels", _label),
    ("skipped_chats", "warehouse.skipped_chats", _skipped),
    ("call_analysis", "warehouse.call_analysis", _call),
    ("cancellation_predictions", "warehouse.cancellation_predictions", _prediction),
    ("waitlist", "app.waitlist", _waitlist),
)


def _stream(src: sqlite3.Connection, table: str, mapper) -> Iterator[dict]:
    cur = src.execute(f"SELECT * FROM {table}")
    while batch := cur.fetchmany(10_000):
        for row in batch:
            yield mapper(row)


def load(dsn: str, sqlite_path: Path) -> dict[str, int]:
    if not sqlite_path.exists():
        raise SystemExit(f"No SQLite snapshot at {sqlite_path}")

    src = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    present = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    counts: dict[str, int] = {}
    with psycopg.connect(dsn) as conn:
        writer.truncate_warehouse(conn)
        with conn.cursor() as cur:
            cur.execute("TRUNCATE app.waitlist RESTART IDENTITY")

        for sqlite_table, pg_table, mapper in TABLES:
            if sqlite_table not in present:
                logger.warning("snapshot has no table %s — skipping", sqlite_table)
                continue
            counts[pg_table] = writer.copy_rows(conn, pg_table, _stream(src, sqlite_table, mapper))

        writer.advance_sequences(conn)
        bounds = conn.execute(
            "SELECT min(placed_at), max(placed_at) FROM warehouse.vendor_kpi"
        ).fetchone()
        writer.set_cursor(
            conn,
            seeded_from=bounds[0],
            seeded_to=bounds[1],
            generator=f"load-sqlite:{sqlite_path.name}",
        )
        writer.record(conn, "load_sqlite", {"source": str(sqlite_path), "counts": counts})
        conn.commit()
        writer.analyze(conn)

    src.close()
    return counts
