"""
Pillar 01 analytics — all call_analysis query functions.
Mirrors the old analytics.py, now importing from bq_client.
"""

import asyncio
import json
import logging
import re

from app.config import get_settings
from app.services.bq_client import get_client

logger = logging.getLogger(__name__)


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
    # Arabic intro line:  خدمة عملاء رفيق، معك Fatima.
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


def _table_refs() -> tuple[str, str]:
    s = get_settings()
    p, d = s.gcp_project_id, s.bq_calls_dataset
    return f"`{p}.{d}.call_analysis`", f"`{p}.{d}.vendor_kpi`"


def _run(sql: str) -> list[dict]:
    return [dict(row) for row in get_client().query(sql).result()]


def _summary_sync() -> dict:
    T, _ = _table_refs()
    overview = _run(f"""
        SELECT COUNT(*) AS total_calls,
          COUNTIF(sentiment = 'positive') AS positive_calls,
          COUNTIF(sentiment = 'neutral')  AS neutral_calls,
          COUNTIF(sentiment = 'negative') AS negative_calls,
          ROUND(SAFE_DIVIDE(COUNTIF(sentiment = 'negative'), COUNT(*)) * 100, 1) AS negative_pct
        FROM {T}
    """)[0]

    intent_dist = _run(f"""
        SELECT primary_intent, COUNT(*) AS total,
          COUNTIF(sentiment = 'positive') AS positive_count,
          COUNTIF(sentiment = 'neutral')  AS neutral_count,
          COUNTIF(sentiment = 'negative') AS negative_count,
          ROUND(AVG(sentiment_confidence), 3) AS avg_confidence
        FROM {T} GROUP BY primary_intent ORDER BY total DESC
    """)

    trend = _run(f"""
        SELECT FORMAT_TIMESTAMP('%G-W%V', analysed_at) AS week,
          COUNTIF(sentiment = 'positive') AS positive,
          COUNTIF(sentiment = 'neutral')  AS neutral,
          COUNTIF(sentiment = 'negative') AS negative,
          COUNT(*) AS total
        FROM {T} WHERE analysed_at IS NOT NULL GROUP BY week ORDER BY week
    """)

    top_by_freq = _run(f"""
        SELECT primary_intent AS topic, COUNT(*) AS volume,
          COUNTIF(sentiment = 'negative') AS negative_count,
          ROUND(SAFE_DIVIDE(COUNTIF(sentiment='negative'), COUNT(*)) * 100, 1) AS negative_pct,
          ROUND(AVG(sentiment_confidence), 3) AS avg_confidence
        FROM {T} GROUP BY primary_intent ORDER BY volume DESC LIMIT 10
    """)

    top_by_neg = _run(f"""
        SELECT primary_intent AS topic, COUNT(*) AS volume,
          COUNTIF(sentiment = 'negative') AS negative_count,
          ROUND(SAFE_DIVIDE(COUNTIF(sentiment='negative'), COUNT(*)) * 100, 1) AS negative_pct,
          ROUND(AVG(sentiment_confidence), 3) AS avg_confidence
        FROM {T} GROUP BY primary_intent ORDER BY negative_pct DESC, volume DESC LIMIT 10
    """)

    return {
        "overview": overview,
        "intent_distribution": intent_dist,
        "sentiment_trend": trend,
        "top_topics_by_frequency": top_by_freq,
        "top_topics_by_negative_sentiment": top_by_neg,
    }


async def get_analytics_summary() -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _summary_sync)


def _area_insights_sync() -> dict:
    T, VK = _table_refs()

    from_entities = _run(f"""
        SELECT area, COUNT(*) AS total_calls,
          COUNTIF(ca.sentiment = 'negative') AS negative_calls,
          ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1) AS negative_pct,
          COUNTIF(ca.primary_intent = 'complaint')       AS complaints,
          COUNTIF(ca.primary_intent = 'delivery_issue')  AS delivery_issues,
          COUNTIF(ca.primary_intent = 'refund_request')  AS refund_requests
        FROM {T} ca, UNNEST(JSON_VALUE_ARRAY(ca.areas)) AS area
        WHERE area IS NOT NULL AND TRIM(area) != ''
        GROUP BY area ORDER BY total_calls DESC LIMIT 20
    """)

    from_orders = []
    try:
        from_orders = _run(f"""
            SELECT vk.customer_zone,
              COUNT(DISTINCT ca.call_id) AS support_calls,
              COUNTIF(ca.sentiment = 'negative') AS negative_calls,
              ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1) AS negative_pct,
              COUNTIF(ca.primary_intent = 'delivery_issue') AS delivery_issues,
              COUNTIF(ca.primary_intent = 'complaint')      AS complaints,
              ROUND(AVG(vk.since_create_til_delivred_min), 1) AS avg_delivery_min,
              ROUND(AVG(vk.total_order_value), 2) AS avg_order_value
            FROM {T} ca, UNNEST(JSON_VALUE_ARRAY(ca.order_ids)) AS order_id
            JOIN {VK} vk ON CAST(vk.id AS STRING) = order_id
            WHERE vk.customer_zone IS NOT NULL AND TRIM(vk.customer_zone) != ''
            GROUP BY vk.customer_zone ORDER BY support_calls DESC LIMIT 20
        """)
    except Exception as exc:
        logger.warning("Zone enrichment query skipped: %s", exc)

    return {"areas_from_transcripts": from_entities, "zones_from_orders": from_orders}


async def get_area_insights() -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _area_insights_sync)


def _restaurant_insights_sync() -> dict:
    T, VK = _table_refs()

    from_entities = _run(f"""
        SELECT restaurant, COUNT(*) AS total_calls,
          COUNTIF(ca.sentiment = 'negative') AS negative_calls,
          ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1) AS negative_pct,
          COUNTIF(ca.primary_intent = 'complaint')      AS complaints,
          COUNTIF(ca.primary_intent = 'wrong_item')     AS wrong_items,
          COUNTIF(ca.primary_intent = 'delivery_issue') AS delivery_issues
        FROM {T} ca, UNNEST(JSON_VALUE_ARRAY(ca.restaurant_names)) AS restaurant
        WHERE restaurant IS NOT NULL AND TRIM(restaurant) != ''
        GROUP BY restaurant ORDER BY total_calls DESC LIMIT 20
    """)

    from_orders = []
    try:
        from_orders = _run(f"""
            SELECT vk.restaurant_name, vk.cuisine,
              COUNT(DISTINCT ca.call_id) AS support_calls,
              COUNTIF(ca.sentiment = 'negative') AS negative_calls,
              ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1) AS negative_pct,
              COUNTIF(ca.primary_intent = 'complaint')      AS complaints,
              COUNTIF(ca.primary_intent = 'wrong_item')     AS wrong_items,
              COUNTIF(ca.primary_intent = 'delivery_issue') AS delivery_issues,
              ROUND(AVG(vk.feedback_order_rating), 2)    AS avg_order_rating,
              ROUND(AVG(vk.feedback_delivery_rating), 2) AS avg_delivery_rating
            FROM {T} ca, UNNEST(JSON_VALUE_ARRAY(ca.order_ids)) AS order_id
            JOIN {VK} vk ON CAST(vk.id AS STRING) = order_id
            WHERE vk.restaurant_name IS NOT NULL AND TRIM(vk.restaurant_name) != ''
            GROUP BY vk.restaurant_name, vk.cuisine ORDER BY support_calls DESC LIMIT 20
        """)
    except Exception as exc:
        logger.warning("Restaurant enrichment query skipped: %s", exc)

    return {"restaurants_from_transcripts": from_entities, "restaurants_from_orders": from_orders}


async def get_restaurant_insights() -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _restaurant_insights_sync)


# ---------------------------------------------------------------------------
# Paginated call list
# ---------------------------------------------------------------------------

def _get_calls_sync(page: int, page_size: int) -> dict:
    T, _ = _table_refs()
    offset = (page - 1) * page_size

    count_row = _run(f"SELECT COUNT(*) AS total FROM {T}")[0]
    total = int(count_row["total"])

    rows = _run(f"""
        SELECT
          call_id, transcript, intents, primary_intent, sentiment,
          sentiment_confidence, order_ids, restaurant_names, areas,
          product_names, qar_amounts, summary,
          CAST(analysed_at AS STRING) AS analysed_at
        FROM {T}
        ORDER BY analysed_at DESC
        LIMIT {page_size} OFFSET {offset}
    """)

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
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_calls_sync, page, page_size)
