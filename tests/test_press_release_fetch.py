"""Press release RSS clinical filter."""
from press_release_fetch import _clinical_filter, press_releases_to_clinical_events


def test_clinical_filter_keeps_trial_headline():
    items = _clinical_filter(
        [
            {
                "title": "BNTX reports Phase 3 clinical trial results",
                "summary": "ORR improved in NSCLC",
                "event_date": "2025-06-01",
            },
            {"title": "BNTX Q2 earnings call scheduled", "summary": "investor relations", "event_date": "2025-06-02"},
        ],
        ticker="BNTX",
        company="BioNTech",
    )
    assert len(items) == 1
    assert "clinical" in items[0]["title"].lower()


def test_press_releases_to_events():
    evs = press_releases_to_clinical_events(
        [{"title": "Data at ASCO", "summary": "ORR 40%", "event_date": "2025-03-15", "link": "https://x"}],
        drug="DrugX",
    )
    assert evs[0]["source_type"] == "press_release"
    assert evs[0]["link_label"] == "Press"
