"""
Cancellation feature engineering — the SINGLE SOURCE OF TRUTH shared by the
training script (`scripts/train_cancellation_model.py`) and the serving
predictor (`app/services/predictor_service.py`).

Design rules (see the cancellation spec):
- Only features available AT or SHORTLY AFTER order placement are used.
  All post-delivery fields are excluded — see ``LEAKAGE_FIELDS``.
- Rolling/historical aggregates (vendor cancel rate, zone cancel rate, customer
  order count, vendor avg prep time) are computed from PRIOR orders only, so the
  training set carries no leakage. At serving time the same features are filled
  from a point-in-time lookup (see ``predictor_service``).

The module is intentionally framework-light (pandas + scikit-learn) so the exact
same transforms run offline (training) and online (inference).
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Label + leakage definitions
# ---------------------------------------------------------------------------

LABEL_COLUMN = "order_status"
CANCELLED_VALUE = "Cancelled"
DELIVERED_VALUE = "Delivered"

# Fields that only exist AFTER an order completes — never used as features.
LEAKAGE_FIELDS = [
    "since_create_til_delivred_min",
    "outForDelivrey_to_delivred_min",
    "delivered_at",
    "picked_time",
    "reached_customer_location_at",
    "reached_restaurant_at",
    "pickedup_after_ready_min",
    "pickedup_after_arrived_min",
    "feedback_delivery_rating",
    "feedback_order_rating",
    "feedback_comment",
    "cancel_comment",
    "cancelled_by_txt",
    "cancelled_by_int",
    "order_status",  # the label, not a feature
]

# Raw columns we pull from `vendor_kpi` to build features (+ keys + label +
# timestamps used purely for ordering / historical windows).
RAW_COLUMNS = [
    "id",
    "vendor_id",
    "customer_id",
    "order_status",
    "order_placement_date",
    "order_placement_time",
    "total_order_value",
    "order_sub_total_value",
    "delivery_charge",
    "vendor_to_customer_dist",
    "driver_vendor_dist",
    "is_pre_order",
    "new_customer",
    "is_pro_user",
    "is_pro_vendor",
    "is_treasure",
    "is_discount",
    "used_coupon",
    "payment_type",
    "customer_device_type",
    "platform_name",
    "cuisine",
    "zone_name",
    "customer_zone",
    "rafeeq_time_to_accept_order_min",
    "vendor_to_accept_order_min",
    "preparing_time_min",  # only used to build the vendor's PRIOR average
]

# ---------------------------------------------------------------------------
# Final model feature columns
# ---------------------------------------------------------------------------

NUMERIC_FEATURES = [
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "total_order_value",
    "order_sub_total_value",
    "delivery_charge",
    "vendor_to_customer_dist",
    "driver_vendor_dist",
    "is_pre_order",
    "is_new_customer",
    "is_pro_user",
    "is_pro_vendor",
    "is_treasure",
    "has_discount",
    "has_coupon",
    "rafeeq_time_to_accept_order_min",
    "vendor_to_accept_order_min",
    "vendor_cancel_rate_30d",
    "zone_cancel_rate_30d",
    "customer_order_count",
    "vendor_avg_prep_time",
]

CATEGORICAL_FEATURES = [
    "time_bucket",
    "payment_type",
    "customer_device_type",
    "platform_name",
    "cuisine",
    "zone_name",
    "customer_zone",
]

FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# Historical features that must be looked up point-in-time when serving.
HISTORICAL_FEATURES = [
    "vendor_cancel_rate_30d",
    "zone_cancel_rate_30d",
    "customer_order_count",
    "vendor_avg_prep_time",
]

ROLLING_WINDOW_DAYS = 30
_TOP_CUISINES = 15


# ---------------------------------------------------------------------------
# Low-level coercion helpers
# ---------------------------------------------------------------------------

def _to_float(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def _to_binary(series: pd.Series) -> pd.Series:
    """Coerce mixed truthy representations (1/0, true/false, yes/no, 't') to 0/1."""
    def conv(v) -> float:
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return 0.0
        if isinstance(v, (int, float, bool)):
            return 1.0 if float(v) != 0 else 0.0
        s = str(v).strip().lower()
        return 1.0 if s in {"1", "true", "t", "yes", "y", "discount"} else 0.0
    return series.map(conv).astype(float)


def _hour_of_day(series: pd.Series) -> pd.Series:
    def hour(v) -> float:
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return np.nan
        if hasattr(v, "hour"):
            return float(v.hour)
        s = str(v)
        try:
            return float(s.split(":")[0])
        except (ValueError, IndexError):
            return np.nan
    return series.map(hour)


def _time_bucket(hour: float) -> str:
    if hour is None or (isinstance(hour, float) and np.isnan(hour)):
        return "unknown"
    h = int(hour)
    if 6 <= h < 11:
        return "morning"
    if 11 <= h < 14:
        return "lunch"
    if 14 <= h < 17:
        return "afternoon"
    if 17 <= h < 21:
        return "dinner"
    return "late_night"


def order_timestamp(df: pd.DataFrame) -> pd.Series:
    """Combine placement date + time into a single ordering timestamp."""
    date = pd.to_datetime(df["order_placement_date"], errors="coerce")
    hours = _hour_of_day(df["order_placement_time"]).fillna(0)
    return date + pd.to_timedelta(hours, unit="h")


# ---------------------------------------------------------------------------
# Historical / rolling features (PRIOR orders only — no leakage)
# ---------------------------------------------------------------------------

def _rolling_prior_mean(
    df: pd.DataFrame, group_col: str, value_col: str, ts_col: str, window_days: int
) -> pd.Series:
    """Per-group time-windowed mean over orders strictly BEFORE the current one."""
    out = pd.Series(np.nan, index=df.index, dtype=float)
    for _, g in df.groupby(group_col, sort=False):
        # Rolling needs a clean, monotonic datetime index — drop null timestamps
        # (those rows keep NaN and are imputed downstream).
        g = g[g[ts_col].notna()].sort_values(ts_col)
        if g.empty:
            continue
        s = pd.Series(g[value_col].to_numpy(), index=pd.DatetimeIndex(g[ts_col]))
        # closed="left" excludes the current timestamp -> only prior orders count
        rolled = s.rolling(f"{window_days}D", closed="left").mean()
        out.loc[g.index] = rolled.to_numpy()
    return out


def add_historical_features(df: pd.DataFrame, ts_col: str = "_order_ts") -> pd.DataFrame:
    """Add the four leakage-free rolling features computed from prior orders."""
    df = df.copy()
    is_cancelled = (df[LABEL_COLUMN] == CANCELLED_VALUE).astype(float)
    df["_is_cancelled"] = is_cancelled

    df["vendor_cancel_rate_30d"] = _rolling_prior_mean(
        df, "vendor_id", "_is_cancelled", ts_col, ROLLING_WINDOW_DAYS
    )
    df["zone_cancel_rate_30d"] = _rolling_prior_mean(
        df, "zone_name", "_is_cancelled", ts_col, ROLLING_WINDOW_DAYS
    )
    df["vendor_avg_prep_time"] = _rolling_prior_mean(
        df, "vendor_id", "preparing_time_min", ts_col, ROLLING_WINDOW_DAYS
    )

    # Customer order count = number of PRIOR orders by this customer
    df = df.sort_values(ts_col)
    df["customer_order_count"] = df.groupby("customer_id").cumcount().astype(float)

    df = df.drop(columns=["_is_cancelled"])
    return df


# ---------------------------------------------------------------------------
# Core transform
# ---------------------------------------------------------------------------

def _engineer_base(df: pd.DataFrame) -> pd.DataFrame:
    """Derive the placement-time features (everything except historical lookups)."""
    out = pd.DataFrame(index=df.index)

    hours = _hour_of_day(df["order_placement_time"])
    out["hour_of_day"] = hours
    dow = pd.to_datetime(df["order_placement_date"], errors="coerce").dt.dayofweek  # Mon=0
    out["day_of_week"] = dow
    out["is_weekend"] = dow.isin([4, 5]).astype(float)  # Qatar weekend: Fri/Sat
    out["time_bucket"] = hours.map(_time_bucket)

    out["total_order_value"] = _to_float(df["total_order_value"])
    out["order_sub_total_value"] = _to_float(df["order_sub_total_value"])
    out["delivery_charge"] = _to_float(df["delivery_charge"])
    out["vendor_to_customer_dist"] = _to_float(df["vendor_to_customer_dist"])
    out["driver_vendor_dist"] = _to_float(df["driver_vendor_dist"])
    out["rafeeq_time_to_accept_order_min"] = _to_float(df["rafeeq_time_to_accept_order_min"])
    out["vendor_to_accept_order_min"] = _to_float(df["vendor_to_accept_order_min"])

    out["is_pre_order"] = _to_binary(df["is_pre_order"])
    out["is_new_customer"] = _to_binary(df["new_customer"])
    out["is_pro_user"] = _to_binary(df["is_pro_user"])
    out["is_pro_vendor"] = _to_binary(df["is_pro_vendor"])
    out["is_treasure"] = _to_binary(df["is_treasure"])
    out["has_discount"] = _to_binary(df["is_discount"])
    out["has_coupon"] = df["used_coupon"].map(
        lambda v: 1.0 if v is not None and str(v).strip() not in {"", "nan", "None"} else 0.0
    )

    out["payment_type"] = df["payment_type"].astype("string").fillna("unknown")
    out["customer_device_type"] = df["customer_device_type"].astype("string").fillna("unknown")
    out["platform_name"] = df["platform_name"].astype("string").fillna("unknown")
    out["zone_name"] = df["zone_name"].astype("string").fillna("unknown")
    out["customer_zone"] = df["customer_zone"].astype("string").fillna("unknown")
    out["cuisine"] = df["cuisine"].astype("string").fillna("unknown")

    return out


def cap_cuisine(df: pd.DataFrame, top: Optional[list[str]] = None) -> pd.DataFrame:
    """Fold rare cuisines into 'other'. Pass a fitted ``top`` list for serving."""
    df = df.copy()
    if top is None:
        top = (
            df["cuisine"].value_counts().head(_TOP_CUISINES).index.tolist()
        )
    df["cuisine"] = df["cuisine"].where(df["cuisine"].isin(top), "other")
    return df, top


def transform(df: pd.DataFrame, *, training: bool) -> pd.DataFrame:
    """
    Build the full feature frame.

    Training: rolling features are computed from prior orders within ``df``.
    Serving:  ``df`` is expected to already carry the HISTORICAL_FEATURES columns
              (filled by a point-in-time lookup); missing ones default to NaN and
              are imputed by the saved pipeline.
    """
    work = df.copy()

    if training:
        work["_order_ts"] = order_timestamp(work)
        work = add_historical_features(work, ts_col="_order_ts")

    base = _engineer_base(work)

    for col in HISTORICAL_FEATURES:
        if col in work.columns:
            base[col] = _to_float(work[col]) if col != "customer_order_count" else _to_float(work[col])
        else:
            base[col] = np.nan

    return base[FEATURE_COLUMNS]


def make_label(df: pd.DataFrame) -> pd.Series:
    """Binary target: 1 = cancelled, 0 = delivered."""
    return (df[LABEL_COLUMN] == CANCELLED_VALUE).astype(int)


def build_preprocessor():
    """ColumnTransformer used inside the saved pipeline (single source of truth)."""
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    numeric = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]
    )
    categorical = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="constant", fill_value="unknown")),
            (
                "onehot",
                OneHotEncoder(handle_unknown="ignore", min_frequency=25, sparse_output=True),
            ),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("num", numeric, NUMERIC_FEATURES),
            ("cat", categorical, CATEGORICAL_FEATURES),
        ],
        remainder="drop",
    )


def get_feature_names(preprocessor) -> list[str]:
    """Human-readable expanded feature names after the ColumnTransformer."""
    try:
        return list(preprocessor.get_feature_names_out())
    except Exception:  # pragma: no cover - fallback for un-fitted transformers
        return list(FEATURE_COLUMNS)
