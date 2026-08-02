"""
Pillar 02 analytics — aggregates db_text query results into API response shapes.
"""

from collections import defaultdict
from typing import Optional

from app.models.schemas import (
    AccuracyResponse, ChannelSentimentSummary, CrossChannelResponse,
    IntentDistributionResponse, IntentRow, MerchantSentimentResponse,
    MerchantSentimentRow, NegativeTrigger, SentimentTrendResponse,
    SharedIntentRow, TopTriggersResponse, WeeklyBucket,
    ZoneHeatmapResponse, ZoneRow,
)
from app.services import db_text as bq
from app.services.ttl_cache import ttl_cache

_CALL_TO_TEXT_INTENT = {
    "complaint": "complaint", "refund_request": "refund",
    "cancellation": "cancellation_request", "praise": "praise",
    "order_status": "order_query", "delivery_issue": "complaint",
    "wrong_item": "complaint", "payment_issue": "refund",
    "general_inquiry": "order_query", "escalation": "complaint",
    "account_issue": "order_query",
}


@ttl_cache
async def get_sentiment_trend(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> SentimentTrendResponse:
    rows = await bq.query_sentiment_trend(start, end, vertical)
    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {"positive": 0, "neutral": 0, "negative": 0})
    for r in rows:
        s = r["sentiment"]
        if s in buckets[r["week_start"]]:
            buckets[r["week_start"]][s] += int(r["cnt"])

    weeks = []
    for week_start in sorted(buckets):
        d = buckets[week_start]
        total = d["positive"] + d["neutral"] + d["negative"]
        weeks.append(WeeklyBucket(
            week_start=week_start, total=total,
            positive=d["positive"], neutral=d["neutral"], negative=d["negative"],
            positive_pct=round(d["positive"] / total * 100, 1) if total else 0.0,
            neutral_pct=round(d["neutral"] / total * 100, 1) if total else 0.0,
            negative_pct=round(d["negative"] / total * 100, 1) if total else 0.0,
        ))
    return SentimentTrendResponse(weeks=weeks)


@ttl_cache
async def get_top_negative_triggers(
    merchant: Optional[str] = None, zone: Optional[str] = None, time_of_day: Optional[str] = None,
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> TopTriggersResponse:
    rows = await bq.query_top_triggers(
        merchant=merchant, zone=zone, time_of_day=time_of_day, start=start, end=end, vertical=vertical
    )
    triggers = [
        NegativeTrigger(
            trigger=r["trigger"], count=int(r["cnt"]),
            top_merchants=list(r.get("top_merchants") or []),
            top_zones=list(r.get("top_zones") or []),
            top_vertical=r.get("top_vertical"),
            time_of_day_distribution={
                "morning": int(r.get("morning_cnt") or 0),
                "afternoon": int(r.get("afternoon_cnt") or 0),
                "evening": int(r.get("evening_cnt") or 0),
                "night": int(r.get("night_cnt") or 0),
            },
        )
        for r in rows
    ]
    return TopTriggersResponse(
        triggers=triggers,
        filters_applied={"merchant": merchant, "zone": zone, "time_of_day": time_of_day, "vertical": vertical},
    )


@ttl_cache
async def get_cross_channel(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> CrossChannelResponse:
    data = await bq.query_cross_channel_data(start, end, vertical)

    def _summary(d: dict) -> ChannelSentimentSummary:
        total = d.get("total", 0)
        pos, neu, neg = d.get("positive", 0), d.get("neutral", 0), d.get("negative", 0)
        return ChannelSentimentSummary(
            total=total, positive=pos, neutral=neu, negative=neg,
            positive_pct=round(pos / total * 100, 1) if total else 0.0,
            neutral_pct=round(neu / total * 100, 1) if total else 0.0,
            negative_pct=round(neg / total * 100, 1) if total else 0.0,
        )

    text_intents: dict[str, int] = data["text_intents"]
    norm_call: dict[str, int] = defaultdict(int)
    for k, v in data["call_intents"].items():
        norm_call[_CALL_TO_TEXT_INTENT.get(k, "order_query")] += v

    shared = set(text_intents) & set(norm_call)
    return CrossChannelResponse(
        text_channel=_summary(data["text_sentiment"]),
        call_channel=_summary(data["call_sentiment"]),
        shared_intents=[
            SharedIntentRow(intent=i, text_count=text_intents.get(i, 0), call_count=norm_call.get(i, 0))
            for i in sorted(shared, key=lambda i: -(text_intents.get(i, 0) + norm_call.get(i, 0)))
        ],
        text_only_intents=sorted(set(text_intents) - set(norm_call)),
        call_only_intents=sorted(set(norm_call) - set(text_intents)),
    )


@ttl_cache
async def get_intent_distribution(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> IntentDistributionResponse:
    rows = await bq.query_intent_distribution(start, end, vertical)
    total = sum(int(r["cnt"]) for r in rows)
    return IntentDistributionResponse(total=total, intents=[
        IntentRow(intent=r["intent"], count=int(r["cnt"]),
                  percentage=round(int(r["cnt"]) / total * 100, 1) if total else 0.0)
        for r in rows
    ])


@ttl_cache
async def get_merchant_sentiment(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> MerchantSentimentResponse:
    rows = await bq.query_merchant_sentiment(start, end, vertical)
    merchants = []
    for r in rows:
        total, neg = int(r["total"]), int(r["negative"])
        merchants.append(MerchantSentimentRow(
            merchant_name=r["merchant_name"], vertical=r.get("vertical"), total=total,
            positive=int(r["positive"]), neutral=int(r["neutral"]), negative=neg,
            negative_pct=round(neg / total * 100, 1) if total else 0.0,
        ))
    return MerchantSentimentResponse(merchants=merchants)


@ttl_cache
async def get_zone_heatmap(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> ZoneHeatmapResponse:
    rows = await bq.query_zone_heatmap(start, end, vertical)
    zones = []
    for r in rows:
        total, neg = int(r["total"]), int(r["negative"])
        zones.append(ZoneRow(
            zone=r["zone"], total=total, negative=neg,
            negative_pct=round(neg / total * 100, 1) if total else 0.0,
            top_vertical=r.get("top_vertical"),
        ))
    return ZoneHeatmapResponse(zones=zones)


@ttl_cache
async def get_message_overview(
    start: Optional[str] = None, end: Optional[str] = None,
    chat_sla_hours: float = 4.0, general_sla_hours: float = 24.0,
    vertical: Optional[str] = None,
) -> dict:
    """Full-corpus stats for the Support Messages stat cards, time-of-day chart
    and SLA banner. Returns a plain dict (no response_model — the shape is UI-only
    and not reused elsewhere)."""
    r = await bq.query_message_overview(start, end, chat_sla_hours, general_sla_hours, vertical)
    total = int(r["total"])

    def tod(name: str) -> dict:
        pos, neu, neg = (int(r[f"{name}_{s}"]) for s in ("positive", "neutral", "negative"))
        bucket = pos + neu + neg
        pct = lambda x: round(x / bucket * 100) if bucket else 0
        return {"time": name.capitalize(), "positive": pct(pos), "neutral": pct(neu), "negative": pct(neg)}

    return {
        "total": total,
        "negative_pct": round(int(r["negative"]) / total * 100, 1) if total else 0.0,
        # Bot→human handovers (messages.agent_name non-null) as a share of all
        # analysable chats in the window.
        "escalated": int(r["escalated"]),
        "escalation_rate_pct": round(int(r["escalated"]) / total * 100, 1) if total else 0.0,
        "top_intent": r.get("top_intent"),
        "top_channel": r.get("top_channel"),
        "top_vertical": r.get("top_vertical"),
        "time_of_day": [tod(n) for n in ("morning", "afternoon", "evening", "night")],
        "sla_breaches": r["sla_breaches"],
    }


async def get_negative_customers(
    start: Optional[str] = None, end: Optional[str] = None, vertical: Optional[str] = None,
) -> list[dict]:
    """Distinct customers with negative sentiment in the window — for the CSV
    export marketing uses to target coupon campaigns."""
    rows = await bq.query_negative_customers(start, end, vertical)
    return [
        {"customer_id": r["customer_id"],
         "negative_messages": int(r["negative_messages"]),
         "last_negative_at": r["last_negative_at"]}
        for r in rows
    ]


@ttl_cache
async def get_sla_breaches(
    start: Optional[str] = None, end: Optional[str] = None,
    chat_sla_hours: float = 4.0, general_sla_hours: float = 24.0,
    vertical: Optional[str] = None,
) -> list[dict]:
    """Individual SLA-breaching messages for the notification drill-down."""
    rows = await bq.query_sla_breaches(start, end, chat_sla_hours, general_sla_hours, vertical)
    return [
        {"message_id": r["message_id"], "channel": r["channel"],
         "hours": float(r["hours"]), "resolved": bool(r["resolved"])}
        for r in rows
    ]


async def get_accuracy() -> AccuracyResponse:
    rows = await bq.query_accuracy_rows()
    if not rows:
        return AccuracyResponse(
            total_labelled=0, sentiment_accuracy=0.0, intent_accuracy=0.0,
            per_sentiment_accuracy={}, per_intent_accuracy={}, confusion={},
        )
    total = len(rows)
    sent_correct = sum(1 for r in rows if r["true_sentiment"] == r["pred_sentiment"])
    intent_correct = sum(1 for r in rows if r["true_intent"] == r["pred_intent"])

    sent_total: dict[str, int] = defaultdict(int)
    sent_right: dict[str, int] = defaultdict(int)
    intent_total: dict[str, int] = defaultdict(int)
    intent_right: dict[str, int] = defaultdict(int)
    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for r in rows:
        sent_total[r["true_sentiment"]] += 1
        if r["true_sentiment"] == r["pred_sentiment"]:
            sent_right[r["true_sentiment"]] += 1
        intent_total[r["true_intent"]] += 1
        if r["true_intent"] == r["pred_intent"]:
            intent_right[r["true_intent"]] += 1
        confusion[r["true_sentiment"]][r["pred_sentiment"]] += 1

    return AccuracyResponse(
        total_labelled=total,
        sentiment_accuracy=round(sent_correct / total, 4),
        intent_accuracy=round(intent_correct / total, 4),
        per_sentiment_accuracy={k: round(sent_right[k] / sent_total[k], 4) for k in sent_total},
        per_intent_accuracy={k: round(intent_right[k] / intent_total[k], 4) for k in intent_total},
        confusion={k: dict(v) for k, v in confusion.items()},
    )
