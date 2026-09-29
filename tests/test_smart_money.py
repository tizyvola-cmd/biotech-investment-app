from datetime import date

from smart_money import (
    classify_13d_filings,
    classify_form4_rows,
    classify_options_snapshot,
    compose_smart_money_event,
)


def test_form4_cluster_ceo_buy():
    out = classify_form4_rows(
        [
            {
                "transactionDate": "2026-07-12",
                "transactionType": "P-Purchase",
                "typeOfOwner": "officer: Chief Executive Officer",
                "reportingName": "JANE DOE",
                "securitiesTransacted": 25000,
            }
        ],
        today=date(2026, 9, 5),
    )
    assert out["cluster"] is True
    assert out["lead_role"] == "CEO"
    assert out["event_date"] == "2026-07-12"


def test_form4_ignores_sales_and_old_prints():
    out = classify_form4_rows(
        [
            {
                "transactionDate": "2026-07-01",
                "transactionType": "S-Sale",
                "typeOfOwner": "officer: CEO",
                "acquisitionOrDisposition": "D",
            },
            {
                "transactionDate": "2025-01-01",
                "transactionType": "P-Purchase",
                "typeOfOwner": "officer: CMO",
            },
        ],
        today=date(2026, 9, 5),
    )
    assert out["cluster"] is False
    assert out["buy_count"] == 0


def test_compose_prefers_form4_over_13f():
    composed = compose_smart_money_event(
        form4={
            "cluster": True,
            "lead_role": "CMO",
            "buy_count": 2,
            "event_date": "2026-06-20",
        },
        inst={
            "inst_delta_pct": 15,
            "premium_fund_present": True,
            "premium_funds_list": ["Baker Bros Advisors"],
            "latest_quarter": "2026-03-31",
        },
        short={"days_to_cover": 8, "squeeze_setup": True},
    )
    assert composed["event"]["kind"] == "form4"
    assert composed["event"]["label"] == "CMO cluster bought shares"
    assert composed["event"]["date"] == "2026-06-20"
    assert composed["event"]["href_label"] == "SEC"
    kinds = [t["kind"] for t in composed["traces"]]
    assert kinds[0] == "form4"
    assert "13f" in kinds
    assert "short_cover" in kinds


def test_13d_recent_schedule():
    out = classify_13d_filings(
        [
            {"type": "SC 13D", "fillingDate": "2026-07-18"},
            {"formType": "10-K", "filingDate": "2026-08-01"},
            {"type": "13D/A", "acceptedDate": "2025-01-01"},
        ],
        today=date(2026, 9, 5),
    )
    assert out["hit"] is True
    assert out["form"] == "13D"
    assert out["event_date"] == "2026-07-18"


def test_options_call_skew_and_oi_growth():
    skew = classify_options_snapshot(
        [{"strike": 10, "openInterest": 100, "impliedVolatility": 0.55, "volume": 20}],
        [{"strike": 10, "openInterest": 90, "impliedVolatility": 0.40, "volume": 10}],
        spot=10.0,
        today=date(2026, 9, 5),
    )
    assert skew["hit"] is True
    assert skew["kind"] == "call_skew"
    assert skew["call_skew"] is not None and skew["call_skew"] >= 0.04

    grow = classify_options_snapshot(
        [{"strike": 8, "openInterest": 400, "impliedVolatility": 0.3, "volume": 50}],
        [{"strike": 8, "openInterest": 300, "impliedVolatility": 0.3, "volume": 40}],
        spot=8.0,
        prev_call_oi=200,
        today=date(2026, 9, 5),
    )
    assert grow["kind"] == "oi_growth"
    assert grow["oi_delta_pct"] == 100.0


def test_compose_13d_beats_13f_and_call_skew():
    composed = compose_smart_money_event(
        filing_13d={"hit": True, "form": "13D", "event_date": "2026-08-02"},
        inst={"inst_delta_pct": 12, "premium_fund_present": True, "latest_quarter": "2026-03-31"},
        options={"hit": True, "kind": "call_skew", "call_skew": 0.06, "event_date": "2026-09-05"},
        short={"days_to_cover": 7, "squeeze_setup": True},
    )
    assert composed["event"]["kind"] == "13d"
    assert composed["event"]["label"] == "New 13D beneficial owner"
    kinds = [t["kind"] for t in composed["traces"]]
    assert kinds[0] == "13d"
    assert "13f" in kinds
    assert "call_skew" in kinds
    assert "short_cover" in kinds
