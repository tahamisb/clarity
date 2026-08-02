"""
Local SQLite warehouse — the drop-in replacement for BigQuery.

Every table the app used to read from BigQuery (`vendor_kpi`, `vendor_items_kpi`,
`chat_history`, `call_analysis`, `messages`, `classifications`, `labels`,
`skipped_chats`, `cancellation_predictions`) now lives in a single file created
by `scripts/generate_mock_db.py`.

Timestamps are stored as `'YYYY-MM-DD HH:MM:SS'` TEXT so SQLite's own date
functions work on them directly and the API can hand them to the frontend
unchanged.

A handful of BigQuery builtins have no SQLite equivalent, so they are registered
here as Python UDFs and used verbatim in the rewritten queries:

    regexp_contains(s, pattern)   REGEXP_CONTAINS
    mode_value(x)      aggregate  APPROX_TOP_COUNT(x, 1)[OFFSET(0)].value
    iso_week(d)                   FORMAT_DATE('%G-W%V', d)
    week_start(ts)                DATE_TRUNC(ts, WEEK(MONDAY))
    day_name(d)                   FORMAT_DATE('%A', d)
    split_first(s, sep)           SPLIT(s, sep)[OFFSET(0)]
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "clarity.db"

_local = threading.local()
# Services run their queries on the default executor, i.e. several threads —
# SQLite connections aren't shareable, so each thread gets its own.
_write_lock = threading.Lock()


# ---------------------------------------------------------------------------
# BigQuery-builtin shims
# ---------------------------------------------------------------------------

def _regexp_contains(value, pattern) -> int:
    if value is None or pattern is None:
        return 0
    return 1 if re.search(pattern, str(value)) else 0


def _parse_day(value) -> date | None:
    if value is None:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _iso_week(value) -> str | None:
    d = _parse_day(value)
    if d is None:
        return None
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def _week_start(value) -> str | None:
    d = _parse_day(value)
    return (d - timedelta(days=d.weekday())).isoformat() if d else None


def _day_name(value) -> str | None:
    d = _parse_day(value)
    return d.strftime("%A") if d else None


def _split_first(value, sep) -> str | None:
    if value is None:
        return None
    return str(value).split(sep)[0]


class _ModeValue:
    """APPROX_TOP_COUNT(x, 1)[OFFSET(0)].value — the most frequent non-null value."""

    def __init__(self):
        self._counts = Counter()

    def step(self, value):
        if value is not None:
            self._counts[value] += 1

    def finalize(self):
        return self._counts.most_common(1)[0][0] if self._counts else None


def _connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"Local warehouse missing at {DB_PATH}. Run: python scripts/generate_mock_db.py"
        )
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.create_function("regexp_contains", 2, _regexp_contains, deterministic=True)
    conn.create_function("iso_week", 1, _iso_week, deterministic=True)
    conn.create_function("week_start", 1, _week_start, deterministic=True)
    conn.create_function("day_name", 1, _day_name, deterministic=True)
    conn.create_function("split_first", 2, _split_first, deterministic=True)
    conn.create_aggregate("mode_value", 1, _ModeValue)
    return conn


def get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _local.conn = _connect()
    return conn


# ---------------------------------------------------------------------------
# Query helpers — the shape every service already expects (list[dict])
# ---------------------------------------------------------------------------

def query(sql: str, params: tuple | list = ()) -> list[dict]:
    return [dict(r) for r in get_conn().execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple | list = ()) -> dict | None:
    row = get_conn().execute(sql, params).fetchone()
    return dict(row) if row else None


def placeholders(values) -> str:
    """`?, ?, ?` for an IN (…) clause — the IN UNNEST(@ids) replacement."""
    return ", ".join("?" * len(values))


def split_agg(value) -> list[str]:
    """group_concat(DISTINCT x) → list, the ARRAY_AGG(… IGNORE NULLS) replacement."""
    if not value:
        return []
    return [p for p in (s.strip() for s in str(value).split(",")) if p]


# ---------------------------------------------------------------------------
# SQL fragment builders — the BigQuery expressions that appear everywhere
# ---------------------------------------------------------------------------

def countif(cond: str) -> str:
    """COUNTIF(cond)."""
    return f"SUM(CASE WHEN {cond} THEN 1 ELSE 0 END)"


def safe_divide(num: str, den: str) -> str:
    """SAFE_DIVIDE(num, den) — NULL rather than a division error on a zero total."""
    return f"(CAST({num} AS REAL) / NULLIF({den}, 0))"


def hour_of(col: str) -> str:
    """EXTRACT(HOUR FROM col)."""
    return f"CAST(strftime('%H', {col}) AS INTEGER)"


def hours_between(later: str, earlier: str) -> str:
    """TIMESTAMP_DIFF(later, earlier, MINUTE) / 60.0."""
    return f"((julianday({later}) - julianday({earlier})) * 24.0)"


def insert_rows(table: str, rows: list[dict]) -> None:
    """Append rows. Mirrors BigQuery's insert_rows_json (column set from row 0)."""
    if not rows:
        return
    cols = list(rows[0])
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) "
        f"VALUES ({', '.join('?' * len(cols))})"
    )
    with _write_lock:
        conn = get_conn()
        conn.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])
        conn.commit()


def ping() -> bool:
    try:
        get_conn().execute("SELECT 1").fetchone()
        return True
    except Exception:  # noqa: BLE001
        return False
