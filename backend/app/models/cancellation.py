"""
Pydantic models for the cancellation-prediction feature.

Request models validate inbound payloads; response models document the shape the
services return (services return plain dicts, matching the existing routers — the
response models are declarative documentation + optional FastAPI validation).
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ===========================================================================
# Prediction — requests
# ===========================================================================

class OrderInput(BaseModel):
    """
    A single order's placement-time attributes.

    All fields are optional so the ops console / live systems can send partial
    payloads; the feature pipeline imputes anything missing. Field names mirror
    the `vendor_kpi` columns. Post-delivery fields are intentionally absent.
    """

    id: Optional[int] = None
    vendor_id: Optional[int] = None
    customer_id: Optional[int] = None

    order_placement_date: Optional[str] = None      # "YYYY-MM-DD"
    order_placement_time: Optional[str] = None       # "HH:MM:SS"

    total_order_value: Optional[float] = None
    order_sub_total_value: Optional[float] = None
    delivery_charge: Optional[float] = None
    vendor_to_customer_dist: Optional[float] = None
    driver_vendor_dist: Optional[float] = None

    is_pre_order: Optional[int] = None
    new_customer: Optional[int] = None
    is_pro_user: Optional[int] = None
    is_pro_vendor: Optional[int] = None
    is_treasure: Optional[bool] = None
    is_discount: Optional[str] = None
    used_coupon: Optional[str] = None

    payment_type: Optional[Any] = None
    customer_device_type: Optional[str] = None
    platform_name: Optional[str] = None
    cuisine: Optional[str] = None
    zone_name: Optional[str] = None
    customer_zone: Optional[str] = None

    rafeeq_time_to_accept_order_min: Optional[float] = None
    vendor_to_accept_order_min: Optional[float] = None

    # Optional pre-computed historical features (otherwise looked up from BQ)
    vendor_cancel_rate_30d: Optional[float] = None
    zone_cancel_rate_30d: Optional[float] = None
    customer_order_count: Optional[float] = None
    vendor_avg_prep_time: Optional[float] = None


class PredictRequest(BaseModel):
    order: OrderInput


class BatchPredictRequest(BaseModel):
    orders: list[OrderInput] = Field(..., min_length=1, max_length=500)


# ===========================================================================
# Prediction — responses
# ===========================================================================

class RiskFactor(BaseModel):
    feature: str
    value: Any = None
    contribution: float                      # signed SHAP value (toward cancellation if > 0)
    direction: str                           # "increases_risk" | "decreases_risk"


class PredictionResponse(BaseModel):
    order_id: Optional[str] = None
    probability: float
    risk_level: str                          # "high" | "medium" | "low"
    threshold: float
    flagged: bool
    top_risk_factors: list[RiskFactor]
    gemini_explanation: Optional[str] = None
    recommended_action: Optional[str] = None


class BatchPredictionResponse(BaseModel):
    count: int
    threshold: float
    predictions: list[PredictionResponse]


class LiveQueueResponse(BaseModel):
    count: int
    threshold: float
    generated_at: str
    orders: list[PredictionResponse]


# ===========================================================================
# Gemini analysis
# ===========================================================================

class CancellationChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2_000)

    @property
    def text(self) -> str:
        return self.question.strip()


class CancellationChatResponse(BaseModel):
    answer: str


# ===========================================================================
# Drivers report (Gemini-generated, structured)
# ===========================================================================

class ReportDriver(BaseModel):
    name: str
    importance: float
    explanation: str
    recommendation: str


class ReportSegment(BaseModel):
    segment: str
    cancel_rate: Optional[float] = None
    recommendation: str


class DriversReportResponse(BaseModel):
    executive_summary: str
    top_drivers: list[ReportDriver]
    high_risk_segments: list[ReportSegment]
    trend_insight: str
    generated_at: str


# ===========================================================================
# Model management
# ===========================================================================

class ModelInfoResponse(BaseModel):
    available: bool
    algorithm: Optional[str] = None
    version: Optional[str] = None
    trained_at: Optional[str] = None
    roc_auc: Optional[float] = None
    threshold: Optional[float] = None
    n_features: Optional[int] = None
    n_training_rows: Optional[int] = None


class ModelHealthResponse(BaseModel):
    status: str                              # "ready" | "unavailable"
    model_loaded: bool
    artifacts_present: bool
    detail: Optional[str] = None


class RefreshResponse(BaseModel):
    status: str
    detail: str
