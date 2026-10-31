"""Monthly account statements and trade confirmations (PDF), built from the ledger and fills.

Every document is marked as a school-project document with simulated funds. Periods are
calendar months in New York time. Data builders (`statement_data`, `confirmation_data`) are
separate from rendering so they can be tested without parsing PDFs.

Statement contents
  * account summary: opening cash, cash in/out by category, closing cash, account value at
    period end (last portfolio snapshot on or before the end, when one exists)
  * cash activity: every posted ledger entry in the period that changed cash
  * trades: every fill in the period
  * realized gains in the period (FIFO lots, see taxlots.py)
  * holdings at period end: quantity and cost basis replayed from fills
"""
from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from bson import ObjectId

from app.database import USERS_COLLECTION, get_collection
from app.market_data import calendar, universe
from app.trading import ledger, orders, portfolio, taxlots

D = Decimal
NOTICE = ("Generated from your TED Brokers account records. This document is not tax advice.")
CATEGORY = {
    "deposit": "Deposits", "opening_balance": "Deposits", "withdrawal": "Withdrawals",
    "trade_buy": "Trades", "trade_sell": "Trades", "short_sale": "Trades", "short_cover": "Trades",
    "option_premium": "Trades", "exercise": "Trades", "assignment": "Trades", "liquidation": "Trades",
    "fee": "Fees and interest", "borrow_fee": "Fees and interest", "margin_interest": "Fees and interest",
    "dividend": "Dividends", "dividend_owed": "Dividends",
    "plan_invest": "Managed plans", "plan_refund": "Managed plans", "plan_payout": "Managed plans",
    "referral_bonus": "Bonuses and adjustments", "adjustment": "Bonuses and adjustments",
    "copy_pnl": "Copy trading",
}


def month_bounds(ym: str) -> Tuple[datetime, datetime]:
    """'2026-10' -> (start, end) as naive UTC datetimes covering the New York calendar month."""
    y, m = (int(x) for x in ym.split("-"))
    if not (1 <= m <= 12 and 2000 <= y <= 2100):
        raise ValueError("period must be YYYY-MM")
    start = datetime(y, m, 1, tzinfo=calendar.NY)
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=calendar.NY)
    to_utc = lambda d: d.astimezone(timezone.utc).replace(tzinfo=None)  # noqa: E731
    return to_utc(start), to_utc(end)


def available_months(user_id: str) -> List[str]:
    """Months from the first ledger entry to the current month, newest first."""
    first = ledger._entries().find_one({"user_id": str(user_id), "status": "posted"}, sort=[("_id", 1)])
    if not first:
        return []
    start = first["created_at"].replace(tzinfo=timezone.utc).astimezone(calendar.NY).date().replace(day=1)
    today = datetime.now(calendar.NY).date().replace(day=1)
    out = []
    d = start
    while d <= today:
        out.append(f"{d.year:04d}-{d.month:02d}")
        d = (d + timedelta(days=32)).replace(day=1)
    return out[::-1]


def _cash_sum(user_id: str, until: datetime) -> int:
    return sum(int(e["cash_delta_cents"]) for e in ledger._entries().find(
        {"user_id": str(user_id), "status": "posted", "created_at": {"$lt": until}}, {"cash_delta_cents": 1}))


def _name(symbol: str) -> str:
    try:
        return universe.describe(symbol).get("name") or symbol
    except Exception:
        return symbol


def statement_data(user_id: str, ym: str) -> Dict:
    uid = str(user_id)
    start, end = month_bounds(ym)
    user = get_collection(USERS_COLLECTION).find_one({"_id": ObjectId(uid)}, {"email": 1, "full_name": 1, "account_type": 1}) or {}
    entries = list(ledger._entries().find({"user_id": uid, "status": "posted", "created_at": {"$gte": start, "$lt": end}})
                   .sort("_id", 1))
    opening, closing = _cash_sum(uid, start), _cash_sum(uid, end)
    by_cat: Dict[str, int] = {}
    activity = []
    for e in entries:
        c = int(e["cash_delta_cents"])
        if c == 0:
            continue
        cat = CATEGORY.get(e["type"], "Other")
        by_cat[cat] = by_cat.get(cat, 0) + c
        activity.append({"date": e["created_at"], "type": e["type"], "category": cat,
                         "description": e.get("description") or e["type"], "amount_cents": c,
                         "balance_cents": int(e.get("cash_after_cents", 0))})
    all_fills = taxlots.user_fills(uid)
    month_fills = sorted((f for f in all_fills if start <= f["ts"] < end), key=lambda f: f["ts"])
    realized = [d for d in taxlots.compute_disposals([f for f in all_fills if f["ts"] < end])
                if start <= d.sold < end]
    holdings = []
    for (sym, bucket), lots in sorted(taxlots.open_lots([f for f in all_fills if f["ts"] < end]).items()):
        qty = sum((l.qty for l in lots), D("0"))
        basis = sum((l.qty * l.per_unit for l in lots), D("0"))
        short = lots[0].short
        holdings.append({"symbol": sym, "name": _name(sym), "bucket": bucket, "qty": -qty if short else qty,
                         "cost_basis": -basis if short else basis})
    snap = portfolio.snaps().find_one({"user_id": uid, "ts": {"$lt": end}}, sort=[("ts", -1)])
    return {
        "period": ym, "start": start, "end": end, "generated_at": datetime.utcnow(),
        "account": {"name": user.get("full_name") or user.get("email") or "", "email": user.get("email", ""),
                    "number": f"TED-{uid[-8:].upper()}", "type": user.get("account_type", "cash")},
        "opening_cash_cents": opening, "closing_cash_cents": closing, "by_category": by_cat,
        "account_value_cents": int(snap["total_value_cents"]) if snap else None,
        "account_value_at": snap["ts"] if snap else None,
        "activity": activity, "fills": month_fills,
        "realized": realized, "realized_total": sum((d.gain for d in realized), D("0")),
        "holdings": holdings,
    }


def confirmation_data(user_id: str, order_id: str) -> Dict:
    o = orders.get_order(str(user_id), order_id)       # ownership enforced (404 otherwise)
    fills = list(orders.fills_col().find({"order_id": o["_id"], "status": "applied"}).sort("ts", 1))
    if not fills:
        raise orders.OrderError("This order has no executions yet, so there is no confirmation.", "no_fills", 404)
    user = get_collection(USERS_COLLECTION).find_one({"_id": ObjectId(str(user_id))}, {"email": 1, "full_name": 1}) or {}
    return {"order": o, "fills": fills, "generated_at": datetime.utcnow(),
            "account": {"name": user.get("full_name") or user.get("email") or "", "number": f"TED-{str(user_id)[-8:].upper()}"}}


# ---------------------------------------------------------------- rendering
def _usd(cents_or_dec, cents: bool = True) -> str:
    v = D(cents_or_dec) / 100 if cents else D(str(cents_or_dec))
    sign = "-" if v < 0 else ""
    return f"{sign}${abs(v):,.2f}"


def _ny(dt: Optional[datetime], fmt: str = "%b %d, %Y") -> str:
    if not dt:
        return "-"
    return dt.replace(tzinfo=timezone.utc).astimezone(calendar.NY).strftime(fmt)


def _doc(story, title: str) -> bytes:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate

    buf = io.BytesIO()

    def frame(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillGray(0.35)
        canvas.drawString(0.6 * inch, 0.45 * inch, "TED Brokers - generated from your account records - not tax advice")
        canvas.drawRightString(LETTER[0] - 0.6 * inch, 0.45 * inch, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=LETTER, title=title, author="TED Brokers",
                            leftMargin=0.6 * inch, rightMargin=0.6 * inch, topMargin=0.6 * inch, bottomMargin=0.7 * inch)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return buf.getvalue()


def _styles():
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    ss = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontSize=16, spaceAfter=4),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11.5, spaceBefore=10, spaceAfter=4),
        "p": ParagraphStyle("p", parent=ss["BodyText"], fontSize=8.5, leading=11),
        "notice": ParagraphStyle("notice", parent=ss["BodyText"], fontSize=8, leading=10.5, textColor=colors.HexColor("#7a4b00"),
                                 backColor=colors.HexColor("#fff4dc"), borderColor=colors.HexColor("#e0a100"), borderWidth=0.6,
                                 borderPadding=5, spaceBefore=4, spaceAfter=8),
        "cell": ParagraphStyle("cell", parent=ss["BodyText"], fontSize=7.5, leading=9),
    }


def _table(rows: List[List], widths, num_cols=(), header=True):
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle
    st = _styles()
    from reportlab.platypus import Paragraph
    from xml.sax.saxutils import escape
    data = [[Paragraph(escape(str(c)), st["cell"]) if isinstance(c, str) and len(c) > 28 else c for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [("FONT", (0, 0), (-1, -1), "Helvetica", 7.5), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#d7dce3")),
             ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3)]
    if header:
        style += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef1f5"))]
    for c in num_cols:
        style.append(("ALIGN", (c, 0), (c, -1), "RIGHT"))
    t.setStyle(TableStyle(style))
    return t


def render_statement(data: Dict) -> bytes:
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, Spacer
    from xml.sax.saxutils import escape
    st = _styles()
    y, m = data["period"].split("-")
    title = f"Account statement - {date(int(y), int(m), 1).strftime('%B %Y')}"
    a = data["account"]
    story = [Paragraph(f"TED Brokers &middot; {escape(title)}", st["h1"]),
             Paragraph(escape(NOTICE), st["notice"]),
             Paragraph(escape(f"{a['name']} ({a['email']}) · Account {a['number']} · {a['type'].title()} account · "
                              f"Period {_ny(data['start'])} - {_ny(data['end'] - timedelta(seconds=1))} (New York time) · "
                              f"Generated {_ny(data['generated_at'], '%b %d, %Y %H:%M')} ET"), st["p"])]
    summary = [["Summary", "Amount"], ["Opening cash", _usd(data["opening_cash_cents"])]]
    for cat in sorted(data["by_category"]):
        summary.append([cat, _usd(data["by_category"][cat])])
    summary.append(["Closing cash", _usd(data["closing_cash_cents"])])
    summary.append(["Realized gain/loss this period", _usd(data["realized_total"], cents=False)])
    if data["account_value_cents"] is not None:
        summary.append([f"Account value (as of {_ny(data['account_value_at'], '%b %d %H:%M')} ET)",
                        _usd(data["account_value_cents"])])
    story += [Paragraph("Account summary", st["h2"]), _table(summary, [4.6 * inch, 1.6 * inch], num_cols=(1,))]

    story.append(Paragraph("Holdings at period end", st["h2"]))
    if data["holdings"]:
        rows = [["Symbol", "Description", "Source", "Quantity", "Cost basis"]]
        rows += [[h["symbol"], h["name"], _source(h["bucket"]), f"{h['qty'].normalize():f}", _usd(h["cost_basis"], cents=False)]
                 for h in data["holdings"]]
        story.append(_table(rows, [1.5 * inch, 2.4 * inch, 1.2 * inch, 0.9 * inch, 1.1 * inch], num_cols=(3, 4)))
    else:
        story.append(Paragraph("No positions were held at the end of the period.", st["p"]))

    story.append(Paragraph("Trades", st["h2"]))
    if data["fills"]:
        rows = [["Date", "Symbol", "Side", "Quantity", "Price", "Fees", "Net cash", "Source"]]
        rows += [[_ny(f["ts"], "%b %d %H:%M"), f["symbol"].strip(), f["side"].replace("_", " "), f["qty"],
                  _usd(f["price"], cents=False), _usd(f.get("fee") or 0, cents=False), _usd(f["cash_delta_cents"]),
                  _source(f.get("bucket", "self"))] for f in data["fills"]]
        story.append(_table(rows, [0.95 * inch, 1.5 * inch, 0.85 * inch, 0.75 * inch, 0.85 * inch, 0.6 * inch, 0.85 * inch, 0.95 * inch],
                            num_cols=(3, 4, 5, 6)))
    else:
        story.append(Paragraph("No trades in this period.", st["p"]))

    story.append(Paragraph("Realized gains and losses (FIFO lots)", st["h2"]))
    if data["realized"]:
        rows = [["Symbol", "Quantity", "Acquired", "Sold", "Proceeds", "Cost basis", "Gain/loss", "Term"]]
        rows += [[d.symbol.strip(), f"{d.qty.normalize():f}", _ny(d.acquired), _ny(d.sold), _usd(d.proceeds, cents=False),
                  _usd(d.cost, cents=False), _usd(d.gain, cents=False), d.term + ("*" if d.wash_disallowed > 0 else "")]
                 for d in data["realized"]]
        story.append(_table(rows, [1.4 * inch] + [0.85 * inch] * 7, num_cols=(1, 4, 5, 6)))
        if any(d.wash_disallowed > 0 for d in data["realized"]):
            story.append(Paragraph("* Possible wash sale: see the realized gains report for the disallowed amount.", st["p"]))
    else:
        story.append(Paragraph("Nothing was sold in this period.", st["p"]))

    story.append(Paragraph("Cash activity", st["h2"]))
    if data["activity"]:
        rows = [["Date", "Category", "Description", "Amount", "Cash after"]]
        rows += [[_ny(e["date"], "%b %d %H:%M"), e["category"], e["description"], _usd(e["amount_cents"]), _usd(e["balance_cents"])]
                 for e in data["activity"]]
        story.append(_table(rows, [0.95 * inch, 1.2 * inch, 3.05 * inch, 0.95 * inch, 0.95 * inch], num_cols=(3, 4)))
    else:
        story.append(Paragraph("No cash activity in this period.", st["p"]))
    story += [Spacer(1, 10), Paragraph(escape(
        "Prices come from public market data (Finnhub, Coinbase, Yahoo Finance) and may be delayed. Executions, fees, "
        "interest and settlement are calculated by TED Brokers."), st["p"])]
    return _doc(story, title)


def _source(bucket: str) -> str:
    if bucket == "self":
        return "Self-directed"
    if bucket.startswith("copy:"):
        return "Copy trading"
    if bucket.startswith("basket:"):
        return "ETF basket"
    return bucket


def render_confirmation(data: Dict) -> bytes:
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph
    from xml.sax.saxutils import escape
    st = _styles()
    o, a = data["order"], data["account"]
    title = f"Trade confirmation - {o['symbol'].strip()} - order {str(o['_id'])[-8:].upper()}"
    story = [Paragraph(f"TED Brokers &middot; {escape(title)}", st["h1"]), Paragraph(escape(NOTICE), st["notice"]),
             Paragraph(escape(f"{a['name']} · Account {a['number']} · Generated {_ny(data['generated_at'], '%b %d, %Y %H:%M')} ET"), st["p"])]
    details = [["Order", "Value"], ["Order id", str(o["_id"])], ["Symbol", f"{o['symbol'].strip()} - {_name(o['symbol'])}"],
               ["Side", o["side"].replace("_", " ")], ["Order type", o["type"].replace("_", " ")], ["Time in force", o.get("tif", "").upper()],
               ["Quantity ordered", o.get("qty") or (f"${o['notional']}" if o.get("notional") else "-")],
               ["Status", o["status"]], ["Source", {"manual": "You (Trading Hub)", "copy": "Copy trading", "bot": "Trader bot",
                                                     "basket": "ETF basket", "liquidation": "House liquidation",
                                                     "system": "System (options settlement)"}.get(o.get("source", "manual"), o.get("source", ""))],
               ["Placed", _ny(o["created_at"], "%b %d, %Y %H:%M:%S") + " ET"]]
    if o.get("limit_price"):
        details.append(["Limit price", _usd(o["limit_price"], cents=False)])
    if o.get("stop_price"):
        details.append(["Stop price", _usd(o["stop_price"], cents=False)])
    story += [Paragraph("Order details", st["h2"]), _table(details, [1.8 * inch, 4.6 * inch])]
    rows = [["Executed (ET)", "Quantity", "Price", "Principal", "Fees", "Net amount", "Settles"]]
    tot = {"qty": D("0"), "gross": D("0"), "fee": D("0"), "net": 0}
    for f in data["fills"]:
        fee_txt = _usd(f.get("fee") or 0, cents=False)
        items = {k: v for k, v in (f.get("fee_items") or {}).items() if D(str(v)) > 0}
        if items:
            fee_txt += " (" + ", ".join(f"{k.replace('_', ' ')} {_usd(v, cents=False)}" for k, v in items.items()) + ")"
        rows.append([_ny(f["ts"], "%b %d %H:%M:%S"), f["qty"], _usd(f["price"], cents=False), _usd(f["gross"], cents=False),
                     fee_txt, _usd(f["cash_delta_cents"]), _ny(f.get("settles_at")) if f.get("settles_at") else "Immediately"])
        tot["qty"] += D(f["qty"])
        tot["gross"] += D(str(f["gross"]))
        tot["fee"] += D(str(f.get("fee") or 0))
        tot["net"] += int(f["cash_delta_cents"])
    if len(data["fills"]) > 1:
        rows.append(["Total", f"{tot['qty'].normalize():f}", "", _usd(tot["gross"], cents=False), _usd(tot["fee"], cents=False),
                     _usd(tot["net"]), ""])
    story += [Paragraph("Executions", st["h2"]),
              _table(rows, [1.15 * inch, 0.75 * inch, 0.85 * inch, 0.95 * inch, 1.6 * inch, 0.95 * inch, 0.85 * inch], num_cols=(1, 2, 3, 5)),
              Paragraph(escape("Executed by TED Brokers against real market quotes (bid/ask plus modelled slippage). "
                               "Regulatory fees are modelled pass-through amounts. Equities and options settle T+1; crypto settles "
                               "immediately."), st["p"])]
    return _doc(story, title)
