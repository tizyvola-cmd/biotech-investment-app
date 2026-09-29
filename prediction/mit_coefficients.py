"""
MIT event-study coefficients (Singh et al. 2022, PLoS ONE) — day 0–1 abnormal returns.

Source: internal brief from MIT LFE paper (DOI 10.1371/journal.pone.0272851).
Values are **marginal category effects** from the brief tables, not a full regression
with simultaneous dummies. Used for backtest / prior layer only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

CompanyType = Literal["EB", "LB", "SP", "BP", "UNK"]
PhaseBucket = Literal["1", "1/2", "2", "2/3", "3", "3/4", "4", "UNK"]
DiseaseCategory = Literal[
    "genitourinary",
    "ophthalmology",
    "vaccines_infectious",
    "cns",
    "oncology",
    "cardiovascular",
    "infectious_disease",
    "autoimmune",
    "metabolic",
    "other",
    "UNK",
]
TrialDesign = Literal[
    "placebo_controlled",
    "pharmacokinetics",
    "fixed_dose",
    "adaptive",
    "safety",
    "active_comparator",
    "non_inferiority",
    "multiple_ascending_dose",
    "UNK",
]

# Day 0–1 % (brief §2.2–2.6)
COMPANY_TYPE_EAR_D01: dict[str, float] = {
    "EB": 6.31,
    "SP": 1.69,
    "LB": 0.73,
    "BP": -4.64,
}

PHASE_EAR_D01: dict[str, float] = {
    "2/3": 1.95,
    "3": 1.59,
    "4": 0.73,
    "2": 0.47,
    "3/4": 0.68,
    "1": -0.28,
    "1/2": -1.11,
}

DISEASE_EAR_D01: dict[str, float] = {
    "genitourinary": 3.13,
    "ophthalmology": 0.81,
    "vaccines_infectious": 0.35,
    "cns": -0.18,
    "oncology": -0.43,
    "cardiovascular": -0.65,
    "infectious_disease": -0.76,
    "autoimmune": -0.81,
    "metabolic": -1.00,
}

TRIAL_DESIGN_EAR_D01: dict[str, float] = {
    "placebo_controlled": 1.30,
    "pharmacokinetics": 0.99,
    "fixed_dose": 0.82,
    "adaptive": 0.69,
    "safety": 0.63,
    "active_comparator": 0.30,
    "non_inferiority": -0.86,
    "multiple_ascending_dose": -2.14,
}

# Brief §5 — unexplained intercept (day 0–1); shrink in production / backtest ex-ante
MIT_ALPHA_D01 = 4.10
ACCRUAL_BPS_PER_1K_D01 = 0.144  # brief formula block (day 0–1); §2.6 cites 0.158 day 0

# Population means for centering (approximate midpoints from brief tables)
_MEAN_COMPANY = sum(COMPANY_TYPE_EAR_D01.values()) / len(COMPANY_TYPE_EAR_D01)
_MEAN_PHASE = sum(PHASE_EAR_D01.values()) / len(PHASE_EAR_D01)
_MEAN_DISEASE = sum(DISEASE_EAR_D01.values()) / len(DISEASE_EAR_D01)


@dataclass(frozen=True)
class MitTrialFeatures:
    company_type: CompanyType = "UNK"
    phase_bucket: PhaseBucket = "UNK"
    disease_category: DiseaseCategory = "UNK"
    trial_design: TrialDesign = "UNK"
    target_enrollment: int | None = None


def classify_company_type(
    market_cap_usd: float | None,
    *,
    industry: str = "",
    approved_product_hint: bool | None = None,
) -> CompanyType:
    """
    Thakor-style rules from brief §2.2 / §4.1 (simplified — no product DB yet).
    """
    if market_cap_usd is None or market_cap_usd <= 0:
        return "UNK"
    mc = float(market_cap_usd)
    ind = (industry or "").lower()
    if mc >= 10e9:
        return "BP"
    if mc >= 2e9:
        if approved_product_hint is True or "pharmaceutical" in ind:
            return "LB" if "biotech" in ind or "biotechnology" in ind else "SP"
        return "LB"
    if "pharmaceutical" in ind and "biotech" not in ind and "biotechnology" not in ind:
        return "SP"
    return "EB"


def parse_phase_bucket(phase_raw: str | None) -> PhaseBucket:
    if not phase_raw or not str(phase_raw).strip():
        return "UNK"
    parts = re.findall(r"PHASE\s*(\d+)|EARLY\s*PHASE\s*(\d+)", str(phase_raw).upper())
    nums: set[int] = set()
    for a, b in parts:
        n = a or b
        if n:
            nums.add(int(n))
    if not nums:
        return "UNK"
    if nums == {2, 3}:
        return "2/3"
    if nums == {1, 2}:
        return "1/2"
    if nums == {3, 4}:
        return "3/4"
    if len(nums) == 1:
        return str(next(iter(nums)))  # type: ignore[return-value]
    # Multi-phase non canonical → highest phase (conservative)
    return str(max(nums))  # type: ignore[return-value]


_DISEASE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("genitourinary", ("genitourinary", "urolog", "bladder", "prostate", "renal", "kidney")),
    ("ophthalmology", ("ophthalm", "retina", "glaucoma", "macular", "eye")),
    ("vaccines_infectious", ("vaccine", "immunization", "prophylaxis")),
    ("oncology", ("cancer", "oncolog", "tumor", "carcinoma", "lymphoma", "leukemia", "melanoma")),
    ("cardiovascular", ("cardio", "heart", "hypertension", "stroke", "coronary", "atrial")),
    ("metabolic", ("diabet", "obesity", "metabolic", "endocrin", "thyroid", "hormone")),
    ("autoimmune", ("autoimmune", "rheumat", "lupus", "psoriasis", "inflamm", "crohn", "colitis")),
    ("infectious_disease", ("hiv", "hepatitis", "infection", "bacterial", "viral", "covid", "influenza")),
    ("cns", ("alzheimer", "parkinson", "epilep", "depression", "schizophren", "neuropath", "cns", "brain")),
)


def map_disease_category(conditions_text: str | None) -> DiseaseCategory:
    blob = (conditions_text or "").lower()
    if not blob.strip():
        return "UNK"
    for cat, kws in _DISEASE_RULES:
        if any(k in blob for k in kws):
            return cat  # type: ignore[return-value]
    return "other"


def classify_trial_design(text: str | None) -> TrialDesign:
    blob = (text or "").lower()
    if not blob.strip():
        return "UNK"
    if "multiple ascending dose" in blob or "mad " in blob or blob.endswith(" mad"):
        return "multiple_ascending_dose"
    if "non-inferiority" in blob or "non inferiority" in blob:
        return "non_inferiority"
    if "placebo" in blob:
        return "placebo_controlled"
    if "pharmacokinetic" in blob or "pk " in blob:
        return "pharmacokinetics"
    if "active comparator" in blob or "active control" in blob:
        return "active_comparator"
    if "adaptive" in blob:
        return "adaptive"
    if "fixed dose" in blob or "fixed-dose" in blob:
        return "fixed_dose"
    if "safety" in blob and "efficacy" not in blob:
        return "safety"
    return "UNK"


def mit_ear_d01(
    features: MitTrialFeatures,
    *,
    include_alpha: bool = False,
    alpha_shrink: float = 0.20,
    center_features: bool = True,
) -> float:
    """
    Ex-ante structural EAR (day 0–1, %).

    Does **not** include outcome-type δ (unknown before the event).
    ``center_features=True`` subtracts table means so partial sums are not biased high.
    """
    total = 0.0
    n_terms = 0

    if features.company_type != "UNK":
        v = COMPANY_TYPE_EAR_D01[features.company_type]
        total += v - (_MEAN_COMPANY if center_features else 0.0)
        n_terms += 1
    if features.phase_bucket != "UNK":
        v = PHASE_EAR_D01.get(features.phase_bucket, 0.0)
        total += v - (_MEAN_PHASE if center_features else 0.0)
        n_terms += 1
    if features.disease_category not in ("UNK", "other"):
        v = DISEASE_EAR_D01.get(features.disease_category, 0.0)
        total += v - (_MEAN_DISEASE if center_features else 0.0)
        n_terms += 1
    if features.trial_design != "UNK":
        total += TRIAL_DESIGN_EAR_D01[features.trial_design]
        n_terms += 1
    if features.target_enrollment is not None and features.target_enrollment > 0:
        total += (features.target_enrollment / 1000.0) * ACCRUAL_BPS_PER_1K_D01
        n_terms += 1

    if include_alpha and n_terms > 0:
        total += MIT_ALPHA_D01 * max(0.0, min(1.0, alpha_shrink))

    return round(total, 4)
