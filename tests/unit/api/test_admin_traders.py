"""Admin trader create/update must reach the user-facing directory (/api/traders/)."""
from bson import ObjectId

from app.database import get_collection, TRADERS_COLLECTION


def _payload(**overrides):
    body = {
        "full_name": "Test Trader Alpha",
        "profile_photo": "https://example.com/alpha.jpg",
        "description": "Swing trades on large caps.",
        "specialization": "stocks",
        "ytd_return": 12.5,
        "win_rate": 58.0,
        "copiers": 3,
        "minimum_copy_amount": 250.0,
        "assets_under_management": 500000.0,
        "max_drawdown": 9.5,
        "risk_score": 4,
    }
    body.update(overrides)
    return body


def _cleanup(names):
    get_collection(TRADERS_COLLECTION).delete_many({"full_name": {"$in": list(names)}})


def _directory(client, user_token):
    r = client.get("/api/traders/", headers={"Authorization": f"Bearer {user_token}"})
    assert r.status_code == 200, r.text
    return {t["full_name"]: t for t in r.json()}


def test_admin_created_trader_appears_in_user_directory(client, admin_token, user_token):
    _cleanup(["Test Trader Alpha"])
    r = client.post("/api/admin/traders", json=_payload(),
                    headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text

    t = _directory(client, user_token)["Test Trader Alpha"]
    assert t["description"] == "Swing trades on large caps."
    assert t["specialization"] == "stocks"
    assert t["minimum_copy_amount"] == 250.0
    assert t["stats_source"] == "admin"
    assert t["ytd_return"] == 12.5
    assert t["win_rate"] == 58.0
    assert t["max_drawdown"] == 9.5
    assert t["assets_under_management"] == 500000.0
    assert t["copiers"] == 3
    _cleanup(["Test Trader Alpha"])


def test_admin_update_is_reflected_in_user_directory(client, admin_token, user_token):
    _cleanup(["Test Trader Alpha", "Test Trader Beta"])
    created = client.post("/api/admin/traders", json=_payload(),
                          headers={"Authorization": f"Bearer {admin_token}"}).json()
    trader_id = created["id"]

    r = client.put(f"/api/admin/traders/{trader_id}",
                   json=_payload(full_name="Test Trader Beta", ytd_return=-4.2,
                                 minimum_copy_amount=75.0, risk_score=8),
                   headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == "Test Trader Beta"

    directory = _directory(client, user_token)
    assert "Test Trader Alpha" not in directory
    t = directory["Test Trader Beta"]
    assert t["ytd_return"] == -4.2
    assert t["minimum_copy_amount"] == 75.0
    assert t["risk_score"] == 8
    _cleanup(["Test Trader Beta"])


def test_admin_list_survives_legacy_trader_document(client, admin_token):
    legacy_name = "Test Trader Legacy"
    _cleanup([legacy_name])
    get_collection(TRADERS_COLLECTION).insert_one({
        "_id": ObjectId(), "full_name": legacy_name, "description": "old seed",
    })
    r = client.get("/api/admin/traders", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text
    assert any(t["full_name"] == legacy_name for t in r.json())
    _cleanup([legacy_name])


def test_admin_edit_is_an_override_and_keeps_computed_stats(client, admin_token, user_token):
    name = "Test Trader Bot"
    _cleanup([name])
    oid = ObjectId()
    get_collection(TRADERS_COLLECTION).insert_one({
        "_id": oid, "full_name": name, "profile_photo": "https://example.com/b.jpg",
        "description": "Bot", "specialization": "stocks", "minimum_copy_amount": 100.0,
        "stats_live": True, "stats_since": None, "ytd_return": 7.0, "win_rate": 60.0,
        "max_drawdown": 3.0, "assets_under_management": 1000.0, "copiers": 0,
        "trades": [], "recent_trades": [],
    })
    r = client.put(f"/api/admin/traders/{oid}", json=_payload(full_name=name, ytd_return=99.0),
                   headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text

    # Admin figures are shown (override layer, unlabelled); the computed top-level value stays stored.
    t = _directory(client, user_token)[name]
    assert t["stats_source"] == "live"
    assert t["ytd_return"] == 99.0
    assert get_collection(TRADERS_COLLECTION).find_one({"_id": oid})["ytd_return"] == 7.0
    _cleanup([name])
