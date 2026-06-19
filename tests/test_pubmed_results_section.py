"""PubMed structured abstract — Results section extraction."""
from pubmed_eutils_fetch import (
    _pick_results_text,
    _sections_from_abstract_parts,
    enrich_pubmed_hit,
)


def test_sections_from_labeled_abstract():
    parts = [
        ("BACKGROUND", "Patients with NSCLC."),
        ("RESULTS", "ORR was 42% (95% CI 31-54, n=48)."),
        ("CONCLUSIONS", "Promising activity."),
    ]
    sections = _sections_from_abstract_parts(parts)
    assert "results" in sections
    picked = _pick_results_text(sections, "")
    assert "42%" in picked


def test_enrich_hit_prioritizes_results_in_abstract_for_ai():
    hit = enrich_pubmed_hit(
        {
            "pmid": "12345",
            "title": "Phase 2 trial",
            "abstract": "Background text. Results: ORR 38%. Conclusions: good.",
            "abstract_sections": {},
            "results_section": "ORR 38%",
            "pub_year": "2024",
        }
    )
    assert "RESULTS" in hit.get("abstract_for_ai", "")
    assert "38%" in hit.get("abstract_for_ai", "")
