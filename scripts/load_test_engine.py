"""Phase 6 load test for the matching engine (in-process, in-memory database).

    venv/bin/python scripts/load_test_engine.py [--orders 500] [--clients 50] [--seconds 20]
                                                [--symbols 25] [--db-latency-ms 0]

Setup: N users with resting (non-marketable) limit orders spread over S symbols, C price-stream
subscribers (what each SSE /api/stream/prices connection holds), and a random-walk feed that
publishes every symbol every 100 ms. Prices drift down at the end so some orders fill.
`--db-latency-ms` adds a delay to every database call to mimic a remote MongoDB (Atlas).

Reports engine tick time (target: under 50 ms), subscriber delivery latency, fills, and a
ledger reconciliation of every user. Exit code 1 if the target or a reconciliation fails.
Never touches the MongoDB configured in .env.
"""
import argparse
import asyncio
import random
import statistics
import sys
import time
from decimal import Decimal as D
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import mongomock  # noqa: E402

import app.database as database  # noqa: E402

database.client = mongomock.MongoClient()
database.db = database.client["tedbroker_load"]

from bson import ObjectId  # noqa: E402

from app.database import get_collection  # noqa: E402
from app.market_data import calendar, service  # noqa: E402
from app.market_data.bus import PriceBus  # noqa: E402
from app.market_data.quotes import make_quote  # noqa: E402
from app.trading import engine as engine_mod  # noqa: E402
from app.trading import events, ledger, orders, portfolio, risk_monitor  # noqa: E402
from app.trading.models import OrderRequest  # noqa: E402


def add_db_latency(ms: float) -> None:
    if ms <= 0:
        return
    from mongomock.collection import Collection
    for name in ("find_one", "find", "update_one", "insert_one", "find_one_and_update", "count_documents", "update_many"):
        orig = getattr(Collection, name)

        def wrapped(self, *a, __orig=orig, **k):
            time.sleep(ms / 1000)
            return __orig(self, *a, **k)
        setattr(Collection, name, wrapped)


TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "MA", "UNH", "HD", "PG",
           "KO", "PEP", "XOM", "CVX", "WMT", "DIS", "NFLX", "INTC", "AMD", "CSCO", "ORCL", "IBM",
           "BA", "NKE", "MCD", "COST", "ADBE"]


class NoBots:
    stats: dict = {}

    async def start(self):
        pass

    async def tick(self):
        pass

    def stop(self):
        pass


async def main(args) -> int:
    calendar.equity_session = lambda now=None: "open"
    symbols = TICKERS[:args.symbols]
    price = {s: 100.0 for s in symbols}
    bus = PriceBus()

    def quote(sym):
        p = price[sym]
        return make_quote(sym, "stock", last=p, bid=round(p - 0.01, 2), ask=round(p + 0.01, 2),
                          prev_close=100.0, ts=time.time(), source="load")

    async def fake_quote(symbol, asset_class=None, max_age=None):
        return quote(symbol)

    async def fake_quotes(syms):
        return {s: quote(s) for s in syms}

    async def nothing(*a, **k):
        return 0
    service.get_quote, service.get_quotes = fake_quote, fake_quotes
    portfolio.snapshot_all = nothing
    risk_monitor.run = nothing

    ledger.ensure_indexes()
    orders.ensure_indexes()
    users = []
    per_user = 10
    n_users = max(1, args.orders // per_user)
    for _ in range(n_users):
        uid = ObjectId()
        get_collection("users").insert_one({"_id": uid, "email": f"{uid}@load.test", "wallet_balance": 100_000.0})
        users.append(str(uid))
    rng = random.Random(7)
    placed = 0
    for i, uid in enumerate(users):
        for j in range(per_user):
            sym = symbols[(i * per_user + j) % len(symbols)]
            limit = D(str(round(rng.uniform(90, 97), 2)))
            o = orders.place(uid, OrderRequest(symbol=sym, side="buy", qty=D("1"), type="limit",
                                               limit_price=limit, tif="gtc"), quote(sym))
            assert o["status"] == "accepted", o
            placed += 1
    add_db_latency(args.db_latency_ms)

    eng = engine_mod.Engine(bus)
    eng.bots = NoBots()
    fill_ms: list = []
    orig_batch = eng._process_batch

    def timed_batch(oids, q):
        t0 = time.perf_counter()
        out = orig_batch(oids, q)
        if oids:
            fill_ms.append((time.perf_counter() - t0) * 1000 / len(oids))
        return out
    eng._process_batch = timed_batch
    events.bind_loop(asyncio.get_running_loop())
    await eng.start()

    # price-stream subscribers (one per SSE client), each watching every symbol
    lat: list = []
    received = [0]

    async def client(sub):
        while True:
            batch = await sub.next_batch(timeout=1)
            now = time.time()
            for q in batch:
                received[0] += 1
                lat.append((now - float(q["ts"])) * 1000)
    subs = [bus.subscribe(symbols) for _ in range(args.clients)]
    tasks = [asyncio.create_task(client(s)) for s in subs]

    ticks = []
    t_end = time.time() + args.seconds
    drift_from = time.time() + args.seconds * 0.6
    rounds = 0
    while time.time() < t_end:
        down = time.time() > drift_from
        for s in symbols:
            step = rng.gauss(-0.35 if down else 0.0, 0.15)
            price[s] = max(1.0, round(price[s] + step, 2))
            bus.publish(quote(s))
        rounds += 1
        await asyncio.sleep(0.1)
        if eng.stats["last_tick_ms"]:
            ticks.append(eng.stats["last_tick_ms"])
    await asyncio.sleep(1.0)
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    for s in subs:
        s.close()
    st = eng.status()
    await eng.stop()

    bad = [u for u in users if not ledger.reconcile(u)["ok"]]
    open_left = orders.orders_col().count_documents({"status": {"$in": ["accepted", "triggered", "partially_filled"]}})
    p = lambda xs, q: (sorted(xs)[min(len(xs) - 1, int(len(xs) * q))] if xs else 0.0)  # noqa: E731
    print(f"orders placed        {placed} over {len(symbols)} symbols, {len(users)} users")
    print(f"feed                 {rounds} rounds x {len(symbols)} quotes, db latency {args.db_latency_ms} ms/call")
    tk = st["tick"]
    print(f"engine ticks         {tk['ticks']} ({tk['with_fills']} with fills)")
    print(f"  evaluation only    p95 {tk['eval_only_p95_ms']:.2f} ms   <- target < 50 ms")
    print(f"  with fills         p95 {tk['with_fills_p95_ms']:.2f} ms   (fills: {st['fills']}, "
          f"{statistics.median(fill_ms) if fill_ms else 0:.1f} ms median per processed order)")
    print(f"  all ticks          median {statistics.median(ticks) if ticks else 0:.2f}  max {st['max_tick_ms']:.2f} ms")
    print(f"evaluations          {st['evaluations']}  sent to DB path {st['candidates']}  fills {st['fills']}  "
          f"errors {st['errors']}  open left {open_left}")
    print(f"subscribers          {args.clients} received {received[0]} quotes, delivery p95 {p(lat, .95):.2f} ms")
    print(f"ledger reconcile     {'ok' if not bad else f'FAILED for {len(bad)} users'}")
    ok = tk["eval_only_p95_ms"] < 50 and not bad and st["errors"] == 0
    print("RESULT               " + ("PASS (evaluation p95 < 50 ms, ledger reconciles, no errors)" if ok else "FAIL"))
    print("note                 the in-memory test database scans collections linearly (no indexes),\n"
          "                     so fill-tick times here overstate a real MongoDB; evaluation-only\n"
          "                     ticks never touch the database (in-memory pre-screen).")
    return 0 if ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--orders", type=int, default=500)
    ap.add_argument("--clients", type=int, default=50)
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--symbols", type=int, default=25, help="max 30")
    ap.add_argument("--db-latency-ms", type=float, default=0)
    sys.exit(asyncio.run(main(ap.parse_args())))
