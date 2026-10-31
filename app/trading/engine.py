"""Matching engine: watches the PriceBus for every symbol with open orders or open
positions and executes orders when the fill rules say so.

  quote loop   coalesced quotes from the bus -> in-memory pre-screen with the pure
               matching rules -> orders.process() (authoritative, under the user lock)
               only for orders that could fill or trigger, in one worker-thread hop
  sweep (1 s)  DAY/GTC expiry, re-evaluation after the open, options expiration,
               margin calls / liquidation (5 s), borrow fees + margin interest and
               dividends (10 min, idempotent per day), portfolio snapshots (60 s),
               index refresh (30 s)

Subscribing to position symbols keeps their prices streaming, so portfolio values
and the copy engine always see live marks. One engine per process.
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Dict, Optional, Set

from app.market_data import calendar, service
from app.market_data.bus import bus as default_bus
from app.trading import alerts, baskets, borrow, recurring, bots, copy_engine, dividends, expiration, orders, portfolio, risk_monitor
from app.trading import matching
from app.trading import options as opt
from app.trading.models import OPEN_STATUSES


class Engine:
    def __init__(self, bus=default_bus):
        self.bus = bus
        self.by_symbol: Dict[str, Set] = defaultdict(set)
        # last known state of each open order: lets a tick skip orders that cannot fill
        self.docs: Dict = {}
        # active price / % move alerts by symbol (their symbols keep streaming too)
        self.alerts: Dict[str, list] = defaultdict(list)
        self.position_symbols: Set[str] = set()
        self.sub = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self._tasks = []
        self._last_session = None
        self.stats = {"fills": 0, "evaluations": 0, "candidates": 0, "last_tick": None, "errors": 0,
                      "last_error": None, "copy_jobs": 0, "last_tick_ms": 0.0, "max_tick_ms": 0.0}
        self.bots = bots.BotRunner()
        # recent tick durations: (ms, did_db_work). Evaluation-only ticks are the latency target.
        self.tick_log: deque = deque(maxlen=2000)

    # ------------------------------------------------------------- index
    def _symbols(self) -> Set[str]:
        return ({s for s, ids in self.by_symbol.items() if ids} | self.position_symbols
                | {s for s, a in self.alerts.items() if a})

    def _resubscribe(self) -> None:
        if self.sub is not None:
            self.sub.update(self._symbols())

    def watch(self, order: Dict) -> None:
        """Called from any thread when an order is accepted."""
        def add():
            if order.get("status") in OPEN_STATUSES:
                for sym in _order_symbols(order):
                    self.by_symbol[sym].add(order["_id"])
                self.docs[order["_id"]] = order
            else:
                self.docs.pop(order.get("_id"), None)
                self.position_symbols.add(order["symbol"])
            self._resubscribe()
        if self.loop and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(add)

    def watch_alert(self, alert: Dict) -> None:
        """Called from any thread when an alert is created."""
        def add():
            if alert.get("symbol") and alert["kind"] != "order_filled":
                self.alerts[alert["symbol"]].append(alert)
                self._resubscribe()
        if self.loop and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(add)

    def refresh_index(self) -> None:
        index = defaultdict(set)
        docs = {}
        for o in orders.open_orders():
            for sym in _order_symbols(o):
                index[sym].add(o["_id"])
            docs[o["_id"]] = o
        self.by_symbol = index
        self.docs = docs
        self.position_symbols = {p["symbol"] for p in orders.positions.col().find({"open": True}, {"symbol": 1})}
        by_sym = defaultdict(list)
        for a in alerts.active_price_alerts():
            by_sym[a["symbol"]].append(a)
        self.alerts = by_sym
        self._resubscribe()

    # ------------------------------------------------------------- evaluation
    def _could_act(self, oid, quote: Dict) -> bool:
        """Cheap in-memory check: would the matching rules fill, trigger or update this order?
        Unknown and multi-leg orders always go to the authoritative path."""
        doc = self.docs.get(oid)
        if doc is None or doc.get("asset_class") == "multileg":
            return True
        try:
            rem = orders.remaining_qty(doc)
            hint = rem if rem is not None else matching.D("1")
            d = matching.evaluate(doc, quote, hint)
        except Exception:
            return True
        return d.fill_price is not None or d.triggered or bool(d.updates)

    def _process_batch(self, oids, quote: Dict):
        """Worker thread: process the candidates and return their fresh state."""
        out = []
        for oid in oids:
            fill, err = None, None
            try:
                fill = orders.process(oid, quote)
            except Exception as exc:
                err = f"{type(exc).__name__}: {exc}"
            out.append((oid, fill, err, orders.orders_col().find_one({"_id": oid})))
        return out

    async def _evaluate_symbol(self, symbol: str, quote: Dict) -> None:
        ids = list(self.by_symbol.get(symbol, ()))
        self.stats["evaluations"] += len(ids)
        candidates = [oid for oid in ids if self._could_act(oid, quote)]
        if not candidates:
            return
        self.stats["candidates"] += len(candidates)
        for oid, fill, err, doc in await asyncio.to_thread(self._process_batch, candidates, quote):
            if err:
                self.stats["errors"] += 1
                self.stats["last_error"] = err
            if fill:
                self.stats["fills"] += 1
                self.position_symbols.add(symbol)
            if not doc or doc["status"] not in OPEN_STATUSES:
                self.by_symbol[symbol].discard(oid)
                self.docs.pop(oid, None)
            else:
                self.docs[oid] = doc
        if not self.by_symbol.get(symbol):
            self._resubscribe()

    async def _check_alerts(self, symbol: str, quote: Dict) -> None:
        candidates = [a for a in self.alerts.get(symbol, ()) if alerts.hit(a, quote)]
        if not candidates:
            return
        try:
            fired = await asyncio.to_thread(alerts.check_quote, candidates, quote)
        except Exception as exc:
            self.stats["errors"] += 1
            self.stats["last_error"] = f"alerts {type(exc).__name__}: {exc}"
            return
        self.stats["alerts_fired"] = self.stats.get("alerts_fired", 0) + len(fired)
        done = {a["_id"]: a for a in fired}
        keep = []
        for a in self.alerts.get(symbol, ()):
            new = done.get(a["_id"])
            if new is None:
                keep.append(a)
            elif new["status"] == "active":        # pct_move: stays, but not again today
                keep.append(new)
        self.alerts[symbol] = keep
        if not keep:
            self._resubscribe()

    async def _quote_loop(self) -> None:
        while True:
            batch = await self.sub.next_batch(timeout=5)
            t0 = time.perf_counter()
            work0 = self.stats["candidates"]
            self.stats["last_tick"] = time.time()
            for q in batch:
                if self.by_symbol.get(q["symbol"]):
                    await self._evaluate_symbol(q["symbol"], q)
                if self.alerts.get(q["symbol"]):
                    await self._check_alerts(q["symbol"], q)
            if batch:
                ms = (time.perf_counter() - t0) * 1000
                self.stats["last_tick_ms"] = round(ms, 2)
                self.stats["max_tick_ms"] = round(max(self.stats["max_tick_ms"], ms), 2)
                self.tick_log.append((ms, self.stats["candidates"] != work0))

    async def _reevaluate_all(self) -> None:
        """Re-check every open order with the freshest quote (e.g. right after the open)."""
        for symbol in list(self.by_symbol):
            if not self.by_symbol[symbol]:
                continue
            try:
                q = await service.get_quote(symbol)
            except Exception:
                continue
            await self._evaluate_symbol(symbol, q)

    # ------------------------------------------------------------- sweep
    async def _sweep(self) -> None:
        last_index = last_snapshot = last_risk = last_daily = last_bots = last_copy = last_recurring = 0.0
        while True:
            await asyncio.sleep(1)
            try:
                now = time.time()
                expired = await asyncio.to_thread(orders.expire_due)
                if expired or now - last_index > 30:
                    await asyncio.to_thread(self.refresh_index)
                    last_index = now
                session = calendar.equity_session()
                if session != self._last_session:
                    self._last_session = session
                    await self._reevaluate_all()
                await expiration.run_due()
                await self._copy_jobs()
                if now - last_copy > 30:
                    last_copy = now
                    await asyncio.to_thread(copy_engine.check_stop_losses)
                    await asyncio.to_thread(copy_engine.finish_stops)
                if now - last_recurring > 60:
                    last_recurring = now
                    await self._recurring()
                if now - last_bots > 20:
                    last_bots = now
                    await self.bots.tick()
                if now - last_risk > 5:
                    last_risk = now
                    await risk_monitor.run()
                if now - last_daily > 600:
                    last_daily = now
                    await asyncio.to_thread(borrow.run_daily)
                    await dividends.run_due()
                    await self._auto_invest()
                if now - last_snapshot > 60:
                    last_snapshot = now
                    await portfolio.snapshot_all()
            except Exception as exc:
                self.stats["errors"] += 1
                self.stats["last_error"] = f"sweep {type(exc).__name__}: {exc}"

    async def _copy_jobs(self) -> None:
        """Mirror trader (bot) fills into followers' copy buckets."""
        for job in await asyncio.to_thread(copy_engine.pending_jobs):
            try:
                await asyncio.to_thread(copy_engine.process_job, job)
                self.stats["copy_jobs"] += 1
            except Exception as exc:
                self.stats["errors"] += 1
                self.stats["last_error"] = f"copy job {type(exc).__name__}: {exc}"
                await asyncio.to_thread(copy_engine.jobs().update_one, {"_id": job["_id"]},
                                        {"$set": {"status": "failed", "error": str(exc)[:300]}})

    async def _recurring(self) -> None:
        """Due recurring investments. Stock/ETF/basket runs wait for the regular session."""
        open_now = calendar.equity_session() == "open"
        for p in await asyncio.to_thread(recurring.due):
            if recurring.needs_open_market(p) and not open_now:
                continue
            t = p["target"]
            try:
                if t["kind"] == "symbol":
                    syms = [t["symbol"]]
                else:
                    b = await asyncio.to_thread(baskets.get, p["user_id"], t["basket_id"])
                    syms = [x["symbol"] for x in b["targets"]]
                quotes = {s: await service.get_quote(s) for s in syms}
            except Exception as exc:
                quotes = {}
                self.stats["last_error"] = f"recurring quotes {type(exc).__name__}: {exc}"
            await asyncio.to_thread(recurring.run, p, quotes)
            self.stats["recurring_runs"] = self.stats.get("recurring_runs", 0) + 1

    async def _auto_invest(self) -> None:
        """Scheduled ETF-basket investments (weekly / monthly)."""
        for b in await asyncio.to_thread(baskets.due_auto_invest):
            try:
                quotes = {t["symbol"]: await service.get_quote(t["symbol"]) for t in b["targets"]}
                await asyncio.to_thread(baskets.invest, b["user_id"], str(b["_id"]),
                                        baskets.D(b["auto_invest"]["amount"]), quotes)
                await asyncio.to_thread(baskets.mark_auto_run, b, True)
            except Exception as exc:
                await asyncio.to_thread(baskets.mark_auto_run, b, False, str(exc)[:200])

    # ------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        await asyncio.to_thread(orders.ensure_indexes)
        await asyncio.to_thread(portfolio.ensure_indexes)
        await asyncio.to_thread(risk_monitor.ensure_indexes)
        await asyncio.to_thread(copy_engine.ensure_indexes)
        await self.bots.start()
        await asyncio.to_thread(orders.recover_pending_fills)
        self.sub = self.bus.subscribe(set())
        await asyncio.to_thread(self.refresh_index)
        orders.order_watchers.append(self.watch)
        alerts.watchers.append(self.watch_alert)
        await asyncio.to_thread(alerts.ensure_indexes)
        await asyncio.to_thread(recurring.ensure_indexes)
        self._tasks = [asyncio.create_task(self._quote_loop()), asyncio.create_task(self._sweep())]
        await self._reevaluate_all()

    async def stop(self) -> None:
        if self.watch in orders.order_watchers:
            orders.order_watchers.remove(self.watch)
        if self.watch_alert in alerts.watchers:
            alerts.watchers.remove(self.watch_alert)
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        if self.sub:
            self.sub.close()
        self.bots.stop()

    def tick_summary(self) -> Dict:
        def p95(xs):
            xs = sorted(xs)
            return round(xs[min(len(xs) - 1, int(len(xs) * 0.95))], 2) if xs else 0.0
        quiet = [ms for ms, work in self.tick_log if not work]
        busy = [ms for ms, work in self.tick_log if work]
        return {"ticks": len(self.tick_log), "eval_only_p95_ms": p95(quiet), "with_fills_p95_ms": p95(busy),
                "with_fills": len(busy)}

    def status(self) -> Dict:
        return {"open_orders": sum(len(v) for v in self.by_symbol.values()),
                "watched_symbols": len(self._symbols()), **self.stats, "tick": self.tick_summary(),
                "bots": self.bots.stats}


def _order_symbols(order: Dict):
    return [l["symbol"] for l in order["legs"]] if order.get("legs") else [order["symbol"]]


engine: Optional[Engine] = None


async def start() -> Engine:
    global engine
    if engine is None:
        engine = Engine()
        await engine.start()
    return engine


async def stop() -> None:
    global engine
    if engine is not None:
        await engine.stop()
        engine = None
