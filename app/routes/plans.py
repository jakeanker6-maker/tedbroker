from fastapi import APIRouter, HTTPException, Depends
from typing import List
from bson import ObjectId

from app.database import get_collection, INVESTMENT_PLANS_COLLECTION
from app.schemas import InvestmentPlanResponse
from app.auth import get_current_user_token

router = APIRouter(prefix="/api/plans", tags=["investment_plans"])


def plan_helper(plan) -> dict:
    """Helper function to format investment plan data from database"""
    return {
        "id": str(plan["_id"]),
        "name": plan["name"],
        "description": plan["description"],
        "minimum_investment": plan["minimum_investment"],
        "holding_period_months": plan["holding_period_months"],
        "expected_return_percent": plan["expected_return_percent"],
        "current_subscribers": plan["current_subscribers"],
        "is_active": plan.get("is_active", True),
        "tags": plan.get("tags", [])
    }


@router.get("/", response_model=List[InvestmentPlanResponse])
async def get_all_plans(current_user: dict = Depends(get_current_user_token)):
    """
    Get all active investment plans
    Requires authentication
    """
    try:
        plans_collection = get_collection(INVESTMENT_PLANS_COLLECTION)
        plans = []

        # Only get active plans
        for plan in plans_collection.find({"is_active": True}):
            plans.append(plan_helper(plan))

        return plans
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving investment plans: {str(e)}")


@router.get("/{plan_id}", response_model=InvestmentPlanResponse)
async def get_plan_by_id(plan_id: str, current_user: dict = Depends(get_current_user_token)):
    """
    Get a specific investment plan by ID
    Requires authentication
    """
    try:
        plans_collection = get_collection(INVESTMENT_PLANS_COLLECTION)
        plan = plans_collection.find_one({"_id": ObjectId(plan_id)})

        if not plan:
            raise HTTPException(status_code=404, detail="Investment plan not found")

        return plan_helper(plan)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error retrieving investment plan: {str(e)}")
