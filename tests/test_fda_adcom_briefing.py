from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import fda_adcom_briefing as fab


ROW = {
    "id": "2026-07-30-REPL",
    "date": "2026-07-30",
    "ticker": "REPL",
    "company": "Replimune Group, Inc.",
    "product": "vusolimogene oderparepvec",
    "committee": "Cellular, Tissue, and Gene Therapies Advisory Committee",
    "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/example",
}


def test_briefing_window_starts_five_days_before():
    assert fab.in_briefing_window("2026-09-16", date(2026, 9, 11)) is True
    assert fab.in_briefing_window("2026-09-16", date(2026, 9, 14)) is True
    assert fab.in_briefing_window("2026-09-16", date(2026, 9, 16)) is True
    assert fab.in_briefing_window("2026-09-16", date(2026, 9, 6)) is False
    assert fab.in_briefing_window("2026-09-16", date(2026, 9, 21)) is False


def test_material_matches_company_and_product():
    title = "Cellular, Tissue, and Gene Therapies Advisory Committee July 30, 2026 Meeting Briefing Document- FDA"
    assert fab.material_matches_row(title, ROW) is True
    assert fab.material_matches_row("Unrelated PAC agenda", ROW) is False
    assert fab.material_matches_row("Briefing for vusolimogene oderparepvec", ROW) is True
    # Same date, wrong committee / company must not match
    assert (
        fab.material_matches_row(
            "Oncologic Drugs Advisory Committee July 30, 2026 Meeting Briefing Document- FDA",
            ROW,
        )
        is False
    )


def test_collect_candidates_do_not_fallback_to_unmatched(monkeypatch):
    monkeypatch.setattr(
        fab.fac,
        "_http_get",
        lambda url, timeout=25: (
            '<a href="/media/1/download">Unrelated PAC Briefing Document- FDA</a>'
            if "recently-updated" in url
            else ""
        ),
    )
    links = fab.collect_candidate_links(ROW)
    assert links == []


def test_collect_includes_briefing_pdf_hint(monkeypatch):
    monkeypatch.setattr(fab.fac, "_http_get", lambda *a, **k: "")
    row = {
        **ROW,
        "briefingPdfHint": "https://www.fda.gov/media/194910/download",
    }
    links = fab.collect_candidate_links(row)
    assert any(x["href"].endswith("/194910/download") for x in links)


def test_meeting_page_keeps_all_media_pdfs(monkeypatch):
    def fake_get(url, timeout=25):
        if "example" in url:
            return (
                '<a href="/media/999/download">Meeting materials package</a>'
                '<a href="/media/998/download">Unrelated PAC Briefing Document- FDA</a>'
            )
        return ""

    monkeypatch.setattr(fab.fac, "_http_get", fake_get)
    links = fab.collect_candidate_links(ROW)
    hrefs = {x["href"] for x in links}
    assert "https://www.fda.gov/media/999/download" in hrefs
    assert "https://www.fda.gov/media/998/download" in hrefs


def test_text_matches_row_company():
    assert fab.text_matches_row(
        "Replimune Group briefing for vusolimogene oderparepvec efficacy.",
        ROW,
    )
    assert not fab.text_matches_row("Totally unrelated oncology review.", ROW)


def test_pick_prefers_fda_briefing_over_sponsor():
    links = [
        {"href": "https://www.fda.gov/media/1/download", "title": "Meeting Briefing Document- Sponsor"},
        {"href": "https://www.fda.gov/media/2/download", "title": "Meeting Briefing Document- FDA"},
        {"href": "https://www.fda.gov/media/3/download", "title": "Draft Agenda"},
    ]
    picked = fab.pick_fda_briefing_pdf(links)
    assert picked is not None
    assert picked["href"].endswith("/2/download")


def test_heuristic_score_negative_on_crl_language():
    text = (
        "The studies do not provide evidence of effectiveness. "
        "A Complete Response Letter was issued. The application did not meet "
        "the primary endpoint and there is insufficient evidence."
    )
    assert fab.heuristic_fda_score(text) < 0


def test_heuristic_score_negative_on_faers_deaths():
    text = (
        "DPV reviewed U.S. serious FAERS reports and identified 94 reports; "
        "including 60 reports with the outcome of death. All reports were excluded "
        "from further discussion. DPV did not identify any new pediatric safety concerns "
        "and will continue routine pharmacovigilance."
    )
    score = fab.heuristic_fda_score(text)
    assert score <= -2.0
    assert fab.apply_safety_severity_to_score(3.0, text) <= -2.0


def test_heuristic_investor_insight_negative_on_deaths():
    insight = fab._heuristic_investor_insight(
        {
            "ticker": "AMGN",
            "company": "Amgen",
            "product": "Aranesp",
        },
        "identified 94 reports including 60 reports with the outcome of death. "
        "All reports were excluded. no new pediatric safety concerns.",
        {"conclusions": []},
    )
    assert "death" in insight.lower()
    assert "bearish" in insight.lower() or "negative" in insight.lower()


def test_condense_executive_not_full_dump():
    long_exec = ("Sentence one about FAERS. " * 40) + "Final conclusion stands."
    out = fab._condense_executive_summary(long_exec, limit=400)
    assert len(out) <= 420
    assert "Sentence one" in out


def test_scrub_intro_drops_toc():
    raw = (
        "This review evaluates FAERS reports for Product X in pediatric patients. "
        "TABLE OF CONTENTS Executive Summary ... 1 1 Introduction ... 2 "
        "EXECUTIVE SUMMARY This should be cut."
    )
    scrubbed = fab._scrub_section_prose(raw)
    assert "TABLE OF CONTENTS" not in scrubbed
    assert "EXECUTIVE SUMMARY" not in scrubbed
    assert "FAERS" in scrubbed


def test_extract_briefing_links_from_meeting_html():
    html = """
    <a href="/media/193878/download">Cellular, Tissue, and Gene Therapies Advisory Committee July 30, 2026 Meeting Briefing Document- FDA</a>
    <a href="/advisory-committees/advisory-committee-calendar">Calendar</a>
    """
    links = fab.extract_material_links(html)
    assert any("/media/193878/download" in x["href"] for x in links)


def test_preserve_briefings_on_calendar_merge():
    import fda_adcom_calendar as fac

    prev = [{"id": "2026-09-23-GRAL", "briefing": {"status": "ready", "score": 3.2}}]
    nxt = [{"id": "2026-09-23-GRAL", "date": "2026-09-23", "ticker": "GRAL"}]
    out = fac.preserve_briefings(nxt, prev)
    assert out[0]["briefing"]["score"] == 3.2
    assert "/media/" in str(out[0].get("briefingPdfHint") or "")


def test_build_card_without_ai(monkeypatch):
    monkeypatch.setattr(fab, "score_briefing_with_ai", lambda *a, **k: None)
    card = fab.build_briefing_card(
        "The trial met the primary endpoint with substantial evidence of effectiveness "
        "and a favorable benefit-risk. The briefing supports approval.",
        ROW,
        materials_url=fab.MATERIALS_URL,
        pdf_url="https://www.fda.gov/media/1/download",
        title="FDA Briefing",
    )
    assert card["status"] == "ready"
    assert card["score"] > 0
    assert card["pdfUrl"].endswith("/download")
    assert "resultsEn" in card
    assert "introductionEn" in card
    assert "investorInsightEn" in card
    assert "clinicalScore" in card
    assert isinstance(card.get("sectionSummariesEn"), list)
    assert any(s.get("heading") == "Introduction" for s in card["sectionSummariesEn"])


def test_heuristic_extract_metrics_from_table_text():
    text = """
    Table 2: PATHFINDER 2: Galleri Test Performance
    Galleri Cancer Signal Detected | PPV=77.0% (65.8%, 85.4%)
    Episode Sensitivity=35.0% (29.8%, 40.5%) | Specificity=99.85% (99.75%, 99.91%)
    CSO prediction accurately identified the location of the cancer in 94.3% of cases
    The false-positive rate was 0.15%.
    Galleri meets the criteria recommended by the 2023 panel with a favorable benefit-risk.
    """
    m = fab.heuristic_extract_metrics(text)
    joined = " ".join(m["results"] + m["statistics"])
    assert "35.0%" in joined
    assert "99.85%" in joined or "PPV" in joined
    assert m["conclusions"]

    card = {
        "summaryEn": "Galleri briefing posted.",
        "introductionEn": "FDA staff briefing for Galleri.",
        "resultsEn": ["Sensitivity 35%"],
        "statisticsEn": ["PPV 77%"],
        "conclusionsEn": ["Benefit-risk favorable"],
        "investorInsightEn": "Clinical package is supportive; stock reaction depends on panel.",
        "clinicalScore": 4.0,
    }
    blob = fab._compose_daily_news_long(card)
    assert "Introduction:" in blob
    assert "Results:" in blob
    assert "Statistics:" in blob
    assert "Conclusions:" in blob
    assert "35%" in blob
    brief = fab.card_to_daily_news_brief(ROW, {**card, "status": "ready", "pdfUrl": "https://x", "score": 4.0})
    assert brief["digest_method"] == "fda_briefing"
    assert brief["investor_insight"]
    assert brief["section_summaries"]
    assert brief["clinical_score"] is not None


def test_stage_fda_briefing_into_daily_news(monkeypatch):
    store: dict = {"items": [], "top_news": []}

    monkeypatch.setattr(fab, "_compose_daily_news_long", lambda card, it=False: "long body")

    def fake_read():
        return store

    def fake_write(doc):
        # doc may be the same object as store — copy before mutating
        payload = {k: (list(v) if isinstance(v, list) else v) for k, v in doc.items()}
        store.clear()
        store.update(payload)

    import daily_news_desk as dnd

    monkeypatch.setattr(dnd, "_read", fake_read)
    monkeypatch.setattr(dnd, "_write", fake_write)
    monkeypatch.setattr(dnd, "_is_article_seen", lambda *a, **k: False)
    monkeypatch.setattr(dnd, "_mark_row_seen", lambda *a, **k: None)
    monkeypatch.setattr(dnd, "persist_brief_cache", lambda *a, **k: None)
    monkeypatch.setattr(
        dnd,
        "_dimension_scores",
        lambda *a, **k: {"clinical_score": 2.0, "eis_score": 2.0},
    )
    monkeypatch.setattr(dnd, "_ten_word_summary", lambda t: t[:40])
    monkeypatch.setattr(dnd, "_now_iso", lambda: "2026-09-22T12:00:00")
    monkeypatch.setattr(dnd, "_article_fingerprint", lambda **k: "fp1")

    row = {
        "id": "2026-09-23-GRAL",
        "ticker": "GRAL",
        "company": "GRAIL, Inc.",
        "product": "Galleri",
        "date": "2026-09-23",
        "committee": "Molecular and Clinical Genetics Panel",
    }
    card = {
        "status": "ready",
        "score": 4.0,
        "clinicalScore": 4.0,
        "stance": "positive",
        "pdfUrl": "https://www.fda.gov/media/194910/download",
        "summaryEn": "Supportive briefing.",
        "introductionEn": "FDA staff package for Galleri.",
        "bulletsEn": ["PPV 77%"],
        "resultsEn": ["Sensitivity 35%"],
        "statisticsEn": ["Specificity 99.85%"],
        "conclusionsEn": ["Panel to vote"],
        "investorInsightEn": "Supportive clinical package; panel vote is the next catalyst.",
        "sectionSummariesEn": [
            {"heading": "Introduction", "summary": "FDA staff package."},
            {"heading": "Results", "summary": "• Sensitivity 35%"},
            {"heading": "Conclusions", "summary": "• Panel to vote"},
        ],
        "updated_at": "2026-09-22T10:00:00",
    }
    assert fab.stage_fda_briefing_into_daily_news(row, card) is True
    assert len(store["items"]) == 1
    assert store["items"][0]["source_kind"] == "fda_briefing"
    assert store["items"][0]["ticker"] == "GRAL"
    assert store["items"][0]["link"].endswith("/194910/download")
    assert store["items"][0]["investor_insight"]
    assert store["items"][0]["section_summaries"]
    # Idempotent
    assert fab.stage_fda_briefing_into_daily_news(row, card) is False


def test_should_run_briefing_hourly_while_due(monkeypatch):
    rome = ZoneInfo("Europe/Rome")
    monkeypatch.setattr(fab, "any_due_without_card", lambda today=None: True)
    now = datetime(2026, 9, 14, 8, 0, tzinfo=rome)
    assert fab.should_run_fda_adcom_briefing(now, last_run_at=None, at=time(7, 0))
    same_hour = datetime(2026, 9, 14, 8, 40, tzinfo=rome)
    assert not fab.should_run_fda_adcom_briefing(
        same_hour,
        last_run_at=now,
        at=time(7, 0),
    )
    next_hour = datetime(2026, 9, 14, 9, 5, tzinfo=rome)
    assert fab.should_run_fda_adcom_briefing(
        next_hour,
        last_run_at=now,
        at=time(7, 0),
    )
    # Legacy last_date still blocks same calendar day
    assert not fab.should_run_fda_adcom_briefing(
        now, last_date=date(2026, 9, 14), at=time(7, 0)
    )
    early = datetime(2026, 9, 14, 6, 10, tzinfo=rome)
    assert not fab.should_run_fda_adcom_briefing(early, last_run_at=None, at=time(7, 0))
