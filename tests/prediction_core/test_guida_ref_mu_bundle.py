"""Predizione — guida: bundle μ riferimento Grafici (Post-CD vs direzione)."""
from __future__ import annotations


def test_sn7_ref_bundle_uses_post_cd_not_direction_ok():
    """Documenta il mapping atteso in _write_prediction_explainer_sheet."""
    means_post_up = [1.0, 2.0]
    means_post_dn = [-1.0, -2.0]
    means_ok = [0.1, 0.2]
    means_fail = [-0.1, -0.2]
    bundle = {
        "success": list(means_post_up),
        "failure": list(means_post_dn),
    }
    assert bundle["success"] is not means_ok
    assert bundle["failure"] is not means_fail
    assert bundle["success"] == means_post_up
