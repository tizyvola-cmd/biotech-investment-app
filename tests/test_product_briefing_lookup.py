from product_briefing_lookup import (
    _detect_device_product,
    _estimate_expiry,
    _merge_pipeline_hints,
    _normalize_briefing,
    _normalize_competitive_signal,
    _normalize_core_patents,
    _normalize_patent,
    _parse_ai_json,
    normalize_pipeline_overview,
)


def test_parse_ai_json_strips_fence():
    raw = '```json\n{"modality": "Cell therapy"}\n```'
    assert _parse_ai_json(raw) == {"modality": "Cell therapy"}


def test_normalize_briefing_keys():
    out = _normalize_briefing(
        {
            "modality": "Cell therapy",
            "mechanism_of_action": "Autologous cultured epidermal grafts.",
            "therapeutic_target": "COL7A1",
            "indication": "Dystrophic epidermolysis bullosa",
        }
    )
    assert out["modality"] == "Cell therapy"
    assert "Autologous" in out["mechanism_of_action"]
    assert out["therapeutic_target"] == "COL7A1"
    assert "epidermolysis" in out["indication"]


def test_normalize_briefing_drops_disease_as_target():
    out = _normalize_briefing(
        {
            "mechanism_of_action": "AAV gene therapy delivering FIX.",
            "therapeutic_target": "Hemophilia B",
            "indication": "Hemophilia B",
        }
    )
    assert out["therapeutic_target"] is None
    assert out["indication"] == "Hemophilia B"

def test_normalize_briefing_indication_prevalence_soc_phase34():
    out = _normalize_briefing(
        {
            "indication": "Plaque psoriasis",
            "usa_prevalence": "~7.5 million US adults",
            "standard_of_care": "Topicals; TNF/IL-17/IL-23 biologics",
            "phase_3_and_4_products": [
                {"product": "DrugX", "company": "Acme", "phase": "Phase 3"},
                "DrugY (Beta, Phase 4)",
            ],
        }
    )
    assert out["indication"] == "Plaque psoriasis"
    assert "7.5 million" in (out["usa_prevalence"] or "")
    assert "biologics" in (out["standard_of_care"] or "")
    assert "DrugX" in (out["phase_3_and_4_products"] or "")
    assert "Phase 3" in (out["phase_3_and_4_products"] or "")
    assert "DrugY" in (out["phase_3_and_4_products"] or "")


def test_estimate_expiry_from_filing_plus_20():
    expiry, years, method = _estimate_expiry(
        "2006-01-15", None, today=__import__("datetime").datetime(2026, 9, 16)
    )
    assert expiry == "2026-01-15"
    assert method == "20y_from_filing"
    assert years is not None and years < 0


def test_normalize_patent_published_loe():
    out = _normalize_patent(
        {
            "brand_name": "Tysabri",
            "generic_name": "natalizumab",
            "aliases": ["Antegren"],
            "filing_date": "1995-06-01",
            "expiry_date": "2028-06-01",
            "method": "published_loe",
            "notes": "Key US LOE around mid-2028.",
        }
    )
    assert out["product_kind"] == "drug"
    assert out["brand_name"] == "Tysabri"
    assert "natalizumab" in (out["generic_name"] or "").lower()
    assert out["expiry_date"] == "2028-06-01"
    assert out["years_remaining"] is not None
    assert out["core_patents"] == []
    assert out["competitive_signal"] is None


def test_detect_device_from_product_name():
    assert _detect_device_product(
        ticker="ZZZZ", product_name="Vascular closure device"
    )
    assert not _detect_device_product(
        ticker="ZZZZ", product_name="natalizumab IV infusion", product_kind="drug"
    )


def test_detect_device_from_medtech_ticker():
    assert _detect_device_product(ticker="HAE", product_name="Anything")


def test_normalize_device_patent_card():
    out = _normalize_patent(
        {
            "product_kind": "device",
            "brand_name": "VASCADE",
            "core_patents": [
                {
                    "patent_number": "US9123456",
                    "title": "Vascular closure apparatus",
                    "filing_date": "2010-01-01",
                    "expiry_date": "2030-01-01",
                }
            ],
            "competitive_signal": {
                "clearance_type": "510(k)",
                "product_code": "DXC",
                "clearance_id": "K123456",
                "decision_date": "1996-05-01",
                "applicant": "Acme Devices",
                "device_name": "Early closure system",
                "notes": "First same-code clearance.",
            },
            "notes": "Device IP context.",
        },
        device=True,
    )
    assert out["product_kind"] == "device"
    assert out["method"] == "device_ip"
    assert out["expiry_date"] is None
    assert len(out["core_patents"]) == 1
    assert out["core_patents"][0]["patent_number"] == "US9123456"
    assert out["competitive_signal"]["product_code"] == "DXC"
    assert out["competitive_signal"]["clearance_id"] == "K123456"


def test_normalize_patent_google_patents_family():
    out = _normalize_patent(
        {
            "product_kind": "drug",
            "brand_name": "fianlimab",
            "generic_name": "fianlimab",
            "aliases": ["REGN3767"],
            "core_patents": [
                {
                    "patent_number": "WO2025096478A1",
                    "title": "Stable antibody formulation comprising fianlimab",
                    "filing_date": "2024-10-29",
                    "expiry_date": "2026-04-30",
                    "url": "https://patents.google.com/patent/WO2025096478A1/en",
                },
                {
                    "patent_number": "US1234567B2",
                    "title": "Anti-LAG3 antibodies",
                    "filing_date": "2015-01-01",
                    "expiry_date": "2035-01-01",
                },
            ],
            "method": "google_patents_family",
        }
    )
    assert out["method"] == "google_patents_family"
    assert len(out["core_patents"]) == 2
    assert out["expiry_date"] == "2035-01-01"
    assert out["core_patents"][0]["url"]


def test_google_patents_detail_parses_anticipated_expiration(monkeypatch):
    from product_briefing_lookup import _google_patents_detail
    import urllib.request as ur

    html = """
    <html><head><title>WO2025096478A1 - Stable antibody formulation comprising fianlimab - Google Patents</title></head>
    <body>
    <time itemprop="date" datetime="2024-10-29">2024-10-29</time>
    <span>Application filed by Regeneron</span>
    <time itemprop="date" datetime="2026-04-30">2026-04-30</time>
    <span itemprop="title">Anticipated expiration</span>
    </body></html>
    """

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return html.encode("utf-8")

    monkeypatch.setattr(ur, "urlopen", lambda *_a, **_k: _Resp())
    detail = _google_patents_detail("WO2025096478A1")
    assert detail is not None
    assert detail["expiry_date"] == "2026-04-30"
    assert "fianlimab" in (detail.get("title") or "").lower()


def test_normalize_core_patents_and_signal_helpers():
    cores = _normalize_core_patents(["US1", {"patent_number": "US2", "title": "T"}])
    assert cores[0]["patent_number"] == "US1"
    assert cores[1]["title"] == "T"
    sig = _normalize_competitive_signal(
        {"clearance_type": "PMA", "product_code": "mdr", "k_number": "P990001"}
    )
    assert sig["product_code"] == "MDR"
    assert sig["clearance_id"] == "P990001"


def test_normalize_pipeline_overview_products():
    rows = normalize_pipeline_overview(
        {
            "products": [
                {
                    "name": "AXS-05",
                    "modality": "Small molecule",
                    "mechanism_of_action": "NMDA receptor antagonist + bupropion.",
                    "indication": "MDD",
                    "usa_prevalence": "~21 million US adults",
                    "phase": "Approved",
                    "lifecycle": "approved",
                    "patent_cliff": "US LOE ~2030",
                },
                {"name": "AXS-05", "phase": "Phase 3"},
                {
                    "name": "AXS-07",
                    "phase": "Phase 3",
                    "lifecycle": "development",
                    "indication": "Migraine",
                    "therapeutic_area": "Neurology / CNS",
                },
            ]
        }
    )
    assert len(rows) == 2
    assert rows[0]["name"] == "AXS-05"
    assert rows[0]["lifecycle"] == "approved"
    assert rows[0]["patent_cliff"] and "2030" in rows[0]["patent_cliff"]
    assert rows[0]["modality"] == "Small molecule"
    assert "NMDA" in (rows[0]["mechanism_of_action"] or "")
    assert "21 million" in (rows[0]["usa_prevalence"] or "")
    assert rows[1]["name"] == "AXS-07"
    assert rows[1]["lifecycle"] == "development"
    assert rows[1]["therapeutic_area"] == "Neurology / CNS"


def test_pipeline_cache_key_is_ticker_scoped():
    from product_briefing_lookup import _pipeline_cache_key

    a = _pipeline_cache_key("REGN", ["dupilumab", "cemiplimab"])
    b = _pipeline_cache_key("REGN", ["fianlimab"])
    c = _pipeline_cache_key("REGN", [])
    assert a == b == c
    assert a.startswith("REGN|")
    assert "|s5" in a


def test_merge_pipeline_hints_prefers_ai_then_feed():
    merged = _merge_pipeline_hints(
        [
            {
                "name": "Tagrisso",
                "phase": "Approved",
                "lifecycle": "approved",
                "modality": None,
                "mechanism_of_action": None,
                "indication": "NSCLC",
                "usa_prevalence": None,
                "patent_cliff": "2027",
            },
            {
                "name": "AXS-07",
                "phase": "Phase 3",
                "lifecycle": "development",
                "modality": None,
                "mechanism_of_action": None,
                "indication": "Migraine",
                "usa_prevalence": None,
                "patent_cliff": None,
            },
        ],
        ["Auvelity", "AXS-07"],
    )
    names = [r["name"] for r in merged]
    assert names[0] == "Tagrisso"
    assert "AXS-07" in names
    assert "Auvelity" in names
    assert names.index("AXS-07") < names.index("Auvelity") or "AXS-07" in names[:2]
