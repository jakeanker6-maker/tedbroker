"""Price, % move and order-filled alerts, delivered as in-app notifications (header bell),
live account-stream events and, optionally, email.

Kinds
  price_above   last >= threshold                       one-shot
  price_below   last <= threshold                       one-shot
  pct_move      |change % vs previous close| >= threshold at most once per trading day,
                stays active until deleted
  order_filled  any of the user's orders fills (optionally only one symbol), stays active;
                copy-trading and basket fills are included, system/bot accounts are not

Evaluation: the engine keeps alert symbols streaming and calls `check_quote` for every
quote batch (cheap in-memory test first, then an atomic claim so an alert fires once even
with several workers). Fills call `on_fill` from the order pipeline.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional

from bson import ObjectId
from pymongo import ASCENDING, ReturnDocument

from app.database import NOTIFICATIONS_COLLECTION, USERS_COLLECTION, get_collection
from app.market_data import calendar, universe
from app.trading import events

D = Decimal
KINDS = ("price_above", "price_below", "pct_move", "order_filled")
MAX_ACTIVE = 50


class AlertError(Exception):
    def __init__(self, message: str, code: str = "invalid_alert", status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status


def col():
    return get_collection("alerts")


def ensure_indexes() -> None:
    col().create_index([("user_id", ASCENDING), ("status", ASCENDING)], name="user_status")
    col().create_index([("status", ASCENDING), ("symbol", ASCENDING)], name="status_symbol")


def _today() -> str:
    return datetime.now(calendar.NY).date().isoformat()


def create(user_id: str, kind: str, symbol: Optional[str] = None, threshold=None, email: bool = False,
           note: str = "") -> Dict:
    if kind not in KINDS:
        raise AlertError("Unknown alert type.")
    uid = str(user_id)
    if col().count_documents({"user_id": uid, "status": "active"}) >= MAX_ACTIVE:
        raise AlertError(f"You can have up to {MAX_ACTIVE} active alerts. Delete some first.", "too_many_alerts")
    sym = None
    if symbol:
        try:
            sym = universe.normalize(symbol)
        except Exception:
            raise AlertError(f"Unknown symbol: {symbol}", "unknown_symbol", 404)
    if kind != "order_filled" and not sym:
        raise AlertError("Choose a symbol for this alert.", "symbol_required")
    thr = None
    if kind != "order_filled":
        try:
            thr = D(str(threshold))
        except (InvalidOperation, TypeError):
            raise AlertError("Enter a number for the alert level.", "invalid_threshold")
        if thr <= 0 or (kind == "pct_move" and thr > 100):
            raise AlertError("The alert level must be above 0" + (" and at most 100%." if kind == "pct_move" else "."),
                             "invalid_threshold")
    if kind == "order_filled" and col().find_one({"user_id": uid, "status": "active", "kind": "order_filled", "symbol": sym}):
        raise AlertError("You already have this order-filled alert.", "duplicate_alert", 409)
    now = datetime.utcnow()
    doc = {"_id": ObjectId(), "user_id": uid, "kind": kind, "symbol": sym, "threshold": str(thr) if thr is not None else None,
           "email": bool(email), "note": (note or "").strip()[:140], "status": "active", "created_at": now,
           "updated_at": now, "triggered_at": None, "trigger_value": None, "last_fired_day": None, "fired_count": 0}
    col().insert_one(doc)
    for hook in watchers:
        hook(doc)
    return doc


def delete(user_id: str, alert_id: str) -> None:
    if not ObjectId.is_valid(alert_id):
        raise AlertError("Alert not found", "not_found", 404)
    res = col().update_one({"_id": ObjectId(alert_id), "user_id": str(user_id), "status": {"$ne": "deleted"}},
                           {"$set": {"status": "deleted", "updated_at": datetime.utcnow()}})
    if res.matched_count != 1:
        raise AlertError("Alert not found", "not_found", 404)


def list_for(user_id: str, include_history: bool = True) -> List[Dict]:
    q = {"user_id": str(user_id), "status": {"$in": ["active", "triggered"] if include_history else ["active"]}}
    return list(col().find(q).sort("created_at", -1).limit(200))


def serialize(a: Dict) -> Dict:
    iso = lambda d: d.isoformat() + "Z" if isinstance(d, datetime) else None  # noqa: E731
    return {"id": str(a["_id"]), "kind": a["kind"], "symbol": a.get("symbol"), "threshold": a.get("threshold"),
            "email": a.get("email", False), "note": a.get("note", ""), "status": a["status"],
            "created_at": iso(a.get("created_at")), "triggered_at": iso(a.get("triggered_at")),
            "trigger_value": a.get("trigger_value"), "fired_count": a.get("fired_count", 0),
            "description": describe(a)}


def describe(a: Dict) -> str:
    s, t = a.get("symbol") or "", a.get("threshold")
    if a["kind"] == "price_above":
        return f"{s} at or above ${D(t):,.2f}" if D(t) >= 1 else f"{s} at or above ${t}"
    if a["kind"] == "price_below":
        return f"{s} at or below ${D(t):,.2f}" if D(t) >= 1 else f"{s} at or below ${t}"
    if a["kind"] == "pct_move":
        return f"{s} moves {D(t).normalize():f}% or more in a day"
    return f"Any {s + ' ' if s else ''}order fills".replace("Any  ", "Any ")


# ---------------------------------------------------------------- evaluation
def _pct(quote: Dict) -> Optional[float]:
    last, prev = quote.get("last"), quote.get("prev_close")
    if last is None or not prev:
        return None
    return (float(last) - float(prev)) / float(prev) * 100


def hit(a: Dict, quote: Dict) -> bool:
    """Pure test of a price alert against a quote (no side effects)."""
    if a.get("status") != "active" or a["kind"] == "order_filled":
        return False
    from app.market_data.quotes import is_stale
    if is_stale(quote):
        return False
    last = quote.get("last")
    if last is None:
        return False
    if a["kind"] == "price_above":
        return float(last) >= float(a["threshold"])
    if a["kind"] == "price_below":
        return float(last) <= float(a["threshold"])
    pct = _pct(quote)
    return pct is not None and abs(pct) >= float(a["threshold"]) and a.get("last_fired_day") != _today()


def active_price_alerts() -> List[Dict]:
    return list(col().find({"status": "active", "kind": {"$in": ["price_above", "price_below", "pct_move"]}}))


def check_quote(alerts: List[Dict], quote: Dict) -> List[Dict]:
    """Fire every alert in `alerts` that the quote meets. Returns the fired alert docs."""
    fired = []
    for a in alerts:
        if not hit(a, quote):
            continue
        now = datetime.utcnow()
        value = quote.get("last")
        if a["kind"] == "pct_move":
            claim = col().find_one_and_update(
                {"_id": a["_id"], "status": "active", "last_fired_day": {"$ne": _today()}},
                {"$set": {"last_fired_day": _today(), "triggered_at": now, "trigger_value": f"{_pct(quote):.2f}"},
                 "$inc": {"fired_count": 1}}, return_document=ReturnDocument.AFTER)
        else:
            claim = col().find_one_and_update(
                {"_id": a["_id"], "status": "active"},
                {"$set": {"status": "triggered", "triggered_at": now, "trigger_value": str(value)},
                 "$inc": {"fired_count": 1}}, return_document=ReturnDocument.AFTER)
        if not claim:
            continue
        _deliver(claim, quote=quote)
        fired.append(claim)
    return fired


def on_fill(fill: Dict) -> None:
    """Order-filled alerts. Called after a fill is applied; never raises."""
    try:
        uid = str(fill["user_id"])
        alerts = list(col().find({"user_id": uid, "status": "active", "kind": "order_filled",
                                  "$or": [{"symbol": None}, {"symbol": fill["symbol"]}]}))
        if not alerts:
            return
        if get_collection(NOTIFICATIONS_COLLECTION).find_one({"fill_id": str(fill["_id"])}, {"_id": 1}):
            return   # fill replayed after a restart: already notified
        user = get_collection(USERS_COLLECTION).find_one({"_id": ObjectId(uid)}, {"is_system": 1})
        if user and user.get("is_system"):
            return
        a = alerts[0]   # one notification per fill even if a symbol and an "any" alert both match
        col().update_one({"_id": a["_id"]}, {"$set": {"triggered_at": datetime.utcnow(), "trigger_value": fill["price"]},
                                             "$inc": {"fired_count": 1}})
        _deliver(a, fill=fill)
    except Exception as exc:
        print(f"order-filled alert failed: {exc}")


def _deliver(a: Dict, quote: Optional[Dict] = None, fill: Optional[Dict] = None) -> None:
    sym = a.get("symbol") or (fill or {}).get("symbol", "")
    if fill:
        side = "Bought" if fill.get("is_buy") else "Sold"
        title = f"{side} {fill['qty']} {fill['symbol'].strip()}"
        message = f"Your order filled: {side.lower()} {fill['qty']} {fill['symbol'].strip()} at ${D(fill['price']):,.4f}".rstrip("0").rstrip(".")
        rows = [("Symbol", fill["symbol"].strip()), ("Quantity", str(fill["qty"])), ("Price", f"${D(fill['price']):,.4f}"),
                ("Fees", f"${D(str(fill.get('fee') or 0)):,.2f}")]
    else:
        last = quote.get("last")
        if a["kind"] == "pct_move":
            pct = _pct(quote) or 0.0
            title = f"{sym} {'up' if pct >= 0 else 'down'} {abs(pct):.2f}% today"
        else:
            title = f"{sym} is {'above' if a['kind'] == 'price_above' else 'below'} ${D(a['threshold']):,.2f}"
        message = f"{describe(a)}: last price ${float(last):,.4f}".rstrip("0").rstrip(".")
        rows = [("Symbol", sym), ("Last price", f"${float(last):,.4f}"), ("Alert", describe(a)),
                ("Source", str(quote.get("source", "")))]
    if a.get("note"):
        rows.append(("Your note", a["note"]))
    get_collection(NOTIFICATIONS_COLLECTION).insert_one({
        "title": title, "message": message, "notification_type": "info", "target_type": "specific",
        "target_user_id": a["user_id"], "is_dismissed": False, "created_at": datetime.utcnow(), "source": "alert",
        "alert_id": str(a["_id"]), "fill_id": str(fill["_id"]) if fill else None})
    events.publish(a["user_id"], "alert", {"id": str(a["_id"]), "kind": a["kind"], "symbol": sym, "title": title,
                                           "message": message})
    if a.get("email"):
        _email(a["user_id"], title, message, rows, sym)


def _email(user_id: str, title: str, message: str, rows, symbol: str) -> None:
    try:
        from app import email_templates
        from app.email_service import email_service
        user = get_collection(USERS_COLLECTION).find_one({"_id": ObjectId(user_id)}, {"email": 1, "full_name": 1, "username": 1})
        if not user or not user.get("email"):
            return
        subject, html, text = email_templates.trading_alert(
            user.get("full_name") or user.get("username") or "there", title, message, rows,
            f"/app/trade.html?symbol={symbol}" if symbol else "/app/trade.html")
        email_service.send_email(user["email"], subject, html, text)
    except Exception as exc:
        print(f"alert email failed: {exc}")


# Called with each newly created alert doc (the engine subscribes to its symbol).
watchers: list = []
