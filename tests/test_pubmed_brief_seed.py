"""PubMed URL → eutils AbstractText seed for Daily News / EIS briefs."""
from daily_news_desk import _pmid_from_url, _section_summaries_from_pubmed_hit


def test_pmid_from_pubmed_url():
    assert _pmid_from_url("https://pubmed.ncbi.nlm.nih.gov/41711722/") == "41711722"
    assert _pmid_from_url("https://www.pubmed.ncbi.nlm.nih.gov/41711722") == "41711722"
    assert _pmid_from_url("https://example.com/41711722") == ""


def test_section_summaries_from_structured_abstract():
    hit = {
        "abstract": (
            "INTRODUCTION: Background on myocarditis. "
            "METHODS: Randomized trial. "
            "RESULTS: Primary endpoint missed narrowly. "
            "CONCLUSION: Remodeling signals remain positive."
        ),
        "abstract_sections": {
            "introduction": "Background on myocarditis.",
            "methods": "Randomized trial.",
            "results": "Primary endpoint missed narrowly.",
            "conclusion": "Remodeling signals remain positive.",
        },
    }
    secs = _section_summaries_from_pubmed_hit(hit)
    headings = {s["heading"] for s in secs}
    assert "Introduction" in headings
    assert "Results" in headings
    assert "Discussion" in headings
    results = next(s for s in secs if s["heading"] == "Results")
    assert "endpoint" in results["summary"].lower()
