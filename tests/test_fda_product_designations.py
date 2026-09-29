"""Unit tests for fda_product_designations helpers (no network)."""

from fda_product_designations import designations_from_blob, normalize_ai_designation, _norm_product


def test_designations_from_blob():
    assert designations_from_blob("FDA granted Breakthrough Therapy and Fast Track") == [
        "Breakthrough Therapy",
        "Fast Track",
    ]


def test_normalize_ai_designation():
    assert normalize_ai_designation("BreakthroughTherapy") == "Breakthrough Therapy"
    assert normalize_ai_designation("orphan_drug") == "Orphan Drug"
    assert normalize_ai_designation("N/D") is None


def test_norm_product_skips_placebo():
    assert _norm_product("Placebo") == ""
    assert _norm_product("ET-400") == "ET-400"
