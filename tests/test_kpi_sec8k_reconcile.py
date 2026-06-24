"""KPI timeline must not show K-8 badge without a matching SEC filing date."""
from clinical_pre_cd_enrichment import _reconcile_kpi_sec8k_against_filings


def test_kpi_sec8k_without_filing_becomes_press():
    clinical = [
        {
            "event_date": "2026-05-01",
            "source_type": "sec_8k",
            "_from_kpi_timeline": True,
            "event_title": "Q1 2026 financial results",
        }
    ]
    sec = [
        {
            "event_date": "2026-05-12",
            "source_type": "sec_8k",
            "sec_filing_verified": True,
            "link": "https://www.sec.gov/example",
        }
    ]
    out = _reconcile_kpi_sec8k_against_filings(clinical, sec)
    assert out[0]["source_type"] == "press_release"


def test_kpi_sec8k_snaps_to_near_filing():
    clinical = [
        {
            "event_date": "2026-05-11",
            "source_type": "sec_8k",
            "_from_kpi_timeline": True,
            "event_title": "Earnings",
        }
    ]
    sec = [
        {
            "event_date": "2026-05-12",
            "source_type": "sec_8k",
            "sec_filing_verified": True,
            "link": "https://www.sec.gov/8k",
            "price": {"p_t0": 1.0, "delta_p_1d": 5.0},
            "eis": {"score": 4.5},
        }
    ]
    out = _reconcile_kpi_sec8k_against_filings(clinical, sec)
    assert out[0]["event_date"] == "2026-05-12"
    assert out[0].get("sec_filing_verified") is True
    assert out[0]["link"] == "https://www.sec.gov/8k"
