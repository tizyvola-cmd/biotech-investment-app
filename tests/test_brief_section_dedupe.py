"""Brief sections must not repeat the same financing / clinical facts."""

from daily_news_desk import _dedupe_brief_sections, _heuristic_news_brief


CRDL_LEDE = (
    "Cardiol Therapeutics Inc. (NASDAQ: CRDL) (TSX: CRDL) today announced that, "
    "following a review by the Ontario Securities Commission, it has filed a "
    "US$150 Million Preliminary Base Shelf Prospectus. The Company also expects "
    "to file a corresponding registration statement on Form F-10 with the U.S. "
    "Securities and Exchange Commission."
)


def test_dedupe_drops_echo_key_points_and_results():
    brief = _dedupe_brief_sections(
        {
            "detail_summary": CRDL_LEDE,
            "news_kind": "financial",
            "key_results": [
                {
                    "label": "Key point 1",
                    "detail": (
                        "Cardiol Therapeutics Inc. (NASDAQ: CRDL) (TSX: CRDL) today "
                        "announced that, following a review by the Ontario Securities "
                        "Commission, it has filed a US$150 Million Preliminary Base "
                        "Shelf Prospectus."
                    ),
                },
                {
                    "label": "Key point 2",
                    "detail": (
                        "The Company also expects to file a corresponding registration "
                        "statement on Form F-10 with the U.S. Securities and Exchange "
                        "Commission."
                    ),
                },
                {
                    "label": "Key point 3",
                    "detail": (
                        "No securities are currently being offered and there is no "
                        "obligation to do so."
                    ),
                },
                {
                    "label": "Size",
                    "detail": "US$150 million",
                },
                {
                    "label": "Window",
                    "detail": "25-month",
                },
            ],
            "key_points": [
                "Size: US$150 million",
                "US$150 Million Preliminary Base Shelf Prospectus filed after OSC review.",
            ],
            "results": (
                "US$150 million shelf prospectus; 25-month window; no offering priced now; "
                "may cover common shares, debt, warrants."
            ),
        }
    )
    kept = brief["key_results"]
    labels = {(kr.get("label") or "").lower() for kr in kept}
    details = [(kr.get("detail") or "").lower() for kr in kept]
    assert "key point 1" not in labels
    assert "key point 2" not in labels
    assert "size" not in labels  # amount already in lede
    assert any("no securities are currently being offered" in d for d in details)
    # 25-month is unique vs this lede → keep
    assert "window" in labels
    assert brief["results"] is None
    assert not any(p.lower().startswith("size:") for p in brief["key_points"])


def test_heuristic_financing_brief_no_repeated_sections():
    body = (
        f"{CRDL_LEDE} No securities are being offered under the shelf prospectus "
        "at this time. The shelf provides for the issuance of common shares, debt "
        "securities, warrants, subscription receipts and units over a 25-month period "
        "for aggregate proceeds of up to US$150 million."
    )
    brief = _heuristic_news_brief(
        title="New 25-month shelf lets Cardiol Therapeutics (CRDL) line up future financing",
        summary="Cardiol files US$150M shelf prospectus",
        article_text=body,
        url="https://example.com/crdl-shelf",
        ticker="CRDL",
    )
    assert brief["news_kind"] == "financial"
    assert "150" in (brief.get("detail_summary") or "")
    # No Data/results block echoing the lede
    assert not brief.get("results")
    # Remaining key_results (if any) must not echo the lede prose
    for kr in brief.get("key_results") or []:
        det = (kr.get("detail") or "").lower()
        assert "ontario securities commission" not in det
        assert not (kr.get("label") or "").lower().startswith("key point")
