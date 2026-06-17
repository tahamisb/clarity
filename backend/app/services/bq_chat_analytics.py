import asyncio
import logging
from typing import Optional
from google.cloud import bigquery
from app.config import get_settings
from app.services.bq_client import get_client

logger = logging.getLogger(__name__)

def _ref(table_name: str) -> str:
    s = get_settings()
    return f"`{s.gcp_project_id}.{s.bq_text_dataset}.{table_name}`"

def _query_stats_sync() -> dict:
    client = get_client()
    
    # Overview
    overview_sql = f"""
        SELECT 
            COUNT(*) AS total,
            COUNTIF(c.sentiment = 'negative') AS negative_count,
            ROUND(SAFE_DIVIDE(COUNTIF(c.sentiment = 'negative'), COUNT(*)) * 100, 1) AS negative_pct
        FROM {_ref('classifications')} c
    """
    overview = dict(next(iter(client.query(overview_sql).result())))
    
    # Top Intent
    intent_sql = f"""
        SELECT intent, COUNT(*) AS cnt 
        FROM {_ref('classifications')} 
        GROUP BY intent ORDER BY cnt DESC LIMIT 1
    """
    intent_rows = list(client.query(intent_sql).result())
    top_intent = intent_rows[0]["intent"] if intent_rows else "—"
    
    # Top Channel
    channel_sql = f"""
        SELECT m.source_channel, COUNT(*) AS cnt 
        FROM {_ref('classifications')} c
        JOIN {_ref('messages')} m ON c.message_id = m.message_id
        GROUP BY m.source_channel ORDER BY cnt DESC LIMIT 1
    """
    channel_rows = list(client.query(channel_sql).result())
    top_channel = channel_rows[0]["source_channel"] if channel_rows else "—"
    
    # WoW Volume Change
    wow_sql = f"""
        WITH WeeklyCounts AS (
            SELECT 
                DATE_TRUNC(DATE(m.created_at), WEEK) AS week_start,
                COUNT(*) AS volume
            FROM {_ref('classifications')} c
            JOIN {_ref('messages')} m ON c.message_id = m.message_id
            WHERE m.created_at IS NOT NULL
            GROUP BY week_start
            ORDER BY week_start DESC
            LIMIT 2
        )
        SELECT * FROM WeeklyCounts ORDER BY week_start DESC
    """
    wow_rows = list(client.query(wow_sql).result())
    wow_change = "+0%"
    if len(wow_rows) == 2:
        curr = wow_rows[0]["volume"]
        prev = wow_rows[1]["volume"]
        if prev > 0:
            diff = ((curr - prev) / prev) * 100
            wow_change = f"+{diff:.1f}%" if diff >= 0 else f"{diff:.1f}%"
            
    return {
        "total_messages": overview["total"],
        "negative_sentiment_pct": overview["negative_pct"] or 0.0,
        "most_common_intent": top_intent,
        "most_active_channel": top_channel.capitalize() if top_channel != "—" else top_channel,
        "wow_volume_change": wow_change
    }

async def get_messages_stats() -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _query_stats_sync)

def _query_list_sync(
    channel: Optional[str], intent: Optional[str], sentiment: Optional[str],
    zone: Optional[str], time_of_day: Optional[str], page: int, limit: int
) -> dict:
    client = get_client()
    conditions, params = [], []
    
    if channel:
        conditions.append("m.source_channel = @channel")
        params.append(bigquery.ScalarQueryParameter("channel", "STRING", channel))
    if intent:
        conditions.append("c.intent = @intent")
        params.append(bigquery.ScalarQueryParameter("intent", "STRING", intent))
    if sentiment:
        conditions.append("c.sentiment = @sentiment")
        params.append(bigquery.ScalarQueryParameter("sentiment", "STRING", sentiment))
    if zone:
        conditions.append("m.zone = @zone")
        params.append(bigquery.ScalarQueryParameter("zone", "STRING", zone))
    if time_of_day:
        ranges = {"Morning": (6, 12), "Afternoon": (12, 18), "Evening": (18, 22), "Night": (22, 6)}
        if time_of_day in ranges:
            s_h, e_h = ranges[time_of_day]
            if time_of_day == "Night":
                conditions.append("(EXTRACT(HOUR FROM m.created_at) >= @tod_start OR EXTRACT(HOUR FROM m.created_at) < @tod_end)")
            else:
                conditions.append("EXTRACT(HOUR FROM m.created_at) BETWEEN @tod_start AND @tod_end")
            params += [
                bigquery.ScalarQueryParameter("tod_start", "INT64", s_h),
                bigquery.ScalarQueryParameter("tod_end", "INT64", e_h),
            ]
            
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    join = f"FROM {_ref('classifications')} c JOIN {_ref('messages')} m ON c.message_id = m.message_id {where}"
    
    total = next(iter(client.query(
        f"SELECT COUNT(*) AS cnt {join}",
        job_config=bigquery.QueryJobConfig(query_parameters=params)
    ).result()))["cnt"]
    
    data_params = params + [
        bigquery.ScalarQueryParameter("limit", "INT64", limit),
        bigquery.ScalarQueryParameter("offset", "INT64", (page - 1) * limit),
    ]
    
    rows = [dict(r) for r in client.query(f"""
        SELECT m.message_id AS id, m.content AS text, m.source_channel AS channel,
               c.intent, c.sentiment, m.zone, CAST(m.created_at AS STRING) AS datetime
        {join} ORDER BY m.created_at DESC
        LIMIT @limit OFFSET @offset
    """, job_config=bigquery.QueryJobConfig(query_parameters=data_params)).result()]
    
    return {"total": total, "page": page, "limit": limit, "items": rows}

async def get_messages_list(channel, intent, sentiment, zone, time_of_day, page, limit) -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _query_list_sync, channel, intent, sentiment, zone, time_of_day, page, limit)

def _query_triggers_sync() -> list[dict]:
    client = get_client()
    sql = f"""
        SELECT c.negative_trigger AS trigger, COUNT(*) AS volume,
               ARRAY_AGG(DISTINCT m.zone IGNORE NULLS LIMIT 5) AS top_zones,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) BETWEEN 6 AND 11) AS morning,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) BETWEEN 12 AND 17) AS afternoon,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) BETWEEN 18 AND 21) AS evening,
               COUNTIF(EXTRACT(HOUR FROM m.created_at) >= 22 OR EXTRACT(HOUR FROM m.created_at) < 6) AS night
        FROM {_ref('classifications')} c
        JOIN {_ref('messages')} m ON c.message_id = m.message_id
        WHERE c.sentiment = 'negative' AND c.negative_trigger IS NOT NULL
        GROUP BY 1 ORDER BY volume DESC LIMIT 5
    """
    rows = []
    for r in client.query(sql).result():
        d = dict(r)
        # Determine peak zone
        peak_zone = d["top_zones"][0] if d["top_zones"] else "Unknown"
        # Determine peak time
        times = {"Morning": d["morning"], "Afternoon": d["afternoon"], "Evening": d["evening"], "Night": d["night"]}
        peak_time = max(times.items(), key=lambda x: x[1])[0]
        
        rows.append({
            "trigger": d["trigger"],
            "volume": d["volume"],
            "zone": peak_zone,
            "time": peak_time
        })
    return rows

async def get_top_triggers() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _query_triggers_sync)

def _query_sentiment_trend_sync() -> list[dict]:
    client = get_client()
    sql = f"""
        SELECT FORMAT_TIMESTAMP('%Y-%m-%d', DATE_TRUNC(DATE(m.created_at), WEEK(MONDAY))) AS week,
               COUNTIF(c.sentiment = 'positive') AS positive,
               COUNTIF(c.sentiment = 'neutral') AS neutral,
               COUNTIF(c.sentiment = 'negative') AS negative
        FROM {_ref('classifications')} c
        JOIN {_ref('messages')} m ON c.message_id = m.message_id
        WHERE m.created_at IS NOT NULL
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    """
    rows = [dict(r) for r in client.query(sql).result()]
    rows.reverse()
    return rows

async def get_sentiment_trend() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _query_sentiment_trend_sync)

def _query_cross_channel_sync() -> list[dict]:
    s = get_settings()
    client = get_client()
    
    # Calls intents
    call_sql = f"""
        SELECT primary_intent AS intent, COUNT(*) AS cnt
        FROM `{s.gcp_project_id}.{s.bq_calls_dataset}.call_analysis`
        WHERE primary_intent IS NOT NULL GROUP BY 1
    """
    calls = {r["intent"]: int(r["cnt"]) for r in client.query(call_sql).result()}
    
    # Messages intents
    msg_sql = f"""
        SELECT intent, COUNT(*) AS cnt
        FROM {_ref('classifications')}
        WHERE intent IS NOT NULL GROUP BY 1
    """
    msgs = {r["intent"]: int(r["cnt"]) for r in client.query(msg_sql).result()}
    
    all_intents = set(calls.keys()).union(set(msgs.keys()))
    rows = []
    for i in all_intents:
        rows.append({
            "intent": i.replace("_", " ").title(),
            "callVolume": calls.get(i, 0),
            "messageVolume": msgs.get(i, 0)
        })
    return sorted(rows, key=lambda x: x["messageVolume"] + x["callVolume"], reverse=True)

async def get_cross_channel() -> list[dict]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _query_cross_channel_sync)

def _get_chat_detail_sync(chat_id: str) -> dict:
    client = get_client()
    sql = f"""
        SELECT m.message_id AS id, m.content AS text, m.source_channel AS channel,
               c.intent, c.sentiment, m.zone, CAST(m.created_at AS STRING) AS datetime
        FROM {_ref('messages')} m
        LEFT JOIN {_ref('classifications')} c ON m.message_id = c.message_id
        WHERE m.message_id = @chat_id LIMIT 1
    """
    rows = list(client.query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("chat_id", "STRING", chat_id)]
    )).result())
    return dict(rows[0]) if rows else None

async def get_chat_detail(chat_id: str) -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_chat_detail_sync, chat_id)
