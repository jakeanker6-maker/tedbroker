"""Google OAuth routes: config, redirect URL, callback success and failure paths.

Google is never contacted. The token exchange and ID token check are patched.
"""
from urllib.parse import parse_qs, urlparse
from unittest.mock import MagicMock, patch

import pytest

from app.database import get_collection, USERS_COLLECTION
from app.routes import auth as auth_routes

CLIENT_ID = "test-client.apps.googleusercontent.com"
CLIENT_SECRET = "test-secret"
REDIRECT_URI = "https://tedbrokers.com/api/auth/google/callback"


@pytest.fixture
def google_config(monkeypatch):
    monkeypatch.setattr(auth_routes, "GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setattr(auth_routes, "GOOGLE_CLIENT_SECRET", CLIENT_SECRET)
    monkeypatch.setattr(auth_routes, "GOOGLE_REDIRECT_URI", REDIRECT_URI)


@pytest.fixture
def no_side_effects():
    """Stop emails and IP geolocation lookups from leaving the test."""
    with patch.object(auth_routes.email_service, "send_login_notification", return_value=True), \
         patch.object(auth_routes.login_history_service, "get_location_from_ip", return_value={}):
        yield


def _token_response(ok=True, body=None):
    resp = MagicMock()
    resp.ok = ok
    resp.status_code = 200 if ok else 400
    resp.text = "error body"
    resp.json.return_value = body or {"id_token": "fake-id-token"}
    resp.raise_for_status.side_effect = None if ok else Exception("bad request")
    return resp


def test_login_redirect_is_encoded_and_uses_config(client, google_config):
    resp = client.get("/api/auth/google/login", follow_redirects=False)
    assert resp.status_code in (302, 307)
    location = urlparse(resp.headers["location"])
    params = parse_qs(location.query)
    assert location.netloc == "accounts.google.com"
    assert params["client_id"] == [CLIENT_ID]
    assert params["redirect_uri"] == [REDIRECT_URI]
    assert params["response_type"] == ["code"]
    assert "openid email profile" in params["scope"][0]


def test_login_without_config_redirects_to_login_error(client, monkeypatch):
    monkeypatch.setattr(auth_routes, "GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(auth_routes, "GOOGLE_CLIENT_SECRET", "")
    monkeypatch.setattr(auth_routes, "GOOGLE_REDIRECT_URI", "")
    resp = client.get("/api/auth/google/login", follow_redirects=False)
    assert resp.headers["location"] == "/login?error=oauth_failed"


def test_callback_cancel_redirects_to_login_error(client, google_config):
    resp = client.get("/api/auth/google/callback?error=access_denied", follow_redirects=False)
    assert resp.headers["location"] == "/login?error=oauth_failed"


def test_callback_rejects_unverified_email(client, google_config, no_side_effects, fresh_db):
    claims = {"sub": "g-1", "email": "new@example.com", "email_verified": False}
    with patch.object(auth_routes.requests, "post", return_value=_token_response()), \
         patch.object(auth_routes.id_token, "verify_oauth2_token", return_value=claims):
        resp = client.get("/api/auth/google/callback?code=abc", follow_redirects=False)
    assert resp.headers["location"] == "/login?error=oauth_failed"
    assert get_collection(USERS_COLLECTION).find_one({"email": "new@example.com"}) is None


def test_callback_creates_new_user_and_returns_token(client, google_config, no_side_effects, fresh_db):
    claims = {"sub": "g-2", "email": "newtrader@example.com", "email_verified": True,
              "name": "New Trader", "picture": "https://example.com/p.png"}
    with patch.object(auth_routes.requests, "post", return_value=_token_response()) as post, \
         patch.object(auth_routes.id_token, "verify_oauth2_token", return_value=claims):
        resp = client.get("/api/auth/google/callback?code=abc", follow_redirects=False)

    sent = post.call_args.kwargs["data"]
    assert sent["redirect_uri"] == REDIRECT_URI
    assert sent["client_id"] == CLIENT_ID
    assert post.call_args.kwargs["timeout"] == 10

    location = resp.headers["location"]
    assert location.startswith("/login#token=")
    user = get_collection(USERS_COLLECTION).find_one({"email": "newtrader@example.com"})
    assert user is not None
    assert user["google_id"] == "g-2"
    assert user["auth_provider"] == "google"


def test_callback_token_exchange_failure_redirects_to_login_error(client, google_config, no_side_effects):
    with patch.object(auth_routes.requests, "post", return_value=_token_response(ok=False)):
        resp = client.get("/api/auth/google/callback?code=abc", follow_redirects=False)
    assert resp.headers["location"] == "/login?error=oauth_failed"
