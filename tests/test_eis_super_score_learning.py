"""EIS super score learning loop."""
import json

from prediction.eis_super_score_learning import (
    build_correlation_timeline,
    build_eis_super_score_overview,
    compute_super_score,
    persist_eis_super_score_learning,
    resolve_cd_bin,
)


def test_compute_super_score_defaults():
    s = compute_super_score(40.0, 20)
    assert s > 0
    assert s >= 40 * 0.85 * 0.4  # at least raw-ish lower bound


def test_resolve_cd_bin_near_cd():
    assert resolve_cd_bin(5) is not None
    lo, hi, label = resolve_cd_bin(5)
    assert lo == 0 and hi == 7


def test_build_correlation_timeline_structure():
    tl = build_correlation_timeline([])
    assert len(tl) == 9
    assert tl[-1]["days_min"] == 0


def test_build_overview():
    doc = build_eis_super_score_overview()
    assert "correlation_timeline" in doc
    assert isinstance(doc["correlation_timeline"], list)


def test_persist_cycle(tmp_path, monkeypatch):
    from prediction import eis_super_score_learning as mod

    monkeypatch.setattr(mod, "_EIS_SUPER_SCORE_JSON", tmp_path / "eis_super.json")
    out = persist_eis_super_score_learning(dry_run=False)
    assert out["ok"] is True
    assert (tmp_path / "eis_super.json").is_file()
    saved = json.loads((tmp_path / "eis_super.json").read_text(encoding="utf-8"))
    assert "windows" in saved
