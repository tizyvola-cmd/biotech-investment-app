"""Google News RSS shells must not be fetched or treated as publisher pages."""
from daily_news_desk import (
    _best_openable_news_url,
    _fetch_url_text,
    _is_google_news_shell_url,
)


GNEWS = "https://news.google.com/rss/articles/CBMiABCDEFGHIJKLMNOP"


def test_google_rss_article_is_shell():
    assert _is_google_news_shell_url(GNEWS)
    assert _is_google_news_shell_url(
        "https://news.google.com/_/DotsSplashUi/data/batchexecute"
    )
    assert not _is_google_news_shell_url(
        "https://www.ad-hoc-news.de/regeneron-stock-slips/123"
    )


def test_best_openable_prefers_publisher_article():
    href = _best_openable_news_url(
        {
            "link": GNEWS,
            "gnews_link": GNEWS,
            "source_url": "https://www.nature.com/articles/d41586-026-00001",
        }
    )
    assert href.startswith("https://www.nature.com/articles/")


def test_best_openable_skips_publisher_homepage_for_unwrap():
    href = _best_openable_news_url(
        {
            "link": GNEWS,
            "gnews_link": GNEWS,
            "source_url": "https://www.reuters.com",
        }
    )
    # Protobuf unwrap of a fake token fails → keep the Google URL for title-search.
    assert href.startswith("https://news.google.com/")


def test_fetch_url_text_never_gets_google_shell(monkeypatch):
    called: list[str] = []

    monkeypatch.setattr(
        "daily_news_desk._unwrap_google_news_url", lambda url, **_k: url
    )
    monkeypatch.setattr(
        "daily_news_desk._guess_publisher_urls_from_title", lambda _t: []
    )
    monkeypatch.setattr(
        "daily_news_desk._fetch_article_via_title_search",
        lambda *_a, **_k: ("", "no_search"),
    )
    monkeypatch.setattr(
        "daily_news_desk._fetch_url_text_direct",
        lambda url, **_k: called.append(url) or ("", "nope"),
    )

    text, err = _fetch_url_text(
        GNEWS, title_hint="Regeneron stock slips as lawsuits add overhang", quick=True
    )
    assert not called
    assert not text
    assert err
