"""Headline/body guard: reject wrong same-ticker press fallbacks."""
from daily_news_desk import _body_matches_headline, _guess_publisher_urls_from_title


def test_body_match_rejects_wrong_biib_press():
    title = (
        "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment "
        "- simplywall.st"
    )
    wrong = (
        "Stoke Therapeutics and Biogen Present Long-Term Clinical Data that Support "
        "the Disease-Modifying Potential of Zorevunersen for the Treatment of Dravet "
        "Syndrome at the European Epilepsy Congress. " * 4
    )
    right = (
        "Biogen and Eisai received China NMPA approval for a self-administered "
        "subcutaneous LEQEMBI formulation for early Alzheimer's disease. "
        "China is the second country to clear the at-home weekly treatment. " * 3
    )
    assert _body_matches_headline(title, wrong) is False
    assert _body_matches_headline(title, right) is True
    assert _body_matches_headline(title, "") is False


def test_simplywall_url_guess_includes_alzheimer_path():
    title = (
        "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment "
        "- simplywall.st"
    )
    urls = _guess_publisher_urls_from_title(title)
    assert any(u.endswith("-alzheimer") for u in urls)
    assert any("nasdaq-biib/biogen/news/" in u for u in urls)


def test_simplywall_url_guess_truncates_slug_and_mid_title_company():
    """Simply Wall hard-cuts news slugs at 60 chars; company may sit mid-headline."""
    title = (
        "Did Updated Survival Data Just Shift Summit Therapeutics (SMMT) "
        "Investment Narrative? - simplywall.st"
    )
    urls = _guess_publisher_urls_from_title(title)
    expected = (
        "https://simplywall.st/stocks/us/pharmaceuticals-biotech/"
        "nasdaq-smmt/summit-therapeutics/news/"
        "did-updated-survival-data-just-shift-summit-therapeutics-smm"
    )
    assert expected in urls
    assert any(
        u.endswith(
            "did-updated-survival-data-just-shift-summit-therapeutics-smm"
        )
        for u in urls
    )
