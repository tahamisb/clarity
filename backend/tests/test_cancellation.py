"""
Tests for the cancellation feature.

Pure-logic tests (feature engineering, pydantic models, graceful degradation
when the model is not trained). Heavy ML deps are imported lazily and skipped if
unavailable so the suite still runs in minimal environments.
"""

import pytest

pd = pytest.importorskip("pandas")
np = pytest.importorskip("numpy")

from app.utils import feature_engineering as fe


def _synthetic_rows(n=6):
    """Build a small frame covering every RAW column the pipeline reads."""
    base = {c: None for c in fe.RAW_COLUMNS}
    rows = []
    for i in range(n):
        r = dict(base)
        r.update({
            "id": i,
            "vendor_id": 100 + (i % 2),       # two vendors
            "customer_id": 7,                  # same customer -> order count grows
            "order_status": "Cancelled" if i % 2 == 0 else "Delivered",
            "order_placement_date": f"2026-01-{(i % 28) + 1:02d}",
            "order_placement_time": "12:30:00",
            "total_order_value": 50.0 + i,
            "order_sub_total_value": 40.0 + i,
            "delivery_charge": 5.0,
            "vendor_to_customer_dist": 3.2,
            "driver_vendor_dist": 1.1,
            "is_pre_order": 0,
            "new_customer": 1 if i == 0 else 0,
            "is_pro_user": 0,
            "is_pro_vendor": 1,
            "is_treasure": False,
            "is_discount": "yes",
            "used_coupon": "SAVE10" if i == 0 else None,
            "payment_type": 2,
            "customer_device_type": "android",
            "platform_name": "clarity_app",
            "cuisine": "burgers",
            "zone_name": "Doha",
            "customer_zone": "Doha",
            "clarity_time_to_accept_order_min": 1.5,
            "vendor_to_accept_order_min": 2.0,
            "preparing_time_min": 12.0,
        })
        rows.append(r)
    return pd.DataFrame(rows)


class TestFeatureEngineering:
    def test_no_leakage_fields_in_features(self):
        for leak in fe.LEAKAGE_FIELDS:
            assert leak not in fe.FEATURE_COLUMNS

    def test_transform_shape_and_columns(self):
        df = _synthetic_rows()
        X = fe.transform(df, training=True)
        assert list(X.columns) == fe.FEATURE_COLUMNS
        assert len(X) == len(df)

    def test_label_mapping(self):
        df = _synthetic_rows()
        y = fe.make_label(df)
        assert set(y.unique()) <= {0, 1}
        assert y.iloc[0] == 1  # first row is Cancelled

    def test_binary_coercion(self):
        df = _synthetic_rows()
        X = fe.transform(df, training=True)
        assert (X["has_discount"] == 1.0).all()       # is_discount "yes"
        assert X["has_coupon"].iloc[0] == 1.0           # coupon present on row 0
        assert X["has_coupon"].iloc[1] == 0.0           # none on row 1

    def test_time_bucket(self):
        assert fe._time_bucket(8) == "morning"
        assert fe._time_bucket(12) == "lunch"
        assert fe._time_bucket(15) == "afternoon"
        assert fe._time_bucket(19) == "dinner"
        assert fe._time_bucket(23) == "late_night"

    def test_customer_order_count_no_leakage(self):
        """First chronological order for a customer must have a prior count of 0."""
        df = _synthetic_rows()
        X = fe.transform(df, training=True)
        assert X["customer_order_count"].min() == 0.0

    def test_build_preprocessor_fits(self):
        pytest.importorskip("sklearn")
        df = _synthetic_rows(n=12)
        X = fe.transform(df, training=True)
        pre = fe.build_preprocessor()
        out = pre.fit_transform(X, fe.make_label(df))
        assert out.shape[0] == len(df)
        assert len(fe.get_feature_names(pre)) > 0


class TestModels:
    def test_order_input_all_optional(self):
        from app.models.cancellation import OrderInput
        o = OrderInput()  # nothing required
        assert o.total_order_value is None

    def test_batch_request_requires_orders(self):
        from pydantic import ValidationError
        from app.models.cancellation import BatchPredictRequest
        with pytest.raises(ValidationError):
            BatchPredictRequest(orders=[])

    def test_chat_request_text_property(self):
        from app.models.cancellation import CancellationChatRequest
        req = CancellationChatRequest(question="  why did cancellations spike?  ")
        assert req.text == "why did cancellations spike?"


class TestPredictorDegradation:
    def test_model_health_unavailable_without_artifacts(self):
        from app.services import predictor_service as p
        health = p.model_health()
        # No trained model in the test environment.
        assert health["status"] in {"ready", "unavailable"}
        assert "model_loaded" in health

    @pytest.mark.asyncio
    async def test_predict_model_engine_raises_when_model_missing(self):
        """engine='model' must hard-fail without a trained model (no Gemini fallback)."""
        from app.services import predictor_service as p
        if p.is_available():
            pytest.skip("A trained model is present; degradation path not exercised.")
        with pytest.raises(p.ModelUnavailable):
            await p.predict_one({"total_order_value": 50}, engine="model")


class TestExplorationConfig:
    def test_every_exploration_artifact_has_a_function(self):
        from app.services import cancellation_service as svc
        assert set(svc.EXPLORATION_FUNCS) == {
            "cancellation_trend", "cancellation_by_merchant", "cancellation_by_zone",
            "cancellation_by_time", "cancellation_by_dow", "cancellation_by_order_size",
            "cancellation_by_actor", "cancellation_by_reason", "cancellation_crosstabs",
        }

    def test_missing_artifact_loaders_return_none(self, tmp_path, monkeypatch):
        from app.services import cancellation_service as svc
        monkeypatch.setattr(svc, "FEATURE_IMPORTANCE_PATH", tmp_path / "nope.json")
        monkeypatch.setattr(svc, "THRESHOLD_ANALYSIS_PATH", tmp_path / "nope2.json")
        assert svc.load_feature_importance() is None
        assert svc.load_threshold_analysis() is None
