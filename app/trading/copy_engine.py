"""Copy trading on the real engine.

A copy link = a follower allocating cash to one expert trader.
  * allocation: cash moves from the follower's available cash into the link
    (ledger `copy_allocate`, a reservation: equity unchanged, not spendable elsewhere)
  * every expert trader is a system account (see bots.py) trading real prices through the
    same order pipeline (source="bot")
  * when a trader fill happens, a durable `copy_jobs` row is written; the engine processes it
    and places proportional child orders (source="copy") in the follower bucket
    "copy:<link_id>":
        buy  : qty = trader_qty x (link equity / trader equity), within the link's cash
        sell : the same fraction of the follower's bucket position as the trader sold
    stocks/ETFs/crypto are fractional; option children need whole contracts (else skipped)
  * link cash: child buys hold from the link (not the follower's free cash); leftovers and
    sale proceeds return to the link (proceeds are re-reserved); all changes are idempotent
  * pause = no new mirrors; stop = close the bucket at market, then release the cash
    (ledger `copy_release`); an optional stop-loss stops the link automatically
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import ROUND_DOWN, Decimal
from typing import Dict, List, Optional

from bson import ObjectId
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from app.database import TRADERS_COLLECTION, USERS_COLLECTION, get_collection
from app.market_data.bus import bus
from app.trading import instruments, ledger, margin, positions
from app.trading import options as opt

D = Decimal
ACTIVE = ("active", "paused", "stopping")
RECENT_APPLIED = 400


class CopyError(Exception):
    def __init__(self, message: str, code: str = "copy_error", status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status


def links():
    return get_collection("copy_links")


def jobs():
    return get_collection("copy_jobs")


def traders():
    return get_collection(TRADERS_COLLECTION)


def ensure_indexes() -> None:
    links().create_index([("user_id", ASCENDING), ("status", ASCENDING)], name="user_status")
    links().create_index([("trader_id", ASCENDING), ("status", ASCENDING)], name="trader_status")
    jobs().create_index([("fill_id", ASCENDING)], unique=True, name="uniq_fill")
    jobs().create_index([("status", ASCENDING)], name="status")


def bucket(link_id) -> str:
    return f"copy:{link_id}"


def link_id_from_bucket(b: str) -> Optional[str]:
    return b.split(":", 1)[1] if b and b.startswith("copy:") else None


# ------------------------------------------------------------------ link cash (idempotent)
def _link_inc(link_id, cents: int, key: str) -> bool:
    """Adjust a link's cash once per key. Returns False if already applied."""
    res = links().update_one({"_id": ObjectId(str(link_id)), "applied": {"$ne": key}},
                             {"$inc": {"cash_cents": int(cents)},
                              "$push": {"applied": {"$each": [key], "$slice": -RECENT_APPLIED}},
                              "$set": {"updated_at": datetime.utcnow()}})
    return res.modified_count == 1


def hold_for_order(link_id: str, cents: int, order_id) -> None:
    """Move cash from the link to an order's hold. Both live inside the user's reserved
    balance, so the ledger does not change. Raises CopyError if the link is short."""
    key = f"hold:{order_id}"
    res = links().update_one({"_id": ObjectId(link_id), "cash_cents": {"$gte": int(cents)}, "applied": {"$ne": key}},
                             {"$inc": {"cash_cents": -int(cents)},
                              "$push": {"applied": {"$each": [key], "$slice": -RECENT_APPLIED}}})
    if res.modified_count != 1:
        if links().count_documents({"_id": ObjectId(link_id), "applied": key}):
            return
        raise CopyError("Not enough cash in this copy allocation.", "insufficient_buying_power")


def return_leftover(order: Dict, cents: int) -> None:
    """An order's unused hold goes back to its link (instead of to the follower's free cash)."""
    if cents > 0:
        _link_inc(order["copy_link_id"], cents, f"leftover:{order['_id']}")


def after_fill(fill: Dict) -> None:
    """Called by orders.apply_fill for every applied fill."""
    if fill.get("source") == "bot":
        enqueue(fill)
        _record_trader_trade(fill)
        return
    link_id = link_id_from_bucket(fill.get("bucket", ""))
    if not link_id:
        return
    if not fill["is_buy"] and fill["cash_delta_cents"] > 0:
        # sale proceeds stay in the copy allocation: re-reserve them into the link
        proceeds = int(fill["cash_delta_cents"])
        try:
            ledger.reserve(fill["user_id"], proceeds, type="copy_allocate", idempotency_key=f"copy-proceeds:{fill['_id']}",
                           ref_type="copy_link", ref_id=link_id, description="Sale proceeds kept in copy allocation")
        except ledger.LedgerError:
            return
        _link_inc(link_id, proceeds, f"proceeds:{fill['_id']}")


# ------------------------------------------------------------------ balance check
def copy_imbalances() -> List[Dict]:
    """Accounts whose reserved cash does not equal the cash held in their copy links.
    Every link's cash is reserved on the ledger (allocate reserves it), so the two must match."""
    users_col = get_collection(USERS_COLLECTION)
    out = []
    for uid in links().distinct("user_id"):
        try:
            user = users_col.find_one({"_id": ObjectId(uid)}) or {}
        except Exception:
            continue
        link_cash = sum(int(l.get("cash_cents", 0)) for l in links().find({"user_id": uid}))
        reserved = int(user.get("reserved_cents", 0))
        if link_cash != reserved:
            out.append({"user_id": uid, "reserved_cents": reserved, "link_cash_cents": link_cash,
                        "gap_cents": link_cash - reserved})
    return out


# ------------------------------------------------------------------ links
def trader_doc(trader_id: str) -> Dict:
    t = traders().find_one({"_id": ObjectId(trader_id)}) if ObjectId.is_valid(trader_id) else None
    if not t:
        raise CopyError("Trader not found", "not_found", 404)
    return t


def link_equity(link: Dict) -> D:
    total = D(int(link.get("cash_cents", 0))) / 100
    for p in positions.col().find({"user_id": link["user_id"], "bucket": bucket(link["_id"]), "open": True}):
        total += D(p["qty"]) * margin.mark_for(p) * int(p.get("multiplier", 1))
    from app.trading.orders import orders_col
    from app.trading.models import OPEN_STATUSES
    for o in orders_col().find({"copy_link_id": str(link["_id"]), "status": {"$in": list(OPEN_STATUSES)}},
                               {"reserved_cents": 1}):
        total += D(int(o.get("reserved_cents") or 0)) / 100      # cash held by open child orders
    return total


def get_link(user_id: str, link_id: str) -> Dict:
    l = links().find_one({"_id": ObjectId(link_id), "user_id": str(user_id)}) if ObjectId.is_valid(link_id) else None
    if not l:
        raise CopyError("Copy relationship not found", "not_found", 404)
    return l


def create_link(user_id: str, trader_id: str, amount: D, stop_loss_pct: Optional[D] = None) -> Dict:
    from app.trading.orders import user_lock
    t = trader_doc(trader_id)
    if not t.get("system_user_id"):
        raise CopyError("This trader is not trading yet. Try again in a moment.", "trader_unavailable", 409)
    minimum = D(str(t.get("minimum_copy_amount") or 0))
    amount = D(str(amount)).quantize(D("0.01"), rounding=ROUND_DOWN)
    if amount < max(minimum, D("10")):
        raise CopyError(f"The minimum to copy {t['full_name']} is ${max(minimum, D('10')):,.2f}.", "below_minimum")
    with user_lock(user_id):
        if links().find_one({"user_id": str(user_id), "trader_id": str(trader_id), "status": {"$in": list(ACTIVE)}}):
            raise CopyError(f"You are already copying {t['full_name']}.", "already_copying", 409)
        st = margin.account_state(user_id)
        free = st.available - st.holds - st.collateral
        if amount > free:
            raise CopyError(f"Not enough cash. You have ${max(free, D('0')):,.2f} available to allocate.",
                            "insufficient_buying_power")
        now = datetime.utcnow()
        link = {"_id": ObjectId(), "user_id": str(user_id), "trader_id": str(trader_id),
                "trader_user_id": t["system_user_id"], "trader_name": t["full_name"], "status": "active",
                "allocated_cents": 0, "cash_cents": 0, "stop_loss_pct": str(stop_loss_pct) if stop_loss_pct else None,
                "applied": [], "created_at": now, "updated_at": now}
        links().insert_one(link)
        allocate(user_id, str(link["_id"]), amount)
    _sync_user(user_id, trader_id)
    return get_link(user_id, str(link["_id"]))


def allocate(user_id: str, link_id: str, amount: D) -> Dict:
    """Add cash to a link."""
    cents = int(D(str(amount)) * 100)
    if cents <= 0:
        raise CopyError("Enter an amount to add.", "invalid_amount")
    key = f"alloc:{ObjectId()}"
    try:
        ledger.reserve(user_id, cents, type="copy_allocate", idempotency_key=f"copy-{key}:{link_id}",
                       ref_type="copy_link", ref_id=link_id, description="Funds allocated to copy trading")
    except ledger.InsufficientFunds as exc:
        raise CopyError(f"Not enough cash. You have ${exc.available_cents / 100:,.2f} available.", "insufficient_buying_power")
    _link_inc(link_id, cents, key)
    links().update_one({"_id": ObjectId(link_id)}, {"$inc": {"allocated_cents": cents}})
    return links().find_one({"_id": ObjectId(link_id)})


def withdraw_from_link(user_id: str, link_id: str, amount: D) -> Dict:
    """Move unused link cash back to the follower's free cash."""
    from app.trading.orders import user_lock
    cents = int(D(str(amount)) * 100)
    with user_lock(user_id):
        link = get_link(user_id, link_id)
        if cents <= 0 or cents > int(link.get("cash_cents", 0)):
            raise CopyError(f"You can withdraw up to ${int(link.get('cash_cents', 0)) / 100:,.2f} of unused cash from "
                            "this copy. Positions stay open.", "invalid_amount")
        key = f"withdraw:{ObjectId()}"
        res = links().update_one({"_id": link["_id"], "cash_cents": {"$gte": cents}},
                                 {"$inc": {"cash_cents": -cents, "allocated_cents": -cents},
                                  "$push": {"applied": {"$each": [key], "$slice": -RECENT_APPLIED}}})
        if res.modified_count != 1:
            raise CopyError("The copy's cash changed; try again.", "conflict", 409)
        ledger.release(user_id, cents, type="copy_release", idempotency_key=f"copy-{key}:{link_id}",
                       ref_type="copy_link", ref_id=link_id, description="Funds returned from copy trading")
    _sync_user(user_id, link["trader_id"])
    return get_link(user_id, link_id)


def set_status(user_id: str, link_id: str, status: str) -> Dict:
    link = get_link(user_id, link_id)
    if link["status"] not in ("active", "paused"):
        raise CopyError(f"This copy is {link['status']}.", "not_active", 409)
    if status not in ("active", "paused"):
        raise CopyError("Status must be active or paused.", "invalid_status")
    links().update_one({"_id": link["_id"]}, {"$set": {"status": status, "updated_at": datetime.utcnow()}})
    return get_link(user_id, link_id)


def stop(user_id: str, link_id: str, reason: str = "user") -> Dict:
    """Close every position in the copy bucket at market; cash is released once flat."""
    from app.trading import orders
    from app.trading.models import OPEN_STATUSES, OrderRequest
    with orders.user_lock(user_id):
        link = get_link(user_id, link_id)
        if link["status"] in ("stopped",):
            return link
        links().update_one({"_id": link["_id"]}, {"$set": {"status": "stopping", "stop_reason": reason,
                                                          "updated_at": datetime.utcnow()}})
        for o in orders.orders_col().find({"copy_link_id": link_id, "status": {"$in": list(OPEN_STATUSES)}}):
            orders._finalize(o, "canceled", "copy_stopped")
        for p in positions.col().find({"user_id": user_id, "bucket": bucket(link_id), "open": True}):
            qty = D(p["qty"])
            if qty <= 0:
                continue
            quote = bus.get(p["symbol"])
            if not quote:
                continue
            side = "sell_to_close" if p["asset_class"] == "option" else "sell"
            try:
                orders.place(user_id, OrderRequest(client_order_id=f"copystop-{p['_id']}-{link_id}", symbol=p["symbol"],
                                                   side=side, qty=qty, type="market",
                                                   tif="gtc" if p["asset_class"] == "crypto" else "day"),
                             quote, source="copy", bucket=bucket(link_id),
                             extra={"copy_link_id": link_id, "trader_id": link["trader_id"]})
            except orders.OrderError as exc:
                print(f"copy stop: could not close {p['symbol']}: {exc}")
    finish_stops(link_id)
    return get_link(user_id, link_id)


def finish_stops(link_id: Optional[str] = None) -> int:
    """Release the cash of stopping links that are flat. Called after stop and by the engine."""
    from app.trading import orders
    from app.trading.models import OPEN_STATUSES
    q = {"status": "stopping"}
    if link_id:
        q["_id"] = ObjectId(link_id)
    n = 0
    for link in list(links().find(q)):
        lid = str(link["_id"])
        flat = not positions.col().count_documents({"user_id": link["user_id"], "bucket": bucket(lid), "open": True})
        busy = orders.orders_col().count_documents({"copy_link_id": lid, "status": {"$in": list(OPEN_STATUSES)}})
        if not flat or busy:
            continue
        with orders.user_lock(link["user_id"]):
            fresh = links().find_one({"_id": link["_id"]})
            cents = int(fresh.get("cash_cents", 0))
            if cents > 0:
                ledger.release(link["user_id"], cents, type="copy_release", idempotency_key=f"copy-final:{lid}",
                               ref_type="copy_link", ref_id=lid, description=f"Stopped copying {link.get('trader_name')}")
            links().update_one({"_id": link["_id"]}, {"$set": {"status": "stopped", "cash_cents": 0,
                                                              "final_cash_cents": cents, "stopped_at": datetime.utcnow()}})
        _sync_user(link["user_id"], link["trader_id"])
        n += 1
    return n


def check_stop_losses() -> int:
    n = 0
    for link in list(links().find({"status": {"$in": ["active", "paused"]}, "stop_loss_pct": {"$ne": None}})):
        alloc = D(int(link.get("allocated_cents", 0))) / 100
        if alloc <= 0:
            continue
        loss_pct = (alloc - link_equity(link)) / alloc * 100
        if loss_pct >= D(link["stop_loss_pct"]):
            stop(link["user_id"], str(link["_id"]), reason="stop_loss")
            n += 1
    return n


def _sync_user(user_id: str, trader_id: str) -> None:
    """Keep legacy fields used by existing pages consistent: selected_traders and copiers."""
    active = links().count_documents({"user_id": str(user_id), "trader_id": str(trader_id), "status": {"$in": ["active", "paused"]}})
    users = get_collection(USERS_COLLECTION)
    if active:
        users.update_one({"_id": ObjectId(user_id)}, {"$addToSet": {"selected_traders": str(trader_id)}})
    else:
        users.update_one({"_id": ObjectId(user_id)}, {"$pull": {"selected_traders": str(trader_id)}})
    total = sum(int(l.get("allocated_cents", 0)) for l in links().find({"user_id": str(user_id), "status": {"$in": list(ACTIVE)}}))
    users.update_one({"_id": ObjectId(user_id)}, {"$set": {"copy_trading_allocation": total / 100}})
    copiers = links().count_documents({"trader_id": str(trader_id), "status": {"$in": ["active", "paused"]}})
    traders().update_one({"_id": ObjectId(trader_id)}, {"$set": {"copiers": copiers}})


def migrate_selected(user_id: str) -> int:
    """One-time: turn the old users.selected_traders list into real copy links (allocating the
    trader's minimum when the follower has the cash; otherwise a paused link with no funds)."""
    users = get_collection(USERS_COLLECTION)
    user = users.find_one({"_id": ObjectId(user_id)})
    if not user or user.get("copy_links_migrated"):
        return 0
    n = 0
    for tid in user.get("selected_traders", []) or []:
        try:
            t = trader_doc(tid)
        except CopyError:
            continue
        if not t.get("system_user_id") or links().find_one({"user_id": str(user_id), "trader_id": tid, "status": {"$in": list(ACTIVE)}}):
            continue
        minimum = D(str(t.get("minimum_copy_amount") or 100))
        try:
            create_link(str(user_id), tid, minimum)
        except CopyError:
            now = datetime.utcnow()
            links().insert_one({"_id": ObjectId(), "user_id": str(user_id), "trader_id": tid,
                                "trader_user_id": t["system_user_id"], "trader_name": t["full_name"],
                                "status": "paused", "allocated_cents": 0, "cash_cents": 0, "stop_loss_pct": None,
                                "applied": [], "created_at": now, "updated_at": now,
                                "note": "Migrated from your earlier selection. Add funds to start copying."})
        n += 1
    users.update_one({"_id": ObjectId(user_id)}, {"$set": {"copy_links_migrated": True}})
    return n


# ------------------------------------------------------------------ mirroring
def enqueue(fill: Dict) -> None:
    try:
        jobs().insert_one({"fill_id": fill["_id"], "trader_user_id": fill["user_id"], "status": "pending",
                           "created_at": datetime.utcnow()})
    except DuplicateKeyError:
        pass


def _trader_for_user(trader_user_id: str) -> Optional[Dict]:
    return traders().find_one({"system_user_id": str(trader_user_id)})


def process_job(job: Dict) -> Dict:
    """Mirror one trader fill to every active link. Idempotent per (fill, link)."""
    from app.trading import orders
    from app.trading.models import OrderRequest
    fill = orders.fills_col().find_one({"_id": job["fill_id"]})
    out = {"placed": 0, "skipped": 0}
    if not fill or fill.get("status") != "applied":
        jobs().update_one({"_id": job["_id"]}, {"$set": {"status": "skipped", "note": "fill not applied"}})
        return out
    trader = _trader_for_user(fill["user_id"])
    if not trader:
        jobs().update_one({"_id": job["_id"]}, {"$set": {"status": "skipped", "note": "no trader"}})
        return out
    trader_eq = margin.account_state(fill["user_id"]).equity
    t_qty = D(fill["qty"])
    ac, symbol = fill["asset_class"], fill["symbol"]
    quote = bus.get(symbol) or {"symbol": symbol, "asset_class": ac, "bid": float(fill["price"]), "ask": float(fill["price"]),
                                "last": float(fill["price"]), "mid": float(fill["price"]), "ts": datetime.utcnow().timestamp(),
                                "source": "trader fill", "spread_model": "synthetic"}
    # trader position size before this fill, for proportional sells
    t_pos_after = positions.open_qty(fill["user_id"], symbol, "self")
    t_pos_before = t_pos_after + t_qty if not fill["is_buy"] else t_pos_after - t_qty
    for link in list(links().find({"trader_user_id": fill["user_id"], "status": "active"})):
        lid = str(link["_id"])
        b = bucket(lid)
        if fill["is_buy"]:
            if trader_eq <= 0:
                continue
            ratio = link_equity(link) / trader_eq
            qty = t_qty * ratio
            price = D(str(quote.get("ask") or fill["price"]))
            budget = D(int(link.get("cash_cents", 0))) / 100 * D("0.97")    # keep room for slippage/fees
            mult = instruments.multiplier(ac)
            if qty * price * mult > budget:
                qty = budget / (price * mult)
            side = "buy_to_open" if ac == "option" else "buy"
        else:
            held = positions.open_qty(link["user_id"], symbol, b)
            if held <= 0 or t_pos_before <= 0:
                continue
            frac = min(D("1"), t_qty / t_pos_before)
            qty = held if frac >= 1 else held * frac
            side = "sell_to_close" if ac == "option" else "sell"
        qty = instruments.round_qty(qty, ac)
        if qty <= 0 or (ac != "option" and qty * D(str(quote.get("last") or fill["price"])) < D("1")):
            out["skipped"] += 1
            continue
        try:
            orders.place(link["user_id"], OrderRequest(
                client_order_id=f"copy-{fill['_id']}-{lid}", symbol=symbol, side=side, qty=qty, type="market",
                tif="gtc" if ac == "crypto" else "day"), quote, source="copy", bucket=b,
                extra={"copy_link_id": lid, "trader_id": link["trader_id"], "parent_fill_id": str(fill["_id"]),
                       "parent_order_id": str(fill["order_id"])})
            out["placed"] += 1
        except orders.OrderError as exc:
            out["skipped"] += 1
            links().update_one({"_id": link["_id"]}, {"$set": {"last_skip": {"at": datetime.utcnow(), "symbol": symbol,
                                                                          "reason": str(exc)}}})
        except CopyError as exc:
            out["skipped"] += 1
            links().update_one({"_id": link["_id"]}, {"$set": {"last_skip": {"at": datetime.utcnow(), "symbol": symbol,
                                                                          "reason": str(exc)}}})
    jobs().update_one({"_id": job["_id"]}, {"$set": {"status": "done", "result": out, "done_at": datetime.utcnow()}})
    return out


def pending_jobs(limit: int = 50) -> List[Dict]:
    return list(jobs().find({"status": "pending"}).sort("created_at", 1).limit(limit))


def _record_trader_trade(fill: Dict) -> None:
    """Keep expert_traders.recent_trades filled with the bot's real executions (shown on the
    existing copy-traders page)."""
    from app.market_data import universe
    try:
        info = universe.describe(fill["symbol"])
    except Exception:
        info = {"exchange": "", "name": fill["symbol"]}
    trade = {"symbol": opt.friendly_name(fill["symbol"]) if fill["asset_class"] == "option" else fill["symbol"],
             "exchange": info.get("exchange") or "TED Brokers",
             "side": "long" if fill["is_buy"] else "short", "order_type": "market",
             "entry_price": float(fill["price"]), "notional_value": float(D(fill["gross"])), "leverage": 1.0,
             "timestamp": fill["ts"].isoformat() + "Z"}
    traders().update_one({"system_user_id": fill["user_id"]},
                         {"$push": {"recent_trades": {"$each": [trade], "$position": 0, "$slice": 20}}})


# ------------------------------------------------------------------ views
def serialize(link: Dict) -> Dict:
    eq = link_equity(link) if link["status"] in ACTIVE else D(int(link.get("final_cash_cents", 0))) / 100
    alloc = D(int(link.get("allocated_cents", 0))) / 100
    pnl = eq - alloc if link["status"] in ACTIVE else D(int(link.get("final_cash_cents", 0))) / 100 - alloc
    return {
        "id": str(link["_id"]), "trader_id": link["trader_id"], "trader_name": link.get("trader_name"),
        "status": link["status"], "allocated": f"{alloc:.2f}", "cash": f"{int(link.get('cash_cents', 0)) / 100:.2f}",
        "equity": f"{eq:.2f}", "pnl": f"{pnl:.2f}", "pnl_percent": f"{(pnl / alloc * 100):.2f}" if alloc else "0.00",
        "stop_loss_pct": link.get("stop_loss_pct"), "bucket": bucket(link["_id"]),
        "positions": positions.col().count_documents({"user_id": link["user_id"], "bucket": bucket(link["_id"]), "open": True}),
        "last_skip": ({"at": link["last_skip"]["at"].isoformat() + "Z", "symbol": link["last_skip"]["symbol"],
                       "reason": link["last_skip"]["reason"]} if link.get("last_skip") else None),
        "note": link.get("note"), "created_at": link["created_at"].isoformat() + "Z",
        "stopped_at": link["stopped_at"].isoformat() + "Z" if link.get("stopped_at") else None,
    }


def labels_for(user_id: str) -> Dict[str, str]:
    """bucket -> "Copying <trader>" for the portfolio views."""
    return {bucket(l["_id"]): f"Copying {l.get('trader_name', 'trader')}"
            for l in links().find({"user_id": str(user_id)}, {"trader_name": 1})}


def cash_by_bucket(user_id: str) -> Dict[str, D]:
    out = {}
    for l in links().find({"user_id": str(user_id), "status": {"$in": list(ACTIVE)}}, {"cash_cents": 1}):
        out[bucket(l["_id"])] = D(int(l.get("cash_cents", 0))) / 100
    return out
