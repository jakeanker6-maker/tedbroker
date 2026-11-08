"""Admin override of live traders' performance figures (stats_override layer).

Admin edits of ytd_return, win_rate, copiers, assets_under_management and max_drawdown on a
live (bot-run) trader are stored in stats_override and shown on both the admin and user
dashboards, unlabelled. The computed top-level values stay stored. Non-live traders are unchanged.
"""
from datetime import datetime

from bson import ObjectId

from app.database import TRADERS_COLLECTION, USERS_COLLECTION, get_collection
from app.trading import bots
from app.trading.trader_stats import effective_stats


def _cleanup(ids):
    get_collection(TRADERS_COLLECTION).delete_many({"_id": {"$in": list(ids)}})
    get_collection("copy_links").delete_many({"trader_id": {"$in": [str(i) for i in ids]}})


def _trader_doc(name, live=True, **extra):
    doc = {"_id": ObjectId(), "full_name": name, "profile_photo": "https://example.com/p.jpg",
           "description": "Override test", "specialization": "stocks", "minimum_copy_amount": 100.0,
           "trades": [], "recent_trades": []}
    if live:
        doc.update({"stats_live": True, "stats_since": datetime(2026, 1, 2), "ytd_return": 7.0,
                    "win_rate": 60.0, "max_drawdown": 3.0, "assets_under_management": 1000.0, "copiers": 0})
    doc.update(extra)
    get_collection(TRADERS_COLLECTION).insert_one(doc)
    return doc["_id"]


def _payload(**overrides):
    body = {"full_name": "Override Trader", "profile_photo": "https://example.com/p.jpg",
            "description": "Override test", "specialization": "stocks", "ytd_return": 99.0,
            "win_rate": 55.0, "copiers": 5, "minimum_copy_amount": 100.0,
            "assets_under_management": 5000.0, "max_drawdown": 1.5, "risk_score": 4}
    body.update(overrides)
    return body


def _admin(token):
    return {"Authorization": f"Bearer {token}"}


def _user(token):
    return {"Authorization": f"Bearer {token}"}


def _directory_entry(client, user_token, oid):
    rows = client.get("/api/traders/", headers=_user(user_token))
    assert rows.status_code == 200, rows.text
    return next(t for t in rows.json() if t["id"] == str(oid))


# ------------------------------------------------------------------ pure helper
def test_effective_stats_rules():
    live = {"stats_live": True, "ytd_return": 7.0, "win_rate": 60.0, "max_drawdown": 3.0,
            "assets_under_management": 1000.0, "copiers": 1}
    assert effective_stats(live, computed_copiers=4) == {
        "ytd_return": 7.0, "win_rate": 60.0, "copiers": 4, "assets_under_management": 1000.0, "max_drawdown": 3.0}
    partial = {**live, "stats_override": {"ytd_return": 50.0, "set_by": "a"}}
    eff = effective_stats(partial, computed_copiers=4)
    assert eff["ytd_return"] == 50.0 and eff["win_rate"] == 60.0 and eff["copiers"] == 4
    nulled = {**live, "stats_override": {"win_rate": None, "ytd_return": 1.0}}
    assert effective_stats(nulled)["win_rate"] is None          # a null override is a real value
    assert effective_stats({**live, "stats_override": {"copiers": 9}}, computed_copiers=4)["copiers"] == 9
    non_live = {"ytd_return": 12.0, "copiers": 3, "stats_admin": True}
    assert effective_stats(non_live, computed_copiers=1)["copiers"] == 3     # max(real, stored)
    assert effective_stats({"ytd_return": 12.0}, computed_copiers=0)["copiers"] == 0
    assert effective_stats({"ytd_return": 12.0, "copiers": 3}, computed_copiers=1)["copiers"] == 1


# ------------------------------------------------------------------ live trader
def test_override_shows_on_admin_and_user_and_computed_stays(client, admin_token, user_token):
    oid = _trader_doc("Override Live A")
    try:
        r = client.put(f"/api/admin/traders/{oid}", json=_payload(win_rate=None), headers=_admin(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ytd_return"] == 99.0 and body["win_rate"] is None and body["copiers"] == 5
        assert body["assets_under_management"] == 5000.0 and body["max_drawdown"] == 1.5
        assert body["stats_override"]["set_by"] and body["stats_override"]["set_at"]

        stored = get_collection(TRADERS_COLLECTION).find_one({"_id": oid})
        assert stored["ytd_return"] == 7.0 and stored["win_rate"] == 60.0       # computed kept
        assert stored["stats_live"] is True and "stats_admin" not in stored

        admin_view = client.get(f"/api/admin/traders/{oid}", headers=_admin(admin_token)).json()
        assert admin_view["ytd_return"] == 99.0 and admin_view["win_rate"] is None
        admin_list = {t["id"]: t for t in client.get("/api/admin/traders", headers=_admin(admin_token)).json()}
        assert admin_list[str(oid)]["ytd_return"] == 99.0

        entry = _directory_entry(client, user_token, oid)
        assert entry["stats_source"] == "live" and entry["stats_live"] is True   # unlabelled
        assert entry["ytd_return"] == 99.0 and entry["win_rate"] is None and entry["copiers"] == 5
        assert entry["assets_under_management"] == 5000.0
        assert "stats_override" not in entry and "admin" not in str(entry["stats_source"])

        detail = client.get(f"/api/traders/{oid}", headers=_user(user_token)).json()
        assert detail["ytd_return"] == 99.0
    finally:
        _cleanup([oid])


def test_clear_override_restores_computed_figures(client, admin_token, user_token):
    oid = _trader_doc("Override Live B")
    try:
        client.put(f"/api/admin/traders/{oid}", json=_payload(), headers=_admin(admin_token))
        r = client.delete(f"/api/admin/traders/{oid}/stats-override", headers=_admin(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ytd_return"] == 7.0 and body["win_rate"] == 60.0 and body["copiers"] == 0
        assert body["assets_under_management"] == 1000.0 and body["max_drawdown"] == 3.0
        assert body["stats_override"] is None
        assert "stats_override" not in get_collection(TRADERS_COLLECTION).find_one({"_id": oid})
        entry = _directory_entry(client, user_token, oid)
        assert entry["ytd_return"] == 7.0 and entry["stats_source"] == "live"
        # clearing again is a no-op
        assert client.delete(f"/api/admin/traders/{oid}/stats-override",
                             headers=_admin(admin_token)).json()["ytd_return"] == 7.0
    finally:
        _cleanup([oid])


def test_copiers_are_the_real_link_count_unless_overridden(client, admin_token, user_token):
    oid = _trader_doc("Override Live C")
    links = get_collection("copy_links")
    links.insert_many([
        {"trader_id": str(oid), "user_id": "u1", "status": "active"},
        {"trader_id": str(oid), "user_id": "u2", "status": "paused"},
        {"trader_id": str(oid), "user_id": "u3", "status": "stopped"},
    ])
    try:
        assert _directory_entry(client, user_token, oid)["copiers"] == 2
        r = client.put(f"/api/admin/traders/{oid}", json=_payload(copiers=9), headers=_admin(admin_token))
        assert r.json()["copiers"] == 9
        assert _directory_entry(client, user_token, oid)["copiers"] == 9
        client.delete(f"/api/admin/traders/{oid}/stats-override", headers=_admin(admin_token))
        assert _directory_entry(client, user_token, oid)["copiers"] == 2
    finally:
        _cleanup([oid])


def test_update_all_stats_keeps_the_override(client, admin_token):
    uid = ObjectId()
    get_collection(USERS_COLLECTION).insert_one({
        "_id": uid, "email": f"bot-{uid}@bots.test", "is_system": True, "cash_cents": 10_000_000,
        "reserved_cents": 0, "available_cents": 10_000_000, "wallet_balance": 100000.0, "account_type": "cash"})
    oid = _trader_doc("Override Bot", system_user_id=str(uid), starting_equity="100000",
                      stats_override={"ytd_return": 42.0, "win_rate": None, "copiers": 3,
                                      "assets_under_management": 9000.0, "max_drawdown": 2.0,
                                      "set_at": datetime(2026, 2, 1), "set_by": "admin-1"})
    try:
        assert bots.update_all_stats() >= 1
        stored = get_collection(TRADERS_COLLECTION).find_one({"_id": oid})
        assert stored["stats_override"]["ytd_return"] == 42.0 and stored["stats_override"]["win_rate"] is None
        assert stored["stats_updated_at"] is not None          # computed keys were refreshed
        assert "ytd_return" in stored
    finally:
        _cleanup([oid])
        get_collection(USERS_COLLECTION).delete_many({"_id": uid})


# ------------------------------------------------------------------ non-live trader
def test_non_live_trader_behaviour_is_unchanged(client, admin_token, user_token):
    oid = _trader_doc("Override Seed D", live=False)
    try:
        r = client.put(f"/api/admin/traders/{oid}", json=_payload(ytd_return=12.0, copiers=3),
                       headers=_admin(admin_token))
        assert r.status_code == 200, r.text
        stored = get_collection(TRADERS_COLLECTION).find_one({"_id": oid})
        assert stored["ytd_return"] == 12.0 and stored["copiers"] == 3 and stored["stats_admin"] is True
        assert "stats_override" not in stored
        entry = _directory_entry(client, user_token, oid)
        assert entry["stats_source"] == "admin" and entry["ytd_return"] == 12.0 and entry["copiers"] == 3
        assert client.delete(f"/api/admin/traders/{oid}/stats-override",
                             headers=_admin(admin_token)).json()["ytd_return"] == 12.0
    finally:
        _cleanup([oid])


# ------------------------------------------------------------------ validation & auth
def test_validation_ranges_are_rejected(client, admin_token):
    oid = _trader_doc("Override Validation")
    try:
        bad = [{"ytd_return": 1001}, {"ytd_return": -1001}, {"win_rate": 101}, {"win_rate": -1},
               {"copiers": -1}, {"assets_under_management": -5}, {"max_drawdown": 150},
               {"max_drawdown": -1}]
        for change in bad:
            r = client.put(f"/api/admin/traders/{oid}", json=_payload(**change), headers=_admin(admin_token))
            assert r.status_code == 422, (change, r.text)
        assert client.put(f"/api/admin/traders/{oid}", json=_payload(win_rate=None),
                          headers=_admin(admin_token)).status_code == 200
    finally:
        _cleanup([oid])


def test_clear_override_errors_and_auth(client, admin_token, user_token):
    oid = _trader_doc("Override Auth")
    try:
        assert client.delete(f"/api/admin/traders/{ObjectId()}/stats-override",
                             headers=_admin(admin_token)).status_code == 404
        assert client.delete("/api/admin/traders/not-an-id/stats-override",
                             headers=_admin(admin_token)).status_code == 400
        assert client.delete(f"/api/admin/traders/{oid}/stats-override",
                             headers=_user(user_token)).status_code == 403
        assert client.put(f"/api/admin/traders/{oid}", json=_payload(),
                          headers=_user(user_token)).status_code == 403
    finally:
        _cleanup([oid])
