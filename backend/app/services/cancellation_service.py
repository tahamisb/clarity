"""
Cancellation analytics, Gemini drivers-report generation, and interactive chat.

Analytics functions follow the existing service convention exactly: a synchronous
`_xxx_sync()` built on `_run(sql)`, wrapped by an async function that offloads to
a thread. These same functions are reused by `scripts/explore_cancellations.py`
to materialise the artifact JSONs — single source of truth.

Gemini is reused via the existing modules:
- `gemini_service.call_with_retry` for the structured (JSON) drivers report.
- `chat_service.chat_with_data` for free-text Q&A grounded on cancellation data.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

from app.config import get_settings
from app.services.bq_client import get_client
from app.services.chat_service import chat_with_data
from app.services.gemini_service import call_with_retry
from app.utils.helpers import extract_json, utcnow_iso

logger = logging.getLogger(__name__)

ARTIFACTS_DIR = Path(__file__).resolve().parents[2] / "artifacts"
REPORT_PATH = ARTIFACTS_DIR / "cancellation_drivers_report.json"
FEATURE_IMPORTANCE_PATH = ARTIFACTS_DIR / "feature_importance.json"
THRESHOLD_ANALYSIS_PATH = ARTIFACTS_DIR / "threshold_analysis.json"


def _T() -> str:
    s = get_settings()
    return f"`{s.gcp_project_id}.{s.bq_calls_dataset}.vendor_kpi`"


# Cancellation detection is tolerant of casing/spelling variants in order_status
# ('Cancelled', 'Canceled', 'CANCELLED', 'Cancelled by customer', …).
_CANCELLED = "LOWER(TRIM(order_status)) LIKE '%cancel%'"


def _date_pred(start: str | None, end: str | None, col: str = "order_placement_date") -> str:
    """
    A ` AND <col> BETWEEN …` fragment for the selected window, appended to an
    existing WHERE clause. Returns "" when unbounded. `start`/`end` are validated
    as YYYY-MM-DD by the router before reaching here, so interpolation is safe.
    """
    parts: list[str] = []
    if start:
        parts.append(f"{col} >= DATE('{start}')")
    if end:
        parts.append(f"{col} <= DATE('{end}')")
    return (" AND " + " AND ".join(parts)) if parts else ""


def _run(sql: str) -> list[dict]:
    return [dict(r) for r in get_client().query(sql).result()]


# ---------------------------------------------------------------------------
# Lightweight TTL cache — analytics queries hit a very large table and the
# dashboard fetches all of them on every load. 5-minute cache keeps repeat
# loads (and the Gemini report's context) fast. Cleared by refresh_all().
# ---------------------------------------------------------------------------

_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL_S = 300


async def _cached(key: str, make_coro) -> object:
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _CACHE_TTL_S:
        return hit[1]
    value = await make_coro()
    _CACHE[key] = (now, value)
    return value


def clear_cache() -> None:
    _CACHE.clear()


# ---------------------------------------------------------------------------
# Exploration analytics — one function per artifact JSON
# ---------------------------------------------------------------------------

def _trend_sync(start: str | None = None, end: str | None = None) -> dict:
    pred = _date_pred(start, end)
    monthly = _run(f"""
        SELECT FORMAT_DATE('%Y-%m', order_placement_date) AS period,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct
        FROM {_T()}
        WHERE order_placement_date IS NOT NULL{pred}
        GROUP BY period ORDER BY period
    """)
    weekly = _run(f"""
        SELECT FORMAT_DATE('%G-W%V', order_placement_date) AS period,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct
        FROM {_T()}
        WHERE order_placement_date IS NOT NULL{pred}
        GROUP BY period ORDER BY period
    """)
    return {"monthly": monthly, "weekly": weekly}


def _by_merchant_sync(start: str | None = None, end: str | None = None) -> dict:
    pred = _date_pred(start, end)
    base = f"""
        SELECT restaurant_name,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct,
          ROUND(AVG(total_order_value), 2)                                          AS avg_order_value
        FROM {_T()}
        WHERE restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''{pred}
        GROUP BY restaurant_name
        HAVING total_orders >= 30
    """
    by_volume = _run(f"{base} ORDER BY cancelled DESC LIMIT 20")
    by_rate = _run(f"{base} ORDER BY cancel_rate_pct DESC, total_orders DESC LIMIT 20")
    return {"by_volume": by_volume, "by_rate": by_rate}


def _by_zone_sync(start: str | None = None, end: str | None = None) -> dict:
    pred = _date_pred(start, end)

    def q(col: str) -> list[dict]:
        return _run(f"""
            SELECT {col} AS zone,
              COUNT(*)                                                                  AS total_orders,
              COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
              ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct
            FROM {_T()}
            WHERE {col} IS NOT NULL AND TRIM(CAST({col} AS STRING)) != ''{pred}
            GROUP BY zone
            HAVING total_orders >= 20
            ORDER BY total_orders DESC LIMIT 30
        """)
    return {"by_zone_name": q("zone_name"), "by_customer_zone": q("customer_zone")}


def _by_time_sync(start: str | None = None, end: str | None = None) -> list[dict]:
    pred = _date_pred(start, end)
    return _run(f"""
        WITH bucketed AS (
          SELECT order_status,
            CASE
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 6  AND 10 THEN 'Morning'
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 11 AND 13 THEN 'Lunch'
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 14 AND 16 THEN 'Afternoon'
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 17 AND 20 THEN 'Dinner'
              ELSE 'Late Night'
            END AS time_bucket
          FROM {_T()}
          WHERE order_placement_time IS NOT NULL{pred}
        )
        SELECT time_bucket,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct
        FROM bucketed
        GROUP BY time_bucket
        ORDER BY cancel_rate_pct DESC
    """)


def _by_dow_sync(start: str | None = None, end: str | None = None) -> list[dict]:
    pred = _date_pred(start, end)
    return _run(f"""
        SELECT FORMAT_DATE('%A', order_placement_date)  AS day_of_week,
          EXTRACT(DAYOFWEEK FROM order_placement_date)  AS dow_index,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct
        FROM {_T()}
        WHERE order_placement_date IS NOT NULL{pred}
        GROUP BY day_of_week, dow_index
        ORDER BY dow_index
    """)


def _by_order_size_sync(start: str | None = None, end: str | None = None) -> list[dict]:
    pred = _date_pred(start, end)
    return _run(f"""
        WITH q AS (
          SELECT total_order_value, order_status,
            NTILE(4) OVER (ORDER BY total_order_value) AS quartile
          FROM {_T()}
          WHERE total_order_value IS NOT NULL{pred}
        )
        SELECT quartile,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct,
          ROUND(MIN(total_order_value), 2)                                          AS min_value,
          ROUND(MAX(total_order_value), 2)                                          AS max_value
        FROM q GROUP BY quartile ORDER BY quartile
    """)


def _by_actor_sync(start: str | None = None, end: str | None = None) -> list[dict]:
    pred = _date_pred(start, end)
    return _run(f"""
        SELECT COALESCE(NULLIF(TRIM(cancelled_by_txt), ''), 'Unknown') AS cancelled_by,
          COUNT(*)                                  AS cancellations,
          ROUND(AVG(total_order_value), 2)          AS avg_order_value
        FROM {_T()}
        WHERE {_CANCELLED}{pred}
        GROUP BY cancelled_by
        ORDER BY cancellations DESC
    """)


def _crosstabs_sync(start: str | None = None, end: str | None = None) -> dict:
    pred = _date_pred(start, end)
    zone_time = _run(f"""
        WITH bucketed AS (
          SELECT order_status, zone_name,
            CASE
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 6  AND 10 THEN 'Morning'
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 11 AND 13 THEN 'Lunch'
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 14 AND 16 THEN 'Afternoon'
              WHEN EXTRACT(HOUR FROM order_placement_time) BETWEEN 17 AND 20 THEN 'Dinner'
              ELSE 'Late Night'
            END AS time_bucket
          FROM {_T()}
          WHERE order_placement_time IS NOT NULL AND zone_name IS NOT NULL AND TRIM(zone_name) != ''{pred}
        )
        SELECT zone_name, time_bucket,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct
        FROM bucketed
        GROUP BY zone_name, time_bucket
        HAVING total_orders >= 20
        ORDER BY cancel_rate_pct DESC LIMIT 20
    """)
    merchant_dow = _run(f"""
        SELECT restaurant_name, FORMAT_DATE('%A', order_placement_date) AS day_of_week,
          COUNT(*)                                                                  AS total_orders,
          COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%')                                       AS cancelled,
          ROUND(SAFE_DIVIDE(COUNTIF(LOWER(TRIM(order_status)) LIKE '%cancel%'), COUNT(*)) * 100, 2)  AS cancel_rate_pct
        FROM {_T()}
        WHERE order_placement_date IS NOT NULL AND restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''{pred}
        GROUP BY restaurant_name, day_of_week
        HAVING total_orders >= 20
        ORDER BY cancel_rate_pct DESC LIMIT 20
    """)
    return {"zone_x_time": zone_time, "merchant_x_dow": merchant_dow}


# ---------------------------------------------------------------------------
# Async wrappers
# ---------------------------------------------------------------------------

async def _run_async(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)


def _key(base: str, start: str | None, end: str | None) -> str:
    return f"{base}:{start or ''}:{end or ''}"


async def get_trend(start: str | None = None, end: str | None = None) -> dict:
    return await _cached(_key("trend", start, end), lambda: _run_async(_trend_sync, start, end))


async def get_by_merchant(start: str | None = None, end: str | None = None) -> dict:
    return await _cached(_key("by_merchant", start, end), lambda: _run_async(_by_merchant_sync, start, end))


async def get_by_zone(start: str | None = None, end: str | None = None) -> dict:
    return await _cached(_key("by_zone", start, end), lambda: _run_async(_by_zone_sync, start, end))


async def get_by_time(start: str | None = None, end: str | None = None) -> list[dict]:
    return await _cached(_key("by_time", start, end), lambda: _run_async(_by_time_sync, start, end))


async def get_by_dow(start: str | None = None, end: str | None = None) -> list[dict]:
    return await _cached(_key("by_dow", start, end), lambda: _run_async(_by_dow_sync, start, end))


async def get_by_order_size(start: str | None = None, end: str | None = None) -> list[dict]:
    return await _cached(_key("by_order_size", start, end), lambda: _run_async(_by_order_size_sync, start, end))


async def get_by_actor(start: str | None = None, end: str | None = None) -> list[dict]:
    return await _cached(_key("by_actor", start, end), lambda: _run_async(_by_actor_sync, start, end))


async def get_crosstabs(start: str | None = None, end: str | None = None) -> dict:
    return await _cached(_key("crosstabs", start, end), lambda: _run_async(_crosstabs_sync, start, end))


# Mapping used by the exploration script to write artifact JSONs.
EXPLORATION_FUNCS: dict[str, callable] = {
    "cancellation_trend": _trend_sync,
    "cancellation_by_merchant": _by_merchant_sync,
    "cancellation_by_zone": _by_zone_sync,
    "cancellation_by_time": _by_time_sync,
    "cancellation_by_dow": _by_dow_sync,
    "cancellation_by_order_size": _by_order_size_sync,
    "cancellation_by_actor": _by_actor_sync,
    "cancellation_crosstabs": _crosstabs_sync,
}


async def get_exploration_context() -> dict:
    """All exploration summaries in parallel — context for Gemini report/chat."""
    keys = ["trend", "by_merchant", "by_zone", "by_time", "by_dow", "by_order_size", "by_actor", "crosstabs"]
    funcs = [get_trend(), get_by_merchant(), get_by_zone(), get_by_time(),
             get_by_dow(), get_by_order_size(), get_by_actor(), get_crosstabs()]
    results = await asyncio.gather(*funcs, return_exceptions=True)
    out: dict = {}
    for k, r in zip(keys, results):
        out[k] = {} if isinstance(r, Exception) else r
        if isinstance(r, Exception):
            logger.warning("Exploration query '%s' failed: %s", k, r)
    return out


# ---------------------------------------------------------------------------
# Artifact helpers
# ---------------------------------------------------------------------------

def _load_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Could not read artifact %s: %s", path, exc)
        return None


def load_feature_importance() -> dict | None:
    return _load_json(FEATURE_IMPORTANCE_PATH)


def load_threshold_analysis() -> dict | None:
    return _load_json(THRESHOLD_ANALYSIS_PATH)


# ---------------------------------------------------------------------------
# Gemini — drivers report (structured JSON)
# ---------------------------------------------------------------------------

_REPORT_PROMPT = """\
You are a senior operations analyst for Rafeeq, a food-delivery platform in Qatar.
Below is aggregated cancellation data and (optionally) ML feature-importance.
Produce a Cancellation Drivers Report as STRICT JSON — no markdown, no prose outside JSON.

DATA:
{context}

Return EXACTLY this JSON shape:
{{
  "executive_summary": "<3-4 sentence overview of the cancellation situation and the single biggest lever>",
  "top_drivers": [
    {{"name": "<driver>", "importance": <0..1 float>, "explanation": "<plain English>", "recommendation": "<specific action>"}}
  ],
  "high_risk_segments": [
    {{"segment": "<e.g. 'Late Night orders in Zone X'>", "cancel_rate": <percent float or null>, "recommendation": "<action>"}}
  ],
  "trend_insight": "<1-2 sentences on the trend direction and what it implies>",
  "generated_at": "{generated_at}"
}}

Rules:
- top_drivers: up to 10, ranked most-to-least important.
- high_risk_segments: up to 5.
- Base every statement strictly on the provided data. Do not invent numbers.
"""


async def generate_drivers_report() -> dict:
    """Generate the structured drivers report via Gemini and cache it to artifacts."""
    context = await get_exploration_context()
    feature_importance = load_feature_importance()
    payload = {"exploration": context, "feature_importance": feature_importance}
    generated_at = utcnow_iso()

    prompt = _REPORT_PROMPT.format(
        context=json.dumps(payload, indent=2, default=str),
        generated_at=generated_at,
    )

    raw = await call_with_retry(prompt)
    try:
        report = extract_json(raw)
    except json.JSONDecodeError as exc:
        logger.error("Gemini drivers-report returned non-JSON: %s", exc)
        report = {
            "executive_summary": "Report generation failed to parse. Raw model output stored in detail.",
            "top_drivers": [],
            "high_risk_segments": [],
            "trend_insight": "",
            "generated_at": generated_at,
            "detail": raw[:2000],
        }

    report.setdefault("generated_at", generated_at)

    try:
        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        REPORT_PATH.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not cache drivers report: %s", exc)

    return report


async def get_drivers_report(force: bool = False) -> dict:
    """Return the cached report, generating it on first request (or when forced)."""
    if not force:
        cached = _load_json(REPORT_PATH)
        if cached:
            return cached
    return await generate_drivers_report()


# ---------------------------------------------------------------------------
# Gemini — interactive cancellation chat
# ---------------------------------------------------------------------------

async def answer_question(question: str) -> str:
    """Free-text Q&A grounded on the live cancellation exploration data."""
    context = await get_exploration_context()
    context_data = {"cancellation_analytics": context}
    messages = [{"role": "user", "text": question}]
    return await chat_with_data(messages, context_data)


# ---------------------------------------------------------------------------
# Refresh — re-run exploration to artifacts + regenerate report
# ---------------------------------------------------------------------------

def write_exploration_artifacts() -> list[str]:
    """Run every exploration query and write its JSON to artifacts/. Returns filenames."""
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for name, fn in EXPLORATION_FUNCS.items():
        try:
            data = fn()
            path = ARTIFACTS_DIR / f"{name}.json"
            path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
            written.append(path.name)
        except Exception as exc:  # noqa: BLE001 — one bad query shouldn't abort the rest
            logger.error("Exploration '%s' failed: %s", name, exc)
    return written


async def refresh_all() -> dict:
    """Re-run exploration (write JSONs) then regenerate the Gemini drivers report."""
    clear_cache()
    loop = asyncio.get_running_loop()
    written = await loop.run_in_executor(None, write_exploration_artifacts)
    await generate_drivers_report()
    return {"status": "ok", "detail": f"Wrote {len(written)} exploration files and regenerated the drivers report."}
