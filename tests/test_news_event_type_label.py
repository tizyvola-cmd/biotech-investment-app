"""news_event_type must show catalog labels, never the internal code ``ma``."""

from daily_news_desk import (
    _label_news_event_type,
    _normalize_digest_news_event_type,
    _run_digest_questionnaire,
)


def test_label_maps_internal_ma_code():
    assert _label_news_event_type(kind="ma", speculative=False) == "closed M&A"
    assert _label_news_event_type(kind="other", speculative=True) == "speculative M&A"
    assert _label_news_event_type(kind="financial") == "financing"
    assert _label_news_event_type(kind="clinical") == "clinical"
    assert _label_news_event_type(kind="other") == "other"


def test_normalize_rewrites_cached_ma_answers():
    answers = [
        {
            "id": "news_event_type",
            "answer": "ma",
            "present": True,
            "question_en": "What type of news is this?",
        }
    ]
    out = _normalize_digest_news_event_type(answers)
    assert out[0]["answer"] == "closed M&A"


def test_qa_extract_closed_acquisition_label():
    body = (
        "Vertex Pharmaceuticals completed its acquisition of Crinetics Pharmaceuticals "
        "on September 1, 2026, for approximately $10.0 billion in cash. "
        "The deal adds PALSONIFY (paltusotine) for acromegaly."
    )
    qa = _run_digest_questionnaire(
        title="Vertex completes Crinetics acquisition",
        body=body,
        ticker="VRTX",
        url="https://example.com/vrtx-deal",
    )
    ans = next(a for a in qa["answers"] if a["id"] == "news_event_type")
    assert ans["answer"] == "closed M&A"
    assert ans["answer"] != "ma"
