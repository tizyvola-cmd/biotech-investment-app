"""Phase 1 regulatory risk — keyword matching + clinical_pre_cd wiring."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.regulatory_risk_refresh import (
    _extract_from_clinical_pre_cd,
    _kw_match,
    PDUFA_KEYWORDS,
    FDA_APPROVAL_KEYWORDS,
    POSITIVE_CATALYST_KEYWORDS,
    CRL_KEYWORDS,
)


def test_kw_match_preserves_word_boundaries_for_padded_bla():
    """Padded ' bla ' must not fire on pre-BLA without submission context."""
    hits = _kw_match("Company advances pre-BLA manufacturing work", PDUFA_KEYWORDS)
    assert "bla" not in hits


def test_kw_match_bla_with_submission_context():
    hits = _kw_match("FDA accepted the BLA submission for review", PDUFA_KEYWORDS)
    assert "bla" in hits or "bla submission" in hits or "fda accepted" in hits


def test_kw_match_skips_foreign_fda_approval():
    hits = _kw_match(
        "Partner receives FDA approval in Japan for BCG indication",
        FDA_APPROVAL_KEYWORDS,
    )
    assert "fda approved" not in hits
    assert "fda approves" not in hits


def test_kw_match_catches_breakthrough_and_510k():
    pos = _kw_match("FDA grants Breakthrough Therapy designation", POSITIVE_CATALYST_KEYWORDS)
    assert any("breakthrough" in h for h in pos)
    appr = _kw_match("FDA 510(k) clearance for iLet system", FDA_APPROVAL_KEYWORDS)
    assert any("510" in h or "clearance" in h or "cleared" in h for h in appr)


def test_kw_match_ignores_complete_response_rate_as_crl():
    hits = _kw_match("ORR complete response rate of 42%", CRL_KEYWORDS)
    assert hits == []


def test_extract_clinical_pre_cd_designations(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    snap = {
        "updated_at": "2026-07-16T00:00:00+00:00",
        "records": [
            {
                "ticker": "AGIO",
                "ai": {"study_clinical_profile": {"fda_designation": "BreakthroughTherapy"}},
                "clinical_indicators": [],
                "clinical_events": [],
            },
            {
                "ticker": "BBNX",
                "ai": {},
                "clinical_indicators": [
                    {
                        "kpi_type": "regulatory",
                        "label": "FDA 510(k) clearance — iLet",
                        "value": "FDA cleared",
                        "indicator_date": "2026-01-01",
                    }
                ],
                "clinical_events": [],
            },
            {
                "ticker": "SKIP",
                "ai": {"study_clinical_profile": {"fda_designation": "N/D"}},
                "clinical_indicators": [
                    {"kpi_type": "regulatory", "label": "FDA designation", "value": "N/D"}
                ],
                "clinical_events": [],
            },
        ],
    }
    path = tmp_path / "clinical_pre_cd_enrichment_snapshot.json"
    path.write_text(json.dumps(snap), encoding="utf-8")
    monkeypatch.setattr(
        "scripts.regulatory_risk_refresh._CLINICAL_PRE_CD_SNAPSHOT",
        str(path),
    )

    out = _extract_from_clinical_pre_cd({"AGIO", "BBNX", "SKIP"})
    assert "AGIO" in out
    assert out["AGIO"]["positive"]["detected"] is True
    assert "BBNX" in out
    assert out["BBNX"]["approved"]["detected"] is True
    assert "SKIP" not in out
