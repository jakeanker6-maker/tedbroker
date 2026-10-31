"""Reg T style requirements, buying power and what-if checks (cash and margin accounts).

One engine for pre-trade checks, buying power, withdrawals and the risk monitor.

Stocks / ETFs (per position, no netting)
  long   initial 50%, maintenance 30% (house)            price < $3: not marginable (100%)
         leveraged ETFs: 75% / 75%
  short  initial 150% of value (100% proceeds + 50%)  -> requirement 50% of value
         maintenance: price >= $5: max(30% of value, $5/share); price < $5: max(100%, $2.50/share)
Crypto   100% (not marginable, longs only)
Options  per underlying and bucket, after pairing covered calls (long shares) and
         covered puts (short shares):
           max_loss  = worst payoff at expiry of the remaining option legs (calendar and
                       diagonal far legs valued at intrinsic: conservative)
           naked     = CBOE: calls max(20% S - OTM + premium, 10% S + premium),
                       puts max(20% S - OTM + premium, 10% K + premium), per share x 100
           margin requirement = max(0, risk + net option value), where risk is max_loss, or
                       naked when the book has unlimited upside loss or naked is smaller
                       (level 4 only). Net option value is included so long options give
                       no loan value and credits received are applied.
           cash-account collateral = max_loss (cash already holds any credit received)
Equity = cash + long value - short value + net option value.
Buying power
  cash account   base = available cash - option collateral - holds of open orders
  margin account base = equity - initial requirement - holds
                 stock BP = 2 x base (equity >= $2,000; otherwise no borrowing)
                 option BP = base; crypto BP = min(available cash, base)
                 day-trade BP (pattern day trader, equity >= $25,000) = 4 x (equity - maintenance)
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Tuple

from app.market_data.bus import bus
from app.trading import ledger
from app.trading import options as opt

D = Decimal
ZERO = D("0")
MIN_MARGIN_EQUITY = D("2000")          # FINRA minimum to borrow
PDT_MIN_EQUITY = D("25000")
LONG_INITIAL, LONG_MAINT = D("0.50"), D("0.30")
SHORT_INITIAL_EXTRA = D("0.50")
SHORT_MAINT = D("0.30")
NON_MARGINABLE_BELOW = D("3")
LEVERAGED_ETFS = {"TQQQ", "SQQQ", "SOXL", "SOXS", "UPRO", "SPXU", "SPXL", "SPXS", "TNA", "TZA", "LABU", "LABD",
                  "UVXY", "SVXY", "TSLL", "NVDL", "FNGU", "FNGD", "YINN", "BOIL", "KOLD"}
LEVERAGED_REQ = D("0.75")
# Tiered margin interest (APR) by debit balance, in the style of retail brokers.
INTEREST_TIERS: List[Tuple[D, D]] = [(D("25000"), D("0.1325")), (D("100000"), D("0.1275")),
                                     (D("250000"), D("0.1150")), (D("500000"), D("0.1050")),
                                     (D("1000000"), D("0.0900")), (D("1e18"), D("0.0850"))]


# =========================================================================== stocks
def stock_requirement(symbol: str, qty: D, price: D) -> Tuple[D, D]:
    """(initial, maintenance) requirement in dollars for one stock/ETF position."""
    if qty == 0 or price <= 0:
        return ZERO, ZERO
    value = abs(qty) * price
    if qty > 0:
        if price < NON_MARGINABLE_BELOW:
            return value, value
        if symbol in LEVERAGED_ETFS:
            return value * LEVERAGED_REQ, value * LEVERAGED_REQ
        return value * LONG_INITIAL, value * LONG_MAINT
    shares = abs(qty)
    initial = value * SHORT_INITIAL_EXTRA
    if price >= 5:
        maint = max(value * SHORT_MAINT, shares * D("5"))
    else:
        maint = max(value, shares * D("2.5"))
    if symbol in LEVERAGED_ETFS:
        maint = max(maint, value * LEVERAGED_REQ)
    return max(initial, maint), maint


# =========================================================================== options
@dataclass
class Leg:
    right: str
    strike: D
    qty: D            # signed contracts
    mark: D           # per share
    expiry: object = None


def naked_requirement(right: str, strike: D, spot: D, premium: D, contracts: D) -> D:
    otm = max(ZERO, strike - spot) if right == "C" else max(ZERO, spot - strike)
    floor_base = spot if right == "C" else strike
    per_share = max(D("0.20") * spot - otm + premium, D("0.10") * floor_base + premium)
    return per_share * opt.MULTIPLIER * contracts


def _payoff(legs: List[Leg], s: D) -> D:
    total = ZERO
    for l in legs:
        intrinsic = max(ZERO, s - l.strike) if l.right == "C" else max(ZERO, l.strike - s)
        total += l.qty * intrinsic * opt.MULTIPLIER
    return total


def option_book(legs: List[Leg], spot: D, stock_qty: D = ZERO) -> Dict:
    """Risk of all option legs on one underlying (one bucket). See module docstring."""
    legs = [Leg(l.right, l.strike, l.qty, l.mark, l.expiry) for l in legs if l.qty != 0]
    net_mv = sum((l.qty * l.mark * opt.MULTIPLIER for l in legs), ZERO)
    covered_calls = covered_puts = ZERO
    # Pair short calls with long shares (lowest strike first), short puts with short shares.
    free_long = max(ZERO, stock_qty) // opt.MULTIPLIER
    for l in sorted((l for l in legs if l.right == "C" and l.qty < 0), key=lambda l: l.strike):
        n = min(-l.qty, free_long)
        l.qty += n
        free_long -= n
        covered_calls += n
    free_short = max(ZERO, -stock_qty) // opt.MULTIPLIER
    for l in sorted((l for l in legs if l.right == "P" and l.qty < 0), key=lambda l: -l.strike):
        n = min(-l.qty, free_short)
        l.qty += n
        free_short -= n
        covered_puts += n
    legs = [l for l in legs if l.qty != 0]
    strikes = sorted({l.strike for l in legs})
    points = [ZERO] + strikes + ([strikes[-1] * 2] if strikes else [])
    worst = min((_payoff(legs, s) for s in points), default=ZERO)
    upside_slope = sum((l.qty for l in legs if l.right == "C"), ZERO)
    unbounded = upside_slope < 0
    max_loss = max(ZERO, -worst)
    naked = sum((naked_requirement(l.right, l.strike, spot, l.mark, -l.qty) for l in legs if l.qty < 0), ZERO)
    has_short = any(l.qty < 0 for l in legs)
    return {"net_mv": net_mv, "max_loss": max_loss, "unbounded": unbounded, "naked": naked,
            "has_short": has_short, "covered_calls": covered_calls, "covered_puts": covered_puts,
            "long_mv": sum((l.qty * l.mark * opt.MULTIPLIER for l in legs if l.qty > 0), ZERO)}


def option_requirement(book: Dict, account_type: str) -> D:
    if account_type == "margin":
        if book["unbounded"]:
            risk = book["naked"]
        elif book["has_short"]:
            risk = min(book["max_loss"], book["naked"]) if book["naked"] else book["max_loss"]
        else:
            risk = ZERO
        return max(ZERO, risk + book["net_mv"])
    return book["max_loss"]  # cash-account collateral


# =========================================================================== account
@dataclass
class Pos:
    symbol: str
    asset_class: str
    bucket: str
    qty: D
    mark: D


@dataclass
class State:
    account_type: str
    cash: D
    reserved: D
    holds: D
    long_mv: D = ZERO
    short_mv: D = ZERO
    option_mv: D = ZERO
    crypto_mv: D = ZERO
    initial_req: D = ZERO
    maint_req: D = ZERO
    collateral: D = ZERO
    unbounded_risk: bool = False
    details: List[Dict] = field(default_factory=list)

    @property
    def available(self) -> D:
        return self.cash - self.reserved

    @property
    def equity(self) -> D:
        return self.cash + self.long_mv + self.short_mv + self.option_mv + self.crypto_mv

    @property
    def base(self) -> D:
        if self.account_type == "margin":
            return self.equity - self.initial_req - self.holds
        return self.available - self.collateral - self.holds

    @property
    def excess_liquidity(self) -> D:
        return self.equity - self.maint_req

    @property
    def margin_debit(self) -> D:
        return max(ZERO, -self.cash)

    def buying_power(self) -> Dict[str, D]:
        base = self.base
        if self.account_type != "margin":
            bp = max(ZERO, base)
            return {"stock": bp, "option": bp, "crypto": bp, "day_trade": ZERO}
        crypto = max(ZERO, min(self.available - self.holds, base))
        if self.equity >= MIN_MARGIN_EQUITY:
            stock = max(ZERO, base * 2)
        else:
            stock = max(ZERO, min(self.available - self.holds, base))
        day = max(ZERO, (self.equity - self.maint_req) * 4) if self.equity >= PDT_MIN_EQUITY else ZERO
        return {"stock": stock, "option": max(ZERO, base), "crypto": crypto, "day_trade": day}


def compute(account_type: str, cash: D, reserved: D, holds: D, positions: Iterable[Pos]) -> State:
    st = State(account_type, cash, reserved, holds)
    by_root: Dict[Tuple[str, str], List[Leg]] = defaultdict(list)
    stock_qty: Dict[Tuple[str, str], D] = defaultdict(lambda: ZERO)
    spots: Dict[str, D] = {}
    for p in positions:
        if p.qty == 0:
            continue
        if p.asset_class == "option":
            o = opt.parse_occ(p.symbol)
            by_root[(o["root"], p.bucket)].append(Leg(o["right"], D(str(o["strike"])), p.qty, p.mark, o["expiry"]))
            continue
        value = p.qty * p.mark
        if p.asset_class == "crypto":
            st.crypto_mv += value
            st.initial_req += abs(value)
            st.maint_req += abs(value)
            continue
        spots[p.symbol] = p.mark
        stock_qty[(p.symbol, p.bucket)] += p.qty
        if p.qty > 0:
            st.long_mv += value
        else:
            st.short_mv += value
        if account_type == "margin":
            i, m = stock_requirement(p.symbol, p.qty, p.mark)
        else:
            i = m = abs(value) if p.qty > 0 else ZERO
        st.initial_req += i
        st.maint_req += m
        st.details.append({"symbol": p.symbol, "bucket": p.bucket, "initial": i, "maintenance": m})
    for (root, bucket), legs in by_root.items():
        spot = spots.get(root) or _spot(root)
        book = option_book(legs, spot, stock_qty.get((root, bucket), ZERO))
        st.option_mv += book["net_mv"]
        if book["unbounded"]:
            st.unbounded_risk = True
        if account_type == "margin":
            req = option_requirement(book, "margin")
            st.initial_req += req
            st.maint_req += req
        else:
            st.collateral += book["max_loss"]
            st.initial_req += book["long_mv"]
            st.maint_req += book["long_mv"]
            req = book["max_loss"]
        st.details.append({"symbol": root, "bucket": bucket, "options": True, "initial": req, "maintenance": req,
                           "max_loss": book["max_loss"], "unbounded": book["unbounded"]})
    return st


def _spot(root: str) -> D:
    q = bus.get(root)
    return D(str(q.get("last") or q.get("mid"))) if q and (q.get("last") or q.get("mid")) else ZERO


# =========================================================================== readers
def mark_for(pos: Dict) -> D:
    """Live mark from the bus; falls back to average cost when no quote is known yet."""
    q = bus.get(pos["symbol"])
    if q:
        v = q.get("mid") if pos["asset_class"] == "option" else (q.get("last") or q.get("mid"))
        if v:
            return D(str(v))
    qty = D(pos["qty"])
    mult = int(pos.get("multiplier", 1))
    return abs(D(pos["cost_basis"]) / (qty * mult)) if qty else ZERO


def load_positions(user_id: str) -> List[Pos]:
    from app.trading import positions as positions_mod
    return [Pos(p["symbol"], p["asset_class"], p.get("bucket", "self"), D(p["qty"]), mark_for(p))
            for p in positions_mod.col().find({"user_id": str(user_id), "open": True})]


def open_holds(user_id: str) -> D:
    from app.trading.orders import orders_col
    from app.trading.models import OPEN_STATUSES
    total = 0
    for o in orders_col().find({"user_id": str(user_id), "status": {"$in": list(OPEN_STATUSES)},
                                "bp_hold_cents": {"$gt": 0}}, {"bp_hold_cents": 1}):
        total += int(o["bp_hold_cents"])
    return D(total) / 100


def account_type(user: Dict) -> str:
    return user.get("account_type", "cash")


def account_state(user_id: str, changes: Optional[List[Tuple[str, str, D, D]]] = None,
                  cash_delta: D = ZERO, extra_holds: D = ZERO) -> State:
    """Current state, or the state after hypothetical fills.

    changes: [(symbol, asset_class, signed_qty_delta, price)] applied to the "self" bucket.
    """
    user = ledger.ensure_account(user_id)
    b = ledger.get_balances(user_id)
    pos = load_positions(user_id)
    for symbol, ac, delta, price in changes or []:
        existing = next((p for p in pos if p.symbol == symbol and p.bucket == "self"), None)
        if existing:
            existing.qty += delta
            existing.mark = price if existing.mark == 0 else existing.mark
        else:
            pos.append(Pos(symbol, ac, "self", delta, price))
    return compute(account_type(user), D(b["cash_cents"]) / 100 + cash_delta, D(b["reserved_cents"]) / 100,
                   open_holds(user_id) + extra_holds, pos)


def serialize(st: State) -> Dict:
    bp = st.buying_power()
    f = lambda v: f"{v:.2f}"  # noqa: E731
    return {
        "account_type": st.account_type, "cash": f(st.cash), "reserved": f(st.reserved), "order_holds": f(st.holds),
        "equity": f(st.equity), "long_market_value": f(st.long_mv), "short_market_value": f(st.short_mv),
        "options_market_value": f(st.option_mv), "crypto_market_value": f(st.crypto_mv),
        "margin_debit": f(st.margin_debit), "initial_requirement": f(st.initial_req),
        "maintenance_requirement": f(st.maint_req), "options_collateral": f(st.collateral),
        "excess_liquidity": f(st.excess_liquidity), "excess_equity": f(st.base),
        "buying_power": {k: f(v) for k, v in bp.items()},
        "margin_utilisation_percent": f((st.maint_req / st.equity * 100) if st.equity > 0 else ZERO),
    }


# =========================================================================== interest
def interest_rate(debit: D) -> D:
    for limit, rate in INTEREST_TIERS:
        if debit < limit:
            return rate
    return INTEREST_TIERS[-1][1]


def daily_interest(debit: D) -> D:
    """Simple daily accrual on the debit balance, 360-day year (broker convention)."""
    return (debit * interest_rate(debit) / 360) if debit > 0 else ZERO
