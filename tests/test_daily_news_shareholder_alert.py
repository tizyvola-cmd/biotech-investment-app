"""Shareholder-alert briefs must summarize from the headline when the page fetch fails."""
from daily_news_desk import (
    _build_shareholder_alert_brief,
    _detect_news_kind,
    _extract_product_from_title,
    _guess_publisher_urls_from_title,
    _is_junk_news_host,
    _is_shareholder_alert,
    _publisher_host_from_title,
    _shareholder_alert_firm,
)

TITLE = (
    "BBNX SHAREHOLDER ALERT: Bronstein, Gewirtz and Grossman, LLC Anno "
    "- The National Law Review"
)


def test_detects_shareholder_alert_from_headline():
    assert _is_shareholder_alert(TITLE)
    assert _detect_news_kind("", title=TITLE) == "litigation"


def test_lead_plaintiff_deadline_is_shareholder_alert():
    title = (
        "Kaplan Fox Continues to Remind Beta Bionics, Inc. (NASDAQ: BBNX) Investors "
        "of the Lead Plaintiff Deadline on November 3, 2026 - Barchart.com"
    )
    assert _is_shareholder_alert(title)
    brief = _build_shareholder_alert_brief(title=title, body="", url="", ticker="BBNX")
    assert brief.get("digest_method") == "shareholder_alert"
    assert "BBNX" in str(brief.get("detail_summary") or "")
    assert brief.get("news_kind") == "litigation"


def test_brief_daily_news_item_skips_fetch_for_lead_plaintiff():
    from daily_news_desk import brief_daily_news_item

    title = (
        "Kaplan Fox Continues to Remind Beta Bionics, Inc. (NASDAQ: BBNX) Investors "
        "of the Lead Plaintiff Deadline on November 3, 2026 - Barchart.com"
    )
    res = brief_daily_news_item(
        title=title,
        url="https://www.barchart.com/story/news/999/kaplan-fox-lead-plaintiff",
        ticker="BBNX",
    )
    assert res.get("ok") is True
    brief = res.get("brief") or {}
    assert brief.get("digest_method") == "shareholder_alert"
    assert len(str(brief.get("detail_summary") or "")) >= 80



def test_extracts_law_firm_from_headline():
    firm = _shareholder_alert_firm(TITLE)
    assert firm is not None
    assert "Bronstein" in firm
    assert "Grossman" in firm


def test_brief_has_readable_summary_without_article_body():
    brief = _build_shareholder_alert_brief(
        title=TITLE, body=TITLE, url="https://natlawreview.com/press-releases/x", ticker="BBNX"
    )
    detail = str(brief.get("detail_summary") or "")
    assert "shareholder" in detail.lower()
    assert "Bronstein" in detail
    assert "BBNX" in detail
    assert brief.get("news_kind") == "litigation"
    assert brief.get("product") is None
    assert brief.get("has_summary") is True
    assert any("solicitation" in str(p).lower() or "alert" in str(p).lower() for p in (brief.get("key_points") or []))


def test_does_not_treat_shareholder_as_a_drug():
    assert _extract_product_from_title(TITLE) is None


def test_junk_host_from_concatenated_headline():
    assert _is_junk_news_host(
        "www.bbnxshareholderalertbronsteingewirtzgrossmanllcanno.com", TITLE
    )
    assert _is_junk_news_host(
        "www.regeneronstockslipsasfianlimablibtayolawsuitsaddlegaloverhang.com",
        "Regeneron stock slips as Fianlimab-Libtayo lawsuits add legal overhang - ad-hoc-news.de",
    )
    assert not _is_junk_news_host("natlawreview.com", TITLE)
    assert not _is_junk_news_host("globenewswire.com", TITLE)
    assert not _is_junk_news_host("ad-hoc-news.de", "x")
    from daily_news_desk import _news_url_is_junk

    assert _news_url_is_junk(
        "https://www.regeneronstockslipsasfianlimablibtayolawsuitsaddlegaloverhang.com/news"
    )
    assert not _news_url_is_junk(
        "https://www.ad-hoc-news.de/boerse/news/corporate-news/regeneron-stock-slips"
    )


def test_regeneron_lawsuit_is_litigation_kind():
    from daily_news_desk import _detect_news_kind, _is_litigation_news

    title = (
        "Regeneron stock slips as Fianlimab-Libtayo lawsuits add legal overhang "
        "- ad-hoc-news.de"
    )
    assert _is_litigation_news(title)
    assert _detect_news_kind("", title=title) == "litigation"


def test_ad_hoc_news_maps_to_host_and_url():
    title = (
        "Regeneron stock slips as Fianlimab-Libtayo lawsuits add legal overhang "
        "- ad-hoc-news.de"
    )
    assert _publisher_host_from_title(title) == "ad-hoc-news.de"
    urls = _guess_publisher_urls_from_title(title)
    assert any("ad-hoc-news.de" in u for u in urls)


def test_cap_news_words_and_paragraphs():
    from daily_news_desk import _cap_news_words, _normalize_news_paragraphs

    long = " ".join(["word"] * 60)
    assert len(_cap_news_words(long, 50).split()) == 50
    rows = _normalize_news_paragraphs(
        [
            {
                "heading": "Legal overhang",
                "summary": "Lawsuits over Fianlimab-Libtayo weigh on Regeneron shares.",
            },
            {"heading": "Abstract", "summary": "Should be skipped as abstract."},
        ]
    )
    assert len(rows) == 1
    assert rows[0]["heading"] == "Legal overhang"


def test_national_law_review_maps_to_host_and_url():
    assert _publisher_host_from_title(TITLE) == "natlawreview.com"
    urls = _guess_publisher_urls_from_title(TITLE)
    assert any("natlawreview.com/press-releases/" in u for u in urls)
    assert not any("investingnews.com" in u for u in urls)
