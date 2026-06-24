"""NCT relation cohort filter (shared by refresh coordinator and tests)."""
from __future__ import annotations

from dataclasses import dataclass, field

from prediction.config import pred_nct_strict

RESTRICTED_NCT_REL_ALLOWED = frozenset({
    "direct sponsor",
    "collaborator",
    "correlated company/subsidiary",
})


def norm_nct_relation_label(v) -> str:
    return str(v or "").strip().lower()


def is_restricted_nct_relation(v) -> bool:
    return norm_nct_relation_label(v) in RESTRICTED_NCT_REL_ALLOWED


def filter_past_pred_by_restricted_nct(past_pred_data: dict | None) -> dict:
    out: dict = {}
    for k, r in (past_pred_data or {}).items():
        if isinstance(r, dict) and is_restricted_nct_relation(r.get("nct_relation_type")):
            out[k] = r
    return out


@dataclass
class CohortSelection:
    primary: dict
    pre_filter: dict
    filtered: dict
    cohort_size: int
    cohort_empty: bool
    nct_filter_applied: bool
    warnings: list[str] = field(default_factory=list)


def select_nct_cohort(
    past_pred_pre: dict,
    *,
    skip_nct_filter: bool = False,
    refresh_kind: str = "guida",
) -> CohortSelection:
    """
    Choose primary cohort dict for sheets.

    - ``guida``: never silent fallback to full JSON when filter is empty.
    - ``accuracy``: legacy fallback to full JSON only if ``PRED_NCT_STRICT`` is off.
    """
    warnings: list[str] = []
    pre = dict(past_pred_pre or {})
    if skip_nct_filter:
        primary = dict(pre)
        return CohortSelection(
            primary=primary,
            pre_filter=pre,
            filtered=pre,
            cohort_size=len(primary),
            cohort_empty=len(primary) == 0,
            nct_filter_applied=False,
            warnings=warnings,
        )

    filtered = filter_past_pred_by_restricted_nct(pre)
    strict = pred_nct_strict()
    kind = (refresh_kind or "guida").strip().lower()

    if filtered:
        primary = dict(filtered)
    elif not pre:
        primary = {}
    elif kind == "accuracy" and not strict:
        primary = dict(pre)
        warnings.append(
            "NCT restricted filter yielded 0 rows; using full JSON "
            "(accuracy fallback; set PRED_NCT_STRICT=1 to disable)."
        )
    else:
        primary = dict(filtered)
        if pre:
            warnings.append(
                "NCT restricted filter yielded 0 cohort members "
                f"(pre-filter n={len(pre)})."
            )

    cohort_empty = len(primary) == 0 and len(pre) > 0
    if cohort_empty and strict:
        warnings.append(
            "PRED_NCT_STRICT=1: refusing implicit full-JSON cohort fallback."
        )

    return CohortSelection(
        primary=primary,
        pre_filter=pre,
        filtered=filtered,
        cohort_size=len(primary),
        cohort_empty=cohort_empty,
        nct_filter_applied=True,
        warnings=warnings,
    )
