from fastapi import APIRouter, HTTPException, Depends
from typing import List
from bson import ObjectId
from datetime import datetime, timedelta
import secrets

from app.database import get_collection, OPTIONS_PLANS_COLLECTION, USER_INVESTMENTS_COLLECTION, USERS_COLLECTION, TRANSACTIONS_COLLECTION
from app.schemas import OptionsPlanResponse, InvestInPlanRequest
from app.auth import get_current_user_token

router = APIRouter(prefix="/api/options-plans", tags=["options_plans"])


def options_plan_helper(plan) -> dict:
    """Helper function to format Options plan data from database"""
    return {
        "id": str(plan["_id"]),
        "name": plan["name"],
        "plan_type": plan["plan_type"],
        "expected_return_percent": plan["expected_return_percent"],
        "duration_months": plan.get("duration_months", 0),
        "minimum_investment": plan.get("minimum_investment", 0.0),
        "description": plan.get("description"),
        "is_active": plan.get("is_active", True),
        "tags": plan.get("tags", [])
    }


@router.get("/", response_model=List[OptionsPlanResponse])
async def get_all_options_plans(current_user: dict = Depends(get_current_user_token)):
    """
    Get all active Options plans
    Requires authentication
    """
    try:
        plans_collection = get_collection(OPTIONS_PLANS_COLLECTION)
        plans = []

        # Only get active plans
        for plan in plans_collection.find({"is_active": True}):
            plans.append(options_plan_helper(plan))

        return plans
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving Options plans: {str(e)}")


@router.get("/{plan_id}", response_model=OptionsPlanResponse)
async def get_options_plan_by_id(plan_id: str, current_user: dict = Depends(get_current_user_token)):
    """
    Get a specific Options plan by ID
    Requires authentication
    """
    try:
        plans_collection = get_collection(OPTIONS_PLANS_COLLECTION)
        plan = plans_collection.find_one({"_id": ObjectId(plan_id)})

        if not plan:
            raise HTTPException(status_code=404, detail="Options plan not found")

        return options_plan_helper(plan)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error retrieving Options plan: {str(e)}")


@router.post("/activate/{plan_id}")
async def activate_options_plan(
    plan_id: str,
    request: InvestInPlanRequest,
    current_user: dict = Depends(get_current_user_token)
):
    """
    Activate an Options plan
    Deducts amount from wallet and creates investment record
    """
    try:
        users_collection = get_collection(USERS_COLLECTION)
        plans_collection = get_collection(OPTIONS_PLANS_COLLECTION)
        investments_collection = get_collection(USER_INVESTMENTS_COLLECTION)
        transactions_collection = get_collection(TRANSACTIONS_COLLECTION)

        user_id = current_user["user_id"]

        # Get user
        user = users_collection.find_one({"_id": ObjectId(user_id)})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Get Options plan
        try:
            plan = plans_collection.find_one({"_id": ObjectId(plan_id)})
        except:
            raise HTTPException(status_code=400, detail="Invalid plan ID")

        if not plan:
            raise HTTPException(status_code=404, detail="Options plan not found")

        if not plan.get("is_active", True):
            raise HTTPException(status_code=400, detail="This Options plan is not currently active")

        # Validate investment amount
        if request.amount < plan.get("minimum_investment", 0):
            raise HTTPException(
                status_code=400,
                detail=f"Investment amount must be at least ${plan.get('minimum_investment', 0)}"
            )

        # Check wallet balance
        wallet_balance = user.get("wallet_balance", 0.0)
        if wallet_balance < request.amount:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient wallet balance. You have ${wallet_balance}, but need ${request.amount}"
            )

        # Calculate dates
        start_date = datetime.utcnow()
        maturity_date = start_date + timedelta(days=plan.get("duration_months", 0) * 30)

        # Create investment record
        investment_doc = {
            "user_id": user_id,
            "plan_id": str(plan["_id"]),
            "plan_name": plan["name"],
            "amount_invested": request.amount,
            "expected_return_percent": plan["expected_return_percent"],
            "holding_period_months": plan.get("duration_months", 0),
            "start_date": start_date,
            "maturity_date": maturity_date,
            "status": "active",
            "created_at": start_date,
            "updated_at": start_date
        }

        result = investments_collection.insert_one(investment_doc)

        # Deduct from wallet balance
        new_balance = wallet_balance - request.amount
        users_collection.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"wallet_balance": new_balance}}
        )

        # Create transaction record
        transaction_doc = {
            "user_id": user_id,
            "transaction_type": "investment",
            "amount": request.amount,
            "status": "completed",
            "payment_method": "wallet",
            "reference_number": secrets.token_hex(16),
            "description": f"Investment in Options Plan: {plan['name']}",
            "investment_id": str(result.inserted_id),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        transactions_collection.insert_one(transaction_doc)

        return {
            "message": "Options plan activated successfully",
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
