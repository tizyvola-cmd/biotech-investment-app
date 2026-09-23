"""Unit tests for US product revenue normalizer."""

from us_product_revenue_lookup import (
    normalize_us_product_revenue,
    _parse_usd_m,
    _norm_line_of_therapy,
    _norm_therapeutic_area,
)


def test_parse_usd_m_variants():
    assert _parse_usd_m(1200) == 1200.0
    assert _parse_usd_m("1.2B") == 1200.0
    assert _parse_usd_m("$850M") == 850.0


def test_norm_line_of_therapy():
    assert _norm_line_of_therapy("1st line") == "1st line"
    assert _norm_line_of_therapy("second line") == "2nd line"
    assert _norm_line_of_therapy("3") == "3rd line"


def test_norm_therapeutic_area():
    assert _norm_therapeutic_area("oncology") == "Oncology"
    assert _norm_therapeutic_area(None, indication="EGFR NSCLC") == "Oncology"
    assert (
        _norm_therapeutic_area(None, indication="Type 2 diabetes mellitus / HF / CKD")
        == "Metabolic / endocrinology"
    )
    assert _norm_therapeutic_area(None, indication="Severe eosinophilic asthma") == "Respiratory"
    assert _norm_therapeutic_area("Immuno") == "Immunology / rheumatology"


def test_normalize_ranks_by_us_revenue():
    out = normalize_us_product_revenue(
        {
            "period": "Q3 2025",
            "period_half": "1H 2025",
            "period_year": "FY 2024",
            "period_type": "quarter",
            "products": [
                {
                    "name": "Farxiga",
                    "indication": "T2D / HF / CKD",
                    "mechanism_of_action": "SGLT2 inhibitor",
                    "protein_target": "SGLT2",
                    "modality": "small molecule",
                    "usa_prevalence": "~38M T2D",
                    "us_approval_year": 2014,
                    "patent_cliff": "US LOE ~2026",
                    "line_of_therapy": "1st line",
                    "us_revenue_q_usd_m": 722,
                    "us_revenue_h_usd_m": 1400,
                    "us_revenue_y_usd_m": 2800,
                },
                {
                    "name": "Tagrisso",
                    "indication": "EGFR NSCLC",
                    "therapeutic_area": "Oncology",
                    "moa_target": "EGFR TKI · EGFR",
                    "modality": "small molecule",
                    "usa_prevalence": "~20k new EGFR+ / yr",
                    "us_approval_year": "FDA approved 2015",
                    "patent_cliff": "US LOE ~2027",
                    "line_of_therapy": "1st line",
                    "us_revenue_q_usd_m": 1800,
                    "us_revenue_q_label": "$1.8B",
                    "us_revenue_h_usd_m": 3500,
                    "us_revenue_y_usd_m": 6500,
                },
                {
                    "name": "Enhertu",
                    "indication": "HER2+ / HER2-low breast",
                    "modality": "ADC",
                    "protein_target": "HER2",
                    "line_of_therapy": "2nd line",
                    "us_revenue_q_usd_m": 1100,
                },
                {
                    "name": "GhostBrand",
                    "indication": "COVID-19",
                    "modality": "vaccine",
                    "notes": "no US breakout",
                },
            ],
        }
    )
    assert out["market"] == "US"
    assert out["period"] == "Q3 2025"
    assert out["period_half"] == "1H 2025"
    assert out["period_year"] == "FY 2024"
    names = [p["name"] for p in out["products"]]
    assert names == ["Tagrisso", "Enhertu", "Farxiga"]
    assert "GhostBrand" not in names
    top = out["products"][0]
    assert top["us_revenue_q_label"] == "$1.8B"
    assert top["indication"] and "EGFR" in top["indication"]
    assert top["therapeutic_area"] == "Oncology"
    assert top["moa_target"] and "EGFR" in top["moa_target"]
    assert top["modality"] == "small molecule"
    assert top["usa_prevalence"] and "20k" in top["usa_prevalence"]
    assert top["us_approval_year"] == "2015"
    assert top["patent_cliff"] and "2027" in top["patent_cliff"]
    assert top["line_of_therapy"] == "1st line"
    assert top["us_revenue_h_usd_m"] == 3500
    assert top["us_revenue_y_usd_m"] == 6500
    farxiga = out["products"][2]
    # target "SGLT2" is already inside MoA — keep the longer MoA string
    assert farxiga["moa_target"] == "SGLT2 inhibitor"
    assert farxiga["modality"] == "small molecule"
    assert farxiga["therapeutic_area"] == "Metabolic / endocrinology"
    assert farxiga["us_approval_year"] == "2014"
    enhertu = out["products"][1]
    assert enhertu["moa_target"] == "HER2"
    assert enhertu["modality"] == "ADC"
    assert enhertu["therapeutic_area"] == "Oncology"


def test_norm_us_approval_year():
    from us_product_revenue_lookup import _norm_us_approval_year

    assert _norm_us_approval_year(2018) == "2018"
    assert _norm_us_approval_year("FDA approved 2023") == "2023"
    assert _norm_us_approval_year("2035") == "2035"
    assert _norm_us_approval_year(None) is None
    assert _norm_us_approval_year("n/a") is None
