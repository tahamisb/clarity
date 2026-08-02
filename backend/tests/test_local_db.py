"""
The BigQuery-builtin shims in local_db are what every rewritten query leans on —
if one of them drifts, the dashboards go quietly wrong rather than erroring.
Runs against an in-memory database, so it needs no generated warehouse.
"""

import pytest

from app.services import local_db as db


@pytest.fixture
def conn(monkeypatch):
    """A throwaway in-memory DB carrying the same UDF registrations."""
    import sqlite3

    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.create_function("regexp_contains", 2, db._regexp_contains)
    c.create_function("iso_week", 1, db._iso_week)
    c.create_function("week_start", 1, db._week_start)
    c.create_function("day_name", 1, db._day_name)
    c.create_function("split_first", 2, db._split_first)
    c.create_aggregate("mode_value", 1, db._ModeValue)
    monkeypatch.setattr(db._local, "conn", c, raising=False)
    return c


def one(conn, sql):
    return conn.execute(sql).fetchone()[0]


def test_regexp_contains(conn):
    assert one(conn, "SELECT regexp_contains('severe delivery delay', 'delay|late')") == 1
    assert one(conn, "SELECT regexp_contains('missing items', 'refund')") == 0
    assert one(conn, "SELECT regexp_contains(NULL, 'refund')") == 0


def test_calendar_shims(conn):
    # 2026-07-28 is a Tuesday in ISO week 31.
    assert one(conn, "SELECT iso_week('2026-07-28 21:45:00')") == "2026-W31"
    assert one(conn, "SELECT week_start('2026-07-28 21:45:00')") == "2026-07-27"  # Monday
    assert one(conn, "SELECT day_name('2026-07-28')") == "Tuesday"
    assert one(conn, "SELECT iso_week('not a date')") is None


def test_split_first(conn):
    assert one(conn, "SELECT split_first('Vendor closed // ref-12', '//')") == "Vendor closed "
    assert one(conn, "SELECT split_first('no separator', '//')") == "no separator"


def test_mode_value_ignores_nulls(conn):
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.executemany("INSERT INTO t VALUES (?)", [("a",), ("b",), ("a",), (None,), (None,), (None,)])
    assert one(conn, "SELECT mode_value(v) FROM t") == "a"
    assert one(conn, "SELECT mode_value(v) FROM t WHERE v IS NULL") is None


def test_sql_fragments(conn):
    conn.execute("CREATE TABLE m (status TEXT, opened TEXT, closed TEXT)")
    conn.executemany("INSERT INTO m VALUES (?,?,?)", [
        ("Cancelled", "2026-07-28 06:00:00", "2026-07-28 12:00:00"),
        ("Delivered", "2026-07-28 08:00:00", None),
        ("Delivered", "2026-07-28 23:30:00", None),
    ])
    delivered = db.countif("status = 'Delivered'")
    assert one(conn, f"SELECT {delivered} FROM m") == 2
    # SAFE_DIVIDE returns NULL on a zero denominator instead of raising.
    assert one(conn, f"SELECT {db.safe_divide('1', '0')}") is None
    assert one(conn, f"SELECT {db.safe_divide('1', '4')}") == 0.25
    assert one(conn, f"SELECT {db.hour_of('opened')} FROM m LIMIT 1") == 6
    assert one(conn, f"SELECT {db.hours_between('closed', 'opened')} FROM m LIMIT 1") == 6.0


def test_split_agg_parses_group_concat():
    assert db.split_agg("West Bay, Lusail ,Al Sadd") == ["West Bay", "Lusail", "Al Sadd"]
    assert db.split_agg(None) == []


def test_placeholders():
    assert db.placeholders(["a", "b", "c"]) == "?, ?, ?"
