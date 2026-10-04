import pytest
from fastapi.testclient import TestClient
from bson import ObjectId


def test_admin_create_plan_with_tags(client, admin_token):
    response = client.post("/api/admin/plans", json={
        "name": "Tagged Plan", "description": "Desc", "minimum_investment": 100,
        "holding_period_months": 6, "expected_return_percent": 10.0,
        "tags": ["hot", "recommended"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["hot", "recommended"]


def test_admin_update_plan_tags(client, admin_token):
    # First create a plan
    create_response = client.post("/api/admin/plans", json={
        "name": "Plan to Update", "description": "Desc", "minimum_investment": 100,
        "holding_period_months": 6, "expected_return_percent": 10.0,
        "tags": ["hot"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert create_response.status_code == 200
    plan_id = create_response.json()["id"]
    
    # Now update with new tags
    response = client.put(f"/api/admin/plans/{plan_id}", json={
        "tags": ["new", "popular"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["new", "popular"]


def test_admin_get_plans_includes_tags(client, admin_token):
    # Create a plan with tags
    client.post("/api/admin/plans", json={
        "name": "Plan with Tags", "description": "Desc", "minimum_investment": 100,
        "holding_period_months": 6, "expected_return_percent": 10.0,
        "tags": ["featured", "trending"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    
    response = client.get("/api/admin/plans", headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    plans = response.json()
    assert any(p["tags"] == ["featured", "trending"] for p in plans)


def test_admin_get_plan_detail_includes_tags(client, admin_token):
    create_response = client.post("/api/admin/plans", json={
        "name": "Detail Plan", "description": "Desc", "minimum_investment": 100,
        "holding_period_months": 6, "expected_return_percent": 10.0,
        "tags": ["hot"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    plan_id = create_response.json()["id"]
    
    response = client.get(f"/api/admin/plans/{plan_id}", headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["hot"]


# ETF Plan tests
def test_admin_create_etf_plan_with_tags(client, admin_token):
    response = client.post("/api/admin/etf-plans", json={
        "name": "Tagged ETF Plan", "plan_type": "Conservative",
        "expected_return_percent": 8.0, "duration_months": 12,
        "minimum_investment": 500, "tags": ["hot", "new"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["hot", "new"]


def test_admin_update_etf_plan_tags(client, admin_token):
    create_response = client.post("/api/admin/etf-plans", json={
        "name": "ETF to Update", "plan_type": "Moderate",
        "expected_return_percent": 8.0, "duration_months": 12,
        "minimum_investment": 500, "tags": ["hot"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    plan_id = create_response.json()["id"]
    
    response = client.put(f"/api/admin/etf-plans/{plan_id}", json={
        "tags": ["recommended", "popular"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["recommended", "popular"]


def test_admin_get_etf_plans_includes_tags(client, admin_token):
    client.post("/api/admin/etf-plans", json={
        "name": "ETF with Tags", "plan_type": "Aggressive",
        "expected_return_percent": 12.0, "duration_months": 6,
        "minimum_investment": 1000, "tags": ["featured"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    
    response = client.get("/api/admin/etf-plans", headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    plans = response.json()
    assert any(p["tags"] == ["featured"] for p in plans)


# DeFi Plan tests
def test_admin_create_defi_plan_with_tags(client, admin_token):
    response = client.post("/api/admin/defi-plans", json={
        "name": "Tagged DeFi Plan", "portfolio_type": "Moderate",
        "expected_return_percent": 15.0, "duration_months": 6,
        "minimum_investment": 1000, "tags": ["trending", "popular"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["trending", "popular"]


def test_admin_update_defi_plan_tags(client, admin_token):
    create_response = client.post("/api/admin/defi-plans", json={
        "name": "DeFi to Update", "portfolio_type": "Conservative",
        "expected_return_percent": 10.0, "duration_months": 12,
        "minimum_investment": 500, "tags": ["new"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    plan_id = create_response.json()["id"]
    
    response = client.put(f"/api/admin/defi-plans/{plan_id}", json={
        "tags": ["hot", "featured"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["hot", "featured"]


def test_admin_get_defi_plans_includes_tags(client, admin_token):
    client.post("/api/admin/defi-plans", json={
        "name": "DeFi with Tags", "portfolio_type": "Aggressive",
        "expected_return_percent": 20.0, "duration_months": 3,
        "minimum_investment": 2000, "tags": ["recommended"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    
    response = client.get("/api/admin/defi-plans", headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    plans = response.json()
    assert any(p["tags"] == ["recommended"] for p in plans)


# Options Plan tests
def test_admin_create_options_plan_with_tags(client, admin_token):
    response = client.post("/api/admin/options-plans", json={
        "name": "Tagged Options Plan", "plan_type": "Beginner",
        "expected_return_percent": 25.0, "duration_months": 3,
        "minimum_investment": 1000, "tags": ["hot", "trending"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["hot", "trending"]


def test_admin_update_options_plan_tags(client, admin_token):
    create_response = client.post("/api/admin/options-plans", json={
        "name": "Options to Update", "plan_type": "Intermediate",
        "expected_return_percent": 20.0, "duration_months": 6,
        "minimum_investment": 1500, "tags": ["new"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    plan_id = create_response.json()["id"]
    
    response = client.put(f"/api/admin/options-plans/{plan_id}", json={
        "tags": ["popular", "featured"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["popular", "featured"]


def test_admin_get_options_plans_includes_tags(client, admin_token):
    client.post("/api/admin/options-plans", json={
        "name": "Options with Tags", "plan_type": "Advanced",
        "expected_return_percent": 30.0, "duration_months": 1,
        "minimum_investment": 3000, "tags": ["featured"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    
    response = client.get("/api/admin/options-plans", headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    plans = response.json()
    assert any(p["tags"] == ["featured"] for p in plans)


# Test invalid tags rejected
def test_admin_rejects_invalid_tag(client, admin_token):
    response = client.post("/api/admin/plans", json={
        "name": "Bad Plan", "description": "Desc", "minimum_investment": 100,
        "holding_period_months": 6, "expected_return_percent": 10.0,
        "tags": ["invalid_tag"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 422  # Validation error