"""
Pillar 01 analytics — all call_analysis query functions, over the local warehouse.
"""

import asyncio
import json
import logging
import re
import time

from app.services import local_db as db
from app.services.local_db import countif, safe_divide
from app.services.verticals import merchant_cte, vertical_case

logger = logging.getLogger(__name__)

# A call's vertical = vertical of the first merchant named in it (resolved
# through the mv merchant→platform map; no merchant → 'Other').
_VERTICAL = vertical_case("mv.platform")
_CALL_MV_JOIN = "LEFT JOIN mv ON json_extract(ca.restaurant_names, '$[0]') = mv.merchant_name"
_MV_WITH = f"WITH {merchant_cte('vendor_kpi')}\n"


# ---------------------------------------------------------------------------
# TTL cache — these aggregates scan the full call_analysis table and the
# dashboard refetches them on every mount + auto-refresh tick. 5-min cache
# collapses repeat loads to one query.
# ponytail: copy of the cancellation_service cache; extract to a shared util
# if a third service needs it.
# ---------------------------------------------------------------------------

_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL_S = 300


async def _cached(key: str, make_coro):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _CACHE_TTL_S:
        return hit[1]
    value = await make_coro()
    _CACHE[key] = (now, value)
    return value


def clear_cache() -> None:
    _CACHE.clear()


# ---------------------------------------------------------------------------
# Transcript parsing helpers
# ---------------------------------------------------------------------------

def _extract_agent_name(transcript: str) -> str:
    """Pull the first agent name from English or Arabic transcript patterns."""
    if not transcript:
        return "—"
    # English:  Agent (Ahmed):
    m = re.search(r'Agent\s*\(([^)]+)\)', transcript, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Arabic labelled turns:  الموظف (Fatima):
    m = re.search(r'الموظف\s*\(([^)]+)\)', transcript)
    if m:
        return m.group(1).strip()
    # Arabic intro line:  خدمة عملاء Clarity، معك Fatima.
    m = re.search(r'معك\s+([^\.\n،،]+)', transcript)
    if m:
        return m.group(1).strip()
    return "—"


# Compiled speaker patterns — checked in order: English first, then Arabic
_AGENT_PATTERNS = [
    re.compile(r'^Agent\s*\([^)]+\):\s*', re.IGNORECASE),
    re.compile(r'^الموظف\s*\([^)]+\):\s*'),
]
_CUSTOMER_PATTERNS = [
    re.compile(r'^Customer\s*\([^)]+\):\s*', re.IGNORECASE),
    re.compile(r'^العميل\s*\([^)]+\):\s*'),
]


def _speaker_text(transcript: str, speaker: str) -> str:
    """Concatenate all dialogue turns belonging to a given speaker (agent or customer)."""
    patterns = _AGENT_PATTERNS if speaker == "agent" else _CUSTOMER_PATTERNS
    lines = transcript.split('\n')
    parts = []
    for line in lines:
        for pat in patterns:
            if pat.match(line):
                content = pat.sub('', line).strip()
                if content:
                    parts.append(content)
                break
    return ' '.join(parts).lower()


def _analyze_agent_helpfulness(transcript: str) -> str:
    """Rate how helpful the agent was based on their dialogue turns."""
    text = _speaker_text(transcript, 'agent')
    if not text:
        return "N/A"

    positive_kw = [
        "let me", "i can", "i'll", "i will", "here's", "happy to", "right away",
        "of course", "no problem", "appreciate", "sorted", "resolved", "applied",
        "processed", "immediately", "sure", "absolutely", "glad to", "allow me",
        "looking into", "check that", "help you", "fix that", "take care",
    ]
    negative_kw = [
        "cannot", "can't", "not possible", "unfortunately", "unable", "denied",
        "not allowed", "not available", "nothing i can do",
    ]

    pos = sum(1 for kw in positive_kw if kw in text)
    neg = sum(1 for kw in negative_kw if kw in text)
    score = pos - neg

    if score >= 5:
        return "Highly Helpful"
    elif score >= 2:
        return "Helpful"
    elif score >= 0:
        return "Neutral"
    else:
        return "Unhelpful"


def _analyze_customer_behavior(transcript: str) -> str:
    """Rate the customer's demeanour based on their dialogue turns."""
    text = _speaker_text(transcript, 'customer')
    if not text:
        return "N/A"

    angry_kw = [
        "ridiculous", "disgusting", "unacceptable", "outrageous", "furious",
        "terrible", "awful", "useless", "never again", "absolute joke",
    ]
    frustrated_kw = [
        "frustrated", "annoyed", "fed up", "still not", "keeps happening",
        "every time", "again and again", "waiting so long", "horrible",
    ]
    polite_kw = [
        "thank you", "thanks", "appreciate", "please", "great", "perfect",
        "wonderful", "fantastic", "awesome", "that's great", "happy",
    ]
    negative_kw = [
        "not working", "wrong", "issue", "problem", "complaint", "error",
        "missing", "late", "delay", "broken",
    ]

    angry_score = sum(1 for kw in angry_kw if kw in text)
    frustrated_score = sum(1 for kw in frustrated_kw if kw in text)
    polite_score = sum(1 for kw in polite_kw if kw in text)
    negative_score = sum(1 for kw in negative_kw if kw in text)

    if angry_score >= 1:
        return "Angry"
    elif frustrated_score >= 1 or negative_score >= 3:
        return "Frustrated"
    elif polite_score >= 2:
        return "Cooperative"
    elif polite_score == 1:
        return "Polite"
    else:
        return "Neutral"


def _topics_sql(order_by: str) -> str:
    return f"""
        {_MV_WITH}
        SELECT ca.primary_intent AS topic, COUNT(*) AS volume,
          {countif("ca.sentiment = 'negative'")} AS negative_count,
          ROUND({safe_divide(countif("ca.sentiment = 'negative'"), "COUNT(*)")} * 100, 1) AS negative_pct,
          ROUND(AVG(ca.sentiment_confidence), 3) AS avg_confidence,
          mode_value({_VERTICAL}) AS top_vertical
        FROM call_analysis ca {_CALL_MV_JOIN}
        GROUP BY ca.primary_intent ORDER BY {order_by} LIMIT 10
    """


def _summary_sync() -> dict:
    overview = db.query_one(f"""
        SELECT COUNT(*) AS total_calls,
          {countif("sentiment = 'positive'")} AS positive_calls,
          {countif("sentiment = 'neutral'")}  AS neutral_calls,
          {countif("sentiment = 'negative'")} AS negative_calls,
          ROUND({safe_divide(countif("sentiment = 'negative'"), "COUNT(*)")} * 100, 1) AS negative_pct
        FROM call_analysis
    """)

    intent_dist = db.query(f"""
        SELECT primary_intent, COUNT(*) AS total,
          {countif("sentiment = 'positive'")} AS positive_count,
          {countif("sentiment = 'neutral'")}  AS neutral_count,
          {countif("sentiment = 'negative'")} AS negative_count,
          ROUND(AVG(sentiment_confidence), 3) AS avg_confidence
        FROM call_analysis GROUP BY primary_intent ORDER BY total DESC
    """)

    trend = db.query(f"""
        SELECT iso_week(analysed_at) AS week,
          {countif("sentiment = 'positive'")} AS positive,
          {countif("sentiment = 'neutral'")}  AS neutral,
          {countif("sentiment = 'negative'")} AS negative,
          COUNT(*) AS total
        FROM call_analysis WHERE analysed_at IS NOT NULL GROUP BY week ORDER BY week
    """)

    top_by_freq = db.query(_topics_sql("volume DESC"))
    top_by_neg = db.query(_topics_sql("negative_pct DESC, volume DESC"))

    return {
        "overview": overview,
        "intent_distribution": intent_dist,
        "sentiment_trend": trend,
        "top_topics_by_frequency": top_by_freq,
        "top_topics_by_negative_sentiment": top_by_neg,
    }


async def get_analytics_summary() -> dict:
    async def make():
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _summary_sync)
    return await _cached("summary", make)


def _area_insights_sync() -> dict:
    from_entities = db.query(f"""
        SELECT a.value AS area, COUNT(*) AS total_calls,
          {countif("ca.sentiment = 'negative'")} AS negative_calls,
          ROUND({safe_divide(countif("ca.sentiment = 'negative'"), "COUNT(*)")} * 100, 1) AS negative_pct,
          {countif("ca.primary_intent = 'complaint'")}       AS complaints,
          {countif("ca.primary_intent = 'delivery_issue'")}  AS delivery_issues,
          {countif("ca.primary_intent = 'refund_request'")}  AS refund_requests
        FROM call_analysis ca, json_each(ca.areas) AS a
        WHERE a.value IS NOT NULL AND TRIM(a.value) != ''
        GROUP BY area ORDER BY total_calls DESC LIMIT 20
    """)

    from_orders = []
    try:
        from_orders = db.query(f"""
            SELECT vk.customer_zone,
              COUNT(DISTINCT ca.call_id) AS support_calls,
              {countif("ca.sentiment = 'negative'")} AS negative_calls,
              ROUND({safe_divide(countif("ca.sentiment = 'negative'"), "COUNT(*)")} * 100, 1) AS negative_pct,
              {countif("ca.primary_intent = 'delivery_issue'")} AS delivery_issues,
              {countif("ca.primary_intent = 'complaint'")}      AS complaints,
              ROUND(AVG(vk.since_create_til_delivred_min), 1) AS avg_delivery_min,
              ROUND(AVG(vk.total_order_value), 2) AS avg_order_value
            FROM call_analysis ca, json_each(ca.order_ids) AS o
            JOIN vendor_kpi vk ON CAST(vk.id AS TEXT) = o.value
            WHERE vk.customer_zone IS NOT NULL AND TRIM(vk.customer_zone) != ''
            GROUP BY vk.customer_zone ORDER BY support_calls DESC LIMIT 20
        """)
    except Exception as exc:
        logger.warning("Zone enrichment query skipped: %s", exc)

    return {"areas_from_transcripts": from_entities, "zones_from_orders": from_orders}


async def get_area_insights() -> dict:
    async def make():
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _area_insights_sync)
    return await _cached("area", make)


def _restaurant_insights_sync() -> dict:
    from_entities = db.query(f"""
        SELECT r.value AS restaurant, COUNT(*) AS total_calls,
          {countif("ca.sentiment = 'negative'")} AS negative_calls,
          ROUND({safe_divide(countif("ca.sentiment = 'negative'"), "COUNT(*)")} * 100, 1) AS negative_pct,
          {countif("ca.primary_intent = 'complaint'")}      AS complaints,
          {countif("ca.primary_intent = 'wrong_item'")}     AS wrong_items,
          {countif("ca.primary_intent = 'delivery_issue'")} AS delivery_issues
        FROM call_analysis ca, json_each(ca.restaurant_names) AS r
        WHERE r.value IS NOT NULL AND TRIM(r.value) != ''
        GROUP BY restaurant ORDER BY total_calls DESC LIMIT 20
    """)

    from_orders = []
    try:
        from_orders = db.query(f"""
            SELECT vk.restaurant_name, vk.cuisine,
              COUNT(DISTINCT ca.call_id) AS support_calls,
              {countif("ca.sentiment = 'negative'")} AS negative_calls,
              ROUND({safe_divide(countif("ca.sentiment = 'negative'"), "COUNT(*)")} * 100, 1) AS negative_pct,
              {countif("ca.primary_intent = 'complaint'")}      AS complaints,
              {countif("ca.primary_intent = 'wrong_item'")}     AS wrong_items,
              {countif("ca.primary_intent = 'delivery_issue'")} AS delivery_issues,
              ROUND(AVG(vk.feedback_order_rating), 2)    AS avg_order_rating,
              ROUND(AVG(vk.feedback_delivery_rating), 2) AS avg_delivery_rating
            FROM call_analysis ca, json_each(ca.order_ids) AS o
            JOIN vendor_kpi vk ON CAST(vk.id AS TEXT) = o.value
            WHERE vk.restaurant_name IS NOT NULL AND TRIM(vk.restaurant_name) != ''
            GROUP BY vk.restaurant_name, vk.cuisine ORDER BY support_calls DESC LIMIT 20
        """)
    except Exception as exc:
        logger.warning("Restaurant enrichment query skipped: %s", exc)

    return {"restaurants_from_transcripts": from_entities, "restaurants_from_orders": from_orders}


async def get_restaurant_insights() -> dict:
    async def make():
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _restaurant_insights_sync)
    return await _cached("restaurant", make)


# ---------------------------------------------------------------------------
# Paginated call list
# ---------------------------------------------------------------------------

def _get_calls_sync(page: int, page_size: int) -> dict:
    total = int(db.query_one("SELECT COUNT(*) AS total FROM call_analysis")["total"])

    rows = db.query(f"""
        {_MV_WITH}
        SELECT
          ca.call_id, ca.transcript, ca.intents, ca.primary_intent, ca.sentiment,
          ca.sentiment_confidence, ca.order_ids, ca.restaurant_names, ca.areas,
          ca.product_names, ca.qar_amounts, ca.summary,
          {_VERTICAL} AS vertical,
          ca.analysed_at
        FROM call_analysis ca {_CALL_MV_JOIN}
        ORDER BY ca.analysed_at DESC, ca.call_id
        LIMIT ? OFFSET ?
    """, (page_size, (page - 1) * page_size))

    items = []
    for row in rows:
        item = dict(row)
        for field in ("intents", "order_ids", "restaurant_names", "areas", "product_names", "qar_amounts"):
            raw = item.get(field)
            try:
                item[field] = json.loads(raw) if raw else []
            except (json.JSONDecodeError, TypeError):
                item[field] = []
        transcript = item.get("transcript") or ""
        item["agent_name"] = _extract_agent_name(transcript)
        item["agent_helpfulness"] = _analyze_agent_helpfulness(transcript)
        item["customer_behavior"] = _analyze_customer_behavior(transcript)
        items.append(item)

    return {"total": total, "items": items}


async def get_calls(page: int = 1, page_size: int = 200) -> dict:
    async def make():
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _get_calls_sync, page, page_size)
    return await _cached(f"calls:{page}:{page_size}", make)
