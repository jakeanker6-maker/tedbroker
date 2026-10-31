"""Copy-trading API: follow an expert trader with an allocation; positions live in the
"copy:<link_id>" bucket of the follower's unified portfolio."""
import asyncio
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user_token
from app.rate_limiter import limiter
from app.trading import copy_engine, orders, portfolio

router = APIRouter(prefix="/api/copy", tags=["Copy trading"])


def _err(exc: copy_engine.CopyError):
    return HTTPException(status_code=exc.status, detail={"code": exc.code, "message": str(exc)})


class LinkCreate(BaseModel):
    trader_id: str
    allocation: Decimal = Field(..., gt=0)
    stop_loss_pct: Optional[Decimal] = Field(None, gt=0, le=95)


class LinkUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(active|paused)$")
    add_funds: Optional[Decimal] = Field(None, gt=0)
    withdraw_funds: Optional[Decimal] = Field(None, gt=0)
    stop_loss_pct: Optional[Decimal] = Field(None, ge=0, le=95)


@router.get("/links")
async def list_links(include_stopped: bool = False, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    await asyncio.to_thread(copy_engine.migrate_selected, uid)
    q = {"user_id": uid}
    if not include_stopped:
        q["status"] = {"$in": list(copy_engine.ACTIVE)}
    rows = await asyncio.to_thread(lambda: list(copy_engine.links().find(q).sort("created_at", -1)))
    return {"links": [await asyncio.to_thread(copy_engine.serialize, l) for l in rows]}


@router.post("/links", status_code=201)
@limiter.limit("20/minute")
async def create_link(request: Request, body: LinkCreate, current_user: dict = Depends(get_current_user_token)):
    try:
        link = await asyncio.to_thread(copy_engine.create_link, current_user["user_id"], body.trader_id,
                                       body.allocation, body.stop_loss_pct)
    except copy_engine.CopyError as exc:
        raise _err(exc)
    return await asyncio.to_thread(copy_engine.serialize, link)


@router.patch("/links/{link_id}")
@limiter.limit("60/minute")
async def update_link(request: Request, link_id: str, body: LinkUpdate, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    try:
        if body.add_funds:
            await asyncio.to_thread(copy_engine.allocate, uid, link_id, body.add_funds)
        if body.withdraw_funds:
            await asyncio.to_thread(copy_engine.withdraw_from_link, uid, link_id, body.withdraw_funds)
        if body.status:
            await asyncio.to_thread(copy_engine.set_status, uid, link_id, body.status)
        if body.stop_loss_pct is not None:
            link = await asyncio.to_thread(copy_engine.get_link, uid, link_id)
            await asyncio.to_thread(copy_engine.links().update_one, {"_id": link["_id"]},
                                    {"$set": {"stop_loss_pct": str(body.stop_loss_pct) if body.stop_loss_pct else None}})
        link = await asyncio.to_thread(copy_engine.get_link, uid, link_id)
    except copy_engine.CopyError as exc:
        raise _err(exc)
    return await asyncio.to_thread(copy_engine.serialize, link)


@router.delete("/links/{link_id}")
@limiter.limit("30/minute")
async def stop_link(request: Request, link_id: str, current_user: dict = Depends(get_current_user_token)):
    try:
        link = await asyncio.to_thread(copy_engine.stop, current_user["user_id"], link_id)
    except copy_engine.CopyError as exc:
        raise _err(exc)
    return await asyncio.to_thread(copy_engine.serialize, link)


@router.get("/links/{link_id}")
async def link_detail(link_id: str, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    try:
        link = await asyncio.to_thread(copy_engine.get_link, uid, link_id)
    except copy_engine.CopyError as exc:
        raise _err(exc)
    pos = await portfolio.positions_view(uid, copy_engine.bucket(link_id))
    fills = await asyncio.to_thread(lambda: list(orders.fills_col().find(
        {"user_id": uid, "bucket": copy_engine.bucket(link_id), "status": "applied"}).sort("ts", -1).limit(50)))
    return {**(await asyncio.to_thread(copy_engine.serialize, link)), "positions_detail": pos,
            "trades": [orders.serialize_fill(f) for f in fills]}
