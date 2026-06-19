"""PubMed pre-CD queries include outcome term filter."""

from pubmed_eutils_fetch import OUTCOME_TERMS, _outcome_filter_clause, _with_outcome_filter


def test_outcome_terms_non_empty():
    assert len(OUTCOME_TERMS) >= 5


def test_with_outcome_filter_appends_and_clause():
    base = '("DrugX"[Title/Abstract])'
    q = _with_outcome_filter(base)
    assert base in q
    assert "AND" in q
    for term in ('"overall response rate"', '"hazard ratio"'):
        assert term in q or term.replace('"', "") in q


def test_outcome_filter_clause_is_or_group():
    clause = _outcome_filter_clause()
    assert clause.startswith("(")
    assert " OR " in clause
