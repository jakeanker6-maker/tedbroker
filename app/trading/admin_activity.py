"""Read-only admin monitoring of customer trading activity (Trading Hub).

Nothing here writes: no ledger, order, position, snapshot or user changes. Money is returned
as decimal strings (2 dp; prices and marks 4 dp), timestamps as ISO-8601 UTC with a trailing
"Z". Figures that cannot be measured are null, never 0. System (bot) accounts
(`users.is_system == True`) are excluded everywhere. Only fills with status "applied" count
as activity.

Database work runs in worker threads (asyncio.to_thread); quotes come from
`portfolio.quotes_for`, which makes one `service.get_quotes` call per request.
"""
import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional, Tuple

from bson import ObjectId

from app.database import USERS_COLLECTION, get_collection
from app.market_data import service, universe
from app.trading import copy_engine, portfolio, positions

RANGES = ("1D", "1W", "1M", "3M", "1Y", "ALL")
ASSET_CLASSES = ("stock", "etf", "option", "crypto")
SIDES = ("all", "buy", "sell")
BUCKETS = ("all", "self", "copy", "basket")
TRADER_SORTS = ("equity", "return", "realized", "trades", "last_trade")
HOLDING_SORTS = ("market_value", "holders", "unrealized")
# Admin range -> market-data candle range (keys of service.RANGES).
CANDLE_RANGE = {"1D": "1D", "1W": "5D", "1M": "1M", "3M": "3M", "1Y": "1Y", "ALL": "5Y"}
MARKER_CAP = 500
PORTFOLIO_TRADES = 100
CENT = Decimal("0.01")
ZERO = Decimal("0")
D = Decimal

_TALLY_FIELDS = {"user_id": 1, "asset_class": 1, "is_buy": 1, "gross": 1, "fee": 1, "realized_pnl": 1,
                 "symbol": 1, "ts": 1}


class ActivityError(Exception):
    """A request the admin view cannot answer. Routes map it to HTTPException."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ------------------------------------------------------------------ validation
def parse_range(value: Optional[str]) -> str:
    r = (value or "1M").strip().upper()
    if r not in RANGES:
        raise ActivityError(400, "invalid_range", f"range must be one of {', '.join(RANGES)}")
    return r


def parse_choice(value: Optional[str], allowed: Tuple[str, ...], name: str, default: str = "all") -> str:
    v = (value or default).strip().lower()
    if v not in allowed:
        raise ActivityError(400, f"invalid_{name}", f"{name} must be one of {', '.join(allowed)}")
    return v


def parse_asset_class(value: Optional[str]) -> Optional[str]:
    """Returns None for "all" (no filter)."""
    v = parse_choice(value, ("all",) + ASSET_CLASSES, "asset_class")
    return None if v == "all" else v


def parse_user_id(value: Optional[str]) -> str:
    if not value or not ObjectId.is_valid(value):
        raise ActivityError(400, "invalid_user_id", "user_id must be a valid user id")
    return str(ObjectId(value))


def parse_symbol(value: str) -> str:
    try:
        return universe.normalize(value)
    except universe.UnknownSymbol:
        return value.strip().upper()


# ------------------------------------------------------------------ helpers
def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def _iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if isinstance(dt, datetime) else None


def since_for(range_: str) -> Optional[datetime]:
    span = portfolio.RANGES[range_]
    return None if span is None else datetime.now(timezone.utc).replace(tzinfo=None) - span


def dec(v) -> Decimal:
    return ZERO if v in (None, "") else D(str(v))


def money(v: Decimal) -> str:
    q = v.quantize(CENT, rounding=ROUND_HALF_UP)
    if q == 0:
        q = CENT * 0  # never "-0.00"
    return f"{q:.2f}"


def px(v) -> Optional[str]:
    return None if v is None else f"{float(v):.4f}"


def pct(v) -> Optional[str]:
    return None if v is None else f"{float(v):.2f}"


def qty_str(q: Decimal) -> str:
    return "0" if q == 0 else format(q.normalize(), "f")


@lru_cache(maxsize=4096)
def _name(symbol: str) -> str:
    try:
        return universe.describe(symbol)["name"]
    except Exception:
        return symbol


def _system_ids() -> List[str]:
    return [str(u["_id"]) for u in get_collection(USERS_COLLECTION).find({"is_system": True}, {"_id": 1})]


def _users(ids: Iterable[str]) -> Dict[str, Dict]:
    oids = [ObjectId(i) for i in set(ids) if i and ObjectId.is_valid(i)]
    if not oids:
        return {}
    cur = get_collection(USERS_COLLECTION).find(
        {"_id": {"$in": oids}},
        {"email": 1, "full_name": 1, "is_system": 1, "cash_cents": 1, "wallet_balance": 1})
    return {str(u["_id"]): u for u in cur}


def _ref(uid: str, users: Dict[str, Dict]) -> Dict:
    u = users.get(uid) or {}
    return {"id": uid, "email": u.get("email"), "full_name": u.get("full_name")}


def _cash_cents(user: Dict) -> int:
    """Total cash in cents. Read-only: ledger.get_balances would migrate an account (a write)
    when cash_cents is missing, so these views read the stored fields and fall back to the
    legacy wallet_balance mirror."""
    if "cash_cents" in user:
        return int(user["cash_cents"])
    return int((D(str(user.get("wallet_balance") or 0)) * 100).to_integral_value(ROUND_HALF_UP))


def _fills():
    return get_collection("fills")


def _user_clause(system_ids: List[str], user_id: Optional[str]):
    if user_id is not None:
        return {"$in": []} if user_id in system_ids else user_id
    return {"$nin": system_ids}


def fill_query(range_: str, asset_class: Optional[str] = None, side: str = "all", user_id: Optional[str] = None,
               symbol: Optional[str] = None, bucket: str = "all", system_ids: Iterable[str] = ()) -> Dict:
    """Applied fills in range. System accounts are excluded unless user_id names one (then none)."""
    q: Dict[str, Any] = {"status": "applied", "user_id": _user_clause(list(system_ids), user_id)}
    since = since_for(range_)
    if since:
        q["ts"] = {"$gte": since}
    if asset_class:
        q["asset_class"] = asset_class
    if side == "buy":
        q["is_buy"] = True
    elif side == "sell":
        q["is_buy"] = False
    if symbol:
        q["symbol"] = symbol
    if bucket == "self":
        q["bucket"] = "self"
    elif bucket == "copy":
        q["bucket"] = {"$regex": "^copy:"}
    elif bucket == "basket":
        q["bucket"] = {"$regex": "^basket:"}
    return q


def _pos_query(asset_class: Optional[str], system_ids: List[str], open_only: bool = False) -> Dict:
    q: Dict[str, Any] = {"user_id": {"$nin": system_ids}}
    if open_only:
        q["open"] = True
    if asset_class:
        q["asset_class"] = asset_class
    return q


def _labels_map(pairs: Iterable[Tuple[str, str]]) -> Dict[str, Dict[str, str]]:
    """Copy-bucket labels per user. DB read: call from a worker thread."""
    uids = {uid for uid, bucket in pairs if bucket.startswith("copy:")}
    return {uid: copy_engine.labels_for(uid) for uid in uids}


def _label(uid: str, bucket: str, labels: Dict[str, Dict[str, str]]) -> str:
    if bucket.startswith("copy:"):
        return (labels.get(uid) or {}).get(bucket) or portfolio.bucket_label(bucket)
    return portfolio.bucket_label(bucket)


def _rank_desc_nulls_last(items: List, key) -> List:
    """Stable descending sort; items whose key is None go last."""
    keyed = [(key(i), i) for i in items]
    present = sorted((kv for kv in keyed if kv[0] is not None), key=lambda kv: kv[0], reverse=True)
    return [i for _, i in present] + [i for k, i in keyed if k is None]


def _unrealized_of(rows: List[Dict]) -> Optional[Decimal]:
    """Sum of unrealised P&L over priced positions. None when positions exist but none is priced;
    zero when there are no open positions."""
    priced = [dec(r["unrealized_pnl"]) for r in rows if r.get("unrealized_pnl") is not None]
    if priced:
        return sum(priced, ZERO)
    return None if rows else ZERO


def _value_of(rows: List[Dict]) -> Decimal:
    """Portfolio convention: unpriced positions count at cost basis (see portfolio.summary)."""
    return sum((dec(r["market_value"]) if r["market_value"] is not None else dec(r["cost_basis"])
                for r in rows), ZERO)


def _tally(fills: List[Dict]) -> Dict[str, Any]:
    t = {"count": 0, "buys": 0, "sells": 0, "volume": ZERO, "buy_volume": ZERO, "sell_volume": ZERO,
         "fees": ZERO, "realized_pnl": ZERO}
    for f in fills:
        g = dec(f.get("gross"))
        t["count"] += 1
        t["volume"] += g
        t["fees"] += dec(f.get("fee"))
        t["realized_pnl"] += dec(f.get("realized_pnl"))
        if f.get("is_buy"):
            t["buys"] += 1
            t["buy_volume"] += g
        else:
            t["sells"] += 1
            t["sell_volume"] += g
    return t


def trade_row(f: Dict, users: Dict[str, Dict], labels: Dict[str, Dict[str, str]]) -> Dict:
    uid = f["user_id"]
    bucket = f.get("bucket", "self")
    rp = dec(f.get("realized_pnl"))
    return {
        "id": str(f["_id"]), "ts": _iso(f["ts"]), "user": _ref(uid, users),
        "symbol": f["symbol"], "name": _name(f["symbol"]), "asset_class": f["asset_class"],
        "side": f["side"], "direction": "buy" if f.get("is_buy") else "sell",
        "qty": qty_str(dec(f["qty"])), "price": px(dec(f["price"])), "gross": money(dec(f["gross"])),
        "fee": money(dec(f.get("fee"))), "net_cash": money(D(int(f.get("cash_delta_cents") or 0)) / 100),
        "realized_pnl": None if rp == 0 else money(rp),
        "bucket": bucket, "bucket_label": _label(uid, bucket, labels),
        "kind": f.get("kind", "trade"), "source": f.get("source", "manual"),
    }


def _quote_block(q: Optional[Dict]) -> Optional[Dict]:
    if not q:
        return None
    return {"last": px(q.get("last")), "bid": px(q.get("bid")), "ask": px(q.get("ask")),
            "mid": px(q.get("mid")), "change_percent": pct(q.get("change_percent")),
            "source": q.get("source"), "stale": bool(q.get("stale"))}


# ------------------------------------------------------------------ 1) summary
async def summary(range: str = "1M", asset_class: Optional[str] = "all") -> Dict:
    range_ = parse_range(range)
    ac = parse_asset_class(asset_class)

    def load():
        sys = _system_ids()
        fills = list(_fills().find(fill_query(range_, ac, system_ids=sys), _TALLY_FIELDS))
        open_pos = list(positions.col().find(_pos_query(ac, sys, open_only=True), {"user_id": 1}))
        return fills, open_pos

    fills, open_pos = await asyncio.to_thread(load)
    total = _tally(fills)
    by_class: Dict[str, List[Dict]] = defaultdict(list)
    for f in fills:
        by_class[f["asset_class"]].append(f)
    classes = []
    for name, rows in by_class.items():
        t = _tally(rows)
        if t["count"] > 0:
            classes.append({"asset_class": name, "trades": t["count"], "buys": t["buys"], "sells": t["sells"],
                            "volume": money(t["volume"])})
    classes.sort(key=lambda c: (-D(c["volume"]), c["asset_class"]))
    return {
        "range": range_, "asset_class": ac or "all", "as_of": _now_iso(),
        "trades": {"count": total["count"], "buys": total["buys"], "sells": total["sells"],
                   "volume": money(total["volume"]), "fees": money(total["fees"]),
                   "realized_pnl": money(total["realized_pnl"])},
        "by_asset_class": classes,
        "active_traders": len({f["user_id"] for f in fills}),
        "open_positions": len(open_pos),
        "traders_holding": len({p["user_id"] for p in open_pos}),
    }


# ------------------------------------------------------------------ 2) trades
async def trades(range: str = "1M", asset_class: Optional[str] = "all", side: str = "all",
                 user_id: Optional[str] = None, symbol: Optional[str] = None, bucket: str = "all",
                 limit: int = 50, offset: int = 0) -> Dict:
    range_ = parse_range(range)
    ac = parse_asset_class(asset_class)
    side = parse_choice(side, SIDES, "side")
    bucket = parse_choice(bucket, BUCKETS, "bucket")
    uid = parse_user_id(user_id) if user_id else None
    sym = parse_symbol(symbol) if symbol else None

    def load():
        sys = _system_ids()
        q = fill_query(range_, ac, side, uid, sym, bucket, sys)
        total = _fills().count_documents(q)
        docs = list(_fills().find(q).sort([("ts", -1), ("_id", -1)]).skip(offset).limit(limit))
        users = _users({d["user_id"] for d in docs})
        labels = _labels_map((d["user_id"], d.get("bucket", "self")) for d in docs)
        return total, [trade_row(d, users, labels) for d in docs]

    total, items = await asyncio.to_thread(load)
    return {"range": range_, "asset_class": ac or "all", "as_of": _now_iso(), "total": total,
            "limit": limit, "offset": offset, "items": items}


# ------------------------------------------------------------------ 3) holdings
def _new_group(quote: Optional[Dict]) -> Dict:
    return {"asset_class": None, "users": set(), "long": set(), "short": set(), "net": ZERO, "basis": ZERO,
            "mv": ZERO, "priced": 0, "unpriced": 0, "upnl": ZERO, "priced_basis": ZERO,
            "mark": None, "change_percent": (quote or {}).get("change_percent")}


async def holdings(asset_class: Optional[str] = "all", sort: str = "market_value", limit: int = 100) -> Dict:
    ac = parse_asset_class(asset_class)
    sort = parse_choice(sort, HOLDING_SORTS, "sort", default="market_value")

    def load():
        sys = _system_ids()
        return list(positions.col().find(_pos_query(ac, sys)))

    all_pos = await asyncio.to_thread(load)
    open_pos = [p for p in all_pos if p.get("open")]
    quotes = await portfolio.quotes_for({p["symbol"] for p in open_pos})
    day_start = portfolio.day_start_utc()
    lifetime: Dict[str, Decimal] = defaultdict(lambda: ZERO)
    for p in all_pos:
        lifetime[p["symbol"]] += dec(p.get("realized_pnl"))
    groups: Dict[str, Dict] = {}
    for p in open_pos:
        sym = p["symbol"]
        g = groups.setdefault(sym, _new_group(quotes.get(sym)))
        row = positions.serialize(p, quotes.get(sym), day_start)
        qty = dec(p["qty"])
        g["asset_class"] = p["asset_class"]
        g["users"].add(p["user_id"])
        (g["long"] if qty > 0 else g["short"]).add(p["user_id"])
        g["net"] += qty
        g["basis"] += dec(p["cost_basis"])
        if g["mark"] is None:
            g["mark"] = row["mark"]
        if row["market_value"] is not None:
            g["priced"] += 1
            g["mv"] += dec(row["market_value"])
            g["upnl"] += dec(row["unrealized_pnl"])
            g["priced_basis"] += dec(p["cost_basis"])
        else:
            g["unpriced"] += 1
    items = []
    for sym in sorted(groups):
        g = groups[sym]
        priced = g["priced"] > 0
        items.append({
            "symbol": sym, "name": _name(sym), "asset_class": g["asset_class"],
            "holders": len(g["users"]), "long_holders": len(g["long"]), "short_holders": len(g["short"]),
            "net_qty": qty_str(g["net"]), "cost_basis": money(g["basis"]),
            "market_value": money(g["mv"]) if priced else None,
            "unpriced_positions": g["unpriced"],
            "unrealized_pnl": money(g["upnl"]) if priced else None,
            "unrealized_pnl_percent": (f"{g['upnl'] / abs(g['priced_basis']) * 100:.2f}"
                                       if priced and g["priced_basis"] != 0 else None),
            "mark": g["mark"], "change_percent": pct(g["change_percent"]),
            "realized_pnl": money(lifetime[sym]),
        })

    def key(i: Dict):
        if sort == "holders":
            return D(i["holders"])
        field = "market_value" if sort == "market_value" else "unrealized_pnl"
        return dec(i[field]) if i[field] is not None else None

    ranked = _rank_desc_nulls_last(items, key)[:limit]
    return {"as_of": _now_iso(), "asset_class": ac or "all", "sort": sort, "total": len(items), "items": ranked}


# ------------------------------------------------------------------ 4) asset detail
async def _candles_block(symbol: str, asset_class: str, range_: str) -> Tuple[Optional[Dict], Optional[str]]:
    if asset_class == "option":
        return None, "Candles are not available for option contracts"
    try:
        data = await service.get_candles(symbol, CANDLE_RANGE[range_])
    except Exception as exc:  # a provider failure must not fail the whole request
        return None, str(exc) or "Candles are unavailable"
    points = [{"t": int(c["t"]), "c": f"{float(c['c']):.4f}"}
              for c in data.get("candles", []) if c.get("c") is not None]
    return {"interval": data.get("interval"), "source": data.get("source"), "points": points}, None


async def asset_detail(symbol: str, range: str = "1M") -> Dict:
    range_ = parse_range(range)
    try:
        sym = universe.normalize(symbol)
        info = universe.describe(sym)
    except universe.UnknownSymbol:
        raise ActivityError(404, "unknown_symbol", "Unknown symbol")
    ac = info["asset_class"]
    quotes, (candles, candles_reason) = await asyncio.gather(
        portfolio.quotes_for([sym]), _candles_block(sym, ac, range_))
    quote = quotes.get(sym)

    def load():
        sys = _system_ids()
        range_fills = list(_fills().find(fill_query(range_, symbol=sym, system_ids=sys), _TALLY_FIELDS))
        marker_docs = list(_fills().find(fill_query(range_, symbol=sym, system_ids=sys))
                           .sort([("ts", -1), ("_id", -1)]).limit(MARKER_CAP))
        pos_all = list(positions.col().find({"symbol": sym, "user_id": {"$nin": sys}}))
        open_pos = [p for p in pos_all if p.get("open")]
        uids = {f["user_id"] for f in range_fills} | {p["user_id"] for p in open_pos}
        users = _users(uids)
        labels = _labels_map([(p["user_id"], p.get("bucket", "self")) for p in open_pos])
        return range_fills, marker_docs, pos_all, open_pos, users, labels

    range_fills, marker_docs, pos_all, open_pos, users, labels = await asyncio.to_thread(load)
    day_start = portfolio.day_start_utc()
    holders, rows = [], []
    for p in open_pos:
        row = positions.serialize(p, quote, day_start)
        rows.append(row)
        uid = p["user_id"]
        holders.append({
            "user": _ref(uid, users), "bucket": row["bucket"],
            "bucket_label": _label(uid, row["bucket"], labels), "qty": row["qty"],
            "avg_cost": row["avg_cost"], "mark": row["mark"], "market_value": row["market_value"],
            "unrealized_pnl": row["unrealized_pnl"], "unrealized_pnl_percent": row["unrealized_pnl_percent"],
            "realized_pnl": row["realized_pnl"], "opened_at": row["opened_at"],
        })
    holders = _rank_desc_nulls_last(
        holders, lambda h: abs(dec(h["market_value"])) if h["market_value"] is not None else None)
    priced_mv = [dec(r["market_value"]) for r in rows if r["market_value"] is not None]
    upnl = _unrealized_of(rows)
    t = _tally(range_fills)
    markers = []
    for f in reversed(marker_docs):  # chronological, for charting
        markers.append({"t": int(f["ts"].replace(tzinfo=timezone.utc).timestamp()),
                        "direction": "buy" if f.get("is_buy") else "sell",
                        "qty": qty_str(dec(f["qty"])), "price": px(dec(f["price"])),
                        "user_email": (users.get(f["user_id"]) or {}).get("email")})
    return {
        "symbol": sym, "name": info["name"], "asset_class": ac, "range": range_, "as_of": _now_iso(),
        "quote": _quote_block(quote),
        "candles": candles, "candles_unavailable_reason": candles_reason,
        "trades_summary": {"count": t["count"], "buys": t["buys"], "sells": t["sells"],
                           "buy_volume": money(t["buy_volume"]), "sell_volume": money(t["sell_volume"]),
                           "fees": money(t["fees"]), "realized_pnl": money(t["realized_pnl"])},
        "trade_markers": markers,
        "holders": holders,
        "totals": {"holders": len({p["user_id"] for p in open_pos}),
                   "market_value": money(sum(priced_mv, ZERO)) if priced_mv else None,
                   "unrealized_pnl": None if upnl is None else money(upnl),
                   "realized_pnl": money(sum((dec(p.get("realized_pnl")) for p in pos_all), ZERO))},
    }


# ------------------------------------------------------------------ 5) traders
async def traders(range: str = "1M", asset_class: Optional[str] = "all", sort: str = "equity",
                  limit: int = 100, offset: int = 0) -> Dict:
    range_ = parse_range(range)
    ac = parse_asset_class(asset_class)
    sort = parse_choice(sort, TRADER_SORTS, "sort", default="equity")

    def load():
        sys = _system_ids()
        fills = list(_fills().find(fill_query(range_, ac, system_ids=sys), _TALLY_FIELDS))
        last = {r["_id"]: r["last"] for r in _fills().aggregate([
            {"$match": fill_query("ALL", ac, system_ids=sys)},
            {"$group": {"_id": "$user_id", "last": {"$max": "$ts"}}}])}
        all_pos = list(positions.col().find(_pos_query(ac, sys)))
        open_uids = {p["user_id"] for p in all_pos if p.get("open")}
        candidates = {f["user_id"] for f in fills} | open_uids
        users = _users(candidates)
        # Accounts that cannot be identified (no users document) are left out.
        uids = {u for u in candidates if u in users}
        baseline: Dict[str, int] = {}
        if uids:
            since = since_for(range_)
            match: Dict[str, Any] = {"user_id": {"$in": list(uids)}}
            if since:
                match["ts"] = {"$gte": since}
            for r in portfolio.snaps().aggregate([
                    {"$match": match}, {"$sort": {"ts": 1}},
                    {"$group": {"_id": "$user_id", "value": {"$first": "$total_value_cents"}}}]):
                baseline[r["_id"]] = int(r["value"])
        plans = {u: portfolio.plans_value(u)["value"] for u in uids}
        return {"fills": fills, "last": last, "all_pos": all_pos, "uids": uids, "users": users,
                "baseline": baseline, "plans": plans}

    d = await asyncio.to_thread(load)
    uids = d["uids"]
    open_pos = [p for p in d["all_pos"] if p.get("open") and p["user_id"] in uids]
    quotes = await portfolio.quotes_for({p["symbol"] for p in open_pos})
    day_start = portfolio.day_start_utc()
    open_rows: Dict[str, List[Dict]] = defaultdict(list)
    for p in open_pos:
        open_rows[p["user_id"]].append(positions.serialize(p, quotes.get(p["symbol"]), day_start))
    realized: Dict[str, Decimal] = defaultdict(lambda: ZERO)
    for p in d["all_pos"]:
        if p["user_id"] in uids:
            realized[p["user_id"]] += dec(p.get("realized_pnl"))
    fills_by: Dict[str, List[Dict]] = defaultdict(list)
    for f in d["fills"]:
        fills_by[f["user_id"]].append(f)

    entries = []
    for uid in sorted(uids, key=lambda u: (d["users"][u].get("email") or "", u)):
        rows = open_rows.get(uid, [])
        cash = D(_cash_cents(d["users"][uid])) / 100
        pv = _value_of(rows)
        equity = cash + pv
        total = equity + d["plans"][uid]
        base = d["baseline"].get(uid)
        ret = change = None
        if base:
            first = D(base) / 100
            change = total - first
            ret = change / first * 100
        t = _tally(fills_by.get(uid, []))
        last_at = d["last"].get(uid)
        upnl = _unrealized_of(rows)
        raw = {"equity": equity, "return": ret, "realized": realized[uid], "trades": t["count"], "last": last_at}
        item = {
            "user": _ref(uid, d["users"]), "open_positions": len(rows),
            "cash": money(cash), "positions_value": money(pv), "equity": money(equity),
            "total_value": money(total), "unrealized_pnl": None if upnl is None else money(upnl),
            "realized_pnl": money(realized[uid]), "trades": t["count"], "volume": money(t["volume"]),
            "realized_pnl_range": money(t["realized_pnl"]), "last_trade_at": _iso(last_at),
            "return_percent": pct(ret), "change": None if change is None else money(change),
        }
        entries.append((raw, item))
    keys = {"equity": lambda r: r["equity"], "return": lambda r: r["return"],
            "realized": lambda r: r["realized"], "trades": lambda r: D(r["trades"]),
            "last_trade": lambda r: r["last"]}
    ranked = _rank_desc_nulls_last(entries, lambda e: keys[sort](e[0]))
    page = [item for _, item in ranked][offset:offset + limit]
    return {"range": range_, "asset_class": ac or "all", "sort": sort, "as_of": _now_iso(),
            "total": len(ranked), "limit": limit, "offset": offset, "items": page}


# ------------------------------------------------------------------ 6) trader portfolio
def _user_or_404(user_id: str) -> Dict:
    if not ObjectId.is_valid(user_id):
        raise ActivityError(404, "not_found", "User not found")
    u = get_collection(USERS_COLLECTION).find_one(
        {"_id": ObjectId(user_id)},
        {"email": 1, "full_name": 1, "is_system": 1, "cash_cents": 1, "wallet_balance": 1})
    if not u or u.get("is_system"):
        raise ActivityError(404, "not_found", "User not found")
    if "cash_cents" not in u:
        # portfolio.summary would migrate the account (a write); an admin view must not.
        raise ActivityError(409, "ledger_not_initialised",
                            "This account has no ledger balance yet, so its portfolio cannot be read.")
    return u


async def trader_portfolio(user_id: str, range: str = "1M") -> Dict:
    range_ = parse_range(range)
    uid = str(ObjectId(user_id)) if ObjectId.is_valid(user_id) else user_id
    user = await asyncio.to_thread(_user_or_404, uid)
    rows = await portfolio.positions_view(uid)
    summ = await portfolio.summary(uid, rows)
    hist = await portfolio.history(uid, range_)

    def load():
        range_fills = list(_fills().find(fill_query(range_, user_id=uid, system_ids=[]), _TALLY_FIELDS))
        recent = list(_fills().find(fill_query(range_, user_id=uid, system_ids=[]))
                      .sort([("ts", -1), ("_id", -1)]).limit(PORTFOLIO_TRADES))
        pos_all = list(positions.col().find({"user_id": uid}, {"realized_pnl": 1}))
        labels = _labels_map((uid, f.get("bucket", "self")) for f in recent)
        return range_fills, recent, pos_all, labels

    range_fills, recent, pos_all, labels = await asyncio.to_thread(load)
    t = _tally(range_fills)
    lifetime = sum((dec(p.get("realized_pnl")) for p in pos_all), ZERO)
    upnl = _unrealized_of(rows)
    return {
        "user": {"id": uid, "email": user.get("email"), "full_name": user.get("full_name"),
                 "is_system": bool(user.get("is_system"))},
        "range": range_, "as_of": summ["as_of"],
        "summary": {
            "total_value": summ["total_value"], "equity": summ["equity"], "cash": summ["cash"],
            "positions_value": summ["positions_value"],
            "unrealized_pnl": None if upnl is None else money(upnl),
            "realized_pnl_lifetime": money(lifetime), "realized_pnl_range": money(t["realized_pnl"]),
            "trades_range": t["count"], "volume_range": money(t["volume"]),
            "buying_power": summ["buying_power"],
        },
        "allocation": [{"asset_class": a["asset_class"], "value": a["value"], "percent": a["percent"]}
                       for a in summ["by_asset_class"]],
        "history": hist,
        "positions": rows,
        "trades": [trade_row(f, {uid: user}, labels) for f in recent],
    }
