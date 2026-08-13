"""
The generators — ported from `backend/scripts/generate_mock_db.py`.

Three things changed in the port, all of them deliberate:

1. **Native types.** Rows are dicts of real Python values (`date`, `time`,
   timezone-aware `datetime`, `bool`, `Decimal`-friendly floats, lists/dicts for
   JSON) instead of tuples of SQLite-friendly strings. The 36-element positional
   tuple the original built for `vendor_kpi` was a latent bug waiting for
   someone to insert a column in the middle.

2. **The window is a parameter, not a constant.** The original hard-coded
   `START_DAY = 2025-01-01` and `END_DAY = clock.FROZEN_TODAY`. Here the caller
   passes a `Window`, which is what lets the seed roll forward to end at *today*
   instead of at a fixed day in the past — the entire point of the exercise.

3. **Real timezone maths.** Orders are recorded in Qatar local time (a naive
   date + time pair, as the source system does it); everything else is a true
   UTC instant derived from it. The original approximated this with a literal
   `hour - 3`.

The distributions, weights and correlations are otherwise unchanged: cancel
risk still varies by zone, merchant, hour, basket size and day of week, so
every cancellation breakdown keeps its signal.
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from . import corpus as C

QATAR = ZoneInfo("Asia/Qatar")
UTC = timezone.utc

# Mean end-to-end order time, in hours: accept + prepare + deliver. Sets how
# deep the in-flight queue is at any moment. Derived from the same
# preparing/delivery distributions the generator samples below.
IN_FLIGHT_HOURS = 1.0


# ---------------------------------------------------------------------------
# Window and volumes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Window:
    """The span the dataset covers. `end` is the dataset's 'today'.

    `cutoff` is the instant the data stops at. It matters when the window ends
    on the real today: without it the seed fills the whole final day, so the
    dashboard opens showing a completed day's volume for a day that is three
    hours old, and every "today so far" comparison reads wrong. With it, today
    is partial — exactly as it would be against a live warehouse.
    """

    start: date
    end: date
    cutoff: datetime | None = None

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def contains(self, d: date) -> bool:
        return self.start <= d <= self.end

    @property
    def cutoff_local(self) -> datetime | None:
        return self.cutoff.astimezone(QATAR) if self.cutoff else None

    def is_partial_day(self, d: date) -> bool:
        local = self.cutoff_local
        return local is not None and d == local.date()

    def elapsed_share(self, d: date) -> float:
        """How much of `d`'s demand has already happened, by the hourly curve.

        Used to scale the final day's volume: at 09:00 Qatar only ~13% of a
        day's orders have been placed, so generating a full day's worth would
        overstate today by 8x.
        """
        local = self.cutoff_local
        if local is None or d != local.date():
            return 1.0
        total = sum(C.HOUR_WEIGHTS)
        done = sum(C.HOUR_WEIGHTS[: local.hour])
        done += C.HOUR_WEIGHTS[local.hour] * (local.minute / 60.0)
        return max(done / total, 1e-6)


@dataclass(frozen=True)
class Volumes:
    orders: int = 60_000
    messages: int = 14_000
    calls: int = 1_800
    labels: int = 400
    # Non-terminal orders on the final day — these become the live risk queue.
    live_orders: int = 600
    # One support chat per N orders. Drives the CX contact-rate metric.
    orders_per_chat: int = 8

    @classmethod
    def for_total(cls, orders: int, *, orders_per_day: float | None = None) -> "Volumes":
        """Scale support volume with order volume, holding the ratios of the
        original dataset (14k messages and 1.8k calls per 60k orders).

        The labelled sample does NOT scale: it is human QA work, and a real
        team labels a fixed-size sample however busy the platform gets — which
        is also what keeps the accuracy endpoint honest as volume grows.
        """
        per_day = orders_per_day if orders_per_day is not None else orders / 574
        return cls(
            orders=orders,
            messages=max(1, round(orders * 14_000 / 60_000)),
            calls=max(1, round(orders * 1_800 / 60_000)),
            labels=400,
            # A quarter of a day's orders are still in flight at any moment —
            # roughly the evening peak, which is where the risk queue lives.
            live_orders=max(1, round(per_day * 0.25)),
        )

    @classmethod
    def for_density(cls, window: Window, orders_per_day: int) -> "Volumes":
        """Volumes expressed as a daily rate — how a live system is actually
        specified, and the form Phase 3's ticker will use."""
        return cls.for_total(orders_per_day * window.days, orders_per_day=orders_per_day)


# ---------------------------------------------------------------------------
# Shape helpers
# ---------------------------------------------------------------------------

def day_weight(d: date, window: Window) -> float:
    """Volume shape: weekend peak, Ramadan-ish dip, steady growth.

    Ramadan is keyed off the actual month rather than a fixed year, so the dip
    keeps landing in the right place as the window rolls forward — the original
    hard-coded March 2026 and would have quietly lost the dip in 2027.
    """
    w = 1.0 + 0.25 * (d.weekday() in (3, 4, 5))              # Thu–Sat busiest in Qatar
    w *= 1.0 + 0.30 * ((d - window.start).days / window.days)  # growth over the period
    w *= 0.78 if d.month == _ramadan_month(d.year) else 1.0
    w *= window.elapsed_share(d)   # 1.0 for every day except a partial today
    return w


def _ramadan_month(year: int) -> int:
    """Gregorian month Ramadan mostly falls in. Drifts ~11 days earlier a year;
    close enough for a demand curve, and it keeps moving like the real thing."""
    return {2025: 3, 2026: 3, 2027: 2, 2028: 2, 2029: 1, 2030: 1}.get(year, 3)


def pick_hour(rng: random.Random, *, max_hour: int | None = None) -> int:
    """Order clock: lunch and dinner peaks, thin early morning. Qatar local.

    `max_hour` clips the curve to the hours that have actually happened, which
    is what keeps a partial final day from scattering orders into tonight.
    """
    hours = range(24 if max_hour is None else max_hour + 1)
    return rng.choices(hours, weights=C.HOUR_WEIGHTS[: len(hours)])[0]


def weighted_day(rng: random.Random, window: Window) -> date:
    """A random day in the window, weighted toward busier/more recent days."""
    while True:
        d = window.start + timedelta(days=rng.randrange(window.days))
        if rng.random() < day_weight(d, window) / 1.7:
            return d


def qatar_instant(d: date, t: time) -> datetime:
    """A Qatar-local wall time as a real UTC instant."""
    return datetime.combine(d, t, tzinfo=QATAR).astimezone(UTC)


def _rand_time(rng: random.Random, hour: int) -> time:
    return time(hour, rng.randrange(60), rng.randrange(60))


def local_time_on(rng: random.Random, d: date, window: Window) -> time:
    """A Qatar-local time of day on `d`, never later than the window's cutoff."""
    local = window.cutoff_local
    if local is not None and d == local.date():
        t = _rand_time(rng, pick_hour(rng, max_hour=local.hour))
        return min(t, local.timetz().replace(tzinfo=None))
    return _rand_time(rng, pick_hour(rng))


def _in_flight_count(window: Window, volumes: Volumes) -> int:
    """How many orders should still be in flight at the cutoff.

    Little's law, not a fixed fraction of the day: in-flight ≈ arrival rate ×
    time in flight. An order takes about an hour end to end, so the queue is
    roughly one hour of arrivals at the CURRENT hour's rate. That is the
    difference between 625 open orders at 09:48 on a quiet morning — which is
    what a flat fraction gives, and which looks obviously fake on the risk
    queue — and the ~80 a real morning would have.
    """
    local = window.cutoff_local
    if local is None:
        return volumes.live_orders
    per_day = volumes.orders / window.days
    hourly_share = C.HOUR_WEIGHTS[local.hour] / sum(C.HOUR_WEIGHTS)
    return max(1, round(per_day * hourly_share * IN_FLIGHT_HOURS))


def _in_flight_time(rng: random.Random, window: Window) -> time:
    """Placement time for an order that is still in flight: inside the last two
    hours before the cutoff, or the evening peak if there is no cutoff."""
    local = window.cutoff_local
    if local is None:
        return _rand_time(rng, rng.randrange(18, 22))
    moment = local - timedelta(minutes=rng.randint(1, round(IN_FLIGHT_HOURS * 120)))
    # Never walk back past midnight — the order belongs to the final day.
    return moment.time() if moment.date() == local.date() else time(0, rng.randrange(60))


def _clamp(moment: datetime | None, cutoff: datetime | None) -> datetime | None:
    """Drop a derived timestamp that would land in the future.

    Applied to `closed_at`: a conversation whose computed close time is after
    the cutoff has not been closed yet, so it stays open. That is the honest
    reading, and it is also what keeps the SLA panels populated.
    """
    if moment is None or cutoff is None:
        return moment
    return None if moment > cutoff else moment


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------

def gen_orders(
    rng: random.Random,
    window: Window,
    volumes: Volumes,
    *,
    first_order_id: int = 500_000,
) -> tuple[list[dict], list[dict]]:
    """Orders and their line items.

    Cancellation risk varies by zone, vertical, hour, basket size and day of
    week, so every cancellation breakdown in the product has real signal rather
    than uniform noise.
    """
    merchant_bias = {m[0]: rng.uniform(0.55, 1.9) for m in C.MERCHANTS}
    merchant_bias["Clarity Res"] = 14.0   # internal test accounts cancel constantly
    merchant_bias["TestNot"] = 16.0
    vendor_ids = {m[0]: 1000 + i for i, m in enumerate(C.MERCHANTS)}

    days = [window.start + timedelta(days=i) for i in range(window.days)]
    weights = [day_weight(d, window) for d in days]
    n_live = _in_flight_count(window, volumes)
    n_history = max(0, volumes.orders - n_live)
    order_days = rng.choices(days, weights=weights, k=n_history)
    order_days.sort()
    order_days += [window.end] * n_live

    orders: list[dict] = []
    items: list[dict] = []

    for i, d in enumerate(order_days):
        oid = first_order_id + i
        live = i >= n_history
        name, platform, cuisine = rng.choice(C.MERCHANTS)
        zone = rng.choice(C.ZONES)
        cust_zone = zone if rng.random() < 0.8 else rng.choice(C.ZONES)
        # In-flight orders were placed in the last couple of hours — that is
        # what "still in flight" means. Against a fixed end day there is no
        # clock to anchor to, so they sit in the evening peak instead.
        placement_time = (
            _in_flight_time(rng, window) if live else local_time_on(rng, d, window)
        )
        hour = placement_time.hour

        subtotal = round(rng.lognormvariate(3.9, 0.55), 2)
        delivery = rng.choice([0, 5, 7, 10, 12])
        total = round(subtotal + delivery, 2)

        risk = 0.055
        risk *= C.ZONE_RISK.get(zone, 1.0)
        risk *= merchant_bias[name]
        risk *= 1.6 if hour >= 22 or hour < 6 else 1.0        # late-night ops thin out
        risk *= 1.25 if platform in ("Grocery", "Market") else 1.0
        risk *= 1.3 if subtotal > 220 else 1.0
        risk *= 1.35 if d.weekday() in (4, 5) else 1.0

        if live:
            status = rng.choice(list(C.OPEN_STATUSES))
        elif rng.random() < min(risk, 0.85):
            status = "Cancelled"
        else:
            status = "Delivered"

        cancelled = status == "Cancelled"
        delivered = status == "Delivered"
        reason, actor, _ = (
            rng.choices(C.CANCEL_REASONS, weights=C._REASON_WEIGHTS)[0] if cancelled
            else (None, None, None)
        )

        orders.append({
            "id": oid,
            "vendor_id": vendor_ids[name],
            "customer_id": 200_000 + rng.randrange(45_000),
            "order_status": status,
            "order_placement_date": d,
            "order_placement_time": placement_time,
            "placed_at": qatar_instant(d, placement_time),
            "total_order_value": total,
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
            "vendor_to_accept_order_min": round(rng.uniform(0.5, 12.0), 1),
            "preparing_time_min": round(rng.uniform(6, 42), 1),
            "since_create_til_delivred_min": round(rng.uniform(22, 95), 1) if delivered else None,
            # The '// ref-' suffix exists so split_first(cancel_comment, '//')
            # has something to strip — the product parses the reason back out.
            "cancel_comment": f"{reason} // ref-{oid}" if cancelled else None,
            "cancelled_by_txt": actor,
            "cancelled_by_int": C.CANCELLED_BY_INT.get(actor or ""),
            "feedback_order_rating": float(rng.randint(3, 5)) if delivered and rng.random() < 0.4 else None,
            "feedback_delivery_rating": float(rng.randint(3, 5)) if delivered and rng.random() < 0.35 else None,
            "feedback_comment": (
                rng.choice(["Great service", "Food was cold", "Fast delivery", None])
                if delivered and rng.random() < 0.15 else None
            ),
            "sim_emitted_at": None,
        })

        for _ in range(rng.randint(1, 4)):
            product, cat = rng.choice(C.PRODUCTS)
            qty = rng.randint(1, 3)
            items.append({
                "order_id": oid,
                "product_name": product,
                "cat_name": cat,
                "count": qty,
                "total_value": round(qty * rng.uniform(8, 65), 2),
            })

    return orders, items


# ---------------------------------------------------------------------------
# Chats
# ---------------------------------------------------------------------------

def gen_chats(
    rng: random.Random,
    orders: list[dict],
    count: int,
    *,
    window: Window | None = None,
    since: date | None = None,
    first_chat_id: int = 900_000,
) -> list[dict]:
    """Support chats linked to an order, so the CX contact-rate metric has a
    denominator. `since` matches the real system's chat coverage, which starts
    later than the order history."""
    cutoff = window.cutoff if window else None
    pool = [
        o for o in orders
        if (since is None or o["order_placement_date"] >= since)
        and (cutoff is None or o["placed_at"] <= cutoff)
    ]
    if not pool:
        pool = orders
    rows = []
    for i in range(count):
        o = rng.choice(pool)
        opened = o["placed_at"] + timedelta(minutes=rng.randint(2, 90))
        if cutoff and opened > cutoff:
            opened = cutoff - timedelta(minutes=rng.randint(1, 30))
        closed = _clamp(opened + timedelta(minutes=rng.randint(3, 400)), cutoff)
        closed_by = (
            rng.choice(C.AGENTS) if rng.random() < 0.42
            else rng.choice(["cron", "customer", "bot"])
        )
        rows.append({
            "chat_id": first_chat_id + i,
            "customer_id": o["customer_id"],
            "order_id": o["id"],
            "type": rng.choice(C.CHAT_CHANNELS),
            "device_id": f"dev-{rng.randrange(99999)}" if rng.random() < 0.8 else None,
            "locale": rng.choice(C.CHAT_LOCALES),
            "messages": [{"from": "customer", "text": rng.choice(C.MESSAGE_TEMPLATES)[3]}],
            "created_at": opened,
            "closed_at": closed,
            # A chat that has not closed has nobody who closed it.
            "closed_by": closed_by if closed else None,
            "is_phone_call": False,
        })
    return rows


# ---------------------------------------------------------------------------
# Support messages, their classifications, and a labelled sample
# ---------------------------------------------------------------------------

def gen_messages(
    rng: random.Random,
    window: Window,
    count: int,
    label_count: int,
) -> tuple[list[dict], list[dict], list[dict]]:
    messages: list[dict] = []
    classifications: list[dict] = []

    for i in range(count):
        sentiment, intent, trigger, text = rng.choices(
            C.MESSAGE_TEMPLATES, weights=C._MSG_WEIGHTS
        )[0]
        d = weighted_day(rng, window)
        created = qatar_instant(d, local_time_on(rng, d, window))
        mid = f"msg-{i:06d}"
        channel = rng.choices(C.MESSAGE_CHANNELS, weights=C.MESSAGE_CHANNEL_WEIGHTS)[0]

        # Handling time: tickets run long, chats short, and a tail of each
        # blows out — that tail is what the SLA-breach view is built to catch.
        base_hours = rng.uniform(2, 20) if channel == "ticket" else rng.uniform(0.2, 3.5)
        if rng.random() < 0.14:
            base_hours *= rng.uniform(2.5, 6)

        # Only conversations from the last few days may still be open. Without
        # this a 2025 message shows up as a 500-day SLA breach and dominates
        # every "still open" panel.
        recent = (window.end - d).days <= 3
        closed = None if (recent and rng.random() < 0.35) else created + timedelta(hours=base_hours)
        # …and one whose close time has not arrived yet is simply still open.
        closed = _clamp(closed, window.cutoff)

        messages.append({
            "message_id": mid,
            "customer_id": str(200_000 + rng.randrange(45_000)),
            "content": text,
            "source_channel": channel,
            "merchant_name": rng.choice(C.MERCHANTS)[0],
            "zone": rng.choice(C.ZONES),
            "created_at": created,
            "ingested_at": min(
                created + timedelta(minutes=rng.randint(1, 30)),
                window.cutoff or datetime.max.replace(tzinfo=UTC),
            ),
            "closed_at": closed,
            "agent_name": rng.choice(C.AGENTS) if rng.random() < 0.22 else None,
            "sim_emitted_at": None,
        })
        classifications.append({
            "classification_id": f"clf-{i:06d}",
            "message_id": mid,
            "sentiment": sentiment,
            "sentiment_confidence": round(rng.uniform(0.68, 0.99), 3),
            "intent": intent,
            "intent_confidence": round(rng.uniform(0.6, 0.98), 3),
            "negative_trigger": trigger if sentiment == "negative" else None,
            "model_version": "gemini-3.1-flash-lite",
            "classified_at": created + timedelta(minutes=rng.randint(2, 45)),
        })

    # Ground truth for the accuracy endpoint — a human sample that mostly
    # agrees with the model, so precision/recall land in a believable band.
    by_message = {c["message_id"]: c for c in classifications}
    labels = []
    sentiments = ("positive", "neutral", "negative")
    intents = ("complaint", "refund", "order_query", "cancellation_request", "praise")
    for m in rng.sample(messages, min(label_count, len(messages))):
        clf = by_message[m["message_id"]]
        labels.append({
            "message_id": m["message_id"],
            "true_sentiment": (
                clf["sentiment"] if rng.random() < 0.89
                else rng.choice([s for s in sentiments if s != clf["sentiment"]])
            ),
            "true_intent": (
                clf["intent"] if rng.random() < 0.84
                else rng.choice([i for i in intents if i != clf["intent"]])
            ),
            "labelled_by": "cx_qa_team",
            "labelled_at": m["created_at"],
        })

    return messages, classifications, labels


# ---------------------------------------------------------------------------
# Calls
# ---------------------------------------------------------------------------

def gen_calls(
    rng: random.Random,
    orders: list[dict],
    count: int,
    *,
    window: Window | None = None,
    since: date | None = None,
) -> list[dict]:
    """Analysed calls. The call list parses speaker turns back out of the
    transcript to derive agent name, agent helpfulness and customer behaviour,
    so the `Agent (Name):` / `Customer (Name):` prefixes are load-bearing."""
    cutoff = window.cutoff if window else None
    pool = [
        o for o in orders
        if (since is None or o["order_placement_date"] >= since)
        and (cutoff is None or o["placed_at"] <= cutoff)
    ]
    if not pool:
        pool = orders

    rows = []
    for _ in range(count):
        sc = rng.choices(C.CALL_SCENARIOS, weights=C._CALL_WEIGHTS)[0]
        agent = rng.choice(C.AGENTS)
        customer = rng.choice(C.CUSTOMER_FIRST_NAMES)
        arabic = sc.get("arabic", False)
        a_tag, c_tag = ("الموظف", "العميل") if arabic else ("Agent", "Customer")

        opening = (
            f"{a_tag} ({agent}): خدمة عملاء Clarity، معك {agent}." if arabic
            else f"{a_tag} ({agent}): Clarity customer service, {agent} speaking."
        )
        lines = [opening]
        for j in range(max(len(sc["customer"]), len(sc["agent"]))):
            if j < len(sc["customer"]):
                lines.append(f"{c_tag} ({customer}): {sc['customer'][j]}")
            if j < len(sc["agent"]):
                lines.append(f"{a_tag} ({agent}): {sc['agent'][j]}")

        order = rng.choice(pool)
        d = order["order_placement_date"]
        rows.append({
            "call_id": str(uuid.UUID(int=rng.getrandbits(128), version=4)),
            "transcript": "\n".join(lines),
            "intents": [sc["intent"]] + (
                [rng.choice(["complaint", "escalation"])] if rng.random() < 0.25 else []
            ),
            "primary_intent": sc["intent"],
            "sentiment": sc["sentiment"],
            "sentiment_confidence": sc["confidence"],
            "order_ids": [str(order["id"])] if rng.random() < 0.75 else [],
            "restaurant_names": [order["restaurant_name"]],
            "areas": rng.sample(C.AREAS, rng.randint(1, 2)),
            "product_names": [rng.choice(C.PRODUCTS)[0] for _ in range(rng.randint(0, 2))],
            "qar_amounts": [str(round(rng.uniform(15, 250), 2))] if rng.random() < 0.4 else [],
            "summary": sc["summary"],
            "analysed_at": qatar_instant(d, local_time_on(rng, d, window)) if window
                           else qatar_instant(d, _rand_time(rng, pick_hour(rng))),
            "sim_emitted_at": None,
        })
    return rows


# ---------------------------------------------------------------------------
# Cancellation predictions
# ---------------------------------------------------------------------------

_RISK_FACTORS = [
    ("vendor_cancel_rate_30d", "increases_risk", "Vendor has cancelled a high share of recent orders"),
    ("zone_cancel_rate_30d", "increases_risk", "This zone runs above the platform cancellation rate"),
    ("hour_of_day", "increases_risk", "Late-night slot with thin courier coverage"),
    ("total_order_value", "increases_risk", "Basket is large enough that vendors often short items"),
    ("vendor_to_customer_dist", "increases_risk", "Long vendor-to-customer distance"),
    ("is_new_customer", "increases_risk", "First-time customer, higher change-of-mind rate"),
    ("is_pro_user", "decreases_risk", "Pro subscriber, historically completes orders"),
    ("payment_type", "decreases_risk", "Prepaid by card, less likely to be abandoned"),
    ("customer_order_count", "decreases_risk", "Repeat customer with a long order history"),
]

_ACTIONS = [
    "Call the vendor now to confirm stock before the courier is dispatched.",
    "Pre-assign a backup courier for this zone in the next 15 minutes.",
    "Send the customer a proactive ETA update to reduce change-of-mind cancellations.",
    "Flag to the zone supervisor and hold dispatch until the vendor confirms.",
    "Offer a small delivery credit up front to keep the customer engaged.",
]


def gen_predictions(
    rng: random.Random,
    orders: list[dict],
    predicted_at: datetime,
) -> list[dict]:
    """Pre-scored risk for the in-flight orders.

    Seeding these means the live-queue endpoint reads through its cache and
    never calls Gemini on a cold start. From Phase 5 the predictor writes these
    itself and this becomes seed-only.
    """
    live = [o for o in orders if o["order_status"] in C.OPEN_STATUSES]
    rows = []
    for o in live:
        prob = round(min(0.97, abs(rng.gauss(0.28, 0.22))), 4)
        factors = rng.sample(_RISK_FACTORS, 4)
        rows.append({
            "order_id": str(o["id"]),
            "engine": "gemini",
            "probability": prob,
            "risk_level": "high" if prob >= 0.5 else ("medium" if prob >= 0.3 else "low"),
            "flagged": prob >= 0.5,
            "threshold": 0.5,
            "top_risk_factors": [
                {"feature": f, "value": why, "contribution": 0.0, "direction": dirn}
                for f, dirn, why in factors
            ],
            "gemini_explanation": (
                f"This order sits at {prob:.0%} cancellation risk, driven mainly by "
                f"{factors[0][0].replace('_', ' ')} and {factors[1][0].replace('_', ' ')}."
            ),
            "recommended_action": rng.choice(_ACTIONS),
            "restaurant_name": o["restaurant_name"],
            "zone_name": o["zone_name"],
            "predicted_at": predicted_at,
        })
    return rows
