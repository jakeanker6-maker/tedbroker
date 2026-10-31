"""Small caching and rate-limiting helpers for market data."""
from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple


class TTLCache:
    """In-memory cache with per-entry TTL and single-flight loading (concurrent
    callers for the same key share one upstream request)."""

    def __init__(self, max_items: int = 2000):
        self._data: Dict[Any, Tuple[float, Any]] = {}
        self._inflight: Dict[Any, asyncio.Future] = {}
        self.max_items = max_items

    def get(self, key, allow_stale: bool = False) -> Optional[Any]:
        hit = self._data.get(key)
        if not hit:
            return None
        expires, value = hit
        if allow_stale or time.time() < expires:
            return value
        return None

    def set(self, key, value, ttl: float) -> None:
        if len(self._data) >= self.max_items:
            oldest = min(self._data.items(), key=lambda kv: kv[1][0])[0]
            self._data.pop(oldest, None)
        self._data[key] = (time.time() + ttl, value)

    def clear(self) -> None:
        self._data.clear()

    async def get_or_load(self, key, ttl: float, loader: Callable[[], Awaitable[Any]],
                          stale_on_error: bool = True) -> Any:
        fresh = self.get(key)
        if fresh is not None:
            return fresh
        if key in self._inflight:
            return await self._inflight[key]
        fut = asyncio.get_event_loop().create_future()
        self._inflight[key] = fut
        try:
            value = await loader()
            self.set(key, value, ttl)
            fut.set_result(value)
            return value
        except Exception as exc:
            stale = self.get(key, allow_stale=True) if stale_on_error else None
            if stale is not None:
                fut.set_result(stale)
                return stale
            fut.set_exception(exc)
            fut.exception()  # mark retrieved so asyncio does not warn when nobody else awaits
            raise
        finally:
            self._inflight.pop(key, None)


class TokenBucket:
    """Async token bucket: `rate` tokens per second, burst `capacity`."""

    def __init__(self, rate: float, capacity: float):
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.updated = time.monotonic()
        self._lock: Optional[asyncio.Lock] = None

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def try_acquire(self) -> bool:
        self._refill()
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

    async def acquire(self, timeout: float = 10.0) -> bool:
        if self._lock is None:
            self._lock = asyncio.Lock()
        deadline = time.monotonic() + timeout
        async with self._lock:
            while True:
                if self.try_acquire():
                    return True
                wait = (1 - self.tokens) / self.rate
                if time.monotonic() + wait > deadline:
                    return False
                await asyncio.sleep(wait)


class CircuitBreaker:
    """Skip a provider for `cooldown` seconds after `threshold` consecutive failures."""

    def __init__(self, threshold: int = 3, cooldown: float = 60.0):
        self.threshold, self.cooldown = threshold, cooldown
        self.failures = 0
        self.open_until = 0.0

    @property
    def available(self) -> bool:
        return time.time() >= self.open_until

    def ok(self) -> None:
        self.failures = 0
        self.open_until = 0.0

    def fail(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.open_until = time.time() + self.cooldown
            self.failures = 0
