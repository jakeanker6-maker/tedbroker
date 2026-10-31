"""Unified cash ledger. This module is the ONLY code allowed to change a user's cash.

Every change is a ``ledger_entries`` row plus one conditional update of the user's
cash fields:

    users.cash_cents       total cash (integer cents, source of truth)
    users.reserved_cents   cash held for open orders / pending withdrawals
    users.available_cents  cash_cents - reserved_cents (stored so guards are one query)
    users.wallet_balance   legacy float-dollar mirror of cash_cents, kept so existing
                           pages and endpoints keep working

How a posting works (crash-safe without needing Mongo transactions):

1. Insert the entry with ``status="pending"``. ``idempotency_key`` is unique, so a
   retry or double-click with the same key never applies twice.
2. Apply the deltas to the user with one ``find_one_and_update`` whose filter carries
   the balance guards and ``ledger_recent != entry_id``. The entry id is pushed onto
   ``users.ledger_recent`` (last 100), which makes the user update itself idempotent
   and lets ``recover_pending`` tell whether a crashed posting was applied.
3. If the guard fails the pending entry is deleted (the key is free again) and
   ``InsufficientFunds`` is raised. Otherwise the entry becomes ``posted``.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Callable, Dict, List, Optional, Union

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.database import LEDGER_ENTRIES_COLLECTION, USERS_COLLECTION, get_collection

RECENT_IDS_KEPT = 100

# Entry types. Phase 0 uses the first block; the rest are reserved for the engine.
ENTRY_TYPES = {
    "opening_balance", "deposit", "withdrawal_hold", "withdrawal_release", "withdrawal",
    "adjustment", "plan_invest", "plan_refund", "plan_payout", "referral_bonus",
    "trade_buy", "trade_sell", "short_sale", "short_cover", "fee", "option_premium",
    "exercise", "assignment", "dividend", "dividend_owed", "borrow_fee", "margin_interest",
    "order_hold", "order_release", "copy_allocate", "copy_release", "copy_pnl", "liquidation",
}

Number = Union[int, float, str, Decimal]


class LedgerError(Exception):
    """Base ledger error."""


class InsufficientFunds(LedgerError):
    def __init__(self, available_cents: int, required_cents: int):
        self.available_cents = available_cents
        self.required_cents = required_cents
        super().__init__(
            f"Insufficient funds: available ${from_cents(available_cents):,.2f}, "
            f"required ${from_cents(required_cents):,.2f}"
        )


class LedgerConflict(LedgerError):
    """Another posting with the same idempotency key is still in flight. Retry."""


class AccountNotFound(LedgerError):
    pass


# ---------------------------------------------------------------- money helpers
def to_cents(amount: Number) -> int:
    """Convert dollars (float/str/Decimal) to integer cents, rounding half up."""
    value = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(value * 100)


def from_cents(cents: int) -> float:
    return round(cents / 100.0, 2)


# ---------------------------------------------------------------- listeners
_listeners: List[Callable[[Dict[str, Any]], None]] = []


def add_listener(fn: Callable[[Dict[str, Any]], None]) -> None:
    """Register a callback run after every posting (used by the account SSE stream)."""
    _listeners.append(fn)


def _notify(entry: Dict[str, Any]) -> None:
    for fn in list(_listeners):
        try:
            fn(entry)
        except Exception as exc:  # listeners must never break a posting
            print(f"ledger listener error: {exc}")


# ---------------------------------------------------------------- collections
def _entries():
    return get_collection(LEDGER_ENTRIES_COLLECTION)


def _users():
    return get_collection(USERS_COLLECTION)


def _oid(user_id: Union[str, ObjectId]) -> ObjectId:
    return user_id if isinstance(user_id, ObjectId) else ObjectId(str(user_id))


def ensure_indexes() -> None:
    e = _entries()
    e.create_index([("idempotency_key", ASCENDING)], unique=True, name="uniq_idem")
    e.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_time")
    e.create_index([("status", ASCENDING), ("created_at", ASCENDING)], name="status_time")
    e.create_index([("ref_type", ASCENDING), ("ref_id", ASCENDING)], name="ref")


# ---------------------------------------------------------------- accounts
def ensure_account(user_id: Union[str, ObjectId]) -> Dict[str, Any]:
    """Make sure the user has ledger cash fields, seeding them from wallet_balance.

    Idempotent and safe to call on every request. The opening balance is recorded
    as an ``opening_balance`` entry so that cash always equals the sum of entries.
    """
    users = _users()
    oid = _oid(user_id)
    user = users.find_one({"_id": oid})
    if not user:
        raise AccountNotFound(str(user_id))
    if "cash_cents" in user:
        return user

    uid = str(oid)
    opening = to_cents(user.get("wallet_balance") or 0)
    entry_id = ObjectId()
    now = datetime.utcnow()
    try:
        _entries().insert_one({
            "_id": entry_id,
            "user_id": uid,
            "type": "opening_balance",
            "cash_delta_cents": opening,
            "reserved_delta_cents": 0,
            "cash_after_cents": opening,
            "reserved_after_cents": 0,
            "idempotency_key": f"opening:{uid}",
            "ref_type": "user",
            "ref_id": uid,
            "description": "Opening balance carried over from wallet",
            "status": "posted",
            "created_at": now,
            "posted_at": now,
        })
    except DuplicateKeyError:
        existing = _entries().find_one({"idempotency_key": f"opening:{uid}"})
        entry_id = existing["_id"]
        opening = existing["cash_delta_cents"]

    users.update_one(
        {"_id": oid, "cash_cents": {"$exists": False}},
        {"$set": {
            "cash_cents": opening,
            "reserved_cents": 0,
            "available_cents": opening,
            "wallet_balance": from_cents(opening),
            "ledger_recent": [entry_id],
            "ledger_initialized_at": now,
        }},
    )
    return users.find_one({"_id": oid})


def get_balances(user_id: Union[str, ObjectId]) -> Dict[str, int]:
    user = ensure_account(user_id)
    return {
        "cash_cents": int(user.get("cash_cents", 0)),
        "reserved_cents": int(user.get("reserved_cents", 0)),
        "available_cents": int(user.get("available_cents", 0)),
    }


# ---------------------------------------------------------------- posting
def post(
    user_id: Union[str, ObjectId],
    *,
    type: str,
    idempotency_key: str,
    cash_delta_cents: int = 0,
    reserved_delta_cents: int = 0,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    description: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    allow_negative_cash: bool = False,
) -> Dict[str, Any]:
    """Apply a cash and/or reservation change atomically and idempotently.

    `allow_negative_cash=True` is for margin accounts only: cash may go below zero
    (a margin loan). The caller must have checked the margin requirement first.

    Guards: cash, reserved and available may never go negative. Returns the posted
    entry. A repeated call with the same key returns the original entry with
    ``duplicate=True`` and changes nothing.
    """
    if type not in ENTRY_TYPES:
        raise LedgerError(f"Unknown ledger entry type: {type}")
    if not idempotency_key:
        raise LedgerError("idempotency_key is required")
    cash_delta_cents = int(cash_delta_cents)
    reserved_delta_cents = int(reserved_delta_cents)
    if cash_delta_cents == 0 and reserved_delta_cents == 0:
        raise LedgerError("A ledger posting must change cash or reserved")

    user = ensure_account(user_id)
    oid = user["_id"]
    uid = str(oid)
    entries = _entries()
    now = datetime.utcnow()
    entry_id = ObjectId()
    entry = {
        "_id": entry_id,
        "user_id": uid,
        "type": type,
        "cash_delta_cents": cash_delta_cents,
        "reserved_delta_cents": reserved_delta_cents,
        "idempotency_key": idempotency_key,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "description": description,
        "meta": meta or {},
        "status": "pending",
        "created_at": now,
    }
    try:
        entries.insert_one(entry)
    except DuplicateKeyError:
        existing = entries.find_one({"idempotency_key": idempotency_key})
        if existing and existing.get("status") == "posted":
            existing["duplicate"] = True
            return existing
        raise LedgerConflict(f"Posting {idempotency_key} is in progress")

    available_delta = cash_delta_cents - reserved_delta_cents
    guard: Dict[str, Any] = {"_id": oid, "ledger_recent": {"$ne": entry_id}}
    if cash_delta_cents < 0 and not allow_negative_cash:
        guard["cash_cents"] = {"$gte": -cash_delta_cents}
    if reserved_delta_cents < 0:
        guard["reserved_cents"] = {"$gte": -reserved_delta_cents}
    if available_delta < 0 and not allow_negative_cash:
        guard["available_cents"] = {"$gte": -available_delta}

    updated = _users().find_one_and_update(
        guard,
        {
            "$inc": {
                "cash_cents": cash_delta_cents,
                "reserved_cents": reserved_delta_cents,
                "available_cents": available_delta,
            },
            "$push": {"ledger_recent": {"$each": [entry_id], "$slice": -RECENT_IDS_KEPT}},
            "$set": {"updated_at": now},
        },
        return_document=ReturnDocument.AFTER,
    )

    if updated is None:
        entries.delete_one({"_id": entry_id, "status": "pending"})
        current = _users().find_one({"_id": oid}) or {}
        if cash_delta_cents < 0 and current.get("cash_cents", 0) < -cash_delta_cents:
            raise InsufficientFunds(int(current.get("cash_cents", 0)), -cash_delta_cents)
        if reserved_delta_cents < 0 and current.get("reserved_cents", 0) < -reserved_delta_cents:
            raise LedgerError("Cannot release more than is reserved")
        raise InsufficientFunds(int(current.get("available_cents", 0)), max(0, -available_delta))

    cash_after = int(updated["cash_cents"])
    reserved_after = int(updated["reserved_cents"])
    entries.update_one(
        {"_id": entry_id},
        {"$set": {
            "status": "posted",
            "posted_at": datetime.utcnow(),
            "cash_after_cents": cash_after,
            "reserved_after_cents": reserved_after,
        }},
    )
    _sync_mirror(oid, cash_after)
    entry.update(status="posted", cash_after_cents=cash_after, reserved_after_cents=reserved_after)
    _notify(entry)
    return entry


def _sync_mirror(oid: ObjectId, cash_after: int) -> None:
    """Refresh the legacy wallet_balance. Guarded on cash_cents so the latest posting
    always wins when two postings race."""
    _users().update_one(
        {"_id": oid, "cash_cents": cash_after},
        {"$set": {"wallet_balance": from_cents(cash_after)}},
    )


# ---------------------------------------------------------------- convenience
def credit(user_id, cents: int, *, type: str, idempotency_key: str, **kw) -> Dict[str, Any]:
    if cents <= 0:
        raise LedgerError("credit amount must be positive")
    return post(user_id, type=type, idempotency_key=idempotency_key, cash_delta_cents=cents, **kw)


def debit(user_id, cents: int, *, type: str, idempotency_key: str, **kw) -> Dict[str, Any]:
    """Spend available (unreserved) cash."""
    if cents <= 0:
        raise LedgerError("debit amount must be positive")
    return post(user_id, type=type, idempotency_key=idempotency_key, cash_delta_cents=-cents, **kw)


def reserve(user_id, cents: int, *, type: str, idempotency_key: str, **kw) -> Dict[str, Any]:
    if cents <= 0:
        raise LedgerError("reserve amount must be positive")
    return post(user_id, type=type, idempotency_key=idempotency_key, reserved_delta_cents=cents, **kw)


def release(user_id, cents: int, *, type: str, idempotency_key: str, **kw) -> Dict[str, Any]:
    if cents <= 0:
        raise LedgerError("release amount must be positive")
    return post(user_id, type=type, idempotency_key=idempotency_key, reserved_delta_cents=-cents, **kw)


def settle_reserved(user_id, cents: int, *, type: str, idempotency_key: str, **kw) -> Dict[str, Any]:
    """Spend cash that was previously reserved (cash and reserved both go down)."""
    if cents <= 0:
        raise LedgerError("settle amount must be positive")
    return post(user_id, type=type, idempotency_key=idempotency_key,
                cash_delta_cents=-cents, reserved_delta_cents=-cents, **kw)


def find_posted(idempotency_key: str) -> Optional[Dict[str, Any]]:
    return _entries().find_one({"idempotency_key": idempotency_key, "status": "posted"})


# ---------------------------------------------------------------- reads & integrity
def list_entries(user_id, limit: int = 50, before_id: Optional[str] = None,
                 types: Optional[List[str]] = None, exclude_types: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Newest first. Ordered by entry id (unique and increasing), so entries created
    in the same millisecond keep a stable order and pagination never skips any."""
    q: Dict[str, Any] = {"user_id": str(user_id), "status": "posted"}
    if before_id:
        q["_id"] = {"$lt": ObjectId(before_id)}
    if types:
        q["type"] = {"$in": types}
    elif exclude_types:
        q["type"] = {"$nin": exclude_types}
    return list(_entries().find(q).sort("_id", DESCENDING).limit(max(1, min(limit, 200))))


def reconcile(user_id) -> Dict[str, Any]:
    """Check that stored balances equal the sum of posted entries."""
    user = ensure_account(user_id)
    cash = reserved = 0
    for e in _entries().find({"user_id": str(user["_id"]), "status": "posted"}):
        cash += int(e["cash_delta_cents"])
        reserved += int(e["reserved_delta_cents"])
    ok = (cash == user["cash_cents"] and reserved == user["reserved_cents"]
          and user["available_cents"] == user["cash_cents"] - user["reserved_cents"]
          and abs(float(user.get("wallet_balance", 0)) - from_cents(user["cash_cents"])) < 0.005)
    return {"ok": ok, "ledger_cash_cents": cash, "ledger_reserved_cents": reserved,
            "stored_cash_cents": user["cash_cents"], "stored_reserved_cents": user["reserved_cents"],
            "stored_available_cents": user["available_cents"],
            "wallet_balance": user.get("wallet_balance")}


def recover_pending(older_than_seconds: int = 60) -> Dict[str, int]:
    """Finish or discard postings left pending by a crash.

    Applied (entry id present in users.ledger_recent) -> mark posted.
    Not applied -> delete, which frees the idempotency key for a retry.
    """
    cutoff = datetime.utcnow() - timedelta(seconds=older_than_seconds)
    fixed = dropped = 0
    for e in list(_entries().find({"status": "pending", "created_at": {"$lt": cutoff}})):
        user = _users().find_one({"_id": _oid(e["user_id"]), "ledger_recent": e["_id"]})
        if user:
            _entries().update_one({"_id": e["_id"]}, {"$set": {
                "status": "posted", "posted_at": datetime.utcnow(), "recovered": True}})
            _sync_mirror(user["_id"], int(user["cash_cents"]))
            fixed += 1
        else:
            _entries().delete_one({"_id": e["_id"], "status": "pending"})
            dropped += 1
    return {"posted": fixed, "dropped": dropped}


def serialize_entry(e: Dict[str, Any]) -> Dict[str, Any]:
    """API shape: dollars as decimal strings."""
    return {
        "id": str(e["_id"]),
        "type": e["type"],
        "amount": f"{e['cash_delta_cents'] / 100:.2f}",
        "reserved_change": f"{e['reserved_delta_cents'] / 100:.2f}",
        "cash_after": f"{e.get('cash_after_cents', 0) / 100:.2f}",
        "description": e.get("description"),
        "ref_type": e.get("ref_type"),
        "ref_id": e.get("ref_id"),
        "bucket": (e.get("meta") or {}).get("bucket") or _fill_bucket(e),
        # bookkeeping inside a copy allocation (sale proceeds re-reserved): no free-cash change
        "internal": str(e.get("idempotency_key", "")).startswith("copy-proceeds:"),
        "created_at": e["created_at"].isoformat() + "Z",
    }


def _fill_bucket(e: Dict[str, Any]) -> Optional[str]:
    """Bucket of a fill-backed entry posted before `meta.bucket` was recorded."""
    if e.get("ref_type") != "fill" or not ObjectId.is_valid(str(e.get("ref_id"))):
        return None
    f = get_collection("fills").find_one({"_id": ObjectId(str(e["ref_id"]))}, {"bucket": 1})
    return f.get("bucket") if f else None
