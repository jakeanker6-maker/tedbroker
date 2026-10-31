"""Unified portfolio: cash + Trading Hub positions (+ copy buckets later) + managed plans.

    equity       = cash + market value of all positions (brokerage account value)
    total_value  = equity + current value of managed plans (what the user owns in total)
    buying_power = cash not held for orders/withdrawals (cash account)
    withdrawable = buying power minus unsettled sale proceeds (T+1)

Snapshots (portfolio_snapshots) power the equity chart:
  minute  every 60 s for accounts with open positions (kept 30 days)
  daily   once per trading day after the close for every funded account
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Iterable, List, Optional

from pymongo import ASCENDING, DESCENDING

from app.database import USER_INVESTMENTS_COLLECTION, get_collection
from app.market_data import calendar, service
from app.market_data.quotes import public
from app.trading import funding, ledger, positions

D = Decimal
SNAPSHOTS = "portfolio_snapshots"
MINUTE_RETENTION_DAYS = 30
RANGES = {"1D": timedelta(days=1), "1W": timedelta(days=7), "1M": timedelta(days=31), "3M": timedelta(days=92),
          "1Y": timedelta(days=366), "ALL": None}
MAX_POINTS = 300


def snaps():
    return get_collection(SNAPSHOTS)


def ensure_indexes() -> None:
    s = snaps()
    s.create_index([("user_id", ASCENDING), ("ts", ASCENDING)], name="user_time")
    s.create_index([("user_id", ASCENDING), ("kind", ASCENDING), ("date", ASCENDING)], name="user_kind_date")
    try:
        s.create_index([("expire_at", ASCENDING)], expireAfterSeconds=0, name="ttl")
    except Exception:
        pass


def bucket_label(bucket: str) -> str:
    if bucket == "self":
        return "Self-directed"
    if bucket.startswith("copy:"):
        return "Copy trading"
    if bucket.startswith("basket:"):
        return "ETF baskets"
    return bucket


def day_start_utc(now: Optional[datetime] = None) -> datetime:
    """Midnight New York today, as naive UTC (positions opened after this are 'today')."""
    now = (now or datetime.now(timezone.utc)).astimezone(calendar.NY)
    start = datetime.combine(now.date(), datetime.min.time(), calendar.NY)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def plans_value(user_id: str) -> Dict[str, D]:
    from app.routes.investments import calculate_current_value
    invested = value = D("0")
    count = 0
    for inv in get_collection(USER_INVESTMENTS_COLLECTION).find({"user_id": str(user_id), "status": "active"}):
        try:
            cur = calculate_current_value(inv)[0]
        except Exception:
            continue
        invested += D(str(inv["amount_invested"]))
        value += D(str(round(cur, 2)))
        count += 1
    return {"invested": invested, "value": value, "count": count}


def open_positions(user_id: str, bucket: Optional[str] = None) -> List[Dict]:
    q = {"user_id": str(user_id), "open": True}
    if bucket and bucket != "all":
        q["bucket"] = bucket
    return list(positions.col().find(q).sort("symbol", 1))


async def quotes_for(symbols: Iterable[str]) -> Dict[str, Dict]:
    syms = list(dict.fromkeys(symbols))
    if not syms:
        return {}
    raw = await service.get_quotes(syms)
    return {s: public(q) for s, q in raw.items()}


async def positions_view(user_id: str, bucket: Optional[str] = None) -> List[Dict]:
    from app.trading import copy_engine
    pos = await asyncio.to_thread(open_positions, user_id, bucket)
    quotes = await quotes_for(p["symbol"] for p in pos)
    labels = await asyncio.to_thread(copy_engine.labels_for, user_id)
    start = day_start_utc()
    out = []
    for p in pos:
        row = positions.serialize(p, quotes.get(p["symbol"]), start)
        q = quotes.get(p["symbol"]) or {}
        row["name"] = q.get("name") or _name(p["symbol"])
        row["bucket_label"] = labels.get(row["bucket"]) or bucket_label(row["bucket"])
        row["change_percent"] = q.get("change_percent")
        out.append(row)
    return out


def _name(symbol: str) -> str:
    from app.market_data import universe
    try:
        return universe.describe(symbol)["name"]
    except Exception:
        return symbol


def _num(s: Optional[str]) -> D:
    return D(s) if s not in (None, "") else D("0")


def _value(r: Dict) -> D:
    """Market value for totals. An unpriced position counts at its cost basis, and the summary
    reports how many positions are unpriced so the figure is never presented as a live mark."""
    if r.get("market_value") is not None:
        return D(r["market_value"])
    return D(r.get("cost_basis") or "0")


async def summary(user_id: str, rows: Optional[List[Dict]] = None) -> Dict:
    rows = rows if rows is not None else await positions_view(user_id)
    bal = await asyncio.to_thread(ledger.get_balances, user_id)
    withdrawable = await asyncio.to_thread(funding.withdrawable_cents, user_id)
    plans = await asyncio.to_thread(plans_value, user_id)
    realized_today = await asyncio.to_thread(realized_since, user_id, day_start_utc())
    from app.trading import margin
    mstate = await asyncio.to_thread(margin.account_state, user_id)
    bp = mstate.buying_power()
    cash = D(bal["cash_cents"]) / 100
    long_value = sum((_value(r) for r in rows if _value(r) > 0), D("0"))
    short_value = sum((_value(r) for r in rows if _value(r) < 0), D("0"))
    positions_value = long_value + short_value
    unrealized = sum((_num(r["unrealized_pnl"]) for r in rows if r.get("unrealized_pnl") is not None), D("0"))
    unpriced = sum(1 for r in rows if not r.get("priced", True))
    day_known = [r for r in rows if r.get("day_pnl") is not None]
    day_pnl = sum((_num(r["day_pnl"]) for r in day_known), D("0")) + realized_today
    equity = cash + positions_value
    total_value = equity + plans["value"]
    start_value = total_value - day_pnl
    from app.trading import copy_engine
    copy_cash = await asyncio.to_thread(copy_engine.cash_by_bucket, user_id)
    labels = await asyncio.to_thread(copy_engine.labels_for, user_id)
    by_class: Dict[str, D] = defaultdict(lambda: D("0"))
    by_source: Dict[str, D] = defaultdict(lambda: D("0"))
    for r in rows:
        by_class[r["asset_class"]] += _value(r)
        by_source[r["bucket"]] += _value(r)
    for b, c in copy_cash.items():            # cash allocated to a copy belongs to that source
        by_source[b] += c
    free_cash = cash - sum(copy_cash.values(), D("0"))
    by_class["cash"] += cash
    if plans["value"]:
        by_class["managed_plans"] += plans["value"]

    def pct(v: D) -> str:
        return f"{(v / total_value * 100):.2f}" if total_value else "0.00"

    sources = [{"bucket": b, "label": labels.get(b) or bucket_label(b), "value": f"{v:.2f}", "percent": pct(v)}
               for b, v in sorted(by_source.items())]
    if plans["value"]:
        sources.append({"bucket": "plans", "label": "Managed plans", "value": f"{plans['value']:.2f}",
                        "percent": pct(plans["value"]), "count": plans["count"]})
    sources.append({"bucket": "cash", "label": "Cash", "value": f"{free_cash:.2f}", "percent": pct(free_cash)})
    return {
        "total_value": f"{total_value:.2f}",
        "equity": f"{equity:.2f}",
        "cash": f"{cash:.2f}",
        "reserved": f"{bal['reserved_cents'] / 100:.2f}",
        "buying_power": f"{bp['stock']:.2f}",
        "buying_power_detail": {k: f"{v:.2f}" for k, v in bp.items()},
        "margin_debit": f"{mstate.margin_debit:.2f}",
        "maintenance_requirement": f"{mstate.maint_req:.2f}",
        "withdrawable": f"{withdrawable / 100:.2f}",
        "positions_value": f"{positions_value:.2f}",
        "long_value": f"{long_value:.2f}",
        "short_value": f"{short_value:.2f}",
        "unrealized_pnl": f"{unrealized:.2f}",
        "day_pnl": f"{day_pnl:.2f}",
        "day_pnl_percent": f"{(day_pnl / start_value * 100):.2f}" if start_value else "0.00",
        "realized_pnl_today": f"{realized_today:.2f}",
        "plans": {"invested": f"{plans['invested']:.2f}", "value": f"{plans['value']:.2f}", "count": plans["count"]},
        "copy_trading": {"allocated_cash": f"{sum(copy_cash.values(), D('0')):.2f}", "copies": len(copy_cash),
                         "value": f"{sum((v for b, v in by_source.items() if b.startswith('copy:')), D('0')):.2f}"},
        "by_asset_class": [{"asset_class": k, "value": f"{v:.2f}", "percent": pct(v)} for k, v in sorted(by_class.items())],
        "by_source": sources,
        "positions_count": len(rows),
        "unpriced_positions": unpriced,
        "account_type": mstate.account_type,
        "market": calendar.market_status(),
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


def realized_since(user_id: str, since: datetime) -> D:
    total = D("0")
    for f in get_collection("fills").find({"user_id": str(user_id), "status": "applied", "ts": {"$gte": since},
                                           "realized_pnl": {"$nin": [None, "0", "0E-10"]}}, {"realized_pnl": 1}):
        total += D(f["realized_pnl"])
    return total.quantize(D("0.01"))


# ------------------------------------------------------------------ snapshots
async def snapshot_user(user_id: str, kind: str = "minute") -> Dict:
    s = await summary(user_id)
    now = datetime.utcnow()
    doc = {"user_id": str(user_id), "ts": now, "kind": kind,
           "date": datetime.now(calendar.NY).date().isoformat(),
           "equity_cents": int(D(s["equity"]) * 100), "total_value_cents": int(D(s["total_value"]) * 100),
           "cash_cents": int(D(s["cash"]) * 100), "positions_value_cents": int(D(s["positions_value"]) * 100)}
    if kind == "minute":
        doc["expire_at"] = now + timedelta(days=MINUTE_RETENTION_DAYS)
        await asyncio.to_thread(snaps().insert_one, doc)
    else:
        await asyncio.to_thread(snaps().update_one, {"user_id": doc["user_id"], "kind": "daily", "date": doc["date"]},
                                {"$set": doc}, True)
    return doc


async def snapshot_all() -> int:
    """Minute snapshots for accounts with open positions; daily snapshots after the close."""
    users = await asyncio.to_thread(lambda: positions.col().distinct("user_id", {"open": True}))
    n = 0
    for uid in users:
        try:
            await snapshot_user(uid, "minute")
            n += 1
        except Exception as exc:
            print(f"snapshot error {uid}: {exc}")
    now = datetime.now(calendar.NY)
    if calendar.is_trading_day(now.date()) and now >= calendar.session_times(now.date())["close"] + timedelta(minutes=5):
        await daily_close(now.date().isoformat())
    return n


_daily_done: set = set()


async def daily_close(date_str: str) -> None:
    if date_str in _daily_done:
        return
    funded = await asyncio.to_thread(lambda: get_collection("users").distinct("_id", {"cash_cents": {"$gt": 0}}))
    with_pos = await asyncio.to_thread(lambda: positions.col().distinct("user_id", {"open": True}))
    for uid in {str(u) for u in funded} | set(with_pos):
        try:
            await snapshot_user(uid, "daily")
        except Exception as exc:
            print(f"daily snapshot error {uid}: {exc}")
    # options have no exchange 'previous close' in our data: remember today's mark
    for p in await asyncio.to_thread(lambda: list(positions.col().find({"open": True, "asset_class": "option"}))):
        try:
            q = await service.get_quote(p["symbol"])
            await asyncio.to_thread(positions.col().update_one, {"_id": p["_id"]}, {"$set": {"prev_mark": q.get("mid")}})
        except Exception:
            pass
    _daily_done.add(date_str)


async def history(user_id: str, range_: str = "1M") -> Dict:
    range_ = range_.upper()
    if range_ not in RANGES:
        raise ValueError(f"range must be one of {', '.join(RANGES)}")
    span = RANGES[range_]
    since = datetime.utcnow() - span if span else datetime(2000, 1, 1)
    kinds = ["minute", "daily"] if range_ in ("1D", "1W") else ["daily", "minute"]

    def load():
        q = {"user_id": str(user_id), "ts": {"$gte": since}}
        rows = list(snaps().find(q, {"ts": 1, "kind": 1, "total_value_cents": 1, "equity_cents": 1}).sort("ts", 1))
        if range_ not in ("1D", "1W"):
            # longer ranges: one point per day (daily snapshot, else the day's last minute snapshot)
            per_day = {}
            for r in rows:
                day = r["ts"].date()
                if r["kind"] == "daily" or day not in per_day or per_day[day]["kind"] != "daily":
                    per_day[day] = r
            rows = [per_day[d] for d in sorted(per_day)]
        return rows

    rows = await asyncio.to_thread(load)
    if len(rows) > MAX_POINTS:
        step = len(rows) / MAX_POINTS
        rows = [rows[int(i * step)] for i in range(MAX_POINTS - 1)] + [rows[-1]]
    points = [{"t": int(r["ts"].replace(tzinfo=timezone.utc).timestamp()),
               "value": f"{r['total_value_cents'] / 100:.2f}", "equity": f"{r['equity_cents'] / 100:.2f}"} for r in rows]
    now_s = await summary(user_id)
    points.append({"t": int(datetime.now(timezone.utc).timestamp()), "value": now_s["total_value"],
                   "equity": now_s["equity"], "live": True})
    first = D(points[0]["value"])
    last = D(points[-1]["value"])
    return {"range": range_, "points": points, "change": f"{last - first:.2f}",
            "change_percent": f"{((last - first) / first * 100):.2f}" if first else "0.00", "kinds": kinds}
