"""TTL cache used by call_analytics_service: serves within TTL, recomputes after."""

import pytest

from app.services import call_analytics_service as svc


@pytest.mark.asyncio
async def test_cached_hit_then_expiry(monkeypatch):
    svc.clear_cache()
    calls = {"n": 0}

    async def make():
        calls["n"] += 1
        return calls["n"]

    monkeypatch.setattr(svc.time, "time", lambda: 1000.0)
    assert await svc._cached("k", make) == 1        # miss → computes
    assert await svc._cached("k", make) == 1        # hit → cached, make not re-run
    assert calls["n"] == 1

    monkeypatch.setattr(svc.time, "time", lambda: 1000.0 + svc._CACHE_TTL_S + 1)
    assert await svc._cached("k", make) == 2        # expired → recomputes
    assert calls["n"] == 2
