"""Payout accounts: one bank account, at most three crypto wallets, and bank withdrawals that
require the saved bank account to be admin-verified."""
from datetime import datetime

import pytest
from bson import ObjectId

from app.auth import create_access_token, get_password_hash
from app.database import get_collection
from app.trading import ledger

BANK = {"account_name": "Pat Tester", "account_number": "0011223344", "bank_name": "First Test Bank",
        "swift_code": "FTBKUS33", "iban": None}


@pytest.fixture
def env(fresh_db, client):
    ledger.ensure_indexes()
    uid = ObjectId()
    get_collection("users").insert_one({
        "_id": uid, "username": "pat", "email": "pat@example.com", "full_name": "Pat Tester",
        "wallet_balance": 500.0, "hashed_password": get_password_hash("pw-123456"),
        "is_active": True, "access_granted": True, "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()})
    user = {"Authorization": "Bearer " + create_access_token({"sub": "pat@example.com", "user_id": str(uid), "role": "user"})}
    return client, user, str(uid)


def _add_bank(client, user, **overrides):
    body = {**BANK, **overrides}
    return client.post("/api/withdrawals/bank-accounts", headers=user, json=body)


def _add_crypto(client, user, n):
    return client.post("/api/withdrawals/crypto-addresses", headers=user, json={
        "currency": "USDT", "network": "TRC20",
        "wallet_address": f"TYpayoutwalletaddress{n:04d}XYZ", "label": f"Wallet {n}"})


def _withdraw_bank(client, user, amount=100):
    return client.post("/api/wallet/withdraw", headers=user, json={"amount": amount, "withdrawal_method": "Bank Transfer"})


def test_second_bank_account_is_refused(env):
    client, user, uid = env
    assert _add_bank(client, user).status_code == 200
    r = _add_bank(client, user, account_number="9988776655")
    assert r.status_code == 409, r.text
    assert get_collection("user_bank_accounts").count_documents({"user_id": uid}) == 1


def test_bank_account_can_be_replaced_after_delete(env):
    client, user, uid = env
    first = _add_bank(client, user).json()
    assert client.delete(f"/api/withdrawals/bank-accounts/{first['id']}", headers=user).status_code == 200
    assert _add_bank(client, user, account_number="9988776655").status_code == 200


def test_fourth_crypto_wallet_is_refused(env):
    client, user, uid = env
    for n in range(3):
        assert _add_crypto(client, user, n).status_code == 200
    r = _add_crypto(client, user, 3)
    assert r.status_code == 409, r.text
    assert get_collection("user_crypto_addresses").count_documents({"user_id": uid}) == 3


def test_crypto_wallet_slot_frees_after_delete(env):
    client, user, uid = env
    ids = [_add_crypto(client, user, n).json()["id"] for n in range(3)]
    assert client.delete(f"/api/withdrawals/crypto-addresses/{ids[0]}", headers=user).status_code == 200
    assert _add_crypto(client, user, 9).status_code == 200


def test_duplicate_crypto_wallet_is_refused(env):
    client, user, uid = env
    assert _add_crypto(client, user, 1).status_code == 200
    r = _add_crypto(client, user, 1)
    assert r.status_code == 409, r.text


def test_bank_withdrawal_requires_a_bank_account(env):
    client, user, uid = env
    r = _withdraw_bank(client, user)
    assert r.status_code == 400
    assert "Settings" in r.json()["detail"]
    assert get_collection("withdrawal_requests").count_documents({}) == 0


def test_bank_withdrawal_requires_verification(env):
    client, user, uid = env
    _add_bank(client, user)
    r = _withdraw_bank(client, user)
    assert r.status_code == 400
    assert "awaiting verification" in r.json()["detail"]
    assert get_collection("withdrawal_requests").count_documents({}) == 0


def test_verified_bank_withdrawal_snapshots_the_account(env):
    client, user, uid = env
    bank = _add_bank(client, user).json()
    get_collection("user_bank_accounts").update_one({"_id": ObjectId(bank["id"])}, {"$set": {"is_verified": True}})
    r = _withdraw_bank(client, user, 150)
    assert r.status_code == 200, r.text
    req = get_collection("withdrawal_requests").find_one({"_id": ObjectId(r.json()["request_id"])})
    assert req["withdrawal_method"] == "Bank Transfer"
    assert req["account_id"] == bank["id"]
    assert req["account_details"]["type"] == "bank"
    assert req["account_details"]["account_number"] == BANK["account_number"]
    assert req["account_details"]["bank_name"] == BANK["bank_name"]
    assert req["status"] == "pending_verification"
    assert ledger.reconcile(uid)["ok"]
