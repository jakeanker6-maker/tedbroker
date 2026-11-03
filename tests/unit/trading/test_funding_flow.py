"""End-to-end tests of the existing deposit / withdrawal / plan / admin-balance flows
now that they post through the unified ledger."""
from datetime import datetime, timedelta

import pytest
from bson import ObjectId

from app.auth import create_access_token, get_password_hash
from app.database import get_collection
from app.trading import ledger


@pytest.fixture(autouse=True)
def no_email(monkeypatch):
    from app.email_service import email_service
    monkeypatch.setattr(email_service, "send_email", lambda *a, **k: True)


@pytest.fixture
def env(fresh_db, client):
    ledger.ensure_indexes()
    admin_id = ObjectId()
    get_collection("admins").insert_one({
        "_id": admin_id, "username": "adm", "email": "adm@t.io", "full_name": "Adm", "role": "admin",
        "is_active": True, "created_at": None, "last_login": None,
        "hashed_password": get_password_hash("x" * 10)})
    uid = ObjectId()
    get_collection("users").insert_one({
        "_id": uid, "username": "u", "email": "u@t.io", "full_name": "U", "wallet_balance": 1000.0,
        "hashed_password": get_password_hash("pw-123456"), "is_active": True, "access_granted": True})
    admin = {"Authorization": "Bearer " + create_access_token({"sub": "adm", "user_id": str(admin_id), "role": "admin"})}
    user = {"Authorization": "Bearer " + create_access_token({"sub": "u@t.io", "user_id": str(uid), "role": "user"})}
    return client, admin, user, str(uid)


def cash(uid):
    return ledger.get_balances(uid)


def bal(client, user):
    r = client.get("/api/wallet/balance", headers=user)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------- deposits
def test_deposit_approval_credits_once(env):
    client, admin, user, uid = env
    r = client.post("/api/wallet/deposit", headers=user, json={"amount": 250.5, "payment_method": "Bank Transfer"})
    assert r.status_code == 200, r.text
    req = get_collection("deposit_requests").find_one({"user_id": uid})
    assert req["transaction_id"] == r.json()["transaction"]["id"]
    assert bal(client, user)["balance"] == 1000.0

    ok = client.put(f"/api/admin/deposit-requests/{req['_id']}/approve", headers=admin)
    assert ok.status_code == 200, ok.text
    again = client.put(f"/api/admin/deposit-requests/{req['_id']}/approve", headers=admin)
    assert again.status_code == 400
    b = bal(client, user)
    assert b["balance"] == 1250.5 and b["buying_power"] == 1250.5
    assert get_collection("transactions").find_one({"_id": ObjectId(req["transaction_id"])})["status"] == "approved"
    assert ledger.reconcile(uid)["ok"]


def test_deposit_approval_updates_the_right_transaction(env):
    """Two identical pending deposits: approving the second must not touch the first."""
    client, admin, user, uid = env
    first = client.post("/api/wallet/deposit", headers=user, json={"amount": 100, "payment_method": "Bank Transfer"}).json()
    second = client.post("/api/wallet/deposit", headers=user, json={"amount": 100, "payment_method": "Bank Transfer"}).json()
    req2 = get_collection("deposit_requests").find_one({"transaction_id": second["transaction"]["id"]})
    client.put(f"/api/admin/deposit-requests/{req2['_id']}/approve", headers=admin)
    txns = get_collection("transactions")
    assert txns.find_one({"_id": ObjectId(first["transaction"]["id"])})["status"] == "pending"
    assert txns.find_one({"_id": ObjectId(second["transaction"]["id"])})["status"] == "approved"


def test_deposit_rejection_posts_nothing(env):
    client, admin, user, uid = env
    client.post("/api/wallet/deposit", headers=user, json={"amount": 75, "payment_method": "Bank Transfer"})
    req = get_collection("deposit_requests").find_one({"user_id": uid})
    assert client.put(f"/api/admin/deposit-requests/{req['_id']}/reject", headers=admin).status_code == 200
    assert bal(client, user)["balance"] == 1000.0


# --------------------------------------------------------------- withdrawals
def _withdraw(client, user, amount):
    return client.post("/api/wallet/withdraw", headers=user, json={"amount": amount, "withdrawal_method": "Bank Transfer"})


def _verify(client, user, rid):
    code = get_collection("withdrawal_requests").find_one({"_id": ObjectId(rid)})["verification_code"]
    r = client.post("/api/withdrawals/verify-code", headers=user, json={"request_id": rid, "verification_code": code})
    assert r.status_code == 200, r.text


def test_withdrawal_hold_verify_approve(env):
    client, admin, user, uid = env
    r = _withdraw(client, user, 300)
    assert r.status_code == 200, r.text
    rid = r.json()["request_id"]
    b = bal(client, user)
    assert b["balance"] == 1000.0 and b["withdrawable"] == 700.0 and b["reserved"] == 300.0
    # the held money cannot be withdrawn again
    assert _withdraw(client, user, 701).status_code == 400

    _verify(client, user, rid)
    ok = client.put(f"/api/admin/withdrawal-requests/{rid}/approve", headers=admin)
    assert ok.status_code == 200, ok.text
    b = bal(client, user)
    assert b["balance"] == 700.0 and b["reserved"] == 0.0
    # paying the same withdrawal through the transaction endpoint is refused
    tid = get_collection("withdrawal_requests").find_one({"_id": ObjectId(rid)})["transaction_id"]
    assert client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin).status_code == 400
    assert bal(client, user)["balance"] == 700.0
    assert ledger.reconcile(uid)["ok"]


def test_withdrawal_reject_releases_hold(env):
    client, admin, user, uid = env
    rid = _withdraw(client, user, 400).json()["request_id"]
    _verify(client, user, rid)
    assert client.put(f"/api/admin/withdrawal-requests/{rid}/reject", headers=admin).status_code == 200
    b = bal(client, user)
    assert b["balance"] == 1000.0 and b["withdrawable"] == 1000.0


def test_withdrawal_complete_via_transaction_endpoint(env):
    client, admin, user, uid = env
    rid = _withdraw(client, user, 100).json()["request_id"]
    _verify(client, user, rid)  # the customer must enter the code before payout
    tid = get_collection("withdrawal_requests").find_one({"_id": ObjectId(rid)})["transaction_id"]
    r = client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin)
    assert r.status_code == 200, r.text
    b = bal(client, user)
    assert b["balance"] == 900.0 and b["reserved"] == 0.0


def test_expired_code_releases_hold(env):
    client, admin, user, uid = env
    rid = _withdraw(client, user, 250).json()["request_id"]
    get_collection("withdrawal_requests").update_one(
        {"_id": ObjectId(rid)}, {"$set": {"code_expires_at": datetime.utcnow() - timedelta(minutes=1)}})
    b = bal(client, user)
    assert b["withdrawable"] == 1000.0
    assert get_collection("withdrawal_requests").find_one({"_id": ObjectId(rid)})["status"] == "expired"


def test_too_many_code_attempts_releases_hold(env):
    client, admin, user, uid = env
    rid = _withdraw(client, user, 250).json()["request_id"]
    get_collection("withdrawal_requests").update_one({"_id": ObjectId(rid)}, {"$set": {"verification_attempts": 5}})
    r = client.post("/api/withdrawals/verify-code", headers=user, json={"request_id": rid, "verification_code": "AAAAAAAA"})
    assert r.status_code == 400
    assert bal(client, user)["withdrawable"] == 1000.0


def test_wrong_password_rejected_when_supplied(env):
    client, admin, user, uid = env
    r = client.post("/api/wallet/withdraw", headers=user,
                    json={"amount": 10, "withdrawal_method": "Bank Transfer", "password": "wrong"})
    assert r.status_code == 401
    r = client.post("/api/wallet/withdraw", headers=user,
                    json={"amount": 10, "withdrawal_method": "Bank Transfer", "password": "pw-123456"})
    assert r.status_code == 200


# --------------------------------------------------------------- plans & admin
def test_plan_purchase_uses_available_cash(env):
    client, admin, user, uid = env
    plan_id = get_collection("etf_plans").insert_one({
        "name": "Core", "minimum_investment": 100, "duration_months": 6, "expected_return_percent": 8,
        "is_active": True}).inserted_id
    _withdraw(client, user, 800)  # holds 800, leaves 200 available
    r = client.post(f"/api/etf-plans/activate/{plan_id}", headers=user, json={"plan_id": str(plan_id), "amount": 300})
    assert r.status_code == 400 and "200.00 available" in r.json()["detail"]
    r = client.post(f"/api/etf-plans/activate/{plan_id}", headers=user, json={"plan_id": str(plan_id), "amount": 150})
    assert r.status_code == 200, r.text
    assert r.json()["new_wallet_balance"] == 850.0
    inv = get_collection("user_investments").find_one({"user_id": uid})
    assert ledger.find_posted(f"plan-invest:{inv['_id']}")
    assert ledger.reconcile(uid)["ok"]


def test_admin_set_balance_posts_adjustment(env):
    client, admin, user, uid = env
    r = client.put(f"/api/admin/users/{uid}/update-balance", headers=admin, json={"new_balance": 1500})
    assert r.status_code == 200, r.text
    assert r.json()["old_balance"] == 1000.0
    assert bal(client, user)["balance"] == 1500.0
    _withdraw(client, user, 1200)
    r = client.put(f"/api/admin/users/{uid}/update-balance", headers=admin, json={"new_balance": 1000})
    assert r.status_code == 400  # would go below the 1200 held
    adj = [e for e in ledger.list_entries(uid) if e["type"] == "adjustment"]
    assert len(adj) == 1 and adj[0]["cash_delta_cents"] == 50000


def test_activity_endpoint_lists_ledger(env):
    client, admin, user, uid = env
    _withdraw(client, user, 10)
    r = client.get("/api/wallet/activity", headers=user)
    assert r.status_code == 200
    types = [i["type"] for i in r.json()["items"]]
    assert types == ["withdrawal_hold", "opening_balance"]
