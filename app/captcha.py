"""Cloudflare Turnstile verification for public auth endpoints.

Clients send the widget token in the ``X-Captcha-Token`` header. The token is checked
server side with Cloudflare's siteverify API before the route runs.

Configuration (environment):
  TURNSTILE_SITE_KEY    public key, served to the browser by GET /api/captcha/config
  TURNSTILE_SECRET_KEY  secret key, never sent to the browser

Fail-closed rules:
  * A secret is configured: every protected request must pass verification.
  * No secret and CAPTCHA_DISABLED=true: development and test bypass, verification skipped.
  * No secret and no bypass: protected requests return 503 instead of passing unchecked.
"""
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TOKEN_HEADER = "X-Captcha-Token"
MAX_TOKEN_LENGTH = 2048

router = APIRouter(prefix="/api/captcha", tags=["Security"])


def _secret() -> str:
    return os.getenv("TURNSTILE_SECRET_KEY", "").strip()


def _site_key() -> str:
    return os.getenv("TURNSTILE_SITE_KEY", "").strip()


def _bypass_allowed() -> bool:
    # The bypass only applies when no secret is configured, so it cannot switch off a live check.
    return not _secret() and os.getenv("CAPTCHA_DISABLED", "false").strip().lower() == "true"


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={"code": "captcha_unavailable", "message": "The security check is unavailable. Please try again later."},
    )


@router.get("/config")
async def captcha_config():
    """Public widget settings for the browser. Contains only the site key."""
    if _bypass_allowed():
        return {"enabled": False, "site_key": ""}
    return {"enabled": True, "site_key": _site_key()}


async def require_captcha(request: Request) -> None:
    """FastAPI dependency: reject the request unless the Turnstile token verifies."""
    if _bypass_allowed():
        return
    secret = _secret()
    if not secret:
        raise _unavailable()

    token = request.headers.get(TOKEN_HEADER, "").strip()
    if not token or len(token) > MAX_TOKEN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "captcha_required", "message": "Please complete the security check."},
        )

    payload = {"secret": secret, "response": token}
    if request.client:
        payload["remoteip"] = request.client.host

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(SITEVERIFY_URL, data=payload)
            result = res.json()
    except (httpx.HTTPError, ValueError):
        raise _unavailable()

    if not isinstance(result, dict) or result.get("success") is not True:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "captcha_failed", "message": "The security check failed. Please try again."},
        )
