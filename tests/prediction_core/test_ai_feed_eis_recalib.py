"""Tests for AI feed recalibration and EIS polynomial adjustment."""
from __future__ import annotations

from datetime import date

import pandas as pd

from prediction.ai_feed_recalib import (
    _event_kpi_quality_weight,
    aggregate_clinical_indicator_shift_pp,
    aggregate_eis_for_events,
    build_prediction_clinical_signal,
    events_for_prediction,
    merge_ai_feed_observations_into_act,
    publication_sessions_pct_vs_p60,
)
from prediction.config import get_config
from prediction.eis_poly_adjust import (
    apply_eis_poly_shift,
    compute_eis_poly_shift_pp,
    eis_augment_pairs_for_fit,
)
from prediction.seq_calib import pred_curve_seq_snap_cal_day_to_offset_index


def test_merge_skips_filled_act_nodes():
    cd = date(2026, 6, 1)
    today = date(2026, 5, 20)
    offsets = (-60, -30, -10, -7, -5, -3, 4, 7)
    act = [0.0, None, 5.0, None, None, None, None, None]
    idx = {
        f"TEST|{cd.isoformat()}": {
            "ticker": "TEST",
            "company": "Test Pharma Inc.",
            "clinical_events": [
                {
                    "event_date": "2026-05-10",
                    "source_type": "publication",
                    "event_title": "Test Pharma Berubicin interim data",
                    "summary": "Test Pharma reports Berubicin ORR 38%.",
                    "drug": "Berubicin",
                    "price": {"p_t1": 11.0, "p_t3": 12.0},
                    "eis": {"score": 4.0},
                    "reference_verified": True,
                    "reference_match": "company+drug",
                }
            ],
            "publication_context": {"drug_tokens_searched": ["Berubicin"]},
        }
    }
    # Build minimal close series around publication
    days = pd.date_range("2026-03-01", "2026-05-15", freq="B")
    ser = pd.Series([10.0 + i * 0.01 for i in range(len(days))], index=days)
    n = merge_ai_feed_observations_into_act(
        tk="TEST",
        cd=cd,
        p60=10.0,
        today=today,
        offsets=offsets,
        act=act,
        close_series=ser,
        index=idx,
        snap_cal_day_to_offset_index=pred_curve_seq_snap_cal_day_to_offset_index,
    )
    assert n >= 0
    assert act[2] == 5.0  # unchanged — already filled


def test_aggregate_eis_recency_weighted():
    events = [
        {"event_date": "2026-05-01", "eis": {"score": 10.0}},
        {"event_date": "2026-04-01", "eis": {"score": -10.0}},
    ]
    agg = aggregate_eis_for_events(events, today=date(2026, 5, 10), cd=date(2026, 6, 1))
    assert agg is not None
    assert agg > 0  # recent positive dominates


def test_aggregate_eis_sentiment_fallback():
    events = [{"event_date": "2026-05-05", "sentiment": 2.0}]
    agg = aggregate_eis_for_events(events, today=date(2026, 5, 10), cd=date(2026, 6, 1))
    assert agg is not None
    assert agg > 0


def test_clinical_indicator_shift_positive_orr():
    rec = {
        "clinical_indicators": [
            {
                "indicator_date": "2026-05-01",
                "label": "ORR",
                "numeric_value": 42,
                "direction": "up",
                "endpoint_met": True,
            }
        ]
    }
    pp, n = aggregate_clinical_indicator_shift_pp(
        rec, [], today=date(2026, 5, 10))
    assert n == 1
    assert pp > 0


def test_events_for_prediction_verified_only():
    cd = date(2026, 6, 1)
    idx = {
        f"TEST|{cd.isoformat()}": {
            "clinical_events": [
                {
                    "event_date": "2026-05-10",
                    "source_type": "publication",
                    "reference_verified": True,
                    "eis": {"score": 1.0},
                },
                {
                    "event_date": "2026-05-08",
                    "source_type": "publication",
                    "reference_verified": False,
                    "eis": {"score": 99.0},
                },
            ],
            "publication_context": {"drug_tokens_searched": ["Drug"]},
        }
    }
    evs = events_for_prediction("TEST", cd, index=idx)
    assert len(evs) == 1
    assert evs[0]["eis"]["score"] == 1.0


def test_build_prediction_clinical_signal_bundle():
    cd = date(2026, 6, 1)
    idx = {
        f"ZZ|{cd.isoformat()}": {
            "clinical_events": [
                {
                    "event_date": "2026-05-10",
                    "source_type": "press_clinical",
                    "reference_verified": True,
                    "sentiment": 1.5,
                    "indicators": [
                        {"label": "PFS", "direction": "up", "endpoint_met": True}
                    ],
                }
            ],
        }
    }
    sig = build_prediction_clinical_signal(
        "ZZ", cd, today=date(2026, 5, 15), index=idx)
    assert sig["verified_events_n"] == 1
    assert sig["eis_agg"] is not None
    assert sig["indicator_shift_pp"] > 0


def test_eis_poly_shift_clamped():
    shift = compute_eis_poly_shift_pp(50.0)
    cfg = get_config()
    assert abs(shift) <= cfg.pred_eis_poly_max_shift + 1e-6


def test_eis_augment_dedupes_existing_pairs():
    today = date(2026, 5, 20)
    pairs = [(float(-5), 1.0), (float(-4), 1.1)]
    events = [
        {
            "event_date": "2026-05-15",
            "price": {"p_t1": 10.5, "p_t3": 10.8},
        }
    ]
    out = eis_augment_pairs_for_fit(
        pairs, events, today=today, p_now=10.0, eis_agg=2.0)
    assert len(out) == len(pairs)


def test_eis_poly_shift_with_clinical_extra_pp():
    base = compute_eis_poly_shift_pp(2.0)
    combined = compute_eis_poly_shift_pp(2.0, extra_pp=2.0)
    assert abs(combined) >= abs(base)


def test_apply_eis_poly_shift():
    shifted, meta = apply_eis_poly_shift(
        model_dm7_pct=1.0,
        model_dm5_pct=1.0,
        model_dm3_pct=1.0,
        model_dm10_pct=1.0,
        model_dm30_pct=1.0,
        model_dm60_pct=1.0,
        model_d4_pct=1.0,
        model_d7_pct=1.0,
        d3_pct=2.0,
        d5_pct=2.0,
        d10_pct=2.0,
        d30_pct=2.0,
        eis_agg=10.0,
        extra_shift_pp=1.5,
    )
    assert meta.get("eis_poly_applied") is True
    assert meta.get("eis_poly_extra_pp") == 1.5
    assert shifted["d3_pct"] != 2.0


def test_merge_skips_unverified_events():
    cd = date(2026, 6, 1)
    today = date(2026, 5, 20)
    offsets = (-60, -30, -10, -7, -5, -3, 4, 7)
    act = [0.0, None, None, None, None, None, None, None]
    days = pd.date_range("2026-05-08", "2026-05-15", freq="B")
    ser = pd.Series([10.0 + i * 0.05 for i in range(len(days))], index=days)
    idx = {
        f"TEST|{cd.isoformat()}": {
            "ticker": "TEST",
            "company": "Test Co",
            "clinical_events": [
                {
                    "event_date": "2026-05-10",
                    "source_type": "publication",
                    "event_title": "Generic oncology trends",
                    "summary": "Industry meta-analysis.",
                    "reference_verified": False,
                }
            ],
        }
    }
    n = merge_ai_feed_observations_into_act(
        tk="TEST",
        cd=cd,
        p60=10.0,
        today=today,
        offsets=offsets,
        act=act,
        close_series=ser,
        index=idx,
        snap_cal_day_to_offset_index=pred_curve_seq_snap_cal_day_to_offset_index,
    )
    assert n == 0
    assert act.count(None) == len(act) - 1


def test_merge_dedupes_same_trade_date():
    cd = date(2026, 6, 1)
    today = date(2026, 5, 20)
    offsets = (-60, -30, -10, -7, -5, -3, 4, 7)
    act = [0.0, None, None, None, None, None, None, None]
    days = pd.date_range("2026-05-08", "2026-05-15", freq="B")
    ser = pd.Series([10.0 + i * 0.05 for i in range(len(days))], index=days)
    idx = {
        f"TEST|{cd.isoformat()}": {
            "ticker": "TEST",
            "company": "Test Pharma Inc.",
            "clinical_events": [
                {
                    "event_date": "2026-05-10",
                    "source_type": "publication",
                    "event_title": "Test Pharma Berubicin update",
                    "drug": "Berubicin",
                    "reference_verified": True,
                },
                {
                    "event_date": "2026-05-10",
                    "source_type": "congress",
                    "event_title": "Test Pharma Berubicin poster",
                    "drug": "Berubicin",
                    "reference_verified": True,
                },
            ],
            "publication_context": {"drug_tokens_searched": ["Berubicin"]},
        }
    }
    n = merge_ai_feed_observations_into_act(
        tk="TEST",
        cd=cd,
        p60=10.0,
        today=today,
        offsets=offsets,
        act=act,
        close_series=ser,
        index=idx,
        snap_cal_day_to_offset_index=pred_curve_seq_snap_cal_day_to_offset_index,
    )
    filled = [i for i, v in enumerate(act) if v is not None and i > 0]
    assert n == len(filled)
    # Same publication date → same T/T+1/T+2 sessions, not doubled per offset
    assert len(filled) <= 3


def test_ai_feed_chart_points_dedupe_trade_dates():
    cd = date(2026, 6, 1)
    today = date(2026, 5, 20)
    days = pd.date_range("2026-05-08", "2026-05-15", freq="B")
    ser = pd.Series([10.0] * len(days), index=days)
    idx = {
        f"TEST|{cd.isoformat()}": {
            "ticker": "TEST",
            "company": "Test Pharma Inc.",
            "clinical_events": [
                {
                    "event_date": "2026-05-10",
                    "source_type": "publication",
                    "event_title": "Test Pharma Berubicin",
                    "drug": "Berubicin",
                    "reference_verified": True,
                },
                {
                    "event_date": "2026-05-10",
                    "source_type": "congress",
                    "event_title": "Unrelated congress abstract",
                    "summary": "Global trends.",
                    "reference_verified": False,
                },
            ],
            "publication_context": {"drug_tokens_searched": ["Berubicin"]},
        }
    }
    from prediction.ai_feed_recalib import ai_feed_chart_points

    pts = ai_feed_chart_points(
        tk="TEST",
        cd=cd,
        p60=10.0,
        today=today,
        close_series=ser,
        index=idx,
    )
    trade_keys = {str(p.get("data_raw")) for p in pts}
    assert len(trade_keys) == len(pts)
    assert all(p.get("nodo") == "AI feed" for p in pts)
    assert all(p.get("reference_verified") is True for p in pts)


def test_publication_sessions_three_points():
    cd = date(2026, 6, 1)
    event_d = date(2026, 5, 10)
    days = pd.date_range("2026-05-08", "2026-05-20", freq="B")
    ser = pd.Series([10.0] * len(days), index=days)
    pts = publication_sessions_pct_vs_p60(
        ser, event_d=event_d, p60=10.0, today=date(2026, 5, 20))
    assert len(pts) == 3
    assert all(abs(p[1]) < 0.01 for p in pts)


def test_publication_sessions_after_event_skips_pub_day():
    event_d = date(2026, 5, 10)
    days = pd.date_range("2026-05-08", "2026-05-20", freq="B")
    ser = pd.Series([10.0] * len(days), index=days)
    pts = publication_sessions_pct_vs_p60(
        ser,
        event_d=event_d,
        p60=10.0,
        today=date(2026, 5, 20),
        sessions_after_event=True,
    )
    assert len(pts) == 3
    assert all(td > event_d for td, _ in pts)


def test_kpi_quality_weight_penalizes_negative_kpi_score():
    ev_pos = {"eis": {"kpi_score": 1.5}}
    ev_neg = {"eis": {"kpi_score": -1.5}}
    w_pos = _event_kpi_quality_weight(ev_pos)
    w_neg = _event_kpi_quality_weight(ev_neg)
    assert w_pos > 1.0
    assert w_neg < 1.0
    assert w_pos > w_neg


def test_clinical_indicator_shift_dedupes_same_indicator():
    rec = {
        "clinical_indicators": [
            {
                "indicator_date": "2026-05-01",
                "label": "ORR",
                "direction": "up",
                "endpoint_met": True,
            }
        ]
    }
    events = [
        {
            "event_date": "2026-05-01",
            "indicators": [
                {
                    "label": "ORR",
                    "direction": "up",
                    "endpoint_met": True,
                }
            ],
        }
    ]
    pp, n = aggregate_clinical_indicator_shift_pp(rec, events, today=date(2026, 5, 10))
    assert n == 1
    assert pp > 0
