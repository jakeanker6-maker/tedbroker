from fastapi import APIRouter, HTTPException, status, Depends, Request
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse
from datetime import datetime, timedelta
from bson import ObjectId
from typing import Optional
import os
import requests
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from app.schemas import (
    UserRegister, UserLogin, Token, UserResponse, PasswordChange,
    ForgotPasswordRequest, VerifyPasswordResetCode, ResetPasswordRequest,
    PasswordChangeWithVerification, CreatePasswordRequest, VerifyPasswordCreation
)
from app.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user_token,
    ACCESS_TOKEN_EXPIRE_MINUTES
)
from app.database import get_collection, USERS_COLLECTION
from app.twofa_service import twofa_service
from app.email_service import email_service
from app.login_history import login_history_service
from app.security_alerts import security_alerts_service
from app.smartsupp_service import smartsupp_service
from app.rate_limiter import limiter, get_rate_limit
from app.referrals_service import referrals_service
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# Pydantic models for 2FA
class TwoFAVerify(BaseModel):
    email: str
    code: str


class TwoFAResponse(BaseModel):
    message: str
    requires_2fa: bool = False


def get_user_by_email(email: str):
    """Get user by email from database"""
    users = get_collection(USERS_COLLECTION)
    return users.find_one({"email": email})


def get_user_by_username(username: str):
    """Get user by username from database"""
    users = get_collection(USERS_COLLECTION)
    return users.find_one({"username": username})


def get_user_by_id(user_id: str):
    """Get user by ID from database"""
    users = get_collection(USERS_COLLECTION)
    try:
        return users.find_one({"_id": ObjectId(user_id)})
    except:
        return None


@router.post("/register")
@limiter.limit(get_rate_limit("register"))
async def register(request: Request, user_data: UserRegister):
    """Register a new user and send 2FA verification code"""
    print(f"DEBUG: Received registration data: {user_data.model_dump()}")
    users = get_collection(USERS_COLLECTION)

    # Check if user already exists
    if get_user_by_email(user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    if get_user_by_username(user_data.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )

    # Create user document
    user_dict = {
        "email": user_data.email,
        "username": user_data.username,
        "hashed_password": get_password_hash(user_data.password),
        "full_name": user_data.full_name,
        "phone": user_data.phone,
        "gender": user_data.gender,
        "country": user_data.country,
        "account_types": user_data.account_types if user_data.account_types else [],
        "wallet_balance": 0.0,  # New users start with zero balance
        "is_active": True,
        "is_verified": False,
        "two_fa_enabled": False,  # 2FA disabled by default
        "access_granted": False,  # Requires admin approval to access dashboard
        "auth_provider": "local",  # Local registration
        "google_id": None,
        "profile_picture": None,
        "selected_traders": [],  # New users start with no traders selected
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }

    # Insert user into database
    result = users.insert_one(user_dict)
    user_dict["_id"] = result.inserted_id

    # Generate unique referral code for the new user
    try:
        referral_code = referrals_service.create_referral_link(str(user_dict["_id"]))
        print(f"Generated referral code for user {user_dict['username']}: {referral_code}")
    except Exception as e:
        print(f"Failed to generate referral code: {e}")

    # Generate 2FA code for email verification
    code = twofa_service.create_2fa_session(
        email=user_dict["email"],
        user_id=str(user_dict["_id"])
    )

    # Send 2FA code via email
    email_sent = email_service.send_2fa_code(
        to_email=user_dict["email"],
        code=code,
        username=user_dict["full_name"]
    )

    if not email_sent:
        # If SendGrid is not configured, log the code for testing
        print(f"2FA Code for {user_dict['email']}: {code}")

    # Return response indicating 2FA is required
    if email_sent:
        message = "Registration successful. Please verify your email with the code sent to you."
    else:
        message = "Registration successful. Email delivery failed - please use the code below to verify your account."

    response = {
        "message": message,
        "requires_2fa": True,
        "email": user_dict["email"],
        "user_id": str(user_dict["_id"]),
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response


@router.post("/login")
@limiter.limit(get_rate_limit("login"))
async def login(request: Request, user_credentials: UserLogin):
    """Login user - sends 2FA code via email with security tracking"""
    # Get user from database
    user = get_user_by_email(user_credentials.email)

    if not user:
        # Record failed login attempt
        login_history_service.record_login_attempt(
            email=user_credentials.email,
            user_id=None,
            request=request,
            success=False,
            failure_reason="User not found"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify password
    if not verify_password(user_credentials.password, user["hashed_password"]):
        # Record failed login attempt
        login_history_service.record_login_attempt(
            email=user["email"],
            user_id=str(user["_id"]),
            request=request,
            success=False,
            failure_reason="Incorrect password"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user is active
    if not user.get("is_active", True):
        login_history_service.record_login_attempt(
            email=user["email"],
            user_id=str(user["_id"]),
            request=request,
            success=False,
            failure_reason="Account inactive"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    # Check if 2FA is enabled for this user
    two_fa_enabled = user.get("two_fa_enabled", False)

    # If 2FA is not enabled, log them in directly
    if not two_fa_enabled:
        # Record successful login
        login_history_service.record_login_attempt(
            email=user["email"],
            user_id=str(user["_id"]),
            request=request,
            success=True
        )

        # Send login notification email
        ip_address = login_history_service.get_ip_address(request)
        device_info = login_history_service.get_device_info(request)
        location = login_history_service.get_location_from_ip(ip_address)
        username = user.get("full_name", user.get("username", "User"))

        try:
            email_service.send_login_notification(
                to_email=user["email"],
                username=username,
                ip_address=ip_address,
                device_info=device_info,
                location=location
            )
        except Exception as e:
            print(f"Failed to send login notification email: {e}")

        # Send Smartsupp login alert
        try:
            smartsupp_service.send_login_alert(
                email=user["email"],
                username=username,
                ip_address=ip_address,
                device_info=device_info,
                location=location
            )
        except Exception as e:
            print(f"Failed to send Smartsupp login alert: {e}")

        # Create access token immediately
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": user["email"], "user_id": str(user["_id"])},
            expires_delta=access_token_expires
        )

        return {
            "message": "Login successful",
            "requires_2fa": False,
            "access_token": access_token,
            "token_type": "bearer"
        }

    # If 2FA is enabled, proceed with 2FA flow
    # Check for suspicious activity
    suspicious_activity = login_history_service.check_suspicious_activity(
        email=user["email"],
        request=request
    )

    # Send security alert if suspicious
    if suspicious_activity.get("is_suspicious"):
        ip_address = login_history_service.get_ip_address(request)
        device_info = login_history_service.get_device_info(request)
        location = login_history_service.get_location_from_ip(ip_address)
        username = user.get("full_name", user.get("username", "User"))

        # Send alert email (non-blocking)
        try:
            security_alerts_service.send_suspicious_login_alert(
                email=user["email"],
                username=username,
                suspicious_activity=suspicious_activity,
                ip_address=ip_address,
                device_info=device_info,
                location=location
            )
        except Exception as e:
            print(f"Failed to send security alert: {e}")

    # Generate 2FA code
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Send 2FA code via email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_2fa_code(
        to_email=user["email"],
        code=code,
        username=username
    )

    if not email_sent:
        # If SendGrid is not configured, log the code for testing
        print(f"2FA Code for {user['email']}: {code}")

    if email_sent:
        message = "Verification code sent to your email"
    else:
        message = "Email delivery failed - please use the code below to verify your login."

    response = {
        "message": message,
        "requires_2fa": True,
        "email": user["email"],
        "security_alert": suspicious_activity.get("is_suspicious", False),
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response


@router.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    """OAuth2 compatible token login (for Swagger UI)"""
    # Get user from database (username field contains email)
    user = get_user_by_email(form_data.username)

    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user is active
    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["email"], "user_id": str(user["_id"])},
        expires_delta=access_token_expires
    )

    return Token(access_token=access_token, token_type="bearer")


@router.get("/me", response_model=UserResponse)
async def get_current_user(current_user: dict = Depends(get_current_user_token)):
    """Get current authenticated user"""
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return UserResponse(
        id=str(user["_id"]),
        email=user["email"],
        username=user["username"],
        full_name=user.get("full_name"),
        phone=user.get("phone"),
        gender=user.get("gender"),
        country=user.get("country"),
        account_types=user.get("account_types", []),
        wallet_balance=user.get("wallet_balance", 0.0),
        copy_trading_allocation=user.get("copy_trading_allocation", 0.0),
        is_active=user.get("is_active", True),
        is_verified=user.get("is_verified", False),
        two_fa_enabled=user.get("two_fa_enabled", False),
        auth_provider=user.get("auth_provider", "local"),
        has_password=bool(user.get("hashed_password")),
        access_granted=user.get("access_granted", False),
        selected_traders=user.get("selected_traders", []),
        created_at=user["created_at"],
        updated_at=user["updated_at"]
    )


@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: dict = Depends(get_current_user_token)
):
    """Change user password"""
    users = get_collection(USERS_COLLECTION)

    # Get user from database
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify old password
    if not verify_password(password_data.old_password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect old password"
        )

    # Update password
    users.update_one(
        {"_id": ObjectId(current_user["user_id"])},
        {
            "$set": {
                "hashed_password": get_password_hash(password_data.new_password),
                "updated_at": datetime.utcnow()
            }
        }
    )

    return {"message": "Password changed successfully"}


class UpdateProfile(BaseModel):
    """Schema for updating user profile"""
    full_name: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[str] = None
    country: Optional[str] = None


@router.put("/update-profile", response_model=UserResponse)
async def update_profile(
    profile_data: UpdateProfile,
    current_user: dict = Depends(get_current_user_token)
):
    """Update user profile information"""
    users = get_collection(USERS_COLLECTION)

    # Get user from database
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Prepare update data
    update_data = {"updated_at": datetime.utcnow()}

    if profile_data.full_name is not None:
        update_data["full_name"] = profile_data.full_name

    if profile_data.phone is not None:
        update_data["phone"] = profile_data.phone

    if profile_data.gender is not None:
        if profile_data.gender and profile_data.gender not in ['Male', 'Female', 'Others', '']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Gender must be Male, Female, or Others"
            )
        update_data["gender"] = profile_data.gender if profile_data.gender else None

    if profile_data.country is not None:
        update_data["country"] = profile_data.country

    # Update user
    users.update_one(
        {"_id": ObjectId(current_user["user_id"])},
        {"$set": update_data}
    )

    # Fetch updated user
    updated_user = get_user_by_id(current_user["user_id"])

    return UserResponse(
        id=str(updated_user["_id"]),
        email=updated_user["email"],
        username=updated_user["username"],
        full_name=updated_user.get("full_name"),
        phone=updated_user.get("phone"),
        gender=updated_user.get("gender"),
        country=updated_user.get("country"),
        account_types=updated_user.get("account_types", []),
        wallet_balance=updated_user.get("wallet_balance", 0.0),
        is_active=updated_user.get("is_active", True),
        is_verified=updated_user.get("is_verified", False),
        two_fa_enabled=updated_user.get("two_fa_enabled", False),
        auth_provider=updated_user.get("auth_provider", "local"),
        has_password=bool(updated_user.get("hashed_password")),
        access_granted=updated_user.get("access_granted", False),
        selected_traders=updated_user.get("selected_traders", []),
        created_at=updated_user["created_at"],
        updated_at=updated_user["updated_at"]
    )


@router.delete("/delete-account")
async def delete_account(current_user: dict = Depends(get_current_user_token)):
    """Delete user account"""
    users = get_collection(USERS_COLLECTION)

    # Delete user
    result = users.delete_one({"_id": ObjectId(current_user["user_id"])})

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return {"message": "Account deleted successfully"}


@router.post("/verify-2fa", response_model=Token)
@limiter.limit(get_rate_limit("verify_2fa"))
async def verify_2fa(request: Request, verification_data: TwoFAVerify):
    """Verify 2FA code and return access token with login history tracking"""
    # Verify the code
    result = twofa_service.verify_code(
        email=verification_data.email,
        code=verification_data.code
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )

    # Get user
    user = get_user_by_email(verification_data.email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Mark user as verified if not already verified
    users = get_collection(USERS_COLLECTION)
    if not user.get("is_verified", False):
        users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "is_verified": True,
                    "updated_at": datetime.utcnow()
                }
            }
        )
        print(f"User {user['email']} marked as verified")

    # Record successful login
    login_history_service.record_login_attempt(
        email=user["email"],
        user_id=str(user["_id"]),
        request=request,
        success=True
    )

    # Send login notification email
    ip_address = login_history_service.get_ip_address(request)
    device_info = login_history_service.get_device_info(request)
    location = login_history_service.get_location_from_ip(ip_address)
    username = user.get("full_name", user.get("username", "User"))

    try:
        email_service.send_login_notification(
            to_email=user["email"],
            username=username,
            ip_address=ip_address,
            device_info=device_info,
            location=location
        )
    except Exception as e:
        print(f"Failed to send login notification email: {e}")

    # Send Smartsupp login alert
    try:
        smartsupp_service.send_login_alert(
            email=user["email"],
            username=username,
            ip_address=ip_address,
            device_info=device_info,
            location=location
        )
    except Exception as e:
        print(f"Failed to send Smartsupp login alert: {e}")

    # Clean up 2FA session
    twofa_service.delete_session(verification_data.email)

    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["email"], "user_id": str(user["_id"])},
        expires_delta=access_token_expires
    )

    return Token(access_token=access_token, token_type="bearer")


@router.post("/resend-2fa")
@limiter.limit(get_rate_limit("resend_2fa"))
async def resend_2fa(request: Request, email_data: dict):
    """Resend 2FA verification code"""
    email = email_data.get("email")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required"
        )

    # Get user
    user = get_user_by_email(email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Generate new 2FA code
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Send code via email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_2fa_code(
        to_email=user["email"],
        code=code,
        username=username
    )

    if not email_sent:
        print(f"2FA Code for {user['email']}: {code}")

    if email_sent:
        message = "New verification code sent to your email"
    else:
        message = "Email delivery failed - please use the code below to verify your account."

    response = {
        "message": message,
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response


@router.get("/login-history")
async def get_login_history(
    current_user: dict = Depends(get_current_user_token),
    limit: int = 50,
    offset: int = 0
):
    """Get login history for current user"""
    history = login_history_service.get_user_login_history(
        user_id=current_user["user_id"],
        limit=limit,
        offset=offset
    )

    return {
        "history": history,
        "count": len(history)
    }


@router.get("/login-statistics")
async def get_login_statistics(
    current_user: dict = Depends(get_current_user_token),
    days: int = 30
):
    """Get login statistics for current user"""
    stats = login_history_service.get_login_statistics(
        user_id=current_user["user_id"],
        days=days
    )

    return stats


class Enable2FARequest(BaseModel):
    """Schema for enabling 2FA"""
    password: str


class Disable2FARequest(BaseModel):
    """Schema for disabling 2FA"""
    password: str
    code: str


@router.post("/enable-2fa")
async def enable_2fa(
    request_data: Enable2FARequest,
    current_user: dict = Depends(get_current_user_token)
):
    """Enable 2FA for the user account - sends verification code"""
    users = get_collection(USERS_COLLECTION)

    # Get user from database
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify password
    if not verify_password(request_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect password"
        )

    # Check if 2FA is already enabled
    if user.get("two_fa_enabled", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is already enabled for your account"
        )

    # Generate 2FA verification code
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Send verification code via email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_2fa_code(
        to_email=user["email"],
        code=code,
        username=username
    )

    if not email_sent:
        print(f"2FA Enable Code for {user['email']}: {code}")

    return {
        "message": "Verification code sent to your email. Please verify to enable 2FA.",
        "email": user["email"]
    }


@router.post("/verify-enable-2fa")
async def verify_enable_2fa(
    verification_data: TwoFAVerify,
    current_user: dict = Depends(get_current_user_token)
):
    """Verify code and enable 2FA"""
    users = get_collection(USERS_COLLECTION)

    # Get user
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify the code
    result = twofa_service.verify_code(
        email=user["email"],
        code=verification_data.code
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )

    # Enable 2FA for the user
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "two_fa_enabled": True,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # Clean up 2FA session
    twofa_service.delete_session(user["email"])

    return {
        "message": "2FA has been successfully enabled for your account",
        "two_fa_enabled": True
    }


@router.post("/disable-2fa")
async def disable_2fa(
    request_data: Disable2FARequest,
    current_user: dict = Depends(get_current_user_token)
):
    """Disable 2FA for the user account - requires password and current 2FA code"""
    users = get_collection(USERS_COLLECTION)

    # Get user from database
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify password
    if not verify_password(request_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect password"
        )

    # Check if 2FA is enabled
    if not user.get("two_fa_enabled", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled for your account"
        )

    # First, create a 2FA session to verify they have access to their email
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Verify the provided code
    result = twofa_service.verify_code(
        email=user["email"],
        code=request_data.code
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code"
        )

    # Disable 2FA
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "two_fa_enabled": False,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # Clean up 2FA session
    twofa_service.delete_session(user["email"])

    return {
        "message": "2FA has been successfully disabled for your account",
        "two_fa_enabled": False
    }


@router.post("/send-2fa-disable-code")
async def send_2fa_disable_code(
    current_user: dict = Depends(get_current_user_token)
):
    """Send verification code to disable 2FA"""
    # Get user
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if 2FA is enabled
    if not user.get("two_fa_enabled", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled for your account"
        )

    # Generate verification code
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Send code via email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_2fa_code(
        to_email=user["email"],
        code=code,
        username=username
    )

    if not email_sent:
        print(f"2FA Disable Code for {user['email']}: {code}")

    return {
        "message": "Verification code sent to your email",
        "email": user["email"]
    }


class UpdateEmailRequest(BaseModel):
    """Schema for updating email"""
    new_email: str
    password: str


@router.post("/request-email-update")
async def request_email_update(
    request_data: UpdateEmailRequest,
    current_user: dict = Depends(get_current_user_token)
):
    """Request email update - sends 2FA codes to both old and new email"""
    users = get_collection(USERS_COLLECTION)

    # Get user from database
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if user has Google OAuth authentication (no password)
    if user.get("auth_provider") == "google" and not user.get("hashed_password"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google accounts cannot update email. Please contact support."
        )

    # Verify password
    if not verify_password(request_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect password"
        )

    # Check if new email is already in use
    existing_user = get_user_by_email(request_data.new_email)
    if existing_user and str(existing_user["_id"]) != str(user["_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address is already in use"
        )

    # Check if new email is the same as current email
    if request_data.new_email.lower() == user["email"].lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New email must be different from current email"
        )

    # Generate 2FA code for new email
    code = twofa_service.create_2fa_session(
        email=request_data.new_email,
        user_id=str(user["_id"])
    )

    # Send verification code to new email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_2fa_code(
        to_email=request_data.new_email,
        code=code,
        username=username
    )

    if not email_sent:
        print(f"Email Update Code for {request_data.new_email}: {code}")

    return {
        "message": "Verification code sent to your new email address. Please verify to complete the email update.",
        "new_email": request_data.new_email
    }


class VerifyEmailUpdateRequest(BaseModel):
    """Schema for verifying email update"""
    new_email: str
    code: str


@router.post("/verify-email-update")
async def verify_email_update(
    request_data: VerifyEmailUpdateRequest,
    current_user: dict = Depends(get_current_user_token)
):
    """Verify 2FA code and update email"""
    users = get_collection(USERS_COLLECTION)

    # Get user
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify the code for new email
    result = twofa_service.verify_code(
        email=request_data.new_email,
        code=request_data.code
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )

    # Update email
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "email": request_data.new_email,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # Clean up 2FA session
    twofa_service.delete_session(request_data.new_email)

    # Create new access token with updated email
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": request_data.new_email, "user_id": str(user["_id"])},
        expires_delta=access_token_expires
    )

    return {
        "message": "Email has been successfully updated",
        "new_email": request_data.new_email,
        "access_token": access_token,
        "token_type": "bearer"
    }


# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")


@router.get("/google/login")
async def google_login():
    """Initiate Google OAuth flow"""
    google_auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"client_id={GOOGLE_CLIENT_ID}&"
        f"redirect_uri={GOOGLE_REDIRECT_URI}&"
        f"response_type=code&"
        f"scope=openid%20email%20profile&"
        f"access_type=offline&"
        f"prompt=consent"
    )
    return RedirectResponse(url=google_auth_url)


@router.get("/google/callback")
async def google_callback(code: str, request: Request):
    """Handle Google OAuth callback"""
    try:
        # Exchange code for tokens
        token_url = "https://oauth2.googleapis.com/token"
        token_data = {
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code"
        }

        token_response = requests.post(token_url, data=token_data)
        token_response.raise_for_status()
        tokens = token_response.json()

        # Verify ID token and get user info
        id_info = id_token.verify_oauth2_token(
            tokens["id_token"],
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )

        # Extract user information
        google_id = id_info["sub"]
        email = id_info["email"]
        full_name = id_info.get("name")
        profile_picture = id_info.get("picture")

        # Check if user exists
        users = get_collection(USERS_COLLECTION)
        user = users.find_one({"$or": [{"email": email}, {"google_id": google_id}]})

        if user:
            # User exists - log them in
            # Update Google info if needed
            update_data = {
                "updated_at": datetime.utcnow()
            }

            if not user.get("google_id"):
                update_data["google_id"] = google_id
                update_data["auth_provider"] = "google"

            if profile_picture:
                update_data["profile_picture"] = profile_picture

            users.update_one(
                {"_id": user["_id"]},
                {"$set": update_data}
            )

            # Record successful login
            login_history_service.record_login_attempt(
                email=user["email"],
                user_id=str(user["_id"]),
                request=request,
                success=True
            )

            # Send login notification email
            ip_address = login_history_service.get_ip_address(request)
            device_info = login_history_service.get_device_info(request)
            location = login_history_service.get_location_from_ip(ip_address)
            username = user.get("full_name", user.get("username", "User"))

            try:
                email_service.send_login_notification(
                    to_email=user["email"],
                    username=username,
                    ip_address=ip_address,
                    device_info=device_info,
                    location=location
                )
            except Exception as e:
                print(f"Failed to send login notification email: {e}")

            # Create access token
            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = create_access_token(
                data={"sub": user["email"], "user_id": str(user["_id"])},
                expires_delta=access_token_expires
            )

            # Redirect to dashboard with token as query parameter
            redirect_url = f"/dashboard?token={access_token}"
            return RedirectResponse(url=redirect_url)
        else:
            # New user - create account
            username = email.split("@")[0]  # Use email prefix as username

            # Check if username exists and make it unique
            base_username = username
            counter = 1
            while get_user_by_username(username):
                username = f"{base_username}{counter}"
                counter += 1

            # Create new user
            user_dict = {
                "email": email,
                "username": username,
                "hashed_password": None,  # No password for OAuth users
                "full_name": full_name,
                "phone": None,
                "gender": None,
                "country": None,
                "account_types": [],
                "wallet_balance": 0.0,
                "is_active": True,
                "is_verified": True,  # Google accounts are pre-verified
                "two_fa_enabled": False,
                "access_granted": False,  # Requires admin approval to access dashboard
                "auth_provider": "google",
                "google_id": google_id,
                "profile_picture": profile_picture,
                "selected_traders": [],
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }

            # Insert user
            result = users.insert_one(user_dict)
            user_dict["_id"] = result.inserted_id

            # Generate referral code
            try:
                referral_code = referrals_service.create_referral_link(str(user_dict["_id"]))
                print(f"Generated referral code for Google user {username}: {referral_code}")
            except Exception as e:
                print(f"Failed to generate referral code: {e}")

            # Record successful login
            login_history_service.record_login_attempt(
                email=user_dict["email"],
                user_id=str(user_dict["_id"]),
                request=request,
                success=True
            )

            # Send login notification email
            ip_address = login_history_service.get_ip_address(request)
            device_info = login_history_service.get_device_info(request)
            location = login_history_service.get_location_from_ip(ip_address)
            username = user_dict.get("full_name", user_dict.get("username", "User"))

            try:
                email_service.send_login_notification(
                    to_email=user_dict["email"],
                    username=username,
                    ip_address=ip_address,
                    device_info=device_info,
                    location=location
                )
            except Exception as e:
                print(f"Failed to send login notification email: {e}")

            # Create access token
            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = create_access_token(
                data={"sub": user_dict["email"], "user_id": str(user_dict["_id"])},
                expires_delta=access_token_expires
            )

            # Redirect to dashboard with token as query parameter
            redirect_url = f"/dashboard?token={access_token}"
            return RedirectResponse(url=redirect_url)

    except Exception as e:
        print(f"Google OAuth error: {e}")
        # Redirect to login page with error
        redirect_url = "/copytradingbroker.io/login.html?error=oauth_failed"
        return RedirectResponse(url=redirect_url)


@router.post("/forgot-password")
@limiter.limit(get_rate_limit("forgot_password"))
async def forgot_password(request: Request, forgot_data: ForgotPasswordRequest):
    """
    Initiate password reset by sending 2FA code to user's email
    """
    # Get user from database
    user = get_user_by_email(forgot_data.email)

    # For security, always return success even if user doesn't exist
    # This prevents email enumeration attacks
    if not user:
        # Still return success to prevent email enumeration
        return {
            "message": "If an account with this email exists, a verification code has been sent.",
            "email": forgot_data.email
        }

    # Check if user has a password (Google OAuth users without password can't reset)
    if not user.get("hashed_password"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account uses Google sign-in and does not have a password. Please sign in with Google."
        )

    # Generate 2FA code for password reset
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Send password reset code via email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_password_reset_code(
        to_email=user["email"],
        code=code,
        username=username
    )

    if not email_sent:
        print(f"Password Reset Code for {user['email']}: {code}")

    return {
        "message": "A verification code has been sent to your email address.",
        "email": user["email"]
    }


@router.post("/verify-password-reset-code")
@limiter.limit(get_rate_limit("verify_2fa"))
async def verify_password_reset_code(request: Request, verification_data: VerifyPasswordResetCode):
    """
    Verify the 2FA code for password reset
    Returns a temporary token that can be used to reset the password
    """
    # Verify the code
    result = twofa_service.verify_code(
        email=verification_data.email,
        code=verification_data.code
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )

    # Get user to ensure they exist
    user = get_user_by_email(verification_data.email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Create a temporary token for password reset (valid for 15 minutes)
    reset_token = create_access_token(
        data={
            "sub": user["email"],
            "user_id": str(user["_id"]),
            "purpose": "password_reset"
        },
        expires_delta=timedelta(minutes=15)
    )

    # Clean up 2FA session
    twofa_service.delete_session(verification_data.email)

    return {
        "message": "Verification successful. You can now reset your password.",
        "reset_token": reset_token
    }


@router.post("/reset-password")
@limiter.limit(get_rate_limit("reset_password"))
async def reset_password(request: Request, reset_data: ResetPasswordRequest):
    """
    Reset password using the temporary token from verification
    """
    # Decode and verify the reset token
    from app.auth import decode_access_token

    payload = decode_access_token(reset_data.token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )

    # Verify this is a password reset token
    if payload.get("purpose") != "password_reset":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid reset token"
        )

    user_id = payload.get("user_id")
    email = payload.get("sub")

    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid reset token"
        )

    # Get user from database
    user = get_user_by_id(user_id)

    if not user or user["email"] != email:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Update password
    users = get_collection(USERS_COLLECTION)
    users.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$set": {
                "hashed_password": get_password_hash(reset_data.new_password),
                "updated_at": datetime.utcnow()
            }
        }
    )

    return {
        "message": "Password has been reset successfully. You can now log in with your new password."
    }


@router.post("/change-password-with-verification")
async def change_password_with_verification(
    password_data: PasswordChangeWithVerification,
    current_user: dict = Depends(get_current_user_token)
):
    """
    Initiate password change from dashboard - sends 2FA code for verification
    """
    users = get_collection(USERS_COLLECTION)

    # Get user from database
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if user has a password (Google OAuth users without password can't change)
    if not user.get("hashed_password"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account uses Google sign-in and does not have a password."
        )

    # Verify old password
    if not verify_password(password_data.old_password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password"
        )

    # Generate 2FA code for password change verification
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Send verification code via email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_2fa_code(
        to_email=user["email"],
        code=code,
        username=username
    )

    if not email_sent:
        print(f"Password Change Code for {user['email']}: {code}")

    return {
        "message": "Verification code sent to your email. Please verify to complete password change.",
        "email": user["email"],
        "new_password_hash": get_password_hash(password_data.new_password)  # Temporarily store for verification
    }


class VerifyPasswordChange(BaseModel):
    """Schema for verifying password change"""
    code: str = Field(..., min_length=6, max_length=6)
    new_password_hash: str


@router.post("/verify-password-change")
async def verify_password_change(
    verification_data: VerifyPasswordChange,
    current_user: dict = Depends(get_current_user_token)
):
    """
    Verify 2FA code and complete password change
    """
    users = get_collection(USERS_COLLECTION)

    # Get user
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify the code
    result = twofa_service.verify_code(
        email=user["email"],
        code=verification_data.code
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )

    # Update password with the pre-hashed password
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "hashed_password": verification_data.new_password_hash,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # Clean up 2FA session
    twofa_service.delete_session(user["email"])

    return {
        "message": "Password has been changed successfully."
    }


@router.post("/create-password")
async def create_password(
    password_data: CreatePasswordRequest,
    current_user: dict = Depends(get_current_user_token)
):
    """
    Initiate password creation for Google OAuth users - sends 2FA code for verification
    """
    from app.schemas import CreatePasswordRequest

    users = get_collection(USERS_COLLECTION)

    # Get user from database
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if user is a Google OAuth user without password
    if user.get("hashed_password"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a password set up. Use 'Change Password' instead."
        )

    # Generate 2FA code for password creation verification
    code = twofa_service.create_2fa_session(
        email=user["email"],
        user_id=str(user["_id"])
    )

    # Send verification code via email
    username = user.get("full_name", user.get("username", "User"))
    email_sent = email_service.send_2fa_code(
        to_email=user["email"],
        code=code,
        username=username
    )

    if not email_sent:
        print(f"Password Creation Code for {user['email']}: {code}")

    return {
        "message": "Verification code sent to your email. Please verify to complete password creation.",
        "email": user["email"],
        "password_hash": get_password_hash(password_data.password)  # Temporarily store for verification
    }


@router.post("/verify-password-creation")
async def verify_password_creation(
    verification_data: VerifyPasswordCreation,
    current_user: dict = Depends(get_current_user_token)
):
    """
    Verify 2FA code and complete password creation for OAuth users
    """
    from app.schemas import VerifyPasswordCreation

    users = get_collection(USERS_COLLECTION)

    # Get user
    user = get_user_by_id(current_user["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if user already has a password
    if user.get("hashed_password"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a password set up"
        )

    # Verify the code
    result = twofa_service.verify_code(
        email=user["email"],
        code=verification_data.code
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )

    # Set password with the pre-hashed password
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "hashed_password": verification_data.password_hash,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # Clean up 2FA session
    twofa_service.delete_session(user["email"])

    return {
        "message": "Password has been created successfully. You can now login with either Google or your password."
    }
