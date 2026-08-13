"""
Reference data and content corpus for the simulation.

Lifted verbatim from `backend/scripts/generate_mock_db.py` — the merchant list,
zones, cancellation reasons, bilingual message templates and call transcripts
are tuned Qatar-specific realism that took real effort to get right, and the
distributions downstream depend on their exact order and weights.

This is now the canonical copy. The backend script keeps its own, frozen: it
only rebuilds the legacy SQLite snapshot, which is being retired. The two are
allowed to drift because nothing checks them against each other — the Postgres
parity test loads the SQLite file directly (see load_sqlite.py) rather than
regenerating from these tables.

Additions beyond the original are marked; everything else is unchanged.
"""

from __future__ import annotations

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
        "arabic": True,
    },
]

AREAS = ZONES[:12]

# Per-template weights chosen so the corpus lands near the real support mix
# (~40% negative / ~35% neutral / ~25% positive) despite the negative templates
# outnumbering the rest three to one.
_SENTIMENT_WEIGHT = {"negative": 3, "neutral": 6, "positive": 6}
_MSG_WEIGHTS = [_SENTIMENT_WEIGHT[t[0]] for t in MESSAGE_TEMPLATES]
_CALL_WEIGHTS = [{"negative": 2, "neutral": 3, "positive": 4}[s["sentiment"]] for s in CALL_SCENARIOS]

# ---------------------------------------------------------------------------
# Added for the simulator (not in the original generator)
# ---------------------------------------------------------------------------

# Non-terminal statuses. An order in one of these is still in flight, which is
# what puts it in the live cancellation-risk queue.
OPEN_STATUSES = ("Accepted", "Preparing", "Ready for pickup", "Out for delivery")

# Hourly demand weights, pulled out of pick_hour() so the live ticker can use
# the same curve as an arrival RATE rather than only as a sampling weight.
HOUR_WEIGHTS = [3, 2, 1, 1, 1, 1, 2, 4, 6, 7, 8, 14, 18, 15, 9, 8, 10, 16, 22, 24, 18, 12, 8, 5]

CUSTOMER_FIRST_NAMES = ["Khalid", "Mariam", "Jassim", "Aisha", "Tariq", "Reem"]

CHAT_CHANNELS = ["app_chat", "whatsapp", "web_ticket"]
CHAT_LOCALES = ["en", "ar", "en-US", "ar-QA"]
MESSAGE_CHANNELS = ["app", "whatsapp", "ticket"]
MESSAGE_CHANNEL_WEIGHTS = [6, 3, 1]

CANCELLED_BY_INT = {"Vendor": 2, "Customer": 1, "Clarity Ops": 3, "Driver": 4}
