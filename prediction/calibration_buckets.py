"""Bucket helpers for portfolio Bayesian shrinkage (mirrors desktop-ui lossAuditAnalysis)."""
from __future__ import annotations

import re
from typing import Any

LOSS_THRESHOLD_PCT = -2.0

DIMENSIONS = ("clinicalPhase", "clinicalIndication", "sdsBucket", "pplanBucket")


def is_resolved(row: dict[str, Any]) -> bool:
    pnl = row.get("pnl_pct")
    if pnl is None:
        return False
    try:
        return float(pnl) == float(pnl)
    except (TypeError, ValueError):
        return False


def is_win(row: dict[str, Any]) -> bool:
    try:
        return float(row.get("pnl_pct") or 0) > LOSS_THRESHOLD_PCT
    except (TypeError, ValueError):
        return False


def bucket_clinical_phase(raw: str) -> str:
    if not raw:
        return "Unknown"
    lo = raw.lower()
    if "approv" in lo or "marketed" in lo or "comm" in lo:
        return "Approved"
    if re.search(r"phase\s*4|fase\s*4|\bp4\b", lo):
        return "Phase 4"
    if re.search(r"phase\s*3|fase\s*3|\bp3\b", lo):
        return "Phase 3"
    if re.search(r"phase\s*2|fase\s*2|\bp2\b", lo):
        return "Phase 2"
    if re.search(r"phase\s*1|fase\s*1|\bp1\b", lo):
        return "Phase 1"
    if "preclin" in lo or "pre-clin" in lo:
        return "Preclinical"
    return "Other"


def bucket_indication(raw: str) -> str:
    if not raw:
        return "Unknown"
    lo = raw.lower()
    if re.search(r"onco|tumor|cancer|carcin|leuk|lymph|myelo|sarcoma|melanoma|glioma", lo):
        return "Oncology"
    if re.search(r"neuro|alzheimer|parkinson|als|huntington|epilep|migrain|sclero", lo):
        return "Neurology"
    if re.search(r"cardio|heart|stroke|hypertens|atrial|coronar", lo):
        return "Cardio"
    if re.search(r"immun|inflam|arthr|psoriasis|lupus|crohn|ulcerat|ibd|colit", lo):
        return "Immunology"
    if re.search(r"infect|virus|covid|hiv|hepatit|bacter|antibiotic|pneumoni", lo):
        return "Infectious"
    if re.search(r"diab|obesit|metabol|nash|liver", lo):
        return "Metab/Liver"
    if re.search(r"rare|orphan|gene|hered", lo):
        return "Rare/Genetic"
    if re.search(r"oph|eye|retin|macular", lo):
        return "Ophthalmology"
    if re.search(r"respir|lung|asthma|copd|cystic", lo):
        return "Respiratory"
    return "Other"


def bucket_sds(sds: float | None) -> str:
    if sds is None:
        return "No SDS"
    try:
        v = float(sds)
    except (TypeError, ValueError):
        return "No SDS"
    if v < 40:
        return "SDS <40 (Low)"
    if v < 55:
        return "SDS 40-55 (Mid)"
    if v < 70:
        return "SDS 55-70 (High)"
    return "SDS ≥70 (Premium)"


def bucket_pplan(p: float | None) -> str:
    if p is None:
        return "P(plan) n/a"
    try:
        v = float(p)
    except (TypeError, ValueError):
        return "P(plan) n/a"
    if v < 30:
        return "P(plan) <30%"
    if v < 50:
        return "P(plan) 30-50%"
    if v < 70:
        return "P(plan) 50-70%"
    return "P(plan) ≥70%"


def confidence_from_n(n: int, *, low_max: int = 5, medium_max: int = 15) -> str:
    if n < low_max:
        return "low"
    if n < medium_max:
        return "medium"
    return "high"
