"""
Pillar 01 — call analytics endpoints.
Paths kept identical to the original backend for frontend compatibility.
"""

from fastapi import APIRouter, Query

from app.services.call_analytics_service import (
    get_analytics_summary,
    get_area_insights,
    get_calls,
    get_restaurant_insights,
)

router = APIRouter(tags=["call-analytics"])


@router.get("/calls")
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
):
    return await get_calls(page, page_size)


@router.get("/analytics/summary")
async def analytics_summary():
    return await get_analytics_summary()


@router.get("/analytics/area-insights")
async def area_insights():
    return await get_area_insights()


@router.get("/analytics/restaurant-insights")
async def restaurant_insights():
    return await get_restaurant_insights()
