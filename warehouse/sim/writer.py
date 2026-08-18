"""
Bulk writes and simulator bookkeeping.

COPY rather than INSERT: seeding is millions of rows at the densities this is
meant to run at, and executemany would turn a two-minute job into an hour.

jsonb values are handed to COPY as JSON *text* — Postgres parses them on the
way in. That avoids the binary-COPY type plumbing and keeps the row dicts
plain, which matters because the same dicts come from two very different
producers (the generator and the SQLite loader).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

import psycopg

logger = logging.getLogger(__name__)

# Column order per table. Explicit because COPY is positional and a silent
# column-order mismatch would write plausible-looking garbage.
COLUMNS: dict[str, tuple[str, ...]] = {
    "warehouse.vendor_kpi": (
        "id", "vendor_id", "customer_id", "order_status",
        "order_placement_date", "order_placement_time", "placed_at",
        "total_order_value", "order_sub_total_value", "delivery_charge",
        "vendor_to_customer_dist", "driver_vendor_dist",
        "is_pre_order", "new_customer", "is_pro_user", "is_pro_vendor",
        "is_treasure", "is_discount", "used_coupon", "payment_type",
        "customer_device_type", "platform_name", "cuisine", "zone_name",
        "customer_zone", "restaurant_name", "location",
        "clarity_time_to_accept_order_min", "vendor_to_accept_order_min",
        "preparing_time_min", "since_create_til_delivred_min",
        "cancel_comment", "cancelled_by_txt", "cancelled_by_int",
        "feedback_order_rating", "feedback_delivery_rating", "feedback_comment",
        "sim_emitted_at",
    ),
    "warehouse.vendor_items_kpi": (
        "order_id", "product_name", "cat_name", "count", "total_value",
    ),
    "warehouse.chat_history": (
        "chat_id", "customer_id", "order_id", "type", "device_id", "locale",
        "messages", "created_at", "closed_at", "closed_by", "is_phone_call",
    ),
    "warehouse.messages": (
        "message_id", "customer_id", "content", "source_channel",
        "merchant_name", "zone", "created_at", "ingested_at", "closed_at",
        "agent_name", "sim_emitted_at",
    ),
    "warehouse.classifications": (
        "classification_id", "message_id", "sentiment", "sentiment_confidence",
        "intent", "intent_confidence", "negative_trigger", "model_version",
        "classified_at",
    ),
    "warehouse.labels": (
        "message_id", "true_sentiment", "true_intent", "labelled_by", "labelled_at",
    ),
    "warehouse.skipped_chats": ("chat_id", "reason", "skipped_at"),
    "warehouse.call_analysis": (
        "call_id", "transcript", "intents", "primary_intent", "sentiment",
        "sentiment_confidence", "order_ids", "restaurant_names", "areas",
        "product_names", "qar_amounts", "summary", "call_reason", "analysed_at",
        "sim_emitted_at",
    ),
    "warehouse.cancellation_predictions": (
        "order_id", "engine", "probability", "risk_level", "flagged", "threshold",
        "top_risk_factors", "gemini_explanation", "recommended_action",
        "restaurant_name", "zone_name", "predicted_at",
    ),
    "app.waitlist": ("email", "company", "note", "plan", "created_at"),
}

# Columns whose Python value is a list/dict and whose column type is jsonb.
JSON_COLUMNS = {
    "messages", "intents", "order_ids", "restaurant_names", "areas",
    "product_names", "qar_amounts", "top_risk_factors",
}

# Truncation order: children before parents (FKs are ON DELETE CASCADE, but
# being explicit keeps the intent readable).
TRUNCATE_ORDER = (
    "warehouse.cancellation_predictions",
    "warehouse.labels",
    "warehouse.classifications",
    "warehouse.messages",
    "warehouse.skipped_chats",
    "warehouse.call_analysis",
    "warehouse.chat_history",
    "warehouse.vendor_items_kpi",
    "warehouse.vendor_kpi",
)


def _encode(column: str, value: Any) -> Any:
    if value is None:
        return None
    if column in JSON_COLUMNS and not isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    return value


def copy_rows(conn: psycopg.Connection, table: str, rows: Sequence[dict] | Iterable[dict]) -> int:
    """COPY dict rows into `table`. Returns the number written."""
    cols = COLUMNS[table]
    collist = ", ".join(f'"{c}"' for c in cols)
    written = 0
    with conn.cursor() as cur:
        with cur.copy(f"COPY {table} ({collist}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(tuple(_encode(c, row.get(c)) for c in cols))
                written += 1
    logger.info("copied %7d rows → %s", written, table)
    return written


def truncate_warehouse(conn: psycopg.Connection) -> None:
    """Empty every warehouse table. Sequences are left alone — ids must stay
    monotonic across reseeds so a stale cached id can never resolve to a
    different order."""
    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE {', '.join(TRUNCATE_ORDER)} RESTART IDENTITY CASCADE")
    logger.info("truncated %d warehouse tables", len(TRUNCATE_ORDER))


def analyze(conn: psycopg.Connection) -> None:
    """Refresh planner statistics. Without this the first dashboard load after
    a seed picks terrible plans on the big group-bys."""
    old = conn.autocommit
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("ANALYZE")
    finally:
        conn.autocommit = old
    logger.info("ANALYZE complete")


def advance_sequences(conn: psycopg.Connection) -> None:
    """Park the id sequences past whatever is already stored.

    Called after every seed and load, and again when the ticker starts —
    cheap, and the alternative is the ticker minting `msg-000001` on top of a
    seeded row and dying on the primary key.

    Message ids are text (`msg-000123`), so the high-water mark comes from
    parsing the numeric suffix rather than from max(id).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT setval('sim.order_id_seq',
                          COALESCE((SELECT max(id) FROM warehouse.vendor_kpi), 500000));
            """)
        cur.execute("""
            SELECT setval('sim.chat_id_seq',
                          COALESCE((SELECT max(chat_id) FROM warehouse.chat_history), 900000));
            """)
        cur.execute("""
            SELECT setval('sim.message_seq', GREATEST(1, COALESCE((
                SELECT max(substring(message_id from '[0-9]+')::bigint)
                  FROM warehouse.messages
                 WHERE message_id ~ '^msg-[0-9]+$'), 0)));
            """)
        cur.execute("""
            SELECT setval('sim.classification_seq', GREATEST(1, COALESCE((
                SELECT max(substring(classification_id from '[0-9]+')::bigint)
                  FROM warehouse.classifications
                 WHERE classification_id ~ '^clf-[0-9]+$'), 0)));
            """)


def record(conn: psycopg.Connection, event: str, detail: dict | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sim.run_log (event, detail) VALUES (%s, %s)",
            (event, json.dumps(detail or {}, default=str)),
        )


def set_cursor(
    conn: psycopg.Connection,
    *,
    seeded_from: datetime | None,
    seeded_to: datetime | None,
    generator: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sim.tick_cursor
               SET seeded_from = %s,
                   seeded_to   = %s,
                   generator   = %s,
                   last_tick_at = %s,
                   updated_at  = now()
             WHERE only_row
            """,
            (seeded_from, seeded_to, generator, datetime.now(timezone.utc)),
        )
