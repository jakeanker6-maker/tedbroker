"""Integrity checks used after restarts, by the admin views and by the failure drills.

`reservation_audit(user_id)` explains a user's reserved cash. Every reserved cent must
belong to one of:
  * an open order's cash hold (`orders.reserved_cents`, including holds taken from a copy
    allocation),
  * a live copy allocation's uninvested cash (`copy_links.cash_cents`),
  * a pending withdrawal (net of `withdrawal_hold / withdrawal_release / withdrawal`).
Anything else is a leak. Closed orders that still carry `reserved_cents` are listed too.
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.trading import copy_engine, ledger, orders
from app.trading.models import OPEN_STATUSES

LIVE_LINK = ("active", "paused", "stopping")


def reservation_audit(user_id) -> Dict[str, Any]:
    uid = str(user_id)
    bal = ledger.get_balances(uid)
    open_orders = 0
    leaked: List[str] = []
    for o in orders.orders_col().find({"user_id": uid, "reserved_cents": {"$gt": 0}},
                                      {"status": 1, "reserved_cents": 1}):
        if o["status"] in OPEN_STATUSES:
            open_orders += int(o["reserved_cents"])
        else:
            leaked.append(str(o["_id"]))
    links = sum(int(l.get("cash_cents") or 0) for l in
                copy_engine.links().find({"user_id": uid, "status": {"$in": list(LIVE_LINK)}}, {"cash_cents": 1}))
    withdrawals = sum(int(e["reserved_delta_cents"]) for e in ledger._entries().find(
        {"user_id": uid, "status": "posted", "type": {"$in": ["withdrawal_hold", "withdrawal_release", "withdrawal"]}},
        {"reserved_delta_cents": 1}))
    expected = open_orders + links + withdrawals
    return {
        "ok": expected == bal["reserved_cents"] and not leaked,
        "reserved_cents": bal["reserved_cents"], "expected_cents": expected,
        "difference_cents": bal["reserved_cents"] - expected,
        "parts": {"open_orders": open_orders, "copy_allocations": links, "withdrawals": withdrawals},
        "closed_orders_holding_cash": leaked,
    }


def check_user(user_id) -> Dict[str, Any]:
    """Ledger reconciliation + reservation audit in one report."""
    rec = ledger.reconcile(user_id)
    res = reservation_audit(user_id)
    return {"ok": rec["ok"] and res["ok"], "ledger": rec, "reservations": res}


def check_all(limit: int = 5000) -> Dict[str, Any]:
    """Run `check_user` for every account that has a ledger. Returns only the failures."""
    from app.database import USERS_COLLECTION, get_collection
    bad = []
    n = 0
    for u in get_collection(USERS_COLLECTION).find({"cash_cents": {"$exists": True}}, {"_id": 1}).limit(limit):
        n += 1
        r = check_user(u["_id"])
        if not r["ok"]:
            bad.append({"user_id": str(u["_id"]), **r})
    return {"checked": n, "failures": bad}
