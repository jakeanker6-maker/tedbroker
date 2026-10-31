"""Shared test configuration.

All tests run against an in-memory mongomock database. Nothing here touches the
MongoDB configured in .env, so the suite is safe to run on any machine.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import mongomock  # noqa: E402
import pytest  # noqa: E402

import app.database as database  # noqa: E402

# Install the mock before anything calls get_database().
database.client = mongomock.MongoClient()
database.db = database.client["tedbroker_test"]

from bson import ObjectId  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import create_access_token, get_password_hash  # noqa: E402
from app.database import get_collection  # noqa: E402


@pytest.fixture
def fresh_db():
    """Give a test an empty database and restore the shared one afterwards."""
    previous = database.db
    database.db = database.client[f"tedbroker_test_{ObjectId()}"]
    try:
        yield database.db
    finally:
        database.client.drop_database(database.db.name)
        database.db = previous


@pytest.fixture(scope="session")
def client():
    """Test client. Not used as a context manager, so startup jobs do not run."""
    from main import app
    return TestClient(app)


@pytest.fixture(scope="session")
def admin_token(client):
    admins = get_collection("admins")
    admins.delete_many({"username": "testadmin"})
    admin_id = ObjectId()
    admins.insert_one({
        "_id": admin_id,
        "username": "testadmin",
        "email": "testadmin@test.com",
        "hashed_password": get_password_hash("testpassword123"),
        "full_name": "Test Admin",
        "role": "admin",
        "is_active": True,
        "created_at": None,
        "updated_at": None,
        "last_login": None,
    })
    yield create_access_token(data={"sub": "testadmin", "user_id": str(admin_id), "role": "admin"})
    admins.delete_many({"username": "testadmin"})


@pytest.fixture(scope="session")
def user_token(client):
    users = get_collection("users")
    users.delete_many({"email": "testuser@test.com"})
    user_id = ObjectId()
    users.insert_one({
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
    })
    yield create_access_token(data={"sub": "testuser", "user_id": str(user_id), "role": "user"})
    users.delete_many({"email": "testuser@test.com"})
