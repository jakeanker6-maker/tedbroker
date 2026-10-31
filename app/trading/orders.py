"""Order placement, cancellation, replacement and fill execution.

All functions here are synchronous and run in worker threads (asyncio.to_thread).
Every mutation of a user's orders/positions/cash happens under that user's lock, so
placements, fills and cancels for one account are serialised.

Fill pipeline (crash-safe, idempotent; `recover_pending_fills` replays step 2-4):
  1. insert the fill with status "pending" (all amounts computed and frozen)
  2. ledger posting keyed by the fill id
  3. position update keyed by the fill id
  4. order update keyed by the fill id, then mark the fill "applied"
"""
from __future__ import annotations

import threading
from collections import defaultdict
from datetime import datetime, timezone
from decimal import ROUND_DOWN, Decimal
from typing import Any, Callable, Dict, List, Optional

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from app.database import get_collection
from app.market_data import calendar, universe
from app.market_data.quotes import is_stale
from app.trading import borrow, events, fees, instruments, ledger, margin, matching, positions
from app.trading import options as opt
from app.trading.models import FINAL_STATUSES, OPEN_STATUSES, SHORT_SIDES, OrderRequest, is_buy

OPENING_SIDES = ("buy", "buy_to_open", "sell_short", "sell_to_open")
CLOSING_SIDES = ("sell", "sell_to_close", "buy_to_cover", "buy_to_close")

D = Decimal
COLLAR = 0.5  # limit/stop prices must be within +/-50% of the last price (fat-finger guard)
RESERVE_BUFFER = {"stock": D("0.01"), "etf": D("0.01"), "crypto": D("0.03"), "option": D("0.05")}
DEFAULT_OPTIONS_LEVEL = 2  # long calls/puts; levels 1, 3, 4 arrive with Phase 2B


class OrderError(Exception):
    """A request that cannot be placed. `code` is machine-readable for the UI."""

    def __init__(self, message: str, code: str = "invalid_order", status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status


# ------------------------------------------------------------------ collections & locks
def orders_col():
    return get_collection("orders")


def fills_col():
    return get_collection("fills")


def ensure_indexes() -> None:
    o = orders_col()
    o.create_index([("user_id", ASCENDING), ("client_order_id", ASCENDING)], unique=True, name="uniq_client_id")
    o.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_time")
    o.create_index([("status", ASCENDING), ("symbol", ASCENDING)], name="status_symbol")
    o.create_index([("parent_order_id", ASCENDING)], name="parent")
    f = fills_col()
    f.create_index([("user_id", ASCENDING), ("ts", DESCENDING)], name="user_time")
    f.create_index([("order_id", ASCENDING)], name="order")
    f.create_index([("status", ASCENDING)], name="status")
    positions.ensure_indexes()


_locks: Dict[str, threading.RLock] = defaultdict(threading.RLock)
_locks_guard = threading.Lock()


def user_lock(user_id: str) -> threading.RLock:
    with _locks_guard:
        return _locks[str(user_id)]


# Engine hook: called (from any thread) when an order is accepted/changed so the
# matching loop can watch its symbol. Set by app.trading.engine.
order_watchers: List[Callable[[Dict], None]] = []


def _notify_watchers(order: Dict) -> None:
    for fn in list(order_watchers):
        try:
            fn(order)
        except Exception as exc:
            print(f"order watcher error: {exc}")


# ------------------------------------------------------------------ helpers
def _now() -> datetime:
    return datetime.utcnow()


def _hist(status: str, reason: Optional[str] = None) -> Dict:
    h = {"status": status, "at": _now()}
    if reason:
        h["reason"] = reason
    return h


def _dec(v) -> Optional[Decimal]:
    return None if v is None else D(str(v))


def options_level(user: Dict) -> int:
    return int(user.get("options_level", DEFAULT_OPTIONS_LEVEL))


def account_type(user: Dict) -> str:
    return user.get("account_type", "cash")


def remaining_qty(order: Dict) -> Optional[Decimal]:
    if order.get("qty") is None:
        return None
    return D(order["qty"]) - D(order.get("filled_qty", "0"))


def committed_sell_qty(user_id: str, symbol: str, bucket: str, exclude_id=None, covers: bool = False) -> Decimal:
    """Quantity already promised to other open closing orders for this position
    (sells for longs; buy-to-cover / buy-to-close when `covers`)."""
    sides = ("buy_to_cover", "buy_to_close") if covers else ("sell", "sell_to_close")
    total = D("0")
    for o in orders_col().find({"user_id": str(user_id), "symbol": symbol, "bucket": bucket,
                                "status": {"$in": list(OPEN_STATUSES)}, "side": {"$in": list(sides)}}):
        if o["_id"] == exclude_id:
            continue
        rem = remaining_qty(o)
        if rem is not None:
            total += rem
    return total


def covered_call_shares(user_id: str, root: str, bucket: str) -> Decimal:
    """Shares that back short calls (they cannot be sold while the calls are open)."""
    contracts = D("0")
    for p in positions.col().find({"user_id": str(user_id), "bucket": bucket, "open": True, "asset_class": "option"}):
        o = opt.parse_occ(p["symbol"])
        q = D(p["qty"])
        if o["root"] == root and o["right"] == "C" and q < 0:
            contracts += -q
    return contracts * opt.MULTIPLIER


# ------------------------------------------------------------------ pattern day trading
OPEN_SIDE_SET = set(("buy", "buy_to_open", "sell_short", "sell_to_open"))


def day_trades(user_id: str, days: int = 5) -> int:
    """Round trips (open and close of the same symbol on the same day) in the last N trading days."""
    start_day = datetime.now(calendar.NY).date()
    for _ in range(days - 1):
        start_day = calendar.previous_trading_day(start_day)
    since = datetime.combine(start_day, datetime.min.time(), calendar.NY).astimezone(timezone.utc).replace(tzinfo=None)
    seen: Dict[tuple, set] = {}
    for f in fills_col().find({"user_id": str(user_id), "status": "applied", "kind": "trade", "ts": {"$gte": since}},
                              {"symbol": 1, "side": 1, "ts": 1}):
        day = f["ts"].replace(tzinfo=timezone.utc).astimezone(calendar.NY).date()
        seen.setdefault((f["symbol"], day), set()).add("open" if f["side"] in OPEN_SIDE_SET else "close")
    return sum(1 for kinds in seen.values() if kinds == {"open", "close"})


def opened_today(user_id: str, symbol: str) -> bool:
    from app.trading.portfolio import day_start_utc
    return fills_col().count_documents({"user_id": str(user_id), "symbol": symbol, "status": "applied",
                                        "kind": "trade", "side": {"$in": list(OPEN_SIDE_SET)},
                                        "ts": {"$gte": day_start_utc()}}) > 0


# ------------------------------------------------------------------ risk checks
def risk_check(user: Dict, spec: Dict, est: Dict, bucket: str, source: str = "manual") -> Dict:
    """Position, PDT and buying-power checks. Returns {reserve_cents, bp_hold_cents, allow_borrow}.

    Cash accounts and crypto reserve cash in the ledger. Margin accounts hold buying
    power on the order (`bp_hold_cents`) and fills may borrow (negative cash).
    """
    uid = str(user["_id"])
    side, ac, symbol = spec["side"], spec["asset_class"], spec["symbol"]
    acct = account_type(user)
    qty = est["qty"]
    # --- closing orders need an open position on the right side
    if side in ("sell", "sell_to_close"):
        held = positions.open_qty(uid, symbol, bucket)
        if held <= 0:
            raise OrderError(f"You don't have a position in {symbol} to sell.", "no_position")
        free = held - committed_sell_qty(uid, symbol, bucket)
        if ac in ("stock", "etf") and (acct != "margin" or options_level(user) < 4):
            free -= covered_call_shares(uid, symbol, bucket)
        if spec["qty"] is not None and qty > free:
            raise OrderError(f"You can sell up to {positions._fmt_qty(max(free, D('0')))}. Shares may be held by "
                             "other open sell orders or be covering short calls.", "insufficient_position")
    if side in ("buy_to_cover", "buy_to_close"):
        short = -positions.open_qty(uid, symbol, bucket)
        if short <= 0:
            raise OrderError(f"You don't have a short position in {symbol}.", "no_position")
        free = short - committed_sell_qty(uid, symbol, bucket, covers=True)
        if qty > free:
            raise OrderError(f"You can close up to {positions._fmt_qty(max(free, D('0')))}.", "insufficient_position")
    # --- pattern day trader rule (margin accounts under $25,000)
    if acct == "margin" and source == "manual" and side in CLOSING_SIDES and opened_today(uid, symbol):
        st = margin.account_state(uid)
        if st.equity < margin.PDT_MIN_EQUITY and day_trades(uid) >= 3:
            raise OrderError("This trade would be your 4th day trade in 5 business days. Accounts under $25,000 "
                             "are limited to 3 day trades in any 5-business-day period (pattern day trader rule).",
                             "pdt_limit", 400)
    out = {"reserve_cents": 0, "bp_hold_cents": 0, "allow_borrow": acct == "margin" and ac != "crypto",
           "copy_hold_cents": 0}
    if side in CLOSING_SIDES:
        return out
    if source == "copy":
        # copy-trading buys are paid from the copy allocation (already reserved), never borrowed
        if side not in ("buy", "buy_to_open"):
            raise OrderError("Copy trading only mirrors buys and closing sells.", "invalid_side")
        out.update(allow_borrow=False, copy_hold_cents=est["reserve_cents"])
        return out
    # --- opening orders: what-if on buying power
    buy = is_buy(side)
    delta = qty if buy else -qty
    cash_delta = -(est["gross"] + est["fee"]) if buy else est["gross"] - est["fee"]
    before = margin.account_state(uid)
    after = margin.account_state(uid, [(symbol, ac, delta, est["price"])], cash_delta)
    if after.unbounded_risk and not before.unbounded_risk and (acct != "margin" or options_level(user) < 4):
        raise OrderError("This order would create an uncovered (naked) short call. That requires a margin account "
                         "with options level 4.", "options_level", 400)
    if side == "sell_to_open" and options_level(user) < 3:
        # level 1-2: only covered calls and cash-secured puts
        o = opt.parse_occ(symbol)
        if o["right"] == "P":
            need = D(str(o["strike"])) * opt.MULTIPLIER * qty
            if acct == "margin" and before.available - before.holds < need:
                raise OrderError(f"A cash-secured put needs ${need:,.2f} in cash.", "insufficient_buying_power")
    if buy and (acct != "margin" or ac == "crypto"):
        reserve = D(est["reserve_cents"]) / 100
        limit = before.base if acct != "margin" else min(before.available - before.holds, before.base)
        if reserve > limit:
            raise OrderError(f"Insufficient buying power. This order needs ${reserve:,.2f}; you have "
                             f"${max(limit, D('0')):,.2f} available.", "insufficient_buying_power")
        out["reserve_cents"] = est["reserve_cents"]
        return out
    hold = max(D("0"), before.base - after.base)
    if after.base < 0:
        bp = before.buying_power()
        kind = "option" if ac == "option" else "stock"
        raise OrderError(f"Insufficient buying power. {kind.title()} buying power is ${bp[kind]:,.2f}.",
                         "insufficient_buying_power")
    if acct == "margin" and after.cash < 0 and before.equity < margin.MIN_MARGIN_EQUITY:
        raise OrderError("Borrowing on margin requires at least $2,000 of account equity.", "margin_minimum")
    # market orders may fill above the estimate: hold a little extra
    buffer = RESERVE_BUFFER[ac] if spec["type"] in ("market", "stop", "trailing_stop") else D("0")
    out["bp_hold_cents"] = instruments.cents(hold * (1 + buffer))
    return out


# ------------------------------------------------------------------ validation
def normalize_request(req: OrderRequest, user: Dict, quote: Optional[Dict]) -> Dict:
    """Validate a request and return a normalised order spec plus warnings.

    Raises OrderError with a user-facing message for anything a real broker would reject.
    """
    try:
        symbol = universe.normalize(req.symbol, req.asset_class)
    except (universe.UnknownSymbol, ValueError) as exc:
        raise OrderError(str(exc), "unknown_symbol", 404)
    ac = universe.asset_class_of(symbol)
    side, tif, otype = req.side, req.tif, req.type
    warnings: List[str] = []

    # --- sides
    if ac == "option":
        side = {"buy": "buy_to_open", "sell": "sell_to_close"}.get(side, side)
        if side not in ("buy_to_open", "sell_to_close", "sell_to_open", "buy_to_close"):
            raise OrderError("Option orders use buy_to_open, sell_to_close, sell_to_open or buy_to_close", "invalid_side")
    elif side not in ("buy", "sell", "sell_short", "buy_to_cover"):
        raise OrderError(f"{side} is only valid for option orders", "invalid_side")
    if side == "sell_short":
        if account_type(user) != "margin":
            raise OrderError("Short selling requires a margin account. Upgrade to margin in Settings.",
                             "margin_required", 400)
        if ac == "crypto":
            raise OrderError("Crypto cannot be sold short.", "not_shortable")
        if req.qty is None or req.qty != req.qty.to_integral_value():
            raise OrderError("Short sales must be for whole shares.", "invalid_qty")
    if ac == "option":
        level = options_level(user)
        if side == "buy_to_open" and level < 2:
            raise OrderError("Buying options requires options approval level 2.", "options_level", 400)
        if side == "sell_to_open" and level < 1:
            raise OrderError("Selling options requires options approval level 1 (covered calls and "
                             "cash-secured puts).", "options_level", 400)
        if level < 1:
            raise OrderError("This account is not approved for options trading.", "options_level", 400)

    # --- option contract checks
    if ac == "option":
        p = opt.parse_occ(symbol)
        if opt.expiry_close(p["expiry"]) <= datetime.now(timezone.utc):
            raise OrderError("This option contract has expired.", "expired_contract")
        if universe.asset_class_of(p["root"]) not in ("stock", "etf"):
            raise OrderError("Unknown underlying for option.", "unknown_symbol", 404)

    # --- time in force & session
    if ac == "crypto":
        if tif == "day":
            tif = "gtc"
            warnings.append("Crypto trades 24/7, so this order is good-til-canceled.")
        if req.extended_hours:
            raise OrderError("Extended hours do not apply to crypto, which trades 24/7.", "invalid_tif")
    else:
        if otype == "market" and tif == "gtc":
            raise OrderError("Market orders for stocks, ETFs and options are day orders.", "invalid_tif")
        if req.extended_hours and ac != "stock" and ac != "etf":
            raise OrderError("Extended-hours trading is available for stocks and ETFs only.", "invalid_tif")
        if not instruments.can_trade_now(ac, req.extended_hours):
            session = calendar.equity_session()
            if tif in ("ioc", "fok"):
                raise OrderError("Immediate-or-cancel and fill-or-kill orders need an open market.", "market_closed")
            if session in ("pre", "post") and ac in ("stock", "etf") and otype == "limit":
                warnings.append("The market is in extended hours. Check 'Extended hours' to trade now, "
                                "or this order will wait for the regular session.")
            else:
                warnings.append("The market is closed. This order will be queued and can execute when the "
                                "market opens at " + _fmt_open())

    # --- quantity
    qty, notional = _dec(req.qty), _dec(req.notional)
    if qty is not None:
        rounded = instruments.round_qty(qty, ac)
        if rounded != qty:
            if ac == "option":
                raise OrderError("Options trade in whole contracts.", "invalid_qty")
            places = abs(instruments.QTY_STEP[ac].as_tuple().exponent)
            raise OrderError(f"Quantity supports up to {places} decimal places.", "invalid_qty")
        if ac in ("stock", "etf") and qty != qty.to_integral_value():
            if otype not in ("market", "limit") or req.extended_hours:
                raise OrderError("Fractional shares are supported for market and limit orders during the "
                                 "regular session only.", "fractional_not_allowed")
    if notional is not None:
        if ac == "option":
            raise OrderError("Option orders must specify a number of contracts.", "invalid_qty")
        if notional < instruments.MIN_NOTIONAL[ac]:
            raise OrderError(f"The minimum dollar amount is ${instruments.MIN_NOTIONAL[ac]}.", "invalid_qty")
        notional = notional.quantize(D("0.01"), rounding=ROUND_DOWN)

    # --- prices
    if not quote:
        raise OrderError("A live price is not available for this symbol right now. Try again shortly.",
                         "no_quote", 503)
    last = float(quote.get("last") or quote.get("mid") or 0)
    for field, label in (("limit_price", "Limit"), ("stop_price", "Stop")):
        price = getattr(req, field)
        if price is None:
            continue
        tick = instruments.price_tick(ac, float(price))
        if not instruments.on_tick(price, ac):
            raise OrderError(f"{label} price must be in ${tick} increments.", "invalid_price")
        if last and ac != "option" and abs(float(price) / last - 1) > COLLAR:
            raise OrderError(f"{label} price is more than {int(COLLAR * 100)}% away from the last price "
                             f"(${last:,.2f}). Check the price.", "price_collar")
    buy = is_buy(side)
    if otype in ("stop", "stop_limit") and last:
        stop = float(req.stop_price)
        if buy and stop <= last:
            raise OrderError(f"A buy stop must be above the current price (${last:,.2f}).", "invalid_stop")
        if not buy and stop >= last:
            raise OrderError(f"A sell stop must be below the current price (${last:,.2f}).", "invalid_stop")
    if otype == "trailing_stop" and req.trail_amount is not None and last and float(req.trail_amount) >= last:
        raise OrderError("Trail amount must be smaller than the current price.", "invalid_stop")
    if otype == "limit" and last and buy and req.limit_price and float(req.limit_price) > (quote.get("ask") or last) * 1.05:
        warnings.append("This buy limit is well above the ask and will likely execute immediately.")

    # --- short-sale rules (locate + Rule 201)
    if side == "sell_short":
        loc = borrow.locate(symbol, last)
        if not loc["shortable"]:
            raise OrderError(loc["reason"] or f"{symbol} is not available to short.", "not_shortable")
        if loc["available_shares"] is not None and qty is not None and qty > loc["available_shares"]:
            raise OrderError(f"Only {loc['available_shares']:,} shares of {symbol} are available to borrow.",
                             "locate_failed")
        if not loc["easy_to_borrow"]:
            warnings.append(f"{symbol} is hard to borrow: a {loc['borrow_rate_apr']}% APR borrow fee is charged daily.")
        if borrow.ssr_active(quote):
            if otype != "limit" or float(req.limit_price) <= float(quote.get("bid") or 0):
                raise OrderError("Short-sale restriction (Rule 201) is in effect: the stock is down 10% or more "
                                 "today. Short sales must be limit orders priced above the current bid.", "ssr")

    # --- minimum size
    mult = instruments.multiplier(ac)
    ref = float(req.limit_price or quote.get("ask" if buy else "bid") or last)
    if qty is not None and ac != "option" and qty * D(str(ref)) * mult < instruments.MIN_NOTIONAL[ac]:
        raise OrderError(f"The minimum order value is ${instruments.MIN_NOTIONAL[ac]}.", "invalid_qty")

    if quote.get("spread_model") == "synthetic":
        warnings.append("Bid/ask is estimated from the last trade (free data feeds have no live quotes).")
    if quote.get("theoretical"):
        warnings.append("This contract has no live quote; prices are theoretical (Black-Scholes).")
    if quote.get("delayed"):
        warnings.append("Option prices are delayed about 15 minutes.")

    return {"symbol": symbol, "asset_class": ac, "multiplier": mult, "side": side, "type": otype, "tif": tif,
            "qty": qty, "notional": notional, "limit_price": _dec(req.limit_price), "stop_price": _dec(req.stop_price),
            "trail_percent": _dec(req.trail_percent), "trail_amount": _dec(req.trail_amount),
            "extended_hours": req.extended_hours, "warnings": warnings}


def _fmt_open() -> str:
    return datetime.fromisoformat(calendar.market_status()["next_open"]).strftime("%a %b %d, %I:%M %p ET").replace(" 0", " ")


def estimate(spec: Dict, quote: Dict) -> Dict:
    """Estimated price, cost/proceeds, fees and the cash to reserve for buys."""
    ac, buy, mult = spec["asset_class"], is_buy(spec["side"]), spec["multiplier"]
    px_quote = D(str(quote.get("ask") if buy else quote.get("bid") or quote.get("last")))
    if spec["type"] in ("limit", "stop_limit"):
        px = spec["limit_price"]
    elif spec["type"] == "stop":
        px = max(spec["stop_price"], px_quote) if buy else min(spec["stop_price"], px_quote)
    else:
        px = px_quote
        # market orders pay size-based slippage at execution; include it in the estimate
        size = spec["notional"] if spec["notional"] is not None else (spec["qty"] or D("0")) * px * mult
        slip = D(str(matching.slippage_bps(ac, float(size)))) / 10000
        px = instruments.round_price(float(px * (1 + slip) if buy else px * (1 - slip)), ac)
    if spec["notional"] is not None:
        gross = spec["notional"]
        fee = fees.compute(ac, not buy, gross / px if px else D("0"), gross)["total"]
        if buy and ac == "crypto":  # the fee comes out of the dollar amount
            gross = (spec["notional"] / (1 + fees.SCHEDULE["crypto_rate"])).quantize(D("0.01"), rounding=ROUND_DOWN)
            fee = spec["notional"] - gross
        qty = (gross / px) if px else D("0")
    else:
        qty = spec["qty"]
        gross = qty * px * mult
        fee = fees.compute(ac, not buy, qty, gross)["total"]
    total = gross + fee if buy else gross - fee
    reserve_cents = 0
    if buy:
        if spec["notional"] is not None:
            reserve = spec["notional"]
        elif spec["type"] in ("limit", "stop_limit"):
            reserve = gross + fee
        else:
            bound = px * (1 + RESERVE_BUFFER[ac])
            if spec["type"] == "trailing_stop":
                trail = spec["trail_percent"] / 100 if spec["trail_percent"] is not None else spec["trail_amount"] / px
                bound = px * (1 + trail) * (1 + RESERVE_BUFFER[ac])
            reserve = qty * bound * mult + fees.compute(ac, False, qty, qty * bound * mult)["total"]
        reserve_cents = instruments.cents(reserve)
    return {"price": px, "qty": qty, "gross": gross, "fee": fee, "total": total, "reserve_cents": reserve_cents}


# ------------------------------------------------------------------ preview
def preview(user_id: str, req: OrderRequest, quote: Dict) -> Dict:
    user = ledger.ensure_account(user_id)
    spec = normalize_request(req, user, quote)
    est = estimate(spec, quote)
    bal = ledger.get_balances(user_id)
    out_warnings = list(spec["warnings"])
    buy = is_buy(spec["side"])
    position_qty = positions.open_qty(user_id, spec["symbol"])
    if buy:
        bp_after = bal["available_cents"] - est["reserve_cents"]
        if bp_after < 0:
            out_warnings.append("Insufficient buying power for this order.")
        position_after = position_qty + est["qty"]
    else:
        bp_after = bal["available_cents"]
        position_after = position_qty - est["qty"]
        free = position_qty - committed_sell_qty(user_id, spec["symbol"], "self")
        if est["qty"] > free:
            out_warnings.append(f"You can sell up to {positions._fmt_qty(max(free, D('0')))} "
                                f"({'contracts' if spec['asset_class'] == 'option' else 'units'}).")
    return {
        "symbol": spec["symbol"], "name": universe.describe(spec["symbol"])["name"],
        "asset_class": spec["asset_class"], "side": spec["side"], "type": spec["type"], "tif": spec["tif"],
        "qty": positions._fmt_qty(est["qty"]) if spec["qty"] is not None else f"~{est['qty']:.6f}",
        "estimated_price": f"{est['price']:.4f}", "estimated_gross": f"{est['gross']:.2f}",
        "estimated_fees": f"{est['fee']:.2f}", "fee_schedule": {k: str(v) for k, v in fees.SCHEDULE.items()},
        "estimated_total": f"{est['total']:.2f}", "cash_reserved": f"{est['reserve_cents'] / 100:.2f}",
        "buying_power": f"{bal['available_cents'] / 100:.2f}", "buying_power_after": f"{bp_after / 100:.2f}",
        "position_after": positions._fmt_qty(position_after), "market_open": instruments.can_trade_now(
            spec["asset_class"], spec["extended_hours"]),
        "quote": {"bid": quote.get("bid"), "ask": quote.get("ask"), "last": quote.get("last"),
                  "spread_model": quote.get("spread_model"), "as_of": quote.get("ts")},
        "warnings": out_warnings,
        "can_place": not any(w.startswith(("Insufficient", "You can sell")) for w in out_warnings),
    }


# ------------------------------------------------------------------ placement
def place(user_id: str, req: OrderRequest, quote: Dict, source: str = "manual", bucket: str = "self",
          extra: Optional[Dict] = None) -> Dict:
    """Validate, persist, reserve funds and try to execute immediately. Returns the order."""
    user_id = str(user_id)
    existing = orders_col().find_one({"user_id": user_id, "client_order_id": req.client_order_id})
    if existing:
        return existing
    user = ledger.ensure_account(user_id)
    spec = normalize_request(req, user, quote)
    with user_lock(user_id):
        existing = orders_col().find_one({"user_id": user_id, "client_order_id": req.client_order_id})
        if existing:
            return existing
        buy = is_buy(spec["side"])
        est = estimate(spec, quote)
        try:
            risk = risk_check(ledger.ensure_account(user_id), spec, est, bucket, source)
        except OrderError as exc:
            _record_rejection(user_id, req, spec, source, bucket, exc, extra)
            raise
        now = _now()
        order = {
            "_id": ObjectId(), "user_id": user_id, "client_order_id": req.client_order_id,
            "source": source, "bucket": bucket, "symbol": spec["symbol"], "asset_class": spec["asset_class"],
            "multiplier": spec["multiplier"], "name": universe.describe(spec["symbol"])["name"],
            "side": spec["side"], "type": spec["type"], "tif": spec["tif"], "extended_hours": spec["extended_hours"],
            "qty": None if spec["qty"] is None else str(spec["qty"]),
            "notional": None if spec["notional"] is None else str(spec["notional"]),
            "limit_price": _s(spec["limit_price"]), "stop_price": _s(spec["stop_price"]),
            "trail_percent": _s(spec["trail_percent"]), "trail_amount": _s(spec["trail_amount"]),
            "trail_watermark": None, "triggered": False,
            "filled_qty": "0", "filled_notional": "0", "avg_fill_price": None, "fees_total": "0",
            "reserved_cents": 0, "bp_hold_cents": risk["bp_hold_cents"], "allow_borrow": risk["allow_borrow"],
            "status": "new", "status_history": [_hist("new")],
            "expires_at": _naive(instruments.order_expiry(spec["asset_class"], spec["tif"], spec["extended_hours"])),
            "warnings": spec["warnings"], "estimate": {"price": str(est["price"]), "total": f"{est['total']:.2f}"},
            "applied_fills": [], "created_at": now, "updated_at": now, **(extra or {}),
        }
        try:
            orders_col().insert_one(order)
        except DuplicateKeyError:
            return orders_col().find_one({"user_id": user_id, "client_order_id": req.client_order_id})

        if risk.get("copy_hold_cents"):
            from app.trading import copy_engine
            try:
                copy_engine.hold_for_order(order["copy_link_id"], risk["copy_hold_cents"], order["_id"])
            except copy_engine.CopyError as exc:
                _finalize(order, "rejected", exc.code)
                raise OrderError(str(exc), exc.code)
            order["reserved_cents"] = risk["copy_hold_cents"]
        elif risk["reserve_cents"] > 0:
            try:
                ledger.reserve(user_id, risk["reserve_cents"], type="order_hold",
                               idempotency_key=f"order-hold:{order['_id']}", ref_type="order",
                               ref_id=str(order["_id"]), description=f"Cash held for {spec['side']} {spec['symbol']}")
            except ledger.InsufficientFunds as exc:
                _finalize(order, "rejected", "insufficient_buying_power")
                raise OrderError(f"Insufficient buying power. This order needs ${risk['reserve_cents'] / 100:,.2f}; "
                                 f"you have ${exc.available_cents / 100:,.2f} available.", "insufficient_buying_power")
            order["reserved_cents"] = risk["reserve_cents"]
        orders_col().update_one({"_id": order["_id"]}, {
            "$set": {"status": "accepted", "reserved_cents": order["reserved_cents"], "updated_at": _now()},
            "$push": {"status_history": _hist("accepted")}})
        order = orders_col().find_one({"_id": order["_id"]})
        _publish_order(order)

        # Marketable orders execute right away against the quote used for the ticket.
        process(order["_id"], quote)
        order = orders_col().find_one({"_id": order["_id"]})
        if order["tif"] in ("ioc", "fok") and order["status"] in OPEN_STATUSES:
            _finalize(order, "canceled", "not_immediately_marketable")
            order = orders_col().find_one({"_id": order["_id"]})
    _notify_watchers(order)   # open -> watch for fills; filled -> keep its position's price streaming
    return order


def _record_rejection(user_id: str, req: OrderRequest, spec: Dict, source: str, bucket: str,
                      exc: "OrderError", extra: Optional[Dict]) -> None:
    """Keep rejected orders in history (with the reason), as brokers do."""
    now = _now()
    try:
        orders_col().insert_one({
            "_id": ObjectId(), "user_id": user_id, "client_order_id": req.client_order_id, "source": source,
            "bucket": bucket, "symbol": spec["symbol"], "asset_class": spec["asset_class"],
            "multiplier": spec["multiplier"], "name": universe.describe(spec["symbol"])["name"], "side": spec["side"],
            "type": spec["type"], "tif": spec["tif"], "extended_hours": spec["extended_hours"],
            "qty": _s(spec["qty"]), "notional": _s(spec["notional"]), "limit_price": _s(spec["limit_price"]),
            "stop_price": _s(spec["stop_price"]), "trail_percent": _s(spec["trail_percent"]),
            "trail_amount": _s(spec["trail_amount"]), "filled_qty": "0", "fees_total": "0", "reserved_cents": 0,
            "bp_hold_cents": 0, "status": "rejected", "final_reason": exc.code,
            "status_history": [_hist("new"), _hist("rejected", str(exc))], "warnings": spec["warnings"],
            "applied_fills": [], "created_at": now, "updated_at": now, "closed_at": now, **(extra or {})})
    except DuplicateKeyError:
        pass


def _s(v) -> Optional[str]:
    return None if v is None else str(v)


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    return None if dt is None else dt.astimezone(timezone.utc).replace(tzinfo=None)


# ------------------------------------------------------------------ cancel / replace / expire
def _finalize(order: Dict, status: str, reason: Optional[str] = None) -> Dict:
    """Move an open order to a final status and release any cash still held for it."""
    res = orders_col().update_one(
        {"_id": order["_id"], "status": {"$in": list(OPEN_STATUSES)}},
        {"$set": {"status": status, "final_reason": reason, "updated_at": _now(),
                  "closed_at": _now()},
         "$push": {"status_history": _hist(status, reason)}})
    fresh = orders_col().find_one({"_id": order["_id"]})
    if res.modified_count:
        _release_remaining(fresh)
        fresh = orders_col().find_one({"_id": order["_id"]})
        _publish_order(fresh)
    return fresh


def _release_remaining(order: Dict) -> None:
    left = int(order.get("reserved_cents") or 0)
    if left > 0 and order.get("copy_link_id"):
        # a copy order's unused hold goes back to the copy allocation, not to free cash
        from app.trading import copy_engine
        copy_engine.return_leftover(order, left)
        orders_col().update_one({"_id": order["_id"]}, {"$set": {"reserved_cents": 0}})
        return
    if left > 0:
        ledger.release(order["user_id"], left, type="order_release", idempotency_key=f"order-release:{order['_id']}",
                       ref_type="order", ref_id=str(order["_id"]), description=f"Hold released - {order['symbol']}")
        orders_col().update_one({"_id": order["_id"]}, {"$set": {"reserved_cents": 0}})


def get_order(user_id: str, order_id: str) -> Dict:
    try:
        o = orders_col().find_one({"_id": ObjectId(order_id), "user_id": str(user_id)})
    except Exception:
        o = None
    if not o:
        raise OrderError("Order not found", "not_found", 404)
    return o


def cancel(user_id: str, order_id: str, reason: str = "user_requested") -> Dict:
    with user_lock(user_id):
        order = get_order(user_id, order_id)
        if order["status"] not in OPEN_STATUSES:
            raise OrderError(f"Order is already {order['status']}.", "not_open", 409)
        return _finalize(order, "canceled", reason)


def replace(user_id: str, order_id: str, changes: Dict, quote: Dict) -> Dict:
    """Cancel-replace: the original is canceled and a new linked order is placed."""
    with user_lock(user_id):
        old = get_order(user_id, order_id)
        if old["status"] not in OPEN_STATUSES:
            raise OrderError(f"Order is already {old['status']}.", "not_open", 409)
        if D(old.get("filled_qty", "0")) > 0:
            raise OrderError("Partially filled orders cannot be changed; cancel the rest instead.", "not_replaceable", 409)
        if old.get("source") != "manual":
            raise OrderError("Copy-trading and system orders cannot be changed.", "not_replaceable", 400)
        if old.get("asset_class") == "multileg":
            raise OrderError("Spread orders cannot be changed; cancel and place a new one.", "not_replaceable", 409)
        fields = {k: old.get(k) for k in ("symbol", "asset_class", "side", "type", "tif", "extended_hours",
                                          "qty", "notional", "limit_price", "stop_price", "trail_percent", "trail_amount")}
        fields.update({k: v for k, v in changes.items() if v is not None})
        fields = {k: (str(v) if isinstance(v, Decimal) else v) for k, v in fields.items() if v is not None}
        import uuid
        new_req = OrderRequest(client_order_id=str(uuid.uuid4()), **fields)
        normalize_request(new_req, ledger.ensure_account(user_id), quote)   # validate before canceling
        _finalize(old, "canceled", "replaced")
        new = place(user_id, new_req, quote, extra={"replaces": str(old["_id"])})
        orders_col().update_one({"_id": old["_id"]}, {"$set": {"replaced_by": str(new["_id"])}})
        return new


def expire_due(now: Optional[datetime] = None) -> int:
    """Expire DAY/GTC orders past their expiry time."""
    now = now or _now()
    n = 0
    for o in list(orders_col().find({"status": {"$in": list(OPEN_STATUSES)}, "expires_at": {"$lte": now}})):
        with user_lock(o["user_id"]):
            fresh = orders_col().find_one({"_id": o["_id"]})
            if fresh and fresh["status"] in OPEN_STATUSES:
                _finalize(fresh, "expired", "time_in_force")
                n += 1
    return n


# ------------------------------------------------------------------ execution
def process(order_id, quote: Optional[Dict], now=None) -> Optional[Dict]:
    """Evaluate one open order against a quote and fill it if the rules say so.
    Returns the fill (or None). Safe to call repeatedly with the same quote."""
    order = orders_col().find_one({"_id": order_id})
    if not order or order["status"] not in OPEN_STATUSES:
        return None
    if order.get("asset_class") == "multileg":
        from app.market_data.bus import bus
        from app.trading import multileg
        quotes = {l["symbol"]: bus.get(l["symbol"]) for l in order["legs"]}
        if quote:
            quotes[quote["symbol"]] = quote
        if all(quotes.values()):
            multileg.process(order_id, quotes)
        return None
    with user_lock(order["user_id"]):
        order = orders_col().find_one({"_id": order_id})
        if not order or order["status"] not in OPEN_STATUSES:
            return None
        rem = remaining_qty(order)
        size_hint = rem if rem is not None else D(order["notional"]) / D(str(quote.get("last") or 1)) if quote else D("1")
        decision = matching.evaluate(order, quote, size_hint, now)
        if decision.updates:
            set_ = dict(decision.updates)
            push = None
            if decision.triggered:
                set_["status"] = "triggered"
                push = {"status_history": _hist("triggered", f"last {quote.get('last')}")}
            upd = {"$set": set_}
            if push:
                upd["$push"] = push
            orders_col().update_one({"_id": order_id, "status": {"$in": list(OPEN_STATUSES)}}, upd)
            order = orders_col().find_one({"_id": order_id})
            if decision.triggered:
                _publish_order(order)
        if decision.fill_price is None:
            return None
        return _execute(order, decision.fill_price, quote)


def _execute(order: Dict, price: Decimal, quote: Dict, kind: str = "trade", no_fees: bool = False) -> Optional[Dict]:
    ac, mult, buy = order["asset_class"], int(order["multiplier"]), is_buy(order["side"])
    rem = remaining_qty(order)
    if rem is None:  # dollar-amount order: size it at the execution price
        notional = D(order["notional"])
        if buy:
            gross_target = notional / (1 + fees.SCHEDULE["crypto_rate"]) if ac == "crypto" else notional
        else:
            gross_target = notional
        qty = instruments.round_qty(gross_target / price, ac)
        if not buy:
            qty = min(qty, positions.open_qty(order["user_id"], order["symbol"], order["bucket"]))
    else:
        qty = rem
    if order["side"] in ("sell", "sell_to_close"):
        # never let a closing order flip the position (it may have shrunk since placement)
        qty = min(qty, positions.open_qty(order["user_id"], order["symbol"], order["bucket"]))
    elif order["side"] in ("buy_to_cover", "buy_to_close"):
        qty = min(qty, -positions.open_qty(order["user_id"], order["symbol"], order["bucket"]))
    if qty <= 0:
        _finalize(order, "canceled", "quantity_rounds_to_zero")
        return None
    gross = qty * price * mult
    fee_items = {"total": D("0")} if no_fees else fees.compute(ac, not buy, qty, gross)
    gross_c, fee_c = instruments.cents(gross), instruments.cents(fee_items["total"])
    cash_delta = -(gross_c + fee_c) if buy else gross_c - fee_c
    reserved = int(order.get("reserved_cents") or 0)
    release = min(reserved, -cash_delta) if buy else 0
    ts = _now()
    fill = {
        "_id": ObjectId(), "order_id": order["_id"], "user_id": order["user_id"], "bucket": order["bucket"],
        "symbol": order["symbol"], "asset_class": ac, "multiplier": mult, "side": order["side"], "is_buy": buy,
        "qty": str(qty), "price": str(price), "gross": f"{gross:.2f}", "fee": str(fee_items["total"]),
        "fee_items": {k: str(v) for k, v in fee_items.items() if k != "total"},
        "cash_delta_cents": cash_delta, "reserved_release_cents": release, "kind": kind,
        "liquidity": "taker" if order["type"] in ("market", "stop", "trailing_stop") else "maker",
        "quote": {k: quote.get(k) for k in ("bid", "ask", "last", "ts", "source", "spread_model")} if quote else None,
        "settles_at": _naive(instruments.settlement_time(ac)), "source": order.get("source", "manual"),
        "allow_borrow": bool(order.get("allow_borrow")), "status": "pending", "ts": ts,
    }
    # A fill that failed to post stays pending. Never stack a second fill on the same order
    # while one is pending; the next pass re-applies the existing one instead.
    pending = fills_col().find_one({"order_id": order["_id"], "status": "pending"})
    if pending:
        return apply_fill(pending)
    fills_col().insert_one(fill)
    return apply_fill(fill)


def apply_fill(fill: Dict) -> Optional[Dict]:
    """Steps 2-4 of the fill pipeline. Idempotent."""
    order = orders_col().find_one({"_id": fill["order_id"]})
    # 2. cash
    if fill["cash_delta_cents"] != 0 or fill["reserved_release_cents"]:
        try:
            ledger.post(fill["user_id"], type=_ledger_type(fill), idempotency_key=f"fill:{fill['_id']}",
                        cash_delta_cents=fill["cash_delta_cents"], reserved_delta_cents=-fill["reserved_release_cents"],
                        ref_type="fill", ref_id=str(fill["_id"]),
                        description=_describe(fill),
                        meta={"symbol": fill["symbol"], "qty": fill["qty"], "price": fill["price"],
                              "order_id": str(fill["order_id"]), "settles_at": fill.get("settles_at"),
                              "asset_class": fill["asset_class"], "bucket": fill.get("bucket", "self")},
                        allow_negative_cash=bool(fill.get("allow_borrow")))
        except ledger.InsufficientFunds:
            fills_col().update_one({"_id": fill["_id"]}, {"$set": {"status": "void", "void_reason": "insufficient_funds"}})
            if order and order["status"] in OPEN_STATUSES and fill.get("leg_index") is None:
                _finalize(order, "canceled", "insufficient_funds_at_execution")
            return None
    # 3. position
    pos = positions.apply_fill(fill)
    # 4. order (multi-leg parents are finalised by multileg.finish once every leg is applied)
    if order is not None and fill.get("leg_index") is None:
        filled = D(order.get("filled_qty", "0")) + D(fill["qty"])
        notional_filled = D(order.get("filled_notional", "0")) + D(fill["qty"]) * D(fill["price"]) * int(fill["multiplier"])
        avg = notional_filled / (filled * int(fill["multiplier"])) if filled else None
        done = order.get("qty") is None or filled >= D(order["qty"])
        status = "filled" if done else "partially_filled"
        res = orders_col().update_one(
            {"_id": order["_id"], "applied_fills": {"$ne": fill["_id"]}},
            {"$set": {"filled_qty": str(filled), "filled_notional": str(notional_filled),
                      "avg_fill_price": f"{avg:.4f}" if avg is not None else None,
                      "fees_total": str(D(order.get("fees_total", "0")) + D(fill["fee"])),
                      "reserved_cents": int(order.get("reserved_cents") or 0) - fill["reserved_release_cents"],
                      "status": status, "updated_at": _now(), **({"filled_at": fill["ts"]} if done else {})},
             "$push": {"applied_fills": fill["_id"], "status_history": _hist(status)}})
        if res.modified_count and done:
            _release_remaining(orders_col().find_one({"_id": order["_id"]}))
    fills_col().update_one({"_id": fill["_id"]}, {"$set": {"status": "applied",
                                                          "realized_pnl": fill.get("realized_pnl")}})
    fill = fills_col().find_one({"_id": fill["_id"]})
    if order is not None and fill.get("leg_index") is None:
        _publish_order(orders_col().find_one({"_id": order["_id"]}))
    if fill.get("source") in ("bot", "copy"):
        try:
            from app.trading import copy_engine
            copy_engine.after_fill(fill)
        except Exception as exc:
            print(f"copy hook failed for fill {fill['_id']}: {exc}")
    if fill.get("allow_borrow") and fill.get("kind") == "trade" and fill.get("source") != "liquidation":
        try:
            from app.trading import risk_monitor
            risk_monitor.after_fill(fill["user_id"])
        except Exception as exc:
            print(f"after_fill check failed: {exc}")
    events.publish(fill["user_id"], "fill", serialize_fill(fill))
    events.publish(fill["user_id"], "position", {"symbol": pos["symbol"], "bucket": pos["bucket"],
                                                 "qty": positions._fmt_qty(D(pos["qty"]))})
    from app.trading import alerts
    alerts.on_fill(fill)
    return fill


def _ledger_type(fill: Dict) -> str:
    if fill["kind"] == "exercise":
        return "exercise"
    if fill["kind"] == "assignment":
        return "assignment"
    return "trade_buy" if fill["is_buy"] else "trade_sell"


def _describe(fill: Dict) -> str:
    verb = {"exercise": "Exercise", "expiration": "Expired", "assignment": "Assigned"}.get(
        fill["kind"], "Bought" if fill["is_buy"] else "Sold")
    unit = " contracts" if fill["asset_class"] == "option" else ""
    return f"{verb} {positions._fmt_qty(D(fill['qty']))}{unit} {fill['symbol'].strip()} @ ${D(fill['price']):,.4f}".rstrip("0").rstrip(".")


def system_fill(user_id: str, symbol: str, side: str, qty: Decimal, price: Decimal, kind: str,
                note: str, quote: Optional[Dict] = None, bucket: str = "self") -> Optional[Dict]:
    """Book a non-market event (option exercise / expiration / assignment) as a filled
    system order, so it appears in order history, the ledger and positions like any trade.
    Caller must hold the user's lock."""
    ac = universe.asset_class_of(symbol)
    now = _now()
    order = {
        "_id": ObjectId(), "user_id": str(user_id), "client_order_id": f"sys-{kind}-{ObjectId()}",
        "source": "system", "bucket": bucket, "symbol": symbol, "asset_class": ac,
        "multiplier": instruments.multiplier(ac), "name": universe.describe(symbol)["name"],
        "side": side, "type": kind, "tif": "day", "extended_hours": False, "qty": str(qty), "notional": None,
        "limit_price": None, "stop_price": None, "trail_percent": None, "trail_amount": None,
        "trail_watermark": None, "triggered": False, "filled_qty": "0", "filled_notional": "0",
        "avg_fill_price": None, "fees_total": "0", "reserved_cents": 0, "status": "accepted",
        "allow_borrow": True, "bp_hold_cents": 0,
        "status_history": [_hist("accepted", note)], "expires_at": None, "warnings": [note],
        "applied_fills": [], "created_at": now, "updated_at": now,
    }
    orders_col().insert_one(order)
    q = quote or {"bid": float(price), "ask": float(price), "last": float(price), "ts": time_now(), "source": "settlement"}
    return _execute(order, price, q, kind=kind, no_fees=True)


def time_now() -> float:
    import time
    return time.time()


def recover_pending_fills() -> int:
    n = 0
    parents = set()
    for f in sorted(fills_col().find({"status": "pending"}), key=lambda f: -f["cash_delta_cents"]):
        with user_lock(f["user_id"]):
            apply_fill(f)
            n += 1
            if f.get("leg_index") is not None:
                parents.add(f["order_id"])
    if parents:
        from app.trading import multileg
        for oid in parents:
            multileg.finish(oid)
    return n


def open_orders(symbol: Optional[str] = None) -> List[Dict]:
    q: Dict[str, Any] = {"status": {"$in": list(OPEN_STATUSES)}}
    if symbol:
        q["symbol"] = symbol
    return list(orders_col().find(q))


# ------------------------------------------------------------------ serialisation & events
def serialize_order(o: Dict) -> Dict:
    return {
        "id": str(o["_id"]), "client_order_id": o["client_order_id"], "source": o.get("source", "manual"),
        "bucket": o.get("bucket", "self"), "symbol": o["symbol"], "name": o.get("name"),
        "asset_class": o["asset_class"], "side": o["side"], "type": o["type"], "tif": o["tif"],
        "extended_hours": o.get("extended_hours", False), "qty": o.get("qty"), "notional": o.get("notional"),
        "limit_price": o.get("limit_price"), "stop_price": o.get("stop_price"),
        "trail_percent": o.get("trail_percent"), "trail_amount": o.get("trail_amount"),
        "status": o["status"], "triggered": o.get("triggered", False),
        "filled_qty": o.get("filled_qty", "0"), "avg_fill_price": o.get("avg_fill_price"),
        "fees": o.get("fees_total", "0"), "cash_reserved": f"{int(o.get('reserved_cents') or 0) / 100:.2f}",
        "reason": o.get("final_reason"), "warnings": o.get("warnings", []),
        "replaces": o.get("replaces"), "replaced_by": o.get("replaced_by"),
        "strategy": o.get("strategy"), "legs": o.get("legs"), "group_id": o.get("group_id"),
        "net_price": o.get("net_price"), "price_effect": o.get("price_effect") or o.get("fill_effect"),
        "buying_power_held": f"{int(o.get('bp_hold_cents') or 0) / 100:.2f}",
        "expires_at": _iso(o.get("expires_at")), "created_at": _iso(o.get("created_at")),
        "filled_at": _iso(o.get("filled_at")), "closed_at": _iso(o.get("closed_at")),
        "status_history": [{"status": h["status"], "at": _iso(h["at"]), "reason": h.get("reason")}
                           for h in o.get("status_history", [])],
    }


def serialize_fill(f: Dict) -> Dict:
    return {
        "id": str(f["_id"]), "order_id": str(f["order_id"]), "symbol": f["symbol"], "asset_class": f["asset_class"],
        "side": f["side"], "qty": f["qty"], "price": f["price"], "gross": f["gross"], "fee": f["fee"],
        "fee_items": f.get("fee_items", {}), "net_cash": f"{f['cash_delta_cents'] / 100:.2f}",
        "kind": f.get("kind", "trade"), "liquidity": f.get("liquidity"), "realized_pnl": f.get("realized_pnl"),
        "settles_at": _iso(f.get("settles_at")), "ts": _iso(f["ts"]), "bucket": f.get("bucket", "self"),
        "source": f.get("source", "manual"),
        "quote": f.get("quote"),
    }


def _iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if isinstance(dt, datetime) else None


def _publish_order(order: Dict) -> None:
    events.publish(order["user_id"], "order", serialize_order(order))
