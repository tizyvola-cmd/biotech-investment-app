"""collect_resolved_outcomes_from_sources must pair each model prediction with
the realized actual at the *same* horizon.

Regression guard: ``d{N}_pct`` are realized post-catalyst outcomes, so the
matching forecast is ``model_d{N}_pct`` (post-CD) — never ``model_dm{N}_pct``
(the pre-CD forecast for a different horizon)."""
from __future__ import annotations

import past_pred_io
from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources


def test_collector_pairs_post_cd_prediction_with_post_cd_actual(monkeypatch):
    rec = {
        "model_accuracy_metrics_eligible": True,
        "completion_date": "2025-01-10",
        "phase": "Phase 2",
        "condition": "oncology",
        "model_dm5_pct": -99.0,  # pre-CD forecast: must NOT be matched to d5_pct
        "model_d5_pct": 4.0,  # post-CD forecast at +5
        "d5_pct": 6.0,  # realized actual at +5
        "model_d3_pct": 2.0,
        "d3_pct": 3.0,
        "model_d10_pct": 5.0,
        "d10_pct": 7.0,
    }
    monkeypatch.setattr(
        past_pred_io, "load_past_pred_map", lambda *a, **k: {"TEST|2025-01-10": rec}
    )
    outs = collect_resolved_outcomes_from_sources()
    mine = [o for o in outs if o["ticker"] == "TEST|2025-01-10"]
    nodes = {o["node"]: o for o in mine}
    assert set(nodes) == {"T+3", "T+5", "T+10"}
    # post-CD prediction paired with post-CD actual at the same horizon
    assert nodes["T+5"]["pred"] == 4.0
    assert nodes["T+5"]["actual"] == 6.0
    assert nodes["T+10"]["pred"] == 5.0
    assert nodes["T+10"]["actual"] == 7.0
    # the pre-CD forecast (model_dm5_pct) is never used as a prediction
    assert all(o["pred"] != -99.0 for o in mine)
