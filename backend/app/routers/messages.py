import csv
import io
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status

from app.models.enums import SourceChannelEnum
from app.models.schemas import (
    MessageCreate, MessageResponse, MessagesListResponse,
    MessagesUploadRequest, MessagesUploadResponse, TextClassificationResponse,
)
from app.services import db_text as bq
from app.utils.helpers import parse_datetime_or_now, preprocess, utcnow_iso

router = APIRouter(prefix="/api/v1/messages", tags=["messages"])
logger = logging.getLogger(__name__)


def _build_row(msg: MessageCreate) -> dict:
    return {
        "message_id": str(uuid.uuid4()),
        "content": preprocess(msg.content),
        "source_channel": msg.source_channel.value,
        "merchant_name": msg.merchant_name,
        "zone": msg.zone,
        "created_at": parse_datetime_or_now(msg.created_at).isoformat(),
        "ingested_at": utcnow_iso(),
    }


def _row_to_response(row: dict, clf: Optional[dict] = None) -> MessageResponse:
    return MessageResponse(
        message_id=row["message_id"],
        customer_id=row.get("customer_id"),
        content=row["content"],
        source_channel=row["source_channel"],
        merchant_name=row.get("merchant_name"),
        zone=row.get("zone"),
        created_at=str(row.get("created_at", "")),
        ingested_at=str(row.get("ingested_at", "")),
        classification=TextClassificationResponse(**clf) if clf else None,
    )


@router.post("/upload", response_model=MessagesUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_messages(req: MessagesUploadRequest):
    rows = [_build_row(m) for m in req.messages]
    try:
        ids = await bq.insert_messages(rows)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Message insert failed: {exc}")
    return MessagesUploadResponse(ingested=len(ids), skipped=0, message_ids=ids)


@router.post("/upload/csv", response_model=MessagesUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_messages_csv(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows, skipped = [], 0
    valid_channels = {e.value for e in SourceChannelEnum}

    for line in reader:
        content = (line.get("content") or "").strip()
        channel = (line.get("source_channel") or "").strip().lower()
        if not content or channel not in valid_channels:
            skipped += 1
            continue
        rows.append(_build_row(MessageCreate(
            content=content,
            source_channel=SourceChannelEnum(channel),
            merchant_name=(line.get("merchant_name") or "").strip() or None,
            zone=(line.get("zone") or "").strip() or None,
            created_at=(line.get("created_at") or "").strip() or None,
        )))

    if not rows:
        raise HTTPException(status_code=422, detail="No valid rows found in CSV")

    try:
        ids = await bq.insert_messages(rows)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Message insert failed: {exc}")
    return MessagesUploadResponse(ingested=len(ids), skipped=skipped, message_ids=ids)


@router.get("", response_model=MessagesListResponse)
async def list_messages(
    source_channel: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    try:
        total, rows = await bq.query_messages(
            source_channel=source_channel, zone=zone,
            from_date=from_date, to_date=to_date, page=page, page_size=page_size,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return MessagesListResponse(total=total, page=page, page_size=page_size,
                                items=[_row_to_response(r) for r in rows])


@router.get("/{message_id}", response_model=MessageResponse)
async def get_message(message_id: str):
    msg = await bq.get_message(message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    clf = await bq.get_classification_for_message(message_id)
    return _row_to_response(msg, clf)
