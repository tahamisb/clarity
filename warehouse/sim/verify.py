"""
Parity checks between the SQLite snapshot and the Postgres warehouse.

The Phase 1 gate is "the backend returns identical JSON on both backends". That
test lives in the backend. This is the layer beneath it: prove the *data* is
identical first, so that when an endpoint diff does fail, it is a query-port
bug and not a load bug.

Compares row counts, then a handful of aggregates chosen because each one
exercises a different conversion: money sums (REAL → numeric), boolean flags
(0/1 → boolean), date bucketing, NULL handling on open conversations, and the
compat views' timestamp rendering.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import psycopg

# (label, sqlite SQL, postgres SQL). Postgres reads through `compat`, because
# that is what the application will read — verifying the physical tables would
# leave the view layer untested.
CHECKS: tuple[tuple[str, str, str], ...] = (
    (
        "orders",
        "SELECT COUNT(*) FROM vendor_kpi",
        "SELECT COUNT(*) FROM compat.vendor_kpi",
    ),
    (
        "cancelled orders",
        "SELECT COUNT(*) FROM vendor_kpi WHERE order_status = 'Cancelled'",
        "SELECT COUNT(*) FROM compat.vendor_kpi WHERE order_status = 'Cancelled'",
    ),
    (
        "gross order value (2dp)",
        "SELECT ROUND(SUM(total_order_value), 2) FROM vendor_kpi",
        "SELECT ROUND(SUM(total_order_value)::numeric, 2) FROM compat.vendor_kpi",
    ),
    (
        "pro-user orders",
        "SELECT COUNT(*) FROM vendor_kpi WHERE is_pro_user = 1",
        "SELECT COUNT(*) FROM compat.vendor_kpi WHERE is_pro_user = 1",
    ),
    (
        "earliest order day",
        "SELECT MIN(order_placement_date) FROM vendor_kpi",
        "SELECT MIN(order_placement_date) FROM compat.vendor_kpi",
    ),
    (
        "latest order day",
        "SELECT MAX(order_placement_date) FROM vendor_kpi",
        "SELECT MAX(order_placement_date) FROM compat.vendor_kpi",
    ),
    (
        "order items",
        "SELECT COUNT(*) FROM vendor_items_kpi",
        "SELECT COUNT(*) FROM compat.vendor_items_kpi",
    ),
    (
        "support messages",
        "SELECT COUNT(*) FROM messages",
        "SELECT COUNT(*) FROM compat.messages",
    ),
    (
        "still-open messages",
        "SELECT COUNT(*) FROM messages WHERE closed_at IS NULL",
        "SELECT COUNT(*) FROM compat.messages WHERE closed_at IS NULL",
    ),
    (
        "earliest message ts",
        "SELECT MIN(created_at) FROM messages",
        "SELECT MIN(created_at) FROM compat.messages",
    ),
    (
        "latest message ts",
        "SELECT MAX(created_at) FROM messages",
        "SELECT MAX(created_at) FROM compat.messages",
    ),
    (
        "classifications",
        "SELECT COUNT(*) FROM classifications",
        "SELECT COUNT(*) FROM compat.classifications",
    ),
    (
        "negative classifications",
        "SELECT COUNT(*) FROM classifications WHERE sentiment = 'negative'",
        "SELECT COUNT(*) FROM compat.classifications WHERE sentiment = 'negative'",
    ),
    (
        "labels",
        "SELECT COUNT(*) FROM labels",
        "SELECT COUNT(*) FROM compat.labels",
    ),
    (
        "chats",
        "SELECT COUNT(*) FROM chat_history",
        "SELECT COUNT(*) FROM compat.chat_history",
    ),
    (
        "calls",
        "SELECT COUNT(*) FROM call_analysis",
        "SELECT COUNT(*) FROM compat.call_analysis",
    ),
    (
        "predictions",
        "SELECT COUNT(*) FROM cancellation_predictions",
        "SELECT COUNT(*) FROM compat.cancellation_predictions",
    ),
    (
        "flagged predictions",
        "SELECT COUNT(*) FROM cancellation_predictions WHERE flagged = 1",
        "SELECT COUNT(*) FROM compat.cancellation_predictions WHERE flagged = 1",
    ),
    (
        "distinct cancel reasons",
        "SELECT COUNT(DISTINCT TRIM(split_first(cancel_comment, '//'))) FROM vendor_kpi "
        "WHERE cancel_comment IS NOT NULL",
        "SELECT COUNT(DISTINCT TRIM(split_first(cancel_comment, '//'))) FROM compat.vendor_kpi "
        "WHERE cancel_comment IS NOT NULL",
    ),
    (
        "iso weeks with messages",
        "SELECT COUNT(DISTINCT iso_week(created_at)) FROM messages",
        "SELECT COUNT(DISTINCT iso_week(created_at)) FROM compat.messages",
    ),
    (
        "waitlist signups",
        "SELECT COUNT(*) FROM waitlist",
        "SELECT COUNT(*) FROM app.waitlist",
    ),
)


def _sqlite_conn(path: Path) -> sqlite3.Connection:
    """Same UDF registration the backend does, so the shim-dependent checks run
    on both sides."""
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
    from app.services import local_db  # noqa: PLC0415 — optional, backend-only import

    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.create_function("regexp_contains", 2, local_db._regexp_contains, deterministic=True)
    conn.create_function("iso_week", 1, local_db._iso_week, deterministic=True)
    conn.create_function("week_start", 1, local_db._week_start, deterministic=True)
    conn.create_function("day_name", 1, local_db._day_name, deterministic=True)
    conn.create_function("split_first", 2, local_db._split_first, deterministic=True)
    conn.create_aggregate("mode_value", 1, local_db._ModeValue)
    return conn


def _norm(value):
    """Compare across drivers without tripping over representation: Decimal vs
    float, and Postgres date/datetime objects vs SQLite strings.

    Timestamps need real care. Since the compat views started returning native
    timestamptz, psycopg hands back an aware datetime while SQLite hands back
    'YYYY-MM-DD HH:MM:SS'. Rendered in a non-UTC session those look completely
    different — `2025-01-01 07:30:14` against `2025-01-01 10:30:14+03:00` — for
    the same instant. Normalising to UTC text is what makes the comparison
    about the data instead of about the reader's timezone.
    """
    from datetime import datetime as _dt, timezone as _tz

    if value is None:
        return None
    if isinstance(value, _dt):
        if value.tzinfo is not None:
            value = value.astimezone(_tz.utc).replace(tzinfo=None)
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, (int,)) and not isinstance(value, bool):
        return value
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return str(value)


def verify(dsn: str, sqlite_path: Path) -> int:
    """Print a comparison table. Returns the number of mismatches."""
    src = _sqlite_conn(sqlite_path)
    mismatches = 0

    with psycopg.connect(dsn) as conn:
        # Same pin as the backend pool: rendering must not depend on the
        # server's timezone.
        conn.execute("SET TIME ZONE 'UTC'")
        print(f"{'check':<28} {'sqlite':>22} {'postgres':>22}   ")
        print("-" * 78)
        for label, sqlite_sql, pg_sql in CHECKS:
            try:
                left = src.execute(sqlite_sql).fetchone()[0]
            except sqlite3.Error as exc:
                left = f"ERR {exc}"
            try:
                right = conn.execute(pg_sql).fetchone()[0]
            except psycopg.Error as exc:
                conn.rollback()
                right = f"ERR {str(exc).splitlines()[0]}"

            ok = _norm(left) == _norm(right)
            mismatches += 0 if ok else 1
            print(f"{label:<28} {str(left):>22} {str(right):>22}  {'ok' if ok else 'MISMATCH'}")

    src.close()
    print("-" * 78)
    print("all checks match" if not mismatches else f"{mismatches} mismatch(es)")
    return mismatches
