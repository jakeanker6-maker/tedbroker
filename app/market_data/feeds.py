"""Long-lived upstream feeds that keep the PriceBus current.

  FinnhubWS   trades for US stocks/ETFs (and crypto via Binance when Coinbase is down)
  CoinbaseWS  crypto ticker with real best bid/ask
  Poller      REST refresh for anything stale (WS down, over the WS symbol limit,
              market closed, or a missing prev-close snapshot)
  OptionMarks re-prices demanded option contracts whenever their underlying moves

The FeedManager watches bus demand and decides which feed carries each symbol.
One upstream connection per provider, fanned out in-process.
"""
from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Dict, Iterable, List, Optional, Set

from app.market_data import service, universe
from app.market_data.bus import PriceBus, bus as default_bus
from app.market_data.providers import coinbase, finnhub, host_reachable
from app.market_data.quotes import make_quote, with_last
from app.trading import options as opt


class WSFeed:
    """Reconnecting websocket client that keeps a wanted-symbol set subscribed."""
    name = "ws"
    url = ""
    max_symbols = 50

    def __init__(self, bus: PriceBus):
        self.bus = bus
        self.wanted: Set[str] = set()
        self.subscribed: Set[str] = set()
        self.connected = False
        self.last_message_at = 0.0
        self.last_error: Optional[str] = None
        self._stop = asyncio.Event()

    # -- overridables
    def enabled(self) -> bool:
        return True

    def connect_url(self) -> str:
        return self.url

    async def send_subscribe(self, ws, add: Set[str], remove: Set[str]) -> None:
        raise NotImplementedError

    def handle(self, msg: dict) -> None:
        raise NotImplementedError

    # -- lifecycle
    def set_wanted(self, symbols: Iterable[str]) -> None:
        self.wanted = set(list(symbols)[: self.max_symbols])

    @property
    def healthy(self) -> bool:
        return self.connected and time.time() - self.last_message_at < 60

    def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        import websockets
        backoff = 1.0
        while not self._stop.is_set():
            if not self.enabled() or not self.wanted:
                await asyncio.sleep(2)
                continue
            host = self.url.split("//", 1)[-1].split("/", 1)[0].split("?", 1)[0]
            if not await host_reachable(host):
                self.last_error = f"{host} not reachable from this network (DNS); retrying later"
                await asyncio.sleep(60)
                continue
            try:
                async with websockets.connect(self.connect_url(), open_timeout=10, ping_interval=20,
                                              ping_timeout=20, max_size=2 ** 22) as ws:
                    self.connected, self.subscribed, backoff = True, set(), 1.0
                    self.last_message_at = time.time()
                    while not self._stop.is_set():
                        if self.wanted != self.subscribed:
                            add, remove = self.wanted - self.subscribed, self.subscribed - self.wanted
                            await self.send_subscribe(ws, add, remove)
                            self.subscribed = set(self.wanted)
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                        except asyncio.TimeoutError:
                            continue
                        self.last_message_at = time.time()
                        try:
                            self.handle(json.loads(raw))
                        except Exception as exc:
                            self.last_error = f"handle: {exc}"
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
            self.connected, self.subscribed = False, set()
            if self._stop.is_set():
                break
            await asyncio.sleep(backoff + random.random())
            backoff = min(backoff * 2, 300)


class FinnhubWS(WSFeed):
    name = "finnhub"
    url = finnhub.WS_URL
    max_symbols = finnhub.WS_MAX_SYMBOLS

    def __init__(self, bus: PriceBus):
        super().__init__(bus)
        self._map: Dict[str, str] = {}  # provider symbol -> canonical

    def enabled(self) -> bool:
        return bool(finnhub.api_key())

    def connect_url(self) -> str:
        return f"{finnhub.WS_URL}?token={finnhub.api_key()}"

    async def send_subscribe(self, ws, add, remove):
        for s in remove:
            await ws.send(json.dumps({"type": "unsubscribe", "symbol": finnhub.provider_symbol(s, universe.asset_class_of(s))}))
        for s in add:
            psym = finnhub.provider_symbol(s, universe.asset_class_of(s))
            self._map[psym] = s
            await ws.send(json.dumps({"type": "subscribe", "symbol": psym}))

    def handle(self, msg: dict) -> None:
        if msg.get("type") != "trade":
            return
        latest: Dict[str, dict] = {}
        for t in msg.get("data") or []:
            sym = self._map.get(t.get("s")) or finnhub.canonical_from_provider(t.get("s", ""))
            if sym and (sym not in latest or t["t"] >= latest[sym]["t"]):
                latest[sym] = t
        for sym, t in latest.items():
            apply_trade(self.bus, sym, float(t["p"]), t["t"] / 1000.0)


class CoinbaseWS(WSFeed):
    name = "coinbase"
    url = coinbase.WS_URL
    max_symbols = 100

    def enabled(self) -> bool:
        return coinbase.enabled()

    async def send_subscribe(self, ws, add, remove):
        if remove:
            await ws.send(json.dumps({"type": "unsubscribe", "product_ids": sorted(remove), "channels": ["ticker"]}))
        if add:
            await ws.send(json.dumps({"type": "subscribe", "product_ids": sorted(add), "channels": ["ticker"]}))

    def handle(self, msg: dict) -> None:
        if msg.get("type") == "ticker" and msg.get("product_id"):
            self.bus.publish(coinbase.parse_ticker_message(msg))
        elif msg.get("type") == "error":
            self.last_error = msg.get("message")


def apply_trade(bus: PriceBus, symbol: str, price: float, ts: float) -> None:
    """Merge a trade print into the latest quote for the symbol."""
    current = bus.get(symbol)
    if (current and current.get("source") == coinbase.SOURCE
            and time.time() - float(current["ts"]) < 10):
        return  # a fresh Coinbase quote has real bid/ask; do not overwrite it with Binance prints
    if current:
        bus.publish(with_last(current, price, ts, source=finnhub.source_label(current["asset_class"])))
    else:
        ac = universe.asset_class_of(symbol)
        bus.publish(make_quote(symbol, ac, last=price, ts=ts, source=finnhub.source_label(ac)))


class Poller:
    """Refreshes demanded symbols whose quote is stale or whose snapshot (prev close,
    open, high, low) is older than 5 minutes. Oldest first, within provider budgets."""

    def __init__(self, bus: PriceBus, interval: float = 2.0):
        self.bus = bus
        self.interval = interval
        self.symbols: Set[str] = set()
        self._stop = asyncio.Event()

    def stop(self):
        self._stop.set()

    def due(self, now: Optional[float] = None) -> List[str]:
        now = now or time.time()
        out = []
        for s in self.symbols:
            ac = universe.asset_class_of(s)
            if ac == "option":
                continue
            q = self.bus.get(s)
            age = now - float(q["ts"]) if q else float("inf")
            if q is None or age > service.freshness_seconds(ac) or service.snapshot_age(s) > 300:
                out.append((service.snapshot_age(s), s))
        return [s for _, s in sorted(out, reverse=True)]

    async def run(self):
        while not self._stop.is_set():
            for sym in self.due()[:4]:
                try:
                    await service.get_quote(sym, max_age=0)
                except Exception:
                    pass
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.interval)
            except asyncio.TimeoutError:
                pass


class FeedManager:
    def __init__(self, bus: PriceBus = default_bus):
        self.bus = bus
        self.finnhub = FinnhubWS(bus)
        self.coinbase = CoinbaseWS(bus)
        self.poller = Poller(bus)
        self.demand: Set[str] = set()
        self._tasks: List[asyncio.Task] = []
        self._underlying_sub = None

    # -- routing
    def assign(self) -> None:
        options = {s for s in self.demand if opt.looks_like_occ(s)}
        roots = {opt.parse_occ(s)["root"] for s in options}
        plain = (self.demand - options) | roots
        crypto = sorted(s for s in plain if s.endswith("-USD"))
        equities = sorted(s for s in plain if not s.endswith("-USD"))
        # Coinbase always keeps trying (with backoff). Until it is healthy, Finnhub also
        # streams crypto; apply_trade() lets Coinbase quotes win once they arrive.
        self.coinbase.set_wanted(crypto if self.coinbase.enabled() else [])
        self.finnhub.set_wanted(equities + ([] if self.coinbase.healthy else crypto))
        self.poller.symbols = set(plain)
        if self._underlying_sub is not None:
            self._underlying_sub.update(roots)

    def on_demand(self, symbols: Set[str]) -> None:
        self.demand = set(symbols)
        self.assign()

    async def _option_marks(self):
        """Re-mark demanded option contracts when their underlying ticks."""
        self._underlying_sub = self.bus.subscribe(set())
        while True:
            batch = await self._underlying_sub.next_batch(timeout=5)
            roots = {q["symbol"] for q in batch}
            for s in [s for s in self.demand if opt.looks_like_occ(s) and opt.parse_occ(s)["root"] in roots]:
                try:
                    await service.get_option_quote(s)
                except Exception:
                    pass
            await asyncio.sleep(0.5)

    async def _health(self):
        """Re-route crypto when Coinbase goes up or down."""
        last = None
        while True:
            state = self.coinbase.healthy
            if state != last:
                self.assign()
                last = state
            await asyncio.sleep(5)

    def is_streaming(self, symbol: str) -> bool:
        """True when a connected WebSocket feed is delivering this symbol right now."""
        return any(f.healthy and symbol in f.subscribed for f in (self.finnhub, self.coinbase))

    def status(self) -> dict:
        return {
            "demand": len(self.demand),
            "finnhub_ws": {"connected": self.finnhub.connected, "symbols": len(self.finnhub.subscribed),
                           "last_error": self.finnhub.last_error},
            "coinbase_ws": {"connected": self.coinbase.connected, "symbols": len(self.coinbase.subscribed),
                            "last_error": self.coinbase.last_error, "enabled": self.coinbase.enabled()},
            "polled": len(self.poller.symbols),
        }

    async def start(self):
        self.bus.on_demand_change(self.on_demand)
        self._tasks = [asyncio.create_task(c) for c in
                       (self.finnhub.run(), self.coinbase.run(), self.poller.run(), self._option_marks(), self._health())]
        self.on_demand(self.bus.demand())

    async def stop(self):
        for f in (self.finnhub, self.coinbase, self.poller):
            f.stop()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []


manager: Optional[FeedManager] = None


def feed_state(q: dict) -> str:
    """'streaming' (live WebSocket), or 'delayed': REST polling while the stream is down,
    delayed or theoretical data, or a stale quote."""
    from app.market_data.quotes import is_stale
    if q.get("delayed") or is_stale(q) or q.get("asset_class") == "option":
        return "delayed"
    return "streaming" if manager is not None and manager.is_streaming(q["symbol"]) else "delayed"


async def start() -> FeedManager:
    global manager
    if manager is None:
        manager = FeedManager()
        await manager.start()
    return manager


async def stop() -> None:
    global manager
    if manager is not None:
        await manager.stop()
        manager = None
    from app.market_data.providers import close_http
    await close_http()
