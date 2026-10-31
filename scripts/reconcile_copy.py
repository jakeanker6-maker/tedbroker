"""Report (and optionally fix) copy-trading accounts whose reserved cash does not match
the cash held in their copy links.

    python scripts/reconcile_copy.py            # report only (default)
    python scripts/reconcile_copy.py --apply    # back up each account, then post a
                                                # copy_allocate reserve for the gap

A positive gap means copy links hold more cash than the ledger reserves; the fix reserves
the difference so free cash is no longer overstated. Negative gaps are only reported.
Each fix is idempotent (keyed on user and gap), so re-running is safe.
"""
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from bson import ObjectId, json_util  # noqa: E402
from pymongo import MongoClient  # noqa: E402

from app.trading import copy_engine, ledger  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="post the reserve entries (default: report only)")
    parser.add_argument("--backup-dir", default="/tmp/copy_reconcile", help="where account backups are written")
    args = parser.parse_args()

    db = MongoClient(os.environ["MONGODB_URL"])[os.environ.get("MONGODB_DB", "tedbroker")]
    rows = copy_engine.copy_imbalances()
    print(f"accounts with copy links: {len(db.copy_links.distinct('user_id'))}")
    print(f"out of balance: {len(rows)}")
    for r in rows:
        print(f"  {r['user_id']}  reserved {r['reserved_cents']}  link cash {r['link_cash_cents']}  gap {r['gap_cents']}")

    if not args.apply:
        print("report only; re-run with --apply to fix positive gaps")
        return 0

    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S")
    Path(args.backup_dir).mkdir(parents=True, exist_ok=True)
    for r in rows:
        if r["gap_cents"] <= 0:
            print(f"  skip {r['user_id']}: negative gap needs manual review")
            continue
        uid = r["user_id"]
        backup = {"user": db.users.find_one({"_id": ObjectId(uid)}),
                  "links": list(db.copy_links.find({"user_id": uid}))}
        path = Path(args.backup_dir) / f"{uid}-{stamp}.json"
        path.write_text(json_util.dumps(backup, indent=2))
        ledger.reserve(uid, r["gap_cents"], type="copy_allocate",
                       idempotency_key=f"copy-reconcile:{uid}:{r['gap_cents']}",
                       ref_type="copy_link", ref_id="reconcile",
                       description="Reserve copy allocation cash (reconciliation)")
        print(f"  fixed {uid}: reserved +{r['gap_cents']} (backup {path})")

    left = copy_engine.copy_imbalances()
    print(f"out of balance after fix: {len(left)}")
    return 0 if not left else 1


if __name__ == "__main__":
    raise SystemExit(main())
