"""Partnership / M&A deal economics on the Fin axis."""

from daily_news_desk import (
    _detect_news_kind,
    _extract_deal_financial_terms,
    _run_digest_questionnaire,
    _seed_financial_deal_evidence,
)


BBNX_TITLE = (
    "Beta Bionics Announces Partnership to Integrate iLet and mint AID Systems "
    "with Senseonics' Eversense 365 CGM"
)
BBNX_BODY = """
Beta Bionics is collaborating with Senseonics to combine automated insulin delivery
with year-long glucose sensing. The partnership aims to expand hardware compatibility
and capture greater market share by pairing the iLet Bionic Pancreas and mint systems
with Senseonics' 365-day CGM. Execution risk remains tied to hitting the
Q4 2026 commercialization timeline. No upfront cash consideration was disclosed.
"""


def test_partnership_detected_as_ma_kind():
    assert _detect_news_kind(BBNX_BODY, title=BBNX_TITLE) == "ma"


def test_extract_deal_terms_undisclosed_cash_with_milestones():
    terms = _extract_deal_financial_terms(title=BBNX_TITLE, body=BBNX_BODY)
    assert terms is not None
    assert terms["deal_type"] == "partnership"
    assert "not disclosed" in terms["paid"].lower()
    assert "integrate" in terms["for_what"].lower() or "iLet" in terms["for_what"]
    assert "Q4 2026" in terms["milestones"] or "commercial" in terms["milestones"].lower()
    assert "paid" in terms["summary"].lower()


def test_digest_questionnaire_fills_deal_economics():
    qa = _run_digest_questionnaire(title=BBNX_TITLE, body=BBNX_BODY, ticker="BBNX")
    assert qa["news_kind"] == "ma"
    assert isinstance(qa.get("deal_terms"), dict)
    answers = {a["id"]: a for a in qa["answers"] if isinstance(a, dict)}
    assert answers["deal_economics"]["present"] is True
    assert "not disclosed" in str(answers["deal_economics"]["answer"]).lower()
    assert answers["news_event_type"]["answer"] == "partnership"


def test_seed_financial_deal_evidence():
    terms = _extract_deal_financial_terms(title=BBNX_TITLE, body=BBNX_BODY)
    dims = _seed_financial_deal_evidence({"financial": {"unclassified": True}}, terms)
    fin = dims["financial"]
    assert fin["unclassified"] is False
    assert abs(float(fin["score"])) >= 0.01
    assert "paid" in str(fin["evidence"]).lower()


def test_ma_with_upfront_extracts_paid():
    title = "Acme licenses Widget to BigCo"
    body = (
        "Acme entered a licensing agreement with BigCo for Widget. "
        "Terms include a $40 million upfront payment and up to $200 million in "
        "development milestones, plus mid-single-digit royalties. "
        "The objective is to accelerate Phase 3 development worldwide."
    )
    terms = _extract_deal_financial_terms(title=title, body=body)
    assert terms is not None
    assert terms["deal_type"] == "licensing"
    assert "40" in terms["paid"]
    assert "milestone" in terms["paid"].lower() or "200" in terms["paid"]
