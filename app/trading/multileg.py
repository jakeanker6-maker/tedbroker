"""Multi-leg option orders (spreads), strategy groups and the payoff calculator.

Pricing is per share, like every broker's spread ticket: net = sum(+buy / -sell x ratio
x leg price), where an option leg counts its ratio and a stock leg counts shares / 100.
  * executable net uses each option leg's mid +/- $0.01 (one tick against you) and the
    stock's ask/bid; a net-limit debit fills when executable <= limit, a credit when
    executable credit >= limit; market spreads fill at the natural price (ask/bid)
  * all legs are booked together: fills are written first, then applied credit legs
    first so cash accounts never dip below zero mid-spread
  * buying power uses the account what-if (max loss for defined-risk spreads)
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from bson import ObjectId
from pydantic import BaseModel, Field, field_validator

from app.database import get_collection
from app.market_data import universe
from app.market_data.quotes import is_stale
from app.trading import events, fees, instruments, ledger, margin, orders, positions
from app.trading import options as opt
from app.trading.models import OPEN_STATUSES, is_buy

D = Decimal
TICK = D("0.01")
STRATEGIES = ("vertical", "calendar", "diagonal", "straddle", "strangle", "iron_condor", "iron_butterfly",
              "butterfly", "covered_call", "collar", "custom")
LEVEL_REQUIRED = {"covered_call": 1, "collar": 2, "straddle": 2, "strangle": 2}


class LegIn(BaseModel):
    symbol: str
    side: str
    ratio: int = Field(1, ge=1, le=1000)

    @field_validator("side")
    @classmethod
    def _side(cls, v):
        v = v.lower()
        if v not in ("buy", "sell", "buy_to_open", "sell_to_open", "buy_to_close", "sell_to_close"):
            raise ValueError("invalid leg side")
        return v


class MultilegRequest(BaseModel):
    client_order_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=8, max_length=64)
    strategy: str
    legs: List[LegIn] = Field(..., min_length=2, max_length=4)
    qty: int = Field(..., ge=1, le=10_000)
    type: str = Field("net_limit", pattern="^(net_limit|market)$")
    net_price: Optional[Decimal] = Field(None, ge=0)
    price_effect: Optional[str] = Field(None, pattern="^(debit|credit|even)$")
    tif: str = Field("day", pattern="^(day|gtc)$")
    group_id: Optional[str] = None   # set when closing an existing strategy

    @field_validator("strategy")
    @classmethod
    def _strategy(cls, v):
        v = v.lower()
        if v not in STRATEGIES:
            raise ValueError(f"strategy must be one of {', '.join(STRATEGIES)}")
        return v


def groups_col():
    return get_collection("strategy_groups")


# ------------------------------------------------------------------ structure
def _resolve_legs(user_id: str, req: MultilegRequest) -> List[Dict]:
    legs = []
    for l in req.legs:
        try:
            sym = universe.normalize(l.symbol)
        except (universe.UnknownSymbol, ValueError) as exc:
            raise orders.OrderError(str(exc), "unknown_symbol", 404)
        ac = universe.asset_class_of(sym)
        if ac not in ("option", "stock", "etf"):
            raise orders.OrderError("Spread legs must be options or the underlying stock.", "invalid_leg")
        buy = l.side.startswith("buy")
        side = l.side
        if side in ("buy", "sell"):
            if ac == "option":
                held = positions.open_qty(user_id, sym)
                closing = (buy and held < 0) or (not buy and held > 0)
                side = ("buy_to_close" if buy else "sell_to_close") if closing else ("buy_to_open" if buy else "sell_to_open")
            else:
                side = "buy" if buy else ("sell" if positions.open_qty(user_id, sym) > 0 else "sell_short")
        leg = {"symbol": sym, "asset_class": ac, "side": side, "buy": buy, "ratio": l.ratio}
        if ac == "option":
            leg.update(opt.parse_occ(sym))
        legs.append(leg)
    return legs


def validate_structure(strategy: str, legs: List[Dict]) -> str:
    opts = [l for l in legs if l["asset_class"] == "option"]
    stocks = [l for l in legs if l["asset_class"] != "option"]
    roots = {l["root"] for l in opts} | {l["symbol"] for l in stocks}
    if len(roots) != 1:
        raise orders.OrderError("All legs must be on the same underlying.", "invalid_strategy")
    if len({l["symbol"] for l in legs}) != len(legs):
        raise orders.OrderError("Each leg must be a different contract.", "invalid_strategy")

    def bad(msg):
        raise orders.OrderError(f"Not a valid {strategy.replace('_', ' ')}: {msg}", "invalid_strategy")

    exp = {l["expiry"] for l in opts}
    rights = sorted(l["right"] for l in opts)
    if strategy in ("covered_call", "collar"):
        if len(stocks) != 1 or stocks[0]["ratio"] != 100 or not stocks[0]["buy"]:
            bad("needs a buy of 100 shares per spread")
        calls = [l for l in opts if l["right"] == "C"]
        if len(calls) != 1 or calls[0]["buy"] or calls[0]["ratio"] != 1:
            bad("needs one short call per 100 shares")
        if strategy == "collar":
            puts = [l for l in opts if l["right"] == "P"]
            if len(puts) != 1 or not puts[0]["buy"] or puts[0]["ratio"] != 1 or len(opts) != 2:
                bad("needs one long put and one short call")
        elif len(opts) != 1:
            bad("needs exactly one call")
        return strategy
    if stocks:
        bad("stock legs are only used in covered calls and collars")
    if strategy != "custom" and any(l["ratio"] != 1 for l in opts) and strategy != "butterfly":
        bad("legs must be 1:1")
    two_opposite = len(opts) == 2 and opts[0]["buy"] != opts[1]["buy"]
    if strategy == "vertical":
        if not (two_opposite and len(exp) == 1 and len(set(rights)) == 1 and opts[0]["strike"] != opts[1]["strike"]):
            bad("two legs, same type and expiry, different strikes, one bought and one sold")
    elif strategy == "calendar":
        if not (two_opposite and len(exp) == 2 and len(set(rights)) == 1 and opts[0]["strike"] == opts[1]["strike"]):
            bad("same strike and type, different expiries, one bought and one sold")
    elif strategy == "diagonal":
        if not (two_opposite and len(exp) == 2 and len(set(rights)) == 1 and opts[0]["strike"] != opts[1]["strike"]):
            bad("same type, different strikes and expiries, one bought and one sold")
    elif strategy in ("straddle", "strangle"):
        same_strike = len(opts) == 2 and opts[0]["strike"] == opts[1]["strike"]
        if not (len(opts) == 2 and rights == ["C", "P"] and len(exp) == 1 and opts[0]["buy"] == opts[1]["buy"]):
            bad("one call and one put, same expiry, both bought or both sold")
        if strategy == "straddle" and not same_strike:
            bad("call and put must share a strike")
        if strategy == "strangle" and same_strike:
            bad("call and put need different strikes")
    elif strategy in ("iron_condor", "iron_butterfly"):
        puts = sorted((l for l in opts if l["right"] == "P"), key=lambda l: l["strike"])
        calls = sorted((l for l in opts if l["right"] == "C"), key=lambda l: l["strike"])
        if len(opts) != 4 or len(puts) != 2 or len(calls) != 2 or len(exp) != 1:
            bad("two puts and two calls with the same expiry")
        inner_put, inner_call = puts[1], calls[0]
        if not (puts[0]["buy"] == calls[1]["buy"] and inner_put["buy"] == inner_call["buy"]
                and puts[0]["buy"] != inner_put["buy"]):
            bad("buy the wings and sell the body (or the reverse)")
        if strategy == "iron_condor" and not inner_put["strike"] < inner_call["strike"]:
            bad("the short put strike must be below the short call strike")
        if strategy == "iron_butterfly" and inner_put["strike"] != inner_call["strike"]:
            bad("the body put and call must share a strike")
    elif strategy == "butterfly":
        s = sorted(opts, key=lambda l: l["strike"])
        if len(s) != 3 or len(set(rights)) != 1 or len(exp) != 1:
            bad("three strikes of the same type and expiry")
        if [l["ratio"] for l in s] != [1, 2, 1] or s[0]["buy"] != s[2]["buy"] or s[1]["buy"] == s[0]["buy"]:
            bad("ratio 1:2:1 with the body on the opposite side")
        if s[1]["strike"] - s[0]["strike"] != s[2]["strike"] - s[1]["strike"]:
            bad("strikes must be evenly spaced")
    elif strategy == "custom":
        if len(opts) < 2:
            bad("needs at least two option legs")
    return strategy


# ------------------------------------------------------------------ pricing
def _units(leg: Dict) -> D:
    return D(leg["ratio"]) if leg["asset_class"] == "option" else D(leg["ratio"]) / opt.MULTIPLIER


def leg_prices(legs: List[Dict], quotes: Dict[str, Dict], natural: bool = False) -> List[D]:
    out = []
    for l in legs:
        q = quotes[l["symbol"]]
        if l["asset_class"] == "option" and not natural:
            mid = D(str(q.get("mid") or q.get("last") or 0))
            px = mid + TICK if l["buy"] else max(D("0"), mid - TICK)
        else:
            px = D(str(q.get("ask") if l["buy"] else q.get("bid")) or q.get("last") or 0)
        out.append(px.quantize(D("0.01") if l["asset_class"] == "option" else D("0.0001"), rounding=ROUND_HALF_UP))
    return out


def net_price(legs: List[Dict], prices: List[D]) -> D:
    """Per-share net: positive = debit, negative = credit."""
    return sum(((1 if l["buy"] else -1) * _units(l) * p for l, p in zip(legs, prices)), D("0"))


def _hypothetical(legs: List[Dict], prices: List[D], qty: int):
    changes, cash = [], D("0")
    for l, p in zip(legs, prices):
        n = D(l["ratio"] * qty)
        mult = instruments.multiplier(l["asset_class"])
        changes.append((l["symbol"], l["asset_class"], n if l["buy"] else -n, p))
        gross = n * p * mult
        fee = fees.compute(l["asset_class"], not l["buy"], n, gross)["total"]
        cash += -(gross + fee) if l["buy"] else gross - fee
    return changes, cash


def required_level(st_before: margin.State, st_after: margin.State, strategy: str, legs: List[Dict]) -> int:
    if st_after.unbounded_risk and not st_before.unbounded_risk:
        return 4
    if strategy in LEVEL_REQUIRED:
        return LEVEL_REQUIRED[strategy]
    opening_short = any(not l["buy"] and l["asset_class"] == "option" and l["side"] == "sell_to_open" for l in legs)
    return 3 if opening_short else 2


# ------------------------------------------------------------------ placement
def preview(user_id: str, req: MultilegRequest, quotes: Dict[str, Dict]) -> Dict:
    legs = _resolve_legs(user_id, req)
    validate_structure(req.strategy, legs)
    exec_prices = leg_prices(legs, quotes)
    nat_prices = leg_prices(legs, quotes, natural=True)
    mid_prices = [D(str(quotes[l["symbol"]].get("mid") or quotes[l["symbol"]].get("last") or 0)) for l in legs]
    before = margin.account_state(user_id)
    changes, cash = _hypothetical(legs, exec_prices, req.qty)
    after = margin.account_state(user_id, changes, cash)
    user = ledger.ensure_account(user_id)
    level = required_level(before, after, req.strategy, legs)
    pay = payoff(legs, quotes, req.qty)
    warnings = []
    if level > orders.options_level(user):
        warnings.append(f"This strategy requires options level {level}; your account is approved for level "
                        f"{orders.options_level(user)}.")
    if level == 4 and margin.account_type(user) != "margin":
        warnings.append("Uncovered short options require a margin account.")
    if after.base < 0:
        warnings.append("Insufficient buying power for this strategy.")
    n_mid = net_price(legs, mid_prices)
    return {
        "strategy": req.strategy, "legs": [{"symbol": l["symbol"], "name": opt.friendly_name(l["symbol"])
                                             if l["asset_class"] == "option" else l["symbol"],
                                             "side": l["side"], "ratio": l["ratio"], "bid": quotes[l["symbol"]].get("bid"),
                                             "ask": quotes[l["symbol"]].get("ask"), "mid": quotes[l["symbol"]].get("mid")}
                                            for l in legs],
        "net_mid": f"{abs(n_mid):.2f}", "net_natural": f"{abs(net_price(legs, nat_prices)):.2f}",
        "price_effect": "debit" if n_mid > 0 else ("credit" if n_mid < 0 else "even"),
        "estimated_net": f"{abs(net_price(legs, exec_prices)):.2f}",
        "estimated_cash": f"{cash:.2f}", "buying_power_effect": f"{(after.base - before.base):.2f}",
        "requirement": f"{max(D('0'), before.base - after.base):.2f}", "required_level": level,
        "payoff": pay, "warnings": warnings, "can_place": not warnings,
    }


def place(user_id: str, req: MultilegRequest, quotes: Dict[str, Dict], source: str = "manual") -> Dict:
    user_id = str(user_id)
    existing = orders.orders_col().find_one({"user_id": user_id, "client_order_id": req.client_order_id})
    if existing:
        return existing
    with orders.user_lock(user_id):
        user = ledger.ensure_account(user_id)
        legs = _resolve_legs(user_id, req)
        validate_structure(req.strategy, legs)
        for l in legs:
            q = quotes.get(l["symbol"])
            if not q:
                raise orders.OrderError(f"No price for {l['symbol']}", "no_quote", 503)
            if l["asset_class"] == "option" and opt.expiry_close(l["expiry"]) <= datetime.now(opt.NY):
                raise orders.OrderError("One of the contracts has expired.", "expired_contract")
            if l["side"] in ("sell_to_close", "buy_to_close", "sell"):
                held = positions.open_qty(user_id, l["symbol"])
                need = D(l["ratio"] * req.qty)
                if (l["side"] == "buy_to_close" and -held < need) or (l["side"] != "buy_to_close" and held < need):
                    raise orders.OrderError(f"Not enough {l['symbol'].strip()} to close this leg.", "insufficient_position")
        if req.type == "net_limit" and (req.net_price is None or req.price_effect is None):
            raise orders.OrderError("Net limit orders need net_price and price_effect (debit or credit).", "invalid_price")
        exec_prices = leg_prices(legs, quotes)
        before = margin.account_state(user_id)
        changes, cash = _hypothetical(legs, exec_prices, req.qty)
        after = margin.account_state(user_id, changes, cash)
        level = required_level(before, after, req.strategy, legs)
        if level > orders.options_level(user):
            raise orders.OrderError(f"This strategy requires options level {level}. Apply for a higher options "
                                    "level in Settings.", "options_level", 400)
        if level == 4 and margin.account_type(user) != "margin":
            raise orders.OrderError("Uncovered short options require a margin account.", "margin_required", 400)
        hold = max(D("0"), before.base - after.base)
        if after.base < 0:
            raise orders.OrderError(f"Insufficient buying power. This strategy needs ${hold:,.2f}; you have "
                                    f"${max(before.base, D('0')):,.2f}.", "insufficient_buying_power")
        root = (legs[0].get("root") or legs[0]["symbol"])
        now = datetime.utcnow()
        group_id = req.group_id or str(ObjectId())
        order = {
            "_id": ObjectId(), "user_id": user_id, "client_order_id": req.client_order_id, "source": source,
            "bucket": "self", "symbol": root, "asset_class": "multileg", "multiplier": 100,
            "name": f"{root} {req.strategy.replace('_', ' ')}", "strategy": req.strategy, "group_id": group_id,
            "legs": [{"symbol": l["symbol"], "asset_class": l["asset_class"], "side": l["side"], "ratio": l["ratio"]}
                     for l in legs],
            "side": "buy" if (req.price_effect or "debit") == "debit" else "sell", "type": req.type,
            "tif": req.tif, "extended_hours": False, "qty": str(req.qty), "notional": None,
            "net_price": None if req.net_price is None else str(req.net_price), "price_effect": req.price_effect,
            "limit_price": None, "stop_price": None, "trail_percent": None, "trail_amount": None, "triggered": False,
            "filled_qty": "0", "avg_fill_price": None, "fees_total": "0", "reserved_cents": 0,
            "bp_hold_cents": instruments.cents(hold * D("1.02")),
            "allow_borrow": margin.account_type(user) == "margin", "status": "accepted",
            "status_history": [orders._hist("new"), orders._hist("accepted")],
            "expires_at": orders._naive(instruments.order_expiry("option", req.tif, False)),
            "warnings": [], "applied_fills": [], "created_at": now, "updated_at": now,
        }
        orders.orders_col().insert_one(order)
        orders._publish_order(order)
        process(order["_id"], quotes)
        order = orders.orders_col().find_one({"_id": order["_id"]})
    for l in order["legs"]:
        orders._notify_watchers({**order, "symbol": l["symbol"]})
    return order


def process(order_id, quotes: Dict[str, Dict]) -> bool:
    order = orders.orders_col().find_one({"_id": order_id})
    if not order or order["status"] not in OPEN_STATUSES:
        return False
    with orders.user_lock(order["user_id"]):
        order = orders.orders_col().find_one({"_id": order_id})
        if not order or order["status"] not in OPEN_STATUSES:
            return False
        if not instruments.can_trade_now("option"):
            return False
        legs = [{**l, "buy": is_buy(l["side"]), **(opt.parse_occ(l["symbol"]) if l["asset_class"] == "option" else {})}
                for l in order["legs"]]
        if any(is_stale(quotes.get(l["symbol"])) for l in legs):
            return False
        natural = order["type"] == "market"
        prices = leg_prices(legs, quotes, natural=natural)
        net = net_price(legs, prices)
        if order["type"] == "net_limit":
            limit = D(order["net_price"])
            effect = order["price_effect"]
            ok = (net <= limit) if effect == "debit" else ((-net >= limit) if effect == "credit" else net <= 0)
            if not ok:
                return False
        _book(order, legs, prices, net, quotes)
        return True


def _book(order: Dict, legs: List[Dict], prices: List[D], net: D, quotes: Dict[str, Dict]) -> None:
    qty = int(D(order["qty"]))
    ts = datetime.utcnow()
    fills = []
    for i, (l, px) in enumerate(zip(legs, prices)):
        n = D(l["ratio"] * qty)
        ac, mult = l["asset_class"], instruments.multiplier(l["asset_class"])
        gross = n * px * mult
        fee_items = fees.compute(ac, not l["buy"], n, gross)
        gross_c, fee_c = instruments.cents(gross), instruments.cents(fee_items["total"])
        q = quotes.get(l["symbol"]) or {}
        fills.append({
            "_id": ObjectId(), "order_id": order["_id"], "leg_index": i, "group_id": order["group_id"],
            "user_id": order["user_id"], "bucket": "self", "symbol": l["symbol"], "asset_class": ac, "multiplier": mult,
            "side": l["side"], "is_buy": l["buy"], "qty": str(n), "price": str(px), "gross": f"{gross:.2f}",
            "fee": str(fee_items["total"]), "fee_items": {k: str(v) for k, v in fee_items.items() if k != "total"},
            "cash_delta_cents": -(gross_c + fee_c) if l["buy"] else gross_c - fee_c, "reserved_release_cents": 0,
            "kind": "trade", "liquidity": "maker" if order["type"] == "net_limit" else "taker",
            "quote": {k: q.get(k) for k in ("bid", "ask", "mid", "last", "ts")},
            "settles_at": orders._naive(instruments.settlement_time(ac)), "source": order.get("source", "manual"),
            "allow_borrow": bool(order.get("allow_borrow")), "status": "pending", "ts": ts,
        })
    orders.fills_col().insert_many(fills)
    for f in sorted(fills, key=lambda f: f["cash_delta_cents"], reverse=True):   # credits first
        orders.apply_fill(f)
    finish(order["_id"], net)


def finish(order_id, net: Optional[D] = None) -> None:
    order = orders.orders_col().find_one({"_id": order_id})
    fills = list(orders.fills_col().find({"order_id": order_id}))
    if not fills or any(f["status"] == "pending" for f in fills):
        return
    if any(f["status"] == "void" for f in fills):
        orders._finalize(order, "canceled", "insufficient_funds_at_execution")
        return
    if net is None:
        legs = [{"buy": f["is_buy"], "ratio": int(D(f["qty"]) / D(order["qty"])), "asset_class": f["asset_class"]}
                for f in sorted(fills, key=lambda f: f["leg_index"])]
        net = net_price(legs, [D(f["price"]) for f in sorted(fills, key=lambda f: f["leg_index"])])
    total_fees = sum((D(f["fee"]) for f in fills), D("0"))
    res = orders.orders_col().update_one({"_id": order_id, "status": {"$in": list(OPEN_STATUSES)}}, {"$set": {
        "status": "filled", "filled_qty": order["qty"], "avg_fill_price": f"{abs(net):.2f}",
        "fill_effect": "debit" if net > 0 else "credit", "fees_total": str(total_fees), "filled_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()}, "$push": {"status_history": orders._hist("filled")}})
    if res.modified_count:
        _update_group(order, net)
        orders._publish_order(orders.orders_col().find_one({"_id": order_id}))


def _update_group(order: Dict, net: D) -> None:
    opening = any(l["side"] in ("buy_to_open", "sell_to_open", "buy", "sell_short") for l in order["legs"])
    if opening and not order.get("group_id_existing"):
        groups_col().update_one({"group_id": order["group_id"]}, {"$setOnInsert": {
            "group_id": order["group_id"], "user_id": order["user_id"], "strategy": order["strategy"],
            "underlying": order["symbol"], "opened_at": datetime.utcnow()},
            "$set": {"legs": order["legs"], "status": "open"},
            "$inc": {"qty": int(D(order["qty"]))},
            "$push": {"orders": str(order["_id"]), "open_nets": f"{net:.4f}"}}, upsert=True)
    else:
        g = groups_col().find_one({"group_id": order["group_id"]})
        if g:
            remaining = int(g.get("qty", 0)) - int(D(order["qty"]))
            groups_col().update_one({"_id": g["_id"]}, {"$set": {"qty": max(0, remaining),
                                                                "status": "closed" if remaining <= 0 else "open"},
                                                       "$push": {"orders": str(order["_id"])}})


# ------------------------------------------------------------------ payoff
def payoff(legs: List[Dict], quotes: Dict[str, Dict], qty: int, points: int = 61) -> Dict:
    """P/L at the first expiry across underlying prices, at current mid prices.
    Later-expiry legs are valued at intrinsic (conservative for calendars/diagonals)."""
    opts = [l for l in legs if l["asset_class"] == "option"]
    mids = [D(str(quotes[l["symbol"]].get("mid") or quotes[l["symbol"]].get("last") or 0)) for l in legs]
    cost = net_price(legs, mids) * opt.MULTIPLIER * qty           # paid (+) / received (-)
    strikes = sorted({l["strike"] for l in opts}) or [1.0]
    spot_q = quotes.get(opts[0]["root"]) if opts else None
    spot = float(spot_q["last"]) if spot_q and spot_q.get("last") else (strikes[0] + strikes[-1]) / 2
    lo = max(0.0, min(strikes[0], spot) * 0.7)
    hi = max(strikes[-1], spot) * 1.3

    def value(s: float) -> D:
        total = D("0")
        for l, m in zip(legs, mids):
            sign = 1 if l["buy"] else -1
            if l["asset_class"] == "option":
                intrinsic = max(0.0, s - l["strike"]) if l["right"] == "C" else max(0.0, l["strike"] - s)
                total += sign * D(l["ratio"] * qty) * D(str(intrinsic)) * opt.MULTIPLIER
            else:
                total += sign * D(l["ratio"] * qty) * D(str(s))
        return total - cost

    grid = sorted(set([lo + (hi - lo) * i / (points - 1) for i in range(points)] + list(strikes) + [spot]))
    curve = [(s, value(s)) for s in grid]
    breakevens = []
    for (s1, v1), (s2, v2) in zip(curve, curve[1:]):
        if v1 == 0:
            breakevens.append(round(s1, 2))
        elif (v1 < 0 < v2) or (v2 < 0 < v1):
            breakevens.append(round(s1 + (s2 - s1) * float(-v1 / (v2 - v1)), 2))
    call_slope = sum((1 if l["buy"] else -1) * l["ratio"] for l in opts if l["right"] == "C") + \
        sum((1 if l["buy"] else -1) * l["ratio"] / 100 for l in legs if l["asset_class"] != "option")
    at_zero = value(0.0)
    vals = [v for _, v in curve] + [at_zero]
    return {
        "spot": round(spot, 2), "points": [{"price": round(s, 2), "pnl": f"{v:.2f}"} for s, v in curve],
        "breakevens": sorted(set(breakevens)),
        "max_profit": None if call_slope > 0 else f"{max(vals):.2f}",
        "max_loss": None if call_slope < 0 else f"{min(vals):.2f}",
        "unlimited_profit": call_slope > 0, "unlimited_loss": call_slope < 0,
        "net_cost": f"{cost:.2f}",
    }


def resolve_for_payoff(user_id: str, req: MultilegRequest) -> List[Dict]:
    legs = _resolve_legs(user_id, req)
    validate_structure(req.strategy, legs)
    return legs
