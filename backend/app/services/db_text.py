"""
Pillar 02 data access — support messages, Gemini classifications and labels.

Reads the local SQLite warehouse (`data/clarity.db`); see `local_db` for the
BigQuery-builtin shims the rewritten queries rely on.

Tables:
  messages         — ingested messages (PII-redacted)
  classifications  — Gemini classification results
  labels           — human ground-truth for accuracy evaluation
  skipped_chats    — chats with no analysable customer text
"""

import asyncio
import logging
from typing import Optional

from app.services import local_db as db
from app.services.local_db import countif, hour_of, hours_between
from app.services.ttl_cache import ttl_cache
from app.services.verticals import merchant_cte, vertical_case
from app.utils.clock import SQL_NOW

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Vertical support — messages/calls only carry a merchant name, so vertical is
# resolved through the `mv` CTE (merchant → majority platform in vendor_kpi).
# ---------------------------------------------------------------------------

# SQL expression for a row's vertical once `mv` is LEFT JOINed (NULL → 'Other').
_VERTICAL = vertical_case("mv.platform")

_MV_WITH = f"WITH {merchant_cte('vendor_kpi')}\n"
_MV_JOIN = "LEFT JOIN mv ON m.merchant_name = mv.merchant_name"


def _vertical_param(vertical: Optional[str]) -> dict:
    return {"vertical": vertical} if vertical else {}


# Messages carry a plain zone name; analysed calls carry a JSON array of areas
# using the same vocabulary, so one selection scopes both.
_MSG_ZONE = "m.zone = :zone"
_CALL_ZONE = "EXISTS (SELECT 1 FROM json_each(ca.areas) WHERE json_each.value = :zone)"


def _zone_param(zone: Optional[str]) -> dict:
    return {"zone": zone} if zone else {}


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

async def _offload(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)


async def insert_messages(rows: list[dict]) -> list[str]:
    await _offload(db.insert_rows, "messages", rows)
    return [r["message_id"] for r in rows]


async def insert_classifications(rows: list[dict]) -> None:
    await _offload(db.insert_rows, "classifications", rows)


async def insert_skipped_chats(chat_ids: list[str], reason: str = "no_genuine_text") -> None:
    from app.utils.helpers import utcnow_iso

    if not chat_ids:
        return
    ts = utcnow_iso()
    await _offload(db.insert_rows, "skipped_chats",
                   [{"chat_id": cid, "reason": reason, "skipped_at": ts} for cid in chat_ids])


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

def _query_messages_sync(
    source_channel: Optional[str], zone: Optional[str],
    from_date: Optional[str], to_date: Optional[str],
    page: int, page_size: int,
) -> tuple[int, list[dict]]:
    conditions, params = [], {}
    if source_channel:
        conditions.append("source_channel = :source_channel")
        params["source_channel"] = source_channel
    if zone:
        conditions.append("zone = :zone")
        params["zone"] = zone
    if from_date:
        conditions.append("created_at >= :from_date")
        params["from_date"] = from_date
    if to_date:
        conditions.append("created_at <= :to_date")
        params["to_date"] = to_date

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    total = db.query_one(f"SELECT COUNT(*) AS cnt FROM messages {where}", params)["cnt"]

    rows = db.query(f"""
        SELECT message_id, customer_id, content, source_channel, merchant_name, zone,
               created_at, ingested_at
        FROM messages {where}
        ORDER BY ingested_at DESC
        LIMIT :page_size OFFSET :offset
    """, {**params, "page_size": page_size, "offset": (page - 1) * page_size})
    return int(total), rows


async def query_messages(
    source_channel: Optional[str] = None, zone: Optional[str] = None,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    page: int = 1, page_size: int = 50,
) -> tuple[int, list[dict]]:
    return await _offload(
        _query_messages_sync, source_channel, zone, from_date, to_date, page, page_size
    )


async def get_message(message_id: str) -> Optional[dict]:
    return await _offload(lambda: db.query_one("""
        SELECT message_id, customer_id, content, source_channel, merchant_name, zone,
               created_at, ingested_at
        FROM messages WHERE message_id = ? LIMIT 1
    """, (message_id,)))


async def get_classification_for_message(message_id: str) -> Optional[dict]:
    return await _offload(lambda: db.query_one("""
        SELECT classification_id, message_id, sentiment, sentiment_confidence,
               intent, intent_confidence, negative_trigger, model_version, classified_at
        FROM classifications
        WHERE message_id = ?
        ORDER BY classified_at DESC LIMIT 1
    """, (message_id,)))


async def get_unclassified_message_ids(limit: int = 500) -> list[str]:
    rows = await _offload(lambda: db.query("""
        SELECT m.message_id
        FROM messages m
        LEFT JOIN classifications c ON m.message_id = c.message_id
        WHERE c.message_id IS NULL
        ORDER BY m.ingested_at
        LIMIT ?
    """, (limit,)))
    return [r["message_id"] for r in rows]


async def get_messages_by_ids(message_ids: list[str]) -> list[dict]:
    if not message_ids:
        return []
    return await _offload(lambda: db.query(
        f"SELECT message_id, content FROM messages "
        f"WHERE message_id IN ({db.placeholders(message_ids)})",
        tuple(message_ids),
    ))


def _query_classifications_sync(
    sentiment: Optional[str], intent: Optional[str], zone: Optional[str], merchant: Optional[str],
    from_date: Optional[str], to_date: Optional[str], page: int, page_size: int,
) -> tuple[int, list[dict]]:
    conditions, params = [], {}
    if sentiment:
        conditions.append("c.sentiment = :sentiment")
        params["sentiment"] = sentiment
    if intent:
        conditions.append("c.intent = :intent")
        params["intent"] = intent
    if zone:
        conditions.append("m.zone = :zone")
        params["zone"] = zone
    if merchant:
        conditions.append("m.merchant_name = :merchant")
        params["merchant"] = merchant
    # Compare on date() so an end of "today" includes all of today, matching the
    # aggregate endpoints' _date_clauses(); a raw timestamp <= would cut off at
    # midnight and drop the current day from the feed.
    if from_date:
        conditions.append("date(m.created_at) >= date(:from_date)")
        params["from_date"] = from_date
    if to_date:
        conditions.append("date(m.created_at) <= date(:to_date)")
        params["to_date"] = to_date

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    total = db.query_one(f"""
        SELECT COUNT(*) AS cnt
        FROM classifications c JOIN messages m ON c.message_id = m.message_id {where}
    """, params)["cnt"]

    rows = db.query(f"""
        {_MV_WITH}
        SELECT c.classification_id, c.message_id, c.sentiment, c.sentiment_confidence,
               c.intent, c.intent_confidence, c.negative_trigger, c.model_version,
               c.classified_at,
               m.content, m.source_channel, m.merchant_name, m.zone, m.customer_id,
               {_VERTICAL} AS vertical,
               m.created_at AS msg_created_at,
               m.ingested_at AS msg_ingested_at,
               m.closed_at AS msg_closed_at,
               m.agent_name AS agent_name
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN} {where}
        ORDER BY c.classified_at DESC, c.message_id
        LIMIT :page_size OFFSET :offset
    """, {**params, "page_size": page_size, "offset": (page - 1) * page_size})
    return int(total), rows


@ttl_cache
async def query_classifications(
    sentiment: Optional[str] = None, intent: Optional[str] = None,
    zone: Optional[str] = None, merchant: Optional[str] = None,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    page: int = 1, page_size: int = 50,
) -> tuple[int, list[dict]]:
    return await _offload(
        _query_classifications_sync,
        sentiment, intent, zone, merchant, from_date, to_date, page, page_size,
    )


# ---------------------------------------------------------------------------
# Analytics queries
# ---------------------------------------------------------------------------

# Optional [start, end] date window (YYYY-MM-DD) applied to the analytics
# queries. Text rows are dated by m.created_at; call rows by analysed_at.
def _date_params(start: Optional[str], end: Optional[str]) -> dict:
    params = {}
    if start:
        params["start_date"] = start
    if end:
        params["end_date"] = end
    return params


def _date_clauses(col: str, start: Optional[str], end: Optional[str]) -> list[str]:
    clauses = []
    if start:
        clauses.append(f"date({col}) >= date(:start_date)")
    if end:
        clauses.append(f"date({col}) <= date(:end_date)")
    return clauses


def _sentiment_trend_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> list[dict]:
    conditions = ["m.created_at IS NOT NULL", *_date_clauses("m.created_at", start, end)]
    if vertical:
        conditions.append(f"{_VERTICAL} = :vertical")
    if zone:
        conditions.append(_MSG_ZONE)
    return db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT week_start(m.created_at) AS week_start, c.sentiment, COUNT(*) AS cnt
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN if vertical else ""}
        WHERE {" AND ".join(conditions)}
        GROUP BY 1, 2 ORDER BY 1
    """, {**_date_params(start, end), **_vertical_param(vertical), **_zone_param(zone)})


async def query_sentiment_trend(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> list[dict]:
    return await _offload(_sentiment_trend_sync, start, end, vertical, zone)


# Gemini's negative_trigger is free-form ("delayed delivery", "order delay",
# "late delivery", "severe delivery delay"… all mean the same thing), so the
# top-triggers ranking canonicalises synonyms into distinct reasons before
# grouping. CASE order matters: specific reasons (refund, location) must match
# before broad ones (delay). Unrecognised phrases pass through unchanged.
def _canonical_trigger(col: str) -> str:
    lt = f"LOWER(TRIM({col}))"
    return f"""CASE
        WHEN regexp_contains({lt}, 'refund') THEN 'refund issue'
        WHEN regexp_contains({lt}, 'promo|coupon|voucher|payment|charge|overcharg') THEN 'payment & promo issue'
        WHEN regexp_contains({lt}, 'location|address') THEN 'wrong delivery location'
        WHEN regexp_contains({lt}, 'missing|incomplete') THEN 'missing items'
        WHEN regexp_contains({lt}, 'wrong|incorrect') THEN 'wrong item'
        WHEN regexp_contains({lt}, 'unavailable|out of stock') THEN 'item unavailable'
        WHEN regexp_contains({lt}, 'not received|not delivered|never arrived') THEN 'order not received'
        WHEN regexp_contains({lt}, 'delay|late|slow|long wait|waiting') THEN 'delayed delivery'
        WHEN regexp_contains({lt}, 'cancel|accidental') THEN 'order cancellation'
        WHEN regexp_contains({lt}, 'food|cold|quality|stale|spoiled|hair|taste|expired') THEN 'food quality'
        WHEN regexp_contains({lt}, 'driver|rider|courier') THEN 'driver issue'
        ELSE {lt}
    END"""


_TOD_RANGES = {"morning": (6, 12), "afternoon": (12, 18), "evening": (18, 22), "night": (22, 6)}


def _top_triggers_sync(
    merchant: Optional[str], zone: Optional[str], time_of_day: Optional[str],
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    conditions = ["c.sentiment = 'negative'", "c.negative_trigger IS NOT NULL"]
    params = {**_date_params(start, end), **_vertical_param(vertical)}
    conditions += _date_clauses("m.created_at", start, end)
    if vertical:
        conditions.append(f"{_VERTICAL} = :vertical")

    if merchant:
        conditions.append("m.merchant_name = :merchant")
        params["merchant"] = merchant
    if zone:
        conditions.append("m.zone = :zone")
        params["zone"] = zone
    if time_of_day in _TOD_RANGES:
        s_h, e_h = _TOD_RANGES[time_of_day]
        hour = hour_of("m.created_at")
        if time_of_day == "night":
            conditions.append(f"({hour} >= :tod_start OR {hour} < :tod_end)")
        else:
            conditions.append(f"{hour} BETWEEN :tod_start AND :tod_end")
        params |= {"tod_start": s_h, "tod_end": e_h}

    hour = hour_of("m.created_at")
    rows = db.query(f"""
        {_MV_WITH}
        SELECT {_canonical_trigger('c.negative_trigger')} AS trigger, COUNT(*) AS cnt,
               group_concat(DISTINCT m.merchant_name) AS top_merchants,
               group_concat(DISTINCT m.zone) AS top_zones,
               mode_value({_VERTICAL}) AS top_vertical,
               {countif(f"{hour} BETWEEN 6 AND 11")} AS morning_cnt,
               {countif(f"{hour} BETWEEN 12 AND 17")} AS afternoon_cnt,
               {countif(f"{hour} BETWEEN 18 AND 21")} AS evening_cnt,
               {countif(f"{hour} >= 22 OR {hour} < 6")} AS night_cnt
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN}
        WHERE {" AND ".join(conditions)}
        GROUP BY 1 ORDER BY cnt DESC LIMIT 5
    """, params)
    for r in rows:
        r["top_merchants"] = db.split_agg(r["top_merchants"])[:5]
        r["top_zones"] = db.split_agg(r["top_zones"])[:5]
    return rows


async def query_top_triggers(
    merchant: Optional[str] = None, zone: Optional[str] = None, time_of_day: Optional[str] = None,
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    return await _offload(_top_triggers_sync, merchant, zone, time_of_day, start, end, vertical)


def _text_conditions(
    start: Optional[str], end: Optional[str], vertical: Optional[str],
    zone: Optional[str] = None,
) -> tuple[str, dict]:
    """(WHERE sql, params) for messages-joined queries."""
    conditions = _date_clauses("m.created_at", start, end)
    if vertical:
        conditions.append(f"{_VERTICAL} = :vertical")
    if zone:
        conditions.append(_MSG_ZONE)
    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where_sql, {**_date_params(start, end), **_vertical_param(vertical), **_zone_param(zone)}


def _text_sentiment_summary_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> dict:
    where_sql, params = _text_conditions(start, end, vertical, zone=zone)
    rows = {r["sentiment"]: int(r["cnt"]) for r in db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT c.sentiment AS sentiment, COUNT(*) AS cnt
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN if vertical else ""}
        {where_sql} GROUP BY 1
    """, params)}
    return {"total": sum(rows.values()), **rows}


def _text_intent_counts_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> dict:
    where_sql, params = _text_conditions(start, end, vertical, zone=zone)
    return {r["intent"]: int(r["cnt"]) for r in db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT c.intent AS intent, COUNT(*) AS cnt
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN if vertical else ""}
        {where_sql} GROUP BY 1
    """, params)}


# Calls carry restaurant names as a JSON string array — resolve the vertical
# through the first named merchant.
_CALL_MV_JOIN = "LEFT JOIN mv ON json_extract(ca.restaurant_names, '$[0]') = mv.merchant_name"


def _call_conditions(
    start: Optional[str], end: Optional[str], vertical: Optional[str], extra: tuple[str, ...] = (),
    zone: Optional[str] = None,
) -> tuple[str, dict]:
    conditions = [*extra, *_date_clauses("ca.analysed_at", start, end)]
    if vertical:
        conditions.append(f"{_VERTICAL} = :vertical")
    if zone:
        conditions.append(_CALL_ZONE)
    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where_sql, {**_date_params(start, end), **_vertical_param(vertical), **_zone_param(zone)}


def _call_sentiment_summary_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> dict:
    where_sql, params = _call_conditions(start, end, vertical, zone=zone)
    rows = {r["sentiment"]: int(r["cnt"]) for r in db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT ca.sentiment AS sentiment, COUNT(*) AS cnt
        FROM call_analysis ca
        {_CALL_MV_JOIN if vertical else ""}
        {where_sql} GROUP BY 1
    """, params)}
    return {"total": sum(rows.values()), **rows}


def _call_intent_counts_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> dict:
    where_sql, params = _call_conditions(
        start, end, vertical, extra=("ca.primary_intent IS NOT NULL",), zone=zone)
    return {r["intent"]: int(r["cnt"]) for r in db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT ca.primary_intent AS intent, COUNT(*) AS cnt
        FROM call_analysis ca
        {_CALL_MV_JOIN if vertical else ""}
        {where_sql} GROUP BY 1
    """, params)}


async def query_cross_channel_data(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> dict:
    loop = asyncio.get_running_loop()
    results = await asyncio.gather(
        loop.run_in_executor(None, _text_sentiment_summary_sync, start, end, vertical, zone),
        loop.run_in_executor(None, _text_intent_counts_sync, start, end, vertical, zone),
        loop.run_in_executor(None, _call_sentiment_summary_sync, start, end, vertical, zone),
        loop.run_in_executor(None, _call_intent_counts_sync, start, end, vertical, zone),
    )
    return {
        "text_sentiment": results[0], "text_intents": results[1],
        "call_sentiment": results[2], "call_intents": results[3],
    }


def _intent_distribution_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    where_sql, params = _text_conditions(start, end, vertical)
    return db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT c.intent AS intent, COUNT(*) AS cnt
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN if vertical else ""}
        {where_sql} GROUP BY 1 ORDER BY cnt DESC
    """, params)


async def query_intent_distribution(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    return await _offload(_intent_distribution_sync, start, end, vertical)


def _merchant_sentiment_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    conditions = ["m.merchant_name IS NOT NULL", *_date_clauses("m.created_at", start, end)]
    if vertical:
        conditions.append(f"{_VERTICAL} = :vertical")
    return db.query(f"""
        {_MV_WITH}
        SELECT m.merchant_name, {_VERTICAL} AS vertical, COUNT(*) AS total,
               {countif("c.sentiment = 'positive'")} AS positive,
               {countif("c.sentiment = 'neutral'")} AS neutral,
               {countif("c.sentiment = 'negative'")} AS negative
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN}
        WHERE {" AND ".join(conditions)}
        GROUP BY 1, 2 ORDER BY total DESC
    """, {**_date_params(start, end), **_vertical_param(vertical)})


async def query_merchant_sentiment(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    return await _offload(_merchant_sentiment_sync, start, end, vertical)


def _zone_heatmap_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    conditions = ["m.zone IS NOT NULL", *_date_clauses("m.created_at", start, end)]
    if vertical:
        conditions.append(f"{_VERTICAL} = :vertical")
    return db.query(f"""
        {_MV_WITH}
        SELECT m.zone, COUNT(*) AS total,
               {countif("c.sentiment = 'negative'")} AS negative,
               mode_value({_VERTICAL}) AS top_vertical
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN}
        WHERE {" AND ".join(conditions)}
        GROUP BY 1 ORDER BY negative DESC
    """, {**_date_params(start, end), **_vertical_param(vertical)})


async def query_zone_heatmap(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    return await _offload(_zone_heatmap_sync, start, end, vertical)


def _negative_customers_sync(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    """Distinct customers with any negative-sentiment message in the window — the
    coupon-campaign export. One row per customer, most-negative first."""
    conditions = ["c.sentiment = 'negative'", "m.customer_id IS NOT NULL",
                  *_date_clauses("m.created_at", start, end)]
    if vertical:
        conditions.append(f"{_VERTICAL} = :vertical")
    return db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT m.customer_id,
               COUNT(*) AS negative_messages,
               date(MAX(m.created_at)) AS last_negative_at
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN if vertical else ""}
        WHERE {" AND ".join(conditions)}
        GROUP BY 1 ORDER BY negative_messages DESC
    """, {**_date_params(start, end), **_vertical_param(vertical)})


async def query_negative_customers(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    return await _offload(_negative_customers_sync, start, end, vertical)


# Handling time = closed_at − created_at, or frozen-now − created_at while open.
_DUR_H = hours_between(f"COALESCE(m.closed_at, {SQL_NOW})", "m.created_at")
_BREACH = f"{_DUR_H} > (CASE WHEN m.source_channel = 'ticket' THEN :general_sla ELSE :chat_sla END)"


def _sla_breaches_sync(
    start: Optional[str], end: Optional[str],
    chat_sla_hours: float, general_sla_hours: float,
    vertical: Optional[str] = None, limit: int = 1000,
) -> list[dict]:
    """Individual SLA-breaching messages (handling time past the channel's SLA) —
    the drill-down behind the SLA notifications. Same handling-time + threshold
    rule as the overview's breach counts; most-overdue first. Messages-only (no
    classification join) so each row is a unique, clickable conversation."""
    conds = _date_clauses("m.created_at", start, end)
    if vertical:
        conds.append(f"{_VERTICAL} = :vertical")
    conds.append(_BREACH)
    params = {
        **_date_params(start, end), **_vertical_param(vertical),
        "chat_sla": chat_sla_hours, "general_sla": general_sla_hours, "lim": limit,
    }
    return db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT m.message_id,
               m.source_channel AS channel,
               ROUND({_DUR_H}, 1) AS hours,
               m.closed_at IS NOT NULL AS resolved
        FROM messages m
        {_MV_JOIN if vertical else ""}
        WHERE {" AND ".join(conds)}
        ORDER BY hours DESC
        LIMIT :lim
    """, params)


async def query_sla_breaches(
    start: Optional[str], end: Optional[str],
    chat_sla_hours: float, general_sla_hours: float, vertical: Optional[str] = None,
) -> list[dict]:
    return await _offload(
        _sla_breaches_sync, start, end, chat_sla_hours, general_sla_hours, vertical
    )


def _tod_counts(name: str, bucket_cond: str) -> str:
    """positive/neutral/negative counts for one time-of-day bucket."""
    return ", ".join(
        f"{countif(f'''({bucket_cond}) AND c.sentiment = '{s}' ''')} AS {name}_{s}"
        for s in ("positive", "neutral", "negative")
    )


# Full-corpus stats for the Support Messages stat cards + time-of-day chart +
# SLA-breach banner — computed in SQL so they reflect all rows, not the 1000-row
# feed the UI paginates. SLA thresholds (hours) are passed in from the caller's
# settings; a Ticket uses the general SLA, every other channel the chat SLA.
def _message_overview_sync(
    start: Optional[str], end: Optional[str],
    chat_sla_hours: float, general_sla_hours: float,
    vertical: Optional[str] = None, zone: Optional[str] = None,
) -> dict:
    where = _date_clauses("m.created_at", start, end)
    if vertical:
        where.append(f"{_VERTICAL} = :vertical")
    if zone:
        where.append(_MSG_ZONE)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params = {
        **_date_params(start, end), **_vertical_param(vertical), **_zone_param(zone),
        "chat_sla": chat_sla_hours, "general_sla": general_sla_hours,
    }
    hour = hour_of("m.created_at")
    row = db.query_one(f"""
        {_MV_WITH}
        SELECT
          COUNT(*) AS total,
          {countif("c.sentiment = 'negative'")} AS negative,
          {countif("m.agent_name IS NOT NULL")} AS escalated,
          mode_value(c.intent) AS top_intent,
          mode_value(m.source_channel) AS top_channel,
          mode_value({_VERTICAL}) AS top_vertical,
          {_tod_counts('morning', f'{hour} BETWEEN 6 AND 11')},
          {_tod_counts('afternoon', f'{hour} BETWEEN 12 AND 17')},
          {_tod_counts('evening', f'{hour} BETWEEN 18 AND 21')},
          {_tod_counts('night', f'{hour} >= 22 OR {hour} < 6')}
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN}
        {where_sql}
    """, params)
    sla = db.query(f"""
        {_MV_WITH if vertical else ""}
        SELECT m.source_channel AS channel, {countif(_BREACH)} AS breaches
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN if vertical else ""}
        {where_sql}
        GROUP BY 1 HAVING breaches > 0 ORDER BY breaches DESC
    """, params)
    row["sla_breaches"] = [{"channel": r["channel"], "count": int(r["breaches"])} for r in sla]
    return row


async def query_message_overview(
    start: Optional[str] = None, end: Optional[str] = None,
    chat_sla_hours: float = 4.0, general_sla_hours: float = 24.0,
    vertical: Optional[str] = None, zone: Optional[str] = None,
) -> dict:
    return await _offload(
        _message_overview_sync, start, end, chat_sla_hours, general_sla_hours, vertical, zone
    )


async def query_accuracy_rows() -> list[dict]:
    return await _offload(lambda: db.query("""
        SELECT l.true_sentiment, l.true_intent, c.sentiment AS pred_sentiment, c.intent AS pred_intent
        FROM labels l
        JOIN classifications c ON l.message_id = c.message_id
    """))


async def ping() -> bool:
    return await _offload(db.ping)


# ---------------------------------------------------------------------------
# Handled by: bot vs human agent
# ---------------------------------------------------------------------------
# A conversation with no agent_name was closed by the bot; one with an agent_name
# was escalated to (and handled by) a human. Sentiment is split per handler so
# leadership can compare outcome quality between the two.
def _handled_by_sync(
    start: Optional[str], end: Optional[str], vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> list[dict]:
    where = _date_clauses("m.created_at", start, end)
    if vertical:
        where.append(f"{_VERTICAL} = :vertical")
    if zone:
        where.append(_MSG_ZONE)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(f"""
        {_MV_WITH}
        SELECT
          CASE WHEN m.agent_name IS NULL OR TRIM(m.agent_name) = ''
               THEN 'Bot' ELSE 'Agent' END AS handler,
          COUNT(*) AS handled,
          {countif("c.sentiment = 'positive'")} AS positive,
          {countif("c.sentiment = 'neutral'")}  AS neutral,
          {countif("c.sentiment = 'negative'")} AS negative,
          {countif("m.closed_at IS NOT NULL")}  AS resolved
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        {_MV_JOIN}
        {where_sql}
        GROUP BY handler
    """, {**_date_params(start, end), **_vertical_param(vertical), **_zone_param(zone)})
    out = {r["handler"]: r for r in rows}
    return [
        {
            "handler": h,
            "handled": int((out.get(h) or {}).get("handled", 0)),
            "positive": int((out.get(h) or {}).get("positive", 0)),
            "neutral": int((out.get(h) or {}).get("neutral", 0)),
            "negative": int((out.get(h) or {}).get("negative", 0)),
            "resolved": int((out.get(h) or {}).get("resolved", 0)),
        }
        for h in ("Bot", "Agent")
    ]


async def query_handled_by(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
    zone: Optional[str] = None,
) -> list[dict]:
    return await _offload(_handled_by_sync, start, end, vertical, zone)
