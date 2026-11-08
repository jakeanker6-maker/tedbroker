"""Onboarding address suggestions (Photon proxy) and the personal info step (name and gender)."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.routes import onboarding
from app.routes.onboarding import normalize_address_features

PHOTON_SAMPLE = {
    "type": "FeatureCollection",
    "features": [
        {"properties": {
            "housenumber": "1600", "name": "1600 Pennsylvania Ave SE", "street": "Pennsylvania Avenue Southeast",
            "city": "Washington", "state": "District of Columbia", "postcode": "20003",
            "country": "United States", "countrycode": "us",
        }},
        # City-level result: no street or house number, name becomes the street
        {"properties": {"name": "Paris", "state": "Ile-de-France", "country": "France", "countrycode": "FR"}},
        # No country: dropped, the wizard cannot autofill the country
        {"properties": {"name": "Nowhere", "countrycode": ""}},
    ],
}


def test_normalize_maps_photon_features():
    items = normalize_address_features(PHOTON_SAMPLE)
    assert [i.country_code for i in items] == ["US", "FR"]
    us = items[0]
    assert us.street == "1600 Pennsylvania Avenue Southeast"
    assert us.city == "Washington"
    assert us.state == "District of Columbia"
    assert us.zip_code == "20003"
    assert us.country == "United States"
    assert us.label.startswith("1600 Pennsylvania Avenue Southeast, Washington")
    paris = items[1]
    assert paris.street == "Paris"
    assert paris.zip_code == ""


def test_normalize_handles_empty_payload():
    assert normalize_address_features({}) == []
    assert normalize_address_features({"features": None}) == []


def test_address_suggestions_requires_auth(client):
    response = client.get("/api/onboarding/address-suggestions", params={"q": "10 downing"})
    assert response.status_code in (401, 403)


def test_address_suggestions_returns_normalised_list(client, user_token):
    fake_response = httpx.Response(200, json=PHOTON_SAMPLE, request=httpx.Request("GET", "https://example.test"))
    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=fake_response)):
        response = client.get(
            "/api/onboarding/address-suggestions",
            params={"q": "1600 pennsylvania"},
            headers={"Authorization": f"Bearer {user_token}"},
        )
    assert response.status_code == 200
    body = response.json()
    assert [s["country_code"] for s in body["suggestions"]] == ["US", "FR"]


def test_address_suggestions_503_when_provider_fails(client, user_token):
    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(side_effect=httpx.ConnectError("down"))):
        response = client.get(
            "/api/onboarding/address-suggestions",
            params={"q": "1600 pennsylvania"},
            headers={"Authorization": f"Bearer {user_token}"},
        )
    assert response.status_code == 503
    assert "enter your address manually" in response.json()["detail"].lower()


def test_address_suggestions_rejects_short_query(client, user_token):
    response = client.get(
        "/api/onboarding/address-suggestions",
        params={"q": "ab"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 422


def test_personal_info_stores_gender(client, user_token):
    response = client.post(
        "/api/onboarding/personal-info",
        json={"first_name": "Ada", "last_name": "Lovelace", "gender": "Female"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    user = client.get("/api/onboarding/data", headers={"Authorization": f"Bearer {user_token}"}).json()
    assert user["personal_info"]["gender"] == "Female"


def test_personal_info_requires_valid_gender(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    missing = client.post("/api/onboarding/personal-info", json={"first_name": "Ada", "last_name": "Lovelace"}, headers=headers)
    assert missing.status_code == 422
    invalid = client.post("/api/onboarding/personal-info",
                          json={"first_name": "Ada", "last_name": "Lovelace", "gender": "Robot"}, headers=headers)
    assert invalid.status_code == 422
