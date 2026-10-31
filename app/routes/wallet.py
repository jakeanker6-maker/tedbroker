from fastapi import APIRouter, HTTPException, status, Depends, Body
from datetime import datetime, timedelta
from bson import ObjectId
from typing import List, Optional, Dict, Any
import secrets
import string
import random
from pydantic import BaseModel

from app.schemas import TransactionResponse
from app.auth import get_current_user_token, verify_password
from app.database import get_collection, USERS_COLLECTION, TRANSACTIONS_COLLECTION, DEPOSIT_REQUESTS_COLLECTION, WITHDRAWAL_REQUESTS_COLLECTION, BANK_ACCOUNTS_COLLECTION
from app.trading import funding, ledger

router = APIRouter(prefix="/api/wallet", tags=["Wallet"])


class DepositRequest(BaseModel):
    amount: float
    payment_method: str
    password: Optional[str] = None
    # Optional fields for different payment methods
    bank_name: Optional[str] = None
    reference_number: Optional[str] = None
    crypto_type: Optional[str] = None
    wallet_address: Optional[str] = None  # Admin's wallet address shown to user


class WithdrawalRequest(BaseModel):
    amount: float
    withdrawal_method: str
    password: Optional[str] = None
    crypto_type: Optional[str] = None
    wallet_address: Optional[str] = None


def get_user_by_id(user_id: str):
    """Get user by ID from database"""
    users = get_collection(USERS_COLLECTION)
    try:
        return users.find_one({"_id": ObjectId(user_id)})
    except:
        return None


def generate_withdrawal_code() -> str:
    """Generate 8-digit alphanumeric withdrawal verification code"""
    characters = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(characters) for _ in range(8))


@router.get("/transactions", response_model=List[TransactionResponse])
async def get_transactions(current_user: dict = Depends(get_current_user_token)):
    """Get all transactions for the current user"""
    transactions_col = get_collection(TRANSACTIONS_COLLECTION)

    # Fetch all transactions for this user, sorted by created_at (newest first)
    transactions = list(transactions_col.find(
        {"user_id": current_user["user_id"]}
    ).sort("created_at", -1))

    # Convert MongoDB documents to response models
    return [
        TransactionResponse(
            id=str(txn["_id"]),
            transaction_type=txn["transaction_type"],
            amount=txn["amount"],
            status=txn["status"],
            payment_method=txn["payment_method"],
            reference_number=txn["reference_number"],
            description=txn.get("description"),
            created_at=txn["created_at"]
        )
        for txn in transactions
    ]


@router.post("/deposit")
async def create_deposit(
    deposit_data: DepositRequest,
    current_user: dict = Depends(get_current_user_token)
):
    """Create a deposit transaction"""
    if deposit_data.amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Amount must be greater than 0"
        )

    if deposit_data.amount > 1000000:  # Max deposit limit
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum deposit amount is $1,000,000"
        )

    users = get_collection(USERS_COLLECTION)
    transactions_col = get_collection(TRANSACTIONS_COLLECTION)
    deposit_requests_col = get_collection(DEPOSIT_REQUESTS_COLLECTION)

    # Get user
    user = get_user_by_id(current_user["user_id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Generate unique reference number
    reference_number = deposit_data.reference_number or f"DEP-{secrets.token_hex(8).upper()}"

    # Prepare payment details
    payment_details = {}
    if deposit_data.payment_method == "Bank Transfer":
        payment_details["bank_name"] = deposit_data.bank_name
        payment_details["reference_number"] = deposit_data.reference_number
    elif deposit_data.payment_method == "Cryptocurrency":
        payment_details["crypto_type"] = deposit_data.crypto_type
        payment_details["wallet_address"] = deposit_data.wallet_address  # Admin's wallet address where user sent payment
    elif deposit_data.payment_method == "PayPal":
        # PayPal is not currently available, but we accept the selection
        # No additional details needed for now
        pass

    # Create transaction record with pending status
    transaction = {
        "user_id": current_user["user_id"],
        "transaction_type": "deposit",
        "amount": deposit_data.amount,
        "status": "pending",  # Requires admin approval
        "payment_method": deposit_data.payment_method,
        "reference_number": reference_number,
        "payment_details": payment_details,
        "description": f"Deposit via {deposit_data.payment_method}",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }

    # Insert transaction
    result = transactions_col.insert_one(transaction)
    transaction["_id"] = result.inserted_id

    # Also create deposit request for admin dashboard
    deposit_request = {
        "transaction_id": str(transaction["_id"]),  # lets approval update exactly this row
        "user_id": current_user["user_id"],
        "username": user.get("username", ""),
        "email": user.get("email", ""),
        "amount": deposit_data.amount,
        "payment_method": deposit_data.payment_method,
        "payment_proof": payment_details.get("wallet_address") or payment_details.get("reference_number"),
        "notes": None,
        "status": "pending",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "reviewed_by": None,
        "reviewed_at": None
    }
    deposit_requests_col.insert_one(deposit_request)

    # Note: Wallet balance will be updated only when admin approves the deposit
    current_balance = ledger.get_balances(current_user["user_id"])["cash_cents"] / 100

    return {
        "message": "Deposit request submitted successfully. Your funds will be available once confirmed on-chain.",
        "transaction": TransactionResponse(
            id=str(transaction["_id"]),
            transaction_type=transaction["transaction_type"],
            amount=transaction["amount"],
            status=transaction["status"],
            payment_method=transaction["payment_method"],
            reference_number=transaction["reference_number"],
            description=transaction.get("description"),
            created_at=transaction["created_at"]
        ),
        "current_balance": current_balance
    }


@router.post("/withdraw")
async def create_withdrawal(
    withdrawal_data: WithdrawalRequest,
    current_user: dict = Depends(get_current_user_token)
):
    """Create a withdrawal transaction"""
    if withdrawal_data.amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Amount must be greater than 0"
        )

    users = get_collection(USERS_COLLECTION)
    transactions_col = get_collection(TRANSACTIONS_COLLECTION)
    withdrawal_requests_col = get_collection(WITHDRAWAL_REQUESTS_COLLECTION)

    user = get_user_by_id(current_user["user_id"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Withdrawals are protected by the 8-character code plus admin approval. The
    # wallet UI does not send a password, so it is only checked when one is supplied
    # (users are stored with `hashed_password`; the old code read `password`, which
    # never exists, so the check never ran).
    stored_hash = user.get("hashed_password")
    if withdrawal_data.password is not None and stored_hash:
        try:
            valid = verify_password(withdrawal_data.password, stored_hash)
        except Exception:
            valid = False
        if not valid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    funding.expire_stale_withdrawals(current_user["user_id"])
    withdrawable = funding.withdrawable_cents(current_user["user_id"]) / 100
    if withdrawable < withdrawal_data.amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient funds. Available to withdraw: ${withdrawable:.2f}"
        )

    reference_number = f"WTH-{secrets.token_hex(8).upper()}"
    payment_details = {}

    if withdrawal_data.withdrawal_method == "Cryptocurrency":
        if not withdrawal_data.crypto_type or not withdrawal_data.wallet_address:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Crypto withdrawal requires crypto_type and wallet_address"
            )
        payment_details["crypto_type"] = withdrawal_data.crypto_type
        payment_details["wallet_address"] = withdrawal_data.wallet_address

    # Additional handling can be added here for other withdrawal methods

    # Hold the funds first so they cannot be traded or withdrawn twice while the
    # request is reviewed. The request id is generated up front so the hold is keyed to it.
    wr_id = ObjectId()
    try:
        funding.hold_withdrawal(str(wr_id), current_user["user_id"], withdrawal_data.amount,
                                withdrawal_data.withdrawal_method)
    except ledger.InsufficientFunds as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient funds. Available to withdraw: ${exc.available_cents / 100:.2f}"
        )

    transaction = {
        "user_id": current_user["user_id"],
        "transaction_type": "withdrawal",
        "amount": withdrawal_data.amount,
        "status": "pending",  # Requires admin approval
        "payment_method": withdrawal_data.withdrawal_method,
        "reference_number": reference_number,
        "payment_details": payment_details,
        "description": f"Withdrawal to {withdrawal_data.withdrawal_method}",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    try:
        result = transactions_col.insert_one(transaction)
    except Exception:
        funding.release_withdrawal(str(wr_id), current_user["user_id"], "failed")
        raise
    transaction["_id"] = result.inserted_id

    # Also create withdrawal request for admin dashboard with verification code
    withdrawal_request = {
        "_id": wr_id,
        "user_id": current_user["user_id"],
        "username": user.get("username", ""),
        "email": user.get("email", ""),
        "amount": withdrawal_data.amount,
        "withdrawal_method": withdrawal_data.withdrawal_method,
        "account_id": None,  # Simple withdrawal doesn't require account_id
        "account_details": {
            "type": "crypto" if withdrawal_data.withdrawal_method == "Cryptocurrency" else "other",
            "crypto_type": payment_details.get("crypto_type"),
            "wallet_address": payment_details.get("wallet_address")
        },
        "notes": None,
        "status": "pending_verification",  # Set to pending_verification initially
        "verification_code": generate_withdrawal_code(),  # Generate verification code
        "code_expires_at": datetime.utcnow() + timedelta(minutes=15),  # 15 minute expiration
        "code_verified_at": None,
        "verification_attempts": 0,
        "transaction_id": str(transaction["_id"]),  # Link to transaction
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "reviewed_by": None,
        "reviewed_at": None,
        "completed_at": None
    }
    try:
        wr_result = withdrawal_requests_col.insert_one(withdrawal_request)
    except Exception:
        funding.release_withdrawal(str(wr_id), current_user["user_id"], "failed")
        transactions_col.update_one({"_id": transaction["_id"]}, {"$set": {"status": "failed"}})
        raise
    current_balance = ledger.get_balances(current_user["user_id"])["cash_cents"] / 100

    return {
        "message": "Withdrawal request submitted successfully. Your request will be processed confirmed on-chain.",
        "request_id": str(wr_result.inserted_id),  # Include request ID for verification
        "transaction": TransactionResponse(
            id=str(transaction["_id"]),
            transaction_type=transaction["transaction_type"],
            amount=transaction["amount"],
            status=transaction["status"],
            payment_method=transaction["payment_method"],
            reference_number=transaction["reference_number"],
            description=transaction.get("description"),
            created_at=transaction["created_at"]
        ),
        "current_balance": current_balance
    }


@router.get("/balance")
async def get_balance(current_user: dict = Depends(get_current_user_token)):
    """Get current wallet balance"""
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    funding.expire_stale_withdrawals(current_user["user_id"])
    from app.trading import portfolio
    s = await portfolio.summary(current_user["user_id"])
    # `balance` keeps its old meaning (total cash). The other fields are additive.
    return {
        "balance": float(s["cash"]),
        "cash": float(s["cash"]),
        "reserved": float(s["reserved"]),
        "withdrawable": float(s["withdrawable"]),
        "buying_power": float(s["buying_power"]),
        "equity": float(s["equity"]),
        "positions_value": float(s["positions_value"]),
        "total_value": float(s["total_value"]),
        "currency": "USD",
    }


@router.get("/activity")
async def get_activity(
    limit: int = 50,
    before: Optional[str] = None,
    types: Optional[str] = None,
    current_user: dict = Depends(get_current_user_token),
):
    """Unified cash activity from the ledger (deposits, withdrawals, plans, bonuses,
    adjustments and, later, trades). Paginate with `before` = `next_before` from the
    previous page."""
    if before and not ObjectId.is_valid(before):
        raise HTTPException(status_code=400, detail="Invalid 'before' cursor")
    type_list = [t for t in (types or "").split(",") if t] or None
    entries = ledger.list_entries(current_user["user_id"], limit=limit, before_id=before, types=type_list)
    items = [ledger.serialize_entry(e) for e in entries]
    return {"items": items, "next_before": items[-1]["id"] if len(items) == limit else None}


@router.get("/deposit-bank-accounts")
async def get_deposit_bank_accounts():
    """
    Get active bank accounts for deposits (public endpoint)

    Returns:
        list: Active bank accounts where users can deposit funds
    """
    bank_accounts = get_collection(BANK_ACCOUNTS_COLLECTION)

    # Get all active bank accounts
    active_accounts = list(bank_accounts.find({"is_active": True}))

    # Return formatted account details (only one account if multiple exist, use the first one)
    if active_accounts:
        account = active_accounts[0]  # Get the first active account
        return {
            "bank_name": account.get("bank_name"),
            "account_name": account.get("account_name"),
            "account_number": account.get("account_number"),
            "routing_number": account.get("routing_number"),
            "swift_code": account.get("swift_code")
        }

    # Return None if no active accounts
    return None


@router.get("/pending-transactions")
async def get_pending_transactions(current_user: dict = Depends(get_current_user_token)):
    """Get summary of pending transactions for the current user"""
    transactions_col = get_collection(TRANSACTIONS_COLLECTION)

    # Find pending deposits and withdrawals
    pending_deposits = list(transactions_col.find({
        "user_id": current_user["user_id"],
        "transaction_type": "deposit",
        "status": "pending"
    }))

    pending_withdrawals = list(transactions_col.find({
        "user_id": current_user["user_id"],
        "transaction_type": "withdrawal",
        "status": "pending"
    }))

    # Calculate totals
    total_pending_deposits = sum(txn["amount"] for txn in pending_deposits)
    total_pending_withdrawals = sum(txn["amount"] for txn in pending_withdrawals)

    return {
        "pending_deposits": {
            "count": len(pending_deposits),
            "total_amount": total_pending_deposits,
            "transactions": [
                {
                    "id": str(txn["_id"]),
                    "amount": txn["amount"],
                    "payment_method": txn["payment_method"],
                    "created_at": txn["created_at"]
                }
                for txn in pending_deposits
            ]
        },
        "pending_withdrawals": {
            "count": len(pending_withdrawals),
            "total_amount": total_pending_withdrawals,
            "transactions": [
                {
                    "id": str(txn["_id"]),
                    "amount": txn["amount"],
                    "payment_method": txn["payment_method"],
                    "created_at": txn["created_at"]
                }
                for txn in pending_withdrawals
            ]
        }
    }
