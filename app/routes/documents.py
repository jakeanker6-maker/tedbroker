"""Documents center: monthly statements (PDF), trade confirmations (PDF) and the realized
gains report (JSON / CSV). All documents are for the user's simulated account only."""
import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from app.auth import get_current_user_token
from app.rate_limiter import limiter
from app.market_data import universe
from app.trading import orders, statements, taxlots

router = APIRouter(prefix="/api/documents", tags=["Documents"])
PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _err(code: str, message: str, status: int = 400):
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _describe(sym: str) -> str:
    try:
        return universe.describe(sym).get("name") or sym
    except Exception:
        return sym


def _pdf(content: bytes, filename: str) -> Response:
    return Response(content, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"})


@router.get("")
async def documents_index(confirmations_limit: int = Query(50, ge=1, le=200),
                          current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]

    def build():
        months = statements.available_months(uid)
        filled = list(orders.orders_col().find(
            {"user_id": uid, "$or": [{"status": "filled"}, {"filled_qty": {"$nin": ["0", None]}}]},
            {"symbol": 1, "side": 1, "type": 1, "filled_qty": 1, "avg_fill_price": 1, "status": 1, "created_at": 1,
             "source": 1, "updated_at": 1}).sort("created_at", -1).limit(confirmations_limit))
        fills = taxlots.user_fills(uid)
        return {
            "statements": [{"period": m, "partial": i == 0} for i, m in enumerate(months)],
            "confirmations": [{"order_id": str(o["_id"]), "symbol": o["symbol"].strip(), "side": o["side"], "type": o["type"],
                               "qty": o.get("filled_qty"), "avg_price": o.get("avg_fill_price"), "status": o["status"],
                               "source": o.get("source", "manual"),
                               "date": o["created_at"].isoformat() + "Z"} for o in filled],
            "tax_years": taxlots.years_with_activity(fills),
        }
    return await asyncio.to_thread(build)


@router.get("/statements/{period}.pdf")
@limiter.limit("30/minute")
async def statement_pdf(request: Request, period: str, current_user: dict = Depends(get_current_user_token)):
    if not PERIOD.match(period):
        raise _err("invalid_period", "Statement period must look like 2026-10.")
    uid = current_user["user_id"]

    def build():
        if period not in statements.available_months(uid):
            raise _err("not_found", "There is no statement for that month.", 404)
        return statements.render_statement(statements.statement_data(uid, period))
    return _pdf(await asyncio.to_thread(build), f"ted-statement-{period}.pdf")


@router.get("/confirmations/{order_id}.pdf")
@limiter.limit("60/minute")
async def confirmation_pdf(request: Request, order_id: str, current_user: dict = Depends(get_current_user_token)):
    uid = current_user["user_id"]

    def build():
        try:
            return statements.render_confirmation(statements.confirmation_data(uid, order_id))
        except orders.OrderError as exc:
            raise _err(exc.code, str(exc), getattr(exc, "status", 404))
    return _pdf(await asyncio.to_thread(build), f"ted-confirmation-{order_id[-8:]}.pdf")


def _report(uid: str, year: int, method: str) -> dict:
    return taxlots.report(taxlots.user_fills(uid), year, method, describe=_describe)


@router.get("/realized-gains")
async def realized_gains(year: int = Query(..., ge=2000, le=2100), method: str = Query("fifo", pattern="^(fifo|average)$"),
                         current_user: dict = Depends(get_current_user_token)):
    return await asyncio.to_thread(_report, current_user["user_id"], year, method)


@router.get("/realized-gains.csv")
@limiter.limit("30/minute")
async def realized_gains_csv(request: Request, year: int = Query(..., ge=2000, le=2100),
                             method: str = Query("fifo", pattern="^(fifo|average)$"),
                             current_user: dict = Depends(get_current_user_token)):
    rep = await asyncio.to_thread(_report, current_user["user_id"], year, method)
    return Response(taxlots.to_csv(rep), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="ted-realized-gains-{year}-{method}.csv"', "Cache-Control": "private, no-store"})
