"""
Train the cancellation-prediction model.

Pipeline:
  1. Pull Delivered + Cancelled orders from `vendor_kpi` (existing BQ client).
  2. Engineer features via the shared `app.utils.feature_engineering` module
     (no leakage — post-delivery fields excluded; rolling aggregates use prior
     orders only).
  3. Time-based split (most recent 20% = test; most recent 20% of the rest = val).
  4. Handle class imbalance — compare XGBoost `scale_pos_weight` vs SMOTE, keep
     whichever scores better on validation.
  5. Train Logistic Regression (baseline), XGBoost (primary, Optuna-tuned for
     recall with a precision floor of 0.3), and LightGBM (comparison).
  6. Evaluate on the held-out test set and write all artifacts.

Artifacts (into ./artifacts):
  cancellation_model.joblib, feature_pipeline.joblib,
  model_metrics.json, threshold_analysis.json, threshold_recommendation.json,
  feature_importance.json, pr_curve.json

Usage:
    cd backend
    python scripts/train_cancellation_model.py
    python scripts/train_cancellation_model.py --trials 50 --limit 200000
"""

import argparse
import json
import logging
import os
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

# Silence the transitive pkg_resources DeprecationWarning emitted by some ML
# libraries (xgboost/shap/etc.) at import — scoped to this exact message only.
warnings.filterwarnings("ignore", message=r".*pkg_resources is deprecated.*", category=DeprecationWarning)

sys.path.insert(0, str(Path(__file__).parent.parent))

try:  # optional — absent in a bare Colab runtime
    from dotenv import load_dotenv
    load_dotenv()
except ModuleNotFoundError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger(__name__)

import numpy as np
import pandas as pd

# Run inside the FastAPI app OR standalone on Colab (where only feature_engineering.py
# is uploaded next to this script). Same feature logic either way — no drift.
try:
    from app.config import get_settings
    from app.services.bq_client import get_client
    from app.utils import feature_engineering as fe
    _RUNNING_IN_APP = True
except ModuleNotFoundError:
    import feature_engineering as fe  # uploaded sibling on Colab
    get_settings = None
    get_client = None
    _RUNNING_IN_APP = False

ARTIFACTS_DIR = (Path(__file__).resolve().parents[1] / "artifacts") if _RUNNING_IN_APP else (Path.cwd() / "artifacts")
PRECISION_FLOOR = 0.3
RECALL_TARGET = 0.75


def _bq_client():
    """App's shared client when available, else a plain client (Colab uses its own auth)."""
    if get_client is not None:
        return get_client()
    from google.cloud import bigquery
    return bigquery.Client(project=os.environ.get("GCP_PROJECT_ID") or "long-ceiling-343505")


def _vendor_kpi_table() -> str:
    if get_settings is not None:
        s = get_settings()
        return f"`{s.gcp_project_id}.{s.bq_calls_dataset}.vendor_kpi`"
    proj = os.environ.get("GCP_PROJECT_ID", "long-ceiling-343505")
    dataset = os.environ.get("BQ_CALLS_DATASET", "reports")
    return f"`{proj}.{dataset}.vendor_kpi`"


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def load_data(limit: int | None) -> pd.DataFrame:
    table = _vendor_kpi_table()
    client = _bq_client()

    # Show the user how many rows are coming before the (potentially long) download.
    where = f"WHERE order_status IN ('{fe.DELIVERED_VALUE}', '{fe.CANCELLED_VALUE}')"
    try:
        total = list(client.query(f"SELECT COUNT(*) AS n FROM {table} {where}").result())[0]["n"]
        target = min(total, limit) if limit else total
        logger.info("Found %s matching rows%s — downloading…", f"{total:,}",
                    f" (capping at {limit:,})" if limit and limit < total else "")
    except Exception:  # noqa: BLE001 — count is best-effort, don't block training
        target = None
        logger.info("Querying BigQuery for training data…")

    cols = ", ".join(fe.RAW_COLUMNS)
    sql = f"SELECT {cols} FROM {table} {where}"
    if limit:
        sql += f"\nLIMIT {limit}"

    # tqdm progress bar during the fetch; bqstorage (if installed) makes it far faster.
    df = client.query(sql).to_dataframe(progress_bar_type="tqdm", create_bqstorage_client=True)
    logger.info("Pulled %s rows.", f"{len(df):,}")
    return df


def build_xy(df: pd.DataFrame):
    """Feature-engineer + time-sort. Returns X, y, and the ordering timestamp."""
    df = df.copy()
    df["_order_ts"] = fe.order_timestamp(df)
    df = df.sort_values("_order_ts").reset_index(drop=True)
    y = fe.make_label(df)
    X = fe.transform(df, training=True)
    return X, y, df["_order_ts"]


def time_split(X, y, test_frac=0.2, val_frac=0.2):
    n = len(X)
    n_test = int(n * test_frac)
    n_trainval = n - n_test
    n_val = int(n_trainval * val_frac)
    n_train = n_trainval - n_val
    sl = slice
    return (
        X.iloc[sl(0, n_train)], y.iloc[sl(0, n_train)],
        X.iloc[sl(n_train, n_trainval)], y.iloc[sl(n_train, n_trainval)],
        X.iloc[sl(n_trainval, n)], y.iloc[sl(n_trainval, n)],
    )


# ---------------------------------------------------------------------------
# Metrics helpers
# ---------------------------------------------------------------------------

def recall_at_precision_floor(y_true, y_proba, floor=PRECISION_FLOOR) -> float:
    """Max achievable recall while keeping precision >= floor (0 if impossible)."""
    from sklearn.metrics import precision_recall_curve
    precision, recall, _ = precision_recall_curve(y_true, y_proba)
    ok = recall[:-1][precision[:-1] >= floor]
    return float(ok.max()) if ok.size else 0.0


def threshold_sweep(y_true, y_proba) -> list[dict]:
    from sklearn.metrics import precision_score, recall_score, f1_score
    out = []
    for t in np.arange(0.1, 0.91, 0.05):
        pred = (y_proba >= t).astype(int)
        out.append({
            "threshold": round(float(t), 2),
            "precision": round(float(precision_score(y_true, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_true, pred, zero_division=0)), 4),
            "f1": round(float(f1_score(y_true, pred, zero_division=0)), 4),
            "flagged": int(pred.sum()),
        })
    return out


def recommend_threshold(sweep: list[dict]) -> dict:
    eligible = [r for r in sweep if r["recall"] >= RECALL_TARGET]
    if eligible:
        best = max(eligible, key=lambda r: r["precision"])
        best = {**best, "rule": f"recall>={RECALL_TARGET}, max precision"}
    else:
        best = max(sweep, key=lambda r: r["f1"])
        best = {**best, "rule": "fallback: max F1"}
    return best


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

def train_logreg(Xtr, ytr):
    from sklearn.linear_model import LogisticRegression
    clf = LogisticRegression(max_iter=1000, class_weight="balanced", n_jobs=-1)
    clf.fit(Xtr, ytr)
    return clf


def train_lightgbm(Xtr, ytr, spw):
    import lightgbm as lgb
    clf = lgb.LGBMClassifier(
        n_estimators=400, learning_rate=0.05, num_leaves=48,
        scale_pos_weight=spw, subsample=0.8, colsample_bytree=0.8, n_jobs=-1, verbose=-1,
    )
    clf.fit(Xtr, ytr)
    return clf


def tune_xgboost(Xtr, ytr, Xval, yval, spw, n_trials):
    import optuna
    import xgboost as xgb

    optuna.logging.set_verbosity(optuna.logging.WARNING)

    def objective(trial):
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 200, 800, step=100),
            "max_depth": trial.suggest_int("max_depth", 3, 9),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
            "gamma": trial.suggest_float("gamma", 0.0, 5.0),
            "reg_lambda": trial.suggest_float("reg_lambda", 0.0, 5.0),
        }
        clf = xgb.XGBClassifier(
            **params, scale_pos_weight=spw, eval_metric="aucpr",
            tree_method="hist", n_jobs=-1,
        )
        clf.fit(Xtr, ytr, verbose=False)
        proba = clf.predict_proba(Xval)[:, 1]
        return recall_at_precision_floor(yval, proba)

    def _log_trial(study, trial):
        val = trial.value if trial.value is not None else float("nan")
        logger.info("  trial %d/%d — recall@p>=%.1f=%.4f  (best=%.4f)",
                    trial.number + 1, n_trials, PRECISION_FLOOR, val, study.best_value)

    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=n_trials, callbacks=[_log_trial], show_progress_bar=True)
    logger.info("Best XGB trial: recall@precision>=%.1f = %.4f", PRECISION_FLOOR, study.best_value)
    logger.info("Best params: %s", study.best_params)

    best = xgb.XGBClassifier(
        **study.best_params, scale_pos_weight=spw, eval_metric="aucpr",
        tree_method="hist", n_jobs=-1,
    )
    return best, study.best_params


def maybe_smote(Xtr, ytr):
    """Return a SMOTE-resampled (dense) training set."""
    from imblearn.over_sampling import SMOTE
    import scipy.sparse as sp
    X_dense = Xtr.toarray() if sp.issparse(Xtr) else Xtr
    sm = SMOTE(random_state=42)
    return sm.fit_resample(X_dense, ytr)


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------

def shap_importance(model, X_sample, feature_names, top=20):
    try:
        import shap
        explainer = shap.TreeExplainer(model)
        vals = explainer.shap_values(X_sample)
        if isinstance(vals, list):
            vals = vals[-1]
        mean_abs = np.abs(np.asarray(vals)).mean(axis=0)
        order = np.argsort(mean_abs)[::-1][:top]
        return [{"feature": feature_names[i], "importance": round(float(mean_abs[i]), 6)} for i in order]
    except Exception as exc:  # noqa: BLE001
        logger.warning("SHAP importance failed (%s); falling back to model importances.", exc)
        imp = getattr(model, "feature_importances_", None)
        if imp is None:
            return []
        order = np.argsort(imp)[::-1][:top]
        return [{"feature": feature_names[i], "importance": round(float(imp[i]), 6)} for i in order]


def write_json(name: str, data) -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS_DIR / name).write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    logger.info("  ✓ wrote %s", name)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(trials: int, limit: int | None) -> None:
    import joblib
    from sklearn.metrics import (
        average_precision_score,
        classification_report,
        confusion_matrix,
        precision_recall_curve,
        roc_auc_score,
    )

    df = load_data(limit)
    if df.empty:
        logger.error("No data returned — aborting.")
        return

    logger.info("Engineering features for %s rows (rolling history can take a minute on large data)…", f"{len(df):,}")
    X, y, _ = build_xy(df)
    logger.info("Feature engineering done — %d features.", X.shape[1])
    logger.info("Class balance: %d cancelled / %d total (%.1f%%)",
                int(y.sum()), len(y), 100 * y.mean())

    Xtr, ytr, Xval, yval, Xte, yte = time_split(X, y)
    logger.info("Split — train=%d val=%d test=%d", len(Xtr), len(Xval), len(Xte))

    # Fit the feature pipeline on TRAIN only (no leakage), transform all splits.
    preprocessor = fe.build_preprocessor()
    Xtr_t = preprocessor.fit_transform(Xtr, ytr)
    Xval_t = preprocessor.transform(Xval)
    Xte_t = preprocessor.transform(Xte)
    feature_names = fe.get_feature_names(preprocessor)
    logger.info("Feature matrix: %d expanded features.", len(feature_names))

    spw = float((ytr == 0).sum() / max(1, (ytr == 1).sum()))
    logger.info("scale_pos_weight = %.2f", spw)

    # --- Baselines / comparisons ---------------------------------------------
    logger.info("Training Logistic Regression baseline…")
    logreg = train_logreg(Xtr_t, ytr)

    logger.info("Training LightGBM…")
    lgbm = train_lightgbm(Xtr_t, ytr, spw)

    # --- XGBoost (primary) tuned with Optuna ---------------------------------
    logger.info("Tuning XGBoost with Optuna (%d trials)…", trials)
    xgb_model, best_params = tune_xgboost(Xtr_t, ytr, Xval_t, yval, spw, trials)

    # Imbalance strategy: scale_pos_weight vs SMOTE — pick the better val score.
    logger.info("Comparing scale_pos_weight vs SMOTE on validation…")
    xgb_model.fit(Xtr_t, ytr, verbose=False)
    spw_score = recall_at_precision_floor(yval, xgb_model.predict_proba(Xval_t)[:, 1])

    smote_score, smote_model = -1.0, None
    try:
        import xgboost as xgb
        Xsm, ysm = maybe_smote(Xtr_t, ytr)
        smote_model = xgb.XGBClassifier(**best_params, eval_metric="aucpr", tree_method="hist", n_jobs=-1)
        smote_model.fit(Xsm, ysm, verbose=False)
        smote_score = recall_at_precision_floor(yval, smote_model.predict_proba(Xval_t)[:, 1])
    except Exception as exc:  # noqa: BLE001
        logger.warning("SMOTE path failed (%s) — keeping scale_pos_weight.", exc)

    logger.info("Validation recall@precision-floor — scale_pos_weight=%.4f  SMOTE=%.4f", spw_score, smote_score)
    if smote_model is not None and smote_score > spw_score:
        logger.info("→ SMOTE wins.")
        final_model, imbalance = smote_model, "smote"
    else:
        logger.info("→ scale_pos_weight wins.")
        final_model, imbalance = xgb_model, "scale_pos_weight"

    # --- Evaluate primary model on TEST --------------------------------------
    proba_te = final_model.predict_proba(Xte_t)[:, 1]
    sweep = threshold_sweep(yte, proba_te)
    rec = recommend_threshold(sweep)
    chosen_t = rec["threshold"]
    pred_te = (proba_te >= chosen_t).astype(int)

    roc = float(roc_auc_score(yte, proba_te))
    pr_auc = float(average_precision_score(yte, proba_te))
    report = classification_report(yte, pred_te, output_dict=True, zero_division=0)
    cm = confusion_matrix(yte, pred_te).tolist()
    logger.info("TEST — ROC-AUC=%.4f  PR-AUC=%.4f  threshold=%.2f", roc, pr_auc, chosen_t)

    # Comparison metrics for the baselines (at chosen threshold)
    def quick_metrics(model):
        p = model.predict_proba(Xte_t)[:, 1]
        return {"roc_auc": round(float(roc_auc_score(yte, p)), 4),
                "pr_auc": round(float(average_precision_score(yte, p)), 4)}

    now = datetime.now(timezone.utc).isoformat()
    metrics = {
        "algorithm": "XGBoost",
        "version": now,
        "trained_at": now,
        "imbalance_strategy": imbalance,
        "best_params": best_params,
        "roc_auc": round(roc, 4),
        "pr_auc": round(pr_auc, 4),
        "threshold": chosen_t,
        "classification_report": report,
        "confusion_matrix": cm,
        "n_features": len(feature_names),
        "n_training_rows": int(len(Xtr)),
        "n_test_rows": int(len(Xte)),
        "model_comparison": {
            "logistic_regression": quick_metrics(logreg),
            "lightgbm": quick_metrics(lgbm),
            "xgboost": {"roc_auc": round(roc, 4), "pr_auc": round(pr_auc, 4)},
        },
    }

    # PR curve (downsampled to ~120 points)
    precision, recall, thr = precision_recall_curve(yte, proba_te)
    step = max(1, len(precision) // 120)
    pr_curve = [
        {"precision": round(float(p), 4), "recall": round(float(r), 4)}
        for p, r in zip(precision[::step], recall[::step])
    ]

    # SHAP importance on a test sample
    sample = Xte_t[:2000].toarray() if hasattr(Xte_t, "toarray") else Xte_t[:2000]
    importance = shap_importance(final_model, sample, feature_names, top=20)

    # --- Persist everything --------------------------------------------------
    logger.info("Writing artifacts to %s …", ARTIFACTS_DIR)
    write_json("model_metrics.json", metrics)
    write_json("threshold_analysis.json", {"thresholds": sweep})
    write_json("threshold_recommendation.json", rec)
    write_json("feature_importance.json", {"top_features": importance})
    write_json("pr_curve.json", {"points": pr_curve})

    joblib.dump(final_model, ARTIFACTS_DIR / "cancellation_model.joblib")
    joblib.dump(preprocessor, ARTIFACTS_DIR / "feature_pipeline.joblib")
    logger.info("  ✓ saved cancellation_model.joblib + feature_pipeline.joblib")
    logger.info("Training complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train the cancellation-prediction model.")
    parser.add_argument("--trials", type=int, default=50, help="Optuna trials for XGBoost (default 50).")
    parser.add_argument("--limit", type=int, default=None, help="Optional row cap for faster iteration.")
    args = parser.parse_args()
    main(trials=args.trials, limit=args.limit)
