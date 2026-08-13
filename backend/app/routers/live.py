"""
Liveness of the *data*, not of the service.

`/health` answers "is the backend up". This answers the question a viewer
actually has in front of a live dashboard: **is what I am looking at current?**

They come apart in the way that matters. If the simulator (or, later, the real
ingestion pipeline) stops, every service stays green, every query still
returns, and the charts quietly freeze at whatever they last showed. That is
the most likely way a demo goes wrong, and the failure is invisible unless
something is watching the data's age rather than the server's.

So the UI polls this, shows the age, and degrades to an explicit stale state
when it grows. A dashboard that admits it is stale is useful; one that shows
old numbers as though they were current is worse than one that is down.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter

from app.services import warehouse as db
from app.utils import clock

router = APIRouter(prefix="/api/v1/live", tags=["live"])
logger = logging.getLogger(__name__)

# How far behind the newest row can fall before the UI stops calling it live.
# Generous relative to the tick interval: at 04:00 Doha a genuinely quiet hour
# can pass with only a handful of orders, and calling that an outage would be
# crying wolf.
FRESH_WITHIN_S = 300
STALE_AFTER_S = 1800


def _counts_sync() -> dict:
    """Newest row and recent volume per stream, in one round trip.

    A single query rather than four: this is polled every few seconds by every
    open dashboard, and four scans of the biggest tables in the warehouse is a
    silly amount of work to answer "anything new?".
    """
    now = db.sql_now()
    # Order placement is recorded in QATAR LOCAL time (a date + time pair, as
    # the source system does it) while every other timestamp is UTC. Shifting
    # it back is what makes "how old is the newest order" a real answer rather
    # than one that reads three hours fresh.
    local_order_ts = "order_placement_date || ' ' || order_placement_time"
    order_ts_utc = db.shift_hours(local_order_ts, -db.business_utc_offset_hours())
    row = db.query_one(f"""
        SELECT
          (SELECT {order_ts_utc} FROM vendor_kpi
            ORDER BY order_placement_date DESC, order_placement_time DESC
            LIMIT 1)                                             AS last_order_at,
          (SELECT COUNT(*) FROM vendor_kpi
            WHERE order_placement_date >= :today)                AS orders_today,
          (SELECT MAX(created_at) FROM messages)                 AS last_message_at,
          (SELECT COUNT(*) FROM messages WHERE created_at >= :today) AS messages_today,
          (SELECT MAX(analysed_at) FROM call_analysis)           AS last_call_at,
          (SELECT COUNT(*) FROM vendor_kpi
            WHERE order_status IN ('Accepted','Preparing','Ready for pickup','Out for delivery')
          )                                                      AS in_flight,
          {now}                                                  AS server_now
    """, {"today": clock.today().isoformat()})
    return row or {}


@router.get("")
async def live_status() -> dict:
    """Freshness of each stream, plus a single verdict the UI can render."""
    loop = asyncio.get_running_loop()
    try:
        row = await loop.run_in_executor(None, _counts_sync)
    except Exception as exc:  # noqa: BLE001 — a broken query must not look "live"
        logger.error("live status query failed: %s", exc)
        return {"state": "unknown", "error": str(exc)[:200], "clock": clock.MODE}

    now = clock.now()

    def age(value) -> float | None:
        if not value:
            return None
        from app.utils.helpers import parse_datetime_or_now  # noqa: PLC0415

        return max(0.0, (now - parse_datetime_or_now(value)).total_seconds())

    order_age = age(row.get("last_order_at"))
    message_age = age(row.get("last_message_at"))

    # Orders are the heartbeat: they arrive far more often than support
    # contacts, so a gap in them is the earliest reliable signal.
    if clock.FROZEN:
        state = "frozen"
    elif order_age is None:
        state = "unknown"
    elif order_age <= FRESH_WITHIN_S:
        state = "live"
    elif order_age <= STALE_AFTER_S:
        state = "lagging"
    else:
        state = "stale"

    return {
        "state": state,
        "clock": clock.MODE,
        "warehouse": db.BACKEND,
        "server_now": now.isoformat(),
        "orders": {
            "last_at": row.get("last_order_at"),
            "age_seconds": order_age,
            "today": row.get("orders_today"),
            "in_flight": row.get("in_flight"),
        },
        "messages": {
            "last_at": row.get("last_message_at"),
            "age_seconds": message_age,
            "today": row.get("messages_today"),
        },
        "calls": {"last_at": row.get("last_call_at")},
        "thresholds": {"fresh_within_s": FRESH_WITHIN_S, "stale_after_s": STALE_AFTER_S},
    }
