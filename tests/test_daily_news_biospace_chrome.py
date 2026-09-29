"""BioSpace / publisher nav chrome must never become the News Brief title."""
from __future__ import annotations

from catalyst_extractor import _extract_html_page_title, _extract_text_from_html
from daily_news_desk import (
    _looks_like_nav_chrome,
    _recover_article_headline,
    _run_digest_questionnaire,
    _strip_article_chrome,
    _title_from_news_url_slug,
)


_BIOSPACE_HTML = """
<html><head>
<meta property="og:title" content="Cardiol Therapeutics Files US$150 Million Preliminary Base Shelf Prospectus Including Additional Disclosure Following Review by Staff of the Ontario Securities Commission - BioSpace" />
<title>Cardiol Therapeutics Files US$150 Million Preliminary Base Shelf Prospectus - BioSpace</title>
</head>
<body>
<header class="site-header">
  <button>SUBSCRIBE</button>
  <div class="menu">Menu</div>
  <button>Show Search</button>
  <form role="search"><label>Search Query</label><button>Submit Search</button></form>
</header>
<nav>News Podcasts Events Jobs Companies Hotbeds</nav>
<main>
  <p>Press Releases</p>
  <article>
    <h1>Cardiol Therapeutics Files US$150 Million Preliminary Base Shelf Prospectus Including Additional Disclosure Following Review by Staff of the Ontario Securities Commission</h1>
    <p>TORONTO, Sept. 10, 2026 /PRNewswire/ -- Cardiol Therapeutics Inc. (NASDAQ: CRDL) (TSX: CRDL)
    today announced that it has filed a preliminary short form base shelf prospectus with the
    securities regulatory authorities. The filing of the Shelf Prospectus does not obligate the
    Company to undertake an offering. Once effective, the filings will permit Cardiol to offer
    and sell securities having an aggregate initial offering price of up to US$150 million.</p>
  </article>
</main>
<footer>Advertise Talent Solutions Post Jobs</footer>
</body></html>
"""


def test_looks_like_nav_chrome_biospace():
    assert _looks_like_nav_chrome(
        "SUBSCRIBE Menu SUBSCRIBE Show Search Search Query Submit Search Press"
    )
    assert not _looks_like_nav_chrome(
        "Cardiol Therapeutics Files US$150 Million Preliminary Base Shelf Prospectus"
    )


def test_extract_html_page_title_biospace():
    title = _extract_html_page_title(_BIOSPACE_HTML)
    assert title is not None
    assert "Cardiol Therapeutics Files" in title
    assert "SUBSCRIBE" not in title.upper()


def test_extract_text_prefers_article_not_subscribe():
    text = _extract_text_from_html(_BIOSPACE_HTML)
    assert "Cardiol Therapeutics Files" in text or "US$150 million" in text or "CRDL" in text
    # Nav tokens may still appear if outside removed tags, but article body must dominate
    assert "Shelf Prospectus" in text or "150 million" in text.lower()


def test_strip_and_recover_headline_from_chrome_body():
    chrome_lead = (
        "SUBSCRIBE Menu SUBSCRIBE Show Search Search Query Submit Search Press Releases "
        "Cardiol Therapeutics Files US$150 Million Preliminary Base Shelf Prospectus "
        "Including Additional Disclosure. TORONTO, Sept. 10, 2026 /PRNewswire/ -- "
        "Cardiol Therapeutics Inc. (NASDAQ: CRDL) today announced that it has filed "
        "a preliminary short form base shelf prospectus for up to US$150 million."
    )
    cleaned = _strip_article_chrome(chrome_lead)
    assert not cleaned.upper().startswith("SUBSCRIBE")
    recovered = _recover_article_headline(
        chrome_lead,
        url=(
            "https://www.biospace.com/press-releases/"
            "cardiol-therapeutics-files-us-150-million-preliminary-base-shelf-prospectus-"
            "including-additional-disclosure-following-review-by-staff-of-the-ontario-"
            "securities-commission"
        ),
        title_hint="SUBSCRIBE Menu SUBSCRIBE Show Search Search Query Submit Search Press",
    )
    assert recovered is not None
    assert "Cardiol" in recovered or "shelf" in recovered.lower() or "150" in recovered
    assert not _looks_like_nav_chrome(recovered)


def test_digest_questionnaire_rejects_chrome_title():
    body = (
        "Cardiol Therapeutics Files US$150 Million Preliminary Base Shelf Prospectus. "
        "TORONTO, Sept. 10, 2026 /PRNewswire/ -- Cardiol Therapeutics Inc. (NASDAQ: CRDL) "
        "today announced that it has filed a preliminary short form base shelf prospectus. "
        "The filing does not obligate the Company to undertake an offering of up to US$150 million."
    )
    qa = _run_digest_questionnaire(
        title="SUBSCRIBE Menu SUBSCRIBE Show Search Search Query Submit Search Press",
        body=body,
        url=(
            "https://www.biospace.com/press-releases/"
            "cardiol-therapeutics-files-us-150-million-preliminary-base-shelf-prospectus"
        ),
        ticker="CRDL",
    )
    headline = str(qa.get("headline") or "")
    assert "SUBSCRIBE" not in headline.upper()
    assert "Cardiol" in headline or "150" in headline or "shelf" in headline.lower()


def test_title_from_biospace_url_slug():
    u = (
        "https://www.biospace.com/press-releases/"
        "cardiol-therapeutics-files-us-150-million-preliminary-base-shelf-prospectus-"
        "including-additional-disclosure-following-review-by-staff-of-the-ontario-"
        "securities-commission"
    )
    t = _title_from_news_url_slug(u)
    assert t is not None
    assert "Cardiol" in t
    assert "files" in t.lower()
    assert "shelf prospectus" in t.lower()


def test_recover_prefers_leading_h1_not_mid_body():
    body = (
        "Cardiol Therapeutics Files US$150 Million Preliminary Base Shelf Prospectus "
        "Including Additional Disclosure Following Review by Staff of the Ontario "
        "Securities Commission. Cardiol Therapeutics Inc. (NASDAQ: CRDL) today announced "
        "that it has filed a preliminary short form base shelf prospectus. Once effective, "
        "common shares, debt securities, warrants, subscription receipts, units, or any "
        "combination of such securities, having an aggregate initial offering price of up "
        "to US$150 million, or the equivalent in other currencies."
    )
    recovered = _recover_article_headline(
        body,
        url=(
            "https://www.biospace.com/press-releases/"
            "cardiol-therapeutics-files-us-150-million-preliminary-base-shelf-prospectus"
        ),
        title_hint="SUBSCRIBE Menu SUBSCRIBE Show Search Search Query Submit Search Press",
    )
    assert recovered is not None
    assert recovered.lower().startswith("cardiol therapeutics files")
    assert "common shares" not in recovered.lower()
