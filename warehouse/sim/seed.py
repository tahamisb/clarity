"""
Build a full history into an empty warehouse.

This is the backfill half of the simulation: it produces the months of past
data that the trend, WTD/MTD/QTD/YTD and model-accuracy views need in order to
show anything at all. The live ticker (Phase 3) takes over from where this
stops.

The window is a parameter, so the same command produces either:

    --to 2026-07-28     the legacy frozen dataset's last day (parity work)
    --to today          a history that ends *now* (what Phase 2 switches to)
"""

from __future__ import annotations

import logging
import random
from dataclasses import replace
from datetime import date, datetime, time, timedelta, timezone

import psycopg

from . import writer
from .generate import (
    QATAR,
    Volumes,
    Window,
    gen_calls,
    gen_chats,
    gen_messages,
    gen_orders,
    gen_predictions,
    qatar_instant,
)

logger = logging.getLogger(__name__)
UTC = timezone.utc

# Chat and call coverage starts later than the order history — the support
# tooling was rolled out after the ordering platform. Keeping that gap means
# the contact-rate metric has an honest "no data before here" edge instead of
# a suspiciously clean full-history series.
SUPPORT_COVERAGE_DAYS = 210


def seed(
    dsn: str,
    *,
    window: Window,
    volumes: Volumes,
    seed_value: int,
    support_since: date | None = None,
) -> dict[str, int]:
    rng = random.Random(seed_value)
    support_since = support_since or max(
        window.start, window.end - timedelta(days=SUPPORT_COVERAGE_DAYS)
    )

    # "Now" for the dataset. When the window ends on the real today, that is
    # the wall clock, and it becomes the window's cutoff — today then arrives
    # partially complete, the way a live warehouse would have it. Against a
    # fixed historical end day there is nothing to be partial about, so the
    # dataset runs to the evening of its last day.
    ends_today = window.end == datetime.now(QATAR).date()
    dataset_now = datetime.now(UTC) if ends_today else qatar_instant(window.end, time(21, 45))
    if ends_today and window.cutoff is None:
        window = replace(window, cutoff=dataset_now)

    logger.info(
        "seeding %s → %s (%d days, up to %s orders, support from %s%s)",
        window.start, window.end, window.days, f"{volumes.orders:,}", support_since,
        f", cutoff {dataset_now:%Y-%m-%d %H:%M} UTC" if window.cutoff else "",
    )

    orders, items = gen_orders(rng, window, volumes)
    chats = gen_chats(
        rng, orders, max(1, volumes.orders // volumes.orders_per_chat),
        window=window, since=support_since,
    )
    messages, classifications, labels = gen_messages(
        rng, window, volumes.messages, volumes.labels
    )
    calls = gen_calls(rng, orders, volumes.calls, window=window, since=support_since)
    predictions = gen_predictions(rng, orders, dataset_now)

    counts: dict[str, int] = {}
    with psycopg.connect(dsn) as conn:
        writer.truncate_warehouse(conn)
        counts["warehouse.vendor_kpi"] = writer.copy_rows(conn, "warehouse.vendor_kpi", orders)
        counts["warehouse.vendor_items_kpi"] = writer.copy_rows(conn, "warehouse.vendor_items_kpi", items)
        counts["warehouse.chat_history"] = writer.copy_rows(conn, "warehouse.chat_history", chats)
        counts["warehouse.messages"] = writer.copy_rows(conn, "warehouse.messages", messages)
        counts["warehouse.classifications"] = writer.copy_rows(conn, "warehouse.classifications", classifications)
        counts["warehouse.labels"] = writer.copy_rows(conn, "warehouse.labels", labels)
        counts["warehouse.call_analysis"] = writer.copy_rows(conn, "warehouse.call_analysis", calls)
        counts["warehouse.cancellation_predictions"] = writer.copy_rows(
            conn, "warehouse.cancellation_predictions", predictions
        )

        writer.advance_sequences(conn)
        writer.set_cursor(
            conn,
            seeded_from=qatar_instant(window.start, time(0, 0)),
            seeded_to=dataset_now,
            generator=f"seed:{seed_value}",
        )
        writer.record(conn, "seed", {
            "window": [str(window.start), str(window.end)],
            "seed": seed_value,
            "counts": counts,
        })
        conn.commit()
        writer.analyze(conn)

    return counts
