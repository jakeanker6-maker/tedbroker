from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# MongoDB Configuration
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
# .env uses MONGODB_DB; DATABASE_NAME is kept as a fallback for older setups.
DATABASE_NAME = os.getenv("MONGODB_DB") or os.getenv("DATABASE_NAME", "tedbroker")

# Global MongoDB client
client = None
db = None


def _describe_url(url: str) -> str:
    """Describe the connection string without revealing the password."""
    import hashlib
    from urllib.parse import urlsplit
    parts = urlsplit(url)
    password = parts.password or ""
    return (
        f"scheme={parts.scheme} user={parts.username!r} host={parts.hostname!r} "
        f"path={parts.path!r} password_len={len(password)} "
        f"has_quotes={url[:1] in chr(34) + chr(39)} has_space={' ' in url} "
        f"sha256={hashlib.sha256(url.encode()).hexdigest()[:12]}"
    )


def connect_to_mongo():
    """Connect to MongoDB and return database instance"""
    global client, db
    print(f"MongoDB config: {_describe_url(MONGODB_URL)} db={DATABASE_NAME!r}")
    try:
        client = MongoClient(MONGODB_URL)
        # Test the connection
        client.admin.command('ping')
        db = client[DATABASE_NAME]
        print(f"✓ Successfully connected to MongoDB: {DATABASE_NAME}")
        return db
    except ConnectionFailure as e:
        print(f"✗ Failed to connect to MongoDB: {e}")
        raise


def close_mongo_connection():
    """Close MongoDB connection"""
    global client
    if client:
        client.close()
        print("✓ MongoDB connection closed")


def get_database():
    """Get database instance"""
    global db
    if db is None:
        db = connect_to_mongo()
    return db


def get_collection(collection_name: str):
    """Get a specific collection from the database"""
    database = get_database()
    return database[collection_name]


# Collection names
USERS_COLLECTION = "users"
TRADERS_COLLECTION = "expert_traders"
INVESTMENT_PLANS_COLLECTION = "investment_plans"
ETF_PLANS_COLLECTION = "etf_plans"
DEFI_PLANS_COLLECTION = "defi_plans"
OPTIONS_PLANS_COLLECTION = "options_plans"
TRANSACTIONS_COLLECTION = "transactions"
DEPOSIT_REQUESTS_COLLECTION = "deposit_requests"
CRYPTO_WALLETS_COLLECTION = "crypto_wallets"
BANK_ACCOUNTS_COLLECTION = "bank_accounts"
USER_INVESTMENTS_COLLECTION = "user_investments"
USER_BANK_ACCOUNTS_COLLECTION = "user_bank_accounts"
USER_CRYPTO_ADDRESSES_COLLECTION = "user_crypto_addresses"
WITHDRAWAL_REQUESTS_COLLECTION = "withdrawal_requests"
CHAT_CONVERSATIONS_COLLECTION = "chat_conversations"
CHAT_MESSAGES_COLLECTION = "chat_messages"
NOTIFICATIONS_COLLECTION = "notifications"
TOKEN_BLACKLIST_COLLECTION = "token_blacklist"

# Trading Hub / unified ledger
LEDGER_ENTRIES_COLLECTION = "ledger_entries"
