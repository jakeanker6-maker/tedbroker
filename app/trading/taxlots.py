"""Realized gains report from fills: tax lots (FIFO or average cost), holding periods and
wash-sale flags. Simulated accounts only: this is an educational report, not tax advice.

Lots are tracked per (symbol, position bucket), so they match what the account actually
held (self-directed, each copy, each basket). Fees are part of the numbers: buy fees add to
cost basis, sell fees reduce proceeds.

  long   buy opens a lot (cost = gross + fee), sell closes lots (proceeds = gross - fee)
  short  sell short / sell to open opens a negative lot (proceeds = gross - fee),
         buy to cover / buy to close closes it (cost = gross + fee); short sales are
         short-term regardless of how long the short was open
  options expiring worthless close at $0; exercise/assignment fills are already booked
         as an option close plus a stock trade, so they need no special case here

Holding period: long-term when the position was held more than one year (sold after the
first anniversary of the purchase date, in New York time).

Method
  fifo     the earliest open lot closes first
  average  cost basis is the average of the open lots (like the positions screen); the
           holding period of each closed portion still follows purchase order (FIFO)

Wash sales (stocks, ETFs and options; not crypto): a loss on a sale is flagged when shares
of the same symbol were bought within 30 days before or after the sale (any bucket),
excluding the shares that were sold. Disallowed = loss x min(1, replacement qty / sold qty).
The report shows the flag and amount; it does not carry the disallowed loss into the
replacement lot's basis.
"""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Iterable, List, Optional

from app.market_data import calendar

D = Decimal
ZERO = D("0")
WASH_WINDOW = timedelta(days=30)
WASH_CLASSES = ("stock", "etf", "option")


def _ny_date(ts: datetime) -> date:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(calendar.NY).date()


def _long_term(acquired: date, sold: date) -> bool:
    try:
        anniversary = acquired.replace(year=acquired.year + 1)
    except ValueError:            # 29 February
        anniversary = acquired.replace(year=acquired.year + 1, day=28)
    return sold > anniversary


@dataclass
class Lot:
    qty: D                       # > 0
    per_unit: D                  # long: cost per unit; short: proceeds per unit
    opened: datetime
    fill_id: str
    short: bool = False


@dataclass
class Disposal:
    symbol: str
    asset_class: str
    bucket: str
    qty: D
    acquired: datetime
    sold: datetime
    proceeds: D
    cost: D
    short: bool
    close_fill_id: str
    open_fill_ids: List[str] = field(default_factory=list)
    wash_disallowed: D = ZERO

    @property
    def gain(self) -> D:
        return self.proceeds - self.cost

    @property
    def term(self) -> str:
        if self.short:
            return "short"
        return "long" if _long_term(_ny_date(self.acquired), _ny_date(self.sold)) else "short"


def _unit(f: Dict, buy: bool) -> D:
    """Per-unit cash: what a buy costs (gross + fee) or a sell brings in (gross - fee)."""
    qty = D(f["qty"])
    gross, fee = D(str(f["gross"])), D(str(f.get("fee") or "0"))
    if qty == 0:
        return ZERO
    return ((gross + fee) if buy else (gross - fee)) / qty


def compute_disposals(fills: Iterable[Dict], method: str = "fifo") -> List[Disposal]:
    """All closing events, oldest first. `fills` may be in any order (sorted by ts here)."""
    fills = list(fills)
    out, _ = replay(fills, method)
    _flag_wash_sales(out, fills)
    return out


def open_lots(fills: Iterable[Dict], method: str = "fifo") -> Dict[tuple, List[Lot]]:
    """Lots still open after the given fills, keyed by (symbol, bucket)."""
    _, books = replay(list(fills), method)
    return {k: v for k, v in books.items() if v}


def replay(fills: List[Dict], method: str = "fifo"):
    if method not in ("fifo", "average"):
        raise ValueError("method must be fifo or average")
    books: Dict[tuple, List[Lot]] = defaultdict(list)
    out: List[Disposal] = []
    for f in sorted(fills, key=lambda x: (x["ts"], str(x["_id"]))):
        qty = D(f["qty"])
        if qty <= 0:
            continue
        key = (f["symbol"], f.get("bucket", "self"))
        lots = books[key]
        buy = bool(f["is_buy"])
        pos_short = bool(lots) and lots[0].short
        closing = bool(lots) and (pos_short == buy)        # a buy closes shorts, a sell closes longs
        remaining = qty
        if closing:
            pool_unit = None
            if method == "average":
                total = sum((l.qty for l in lots), ZERO)
                pool_unit = sum((l.qty * l.per_unit for l in lots), ZERO) / total if total else ZERO
            close_unit = _unit(f, buy=buy)
            while remaining > 0 and lots:
                lot = lots[0]
                m = min(lot.qty, remaining)
                open_unit = pool_unit if pool_unit is not None else lot.per_unit
                if lot.short:
                    proceeds, cost = m * open_unit, m * close_unit
                else:
                    proceeds, cost = m * close_unit, m * open_unit
                out.append(Disposal(symbol=f["symbol"], asset_class=f["asset_class"], bucket=key[1], qty=m,
                                    acquired=lot.opened, sold=f["ts"], proceeds=proceeds, cost=cost, short=lot.short,
                                    close_fill_id=str(f["_id"]), open_fill_ids=[lot.fill_id]))
                lot.qty -= m
                remaining -= m
                if lot.qty == 0:
                    lots.pop(0)
                elif pool_unit is not None:
                    lot.per_unit = pool_unit
            if pool_unit is not None:
                for l in lots:
                    l.per_unit = pool_unit
        if remaining > 0:   # opening (or the part of a flip beyond the old position)
            lots.append(Lot(qty=remaining, per_unit=_unit(f, buy=buy), opened=f["ts"], fill_id=str(f["_id"]), short=not buy))
    return out, books


def _flag_wash_sales(disposals: List[Disposal], fills: Iterable[Dict]) -> None:
    buys: Dict[str, List[Dict]] = defaultdict(list)
    for f in fills:
        if f["is_buy"] and f["asset_class"] in WASH_CLASSES and f["side"] in ("buy", "buy_to_open"):
            buys[f["symbol"]].append(f)
    # one sale can produce several disposals (lots); evaluate per closing fill
    by_close: Dict[str, List[Disposal]] = defaultdict(list)
    for d in disposals:
        if not d.short and d.asset_class in WASH_CLASSES:
            by_close[d.close_fill_id].append(d)
    for group in by_close.values():
        loss_parts = [d for d in group if d.gain < 0]
        if not loss_parts:
            continue
        sold_at = group[0].sold
        excluded = {i for d in group for i in d.open_fill_ids}
        replacement = sum((D(b["qty"]) for b in buys[group[0].symbol]
                           if str(b["_id"]) not in excluded and abs(b["ts"] - sold_at) <= WASH_WINDOW
                           and str(b["_id"]) != group[0].close_fill_id), ZERO)
        if replacement <= 0:
            continue
        loss_qty = sum((d.qty for d in loss_parts), ZERO)
        ratio = min(D("1"), replacement / loss_qty) if loss_qty else ZERO
        for d in loss_parts:
            d.wash_disallowed = (-d.gain * ratio).quantize(D("0.01"))


def _money(v: D) -> str:
    return f"{v.quantize(D('0.01')):.2f}"


def report(fills: Iterable[Dict], year: int, method: str = "fifo", describe=None) -> Dict:
    """Realized gains for disposals whose sale date (New York) falls in `year`."""
    fills = [f for f in fills if f.get("status", "applied") == "applied"]
    rows = []
    totals = {"short": {"proceeds": ZERO, "cost": ZERO, "gain": ZERO, "wash": ZERO},
              "long": {"proceeds": ZERO, "cost": ZERO, "gain": ZERO, "wash": ZERO}}
    for d in compute_disposals(fills, method):
        if _ny_date(d.sold).year != year:
            continue
        t = totals[d.term]
        t["proceeds"] += d.proceeds
        t["cost"] += d.cost
        t["gain"] += d.gain
        t["wash"] += d.wash_disallowed
        rows.append({
            "symbol": d.symbol, "description": (describe(d.symbol) if describe else d.symbol),
            "asset_class": d.asset_class, "source": d.bucket, "position": "short" if d.short else "long",
            "quantity": f"{d.qty.normalize():f}", "date_acquired": _ny_date(d.acquired).isoformat(),
            "date_sold": _ny_date(d.sold).isoformat(), "proceeds": _money(d.proceeds), "cost_basis": _money(d.cost),
            "gain_loss": _money(d.gain), "term": d.term, "wash_sale_disallowed": _money(d.wash_disallowed),
            "wash_sale": d.wash_disallowed > 0,
        })
    summary = {term: {k: _money(v) for k, v in t.items()} for term, t in totals.items()}
    net = totals["short"]["gain"] + totals["long"]["gain"]
    wash = totals["short"]["wash"] + totals["long"]["wash"]
    return {"year": year, "method": method, "rows": rows, "summary": summary,
            "net_gain_loss": _money(net), "wash_sale_disallowed": _money(wash),
            "net_after_wash_sales": _money(net + wash)}


CSV_COLUMNS = ["symbol", "description", "asset_class", "source", "position", "quantity", "date_acquired",
               "date_sold", "proceeds", "cost_basis", "gain_loss", "term", "wash_sale_disallowed"]


def to_csv(rep: Dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"TED Brokers - realized gains {rep['year']} - "
                f"method {rep['method']} - not tax advice"])
    w.writerow(CSV_COLUMNS)
    for r in rep["rows"]:
        w.writerow([_csv_safe(r[c]) for c in CSV_COLUMNS])
    w.writerow([])
    for term in ("short", "long"):
        s = rep["summary"][term]
        w.writerow([f"{term}-term totals", "", "", "", "", "", "", "", s["proceeds"], s["cost"], s["gain"], "", s["wash"]])
    w.writerow(["net gain/loss", rep["net_gain_loss"], "wash sales disallowed", rep["wash_sale_disallowed"]])
    return buf.getvalue()


def _csv_safe(v) -> str:
    """Neutralise spreadsheet formula injection in text cells."""
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") and not _is_number(s) else s


def _is_number(s: str) -> bool:
    try:
        D(s)
        return True
    except Exception:
        return False


def years_with_activity(fills: Iterable[Dict]) -> List[int]:
    return sorted({_ny_date(f["ts"]).year for f in fills}, reverse=True)


def user_fills(user_id: str) -> List[Dict]:
    from app.trading import orders
    return list(orders.fills_col().find({"user_id": str(user_id), "status": "applied"},
                                        {"quote": 0, "fee_items": 0}))
