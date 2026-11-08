"""Read-only admin monitoring of MANUAL (user-initiated) trading activity.

Scope: only fills with status "applied" and source "manual" count. Automated activity (bot,
copy, basket, recurring, liquidation, system) is excluded everywhere.

A position is manual when it is open (or, for lifetime figures, any position), bucket "self",
belongs to a non-system user, has at least one manual fill and no automated fill in the same
(user_id, symbol) self bucket. The key set is built with one aggregation over fills.

Nothing here writes. Money is returned as decimal strings (2 dp; prices and marks 4 dp),
timestamps as ISO-8601 UTC with a trailing "Z". Figures that cannot be measured are null,
never 0. System (bot) accounts (`users.is_system == True`) are excluded everywhere.
Account-level balances and snapshot history are deliberately not returned: they cannot be
split into manual and automated parts.

Database work runs in worker threads (asyncio.to_thread); quotes come from
`portfolio.quotes_for`, one `service.get_quotes` call per request.
"""
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from bson import ObjectId
from pymongo import ASCENDING

from app.database import MANUAL_SNAPSHOTS_COLLECTION, USERS_COLLECTION, get_collection
from app.market_data import calendar, service, universe
from app.trading import portfolio, positions

RANGES = ("1D", "1W", "1M", "3M", "1Y", "ALL")
ASSET_CLASSES = ("stock", "etf", "option", "crypto")
SIDES = ("all", "buy", "sell")
BUCKETS = ("all", "self", "copy", "basket")
TRADER_SORTS = ("equity", "return", "realized", "trades", "last_trade")
HOLDING_SORTS = ("market_value", "holders", "unrealized")
# Admin range -> market-data candle range (keys of service.RANGES).
CANDLE_RANGE = {"1D": "1D", "1W": "5D", "1M": "1M", "3M": "3M", "1Y": "1Y", "ALL": "5Y"}
MANUAL = "manual"
MARKER_CAP = 500
PORTFOLIO_TRADES = 100
CENT = Decimal("0.01")
ZERO = Decimal("0")
D = Decimal

# traders sort -> row field. There is no return field for manual activity, so "return"
# orders by unrealized P&L and "equity" orders by positions value (see README/docs).
TRADER_SORT_FIELD = {"equity": "positions_value", "return": "unrealized_pnl", "realized": "realized_pnl",
                     "trades": "trades", "last_trade": "last_trade_at"}

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
    cur = get_collection(USERS_COLLECTION).find({"_id": {"$in": oids}},
                                                {"email": 1, "full_name": 1, "is_system": 1})
    return {str(u["_id"]): u for u in cur}


def _ref(uid: str, users: Dict[str, Dict]) -> Dict:
    u = users.get(uid) or {}
    return {"id": uid, "email": u.get("email"), "full_name": u.get("full_name")}


def _fills():
    return get_collection("fills")


def _user_clause(system_ids: List[str], user_id: Optional[str]):
    if user_id is not None:
        return {"$in": []} if user_id in system_ids else user_id
    return {"$nin": system_ids}


# ------------------------------------------------------------------ manual selection
def manual_keys(system_ids: List[str], user_id: Optional[str] = None) -> Set[Tuple[str, str]]:
    """(user_id, symbol) self-bucket keys whose applied fills are all manual (and at least one).
    One aggregation over fills; system accounts excluded (optionally restricted to one user)."""
    groups = _fills().aggregate([
        {"$match": {"status": "applied", "bucket": "self",
                    "user_id": _user_clause(list(system_ids), user_id)}},
        {"$group": {"_id": {"u": "$user_id", "s": "$symbol"},
                    "src": {"$addToSet": {"$ifNull": ["$source", ""]}}}},
    ])
    return {(g["_id"]["u"], g["_id"]["s"]) for g in groups if set(g["src"]) == {MANUAL}}


def manual_positions(base_query: Dict, keys: Set[Tuple[str, str]]) -> List[Dict]:
    """Self-bucket positions matching `base_query` whose (user, symbol) is a manual key."""
    q = {**base_query, "bucket": "self"}
    return [p for p in positions.col().find(q) if (p["user_id"], p["symbol"]) in keys]


def _pos_query(asset_class: Optional[str], system_ids: List[str], open_only: bool = False,
               symbol: Optional[str] = None) -> Dict:
    q: Dict[str, Any] = {"user_id": {"$nin": system_ids}}
    if open_only:
        q["open"] = True
    if asset_class:
        q["asset_class"] = asset_class
    if symbol:
        q["symbol"] = symbol
    return q


def fill_query(range_: str, asset_class: Optional[str] = None, side: str = "all", user_id: Optional[str] = None,
               symbol: Optional[str] = None, bucket: str = "all", system_ids: Iterable[str] = ()) -> Dict:
    """Applied MANUAL fills in range. System accounts are excluded unless user_id names one
    (then none). bucket copy/basket match nothing, because manual fills are bucket self."""
    q: Dict[str, Any] = {"status": "applied", "source": MANUAL,
                         "user_id": _user_clause(list(system_ids), user_id)}
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


# ------------------------------------------------------------------ valuation helpers
def _unrealized_of(rows: List[Dict]) -> Optional[Decimal]:
    """Sum of unrealised P&L over priced positions. None when positions exist but none is priced;
    zero when there are no open positions."""
    priced = [dec(r["unrealized_pnl"]) for r in rows if r.get("unrealized_pnl") is not None]
    if priced:
        return sum(priced, ZERO)
    return None if rows else ZERO


def _value_of(rows: List[Dict]) -> Decimal:
    """Unpriced positions count at cost basis (the convention used by portfolio.summary)."""
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


def trade_row(f: Dict, users: Dict[str, Dict]) -> Dict:
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
        "bucket": bucket, "bucket_label": portfolio.bucket_label(bucket),
        "kind": f.get("kind", "trade"), "source": f.get("source", MANUAL),
    }


def _rank_desc_nulls_last(items: List, key) -> List:
    """Stable descending sort; items whose key is None go last."""
    keyed = [(key(i), i) for i in items]
    present = sorted((kv for kv in keyed if kv[0] is not None), key=lambda kv: kv[0], reverse=True)
    return [i for _, i in present] + [i for k, i in keyed if k is None]


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
        keys = manual_keys(sys)
        fills = list(_fills().find(fill_query(range_, ac, system_ids=sys), _TALLY_FIELDS))
        open_pos = manual_positions(_pos_query(ac, sys, open_only=True), keys)
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
        return total, [trade_row(d, users) for d in docs]

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
        keys = manual_keys(sys)
        return manual_positions(_pos_query(ac, sys), keys)

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
        keys = manual_keys(sys)
        range_fills = list(_fills().find(fill_query(range_, symbol=sym, system_ids=sys), _TALLY_FIELDS))
        marker_docs = list(_fills().find(fill_query(range_, symbol=sym, system_ids=sys))
                           .sort([("ts", -1), ("_id", -1)]).limit(MARKER_CAP))
        pos_all = manual_positions(_pos_query(None, sys, symbol=sym), keys)
        users = _users({f["user_id"] for f in range_fills} | {p["user_id"] for p in pos_all})
        return range_fills, marker_docs, pos_all, users

    range_fills, marker_docs, pos_all, users = await asyncio.to_thread(load)
    open_pos = [p for p in pos_all if p.get("open")]
    day_start = portfolio.day_start_utc()
    holders, rows = [], []
    for p in open_pos:
        row = positions.serialize(p, quote, day_start)
        rows.append(row)
        holders.append({
            "user": _ref(p["user_id"], users), "bucket": row["bucket"],
            "bucket_label": portfolio.bucket_label(row["bucket"]), "qty": row["qty"],
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
        keys = manual_keys(sys)
        fills = list(_fills().find(fill_query(range_, ac, system_ids=sys), _TALLY_FIELDS))
        last = {r["_id"]: r["last"] for r in _fills().aggregate([
            {"$match": fill_query("ALL", ac, system_ids=sys)},
            {"$group": {"_id": "$user_id", "last": {"$max": "$ts"}}}])}
        all_pos = manual_positions(_pos_query(ac, sys), keys)
        open_uids = {p["user_id"] for p in all_pos if p.get("open")}
        candidates = {f["user_id"] for f in fills} | open_uids
        users = _users(candidates)
        # Accounts that cannot be identified (no users document) are left out.
        uids = {u for u in candidates if u in users}
        return {"fills": fills, "last": last, "all_pos": all_pos, "uids": uids, "users": users}

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
        pv = _value_of(rows)
        upnl = _unrealized_of(rows)
        t = _tally(fills_by.get(uid, []))
        last_at = d["last"].get(uid)
        item = {
            "user": _ref(uid, d["users"]), "open_positions": len(rows),
            "positions_value": money(pv), "unrealized_pnl": None if upnl is None else money(upnl),
            "realized_pnl": money(realized[uid]), "trades": t["count"], "volume": money(t["volume"]),
            "realized_pnl_range": money(t["realized_pnl"]), "last_trade_at": _iso(last_at),
        }
        raw = {"positions_value": pv, "unrealized_pnl": upnl, "realized_pnl": realized[uid],
               "trades": t["count"], "last_trade_at": last_at}
        entries.append((raw, item))
    field = TRADER_SORT_FIELD[sort]
    ranked = _rank_desc_nulls_last(entries, lambda e: e[0][field] if field != "trades" else D(e[0]["trades"]))
    page = [item for _, item in ranked][offset:offset + limit]
    return {"range": range_, "asset_class": ac or "all", "sort": sort, "as_of": _now_iso(),
            "total": len(ranked), "limit": limit, "offset": offset, "items": page}


# ------------------------------------------------------------------ 6) trader portfolio
def _user_or_404(user_id: str) -> Dict:
    if not ObjectId.is_valid(user_id):
        raise ActivityError(404, "not_found", "User not found")
    u = get_collection(USERS_COLLECTION).find_one(
        {"_id": ObjectId(user_id)}, {"email": 1, "full_name": 1, "is_system": 1})
    if not u or u.get("is_system"):
        raise ActivityError(404, "not_found", "User not found")
    return u


async def trader_portfolio(user_id: str, range: str = "1M") -> Dict:
    range_ = parse_range(range)
    uid = str(ObjectId(user_id)) if ObjectId.is_valid(user_id) else user_id
    user = await asyncio.to_thread(_user_or_404, uid)

    def load():
        sys = _system_ids()
        keys = manual_keys(sys)
        pos_all = manual_positions({"user_id": uid}, keys)
        range_fills = list(_fills().find(fill_query(range_, user_id=uid, system_ids=[]), _TALLY_FIELDS))
        recent = list(_fills().find(fill_query(range_, user_id=uid, system_ids=[]))
                      .sort([("ts", -1), ("_id", -1)]).limit(PORTFOLIO_TRADES))
        return pos_all, range_fills, recent

    pos_all, range_fills, recent = await asyncio.to_thread(load)
    open_pos = [p for p in pos_all if p.get("open")]
    quotes = await portfolio.quotes_for({p["symbol"] for p in open_pos})
    day_start = portfolio.day_start_utc()
    rows = []
    for p in open_pos:
        row = positions.serialize(p, quotes.get(p["symbol"]), day_start)
        row["name"] = _name(p["symbol"])
        row["bucket_label"] = portfolio.bucket_label(row["bucket"])
        row["change_percent"] = (quotes.get(p["symbol"]) or {}).get("change_percent")
        rows.append(row)
    total_pv = _value_of(rows)
    by_class: Dict[str, List[Dict]] = defaultdict(list)
    for r in rows:
        by_class[r["asset_class"]].append(r)
    allocation = []
    for ac in sorted(by_class):
        v = _value_of(by_class[ac])
        allocation.append({"asset_class": ac, "value": money(v),
                           "percent": f"{v / total_pv * 100:.2f}" if total_pv != 0 else None})
    t = _tally(range_fills)
    lifetime = sum((dec(p.get("realized_pnl")) for p in pos_all), ZERO)
    upnl = _unrealized_of(rows)
    users = {uid: user}
    history = await manual_history(uid, range_, {"positions_value": total_pv, "unrealized": upnl,
                                                  "realized": lifetime})
    return {
        "user": {"id": uid, "email": user.get("email"), "full_name": user.get("full_name"),
                 "is_system": bool(user.get("is_system"))},
        "as_of": _now_iso(),
        "summary": {
            "positions_value": money(total_pv),
            "unrealized_pnl": None if upnl is None else money(upnl),
            "realized_pnl_lifetime": money(lifetime), "realized_pnl_range": money(t["realized_pnl"]),
            "trades_range": t["count"], "volume_range": money(t["volume"]),
        },
        "allocation": allocation,
        "history": history,
        "positions": rows,
        "trades": [trade_row(f, users) for f in recent],
    }


# ------------------------------------------------------------------ manual snapshots
# A separate series (manual_snapshots) of the manual-only valuation, recorded going forward.
# Account-level snapshots cannot be split into manual and automated parts, so they are not used.
SNAPSHOT_RETENTION_DAYS = 30
SERIES_MAX_POINTS = 300  # including the live point
_manual_daily_done: Set[str] = set()


def manual_snaps():
    return get_collection(MANUAL_SNAPSHOTS_COLLECTION)


def ensure_indexes() -> None:
    """Called from the engine start-up, like portfolio.ensure_indexes (never at import time)."""
    c = manual_snaps()
    c.create_index([("user_id", ASCENDING), ("ts", ASCENDING)], name="user_time")
    # one daily snapshot per user and NY date (the upsert key); minute docs are not constrained
    c.create_index([("user_id", ASCENDING), ("kind", ASCENDING), ("date", ASCENDING)], unique=True,
                   partialFilterExpression={"kind": "daily"}, name="uniq_daily")
    try:
        c.create_index([("expire_at", ASCENDING)], expireAfterSeconds=0, name="ttl")
    except Exception:
        pass


def _cents(v: Decimal) -> int:
    return int((v * 100).quantize(D("1"), rounding=ROUND_HALF_UP))


def _values(rows: List[Dict], pos_all: List[Dict]) -> Dict[str, Any]:
    return {"positions_value": _value_of(rows),
            "cost_basis": sum((dec(r["cost_basis"]) for r in rows), ZERO),
            "unrealized": _unrealized_of(rows),          # None when open rows exist but none is priced
            "unpriced": sum(1 for r in rows if r["market_value"] is None),
            "realized": sum((dec(p.get("realized_pnl")) for p in pos_all), ZERO),
            "open": len(rows)}


async def manual_book(user_id: str, keys: Optional[Set[Tuple[str, str]]] = None) -> Dict:
    """Manual-only valuation of one account: its manual self positions, rows priced via one
    batch quote call, and the summary values (unpriced positions at cost basis)."""
    def load():
        k = keys if keys is not None else manual_keys(_system_ids(), user_id)
        return manual_positions({"user_id": user_id}, k)

    pos_all = await asyncio.to_thread(load)
    open_pos = [p for p in pos_all if p.get("open")]
    quotes = await portfolio.quotes_for({p["symbol"] for p in open_pos})
    day = portfolio.day_start_utc()
    rows = [positions.serialize(p, quotes.get(p["symbol"]), day) for p in open_pos]
    return {"pos_all": pos_all, "rows": rows, "quotes": quotes, "values": _values(rows, pos_all)}


def eligible_manual_users() -> Tuple[List[str], Set[Tuple[str, str]]]:
    """Non-system users with a manual fill or a manual open position, plus the manual key set."""
    sys = _system_ids()
    keys = manual_keys(sys)
    fill_users = _fills().distinct("user_id", {"status": "applied", "source": MANUAL,
                                               "user_id": {"$nin": sys}})
    return sorted(set(fill_users) | {u for u, _ in keys}), keys


async def build_manual_snapshot(user_id: str, kind: str = "minute", keys=None,
                                date_str: Optional[str] = None) -> Dict:
    """The snapshot document for one user, without writing it."""
    if kind not in ("minute", "daily"):
        raise ValueError("kind must be minute or daily")
    book = await manual_book(str(user_id), keys)
    v = book["values"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    doc = {"user_id": str(user_id), "ts": now, "kind": kind,
           "date": date_str or datetime.now(calendar.NY).date().isoformat(),
           "positions_value_cents": _cents(v["positions_value"]), "cost_basis_cents": _cents(v["cost_basis"]),
           "unrealized_cents": None if v["unrealized"] is None else _cents(v["unrealized"]),
           "unpriced_positions": v["unpriced"], "realized_cents": _cents(v["realized"]),
           "open_positions": v["open"]}
    if kind == "minute":
        doc["expire_at"] = now + timedelta(days=SNAPSHOT_RETENTION_DAYS)
    return doc


def store_snapshot(doc: Dict) -> None:
    if doc["kind"] == "minute":
        manual_snaps().insert_one(doc)
    else:  # idempotent: one daily document per user and date
        manual_snaps().update_one({"user_id": doc["user_id"], "kind": "daily", "date": doc["date"]},
                                  {"$set": doc}, upsert=True)


async def snapshot_manual_user(user_id: str, kind: str = "minute", keys=None,
                               date_str: Optional[str] = None) -> Dict:
    doc = await build_manual_snapshot(user_id, kind, keys, date_str)
    await asyncio.to_thread(store_snapshot, doc)
    return doc


async def snapshot_all_manual(kind: str = "minute") -> int:
    """Minute snapshots for every eligible user; after the close, the daily close (once per day).
    Per-user failures are logged and do not stop the others."""
    uids, keys = await asyncio.to_thread(eligible_manual_users)
    n = 0
    for uid in uids:
        try:
            await snapshot_manual_user(uid, kind, keys)
            n += 1
        except Exception as exc:
            print(f"manual snapshot error {uid}: {exc}")
    if kind == "minute":
        now = datetime.now(calendar.NY)
        if calendar.is_trading_day(now.date()) and \
                now >= calendar.session_times(now.date())["close"] + timedelta(minutes=5):
            await daily_manual_close(now.date().isoformat())
    return n


async def daily_manual_close(date_str: str) -> int:
    if date_str in _manual_daily_done:
        return 0
    uids, keys = await asyncio.to_thread(eligible_manual_users)
    n, failed = 0, 0
    for uid in uids:
        try:
            await snapshot_manual_user(uid, "daily", keys, date_str)
            n += 1
        except Exception as exc:
            failed += 1
            print(f"manual daily snapshot error {uid}: {exc}")
    if not failed:
        _manual_daily_done.add(date_str)  # a failed day is retried on the next sweep (upserts are idempotent)
    return n


async def safe_snapshot_all_manual(kind: str = "minute") -> int:
    """Hook for the engine sweep: never raises, so account snapshots are never affected."""
    try:
        return await snapshot_all_manual(kind)
    except Exception as exc:
        print(f"manual snapshot hook failed: {exc}")
        return -1


def _stored_points(uid: str, range_: str) -> List[Dict]:
    span = portfolio.RANGES[range_]
    q: Dict[str, Any] = {"user_id": uid}
    if span:
        q["ts"] = {"$gte": datetime.now(timezone.utc).replace(tzinfo=None) - span}
    rows = list(manual_snaps().find(q).sort("ts", ASCENDING))
    if range_ not in ("1D", "1W"):  # one point per day: the daily snapshot, else the day's last minute
        per_day: Dict[Any, Dict] = {}
        for r in rows:
            day = r["ts"].date()
            if r["kind"] == "daily" or day not in per_day or per_day[day]["kind"] != "daily":
                per_day[day] = r
        rows = [per_day[d] for d in sorted(per_day)]
    cap = SERIES_MAX_POINTS - 1
    if len(rows) > cap:
        step = len(rows) / cap
        rows = [rows[int(i * step)] for i in range(cap - 1)] + [rows[-1]]
    return rows


async def manual_history(user_id: str, range_: str, live: Dict[str, Any]) -> Dict:
    """Manual positions value over time. The series ends with a live point from the current
    valuation. change is only reported with at least two stored points (never fabricated)."""
    range_ = parse_range(range_)
    rows = await asyncio.to_thread(_stored_points, str(user_id), range_)
    points = [{"t": int(r["ts"].replace(tzinfo=timezone.utc).timestamp()),
               "value": money(D(r["positions_value_cents"]) / 100),
               "unrealized": None if r.get("unrealized_cents") is None else money(D(r["unrealized_cents"]) / 100),
               "realized": money(D(r.get("realized_cents") or 0) / 100), "live": False} for r in rows]
    value = live["positions_value"]
    u = live.get("unrealized")
    points.append({"t": int(datetime.now(timezone.utc).timestamp()), "value": money(value),
                   "unrealized": None if u is None else money(u), "realized": money(live["realized"]),
                   "live": True})
    change = change_pct = None
    if len(rows) >= 2:
        first = D(points[0]["value"])
        delta = value - first
        change = money(delta)
        change_pct = None if first == 0 else f"{delta / first * 100:.2f}"
    return {"range": range_, "series": "manual_positions_value", "points": points, "change": change,
            "change_percent": change_pct, "kinds": sorted({r["kind"] for r in rows}), "count": len(rows)}
