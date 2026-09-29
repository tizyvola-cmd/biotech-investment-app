"""Main inflection classification for Calendar highlight."""
from __future__ import annotations

from catalyst_benchmark import classify_main_inflection


def test_pdufa_is_main_inflection() -> None:
    ok, score, label = classify_main_inflection(
        {"event_type": "PDUFA", "raw_snippet": "FDA set a PDUFA target action date"}
    )
    assert ok is True
    assert score == 80
    assert label


def test_adcom_is_main_inflection() -> None:
    ok, score, _ = classify_main_inflection(
        {"event_type": "AdCom", "raw_snippet": "Advisory Committee meeting scheduled"}
    )
    assert ok is True
    assert score == 50


def test_routine_partnership_not_main() -> None:
    ok, score, _ = classify_main_inflection(
        {
            "event_type": "Partnership",
            "window_label": "Q1 2027",
            "raw_snippet": "entered into a collaboration agreement",
        }
    )
    assert ok is False
    assert score is None


def test_phase3_readout_is_main() -> None:
    ok, score, _ = classify_main_inflection(
        {
            "event_type": "Readout",
            "window_label": "2H 2026",
            "raw_snippet": "expects Phase 3 topline primary endpoint data in 2H 2026",
        }
    )
    assert ok is True
    assert score is not None and abs(score) >= 40
