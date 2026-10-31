"""Positions: average-cost accounting and idempotent updates.

Quantities are signed (negative = short, used from Phase 2B). `cost_basis` is signed
too: the money paid to open a long (positive) or received to open a short
(negative), plus opening fees. Then for any position:

    market_value   = qty * mark * multiplier
    unrealized_pnl = market_value - cost_basis
    avg_cost       = cost_basis / (qty * multiplier)

Closing a fraction f of a position releases f * cost_basis and realises
(closing value - released basis - closing fees).

Positions are stored per (user_id, symbol, bucket). Buckets: "self" (Trading Hub),
"copy:<link_id>" (copy trading, Phase 4), "basket:<id>" (ETF baskets).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Dict, Optional, Tuple

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from app.database import get_collection

D = Decimal
COLLECTION = "positions"
RECENT_FILLS_KEPT = 200


def col():
    return get_collection(COLLECTION)


def ensure_indexes() -> None:
    c = col()
    c.create_index([("user_id", ASCENDING), ("symbol", ASCENDING), ("bucket", ASCENDING)], unique=True, name="uniq_pos")
    c.create_index([("user_id", ASCENDING), ("open", ASCENDING)], name="user_open")
    c.create_index([("open", ASCENDING), ("asset_class", ASCENDING)], name="open_class")


def _sign(x: Decimal) -> int:
    return (x > 0) - (x < 0)


def apply_fill_math(qty: Decimal, cost_basis: Decimal, realized: Decimal, delta: Decimal, price: Decimal,
                    mult: int, fee: Decimal) -> Tuple[Decimal, Decimal, Decimal, Decimal]:
    """Return (qty, cost_basis, realized, realized_this_fill) after a fill of signed `delta`."""
    realized_now = D("0")
    remaining = delta
    fee_left = fee
    if qty != 0 and _sign(delta) != _sign(qty):
        # closing part (all of delta, or up to the current size if the fill flips the position)
        closing = min(abs(delta), abs(qty))
        released = cost_basis * (closing / abs(qty))
        close_fee = fee * (closing / abs(delta))
        realized_now = closing * price * mult * _sign(qty) - released - close_fee
        cost_basis -= released
        qty += _sign(delta) * closing
        remaining = delta - _sign(delta) * closing
        fee_left = fee - close_fee
        if qty == 0:
            cost_basis = D("0")
    if remaining != 0:  # opening part: add to the position and its basis
        cost_basis += remaining * price * mult + fee_left
        qty += remaining
    q = D("0.0000000001")
    return qty, cost_basis.quantize(q), (realized + realized_now).quantize(q), realized_now.quantize(q)


def valuation(pos: Dict, mark: Optional[float]) -> Dict[str, Optional[Decimal]]:
    """Market value and unrealised P&L. Without a price these are None (unknown), never a
    cost-basis or zero figure that could be mistaken for a real value."""
    qty = D(pos["qty"])
    basis = D(pos["cost_basis"])
    mult = int(pos.get("multiplier", 1))
    avg = (basis / (qty * mult)) if qty else D("0")
    if qty == 0:
        return {"market_value": D("0"), "unrealized_pnl": D("0"), "avg_cost": avg}
    if mark is None:
        return {"market_value": None, "unrealized_pnl": None, "avg_cost": avg}
    mv = qty * D(str(mark)) * mult
    return {"market_value": mv, "unrealized_pnl": mv - basis, "avg_cost": basis / (qty * mult)}


def get(user_id: str, symbol: str, bucket: str = "self") -> Optional[Dict]:
    return col().find_one({"user_id": str(user_id), "symbol": symbol, "bucket": bucket})


def open_qty(user_id: str, symbol: str, bucket: str = "self") -> Decimal:
    p = get(user_id, symbol, bucket)
    return D(p["qty"]) if p and p.get("open") else D("0")


def apply_fill(fill: Dict) -> Dict:
    """Idempotently apply a fill to its position (optimistic concurrency on `version`)."""
    key = {"user_id": fill["user_id"], "symbol": fill["symbol"], "bucket": fill.get("bucket", "self")}
    for _ in range(20):
        pos = col().find_one(key)
        if pos is None:
            try:
                col().insert_one({**key, "asset_class": fill["asset_class"], "multiplier": fill["multiplier"],
                                  "qty": "0", "cost_basis": "0", "realized_pnl": "0", "open": False,
                                  "version": 0, "applied_fills": [], "opened_at": None,
                                  "created_at": datetime.utcnow()})
            except DuplicateKeyError:
                pass
            continue
        if fill["_id"] in pos.get("applied_fills", []):
            return pos
        delta = D(fill["qty"]) * (1 if fill["is_buy"] else -1)
        qty, basis, realized, realized_now = apply_fill_math(
            D(pos["qty"]), D(pos["cost_basis"]), D(pos["realized_pnl"]), delta,
            D(fill["price"]), int(fill["multiplier"]), D(fill["fee"]))
        was_open = pos.get("open", False)
        now = datetime.utcnow()
        update = {
            "qty": str(qty), "cost_basis": str(basis), "realized_pnl": str(realized), "open": qty != 0,
            "updated_at": now, "last_fill_at": fill["ts"],
        }
        if qty != 0 and (not was_open or _sign(qty) != _sign(D(pos["qty"]))):
            update["opened_at"] = fill["ts"]
            update["prev_mark"] = None
        res = col().update_one(
            {**key, "version": pos["version"], "applied_fills": {"$ne": fill["_id"]}},
            {"$set": update, "$inc": {"version": 1},
             "$push": {"applied_fills": {"$each": [fill["_id"]], "$slice": -RECENT_FILLS_KEPT}}},
        )
        if res.modified_count == 1:
            fill["realized_pnl"] = str(realized_now)
            return col().find_one(key)
    raise RuntimeError(f"Position update contention for {key}")


def serialize(pos: Dict, quote: Optional[Dict] = None, day_start: Optional[datetime] = None) -> Dict:
    """API shape with live valuation. Money as decimal strings."""
    mark = None
    if quote:
        mark = quote.get("mid") if pos["asset_class"] == "option" else (quote.get("last") or quote.get("mid"))
    v = valuation(pos, mark)
    qty = D(pos["qty"])
    mult = int(pos.get("multiplier", 1))
    day_pnl = None
    if mark is not None and qty != 0:
        opened = pos.get("opened_at")
        if opened and day_start and opened >= day_start:
            day_pnl = v["unrealized_pnl"]   # opened today: the day's move is the P&L since the open
        else:
            ref = (quote or {}).get("prev_close") if pos["asset_class"] != "option" else pos.get("prev_mark")
            # No reference close: the day figure is unknown. Never fall back to lifetime P&L.
            day_pnl = (qty * (D(str(mark)) - D(str(ref))) * mult) if ref else None
    basis = D(pos["cost_basis"])
    return {
        "symbol": pos["symbol"],
        "asset_class": pos["asset_class"],
        "bucket": pos.get("bucket", "self"),
        "qty": _fmt_qty(qty),
        "side": "short" if qty < 0 else "long",
        "multiplier": mult,
        "avg_cost": f"{v['avg_cost']:.4f}",
        "cost_basis": f"{basis:.2f}",
        "mark": None if mark is None else f"{mark:.4f}",
        "priced": mark is not None or qty == 0,
        "market_value": None if v["market_value"] is None else f"{v['market_value']:.2f}",
        "unrealized_pnl": None if v["unrealized_pnl"] is None else f"{v['unrealized_pnl']:.2f}",
        "unrealized_pnl_percent": (None if v["unrealized_pnl"] is None else
                                   (f"{(v['unrealized_pnl'] / abs(basis) * 100):.2f}" if basis else "0.00")),
        "day_pnl": None if day_pnl is None else f"{day_pnl:.2f}",
        "realized_pnl": f"{D(pos['realized_pnl']):.2f}",
        "opened_at": pos["opened_at"].isoformat() + "Z" if pos.get("opened_at") else None,
        "quote_stale": bool(quote and quote.get("stale")) if quote else True,
    }


def _fmt_qty(q: Decimal) -> str:
    return format(q.normalize(), "f") if q != 0 else "0"
