"""Effective performance figures for expert traders. Every reader goes through `effective_stats`.

Two layers, one rule each:

- Computed (live traders, stats_live): top-level ytd_return, win_rate, max_drawdown,
  assets_under_management, copiers, written by bots.compute_stats / copy_engine. Never destroyed
  by an admin edit, so they stay stored behind any override.
- Admin override (live traders): the sub-document `stats_override`, written by the admin update
  route and removable by the clear-override route. When a field is present in it, that value is
  the effective figure on both the admin and the user dashboards. It is shown unlabelled
  (stats_source stays "live"), by decision.

Non-live traders keep their existing top-level values (stats_admin marks admin-entered ones).
"""
from datetime import datetime
from typing import Any, Dict, Mapping, Optional

from app.database import get_collection

FIELDS = ("ytd_return", "win_rate", "copiers", "assets_under_management", "max_drawdown")


def is_live(trader: Mapping) -> bool:
    return bool(trader.get("stats_live"))


def active_copiers(trader_id) -> int:
    """Real copy links on this trader (active or paused), the same count bots.compute_stats stores."""
    return get_collection("copy_links").count_documents(
        {"trader_id": str(trader_id), "status": {"$in": ["active", "paused"]}})


def effective_stats(trader: Mapping, computed_copiers: Optional[int] = None) -> Dict[str, Any]:
    """The five performance fields as users and admins see them.

    Live trader: override field if present (a null win_rate override is a real value), else the
    computed top-level field; copiers = override, else the real copy-link count passed in (else the
    stored copiers). Non-live trader: stored top-level values; copiers = real count, and for
    admin-entered traders the larger of real count and stored value (the earlier rule, unchanged).
    """
    override = trader.get("stats_override") or {}
    out: Dict[str, Any] = {f: (override[f] if f in override else trader.get(f)) for f in FIELDS}
    if is_live(trader):
        if "copiers" not in override:
            out["copiers"] = computed_copiers if computed_copiers is not None else int(trader.get("copiers") or 0)
    elif computed_copiers is not None:
        stored = int(trader.get("copiers") or 0)
        out["copiers"] = max(computed_copiers, stored) if trader.get("stats_admin") else computed_copiers
    return out


def override_document(values: Mapping[str, Any], set_by: str, set_at: Optional[datetime] = None) -> Dict[str, Any]:
    """The stats_override sub-document for the five fields plus audit fields."""
    doc: Dict[str, Any] = {f: values.get(f) for f in FIELDS}
    doc["set_at"] = set_at or datetime.utcnow()
    doc["set_by"] = str(set_by)
    return doc


def override_view(trader: Mapping) -> Optional[Dict[str, Any]]:
    """Admin-facing copy of the override (never sent to users)."""
    o = trader.get("stats_override")
    if not o:
        return None
    return {**{f: o.get(f) for f in FIELDS if f in o},
            "set_at": o["set_at"].isoformat() + "Z" if o.get("set_at") else None,
            "set_by": o.get("set_by")}
