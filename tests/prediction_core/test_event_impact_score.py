"""Tests for Event Impact Score (EIS) and Copilot research helpers."""
from __future__ import annotations

from prediction.event_impact_score import (
    K_INTRINSIC,
    compute_eis,
    eis_intrinsic_from_kpi,
    kpi_intrinsic_score,
    virtual_regulatory_indicator,
)


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


def test_eis_intrinsic_is_kpi_times_k_and_not_folded_into_market_score():
    e_none = compute_eis(delta_p_1d=5.0, delta_p_3d=5.0, vol_ratio=1.0, sentiment=0.0)
    assert e_none["eis_intrinsic"] is None
    e = compute_eis(
        delta_p_1d=5.0,
        delta_p_3d=5.0,
        vol_ratio=1.0,
        sentiment=0.0,
        kpi_score=0.5,
    )
    assert e["eis_intrinsic"] == round(0.5 * K_INTRINSIC, 2)
    assert e["kpi_score"] == 0.5
    # Market score still uses w4 × kpi×10, not eis_intrinsic as an extra addend.
    assert e["score"] == e_none["score"] + 0.15 * (0.5 * 10.0)
    assert eis_intrinsic_from_kpi(3.0) == round(2.0 * K_INTRINSIC, 2)
    assert eis_intrinsic_from_kpi(-3.0) == round(-2.0 * K_INTRINSIC, 2)
    assert eis_intrinsic_from_kpi(None) is None


def test_virtual_regulatory_approval_and_crl():
    appr = virtual_regulatory_indicator({"event_title": "FDA approves NDA for asset X"})
    assert appr is not None
    assert appr["kpi_type"] == "regulatory"
    assert appr["endpoint_met"] is True
    kpi = kpi_intrinsic_score([appr])
    assert kpi > 0.4
    e = compute_eis(delta_p_1d=4.0, delta_p_3d=3.0, vol_ratio=1.0, sentiment=0.0, kpi_score=kpi)
    assert e["eis_intrinsic"] is not None and e["eis_intrinsic"] > 4

    crl = virtual_regulatory_indicator({"event_title": "FDA issues a complete response letter"})
    assert crl is not None and crl["endpoint_met"] is False

    hold = virtual_regulatory_indicator({"event_title": "FDA places the program on clinical hold"})
    assert hold is not None and hold["endpoint_met"] is False


def test_virtual_regulatory_skips_oncology_crr_pending_and_earnings():
    assert (
        virtual_regulatory_indicator(
            {"event_title": "Phase 2: complete response rate 40% in TNBC"}
        )
        is None
    )
    assert virtual_regulatory_indicator({"event_title": "Company seeking FDA approval"}) is None
    assert (
        virtual_regulatory_indicator(
            {
                "event_title": "Results of operations",
                "source_type": "sec_8k",
                "items_raw": "2.02",
            }
        )
        is None
    )
    assert (
        virtual_regulatory_indicator(
            {"event_title": "FDA approves NDA"},
            [{"label": "ORR", "value": "38%", "kpi_type": "efficacy", "endpoint_met": True}],
        )
        is None
    )
