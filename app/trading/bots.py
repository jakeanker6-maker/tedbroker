"""Expert traders as automated system accounts trading real prices on the simulated engine.

Every expert_traders document gets a system user (is_system=True) with its own cash and
positions. A strategy chosen from the trader's specialization decides what to hold; orders go
through the normal pipeline (source="bot"), so followers' copy orders mirror real executions.

Strategies (evaluated every 8-20 minutes while their market is open, at most 3 orders each):
  momentum   hold the top-N of a universe by today's change, equal weight; sell names that
             drop out of the top N+1 (hysteresis keeps turnover realistic)
  weights    fixed target weights, rebalanced when a holding drifts > 3 points
  income     SPY shares plus covered calls ~3% out of the money, 2-6 weeks out
Stats on the copy page (YTD return, win rate, max drawdown, AUM, copiers) are computed from
each bot's own snapshots and fills: a live track record that starts when the bot starts.
"""
from __future__ import annotations

import asyncio
import random
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Dict, List, Optional

from bson import ObjectId

from app.database import TRADERS_COLLECTION, USERS_COLLECTION, get_collection
from app.market_data import calendar, service
from app.market_data.bus import bus
from app.trading import ledger, margin, positions
from app.trading import options as opt

D = Decimal
STRATEGIES: Dict[str, Dict] = {
    "crypto_momentum": {"kind": "momentum", "crypto": True, "top": 3, "invest": D("0.85"),
                        "universe": ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "AVAX-USD", "LINK-USD"],
                        "label": "Crypto momentum: rotates into the strongest large-cap coins."},
    "fx_macro": {"kind": "momentum", "top": 2, "invest": D("0.80"),
                 "universe": ["UUP", "FXE", "FXY", "FXB", "FXA", "FXC", "FXF"],
                 "label": "Currency momentum through currency ETFs (USD, EUR, JPY, GBP, AUD, CAD, CHF)."},
    "tech_momentum": {"kind": "momentum", "top": 4, "invest": D("0.90"),
                      "universe": ["NVDA", "MSFT", "AAPL", "AMD", "AVGO", "META", "GOOGL", "AMZN", "TSLA"],
                      "label": "Large-cap technology momentum."},
    "index_rotation": {"kind": "momentum", "top": 3, "invest": D("0.90"),
                       "universe": ["SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV"],
                       "label": "Index and sector ETF rotation."},
    "dividend": {"kind": "weights", "invest": D("0.95"),
                 "weights": {"SCHD": "25", "VYM": "15", "KO": "12", "PEP": "12", "JNJ": "12", "PG": "12", "ABBV": "12"},
                 "label": "Dividend growth: quality dividend ETFs and blue chips, rebalanced on drift."},
    "blue_chip": {"kind": "weights", "invest": D("0.95"),
                  "weights": {"AAPL": "15", "MSFT": "15", "GOOGL": "10", "AMZN": "10", "JPM": "10", "V": "10",
                              "COST": "10", "UNH": "10", "XOM": "10"},
                  "label": "Long-term blue chips, buy and hold with drift rebalancing."},
    "options_income": {"kind": "income", "underlying": "SPY", "stock": D("0.85"),
                       "label": "Options income: SPY shares with covered calls ~3% out of the money."},
}
INTERVAL = (8 * 60, 20 * 60)
MAX_ORDERS = 3


def strategy_for(specialization: str) -> str:
    s = (specialization or "").lower()
    if "crypto" in s or "bitcoin" in s or "defi" in s:
        return "crypto_momentum"
    if "forex" in s or "currency" in s or " fx" in s:
        return "fx_macro"
    if "option" in s:
        return "options_income"
    if "dividend" in s or "income" in s:
        return "dividend"
    if "tech" in s:
        return "tech_momentum"
    if "long-term" in s or "long term" in s or "value" in s:
        return "blue_chip"
    return "index_rotation"


def starting_equity(trader: Dict) -> D:
    aum = D(str(trader.get("assets_under_management") or 0))
    return max(D("100000"), min(aum, D("2000000"))) if aum else D("250000")


def ensure_bots() -> int:
    """Create a system account for every expert trader that has none."""
    traders = get_collection(TRADERS_COLLECTION)
    users = get_collection(USERS_COLLECTION)
    n = 0
    for t in list(traders.find({"$or": [{"system_user_id": {"$exists": False}}, {"system_user_id": None}]})):
        uid = ObjectId()
        equity = starting_equity(t)
        now = datetime.utcnow()
        users.insert_one({
            "_id": uid, "email": f"trader-{t['_id']}@bots.tedbrokers.invalid", "username": f"bot_{t['_id']}",
            "full_name": f"{t['full_name']} (trading account)", "is_system": True, "is_active": True,
            "is_verified": True, "access_granted": False, "auth_provider": "system", "hashed_password": None,
            "wallet_balance": float(equity), "account_type": "cash", "options_level": 2,
            "trader_id": str(t["_id"]), "created_at": now, "updated_at": now})
        ledger.ensure_account(str(uid))
        key = strategy_for(t.get("specialization", ""))
        traders.update_one({"_id": t["_id"]}, {"$set": {
            "system_user_id": str(uid), "strategy": key, "strategy_label": STRATEGIES[key]["label"],
            "stats_live": True, "stats_since": now, "starting_equity": str(equity), "recent_trades": []}})
        n += 1
    return n


def bot_traders() -> List[Dict]:
    return list(get_collection(TRADERS_COLLECTION).find({"system_user_id": {"$nin": [None, ""]}}))


def symbols_for(strategy: str) -> List[str]:
    s = STRATEGIES[strategy]
    if s["kind"] == "momentum":
        return list(s["universe"])
    if s["kind"] == "weights":
        return list(s["weights"])
    return [s["underlying"]]


# ------------------------------------------------------------------ decisions (pure)
def momentum_targets(scores: Dict[str, float], held: List[str], top: int) -> Dict[str, List[str]]:
    """Which symbols to buy and which to sell, with hysteresis (keep anything still in top+1)."""
    ranked = [s for s, _ in sorted(scores.items(), key=lambda kv: kv[1], reverse=True)]
    keep_band = set(ranked[:top + 1])
    target = ranked[:top]
    sells = [s for s in held if s not in keep_band]
    buys = [s for s in target if s not in held]
    return {"buy": buys, "sell": sells, "target": target}


def weight_trades(values: Dict[str, D], equity: D, weights: Dict[str, str], invest: D,
                  threshold: D = D("3")) -> List[Dict]:
    """Rebalancing trades (dollar amounts) for fixed weights when drift > threshold points."""
    out = []
    for sym, w in weights.items():
        target = equity * invest * D(w) / 100
        current = values.get(sym, D("0"))
        drift_pts = ((current - target) / equity * 100) if equity else D("0")
        if current == 0 or abs(drift_pts) > threshold:
            diff = target - current
            if abs(diff) >= D("10"):
                out.append({"symbol": sym, "amount": diff})
    return sorted(out, key=lambda t: t["amount"])  # sells (negative) first


# ------------------------------------------------------------------ execution
def _place(uid: str, symbol: str, side: str, quote: Dict, qty: Optional[D] = None, notional: Optional[D] = None,
           type_: str = "market", limit: Optional[D] = None) -> Optional[Dict]:
    from app.trading import orders
    from app.trading.models import OrderRequest
    ac = quote.get("asset_class") or "stock"
    try:
        req = OrderRequest(client_order_id=f"bot-{uuid.uuid4()}", symbol=symbol, side=side, type=type_, qty=qty,
                           notional=notional, limit_price=limit, tif="gtc" if ac == "crypto" else "day")
        return orders.place(uid, req, quote, source="bot")
    except (orders.OrderError, ValueError) as exc:
        print(f"bot order skipped {uid} {side} {symbol}: {exc}")
        return None


def holdings(uid: str) -> Dict[str, Dict]:
    return {p["symbol"]: p for p in positions.col().find({"user_id": uid, "bucket": "self", "open": True})}


async def evaluate(trader: Dict) -> int:
    """Run one decision cycle for a bot. Returns the number of orders placed."""
    uid = trader["system_user_id"]
    key = trader.get("strategy") or strategy_for(trader.get("specialization", ""))
    s = STRATEGIES[key]
    crypto = s.get("crypto", False)
    if not crypto and calendar.equity_session() != "open":
        return 0
    quotes = await service.get_quotes(symbols_for(key))
    if not quotes:
        return 0
    st = await asyncio.to_thread(margin.account_state, uid)
    equity, cash = st.equity, st.available - st.holds
    held = await asyncio.to_thread(holdings, uid)
    placed = 0

    def run(fn, *a, **k):
        return asyncio.to_thread(fn, *a, **k)

    if s["kind"] == "momentum":
        scores = {sym: float(q.get("change_percent") or 0) for sym, q in quotes.items() if not q.get("stale")}
        plan = momentum_targets(scores, [h for h in held if h in s["universe"]], s["top"])
        for sym in plan["sell"][:MAX_ORDERS]:
            if await run(_place, uid, sym, "sell", quotes[sym], qty=D(held[sym]["qty"])):
                placed += 1
        per = equity * s["invest"] / s["top"]
        for sym in plan["buy"]:
            if placed >= MAX_ORDERS:
                break
            amount = min(per, cash * D("0.98")).quantize(D("0.01"), rounding=ROUND_DOWN)
            if amount >= D("50") and await run(_place, uid, sym, "buy", quotes[sym], notional=amount):
                cash -= amount
                placed += 1
    elif s["kind"] == "weights":
        values = {sym: D(p["qty"]) * D(str(quotes[sym].get("last") or 0)) for sym, p in held.items() if sym in quotes}
        for t in weight_trades(values, equity, s["weights"], s["invest"])[:MAX_ORDERS]:
            q = quotes.get(t["symbol"])
            if not q:
                continue
            if t["amount"] < 0:
                px = D(str(q.get("bid") or q.get("last")))
                qty = min(D(held[t["symbol"]]["qty"]), (-t["amount"] / px).quantize(D("0.000001"), rounding=ROUND_DOWN))
                if qty > 0 and await run(_place, uid, t["symbol"], "sell", q, qty=qty):
                    placed += 1
            else:
                amount = min(t["amount"], cash * D("0.98")).quantize(D("0.01"), rounding=ROUND_DOWN)
                if amount >= D("10") and await run(_place, uid, t["symbol"], "buy", q, notional=amount):
                    cash -= amount
                    placed += 1
    else:
        placed += await _income(uid, s, quotes, held, equity, cash)
    return placed


async def _income(uid: str, s: Dict, quotes: Dict, held: Dict, equity: D, cash: D) -> int:
    und = s["underlying"]
    q = quotes.get(und)
    if not q:
        return 0
    placed = 0
    price = D(str(q.get("ask") or q.get("last")))
    shares = D(held[und]["qty"]) if und in held else D("0")
    target_shares = (equity * s["stock"] / price).quantize(D("1"), rounding=ROUND_DOWN)
    if shares < target_shares - 5:
        qty = min(target_shares - shares, (cash * D("0.98") / price).quantize(D("1"), rounding=ROUND_DOWN))
        if qty > 0 and await asyncio.to_thread(_place, uid, und, "buy", q, qty=qty):
            placed += 1
            shares += qty
    short_calls = sum(-D(p["qty"]) for sym, p in held.items()
                      if p["asset_class"] == "option" and D(p["qty"]) < 0 and opt.parse_occ(sym)["right"] == "C")
    can_write = int(shares // 100) - int(short_calls)
    if can_write <= 0:
        return placed
    try:
        exps = await service.get_expiries(und)
    except Exception:
        return placed
    today = datetime.now(calendar.NY).date()
    window = [e for e in exps if 14 <= (date.fromisoformat(e) - today).days <= 45]
    if not window:
        return placed
    chain = await service.get_chain(und, window[0])
    spot = float(q.get("last"))
    calls = sorted((r for r in chain["calls"] if r["strike"] >= spot * 1.03 and r["bid"] > 0), key=lambda r: r["strike"])
    if not calls:
        return placed
    c = calls[0]
    oq = await service.get_option_quote(c["symbol"])
    limit = D(str(max(0.05, c["bid"]))).quantize(D("0.01"))
    if await asyncio.to_thread(_place, uid, c["symbol"], "sell_to_open", oq, qty=D(can_write), type_="limit", limit=limit):
        placed += 1
    return placed


# ------------------------------------------------------------------ stats
def compute_stats(trader: Dict) -> Dict:
    """Live track record from the bot's snapshots and fills."""
    from app.trading import copy_engine
    uid = trader["system_user_id"]
    snaps = list(get_collection("portfolio_snapshots").find({"user_id": uid}, {"ts": 1, "equity_cents": 1}).sort("ts", 1))
    start_equity = D(str(trader.get("starting_equity") or "0")) or (D(snaps[0]["equity_cents"]) / 100 if snaps else D("0"))
    st = margin.account_state(uid)
    equity = st.equity
    # YTD: from the first snapshot of this year, or from the start if the bot began this year
    year_start = datetime(datetime.utcnow().year, 1, 1)
    base = start_equity
    since = trader.get("stats_since")
    if since and since < year_start:
        base = next((D(x["equity_cents"]) / 100 for x in snaps if x["ts"] >= year_start), start_equity)
    ytd = ((equity - base) / base * 100) if base else D("0")
    peak, mdd = D("0"), D("0")
    for x in snaps + [{"equity_cents": int(equity * 100)}]:
        v = D(x["equity_cents"]) / 100
        peak = max(peak, v)
        if peak > 0:
            mdd = max(mdd, (peak - v) / peak * 100)
    closes = [D(f["realized_pnl"]) for f in get_collection("fills").find(
        {"user_id": uid, "status": "applied", "is_buy": False, "realized_pnl": {"$nin": [None]}}, {"realized_pnl": 1})
        if D(f["realized_pnl"]) != 0]
    win = (D(sum(1 for r in closes if r > 0)) / len(closes) * 100) if closes else D("0")
    links = list(copy_engine.links().find({"trader_id": str(trader["_id"]), "status": {"$in": ["active", "paused"]}}))
    aum = equity + sum((copy_engine.link_equity(l) for l in links), D("0"))
    # No closed trades yet means no win rate to measure: store None, not 0.
    return {"ytd_return": round(float(ytd), 2), "max_drawdown": round(float(mdd), 2),
            "win_rate": round(float(win), 1) if closes else None,
            "copiers": len(links), "assets_under_management": round(float(aum), 2), "closed_trades": len(closes),
            "account_equity": round(float(equity), 2), "stats_updated_at": datetime.utcnow()}


def update_all_stats() -> int:
    n = 0
    for t in bot_traders():
        try:
            get_collection(TRADERS_COLLECTION).update_one({"_id": t["_id"]}, {"$set": compute_stats(t)})
            n += 1
        except Exception as exc:
            print(f"trader stats error {t['_id']}: {exc}")
    return n


# ------------------------------------------------------------------ runner
class BotRunner:
    """Lives inside the trading engine. Keeps bot universes streaming and runs decisions."""

    def __init__(self):
        self.next_at: Dict[str, float] = {}
        self.sub = None
        self.last_stats = 0.0
        self.stats = {"evaluations": 0, "orders": 0, "last_error": None}

    async def start(self) -> None:
        await asyncio.to_thread(ensure_bots)
        syms = set()
        for t in await asyncio.to_thread(bot_traders):
            syms.update(symbols_for(t.get("strategy") or strategy_for(t.get("specialization", ""))))
        self.sub = bus.subscribe(syms)   # keeps these prices streaming for decisions and marks

    async def tick(self) -> None:
        now = time.time()
        if now - self.last_stats > 1800:
            self.last_stats = now
            await asyncio.to_thread(ensure_bots)
            await asyncio.to_thread(update_all_stats)
        for t in await asyncio.to_thread(bot_traders):
            tid = str(t["_id"])
            if tid not in self.next_at:
                self.next_at[tid] = now + random.uniform(30, 120)     # stagger the first runs
            if now < self.next_at[tid]:
                continue
            self.next_at[tid] = now + random.uniform(*INTERVAL)
            try:
                self.stats["orders"] += await evaluate(t)
                self.stats["evaluations"] += 1
            except Exception as exc:
                self.stats["last_error"] = f"{tid}: {type(exc).__name__}: {exc}"

    def stop(self) -> None:
        if self.sub:
            self.sub.close()
