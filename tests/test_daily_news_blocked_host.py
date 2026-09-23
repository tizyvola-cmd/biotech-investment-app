"""Stocktwits / 403 walls must not leave Daily News briefs empty."""
from daily_news_desk import (
    _body_matches_headline,
    _build_investor_digest,
    _fetch_url_text_direct,
    _is_blocked_news_host,
    _publisher_host_from_title,
)


def test_extract_paywall_teaser_from_seeking_alpha_shell():
    from daily_news_desk import _extract_paywall_teaser_html

    html = """
    <html><head>
    <meta property="og:description" content="Beta Bionics (BBNX) is evolving into a multi-product diabetes franchise with FDA-cleared Mint launching in 1Q27."/>
    </head><body>
    <ul><li>Mint expands addressable market and accelerates pharmacy channel mix.</li>
    <li>A $150M equity raise funds Mint rollout amid near-term dilution.</li></ul>
    </body></html>
    """
    teaser = _extract_paywall_teaser_html(html)
    assert "multi-product" in teaser
    assert "Mint expands" in teaser
    assert "$150M" in teaser or "150M" in teaser


def test_extract_paywall_teaser_includes_rttnews_lede_paragraph():
    from daily_news_desk import _extract_paywall_teaser_html

    html = """
    <html><head>
    <meta property="og:description" content="For Summit Therapeutics Inc. (SMMT), the coming months could mark an important period as the company advances Ivonescimab."/>
    </head><body>
    <h1>Summit Therapeutics (SMMT): Time To Take A Look Ahead Of The FDA Decision</h1>
    <p>Ivonescimab is a PD-1/VEGF bispecific antibody discovered by Akeso. It combines two approaches in one drug: blocking PD-1 to activate the immune system and blocking VEGF to inhibit vessel growth.</p>
    <p>For comments and feedback contact: editorial@rttnews.com</p>
    </body></html>
    """
    teaser = _extract_paywall_teaser_html(html)
    assert "coming months" in teaser
    assert "PD-1/VEGF" in teaser
    assert "editorial@" not in teaser


def test_soft_wall_teaser_skips_title_search(monkeypatch):
    """Usable soft-wall body must not hang on Google/DDG title-search."""
    from daily_news_desk import _fetch_url_text

    soft = (
        "Summit Therapeutics (SMMT): Time To Take A Look Ahead Of The FDA Decision. "
        "For Summit Therapeutics Inc. (SMMT), the coming months could mark an important "
        "period as the company advances the clinical development of Ivonescimab."
    )
    assert len(soft) < 280

    monkeypatch.setattr(
        "daily_news_desk._fetch_url_text_direct",
        lambda *a, **k: (soft, None),
    )

    def boom(*a, **k):
        raise AssertionError("title_search must be skipped for soft-wall teaser")

    monkeypatch.setattr("daily_news_desk._fetch_article_via_title_search", boom)
    text, err = _fetch_url_text(
        "https://www.rttnews.com/3692585/summit.aspx",
        title_hint=(
            "Summit Therapeutics (SMMT): Time To Take A Look Ahead Of The FDA "
            "Decision - RTTNews"
        ),
        ticker_hint="SMMT",
        quick=False,
    )
    assert err is None
    assert "Ivonescimab" in text


def test_stocktwits_is_blocked_host():
    assert _is_blocked_news_host("stocktwits.com") is True
    assert _is_blocked_news_host("www.stocktwits.com") is True
    assert _is_blocked_news_host("seekingalpha.com") is True
    assert _is_blocked_news_host("reuters.com") is False


def test_publisher_maps_stocktwits_then_blocked():
    title = (
        "Dow, S&P 500, Nasdaq Futures Edge Higher After Fed Delivers Rate Hike: "
        "SPCX, CADL, SNAP, FLNC Stocks In Focus - Stocktwits"
    )
    assert _publisher_host_from_title(title) == "stocktwits.com"
    assert _is_blocked_news_host(_publisher_host_from_title(title) or "") is True


def test_fetch_direct_skips_stocktwits_without_http(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not GET a blocked publisher")

    monkeypatch.setattr("requests.get", boom)
    text, err = _fetch_url_text_direct(
        "https://stocktwits.com/news-articles/markets/equity/cadl-fed"
    )
    assert text == ""
    assert err == "blocked_publisher_host"


def test_thin_market_wrap_still_gets_paragraph_summaries(monkeypatch):
    monkeypatch.setattr(
        "daily_news_desk._run_digest_questionnaire",
        lambda **k: {
            "answers": [{"id": "news_event_type", "answer": "other"}],
            "has_summary": True,
            "has_bullet_summary": False,
            "headline": k.get("title"),
            "bullet_points": [],
        },
    )
    monkeypatch.setattr(
        "daily_news_desk._brief_from_digest_qa",
        lambda *_a, **k: {
            "detail_summary": (
                "US index futures firmed after the Fed hiked rates; "
                "CADL is listed among stocks in focus."
            ),
            "news_kind": "other",
            "digest_method": "qa_framework",
            "key_points": [],
            "key_results": [],
        },
    )
    monkeypatch.setattr(
        "daily_news_desk._gemini_news_paragraphs",
        lambda **k: [
            {
                "heading": "Fed hike, futures higher",
                "summary": (
                    "Dow, S&P 500 and Nasdaq futures rose after a 25 bp rate hike, "
                    "removing a long-standing policy overhang."
                ),
            },
            {
                "heading": "CADL among stocks in focus",
                "summary": (
                    "The wrap flags Candel Therapeutics (CADL) with SNAP, SPCX and "
                    "FLNC as pre-market names in focus, not a company-specific filing."
                ),
            },
        ],
    )
    title = (
        "Dow, S&P 500, Nasdaq Futures Edge Higher After Fed Delivers Rate Hike: "
        "SPCX, CADL, SNAP, FLNC Stocks In Focus - Stocktwits"
    )
    brief = _build_investor_digest(
        title=title,
        body=title,
        url="https://stocktwits.com/news-articles/markets/equity/cadl-fed",
        ticker="CADL",
        allow_ai=False,
    )
    secs = brief.get("section_summaries") or []
    assert len(secs) == 2
    assert "Fed hike" in (secs[0].get("heading") or "")
    assert "CADL" in (secs[1].get("summary") or "")


def test_fed_wrap_matches_reuters_syndicated_copy():
    title = (
        "Dow, S&P 500, Nasdaq Futures Edge Higher After Fed Delivers Rate Hike: "
        "SPCX, CADL, SNAP, FLNC Stocks In Focus - Stocktwits"
    )
    reuters = (
        "U.S. stock index futures surged on Thursday after the Federal Reserve "
        "raised interest rates. Dow E-minis were up 0.66%, S&P 500 E-minis rose "
        "0.74%, and Nasdaq 100 E-minis gained 0.96%. The central bank flagged "
        "that more hikes may be needed. " * 3
    )
    assert _body_matches_headline(title, reuters) is True
