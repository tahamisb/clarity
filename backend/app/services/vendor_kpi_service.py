"""
Pre-aggregated analytics from long-ceiling-343505.reports.vendor_kpi.
All functions return compact summaries — never raw rows — to keep token cost low.
"""

import asyncio
import logging

from app.config import get_settings
from app.services.bq_client import get_client

logger = logging.getLogger(__name__)


def _T() -> str:
    s = get_settings()
    return f"`{s.gcp_project_id}.{s.bq_calls_dataset}.vendor_kpi`"


def _run(sql: str) -> list[dict]:
    return [dict(r) for r in get_client().query(sql).result()]


def _overview_sync() -> dict:
    rows = _run(f"""
        SELECT
          COUNT(*)                                                          AS total_orders,
          COUNTIF(order_status = 'Delivered')                               AS delivered,
          COUNTIF(order_status = 'Cancelled')                               AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(order_status = 'Cancelled'), COUNT(*)) * 100, 1) AS cancel_rate_pct,
          ROUND(AVG(since_create_til_delivred_min), 1)                      AS avg_delivery_min,
          ROUND(AVG(preparing_time_min), 1)                                 AS avg_prep_min,
          ROUND(AVG(Driver_to_vendor_min), 1)                               AS avg_driver_to_vendor_min,
          ROUND(AVG(outForDelivrey_to_delivred_min), 1)                     AS avg_last_mile_min,
          ROUND(AVG(total_order_value), 2)                                  AS avg_order_value,
          ROUND(AVG(feedback_delivery_rating), 2)                           AS avg_delivery_rating
        FROM {_T()}
    """)
    return rows[0] if rows else {}


def _restaurants_sync() -> list[dict]:
    return _run(f"""
        SELECT
          restaurant_name,
          COUNT(*)                                                                AS total_orders,
          COUNTIF(order_status = 'Cancelled')                                     AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(order_status = 'Cancelled'), COUNT(*)) * 100, 1) AS cancel_rate_pct,
          ROUND(AVG(since_create_til_delivred_min), 1)                            AS avg_delivery_min,
          ROUND(AVG(preparing_time_min), 1)                                       AS avg_prep_min,
          ROUND(AVG(feedback_delivery_rating), 2)                                 AS avg_rating,
          ROUND(AVG(total_order_value), 2)                                        AS avg_order_value
        FROM {_T()}
        WHERE restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''
        GROUP BY restaurant_name
        ORDER BY total_orders DESC
        LIMIT 20
    """)


def _zones_sync() -> list[dict]:
    return _run(f"""
        SELECT
          customer_location                                                        AS zone,
          COUNT(*)                                                                 AS total_orders,
          COUNTIF(order_status = 'Cancelled')                                      AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(order_status = 'Cancelled'), COUNT(*)) * 100, 1) AS cancel_rate_pct,
          ROUND(AVG(since_create_til_delivred_min), 1)                             AS avg_delivery_min,
          ROUND(AVG(feedback_delivery_rating), 2)                                  AS avg_rating
        FROM {_T()}
        WHERE customer_location IS NOT NULL AND TRIM(customer_location) != ''
        GROUP BY zone
        ORDER BY total_orders DESC
        LIMIT 15
    """)


def _cancellations_sync() -> list[dict]:
    return _run(f"""
        SELECT
          COALESCE(NULLIF(TRIM(cancelled_by_txt), ''), 'Unknown')  AS cancelled_by,
          COALESCE(NULLIF(TRIM(cancel_comment), ''), 'No comment') AS reason,
          COUNT(*)                                                  AS count,
          ROUND(AVG(total_order_value), 2)                         AS avg_order_value
        FROM {_T()}
        WHERE order_status = 'Cancelled'
        GROUP BY cancelled_by, reason
        ORDER BY count DESC
        LIMIT 15
    """)


def _delivery_breakdown_sync() -> list[dict]:
    """Delivery time broken down by day of week."""
    return _run(f"""
        SELECT
          FORMAT_DATE('%A', order_placement_date) AS day_of_week,
          COUNT(*)                                AS total_orders,
          ROUND(AVG(since_create_til_delivred_min), 1) AS avg_delivery_min,
          ROUND(AVG(preparing_time_min), 1)            AS avg_prep_min
        FROM {_T()}
        WHERE order_placement_date IS NOT NULL
        GROUP BY day_of_week
        ORDER BY total_orders DESC
    """)


async def get_vendor_kpi_context() -> dict:
    """Return all vendor_kpi summaries in parallel. Used to build chat context."""
    loop = asyncio.get_running_loop()
    overview, restaurants, zones, cancellations, delivery_by_day = await asyncio.gather(
        loop.run_in_executor(None, _overview_sync),
        loop.run_in_executor(None, _restaurants_sync),
        loop.run_in_executor(None, _zones_sync),
        loop.run_in_executor(None, _cancellations_sync),
        loop.run_in_executor(None, _delivery_breakdown_sync),
        return_exceptions=True,
    )

    def _safe(val, fallback):
        return fallback if isinstance(val, Exception) else val

    return {
        "order_overview": _safe(overview, {}),
        "top_restaurants": _safe(restaurants, []),
        "zone_performance": _safe(zones, []),
        "cancellation_reasons": _safe(cancellations, []),
        "delivery_by_day_of_week": _safe(delivery_by_day, []),
    }
