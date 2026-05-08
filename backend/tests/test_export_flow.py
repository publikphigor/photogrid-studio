from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from photogrid.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _png_bytes(color: tuple[int, int, int] = (255, 0, 0), size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buf, format="PNG")
    return buf.getvalue()


def test_health(client: TestClient) -> None:
    r = client.get("/api/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "cache" in body


def test_upload_and_export_2x2(client: TestClient) -> None:
    r = client.post("/api/images", files={"file": ("a.png", _png_bytes((255, 0, 0)), "image/png")})
    assert r.status_code == 200, r.text
    a = r.json()
    r = client.post("/api/images", files={"file": ("b.png", _png_bytes((0, 255, 0)), "image/png")})
    assert r.status_code == 200
    b = r.json()
    assert a["hash"] != b["hash"]

    state = {
        "container": {
            "shape": "rect", "cornerRadius": 12, "aspect": "1:1",
            "bg": "#ffffff", "bgTransparent": False,
            "padding": 8, "gap": 4,
            "borderWidth": 0, "borderColor": "#000000",
        },
        "grid": {"cols": 2, "rows": 2},
        "cells": [
            {
                "id": "c1", "colStart": 1, "rowStart": 1, "colSpan": 1, "rowSpan": 1,
                "image": {"hash": a["hash"], "name": "a", "w": 64, "h": 64, "mime": "image/png"},
                "fit": "cover", "offsetX": 0, "offsetY": 0, "scale": 1, "rotation": 0,
                "filter": "none", "cellRadius": 0, "cellBorder": 0, "cellBorderColor": "#fff",
            },
            {
                "id": "c2", "colStart": 2, "rowStart": 1, "colSpan": 1, "rowSpan": 1,
                "image": {"hash": b["hash"], "name": "b", "w": 64, "h": 64, "mime": "image/png"},
                "fit": "cover", "offsetX": 0, "offsetY": 0, "scale": 1, "rotation": 0,
                "filter": "none", "cellRadius": 0, "cellBorder": 0, "cellBorderColor": "#fff",
            },
            {
                "id": "c3", "colStart": 1, "rowStart": 2, "colSpan": 1, "rowSpan": 1,
                "image": None,
                "fit": "cover", "offsetX": 0, "offsetY": 0, "scale": 1, "rotation": 0,
                "filter": "none", "cellRadius": 0, "cellBorder": 0, "cellBorderColor": "#fff",
            },
            {
                "id": "c4", "colStart": 2, "rowStart": 2, "colSpan": 1, "rowSpan": 1,
                "image": None,
                "fit": "cover", "offsetX": 0, "offsetY": 0, "scale": 1, "rotation": 0,
                "filter": "none", "cellRadius": 0, "cellBorder": 0, "cellBorderColor": "#fff",
            },
        ],
        "output": {"format": "png", "quality": 0.92, "scale": 1, "baseSize": 256},
    }
    r = client.post("/api/export", json={"state": state})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (256, 256)
    # Top-left red, top-right green sample.
    r_px = img.getpixel((40, 40))
    g_px = img.getpixel((200, 40))
    assert r_px[0] > 200 and r_px[1] < 60
    assert g_px[1] > 200 and g_px[0] < 60


def test_export_409_on_missing(client: TestClient) -> None:
    state = {
        "container": {
            "shape": "rect", "cornerRadius": 12, "aspect": "1:1",
            "bg": "#ffffff", "bgTransparent": False,
            "padding": 8, "gap": 4,
            "borderWidth": 0, "borderColor": "#000000",
        },
        "grid": {"cols": 1, "rows": 1},
        "cells": [{
            "id": "c1", "colStart": 1, "rowStart": 1, "colSpan": 1, "rowSpan": 1,
            "image": {"hash": "0" * 64, "name": "ghost", "w": 0, "h": 0, "mime": "image/png"},
            "fit": "cover", "offsetX": 0, "offsetY": 0, "scale": 1, "rotation": 0,
            "filter": "none", "cellRadius": 0, "cellBorder": 0, "cellBorderColor": "#fff",
        }],
        "output": {"format": "png", "quality": 0.92, "scale": 1, "baseSize": 256},
    }
    r = client.post("/api/export", json={"state": state})
    assert r.status_code == 409
    assert "0" * 64 in r.json()["missing"]
