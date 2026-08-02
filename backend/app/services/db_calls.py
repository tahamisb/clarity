"""
Pillar 01 data access — call_analysis persistence and order enrichment.

Tables (local SQLite warehouse):
  call_analysis     — written by this service
  vendor_kpi        — read-only order data
  vendor_items_kpi  — read-only item data
"""

import asyncio
import json
import logging
from typing import List

from app.services import local_db as db
from app.utils.clock import now_sql

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Persist analysis result
# ---------------------------------------------------------------------------

async def save_call_analysis(result: dict) -> None:
    row = {
        "call_id": result["call_id"],
        "transcript": result["transcript"],
        "intents": json.dumps(result["intents"]),
        "primary_intent": result["intents"][0] if result["intents"] else "general_inquiry",
        "sentiment": result["sentiment"],
        "sentiment_confidence": result["sentiment_confidence"],
        "order_ids": json.dumps(result["entities"]["order_ids"]),
        "restaurant_names": json.dumps(result["entities"]["restaurant_names"]),
        "areas": json.dumps(result["entities"]["areas"]),
        "product_names": json.dumps(result["entities"]["product_names"]),
        "qar_amounts": json.dumps(result["entities"]["qar_amounts"]),
        "summary": result["summary"],
        "analysed_at": now_sql(),
    }
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, db.insert_rows, "call_analysis", [row])
    except Exception as exc:  # noqa: BLE001 — a failed write must not fail the call
        logger.error("Failed to persist call analysis %s: %s", result["call_id"], exc)


# ---------------------------------------------------------------------------
# Order enrichment
# ---------------------------------------------------------------------------

def _enrich_sync(order_ids: List[str]) -> List[dict]:
    marks = db.placeholders(order_ids)
    ids = tuple(order_ids)

    orders: dict[str, dict] = {}
    for d in db.query(f"""
        SELECT
          CAST(vk.id AS TEXT) AS order_id,
          vk.order_status, vk.restaurant_name, vk.location, vk.zone_name,
          vk.customer_zone, vk.total_order_value,
          vk.since_create_til_delivred_min AS delivery_time_min,
          vk.order_placement_date,
          CASE
            WHEN vk.cancel_comment IS NOT NULL AND TRIM(vk.cancel_comment) != ''
            THEN TRIM(split_first(vk.cancel_comment, '//'))
            ELSE NULL
          END AS cancel_reason,
          vk.vendor_to_customer_dist AS distance_km,
          vk.payment_type,
          LOWER(vk.customer_device_type) AS device_type,
          vk.feedback_order_rating AS order_rating,
          vk.feedback_delivery_rating AS delivery_rating,
          vk.feedback_comment, vk.cuisine,
          vk.new_customer AS is_new_customer,
          vk.is_pro_user
        FROM vendor_kpi vk
        WHERE CAST(vk.id AS TEXT) IN ({marks})
    """, ids):
        d["is_new_customer"] = bool(d["is_new_customer"]) if d.get("is_new_customer") is not None else None
        d["is_pro_user"] = bool(d["is_pro_user"]) if d.get("is_pro_user") is not None else None
        d["items"] = []
        orders[d["order_id"]] = d

    for row in db.query(f"""
        SELECT CAST(vi.order_id AS TEXT) AS order_id, vi.product_name, vi.cat_name,
               CAST(vi.count AS INTEGER) AS quantity,
               CAST(vi.total_value AS REAL) AS item_value
        FROM vendor_items_kpi vi
        WHERE CAST(vi.order_id AS TEXT) IN ({marks})
    """, ids):
        oid = row["order_id"]
        if oid in orders:
            orders[oid]["items"].append({
                "product_name": row["product_name"],
                "cat_name": row["cat_name"],
                "quantity": row["quantity"],
                "item_value": row["item_value"],
            })
    return list(orders.values())


async def enrich_orders(order_ids: List[str]) -> List[dict]:
    if not order_ids:
        return []
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, _enrich_sync, order_ids)
    except Exception as exc:  # noqa: BLE001
        logger.error("Order enrichment failed for %s: %s", order_ids, exc)
        return []
