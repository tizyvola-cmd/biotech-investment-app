"""Numbers box: contextual bullets, not raw prose windows."""
from __future__ import annotations

from daily_news_desk import _extract_hard_numbers, _run_digest_questionnaire


def test_hard_numbers_partnership_patients_conference():
    body = (
        "The company announced a $50 million partnership with Acme Bio for the asset. "
        "The Phase 2 study has 270 patients enrolled to date. "
        "On 17 September 2026 management will present at the conference in Boston."
    )
    bullets = _extract_hard_numbers(body)
    joined = " | ".join(bullets).lower()
    assert any("50m" in b.lower() and "partnership" in b.lower() for b in bullets), bullets
    assert any("270" in b and "patient" in b.lower() for b in bullets), bullets
    assert any("17 september" in b.lower() and "conference" in b.lower() for b in bullets), bullets
    assert "hoc news" not in joined


def test_hard_numbers_skips_stock_tape():
    body = (
        "HOC NEWS At the close on September 18, 2026, Biogen stock finished at USD 215.50 "
        "on Nasdaq, down 1.62 percent, cited by 21st Century Business Herald."
    )
    bullets = _extract_hard_numbers(body)
    assert bullets == [], bullets


def test_hard_numbers_skips_market_wrap_peer_prices():
    body = (
        "Shares finished at $108.08, topping the session's most dramatic moves. "
        "Fastly (FSLY) rising 15% to $27.57, while Intel (INTC) climbed 13% to $147.69, "
        "rounding out a broadly bullish session for the technology sector. "
        "Parabilis Medicines (PBLS) shed 13% to $25.04."
    )
    bullets = _extract_hard_numbers(body)
    assert bullets == [], bullets


def test_hard_numbers_keeps_deal_sentence_as_key_point():
    body = (
        "Acme Bio announced a $50 million partnership with Zenith Labs to advance the Phase 2 asset. "
        "The collaboration includes milestones tied to regulatory filing."
    )
    bullets = _extract_hard_numbers(body)
    assert any("50m" in b.lower() and "partnership" in b.lower() for b in bullets), bullets


def test_hard_numbers_clinical_pct_and_n():
    body = "In the pivotal cohort (n=84), ORR was 45% with a manageable safety profile."
    bullets = _extract_hard_numbers(body)
    assert any(re_search_orr(b) for b in bullets), bullets
    assert any("n=84" in b.lower() for b in bullets), bullets


def re_search_orr(b: str) -> bool:
    return "ORR" in b.upper() and "45%" in b


def test_digest_questionnaire_hard_numbers_bullets():
    qa = _run_digest_questionnaire(
        title="Acme announces collaboration",
        body=(
            "Acme Bio signed a $50 million partnership with Zenith Labs. "
            "The trial has enrolled 270 patients. "
            "On 17 September 2026 data will be shared at the conference."
        ),
        ticker="ACME",
    )
    nums = qa.get("hard_numbers") or []
    assert isinstance(nums, list) and len(nums) >= 2
    assert all(len(x) < 220 for x in nums)
    # Must not dump multi-sentence prose windows.
    assert all("HOC NEWS" not in x for x in nums)
