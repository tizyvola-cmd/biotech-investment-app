"""Title-only brief fallback must not invent bullet points from the headline."""

from daily_news_desk import _body_is_title_echo, _run_digest_questionnaire


TITLE = (
    "The Nose Knows: Why NeOnc's Patent Portfolio Could Make NTHI "
    "More Than a One-Drug Biotech - The Manila Times"
)


def test_title_echo_detected():
    assert _body_is_title_echo(TITLE, TITLE)
    assert _body_is_title_echo(TITLE, f"{TITLE}\n{TITLE}")
    assert not _body_is_title_echo(
        TITLE,
        f"{TITLE}\n\nNEO100 carries FDA Orphan Drug, Fast Track, and Rare Pediatric "
        "Disease designations. Phase 2 data are expected later this year.",
    )


def test_title_only_qa_does_not_echo_headline_as_bullets():
    qa = _run_digest_questionnaire(title=TITLE, body=TITLE, ticker="NTHI")
    assert qa["has_summary"] is False
    assert qa["has_bullet_summary"] is False
    assert qa["bullet_points"] == []
    take = qa["takeaway"]
    assert "could not be fetched" in take.lower() or "rate-limited" in take.lower()
    assert "Key points:" not in take


def test_takeaway_does_not_repeat_headline_plus_bullets():
    from daily_news_desk import _build_investor_takeaway, _filter_digest_bullets

    headline = (
        "Heart-drug developer Cardiol Therapeutics (CRDL) heads to a major "
        "New York investor conference"
    )
    raw_bullets = [
        "ing MAVERIC Phase III, ARCHER Phase II data, and CRD-38 pipeline candidate.",
        "Feb 10 ARCHER Phase II data 24h Move +1.9% Publication of ARCHER Phase II.",
        "MAVERIC Phase III surpassed 50% enrollment with plans for ~110 patients.",
    ]
    bullets = _filter_digest_bullets(raw_bullets, headline=headline)
    assert all("24h Move" not in b for b in bullets)
    assert not any(b.startswith("ing ") for b in bullets)
    take = _build_investor_takeaway(
        headline=headline,
        bullets=bullets,
        lede=(
            "Cardiol Therapeutics will present at the New York investor conference, "
            "highlighting CardiolRx programs MAVERIC and ARCHER plus CRD-38."
        ),
        kind="clinical",
        products=["CardiolRx", "CRD-38"],
        facts={"phase": "Phase III", "study": "MAVERIC"},
        speculative=False,
        title_only=False,
        ticker="CRDL",
    )
    assert "Key points:" not in take
    assert take.lower().startswith("cardiol therapeutics will present")
    assert take.count(headline[:40]) == 0
