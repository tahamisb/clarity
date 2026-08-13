"""
Shared async TTL-cache decorator for warehouse-backed read paths.

Keys are the function's bound arguments (defaults applied), so positional and
keyword call styles hit the same entry. One global registry lets
/api/cache/clear drop everything at once. The older per-service caches in
cancellation_service and call_analytics_service predate this and keep their own
stores; clear_all() only covers caches created here.

**The TTL depends on what was asked for.** A flat five minutes was right when
the warehouse was a frozen file — nothing could change, so the only cost was
staleness at startup. Against a live warehouse it is wrong in a specific,
demo-killing way: the numbers stop moving, and a dashboard that does not move
is exactly what this project exists to fix.

So: a query whose window includes today expires in seconds, because that is
the data actually changing. A query over a closed historical period keeps the
long TTL, because those rows are immutable and re-running the scan is pure
cost. Under the frozen clock every window is historical and this reverts to
the old behaviour.
"""

import functools
import inspect
import logging
import time

from app.utils import clock

logger = logging.getLogger(__name__)

# Historical windows: nothing behind them can change.
TTL_S = 300
# Anything touching today. Short enough that a dashboard visibly moves, long
# enough that the warm loop and a room full of viewers do not re-run every
# aggregate on every poll.
LIVE_TTL_S = 20

_STORES: list[dict] = []

# Argument names that carry the end of a requested window. `end`/`to_date` are
# the two spellings in the service layer.
_END_ARGS = ("end", "end_date", "to_date")
_START_ARGS = ("start", "start_date", "from_date")


def _touches_today(arguments: dict) -> bool:
    """Would this result change if new rows arrived right now?

    An unbounded window (no start, no end — the "All time" preset) always
    includes today, which is why the default is True. Getting that backwards
    would cache the busiest view on the dashboard for five minutes.
    """
    if clock.FROZEN:
        return False
    today = clock.today().isoformat()
    for name in _END_ARGS:
        end = arguments.get(name)
        if isinstance(end, str) and end:
            # A window that closed before today cannot gain rows.
            return end >= today
    return True


def ttl_for(arguments: dict) -> int:
    return LIVE_TTL_S if _touches_today(arguments) else TTL_S


def ttl_cache(fn):
    """Cache an async function's result per-arguments, TTL by window."""
    store: dict = {}
    _STORES.append(store)
    sig = inspect.signature(fn)

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        key = tuple(sorted(bound.arguments.items()))
        ttl = ttl_for(bound.arguments)
        now = time.time()
        hit = store.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        value = await fn(*args, **kwargs)
        store[key] = (now, value)
        return value

    return wrapper


def clear_all() -> None:
    for store in _STORES:
        store.clear()
