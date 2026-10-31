"""Upstream market-data providers. Each adapter normalises to app.market_data.quotes."""
from __future__ import annotations

from typing import Optional

import httpx

_client: Optional[httpx.AsyncClient] = None


def http() -> httpx.AsyncClient:
    """Shared HTTP client (connection pooling). Created lazily inside the running loop."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=5.0),
                                    headers={"User-Agent": "TEDBrokers/1.0"},
                                    follow_redirects=True)
    return _client


async def close_http() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


class ProviderError(Exception):
    pass


# Host reachability gate. Some networks block provider domains (e.g. school DNS
# filters return NXDOMAIN for crypto exchanges, sometimes slowly). Failed lookups
# occupy the resolver thread pool and can stall lookups for healthy providers, so a
# blocked host is checked once with a short timeout and skipped for a while.
_dns: dict = {}
DNS_OK_TTL = 1800
DNS_FAIL_TTL = 600


async def host_reachable(host: str, timeout: float = 3.0) -> bool:
    import asyncio
    import time
    cached = _dns.get(host)
    now = time.time()
    if cached and now < cached[1]:
        return cached[0]
    pending = cached[2] if cached and len(cached) > 2 else None
    if pending is not None and not pending.done():
        return await asyncio.shield(pending)
    loop = asyncio.get_running_loop()

    async def resolve() -> bool:
        try:
            await asyncio.wait_for(loop.getaddrinfo(host, 443), timeout)
            ok = True
        except Exception:
            ok = False
        _dns[host] = (ok, time.time() + (DNS_OK_TTL if ok else DNS_FAIL_TTL))
        return ok

    task = asyncio.ensure_future(resolve())
    _dns[host] = (cached[0] if cached else False, 0, task)
    return await task
