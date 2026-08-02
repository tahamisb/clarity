"""
Frozen clock — the whole app pretends "now" is always FROZEN_NOW.

The dashboards run on a synthesised dataset that ends on a fixed day, so every
calendar control (WTD/MTD/QTD/YTD, the custom range picker, SLA "still open"
maths) has to be anchored there instead of the wall clock. Otherwise the data
silently drifts out of the selected window as real days pass.

Frontend twin: frontend/lib/frozen-clock.ts — keep the two dates in sync.
"""

from datetime import date, datetime, timezone

# The synthetic dataset's last day. Every "today" in the app resolves to this.
FROZEN_TODAY = date(2026, 7, 28)
FROZEN_NOW = datetime(2026, 7, 28, 21, 45, 0, tzinfo=timezone.utc)

# SQLite literal for "now" — substituted wherever BigQuery used CURRENT_TIMESTAMP().
SQL_NOW = f"'{FROZEN_NOW.strftime('%Y-%m-%d %H:%M:%S')}'"


def now() -> datetime:
    return FROZEN_NOW


def now_iso() -> str:
    return FROZEN_NOW.isoformat()


def now_sql() -> str:
    """'YYYY-MM-DD HH:MM:SS' — the storage format used by every timestamp column."""
    return FROZEN_NOW.strftime("%Y-%m-%d %H:%M:%S")
