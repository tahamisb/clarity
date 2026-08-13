from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator

from app.models.enums import SourceChannelEnum, TextIntentEnum, TextSentimentEnum


# ===========================================================================
# Pillar 01 — Call Analysis
# ===========================================================================

class AnalyseRequest(BaseModel):
    transcript: str

    @field_validator("transcript")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("transcript cannot be empty")
        return v


class BatchAnalyseRequest(BaseModel):
    transcripts: list[str] = Field(..., min_length=1, max_length=100)

    @field_validator("transcripts")
    @classmethod
    def check_size(cls, v: list) -> list:
        if not v:
            raise ValueError("transcripts list is empty")
        return v


class PredictRequest(BaseModel):
    transcript: str

    @field_validator("transcript")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("transcript cannot be empty")
        return v


# ===========================================================================
# Pillar 02 — Messages
# ===========================================================================

class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10_000)
    source_channel: SourceChannelEnum
    merchant_name: Optional[str] = None
    zone: Optional[str] = None
    created_at: Optional[datetime] = None

    @field_validator("content")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("content cannot be blank")
        return v


class MessageResponse(BaseModel):
    message_id: str
    customer_id: Optional[str] = None
    content: str
    source_channel: str
    merchant_name: Optional[str]
    zone: Optional[str]
    vertical: Optional[str] = None
    created_at: str
    ingested_at: str
    closed_at: Optional[str] = None
    agent_name: Optional[str] = None
    classification: Optional[TextClassificationResponse] = None


class MessagesUploadRequest(BaseModel):
    messages: list[MessageCreate] = Field(..., min_length=1, max_length=1_000)


class MessagesUploadResponse(BaseModel):
    ingested: int
    skipped: int
    message_ids: list[str]


class MessagesListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[MessageResponse]


# ===========================================================================
# Pillar 02 — Classifications
# ===========================================================================

class TextClassificationResponse(BaseModel):
    classification_id: str
    message_id: str
    sentiment: TextSentimentEnum
    sentiment_confidence: float
    intent: TextIntentEnum
    intent_confidence: float
    negative_trigger: Optional[str]
    model_version: str
    classified_at: str


class ClassifyRequest(BaseModel):
    message_ids: Optional[list[str]] = None
    batch_size: int = Field(default=10, ge=1, le=100)


class ClassifyResponse(BaseModel):
    total: int
    classified: int
    failed: int
    failed_message_ids: list[str]


class SentimentResultsResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ClassificationWithMessage]


class ClassificationWithMessage(BaseModel):
    classification: TextClassificationResponse
    message: MessageResponse


class AccuracyResponse(BaseModel):
    total_labelled: int
    sentiment_accuracy: float
    intent_accuracy: float
    per_sentiment_accuracy: dict[str, float]
    per_intent_accuracy: dict[str, float]
    confusion: dict[str, Any]


# ===========================================================================
# Pillar 02 — Analytics responses
# ===========================================================================

class WeeklyBucket(BaseModel):
    week_start: str
    positive: int
    neutral: int
    negative: int
    total: int
    positive_pct: float
    neutral_pct: float
    negative_pct: float


class SentimentTrendResponse(BaseModel):
    weeks: list[WeeklyBucket]


class NegativeTrigger(BaseModel):
    trigger: str
    count: int
    top_merchants: list[str]
    top_zones: list[str]
    top_vertical: Optional[str] = None
    time_of_day_distribution: dict[str, int]


class TopTriggersResponse(BaseModel):
    triggers: list[NegativeTrigger]
    filters_applied: dict[str, Optional[str]]


class ChannelSentimentSummary(BaseModel):
    total: int
    positive: int
    neutral: int
    negative: int
    positive_pct: float
    neutral_pct: float
    negative_pct: float


class SharedIntentRow(BaseModel):
    intent: str
    text_count: int
    call_count: int


class CrossChannelResponse(BaseModel):
    text_channel: ChannelSentimentSummary
    call_channel: ChannelSentimentSummary
    shared_intents: list[SharedIntentRow]
    text_only_intents: list[str]
    call_only_intents: list[str]


class IntentRow(BaseModel):
    intent: str
    count: int
    percentage: float


class IntentDistributionResponse(BaseModel):
    total: int
    intents: list[IntentRow]


class MerchantSentimentRow(BaseModel):
    merchant_name: str
    vertical: Optional[str] = None
    total: int
    positive: int
    neutral: int
    negative: int
    negative_pct: float


class MerchantSentimentResponse(BaseModel):
    merchants: list[MerchantSentimentRow]


class ZoneRow(BaseModel):
    zone: str
    total: int
    negative: int
    negative_pct: float
    top_vertical: Optional[str] = None


class ZoneHeatmapResponse(BaseModel):
    zones: list[ZoneRow]


# ===========================================================================
# Health
# ===========================================================================

class HealthResponse(BaseModel):
    status: str
    database: str
    gemini: str
    version: str = "3.0.0"
    # Which warehouse is behind this deploy, and what it thinks "now" is. The
    # frontend computes its own date windows, so a clock mismatch between the
    # two shows up as inexplicably empty charts — this makes it a one-request
    # diagnosis instead. See app/utils/clock.py.
    warehouse: str = "unknown"
    clock_mode: str = "unknown"
    now: str = ""


# Rebuild forward refs (TextClassificationResponse used in MessageResponse)
MessageResponse.model_rebuild()
