"""Admin views of the simulated Trading Hub: per-user ledger, orders, positions and copies,
integrity checks, engine/feed status, and "reset simulated account"."""
import asyncio
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import USERS_COLLECTION, get_collection
from app.routes.admin import get_current_admin
from app.trading import admin_activity as activity
from app.trading import copy_engine, integrity, ledger, orders, positions, reset

router = APIRouter(prefix="/api/admin/trading", tags=["Admin - Trading Hub"])


def _user(user_id: str) -> dict:
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})
    u = get_collection(USERS_COLLECTION).find_one({"_id": ObjectId(user_id)},
                                                  {"email": 1, "full_name": 1, "is_system": 1})
    if not u:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})
    return u


def _cents(v) -> str:
    return f"{int(v or 0) / 100:.2f}"


def _overview(user_id: str, ledger_limit: int, orders_limit: int) -> dict:
    u = _user(user_id)
    bal = ledger.get_balances(user_id)
    report = integrity.check_user(user_id)
    pos = [positions.serialize(p) for p in positions.col().find({"user_id": user_id, "open": True}).sort("symbol", 1)]
    ords = [orders.serialize_order(o) for o in
            orders.orders_col().find({"user_id": user_id}).sort("created_at", -1).limit(orders_limit)]
    entries = [ledger.serialize_entry(e) for e in ledger.list_entries(user_id, limit=ledger_limit)]
    links = [copy_engine.serialize(l) for l in copy_engine.links().find({"user_id": user_id}).sort("created_at", -1)]
    res = report["reservations"]
    return {
        "user": {"id": user_id, "email": u.get("email"), "full_name": u.get("full_name"), "is_system": bool(u.get("is_system"))},
        "balances": {"cash": _cents(bal["cash_cents"]), "reserved": _cents(bal["reserved_cents"]),
                     "available": _cents(bal["available_cents"])},
        "integrity": {"ok": report["ok"], "ledger_ok": report["ledger"]["ok"], "reservations_ok": res["ok"],
                      "difference": _cents(res["difference_cents"]),
                      "parts": {k: _cents(v) for k, v in res["parts"].items()},
                      "closed_orders_holding_cash": res["closed_orders_holding_cash"]},
        "net_funding": _cents(reset.net_funding_cents(user_id)),
        "positions": pos, "orders": ords, "ledger": entries, "copy_links": links,
    }


@router.get("/users/{user_id}")
async def user_trading(user_id: str, ledger_limit: int = Query(100, ge=1, le=500),
                       orders_limit: int = Query(50, ge=1, le=500), current_admin: dict = Depends(get_current_admin)):
    return await asyncio.to_thread(_overview, user_id, ledger_limit, orders_limit)


class ResetBody(BaseModel):
    confirm: str
    reset_id: Optional[str] = None


@router.post("/users/{user_id}/reset")
async def reset_user(user_id: str, body: ResetBody, current_admin: dict = Depends(get_current_admin)):
    u = await asyncio.to_thread(_user, user_id)
    if u.get("is_system"):
        raise HTTPException(status_code=409, detail={"code": "system_account",
                                                     "message": "Trader bot accounts cannot be reset."})
    if body.confirm.strip().lower() != str(u.get("email", "")).lower():
        raise HTTPException(status_code=400, detail={"code": "confirm_mismatch",
                                                     "message": "Type the user's email address to confirm the reset."})
    result = await asyncio.to_thread(reset.reset_account, user_id, current_admin.get("user_id", "admin"), body.reset_id or "")
    result["balances"] = {k.replace("_cents", ""): _cents(v) for k, v in result["balances"].items()}
    result.pop("integrity", None)
    return result


@router.get("/integrity")
async def integrity_all(current_admin: dict = Depends(get_current_admin)):
    """Ledger reconciliation + reservation audit for every account; returns the failures."""
    return await asyncio.to_thread(integrity.check_all)


@router.get("/engine")
async def engine_and_feeds(current_admin: dict = Depends(get_current_admin)):
    from app.market_data import feeds
    from app.trading import engine
    return {"engine": engine.engine.status() if engine.engine else {"running": False},
            "feeds": feeds.manager.status() if feeds.manager else {"running": False}}


# ---------------------------------------------------------------- read-only activity monitor
# Every route below only reads. Logic lives in app/trading/admin_activity.py.
async def _activity(coro):
    try:
        return await coro
    except activity.ActivityError as exc:
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message})


@router.get("/activity/summary")
async def activity_summary(range_: str = Query("1M", alias="range"), asset_class: str = Query("all"),
                           current_admin: dict = Depends(get_current_admin)):
    return await _activity(activity.summary(range_, asset_class))


@router.get("/activity/trades")
async def activity_trades(range_: str = Query("1M", alias="range"), asset_class: str = Query("all"),
                          side: str = Query("all"), user_id: Optional[str] = Query(None),
                          symbol: Optional[str] = Query(None, max_length=40), bucket: str = Query("all"),
                          limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                          current_admin: dict = Depends(get_current_admin)):
    return await _activity(activity.trades(range_, asset_class, side, user_id, symbol, bucket, limit, offset))


@router.get("/activity/holdings")
async def activity_holdings(asset_class: str = Query("all"), sort: str = Query("market_value"),
                            limit: int = Query(100, ge=1, le=200), current_admin: dict = Depends(get_current_admin)):
    return await _activity(activity.holdings(asset_class, sort, limit))


@router.get("/activity/assets/{symbol}")
async def activity_asset(symbol: str, range_: str = Query("1M", alias="range"),
                         current_admin: dict = Depends(get_current_admin)):
    return await _activity(activity.asset_detail(symbol, range_))


@router.get("/activity/traders")
async def activity_traders(range_: str = Query("1M", alias="range"), asset_class: str = Query("all"),
                           sort: str = Query("equity"), limit: int = Query(100, ge=1, le=200),
                           offset: int = Query(0, ge=0), current_admin: dict = Depends(get_current_admin)):
    return await _activity(activity.traders(range_, asset_class, sort, limit, offset))


@router.get("/activity/traders/{user_id}/portfolio")
async def activity_trader_portfolio(user_id: str, range_: str = Query("1M", alias="range"),
                                    current_admin: dict = Depends(get_current_admin)):
    return await _activity(activity.trader_portfolio(user_id, range_))
