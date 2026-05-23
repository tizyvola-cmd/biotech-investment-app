"""Interp curva Pred Accuracy — ancoraggio CD tra pre e post."""
from __future__ import annotations

import data_orchestrator as orch


def test_interp_inserts_cd_knot_pre_post_bridge():
    """Con nodi pre‑CD e post‑CD, offset 0 usa price_at_cd (no salto solo a T+4)."""
    dd = {
        "price_at_cd": 100.0,
        "model_dm60_pct": 0.0,
        "model_dm3_pct": 0.0,
        "model_d4_pct": 40.0,
        "model_d7_pct": 50.0,
    }

    def _px(d, k):
        return orch._acc_sim_pred_px_at_pct_key(d, k)

    px_m3 = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, -3, _px)
    px_0 = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, 0, _px)
    px_p2 = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, 2, _px)
    px_p4 = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, 4, _px)

    assert px_m3 is not None and abs(px_m3 - 100.0) < 0.01
    assert px_0 is not None and abs(px_0 - 100.0) < 0.01
    assert px_p4 is not None and abs(px_p4 - 140.0) < 0.01
    # Tra CD e T+4 la traiettoria è lineare in prezzo, non un gradino solo al nodo +4
    assert px_p2 is not None
    assert 100.0 < float(px_p2) < 140.0


def test_synthesize_post_cd_when_only_t60_zero_anchor():
    row = {"model_dm60_pct": 0.0, "d3_pct": 5.0, "d5_pct": 35.0, "d10_pct": 40.0}
    orch._accuracy_sim_synthesize_interp_nodes_from_post_d_only(row)
    assert row.get("model_d4_pct") is not None
    assert float(row["model_d4_pct"]) > 10.0
