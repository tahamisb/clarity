"""Support-message dashboard aggregates (the /api/messages/* endpoints)."""

import asyncio
import logging
from typing import Optional

from app.services import warehouse as db
from app.services.warehouse import countif, hour_of, safe_divide, shift_hours
from app.services.ttl_cache import ttl_cache

logger = logging.getLogger(__name__)


async def _offload(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)


def _query_stats_sync() -> dict:
    overview = db.query_one(f"""
        SELECT COUNT(*) AS total,
               {countif("c.sentiment = 'negative'")} AS negative_count,
               ROUND({safe_divide(countif("c.sentiment = 'negative'"), "COUNT(*)")} * 100, 1) AS negative_pct
        FROM classifications c
    """)

    intent_rows = db.query("""
        SELECT intent, COUNT(*) AS cnt FROM classifications
        GROUP BY intent ORDER BY cnt DESC LIMIT 1
    """)
    top_intent = intent_rows[0]["intent"] if intent_rows else "—"

    channel_rows = db.query("""
        SELECT m.source_channel, COUNT(*) AS cnt
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        GROUP BY m.source_channel ORDER BY cnt DESC LIMIT 1
    """)
    top_channel = channel_rows[0]["source_channel"] if channel_rows else "—"

    wow_rows = db.query("""
        SELECT week_start(m.created_at) AS week_start, COUNT(*) AS volume
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        WHERE m.created_at IS NOT NULL
        GROUP BY week_start ORDER BY week_start DESC LIMIT 2
    """)
    wow_change = "+0%"
    if len(wow_rows) == 2:
        curr, prev = wow_rows[0]["volume"], wow_rows[1]["volume"]
        if prev > 0:
            diff = ((curr - prev) / prev) * 100
            wow_change = f"+{diff:.1f}%" if diff >= 0 else f"{diff:.1f}%"

    return {
        "total_messages": overview["total"],
        "negative_sentiment_pct": overview["negative_pct"] or 0.0,
        "most_common_intent": top_intent,
        "most_active_channel": top_channel.capitalize() if top_channel != "—" else top_channel,
        "wow_volume_change": wow_change,
    }


async def get_messages_stats() -> dict:
    return await _offload(_query_stats_sync)


def _contact_rate_sync(start: Optional[str], end: Optional[str]) -> dict:
    # Orders go back further than chat coverage does, so an unclamped "All"
    # divides contacts by a denominator that never could have produced any.
    # Derived from the data rather than hard-coded to 2026-01-01: against a
    # live warehouse on a rolling window, that constant silently drifts wrong.
    if not start:
        first_chat = db.query_one("SELECT MIN(created_at) AS first FROM chat_history")
        start = str(first_chat["first"])[:10] if first_chat and first_chat["first"] else None
    # Order-level: share of orders placed in the window that have at least one
    # support chat linked via chat_history.order_id AND opened after the order
    # was placed. Chats without an order_id (most bot/general chats) can't be
    # attributed to an order and don't count. Orders with a NULL placement time
    # fall back to midnight. chat_history.created_at is UTC while
    # order_placement_time is Qatar local (UTC+3, no DST) — hence the shift.
    # Built conditionally rather than as `:start IS NULL OR col >= :start`.
    # That guard forces the parameter's type to text, and the column is a real
    # date now, so Postgres finds no `date >= text` operator. Omitting the
    # clause entirely also lets the planner use the index on the date column,
    # which the null-guard form prevented.
    clauses, params = [], {}
    if start:
        clauses.append("o.order_placement_date >= :start")
        params["start"] = start
    if end:
        clauses.append("o.order_placement_date <= :end")
        params["end"] = end
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    row = db.query_one(f"""
        WITH chat_orders AS (
            SELECT order_id, {shift_hours("MAX(created_at)", 3)} AS last_chat_at_qatar
            FROM chat_history
            WHERE order_id IS NOT NULL
            GROUP BY order_id
        )
        SELECT
            COUNT(*) AS total_orders,
            {countif("co.order_id IS NOT NULL")} AS orders_with_chat,
            {countif(
                "co.order_id IS NOT NULL AND co.last_chat_at_qatar >= "
                "(o.order_placement_date || ' ' || COALESCE(o.order_placement_time, '00:00:00'))"
            )} AS orders_with_chat_after
        FROM vendor_kpi o
        LEFT JOIN chat_orders co ON o.id = co.order_id
        {where}
    """, params)
    total, contacted = row["total_orders"], row["orders_with_chat_after"]
    return {
        "total_orders": total,
        "orders_with_chat": row["orders_with_chat"],
        "orders_with_chat_after": contacted,
        "contact_rate_pct": round(contacted / total * 100, 1) if total else 0.0,
    }


@ttl_cache
async def get_contact_rate(start: Optional[str] = None, end: Optional[str] = None) -> dict:
    return await _offload(_contact_rate_sync, start, end)


_TOD_RANGES = {"Morning": (6, 12), "Afternoon": (12, 18), "Evening": (18, 22), "Night": (22, 6)}


def _query_list_sync(
    channel: Optional[str], intent: Optional[str], sentiment: Optional[str],
    zone: Optional[str], time_of_day: Optional[str], page: int, limit: int,
) -> dict:
    conditions, params = [], {}
    if channel:
        conditions.append("m.source_channel = :channel")
        params["channel"] = channel
    if intent:
        conditions.append("c.intent = :intent")
        params["intent"] = intent
    if sentiment:
        conditions.append("c.sentiment = :sentiment")
        params["sentiment"] = sentiment
    if zone:
        conditions.append("m.zone = :zone")
        params["zone"] = zone
    if time_of_day in _TOD_RANGES:
        s_h, e_h = _TOD_RANGES[time_of_day]
        hour = hour_of("m.created_at")
        if time_of_day == "Night":
            conditions.append(f"({hour} >= :tod_start OR {hour} < :tod_end)")
        else:
            conditions.append(f"{hour} BETWEEN :tod_start AND :tod_end")
        params |= {"tod_start": s_h, "tod_end": e_h}

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    join = f"FROM classifications c JOIN messages m ON c.message_id = m.message_id {where}"

    total = db.query_one(f"SELECT COUNT(*) AS cnt {join}", params)["cnt"]
    rows = db.query(f"""
        SELECT m.message_id AS id, m.content AS text, m.source_channel AS channel,
               c.intent, c.sentiment, m.zone, m.created_at AS datetime
        {join} ORDER BY m.created_at DESC
        LIMIT :limit OFFSET :offset
    """, {**params, "limit": limit, "offset": (page - 1) * limit})

    return {"total": total, "page": page, "limit": limit, "items": rows}


async def get_messages_list(channel, intent, sentiment, zone, time_of_day, page, limit) -> dict:
    return await _offload(
        _query_list_sync, channel, intent, sentiment, zone, time_of_day, page, limit
    )


def _query_triggers_sync() -> list[dict]:
    hour = hour_of("m.created_at")
    rows = db.query(f"""
        SELECT c.negative_trigger AS trigger, COUNT(*) AS volume,
               group_concat(DISTINCT m.zone) AS top_zones,
               {countif(f"{hour} BETWEEN 6 AND 11")} AS morning,
               {countif(f"{hour} BETWEEN 12 AND 17")} AS afternoon,
               {countif(f"{hour} BETWEEN 18 AND 21")} AS evening,
               {countif(f"{hour} >= 22 OR {hour} < 6")} AS night
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        WHERE c.sentiment = 'negative' AND c.negative_trigger IS NOT NULL
        GROUP BY 1 ORDER BY volume DESC LIMIT 5
    """)
    out = []
    for d in rows:
        zones = db.split_agg(d["top_zones"])[:5]
        times = {"Morning": d["morning"], "Afternoon": d["afternoon"],
                 "Evening": d["evening"], "Night": d["night"]}
        out.append({
            "trigger": d["trigger"],
            "volume": d["volume"],
            "zone": zones[0] if zones else "Unknown",
            "time": max(times.items(), key=lambda x: x[1])[0],
        })
    return out


async def get_top_triggers() -> list[dict]:
    return await _offload(_query_triggers_sync)


def _query_sentiment_trend_sync() -> list[dict]:
    rows = db.query(f"""
        SELECT week_start(m.created_at) AS week,
               {countif("c.sentiment = 'positive'")} AS positive,
               {countif("c.sentiment = 'neutral'")} AS neutral,
               {countif("c.sentiment = 'negative'")} AS negative
        FROM classifications c
        JOIN messages m ON c.message_id = m.message_id
        WHERE m.created_at IS NOT NULL
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    """)
    rows.reverse()
    return rows


async def get_sentiment_trend() -> list[dict]:
    return await _offload(_query_sentiment_trend_sync)


def _query_cross_channel_sync() -> list[dict]:
    calls = {r["intent"]: int(r["cnt"]) for r in db.query("""
        SELECT primary_intent AS intent, COUNT(*) AS cnt FROM call_analysis
        WHERE primary_intent IS NOT NULL GROUP BY 1
    """)}
    msgs = {r["intent"]: int(r["cnt"]) for r in db.query("""
        SELECT intent, COUNT(*) AS cnt FROM classifications
        WHERE intent IS NOT NULL GROUP BY 1
    """)}
    rows = [
        {"intent": i.replace("_", " ").title(),
         "callVolume": calls.get(i, 0), "messageVolume": msgs.get(i, 0)}
        for i in set(calls) | set(msgs)
    ]
    return sorted(rows, key=lambda x: x["messageVolume"] + x["callVolume"], reverse=True)


async def get_cross_channel() -> list[dict]:
    return await _offload(_query_cross_channel_sync)


def _get_chat_detail_sync(chat_id: str) -> Optional[dict]:
    return db.query_one("""
        SELECT m.message_id AS id, m.content AS text, m.source_channel AS channel,
               c.intent, c.sentiment, m.zone, m.created_at AS datetime
        FROM messages m
        LEFT JOIN classifications c ON m.message_id = c.message_id
        WHERE m.message_id = ? LIMIT 1
    """, (chat_id,))


async def get_chat_detail(chat_id: str) -> Optional[dict]:
    return await _offload(_get_chat_detail_sync, chat_id)
