"""In-process price bus: latest quote per symbol + coalescing pub/sub.

Every consumer (an SSE client, the matching engine, the copy engine) opens a
Subscription for a set of symbols. Updates are coalesced per symbol, so a slow
consumer only ever sees the newest quote, never a backlog.

The set of symbols with at least one subscriber is the "demand" that the feed
manager streams from upstream providers. This bus lives in one process; run
Uvicorn with a single worker (Redis pub/sub is the upgrade path).
"""
from __future__ import annotations

import asyncio
from collections import Counter
from typing import Callable, Dict, Iterable, List, Optional, Set


class Subscription:
    def __init__(self, bus: "PriceBus", symbols: Iterable[str]):
        self.bus = bus
        self.symbols: Set[str] = set()
        self._pending: Dict[str, dict] = {}
        self._event = asyncio.Event()
        self.closed = False
        self.update(symbols)

    def update(self, symbols: Iterable[str]) -> None:
        new = set(symbols)
        self.bus._change(self, self.symbols, new)
        self.symbols = new

    def offer(self, quote: dict) -> None:
        self._pending[quote["symbol"]] = quote
        self._event.set()

    async def next_batch(self, timeout: Optional[float] = None) -> List[dict]:
        """Wait for updates; returns [] on timeout. Coalesced: newest quote per symbol."""
        if not self._pending:
            self._event.clear()
            try:
                await asyncio.wait_for(self._event.wait(), timeout)
            except asyncio.TimeoutError:
                return []
        batch, self._pending = list(self._pending.values()), {}
        self._event.clear()
        return batch

    def close(self) -> None:
        if not self.closed:
            self.bus._change(self, self.symbols, set())
            self.symbols = set()
            self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class PriceBus:
    def __init__(self):
        self.latest: Dict[str, dict] = {}
        self._subs: Dict[str, Set[Subscription]] = {}
        self._demand: Counter = Counter()
        self._demand_listeners: List[Callable[[Set[str]], None]] = []

    # ---- publishing
    def publish(self, quote: dict) -> None:
        sym = quote["symbol"]
        prev = self.latest.get(sym)
        if prev and float(prev.get("ts") or 0) > float(quote.get("ts") or 0):
            return  # never let an older quote overwrite a newer one
        self.latest[sym] = quote
        for sub in list(self._subs.get(sym, ())):
            sub.offer(quote)

    def get(self, symbol: str) -> Optional[dict]:
        return self.latest.get(symbol)

    # ---- subscriptions
    def subscribe(self, symbols: Iterable[str]) -> Subscription:
        sub = Subscription(self, symbols)
        for s in sub.symbols:  # prime with what we already have
            if s in self.latest:
                sub.offer(self.latest[s])
        return sub

    def demand(self) -> Set[str]:
        return {s for s, n in self._demand.items() if n > 0}

    def on_demand_change(self, fn: Callable[[Set[str]], None]) -> None:
        self._demand_listeners.append(fn)

    def _change(self, sub: Subscription, old: Set[str], new: Set[str]) -> None:
        before = self.demand()
        for s in old - new:
            self._subs.get(s, set()).discard(sub)
            self._demand[s] -= 1
            if self._demand[s] <= 0:
                del self._demand[s]
        for s in new - old:
            self._subs.setdefault(s, set()).add(sub)
            self._demand[s] += 1
            if s in self.latest:
                sub.offer(self.latest[s])
        after = self.demand()
        if after != before:
            for fn in list(self._demand_listeners):
                try:
                    fn(after)
                except Exception as exc:
                    print(f"price bus demand listener error: {exc}")


bus = PriceBus()
