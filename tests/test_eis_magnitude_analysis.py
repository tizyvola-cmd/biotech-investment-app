"""EIS magnitude analysis — high vs low score and price correlation."""
import json

from prediction.eis_magnitude_analysis import build_eis_magnitude_analysis


def test_build_eis_magnitude_analysis_structure():
    doc = build_eis_magnitude_analysis()
    assert doc.get("schema_version") == 2
    assert "n_events_scored" in doc
    assert "split" in doc
    assert "correlation" in doc
    assert "temporal_radius" in doc
    assert "temporal_regression" in doc
    assert "scatter" in doc
    assert "expected_move_calibration" in doc
    assert isinstance(doc["temporal_radius"], list)
    assert isinstance(doc["temporal_regression"], list)


def test_temporal_windows_cover_buckets():
    doc = build_eis_magnitude_analysis()
    windows = [r.get("window") for r in doc.get("temporal_radius") or []]
    reg_windows = [r.get("window") for r in doc.get("temporal_regression") or []]
    assert "0–30d" in windows
    assert "91–180d" in windows
    assert reg_windows == windows


def test_linear_regression_shape_when_data():
    doc = build_eis_magnitude_analysis()
    scatter = doc.get("scatter") or {}
    reg = (scatter.get("delta_p_1d") or {}).get("regression") or {}
    if (reg.get("n") or 0) >= 3:
        assert "slope" in reg
        assert "line" in reg
        assert len(reg.get("line") or []) == 2


def test_expected_move_calibration_when_regression():
    doc = build_eis_magnitude_analysis()
    cal = doc.get("expected_move_calibration") or {}
    t1 = (cal.get("horizons") or {}).get("t1") or {}
    if (t1.get("n") or 0) >= 3:
        assert t1.get("formula")
        assert len(t1.get("line") or []) >= 10
        assert len(t1.get("anchors") or []) >= 3
        slope = float(t1["slope_pp_per_eis"])
        intercept = float(t1["intercept_pp"])
        anchor0 = next((a for a in t1["anchors"] if abs(float(a["eis"])) < 1e-9), None)
        if anchor0:
            assert abs(float(anchor0["expected_pp"]) - intercept) < 0.05


def test_persist_eis_magnitude_snapshot(tmp_path):
    from prediction.eis_magnitude_analysis import persist_eis_magnitude_analysis

    doc = build_eis_magnitude_analysis()
    out = tmp_path / "eis_magnitude_analysis.json"
    persist_eis_magnitude_analysis(doc, snapshot_path=out)
    assert out.is_file()
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert saved.get("schema_version") == 2
    assert "scatter" in saved
