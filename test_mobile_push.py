"""Unit tests for mobile_push Soft SELL extraction and signatures (Soft BUY removed)."""
from __future__ import annotations

from mobile_push import (
    extract_soft_rec_sets,
    format_push_payload,
    signature_for_sets,
)


def test_extract_sell_only_ignores_buy_recommendations():
    buy, sell = extract_soft_rec_sets(
        {
            "recommendations": [
                {"ticker": "AAA", "action": "BUY"},
                {"ticker": "BBB", "action": "SELL"},
                {"ticker": "CCC", "action": "COMPRA"},
                {"ticker": "DDD", "action": "VENDI"},
                {"ticker": "EEE", "action": "HOLD"},
            ]
        }
    )
    assert buy == []
    assert sell == ["BBB", "DDD"]


def test_extract_prefers_soft_sells_list():
    buy, sell = extract_soft_rec_sets(
        {
            "softSells": [
                {"ticker": "SRPT", "key": "SRPT|x"},
                {"ticker": "TGTX", "key": "TGTX|y"},
            ],
            "recommendations": [
                {"ticker": "AAA", "action": "BUY"},
                {"ticker": "BBB", "action": "SELL"},
            ],
        }
    )
    assert buy == []
    assert sell == ["SRPT", "TGTX"]


def test_extract_empty_soft_sells_is_none_now():
    """Empty softSells = Home Suggested SELL empty — never fall back to recs."""
    buy, sell = extract_soft_rec_sets(
        {
            "softSells": [],
            "recommendations": [
                {"ticker": "MSLE", "action": "SELL"},
                {"ticker": "BBB", "action": "VENDI"},
            ],
        }
    )
    assert buy == []
    assert sell == []


def test_signature_sell_only():
    assert signature_for_sets(["A", "B"], ["Z"]) == "s:Z"


def test_format_payload_sell_only_never_mentions_buy():
    p = format_push_payload(["AAA"], ["BBB", "CCC"], lang="en")
    assert p["title"] == "Soft SELL · 2"
    assert "BUY" not in p["title"]
    assert "BUY" not in p["body"]
    assert p["sellTickers"] == ["BBB", "CCC"]
    assert p["buyTickers"] == []
