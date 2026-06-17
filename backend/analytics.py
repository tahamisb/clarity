"""
Analytics query functions.

All functions run synchronous BigQuery queries via run_in_executor so they
don't block the FastAPI event loop.
"""

import asyncio
import logging

from bigquery_client import get_client, PROJECT, DATASET, TABLE_ID

logger = logging.getLogger(__name__)

T = f"`{TABLE_ID}`"
VK = f"`{PROJECT}.{DATASET}.vendor_kpi`"


def _run(sql: str) -> list[dict]:
    return [dict(row) for row in get_client().query(sql).result()]


# ---------------------------------------------------------------------------
# /analytics/summary
# ---------------------------------------------------------------------------

def _summary_sync() -> dict:
    overview = _run(f"""
        SELECT
          COUNT(*)                                                              AS total_calls,
          COUNTIF(sentiment = 'positive')                                       AS positive_calls,
          COUNTIF(sentiment = 'neutral')                                        AS neutral_calls,
          COUNTIF(sentiment = 'negative')                                       AS negative_calls,
          ROUND(SAFE_DIVIDE(COUNTIF(sentiment = 'negative'), COUNT(*)) * 100, 1) AS negative_pct
        FROM {T}
    """)[0]

    intent_dist = _run(f"""
        SELECT
          primary_intent,
          COUNT(*)                                                                    AS total,
          COUNTIF(sentiment = 'positive')                                             AS positive_count,
          COUNTIF(sentiment = 'neutral')                                              AS neutral_count,
          COUNTIF(sentiment = 'negative')                                             AS negative_count,
          ROUND(AVG(sentiment_confidence), 3)                                         AS avg_confidence
        FROM {T}
        GROUP BY primary_intent
        ORDER BY total DESC
    """)

    trend = _run(f"""
        SELECT
          FORMAT_TIMESTAMP('%G-W%V', analysed_at) AS week,
          COUNTIF(sentiment = 'positive')         AS positive,
          COUNTIF(sentiment = 'neutral')           AS neutral,
          COUNTIF(sentiment = 'negative')          AS negative,
          COUNT(*)                                 AS total
        FROM {T}
        WHERE analysed_at IS NOT NULL
        GROUP BY week
        ORDER BY week
    """)

    # Top topics use primary_intent as the grouping key since individual summaries
    # are unique per call. Rank by volume first, then by negative concentration.
    top_by_freq = _run(f"""
        SELECT
          primary_intent                                                              AS topic,
          COUNT(*)                                                                    AS volume,
          COUNTIF(sentiment = 'negative')                                             AS negative_count,
          ROUND(SAFE_DIVIDE(COUNTIF(sentiment='negative'), COUNT(*)) * 100, 1)       AS negative_pct,
          ROUND(AVG(sentiment_confidence), 3)                                         AS avg_confidence
        FROM {T}
        GROUP BY primary_intent
        ORDER BY volume DESC
        LIMIT 10
    """)

    top_by_neg = _run(f"""
        SELECT
          primary_intent                                                              AS topic,
          COUNT(*)                                                                    AS volume,
          COUNTIF(sentiment = 'negative')                                             AS negative_count,
          ROUND(SAFE_DIVIDE(COUNTIF(sentiment='negative'), COUNT(*)) * 100, 1)       AS negative_pct,
          ROUND(AVG(sentiment_confidence), 3)                                         AS avg_confidence
        FROM {T}
        GROUP BY primary_intent
        ORDER BY negative_pct DESC, volume DESC
        LIMIT 10
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


# ---------------------------------------------------------------------------
# /analytics/area-insights
# ---------------------------------------------------------------------------

def _area_insights_sync() -> dict:
    # Areas mentioned in transcripts (extracted entities)
    from_entities = _run(f"""
        SELECT
          area,
          COUNT(*)                                                                      AS total_calls,
          COUNTIF(ca.sentiment = 'negative')                                           AS negative_calls,
          ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1)     AS negative_pct,
          COUNTIF(ca.primary_intent = 'complaint')                                     AS complaints,
          COUNTIF(ca.primary_intent = 'delivery_issue')                                AS delivery_issues,
          COUNTIF(ca.primary_intent = 'refund_request')                                AS refund_requests
        FROM {T} ca,
        UNNEST(JSON_VALUE_ARRAY(ca.areas)) AS area
        WHERE area IS NOT NULL AND TRIM(area) != ''
        GROUP BY area
        ORDER BY total_calls DESC
        LIMIT 20
    """)

    # Zones from vendor_kpi matched via extracted order IDs
    from_orders = []
    try:
        from_orders = _run(f"""
            SELECT
              vk.customer_zone,
              COUNT(DISTINCT ca.call_id)                                                    AS support_calls,
              COUNTIF(ca.sentiment = 'negative')                                            AS negative_calls,
              ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1)      AS negative_pct,
              COUNTIF(ca.primary_intent = 'delivery_issue')                                 AS delivery_issues,
              COUNTIF(ca.primary_intent = 'complaint')                                      AS complaints,
              ROUND(AVG(vk.since_create_til_delivred_min), 1)                               AS avg_delivery_min,
              ROUND(AVG(vk.total_order_value), 2)                                            AS avg_order_value
            FROM {T} ca,
            UNNEST(JSON_VALUE_ARRAY(ca.order_ids)) AS order_id
            JOIN {VK} vk ON CAST(vk.id AS STRING) = order_id
            WHERE vk.customer_zone IS NOT NULL AND TRIM(vk.customer_zone) != ''
            GROUP BY vk.customer_zone
            ORDER BY support_calls DESC
            LIMIT 20
        """)
    except Exception as exc:
        logger.warning("Zone enrichment query skipped (no joined data yet?): %s", exc)

    return {
        "areas_from_transcripts": from_entities,
        "zones_from_orders": from_orders,
    }


async def get_area_insights() -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _area_insights_sync)


# ---------------------------------------------------------------------------
# /analytics/restaurant-insights
# ---------------------------------------------------------------------------

def _restaurant_insights_sync() -> dict:
    from_entities = _run(f"""
        SELECT
          restaurant,
          COUNT(*)                                                                      AS total_calls,
          COUNTIF(ca.sentiment = 'negative')                                           AS negative_calls,
          ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1)     AS negative_pct,
          COUNTIF(ca.primary_intent = 'complaint')                                     AS complaints,
          COUNTIF(ca.primary_intent = 'wrong_item')                                    AS wrong_items,
          COUNTIF(ca.primary_intent = 'delivery_issue')                                AS delivery_issues
        FROM {T} ca,
        UNNEST(JSON_VALUE_ARRAY(ca.restaurant_names)) AS restaurant
        WHERE restaurant IS NOT NULL AND TRIM(restaurant) != ''
        GROUP BY restaurant
        ORDER BY total_calls DESC
        LIMIT 20
    """)

    from_orders = []
    try:
        from_orders = _run(f"""
            SELECT
              vk.restaurant_name,
              vk.cuisine,
              COUNT(DISTINCT ca.call_id)                                                    AS support_calls,
              COUNTIF(ca.sentiment = 'negative')                                            AS negative_calls,
              ROUND(SAFE_DIVIDE(COUNTIF(ca.sentiment='negative'), COUNT(*)) * 100, 1)      AS negative_pct,
              COUNTIF(ca.primary_intent = 'complaint')                                      AS complaints,
              COUNTIF(ca.primary_intent = 'wrong_item')                                     AS wrong_items,
              COUNTIF(ca.primary_intent = 'delivery_issue')                                 AS delivery_issues,
              ROUND(AVG(vk.feedback_order_rating), 2)                                        AS avg_order_rating,
              ROUND(AVG(vk.feedback_delivery_rating), 2)                                     AS avg_delivery_rating
            FROM {T} ca,
            UNNEST(JSON_VALUE_ARRAY(ca.order_ids)) AS order_id
            JOIN {VK} vk ON CAST(vk.id AS STRING) = order_id
            WHERE vk.restaurant_name IS NOT NULL AND TRIM(vk.restaurant_name) != ''
            GROUP BY vk.restaurant_name, vk.cuisine
            ORDER BY support_calls DESC
            LIMIT 20
        """)
    except Exception as exc:
        logger.warning("Restaurant enrichment query skipped (no joined data yet?): %s", exc)

    return {
        "restaurants_from_transcripts": from_entities,
        "restaurants_from_orders": from_orders,
    }


async def get_restaurant_insights() -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _restaurant_insights_sync)
