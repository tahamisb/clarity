"""
Postgres driver for the simulated warehouse.

Reached through `warehouse.py`, never imported directly by a service.

Two jobs beyond opening a connection:

1. **Translate the SQL.** The query text is written for SQLite. Placeholders
   differ (`?` / `:name` vs `%s` / `%(name)s`), and psycopg treats `%` as
   special whenever parameters are supplied — which matters because the
   queries contain `LIKE '%cancel%'` and `strftime('%Y-%m', …)`. `_to_pg()`
   handles both, skipping string literals and comments so a `?` or `%` inside
   quotes is left alone.

2. **Normalise the rows.** psycopg returns real Python objects; the app and its
   frontend expect what SQLite gave them. Timestamps come back as
   `'YYYY-MM-DD HH:MM:SS'`, `Decimal` becomes `float`, `UUID` becomes `str`.
   Most reads go through the `compat` views and are already in legacy shapes,
   so this is a backstop rather than the main mechanism — but it is what makes
   "identical JSON on both backends" hold for the paths that are not.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import psycopg
from psycopg import sql as pgsql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()

# FastAPI runs these synchronous reads on its threadpool, so several run at
# once — a pool is required, not an optimisation. `open=False` keeps import
# side-effect-free; the first query opens it.
def _configure(conn: psycopg.Connection) -> None:
    """Pin the two session settings the app's correctness depends on.

    **timezone** — the app writes timestamps as bare `'YYYY-MM-DD HH:MM:SS'`
    strings (`clock.now_sql()`), and Postgres interprets a bare string in the
    *session* timezone before storing it in a timestamptz. On a server whose
    timezone is Asia/Qatar that silently shifts every written timestamp by
    three hours. Setting it here rather than trusting the server's config is
    the difference between "correct" and "correct on the machines we checked".

    **search_path** — states the read contract in the code instead of relying
    on `ALTER ROLE`: compat views first, then the real tables. When Clarity
    migrates to native types, dropping `compat` from this one line is the
    switch.
    """
    conn.execute("SET TIME ZONE 'UTC'")
    conn.execute("SET search_path = compat, warehouse, app, public")
    # The pool requires configure() to hand back an idle connection; without
    # this it rejects every one it creates as "left in status INTRANS".
    conn.commit()


_pool = ConnectionPool(
    conninfo=_settings.database_url,
    min_size=_settings.warehouse_pool_min,
    max_size=_settings.warehouse_pool_max,
    kwargs={"row_factory": dict_row, "application_name": "clarity-backend"},
    configure=_configure,
    open=False,
    name="warehouse",
)
_opened = False


def _ensure_open() -> ConnectionPool:
    global _opened
    if not _opened:
        _pool.open(wait=True, timeout=_settings.warehouse_connect_timeout_s)
        _opened = True
    return _pool


# ---------------------------------------------------------------------------
# SQL translation
# ---------------------------------------------------------------------------

_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _to_pg(sql: str, has_params: bool) -> str:
    """Rewrite SQLite-flavoured SQL for psycopg.

    Character-by-character rather than regex because the transformation is not
    context-free: `?` and `:name` are placeholders in code but literal text
    inside a quoted string, and `%` has to be doubled everywhere — including
    inside strings, where psycopg still scans for it.

    `::` is passed through so Postgres casts written in a builder survive.
    """
    out: list[str] = []
    i, n = 0, len(sql)

    while i < n:
        ch = sql[i]

        # Single-quoted literal: copy verbatim, only doubling '%'.
        if ch == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":   # '' escape
                        j += 2
                        continue
                    break
                j += 1
            literal = sql[i : j + 1]
            out.append(literal.replace("%", "%%") if has_params else literal)
            i = j + 1
            continue

        # Double-quoted identifier: never contains placeholders.
        if ch == '"':
            j = sql.find('"', i + 1)
            j = n - 1 if j == -1 else j
            out.append(sql[i : j + 1])
            i = j + 1
            continue

        # Line comment: copy to end of line untouched, so a '?' in prose does
        # not silently become a bind parameter psycopg then demands a value for.
        if ch == "-" and sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j == -1 else j
            out.append(sql[i:j].replace("%", "%%") if has_params else sql[i:j])
            i = j
            continue

        if ch == "%":
            out.append("%%" if has_params else "%")
            i += 1
            continue

        if ch == "?":
            out.append("%s")
            i += 1
            continue

        if ch == ":":
            if sql.startswith("::", i):      # a Postgres cast, not a bind
                out.append("::")
                i += 2
                continue
            m = _NAME_RE.match(sql, i + 1)
            if m:
                out.append(f"%({m.group(0)})s")
                i = m.end()
                continue

        out.append(ch)
        i += 1

    return "".join(out)


def _prepare(sql: str, params: Any) -> tuple[str, Any]:
    empty = params is None or (hasattr(params, "__len__") and len(params) == 0)
    return _to_pg(sql, has_params=not empty), (None if empty else params)


# ---------------------------------------------------------------------------
# Row normalisation
# ---------------------------------------------------------------------------

def _scalar(value: Any) -> Any:
    """Coerce a psycopg value into what sqlite3 would have handed back.

    The wire format is a contract with the frontend — `time-range.ts` parses
    `'YYYY-MM-DD HH:MM:SS'` — so a timestamp must not start arriving as
    ISO-8601 with an offset just because the backend changed.
    """
    if isinstance(value, datetime):
        # Warehouse instants are stored UTC; render them as the snapshot did.
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.strftime("%H:%M:%S")
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, memoryview):
        return bytes(value)
    return value


def _normalise(row: dict) -> dict:
    return {k: _scalar(v) for k, v in row.items()}


# ---------------------------------------------------------------------------
# Query interface
# ---------------------------------------------------------------------------

def query(sql: str, params: Any = ()) -> list[dict]:
    text, args = _prepare(sql, params)
    with _ensure_open().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(text, args)
            return [_normalise(r) for r in cur.fetchall()]


def query_one(sql: str, params: Any = ()) -> dict | None:
    text, args = _prepare(sql, params)
    with _ensure_open().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(text, args)
            row = cur.fetchone()
            return _normalise(row) if row else None


# Writes must name their schema. Reads resolve through the role's search_path
# (`compat, warehouse, app, public`) so an unqualified `FROM messages` lands on
# the compat view — but a compat view has computed columns (`flagged::int`,
# `call_id::text`) and Postgres refuses to insert through those. An unqualified
# INSERT therefore fails with "cannot insert into column … of view", which
# reads like a permissions problem and is not one.
#
# Only three tables are ever written; see warehouse/sql/070_grants.sql for why
# two of them are in `warehouse` at all.
_WRITE_SCHEMA = {
    "call_analysis": "warehouse",
    "classifications": "warehouse",
    "cancellation_predictions": "warehouse",
    "skipped_chats": "warehouse",
    "waitlist": "app",
}


def _write_target(table: str) -> tuple[str, ...]:
    if "." in table:
        return tuple(table.split("."))
    schema = _WRITE_SCHEMA.get(table)
    if schema is None:
        raise ValueError(
            f"No write schema mapped for {table!r}. Add it to _WRITE_SCHEMA — an "
            f"unqualified INSERT would hit the compat view and fail confusingly."
        )
    return (schema, table)


def insert_rows(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    cols = list(rows[0])
    stmt = pgsql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
        pgsql.Identifier(*_write_target(table)),
        pgsql.SQL(", ").join(pgsql.Identifier(c) for c in cols),
        pgsql.SQL(", ").join(pgsql.Placeholder() * len(cols)),
    )
    with _ensure_open().connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(stmt, [tuple(r.get(c) for c in cols) for r in rows])
        conn.commit()


def ping() -> bool:
    try:
        with _ensure_open().connection() as conn:
            conn.execute("SELECT 1").fetchone()
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("Warehouse ping failed: %s", exc)
        return False


def available() -> bool:
    return ping()


def describe() -> str:
    # Never log the DSN: it carries the password.
    try:
        info = psycopg.conninfo.conninfo_to_dict(_settings.database_url)
        where = f"{info.get('host', '?')}:{info.get('port', 5432)}/{info.get('dbname', '?')}"
    except Exception:  # noqa: BLE001
        where = "postgres"
    return f"Postgres warehouse at {where}"


def ensure_waitlist_table() -> None:
    """No-op: `app.waitlist` ships with the warehouse schema, and the app's
    role has no CREATE right anyway — deliberately."""
    return


def close() -> None:
    global _opened
    if _opened:
        _pool.close()
        _opened = False
