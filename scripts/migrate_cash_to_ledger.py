"""Move every user's cash onto the unified ledger.

    venv/bin/python scripts/migrate_cash_to_ledger.py            # dry run (no writes)
    venv/bin/python scripts/migrate_cash_to_ledger.py --apply    # perform migration

For each user without ledger fields it records an `opening_balance` entry equal to
the current wallet_balance and sets cash_cents / reserved_cents / available_cents.
It then places holds for withdrawal requests that are still pending (created before
the ledger existed), so that money cannot be traded away while the admin reviews it.
Safe to run repeatedly: every write is keyed by an idempotency key.

Note: the app also migrates users lazily on first use, so running this is optional;
it just makes the switch-over explicit and reports any problems.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import (USERS_COLLECTION, WITHDRAWAL_REQUESTS_COLLECTION,  # noqa: E402
                          get_collection)
from app.trading import funding, ledger  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = parser.parse_args()

    users = get_collection(USERS_COLLECTION)
    wrs = get_collection(WITHDRAWAL_REQUESTS_COLLECTION)

    todo = list(users.find({"cash_cents": {"$exists": False}}, {"wallet_balance": 1, "email": 1}))
    total = sum(ledger.to_cents(u.get("wallet_balance") or 0) for u in todo)
    print(f"Users to migrate: {len(todo)} (total cash ${total / 100:,.2f})")

    pending = [r for r in wrs.find({"status": {"$in": ["pending", "pending_verification"]}})
               if not ledger.find_posted(f"wd-hold:{r['_id']}")]
    print(f"Pending withdrawal requests without a hold: {len(pending)}")

    if not args.apply:
        print("Dry run only. Re-run with --apply to migrate.")
        return 0

    ledger.ensure_indexes()
    for u in todo:
        ledger.ensure_account(u["_id"])

    unheld = []
    for r in pending:
        try:
            funding.hold_withdrawal(str(r["_id"]), r["user_id"], r["amount"], r.get("withdrawal_method", ""))
        except ledger.LedgerError as exc:
            unheld.append((str(r["_id"]), r["user_id"], r["amount"], str(exc)))

    bad = []
    for u in users.find({}, {"_id": 1}):
        result = ledger.reconcile(u["_id"])
        if not result["ok"]:
            bad.append((str(u["_id"]), result))

    print(f"Migrated {len(todo)} users. Holds placed: {len(pending) - len(unheld)}.")
    for rid, uid, amount, why in unheld:
        print(f"  could not hold withdrawal {rid} (user {uid}, ${amount}): {why}")
    if bad:
        print(f"Reconciliation FAILED for {len(bad)} users:")
        for uid, r in bad:
            print(f"  {uid}: {r}")
        return 1
    print("Reconciliation OK for all users.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
