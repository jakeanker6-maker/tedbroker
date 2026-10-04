import pytest
from fastapi.testclient import TestClient
import sys
sys.path.insert(0, '/home/taliban/websites/tedbroker.com/.worktrees/plan-tagging')
from main import app
from app.auth import create_access_token, get_password_hash
from app.database import get_collection
from bson import ObjectId


@pytest.fixture(scope="session")
def client():
    """Test client fixture"""
    return TestClient(app)


@pytest.fixture(scope="session")
def admin_token(client):
    """Create an admin user in DB and return a valid token"""
    admins = get_collection("admins")
    
    # Delete any existing test admin
    admins.delete_many({"username": "testadmin"})
    
    # Create test admin
    admin_id = ObjectId()
    admin_dict = {
        "_id": admin_id,
        "username": "testadmin",
        "email": "testadmin@test.com",
        "hashed_password": get_password_hash("testpassword123"),
        "full_name": "Test Admin",
        "role": "admin",
        "is_active": True,
        "created_at": None,
        "updated_at": None,
        "last_login": None
    }
    admins.insert_one(admin_dict)
    
    # Create access token
    access_token = create_access_token(
        data={
            "sub": "testadmin",
            "user_id": str(admin_id),
            "role": "admin"
        }
    )
    yield access_token
    
    # Cleanup
    admins.delete_many({"username": "testadmin"})


@pytest.fixture(scope="session")
def user_token(client):
    """Create a regular user in DB and return a valid token"""
    users = get_collection("users")
    
    # Delete any existing test user
    users.delete_many({"email": "testuser@test.com"})
    
    # Create test user
    user_id = ObjectId()
    user_dict = {
        "_id": user_id,
        "username": "testuser",
        "email": "testuser@test.com",
        "hashed_password": get_password_hash("testpassword123"),
        "full_name": "Test User",
        "wallet_balance": 10000.0,
        "is_active": True,
        "is_verified": True,
        "access_granted": True,
        "two_fa_enabled": False,
        "auth_provider": "local",
        "created_at": None,
        "updated_at": None
    }
    users.insert_one(user_dict)
    
    # Create access token
    access_token = create_access_token(
        data={
            "sub": "testuser",
            "user_id": str(user_id),
            "role": "user"
        }
    )
    yield access_token
    
    # Cleanup
    users.delete_many({"email": "testuser@test.com"})