import time

from competition_landscape_lookup import (
    _fmt_mcap,
    _normalize_competitor,
    _normalize_landscape,
    _parse_usd,
    _same_product,
    lookup_competition_landscape,
)


def test_fmt_and_parse_mcap():
    assert _fmt_mcap(1.2e9, None) == "$1.2B"
    assert _fmt_mcap(None, "private") == "private"
    assert _parse_usd("$2.4B") == 2.4e9
    assert _parse_usd(850_000_000) == 850_000_000


def test_drops_focal_product_and_ticker():
    assert _same_product("iLet Bionic Pancreas", "iLet")
    dropped = _normalize_competitor(
        {"product": "iLet", "company": "Beta Bionics", "ticker": "BBNX"},
        focal_product="iLet",
        focal_ticker="BBNX",
    )
    assert dropped is None
    kept = _normalize_competitor(
        {
            "product": "Twiist",
            "company": "Sequel Med Tech",
            "ticker": None,
            "phase": "Approved / launch",
            "mechanism_of_action": "AID insulin pump algorithm.",
            "modality": "device",
            "value_proposition": "Tubed AID alternative to iLet.",
            "market_cap": "private",
        },
        focal_product="iLet",
        focal_ticker="BBNX",
    )
    assert kept is not None
    assert kept["product"] == "Twiist"
    assert kept["modality"] == "device"


def test_normalize_landscape_caps_and_indication():
    parsed = {
        "indication": "Type 1 diabetes",
        "standard_of_care": "AID pumps + MDI",
        "summary": "Crowded AID device space.",
        "competitors": [
            {
                "product": "Omnipod 5",
                "company": "Insulet",
                "ticker": "PODD",
                "market_cap_usd": 1.5e10,
                "phase": "Approved",
                "mechanism_of_action": "Tubeless AID.",
                "modality": "device",
                "value_proposition": "Patch pump convenience.",
            },
            {"product": "iLet", "company": "Beta Bionics", "ticker": "BBNX"},
        ],
    }
    out = _normalize_landscape(
        parsed, focal_product="iLet", focal_ticker="BBNX", indication_fallback=None
    )
    assert out["indication"] == "Type 1 diabetes"
    assert [c["product"] for c in out["competitors"]] == ["Omnipod 5"]
    assert out["competitors"][0]["market_cap"] == "$15.0B"


def test_drops_same_company_sibling_pipeline():
    from competition_landscape_lookup import _same_company

    assert _same_company("Structure Therapeutics Inc.", "Structure Therapeutics")
    dropped = _normalize_competitor(
        {
            "product": "ACCG-2671",
            "company": "Structure Therapeutics Inc.",
            "ticker": None,
            "phase": "Phase 1",
        },
        focal_product="aleniglipron",
        focal_ticker="GPCR",
        focal_company="Structure Therapeutics Inc.",
    )
    assert dropped is None
    kept = _normalize_competitor(
        {
            "product": "Orforglipron",
            "company": "Eli Lilly and Company",
            "ticker": "LLY",
            "phase": "Phase 3",
            "mechanism_of_action": "Oral GLP-1 RA",
            "modality": "small molecule",
            "value_proposition": "Oral convenience vs injectables",
            "market_cap": "$750B",
        },
        focal_product="aleniglipron",
        focal_ticker="GPCR",
        focal_company="Structure Therapeutics Inc.",
    )
    assert kept is not None
    assert kept["product"] == "Orforglipron"


def test_lookup_requires_ticker_or_context():
    assert lookup_competition_landscape(ticker="")["ok"] is False
    assert lookup_competition_landscape(ticker="BBNX")["ok"] is False
    err = lookup_competition_landscape(ticker="BBNX")["error"]
    assert "product_name or indication" in err


def test_warm_is_off_unless_enabled(monkeypatch):
    import competition_landscape_lookup as cl

    calls: list[int] = []
    monkeypatch.setattr(cl, "desk_competition_targets", lambda **_: calls.append(1) or [])
    monkeypatch.delenv("COMPETITION_WARM", raising=False)
    cl.warm_desk_competition()
    assert calls == []

    monkeypatch.setenv("COMPETITION_WARM", "1")
    cl.warm_desk_competition()
    for _ in range(100):
        if calls:
            break
        time.sleep(0.02)
    assert calls == [1]


def test_quota_error_starts_cooldown_and_next_call_fails_fast(monkeypatch):
    import competition_landscape_lookup as cl

    monkeypatch.setattr(cl, "_ddg_snippets", lambda *_a, **_k: [])
    monkeypatch.setattr(cl.ai_provider, "is_available", lambda: True)
    monkeypatch.setattr(cl.ai_provider, "get_api_key", lambda _p: "key")
    monkeypatch.setattr(cl.ai_provider, "friendly_error_message", lambda **_k: "quota esaurita")
    seen: list[str | None] = []

    def _fail(_provider, _prompt, **kwargs):
        seen.append(kwargs.get("model_override"))
        return None

    monkeypatch.setattr(cl.ai_provider, "_call_provider", _fail)
    cl._clear_ai_cooldown()
    try:
        first = cl.lookup_competition_landscape(ticker="BBNX", indication="Type 1 diabetes")
        assert first["error"] == "ai_empty"
        assert seen == ["gemini-flash-lite-latest"]

        second = cl.lookup_competition_landscape(ticker="GPCR", indication="Obesity")
        assert second["error"] == "ai_cooldown"
        assert second["retry_after_s"] > 0
        # No second provider round-trip while the cooldown holds.
        assert len(seen) == 1
    finally:
        cl._clear_ai_cooldown()
