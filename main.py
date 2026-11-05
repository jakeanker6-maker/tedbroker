from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import os
from pathlib import Path
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import asyncio

from app.database import connect_to_mongo, close_mongo_connection
from app.routes import admin_trading, documents
from app.routes import auth, traders, plans, etf_plans, defi_plans, options_plans, wallet, referrals, admin, deposits, investments, news, crypto_wallets, withdrawals, chat, onboarding, notifications, language, pageview, market, stream, trading, copy
from app.rate_limiter import limiter
from app.trade_scheduler import update_all_traders_trades  # noqa: F401  (kept for admin scripts)
from app.trading import events, funding, ledger
from app.market_data import feeds as market_feeds
from app.trading import engine as trading_engine


async def run_ledger_maintenance(interval_seconds: int = 300):
    """Finish postings interrupted by a crash and release expired withdrawal holds."""
    while True:
        try:
            await asyncio.to_thread(ledger.recover_pending)
            await asyncio.to_thread(funding.expire_stale_withdrawals)
        except Exception as exc:
            print(f"ledger maintenance error: {exc}")
        await asyncio.sleep(interval_seconds)

app = FastAPI(
    title="TED Broker API",
    description="RESTful API for TED Broker with authentication",
    version="1.0.0"
)

# Add rate limiter state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

def cors_origins() -> list:
    """The dashboard is served by this app (same origin), so CORS only matters for a separately
    hosted front end. Set CORS_ORIGINS to a comma-separated list of site origins; the default
    only allows local development hosts. Never `*`."""
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip() and o.strip() != "*"]
    if not origins:
        port = os.getenv("PORT", "8000")
        origins = [f"http://localhost:{port}", f"http://127.0.0.1:{port}",
                   "http://localhost:5500", "http://127.0.0.1:5500"]
    return origins


# CORS middleware. Auth is a Bearer token (not cookies), so credentials are not needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept-Language", "X-Requested-With"],
)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # Only add HSTS in production
        if not os.getenv("DEBUG", "false").lower() == "true":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# Include authentication routes
app.include_router(auth.router)
from app.captcha import router as captcha_router
app.include_router(captcha_router)
# Include traders routes
app.include_router(traders.router)
# Include investment plans routes
app.include_router(plans.router)
# Include ETF plans routes
app.include_router(etf_plans.router)
# Include DeFi plans routes
app.include_router(defi_plans.router)
# Include Options plans routes
app.include_router(options_plans.router)
# Include wallet routes
app.include_router(wallet.router)
# Include referrals routes
app.include_router(referrals.router)
# Include admin routes
app.include_router(admin.router)
app.include_router(admin_trading.router)
# Include deposits routes
app.include_router(deposits.router)
# Include investments routes
app.include_router(investments.router)
# Include news routes
app.include_router(news.router)
# Include crypto wallets routes
app.include_router(crypto_wallets.router)
# Include withdrawals routes
app.include_router(withdrawals.router)
# Include chat routes
app.include_router(chat.router)
# Include onboarding routes
app.include_router(onboarding.router)
# Include notifications routes
app.include_router(notifications.router)
# Include language routes
app.include_router(language.router)

# Include pageview routes
app.include_router(pageview.router)
app.include_router(market.router)
app.include_router(stream.router)
app.include_router(trading.router)
app.include_router(copy.router)
app.include_router(documents.router)


@app.on_event("startup")
async def startup_db_client():
    """Initialize database connection on startup"""
    connect_to_mongo()

    # Unified ledger: indexes + background maintenance.
    ledger.ensure_indexes()
    asyncio.create_task(run_ledger_maintenance())

    # Copy-trading balance check: warn (never block startup) if link cash and reserved cash disagree.
    try:
        from app.trading import copy_engine as _copy_engine
        for row in _copy_engine.copy_imbalances():
            print(f"[copy-balance] WARNING user {row['user_id']}: reserved {row['reserved_cents']} "
                  f"vs copy-link cash {row['link_cash_cents']} (gap {row['gap_cents']} cents). "
                  f"Run scripts/reconcile_copy.py.")
    except Exception as exc:
        print(f"[copy-balance] check skipped: {exc}")

    # Live account events (balance changes) and real-time market data feeds.
    events.bind_loop(asyncio.get_running_loop())
    ledger.add_listener(events.on_ledger_entry)
    if os.getenv("MARKET_FEEDS", "1") != "0":
        await market_feeds.start()
    if os.getenv("TRADING_ENGINE", "1") != "0":
        await trading_engine.start()

    # Trader activity comes from the trading bots (app/trading/bots.py, run by the engine),
    # which place real simulated orders at live prices. The old random trade generator
    # (app/trade_scheduler.py) is no longer started.


@app.on_event("shutdown")
async def shutdown_db_client():
    """Close database connection on shutdown"""
    await trading_engine.stop()
    await market_feeds.stop()
    close_mongo_connection()

# Get the base directory - current folder is the root
BASE_DIR = Path(__file__).resolve().parent
SITE_DIR = BASE_DIR  # Use current directory as site root

# Check if we have a public/copytradingbroker.io subdirectory and use it
if (BASE_DIR / "public" / "copytradingbroker.io").exists():
    SITE_DIR = BASE_DIR / "public" / "copytradingbroker.io"
# Otherwise check for public directory
elif (BASE_DIR / "public").exists():
    SITE_DIR = BASE_DIR / "public"

class RevalidatingStaticFiles(StaticFiles):
    """Static files that browsers must revalidate on every load (no-cache keeps the ETag
    check, so unchanged files still come from the browser cache). Stops stale page modules
    from running after a deploy."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Mount static files for assets (CSS, JS, images, etc)
if (SITE_DIR / "assets").exists():
    app.mount("/assets", RevalidatingStaticFiles(directory=str(SITE_DIR / "assets")), name="assets")

if (SITE_DIR / "temp").exists():
    app.mount("/temp", StaticFiles(directory=str(SITE_DIR / "temp")), name="temp")

if (SITE_DIR / "uploads").exists():
    app.mount("/uploads", StaticFiles(directory=str(SITE_DIR / "uploads")), name="uploads")

# Handle translate.google.com assets
if (SITE_DIR / "translate.google.com").exists():
    app.mount("/translate.google.com", StaticFiles(directory=str(SITE_DIR / "translate.google.com")), name="translate")


def read_html_file(file_path: Path) -> str:
    """Read and return HTML file content"""
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Page not found")

    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


@app.get("/", response_class=HTMLResponse)
async def home():
    """Serve the home page"""
    return read_html_file(SITE_DIR / "index.html")


@app.get("/index", response_class=HTMLResponse)
@app.get("/index.html", response_class=HTMLResponse)
async def index():
    """Serve the index page"""
    return read_html_file(SITE_DIR / "index.html")


@app.get("/about-us", response_class=HTMLResponse)
@app.get("/about-us.html", response_class=HTMLResponse)
async def about_us():
    """Serve the about us page"""
    return read_html_file(SITE_DIR / "about-us.html")


@app.get("/contact-us", response_class=HTMLResponse)
@app.get("/contact-us.html", response_class=HTMLResponse)
async def contact_us():
    """Serve the contact us page"""
    return read_html_file(SITE_DIR / "contact-us.html")


@app.get("/faqs", response_class=HTMLResponse)
@app.get("/faqs.html", response_class=HTMLResponse)
async def faqs():
    """Serve the FAQs page"""
    return read_html_file(SITE_DIR / "faqs.html")


@app.get("/investors", response_class=HTMLResponse)
@app.get("/investors.html", response_class=HTMLResponse)
async def investors():
    """Serve the investors page"""
    return read_html_file(SITE_DIR / "investors.html")


@app.get("/traders", response_class=HTMLResponse)
@app.get("/traders.html", response_class=HTMLResponse)
async def traders():
    """Serve the traders page"""
    return read_html_file(SITE_DIR / "traders.html")


@app.get("/mobile-app", response_class=HTMLResponse)
@app.get("/mobile-app.html", response_class=HTMLResponse)
async def mobile_app():
    """Serve the mobile app page"""
    return read_html_file(SITE_DIR / "mobile-app.html")


@app.get("/how_it_works", response_class=HTMLResponse)
@app.get("/how_it_works.html", response_class=HTMLResponse)
async def how_it_works():
    """Serve the how it works page"""
    return read_html_file(SITE_DIR / "how_it_works.html")


@app.get("/register", response_class=HTMLResponse)
@app.get("/register.html", response_class=HTMLResponse)
async def register():
    """Serve the register page"""
    return read_html_file(SITE_DIR / "register.html")


@app.get("/login", response_class=HTMLResponse)
@app.get("/login.html", response_class=HTMLResponse)
async def login():
    """Serve the login page"""
    return read_html_file(SITE_DIR / "login.html")


@app.get("/dashboard", include_in_schema=False)
@app.get("/dashboard.html", include_in_schema=False)
async def dashboard():
    """Send legacy dashboard traffic to the redesigned app."""
    return RedirectResponse(url="/app/", status_code=307)


APP_DIR = SITE_DIR / "app"
APP_PAGES = {"index", "trade", "screener", "documents", "copy-traders", "wallet", "plans", "portfolio", "referrals", "settings", "network", "news"}


@app.get("/app", include_in_schema=False)
async def app_root_redirect():
    return RedirectResponse(url="/app/", status_code=307)


@app.get("/app/", response_class=HTMLResponse, include_in_schema=False)
async def app_home():
    return read_html_file(APP_DIR / "index.html")


@app.get("/app/{page}", response_class=HTMLResponse, include_in_schema=False)
async def app_page(page: str):
    slug = page[:-5] if page.endswith(".html") else page
    if slug not in APP_PAGES:
        raise HTTPException(status_code=404, detail="Page not found")
    return read_html_file(APP_DIR / f"{slug}.html")


@app.get("/forgot-password", response_class=HTMLResponse)
@app.get("/forgot-password.html", response_class=HTMLResponse)
async def forgot_password():
    """Serve the forgot password page"""
    return read_html_file(SITE_DIR / "forgot-password.html")


@app.get("/verify-2fa", response_class=HTMLResponse)
@app.get("/verify-2fa.html", response_class=HTMLResponse)
async def verify_2fa_page():
    """Serve the 2FA verification page"""
    return read_html_file(SITE_DIR / "verify-2fa.html")


@app.get("/welcome", response_class=HTMLResponse)
@app.get("/welcome.html", response_class=HTMLResponse)
async def welcome():
    """Placeholder for signed-in users whose dashboard access is not approved yet"""
    return read_html_file(SITE_DIR / "welcome.html")


@app.get("/onboarding", response_class=HTMLResponse)
@app.get("/onboarding.html", response_class=HTMLResponse)
async def onboarding_page():
    """Serve the onboarding wizard page"""
    return read_html_file(SITE_DIR / "onboarding.html")


@app.get("/privacy-policy", response_class=HTMLResponse)
@app.get("/privacy-policy.html", response_class=HTMLResponse)
async def privacy_policy():
    """Serve the privacy policy page"""
    return read_html_file(SITE_DIR / "privacy-policy.html")


@app.get("/help", response_class=HTMLResponse)
@app.get("/help.html", response_class=HTMLResponse)
async def help_page():
    """Serve the help center page"""
    return read_html_file(SITE_DIR / "help.html")


# Legal pages
@app.get("/legal/privacy_policy", response_class=HTMLResponse)
@app.get("/legal/privacy_policy.html", response_class=HTMLResponse)
async def legal_privacy_policy():
    """Serve the legal privacy policy page"""
    return read_html_file(SITE_DIR / "legal" / "privacy_policy.html")


@app.get("/legal/terms_conditions", response_class=HTMLResponse)
@app.get("/legal/terms_conditions.html", response_class=HTMLResponse)
async def legal_terms_conditions():
    """Serve the legal terms and conditions page"""
    return read_html_file(SITE_DIR / "legal" / "terms_conditions.html")


@app.get("/legal/aml_policy", response_class=HTMLResponse)
@app.get("/legal/aml_policy.html", response_class=HTMLResponse)
async def legal_aml_policy():
    """Serve the legal AML policy page"""
    return read_html_file(SITE_DIR / "legal" / "aml_policy.html")


@app.get("/legal/risk_closure", response_class=HTMLResponse)
@app.get("/legal/risk_closure.html", response_class=HTMLResponse)
async def legal_risk_closure():
    """Serve the legal risk closure page"""
    return read_html_file(SITE_DIR / "legal" / "risk_closure.html")


@app.get("/legal", response_class=HTMLResponse)
@app.get("/legal/", response_class=HTMLResponse)
@app.get("/legal/index", response_class=HTMLResponse)
@app.get("/legal/index.html", response_class=HTMLResponse)
async def legal_index():
    """Serve the legal index page"""
    return read_html_file(SITE_DIR / "legal" / "index.html")


# Admin pages
@app.get("/admin", response_class=HTMLResponse)
@app.get("/admin/", response_class=HTMLResponse)
@app.get("/admin/login", response_class=HTMLResponse)
@app.get("/admin/login.html", response_class=HTMLResponse)
async def admin_login_page():
    """Serve the admin login page"""
    return read_html_file(SITE_DIR / "admin-login.html")


@app.get("/admin/register", response_class=HTMLResponse)
@app.get("/admin/register.html", response_class=HTMLResponse)
async def admin_register_page():
    """Serve the admin registration page"""
    return read_html_file(SITE_DIR / "admin-register.html")


@app.get("/admin-dashboard.html", response_class=HTMLResponse)
async def admin_dashboard_html():
    """Serve the admin dashboard page via admin-dashboard.html"""
    return read_html_file(SITE_DIR / "admin-dashboard.html")

@app.get("/admin/dashboard.html", response_class=HTMLResponse)
@app.get("/admin/dashboard", response_class=HTMLResponse)
async def admin_dashboard_page():
    """Serve the admin dashboard page"""
    return read_html_file(SITE_DIR / "admin-dashboard.html")


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
