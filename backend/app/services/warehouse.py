"""
Warehouse facade — one interface, two backends.

The app reads either the local SQLite snapshot (`local_db`) or the simulated
Postgres warehouse (`pg_warehouse`), chosen by `WAREHOUSE_BACKEND`. Every
service imports this module, never a driver directly, so switching is a config
change rather than a code change.

    WAREHOUSE_BACKEND=sqlite     data/clarity.db, the frozen snapshot (default)
    WAREHOUSE_BACKEND=postgres   DATABASE_URL, the simulated live warehouse

**The SQL text is the same for both.** That is not an accident, and it is what
makes this port small enough to trust:

- The six BigQuery shims (`regexp_contains`, `iso_week`, `week_start`,
  `day_name`, `split_first`, `mode_value`) plus the SQLite ones the first port
  left behind (`date`, `datetime`, `group_concat`, `strftime`) are registered as
  Python UDFs on SQLite and defined as real SQL functions in Postgres, under
  the same names. See `warehouse/sql/020_functions.sql`.
- Postgres reads through the `compat` views, which re-render the properly-typed
  warehouse tables in the legacy SQLite shapes — TEXT timestamps, 0/1 flags,
  float money, JSON-as-string. See `warehouse/sql/050_compat_views.sql`.
- The handful of expressions that genuinely cannot be shimmed live in the SQL
  fragment builders below, which is why they were extracted during the
  BigQuery port in the first place.

Parameters use either style; both work on both backends. `:name` with a dict is
preferred for new code.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings
from app.utils import clock

logger = logging.getLogger(__name__)

_settings = get_settings()
BACKEND = _settings.warehouse_backend.strip().lower()

if BACKEND not in ("sqlite", "postgres"):
    raise RuntimeError(
        f"WAREHOUSE_BACKEND must be 'sqlite' or 'postgres', got {BACKEND!r}"
    )

if BACKEND == "postgres":
    from app.services import pg_warehouse as _driver
else:
    from app.services import local_db as _driver


# ---------------------------------------------------------------------------
# Query interface — delegated to the active driver
# ---------------------------------------------------------------------------

def query(sql: str, params: Any = ()) -> list[dict]:
    return _driver.query(sql, params)


def query_one(sql: str, params: Any = ()) -> dict | None:
    return _driver.query_one(sql, params)


def insert_rows(table: str, rows: list[dict]) -> None:
    """Append rows. Mirrors BigQuery's insert_rows_json (columns from row 0)."""
    _driver.insert_rows(table, rows)


def ping() -> bool:
    return _driver.ping()


def describe() -> str:
    """Human-readable "where is the data" line, for logs and health output."""
    return _driver.describe()


def available() -> bool:
    """Is the warehouse present at all? Distinct from ping(): a SQLite file can
    be missing, where Postgres can only be unreachable."""
    return _driver.available()


def ensure_waitlist_table() -> None:
    """The waitlist is written at runtime, so its table has to exist before the
    first signup. On SQLite that means a CREATE TABLE IF NOT EXISTS; on
    Postgres the table is part of the warehouse schema and this is a no-op."""
    _driver.ensure_waitlist_table()


# ---------------------------------------------------------------------------
# Helpers that are pure Python — identical on both backends
# ---------------------------------------------------------------------------

def placeholders(values) -> str:
    """`?, ?, ?` for an IN (…) clause. The Postgres driver rewrites `?` to
    `%s`, so this stays backend-agnostic."""
    return ", ".join("?" * len(values))


def split_agg(value) -> list[str]:
    """group_concat(DISTINCT x) → list, the ARRAY_AGG(… IGNORE NULLS) swap.

    Sorted, because neither engine defines the order of a group_concat and the
    two disagree in practice — so `top_zones[0]`, which the triggers panel
    displays as "the zone", would flip between backends for the same data.

    Note this makes the order *stable*, not *ranked*: `top_zones` and
    `top_merchants` are distinct sets truncated to five, never a top-five by
    volume, despite the names. Ranking them is a product decision, not a
    porting one — see docs/live-data-simulation.md.
    """
    if not value:
        return []
    return sorted(p for p in (s.strip() for s in str(value).split(",")) if p)


# ---------------------------------------------------------------------------
# SQL fragment builders
#
# Everything the two dialects genuinely disagree about. Kept deliberately
# small: anything that CAN be shimmed as a same-named SQL function is, because
# a shim keeps the query text identical and a builder does not.
# ---------------------------------------------------------------------------

def sql_now() -> str:
    """A SQL expression for "now", in the storage format.

    Replaces the old `clock.SQL_NOW` constant. That was a Python literal
    interpolated once at import, which is correct while the clock is frozen and
    quietly wrong the moment it is not: a long-running server would keep
    measuring "still open" against the instant it booted, so SLA ages would
    stop advancing. Emitting a SQL function instead lets the database evaluate
    it per query.
    """
    if clock.FROZEN:
        return f"'{clock.now_sql()}'"
    if BACKEND == "postgres":
        # Rendered to text, not left as `now()`: callers COALESCE it with
        # timestamp columns, which the compat views expose as TEXT, and
        # COALESCE(text, timestamptz) is a type error rather than a coercion.
        return "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"
    return "datetime('now')"


def business_utc_offset_hours() -> int:
    """Hours to add to a UTC instant to get business-local wall time."""
    return _tz_offset_hours()


def _tz_offset_hours() -> int:
    """Fixed UTC offset of the business timezone.

    SQLite has no timezone database, so its date functions can only take a
    literal offset. Safe here because the business timezone is Asia/Qatar,
    which is UTC+3 all year with no DST — this would be wrong for a zone that
    observes it, and `hour_of` says so.
    """
    offset = datetime.now(timezone.utc).astimezone(clock.BUSINESS_TZ).utcoffset()
    return round(offset.total_seconds() / 3600) if offset else 0


def countif(cond: str) -> str:
    """COUNTIF(cond).

    Identical on both backends on purpose. Postgres has the nicer
    `COUNT(*) FILTER (WHERE …)`, but it returns 0 over an empty result set
    where SUM(CASE …) returns NULL — so on a filter that matches nothing the
    two backends would put `0` and `null` on the wire for the same request.
    Not worth a marginal planner win.
    """
    return f"SUM(CASE WHEN {cond} THEN 1 ELSE 0 END)"


if BACKEND == "postgres":

    def safe_divide(num: str, den: str) -> str:
        """SAFE_DIVIDE(num, den) — NULL, not an error, on a zero denominator.

        `double precision`, never `REAL`: Postgres REAL is 4-byte float, so it
        would round-trip 123.45 as 123.44999694824219 and every money-derived
        rate would differ from SQLite in the last digits.
        """
        return f"(CAST({num} AS double precision) / NULLIF({den}, 0))"

    def as_float(expr: str) -> str:
        """CAST(expr AS REAL) — see safe_divide for why the type differs."""
        return f"CAST({expr} AS double precision)"

    def hour_of(col: str) -> str:
        """EXTRACT(HOUR FROM col), in business time. `col` is UTC TEXT via compat.

        The conversion is the point: message timestamps are stored UTC, so
        extracting the hour raw puts Doha's 19:00 dinner peak at 16:00 on the
        chart. With business_timezone left at UTC this is a no-op, which is
        what the legacy snapshot needs — its timestamps are already local.
        """
        hours = _tz_offset_hours()
        base = f"({col})::timestamp"
        expr = base if not hours else f"({base} + interval '{hours} hours')"
        return f"CAST(EXTRACT(HOUR FROM {expr}) AS INTEGER)"

    def hours_between(later: str, earlier: str) -> str:
        """TIMESTAMP_DIFF(later, earlier, MINUTE) / 60.0.

        Computed as whole seconds divided by 3600.0 — matching the SQLite
        branch exactly, bit for bit. Both engines' natural spellings
        (julianday difference × 24 here, epoch interval there) accumulate
        float error differently, and this value is a sort key on the SLA
        list: a last-bit disagreement stops being cosmetic and starts
        reordering rows.
        """
        return (
            f"(CAST(EXTRACT(EPOCH FROM (({later})::timestamp - ({earlier})::timestamp)) "
            f"AS bigint) / 3600.0)"
        )

    def shift_hours(expr: str, hours: int) -> str:
        """SQLite's datetime(x, '+N hours')."""
        # Every cast is parenthesised: callers pass compound expressions
        # (`a || ' ' || b`), and `::` binds tighter than `||`, so an
        # unparenthesised cast silently applies to the last term only.
        return f"to_char(({expr})::timestamp + interval '{hours} hours', 'YYYY-MM-DD HH24:MI:SS')"

else:

    def safe_divide(num: str, den: str) -> str:
        return f"(CAST({num} AS REAL) / NULLIF({den}, 0))"

    def as_float(expr: str) -> str:
        return f"CAST({expr} AS REAL)"

    def hour_of(col: str) -> str:
        # See the Postgres branch. SQLite takes a literal offset modifier
        # rather than a zone name; correct here only because the business zone
        # has no DST.
        hours = _tz_offset_hours()
        shift = f", '{hours:+d} hours'" if hours else ""
        return f"CAST(strftime('%H', {col}{shift}) AS INTEGER)"

    def hours_between(later: str, earlier: str) -> str:
        # Whole seconds / 3600.0, not julianday difference × 24: julianday
        # returns ~2.46e6-magnitude doubles, so the subtraction loses low bits
        # and the result disagrees with Postgres in the last place. See the
        # Postgres branch.
        return f"((strftime('%s', {later}) - strftime('%s', {earlier})) / 3600.0)"

    def shift_hours(expr: str, hours: int) -> str:
        return f"datetime({expr}, '{hours:+d} hours')"
