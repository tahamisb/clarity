"""
Pillar 02 analytics — aggregates bq_text query results into API response shapes.
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
from app.services import bq_text as bq

_CALL_TO_TEXT_INTENT = {
    "complaint": "complaint", "refund_request": "refund",
    "cancellation": "cancellation_request", "praise": "praise",
    "order_status": "order_query", "delivery_issue": "complaint",
    "wrong_item": "complaint", "payment_issue": "refund",
    "general_inquiry": "order_query", "escalation": "complaint",
    "account_issue": "order_query",
}


async def get_sentiment_trend() -> SentimentTrendResponse:
    rows = await bq.query_sentiment_trend()
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


async def get_top_negative_triggers(
    merchant: Optional[str] = None, zone: Optional[str] = None, time_of_day: Optional[str] = None
) -> TopTriggersResponse:
    rows = await bq.query_top_triggers(merchant=merchant, zone=zone, time_of_day=time_of_day)
    triggers = [
        NegativeTrigger(
            trigger=r["trigger"], count=int(r["cnt"]),
            top_merchants=list(r.get("top_merchants") or []),
            top_zones=list(r.get("top_zones") or []),
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
        filters_applied={"merchant": merchant, "zone": zone, "time_of_day": time_of_day},
    )


async def get_cross_channel() -> CrossChannelResponse:
    data = await bq.query_cross_channel_data()

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


async def get_intent_distribution() -> IntentDistributionResponse:
    rows = await bq.query_intent_distribution()
    total = sum(int(r["cnt"]) for r in rows)
    return IntentDistributionResponse(total=total, intents=[
        IntentRow(intent=r["intent"], count=int(r["cnt"]),
                  percentage=round(int(r["cnt"]) / total * 100, 1) if total else 0.0)
        for r in rows
    ])


async def get_merchant_sentiment() -> MerchantSentimentResponse:
    rows = await bq.query_merchant_sentiment()
    merchants = []
    for r in rows:
        total, neg = int(r["total"]), int(r["negative"])
        merchants.append(MerchantSentimentRow(
            merchant_name=r["merchant_name"], total=total,
            positive=int(r["positive"]), neutral=int(r["neutral"]), negative=neg,
            negative_pct=round(neg / total * 100, 1) if total else 0.0,
        ))
    return MerchantSentimentResponse(merchants=merchants)


async def get_zone_heatmap() -> ZoneHeatmapResponse:
    rows = await bq.query_zone_heatmap()
    zones = []
    for r in rows:
        total, neg = int(r["total"]), int(r["negative"])
        zones.append(ZoneRow(
            zone=r["zone"], total=total, negative=neg,
            negative_pct=round(neg / total * 100, 1) if total else 0.0,
        ))
    return ZoneHeatmapResponse(zones=zones)


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
