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

from app.services import local_db as db
from app.services.chat_service import chat_with_data
from app.services.gemini_service import call_with_retry
from app.services.local_db import countif, safe_divide
from app.services.verticals import normalize, vertical_case, vertical_pred
from app.services.zones import zone_pred
from app.utils.helpers import extract_json, utcnow_iso

logger = logging.getLogger(__name__)

ARTIFACTS_DIR = Path(__file__).resolve().parents[2] / "artifacts"
REPORT_PATH = ARTIFACTS_DIR / "cancellation_drivers_report.json"
FEATURE_IMPORTANCE_PATH = ARTIFACTS_DIR / "feature_importance.json"
THRESHOLD_ANALYSIS_PATH = ARTIFACTS_DIR / "threshold_analysis.json"

_T = "vendor_kpi"


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
        parts.append(f"{col} >= date('{start}')")
    if end:
        parts.append(f"{col} <= date('{end}')")
    return (" AND " + " AND ".join(parts)) if parts else ""


# Internal QA/testing accounts (confirmed by ops) — excluded from every
# cancellation analytics query so their near-100% cancel rates don't skew
# rates or the Gemini drivers report. Exact names only: many legitimate
# first-party storefronts are also named "Clarity …".
_EXCLUDE_INTERNAL = (
    " AND (restaurant_name IS NULL"
    " OR LOWER(TRIM(restaurant_name)) NOT IN ('clarity res', 'testnot'))"
)


def _preds(start: str | None, end: str | None, vertical: str | None = None,
           zone: str | None = None) -> str:
    """Combined date + vertical + zone + internal-account WHERE fragment
    (vertical and zone whitelisted by the router)."""
    return (_date_pred(start, end) + vertical_pred(vertical)
            + zone_pred(zone) + _EXCLUDE_INTERNAL)


# Dominant vertical of a merchant/zone group — normalized python-side.
_TOP_PLATFORM = "mode_value(platform_name) AS raw_platform"

# Cancellation count / rate — repeated in nearly every breakdown below.
_N_CANCELLED = countif(_CANCELLED)
_RATE_PCT = f"ROUND({safe_divide(_N_CANCELLED, 'COUNT(*)')} * 100, 2)"

# EXTRACT(HOUR FROM order_placement_time) over the stored 'HH:MM:SS' text.
_ORDER_HOUR = "CAST(substr(order_placement_time, 1, 2) AS INTEGER)"

_TIME_BUCKET = f"""CASE
              WHEN {_ORDER_HOUR} BETWEEN 6  AND 10 THEN 'Morning'
              WHEN {_ORDER_HOUR} BETWEEN 11 AND 13 THEN 'Lunch'
              WHEN {_ORDER_HOUR} BETWEEN 14 AND 16 THEN 'Afternoon'
              WHEN {_ORDER_HOUR} BETWEEN 17 AND 20 THEN 'Dinner'
              ELSE 'Late Night'
            END"""


def _with_vertical(rows: list[dict]) -> list[dict]:
    for r in rows:
        r["vertical"] = normalize(r.pop("raw_platform", None))
    return rows


def _run(sql: str) -> list[dict]:
    return db.query(sql)


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

def _trend_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> dict:
    pred = _preds(start, end, vertical, zone)

    def q(period: str) -> list[dict]:
        return _run(f"""
            SELECT {period} AS period,
              COUNT(*)      AS total_orders,
              {_N_CANCELLED} AS cancelled,
              {_RATE_PCT}    AS cancel_rate_pct
            FROM {_T}
            WHERE order_placement_date IS NOT NULL{pred}
            GROUP BY period ORDER BY period
        """)
    return {
        "monthly": q("strftime('%Y-%m', order_placement_date)"),
        "weekly": q("iso_week(order_placement_date)"),
    }


def _by_merchant_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> dict:
    pred = _preds(start, end, vertical, zone)
    base = f"""
        SELECT restaurant_name,
          {_TOP_PLATFORM},
          COUNT(*)       AS total_orders,
          {_N_CANCELLED} AS cancelled,
          {_RATE_PCT}    AS cancel_rate_pct,
          ROUND(AVG(total_order_value), 2) AS avg_order_value
        FROM {_T}
        WHERE restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''{pred}
        GROUP BY restaurant_name
        HAVING total_orders >= 30
    """
    by_volume = _with_vertical(_run(f"{base} ORDER BY cancelled DESC LIMIT 20"))
    by_rate = _with_vertical(_run(f"{base} ORDER BY cancel_rate_pct DESC, total_orders DESC LIMIT 20"))
    return {"by_volume": by_volume, "by_rate": by_rate}


def _by_zone_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> dict:
    pred = _preds(start, end, vertical, zone)

    def q(col: str) -> list[dict]:
        return _with_vertical(_run(f"""
            SELECT {col} AS zone,
              {_TOP_PLATFORM},
              COUNT(*)       AS total_orders,
              {_N_CANCELLED} AS cancelled,
              {_RATE_PCT}    AS cancel_rate_pct
            FROM {_T}
            WHERE {col} IS NOT NULL AND TRIM(CAST({col} AS TEXT)) != ''{pred}
            GROUP BY zone
            HAVING total_orders >= 20
            ORDER BY total_orders DESC LIMIT 30
        """))
    return {"by_zone_name": q("zone_name"), "by_customer_zone": q("customer_zone")}


def _by_time_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> list[dict]:
    pred = _preds(start, end, vertical, zone)
    return _run(f"""
        WITH bucketed AS (
          SELECT order_status, {_TIME_BUCKET} AS time_bucket
          FROM {_T}
          WHERE order_placement_time IS NOT NULL{pred}
        )
        SELECT time_bucket,
          COUNT(*)       AS total_orders,
          {_N_CANCELLED} AS cancelled,
          {_RATE_PCT}    AS cancel_rate_pct
        FROM bucketed
        GROUP BY time_bucket
        ORDER BY cancel_rate_pct DESC
    """)


def _by_hour_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> list[dict]:
    """Cancellation rate per hour of day (0-23) — the finer-grained companion to
    _by_time_sync's five named buckets."""
    pred = _preds(start, end, vertical, zone)
    return _run(f"""
        WITH hourly AS (
          SELECT order_status, {_ORDER_HOUR} AS hour
          FROM {_T}
          WHERE order_placement_time IS NOT NULL{pred}
        )
        SELECT hour,
          COUNT(*)       AS total_orders,
          {_N_CANCELLED} AS cancelled,
          {_RATE_PCT}    AS cancel_rate_pct
        FROM hourly
        WHERE hour BETWEEN 0 AND 23
        GROUP BY hour
        ORDER BY hour
    """)


def _by_dow_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> list[dict]:
    pred = _preds(start, end, vertical, zone)
    return _run(f"""
        SELECT day_name(order_placement_date) AS day_of_week,
          CAST(strftime('%w', order_placement_date) AS INTEGER) + 1 AS dow_index,
          COUNT(*)       AS total_orders,
          {_N_CANCELLED} AS cancelled,
          {_RATE_PCT}    AS cancel_rate_pct
        FROM {_T}
        WHERE order_placement_date IS NOT NULL{pred}
        GROUP BY day_of_week, dow_index
        ORDER BY dow_index
    """)


def _by_order_size_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> list[dict]:
    pred = _preds(start, end, vertical, zone)
    return _run(f"""
        WITH q AS (
          SELECT total_order_value, order_status,
            NTILE(4) OVER (ORDER BY total_order_value) AS quartile
          FROM {_T}
          WHERE total_order_value IS NOT NULL{pred}
        )
        SELECT quartile,
          COUNT(*)       AS total_orders,
          {_N_CANCELLED} AS cancelled,
          {_RATE_PCT}    AS cancel_rate_pct,
          ROUND(MIN(total_order_value), 2) AS min_value,
          ROUND(MAX(total_order_value), 2) AS max_value
        FROM q GROUP BY quartile ORDER BY quartile
    """)


def _by_actor_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> list[dict]:
    pred = _preds(start, end, vertical, zone)
    return _run(f"""
        SELECT COALESCE(NULLIF(TRIM(cancelled_by_txt), ''), 'Unknown') AS cancelled_by,
          COUNT(*)                                  AS cancellations,
          ROUND(AVG(total_order_value), 2)          AS avg_order_value
        FROM {_T}
        WHERE {_CANCELLED}{pred}
        GROUP BY cancelled_by
        ORDER BY cancellations DESC
    """)


def _by_reason_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> list[dict]:
    """Stated cancellation reasons (first segment of cancel_comment) with who
    cancelled — the closest thing to ground-truth causes in the data."""
    pred = _preds(start, end, vertical, zone)
    return _run(f"""
        SELECT
          COALESCE(NULLIF(TRIM(split_first(cancel_comment, '//')), ''), 'No reason given') AS reason,
          COALESCE(NULLIF(TRIM(cancelled_by_txt), ''), 'Unknown')                          AS cancelled_by,
          COUNT(*)                          AS cancellations,
          ROUND(AVG(total_order_value), 2)  AS avg_order_value
        FROM {_T}
        WHERE {_CANCELLED}{pred}
        GROUP BY reason, cancelled_by
        ORDER BY cancellations DESC
        LIMIT 20
    """)


def _crosstabs_sync(start: str | None = None, end: str | None = None, vertical: str | None = None,
                     zone: str | None = None) -> dict:
    pred = _preds(start, end, vertical, zone)
    # Full zone × time-bucket grid for the riskiest zones (highest cancel rate
    # with meaningful volume) — every bucket is returned for each zone so the
    # heatmap has no holes, unlike a flat "top 20 worst cells" ranking.
    zone_time = _run(f"""
        WITH bucketed AS (
          SELECT order_status, zone_name, {_TIME_BUCKET} AS time_bucket
          FROM {_T}
          WHERE order_placement_time IS NOT NULL AND zone_name IS NOT NULL AND TRIM(zone_name) != ''{pred}
        ),
        agg AS (
          SELECT zone_name, time_bucket,
            COUNT(*)       AS total_orders,
            {_N_CANCELLED} AS cancelled,
            {_RATE_PCT}    AS cancel_rate_pct
          FROM bucketed
          GROUP BY zone_name, time_bucket
        ),
        top_zones AS (
          SELECT zone_name, {safe_divide("SUM(cancelled)", "SUM(total_orders)")} AS zone_rate
          FROM agg
          GROUP BY zone_name
          HAVING SUM(total_orders) >= 100
          ORDER BY zone_rate DESC
          LIMIT 6
        )
        SELECT a.zone_name, a.time_bucket, a.total_orders, a.cancelled, a.cancel_rate_pct
        FROM agg a
        JOIN top_zones t ON a.zone_name = t.zone_name
        ORDER BY t.zone_rate DESC, a.time_bucket
    """)
    # Top 5 vendors by cancelled volume for EACH weekday — feeds the
    # "Cancellation Rate by Day" hover ("which vendors drive this day").
    merchant_dow = _run(f"""
        WITH agg AS (
          SELECT restaurant_name, day_name(order_placement_date) AS day_of_week,
            COUNT(*)       AS total_orders,
            {_N_CANCELLED} AS cancelled,
            {_RATE_PCT}    AS cancel_rate_pct
          FROM {_T}
          WHERE order_placement_date IS NOT NULL AND restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''{pred}
          GROUP BY restaurant_name, day_of_week
          HAVING total_orders >= 20
        ),
        ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY day_of_week ORDER BY cancelled DESC) AS rn FROM agg
        )
        SELECT restaurant_name, day_of_week, total_orders, cancelled, cancel_rate_pct
        FROM ranked WHERE rn <= 5
        ORDER BY day_of_week, cancelled DESC
    """)
    # Top 5 vendors by cancelled volume for EACH zone — feeds the
    # "Cancellation Rate by Zone" hover ("which vendors drive this zone").
    merchant_zone = _run(f"""
        WITH agg AS (
          SELECT restaurant_name, zone_name,
            COUNT(*)       AS total_orders,
            {_N_CANCELLED} AS cancelled,
            {_RATE_PCT}    AS cancel_rate_pct
          FROM {_T}
          WHERE zone_name IS NOT NULL AND TRIM(zone_name) != ''
            AND restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''{pred}
          GROUP BY restaurant_name, zone_name
          HAVING total_orders >= 20
        ),
        ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY zone_name ORDER BY cancelled DESC) AS rn FROM agg
        )
        SELECT restaurant_name, zone_name, total_orders, cancelled, cancel_rate_pct
        FROM ranked WHERE rn <= 5
        ORDER BY zone_name, cancelled DESC
    """)
    return {"zone_x_time": zone_time, "merchant_x_dow": merchant_dow, "merchant_x_zone": merchant_zone}


def _by_vertical_sync(start: str | None = None, end: str | None = None,
                      zone: str | None = None) -> list[dict]:
    """Cancellation breakdown across the canonical verticals (renames merged,
    NULL/junk platforms excluded), each carrying its top contributing merchants."""
    pred = _preds(start, end, None, zone)
    verticals_rows = _run(f"""
        SELECT {vertical_case('platform_name')} AS vertical,
          COUNT(*)       AS total_orders,
          {_N_CANCELLED} AS cancelled,
          {_RATE_PCT}    AS cancel_rate_pct,
          ROUND(AVG(total_order_value), 2) AS avg_order_value
        FROM {_T}
        WHERE order_placement_date IS NOT NULL
          AND {vertical_case('platform_name')} IS NOT NULL{pred}
        GROUP BY vertical
        ORDER BY total_orders DESC
    """)
    # Top contributing merchants per vertical. Rules from ops:
    #  1. Vendors averaging > 5 cancelled orders per active day qualify. But for a
    #     low-volume vertical (Health & Wellness, Last Mile, …) where no vendor
    #     clears that bar, the threshold drops to 0 so it still gets a breakdown
    #     (any vendor with cancellations) instead of showing empty.
    #  2. Show each vendor's contribution to the vertical's cancel RATE
    #     (cancelled / vertical's total orders), so the merchants' percentages
    #     break down the vertical's headline rate (they sum to it, e.g. 2.3%).
    #     Top 5 per vertical; cancelled-volume order == contribution order.
    per_day = safe_divide("cancelled", "NULLIF(active_days, 0)")
    merchants = _run(f"""
        WITH agg AS (
          SELECT {vertical_case('platform_name')} AS vertical, restaurant_name,
            {_N_CANCELLED} AS cancelled,
            {_RATE_PCT}    AS cancel_rate_pct,
            COUNT(DISTINCT order_placement_date) AS active_days
          FROM {_T}
          WHERE order_placement_date IS NOT NULL
            AND restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''
            AND {vertical_case('platform_name')} IS NOT NULL{pred}
          GROUP BY vertical, restaurant_name
        ),
        flagged AS (
          SELECT vertical, restaurant_name, cancelled, cancel_rate_pct,
            {per_day} > 5 AS qualifies,
            MAX(CASE WHEN {per_day} > 5 THEN 1 ELSE 0 END)
              OVER (PARTITION BY vertical) AS vertical_has_qualifier
          FROM agg
        ),
        ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY vertical ORDER BY cancelled DESC) AS rn
          FROM flagged
          WHERE cancelled > 0 AND (qualifies OR vertical_has_qualifier = 0)
        )
        SELECT vertical, restaurant_name, cancelled, cancel_rate_pct
        FROM ranked WHERE rn <= 5
        ORDER BY vertical, cancelled DESC
    """)
    # Denominator = the vertical's own total orders, so each merchant's share is a
    # slice of that vertical's cancel rate (all merchants' shares sum to it).
    orders_by_vertical = {r["vertical"]: (r.get("total_orders") or 0) for r in verticals_rows}
    by_vertical: dict[str, list[dict]] = {}
    for m in merchants:
        denom = orders_by_vertical.get(m["vertical"], 0)
        by_vertical.setdefault(m["vertical"], []).append({
            "restaurant_name": m["restaurant_name"],
            "cancelled": m["cancelled"],
            "cancel_rate_pct": m["cancel_rate_pct"],
            "rate_contribution_pct": round(m["cancelled"] / denom * 100, 2) if denom else 0.0,
        })
    for row in verticals_rows:
        row["top_merchants"] = by_vertical.get(row["vertical"], [])
    return verticals_rows


# ---------------------------------------------------------------------------
# Async wrappers
# ---------------------------------------------------------------------------

async def _run_async(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)


def _key(base: str, start: str | None, end: str | None, vertical: str | None = None,
         zone: str | None = None) -> str:
    return f"{base}:{start or ''}:{end or ''}:{vertical or ''}:{zone or ''}"


async def get_trend(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> dict:
    return await _cached(_key("trend", start, end, vertical, zone),
                         lambda: _run_async(_trend_sync, start, end, vertical, zone))


async def get_by_merchant(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> dict:
    return await _cached(_key("by_merchant", start, end, vertical, zone),
                         lambda: _run_async(_by_merchant_sync, start, end, vertical, zone))


async def get_by_zone(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> dict:
    return await _cached(_key("by_zone", start, end, vertical, zone),
                         lambda: _run_async(_by_zone_sync, start, end, vertical, zone))


async def get_by_time(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> list[dict]:
    return await _cached(_key("by_time", start, end, vertical, zone),
                         lambda: _run_async(_by_time_sync, start, end, vertical, zone))


async def get_by_hour(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> list[dict]:
    return await _cached(_key("by_hour", start, end, vertical, zone),
                         lambda: _run_async(_by_hour_sync, start, end, vertical, zone))


async def get_by_dow(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> list[dict]:
    return await _cached(_key("by_dow", start, end, vertical, zone),
                         lambda: _run_async(_by_dow_sync, start, end, vertical, zone))


async def get_by_order_size(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> list[dict]:
    return await _cached(_key("by_order_size", start, end, vertical, zone),
                         lambda: _run_async(_by_order_size_sync, start, end, vertical, zone))


async def get_by_actor(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> list[dict]:
    return await _cached(_key("by_actor", start, end, vertical, zone),
                         lambda: _run_async(_by_actor_sync, start, end, vertical, zone))


async def get_crosstabs(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> dict:
    return await _cached(_key("crosstabs", start, end, vertical, zone),
                         lambda: _run_async(_crosstabs_sync, start, end, vertical, zone))


async def get_by_vertical(start: str | None = None, end: str | None = None,
                          zone: str | None = None) -> list[dict]:
    return await _cached(_key("by_vertical", start, end, None, zone),
                         lambda: _run_async(_by_vertical_sync, start, end, zone))


async def get_by_reason(start: str | None = None, end: str | None = None, vertical: str | None = None,
          zone: str | None = None) -> list[dict]:
    return await _cached(_key("by_reason", start, end, vertical, zone),
                         lambda: _run_async(_by_reason_sync, start, end, vertical, zone))


# Mapping used by the exploration script to write artifact JSONs.
EXPLORATION_FUNCS: dict[str, callable] = {
    "cancellation_trend": _trend_sync,
    "cancellation_by_merchant": _by_merchant_sync,
    "cancellation_by_zone": _by_zone_sync,
    "cancellation_by_time": _by_time_sync,
    "cancellation_by_dow": _by_dow_sync,
    "cancellation_by_order_size": _by_order_size_sync,
    "cancellation_by_actor": _by_actor_sync,
    "cancellation_by_reason": _by_reason_sync,
    "cancellation_crosstabs": _crosstabs_sync,
}


async def get_exploration_context() -> dict:
    """All exploration summaries in parallel — context for Gemini report/chat."""
    keys = ["trend", "by_merchant", "by_zone", "by_time", "by_dow", "by_order_size", "by_actor", "crosstabs", "by_vertical", "by_reason"]
    funcs = [get_trend(), get_by_merchant(), get_by_zone(), get_by_time(),
             get_by_dow(), get_by_order_size(), get_by_actor(), get_crosstabs(), get_by_vertical(), get_by_reason()]
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
You are a senior operations analyst for Clarity, a food-delivery platform in Qatar.
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
- A driver is a ROOT CAUSE or operational mechanism that makes customers or
  vendors cancel (e.g. "items out of stock at pickup", "no couriers available
  late at night", "orders placed by mistake"). It must answer "WHY do orders
  get cancelled?".
- A driver is NEVER a segment comparison or observation ("vertical X cancels
  more than vertical Y", "zone Z has a high rate") — those belong in
  high_risk_segments. Ground drivers primarily in the by_reason data (stated
  cancellation reasons and who cancelled); use segment data only as supporting
  evidence for WHERE a cause concentrates.
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

    # Reasoning-heavy narrative over the whole exploration payload; runs once per
    # cache refresh, so medium thinking costs pennies here (unlike classification).
    raw = await call_with_retry(prompt, thinking_level="medium")
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
