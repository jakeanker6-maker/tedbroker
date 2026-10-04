import pytest
from fastapi.testclient import TestClient
from bson import ObjectId


def test_get_plans_includes_tags(client, user_token):
    """Test that GET /api/plans returns tags field"""
    response = client.get("/api/plans", headers={"Authorization": f"Bearer {user_token}"})
    assert response.status_code == 200
    plans = response.json()
    # Check that each plan has tags field
    for plan in plans:
        assert "tags" in plan
        assert isinstance(plan["tags"], list)


def test_get_plan_by_id_includes_tags(client, user_token):
    """Test that GET /api/plans/{plan_id} returns tags field"""
    # First get all plans to find one with tags
    response = client.get("/api/plans", headers={"Authorization": f"Bearer {user_token}"})
    plans = response.json()
    if plans:
        plan_id = plans[0]["id"]
        response = client.get(f"/api/plans/{plan_id}", headers={"Authorization": f"Bearer {user_token}"})
        assert response.status_code == 200
        assert "tags" in response.json()
        assert isinstance(response.json()["tags"], list)


# ETF Plans tests
def test_get_etf_plans_includes_tags(client, user_token):
    """Test that GET /api/etf-plans returns tags field"""
    response = client.get("/api/etf-plans", headers={"Authorization": f"Bearer {user_token}"})
    assert response.status_code == 200
    plans = response.json()
    for plan in plans:
        assert "tags" in plan
        assert isinstance(plan["tags"], list)


def test_get_etf_plan_by_id_includes_tags(client, user_token):
    response = client.get("/api/etf-plans", headers={"Authorization": f"Bearer {user_token}"})
    plans = response.json()
    if plans:
        plan_id = plans[0]["id"]
        response = client.get(f"/api/etf-plans/{plan_id}", headers={"Authorization": f"Bearer {user_token}"})
        assert response.status_code == 200
        assert "tags" in response.json()
        assert isinstance(response.json()["tags"], list)


# DeFi Plans tests
def test_get_defi_plans_includes_tags(client, user_token):
    response = client.get("/api/defi-plans", headers={"Authorization": f"Bearer {user_token}"})
    assert response.status_code == 200
    plans = response.json()
    for plan in plans:
        assert "tags" in plan
        assert isinstance(plan["tags"], list)


def test_get_defi_plan_by_id_includes_tags(client, user_token):
    response = client.get("/api/defi-plans", headers={"Authorization": f"Bearer {user_token}"})
    plans = response.json()
    if plans:
        plan_id = plans[0]["id"]
        response = client.get(f"/api/defi-plans/{plan_id}", headers={"Authorization": f"Bearer {user_token}"})
        assert response.status_code == 200
        assert "tags" in response.json()
        assert isinstance(response.json()["tags"], list)


# Options Plans tests
def test_get_options_plans_includes_tags(client, user_token):
    response = client.get("/api/options-plans", headers={"Authorization": f"Bearer {user_token}"})
    assert response.status_code == 200
    plans = response.json()
    for plan in plans:
        assert "tags" in plan
        assert isinstance(plan["tags"], list)


def test_get_options_plan_by_id_includes_tags(client, user_token):
    response = client.get("/api/options-plans", headers={"Authorization": f"Bearer {user_token}"})
    plans = response.json()
    if plans:
        plan_id = plans[0]["id"]
        response = client.get(f"/api/options-plans/{plan_id}", headers={"Authorization": f"Bearer {user_token}"})
        assert response.status_code == 200
        assert "tags" in response.json()
        assert isinstance(response.json()["tags"], list)