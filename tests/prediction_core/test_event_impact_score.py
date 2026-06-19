"""Tests for Event Impact Score (EIS) and Copilot research helpers."""
from __future__ import annotations

from prediction.event_impact_score import compute_eis, kpi_intrinsic_score


def test_easi_endpoint_met_positive_without_price():
    """EASI-75 ~51% vs ~15% with endpoint met → positive KPI/EIS even without T+1."""
    ind = [
        {
            "label": "EASI-75 response rate",
            "value": "~51% vs ~15%",
            "kpi_type": "efficacy",
            "direction": "up",
            "endpoint_met": True,
        },
        {
            "label": "IGA 0/1 response rate",
            "value": "~36% vs ~8%",
            "kpi_type": "efficacy",
            "direction": "up",
            "endpoint_met": True,
        },
    ]
    kpi = kpi_intrinsic_score(ind)
    assert kpi >= 0.5, f"expected strong KPI score, got {kpi}"
    e = compute_eis(delta_p_1d=None, delta_p_3d=None, vol_ratio=1.0, sentiment=0, kpi_score=kpi)
    assert e["score"] >= 1.0, f"expected positive EIS from KPI alone, got {e}"
    assert e.get("kpi_score") is not None


def test_dcr_78_positive_not_negative_with_low_volume():
    """DCR 78% + T+1 +3.4% / T+3 flat should not be strongly negative."""
    ind = [{"label": "DCR", "value": "78%", "kpi_type": "efficacy", "direction": "up"}]
    kpi = kpi_intrinsic_score(ind)
    assert kpi >= 0.35
    e = compute_eis(delta_p_1d=3.4, delta_p_3d=0.0, vol_ratio=0.5, sentiment=0, kpi_score=kpi)
    assert e["score"] > 0.5, f"expected positive EIS, got {e}"


def test_fade_partial_credit_on_delta_p3():
    e = compute_eis(delta_p_1d=3.4, delta_p_3d=0.0, vol_ratio=1.0, kpi_score=0.5)
    assert e.get("delta_p_3d_effective") == 1.36
    assert e["score"] > 1.0


def test_volume_ignored_without_price_reaction():
    e = compute_eis(delta_p_1d=0.0, delta_p_3d=0.0, vol_ratio=0.3, kpi_score=0.0)
    assert e["vol_term"] == 0.0


def test_orr_endpoint_met_scores_higher_than_dcr_direction_only():
    dcr = kpi_intrinsic_score(
        [{"label": "DCR", "value": "78%", "kpi_type": "efficacy", "direction": "up"}]
    )
    orr = kpi_intrinsic_score(
        [
            {
                "label": "ORR",
                "value": "38%",
                "kpi_type": "efficacy",
                "direction": "up",
                "endpoint_met": True,
                "p_value": "0.02",
                "data_maturity": "primary",
            }
        ]
    )
    assert orr > dcr
