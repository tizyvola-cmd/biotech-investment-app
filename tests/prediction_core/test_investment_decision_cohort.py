"""Tests for investment decision cohort builder."""
import json
from datetime import date
from pathlib import Path

from prediction.investment_decision_cohort import (
    _direction_hit,
    _forward_return_pp,
    _segment_metrics,
    _spearman,
    build_cohort_comparison,
    build_investment_decision_cohort,
    build_segment_diagnostics,
    env_fingerprint,
    write_investment_decision_cohort,
)


def test_spearman_perfect_positive():
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert _spearman(xs, xs) == 1.0


def test_forward_return_from_closes():
    rec = {"close_m7": 100.0, "close_p7": 110.0}
    assert _forward_return_pp(rec) == 10.0


def test_direction_hit_flat_band():
    assert _direction_hit(0.2, 0.3, 0.5) is True
    assert _direction_hit(1.0, -1.0, 0.5) is False


def test_segment_metrics_bias():
    rows = [
        {
            "pred_forward_pp": 10.0,
            "realized_forward_pp": 5.0,
            "direction_hit": True,
        },
        {
            "pred_forward_pp": 4.0,
            "realized_forward_pp": 6.0,
            "direction_hit": True,
        },
    ]
    m = _segment_metrics(rows)
    assert m["n_ic_pairs"] == 2
    assert m["mean_pred_bias_pp"] == 1.5
    assert m["hit_rate_pct"] == 100.0


def test_build_segment_diagnostics_groups():
    rows = [
        {
            "sponsor_match": "exact",
            "phase": "Phase III",
            "run_up_30d": 20.0,
            "dir_v4": "▲ Up",
            "affidabilita_pct": 75.0,
            "model_inferenza_affidabile": True,
            "pred_forward_pp": 8.0,
            "realized_forward_pp": 6.0,
            "direction_hit": True,
        },
        {
            "sponsor_match": "partial",
            "phase": "Phase II",
            "run_up_30d": -2.0,
            "dir_v4": "▼ Down",
            "affidabilita_pct": 40.0,
            "model_inferenza_affidabile": False,
            "pred_forward_pp": -3.0,
            "realized_forward_pp": 2.0,
            "direction_hit": False,
        },
    ]
    groups = build_segment_diagnostics(rows)
    ids = {g["id"] for g in groups}
    assert "sponsor" in ids
    assert "runup" in ids
    assert any(g["id"] == "sponsor" and len(g["segments"]) == 2 for g in groups)


def test_build_cohort_empty_doc():
    payload = build_investment_decision_cohort(
        past_pred_path="/nonexistent/past.json",
        today=date(2026, 5, 24),
    )
    assert payload["summary"]["n_events"] == 0
    assert "protocol" in payload
    assert payload.get("segment_groups") == []


def test_env_fingerprint_stable():
    env = {"PRED_V4_CURVE_SCALE_PRECD": 1.05, "PRED_ENGINE": "v4"}
    assert env_fingerprint(env) == env_fingerprint(dict(env))


def test_build_cohort_comparison_delta():
    prev = {
        "generated_at": "2026-05-01T00:00:00+00:00",
        "env_snapshot": {"PRED_V4_CURVE_SCALE_PRECD": 1.0},
        "env_fingerprint": "aaa",
        "summary": {"ic_spearman": -0.04, "hit_rate_pct": 40.0, "n_events": 700},
        "segment_groups": [
            {
                "id": "sponsor",
                "segments": [{"label": "Exact", "ic_spearman": -0.02, "hit_rate_pct": 41.0}],
            }
        ],
    }
    cur = {
        "generated_at": "2026-05-02T00:00:00+00:00",
        "env_snapshot": {"PRED_V4_CURVE_SCALE_PRECD": 1.05},
        "env_fingerprint": "bbb",
        "summary": {"ic_spearman": 0.01, "hit_rate_pct": 45.0, "n_events": 710},
        "segment_groups": [
            {
                "id": "sponsor",
                "segments": [{"label": "Exact", "ic_spearman": 0.05, "hit_rate_pct": 46.0, "n_ic_pairs": 690}],
            }
        ],
    }
    cmp = build_cohort_comparison(prev, cur)
    assert cmp["env_changed"] is True
    assert cmp["summary_delta"]["ic_spearman"] == 0.05
    assert cmp["segment_delta"][0]["delta_ic"] == 0.07


def test_write_cohort_records_history(tmp_path: Path):
    out = tmp_path / "cohort.json"
    hist = tmp_path / "history.json"
    payload = write_investment_decision_cohort(
        path=out,
        history_path=hist,
        past_pred_path="/nonexistent/past.json",
        today=date(2026, 5, 24),
    )
    assert payload["schema_version"] == 2
    assert "env_snapshot" in payload
    assert out.is_file()
    hist_doc = json.loads(hist.read_text(encoding="utf-8"))
    assert len(hist_doc["snapshots"]) == 1

    payload2 = write_investment_decision_cohort(
        path=out,
        history_path=hist,
        past_pred_path="/nonexistent/past.json",
        today=date(2026, 5, 24),
    )
    assert "comparison" in payload2
    assert len(json.loads(hist.read_text(encoding="utf-8"))["snapshots"]) == 1  # duplicate skipped
