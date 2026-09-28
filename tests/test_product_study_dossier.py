"""Product study dossier helpers."""
from product_study_dossier import (
    _cap_words,
    _is_positive_stat,
    _mentions_product,
    _parse_pubmed_articles,
    _primary_secondary_oms,
    _product_needles,
)


def test_cap_words():
    assert _cap_words("one two three", 5) == "one two three"
    long = " ".join(f"w{i}" for i in range(60))
    out = _cap_words(long, 50)
    assert out is not None
    assert len(out.split()) == 50
    assert out.endswith("…")


def test_product_needles_and_mention():
    needles = _product_needles("litifilimab", ["BIIB059", "BIIB-059"])
    assert any("litifilimab" in n.lower() for n in needles)
    assert _mentions_product("Phase 2 litifilimab in CLE", needles)
    assert not _mentions_product("Natalizumab plus glatiramer in MS", needles)


def test_primary_secondary_only():
    oms = [
        {"type": "PRIMARY", "title": "IGA 0/1"},
        {"type": "SECONDARY", "title": "CLASI-70 W24"},
        {"type": "OTHER", "title": "CLASI-70 W52"},
        {"type": "SECONDARY", "title": "CLASI-70 W52 extra"},
    ]
    out = _primary_secondary_oms(oms)
    assert [r["title"] for r in out] == ["IGA 0/1", "CLASI-70 W24"]
    two_primary = [
        {"type": "PRIMARY", "title": "Part A joints"},
        {"type": "PRIMARY", "title": "Part B CLASI"},
        {"type": "SECONDARY", "title": "CLASI-50"},
    ]
    assert [r["title"] for r in _primary_secondary_oms(two_primary)] == [
        "Part A joints",
        "Part B CLASI",
    ]


def test_positive_p_value():
    assert _is_positive_stat(p_value="0.01", comment=None, values=None)
    assert _is_positive_stat(p_value="p<0.05", comment=None, values=None)
    assert _is_positive_stat(
        p_value=None, comment="statistically significant vs placebo", values=None
    )
    assert not _is_positive_stat(p_value="0.42", comment=None, values="12% vs 11%")


def test_pubmed_parse_doi_and_reference_links():
    xml = """
    <PubmedArticleSet>
      <PubmedArticle>
        <MedlineCitation>
          <PMID>41423415</PMID>
          <Article>
            <ArticleTitle>CHS-114: An Afucosylated Anti-CCR8 Antibody.</ArticleTitle>
            <Journal><Title>Molecular cancer therapeutics</Title>
              <JournalIssue><PubDate><Year>2026</Year></PubDate></JournalIssue>
            </Journal>
            <Abstract>
              <AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Intro sentence about the antibody.</AbstractText>
              <AbstractText Label="RESULTS" NlmCategory="RESULTS">ORR was 42 percent in the dose cohort.</AbstractText>
              <AbstractText Label="CONCLUSIONS" NlmCategory="CONCLUSIONS">CHS-114 warrants further study in solid tumors.</AbstractText>
            </Abstract>
            <AuthorList>
              <Author>
                <LastName>Smith</LastName>
                <AffiliationInfo><Affiliation>Coherus BioSciences, Redwood City, CA, USA.</Affiliation></AffiliationInfo>
              </Author>
            </AuthorList>
            <ELocationID EIdType="doi">10.1158/1535-7163.MCT-25-0001</ELocationID>
            <ReferenceList>
              <Reference>
                <Citation>Smith J et al. Prior CCR8 paper in mice.</Citation>
                <ArticleIdList>
                  <ArticleId IdType="pubmed">11111111</ArticleId>
                </ArticleIdList>
              </Reference>
            </ReferenceList>
          </Article>
        </MedlineCitation>
        <PubmedData>
          <ArticleIdList>
            <ArticleId IdType="pubmed">41423415</ArticleId>
            <ArticleId IdType="doi">10.1158/1535-7163.MCT-25-0001</ArticleId>
            <ArticleId IdType="pmc">PMC9990001</ArticleId>
          </ArticleIdList>
        </PubmedData>
      </PubmedArticle>
    </PubmedArticleSet>
    """
    papers = _parse_pubmed_articles(xml)
    assert len(papers) == 1
    p = papers[0]
    assert p["pmid"] == "41423415"
    assert p["url"] == "https://pubmed.ncbi.nlm.nih.gov/41423415/"
    assert p["doi"] == "10.1158/1535-7163.MCT-25-0001"
    assert p["doi_url"] == "https://doi.org/10.1158/1535-7163.MCT-25-0001"
    assert p["pmc_url"].endswith("PMC9990001/")
    assert "Intro sentence" in (p["abstract"] or "")
    assert p["introduction"]
    assert p["results"]
    assert p["discussion"]
    assert p["structured_abstract"] is True
    assert p.get("references") in (None, [])


def test_readout_explainer(monkeypatch):
    import json

    import ai_provider
    from product_study_dossier import _readout_explainer_ai

    card = {
        "nct_id": "NCT02879383",
        "title": "Duodenal Mucosal Resurfacing in Type 2 Diabetes",
        "conditions": "Diabetes Mellitus, Type 2",
        "phase": "PHASE2",
        "design": "Double-blind · Randomized",
        "enrollment": 109,
        "results_table": [
            {
                "endpoint": "Change From Baseline at 24 Weeks in HbA1c",
                "type": "PRIMARY",
                "time_frame": "Baseline and 24 weeks",
                "result": "DMR: -0.60 · Sham: -0.30",
                "statistic": None,
                "p_value": None,
            }
        ],
    }

    monkeypatch.setattr(ai_provider, "is_available", lambda: False)
    assert _readout_explainer_ai(card, product="Revita DMR") is None

    monkeypatch.setattr(ai_provider, "is_available", lambda: True)
    assert _readout_explainer_ai({"results_table": []}, product="Revita DMR") is None

    captured: dict[str, str] = {}

    def fake_call(prompt, **kwargs):
        captured["prompt"] = prompt
        return "```json\n" + json.dumps(
            {
                "what": "Average blood sugar over three months, in percentage points; lower is better.",
                "why": None,
                "impact": "A 0.3 point advantage over sham is below what metformin delivers.",
            }
        ) + "\n```"

    monkeypatch.setattr(ai_provider, "call_ai", fake_call)
    out = _readout_explainer_ai(card, product="Revita DMR")
    assert out is not None
    assert "blood sugar" in out["what"]
    assert "why" not in out
    assert "metformin" in out["impact"]
    assert "Diabetes Mellitus, Type 2" in captured["prompt"]
    assert "DMR: -0.60 · Sham: -0.30" in captured["prompt"]

    monkeypatch.setattr(ai_provider, "call_ai", lambda prompt, **kwargs: "not json")
    assert _readout_explainer_ai(card, product="Revita DMR") is None


def test_affiliation_match_and_pdf_placeholder(monkeypatch):
    import ai_provider
    from product_study_dossier import (
        _PDF_NOT_AVAILABLE,
        _affiliation_matches_company,
        _stamp_paper_affiliation,
        _summarize_paper_ai,
    )

    monkeypatch.setattr(ai_provider, "is_available", lambda: False)

    assert _affiliation_matches_company(
        ["Coherus BioSciences, Redwood City, CA"], "Coherus BioSciences Inc."
    )
    assert not _affiliation_matches_company(
        ["Stanford University, Palo Alto"], "Coherus BioSciences"
    )
    paper = {
        "title": "Drug X in MASLD",
        "abstract": "A single paragraph without BACKGROUND/RESULTS labels.",
        "affiliations": ["Harvard Medical School"],
        "structured_abstract": False,
        "full_text_available": False,
    }
    out = _summarize_paper_ai(paper, product="Drug X")
    assert out["abstract"]
    assert out["introduction"] == _PDF_NOT_AVAILABLE
    assert out["results"] == _PDF_NOT_AVAILABLE
    assert out["discussion"] == _PDF_NOT_AVAILABLE
    assert out.get("references") == []
    stamped = _stamp_paper_affiliation(out, "Coherus")
    assert stamped["company_affiliated"] is False

