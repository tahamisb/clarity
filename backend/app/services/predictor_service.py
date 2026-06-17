"""
Cancellation predictor — model loading, inference, SHAP explanations, and
Gemini-enhanced analysis.

The ML model + feature pipeline are produced by `scripts/train_cancellation_model.py`
and loaded lazily from `artifacts/`. Gemini is reused via `gemini_service.call_with_retry`
(JSON mode) to turn a numeric prediction + SHAP factors into a plain-language
explanation and a recommended action.

If the model artifacts are absent (model not trained yet), the service degrades
gracefully — endpoints return a clear "model unavailable" signal rather than 500s.
"""

from __future__ import annotations

import asyncio
import json
import logging
import warnings
from pathlib import Path
from typing import Any, Optional

# ML libraries (shap/xgboost/…) loaded lazily here still emit a transitive
# pkg_resources DeprecationWarning on first import — scope-silence that one message.
warnings.filterwarnings("ignore", message=r".*pkg_resources is deprecated.*", category=DeprecationWarning)

import numpy as np
import pandas as pd

from app.config import get_settings
from app.services.bq_client import get_client
import re

from app.services import bq_predictions
from app.services.gemini_service import call_with_retry
from app.utils import feature_engineering as fe
from app.utils.helpers import extract_json, strip_markdown_fences, utcnow_iso

logger = logging.getLogger(__name__)

ARTIFACTS_DIR = Path(__file__).resolve().parents[2] / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "cancellation_model.joblib"
PIPELINE_PATH = ARTIFACTS_DIR / "feature_pipeline.joblib"
METRICS_PATH = ARTIFACTS_DIR / "model_metrics.json"
THRESHOLD_PATH = ARTIFACTS_DIR / "threshold_recommendation.json"

DEFAULT_THRESHOLD = 0.5
_TOP_FACTORS = 6
# Cap NEW Gemini scorings per live-queue request so the endpoint can't hang on a
# cold cache (50 LLM calls). Cached predictions are always returned in full;
# uncached ones fill in across loads.
_GEMINI_QUEUE_MAX_NEW = 20

# Lazily-initialised singletons
_model = None
_pipeline = None
_explainer = None
_loaded = False


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def _load() -> bool:
    """Load model + pipeline once. Returns True if both are available."""
    global _model, _pipeline, _loaded
    if _loaded:
        return _model is not None and _pipeline is not None
    _loaded = True
    if not (MODEL_PATH.exists() and PIPELINE_PATH.exists()):
        logger.warning("Cancellation model artifacts not found in %s — predictions disabled.", ARTIFACTS_DIR)
        return False
    try:
        import joblib
        _model = joblib.load(MODEL_PATH)
        _pipeline = joblib.load(PIPELINE_PATH)
        logger.info("Loaded cancellation model + feature pipeline from artifacts.")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to load cancellation model: %s", exc)
        _model = _pipeline = None
        return False


def _get_explainer():
    global _explainer
    if _explainer is None and _model is not None:
        try:
            import shap
            _explainer = shap.TreeExplainer(_model)
        except Exception as exc:  # noqa: BLE001
            logger.warning("SHAP explainer unavailable: %s", exc)
            _explainer = None
    return _explainer


def is_available() -> bool:
    return _load()


def _threshold() -> float:
    if THRESHOLD_PATH.exists():
        try:
            data = json.loads(THRESHOLD_PATH.read_text(encoding="utf-8"))
            return float(data.get("threshold", DEFAULT_THRESHOLD))
        except (json.JSONDecodeError, OSError, ValueError):
            pass
    return DEFAULT_THRESHOLD


def _risk_level(prob: float, threshold: float) -> str:
    if prob >= threshold:
        return "high"
    if prob >= threshold * 0.6:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Frame building + point-in-time history lookup
# ---------------------------------------------------------------------------

def _orders_to_frame(orders: list[dict]) -> pd.DataFrame:
    cols = fe.RAW_COLUMNS + fe.HISTORICAL_FEATURES
    df = pd.DataFrame(orders)
    return df.reindex(columns=cols)


def _T() -> str:
    s = get_settings()
    return f"`{s.gcp_project_id}.{s.bq_calls_dataset}.vendor_kpi`"


def _fill_history(df: pd.DataFrame) -> pd.DataFrame:
    """
    Best-effort point-in-time fill for the rolling features when the caller did
    not supply them. Uses recent aggregates from BigQuery; any failure leaves
    NaN, which the saved pipeline imputes. Not strictly windowed — adequate for
    live scoring where the goal is a current risk estimate.
    """
    need = df[fe.HISTORICAL_FEATURES].isna().all(axis=None)
    if not need:
        return df

    vendor_ids = [int(v) for v in df["vendor_id"].dropna().unique().tolist()]
    zones = [str(z) for z in df["zone_name"].dropna().unique().tolist()]
    customers = [int(c) for c in df["customer_id"].dropna().unique().tolist()]

    try:
        vendor_stats, zone_stats, cust_stats = {}, {}, {}
        if vendor_ids:
            rows = [dict(r) for r in get_client().query(f"""
                SELECT vendor_id,
                  SAFE_DIVIDE(COUNTIF(order_status='Cancelled'), COUNT(*)) AS vendor_cancel_rate_30d,
                  AVG(preparing_time_min) AS vendor_avg_prep_time
                FROM {_T()}
                WHERE vendor_id IN UNNEST({vendor_ids})
                GROUP BY vendor_id
            """).result()]
            vendor_stats = {r["vendor_id"]: r for r in rows}
        if zones:
            rows = [dict(r) for r in get_client().query(f"""
                SELECT zone_name,
                  SAFE_DIVIDE(COUNTIF(order_status='Cancelled'), COUNT(*)) AS zone_cancel_rate_30d
                FROM {_T()}
                WHERE zone_name IN UNNEST({json.dumps(zones)})
                GROUP BY zone_name
            """).result()]
            zone_stats = {r["zone_name"]: r for r in rows}
        if customers:
            rows = [dict(r) for r in get_client().query(f"""
                SELECT customer_id, COUNT(*) AS customer_order_count
                FROM {_T()}
                WHERE customer_id IN UNNEST({customers})
                GROUP BY customer_id
            """).result()]
            cust_stats = {r["customer_id"]: r for r in rows}

        def fill(row):
            v = vendor_stats.get(row["vendor_id"], {})
            z = zone_stats.get(row["zone_name"], {})
            c = cust_stats.get(row["customer_id"], {})
            if pd.isna(row["vendor_cancel_rate_30d"]):
                row["vendor_cancel_rate_30d"] = v.get("vendor_cancel_rate_30d")
            if pd.isna(row["vendor_avg_prep_time"]):
                row["vendor_avg_prep_time"] = v.get("vendor_avg_prep_time")
            if pd.isna(row["zone_cancel_rate_30d"]):
                row["zone_cancel_rate_30d"] = z.get("zone_cancel_rate_30d")
            if pd.isna(row["customer_order_count"]):
                row["customer_order_count"] = c.get("customer_order_count")
            return row

        df = df.apply(fill, axis=1)
    except Exception as exc:  # noqa: BLE001
        logger.warning("History lookup failed (features left for imputation): %s", exc)
    return df


# ---------------------------------------------------------------------------
# Core scoring
# ---------------------------------------------------------------------------

def _shap_factors(X_trans, feature_names: list[str]) -> list[dict]:
    explainer = _get_explainer()
    if explainer is None:
        # Fall back to global feature importance
        importances = getattr(_model, "feature_importances_", None)
        if importances is None:
            return []
        order = np.argsort(importances)[::-1][:_TOP_FACTORS]
        return [
            {"feature": feature_names[i], "value": None,
             "contribution": float(importances[i]), "direction": "increases_risk"}
            for i in order
        ]
    try:
        vals = explainer.shap_values(X_trans)
        if isinstance(vals, list):  # some explainers return [class0, class1]
            vals = vals[-1]
        row = np.asarray(vals)[0]
        order = np.argsort(np.abs(row))[::-1][:_TOP_FACTORS]
        return [
            {"feature": feature_names[i], "value": None,
             "contribution": float(row[i]),
             "direction": "increases_risk" if row[i] > 0 else "decreases_risk"}
            for i in order
        ]
    except Exception as exc:  # noqa: BLE001
        logger.warning("SHAP computation failed: %s", exc)
        return []


def _score_frame(df: pd.DataFrame) -> list[dict]:
    """Run the pipeline + model on a raw-order frame. Returns per-row dicts."""
    df = _fill_history(df)
    X = fe.transform(df, training=False)
    X_trans = _pipeline.transform(X)
    probs = _model.predict_proba(X_trans)[:, 1]
    feature_names = fe.get_feature_names(_pipeline)
    threshold = _threshold()

    results = []
    for i in range(len(df)):
        prob = float(probs[i])
        # SHAP per row (slice the single row for explanation)
        factors = _shap_factors(X_trans[i:i + 1], feature_names)
        oid = df.iloc[i].get("id")
        results.append({
            "order_id": str(oid) if oid is not None and not pd.isna(oid) else None,
            "probability": round(prob, 4),
            "risk_level": _risk_level(prob, threshold),
            "threshold": threshold,
            "flagged": prob >= threshold,
            "top_risk_factors": factors,
            "gemini_explanation": None,
            "recommended_action": None,
        })
    return results


# ---------------------------------------------------------------------------
# Gemini enhancement
# ---------------------------------------------------------------------------

_EXPLAIN_PROMPT = """\
You are an operations analyst for Rafeeq, a food-delivery platform in Qatar.
A machine-learning model scored a food-delivery order with a {pct:.0%} chance of being cancelled.
Top contributing factors (SHAP, positive = pushes toward cancellation): {factors}
Order details: {order}

Respond with STRICT JSON only:
{{
  "explanation": "<2-3 sentences: why this order is at risk>",
  "recommended_action": "<one specific action the ops team can take right now>"
}}
"""


async def _augment_with_gemini(prediction: dict, order: dict) -> dict:
    factors = ", ".join(
        f"{f['feature']} ({f['direction']})" for f in prediction.get("top_risk_factors", [])[:5]
    ) or "none"
    prompt = _EXPLAIN_PROMPT.format(
        pct=prediction["probability"],
        factors=factors,
        order=json.dumps({k: v for k, v in order.items() if v is not None}, default=str),
    )
    try:
        raw = await call_with_retry(prompt)
        parsed = _parse_gemini_json(raw)
        prediction["gemini_explanation"] = parsed.get("explanation")
        prediction["recommended_action"] = parsed.get("recommended_action")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini explanation failed: %s", exc)
        prediction["gemini_explanation"] = None
        prediction["recommended_action"] = None
    return prediction


def _parse_gemini_json(raw: str) -> dict:
    """
    Parse a Gemini JSON response tolerantly. Falls back to regex salvage of the
    key fields when the model emits not-quite-valid JSON (missing commas,
    unescaped quotes in free text, etc.).
    """
    try:
        return extract_json(raw)
    except json.JSONDecodeError:
        pass

    text = strip_markdown_fences(raw)
    out: dict = {}
    m = re.search(r'"probability"\s*:\s*([0-9.]+)', text)
    if m:
        out["probability"] = float(m.group(1))
    m = re.search(r'"explanation"\s*:\s*"(.*?)"\s*[,}\n]', text, re.S)
    if m:
        out["explanation"] = m.group(1).strip()
    m = re.search(r'"recommended_action"\s*:\s*"(.*?)"\s*[,}\n]', text, re.S)
    if m:
        out["recommended_action"] = m.group(1).strip()
    if not out:
        logger.warning("Gemini JSON unparseable; raw head: %s", text[:160])
    return out


# ---------------------------------------------------------------------------
# Gemini prediction engine (LLM-only — used as a fallback / comparison)
# ---------------------------------------------------------------------------

_GEMINI_PREDICT_PROMPT = """\
You are a cancellation-risk estimator for Rafeeq, a food-delivery platform in Qatar.
Estimate the probability (0.0–1.0) that the following order will be CANCELLED, using
food-delivery domain knowledge and the supplied signals — especially the vendor's and
zone's historical cancellation rates when present.

ORDER SIGNALS:
{order}

Respond with STRICT JSON only:
{{
  "probability": <float between 0 and 1>,
  "top_risk_factors": [
    {{"feature": "<signal name>", "direction": "increases_risk" | "decreases_risk", "reason": "<short>"}}
  ],
  "explanation": "<2-3 sentences on why this order is at risk>",
  "recommended_action": "<one specific action ops can take now>"
}}
Base the estimate strictly on the signals; do not invent values.
"""

# Signals shown to Gemini (placement-time + looked-up history; never post-delivery).
_GEMINI_SIGNAL_FIELDS = [
    "restaurant_name", "cuisine", "zone_name", "customer_zone", "platform_name",
    "total_order_value", "delivery_charge", "vendor_to_customer_dist", "driver_vendor_dist",
    "is_pre_order", "new_customer", "is_pro_user", "payment_type", "customer_device_type",
    "order_placement_time", "rafeeq_time_to_accept_order_min", "vendor_to_accept_order_min",
    "vendor_cancel_rate_30d", "zone_cancel_rate_30d", "customer_order_count", "vendor_avg_prep_time",
]


async def _gemini_score_row(row: dict, order_id, threshold: float) -> dict:
    """Score a SINGLE already-history-filled row with Gemini (no BigQuery here)."""
    signals = {k: row.get(k) for k in _GEMINI_SIGNAL_FIELDS
               if row.get(k) is not None and not (isinstance(row.get(k), float) and np.isnan(row.get(k)))}
    prompt = _GEMINI_PREDICT_PROMPT.format(order=json.dumps(signals, default=str))

    pred = {
        "order_id": str(order_id) if order_id is not None else None,
        "probability": 0.0, "risk_level": "low", "threshold": threshold, "flagged": False,
        "top_risk_factors": [], "gemini_explanation": None, "recommended_action": None,
        "engine": "gemini",
    }
    try:
        parsed = _parse_gemini_json(await call_with_retry(prompt))
        prob = max(0.0, min(1.0, float(parsed.get("probability", 0.0))))
        factors = [
            {"feature": f.get("feature", "?"), "value": f.get("reason"),
             "contribution": 0.0, "direction": f.get("direction", "increases_risk")}
            for f in parsed.get("top_risk_factors", [])[:_TOP_FACTORS]
        ]
        pred.update({
            "probability": round(prob, 4),
            "risk_level": _risk_level(prob, threshold),
            "flagged": prob >= threshold,
            "top_risk_factors": factors,
            "gemini_explanation": parsed.get("explanation"),
            "recommended_action": parsed.get("recommended_action"),
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini prediction failed: %s", exc)
        pred["gemini_explanation"] = "Gemini prediction failed to parse."
    return pred


async def predict_one_gemini(order: dict) -> dict:
    """LLM-based risk estimate for one order. Works without a trained model."""
    loop = asyncio.get_running_loop()
    # Enrich with real vendor/zone/customer history so the estimate is grounded.
    df = _orders_to_frame([order])
    df = await loop.run_in_executor(None, _fill_history, df)
    return await _gemini_score_row(df.iloc[0].to_dict(), order.get("id"), _threshold())


def _resolve_engine(engine: str) -> str:
    """Decide which engine actually runs. 'auto' uses the model if trained, else Gemini."""
    engine = (engine or "auto").lower()
    if engine == "model":
        if not _load():
            raise ModelUnavailable()
        return "model"
    if engine == "gemini":
        return "gemini"
    # auto
    return "model" if _load() else "gemini"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def _persist(preds: list[dict]) -> None:
    """Fire-and-forget save of predictions that carry an order_id."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, bq_predictions.save_predictions, preds)


async def predict_one(order: dict, engine: str = "auto", with_gemini: bool = True) -> dict:
    if _resolve_engine(engine) == "gemini":
        pred = await predict_one_gemini(order)
        await _persist([pred])
        return pred
    loop = asyncio.get_running_loop()
    df = _orders_to_frame([order])
    results = await loop.run_in_executor(None, _score_frame, df)
    pred = results[0]
    pred["engine"] = "model"
    if with_gemini:
        pred = await _augment_with_gemini(pred, order)
    await _persist([pred])
    return pred


async def predict_batch(orders: list[dict], engine: str = "auto") -> dict:
    if _resolve_engine(engine) == "gemini":
        preds = list(await asyncio.gather(*[predict_one_gemini(o) for o in orders]))
        await _persist(preds)
        return {"count": len(preds), "threshold": _threshold(), "engine": "gemini", "predictions": preds}
    loop = asyncio.get_running_loop()
    df = _orders_to_frame(orders)
    results = await loop.run_in_executor(None, _score_frame, df)
    for r in results:
        r["engine"] = "model"
    await _persist(results)
    return {"count": len(results), "threshold": _threshold(), "engine": "model", "predictions": results}


def _fetch_live_orders_sync(limit: int) -> list[dict]:
    """Active (non-terminal) orders, falling back to the most recent orders."""
    cols = ", ".join(fe.RAW_COLUMNS + ["restaurant_name"])  # restaurant_name is display-only
    # Tolerant 'active' filter: anything not clearly delivered/cancelled.
    active = "NOT (LOWER(TRIM(order_status)) LIKE '%cancel%' OR LOWER(TRIM(order_status)) LIKE '%deliver%')"
    rows = [dict(r) for r in get_client().query(f"""
        SELECT {cols}
        FROM {_T()}
        WHERE {active}
        ORDER BY order_placement_date DESC, order_placement_time DESC
        LIMIT {limit}
    """).result()]
    if not rows:
        rows = [dict(r) for r in get_client().query(f"""
            SELECT {cols}
            FROM {_T()}
            ORDER BY order_placement_date DESC, order_placement_time DESC
            LIMIT {limit}
        """).result()]
    return rows


def _attach_context(pred: dict, order: dict) -> dict:
    pred["restaurant_name"] = order.get("restaurant_name")
    pred["zone_name"] = order.get("zone_name")
    return pred


async def live_queue(limit: int = 50, engine: str = "auto") -> dict:
    threshold = _threshold()
    empty = {"count": 0, "threshold": threshold, "engine": "none", "generated_at": utcnow_iso(), "orders": []}

    # On 'auto' with no trained model, don't silently mass-score with Gemini.
    if engine == "auto" and not _load():
        return empty

    used = _resolve_engine(engine)  # raises ModelUnavailable only when engine == "model"
    loop = asyncio.get_running_loop()
    orders = await loop.run_in_executor(None, _fetch_live_orders_sync, limit)
    if not orders:
        return {**empty, "engine": used}

    by_id = {str(o["id"]): o for o in orders if o.get("id") is not None}

    # Read-through cache: reuse any prediction already stored for these orders.
    stored = await loop.run_in_executor(None, bq_predictions.get_predictions, list(by_id.keys()), used)
    results: list[dict] = [_attach_context(stored[oid], by_id[oid]) for oid in stored if oid in by_id]

    uncached = [o for o in orders if str(o.get("id")) not in stored]
    new_preds: list[dict] = []

    if uncached:
        if used == "gemini":
            # Batch the history lookup ONCE (3 queries total), then score the
            # capped batch concurrently — no per-order BigQuery round-trips.
            batch = uncached[:_GEMINI_QUEUE_MAX_NEW]
            df = await loop.run_in_executor(None, _fill_history, _orders_to_frame(batch))
            rows = [df.iloc[i].to_dict() for i in range(len(df))]
            scored = await asyncio.gather(
                *[_gemini_score_row(rows[i], batch[i].get("id"), threshold) for i in range(len(batch))]
            )
            new_preds = [_attach_context(p, o) for p, o in zip(scored, batch)]
            if len(uncached) > len(batch):
                logger.info("Live queue: scored %d new orders, %d more will fill in on the next load.",
                            len(batch), len(uncached) - len(batch))
        else:
            preds = await loop.run_in_executor(None, _score_frame, _orders_to_frame(uncached))
            for p in preds:
                p["engine"] = "model"
            new_preds = [_attach_context(p, o) for p, o in zip(preds, uncached)]

        results.extend(new_preds)
        if new_preds:
            await _persist(new_preds)

    results.sort(key=lambda r: r["probability"], reverse=True)
    return {"count": len(results), "threshold": threshold, "engine": used,
            "generated_at": utcnow_iso(), "orders": results}


def _fetch_order_sync(order_id: str) -> Optional[dict]:
    cols = ", ".join(fe.RAW_COLUMNS + ["restaurant_name"])
    rows = [dict(r) for r in get_client().query(f"""
        SELECT {cols} FROM {_T()} WHERE CAST(id AS STRING) = @oid LIMIT 1
    """, job_config=_id_param(order_id)).result()]
    return rows[0] if rows else None


def _id_param(order_id: str):
    from google.cloud import bigquery
    return bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("oid", "STRING", order_id)]
    )


async def explain_order(order_id: str, engine: str = "auto") -> Optional[dict]:
    used = _resolve_engine(engine)
    loop = asyncio.get_running_loop()

    # Reuse a stored prediction if it already carries a natural-language explanation.
    stored = await loop.run_in_executor(None, bq_predictions.get_predictions, [order_id], used)
    cached = stored.get(str(order_id))
    if cached and cached.get("gemini_explanation"):
        return cached

    order = await loop.run_in_executor(None, _fetch_order_sync, order_id)
    if order is None:
        return None

    if used == "gemini":
        pred = await predict_one_gemini(order)
        pred["order_id"] = str(order_id)
    else:
        results = await loop.run_in_executor(None, _score_frame, _orders_to_frame([order]))
        pred = results[0]
        pred["engine"] = "model"
        pred = await _augment_with_gemini(pred, order)  # model row needs an on-demand explanation

    pred = _attach_context(pred, order)
    await _persist([pred])
    return pred


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------

def model_info() -> dict:
    available = _load()
    metrics = {}
    if METRICS_PATH.exists():
        try:
            metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            metrics = {}
    return {
        "available": available,
        "algorithm": metrics.get("algorithm"),
        "version": metrics.get("version"),
        "trained_at": metrics.get("trained_at"),
        "roc_auc": metrics.get("roc_auc"),
        "threshold": _threshold() if available else None,
        "n_features": metrics.get("n_features"),
        "n_training_rows": metrics.get("n_training_rows"),
    }


def model_health() -> dict:
    artifacts_present = MODEL_PATH.exists() and PIPELINE_PATH.exists()
    loaded = _load()
    return {
        "status": "ready" if loaded else "unavailable",
        "model_loaded": loaded,
        "artifacts_present": artifacts_present,
        "detail": None if loaded else f"Model artifacts not found in {ARTIFACTS_DIR}. Run scripts/train_cancellation_model.py.",
    }


class ModelUnavailable(RuntimeError):
    """Raised when prediction is requested but the model has not been trained."""

    def __init__(self):
        super().__init__(
            "Cancellation model is not available. Train it first: "
            "python scripts/train_cancellation_model.py"
        )
