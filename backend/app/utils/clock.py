"""
The app's clock — real time, or pinned to a fixed instant.

Which one depends on where the data comes from, and getting this wrong is the
difference between a working dashboard and an empty one:

  **The SQLite snapshot** ends on a fixed day (2026-07-28). Against it, "now"
  must be that day, or every calendar preset (WTD/MTD/QTD/YTD), the range
  picker and the SLA "still open" maths select a window with no data in it.

  **The simulated Postgres warehouse** runs up to the present and keeps
  going. Against it, "now" must be the real clock, or the dashboard shows a
  stale slice of a live system — which is the whole thing this project exists
  to fix.

So the default is `auto`: frozen on sqlite, live on postgres. Override with
`CLOCK_MODE=live|frozen` when you want to force it — a frozen clock is still
the right choice for an offline presentation with no warehouse behind it.

Frontend twin: frontend/lib/clock.ts. The two are configured together (see
docker-compose.warehouse.yml); if they disagree, the frontend asks for a window
the backend has no data for. `GET /api/v1/health` reports which mode the
backend is in so a mismatch is diagnosable rather than mysterious.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.config import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()

# The legacy snapshot's last day. Only meaningful in frozen mode, but exported
# unconditionally because scripts/generate_mock_db.py builds that snapshot and
# has to agree with it.
FROZEN_TODAY = date(2026, 7, 28)
FROZEN_NOW = datetime(2026, 7, 28, 21, 45, 0, tzinfo=timezone.utc)

# Qatar is UTC+3 year-round with no DST, which is why a fixed offset is safe in
# the SQLite fragments that have no timezone database to consult.
BUSINESS_TZ = ZoneInfo(_settings.business_timezone)


def _resolve_mode() -> str:
    mode = _settings.clock_mode.strip().lower()
    if mode not in ("auto", "live", "frozen"):
        raise RuntimeError(f"CLOCK_MODE must be auto|live|frozen, got {mode!r}")
    if mode != "auto":
        return mode
    return "frozen" if _settings.warehouse_backend.strip().lower() == "sqlite" else "live"


MODE = _resolve_mode()
FROZEN = MODE == "frozen"

if FROZEN and _settings.clock_frozen_at:
    FROZEN_NOW = datetime.fromisoformat(_settings.clock_frozen_at)
    if FROZEN_NOW.tzinfo is None:
        FROZEN_NOW = FROZEN_NOW.replace(tzinfo=timezone.utc)
    FROZEN_TODAY = FROZEN_NOW.date()


def now() -> datetime:
    """Current instant, UTC-aware."""
    return FROZEN_NOW if FROZEN else datetime.now(timezone.utc)


def today() -> date:
    """Today in *business* time, not UTC.

    A dashboard's "today" is the operator's day. At 01:00 in Doha it is
    already tomorrow there while UTC still says yesterday, and a WTD window
    computed off UTC would silently drop the first three hours of trading.
    """
    return now().astimezone(BUSINESS_TZ).date()


def now_iso() -> str:
    return now().isoformat()


def now_sql() -> str:
    """'YYYY-MM-DD HH:MM:SS' UTC — the storage format of every timestamp column."""
    return now().strftime("%Y-%m-%d %H:%M:%S")


def describe() -> str:
    return f"frozen at {FROZEN_NOW.isoformat()}" if FROZEN else "live"


logger.info("Clock: %s (mode=%s)", describe(), MODE)
