from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from tests.test_solver import BASE_CONFIG, SHIFT_TYPES, make_staff  # noqa: E402

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_generate_endpoint():
    staff = [make_staff(x) for x in "ABCDE"]
    payload = {
        "year": 2026,
        "month": 3,
        "floor": "1F",
        "staff": [s.model_dump() for s in staff],
        "shiftTypes": [st.model_dump() for st in SHIFT_TYPES],
        "config": BASE_CONFIG.model_dump(),
        "pairs": [],
        "holidays": [],
        "prevMonthAssignments": [],
        "prefilled": [],
        "timeLimitSeconds": 10,
    }
    res = client.post("/generate", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] in ("optimal", "feasible")
    assert len(body["assignments"]) > 0
