"""
BigQuery persistence for cancellation predictions — acts as a read-through cache
so the same order isn't re-scored (and re-billed to Gemini) on every dashboard load.

Table: `<project>.<bq_calls_dataset>.cancellation_predictions`
Created lazily on first use (no lifespan/bootstrap changes required).
"""

from __future__ import annotations

import json
import logging

from app.config import get_settings
from app.services.bq_client import get_client
from app.utils.helpers import utcnow_iso

logger = logging.getLogger(__name__)

_ensured = False

# Columns mirrored back onto a prediction dict when read from BQ.
_READ_FIELDS = [
    "order_id", "engine", "probability", "risk_level", "flagged", "threshold",
    "top_risk_factors", "gemini_explanation", "recommended_action",
    "restaurant_name", "zone_name", "predicted_at",
]


def _table_id() -> str:
    s = get_settings()
    return f"{s.gcp_project_id}.{s.bq_calls_dataset}.cancellation_predictions"


def ensure_table() -> None:
    """Create the predictions table once per process if it doesn't exist."""
    global _ensured
    if _ensured:
        return
    get_client().query(f"""
        CREATE TABLE IF NOT EXISTS `{_table_id()}` (
            order_id            STRING,
            engine              STRING,
            probability         FLOAT64,
            risk_level          STRING,
            flagged             BOOL,
            threshold           FLOAT64,
            top_risk_factors    STRING,     -- JSON-encoded list
            gemini_explanation  STRING,
            recommended_action  STRING,
            restaurant_name     STRING,
            zone_name           STRING,
            predicted_at        TIMESTAMP
        )
    """).result()
    _ensured = True


def save_predictions(preds: list[dict]) -> None:
    """Persist predictions (only those with an order_id). Best-effort — never raises."""
    rows = [p for p in preds if p.get("order_id")]
    if not rows:
        return
    try:
        ensure_table()
        now = utcnow_iso()
        payload = [{
            "order_id": str(p.get("order_id")),
            "engine": p.get("engine", "model"),
            "probability": p.get("probability"),
            "risk_level": p.get("risk_level"),
            "flagged": p.get("flagged"),
            "threshold": p.get("threshold"),
            "top_risk_factors": json.dumps(p.get("top_risk_factors") or [], default=str),
            "gemini_explanation": p.get("gemini_explanation"),
            "recommended_action": p.get("recommended_action"),
            "restaurant_name": p.get("restaurant_name"),
            "zone_name": p.get("zone_name"),
            "predicted_at": now,
        } for p in rows]
        errors = get_client().insert_rows_json(_table_id(), payload)
        if errors:
            logger.warning("Prediction insert reported errors: %s", errors[:3])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist predictions: %s", exc)


def get_predictions(order_ids: list, engine: str) -> dict:
    """Return the latest stored prediction per order_id for a given engine."""
    ids = [str(i) for i in order_ids if i is not None]
    if not ids:
        return {}
    try:
        ensure_table()
        from google.cloud import bigquery
        cfg = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("engine", "STRING", engine),
            bigquery.ArrayQueryParameter("ids", "STRING", ids),
        ])
        sql = f"""
            SELECT {", ".join(_READ_FIELDS)} FROM (
                SELECT {", ".join(_READ_FIELDS)},
                       ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY predicted_at DESC) AS rn
                FROM `{_table_id()}`
                WHERE engine = @engine AND order_id IN UNNEST(@ids)
            ) WHERE rn = 1
        """
        out: dict[str, dict] = {}
        for r in get_client().query(sql, job_config=cfg).result():
            d = dict(r)
            try:
                d["top_risk_factors"] = json.loads(d.get("top_risk_factors") or "[]")
            except (json.JSONDecodeError, TypeError):
                d["top_risk_factors"] = []
            d["predicted_at"] = str(d.get("predicted_at"))
            d["cached"] = True
            out[d["order_id"]] = d
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read stored predictions: %s", exc)
        return {}
