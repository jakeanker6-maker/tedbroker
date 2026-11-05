"""Crypto withdrawal destinations and the withdrawal-processed email.

Every completed withdrawal (bank or crypto, through either admin completion path) must email
the account owner, the same way deposit approvals do. Crypto payouts may only go to a saved,
admin-verified address.
"""
from datetime import datetime

import pytest
from bson import ObjectId

from app.auth import create_access_token, get_password_hash
from app.database import get_collection
from app.email_service import email_service
from app.trading import ledger

WALLET = "TYdemoVerifiedAddr9xK2mP7qL4vN8sR1tU3wZ"


@pytest.fixture
def sent(monkeypatch):
    """Record every email instead of sending it."""
    outbox = []

    def record(to_email, subject, html_content, plain_content=None):
        outbox.append({"to": to_email, "subject": subject, "text": plain_content or ""})
        return True

    monkeypatch.setattr(email_service, "send_email", record)
    return outbox


@pytest.fixture
def env(fresh_db, client):
    ledger.ensure_indexes()
    admin_id = ObjectId()
    get_collection("admins").insert_one({
        "_id": admin_id, "username": "adm", "email": "adm@t.io", "full_name": "Adm", "role": "admin",
        "is_active": True, "created_at": datetime.utcnow(), "last_login": None,
        "hashed_password": get_password_hash("x" * 10)})
    uid = ObjectId()
    get_collection("users").insert_one({
        "_id": uid, "username": "alice", "email": "alice@example.com", "full_name": "Alice Tester",
        "wallet_balance": 1000.0, "hashed_password": get_password_hash("pw-123456"),
        "is_active": True, "access_granted": True, "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()})
    get_collection("user_crypto_addresses").insert_many([
        {"_id": ObjectId(), "user_id": str(uid), "currency": "USDT", "network": "TRC20",
         "wallet_address": WALLET, "label": "Main", "is_primary": True, "is_verified": True,
         "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()},
        {"_id": ObjectId(), "user_id": str(uid), "currency": "BTC", "network": "Bitcoin",
         "wallet_address": "bc1qunverifiedaddress0000000000000", "label": "Cold", "is_primary": False,
         "is_verified": False, "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()},
    ])
    get_collection("user_bank_accounts").insert_one({
        "_id": ObjectId(), "user_id": str(uid), "account_name": "Alice Tester", "account_number": "0123456789",
        "bank_name": "Test Bank", "is_primary": True, "is_verified": True,
        "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()})
    admin = {"Authorization": "Bearer " + create_access_token({"sub": "adm", "user_id": str(admin_id), "role": "admin"})}
    user = {"Authorization": "Bearer " + create_access_token({"sub": "alice@example.com", "user_id": str(uid), "role": "user"})}
    return client, admin, user, str(uid)


def _crypto(client, user, amount=100, currency="USDT", address=WALLET):
    return client.post("/api/wallet/withdraw", headers=user, json={
        "amount": amount, "withdrawal_method": "Cryptocurrency", "crypto_type": currency, "wallet_address": address})


def _bank(client, user, amount=100):
    return client.post("/api/wallet/withdraw", headers=user, json={"amount": amount, "withdrawal_method": "Bank Transfer"})


def _request(rid):
    return get_collection("withdrawal_requests").find_one({"_id": ObjectId(rid)})


def _verify(client, user, rid):
    code = _request(rid)["verification_code"]
    r = client.post("/api/withdrawals/verify-code", headers=user, json={"request_id": rid, "verification_code": code})
    assert r.status_code == 200, r.text
    return code


# ------------------------------------------------------------ destination rules
def test_crypto_withdrawal_to_unsaved_address_is_refused(env):
    client, admin, user, uid = env
    r = _crypto(client, user, address="0xnotSavedByTheUserAnywhere")
    assert r.status_code == 400
    assert "saved to your account" in r.json()["detail"]
    assert get_collection("withdrawal_requests").count_documents({}) == 0
    assert ledger.get_balances(uid)["reserved_cents"] == 0


def test_crypto_withdrawal_to_unverified_address_is_refused(env):
    client, admin, user, uid = env
    r = _crypto(client, user, currency="BTC", address="bc1qunverifiedaddress0000000000000")
    assert r.status_code == 400
    assert "awaiting verification" in r.json()["detail"]
    assert get_collection("withdrawal_requests").count_documents({}) == 0


def test_crypto_withdrawal_to_verified_saved_address_stores_canonical_details(env):
    client, admin, user, uid = env
    r = _crypto(client, user, amount=120, currency="usdt")  # currency match is case-insensitive
    assert r.status_code == 200, r.text
    req = _request(r.json()["request_id"])
    addr = get_collection("user_crypto_addresses").find_one({"wallet_address": WALLET})
    assert req["account_id"] == str(addr["_id"])
    assert req["account_details"] == {
        "type": "crypto", "currency": "USDT", "crypto_type": "USDT", "wallet_address": WALLET,
        "network": "TRC20", "label": "Main"}
    assert req["withdrawal_method"] == "Cryptocurrency"
    assert ledger.get_balances(uid)["reserved_cents"] == 12000


def test_unknown_or_lowercase_method_labels_are_refused(env):
    client, admin, user, uid = env
    for label in ("crypto", "Crypto", "Cryptocurrency ", "wire"):
        r = client.post("/api/wallet/withdraw", headers=user, json={
            "amount": 10, "withdrawal_method": label, "crypto_type": "USDT", "wallet_address": WALLET})
        assert r.status_code == 422, (label, r.text)
    assert get_collection("withdrawal_requests").count_documents({}) == 0
    assert ledger.get_balances(uid)["reserved_cents"] == 0


def test_transaction_complete_refused_while_request_is_being_processed(env, sent):
    client, admin, user, uid = env
    rid = _bank(client, user, 25).json()["request_id"]
    _verify(client, user, rid)
    tid = _request(rid)["transaction_id"]
    # request approval has claimed the request
    get_collection("withdrawal_requests").update_one({"_id": ObjectId(rid)}, {"$set": {"status": "processing"}})
    r = client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin)
    assert r.status_code == 409, r.text
    assert get_collection("transactions").find_one({"_id": ObjectId(tid)})["status"] == "pending"
    assert ledger.get_balances(uid)["cash_cents"] == 100000
    assert sent == []


def test_bank_withdrawal_is_unaffected_by_crypto_rules(env):
    client, admin, user, uid = env
    r = _bank(client, user, 75)
    assert r.status_code == 200, r.text
    details = _request(r.json()["request_id"])["account_details"]
    assert details["type"] == "bank"
    assert details["account_number"] == "0123456789"


# ------------------------------------------------------------ emails on payout
def test_crypto_payout_through_transaction_complete_emails_the_user(env, sent):
    client, admin, user, uid = env
    r = _crypto(client, user, amount=100)
    rid = r.json()["request_id"]
    code = _verify(client, user, rid)
    tid = _request(rid)["transaction_id"]

    ok = client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin)
    assert ok.status_code == 200, ok.text
    assert len(sent) == 1
    mail = sent[0]
    assert mail["to"] == "alice@example.com"
    assert mail["subject"] == "Withdrawal processed"
    assert "Method: Cryptocurrency" in mail["text"]
    assert "Currency: USDT" in mail["text"]
    assert "Network: TRC20" in mail["text"]
    assert "Wallet: TYdemo...U3wZ" in mail["text"]
    assert WALLET not in mail["text"]  # identifiers are masked
    assert code not in mail["text"]  # the verification code is never emailed


def test_bank_payout_through_transaction_complete_emails_the_user(env, sent):
    client, admin, user, uid = env
    rid = _bank(client, user, 60).json()["request_id"]
    _verify(client, user, rid)
    tid = _request(rid)["transaction_id"]
    assert client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin).status_code == 200
    assert len(sent) == 1
    assert sent[0]["to"] == "alice@example.com"
    assert "Method: Bank Transfer" in sent[0]["text"]
    assert "Amount: $60.00" in sent[0]["text"]


def test_crypto_payout_through_request_approval_shows_the_currency(env, sent):
    client, admin, user, uid = env
    rid = _crypto(client, user, amount=40).json()["request_id"]
    _verify(client, user, rid)
    assert client.put(f"/api/admin/withdrawal-requests/{rid}/approve", headers=admin).status_code == 200
    assert len(sent) == 1
    assert "Currency: USDT" in sent[0]["text"]
    assert "Currency: N/A" not in sent[0]["text"]


def test_transaction_complete_is_refused_before_the_code_is_verified(env, sent):
    client, admin, user, uid = env
    rid = _bank(client, user, 45).json()["request_id"]
    tid = _request(rid)["transaction_id"]
    r = client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin)
    assert r.status_code == 400
    assert "not verified" in r.json()["detail"]
    assert ledger.get_balances(uid)["cash_cents"] == 100000  # nothing paid out
    assert sent == []
    assert _request(rid)["status"] == "pending_verification"
    assert get_collection("transactions").find_one({"_id": ObjectId(tid)})["status"] == "pending"

    # once the code is verified, the same completion succeeds
    _verify(client, user, rid)
    assert client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin).status_code == 200
    assert ledger.get_balances(uid)["cash_cents"] == 95500
    assert len(sent) == 1


def test_no_email_when_withdrawal_is_rejected(env, sent):
    client, admin, user, uid = env
    rid = _crypto(client, user, amount=40).json()["request_id"]
    _verify(client, user, rid)
    assert client.put(f"/api/admin/withdrawal-requests/{rid}/reject", headers=admin).status_code == 200
    assert sent == []


def test_failed_email_does_not_block_the_payout(env, monkeypatch):
    client, admin, user, uid = env

    def boom(*args, **kwargs):
        raise RuntimeError("postmark unavailable")

    monkeypatch.setattr(email_service, "send_email", boom)
    rid = _bank(client, user, 30).json()["request_id"]
    _verify(client, user, rid)
    tid = _request(rid)["transaction_id"]
    assert client.put(f"/api/admin/transactions/withdrawals/{tid}/complete", headers=admin).status_code == 200
    assert ledger.get_balances(uid)["cash_cents"] == 97000


# ------------------------------------------------------------ email service formatting
def test_email_accepts_the_withdrawal_api_vocabulary(sent):
    email_service.send_withdrawal_notification(
        to_email="bob@example.com", username="Bob", amount=12.5, withdrawal_method="crypto",
        account_details={"currency": "ETH", "wallet_address": "0x1234567890abcdef1234"})
    assert "Method: Cryptocurrency" in sent[-1]["text"]
    assert "Currency: ETH" in sent[-1]["text"]
    assert "Wallet: 0x1234...1234" in sent[-1]["text"]

    email_service.send_withdrawal_notification(
        to_email="bob@example.com", username="Bob", amount=99, withdrawal_method="bank",
        account_details={"bank_name": "First Bank", "account_number": "1234567890"})
    assert "Method: Bank Transfer" in sent[-1]["text"]
    assert "Bank: First Bank" in sent[-1]["text"]
    assert "Account: ****7890" in sent[-1]["text"]


def test_email_tolerates_missing_account_details(sent):
    email_service.send_withdrawal_notification(
        to_email="bob@example.com", username="Bob", amount=5, withdrawal_method="Bank Transfer", account_details=None)
    text = sent[-1]["text"]
    assert "Method: Bank Transfer" in text
    assert "N/A" not in text
