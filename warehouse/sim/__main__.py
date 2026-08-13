"""
CLI:

    python -m sim seed --from 2025-01-01 --to today --per-day 2500
    python -m sim seed --to 2026-07-28 --orders 60000     # legacy-parity dataset
    python -m sim load-sqlite ../backend/data/clarity.db  # the parity reference
    python -m sim verify ../backend/data/clarity.db
    python -m sim status

Inside the compose stack, drop the `python -m`:

    docker compose run --rm simulator seed --to today --per-day 2500
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .config import Settings
from .generate import QATAR, Volumes, Window

DEFAULT_SNAPSHOT = Path(__file__).resolve().parents[2] / "backend" / "data" / "clarity.db"


def _parse_day(value: str) -> date:
    if value == "today":
        return datetime.now(QATAR).date()
    if value == "yesterday":
        return datetime.now(QATAR).date() - timedelta(days=1)
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD or 'today', got {value!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sim", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dsn", help="overrides POSTGRES_DSN")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    p_seed = sub.add_parser("seed", help="generate a full history into an empty warehouse")
    p_seed.add_argument("--from", dest="start", type=_parse_day, default=None,
                        help="first day (default: 574 days before --to, matching the legacy span)")
    p_seed.add_argument("--to", dest="end", type=_parse_day, default=_parse_day("today"),
                        help="last day, the dataset's 'today' (default: today)")
    group = p_seed.add_mutually_exclusive_group()
    group.add_argument("--orders", type=int, help="total orders across the window")
    group.add_argument("--per-day", type=int, help="orders per day (scales support volume with it)")
    p_seed.add_argument("--support-since", type=_parse_day, default=None,
                        help="first day with chat/call coverage (default: 210 days before --to)")

    p_run = sub.add_parser("run", help="the live ticker — orders arriving in real time")
    p_run.add_argument("--tick-seconds", type=float, default=10.0)
    p_run.add_argument("--per-day", type=int, default=2500, help="orders per day at the current rate")
    p_run.add_argument("--retention-days", type=int, default=548)
    p_run.add_argument("--once", action="store_true", help="one tick, then exit (for testing)")

    p_ctl = sub.add_parser("control", help="scenario-injection HTTP API (internal network only)")
    p_ctl.add_argument("--host", default="0.0.0.0")
    p_ctl.add_argument("--port", type=int, default=8080)

    p_scen = sub.add_parser("scenario", help="start a scenario from the command line")
    # Optional so `--clear` works on its own: needing to name a scenario in
    # order to cancel all of them is exactly the wrong ergonomics for the
    # command you reach for when a demo is going sideways.
    p_scen.add_argument("kind", nargs="?", choices=["merchant_outage", "zone_courier_shortage",
                                                    "sentiment_storm", "volume_spike"])
    p_scen.add_argument("--target", help="merchant / zone / channel")
    p_scen.add_argument("--minutes", type=float, default=30)
    p_scen.add_argument("--magnitude", type=float, default=3.0)
    p_scen.add_argument("--clear", action="store_true", help="end every active scenario instead")

    p_load = sub.add_parser("load-sqlite", help="copy the legacy snapshot in, for parity testing")
    p_load.add_argument("path", nargs="?", type=Path, default=DEFAULT_SNAPSHOT)

    p_verify = sub.add_parser("verify", help="compare the warehouse against the legacy snapshot")
    p_verify.add_argument("path", nargs="?", type=Path, default=DEFAULT_SNAPSHOT)

    sub.add_parser("status", help="what is in the warehouse and when it was written")

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    settings = Settings.from_env()
    dsn = args.dsn or settings.dsn

    if args.command == "seed":
        from .seed import seed

        end = args.end
        # 574 days is the legacy span (2025-01-01 → 2026-07-28); keeping it as
        # the default means `--to today` reproduces the same shape of history,
        # just ending now.
        start = args.start or (end - timedelta(days=573))
        if start > end:
            parser.error("--from is after --to")
        window = Window(start=start, end=end)

        if args.per_day:
            volumes = Volumes.for_density(window, args.per_day)
        elif args.orders:
            volumes = Volumes.for_total(args.orders, orders_per_day=args.orders / window.days)
        else:
            volumes = Volumes()

        counts = seed(
            dsn,
            window=window,
            volumes=volumes,
            seed_value=settings.seed,
            support_since=args.support_since,
        )
        _print_counts(counts)
        return 0

    if args.command == "run":
        from .tick import TickConfig, run

        run(
            dsn,
            TickConfig(
                tick_seconds=args.tick_seconds,
                orders_per_day=args.per_day,
                retention_days=args.retention_days,
            ),
            seed=settings.seed,
            once=args.once,
        )
        return 0

    if args.command == "control":
        from .control import serve

        serve(dsn, host=args.host, port=args.port)
        return 0

    if args.command == "scenario":
        import psycopg

        with psycopg.connect(dsn) as conn:
            if args.clear:
                n = conn.execute(
                    "UPDATE sim.scenarios SET ends_at = now() WHERE ends_at > now()"
                ).rowcount
                conn.commit()
                print(f"ended {n} active scenario(s)")
                return 0
            if not args.kind:
                parser.error("give a scenario kind, or --clear to end the active ones")
            starts = datetime.now(timezone.utc)
            conn.execute(
                """INSERT INTO sim.scenarios (kind, target, magnitude, starts_at, ends_at)
                   VALUES (%s, %s, %s, %s, %s)""",
                (args.kind, args.target, args.magnitude, starts,
                 starts + timedelta(minutes=args.minutes)),
            )
            conn.commit()
        print(f"{args.kind} on {args.target or 'the platform'} for {args.minutes:.0f} min "
              f"(magnitude {args.magnitude})")
        return 0

    if args.command == "load-sqlite":
        from .load_sqlite import load

        _print_counts(load(dsn, args.path))
        return 0

    if args.command == "verify":
        from .verify import verify

        return 1 if verify(dsn, args.path) else 0

    if args.command == "status":
        return _status(dsn)

    return 2


def _print_counts(counts: dict[str, int]) -> None:
    print()
    for table, n in counts.items():
        print(f"  {n:>10,}  {table}")
    print(f"  {sum(counts.values()):>10,}  total")


def _status(dsn: str) -> int:
    import psycopg

    with psycopg.connect(dsn) as conn:
        cursor = conn.execute(
            "SELECT seeded_from, seeded_to, generator, last_tick_at FROM sim.tick_cursor"
        ).fetchone()
        if cursor:
            print(f"generator    {cursor[2]}")
            print(f"covers       {cursor[0]} → {cursor[1]}")
            print(f"last write   {cursor[3]}")
        print()
        rows = conn.execute("""
            SELECT relname, n_live_tup
              FROM pg_stat_user_tables
             WHERE schemaname = 'warehouse'
             ORDER BY n_live_tup DESC
        """).fetchall()
        for name, n in rows:
            print(f"  {n:>10,}  warehouse.{name}")
        print()
        for at, event in conn.execute(
            "SELECT at, event FROM sim.run_log ORDER BY at DESC LIMIT 5"
        ).fetchall():
            print(f"  {at:%Y-%m-%d %H:%M:%S}  {event}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
