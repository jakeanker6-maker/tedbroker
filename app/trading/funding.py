"""Bridge between the existing deposit/withdrawal flow and the ledger.

The user-facing flow is unchanged:
  deposit:    request -> admin approve -> credit_deposit()
  withdrawal: request -> hold_withdrawal() -> code verified -> admin approve
              -> settle_withdrawal()   (or reject/expire/fail -> release_withdrawal())

Holding funds when the request is made means the same cash cannot also be spent
on a trade or a second withdrawal while the admin reviews it.
Idempotency keys are derived from the request id, so double clicks are harmless.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from app.trading import ledger


def credit_deposit(request_id: str, user_id: str, amount: float, method: str) -> Dict[str, Any]:
    return ledger.credit(
        user_id, ledger.to_cents(amount), type="deposit",
        idempotency_key=f"deposit:{request_id}",
        ref_type="deposit_request", ref_id=str(request_id),
        description=f"Deposit - {method}",
    )


def hold_withdrawal(request_id: str, user_id: str, amount: float, method: str) -> Dict[str, Any]:
    return ledger.reserve(
        user_id, ledger.to_cents(amount), type="withdrawal_hold",
        idempotency_key=f"wd-hold:{request_id}",
        ref_type="withdrawal_request", ref_id=str(request_id),
        description=f"Funds held for withdrawal - {method}",
    )


def _hold(request_id: str) -> Optional[Dict[str, Any]]:
    return ledger.find_posted(f"wd-hold:{request_id}")


def release_withdrawal(request_id: str, user_id: str, reason: str = "rejected") -> Optional[Dict[str, Any]]:
    """Release the held funds, if any were held and not already settled/released."""
    hold = _hold(request_id)
    if not hold:
        return None
    if ledger.find_posted(f"wd-settle:{request_id}"):
        return None
    return ledger.release(
        user_id, int(hold["reserved_delta_cents"]), type="withdrawal_release",
        idempotency_key=f"wd-release:{request_id}",
        ref_type="withdrawal_request", ref_id=str(request_id),
        description=f"Withdrawal {reason} - funds released",
    )


def settle_withdrawal(request_id: str, user_id: str, amount: float, method: str) -> Dict[str, Any]:
    """Pay out the withdrawal. Uses the hold when one exists (requests created after
    the ledger went live); otherwise debits available cash (older pending requests)."""
    hold = _hold(request_id)
    kw = dict(type="withdrawal", idempotency_key=f"wd-settle:{request_id}",
              ref_type="withdrawal_request", ref_id=str(request_id),
              description=f"Withdrawal - {method}")
    if hold and not ledger.find_posted(f"wd-release:{request_id}"):
        return ledger.settle_reserved(user_id, int(hold["reserved_delta_cents"]), **kw)
    return ledger.debit(user_id, ledger.to_cents(amount), **kw)


def pay_for_plan(user_id: str, investment_id: str, amount: float, plan_name: str) -> Dict[str, Any]:
    """Debit a managed-plan purchase. Raises ledger.InsufficientFunds."""
    return ledger.debit(
        user_id, ledger.to_cents(amount), type="plan_invest",
        idempotency_key=f"plan-invest:{investment_id}",
        ref_type="user_investment", ref_id=str(investment_id),
        description=f"Investment in {plan_name}",
    )


def refund_plan(user_id: str, investment_id: str, amount: float, plan_name: str) -> Dict[str, Any]:
    """Compensating credit if recording the investment fails after the debit."""
    return ledger.credit(
        user_id, ledger.to_cents(amount), type="plan_refund",
        idempotency_key=f"plan-refund:{investment_id}",
        ref_type="user_investment", ref_id=str(investment_id),
        description=f"Refund - {plan_name}",
    )


def expire_stale_withdrawals(user_id: Optional[str] = None) -> int:
    """Release holds for requests whose verification code expired unused.

    Expired requests are moved to status "expired". Runs lazily on balance reads
    and from the periodic maintenance loop.
    """
    from datetime import datetime
    from app.database import WITHDRAWAL_REQUESTS_COLLECTION, TRANSACTIONS_COLLECTION, get_collection
    from bson import ObjectId

    wrs = get_collection(WITHDRAWAL_REQUESTS_COLLECTION)
    q: Dict[str, Any] = {"status": "pending_verification", "code_expires_at": {"$lt": datetime.utcnow()}}
    if user_id:
        q["user_id"] = str(user_id)
    count = 0
    for req in list(wrs.find(q).limit(200)):
        moved = wrs.update_one({"_id": req["_id"], "status": "pending_verification"},
                               {"$set": {"status": "expired", "updated_at": datetime.utcnow()}})
        if moved.modified_count != 1:
            continue
        release_withdrawal(str(req["_id"]), req["user_id"], "expired")
        if req.get("transaction_id"):
            get_collection(TRANSACTIONS_COLLECTION).update_one(
                {"_id": ObjectId(req["transaction_id"]), "status": "pending"},
                {"$set": {"status": "failed", "description": "Withdrawal expired - code not verified",
                          "updated_at": datetime.utcnow()}})
        count += 1
    return count


def unsettled_proceeds_cents(user_id: str) -> int:
    """Sale proceeds that have not settled yet (stocks/options settle T+1; crypto at once).
    They can buy securities right away but cannot be withdrawn until settlement."""
    from datetime import datetime
    from app.database import LEDGER_ENTRIES_COLLECTION, get_collection
    total = 0
    for e in get_collection(LEDGER_ENTRIES_COLLECTION).find(
            {"user_id": str(user_id), "status": "posted", "type": {"$in": ["trade_sell", "exercise"]},
             "cash_delta_cents": {"$gt": 0}, "meta.settles_at": {"$gt": datetime.utcnow()}},
            {"cash_delta_cents": 1}):
        total += int(e["cash_delta_cents"])
    return total


def withdrawable_cents(user_id: str) -> int:
    """Cash that can leave the account.

    Cash account:   available cash - unsettled sale proceeds - option collateral.
    Margin account: the smaller of that and excess equity (equity - initial requirement),
                    so borrowed money and short-sale proceeds cannot be withdrawn;
                    nothing while a margin call is open.
    """
    from decimal import Decimal
    from app.trading import margin, risk_monitor
    available = ledger.get_balances(user_id)["available_cents"]
    cash_limit = available - unsettled_proceeds_cents(user_id)
    user = ledger.ensure_account(user_id)
    try:
        st = margin.account_state(user_id)
    except Exception:
        return max(0, cash_limit)
    cash_limit -= int(st.collateral * 100) + int(st.holds * 100)
    if margin.account_type(user) == "margin":
        if risk_monitor.has_open_call(user_id):
            return 0
        cash_limit = min(cash_limit, int((st.equity - st.initial_req - st.holds) * 100))
    return max(0, cash_limit)
