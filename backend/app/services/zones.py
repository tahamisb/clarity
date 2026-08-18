"""
Delivery zones — the geographic filter shared by every pillar.

Orders (vendor_kpi.zone_name), support messages (messages.zone) and analysed
calls (call_analysis.areas) all use the same plain zone names ("Ain Khaled",
"West Bay"), so one vocabulary scopes all three with no mapping layer.

The list is read from the warehouse rather than hardcoded — a hardcoded list
goes stale the moment operations opens a zone, and silently drops its rows from
every filtered view. Cached because it changes at the pace of city expansion.
"""

from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cached: tuple[str, ...] | None = None


def all_zones() -> tuple[str, ...]:
    """Every zone with orders, alphabetical. Cached for the process lifetime."""
    global _cached
    if _cached is not None:
        return _cached
    with _lock:
        if _cached is not None:
            return _cached
        from app.services import local_db as db
        try:
            rows = db.query("""
                SELECT DISTINCT zone_name AS zone FROM vendor_kpi
                WHERE zone_name IS NOT NULL AND TRIM(zone_name) != ''
                ORDER BY zone
            """)
            _cached = tuple(r["zone"] for r in rows)
        except Exception as exc:  # noqa: BLE001 — a filter list must not 500 the app
            logger.warning("Zone list unavailable, zone filtering disabled: %s", exc)
            _cached = ()
    return _cached


def clear_cache() -> None:
    global _cached
    _cached = None


def is_valid(zone: str) -> bool:
    return zone in all_zones()


def _quote(zone: str) -> str:
    assert is_valid(zone), f"unvalidated zone: {zone!r}"
    return "'" + zone.replace("'", "''") + "'"


def zone_pred(zone: str | None, col: str = "zone_name") -> str:
    """` AND <col> = '<zone>'` fragment, "" when no filter.

    `zone` must be pre-validated with is_valid() — same whitelist convention as
    vertical_pred(), so interpolation is safe.
    """
    if not zone:
        return ""
    return f" AND {col} = {_quote(zone)}"
