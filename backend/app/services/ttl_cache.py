"""
Shared async TTL-cache decorator for warehouse-backed read paths.

Keys are the function's bound arguments (defaults applied), so positional and
keyword call styles hit the same entry. One global registry lets
/api/cache/clear drop everything at once. The older per-service caches in
cancellation_service and call_analytics_service predate this and keep their own
stores; clear_all() only covers caches created here.
"""

import functools
import inspect
import time

TTL_S = 300

_STORES: list[dict] = []


def ttl_cache(fn):
    """Cache an async function's result per-arguments for TTL_S seconds."""
    store: dict = {}
    _STORES.append(store)
    sig = inspect.signature(fn)

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        key = tuple(sorted(bound.arguments.items()))
        now = time.time()
        hit = store.get(key)
        if hit and now - hit[0] < TTL_S:
            return hit[1]
        value = await fn(*args, **kwargs)
        store[key] = (now, value)
        return value

    return wrapper


def clear_all() -> None:
    for store in _STORES:
        store.clear()
