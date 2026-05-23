"""Golden / fixture tests for direction_ensemble (stable across refactors)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from prediction.direction_ensemble import direction_ensemble_detail

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "direction_ensemble_cases.json"


def _load_cases() -> list[dict]:
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return list(data.get("cases") or [])


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["id"])
def test_direction_ensemble_golden_case(case: dict) -> None:
    detail = direction_ensemble_detail(**case["kwargs"])
    exp = case["expect"]

    assert exp["direction_substring"] in detail.direction_label
    assert detail.direction_label == exp["direction_label"]
    assert detail.phase == exp["phase"]
    assert detail.net_score == exp["net_score"]
    assert exp["confidence_min"] <= detail.confidence <= exp["confidence_max"]
    assert detail.confidence == exp["confidence"]
