"""Trading Hub API: orders, positions, portfolio, activity and watchlists.

Simulated brokerage (school project): real market prices, simulated execution, funds
from the existing wallet. The user is always taken from the token, never the body.
Errors use {"detail": {"code": "...", "message": "..."}} so the ticket can show them inline.
"""

import asyncio
from datetime import datetime
from decimal import Decimal
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import get_current_user_token
from app.database import get_collection
from app.market_data import service, universe
from app.rate_limiter import limiter
from pydantic import BaseModel, Field

from app.trading import borrow, ledger, margin, multileg, orders, portfolio, risk_monitor
from app.trading import options as opt
from app.trading.models import OPEN_STATUSES, OrderRequest, ReplaceRequest, WatchlistCreate

router = APIRouter(prefix="/api/trading", tags=["Trading Hub"])


def _err(exc: orders.OrderError):
    return HTTPException(status_code=exc.status, detail={"code": exc.code, "message": str(exc)})


async def _quote_for(symbol: str, asset_class: Optional[str] = None) -> dict:
    try:
        sym = universe.normalize(symbol, asset_class)
    except (universe.UnknownSymbol, ValueError) as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_symbol", "message": str(exc)})
    try:
        # Orders are priced off a near-fresh quote (the ticket may have shown an older one).
        return await service.get_quote(sym, max_age=3)
    except service.MarketDataError:
        raise HTTPException(status_code=503, detail={"code": "no_quote",
                                                     "message": "A live price is not available right now. Try again shortly."})


# ------------------------------------------------------------------ account
def _account_extras(uid: str) -> dict:
    user = ledger.ensure_account(uid)
    st = margin.account_state(uid)
    m = margin.serialize(st)
    acct = margin.account_type(user)
    trades = orders.day_trades(uid)
    under = st.equity < margin.PDT_MIN_EQUITY
    return {
        "account_type": acct, "options_level": orders.options_level(user),
        "options_level_name": OPTIONS_LEVELS[orders.options_level(user)],
        "margin_enabled": acct == "margin", "margin_agreement_at": _iso(user.get("margin_agreement_at")),
        "margin": m, "buying_power_detail": m["buying_power"],
        "day_trades_5d": trades, "day_trades_left": (max(0, 3 - trades) if (acct == "margin" and under) else None),
        "pattern_day_trader": acct == "margin" and trades >= 4 and not under,
        "margin_calls": [risk_monitor.serialize(c) for c in risk_monitor.open_calls(uid)],
        "margin_interest_rate": f"{margin.interest_rate(st.margin_debit) * 100:.2f}" if acct == "margin" else None,
        "margin_interest_accrued": user.get("margin_interest_accrued", "0"),
    }


def _iso(dt):
    return dt.isoformat() + "Z" if isinstance(dt, datetime) else None


OPTIONS_LEVELS = {0: "Not approved", 1: "Level 1 - covered calls and cash-secured puts",
                  2: "Level 2 - buy calls and puts", 3: "Level 3 - spreads",
                  4: "Level 4 - uncovered (naked) options"}


@router.get("/account")
async def account(current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    s = await portfolio.summary(uid)
    extras = await asyncio.to_thread(_account_extras, uid)
    s.update(extras)
    bp = extras["margin"]["buying_power"]
    s["buying_power"] = bp["stock"]
    return s


class MarginUpgrade(BaseModel):
    accept_margin_agreement: bool
    accept_risk_disclosure: bool
    agreement_version: str = "2026-10"


@router.post("/account/margin-upgrade")
@limiter.limit("10/minute")
async def margin_upgrade(request: Request, body: MarginUpgrade, current_user: dict = Depends(get_current_user_token)):
    if not (body.accept_margin_agreement and body.accept_risk_disclosure):
        raise HTTPException(status_code=400, detail={"code": "agreement_required",
                                                     "message": "You must accept the margin agreement and the risk disclosure."})
    uid = current_user["user_id"]

    def upgrade():
        ledger.ensure_account(uid)
        get_collection("users").update_one({"_id": ObjectId(uid)}, {"$set": {
            "account_type": "margin", "margin_agreement_at": datetime.utcnow(),
            "margin_agreement_version": body.agreement_version}})
        return _account_extras(uid)
    return await asyncio.to_thread(upgrade)


@router.post("/account/cash-downgrade")
@limiter.limit("10/minute")
async def cash_downgrade(request: Request, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]

    def downgrade():
        st = margin.account_state(uid)
        shorts = orders.positions.col().count_documents({"user_id": uid, "open": True, "qty": {"$regex": "^-"}})
        if st.cash < 0 or shorts or risk_monitor.has_open_call(uid):
            raise HTTPException(status_code=409, detail={"code": "not_eligible", "message":
                                "Repay any margin balance and close short positions before switching to a cash account."})
        user = ledger.ensure_account(uid)
        get_collection("users").update_one({"_id": ObjectId(uid)}, {"$set": {
            "account_type": "cash", "options_level": min(orders.options_level(user), 3)}})
        return _account_extras(uid)
    return await asyncio.to_thread(downgrade)


class OptionsApplication(BaseModel):
    level: int = Field(..., ge=0, le=4)
    experience: str = Field(..., pattern="^(none|under_1|1_to_5|over_5)$")
    objective: str = Field(..., pattern="^(income|growth|speculation|hedging)$")
    understands_risk: bool


@router.post("/account/options-level")
@limiter.limit("10/minute")
async def options_level(request: Request, body: OptionsApplication, current_user: dict = Depends(get_current_user_token)):
    """Automated options approval (simulated suitability rules)."""
    uid = current_user["user_id"]

    def apply():
        user = ledger.ensure_account(uid)
        st = margin.account_state(uid)
        reasons = []
        if not body.understands_risk:
            reasons.append("You must confirm you understand the risks of options trading.")
        if body.level >= 3 and body.experience in ("none",):
            reasons.append("Spreads require some options trading experience.")
        if body.level == 4:
            if margin.account_type(user) != "margin":
                reasons.append("Level 4 requires a margin account.")
            if body.experience not in ("1_to_5", "over_5"):
                reasons.append("Level 4 requires at least one year of options experience.")
            if body.objective != "speculation":
                reasons.append("Level 4 is only available with a speculation objective.")
            if st.equity < 5000:
                reasons.append("Level 4 requires at least $5,000 of account equity.")
        approved = body.level if not reasons else orders.options_level(user)
        get_collection("users").update_one({"_id": ObjectId(uid)}, {"$set": {
            "options_level": approved, "options_application": {**body.model_dump(), "decided_at": datetime.utcnow(),
                                                                "approved": not reasons, "reasons": reasons}}})
        return {"requested_level": body.level, "approved": not reasons, "options_level": approved,
                "options_level_name": OPTIONS_LEVELS[approved], "reasons": reasons}
    return await asyncio.to_thread(apply)


@router.get("/locate/{symbol}")
async def locate(symbol: str, current_user: dict = Depends(get_current_user_token)):
    quote = await _quote_for(symbol)
    out = borrow.locate(quote["symbol"], quote.get("last"))
    out["ssr"] = borrow.ssr_active(quote)
    return out


@router.get("/margin-calls")
async def margin_calls(include_closed: bool = False, current_user: dict = Depends(get_current_user_token)):
    q = {"user_id": current_user["user_id"]}
    if not include_closed:
        q["status"] = "open"
    rows = await asyncio.to_thread(lambda: list(risk_monitor.calls_col().find(q).sort("issued_at", -1).limit(50)))
    return {"margin_calls": [risk_monitor.serialize(c) for c in rows]}


# ------------------------------------------------------------------ multi-leg strategies
async def _leg_quotes(req: "multileg.MultilegRequest") -> dict:
    syms = []
    for l in req.legs:
        try:
            syms.append(universe.normalize(l.symbol))
        except (universe.UnknownSymbol, ValueError) as exc:
            raise HTTPException(status_code=404, detail={"code": "unknown_symbol", "message": str(exc)})
    roots = {opt.parse_occ(s)["root"] for s in syms if opt.looks_like_occ(s)}
    out = {}
    for s in list(dict.fromkeys(syms + sorted(roots))):
        try:
            out[s] = await service.get_quote(s, max_age=3)
        except service.MarketDataError:
            raise HTTPException(status_code=503, detail={"code": "no_quote", "message": f"No price for {s}"})
    return out


@router.post("/orders/multileg/preview")
async def multileg_preview(req: multileg.MultilegRequest, current_user: dict = Depends(get_current_user_token)):
    quotes = await _leg_quotes(req)
    try:
        return await asyncio.to_thread(multileg.preview, current_user["user_id"], req, quotes)
    except orders.OrderError as exc:
        raise _err(exc)


@router.post("/orders/multileg", status_code=201)
@limiter.limit("30/minute")
async def multileg_place(request: Request, req: multileg.MultilegRequest,
                         current_user: dict = Depends(get_current_user_token)):
    quotes = await _leg_quotes(req)
    try:
        order = await asyncio.to_thread(multileg.place, current_user["user_id"], req, quotes)
    except orders.OrderError as exc:
        raise _err(exc)
    return orders.serialize_order(order)


@router.post("/strategies/payoff")
async def strategy_payoff(req: multileg.MultilegRequest, current_user: dict = Depends(get_current_user_token)):
    quotes = await _leg_quotes(req)
    try:
        legs = await asyncio.to_thread(multileg.resolve_for_payoff, current_user["user_id"], req)
    except orders.OrderError as exc:
        raise _err(exc)
    return multileg.payoff(legs, quotes, req.qty)


@router.get("/strategies")
async def strategy_groups(status: str = Query("open", pattern="^(open|closed|all)$"),
                          current_user: dict = Depends(get_current_user_token)):
    q = {"user_id": current_user["user_id"]}
    if status != "all":
        q["status"] = status
    rows = await asyncio.to_thread(lambda: list(multileg.groups_col().find(q).sort("opened_at", -1).limit(100)))
    return {"strategies": [{"group_id": g["group_id"], "strategy": g["strategy"], "underlying": g["underlying"],
                            "qty": g.get("qty", 0), "legs": g.get("legs", []), "status": g.get("status"),
                            "opened_at": _iso(g.get("opened_at")), "open_net_prices": g.get("open_nets", [])}
                           for g in rows]}


# ------------------------------------------------------------------ orders
@router.post("/orders/preview")
@limiter.limit("120/minute")
async def preview_order(request: Request, req: OrderRequest, current_user: dict = Depends(get_current_user_token)):
    quote = await _quote_for(req.symbol, req.asset_class)
    try:
        return await asyncio.to_thread(orders.preview, current_user["user_id"], req, quote)
    except orders.OrderError as exc:
        raise _err(exc)


@router.post("/orders", status_code=201)
@limiter.limit("60/minute")
async def place_order(request: Request, req: OrderRequest, current_user: dict = Depends(get_current_user_token)):
    quote = await _quote_for(req.symbol, req.asset_class)
    try:
        order = await asyncio.to_thread(orders.place, current_user["user_id"], req, quote)
    except orders.OrderError as exc:
        raise _err(exc)
    return orders.serialize_order(order)


@router.get("/orders")
async def list_orders(status: str = Query("all", pattern="^(open|filled|closed|all)$"),
                      symbol: Optional[str] = None, source: Optional[str] = None,
                      limit: int = Query(50, ge=1, le=200), before: Optional[str] = None,
                      current_user: dict = Depends(get_current_user_token)):
    q = {"user_id": current_user["user_id"]}
    if status == "open":
        q["status"] = {"$in": list(OPEN_STATUSES)}
    elif status == "filled":
        q["status"] = "filled"
    elif status == "closed":
        q["status"] = {"$nin": list(OPEN_STATUSES)}
    if symbol:
        try:
            q["symbol"] = universe.normalize(symbol)
        except (universe.UnknownSymbol, ValueError):
            return {"orders": [], "next_before": None}
    if source:
        q["source"] = source
    if before:
        if not ObjectId.is_valid(before):
            raise HTTPException(status_code=400, detail="Invalid cursor")
        q["_id"] = {"$lt": ObjectId(before)}
    rows = await asyncio.to_thread(lambda: list(orders.orders_col().find(q).sort("_id", -1).limit(limit)))
    items = [orders.serialize_order(o) for o in rows]
    return {"orders": items, "next_before": items[-1]["id"] if len(items) == limit else None}


@router.get("/orders/{order_id}")
async def get_order(order_id: str, current_user: dict = Depends(get_current_user_token)):
    try:
        o = await asyncio.to_thread(orders.get_order, current_user["user_id"], order_id)
    except orders.OrderError as exc:
        raise _err(exc)
    fills = await asyncio.to_thread(lambda: list(orders.fills_col().find({"order_id": o["_id"], "status": "applied"})))
    return {**orders.serialize_order(o), "fills": [orders.serialize_fill(f) for f in fills]}


@router.delete("/orders/{order_id}")
@limiter.limit("120/minute")
async def cancel_order(request: Request, order_id: str, current_user: dict = Depends(get_current_user_token)):
    try:
        return orders.serialize_order(await asyncio.to_thread(orders.cancel, current_user["user_id"], order_id))
    except orders.OrderError as exc:
        raise _err(exc)


@router.patch("/orders/{order_id}")
@limiter.limit("60/minute")
async def replace_order(request: Request, order_id: str, changes: ReplaceRequest,
                        current_user: dict = Depends(get_current_user_token)):
    try:
        old = await asyncio.to_thread(orders.get_order, current_user["user_id"], order_id)
    except orders.OrderError as exc:
        raise _err(exc)
    quote = await _quote_for(old["symbol"])
    try:
        new = await asyncio.to_thread(orders.replace, current_user["user_id"], order_id,
                                      changes.model_dump(exclude_none=True), quote)
    except orders.OrderError as exc:
        raise _err(exc)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "invalid_order", "message": str(exc)})
    return orders.serialize_order(new)


@router.get("/fills")
async def list_fills(symbol: Optional[str] = None, limit: int = Query(50, ge=1, le=200),
                     current_user: dict = Depends(get_current_user_token)):
    q = {"user_id": current_user["user_id"], "status": "applied"}
    if symbol:
        try:
            q["symbol"] = universe.normalize(symbol)
        except (universe.UnknownSymbol, ValueError):
            return {"fills": []}
    rows = await asyncio.to_thread(lambda: list(orders.fills_col().find(q).sort("ts", -1).limit(limit)))
    return {"fills": [orders.serialize_fill(f) for f in rows]}


# ------------------------------------------------------------------ positions & portfolio
@router.get("/positions")
async def list_positions(bucket: str = "all", current_user: dict = Depends(get_current_user_token)):
    return {"positions": await portfolio.positions_view(current_user["user_id"], bucket)}


@router.get("/positions/{symbol}")
async def get_position(symbol: str, bucket: str = "self", current_user: dict = Depends(get_current_user_token)):
    try:
        sym = universe.normalize(symbol)
    except (universe.UnknownSymbol, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    rows = [p for p in await portfolio.positions_view(current_user["user_id"], bucket) if p["symbol"] == sym]
    return {"position": rows[0] if rows else None}


@router.get("/portfolio/summary")
async def portfolio_summary(current_user: dict = Depends(get_current_user_token)):
    return await portfolio.summary(current_user["user_id"])


@router.get("/portfolio/history")
async def portfolio_history(range: str = Query("1M"), current_user: dict = Depends(get_current_user_token)):
    try:
        return await portfolio.history(current_user["user_id"], range)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/activity")
async def activity(limit: int = Query(50, ge=1, le=200), before: Optional[str] = None, types: Optional[str] = None,
                   include_holds: bool = False, current_user: dict = Depends(get_current_user_token)):
    """Cash activity. Internal order holds/releases are hidden unless include_holds=true."""
    if before and not ObjectId.is_valid(before):
        raise HTTPException(status_code=400, detail="Invalid cursor")
    type_list = [t for t in (types or "").split(",") if t] or None
    exclude = None if include_holds else ["order_hold", "order_release"]
    rows = await asyncio.to_thread(ledger.list_entries, current_user["user_id"], limit, before, type_list, exclude)
    items = [ledger.serialize_entry(e) for e in rows]
    return {"items": items, "next_before": items[-1]["id"] if len(items) == limit else None}


# ------------------------------------------------------------------ watchlists
DEFAULT_WATCHLIST = ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "TSLA", "BTC-USD", "ETH-USD"]


def _wl():
    return get_collection("watchlists")


def _wl_out(w: dict) -> dict:
    return {"id": str(w["_id"]), "name": w["name"], "symbols": w.get("symbols", []),
            "updated_at": w.get("updated_at").isoformat() + "Z" if w.get("updated_at") else None}


def _clean_symbols(raw: list) -> list:
    out = []
    for s in raw[:100]:
        try:
            sym = universe.normalize(str(s))
        except (universe.UnknownSymbol, ValueError):
            continue
        if sym not in out:
            out.append(sym)
    return out


@router.get("/watchlists")
async def list_watchlists(current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]

    def load():
        rows = list(_wl().find({"user_id": uid}).sort("created_at", 1))
        if not rows:
            now = datetime.utcnow()
            doc = {"user_id": uid, "name": "My watchlist", "symbols": DEFAULT_WATCHLIST, "created_at": now, "updated_at": now}
            doc["_id"] = _wl().insert_one(doc).inserted_id
            rows = [doc]
        return rows
    return {"watchlists": [_wl_out(w) for w in await asyncio.to_thread(load)]}


@router.post("/watchlists", status_code=201)
@limiter.limit("30/minute")
async def create_watchlist(request: Request, body: WatchlistCreate, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    if await asyncio.to_thread(_wl().count_documents, {"user_id": uid}) >= 20:
        raise HTTPException(status_code=400, detail="You can have up to 20 watchlists")
    now = datetime.utcnow()
    doc = {"user_id": uid, "name": body.name.strip(), "symbols": _clean_symbols(body.symbols),
           "created_at": now, "updated_at": now}
    doc["_id"] = (await asyncio.to_thread(_wl().insert_one, doc)).inserted_id
    return _wl_out(doc)


def _own_wl(uid: str, wid: str) -> dict:
    w = _wl().find_one({"_id": ObjectId(wid), "user_id": uid}) if ObjectId.is_valid(wid) else None
    if not w:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return w


@router.delete("/watchlists/{wid}")
async def delete_watchlist(wid: str, current_user: dict = Depends(get_current_user_token)):
    w = await asyncio.to_thread(_own_wl, current_user["user_id"], wid)
    await asyncio.to_thread(_wl().delete_one, {"_id": w["_id"]})
    return {"deleted": wid}


@router.post("/watchlists/{wid}/symbols")
@limiter.limit("120/minute")
async def add_watch_symbol(request: Request, wid: str, body: dict, current_user: dict = Depends(get_current_user_token)):
    w = await asyncio.to_thread(_own_wl, current_user["user_id"], wid)
    syms = _clean_symbols([body.get("symbol", "")])
    if not syms:
        raise HTTPException(status_code=404, detail="Unknown symbol")
    if len(w.get("symbols", [])) >= 100:
        raise HTTPException(status_code=400, detail="A watchlist can hold up to 100 symbols")
    await asyncio.to_thread(_wl().update_one, {"_id": w["_id"]},
                            {"$addToSet": {"symbols": syms[0]}, "$set": {"updated_at": datetime.utcnow()}})
    return _wl_out(await asyncio.to_thread(_wl().find_one, {"_id": w["_id"]}))


@router.delete("/watchlists/{wid}/symbols/{symbol}")
async def remove_watch_symbol(wid: str, symbol: str, current_user: dict = Depends(get_current_user_token)):
    w = await asyncio.to_thread(_own_wl, current_user["user_id"], wid)
    try:
        sym = universe.normalize(symbol)
    except (universe.UnknownSymbol, ValueError):
        sym = symbol.upper()
    await asyncio.to_thread(_wl().update_one, {"_id": w["_id"]},
                            {"$pull": {"symbols": sym}, "$set": {"updated_at": datetime.utcnow()}})
    return _wl_out(await asyncio.to_thread(_wl().find_one, {"_id": w["_id"]}))


# ------------------------------------------------------------------ diagnostics
@router.get("/engine")
async def engine_status(current_user: dict = Depends(get_current_user_token)):
    from app.trading import engine
    return engine.engine.status() if engine.engine else {"running": False}


# ------------------------------------------------------------------ ETF baskets
from app.trading import baskets  # noqa: E402


async def _quotes_for(symbols) -> dict:
    out = {}
    for s in dict.fromkeys(symbols):
        try:
            out[s] = await service.get_quote(s, max_age=3)
        except service.MarketDataError:
            raise HTTPException(status_code=503, detail={"code": "no_quote", "message": f"No price for {s} right now."})
    return out


class BasketCreate(BaseModel):
    template_id: Optional[str] = None
    name: Optional[str] = Field(None, max_length=60)
    holdings: Optional[list] = None
    amount: Optional[Decimal] = Field(None, gt=0)


class BasketAmount(BaseModel):
    amount: Decimal = Field(..., gt=0)


class BasketSell(BaseModel):
    percent: Decimal = Field(..., gt=0, le=100)


class BasketAuto(BaseModel):
    amount: Optional[Decimal] = Field(None, gt=0)
    frequency: Optional[str] = Field(None, pattern="^(weekly|monthly)$")


@router.get("/baskets/templates")
async def basket_templates(current_user: dict = Depends(get_current_user_token)):
    return {"templates": baskets.templates_out()}


@router.get("/baskets")
async def list_baskets(current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    rows = await asyncio.to_thread(lambda: list(baskets.col().find({"user_id": uid, "status": "open"}).sort("created_at", -1)))
    quotes = await service.get_quotes({t["symbol"] for b in rows for t in b["targets"]})
    return {"baskets": [baskets.serialize(b, quotes) for b in rows]}


@router.post("/baskets", status_code=201)
@limiter.limit("20/minute")
async def create_basket(request: Request, body: BasketCreate, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    if body.template_id:
        t = baskets.template(body.template_id)
        if not t:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Unknown basket template"})
        targets, name = [{"symbol": s, "weight": w} for s, w in t["holdings"]], body.name or t["name"]
    else:
        targets, name = body.holdings or [], body.name or "My basket"
    try:
        b = await asyncio.to_thread(baskets.create, uid, name, targets, body.template_id)
        if body.amount:
            quotes = await _quotes_for(t2["symbol"] for t2 in b["targets"])
            await asyncio.to_thread(baskets.invest, uid, str(b["_id"]), body.amount, quotes)
    except orders.OrderError as exc:
        if "b" in locals():
            await asyncio.to_thread(baskets.col().delete_one, {"_id": b["_id"], "invested_cents": 0})
        raise _err(exc)
    quotes = await service.get_quotes({t2["symbol"] for t2 in b["targets"]})
    return baskets.serialize(await asyncio.to_thread(baskets.get, uid, str(b["_id"])), quotes)


async def _basket_action(uid: str, basket_id: str, fn, *args):
    b = await asyncio.to_thread(baskets.get, uid, basket_id)
    quotes = await _quotes_for(t["symbol"] for t in b["targets"])
    placed = await asyncio.to_thread(fn, uid, basket_id, *args, quotes)
    fresh = await asyncio.to_thread(baskets.get, uid, basket_id)
    return {"basket": baskets.serialize(fresh, quotes), "orders": [orders.serialize_order(o) for o in placed]}


@router.post("/baskets/{basket_id}/invest")
@limiter.limit("30/minute")
async def invest_basket(request: Request, basket_id: str, body: BasketAmount, current_user: dict = Depends(get_current_user_token)):
    try:
        return await _basket_action(current_user["user_id"], basket_id, baskets.invest, body.amount)
    except orders.OrderError as exc:
        raise _err(exc)


@router.post("/baskets/{basket_id}/sell")
@limiter.limit("30/minute")
async def sell_basket(request: Request, basket_id: str, body: BasketSell, current_user: dict = Depends(get_current_user_token)):
    try:
        return await _basket_action(current_user["user_id"], basket_id, baskets.sell, body.percent)
    except orders.OrderError as exc:
        raise _err(exc)


@router.post("/baskets/{basket_id}/rebalance")
@limiter.limit("20/minute")
async def rebalance_basket(request: Request, basket_id: str, current_user: dict = Depends(get_current_user_token)):
    try:
        return await _basket_action(current_user["user_id"], basket_id, baskets.rebalance)
    except orders.OrderError as exc:
        raise _err(exc)


@router.patch("/baskets/{basket_id}/auto-invest")
@limiter.limit("30/minute")
async def basket_auto_invest(request: Request, basket_id: str, body: BasketAuto, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]
    try:
        b = await asyncio.to_thread(baskets.set_auto_invest, uid, basket_id, body.amount, body.frequency)
    except orders.OrderError as exc:
        raise _err(exc)
    quotes = await service.get_quotes({t["symbol"] for t in b["targets"]})
    return baskets.serialize(b, quotes)


# ------------------------------------------------------------------ alerts
from app.trading import alerts as alerts_mod  # noqa: E402


class AlertCreate(BaseModel):
    kind: str = Field(..., pattern="^(price_above|price_below|pct_move|order_filled)$")
    symbol: Optional[str] = Field(None, max_length=32)
    threshold: Optional[Decimal] = None
    email: bool = False
    note: str = Field("", max_length=140)


def _alert_err(exc: "alerts_mod.AlertError"):
    return HTTPException(status_code=exc.status, detail={"code": exc.code, "message": str(exc)})


@router.get("/alerts")
async def list_alerts(include_history: bool = True, current_user: dict = Depends(get_current_user_token)):
    rows = await asyncio.to_thread(alerts_mod.list_for, current_user["user_id"], include_history)
    return {"alerts": [alerts_mod.serialize(a) for a in rows], "max_active": alerts_mod.MAX_ACTIVE}


@router.post("/alerts", status_code=201)
@limiter.limit("30/minute")
async def create_alert(request: Request, body: AlertCreate, current_user: dict = Depends(get_current_user_token)):
    try:
        a = await asyncio.to_thread(alerts_mod.create, current_user["user_id"], body.kind, body.symbol,
                                    body.threshold, body.email, body.note)
    except alerts_mod.AlertError as exc:
        raise _alert_err(exc)
    return alerts_mod.serialize(a)


@router.delete("/alerts/{alert_id}")
@limiter.limit("60/minute")
async def delete_alert(request: Request, alert_id: str, current_user: dict = Depends(get_current_user_token)):
    try:
        await asyncio.to_thread(alerts_mod.delete, current_user["user_id"], alert_id)
    except alerts_mod.AlertError as exc:
        raise _alert_err(exc)
    return {"deleted": True}


# ------------------------------------------------------------------ recurring investments
from app.trading import recurring as recurring_mod  # noqa: E402


class RecurringCreate(BaseModel):
    kind: str = Field("symbol", pattern="^(symbol|basket)$")
    symbol: Optional[str] = Field(None, max_length=32)
    basket_id: Optional[str] = Field(None, max_length=32)
    amount: Decimal = Field(..., gt=0)
    frequency: str = Field(..., pattern="^(weekly|biweekly|monthly)$")
    day: int = Field(..., ge=0, le=28)


class RecurringUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(active|paused)$")
    amount: Optional[Decimal] = Field(None, gt=0)
    frequency: Optional[str] = Field(None, pattern="^(weekly|biweekly|monthly)$")
    day: Optional[int] = Field(None, ge=0, le=28)


def _rec_err(exc: "recurring_mod.RecurringError"):
    return HTTPException(status_code=exc.status, detail={"code": exc.code, "message": str(exc)})


@router.get("/recurring")
async def list_recurring(current_user: dict = Depends(get_current_user_token)):
    rows = await asyncio.to_thread(recurring_mod.list_for, current_user["user_id"])
    return {"plans": [recurring_mod.serialize(p) for p in rows], "min_amount": str(recurring_mod.MIN_AMOUNT)}


@router.post("/recurring", status_code=201)
@limiter.limit("20/minute")
async def create_recurring(request: Request, body: RecurringCreate, current_user: dict = Depends(get_current_user_token)):
    try:
        p = await asyncio.to_thread(recurring_mod.create, current_user["user_id"], body.kind, body.frequency, body.day,
                                    body.amount, body.symbol, body.basket_id)
    except recurring_mod.RecurringError as exc:
        raise _rec_err(exc)
    return recurring_mod.serialize(p)


@router.patch("/recurring/{plan_id}")
@limiter.limit("60/minute")
async def update_recurring(request: Request, plan_id: str, body: RecurringUpdate,
                           current_user: dict = Depends(get_current_user_token)):
    try:
        p = await asyncio.to_thread(recurring_mod.update, current_user["user_id"], plan_id, body.status, body.amount,
                                    body.frequency, body.day)
    except recurring_mod.RecurringError as exc:
        raise _rec_err(exc)
    return recurring_mod.serialize(p)


@router.delete("/recurring/{plan_id}")
@limiter.limit("60/minute")
async def delete_recurring(request: Request, plan_id: str, current_user: dict = Depends(get_current_user_token)):
    try:
        await asyncio.to_thread(recurring_mod.delete, current_user["user_id"], plan_id)
    except recurring_mod.RecurringError as exc:
        raise _rec_err(exc)
    return {"deleted": True}
