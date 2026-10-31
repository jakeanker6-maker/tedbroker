"""Admin "reset simulated account": put a user's Trading Hub back to a clean state without
touching real-world records.

What it does (under the user's lock, idempotent per reset id):
  1. cancels every open order (holds are released; copy-order holds return to their link),
  2. stops every live copy link and releases its uninvested cash,
  3. closes every open position, basket and option strategy *without* trading
     (they are flagged `closed_reason = "account_reset"`, history stays queryable),
  4. closes open margin calls and clears account-value snapshots,
  5. sets cash back to the user's net funding: deposits, withdrawals, bonuses, admin
     adjustments and managed-plan flows. Trading, copy and fee P&L is reversed with one
     `adjustment` ledger entry, so the ledger stays append-only and reconciles.

Kept as-is: deposit/withdrawal requests (pending withdrawals stay on hold), managed plans,
the ledger history, KYC, settings and the account type.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from bson import ObjectId

from app.trading import baskets, copy_engine, integrity, ledger, multileg, orders, portfolio, positions, risk_monitor
from app.trading.models import OPEN_STATUSES

# cash movements that came from outside the Trading Hub
FUNDING_TYPES = ("opening_balance", "deposit", "withdrawal", "adjustment", "referral_bonus",
                 "plan_invest", "plan_refund", "plan_payout")


def net_funding_cents(user_id: str) -> int:
    return sum(int(e["cash_delta_cents"]) for e in ledger._entries().find(
        {"user_id": str(user_id), "status": "posted", "type": {"$in": list(FUNDING_TYPES)},
         "meta.reset": {"$ne": True}},
        {"cash_delta_cents": 1}))


def reset_account(user_id: str, admin_id: str = "admin", reset_id: str = "") -> Dict[str, Any]:
    uid = str(user_id)
    rid = reset_id or str(ObjectId())
    now = datetime.utcnow()
    done = {"orders_canceled": 0, "copies_stopped": 0, "positions_closed": 0, "baskets_closed": 0,
            "strategies_closed": 0, "margin_calls_closed": 0, "snapshots_deleted": 0, "cash_adjustment": "0.00"}
    ledger.ensure_account(uid)
    with orders.user_lock(uid):
        # copy orders first, so their holds go back to the link before the link is released
        open_orders = sorted(orders.orders_col().find({"user_id": uid, "status": {"$in": list(OPEN_STATUSES)}}),
                             key=lambda o: 0 if o.get("copy_link_id") else 1)
        for o in open_orders:
            orders._finalize(o, "canceled", "account_reset")
            done["orders_canceled"] += 1
        for link in list(copy_engine.links().find({"user_id": uid, "status": {"$in": list(integrity.LIVE_LINK)}})):
            cents = int(copy_engine.links().find_one({"_id": link["_id"]}).get("cash_cents") or 0)
            if cents > 0:
                ledger.release(uid, cents, type="copy_release", idempotency_key=f"copy-reset:{rid}:{link['_id']}",
                               ref_type="copy_link", ref_id=str(link["_id"]),
                               description=f"Account reset - copy of {link.get('trader_name') or 'trader'} closed")
            copy_engine.links().update_one({"_id": link["_id"]}, {"$set": {
                "status": "stopped", "stop_reason": "account_reset", "cash_cents": 0, "final_cash_cents": cents,
                "stopped_at": now, "updated_at": now}})
            done["copies_stopped"] += 1
        done["positions_closed"] = positions.col().update_many(
            {"user_id": uid, "open": True},
            {"$set": {"open": False, "qty": "0", "closed_reason": "account_reset", "closed_at": now}}).modified_count
        done["baskets_closed"] = baskets.col().update_many(
            {"user_id": uid, "status": "open"},
            {"$set": {"status": "closed", "auto_invest": None, "closed_reason": "account_reset", "updated_at": now}}).modified_count
        done["strategies_closed"] = multileg.groups_col().update_many(
            {"user_id": uid, "status": "open"},
            {"$set": {"status": "closed", "closed_reason": "account_reset", "closed_at": now}}).modified_count
        done["margin_calls_closed"] = risk_monitor.calls_col().update_many(
            {"user_id": uid, "status": "open"},
            {"$set": {"status": "met", "resolution": "account_reset", "resolved_at": now}}).modified_count
        done["snapshots_deleted"] = portfolio.snaps().delete_many({"user_id": uid}).deleted_count

        diff = net_funding_cents(uid) - ledger.get_balances(uid)["cash_cents"]
        if diff:
            ledger.post(uid, type="adjustment", idempotency_key=f"account-reset:{rid}", cash_delta_cents=diff,
                        ref_type="admin", ref_id=str(admin_id),
                        description="Account reset: trading results reversed",
                        meta={"reset": True, "reset_id": rid})
        done["cash_adjustment"] = f"{diff / 100:.2f}"
    report = integrity.check_user(uid)
    return {"reset_id": rid, **done, "balances": ledger.get_balances(uid), "integrity_ok": report["ok"],
            "integrity": report}
