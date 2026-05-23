"""Regression: HURA FY2025 Yahoo balance sheet → CR ~0.78, not ~45."""
from __future__ import annotations

import json
import os
import tempfile

import pytest

from prediction.financial_liquidity import (
    CR_SANITY_MAX,
    CR_SANITY_MIN,
    compute_liquidity_ratios,
    fetch_liquidity_yfinance,
    is_plausible_current_ratio,
    load_liquidity_from_enrich_cache,
    merge_liquidity_dict,
    parse_balance_sheet_values,
    parse_yfinance_balance_sheet,
    scan_enrich_cache_insane_ratios,
    sanitize_liquidity_payload,
)

# Yahoo Finance FY 2025 (values in thousands on statement; ratio is unitless).
HURA_CA = 4_621_136
HURA_CL = 5_919_282
HURA_CASH = 3_619_876
HURA_CR_EXPECTED = HURA_CA / HURA_CL  # ~0.7807


def _hura_yahoo_rows() -> dict[str, float]:
    return {
        "Current Assets": float(HURA_CA),
        "Current Liabilities": float(HURA_CL),
        "Cash And Cash Equivalents": float(HURA_CASH),
        "Inventory": 0.0,
        # Bare aggregate line that previously matched via ``nl in pat``:
        "Assets": 263_000_000.0,
        "Total Assets": 263_000_000.0,
    }


def test_hura_fy2025_current_ratio_from_balance_sheet():
    out = parse_balance_sheet_values(
        _hura_yahoo_rows(),
        fy_date="2025-12-31",
        ticker="HURA",
    )
    assert out["current_ratio"] == pytest.approx(HURA_CR_EXPECTED, rel=1e-5)
    assert is_plausible_current_ratio(out["current_ratio"])
    assert out["current_ratio"] >= CR_SANITY_MIN
    assert out["liquidity_score"] < 1.0


def test_bare_assets_row_does_not_inflate_current_ratio():
    wrong_only = {
        "Assets": 263_000_000.0,
        "Current Liabilities": float(HURA_CL),
    }
    out = parse_balance_sheet_values(wrong_only, fy_date="2025-12-31", ticker="X")
    assert out["current_ratio"] is None
    assert out["liquidity_score"] == 1.0


def test_sanitize_rejects_cr_near_45_when_crosscheck_fails():
    bad = sanitize_liquidity_payload(
        {
            "current_ratio": 44.9,
            "quick_ratio": 44.9,
            "fy_date": "2025-12-31",
            "_current_assets": float(HURA_CA),
            "_current_liabilities": float(HURA_CL),
        },
        ticker="HURA",
        source="test",
    )
    assert bad["current_ratio"] is None
    assert bad["liquidity_score"] == 1.0


def test_sanitize_high_but_valid_cr_keeps_ratio_neutral_score():
    out = sanitize_liquidity_payload(
        {"current_ratio": 8.0, "quick_ratio": 8.0, "fy_date": "2025-12-31"},
        ticker="TST",
        source="test",
    )
    assert out["current_ratio"] == 8.0
    assert out["liquidity_score"] == 1.0


def test_merge_liquidity_dict_skips_insane_cache_values():
    target = {"beta": 0.9, "companyName": "TuHURA"}
    merge_liquidity_dict(
        target,
        {"current_ratio": 45.0, "quick_ratio": 45.0, "liquidity_fy_date": "2025-12-31"},
    )
    assert "current_ratio" not in target


def test_load_enrich_cache_rejects_insane_stored_cr():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "HURA.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"current_ratio": 105.0, "fy_date": "2025-12-31"}, fh)
        assert load_liquidity_from_enrich_cache("HURA", cache_dir=tmp) is None


def test_load_enrich_cache_accepts_hura_like_cr():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "HURA.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "current_ratio": HURA_CR_EXPECTED,
                    "quick_ratio": HURA_CR_EXPECTED,
                    "cash_ratio": HURA_CASH / HURA_CL,
                    "fy_date": "2025-12-31",
                },
                fh,
            )
        loaded = load_liquidity_from_enrich_cache("HURA", cache_dir=tmp)
        assert loaded is not None
        assert loaded["current_ratio"] == pytest.approx(HURA_CR_EXPECTED, rel=1e-5)


class _FakeSeries:
    def __init__(self, data: dict) -> None:
        self._data = data

    @property
    def index(self):
        return list(self._data.keys())

    def loc(self, key):
        return self._data[key]


class _FakeBalanceSheet:
    empty = False
    columns = [type("Col", (), {"strftime": lambda self, fmt: "2025-12-31"})()]

    def __getitem__(self, _col):
        return _FakeSeries(_hura_yahoo_rows())


def test_parse_yfinance_balance_sheet_hura_mock():
    out = parse_yfinance_balance_sheet(_FakeBalanceSheet(), ticker="HURA")
    assert out["current_ratio"] == pytest.approx(HURA_CR_EXPECTED, rel=1e-5)


def test_compute_liquidity_ratios_hura_line_items():
    out = compute_liquidity_ratios(
        current_assets=float(HURA_CA),
        current_liabilities=float(HURA_CL),
        cash=float(HURA_CASH),
    )
    assert out["current_ratio"] == pytest.approx(HURA_CR_EXPECTED, rel=1e-5)


@pytest.mark.integration
def test_fetch_liquidity_yfinance_hura_live():
    out = fetch_liquidity_yfinance("HURA")
    cr = out.get("current_ratio")
    if cr is None:
        pytest.skip("yfinance balance sheet unavailable in this environment")
    assert is_plausible_current_ratio(cr)
    assert cr == pytest.approx(HURA_CR_EXPECTED, rel=0.15)


def test_scan_enrich_cache_flags_hard_insane_cr():
    """Cache entries with CR > 100 (or < min) are flagged for revalidation."""
    from prediction.financial_liquidity import cr_hard_reject_above

    root = os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, "data", "enrich_cache")
    root = os.path.normpath(root)
    if not os.path.isdir(root):
        pytest.skip("enrich_cache not present")
    bad = scan_enrich_cache_insane_ratios(root)
    hard = cr_hard_reject_above()
    for sym, cr in bad[:5]:
        assert cr > hard or cr < CR_SANITY_MIN
