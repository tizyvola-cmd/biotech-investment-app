"""Press release RSS clinical filter."""
from press_release_fetch import (
    _clinical_filter,
    _rss_items,
    press_releases_to_clinical_events,
)


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


def test_rss_items_keep_published_clock_time():
    xml = (
        b'<?xml version="1.0"?><rss><channel>'
        b"<item>"
        b"<title>CRDL opens path to raise cash</title>"
        b"<link>https://example.com/a</link>"
        b"<pubDate>Wed, 16 Sep 2026 14:32:00 GMT</pubDate>"
        b"<description>ok</description>"
        b"</item>"
        b"</channel></rss>"
    )
    items = _rss_items(xml)
    assert items[0]["event_date"] == "2026-09-16"
    assert "T14:32" in str(items[0].get("published_at") or "")


def test_rss_items_prefer_article_not_google_shell():
    xml = (
        b'<?xml version="1.0"?><rss><channel><item>'
        b"<title>Regeneron stock slips on lawsuits</title>"
        b"<link>https://news.google.com/rss/articles/CBMiABCDEF</link>"
        b'<source url="https://www.ad-hoc-news.de/regeneron-stock-slips/123">'
        b"ad-hoc-news.de</source>"
        b"<description>ok</description>"
        b"</item></channel></rss>"
    )
    items = _rss_items(xml)
    assert items[0]["link"].startswith("https://www.ad-hoc-news.de/")
    assert "news.google.com" not in items[0]["link"]
    assert items[0]["gnews_link"].startswith("https://news.google.com/")


def test_rss_items_do_not_promote_publisher_homepage():
    xml = (
        b'<?xml version="1.0"?><rss><channel><item>'
        b"<title>Cardior Pharmaceuticals update</title>"
        b"<link>https://news.google.com/rss/articles/CBMiXYZ</link>"
        b'<source url="https://www.reuters.com">Reuters</source>'
        b"<description>ok</description>"
        b"</item></channel></rss>"
    )
    items = _rss_items(xml)
    assert items[0]["gnews_link"].startswith("https://news.google.com/")
    assert items[0]["link"].startswith("https://news.google.com/")
    assert not items[0]["source_url"]
