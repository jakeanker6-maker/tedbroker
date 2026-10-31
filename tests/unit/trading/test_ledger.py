import threading
from datetime import datetime, timedelta

import pytest
from bson import ObjectId

from app.database import get_collection
from app.trading import funding, ledger


@pytest.fixture
def db(fresh_db):
    ledger.ensure_indexes()
    return fresh_db


def make_user(balance=0.0, **extra):
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": balance, **extra})
    return str(uid)


def user(uid):
    return get_collection("users").find_one({"_id": ObjectId(uid)})


# ------------------------------------------------------------------ money
@pytest.mark.parametrize("amount,cents", [(0, 0), (1, 100), (0.1, 10), (0.005, 1), (19.999, 2000),
                                          ("12.34", 1234), (1000000, 100000000), (0.29, 29)])
def test_to_cents(amount, cents):
    assert ledger.to_cents(amount) == cents


# ------------------------------------------------------------------ accounts
def test_ensure_account_seeds_from_wallet_balance(db):
    uid = make_user(1234.56)
    u = ledger.ensure_account(uid)
    assert (u["cash_cents"], u["reserved_cents"], u["available_cents"]) == (123456, 0, 123456)
    assert ledger.reconcile(uid)["ok"]
    # idempotent
    ledger.ensure_account(uid)
    assert get_collection("ledger_entries").count_documents({"user_id": uid}) == 1


def test_ensure_account_missing_user(db):
    with pytest.raises(ledger.AccountNotFound):
        ledger.ensure_account(ObjectId())


# ------------------------------------------------------------------ postings
def test_credit_and_debit_update_mirror(db):
    uid = make_user(100)
    ledger.credit(uid, 5000, type="deposit", idempotency_key="d1")
    ledger.debit(uid, 2500, type="plan_invest", idempotency_key="p1")
    u = user(uid)
    assert u["cash_cents"] == 12500 and u["wallet_balance"] == 125.0
    assert ledger.reconcile(uid)["ok"]


def test_duplicate_key_is_noop(db):
    uid = make_user(0)
    first = ledger.credit(uid, 1000, type="deposit", idempotency_key="dep:1")
    second = ledger.credit(uid, 1000, type="deposit", idempotency_key="dep:1")
    assert second.get("duplicate") is True and second["_id"] == first["_id"]
    assert user(uid)["cash_cents"] == 1000


def test_debit_cannot_overdraw(db):
    uid = make_user(10)
    with pytest.raises(ledger.InsufficientFunds):
        ledger.debit(uid, 1001, type="plan_invest", idempotency_key="x")
    assert user(uid)["cash_cents"] == 1000
    # failed key is freed for a retry
    assert get_collection("ledger_entries").count_documents({"idempotency_key": "x"}) == 0


def test_reserved_cash_is_not_spendable(db):
    uid = make_user(100)
    ledger.reserve(uid, 8000, type="withdrawal_hold", idempotency_key="h")
    with pytest.raises(ledger.InsufficientFunds):
        ledger.debit(uid, 2001, type="plan_invest", idempotency_key="p")
    ledger.debit(uid, 2000, type="plan_invest", idempotency_key="p")
    u = user(uid)
    assert (u["cash_cents"], u["reserved_cents"], u["available_cents"]) == (8000, 8000, 0)
    assert ledger.reconcile(uid)["ok"]


def test_cannot_release_more_than_reserved(db):
    uid = make_user(100)
    ledger.reserve(uid, 100, type="withdrawal_hold", idempotency_key="h")
    with pytest.raises(ledger.LedgerError):
        ledger.release(uid, 101, type="withdrawal_release", idempotency_key="r")


def test_unknown_type_rejected(db):
    uid = make_user(1)
    with pytest.raises(ledger.LedgerError):
        ledger.credit(uid, 1, type="free_money", idempotency_key="k")


def test_concurrent_debits_never_overdraw(db):
    uid = make_user(100)  # 10_000 cents
    ok, failed = [], []

    def spend(i):
        try:
            ledger.debit(uid, 3000, type="plan_invest", idempotency_key=f"c{i}")
            ok.append(i)
        except ledger.InsufficientFunds:
            failed.append(i)

    threads = [threading.Thread(target=spend, args=(i,)) for i in range(10)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(ok) == 3 and len(failed) == 7
    assert user(uid)["cash_cents"] == 1000
    assert ledger.reconcile(uid)["ok"]


def test_recover_pending(db):
    uid = make_user(0)
    ledger.ensure_account(uid)
    entries = get_collection("ledger_entries")
    old = datetime.utcnow() - timedelta(minutes=5)
    # crashed before the user update: should be dropped
    entries.insert_one({"_id": ObjectId(), "user_id": uid, "type": "deposit", "cash_delta_cents": 500,
                        "reserved_delta_cents": 0, "idempotency_key": "crash1", "status": "pending",
                        "created_at": old})
    # crashed after the user update: should be posted
    applied_id = ObjectId()
    entries.insert_one({"_id": applied_id, "user_id": uid, "type": "deposit", "cash_delta_cents": 700,
                        "reserved_delta_cents": 0, "idempotency_key": "crash2", "status": "pending",
                        "created_at": old})
    get_collection("users").update_one({"_id": ObjectId(uid)}, {
        "$inc": {"cash_cents": 700, "available_cents": 700}, "$push": {"ledger_recent": applied_id}})
    assert ledger.recover_pending() == {"posted": 1, "dropped": 1}
    assert ledger.reconcile(uid)["ok"] and user(uid)["wallet_balance"] == 7.0


# ------------------------------------------------------------------ funding
def test_deposit_credit_is_idempotent(db):
    uid = make_user(0)
    funding.credit_deposit("req1", uid, 250.10, "Bank Transfer")
    funding.credit_deposit("req1", uid, 250.10, "Bank Transfer")
    assert user(uid)["cash_cents"] == 25010


def test_withdrawal_hold_then_settle(db):
    uid = make_user(500)
    funding.hold_withdrawal("w1", uid, 200, "crypto")
    assert funding.withdrawable_cents(uid) == 30000
    funding.settle_withdrawal("w1", uid, 200, "crypto")
    u = user(uid)
    assert (u["cash_cents"], u["reserved_cents"]) == (30000, 0)
    # settle twice is harmless; release after settle is a no-op
    funding.settle_withdrawal("w1", uid, 200, "crypto")
    assert funding.release_withdrawal("w1", uid) is None
    assert user(uid)["cash_cents"] == 30000 and ledger.reconcile(uid)["ok"]


def test_withdrawal_hold_then_release(db):
    uid = make_user(500)
    funding.hold_withdrawal("w2", uid, 200, "bank")
    funding.release_withdrawal("w2", uid)
    funding.release_withdrawal("w2", uid)
    u = user(uid)
    assert (u["cash_cents"], u["reserved_cents"], u["available_cents"]) == (50000, 0, 50000)


def test_withdrawal_hold_requires_funds(db):
    uid = make_user(100)
    with pytest.raises(ledger.InsufficientFunds):
        funding.hold_withdrawal("w3", uid, 100.01, "bank")


def test_legacy_withdrawal_without_hold_debits_available(db):
    uid = make_user(100)
    funding.settle_withdrawal("legacy", uid, 40, "bank")
    assert user(uid)["cash_cents"] == 6000


# ------------------------------------------------------------------ referrals
def test_referral_bonus_credited_through_ledger(db):
    from app.referrals_service import BASE_REFERRAL_BONUS, ReferralsService
    referrer = make_user(0, referral_code="alice", username="alice")
    referred = make_user(0)
    assert ReferralsService.submit_referral("alice", referred)["success"]
    assert user(referrer)["cash_cents"] == ledger.to_cents(BASE_REFERRAL_BONUS)
    assert ledger.find_posted(f"referral:{referred}")["type"] == "referral_bonus"
    assert ledger.reconcile(referrer)["ok"]
