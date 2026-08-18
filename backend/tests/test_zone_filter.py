"""Zone filter: scopes every pillar, and only accepts real zones."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import zones

client = TestClient(app)


@pytest.fixture(scope="module")
def zone() -> str:
    known = zones.all_zones()
    if not known:
        pytest.skip("no warehouse zones available")
    return known[0]


def _orders(params: str) -> int:
    r = client.get(f"/api/cancellation/analytics/trend{params}")
    assert r.status_code == 200, r.text
    return sum(m["total_orders"] for m in r.json()["monthly"])


def test_zone_scopes_cancellations(zone):
    assert 0 < _orders(f"?zone={zone}") < _orders("")


@pytest.mark.parametrize("path", [
    "/api/v1/analytics/handled-by",
    "/api/v1/analytics/message-overview",
])
def test_zone_scopes_message_aggregates(path, zone):
    everything = client.get(path).json()["total"]
    scoped = client.get(path, params={"zone": zone}).json()["total"]
    assert 0 < scoped < everything


@pytest.mark.parametrize("bogus", ["Nowhere", "' OR 1=1--", "Al Khor'; DROP TABLE vendor_kpi;--"])
def test_unknown_zones_are_rejected_not_interpolated(bogus):
    r = client.get("/api/cancellation/analytics/trend", params={"zone": bogus})
    assert r.status_code == 422
    # The table the injection targeted is still there.
    assert client.get("/api/cancellation/analytics/trend").status_code == 200


@pytest.mark.parametrize("empty", ["", "all"])
def test_empty_zone_means_no_filter(empty):
    assert _orders(f"?zone={empty}") == _orders("")


def test_zone_list_endpoint_matches_the_whitelist():
    listed = client.get("/api/cancellation/analytics/zones").json()["zones"]
    assert listed == list(zones.all_zones())
    assert all(zones.is_valid(z) for z in listed)
