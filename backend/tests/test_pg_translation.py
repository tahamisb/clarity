"""
Unit tests for the SQLite→Postgres SQL translation.

This is the riskiest code in the warehouse port: it rewrites every query the
app issues, and a mistake produces either a syntax error (loud, fine) or a
query that runs and returns subtly wrong rows (quiet, not fine). The cases
below are the ones that actually occur in the codebase — `LIKE '%cancel%'`,
`strftime('%Y-%m', …)`, `:name` binds, `?` placeholders — plus the traps around
them.
"""

import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")
os.environ.setdefault("GEMINI_API_KEY", "")

from app.services.pg_warehouse import _prepare, _to_pg  # noqa: E402


class TestPlaceholders:
    def test_question_marks_become_positional(self):
        assert _to_pg("SELECT * FROM t WHERE a = ? AND b = ?", True) == \
            "SELECT * FROM t WHERE a = %s AND b = %s"

    def test_named_binds_become_pyformat(self):
        assert _to_pg("WHERE a = :start AND b = :end", True) == \
            "WHERE a = %(start)s AND b = %(end)s"

    def test_repeated_name_translates_every_occurrence(self):
        # `(:start IS NULL OR col >= :start)` is a real pattern in the app.
        assert _to_pg("(:s IS NULL OR c >= :s)", True) == \
            "(%(s)s IS NULL OR c >= %(s)s)"

    def test_double_colon_is_a_cast_not_a_bind(self):
        assert _to_pg("SELECT x::timestamp FROM t", True) == "SELECT x::timestamp FROM t"

    def test_colon_followed_by_non_name_is_left_alone(self):
        assert _to_pg("SELECT '12:30' AS t", True) == "SELECT '12:30' AS t"


class TestPercentEscaping:
    def test_like_pattern_is_escaped(self):
        # The app's cancellation predicate. Unescaped, psycopg reads %c as a
        # placeholder and the query dies — or worse, binds the wrong argument.
        assert _to_pg("WHERE s LIKE '%cancel%' AND id = ?", True) == \
            "WHERE s LIKE '%%cancel%%' AND id = %s"

    def test_strftime_format_is_escaped(self):
        assert _to_pg("SELECT strftime('%Y-%m', d) WHERE a = ?", True) == \
            "SELECT strftime('%%Y-%%m', d) WHERE a = %s"

    def test_no_escaping_without_params(self):
        # psycopg only interprets % when parameters are supplied, and doubling
        # it up regardless would put literal %% into a LIKE pattern.
        assert _to_pg("WHERE s LIKE '%cancel%'", False) == "WHERE s LIKE '%cancel%'"


class TestStringLiteralsAreOpaque:
    def test_question_mark_inside_a_literal_is_not_a_placeholder(self):
        assert _to_pg("SELECT 'why?' AS q, x FROM t WHERE a = ?", True) == \
            "SELECT 'why?' AS q, x FROM t WHERE a = %s"

    def test_colon_name_inside_a_literal_is_not_a_bind(self):
        assert _to_pg("SELECT ':start' AS s WHERE a = :real", True) == \
            "SELECT ':start' AS s WHERE a = %(real)s"

    def test_escaped_quote_does_not_end_the_literal(self):
        assert _to_pg("SELECT 'it''s ok?' WHERE a = ?", True) == \
            "SELECT 'it''s ok?' WHERE a = %s"

    def test_quoted_identifier_is_opaque(self):
        assert _to_pg('SELECT "odd?name" FROM t WHERE a = ?', True) == \
            'SELECT "odd?name" FROM t WHERE a = %s'


class TestComments:
    def test_line_comment_content_is_not_translated(self):
        sql = "SELECT 1 -- is this a bind? :nope\nWHERE a = ?"
        assert _to_pg(sql, True) == "SELECT 1 -- is this a bind? :nope\nWHERE a = %s"

    def test_percent_in_a_comment_is_still_escaped(self):
        # psycopg scans the whole string, comments included.
        assert _to_pg("-- 50% done\nSELECT ?", True) == "-- 50%% done\nSELECT %s"


class TestPrepare:
    @pytest.mark.parametrize("empty", [(), [], {}, None])
    def test_empty_params_become_none_and_skip_escaping(self, empty):
        text, args = _prepare("WHERE s LIKE '%x%'", empty)
        assert args is None
        assert text == "WHERE s LIKE '%x%'"

    def test_non_empty_params_are_passed_through(self):
        text, args = _prepare("WHERE a = :a", {"a": 1})
        assert (text, args) == ("WHERE a = %(a)s", {"a": 1})
