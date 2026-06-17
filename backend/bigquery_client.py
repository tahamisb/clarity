"""
BigQuery client — table management, call analysis persistence, and order enrichment.

Tables used:
  long-ceiling-343505.reports.call_analysis  — written by this service
  long-ceiling-343505.reports.vendor_kpi     — read-only order data
  long-ceiling-343505.reports.vendor_items_kpi — read-only item data
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import List, Optional

from google.cloud import bigquery
from google.api_core.exceptions import Conflict

logger = logging.getLogger(__name__)

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "long-ceiling-343505")
DATASET = "reports"
TABLE_ID = f"{PROJECT}.{DATASET}.call_analysis"

_client: Optional[bigquery.Client] = None


def get_client() -> bigquery.Client:
    global _client
    if _client is None:
        _client = bigquery.Client(project=PROJECT)
    return _client


# ---------------------------------------------------------------------------
# Table bootstrap
# ---------------------------------------------------------------------------

CALL_ANALYSIS_SCHEMA = [
    bigquery.SchemaField("call_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("transcript", "STRING"),
    bigquery.SchemaField("intents", "STRING"),           # JSON array string
    bigquery.SchemaField("primary_intent", "STRING"),
    bigquery.SchemaField("sentiment", "STRING"),
    bigquery.SchemaField("sentiment_confidence", "FLOAT64"),
    bigquery.SchemaField("order_ids", "STRING"),         # JSON array string
    bigquery.SchemaField("restaurant_names", "STRING"),  # JSON array string
    bigquery.SchemaField("areas", "STRING"),             # JSON array string
    bigquery.SchemaField("product_names", "STRING"),     # JSON array string
    bigquery.SchemaField("qar_amounts", "STRING"),       # JSON array string
    bigquery.SchemaField("summary", "STRING"),
    bigquery.SchemaField("analysed_at", "TIMESTAMP"),
]


def _ensure_table_sync() -> None:
    client = get_client()
    table = bigquery.Table(TABLE_ID, schema=CALL_ANALYSIS_SCHEMA)
    try:
        client.create_table(table)
        logger.info("Created table %s", TABLE_ID)
    except Conflict:
        logger.info("Table %s already exists", TABLE_ID)


async def ensure_table() -> None:
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, _ensure_table_sync)
    except Exception as exc:
        logger.error("Could not ensure call_analysis table: %s", exc)


# ---------------------------------------------------------------------------
# Persist analysis result
# ---------------------------------------------------------------------------

def _save_sync(row: dict) -> None:
    client = get_client()
    errors = client.insert_rows_json(TABLE_ID, [row])
    if errors:
        raise RuntimeError(f"BigQuery streaming insert errors: {errors}")


async def save_analysis(result: dict) -> None:
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
        "analysed_at": datetime.now(timezone.utc).isoformat(),
    }
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, _save_sync, row)
    except Exception as exc:
        # Log and continue — analysis result is still returned to caller
        logger.error("Failed to persist call analysis %s: %s", result["call_id"], exc)


# ---------------------------------------------------------------------------
# Order enrichment
# ---------------------------------------------------------------------------

_ORDERS_SQL = f"""
SELECT
  CAST(vk.id AS STRING)                                                 AS order_id,
  vk.order_status,
  vk.restaurant_name,
  vk.location,
  vk.zone_name,
  vk.customer_zone,
  vk.total_order_value,
  vk.since_create_til_delivred_min                                      AS delivery_time_min,
  CAST(vk.order_placement_date AS STRING)                               AS order_placement_date,
  CASE
    WHEN vk.cancel_comment IS NOT NULL AND TRIM(vk.cancel_comment) != ''
    THEN TRIM(SPLIT(vk.cancel_comment, '//')[OFFSET(0)])
    ELSE NULL
  END                                                                    AS cancel_reason,
  vk.vendor_to_customer_dist                                            AS distance_km,
  vk.payment_type,
  LOWER(vk.customer_device_type)                                        AS device_type,
  vk.feedback_order_rating                                              AS order_rating,
  vk.feedback_delivery_rating                                           AS delivery_rating,
  vk.feedback_comment,
  vk.cuisine,
  vk.new_customer                                                       AS is_new_customer,
  vk.is_pro_user
FROM `{PROJECT}.{DATASET}.vendor_kpi` vk
WHERE CAST(vk.id AS STRING) IN UNNEST(@order_ids)
"""

_ITEMS_SQL = f"""
SELECT
  vi.order_id,
  vi.product_name,
  vi.cat_name,
  SAFE_CAST(vi.count        AS INT64)   AS quantity,
  SAFE_CAST(vi.total_value  AS FLOAT64) AS item_value
FROM `{PROJECT}.{DATASET}.vendor_items_kpi` vi
WHERE vi.order_id IN UNNEST(@order_ids)
"""


def _enrich_sync(order_ids: List[str]) -> List[dict]:
    client = get_client()
    params = [bigquery.ArrayQueryParameter("order_ids", "STRING", order_ids)]
    job_config = bigquery.QueryJobConfig(query_parameters=params)

    # Fetch order-level rows
    orders: dict[str, dict] = {}
    for row in client.query(_ORDERS_SQL, job_config=job_config).result():
        d = dict(row)
        # Cast integer flags to bool for clean serialisation
        if d.get("is_new_customer") is not None:
            d["is_new_customer"] = bool(d["is_new_customer"])
        if d.get("is_pro_user") is not None:
            d["is_pro_user"] = bool(d["is_pro_user"])
        d["items"] = []
        orders[d["order_id"]] = d

    # Fetch item-level rows and attach to parent orders
    for row in client.query(_ITEMS_SQL, job_config=job_config).result():
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
    except Exception as exc:
        logger.error("Order enrichment failed for %s: %s", order_ids, exc)
        return []
