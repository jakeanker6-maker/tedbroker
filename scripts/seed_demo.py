"""Demo account for presenting the school project: a coordinator with $100,000 of
simulated funds, a few positions bought at real market prices, and two active copies.

    venv/bin/python scripts/seed_demo.py                        # dry run: show what would happen
    venv/bin/python scripts/seed_demo.py --apply --password '...'   # create/top up in MONGODB_URL
    venv/bin/python scripts/seed_demo.py --memory               # rehearse against an in-memory DB

Safe to re-run: funding is a one-off top-up to $100,000 of net funding, orders use fixed
client order ids, and traders already copied are skipped. Stock/ETF market orders placed
while the US market is closed wait (GTC) and fill at the next open once the server runs;
crypto normally fills immediately. Funds are simulated: the top-up is an `adjustment` ledger entry,
not a deposit, and no payment is involved.
"""
import argparse
import asyncio
import sys
from datetime import datetime
from decimal import Decimal as D
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEMO_EMAIL = "coordinator@tedbrokers-school.com"
TARGET_FUNDING_CENTS = 100_000_00
POSITIONS = [("BTC-USD", "0.25"), ("ETH-USD", "3"), ("AAPL", "20"), ("MSFT", "10"), ("SPY", "15"), ("QQQ", "8")]
COPY_AMOUNT = D("10000")
COPIES = 2


def parse() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write to the database in MONGODB_URL")
    ap.add_argument("--memory", action="store_true", help="use an in-memory database (seeds traders too)")
    ap.add_argument("--email", default=DEMO_EMAIL)
    ap.add_argument("--password", help="password for the demo user if it has to be created")
    return ap.parse_args()


async def main(args) -> int:
    if args.memory:
        import mongomock
        import app.database as database
        database.client = mongomock.MongoClient()
        database.db = database.client["demo_rehearsal"]
    from bson import ObjectId

    from app.auth import get_password_hash
    from app.database import TRADERS_COLLECTION, USERS_COLLECTION, get_collection
    from app.market_data import service
    from app.trading import bots, copy_engine, integrity, ledger, orders, reset
    from app.trading.models import OrderRequest

    write = args.apply or args.memory
    users, traders = get_collection(USERS_COLLECTION), get_collection(TRADERS_COLLECTION)
    if args.memory and not traders.count_documents({}):
        import copy
        from seed_traders import EXPERT_TRADERS_DATA
        traders.insert_many([copy.deepcopy(t) for t in EXPERT_TRADERS_DATA])
    print(f"Mode: {'in-memory rehearsal' if args.memory else 'APPLY to MONGODB_URL' if args.apply else 'dry run (no writes)'}")

    # 1. user
    user = users.find_one({"email": args.email.lower()})
    if not user:
        if not write:
            print(f"- would create {args.email} (needs --password)")
        else:
            if not args.password and not args.memory:
                print("The demo user does not exist; pass --password to create it.")
                return 2
            now = datetime.utcnow()
            uid = ObjectId()
            users.insert_one({
                "_id": uid, "username": args.email.split("@")[0], "email": args.email.lower(),
                "full_name": "Project Coordinator", "hashed_password": get_password_hash(args.password or "demo-password-1"),
                "wallet_balance": 0.0, "is_active": True, "is_verified": True, "access_granted": True,
                "two_fa_enabled": False, "auth_provider": "local", "selected_traders": [],
                "onboarding": {"personal_info_completed": True, "address_completed": True, "kyc_completed": True,
                               "kyc_status": "approved"},
                "created_at": now, "updated_at": now})
            user = users.find_one({"_id": uid})
            print(f"- created {args.email}")
    else:
        print(f"- found {args.email}")
    if not user:
        print("- (dry run) stopping before funding; nothing else to show without the user")
        return 0
    uid = str(user["_id"])

    # 2. funding top-up to $100,000 of net funding
    if write:   # a dry run must not write anything, indexes included
        ledger.ensure_indexes()
        orders.ensure_indexes()
        copy_engine.ensure_indexes()
        ledger.ensure_account(uid)
    gap = TARGET_FUNDING_CENTS - (reset.net_funding_cents(uid) if write or user.get("cash_cents") is not None else 0)
    if gap > 0:
        print(f"- top up simulated funds by ${gap / 100:,.2f}")
        if write:
            ledger.post(uid, type="adjustment", idempotency_key=f"demo-funding:{uid}:{TARGET_FUNDING_CENTS}",
                        cash_delta_cents=gap, ref_type="admin", ref_id="seed_demo",
                        description="Demo funding (simulated school-project funds)")
    else:
        print("- funding already at or above $100,000")

    # 3. positions at real prices
    for sym, qty in POSITIONS:
        cid = f"demo-seed-{sym}"
        existing = orders.orders_col().find_one({"user_id": uid, "client_order_id": cid})
        if existing:
            print(f"- {sym}: already ordered ({existing['status']})")
            continue
        try:
            quote = await service.get_quote(sym)
        except Exception as exc:
            print(f"- {sym}: skipped, no quote ({exc})")
            continue
        print(f"- {sym}: buy {qty} @ market (last ${quote.get('last')}, {quote.get('source')})")
        if write:
            try:
                tif = "gtc" if sym.endswith("-USD") else "day"   # stock/ETF market orders are DAY orders
                o = orders.place(uid, OrderRequest(client_order_id=cid, symbol=sym, side="buy", qty=D(qty),
                                                   type="market", tif=tif), quote)
                why = (o.get("status_history") or [{}])[-1].get("reason") or ", ".join(o.get("warnings") or [])
                print(f"    -> {o['status']}" + (f" at ${o.get('avg_fill_price')}" if o.get("avg_fill_price") else
                                                  f" (waiting: {why or 'fills on the next live quote / at the open'})"))
            except orders.OrderError as exc:
                print(f"    -> rejected: {exc}")

    # 4. two copies of live traders
    if write:
        bots.ensure_bots()
    copying = {l["trader_id"] for l in copy_engine.links().find({"user_id": uid, "status": {"$in": ["active", "paused"]}})}
    candidates = [t for t in traders.find({"system_user_id": {"$ne": None}}).sort("ytd_return", -1)
                  if str(t["_id"]) not in copying]
    need = max(0, COPIES - len(copying))
    if not candidates and need:
        print("- no trader bots found: run seed_traders.py, then start the server once (it creates the bots)")
    for t in candidates[:need]:
        print(f"- copy {t['full_name']} with ${COPY_AMOUNT:,.2f}")
        if write:
            try:
                copy_engine.create_link(uid, str(t["_id"]), COPY_AMOUNT, D("20"))
            except copy_engine.CopyError as exc:
                print(f"    -> not started: {exc}")
    if write:
        report = integrity.check_user(uid)
        bal = ledger.get_balances(uid)
        print(f"Cash ${bal['cash_cents'] / 100:,.2f} · held ${bal['reserved_cents'] / 100:,.2f} · "
              f"integrity {'ok' if report['ok'] else 'PROBLEM: ' + str(report)}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(parse())))
