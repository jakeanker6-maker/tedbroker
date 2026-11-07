from fastapi import APIRouter, HTTPException, status, Depends
from datetime import datetime
from bson import ObjectId
import base64
import os
from pathlib import Path

from app.schemas import (
    OnboardingPersonalInfo,
    OnboardingAddress,
    OnboardingKYC,
    OnboardingQuestionnaire,
    OnboardingStatus,
    UserResponse
)
from app.auth import get_current_user_token
from app.database import get_collection, USERS_COLLECTION

router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])

# Define upload directory for document photos
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "public" / "copytradingbroker.io" / "uploads" / "kyc"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def get_user_by_id(user_id: str):
    """Get user by ID from database"""
    users = get_collection(USERS_COLLECTION)
    try:
        return users.find_one({"_id": ObjectId(user_id)})
    except:
        return None


@router.get("/status", response_model=OnboardingStatus)
async def get_onboarding_status(current_user: dict = Depends(get_current_user_token)):
    """Check user's onboarding completion status"""
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check which onboarding steps are completed
    completed_steps = []
    onboarding_data = user.get("onboarding", {})

    # Check personal info
    if onboarding_data.get("personal_info_completed"):
        completed_steps.append("personal_info")

    # Check address
    if onboarding_data.get("address_completed"):
        completed_steps.append("address")

    # Check KYC
    if onboarding_data.get("kyc_completed"):
        completed_steps.append("kyc")

    # Determine if onboarding is complete
    is_complete = len(completed_steps) == 3

    # Determine current step
    current_step = None
    if not is_complete:
        if "personal_info" not in completed_steps:
            current_step = "personal_info"
        elif "address" not in completed_steps:
            current_step = "address"
        elif "kyc" not in completed_steps:
            current_step = "kyc"

    return OnboardingStatus(
        is_onboarding_complete=is_complete,
        current_step=current_step,
        completed_steps=completed_steps,
        questionnaire_completed=bool(onboarding_data.get("questionnaire_completed", False))
    )


@router.post("/personal-info")
async def submit_personal_info(
    personal_info: OnboardingPersonalInfo,
    current_user: dict = Depends(get_current_user_token)
):
    """Submit personal information step"""
    users = get_collection(USERS_COLLECTION)
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Update user with personal info
    update_data = {
        "onboarding.first_name": personal_info.first_name,
        "onboarding.last_name": personal_info.last_name,
        "onboarding.gender": personal_info.gender,
        "onboarding.personal_info_completed": True,
        "updated_at": datetime.utcnow()
    }

    # Also update the main user fields for convenience
    update_data["full_name"] = f"{personal_info.first_name} {personal_info.last_name}"
    update_data["gender"] = personal_info.gender

    users.update_one(
        {"_id": ObjectId(current_user["user_id"])},
        {"$set": update_data}
    )

    return {
        "message": "Personal information saved successfully",
        "step": "personal_info",
        "completed": True
    }


@router.post("/address")
async def submit_address(
    address: OnboardingAddress,
    current_user: dict = Depends(get_current_user_token)
):
    """Submit address information step"""
    users = get_collection(USERS_COLLECTION)
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if personal info is completed
    onboarding_data = user.get("onboarding", {})
    if not onboarding_data.get("personal_info_completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please complete personal information first"
        )

    # Update user with address info
    update_data = {
        "onboarding.street": address.street,
        "onboarding.city": address.city,
        "onboarding.state": address.state,
        "onboarding.zip_code": address.zip_code,
        "onboarding.country": address.country,
        "onboarding.address_completed": True,
        "updated_at": datetime.utcnow()
    }

    # Also update the main country field
    update_data["country"] = address.country

    users.update_one(
        {"_id": ObjectId(current_user["user_id"])},
        {"$set": update_data}
    )

    return {
        "message": "Address information saved successfully",
        "step": "address",
        "completed": True
    }


@router.post("/kyc")
async def submit_kyc(
    kyc: OnboardingKYC,
    current_user: dict = Depends(get_current_user_token)
):
    """Submit KYC document information step"""
    users = get_collection(USERS_COLLECTION)
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if address is completed
    onboarding_data = user.get("onboarding", {})
    if not onboarding_data.get("address_completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please complete address information first"
        )

    # Process document photo
    document_photo_path = None
    try:
        # Check if it's a base64 encoded image
        if kyc.document_photo.startswith('data:image'):
            # Extract base64 data
            header, encoded = kyc.document_photo.split(',', 1)
            file_ext = header.split('/')[1].split(';')[0]

            # Decode base64
            file_data = base64.b64decode(encoded)

            # Generate unique filename
            filename = f"{current_user['user_id']}_{datetime.utcnow().timestamp()}.{file_ext}"
            file_path = UPLOAD_DIR / filename

            # Save file
            with open(file_path, 'wb') as f:
                f.write(file_data)

            # Store relative path
            document_photo_path = f"/uploads/kyc/{filename}"
        else:
            # Assume it's already a file path
            document_photo_path = kyc.document_photo

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to process document photo: {str(e)}"
        )

    # Update user with KYC info
    update_data = {
        "onboarding.document_number": kyc.document_number,
        "onboarding.document_photo": document_photo_path,
        "onboarding.kyc_completed": True,
        "onboarding.kyc_submitted_at": datetime.utcnow(),
        "onboarding.kyc_status": "pending_review",  # pending_review, approved, rejected
        "onboarding.completed_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }

    users.update_one(
        {"_id": ObjectId(current_user["user_id"])},
        {"$set": update_data}
    )

    return {
        "message": "KYC information submitted successfully",
        "step": "kyc",
        "completed": True,
        "kyc_status": "pending_review"
    }


@router.get("/data")
async def get_onboarding_data(current_user: dict = Depends(get_current_user_token)):
    """Get user's onboarding data"""
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    onboarding_data = user.get("onboarding", {})

    return {
        "personal_info": {
            "first_name": onboarding_data.get("first_name"),
            "last_name": onboarding_data.get("last_name"),
            "gender": onboarding_data.get("gender"),
            "completed": onboarding_data.get("personal_info_completed", False)
        },
        "address": {
            "street": onboarding_data.get("street"),
            "city": onboarding_data.get("city"),
            "state": onboarding_data.get("state"),
            "zip_code": onboarding_data.get("zip_code"),
            "country": onboarding_data.get("country"),
            "completed": onboarding_data.get("address_completed", False)
        },
        "kyc": {
            "document_number": onboarding_data.get("document_number"),
            "document_photo": onboarding_data.get("document_photo"),
            "status": onboarding_data.get("kyc_status", "not_submitted"),
            "completed": onboarding_data.get("kyc_completed", False),
            "submitted_at": onboarding_data.get("kyc_submitted_at")
        }
    }


@router.get("/questionnaire-status")
async def get_questionnaire_status(current_user: dict = Depends(get_current_user_token)):
    """Check if user has completed the investment questionnaire"""
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    onboarding_data = user.get("onboarding", {})
    return {
        "completed": onboarding_data.get("questionnaire_completed", False)
    }


@router.post("/questionnaire")
async def submit_questionnaire(
    questionnaire: OnboardingQuestionnaire,
    current_user: dict = Depends(get_current_user_token)
):
    """Submit investment questionnaire"""
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # The questionnaire is the last onboarding step: it comes after KYC and before the pending review
    if not user.get("onboarding", {}).get("kyc_completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please complete identity verification first"
        )

    valid_risk = ["very_low", "low", "moderate", "high", "very_high"]
    valid_income = ["under_10k", "10k_50k", "50k_100k", "100k_1m", "over_1m"]
    valid_employment = ["unemployed", "self_employed", "part_time", "full_time", "retired"]

    if questionnaire.risk_tolerance not in valid_risk:
        raise HTTPException(status_code=400, detail="Invalid risk tolerance value")
    if questionnaire.annual_income not in valid_income:
        raise HTTPException(status_code=400, detail="Invalid annual income value")
    if questionnaire.employment_status not in valid_employment:
        raise HTTPException(status_code=400, detail="Invalid employment status value")

    users = get_collection(USERS_COLLECTION)
    users.update_one(
        {"_id": ObjectId(current_user["user_id"])},
        {"$set": {
            "onboarding.risk_tolerance": questionnaire.risk_tolerance,
            "onboarding.annual_income": questionnaire.annual_income,
            "onboarding.employment_status": questionnaire.employment_status,
            "onboarding.questionnaire_completed": True,
            "onboarding.questionnaire_submitted_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }}
    )

    return {
        "message": "Investment questionnaire submitted successfully",
        "completed": True
    }
