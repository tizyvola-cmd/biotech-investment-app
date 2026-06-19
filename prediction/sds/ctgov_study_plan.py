"""
ClinicalTrials.gov study plan fields for SDS Cluster A.

Uses CT.gov API v2 (same JSON as the public study plan page), e.g.:
https://clinicaltrials.gov/study/NCT04187560#study-plan
"""
from __future__ import annotations

import json
import time
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

_CTGov_STUDY_URL = "https://clinicaltrials.gov/api/v2/studies/{nct_id}"
_SLEEP_S = 0.35


def normalize_nct_id(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        text = str(raw.get("text") or raw.get("nct_id") or "").strip().upper()
    else:
        text = str(raw).strip().upper()
    if not text.startswith("NCT"):
        return None
    return text


def nct_from_sim_row(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None
    for key in ("NCT", "nct_id", "NCT ID", "NctId"):
        n = normalize_nct_id(row.get(key))
        if n:
            return n
    return None


def fetch_ctgov_study(nct_id: str, *, timeout: float = 20.0) -> dict[str, Any] | None:
    nct = normalize_nct_id(nct_id)
    if not nct:
        return None
    url = _CTGov_STUDY_URL.format(nct_id=nct)
    try:
        req = Request(url, headers={"User-Agent": "SuperNova-SDS/1.0", "Accept": "application/json"})
        with urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return payload if isinstance(payload, dict) else None
    except (URLError, OSError, json.JSONDecodeError, TimeoutError):
        return None
    finally:
        time.sleep(_SLEEP_S)


def _outcome_measures_list(outcomes: list[dict[str, Any]] | None) -> list[str]:
    if not outcomes:
        return []
    parts: list[str] = []
    for om in outcomes:
        if not isinstance(om, dict):
            continue
        measure = str(om.get("measure") or om.get("title") or "").strip()
        if measure:
            parts.append(measure)
    return parts


def _join_outcome_measures(outcomes: list[dict[str, Any]] | None, *, limit: int = 3) -> str | None:
    parts = _outcome_measures_list(outcomes)
    if not parts:
        return None
    return " | ".join(parts[:limit])


def _has_placebo(study: dict[str, Any]) -> bool:
    protocol = study.get("protocolSection") if isinstance(study.get("protocolSection"), dict) else {}
    arms = protocol.get("armsInterventionsModule") if isinstance(protocol.get("armsInterventionsModule"), dict) else {}
    for arm in arms.get("armGroups") or []:
        if not isinstance(arm, dict):
            continue
        label = str(arm.get("label") or arm.get("description") or "").lower()
        if "placebo" in label:
            return True
    for inter in arms.get("interventions") or []:
        if not isinstance(inter, dict):
            continue
        name = str(inter.get("name") or inter.get("description") or "").lower()
        if "placebo" in name:
            return True
    return False


def trial_design_from_study(study: dict[str, Any] | None) -> str | None:
    if not study:
        return None
    protocol = study.get("protocolSection") if isinstance(study.get("protocolSection"), dict) else {}
    design = protocol.get("designModule") if isinstance(protocol.get("designModule"), dict) else {}
    info = design.get("designInfo") if isinstance(design.get("designInfo"), dict) else {}
    tags: list[str] = []

    alloc = str(info.get("allocation") or "").replace("_", " ").lower()
    if "random" in alloc:
        tags.append("randomized")

    masking = info.get("maskingInfo") if isinstance(info.get("maskingInfo"), dict) else {}
    mask = str(masking.get("masking") or "").replace("_", " ").lower()
    if mask and mask not in ("none", "unknown"):
        tags.append(mask)

    model = str(info.get("interventionModel") or "").replace("_", " ").lower()
    if model:
        tags.append(model)

    if _has_placebo(study):
        tags.append("placebo-controlled")

    return " ".join(tags) if tags else None


def extract_study_plan_fields(study: dict[str, Any] | None) -> dict[str, Any]:
    """
    Pull Cluster A fields from CT.gov protocol (study plan).

    Returns primary_outcome, secondary_outcomes, trial_design, phase, conditions, …
    """
    out: dict[str, Any] = {
        "primary_outcome": None,
        "primary_outcomes": [],
        "secondary_outcomes": None,
        "study_description": None,
        "trial_design": None,
        "phase": None,
        "conditions": None,
        "interventions": None,
        "brief_title": None,
        "overall_status": None,
        "source": "ctgov_v2_study_plan",
    }
    if not study:
        out["error"] = "empty_study"
        return out

    protocol = study.get("protocolSection") if isinstance(study.get("protocolSection"), dict) else {}
    ident = protocol.get("identificationModule") if isinstance(protocol.get("identificationModule"), dict) else {}
    status = protocol.get("statusModule") if isinstance(protocol.get("statusModule"), dict) else {}
    conditions_mod = protocol.get("conditionsModule") if isinstance(protocol.get("conditionsModule"), dict) else {}
    arms = protocol.get("armsInterventionsModule") if isinstance(protocol.get("armsInterventionsModule"), dict) else {}
    design = protocol.get("designModule") if isinstance(protocol.get("designModule"), dict) else {}
    outcomes = protocol.get("outcomesModule") if isinstance(protocol.get("outcomesModule"), dict) else {}
    desc_mod = protocol.get("descriptionModule") if isinstance(protocol.get("descriptionModule"), dict) else {}

    out["nct_id"] = ident.get("nctId")
    out["brief_title"] = str(ident.get("briefTitle") or "").strip() or None
    out["overall_status"] = str(status.get("overallStatus") or "").strip() or None
    primary_list = _outcome_measures_list(outcomes.get("primaryOutcomes"))
    out["primary_outcomes"] = primary_list
    out["primary_outcome"] = " | ".join(primary_list[:3]) if primary_list else None
    out["secondary_outcomes"] = _join_outcome_measures(outcomes.get("secondaryOutcomes"))
    out["study_description"] = (
        str(desc_mod.get("briefSummary") or desc_mod.get("detailedDescription") or "").strip()[:2000] or None
    )
    out["trial_design"] = trial_design_from_study(study)
    phases = design.get("phases") if isinstance(design.get("phases"), list) else []
    out["phase"] = " | ".join(str(p) for p in phases if p) or None
    conds = conditions_mod.get("conditions") if isinstance(conditions_mod.get("conditions"), list) else []
    out["conditions"] = " | ".join(str(c) for c in conds if c)[:500] or None
    inters = arms.get("interventions") if isinstance(arms.get("interventions"), list) else []
    out["interventions"] = " | ".join(
        str(i.get("name") or "").strip() for i in inters if isinstance(i, dict) and i.get("name")
    )[:500] or None
    return out


def fetch_study_plan_fields(nct_id: str) -> dict[str, Any]:
    study = fetch_ctgov_study(nct_id)
    if not study:
        return {"nct_id": normalize_nct_id(nct_id), "error": "fetch_failed", "source": "ctgov_v2_study_plan"}
    fields = extract_study_plan_fields(study)
    fields["nct_id"] = normalize_nct_id(nct_id)
    return fields


__all__ = [
    "extract_study_plan_fields",
    "fetch_ctgov_study",
    "fetch_study_plan_fields",
    "nct_from_sim_row",
    "normalize_nct_id",
    "trial_design_from_study",
]
