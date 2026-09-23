"""8-K extractive digest: real headline instead of the bare 'Item 7' decimal split."""

from daily_news_desk import _extractive_8k_points, _split_sentences

EIGHT_K = (
    "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 8-K "
    "Item 7.01 Regulation FD Disclosure. On September 10, 2026, NeOnc "
    "Technologies Holdings, Inc. issued a press release announcing that NEO100 "
    "received Rare Pediatric Disease designation from the FDA. The company also "
    "reaffirmed that topline data from the Phase 2 trial are expected in the "
    "fourth quarter of 2026. A copy of the press release is furnished as "
    "Exhibit 99.1. "
    "Item 8.01 Other Events. The Company announced the closing of a previously "
    "announced registered direct offering of common stock, raising gross "
    "proceeds of $12.0 million before expenses. The Company intends to use the "
    "net proceeds for clinical development of its lead candidate."
)


def test_title_is_not_the_item_number():
    points = _extractive_8k_points(EIGHT_K)
    assert points, "expected at least one 8-K finding"
    for p in points:
        assert p["title"].strip() not in {"Item 7", "Item 8", "Item 2"}
        assert not p["title"].startswith("Item ")


def test_each_item_section_becomes_its_own_finding():
    titles = [p["title"] for p in _extractive_8k_points(EIGHT_K)]
    assert any("Regulation FD Disclosure" in t for t in titles)
    assert any("Other Events" in t for t in titles)


def test_lede_boilerplate_dropped_from_title():
    fd = next(
        p
        for p in _extractive_8k_points(EIGHT_K)
        if "Regulation FD Disclosure" in p["title"]
    )
    assert "issued a press release" not in fd["title"]
    assert "NEO100" in fd["title"]


def test_sentence_split_survives_inc_and_decimals():
    sents = _split_sentences(
        "Acme Holdings, Inc. filed the report. Exhibit 99.1 is furnished herewith."
    )
    assert sents[0] == "Acme Holdings, Inc. filed the report."
    assert len(sents) == 2
