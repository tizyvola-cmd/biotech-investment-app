"""Systemic FY liquidity sanity (all tickers, not HURA-only)."""
from __future__ import annotations

import json
import os
import tempfile

import pytest

from prediction.financial_liquidity import (
    compute_liquidity_ratios,
    format_liquidity_display,
    is_plausible_current_ratio,
    liquidity_ratios_sane,
    load_liquidity_from_enrich_cache,
    parse_balance_sheet_values,
    sanitize_liquidity_payload,
)


def test_hura_like_total_assets_not_used_as_current_assets():
    """Total Assets / CL must not produce a trusted CR (~45); use Current Assets."""
    row_values = {
        "Total Assets": 263_000_000.0,
        "Current Assets": 4_600_000.0,
        "Total Current Liabilities": 5_900_000.0,
        "Inventory": 0.0,
    }
    out = parse_balance_sheet_values(row_values, fy_date="2025-12-31", ticker="HURA")
    assert out["current_ratio"] == pytest.approx(4_600_000 / 5_900_000, rel=1e-6)
    assert liquidity_ratios_sane(out)
    assert not out.get("liquidity_sanity_failed")


def test_wrong_row_only_total_assets_rejected():
    """If only aggregate lines exist, ratios are cleared and sanity fails."""
    row_values = {
        "Total Assets": 263_000_000.0,
        "Total Current Liabilities": 5_900_000.0,
    }
    out = parse_balance_sheet_values(row_values, ticker="BAD")
    assert out["current_ratio"] is None
    assert out["liquidity_score"] == 1.0
    assert not liquidity_ratios_sane(out)


def test_normal_cr_15_passes_sanity():
    out = compute_liquidity_ratios(
        current_assets=150.0,
        current_liabilities=100.0,
    )
    assert out["current_ratio"] == pytest.approx(1.5)
    assert liquidity_ratios_sane(out)
    assert is_plausible_current_ratio(1.5, current_assets=150.0, current_liabilities=100.0)


def test_insane_cr_45_crosscheck_mismatch_rejected():
    """Parser artifact CR≈45 must not match true CA/CL (~0.78)."""
    raw = {
        "current_ratio": 45.0,
        "quick_ratio": 45.0,
        "_current_assets": 4_600_000.0,
        "_current_liabilities": 5_900_000.0,
    }
    sane = sanitize_liquidity_payload(raw, ticker="HURA", source="test")
    assert sane["liquidity_sanity_failed"] is True
    assert sane["current_ratio"] is None
    assert sane["liquidity_score"] == 1.0


def test_aard_like_high_cr_accepted_score_capped():
    """Cash-rich biotech CR≈10.6 is valid liquidity, not a parse error."""
    raw = {
        "current_ratio": 10.61,
        "quick_ratio": 10.5,
        "_current_assets": 106.1,
        "_current_liabilities": 10.0,
    }
    sane = sanitize_liquidity_payload(raw, ticker="AARD", source="test")
    assert not sane["liquidity_sanity_failed"]
    assert sane["current_ratio"] == pytest.approx(10.61)
    assert sane["liquidity_score"] == 1.0


def test_curx_like_cr_81_accepted_with_crosscheck():
    """CR 50–100 accepted when CA/CL cross-check passes (optional soft-warn band)."""
    raw = {
        "current_ratio": 81.0,
        "quick_ratio": 80.0,
        "_current_assets": 810.0,
        "_current_liabilities": 10.0,
    }
    sane = sanitize_liquidity_payload(raw, ticker="CURX", source="test")
    assert not sane["liquidity_sanity_failed"]
    assert sane["current_ratio"] == pytest.approx(81.0)


def test_cr_above_100_hard_rejected():
    raw = {"current_ratio": 120.0, "_current_assets": 1200.0, "_current_liabilities": 10.0}
    sane = sanitize_liquidity_payload(raw, ticker="BAD", source="test")
    assert sane["liquidity_sanity_failed"] is True


def test_cache_only_cr_81_rejected_without_crosscheck():
    raw = {"current_ratio": 81.0, "quick_ratio": 80.0}
    sane = sanitize_liquidity_payload(raw, ticker="CURX", source="enrich_cache")
    assert sane["liquidity_sanity_failed"] is True


def test_format_display_high_cr():
    text = format_liquidity_display(current_ratio=10.61, quick_ratio=10.5)
    assert text == "CR 10.61 | QR 10.50"


def test_crosscheck_mismatch_rejected():
    raw = {
        "current_ratio": 1.5,
        "_current_assets": 200.0,
        "_current_liabilities": 100.0,
    }
    sane = sanitize_liquidity_payload(raw, ticker="X", source="test")
    assert sane["liquidity_sanity_failed"] is True


def test_format_display_sanity_failed():
    row = {"liquidity_sanity_failed": True, "current_ratio": 45.0}
    assert format_liquidity_display(row=row) == "N/D (sanity)"


def test_load_enrich_cache_rejects_insane_cr():
    with tempfile.TemporaryDirectory() as tmp:
        with open(os.path.join(tmp, "BAD.json"), "w", encoding="utf-8") as fh:
            json.dump({"current_ratio": 120.0, "fy_date": "2024-12-31"}, fh)
        assert load_liquidity_from_enrich_cache("BAD", cache_dir=tmp) is None


def test_load_enrich_cache_accepts_aard_like_cr():
    with tempfile.TemporaryDirectory() as tmp:
        with open(os.path.join(tmp, "AARD.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {"current_ratio": 10.61, "quick_ratio": 10.5, "fy_date": "2025-12-31"},
                fh,
            )
        loaded = load_liquidity_from_enrich_cache("AARD", cache_dir=tmp)
        assert loaded is not None
        assert loaded["current_ratio"] == pytest.approx(10.61)
