"""Admin uploads a trader photo from local storage; the URL reaches the user-facing directory."""
from app.routes.admin import TRADER_PHOTO_DIR
from app.database import get_collection, TRADERS_COLLECTION

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
NAME = "Photo Test Trader"


def _cleanup():
    get_collection(TRADERS_COLLECTION).delete_many({"full_name": NAME})


def _upload(client, token, filename, content, content_type):
    return client.post("/api/admin/traders/photo",
                       files={"file": (filename, content, content_type)},
                       headers={"Authorization": f"Bearer {token}"})


def test_admin_photo_upload_stores_file_and_returns_url(client, admin_token):
    r = _upload(client, admin_token, "face.png", PNG, "image/png")
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("/uploads/traders/") and url.endswith(".png")
    assert (TRADER_PHOTO_DIR / url.rsplit("/", 1)[1]).read_bytes() == PNG
    (TRADER_PHOTO_DIR / url.rsplit("/", 1)[1]).unlink()


def test_uploaded_photo_appears_in_user_directory(client, admin_token, user_token):
    _cleanup()
    url = _upload(client, admin_token, "face.png", PNG, "image/png").json()["url"]
    body = {
        "full_name": NAME, "profile_photo": url, "description": "d", "specialization": "stocks",
        "ytd_return": 1.0, "win_rate": 50.0, "copiers": 0, "minimum_copy_amount": 100.0,
    }
    r = client.post("/api/admin/traders", json=body, headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text

    directory = client.get("/api/traders/", headers={"Authorization": f"Bearer {user_token}"}).json()
    match = next(t for t in directory if t["full_name"] == NAME)
    assert match["profile_photo"] == url
    _cleanup()
    (TRADER_PHOTO_DIR / url.rsplit("/", 1)[1]).unlink()


def test_non_image_is_rejected(client, admin_token):
    r = _upload(client, admin_token, "notes.txt", b"hello world", "text/plain")
    assert r.status_code == 400


def test_oversized_image_is_rejected(client, admin_token):
    big = PNG + b"\x00" * (5 * 1024 * 1024)
    r = _upload(client, admin_token, "big.png", big, "image/png")
    assert r.status_code == 413


def test_upload_requires_admin(client, user_token):
    r = _upload(client, user_token, "face.png", PNG, "image/png")
    assert r.status_code in (401, 403)
