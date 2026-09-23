"""Daily News migrate → EIS Deep Dive + guidance calendar / price plot dates."""

from __future__ import annotations

from daily_news_desk import (
    _extract_catalyst_dates_from_news,
    _hydrate_news_item_from_brief,
)


def test_extract_conference_dates_from_brief_fields():
    it = {
        "ticker": "CRDL",
        "title": "Cardiol Therapeutics to Participate in a Fireside Chat at the H.C. Wainwright Conference",
        "summary": "Short RSS blurb.",
        "detail_summary": (
            "Cardiol Therapeutics will join a fireside chat at the H.C. Wainwright "
            "28th Annual Global Investment Conference on September 15, 2026 in New York."
        ),
        "dates": [
            {
                "date": "September 15, 2026",
                "what_happens": "Fireside chat at H.C. Wainwright.",
            }
        ],
    }
    found = _extract_catalyst_dates_from_news(it)
    assert found, "expected at least one conference date"
    assert found[0]["window_start"] == "2026-09-15"
    assert found[0]["event_type"] == "conference"


def test_conference_title_not_polluted_by_clinical_brief():
    it = {
        "ticker": "CRDL",
        "title": "Heart-drug developer Cardiol Therapeutics (CRDL) heads to a major New York investor conference",
        "summary": "Stock Titan blurb",
        "detail_summary": (
            "Cardiol Therapeutics published Phase II MAvERIC study results for CardiolRx "
            "in recurrent pericarditis in the Journal of the American Heart Association."
        ),
        "event_date": "2026-09-09",
    }
    found = _extract_catalyst_dates_from_news(it)
    # No invented publish-day marker; wait for a real conference date
    assert found == []


def test_financing_without_date_skips_calendar():
    it = {
        "ticker": "CRDL",
        "title": "New 25-month shelf lets Cardiol line up future financing",
        "summary": "Filed a US$150 Million Preliminary Base Shelf Prospectus.",
    }
    assert _extract_catalyst_dates_from_news(it) == []


def test_hydrate_merges_brief_dates(monkeypatch, tmp_path):
    import daily_news_desk as desk

    doc = {
        "briefs": {
            "abc123": {
                "at": "2026-09-13T00:00:00+00:00",
                "brief": {
                    "dates": [
                        {
                            "date": "September 8-10, 2026",
                            "what_happens": "H.C. Wainwright conference window.",
                        }
                    ],
                    "detail_summary": (
                        "Cardiol will present at H.C. Wainwright September 8-10, 2026."
                    ),
                },
            }
        }
    }
    monkeypatch.setattr(desk, "_brief_cache_get", lambda fp, d=None: doc["briefs"]["abc123"]["brief"])
    row = {
        "ticker": "CRDL",
        "title": "Cardiol heads to New York investor conference",
        "article_fp": "abc123",
        "summary": "thin",
    }
    hydrated = _hydrate_news_item_from_brief(row, doc)
    assert hydrated["dates"]
    assert "Wainwright" in (hydrated.get("summary") or "") or hydrated["dates"]
    found = _extract_catalyst_dates_from_news(hydrated)
    assert any(d["window_start"] == "2026-09-08" for d in found)
