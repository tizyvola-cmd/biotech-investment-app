"""Daily News rows are first scored on title only — the body must upgrade them."""
from __future__ import annotations

from daily_news_desk import _rescore_row_from_body

_ZERO_ROW = {
    "clinical_score": 0.0,
    "financial_score": 0.0,
    "corporate_score": 0.0,
    "market_access_score": 0.0,
    "eis_score": 0.0,
}

_BODY = (
    "NeOnc Technologies today announced that NEO100 has received FDA Orphan Drug "
    "designation and Fast Track designation for recurrent glioma. The Phase 2 trial "
    "met the primary endpoint with statistical significance (p<0.01)."
)


def test_body_upgrades_sticky_zero_score():
    patch = _rescore_row_from_body(
        dict(_ZERO_ROW),
        title="Why NeOnc's Patent Portfolio Could Make NTHI More Than a One-Drug Biotech",
        body=_BODY,
    )
    assert patch["clinical_score"] > 0
    assert patch["eis_score"] > 0
    assert patch["scored_from"] == "article_body"
    assert patch["taxonomy_dimensions"]["clinical"]["event_id"]


def test_short_body_is_a_no_op():
    assert _rescore_row_from_body(dict(_ZERO_ROW), title="NTHI news", body="n/a") == {}


def test_never_weakens_an_existing_stronger_score():
    strong = {**_ZERO_ROW, "clinical_score": 3.0, "eis_score": 3.0}
    patch = _rescore_row_from_body(strong, title="NTHI", body=_BODY)
    assert "clinical_score" not in patch
    assert "eis_score" not in patch
