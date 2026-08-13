"""
Cancellation-prediction storage — acts as a read-through cache so the same order
isn't re-scored (and re-billed to Gemini) on every dashboard load.

Table: `cancellation_predictions` in the local SQLite warehouse. The generator
pre-seeds a prediction for every live order, so a fresh install serves the whole
risk queue without a single LLM call.
"""

from __future__ import annotations

import json
import logging

from app.services import warehouse as db
from app.utils.helpers import utcnow_iso

logger = logging.getLogger(__name__)

# Columns mirrored back onto a prediction dict when read from storage.
_READ_FIELDS = [
    "order_id", "engine", "probability", "risk_level", "flagged", "threshold",
    "top_risk_factors", "gemini_explanation", "recommended_action",
    "restaurant_name", "zone_name", "predicted_at",
]


def save_predictions(preds: list[dict]) -> None:
    """Persist predictions (only those with an order_id). Best-effort — never raises."""
    rows = [p for p in preds if p.get("order_id")]
    if not rows:
        return
    try:
        now = utcnow_iso()
        db.insert_rows("cancellation_predictions", [{
            "order_id": str(p.get("order_id")),
            "engine": p.get("engine", "model"),
            "probability": p.get("probability"),
            "risk_level": p.get("risk_level"),
            # A real bool, not int(bool(...)): SQLite stores it as 0/1 either
            # way, but Postgres will not implicitly coerce an integer into a
            # boolean column and the insert fails outright.
            "flagged": bool(p.get("flagged")),
            "threshold": p.get("threshold"),
            "top_risk_factors": json.dumps(p.get("top_risk_factors") or [], default=str),
            "gemini_explanation": p.get("gemini_explanation"),
            "recommended_action": p.get("recommended_action"),
            "restaurant_name": p.get("restaurant_name"),
            "zone_name": p.get("zone_name"),
            "predicted_at": now,
        } for p in rows])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist predictions: %s", exc)


def get_predictions(order_ids: list, engine: str) -> dict:
    """Return the latest stored prediction per order_id for a given engine."""
    ids = [str(i) for i in order_ids if i is not None]
    if not ids:
        return {}
    try:
        cols = ", ".join(_READ_FIELDS)
        rows = db.query(f"""
            SELECT {cols} FROM (
                SELECT {cols},
                       ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY predicted_at DESC) AS rn
                FROM cancellation_predictions
                WHERE engine = ? AND order_id IN ({db.placeholders(ids)})
            ) WHERE rn = 1
        """, (engine, *ids))
        out: dict[str, dict] = {}
        for d in rows:
            try:
                d["top_risk_factors"] = json.loads(d.get("top_risk_factors") or "[]")
            except (json.JSONDecodeError, TypeError):
                d["top_risk_factors"] = []
            d["flagged"] = bool(d.get("flagged"))
            d["predicted_at"] = str(d.get("predicted_at"))
            d["cached"] = True
            out[d["order_id"]] = d
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read stored predictions: %s", exc)
        return {}
