from fastapi import APIRouter, HTTPException, Depends
from typing import List
from bson import ObjectId
from datetime import datetime, timedelta
import secrets

from app.database import get_collection, DEFI_PLANS_COLLECTION, USER_INVESTMENTS_COLLECTION, USERS_COLLECTION, TRANSACTIONS_COLLECTION
from app.schemas import DeFiPlanResponse, InvestInPlanRequest
from app.auth import get_current_user_token
from app.trading import funding, ledger

router = APIRouter(prefix="/api/defi-plans", tags=["defi_plans"])


def defi_plan_helper(plan) -> dict:
    """Helper function to format DeFi plan data from database"""
    return {
        "id": str(plan["_id"]),
        "name": plan.get("name") or "Untitled Plan",
        "portfolio_type": plan.get("portfolio_type") or plan.get("plan_type") or "General",
        "expected_return_percent": plan.get("expected_return_percent") or 0.0,
        "duration_months": plan.get("duration_months") or 0,
        "minimum_investment": plan.get("minimum_investment") or 0.0,
        "description": plan.get("description"),
        "is_active": plan.get("is_active", True),
        "tags": plan.get("tags", [])
    }


@router.get("/", response_model=List[DeFiPlanResponse])
async def get_all_defi_plans(current_user: dict = Depends(get_current_user_token)):
    """
    Get all active DeFi plans
    Requires authentication
    """
    try:
        plans_collection = get_collection(DEFI_PLANS_COLLECTION)
        plans = []

        # Only get active plans
        for plan in plans_collection.find({"is_active": True}):
            plans.append(defi_plan_helper(plan))

        return plans
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving DeFi plans: {str(e)}")


@router.get("/{plan_id}", response_model=DeFiPlanResponse)
async def get_defi_plan_by_id(plan_id: str, current_user: dict = Depends(get_current_user_token)):
    """
    Get a specific DeFi plan by ID
    Requires authentication
    """
    try:
        plans_collection = get_collection(DEFI_PLANS_COLLECTION)
        plan = plans_collection.find_one({"_id": ObjectId(plan_id)})

        if not plan:
            raise HTTPException(status_code=404, detail="DeFi plan not found")

        return defi_plan_helper(plan)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error retrieving DeFi plan: {str(e)}")


@router.post("/activate/{plan_id}")
async def activate_defi_plan(
    plan_id: str,
    request: InvestInPlanRequest,
    current_user: dict = Depends(get_current_user_token)
):
    """
    Activate a DeFi plan
    Deducts amount from wallet and creates investment record
    """
    try:
        users_collection = get_collection(USERS_COLLECTION)
        plans_collection = get_collection(DEFI_PLANS_COLLECTION)
        investments_collection = get_collection(USER_INVESTMENTS_COLLECTION)
        transactions_collection = get_collection(TRANSACTIONS_COLLECTION)

        user_id = current_user["user_id"]

        # Get user
        user = users_collection.find_one({"_id": ObjectId(user_id)})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Get DeFi plan
        try:
            plan = plans_collection.find_one({"_id": ObjectId(plan_id)})
        except:
            raise HTTPException(status_code=400, detail="Invalid plan ID")

        if not plan:
            raise HTTPException(status_code=404, detail="DeFi plan not found")

        if not plan.get("is_active", True):
            raise HTTPException(status_code=400, detail="This DeFi plan is not currently active")

        # Validate investment amount
        if request.amount < plan.get("minimum_investment", 0):
            raise HTTPException(
                status_code=400,
                detail=f"Investment amount must be at least ${plan.get('minimum_investment', 0)}"
            )

        # Pay from available cash through the unified ledger (cash held for open
        # orders or pending withdrawals cannot be spent).
        investment_id = ObjectId()
        try:
            paid = funding.pay_for_plan(user_id, str(investment_id), request.amount, plan["name"])
        except ledger.InsufficientFunds as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient wallet balance. You have ${exc.available_cents / 100:.2f} available, but need ${request.amount}"
            )
        new_balance = paid["cash_after_cents"] / 100

        # Calculate dates
        start_date = datetime.utcnow()
        maturity_date = start_date + timedelta(days=plan["duration_months"] * 30)

        # Create investment record
        investment_doc = {
            "user_id": user_id,
            "plan_id": str(plan["_id"]),
            "plan_name": plan["name"],
            "amount_invested": request.amount,
            "expected_return_percent": plan["expected_return_percent"],
            "holding_period_months": plan["duration_months"],
            "start_date": start_date,
            "maturity_date": maturity_date,
            "status": "active",
            "created_at": start_date,
            "updated_at": start_date
        }

        investment_doc["_id"] = investment_id
        try:
            result = investments_collection.insert_one(investment_doc)
        except Exception:
            funding.refund_plan(user_id, str(investment_id), request.amount, plan["name"])
            raise

        # Create transaction record
        transaction_doc = {
            "user_id": user_id,
            "transaction_type": "investment",
            "amount": request.amount,
            "status": "completed",
            "payment_method": "wallet",
            "reference_number": secrets.token_hex(16),
            "description": f"Investment in DeFi Plan: {plan['name']}",
            "investment_id": str(result.inserted_id),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        transactions_collection.insert_one(transaction_doc)

        return {
            "message": "DeFi plan activated successfully",
            "investment_id": str(result.inserted_id),
            "amount_invested": request.amount,
            "plan_name": plan["name"],
            "new_wallet_balance": new_balance,
            "maturity_date": maturity_date.isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Plan activation failed: {str(e)}")
