"""
The Phase 1 acceptance gate: does the app return the same thing on both
warehouse backends?

Boots the FastAPI app twice in one process — once with WAREHOUSE_BACKEND=sqlite
and once with postgres — hits every read endpoint through TestClient, and
diffs the JSON.

Why this and not a unit test per query: the SQL is assembled from f-strings and
fragment builders across ~4 000 lines of service code, so the only honest
question is whether the *responses* match. A per-query test would pass while an
endpoint still broke on serialisation, NULL-vs-0, or float precision.

Preconditions — both backends must hold the SAME data:

    cd warehouse && python -m sim load-sqlite && python -m sim verify

`load-sqlite` copies the snapshot across verbatim rather than regenerating it,
precisely so this diff measures the port and not the generator.

The frozen clock stays ON for this run. Time is Phase 2's problem; mixing the
two would make a failure here ambiguous.

Usage:
    cd backend
    DATABASE_URL=postgresql://clarity_reader:pw@127.0.0.1:5432/warehouse \\
        python scripts/warehouse_parity.py
    python scripts/warehouse_parity.py --verbose      # show the first diffs
    python scripts/warehouse_parity.py --only cancellations
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

# Every GET the dashboards actually issue. Query strings included where the
# default and filtered paths take different SQL branches — a filter predicate
# is exactly the kind of thing that ports wrong.
ENDPOINTS: tuple[str, ...] = (
    # Call intelligence
    "/calls",
    "/analytics/summary",
    "/analytics/restaurant-insights",
    "/analytics/area-insights",
    # Support messages — CX dashboard views
    "/api/messages/stats",
    "/api/messages/list?page=1&limit=50",
    "/api/messages/list?page=2&limit=50&sentiment=negative",
    "/api/messages/list?channel=whatsapp&time_of_day=Evening",
    "/api/messages/list?zone=West%20Bay&intent=complaint",
    "/api/messages/triggers",
    "/api/messages/sentiment-trend",
    "/api/messages/cross-channel",
    "/api/messages/contact-rate?start=2026-06-01&end=2026-06-30",
    # Support messages — text analytics
    "/api/v1/messages",
    "/api/v1/analytics/message-overview",
    "/api/v1/analytics/sentiment-trend",
    "/api/v1/analytics/top-negative-triggers",
    "/api/v1/analytics/cross-channel",
    "/api/v1/analytics/zone-heatmap",
    "/api/v1/analytics/sla-breaches",
    "/api/v1/analytics/intent-distribution",
    "/api/v1/analytics/merchant-sentiment",
    "/api/v1/analytics/negative-customers.csv",
    "/api/v1/sentiment/results",
    "/api/v1/sentiment/accuracy",
    # Cancellations — every breakdown, unfiltered and filtered
    "/api/cancellation/analytics/trend",
    "/api/cancellation/analytics/by-merchant",
    "/api/cancellation/analytics/by-zone",
    "/api/cancellation/analytics/by-time",
    "/api/cancellation/analytics/by-day",
    "/api/cancellation/analytics/by-order-size",
    "/api/cancellation/analytics/by-actor",
    "/api/cancellation/analytics/by-vertical",
    "/api/cancellation/analytics/crosstabs",
    "/api/cancellation/analytics/drivers-report",
    "/api/cancellation/analytics/trend?start=2026-01-01&end=2026-06-30",
    "/api/cancellation/analytics/by-zone?start=2026-01-01&end=2026-06-30&vertical=Restaurants",
    "/api/cancellation/analytics/by-merchant?start=2025-06-01&end=2026-07-28",
    # Model surfaces that read the warehouse
    "/api/cancellation/analytics/feature-importance",
    "/api/cancellation/analytics/threshold-analysis",
    "/api/cancellation/predict/live-queue",
    "/api/cancellation/model/info",
    # Health / status — status code only
    "/health",
    "/api/v1/health",
    "/api/v1/waitlist/status",
    "/api/cancellation/model/health",
)

# Endpoints whose payload legitimately differs between runs — they report
# Gemini reachability, connection targets or timings, not warehouse data.
STATUS_ONLY = {
    "/health",
    "/api/v1/health",
    "/api/v1/waitlist/status",
    "/api/cancellation/model/health",
}

# A 404 on both backends compares equal but proves nothing, and that is exactly
# how a parity suite quietly stops testing anything. Treat it as a failure of
# the suite rather than a pass.
EXPECT_OK = True


def _scratch_sqlite(source: Path) -> Path:
    """A throwaway copy of the snapshot for the sqlite run.

    Several endpoints persist as a side effect — the risk queue stores the
    scores it computes, the classifier stores its labels. Run against the real
    file and the suite corrupts its own reference data: the second run
    disagrees with the first, and the disagreement looks like a porting bug.
    Found the hard way, after a run left 418 extra prediction rows behind.
    """
    tmp = Path(tempfile.gettempdir()) / f"parity-{os.getpid()}-{source.name}"
    shutil.copy2(source, tmp)
    for suffix in ("-wal", "-shm"):
        side = source.with_name(source.name + suffix)
        if side.exists():
            shutil.copy2(side, tmp.with_name(tmp.name + suffix))
    return tmp


def _postgres_watermark(admin_dsn: str) -> int | None:
    """Highest prediction id before the run, so we can delete exactly what it adds."""
    if not admin_dsn:
        return None
    try:
        import psycopg  # noqa: PLC0415

        with psycopg.connect(admin_dsn) as conn:
            row = conn.execute("SELECT COALESCE(max(id), 0) FROM warehouse.cancellation_predictions").fetchone()
            return int(row[0])
    except Exception:  # noqa: BLE001
        return None


def _postgres_rollback(admin_dsn: str, watermark: int | None) -> None:
    """Undo what the postgres run persisted.

    Keyed on an id watermark, NOT on a timestamp. The run executes under the
    frozen clock, so every row it writes is stamped 2026-07-28 — a
    `WHERE written_at >= <run start>` filter matches nothing at all, which
    looks like a working cleanup and silently lets the data drift.

    Needs an owner DSN: the app connects as `clarity_reader`, which has INSERT
    on these tables and deliberately no DELETE.
    """
    if not admin_dsn or watermark is None:
        print("note: no admin DSN, so postgres keeps the rows this run persisted.\n"
              "      Re-run `sim load-sqlite` before the next comparison, or pass\n"
              "      --admin-database-url / set POSTGRES_DSN.", file=sys.stderr)
        return
    try:
        import psycopg  # noqa: PLC0415

        with psycopg.connect(admin_dsn) as conn:
            preds = conn.execute(
                "DELETE FROM warehouse.cancellation_predictions WHERE id > %s", (watermark,)
            ).rowcount
            clfs = conn.execute(
                "DELETE FROM warehouse.classifications WHERE classification_id LIKE 'clf-live-%%'"
            ).rowcount
            conn.commit()
        if preds or clfs:
            print(f"(rolled back {preds} prediction(s) and {clfs} classification(s) "
                  f"written during the run)")
    except Exception as exc:  # noqa: BLE001
        print(f"warning: could not roll back postgres writes: {exc}", file=sys.stderr)


def _fresh_app(backend: str, database_url: str):
    """Import the app with a given backend, discarding any previous import.

    `warehouse.py` picks its driver at import time and `get_settings()` is
    lru_cached, so the whole app tree has to be dropped from sys.modules
    between runs. Cheaper and far less flaky than two subprocesses.
    """
    os.environ["WAREHOUSE_BACKEND"] = backend
    os.environ["DATABASE_URL"] = database_url
    # Pin the clock and the business timezone for BOTH runs. Since Phase 2 the
    # backend picks its clock from the warehouse — frozen on sqlite, live on
    # postgres — so leaving it on `auto` would compare a frozen app against a
    # live one and report the clock as a porting failure. This gate measures
    # the port; time is verified separately.
    os.environ["CLOCK_MODE"] = "frozen"
    os.environ["BUSINESS_TIMEZONE"] = "UTC"
    # The live classifier/scorer would write into the dataset under comparison.
    os.environ["LIVE_PIPELINE_ENABLED"] = "false"

    for name in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[name]

    from fastapi.testclient import TestClient  # noqa: PLC0415

    main = importlib.import_module("app.main")
    return TestClient(main.app)


def _collect(client, endpoints: tuple[str, ...]) -> dict[str, tuple[int, Any, float]]:
    out: dict[str, tuple[int, Any, float]] = {}
    for path in endpoints:
        t0 = time.perf_counter()
        try:
            resp = client.get(path)
            body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            out[path] = (resp.status_code, body, time.perf_counter() - t0)
        except Exception as exc:  # noqa: BLE001
            out[path] = (-1, f"EXCEPTION: {type(exc).__name__}: {exc}", time.perf_counter() - t0)
    return out


def _first_difference(left: Any, right: Any, path: str = "") -> str | None:
    """Locate the first structural difference, as a readable path.

    A whole-payload dump is unusable when an endpoint returns a thousand rows;
    what a failure needs to answer is "which field, in which row".
    """
    if type(left) is not type(right):
        return f"{path or '<root>'}: type {type(left).__name__} vs {type(right).__name__}"
    if isinstance(left, dict):
        for key in sorted(set(left) | set(right)):
            if key not in left:
                return f"{path}.{key}: missing on sqlite"
            if key not in right:
                return f"{path}.{key}: missing on postgres"
            if (found := _first_difference(left[key], right[key], f"{path}.{key}")):
                return found
        return None
    if isinstance(left, list):
        if len(left) != len(right):
            return f"{path or '<root>'}: {len(left)} rows vs {len(right)} rows"
        for i, (a, b) in enumerate(zip(left, right)):
            if (found := _first_difference(a, b, f"{path}[{i}]")):
                return found
        return None
    if isinstance(left, float) and isinstance(right, float):
        if abs(left - right) <= 1e-9 * max(1.0, abs(left)):
            return None
        if _rounding_only(left, right):
            # Reported, not silently swallowed — see ROUNDING_NOTE.
            return f"~{path}: {left} vs {right}"
        return f"{path}: {left} vs {right}"
    if left == right:
        return None
    return f"{path or '<root>'}: {_clip(left)} vs {_clip(right)}"


ROUNDING_NOTE = """\
Values marked '~' differ only in the last rounded digit. SQLite's ROUND works on
the exact binary value of the double (2.675 -> 2.67, because the stored double
is 2.67499...); Postgres rounds the shortest decimal representation
(2.675 -> 2.68). Postgres is the more defensible answer and is where this is
heading, so the divergence is accepted rather than emulated away — but it is
counted and printed, never hidden. Ordering keys must not depend on a rounded
value; that turns a last-digit difference into a reshuffled list."""


def _rounding_only(left: float, right: float) -> bool:
    """True when two floats differ by at most one unit in the last place they
    are rounded to (inferred from the shorter of the two decimal renderings)."""
    places = max(
        (len(t.split(".")[1]) if "." in t else 0)
        for t in (repr(round(left, 6)), repr(round(right, 6)))
    )
    if places > 4:                      # not a rounded display value
        return False
    ulp = 10.0 ** -places
    return abs(left - right) <= ulp * 1.001 and abs(left - right) <= 0.005 * max(1.0, abs(left))


def _clip(value: Any, limit: int = 60) -> str:
    """Short repr. A CSV endpoint's whole body in a one-line verdict makes the
    report unreadable, which is how real diffs get missed."""
    text = repr(value)
    return text if len(text) <= limit else f"{text[:limit]}…({len(text)} chars)"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--admin-database-url", default=os.environ.get("POSTGRES_DSN", ""),
                        help="owner DSN, used only to undo side-effect writes afterwards")
    parser.add_argument("--only", help="substring filter on the endpoint path")
    parser.add_argument("--verbose", action="store_true", help="print the differing payloads")
    args = parser.parse_args()

    if not args.database_url:
        print("Set DATABASE_URL (or pass --database-url).", file=sys.stderr)
        return 2

    endpoints = tuple(e for e in ENDPOINTS if not args.only or args.only in e)
    print(f"Comparing {len(endpoints)} endpoints across both backends\n")

    # Run against a scratch copy and clean up after, so the suite cannot
    # corrupt the very data it is comparing.
    snapshot = Path(__file__).parent.parent / "data" / "clarity.db"
    scratch = _scratch_sqlite(snapshot)
    os.environ["SQLITE_PATH"] = str(scratch)
    watermark = _postgres_watermark(args.admin_database_url)

    try:
        print("→ sqlite")
        sqlite_results = _collect(_fresh_app("sqlite", args.database_url), endpoints)
        print("→ postgres")
        pg_results = _collect(_fresh_app("postgres", args.database_url), endpoints)
    finally:
        for path in (scratch, scratch.with_name(scratch.name + "-wal"),
                     scratch.with_name(scratch.name + "-shm")):
            path.unlink(missing_ok=True)
        _postgres_rollback(args.admin_database_url, watermark)
    # Shut the pool down explicitly; otherwise its worker threads keep the
    # interpreter alive for ~20s of timeout warnings after the report prints.
    try:
        sys.modules["app.services.pg_warehouse"].close()
    except (KeyError, AttributeError):
        pass

    width = max(len(e) for e in endpoints) + 2
    failures = 0
    rounding = 0
    print(f"\n{'endpoint':<{width}} {'sqlite':>8} {'postgres':>10}   verdict")
    print("-" * (width + 40))

    for path in endpoints:
        s_code, s_body, s_ms = sqlite_results[path]
        p_code, p_body, p_ms = pg_results[path]
        timing = f"{s_ms*1000:>7.0f}ms {p_ms*1000:>9.0f}ms"

        if s_code != p_code:
            verdict = f"STATUS {s_code} vs {p_code}"
        elif EXPECT_OK and s_code != 200:
            # Matching non-200s are not parity — they are an endpoint the suite
            # is no longer exercising. Route renames must break this loudly.
            verdict = f"NOT EXERCISED (both {s_code})"
        elif path in STATUS_ONLY:
            verdict = f"ok ({s_code}, body not compared)"
        elif (diff := _first_difference(s_body, p_body)):
            # A leading '~' means the only difference found was a last-digit
            # rounding one. Surfaced separately: it is a known, accepted
            # divergence, not a passing test and not a broken one.
            verdict = f"ok (rounding) {diff}" if diff.startswith("~") else f"DIFF  {diff}"
        else:
            verdict = "ok"

        if verdict.startswith("ok (rounding)"):
            rounding += 1
        elif not verdict.startswith("ok"):
            failures += 1
            if args.verbose:
                print(f"\n--- {path}\n  sqlite  : {json.dumps(s_body, default=str)[:600]}"
                      f"\n  postgres: {json.dumps(p_body, default=str)[:600]}\n")
        print(f"{path:<{width}} {timing}   {verdict}")

    print("-" * (width + 40))
    identical = len(endpoints) - failures - rounding
    print(f"{identical} identical, {rounding} rounding-only, {failures} differ")
    if rounding:
        print(f"\n{ROUNDING_NOTE}")
    if not failures:
        print("\nno substantive differences — the port is clean")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
