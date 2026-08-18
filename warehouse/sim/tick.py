"""
The live ticker — what makes this a simulation rather than a dataset.

Every few seconds it does four things:

  1. **Arrivals.** Draws a Poisson count of new orders from the hourly demand
     curve, so 13:00 in Doha is busy and 04:00 is nearly still. Rows are
     stamped with the real current time.
  2. **Lifecycle.** Advances in-flight orders through
     accepted → preparing → ready → out for delivery → delivered/cancelled.
  3. **Consequences.** Late and cancelled orders produce support contacts —
     which is what makes the cross-channel views tell one coherent story
     instead of showing three independent random walks.
  4. **Housekeeping.** Moves the cursor, prunes past the retention horizon.

Design notes worth knowing before changing anything here:

**The plan is written up front.** When an order is created, its entire future
is decided and stored in `sim.order_plan`. A tick is then a set-based UPDATE
that applies whatever has come due — no per-order Python, and a replayed window
produces identical outcomes.

**Ticks are driven by the cursor, not by the loop.** Each pass advances from
`sim.tick_cursor.last_tick_at` to now, in bounded steps. A tick that takes too
long, a container restart, a laptop that slept — all of it self-heals, because
the loop never assumes it ran on time.

**Scenarios bend the simulation** (`sim.scenarios`): a merchant outage, a
courier shortage in one zone, a sentiment storm, a demand spike. They are read
fresh every tick, so injecting one mid-demo takes effect within seconds.
"""

from __future__ import annotations

import logging
import math
import random
import signal
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import psycopg

from . import corpus as C
from . import writer
from .generate import QATAR, IN_FLIGHT_HOURS, day_weight, Window

logger = logging.getLogger(__name__)
UTC = timezone.utc

_HOUR_TOTAL = sum(C.HOUR_WEIGHTS)


@dataclass(frozen=True)
class TickConfig:
    tick_seconds: float = 10.0
    orders_per_day: int = 2500
    # How far back the warehouse keeps data. Bounds both the database size and
    # how long a query has to scan; 18 months keeps YTD and last-year
    # comparisons intact.
    retention_days: int = 548
    # A tick catches up at most this much wall time. Past it the simulator
    # fast-forwards the cursor and logs a gap rather than trying to
    # manufacture a week of missing history at startup.
    max_catchup_hours: float = 24.0
    # Longest span a single tick will simulate while catching up.
    max_step_seconds: float = 900.0
    prune_every_ticks: int = 2880  # ~8h at the default tick


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

@dataclass
class Scenarios:
    volume_multiplier: float = 1.0
    outage_merchants: tuple[str, ...] = ()
    shortage_zones: tuple[str, ...] = ()
    storm_channels: tuple[str, ...] = ()
    magnitude: float = 1.0

    @property
    def active(self) -> bool:
        return bool(
            self.volume_multiplier != 1.0
            or self.outage_merchants or self.shortage_zones or self.storm_channels
        )


def load_scenarios(conn: psycopg.Connection) -> Scenarios:
    rows = conn.execute(
        "SELECT kind, target, magnitude FROM sim.active_scenarios"
    ).fetchall()
    s = Scenarios()
    for kind, target, magnitude in rows:
        mag = float(magnitude)
        if kind == "volume_spike":
            s.volume_multiplier *= mag
        elif kind == "merchant_outage" and target:
            s.outage_merchants += (target,)
            s.magnitude = max(s.magnitude, mag)
        elif kind == "zone_courier_shortage" and target:
            s.shortage_zones += (target,)
            s.magnitude = max(s.magnitude, mag)
        elif kind == "sentiment_storm":
            s.storm_channels += (target or "*",)
            s.magnitude = max(s.magnitude, mag)
    return s


# ---------------------------------------------------------------------------
# Arrival process
# ---------------------------------------------------------------------------

def expected_orders(at: datetime, seconds: float, cfg: TickConfig, scen: Scenarios) -> float:
    """How many orders this window should produce.

    The hourly curve gives the share of a day's volume falling in this hour;
    the day curve adds the Thu–Sat peak and the seasonal shape. Both are the
    same curves the seeder uses, so live data continues the history's rhythm
    rather than starting a visibly different one.
    """
    local = at.astimezone(QATAR)
    hour_share = C.HOUR_WEIGHTS[local.hour] / _HOUR_TOTAL      # of a day
    per_second = cfg.orders_per_day * hour_share / 3600.0
    # day_weight wants a Window for its growth term; over a single day the
    # growth factor is irrelevant, so use a degenerate one centred on today.
    window = Window(start=local.date(), end=local.date())
    return per_second * seconds * day_weight(local.date(), window) * scen.volume_multiplier


def poisson(rng: random.Random, lam: float) -> int:
    """Poisson sample without numpy.

    Knuth's method below ~30, where it is exact and cheap; a normal
    approximation above, where Knuth's loop count grows with lambda.
    """
    if lam <= 0:
        return 0
    if lam < 30:
        target, k, p = math.exp(-lam), 0, 1.0
        while True:
            p *= rng.random()
            if p <= target:
                return k
            k += 1
    return max(0, round(rng.gauss(lam, math.sqrt(lam))))


# ---------------------------------------------------------------------------
# Order creation
# ---------------------------------------------------------------------------

def _plan_order(
    rng: random.Random, placed_at: datetime, scen: Scenarios
) -> tuple[dict, list[dict], dict]:
    """One order, its items, and its whole future."""
    name, platform, cuisine = rng.choice(C.MERCHANTS)
    zone = rng.choice(C.ZONES)
    cust_zone = zone if rng.random() < 0.8 else rng.choice(C.ZONES)
    local = placed_at.astimezone(QATAR)
    hour = local.hour

    subtotal = round(rng.lognormvariate(3.9, 0.55), 2)
    delivery = rng.choice([0, 5, 7, 10, 12])

    outage = name in scen.outage_merchants
    shortage = zone in scen.shortage_zones

    # Same risk model as the seeder, so live rows keep the correlations the
    # cancellation views are built to surface.
    risk = 0.055
    risk *= C.ZONE_RISK.get(zone, 1.0)
    risk *= 1.6 if hour >= 22 or hour < 6 else 1.0
    risk *= 1.25 if platform in ("Grocery", "Market") else 1.0
    risk *= 1.3 if subtotal > 220 else 1.0
    risk *= 1.35 if local.weekday() in (4, 5) else 1.0
    if outage:
        risk *= scen.magnitude * 4
    if shortage:
        risk *= scen.magnitude * 2.5

    cancelled = rng.random() < min(risk, 0.9)

    # Timings, stretched by whichever scenario applies.
    stretch = scen.magnitude * 3 if outage else (scen.magnitude * 2 if shortage else 1.0)
    accept_min = round(rng.uniform(0.5, 12.0) * stretch, 1)
    prep_min = round(rng.uniform(6, 42) * (scen.magnitude if outage else 1.0), 1)
    ready_to_door_min = round(rng.uniform(8, 40) * (scen.magnitude if shortage else 1.0), 1)
    total_min = round(accept_min + prep_min + ready_to_door_min, 1)

    accept_at = placed_at + timedelta(minutes=accept_min)
    prepare_at = accept_at + timedelta(seconds=30)
    ready_at = accept_at + timedelta(minutes=prep_min)
    dispatch_at = ready_at + timedelta(minutes=rng.uniform(1, 6))
    deliver_at = placed_at + timedelta(minutes=total_min)

    if cancelled:
        reason, actor, _ = rng.choices(C.CANCEL_REASONS, weights=C._REASON_WEIGHTS)[0]
        if outage:
            reason, actor = "Items out of stock at vendor", "Vendor"
        elif shortage:
            reason, actor = "No driver available", "Clarity Ops"
        # Cancellations happen EARLY, not proportionally through the lifecycle.
        # Every real reason for one — the vendor not answering, an item out of
        # stock, a customer changing their mind — surfaces in the first minutes.
        # Scaling the delay off total_min instead meant a merchant outage, which
        # inflates prep times to 80 minutes, would not produce its cancellations
        # for three hours: the opposite of what an outage looks like, and
        # useless to watch.
        cancel_delay = min(total_min * 0.9, rng.uniform(2, 30))
        terminal_at = placed_at + timedelta(minutes=cancel_delay)
    else:
        reason = actor = None
        terminal_at = deliver_at

    order = {
        "vendor_id": 1000 + next(i for i, m in enumerate(C.MERCHANTS) if m[0] == name),
        "customer_id": 200_000 + rng.randrange(45_000),
        "order_status": "Accepted",
        "order_placement_date": local.date(),
        "order_placement_time": local.time().replace(microsecond=0),
        "placed_at": placed_at,
        "total_order_value": round(subtotal + delivery, 2),
        "order_sub_total_value": subtotal,
        "delivery_charge": float(delivery),
        "vendor_to_customer_dist": round(rng.uniform(0.4, 18.0), 2),
        "driver_vendor_dist": round(rng.uniform(0.2, 9.0), 2),
        "is_pre_order": rng.random() < 0.06,
        "new_customer": rng.random() < 0.18,
        "is_pro_user": rng.random() < 0.22,
        "is_pro_vendor": rng.random() < 0.30,
        "is_treasure": rng.random() < 0.05,
        "is_discount": rng.random() < 0.25,
        "used_coupon": rng.choice([None, None, None, "WELCOME10", "CLARITY25", "FREEDEL"]),
        "payment_type": rng.choice(C.PAYMENT_TYPES),
        "customer_device_type": rng.choice(C.DEVICE_TYPES),
        "platform_name": platform,
        "cuisine": cuisine,
        "zone_name": zone,
        "customer_zone": cust_zone,
        "restaurant_name": name,
        "location": f"{zone}, Doha",
        "clarity_time_to_accept_order_min": round(rng.uniform(0.2, 6.0), 1),
        "vendor_to_accept_order_min": accept_min,
        "preparing_time_min": prep_min,
        # Only known once delivered; the lifecycle UPDATE fills it in.
        "since_create_til_delivred_min": None,
        "cancel_comment": None,
        "cancelled_by_txt": None,
        "cancelled_by_int": None,
        "feedback_order_rating": None,
        "feedback_delivery_rating": None,
        "feedback_comment": None,
        # The marker that separates live rows from seeded history.
        "sim_emitted_at": placed_at,
    }

    items = [
        {
            "order_id": None,  # filled once the id is minted
            "product_name": p,
            "cat_name": c,
            "count": q,
            "total_value": round(q * rng.uniform(8, 65), 2),
        }
        for p, c, q in (
            (*rng.choice(C.PRODUCTS), rng.randint(1, 3)) for _ in range(rng.randint(1, 4))
        )
    ]

    # Support contact. Cancellations and slow orders generate far more of it —
    # that correlation is what the contact-rate and cross-channel views read.
    contact_p = 0.30 if cancelled else (0.22 if total_min > 70 else 0.06)
    if outage or shortage:
        contact_p = min(0.85, contact_p * 2.5)
    contact_at = contact_kind = None
    if rng.random() < contact_p:
        contact_at = terminal_at + timedelta(minutes=rng.uniform(-10, 45))
        contact_kind = rng.choices(["message", "chat", "call"], weights=[6, 3, 1])[0]

    plan = {
        "accept_at": accept_at,
        "prepare_at": prepare_at,
        "ready_at": ready_at,
        "dispatch_at": dispatch_at,
        "terminal_at": terminal_at,
        "terminal_status": "Cancelled" if cancelled else "Delivered",
        "cancel_comment": reason,
        "cancelled_by": actor,
        "contact_at": contact_at,
        "contact_kind": contact_kind,
        "_total_min": total_min,
    }
    return order, items, plan


def create_orders(
    conn: psycopg.Connection, rng: random.Random, moments: list[datetime], scen: Scenarios
) -> int:
    if not moments:
        return 0

    orders, items, plans = [], [], []
    ids = conn.execute(
        "SELECT nextval('sim.order_id_seq') FROM generate_series(1, %s)", (len(moments),)
    ).fetchall()

    for (oid,), placed_at in zip(ids, moments):
        order, its, plan = _plan_order(rng, placed_at, scen)
        order["id"] = oid
        for it in its:
            it["order_id"] = oid
        plan["order_id"] = oid
        plan.pop("_total_min")
        orders.append(order)
        items.extend(its)
        plans.append(plan)

    writer.copy_rows(conn, "warehouse.vendor_kpi", orders)
    writer.copy_rows(conn, "warehouse.vendor_items_kpi", items)
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO sim.order_plan
                (order_id, accept_at, prepare_at, ready_at, dispatch_at, terminal_at,
                 terminal_status, cancel_comment, cancelled_by, contact_at, contact_kind)
            VALUES (%(order_id)s, %(accept_at)s, %(prepare_at)s, %(ready_at)s,
                    %(dispatch_at)s, %(terminal_at)s, %(terminal_status)s,
                    %(cancel_comment)s, %(cancelled_by)s, %(contact_at)s, %(contact_kind)s)
            """,
            plans,
        )
    return len(orders)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

# One set-based UPDATE for every in-flight order, rather than a row at a time.
# CASE order matters: the latest stage whose time has come wins.
_ADVANCE_SQL = """
UPDATE warehouse.vendor_kpi v
   SET order_status = CASE
           WHEN %(at)s >= p.terminal_at  THEN p.terminal_status
           WHEN %(at)s >= p.dispatch_at  THEN 'Out for delivery'
           WHEN %(at)s >= p.ready_at     THEN 'Ready for pickup'
           WHEN %(at)s >= p.prepare_at   THEN 'Preparing'
           ELSE v.order_status
       END,
       cancel_comment = CASE
           WHEN %(at)s >= p.terminal_at AND p.terminal_status = 'Cancelled'
           THEN p.cancel_comment || ' // ref-' || v.id::text END,
       cancelled_by_txt = CASE
           WHEN %(at)s >= p.terminal_at AND p.terminal_status = 'Cancelled'
           THEN p.cancelled_by END,
       cancelled_by_int = CASE
           WHEN %(at)s >= p.terminal_at AND p.terminal_status = 'Cancelled'
           THEN CASE p.cancelled_by
                    WHEN 'Customer' THEN 1 WHEN 'Vendor' THEN 2
                    WHEN 'Clarity Ops' THEN 3 WHEN 'Driver' THEN 4 END END,
       -- Actual door-to-door time, known only on delivery.
       since_create_til_delivred_min = CASE
           WHEN %(at)s >= p.terminal_at AND p.terminal_status = 'Delivered'
           THEN round((EXTRACT(EPOCH FROM (p.terminal_at - v.placed_at)) / 60.0)::numeric, 1) END,
       -- Only some customers rate, and only delivered orders can be rated.
       feedback_order_rating = CASE
           WHEN %(at)s >= p.terminal_at AND p.terminal_status = 'Delivered'
                AND (v.id %% 5) < 2 THEN 3 + (v.id %% 3) END,
       feedback_delivery_rating = CASE
           WHEN %(at)s >= p.terminal_at AND p.terminal_status = 'Delivered'
                AND (v.id %% 6) < 2 THEN 3 + (v.id %% 3) END
  FROM sim.order_plan p
 WHERE p.order_id = v.id
   AND v.order_status IN ('Accepted', 'Preparing', 'Ready for pickup', 'Out for delivery')
"""

# A plan is finished once its order reached a terminal state AND any support
# contact it owed has been emitted; keeping it longer would replay the contact.
_RETIRE_PLANS_SQL = """
DELETE FROM sim.order_plan p
 USING warehouse.vendor_kpi v
 WHERE p.order_id = v.id
   AND v.order_status IN ('Delivered', 'Cancelled')
   AND (p.contact_at IS NULL OR p.contact_at < %(at)s)
"""


def advance_lifecycle(conn: psycopg.Connection, at: datetime) -> int:
    with conn.cursor() as cur:
        cur.execute(_ADVANCE_SQL, {"at": at})
        return cur.rowcount


# ---------------------------------------------------------------------------
# Support consequences
# ---------------------------------------------------------------------------

def emit_support(
    conn: psycopg.Connection, rng: random.Random, since: datetime, at: datetime, scen: Scenarios
) -> dict[str, int]:
    """Turn due contacts into messages, chats and calls.

    Written as *raw* rows only — no classification. That is deliberate: the
    backend's classifier picks them up and labels them, which demonstrates the
    real ingest → classify → serve pipeline instead of pre-baking the answer.
    """
    due = conn.execute(
        """
        SELECT p.order_id, p.contact_kind, p.contact_at, p.terminal_status,
               v.restaurant_name, v.zone_name, v.customer_id
          FROM sim.order_plan p
          JOIN warehouse.vendor_kpi v ON v.id = p.order_id
         WHERE p.contact_at IS NOT NULL
           AND p.contact_at > %(since)s AND p.contact_at <= %(at)s
        """,
        {"since": since, "at": at},
    ).fetchall()
    if not due:
        return {}

    messages, chats, calls = [], [], []
    for order_id, kind, contact_at, terminal, merchant, zone, customer_id in due:
        stormy = scen.storm_channels and rng.random() < min(0.9, 0.4 * scen.magnitude)
        # An unhappy outcome picks from the negative half of the corpus.
        negative = terminal == "Cancelled" or stormy or rng.random() < 0.45
        pool = [t for t in C.MESSAGE_TEMPLATES if (t[0] == "negative") == negative]
        _, _, _, text = rng.choice(pool)

        if kind == "message":
            (seq,) = conn.execute("SELECT nextval('sim.message_seq')").fetchone()
            messages.append({
                "message_id": f"msg-{seq:06d}",
                "customer_id": str(customer_id),
                "content": text,
                "source_channel": rng.choices(
                    C.MESSAGE_CHANNELS, weights=C.MESSAGE_CHANNEL_WEIGHTS
                )[0],
                "merchant_name": merchant,
                "zone": zone,
                "created_at": contact_at,
                "ingested_at": contact_at + timedelta(seconds=rng.randint(5, 120)),
                "closed_at": None,          # open; the SLA views want live ones
                "agent_name": rng.choice(C.AGENTS) if rng.random() < 0.22 else None,
                "sim_emitted_at": at,
            })
        elif kind == "chat":
            (seq,) = conn.execute("SELECT nextval('sim.chat_id_seq')").fetchone()
            chats.append({
                "chat_id": seq,
                "customer_id": customer_id,
                "order_id": order_id,
                "type": rng.choice(C.CHAT_CHANNELS),
                "device_id": f"dev-{rng.randrange(99999)}",
                "locale": rng.choice(C.CHAT_LOCALES),
                "messages": [{"from": "customer", "text": text}],
                "created_at": contact_at,
                "closed_at": None,
                "closed_by": None,
                "is_phone_call": False,
            })
        else:
            sc = rng.choices(C.CALL_SCENARIOS, weights=C._CALL_WEIGHTS)[0]
            agent = rng.choice(C.AGENTS)
            customer = rng.choice(C.CUSTOMER_FIRST_NAMES)
            arabic = sc.get("arabic", False)
            a_tag, c_tag = ("الموظف", "العميل") if arabic else ("Agent", "Customer")
            lines = [
                f"{a_tag} ({agent}): خدمة عملاء Clarity، معك {agent}." if arabic
                else f"{a_tag} ({agent}): Clarity customer service, {agent} speaking."
            ]
            for j in range(max(len(sc["customer"]), len(sc["agent"]))):
                if j < len(sc["customer"]):
                    lines.append(f"{c_tag} ({customer}): {sc['customer'][j]}")
                if j < len(sc["agent"]):
                    lines.append(f"{a_tag} ({agent}): {sc['agent'][j]}")
            calls.append({
                "call_id": str(__import__("uuid").UUID(int=rng.getrandbits(128), version=4)),
                "transcript": "\n".join(lines),
                "intents": [sc["intent"]],
                "primary_intent": sc["intent"],
                "sentiment": sc["sentiment"],
                "sentiment_confidence": sc["confidence"],
                "order_ids": [str(order_id)],
                "restaurant_names": [merchant],
                "areas": [zone],
                "product_names": [],
                "qar_amounts": [],
                "summary": sc["summary"],
            "call_reason": C.derive_reason(
                sc.get("reason", ""), sc["summary"], sc["intent"]),
                "analysed_at": contact_at,
                "sim_emitted_at": at,
            })

    counts = {}
    if messages:
        counts["messages"] = writer.copy_rows(conn, "warehouse.messages", messages)
    if chats:
        counts["chats"] = writer.copy_rows(conn, "warehouse.chat_history", chats)
    if calls:
        counts["calls"] = writer.copy_rows(conn, "warehouse.call_analysis", calls)
    return counts


def close_conversations(conn: psycopg.Connection, at: datetime) -> int:
    """Resolve open conversations as their handling time elapses.

    Without this every live message stays open forever and the SLA panel fills
    with false breaches within a day.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE warehouse.messages
               SET closed_at = %(at)s,
                   agent_name = COALESCE(agent_name, 'Fatima Ezzahra')
             WHERE closed_at IS NULL
               AND sim_emitted_at IS NOT NULL
               -- Tickets run long, chats short; the tail of each still breaches.
               AND created_at < %(at)s - (CASE WHEN source_channel = 'ticket'
                                               THEN interval '6 hours'
                                               ELSE interval '90 minutes' END)
               -- Leave a slice permanently open so "still open" is never empty.
               -- Modulo is doubled below: psycopg scans the whole string for
               -- placeholders, comments included, so a bare percent sign
               -- anywhere in here is a parse error.
               AND (abs(hashtext(message_id)) %% 100) >= 12
            """,
            {"at": at},
        )
        closed = cur.rowcount
        cur.execute(
            """
            UPDATE warehouse.chat_history
               SET closed_at = %(at)s, closed_by = 'cron'
             WHERE closed_at IS NULL AND created_at < %(at)s - interval '3 hours'
            """,
            {"at": at},
        )
    return closed


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

def prune(conn: psycopg.Connection, at: datetime, retention_days: int) -> dict[str, int]:
    """Drop everything past the horizon, so the warehouse stops growing.

    Order items and classifications go with their parents via ON DELETE
    CASCADE, which is why the FKs are there.
    """
    cutoff = at - timedelta(days=retention_days)
    counts: dict[str, int] = {}
    with conn.cursor() as cur:
        for table, column in (
            ("warehouse.vendor_kpi", "placed_at"),
            ("warehouse.messages", "created_at"),
            ("warehouse.chat_history", "created_at"),
            ("warehouse.call_analysis", "analysed_at"),
            ("warehouse.cancellation_predictions", "predicted_at"),
        ):
            cur.execute(f"DELETE FROM {table} WHERE {column} < %s", (cutoff,))
            if cur.rowcount:
                counts[table] = cur.rowcount
    return counts


# ---------------------------------------------------------------------------
# The tick
# ---------------------------------------------------------------------------

def tick(
    conn: psycopg.Connection, cfg: TickConfig, since: datetime, at: datetime, seed: int
) -> dict:
    """Simulate the window (since, at]. Idempotent per window given the seed."""
    seconds = (at - since).total_seconds()
    if seconds <= 0:
        return {}

    rng = random.Random(f"{seed}:{since.isoformat()}:{at.isoformat()}")
    scen = load_scenarios(conn)

    lam = expected_orders(since, seconds, cfg, scen)
    n = poisson(rng, lam)
    moments = sorted(
        since + timedelta(seconds=rng.uniform(0, seconds)) for _ in range(n)
    )

    created = create_orders(conn, rng, moments, scen)
    advanced = advance_lifecycle(conn, at)
    support = emit_support(conn, rng, since, at, scen)
    closed = close_conversations(conn, at)

    with conn.cursor() as cur:
        cur.execute(_RETIRE_PLANS_SQL, {"at": at})
        cur.execute(
            "UPDATE sim.tick_cursor SET last_tick_at = %s, updated_at = now() WHERE only_row",
            (at,),
        )
    conn.commit()

    return {
        "orders": created, "advanced": advanced, "closed": closed,
        **support,
        **({"scenarios": True} if scen.active else {}),
    }


def catch_up_bounds(cursor_at: datetime | None, now: datetime, cfg: TickConfig) -> tuple[datetime, bool]:
    """Where this run should resume from, and whether a gap was skipped."""
    if cursor_at is None:
        return now - timedelta(seconds=cfg.tick_seconds), False
    behind = (now - cursor_at).total_seconds()
    if behind > cfg.max_catchup_hours * 3600:
        return now - timedelta(hours=cfg.max_catchup_hours), True
    return cursor_at, False


def run(dsn: str, cfg: TickConfig, seed: int, once: bool = False) -> None:
    stopping = False

    def _stop(signum, _frame):
        nonlocal stopping
        stopping = True
        logger.info("signal %s — finishing the current tick and exiting", signum)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    with psycopg.connect(dsn) as conn:
        # Re-park the id sequences before minting anything: a reseed while the
        # ticker was down would otherwise leave them pointing into occupied
        # id space, and the first insert dies on the primary key.
        writer.advance_sequences(conn)
        conn.commit()

        row = conn.execute("SELECT last_tick_at FROM sim.tick_cursor").fetchone()
        now = datetime.now(UTC)
        resume_from, gapped = catch_up_bounds(row[0] if row else None, now, cfg)
        if gapped:
            logger.warning(
                "cursor was %s — beyond the %.0fh catch-up limit; fast-forwarding",
                row[0], cfg.max_catchup_hours,
            )
            writer.record(conn, "gap", {"cursor": str(row[0]), "resumed_at": str(resume_from)})
        writer.record(conn, "ticker_start", {
            "resume_from": str(resume_from), "orders_per_day": cfg.orders_per_day,
        })
        conn.commit()

        logger.info(
            "ticker up: %s orders/day, %.0fs ticks, resuming from %s",
            f"{cfg.orders_per_day:,}", cfg.tick_seconds, resume_from,
        )

        cursor_at, ticks = resume_from, 0
        while not stopping:
            now = datetime.now(UTC)
            # Catch-up runs in bounded steps so one enormous window never
            # produces a single unreviewable burst of orders.
            target = min(now, cursor_at + timedelta(seconds=cfg.max_step_seconds))
            if target > cursor_at:
                stats = tick(conn, cfg, cursor_at, target, seed)
                cursor_at = target
                ticks += 1
                if stats.get("orders") or stats.get("messages") or stats.get("calls"):
                    logger.info("tick %s → %s", target.strftime("%H:%M:%S"), stats)

                if ticks % cfg.prune_every_ticks == 0:
                    pruned = prune(conn, now, cfg.retention_days)
                    conn.commit()
                    if pruned:
                        logger.info("pruned past %d days: %s", cfg.retention_days, pruned)
                        writer.record(conn, "prune", pruned)
                        conn.commit()

            if once:
                return
            # Only sleep once caught up; otherwise loop straight into the next step.
            if cursor_at >= now - timedelta(seconds=1):
                time.sleep(cfg.tick_seconds)

        writer.record(conn, "ticker_stop", {"cursor": str(cursor_at)})
        conn.commit()
        logger.info("ticker stopped cleanly at %s", cursor_at)
