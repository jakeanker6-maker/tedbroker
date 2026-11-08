"""Record one MINUTE snapshot of the manual-activity series (collection manual_snapshots) for every
eligible user, so the admin trader history has a first point now.

    python scripts/snapshot_manual_now.py            # dry run (default): values only, no writes
    python scripts/snapshot_manual_now.py --apply    # ensure indexes, then write one snapshot per user

Eligible = non-system users with a manual fill or a manual open position. Valuation is the same
as the admin trader portfolio (manual positions only, unpriced positions at cost basis). Quotes
are read from the market-data service; nothing else is written. Re-running --apply adds another
minute point, so run it once.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from bson import ObjectId  # noqa: E402

from app.database import USERS_COLLECTION, get_collection  # noqa: E402
from app.trading import admin_activity as aa  # noqa: E402


def _money(cents):
    return None if cents is None else f"{cents / 100:.2f}"


async def run(apply: bool) -> dict:
    uids, keys = await asyncio.to_thread(aa.eligible_manual_users)
    report = {"mode": "apply" if apply else "dry-run", "eligible_users": len(uids), "users": []}
    if apply:
        await asyncio.to_thread(aa.ensure_indexes)
    totals = {"positions_value_cents": 0, "realized_cents": 0, "open_positions": 0}
    for uid in uids:
        doc = await aa.build_manual_snapshot(uid, "minute", keys)
        if apply:
            await asyncio.to_thread(aa.store_snapshot, doc)
        user = get_collection(USERS_COLLECTION).find_one({"_id": ObjectId(uid)}, {"email": 1}) or {}
        for k in totals:
            totals[k] += doc[k]
        report["users"].append({
            "user_id": uid, "email": user.get("email"), "open_positions": doc["open_positions"],
            "positions_value": _money(doc["positions_value_cents"]), "cost_basis": _money(doc["cost_basis_cents"]),
            "unrealized": _money(doc["unrealized_cents"]), "unpriced_positions": doc["unpriced_positions"],
            "realized": _money(doc["realized_cents"]), "written": apply,
        })
    report["totals"] = {"positions_value": _money(totals["positions_value_cents"]),
                        "realized": _money(totals["realized_cents"]),
                        "open_positions": totals["open_positions"]}
    report["snapshots_written"] = len(uids) if apply else 0
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write the snapshots (default: dry run)")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args.apply)), indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
