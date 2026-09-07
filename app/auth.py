from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import os

# Security Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

# Password hashing context - using argon2 for better compatibility
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> dict:
    """Decode and verify a JWT access token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


async def get_current_user_token(token: str = Depends(oauth2_scheme)) -> dict:
    """Dependency to get current user from token"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    # Check if token has been blacklisted (e.g. user logged out)
    from app.database import get_collection, TOKEN_BLACKLIST_COLLECTION
    blacklist = get_collection(TOKEN_BLACKLIST_COLLECTION)
    if blacklist.find_one({"token": token}):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email: str = payload.get("sub")
    user_id: str = payload.get("user_id")
    role: str = payload.get("role")  # Extract role from token

    if email is None or user_id is None:
        raise credentials_exception

    # Return user data including role and raw token if present
    result = {"email": email, "user_id": user_id, "token": token}
    if role:
        result["role"] = role

    return result


async def get_current_user_with_access(current_user: dict = Depends(get_current_user_token)) -> dict:
    """
    Dependency to verify user has been granted dashboard access by admin.
    This should be used for all protected dashboard routes.
    """
    from app.database import get_collection, USERS_COLLECTION
    from bson import ObjectId

    # Get user from database to check access_granted status
    users = get_collection(USERS_COLLECTION)
    try:
        user = users.find_one({"_id": ObjectId(current_user["user_id"])})
    except:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user credentials"
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )

    # Check if user's access has been granted by admin
    if not user.get("access_granted", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dashboard access pending admin approval"
        )

    # Check if user is active
    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    return current_user
