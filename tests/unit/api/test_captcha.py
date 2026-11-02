"""Turnstile gate on public auth endpoints. Cloudflare's siteverify call is replaced by a fake."""
import httpx
import pytest

from app import captcha

LOGIN = {"email": "nobody@example.com", "password": "not-a-real-password"}


class FakeResponse:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data


class FakeClient:
    payload = {"success": True}
    error = None
    calls = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        FakeClient.calls.append((url, data))
        if FakeClient.error:
            raise FakeClient.error
        return FakeResponse(FakeClient.payload)


@pytest.fixture(autouse=True)
def captcha_env(monkeypatch):
    monkeypatch.delenv("CAPTCHA_DISABLED", raising=False)
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
    monkeypatch.delenv("TURNSTILE_SITE_KEY", raising=False)
    monkeypatch.setattr(captcha.httpx, "AsyncClient", FakeClient)
    FakeClient.payload = {"success": True}
    FakeClient.error = None
    FakeClient.calls = []
    yield


def test_config_reports_bypass_only_when_no_secret_is_set(client, monkeypatch):
    monkeypatch.setenv("CAPTCHA_DISABLED", "true")
    assert client.get("/api/captcha/config").json() == {"enabled": False, "site_key": ""}


def test_config_exposes_site_key_but_never_the_secret(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SITE_KEY", "site-123")
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-456")
    body = client.get("/api/captcha/config").json()
    assert body == {"enabled": True, "site_key": "site-123"}
    assert "secret-456" not in str(body)


def test_protected_route_fails_closed_without_secret_or_bypass(client):
    response = client.post("/api/auth/login", json=LOGIN)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "captcha_unavailable"


def test_missing_token_is_rejected_before_the_route_runs(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-456")
    response = client.post("/api/auth/login", json=LOGIN)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "captcha_required"
    assert FakeClient.calls == []


def test_failed_verification_is_rejected(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-456")
    FakeClient.payload = {"success": False, "error-codes": ["invalid-input-response"]}
    response = client.post("/api/auth/login", json=LOGIN, headers={"X-Captcha-Token": "bad"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "captcha_failed"


def test_successful_verification_lets_the_request_through(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-456")
    response = client.post("/api/auth/login", json=LOGIN, headers={"X-Captcha-Token": "good"})
    # The gate passed, so the normal login logic ran and rejected the unknown account.
    assert response.status_code == 401
    url, data = FakeClient.calls[0]
    assert url == captcha.SITEVERIFY_URL
    assert data["secret"] == "secret-456" and data["response"] == "good"


def test_siteverify_outage_fails_closed(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-456")
    FakeClient.error = httpx.ConnectError("unreachable")
    response = client.post("/api/auth/login", json=LOGIN, headers={"X-Captcha-Token": "good"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "captcha_unavailable"


def test_bypass_cannot_switch_off_a_configured_check(client, monkeypatch):
    monkeypatch.setenv("CAPTCHA_DISABLED", "true")
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-456")
    response = client.post("/api/auth/login", json=LOGIN)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "captcha_required"


def test_bypass_lets_development_requests_through(client, monkeypatch):
    monkeypatch.setenv("CAPTCHA_DISABLED", "true")
    response = client.post("/api/auth/login", json=LOGIN)
    assert response.status_code == 401
    assert FakeClient.calls == []
