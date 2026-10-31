"""Server-Sent Event streams for live prices and account updates.

Browsers' EventSource cannot send an Authorization header, so the page first calls
POST /api/stream/token (with its normal Bearer token) and opens the stream with
?st=<token>. Stream tokens are short-lived, only open streams, and are rejected
as API Bearer tokens (they carry no `sub`/`user_id` claims).

Event formats
  event: quote    data: <quote>          (prices stream; coalesced, <= 4 flushes/s)
  event: status   data: <market status>  (prices stream; on connect and every 60 s)
  event: balance  data: {cash, reserved, available, reason}   (account stream)
  event: stream_error  data: {message, symbols?}   (not "error": that name is reserved by EventSource)
  : ping                                  (every 15 s, keeps proxies from closing)
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import timedelta
from typing import AsyncIterator, List, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.auth import create_access_token, decode_access_token, get_current_user_token
from app.market_data import calendar, service, universe
from app.market_data.bus import bus
from app.market_data.quotes import public
from app.trading import events, ledger

router = APIRouter(prefix="/api/stream", tags=["Streaming"])

STREAM_TOKEN_TTL = 120
MAX_SYMBOLS = 60
FLUSH_INTERVAL = 0.25
PING_EVERY = 15
STATUS_EVERY = 60
SSE_HEADERS = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


# Per-user cap on open SSE connections (a handful of tabs is normal; hundreds is abuse).
MAX_STREAMS_PER_USER = 12
_open: dict = {}


def _claim(user_id: str) -> None:
    if _open.get(user_id, 0) >= MAX_STREAMS_PER_USER:
        raise HTTPException(status_code=429, detail={"code": "too_many_streams",
                                                     "message": "Too many live connections. Close some tabs and retry."})
    _open[user_id] = _open.get(user_id, 0) + 1


def _release(user_id: str) -> None:
    n = _open.get(user_id, 0) - 1
    if n > 0:
        _open[user_id] = n
    else:
        _open.pop(user_id, None)


def sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'), default=str)}\n\n"


@router.post("/token")
async def stream_token(current_user: dict = Depends(get_current_user_token)):
    token = create_access_token({"typ": "stream", "uid": current_user["user_id"]},
                                expires_delta=timedelta(seconds=STREAM_TOKEN_TTL))
    return {"token": token, "expires_in": STREAM_TOKEN_TTL}


def stream_user(st: str) -> str:
    payload = decode_access_token(st) if st else None
    if not payload or payload.get("typ") != "stream" or not payload.get("uid"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired stream token")
    return payload["uid"]


def parse_symbols(raw: str) -> Tuple[List[str], List[str]]:
    good, bad = [], []
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            sym = universe.normalize(part)
            if sym not in good:
                good.append(sym)
        except (universe.UnknownSymbol, ValueError):
            bad.append(part)
    return good[:MAX_SYMBOLS], bad


async def _prime(symbols: List[str]) -> None:
    """Make sure every symbol has a quote right away, even before the feeds tick."""
    await service.get_quotes(symbols)


async def price_events(request: Request, symbols: List[str], bad: List[str], user_id: str = "") -> AsyncIterator[str]:
    sub = bus.subscribe(symbols)
    prime = asyncio.create_task(_prime(symbols))
    try:
        yield "retry: 3000\n\n"
        yield sse("status", calendar.market_status())
        if bad:
            yield sse("stream_error", {"message": "Unknown symbols ignored", "symbols": bad})
        last_ping = last_status = time.monotonic()
        while True:
            if await request.is_disconnected():
                break
            batch = await sub.next_batch(timeout=1.0)
            for q in batch:
                yield sse("quote", public(q))
            now = time.monotonic()
            if now - last_status > STATUS_EVERY:
                yield sse("status", calendar.market_status())
                last_status = now
            if now - last_ping > PING_EVERY:
                yield ": ping\n\n"
                last_ping = now
            if batch:
                await asyncio.sleep(FLUSH_INTERVAL)
    finally:
        prime.cancel()
        sub.close()
        if user_id:
            _release(user_id)


@router.get("/prices")
async def stream_prices(request: Request, symbols: str = Query(..., description="Comma-separated symbols"),
                        st: str = Query(..., description="Stream token from POST /api/stream/token")):
    user_id = stream_user(st)
    good, bad = parse_symbols(symbols)
    if not good:
        raise HTTPException(status_code=400, detail="No valid symbols")
    _claim(user_id)
    return StreamingResponse(price_events(request, good, bad, user_id), media_type="text/event-stream", headers=SSE_HEADERS)


async def account_events(request: Request, user_id: str) -> AsyncIterator[str]:
    q = events.open_stream(user_id)
    try:
        yield "retry: 3000\n\n"
        b = await asyncio.to_thread(ledger.get_balances, user_id)
        yield sse("balance", {"cash": f"{b['cash_cents'] / 100:.2f}", "reserved": f"{b['reserved_cents'] / 100:.2f}",
                              "available": f"{b['available_cents'] / 100:.2f}", "reason": "snapshot"})
        last_ping = time.monotonic()
        while True:
            if await request.is_disconnected():
                break
            try:
                ev = await asyncio.wait_for(q.get(), timeout=1.0)
                yield sse(ev["event"], ev["data"])
            except asyncio.TimeoutError:
                pass
            if time.monotonic() - last_ping > PING_EVERY:
                yield ": ping\n\n"
                last_ping = time.monotonic()
    finally:
        events.close_stream(user_id, q)
        _release(user_id)


@router.get("/account")
async def stream_account(request: Request, st: str = Query(...)):
    user_id = stream_user(st)
    _claim(user_id)
    return StreamingResponse(account_events(request, user_id), media_type="text/event-stream", headers=SSE_HEADERS)
