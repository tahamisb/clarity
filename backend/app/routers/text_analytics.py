import csv
import io
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.models.schemas import (
    CrossChannelResponse, IntentDistributionResponse, MerchantSentimentResponse,
    SentimentTrendResponse, TopTriggersResponse, ZoneHeatmapResponse,
)
from app.services import text_analytics_service as svc
from app.services import zones
from app.services import verticals

router = APIRouter(prefix="/api/v1/analytics", tags=["text-analytics"])
logger = logging.getLogger(__name__)


def _window(start: Optional[str], end: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Validate optional [start, end] date bounds (YYYY-MM-DD)."""
    for label, value in (("start", start), ("end", end)):
        if value is None:
            continue
        try:
            date.fromisoformat(value)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{label} must be a YYYY-MM-DD date")
    return start, end


def _vertical(vertical: Optional[str]) -> Optional[str]:
    """Whitelist-validate the vertical filter."""
    if vertical is not None and not verticals.is_valid(vertical):
        raise HTTPException(status_code=422, detail=f"vertical must be one of {list(verticals.VERTICALS)}")
    return vertical


def _zone(zone: Optional[str]) -> Optional[str]:
    """Whitelist-validate the zone filter (safe to interpolate downstream).

    An empty string or "all" means no zone predicate, not a zone named "".
    """
    if zone is None or zone == "" or zone == "all":
        return None
    if not zones.is_valid(zone):
        raise HTTPException(status_code=422, detail=f"unknown zone: {zone}")
    return zone


@router.get("/sentiment-trend", response_model=SentimentTrendResponse)
async def sentiment_trend(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                          vertical: Optional[str] = Query(None), zone: Optional[str] = Query(None)):
    try:
        return await svc.get_sentiment_trend(*_window(start, end), _vertical(vertical), _zone(zone))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/top-negative-triggers", response_model=TopTriggersResponse)
async def top_negative_triggers(
    merchant: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    time_of_day: Optional[str] = Query(None, description="morning | afternoon | evening | night"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    vertical: Optional[str] = Query(None),
):
    if time_of_day not in {"morning", "afternoon", "evening", "night", None}:
        raise HTTPException(status_code=422, detail="time_of_day must be: morning, afternoon, evening, or night")
    s, e = _window(start, end)
    try:
        return await svc.get_top_negative_triggers(
            merchant=merchant, zone=_zone(zone), time_of_day=time_of_day, start=s, end=e,
            vertical=_vertical(vertical),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/cross-channel", response_model=CrossChannelResponse)
async def cross_channel(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                        vertical: Optional[str] = Query(None), zone: Optional[str] = Query(None)):
    try:
        return await svc.get_cross_channel(*_window(start, end), _vertical(vertical), _zone(zone))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/intent-distribution", response_model=IntentDistributionResponse)
async def intent_distribution(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                              vertical: Optional[str] = Query(None)):
    try:
        return await svc.get_intent_distribution(*_window(start, end), _vertical(vertical))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/merchant-sentiment", response_model=MerchantSentimentResponse)
async def merchant_sentiment(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                             vertical: Optional[str] = Query(None)):
    try:
        return await svc.get_merchant_sentiment(*_window(start, end), _vertical(vertical))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/message-overview")
async def message_overview(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    chat_sla_hours: float = Query(4.0, gt=0),
    general_sla_hours: float = Query(24.0, gt=0),
    vertical: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
):
    s, e = _window(start, end)
    try:
        return await svc.get_message_overview(
            s, e, chat_sla_hours, general_sla_hours, _vertical(vertical), _zone(zone))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/handled-by")
async def handled_by(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                     vertical: Optional[str] = Query(None), zone: Optional[str] = Query(None)):
    try:
        return await svc.get_handled_by(*_window(start, end), _vertical(vertical), _zone(zone))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/zone-heatmap", response_model=ZoneHeatmapResponse)
async def zone_heatmap(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                       vertical: Optional[str] = Query(None)):
    try:
        return await svc.get_zone_heatmap(*_window(start, end), _vertical(vertical))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/sla-breaches")
async def sla_breaches(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    chat_sla_hours: float = Query(4.0, gt=0),
    general_sla_hours: float = Query(24.0, gt=0),
    vertical: Optional[str] = Query(None),
):
    """Individual SLA-breaching messages in the window — drill-down for the SLA
    notifications (the overview only exposes per-channel counts)."""
    s, e = _window(start, end)
    try:
        breaches = await svc.get_sla_breaches(s, e, chat_sla_hours, general_sla_hours, _vertical(vertical))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"breaches": breaches}


@router.get("/negative-customers.csv")
async def negative_customers_csv(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    vertical: Optional[str] = Query(None),
):
    """CSV of every customer with negative sentiment in the window (deduped), for
    marketing coupon campaigns. Content-Disposition makes the browser download it."""
    s, e = _window(start, end)
    try:
        rows = await svc.get_negative_customers(s, e, _vertical(vertical))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["customer_id", "negative_messages", "last_negative_at"])
    for r in rows:
        writer.writerow([r["customer_id"], r["negative_messages"], r["last_negative_at"]])

    # Stamp the exported window into the filename so it's obvious the export is
    # scoped to the dashboard's timeline (adaptive), not a fixed dump.
    window = f"{s}_to_{e}" if s and e else (f"from_{s}" if s else (f"until_{e}" if e else "all-time"))
    filename = f"negative-customers-{window}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
