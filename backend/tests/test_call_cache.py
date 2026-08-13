"""TTL cache used by call_analytics_service: serves within TTL, recomputes after.

The TTL is no longer a constant — it depends on whether the cached window
includes today (see ttl_cache). These tests pin the boundary from the same
source the cache reads, so they keep testing expiry rather than a number.
"""

import pytest

from app.services import call_analytics_service as svc
from app.services import ttl_cache


@pytest.mark.asyncio
async def test_cached_hit_then_expiry(monkeypatch):
    svc.clear_cache()
    calls = {"n": 0}

    async def make():
        calls["n"] += 1
        return calls["n"]

    # These views carry no date filter, so they take whatever ttl_for({}) says.
    ttl = ttl_cache.ttl_for({})

    monkeypatch.setattr(svc.time, "time", lambda: 1000.0)
    assert await svc._cached("k", make) == 1        # miss → computes
    assert await svc._cached("k", make) == 1        # hit → cached, make not re-run
    assert calls["n"] == 1

    monkeypatch.setattr(svc.time, "time", lambda: 1000.0 + ttl + 1)
    assert await svc._cached("k", make) == 2        # expired → recomputes
    assert calls["n"] == 2


def test_live_windows_expire_sooner_than_historical():
    """The point of the change: a window covering today must not be cached for
    as long as a closed one, or a live dashboard stops moving."""
    from app.utils import clock

    if clock.FROZEN:
        # Under the frozen clock nothing is "live" and every window keeps the
        # long TTL — which is exactly what the snapshot demo needs.
        assert ttl_cache.ttl_for({"end": None}) == ttl_cache.TTL_S
        return

    today = clock.today().isoformat()
    assert ttl_cache.ttl_for({"end": today}) == ttl_cache.LIVE_TTL_S
    assert ttl_cache.ttl_for({"end": None}) == ttl_cache.LIVE_TTL_S      # unbounded = includes today
    assert ttl_cache.ttl_for({"end": "2020-01-01"}) == ttl_cache.TTL_S   # closed period
    assert ttl_cache.LIVE_TTL_S < ttl_cache.TTL_S
