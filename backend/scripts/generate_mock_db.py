"""
Build the local SQLite warehouse that replaced BigQuery.

Synthesises every table the app used to read from BigQuery — orders, order
items, chats, calls, support messages, classifications, ground-truth labels and
cancellation predictions — with volumes, distributions and correlations chosen
so each dashboard renders the same shapes it did on live data.

The dataset ends on `clock.FROZEN_TODAY`; the app treats that day as "today",
so every calendar preset (WTD/MTD/QTD/YTD) lands on populated data forever.

Usage:
    cd backend
    python scripts/generate_mock_db.py            # rebuild data/clarity.db
    python scripts/generate_mock_db.py --orders 20000   # smaller/faster
"""

from __future__ import annotations

import argparse
import json
import random
import sqlite3
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.local_db import DB_PATH
from app.utils.clock import FROZEN_NOW, FROZEN_TODAY

RNG = random.Random(20260728)  # fixed seed → reproducible warehouse

START_DAY = date(2025, 1, 1)
END_DAY = FROZEN_TODAY
TOTAL_DAYS = (END_DAY - START_DAY).days + 1

DEFAULT_ORDERS = 60_000
MESSAGE_COUNT = 14_000
CALL_COUNT = 1_800
LABEL_COUNT = 400
LIVE_ORDERS = 600  # non-terminal orders on the final day → the live risk queue

# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

# (restaurant_name, platform_name, cuisine) — platform_name drives the vertical.
MERCHANTS = [
    ("Shawarma Time", "Restaurants", "Levantine"),
    ("Turkey Central", "Restaurants", "Turkish"),
    ("Al Aker Sweets", "Restaurants", "Desserts"),
    ("Layali Beirut", "Restaurants", "Lebanese"),
    ("Bait Al Mandi", "Restaurants", "Yemeni"),
    ("Chapati & Karak", "Restaurants", "Indian"),
    ("Burger Boutique", "Restaurants", "Burgers"),
    ("Sushi Yard", "Restaurants", "Japanese"),
    ("Pizza Nabil", "Restaurants", "Italian"),
    ("Tandoori Nights", "Restaurants", "Indian"),
    ("Damascus Gate", "Restaurants", "Syrian"),
    ("Golden Wok", "Restaurants", "Chinese"),
    ("Fahm Grill", "Restaurants", "Grills"),
    ("Wrap It Up", "Restaurants", "Fast Food"),
    ("Cafe Batteel", "Restaurants", "Bakery"),
    ("Kebab House Doha", "Restaurants", "Grills"),
    ("Manoushe Street", "Restaurants", "Lebanese"),
    ("Saffron Biryani", "Restaurants", "Indian"),
    ("Doha Poke Bar", "Restaurants", "Healthy"),
    ("Falafel Corner", "Restaurants", "Levantine"),
    ("Nasi Lemak Qatar", "Restaurants", "Malaysian"),
    ("Karam Beirut", "Restaurants", "Lebanese"),
    ("The Breakfast Club QA", "Restaurants", "Breakfast"),
    ("Zaatar w Zeit Doha", "Restaurants", "Lebanese"),
    ("Al Baik Express", "Restaurants", "Fast Food"),
    ("Grand Mart", "Grocery", "Supermarket"),
    ("Al Meera Express", "Grocery", "Supermarket"),
    ("LuLu Hypermarket", "Grocery", "Supermarket"),
    ("Family Food Centre", "Grocery", "Supermarket"),
    ("Quick Basket", "Grocery", "Convenience"),
    ("Fresh Souq", "Grocery", "Fresh Produce"),
    ("Dana Mini Mart", "Grocery", "Convenience"),
    ("Souq Waqif Spices", "Market", "Spices"),
    ("Doha Fish Market", "Market", "Seafood"),
    ("Green Farm Market", "Market", "Fresh Produce"),
    ("Qatar Dates House", "Market", "Dates"),
    ("Wellcare Pharmacy", "Health & Wellness", "Pharmacy"),
    ("Kulud Pharmacy", "Health & Wellness", "Pharmacy"),
    ("Vitamin Hub", "Health & Beauty", "Supplements"),
    ("Naseem Al Rabeeh", "Health & Wellness", "Clinic"),
    ("Stars Electronics", "The Stars", "Electronics"),
    ("Stars Home Living", "Stars", "Home"),
    ("Bloom & Bud", "Flowers", "Florist"),
    ("Petals Doha", "Flowers", "Florist"),
    ("Qatar Charity Meals", "Charity", "Meals"),
    ("Ehsan Food Bank", "Charity", "Meals"),
    ("Clarity Courier", "Last Mile Delivery", "Courier"),
    ("Swift Parcel QA", "Last Mile", "Courier"),
    ("Pet Planet", "Pets", "Pet Supplies"),
    ("Waggy Tails Store", "Pets", "Pet Supplies"),
    ("Fluffy Grooming", "Pet Grooming", "Grooming"),
    ("Doha Event Supplies", "Events", "Events"),
    ("Glow Salon", "Salons", "Beauty"),
    ("Barber Lounge", "Salons", "Beauty"),
    ("Outlet Bazaar", "OUTLET", "Retail"),
    ("Clarity Res", "Restaurants", "Internal"),   # internal test account
    ("TestNot", "Restaurants", "Internal"),      # internal test account
]

ZONES = [
    "West Bay", "Al Sadd", "The Pearl", "Lusail", "Al Wakrah", "Msheireb",
    "Al Rayyan", "Umm Salal", "Al Khor", "Al Gharrafa", "Ain Khaled",
    "Bin Mahmoud", "Al Waab", "Duhail", "Muaither", "Al Thumama",
    "Old Airport", "Education City",
]

# Zones with structurally worse operations — gives the heatmaps real contrast.
ZONE_RISK = {
    "Al Khor": 1.9, "Umm Salal": 1.6, "Al Wakrah": 1.45, "Muaither": 1.35,
    "Education City": 1.25, "The Pearl": 0.75, "West Bay": 0.8, "Msheireb": 0.85,
}

PAYMENT_TYPES = ["card", "cash", "wallet", "apple_pay", "online"]
DEVICE_TYPES = ["ios", "android", "web"]

# (reason, who cancelled, relative frequency) — a long tail, not a flat split, so
# the drivers report actually has something to rank.
CANCEL_REASONS = [
    ("Items out of stock at vendor", "Vendor", 16),
    ("Customer changed mind", "Customer", 12),
    ("Vendor not answering", "Vendor", 11),
    ("Ordered by mistake", "Customer", 10),
    ("No driver available", "Clarity Ops", 9),
    ("Delivery time too long", "Customer", 8),
    ("Vendor closed", "Vendor", 6),
    ("Wrong delivery address", "Customer", 5),
    ("Payment failed", "Clarity Ops", 5),
    ("Duplicate order", "Clarity Ops", 4),
    ("Customer unreachable", "Driver", 3),
    ("Area out of coverage", "Clarity Ops", 2),
]
_REASON_WEIGHTS = [r[2] for r in CANCEL_REASONS]

PRODUCTS = [
    ("Chicken Shawarma", "Sandwiches"), ("Mixed Grill Platter", "Grills"),
    ("Family Biryani", "Rice"), ("Margherita Pizza", "Pizza"),
    ("Karak Tea", "Beverages"), ("Fresh Orange Juice", "Beverages"),
    ("Hummus Bowl", "Starters"), ("Beef Burger Meal", "Burgers"),
    ("Salmon Sushi Set", "Sushi"), ("Chocolate Cake Slice", "Desserts"),
    ("Bottled Water 1.5L", "Beverages"), ("Basmati Rice 5kg", "Pantry"),
    ("Free Range Eggs", "Dairy"), ("Paracetamol 500mg", "Pharmacy"),
    ("Vitamin C 1000mg", "Supplements"), ("Rose Bouquet", "Flowers"),
    ("Cat Litter 10L", "Pet Supplies"), ("Falafel Wrap", "Sandwiches"),
]

AGENTS = [
    "Fatima Ezzahra", "Ahmed Nasser", "Layla Haddad", "Omar Siddiqui",
    "Noura Al Kuwari", "Rami Khalil", "Sara Mansour", "Yousef Aziz",
    "Hind Al Marri", "Bilal Rahman",
]

# ---------------------------------------------------------------------------
# Support-message corpus — (sentiment, intent, negative_trigger, text)
# Free-form triggers on purpose: the top-triggers query canonicalises synonyms.
# ---------------------------------------------------------------------------

MESSAGE_TEMPLATES = [
    ("negative", "complaint", "delayed delivery", "My order is 50 minutes late and still not here."),
    ("negative", "complaint", "late delivery", "Driver still hasn't arrived, it's been over an hour."),
    ("negative", "complaint", "severe delivery delay", "This is the third time my order is extremely late."),
    ("negative", "complaint", "order delay", "طلبي متأخر جدا ولا أحد يرد علي."),
    ("negative", "complaint", "food quality issue", "The food arrived completely cold and soggy."),
    ("negative", "complaint", "cold food", "Everything was cold by the time it reached me."),
    ("negative", "complaint", "stale food", "الأكل كان بايت وطعمه غريب."),
    ("negative", "complaint", "missing items", "Two items from my order are missing."),
    ("negative", "complaint", "incomplete order", "الطلب ناقص، ما وصلني المشروب."),
    ("negative", "complaint", "wrong item delivered", "I received a completely wrong item."),
    ("negative", "complaint", "incorrect order", "You sent me someone else's order."),
    ("negative", "complaint", "driver issue", "The driver was rude and refused to come up."),
    ("negative", "complaint", "rider behaviour", "السائق كان غير محترم أبدا."),
    ("negative", "complaint", "wrong delivery location", "The driver went to the wrong address again."),
    ("negative", "complaint", "address problem", "My location was clear but the order went elsewhere."),
    ("negative", "refund", "refund issue", "I still haven't received my refund after 8 days."),
    ("negative", "refund", "refund not processed", "لم يتم استرجاع مبلغي حتى الآن."),
    ("negative", "refund", "overcharged", "I was charged twice for the same order."),
    ("negative", "refund", "payment issue", "The payment went through but the order was never placed."),
    ("negative", "refund", "promo code failed", "My promo code was rejected at checkout."),
    ("negative", "refund", "coupon not applied", "الكوبون ما اشتغل مع إني مؤهل له."),
    ("negative", "complaint", "item unavailable", "Half the items were out of stock after I paid."),
    ("negative", "complaint", "order not received", "My order was marked delivered but never arrived."),
    ("negative", "cancellation_request", "order cancellation", "The vendor cancelled my order without telling me."),
    ("negative", "cancellation_request", "accidental cancellation", "My order got cancelled for no reason at all."),
    ("negative", "escalation", "unresolved complaint", "I've contacted support three times with no resolution."),
    ("neutral", "order_query", None, "Can you tell me where my order is right now?"),
    ("neutral", "order_query", None, "وين وصل طلبي؟"),
    ("neutral", "order_query", None, "How long until the driver arrives?"),
    ("neutral", "order_query", None, "Is the restaurant still open for delivery?"),
    ("neutral", "order_query", None, "Can I add one more item to my order?"),
    ("neutral", "order_query", None, "هل يمكن تغيير عنوان التوصيل؟"),
    ("neutral", "order_query", None, "Do you deliver to Lusail Marina after midnight?"),
    ("neutral", "cancellation_request", None, "I'd like to cancel my order please."),
    ("neutral", "cancellation_request", None, "أرغب في إلغاء الطلب."),
    ("neutral", "refund", None, "How do I request a refund for a missing item?"),
    ("neutral", "order_query", None, "Can I pay by card instead of cash?"),
    ("neutral", "order_query", None, "Please ask the driver to call when he arrives."),
    ("positive", "praise", None, "Delivery was super fast, thank you!"),
    ("positive", "praise", None, "الأكل وصل ساخن وبسرعة، شكرا لكم."),
    ("positive", "praise", None, "The driver was very polite and helpful."),
    ("positive", "praise", None, "Best service I've had from any app in Doha."),
    ("positive", "praise", None, "Order arrived early and everything was correct."),
    ("positive", "praise", None, "خدمة ممتازة، شكرا Clarity."),
    ("positive", "order_query", None, "Thanks for updating me, all sorted now."),
    ("positive", "refund", None, "Refund came through quickly, appreciated."),
]

# ---------------------------------------------------------------------------
# Call transcripts — the call list parses speaker turns out of these to derive
# agent name, agent helpfulness and customer behaviour, so the wording matters.
# ---------------------------------------------------------------------------

CALL_SCENARIOS = [
    {
        "intent": "delivery_issue", "sentiment": "negative", "confidence": 0.92,
        "customer": [
            "This is unacceptable, my order is two hours late!",
            "Every time I order from you this keeps happening.",
        ],
        "agent": [
            "I'm really sorry about that, let me check that for you right away.",
            "I can see the driver is 5 minutes away. I'll apply a QAR 20 credit immediately.",
        ],
        "summary": "Customer complained about a severely delayed delivery; agent applied a goodwill credit.",
    },
    {
        "intent": "refund_request", "sentiment": "negative", "confidence": 0.88,
        "customer": [
            "I want a refund, I was charged twice for one order.",
            "I'm frustrated, I've been waiting a week for this.",
        ],
        "agent": [
            "Of course, I can help you with that. Let me look into the duplicate charge.",
            "I've processed the refund now, it will be back within 3 working days.",
        ],
        "summary": "Duplicate charge reported; agent processed the refund on the call.",
    },
    {
        "intent": "wrong_item", "sentiment": "negative", "confidence": 0.85,
        "customer": [
            "You sent the wrong order, this is not what I paid for.",
            "It's the second time this week, honestly it's terrible.",
        ],
        "agent": [
            "I'm sorry about that, I'll fix that for you now.",
            "I've arranged a replacement and refunded the difference.",
        ],
        "summary": "Wrong item delivered; replacement arranged and difference refunded.",
    },
    {
        "intent": "order_status", "sentiment": "neutral", "confidence": 0.74,
        "customer": ["Hi, I just wanted to check where my order is."],
        "agent": [
            "Sure, let me check that for you. The driver has picked it up and is 8 minutes away.",
        ],
        "summary": "Routine order-status check; driver was en route.",
    },
    {
        "intent": "cancellation", "sentiment": "neutral", "confidence": 0.71,
        "customer": ["I'd like to cancel my order, I ordered by mistake."],
        "agent": [
            "No problem, I can do that for you. The order has been cancelled and refunded.",
        ],
        "summary": "Customer cancelled an accidental order; refund issued.",
    },
    {
        "intent": "praise", "sentiment": "positive", "confidence": 0.94,
        "customer": [
            "I just wanted to say thank you, the delivery was perfect and the driver was great.",
        ],
        "agent": ["That's wonderful to hear, I appreciate you calling in to tell us."],
        "summary": "Customer called to praise a fast delivery and a courteous driver.",
        "reason": "Unprompted praise for delivery speed and driver",
    },
    {
        "intent": "payment_issue", "sentiment": "negative", "confidence": 0.81,
        "customer": ["My card was declined but the money left my account."],
        "agent": [
            "I understand, let me check that. I can see a pending authorisation.",
            "I've raised it with the bank and it will drop off in 48 hours.",
        ],
        "summary": "Pending card authorisation after a declined payment; escalated to the bank.",
    },
    {
        "intent": "escalation", "sentiment": "negative", "confidence": 0.9,
        "customer": [
            "I want to speak to a manager, this is ridiculous.",
            "Nothing I can do here is working, nobody has called me back.",
        ],
        "agent": [
            "Unfortunately I cannot transfer you right now, but I will escalate this.",
            "I'm unable to override the policy, however a supervisor will call you today.",
        ],
        "summary": "Customer demanded escalation after repeated unresolved contacts.",
    },
    {
        "intent": "complaint", "sentiment": "negative", "confidence": 0.87,
        "customer": ["The food was cold and honestly disgusting, I couldn't eat it."],
        "agent": [
            "I'm sorry to hear that, let me take care of that for you.",
            "I've refunded the order in full and flagged it with the vendor.",
        ],
        "summary": "Food-quality complaint; full refund issued and vendor flagged.",
    },
    {
        "intent": "account_issue", "sentiment": "neutral", "confidence": 0.68,
        "customer": ["I can't log into my account, it says my number isn't registered."],
        "agent": ["Sure, I can help. I've reset the number on your profile now."],
        "summary": "Login failure caused by a stale phone number; profile reset.",
    },
    {
        "intent": "general_inquiry", "sentiment": "neutral", "confidence": 0.62,
        "customer": ["Do you deliver to Al Khor and what is the minimum order?"],
        "agent": ["Yes we do, and the minimum order for that zone is QAR 30."],
        "summary": "General coverage and minimum-order enquiry for Al Khor.",
    },
    {
        "intent": "delivery_issue", "sentiment": "negative", "confidence": 0.83,
        "customer": [
            "السائق راح لعنوان غلط والطلب ما وصلني.",
            "صار لي ساعة أنتظر وهذا شي مو مقبول.",
        ],
        "agent": [
            "أعتذر منك، خلني أشوف الموضوع حالا.",
            "تم إعادة توجيه السائق وأضفت لك رصيد اعتذار.",
        ],
        "summary": "Driver went to the wrong address; order re-routed and credit added.",
        "arabic": True,
    },
    {
        "intent": "praise", "sentiment": "positive", "confidence": 0.91,
        "customer": ["شكرا لكم، الطلب وصل بسرعة والخدمة رائعة."],
        "agent": ["يسعدنا سماع ذلك، شكرا لتواصلك معنا."],
        "summary": "Customer called to thank the team for a fast delivery.",
        "reason": "Unprompted thanks for a fast delivery",
        "arabic": True,
    },
]

AREAS = ZONES[:12]

# Per-template weights chosen so the corpus lands near the real support mix
# (~40% negative / ~35% neutral / ~25% positive) despite the negative templates
# outnumbering the rest three to one.
_SENTIMENT_WEIGHT = {"negative": 3, "neutral": 6, "positive": 6}
_MSG_WEIGHTS = [_SENTIMENT_WEIGHT[t[0]] for t in MESSAGE_TEMPLATES]

# Inbound CALL mix is weighted by intent, not by sentiment: people phone a
# food-delivery support line because something went wrong or they want a status.
# Almost nobody calls to say thank you — praise arrives via ratings and reviews,
# not the phone queue. Shares are percentages of all calls.
_CALL_INTENT_MIX = {
    "delivery_issue":  24,
    "order_status":    18,
    "wrong_item":      13,
    "refund_request":  12,
    "payment_issue":    9,
    "cancellation":     8,
    "complaint":        7,
    "account_issue":    5,
    "escalation":       3,
    "general_inquiry":  1,
    # Rare but real — kept non-zero so the positive-sentiment path still has data.
    "praise":           1,
}


def _call_weights() -> list[float]:
    """Split each intent's share evenly across the templates that carry it."""
    per_intent: dict[str, int] = {}
    for sc in CALL_SCENARIOS:
        per_intent[sc["intent"]] = per_intent.get(sc["intent"], 0) + 1
    return [_CALL_INTENT_MIX[sc["intent"]] / per_intent[sc["intent"]] for sc in CALL_SCENARIOS]


_CALL_WEIGHTS = _call_weights()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def day_weight(d: date) -> float:
    """Volume shape: weekend peak, Ramadan-ish dip, steady YoY growth."""
    w = 1.0 + 0.25 * (d.weekday() in (3, 4, 5))          # Thu–Sat busiest in Qatar
    w *= 1.0 + 0.30 * ((d - START_DAY).days / TOTAL_DAYS)  # growth over the period
    w *= 0.78 if (d.month == 3 and d.year == 2026) else 1.0
    return w


def pick_hour() -> int:
    """Order clock: lunch and dinner peaks, thin early morning."""
    return RNG.choices(
        range(24),
        weights=[3, 2, 1, 1, 1, 1, 2, 4, 6, 7, 8, 14, 18, 15, 9, 8, 10, 16, 22, 24, 18, 12, 8, 5],
    )[0]


def ts(d: date, hour: int, minute: int | None = None, second: int | None = None) -> str:
    minute = RNG.randrange(60) if minute is None else minute
    second = RNG.randrange(60) if second is None else second
    return f"{d.isoformat()} {hour:02d}:{minute:02d}:{second:02d}"


def weighted_day() -> date:
    """A random day in the period, weighted toward busier/more recent days."""
    while True:
        d = START_DAY + timedelta(days=RNG.randrange(TOTAL_DAYS))
        if RNG.random() < day_weight(d) / 1.7:
            return d


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

SCHEMA = """
DROP TABLE IF EXISTS vendor_kpi;
CREATE TABLE vendor_kpi (
    id INTEGER PRIMARY KEY, vendor_id INTEGER, customer_id INTEGER,
    order_status TEXT, order_placement_date TEXT, order_placement_time TEXT,
    total_order_value REAL, order_sub_total_value REAL, delivery_charge REAL,
    vendor_to_customer_dist REAL, driver_vendor_dist REAL,
    is_pre_order INTEGER, new_customer INTEGER, is_pro_user INTEGER,
    is_pro_vendor INTEGER, is_treasure INTEGER, is_discount INTEGER, used_coupon TEXT,
    payment_type TEXT, customer_device_type TEXT, platform_name TEXT, cuisine TEXT,
    zone_name TEXT, customer_zone TEXT, restaurant_name TEXT, location TEXT,
    clarity_time_to_accept_order_min REAL, vendor_to_accept_order_min REAL,
    preparing_time_min REAL, since_create_til_delivred_min REAL,
    cancel_comment TEXT, cancelled_by_txt TEXT, cancelled_by_int INTEGER,
    feedback_order_rating REAL, feedback_delivery_rating REAL, feedback_comment TEXT
);

DROP TABLE IF EXISTS vendor_items_kpi;
CREATE TABLE vendor_items_kpi (
    order_id INTEGER, product_name TEXT, cat_name TEXT, count INTEGER, total_value REAL
);

DROP TABLE IF EXISTS chat_history;
CREATE TABLE chat_history (
    chat_id INTEGER PRIMARY KEY, customer_id INTEGER, order_id INTEGER, type TEXT,
    device_id TEXT, locale TEXT, messages TEXT, created_at TEXT, closed_at TEXT,
    closed_by TEXT, is_phone_call INTEGER
);

DROP TABLE IF EXISTS call_analysis;
CREATE TABLE call_analysis (
    call_id TEXT PRIMARY KEY, transcript TEXT, intents TEXT, primary_intent TEXT,
    sentiment TEXT, sentiment_confidence REAL, order_ids TEXT, restaurant_names TEXT,
    areas TEXT, product_names TEXT, qar_amounts TEXT, summary TEXT, call_reason TEXT,
    analysed_at TEXT
);

DROP TABLE IF EXISTS messages;
CREATE TABLE messages (
    message_id TEXT PRIMARY KEY, customer_id TEXT, content TEXT, source_channel TEXT,
    merchant_name TEXT, zone TEXT, created_at TEXT, ingested_at TEXT,
    closed_at TEXT, agent_name TEXT
);

DROP TABLE IF EXISTS classifications;
CREATE TABLE classifications (
    classification_id TEXT PRIMARY KEY, message_id TEXT, sentiment TEXT,
    sentiment_confidence REAL, intent TEXT, intent_confidence REAL,
    negative_trigger TEXT, model_version TEXT, classified_at TEXT
);

DROP TABLE IF EXISTS labels;
CREATE TABLE labels (
    message_id TEXT PRIMARY KEY, true_sentiment TEXT, true_intent TEXT,
    labelled_by TEXT, labelled_at TEXT
);

DROP TABLE IF EXISTS skipped_chats;
CREATE TABLE skipped_chats (chat_id TEXT PRIMARY KEY, reason TEXT, skipped_at TEXT);

DROP TABLE IF EXISTS cancellation_predictions;
CREATE TABLE cancellation_predictions (
    order_id TEXT, engine TEXT, probability REAL, risk_level TEXT, flagged INTEGER,
    threshold REAL, top_risk_factors TEXT, gemini_explanation TEXT,
    recommended_action TEXT, restaurant_name TEXT, zone_name TEXT, predicted_at TEXT
);

CREATE INDEX idx_vk_date ON vendor_kpi(order_placement_date);
CREATE INDEX idx_vk_merchant ON vendor_kpi(restaurant_name);
CREATE INDEX idx_vk_status ON vendor_kpi(order_status);
CREATE INDEX idx_items_order ON vendor_items_kpi(order_id);
CREATE INDEX idx_msg_created ON messages(created_at);
CREATE INDEX idx_clf_msg ON classifications(message_id);
CREATE INDEX idx_chat_order ON chat_history(order_id);
CREATE INDEX idx_pred_order ON cancellation_predictions(order_id, engine);
"""


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

def gen_orders(n: int) -> tuple[list[tuple], list[tuple]]:
    """Orders + their line items. Cancellation risk varies by zone, vertical,
    hour and merchant so every cancellation breakdown has real signal."""
    merchant_bias = {m[0]: RNG.uniform(0.55, 1.9) for m in MERCHANTS}
    merchant_bias["Clarity Res"] = 14.0   # internal test accounts cancel constantly
    merchant_bias["TestNot"] = 16.0
    vendor_ids = {m[0]: 1000 + i for i, m in enumerate(MERCHANTS)}

    days = [START_DAY + timedelta(days=i) for i in range(TOTAL_DAYS)]
    weights = [day_weight(d) for d in days]
    order_days = RNG.choices(days, weights=weights, k=n - LIVE_ORDERS)
    order_days.sort()
    order_days += [END_DAY] * LIVE_ORDERS  # final-day, still-in-flight orders

    orders, items = [], []
    for i, d in enumerate(order_days):
        oid = 500000 + i
        live = i >= n - LIVE_ORDERS
        name, platform, cuisine = RNG.choice(MERCHANTS)
        zone = RNG.choice(ZONES)
        cust_zone = zone if RNG.random() < 0.8 else RNG.choice(ZONES)
        hour = pick_hour() if not live else RNG.randrange(18, 22)

        subtotal = round(RNG.lognormvariate(3.9, 0.55), 2)
        delivery = RNG.choice([0, 5, 7, 10, 12])
        total = round(subtotal + delivery, 2)

        risk = 0.055
        risk *= ZONE_RISK.get(zone, 1.0)
        risk *= merchant_bias[name]
        risk *= 1.6 if hour >= 22 or hour < 6 else 1.0     # late-night ops thin out
        risk *= 1.25 if platform in ("Grocery", "Market") else 1.0
        risk *= 1.3 if subtotal > 220 else 1.0
        risk *= 1.35 if d.weekday() in (4, 5) else 1.0

        if live:
            status = RNG.choice(["Accepted", "Preparing", "Ready for pickup", "Out for delivery"])
        elif RNG.random() < min(risk, 0.85):
            status = "Cancelled"
        else:
            status = "Delivered"

        cancelled = status == "Cancelled"
        reason, actor, _ = (
            RNG.choices(CANCEL_REASONS, weights=_REASON_WEIGHTS)[0] if cancelled
            else (None, None, None)
        )
        delivered = status == "Delivered"

        orders.append((
            oid, vendor_ids[name], 200000 + RNG.randrange(45000), status,
            d.isoformat(), f"{hour:02d}:{RNG.randrange(60):02d}:{RNG.randrange(60):02d}",
            total, subtotal, float(delivery),
            round(RNG.uniform(0.4, 18.0), 2), round(RNG.uniform(0.2, 9.0), 2),
            int(RNG.random() < 0.06), int(RNG.random() < 0.18), int(RNG.random() < 0.22),
            int(RNG.random() < 0.3), int(RNG.random() < 0.05), int(RNG.random() < 0.25),
            RNG.choice([None, None, None, "WELCOME10", "CLARITY25", "FREEDEL"]),
            RNG.choice(PAYMENT_TYPES), RNG.choice(DEVICE_TYPES), platform, cuisine,
            zone, cust_zone, name, f"{zone}, Doha",
            round(RNG.uniform(0.2, 6.0), 1), round(RNG.uniform(0.5, 12.0), 1),
            round(RNG.uniform(6, 42), 1),
            round(RNG.uniform(22, 95), 1) if delivered else None,
            f"{reason} // ref-{oid}" if cancelled else None,
            actor, {"Vendor": 2, "Customer": 1, "Clarity Ops": 3, "Driver": 4}.get(actor or "", None),
            float(RNG.randint(3, 5)) if delivered and RNG.random() < 0.4 else None,
            float(RNG.randint(3, 5)) if delivered and RNG.random() < 0.35 else None,
            RNG.choice(["Great service", "Food was cold", "Fast delivery", None])
            if delivered and RNG.random() < 0.15 else None,
        ))

        for _ in range(RNG.randint(1, 4)):
            product, cat = RNG.choice(PRODUCTS)
            qty = RNG.randint(1, 3)
            items.append((oid, product, cat, qty, round(qty * RNG.uniform(8, 65), 2)))

    return orders, items


def gen_chats(orders: list[tuple], count: int) -> list[tuple]:
    """Support chats, ~1 per 8 orders, linked to an order so the CX contact-rate
    metric has something to divide by. Only 2026 onward (matching chat coverage)."""
    pool = [o for o in orders if o[4] >= "2026-01-01"]
    rows = []
    for i in range(count):
        o = RNG.choice(pool)
        d = date.fromisoformat(o[4])
        hour = int(o[5][:2])
        # chat opens shortly after the order; stored UTC while orders are Qatar local
        opened = datetime.combine(d, datetime.min.time()) + timedelta(
            hours=hour - 3, minutes=RNG.randint(2, 90)
        )
        closed = opened + timedelta(minutes=RNG.randint(3, 400))
        closed_by = RNG.choice(AGENTS) if RNG.random() < 0.42 else RNG.choice(["cron", "customer", "bot"])
        rows.append((
            900000 + i, o[2], o[0],
            RNG.choice(["app_chat", "whatsapp", "web_ticket"]),
            f"dev-{RNG.randrange(99999)}" if RNG.random() < 0.8 else None,
            RNG.choice(["en", "ar", "en-US", "ar-QA"]),
            json.dumps([{"from": "customer", "text": RNG.choice(MESSAGE_TEMPLATES)[3]}]),
            opened.strftime("%Y-%m-%d %H:%M:%S"), closed.strftime("%Y-%m-%d %H:%M:%S"),
            closed_by, 0,
        ))
    return rows


def gen_messages(count: int) -> tuple[list[tuple], list[tuple], list[tuple]]:
    """Support messages + their Gemini classifications + a labelled sample."""
    messages, classifications = [], []
    for i in range(count):
        sentiment, intent, trigger, text = RNG.choices(MESSAGE_TEMPLATES, weights=_MSG_WEIGHTS)[0]
        d = weighted_day()
        hour = pick_hour()
        created = ts(d, hour)
        mid = f"msg-{i:06d}"
        channel = RNG.choices(["app", "whatsapp", "ticket"], weights=[6, 3, 1])[0]

        # Handling time: tickets run long, chats short — a slice of each breaches SLA.
        base = RNG.uniform(0.2, 3.5) if channel != "ticket" else RNG.uniform(2, 20)
        if RNG.random() < 0.14:
            base *= RNG.uniform(2.5, 6)
        # Only conversations from the last few days can still be open — otherwise a
        # 2025 message would show up as a 500-day SLA breach.
        recent = (END_DAY - d).days <= 3
        closed = None if (recent and RNG.random() < 0.35) else (
            datetime.fromisoformat(created) + timedelta(hours=base)
        ).strftime("%Y-%m-%d %H:%M:%S")
        agent = RNG.choice(AGENTS) if RNG.random() < 0.22 else None
        merchant = RNG.choice(MERCHANTS)[0]

        messages.append((
            mid, str(200000 + RNG.randrange(45000)), text, channel, merchant,
            RNG.choice(ZONES), created,
            (datetime.fromisoformat(created) + timedelta(minutes=RNG.randint(1, 30)))
            .strftime("%Y-%m-%d %H:%M:%S"),
            closed, agent,
        ))
        classifications.append((
            f"clf-{i:06d}", mid, sentiment, round(RNG.uniform(0.68, 0.99), 3),
            intent, round(RNG.uniform(0.6, 0.98), 3),
            trigger if sentiment == "negative" else None,
            "gemini-3.1-flash-lite",
            (datetime.fromisoformat(created) + timedelta(minutes=RNG.randint(2, 45)))
            .strftime("%Y-%m-%d %H:%M:%S"),
        ))

    # Ground truth for the accuracy endpoint — mostly agreeing with the model.
    by_message = {c[1]: c for c in classifications}
    labels = []
    for mid, _, _, _, _, _, created, *_ in RNG.sample(messages, LABEL_COUNT):
        clf = by_message[mid]
        agree_s = RNG.random() < 0.89
        agree_i = RNG.random() < 0.84
        labels.append((
            mid,
            clf[2] if agree_s else RNG.choice([s for s in ("positive", "neutral", "negative") if s != clf[2]]),
            clf[4] if agree_i else RNG.choice(
                [i for i in ("complaint", "refund", "order_query", "cancellation_request", "praise")
                 if i != clf[4]]
            ),
            "cx_qa_team", created,
        ))
    return messages, classifications, labels


# The order gen_calls() emits. Named explicitly in the INSERT because the column
# can be appended by migration rather than sitting where the schema literal puts it.
CALL_COLUMNS = [
    "call_id", "transcript", "intents", "primary_intent", "sentiment",
    "sentiment_confidence", "order_ids", "restaurant_names", "areas",
    "product_names", "qar_amounts", "summary", "call_reason", "analysed_at",
]

# Not every unhappy-path call is an angry one — plenty of people ring up about a
# late order perfectly calmly, and a routine status check can turn sour. Without
# this the corpus is a deterministic intent→sentiment lookup (~68% negative).
_SENTIMENT_DRIFT = {
    "negative": [("negative", 0.72), ("neutral", 0.28)],
    "neutral":  [("neutral", 0.78), ("negative", 0.19), ("positive", 0.03)],
    "positive": [("positive", 0.94), ("neutral", 0.06)],
}


def drift_sentiment(base: str) -> str:
    options = _SENTIMENT_DRIFT[base]
    return RNG.choices([o[0] for o in options], weights=[o[1] for o in options])[0]


# Same derivation the API applies to live analyses, so seeded rows and analysed
# rows are indistinguishable downstream.
from app.services.call_service import derive_reason  # noqa: E402


def gen_calls(orders: list[tuple], count: int) -> list[tuple]:
    recent = [o for o in orders if o[4] >= "2026-01-01"]
    rows = []
    for i in range(count):
        sc = RNG.choices(CALL_SCENARIOS, weights=_CALL_WEIGHTS)[0]
        agent = RNG.choice(AGENTS)
        customer = RNG.choice(["Khalid", "Mariam", "Jassim", "Aisha", "Tariq", "Reem"])
        arabic = sc.get("arabic", False)
        a_tag, c_tag = ("الموظف", "العميل") if arabic else ("Agent", "Customer")

        lines = []
        if arabic:
            lines.append(f"{a_tag} ({agent}): خدمة عملاء Clarity، معك {agent}.")
        else:
            lines.append(f"{a_tag} ({agent}): Clarity customer service, {agent} speaking.")
        for j in range(max(len(sc["customer"]), len(sc["agent"]))):
            if j < len(sc["customer"]):
                lines.append(f"{c_tag} ({customer}): {sc['customer'][j]}")
            if j < len(sc["agent"]):
                lines.append(f"{a_tag} ({agent}): {sc['agent'][j]}")

        order = RNG.choice(recent)
        d = date.fromisoformat(order[4])
        sentiment = drift_sentiment(sc["sentiment"])
        rows.append((
            str(uuid.uuid4()), "\n".join(lines),
            json.dumps([sc["intent"]] + ([RNG.choice(["complaint", "escalation"])]
                                         if RNG.random() < 0.25 else [])),
            sc["intent"], sentiment,
            # A drifted label is a less clear-cut read than the template's own.
            round(sc["confidence"] if sentiment == sc["sentiment"]
                  else max(0.55, sc["confidence"] - RNG.uniform(0.08, 0.18)), 2),
            json.dumps([str(order[0])] if RNG.random() < 0.75 else []),
            json.dumps([order[24]]),
            json.dumps(RNG.sample(AREAS, RNG.randint(1, 2))),
            json.dumps([RNG.choice(PRODUCTS)[0] for _ in range(RNG.randint(0, 2))]),
            json.dumps([str(round(RNG.uniform(15, 250), 2))] if RNG.random() < 0.4 else []),
            sc["summary"], sc.get("reason") or derive_reason("", sc["summary"], sc["intent"]),
            ts(d, pick_hour()),
        ))
    return rows


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


def gen_predictions(orders: list[tuple]) -> list[tuple]:
    """Pre-scored risk for the live (non-terminal) orders. Seeding these means the
    live-queue endpoint reads through its cache and never calls Gemini."""
    live = [o for o in orders if o[3] in ("Accepted", "Preparing", "Ready for pickup", "Out for delivery")]
    rows = []
    for o in live:
        prob = round(min(0.97, abs(RNG.gauss(0.28, 0.22))), 4)
        level = "high" if prob >= 0.5 else ("medium" if prob >= 0.3 else "low")
        factors = RNG.sample(_RISK_FACTORS, 4)
        rows.append((
            str(o[0]), "gemini", prob, level, int(prob >= 0.5), 0.5,
            json.dumps([{"feature": f, "value": why, "contribution": 0.0, "direction": dirn}
                        for f, dirn, why in factors]),
            f"This order sits at {prob:.0%} cancellation risk, driven mainly by "
            f"{factors[0][0].replace('_', ' ')} and {factors[1][0].replace('_', ' ')}.",
            RNG.choice(_ACTIONS), o[24], o[22], FROZEN_NOW.strftime("%Y-%m-%d %H:%M:%S"),
        ))
    return rows


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build(order_count: int) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Rebuilt in place (SCHEMA drops every table first) rather than by deleting the
    # file — a running API server holds it open, and WAL lets us write past its readers.
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.executescript(SCHEMA)

    print(f"Generating {order_count:,} orders…")
    orders, items = gen_orders(order_count)
    conn.executemany(f"INSERT INTO vendor_kpi VALUES ({','.join('?' * 36)})", orders)
    conn.executemany("INSERT INTO vendor_items_kpi VALUES (?,?,?,?,?)", items)

    print("Generating chats…")
    conn.executemany(
        "INSERT INTO chat_history VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        gen_chats(orders, order_count // 8),
    )

    print(f"Generating {MESSAGE_COUNT:,} support messages…")
    messages, classifications, labels = gen_messages(MESSAGE_COUNT)
    conn.executemany("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?)", messages)
    conn.executemany("INSERT INTO classifications VALUES (?,?,?,?,?,?,?,?,?)", classifications)
    conn.executemany("INSERT INTO labels VALUES (?,?,?,?,?)", labels)

    print(f"Generating {CALL_COUNT:,} analysed calls…")
    conn.executemany(
        f"INSERT INTO call_analysis ({', '.join(CALL_COLUMNS)}) "
        f"VALUES ({','.join('?' * len(CALL_COLUMNS))})", gen_calls(orders, CALL_COUNT)
    )

    preds = gen_predictions(orders)
    print(f"Generating {len(preds):,} cancellation predictions…")
    conn.executemany(f"INSERT INTO cancellation_predictions VALUES ({','.join('?' * 12)})", preds)

    conn.commit()
    conn.execute("ANALYZE")
    conn.close()

    size_mb = DB_PATH.stat().st_size / 1024 / 1024
    print(f"\nWrote {DB_PATH} ({size_mb:.1f} MB) - data runs {START_DAY} to {END_DAY}.")


# ---------------------------------------------------------------------------
# Artifacts — the exploration JSONs and the drivers report the Cancellations
# page serves. Rebuilt from the warehouse so they can't describe data that
# isn't there. The report is templated from the real aggregates rather than
# generated by Gemini: deterministic, free, and always consistent.
# ---------------------------------------------------------------------------

_DRIVER_RECOMMENDATIONS = {
    "Items out of stock at vendor": "Mandate real-time stock sync for the top grocery and market partners, and offer substitutions at checkout instead of cancelling.",
    "Vendor not answering": "Auto-page vendors that haven't accepted within 5 minutes, and pause merchants after two consecutive non-responses.",
    "Vendor closed": "Reconcile listed opening hours against actual accept behaviour weekly and auto-hide vendors that miss their own window.",
    "Customer changed mind": "Show a live prep/ETA bar from the moment of ordering — most change-of-mind cancels land in the first five minutes.",
    "Ordered by mistake": "Add a 10-second grace window and a duplicate-order prompt when the same basket is re-submitted.",
    "Delivery time too long": "Cap promised ETAs per zone at the p80 actual, and surface a courier-shortage banner before checkout.",
    "No driver available": "Pre-position couriers in the late-night zones and raise incentives before the 22:00 supply dip, not after it.",
    "Duplicate order": "Deduplicate identical baskets from the same customer inside a 5-minute window at the API layer.",
    "Wrong delivery address": "Force an address confirmation step for first-time drop-off points and pin-drop verification outside mapped zones.",
    "Payment failed": "Retry the authorisation once before cancelling, and fall back to cash-on-delivery where the zone allows it.",
    "Area out of coverage": "Stop accepting orders outside the served polygon at checkout rather than cancelling them post-payment.",
    "Customer unreachable": "Trigger an in-app call plus SMS at arrival, and hold the order at the hub for 30 minutes before cancelling.",
}


def write_artifacts() -> None:
    from app.services import cancellation_service as svc

    written = svc.write_exploration_artifacts()
    print(f"Wrote {len(written)} exploration artifacts.")

    trend = svc._trend_sync()["monthly"]
    reasons = svc._by_reason_sync()
    zones = svc._by_zone_sync()["by_zone_name"]
    buckets = svc._by_time_sync()
    verticals = svc._by_vertical_sync()

    total = sum(r["total_orders"] for r in trend)
    cancelled = sum(r["cancelled"] for r in trend)
    rate = round(cancelled / total * 100, 2) if total else 0.0
    recent = [r["cancel_rate_pct"] for r in trend[-6:]]
    direction = "easing" if recent and recent[-1] < max(recent) else "climbing"

    # Aggregate the stated reasons across actors — one driver per root cause.
    by_reason: dict[str, int] = {}
    for r in reasons:
        by_reason[r["reason"]] = by_reason.get(r["reason"], 0) + r["cancellations"]
    ranked = sorted(by_reason.items(), key=lambda kv: -kv[1])[:10]
    top_n = ranked[0][1] if ranked else 1

    worst_bucket = max(buckets, key=lambda b: b["cancel_rate_pct"]) if buckets else None
    worst_zones = sorted(zones, key=lambda z: -z["cancel_rate_pct"])[:3]
    worst_vertical = max(verticals, key=lambda v: v["cancel_rate_pct"]) if verticals else None

    segments = [{
        "segment": f"{z['zone']} ({z['vertical'] or 'mixed'})",
        "cancel_rate": z["cancel_rate_pct"],
        "recommendation": f"Audit courier supply and vendor accept times in {z['zone']}; "
                          f"it runs {round(z['cancel_rate_pct'] - rate, 2)} points above the platform average.",
    } for z in worst_zones]
    if worst_bucket:
        segments.append({
            "segment": f"{worst_bucket['time_bucket']} orders, all zones",
            "cancel_rate": worst_bucket["cancel_rate_pct"],
            "recommendation": f"{worst_bucket['time_bucket']} is the weakest slot of the day — "
                              "staff couriers to it before raising vendor targets.",
        })
    if worst_vertical:
        segments.append({
            "segment": f"{worst_vertical['vertical']} vertical",
            "cancel_rate": worst_vertical["cancel_rate_pct"],
            "recommendation": f"{worst_vertical['vertical']} cancels most often; start with stock accuracy "
                              "at its highest-volume merchants.",
        })

    report = {
        "executive_summary": (
            f"Across {total:,} orders the platform cancelled {cancelled:,} of them — a {rate}% cancellation "
            f"rate, and the trend is {direction}. The largest single addressable driver is "
            f"\"{ranked[0][0].lower()}\" at {ranked[0][1]:,} cancellations "
            f"({round(ranked[0][1] / cancelled * 100, 1)}% of all cancellations). "
            f"The steepest concentration is {worst_bucket['time_bucket'].lower() if worst_bucket else 'late night'} "
            f"orders in {worst_zones[0]['zone'] if worst_zones else 'the outer zones'}, where supply, not demand, "
            "is the binding constraint."
        ),
        "top_drivers": [{
            "name": reason,
            "importance": round(count / top_n, 2),
            "explanation": f"Recorded on {count:,} cancelled orders "
                           f"({round(count / cancelled * 100, 1)}% of all cancellations).",
            "recommendation": _DRIVER_RECOMMENDATIONS.get(
                reason, "Review the operational path behind this reason with the zone supervisors."
            ),
        } for reason, count in ranked],
        "high_risk_segments": segments[:5],
        "trend_insight": (
            f"Monthly cancellation rate over the last six months: "
            f"{', '.join(f'{v}%' for v in recent)}. The rate is {direction} while order volume grows, "
            "so the remaining cancellations are concentrated causes rather than broad degradation."
        ),
        "generated_at": FROZEN_NOW.isoformat(),
    }
    svc.REPORT_PATH.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"Wrote {svc.REPORT_PATH.name} ({len(ranked)} drivers, {len(segments[:5])} segments).")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--orders", type=int, default=DEFAULT_ORDERS)
    ap.add_argument("--skip-artifacts", action="store_true",
                    help="Only rebuild the database, leave artifacts/ alone.")
    args = ap.parse_args()
    build(args.orders)
    if not args.skip_artifacts:
        write_artifacts()


if __name__ == "__main__":
    main()
