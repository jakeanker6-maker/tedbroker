"""Pure fill rules: given an open order and a quote, decide what happens.

No I/O here so every rule is unit-testable. The engine applies the decision.

  market         buy at ask, sell at bid, plus size-based slippage
  limit          buy when ask <= limit at min(limit, ask); sell when bid >= limit at max(limit, bid)
  stop           triggers when last trades through the stop, then executes as market
  stop_limit     triggers like a stop, then rests as a limit
  trailing_stop  stop follows the best price since placement (high for sells, low for buys)
Stops trigger on regular-session prints only (crypto 24/7). Quotes older than the
asset's staleness limit are never used to fill.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Optional

from app.market_data.quotes import is_stale
from app.trading import instruments
from app.trading.models import is_buy

D = Decimal
MAX_SLIPPAGE_BPS = 50.0


def slippage_bps(asset_class: str, notional: float) -> float:
    """Market impact grows with the square root of order size; options use the quoted spread only."""
    if asset_class == "option" or notional <= 0:
        return 0.0
    k = 0.8 if asset_class == "crypto" else 0.5
    return min(MAX_SLIPPAGE_BPS, k * math.sqrt(notional / 1000.0))


@dataclass
class Decision:
    fill_price: Optional[Decimal] = None          # set -> fill now at this price
    triggered: bool = False                       # stop condition met on this quote
    updates: Dict = field(default_factory=dict)   # order fields to persist (trail state, ...)
    reason: str = ""


def _trail_stop(order: Dict, last: float) -> (Optional[float], Dict):
    """Update the trailing watermark and return (stop price, field updates)."""
    buy = is_buy(order["side"])
    mark = order.get("trail_watermark")
    updates = {}
    if mark is None or (not buy and last > mark) or (buy and last < mark):
        mark = last
        updates["trail_watermark"] = mark
    if order.get("trail_percent") is not None:
        p = float(order["trail_percent"]) / 100
        stop = mark * (1 + p) if buy else mark * (1 - p)
    else:
        a = float(order["trail_amount"])
        stop = mark + a if buy else mark - a
    if order.get("stop_price") is None or abs(float(order["stop_price"]) - stop) > 1e-9:
        updates["stop_price"] = str(instruments.round_price(stop, order["asset_class"]))
    return stop, updates


def evaluate(order: Dict, quote: Optional[Dict], qty: Decimal, now=None) -> Decision:
    """`qty` is the remaining quantity (used for slippage)."""
    if not quote or is_stale(quote):
        return Decision(reason="stale_quote")
    ac = order["asset_class"]
    buy = is_buy(order["side"])
    last = quote.get("last") or quote.get("mid")
    bid, ask = quote.get("bid"), quote.get("ask")
    otype = order["type"]
    decision = Decision()

    if otype in ("stop", "stop_limit", "trailing_stop") and not order.get("triggered"):
        if not instruments.stops_can_trigger(ac, now) or last is None:
            return Decision(reason="stops_inactive")
        if otype == "trailing_stop":
            stop, decision.updates = _trail_stop(order, float(last))
        else:
            stop = float(order["stop_price"])
        hit = float(last) >= stop if buy else float(last) <= stop
        if not hit:
            decision.reason = "stop_not_reached"
            return decision
        decision.triggered = True
        decision.updates["triggered"] = True

    if not instruments.can_trade_now(ac, order.get("extended_hours", False), now):
        decision.reason = "market_closed"
        return decision

    effective = "limit" if otype in ("limit", "stop_limit") else "market"
    mult = instruments.multiplier(ac)
    if effective == "market":
        px = ask if buy else bid
        if not px or px <= 0:
            decision.reason = "no_liquidity"
            return decision
        slip = slippage_bps(ac, float(qty) * px * mult) / 10_000
        px = px * (1 + slip) if buy else px * (1 - slip)
        decision.fill_price = instruments.round_price(px, ac)
        return decision

    limit = float(order["limit_price"])
    if buy and ask and ask <= limit:
        decision.fill_price = instruments.round_price(min(limit, ask), ac)
    elif not buy and bid and bid >= limit:
        decision.fill_price = instruments.round_price(max(limit, bid), ac)
    else:
        decision.reason = "limit_not_reached"
    return decision


def is_marketable(order: Dict, quote: Optional[Dict]) -> bool:
    return evaluate(order, quote, D(order.get("qty") or "1")).fill_price is not None
