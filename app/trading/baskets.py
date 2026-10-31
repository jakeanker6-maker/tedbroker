"""ETF baskets: model portfolios of real ETFs bought with one action (M1 "pie" style).

  * curated templates, or custom baskets of up to 20 ETFs with weights totalling 100%
  * invest $X -> one fractional dollar-amount market order per ETF, held in the position
    bucket "basket:<id>" so each basket's holdings and P&L are tracked separately
  * sell a percentage of the basket, rebalance back to target weights (sells first,
    then buys), and optional weekly / monthly auto-invest from cash
These are separate from the managed investment plans, which are unchanged.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Dict, List, Optional

from bson import ObjectId

from app.database import get_collection
from app.market_data import universe
from app.trading import margin, orders, positions
from app.trading.models import OrderRequest

D = Decimal
MIN_ORDER = D("1.00")
MAX_HOLDINGS = 20
REBALANCE_THRESHOLD = D("1.00")

TEMPLATES = [
    {"id": "core-60-40", "name": "Core 60/40", "risk": "Moderate",
     "description": "The classic balanced portfolio: US total market stocks and investment-grade bonds.",
     "holdings": [("VTI", "60"), ("BND", "40")]},
    {"id": "all-weather", "name": "All-Weather", "risk": "Moderate",
     "description": "Diversified across stocks, long and intermediate Treasuries, gold and commodities.",
     "holdings": [("VTI", "30"), ("TLT", "40"), ("IEF", "15"), ("GLD", "7.5"), ("DBC", "7.5")]},
    {"id": "growth-tech", "name": "Growth Tech", "risk": "High",
     "description": "Large-cap growth, information technology and semiconductors.",
     "holdings": [("QQQ", "50"), ("VGT", "30"), ("SMH", "20")]},
    {"id": "dividend", "name": "Dividend Income", "risk": "Moderate",
     "description": "Quality dividend payers and dividend growers.",
     "holdings": [("SCHD", "40"), ("VYM", "30"), ("VIG", "30")]},
    {"id": "global", "name": "Global Diversified", "risk": "Moderate",
     "description": "The whole world in three funds: global stocks, international stocks and global bonds.",
     "holdings": [("VT", "60"), ("VXUS", "20"), ("BNDX", "20")]},
]


def col():
    return get_collection("basket_holdings")


def template(tid: str) -> Optional[Dict]:
    return next((t for t in TEMPLATES if t["id"] == tid), None)


def templates_out() -> List[Dict]:
    out = []
    for t in TEMPLATES:
        out.append({"id": t["id"], "name": t["name"], "risk": t["risk"], "description": t["description"],
                    "holdings": [{"symbol": s, "weight": w, "name": universe.describe(s)["name"]} for s, w in t["holdings"]]})
    return out


def validate_targets(holdings: List[Dict]) -> List[Dict]:
    if not holdings:
        raise orders.OrderError("Add at least one ETF.", "invalid_basket")
    if len(holdings) > MAX_HOLDINGS:
        raise orders.OrderError(f"A basket can hold up to {MAX_HOLDINGS} ETFs.", "invalid_basket")
    out, seen = [], set()
    total = D("0")
    for h in holdings:
        try:
            sym = universe.normalize(str(h["symbol"]), "etf")
        except (universe.UnknownSymbol, ValueError):
            raise orders.OrderError(f"{h.get('symbol')} is not a US-listed ETF.", "invalid_basket")
        if sym in seen:
            raise orders.OrderError(f"{sym} appears twice.", "invalid_basket")
        seen.add(sym)
        w = D(str(h["weight"]))
        if w <= 0:
            raise orders.OrderError("Weights must be positive.", "invalid_basket")
        total += w
        out.append({"symbol": sym, "weight": str(w)})
    if total != 100:
        raise orders.OrderError(f"Weights must add up to 100% (they add up to {total}%).", "invalid_basket")
    return out


def bucket(basket_id) -> str:
    return f"basket:{basket_id}"


def create(user_id: str, name: str, targets: List[Dict], template_id: Optional[str] = None) -> Dict:
    now = datetime.utcnow()
    doc = {"_id": ObjectId(), "user_id": str(user_id), "name": name.strip()[:60] or "My basket",
           "template_id": template_id, "targets": validate_targets(targets), "status": "open",
           "invested_cents": 0, "auto_invest": None, "created_at": now, "updated_at": now}
    col().insert_one(doc)
    return doc


def get(user_id: str, basket_id: str) -> Dict:
    b = col().find_one({"_id": ObjectId(basket_id), "user_id": str(user_id)}) if ObjectId.is_valid(basket_id) else None
    if not b:
        raise orders.OrderError("Basket not found", "not_found", 404)
    return b


def _order(user_id: str, b: Dict, symbol: str, side: str, quote: Dict, notional: Optional[D] = None,
           qty: Optional[D] = None, tag: str = "invest") -> Dict:
    req = OrderRequest(client_order_id=f"bsk-{tag}-{uuid.uuid4()}", symbol=symbol, side=side, type="market", tif="day",
                       notional=notional, qty=qty)
    return orders.place(user_id, req, quote, source="basket", bucket=bucket(b["_id"]), extra={"basket_id": str(b["_id"])})


def invest(user_id: str, basket_id: str, amount: D, quotes: Dict[str, Dict]) -> List[Dict]:
    b = get(user_id, basket_id)
    amount = D(str(amount)).quantize(D("0.01"), rounding=ROUND_DOWN)
    legs = []
    for t in b["targets"]:
        part = (amount * D(t["weight"]) / 100).quantize(D("0.01"), rounding=ROUND_DOWN)
        if part < MIN_ORDER:
            raise orders.OrderError(f"Invest at least ${(MIN_ORDER * 100 / D(t['weight'])).quantize(D('0.01'))} so every "
                                    f"ETF gets the $1 minimum order.", "invalid_qty")
        legs.append((t["symbol"], part))
    st = margin.account_state(user_id)
    if amount > max(D("0"), st.available - st.holds - st.collateral):
        raise orders.OrderError(f"Not enough cash. You have ${max(D('0'), st.available - st.holds):,.2f} available.",
                                "insufficient_buying_power")
    placed = [_order(user_id, b, sym, "buy", quotes[sym], notional=part) for sym, part in legs]
    col().update_one({"_id": b["_id"]}, {"$inc": {"invested_cents": int(amount * 100)},
                                         "$set": {"updated_at": datetime.utcnow(), "status": "open"}})
    return placed


def holdings(user_id: str, basket_id) -> List[Dict]:
    return list(positions.col().find({"user_id": str(user_id), "bucket": bucket(basket_id), "open": True}))


def sell(user_id: str, basket_id: str, percent: D, quotes: Dict[str, Dict]) -> List[Dict]:
    b = get(user_id, basket_id)
    pct = D(str(percent))
    if not (0 < pct <= 100):
        raise orders.OrderError("Choose a percentage between 1 and 100.", "invalid_qty")
    placed = []
    for p in holdings(user_id, b["_id"]):
        q = D(p["qty"]) * pct / 100
        q = q.quantize(D("0.000001"), rounding=ROUND_DOWN) if pct < 100 else D(p["qty"])
        if q > 0 and q * D(str(quotes[p["symbol"]].get("bid") or 0)) >= MIN_ORDER:
            placed.append(_order(user_id, b, p["symbol"], "sell", quotes[p["symbol"]], qty=q, tag="sell"))
    if pct == 100:
        col().update_one({"_id": b["_id"]}, {"$set": {"status": "closed", "auto_invest": None,
                                                     "updated_at": datetime.utcnow()}})
    return placed


def drift(b: Dict, quotes: Dict[str, Dict]) -> Dict:
    """Current vs target weights for a basket."""
    rows, total = [], D("0")
    held = {p["symbol"]: p for p in holdings(b["user_id"], b["_id"])}
    for t in b["targets"]:
        p = held.get(t["symbol"])
        q = quotes.get(t["symbol"]) or {}
        mark = D(str(q.get("last") or q.get("mid") or 0)) or (margin.mark_for(p) if p else D("0"))
        value = D(p["qty"]) * mark if p else D("0")
        basis = D(p["cost_basis"]) if p else D("0")
        rows.append({"symbol": t["symbol"], "target": D(t["weight"]), "value": value, "basis": basis,
                     "qty": D(p["qty"]) if p else D("0"), "mark": mark})
        total += value
    for r in rows:
        r["actual"] = (r["value"] / total * 100) if total else D("0")
        r["drift"] = r["actual"] - r["target"]
    return {"rows": rows, "total": total}


def rebalance(user_id: str, basket_id: str, quotes: Dict[str, Dict]) -> List[Dict]:
    b = get(user_id, basket_id)
    d = drift(b, quotes)
    if d["total"] <= 0:
        raise orders.OrderError("This basket has no holdings to rebalance yet.", "invalid_basket")
    placed = []
    for r in sorted(d["rows"], key=lambda r: r["drift"], reverse=True):     # sells first
        target_value = d["total"] * r["target"] / 100
        diff = target_value - r["value"]
        if abs(diff) < REBALANCE_THRESHOLD or r["mark"] <= 0:
            continue
        if diff < 0:
            q = min(r["qty"], (-diff / r["mark"]).quantize(D("0.000001"), rounding=ROUND_DOWN))
            if q > 0:
                placed.append(_order(user_id, b, r["symbol"], "sell", quotes[r["symbol"]], qty=q, tag="rebalance"))
        else:
            placed.append(_order(user_id, b, r["symbol"], "buy", quotes[r["symbol"]],
                                 notional=diff.quantize(D("0.01"), rounding=ROUND_DOWN), tag="rebalance"))
    return placed


def set_auto_invest(user_id: str, basket_id: str, amount: Optional[D], frequency: Optional[str]) -> Dict:
    b = get(user_id, basket_id)
    if not frequency or not amount:
        col().update_one({"_id": b["_id"]}, {"$set": {"auto_invest": None}})
    else:
        if frequency not in ("weekly", "monthly"):
            raise orders.OrderError("Frequency must be weekly or monthly.", "invalid_schedule")
        nxt = datetime.utcnow() + (timedelta(days=7) if frequency == "weekly" else timedelta(days=30))
        col().update_one({"_id": b["_id"]}, {"$set": {"auto_invest": {
            "amount": str(D(str(amount)).quantize(D("0.01"))), "frequency": frequency, "next_run": nxt}}})
    return get(user_id, basket_id)


def due_auto_invest(now: Optional[datetime] = None) -> List[Dict]:
    now = now or datetime.utcnow()
    return list(col().find({"status": "open", "auto_invest.next_run": {"$lte": now}}))


def mark_auto_run(b: Dict, ok: bool, message: str = "") -> None:
    ai = b["auto_invest"]
    step = timedelta(days=7) if ai["frequency"] == "weekly" else timedelta(days=30)
    col().update_one({"_id": b["_id"]}, {"$set": {"auto_invest.next_run": datetime.utcnow() + step,
                                                 "auto_invest.last_run": datetime.utcnow(),
                                                 "auto_invest.last_result": "ok" if ok else message}})


def serialize(b: Dict, quotes: Dict[str, Dict]) -> Dict:
    d = drift(b, quotes)
    value = d["total"]
    basis = sum((r["basis"] for r in d["rows"]), D("0"))
    pnl = value - basis
    ai = b.get("auto_invest")
    return {
        "id": str(b["_id"]), "name": b["name"], "template_id": b.get("template_id"), "status": b["status"],
        "value": f"{value:.2f}", "cost_basis": f"{basis:.2f}", "pnl": f"{pnl:.2f}",
        "pnl_percent": f"{(pnl / basis * 100):.2f}" if basis else "0.00",
        "invested": f"{b.get('invested_cents', 0) / 100:.2f}",
        "max_drift": f"{max((abs(r['drift']) for r in d['rows']), default=D('0')):.2f}",
        "holdings": [{"symbol": r["symbol"], "target": f"{r['target']:.2f}", "actual": f"{r['actual']:.2f}",
                      "drift": f"{r['drift']:.2f}", "value": f"{r['value']:.2f}", "qty": format(r["qty"].normalize(), "f")}
                     for r in d["rows"]],
        "auto_invest": None if not ai else {"amount": ai["amount"], "frequency": ai["frequency"],
                                            "next_run": ai["next_run"].isoformat() + "Z",
                                            "last_result": ai.get("last_result")},
        "created_at": b["created_at"].isoformat() + "Z",
    }
