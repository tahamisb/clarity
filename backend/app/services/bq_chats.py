import asyncio
import logging
from google.cloud import bigquery
from app.config import get_settings
from app.services.bq_client import get_client

logger = logging.getLogger(__name__)

def _fetch_unprocessed_chats_sync(limit: int) -> list[dict]:
    s = get_settings()
    client = get_client()
    
    # We use LEFT JOIN against the text_sentiment.messages table
    # using chat_id as the message_id to find unprocessed chats.
    # We also LEFT JOIN vendor_kpi via order_id to enrich with zone/merchant info.
    sql = f"""
        SELECT
            CAST(ch.chat_id AS STRING) AS chat_id,
            CAST(ch.customer_id AS STRING) AS customer_id,
            CAST(ch.order_id AS STRING) AS order_id,
            ch.type,
            ch.device_id,
            ch.locale,
            ch.messages,
            ch.created_at,
            ch.closed_at,
            ch.closed_by,
            vk.customer_zone AS zone,
            vk.restaurant_name AS merchant_name
        FROM `{s.gcp_project_id}.reports.chat_history` ch
        LEFT JOIN `{s.gcp_project_id}.{s.bq_calls_dataset}.vendor_kpi` vk
               ON ch.order_id = vk.id
        LEFT JOIN `{s.gcp_project_id}.{s.bq_text_dataset}.messages` m
               ON CAST(ch.chat_id AS STRING) = m.message_id
        WHERE ch.is_phone_call = false
          AND ch.messages IS NOT NULL
          AND (LOWER(ch.locale) LIKE '%ar%' OR LOWER(ch.locale) LIKE '%en%')
          AND m.message_id IS NULL
        ORDER BY ch.created_at DESC
        LIMIT @limit
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("limit", "INT64", limit)]
    )
    return [dict(row) for row in client.query(sql, job_config=job_config).result()]


async def fetch_unprocessed_chats(limit: int = 50) -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _fetch_unprocessed_chats_sync, limit)
