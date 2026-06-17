"""
Pillar 02 BigQuery operations — text_sentiment dataset.

Tables (dataset: text_sentiment):
  messages         — raw ingested messages (PII-redacted)
  classifications  — Gemini classification results
  labels           — human ground-truth for accuracy evaluation
"""

import asyncio
import logging
from typing import Optional

from google.api_core.exceptions import Conflict
from google.cloud import bigquery

from app.config import get_settings
from app.services.bq_client import get_client

logger = logging.getLogger(__name__)

_MESSAGES_SCHEMA = [
    bigquery.SchemaField("message_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("customer_id", "STRING"),
    bigquery.SchemaField("content", "STRING"),
    bigquery.SchemaField("source_channel", "STRING"),
    bigquery.SchemaField("merchant_name", "STRING"),
    bigquery.SchemaField("zone", "STRING"),
    bigquery.SchemaField("created_at", "TIMESTAMP"),
    bigquery.SchemaField("ingested_at", "TIMESTAMP"),
]

_CLASSIFICATIONS_SCHEMA = [
    bigquery.SchemaField("classification_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("message_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("sentiment", "STRING"),
    bigquery.SchemaField("sentiment_confidence", "FLOAT64"),
    bigquery.SchemaField("intent", "STRING"),
    bigquery.SchemaField("intent_confidence", "FLOAT64"),
    bigquery.SchemaField("negative_trigger", "STRING"),
    bigquery.SchemaField("model_version", "STRING"),
    bigquery.SchemaField("classified_at", "TIMESTAMP"),
]

_LABELS_SCHEMA = [
    bigquery.SchemaField("message_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("true_sentiment", "STRING"),
    bigquery.SchemaField("true_intent", "STRING"),
    bigquery.SchemaField("labelled_by", "STRING"),
    bigquery.SchemaField("labelled_at", "TIMESTAMP"),
]


def _ref(table_name: str) -> str:
    s = get_settings()
    return f"{s.gcp_project_id}.{s.bq_text_dataset}.{table_name}"


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

def _bootstrap_sync() -> None:
    s = get_settings()
    client = get_client()
    dataset_id = f"{s.gcp_project_id}.{s.bq_text_dataset}"
    ds = bigquery.Dataset(dataset_id)
    ds.location = "us-central1"
    try:
        client.create_dataset(ds)
        logger.info("Created dataset %s", dataset_id)
    except Conflict:
        logger.debug("Dataset %s already exists", dataset_id)

    for name, schema in [
        ("messages", _MESSAGES_SCHEMA),
        ("classifications", _CLASSIFICATIONS_SCHEMA),
        ("labels", _LABELS_SCHEMA),
    ]:
        table = bigquery.Table(_ref(name), schema=schema)
        try:
            client.create_table(table)
            logger.info("Created table %s", _ref(name))
        except Conflict:
            logger.debug("Table %s already exists", _ref(name))


async def bootstrap_text_tables() -> None:
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, _bootstrap_sync)
        logger.info("Text-sentiment BigQuery tables ready")
    except Exception as exc:
        logger.error("Failed to bootstrap text tables: %s", exc)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

def _insert_messages_sync(rows: list[dict]) -> list[str]:
    errors = get_client().insert_rows_json(_ref("messages"), rows)
    if errors:
        raise RuntimeError(f"BigQuery insert errors: {errors}")
    return [r["message_id"] for r in rows]


async def insert_messages(rows: list[dict]) -> list[str]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _insert_messages_sync, rows)


def _query_messages_sync(
    source_channel: Optional[str], zone: Optional[str],
    from_date: Optional[str], to_date: Optional[str],
    page: int, page_size: int,
) -> tuple[int, list[dict]]:
    client = get_client()
    base = f"`{_ref('messages')}`"
    conditions, params = [], []

    if source_channel:
        conditions.append("source_channel = @source_channel")
        params.append(bigquery.ScalarQueryParameter("source_channel", "STRING", source_channel))
    if zone:
        conditions.append("zone = @zone")
        params.append(bigquery.ScalarQueryParameter("zone", "STRING", zone))
    if from_date:
        conditions.append("created_at >= @from_date")
        params.append(bigquery.ScalarQueryParameter("from_date", "TIMESTAMP", from_date))
    if to_date:
        conditions.append("created_at <= @to_date")
        params.append(bigquery.ScalarQueryParameter("to_date", "TIMESTAMP", to_date))

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    count_sql = f"SELECT COUNT(*) AS cnt FROM {base} {where}"
    total = next(iter(
        client.query(count_sql, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    ))["cnt"]

    data_params = params + [
        bigquery.ScalarQueryParameter("page_size", "INT64", page_size),
        bigquery.ScalarQueryParameter("offset", "INT64", (page - 1) * page_size),
    ]
    data_sql = f"""
        SELECT message_id, customer_id, content, source_channel, merchant_name, zone,
               CAST(created_at AS STRING) AS created_at,
               CAST(ingested_at AS STRING) AS ingested_at
        FROM {base} {where}
        ORDER BY ingested_at DESC
        LIMIT @page_size OFFSET @offset
    """
    rows = [dict(r) for r in client.query(
        data_sql, job_config=bigquery.QueryJobConfig(query_parameters=data_params)
    ).result()]
    return int(total), rows


async def query_messages(
    source_channel: Optional[str] = None, zone: Optional[str] = None,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    page: int = 1, page_size: int = 50,
) -> tuple[int, list[dict]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _query_messages_sync, source_channel, zone, from_date, to_date, page, page_size
    )


def _get_message_sync(message_id: str) -> Optional[dict]:
    sql = f"""
        SELECT message_id, customer_id, content, source_channel, merchant_name, zone,
               CAST(created_at AS STRING) AS created_at,
               CAST(ingested_at AS STRING) AS ingested_at
        FROM `{_ref('messages')}`
        WHERE message_id = @message_id LIMIT 1
    """
    rows = list(get_client().query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("message_id", "STRING", message_id)]
    )).result())
    return dict(rows[0]) if rows else None


async def get_message(message_id: str) -> Optional[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_message_sync, message_id)


def _get_classification_for_message_sync(message_id: str) -> Optional[dict]:
    sql = f"""
        SELECT classification_id, message_id, sentiment, sentiment_confidence,
               intent, intent_confidence, negative_trigger, model_version,
               CAST(classified_at AS STRING) AS classified_at
        FROM `{_ref('classifications')}`
        WHERE message_id = @message_id
        ORDER BY classified_at DESC LIMIT 1
    """
    rows = list(get_client().query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("message_id", "STRING", message_id)]
    )).result())
    return dict(rows[0]) if rows else None


async def get_classification_for_message(message_id: str) -> Optional[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_classification_for_message_sync, message_id)


# ---------------------------------------------------------------------------
# Classifications
# ---------------------------------------------------------------------------

def _insert_classifications_sync(rows: list[dict]) -> None:
    errors = get_client().insert_rows_json(_ref("classifications"), rows)
    if errors:
        raise RuntimeError(f"BigQuery insert errors: {errors}")


async def insert_classifications(rows: list[dict]) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _insert_classifications_sync, rows)


def _get_unclassified_ids_sync(limit: int) -> list[str]:
    sql = f"""
        SELECT m.message_id
        FROM `{_ref('messages')}` m
        LEFT JOIN `{_ref('classifications')}` c ON m.message_id = c.message_id
        WHERE c.message_id IS NULL
        ORDER BY m.ingested_at
        LIMIT @limit
    """
    return [r["message_id"] for r in get_client().query(
        sql, job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("limit", "INT64", limit)]
        )
    ).result()]


async def get_unclassified_message_ids(limit: int = 500) -> list[str]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_unclassified_ids_sync, limit)


def _get_messages_by_ids_sync(message_ids: list[str]) -> list[dict]:
    if not message_ids:
        return []
    sql = f"""
        SELECT message_id, content FROM `{_ref('messages')}`
        WHERE message_id IN UNNEST(@message_ids)
    """
    return [dict(r) for r in get_client().query(
        sql, job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ArrayQueryParameter("message_ids", "STRING", message_ids)]
        )
    ).result()]


async def get_messages_by_ids(message_ids: list[str]) -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_messages_by_ids_sync, message_ids)


def _query_classifications_sync(
    sentiment: Optional[str], intent: Optional[str], zone: Optional[str], merchant: Optional[str],
    from_date: Optional[str], to_date: Optional[str], page: int, page_size: int,
) -> tuple[int, list[dict]]:
    client = get_client()
    conditions, params = [], []

    if sentiment:
        conditions.append("c.sentiment = @sentiment")
        params.append(bigquery.ScalarQueryParameter("sentiment", "STRING", sentiment))
    if intent:
        conditions.append("c.intent = @intent")
        params.append(bigquery.ScalarQueryParameter("intent", "STRING", intent))
    if zone:
        conditions.append("m.zone = @zone")
        params.append(bigquery.ScalarQueryParameter("zone", "STRING", zone))
    if merchant:
        conditions.append("m.merchant_name = @merchant")
        params.append(bigquery.ScalarQueryParameter("merchant", "STRING", merchant))
    if from_date:
        conditions.append("m.created_at >= @from_date")
        params.append(bigquery.ScalarQueryParameter("from_date", "TIMESTAMP", from_date))
    if to_date:
        conditions.append("m.created_at <= @to_date")
        params.append(bigquery.ScalarQueryParameter("to_date", "TIMESTAMP", to_date))

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    join = f"""
        FROM `{_ref('classifications')}` c
        JOIN `{_ref('messages')}` m ON c.message_id = m.message_id {where}
    """
    total = next(iter(client.query(
        f"SELECT COUNT(*) AS cnt {join}",
        job_config=bigquery.QueryJobConfig(query_parameters=params)
    ).result()))["cnt"]

    data_params = params + [
        bigquery.ScalarQueryParameter("page_size", "INT64", page_size),
        bigquery.ScalarQueryParameter("offset", "INT64", (page - 1) * page_size),
    ]
    rows = [dict(r) for r in client.query(f"""
        SELECT c.classification_id, c.message_id, c.sentiment, c.sentiment_confidence,
               c.intent, c.intent_confidence, c.negative_trigger, c.model_version,
               CAST(c.classified_at AS STRING) AS classified_at,
               m.content, m.source_channel, m.merchant_name, m.zone, m.customer_id,
               CAST(m.created_at AS STRING) AS msg_created_at,
               CAST(m.ingested_at AS STRING) AS msg_ingested_at
        {join} ORDER BY c.classified_at DESC
        LIMIT @page_size OFFSET @offset
    """, job_config=bigquery.QueryJobConfig(query_parameters=data_params)).result()]
    return int(total), rows


async def query_classifications(
    sentiment: Optional[str] = None, intent: Optional[str] = None,
    zone: Optional[str] = None, merchant: Optional[str] = None,
    from_date: Optional[str] = None, to_date: Optional[str] = None,
    page: int = 1, page_size: int = 50,
) -> tuple[int, list[dict]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _query_classifications_sync,
        sentiment, intent, zone, merchant, from_date, to_date, page, page_size,
    )


# ---------------------------------------------------------------------------
# Analytics queries
# ---------------------------------------------------------------------------

def _sentiment_trend_sync() -> list[dict]:
    sql = f"""
        SELECT FORMAT_TIMESTAMP('%Y-%m-%d', DATE_TRUNC(m.created_at, WEEK(MONDAY))) AS week_start,
               c.sentiment, COUNT(*) AS cnt
        FROM `{_ref('classifications')}` c
        JOIN `{_ref('messages')}` m ON c.message_id = m.message_id
        WHERE m.created_at IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1
    """
    return [dict(r) for r in get_client().query(sql).result()]


async def query_sentiment_trend() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sentiment_trend_sync)


def _top_triggers_sync(merchant: Optional[str], zone: Optional[str], time_of_day: Optional[str]) -> list[dict]:
    conditions = ["c.sentiment = 'negative'", "c.negative_trigger IS NOT NULL"]
    params: list = []

    if merchant:
        conditions.append("m.merchant_name = @merchant")
        params.append(bigquery.ScalarQueryParameter("merchant", "STRING", merchant))
    if zone:
        conditions.append("m.zone = @zone")
        params.append(bigquery.ScalarQueryParameter("zone", "STRING", zone))
    if time_of_day:
        ranges = {"morning": (6, 12), "afternoon": (12, 18), "evening": (18, 22), "night": (22, 6)}
        if time_of_day in ranges:
            s_h, e_h = ranges[time_of_day]
            if time_of_day == "night":
                conditions.append("(EXTRACT(HOUR FROM m.created_at) >= @tod_start OR EXTRACT(HOUR FROM m.created_at) < @tod_end)")
            else:
                conditions.append("EXTRACT(HOUR FROM m.created_at) BETWEEN @tod_start AND @tod_end")
            params += [
                bigquery.ScalarQueryParameter("tod_start", "INT64", s_h),
                bigquery.ScalarQueryParameter("tod_end", "INT64", e_h),
            ]

    where = "WHERE " + " AND ".join(conditions)
    sql = f"""
        SELECT c.negative_trigger AS trigger, COUNT(*) AS cnt,
               ARRAY_AGG(DISTINCT m.merchant_name IGNORE NULLS LIMIT 5) AS top_merchants,
               ARRAY_AGG(DISTINCT m.zone IGNORE NULLS LIMIT 5) AS top_zones,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) BETWEEN 6 AND 11) AS morning_cnt,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) BETWEEN 12 AND 17) AS afternoon_cnt,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) BETWEEN 18 AND 21) AS evening_cnt,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) >= 22 OR EXTRACT(HOUR FROM m.created_at) < 6) AS night_cnt
        FROM `{_ref('classifications')}` c
        JOIN `{_ref('messages')}` m ON c.message_id = m.message_id {where}
        GROUP BY 1 ORDER BY cnt DESC LIMIT 5
    """
    return [dict(r) for r in get_client().query(
        sql, job_config=bigquery.QueryJobConfig(query_parameters=params)
    ).result()]


async def query_top_triggers(
    merchant: Optional[str] = None, zone: Optional[str] = None, time_of_day: Optional[str] = None
) -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _top_triggers_sync, merchant, zone, time_of_day)


def _text_sentiment_summary_sync() -> dict:
    rows = {r["sentiment"]: int(r["cnt"]) for r in get_client().query(
        f"SELECT sentiment, COUNT(*) AS cnt FROM `{_ref('classifications')}` GROUP BY 1"
    ).result()}
    return {"total": sum(rows.values()), **rows}


def _text_intent_counts_sync() -> dict:
    return {r["intent"]: int(r["cnt"]) for r in get_client().query(
        f"SELECT intent, COUNT(*) AS cnt FROM `{_ref('classifications')}` GROUP BY 1"
    ).result()}


def _call_sentiment_summary_sync() -> dict:
    s = get_settings()
    rows = {r["sentiment"]: int(r["cnt"]) for r in get_client().query(
        f"SELECT sentiment, COUNT(*) AS cnt FROM `{s.gcp_project_id}.{s.bq_calls_dataset}.call_analysis` GROUP BY 1"
    ).result()}
    return {"total": sum(rows.values()), **rows}


def _call_intent_counts_sync() -> dict:
    s = get_settings()
    return {r["intent"]: int(r["cnt"]) for r in get_client().query(f"""
        SELECT primary_intent AS intent, COUNT(*) AS cnt
        FROM `{s.gcp_project_id}.{s.bq_calls_dataset}.call_analysis`
        WHERE primary_intent IS NOT NULL GROUP BY 1
    """).result()}


async def query_cross_channel_data() -> dict:
    loop = asyncio.get_running_loop()
    results = await asyncio.gather(
        loop.run_in_executor(None, _text_sentiment_summary_sync),
        loop.run_in_executor(None, _text_intent_counts_sync),
        loop.run_in_executor(None, _call_sentiment_summary_sync),
        loop.run_in_executor(None, _call_intent_counts_sync),
    )
    return {
        "text_sentiment": results[0], "text_intents": results[1],
        "call_sentiment": results[2], "call_intents": results[3],
    }


async def query_intent_distribution() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: [dict(r) for r in get_client().query(
        f"SELECT intent, COUNT(*) AS cnt FROM `{_ref('classifications')}` GROUP BY 1 ORDER BY cnt DESC"
    ).result()])


async def query_merchant_sentiment() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: [dict(r) for r in get_client().query(f"""
        SELECT m.merchant_name, COUNT(*) AS total,
               COUNTIF(c.sentiment = 'positive') AS positive,
               COUNTIF(c.sentiment = 'neutral') AS neutral,
               COUNTIF(c.sentiment = 'negative') AS negative
        FROM `{_ref('classifications')}` c
        JOIN `{_ref('messages')}` m ON c.message_id = m.message_id
        WHERE m.merchant_name IS NOT NULL
        GROUP BY 1 ORDER BY total DESC
    """).result()])


async def query_zone_heatmap() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: [dict(r) for r in get_client().query(f"""
        SELECT m.zone, COUNT(*) AS total, COUNTIF(c.sentiment = 'negative') AS negative
        FROM `{_ref('classifications')}` c
        JOIN `{_ref('messages')}` m ON c.message_id = m.message_id
        WHERE m.zone IS NOT NULL
        GROUP BY 1 ORDER BY negative DESC
    """).result()])


async def query_accuracy_rows() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: [dict(r) for r in get_client().query(f"""
        SELECT l.true_sentiment, l.true_intent, c.sentiment AS pred_sentiment, c.intent AS pred_intent
        FROM `{_ref('labels')}` l
        JOIN `{_ref('classifications')}` c ON l.message_id = c.message_id
    """).result()])


async def ping() -> bool:
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, lambda: list(
            get_client().query(f"SELECT 1 FROM `{_ref('messages')}` LIMIT 1").result()
        ))
        return True
    except Exception:
        return False
