"""Brief product/indication must follow the headline, not another franchise."""

from daily_news_desk import _align_brief_to_headline, _extract_indication_from_title


TITLE = (
    "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment "
    "- simplywall.st"
)

WRONG_BODY = (
    "Long-term data for zorevunersen in Dravet syndrome from Phase 1/2a and the "
    "ongoing Phase 3 EMPEROR trial showed durable reductions in seizures."
)

ALIGNED_BODY = (
    "China's NMPA approved the subcutaneous LEQEMBI formulation for early "
    "Alzheimer's disease. Once-weekly at-home dosing expands access versus IV infusions."
)


def test_title_indication_alzheimer():
    assert _extract_indication_from_title(TITLE) == "Alzheimer's disease"


def test_align_drops_zorevunersen_on_alzheimer_headline():
    brief = {
        "product": "zorevunersen",
        "indication": "Dravet syndrome",
        "phase": "Phase III",
        "study": "EMPEROR",
        "detail_summary": WRONG_BODY,
        "key_points": [
            "zorevunersen Phase 3 EMPEROR Dravet long-term seizure data",
            "Stoke Therapeutics partnership",
        ],
    }
    out = _align_brief_to_headline(brief, TITLE, WRONG_BODY)
    assert out.get("product") in (None, "LEQEMBI")  # none from wrong body
    assert out.get("product") != "zorevunersen"
    assert out.get("indication") == "Alzheimer's disease"
    assert out.get("phase") in (None, "")
    assert out.get("study") in (None, "")
    assert all("zorevunersen" not in str(p).lower() for p in (out.get("key_points") or []))


def test_align_keeps_leqembi_from_matching_body():
    brief = {
        "product": "zorevunersen",
        "indication": "Dravet syndrome",
        "detail_summary": WRONG_BODY,
        "key_points": ["zorevunersen Dravet EMPEROR"],
    }
    out = _align_brief_to_headline(brief, TITLE, ALIGNED_BODY)
    assert out.get("indication") == "Alzheimer's disease"
    assert out.get("product") == "LEQEMBI"
    assert any("alzheimer" in str(p).lower() or "leqembi" in str(p).lower()
               or "china" in str(p).lower()
               for p in (out.get("key_points") or []))
