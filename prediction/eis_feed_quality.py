"""
EIS clinical feed quality gates — reduce cross-company contamination.

Used by ``clinical_pre_cd_enrichment`` (annotate/filter) and sanitize scripts.
"""
from __future__ import annotations

import re
from typing import Any

INVALID_TICKERS = frozenset(
    {"NAN", "NONE", "NULL", "N/A", "NA", "UNKNOWN", "UNDEFINED", "TBD", "—", "-"}
)
_MIN_REFERENCE_CHARS = 12
_MIN_DRUG_ONLY_TERM_LEN = 5
_SHORT_TICKER_MAX = 4


def is_valid_feed_ticker(ticker: str | None) -> bool:
    """Reject missing, NaN-string, and placeholder tickers."""
    tk = str(ticker or "").strip().upper()
    if not tk or tk in INVALID_TICKERS:
        return False
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", tk):
        return False
    return True


def event_reference_text(ev: dict[str, Any]) -> str:
    parts = [
        ev.get("event_title"),
        ev.get("summary"),
        ev.get("impact_note"),
    ]
    return " ".join(str(p) for p in parts if p).strip()


def event_has_usable_reference_text(ev: dict[str, Any]) -> bool:
    """Publication/clinical events need a readable title or summary."""
    st = str(ev.get("source_type") or "").lower()
    if st in ("sec_8k", "cd_milestone"):
        return True
    return len(event_reference_text(ev)) >= _MIN_REFERENCE_CHARS


def _text_mentions_term(text: str, term: str) -> bool:
    if not text or not term:
        return False
    tl = term.lower()
    if len(tl) <= 5:
        return bool(re.search(rf"\b{re.escape(tl)}\b", text, flags=re.I))
    if tl in text:
        return True
    return bool(re.search(rf"\b{re.escape(tl)}\b", text, flags=re.I))


def verify_event_reference_strict(
    ev: dict[str, Any],
    *,
    company: str,
    ticker: str,
    drug_tokens: list[str] | None = None,
    expected_nct_id: str | None = None,
    company_search_terms_fn=None,
    drug_search_terms_fn=None,
) -> tuple[bool, str | None]:
    """
    Stricter reference check than legacy auto-pass rules.

    * Requires usable title/summary (except SEC 8-K / CD milestone).
    * CT.gov: NCT in link/summary must match study when ``expected_nct_id`` set.
    * Drug-only match: term length ≥ 5 (blocks spurious short-token hits).
    * Short tickers (≤4): company mention requires drug co-hit.
    """
    if not event_has_usable_reference_text(ev):
        return False, None

    st = str(ev.get("source_type") or "").lower()
    if st == "sec_8k":
        if ev.get("_from_kpi_timeline") and not ev.get("sec_filing_verified"):
            pass
        else:
            return True, "sec_8k"
    if st == "cd_milestone":
        return True, "ctgov"

    if st in ("ctgov", "clinicaltrials.gov", "ct_gov"):
        nct = (expected_nct_id or "").strip().upper()
        if nct:
            link = str(ev.get("link") or "")
            blob = f"{event_reference_text(ev)} {link}".upper()
            if nct in blob or nct.replace("NCT", "NCT") in blob:
                return True, "ctgov"
            return False, None
        return True, "ctgov"

    if company_search_terms_fn is None or drug_search_terms_fn is None:
        from clinical_pre_cd_enrichment import _company_search_terms, _drug_search_terms

        company_search_terms_fn = _company_search_terms
        drug_search_terms_fn = _drug_search_terms

    text = event_reference_text(ev).lower()
    co_terms = company_search_terms_fn(company, ticker)
    dr_terms = [
        t
        for t in drug_search_terms_fn(drug_tokens or [], ev.get("drug") or ev.get("asset"))
        if len(t) >= _MIN_DRUG_ONLY_TERM_LEN
    ]

    dr_hit = any(_text_mentions_term(text, t) for t in dr_terms)
    multi_co = [t for t in co_terms if " " in t and _text_mentions_term(text, t)]
    single_co = [t for t in co_terms if " " not in t and _text_mentions_term(text, t)]
    tk = str(ticker or "").strip().upper()
    if len(tk) <= _SHORT_TICKER_MAX:
        co_hit = bool(multi_co) or (bool(single_co) and dr_hit)
    else:
        co_hit = bool(multi_co) or bool(single_co)

    if co_hit and dr_hit:
        return True, "company+drug"
    if co_hit:
        return True, "company"
    if dr_hit:
        return True, "drug"
    return False, None


def filter_verified_feed_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep SEC 8-K, CD milestones, and reference-verified rows with usable text."""
    out: list[dict[str, Any]] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        if not event_has_usable_reference_text(ev):
            continue
        st = str(ev.get("source_type") or "").lower()
        if st == "sec_8k":
            out.append(ev)
            continue
        if ev.get("reference_verified") is True:
            out.append(ev)
    return out


def recompute_record_sponsor_match(record: dict[str, Any]) -> str:
    """Recompute sponsor_match from company + CT.gov lead_sponsor in meta."""
    from fetch_edgar import _compute_sponsor_match

    stored = str(record.get("sponsor_match") or "").strip()
    if stored.lower() in ("exact", "partial", "direct match"):
        return stored
    company = str(record.get("company") or record.get("query_company") or record.get("ticker") or "")
    meta = record.get("meta") if isinstance(record.get("meta"), dict) else {}
    lead = str(meta.get("lead_sponsor") or record.get("lead_sponsor") or "")
    if not lead:
        return stored or "N/D"
    return _compute_sponsor_match(company, lead)


_GENERIC_SPONSOR_TOKENS = frozenset(
    {
        "biosciences",
        "biopharma",
        "biotherapeutics",
        "pharmaceuticals",
        "pharmaceutical",
        "pharma",
        "therapeutics",
        "medicines",
        "sciences",
        "health",
        "laboratories",
        "labs",
    }
)


def _sponsor_tokens(text: str) -> set[str]:
    t = re.sub(r"[^a-z0-9]+", " ", str(text or "").lower())
    return {w for w in t.split() if len(w) >= 4}


def _meaningful_sponsor_overlap(company: str, lead: str) -> bool:
    """True when company and lead share a non-generic token (blocks *Biosciences-only partial)."""
    common = _sponsor_tokens(company) & _sponsor_tokens(lead)
    if not common:
        return False
    return bool(common - _GENERIC_SPONSOR_TOKENS)


def is_study_sponsor_trusted(record: dict[str, Any]) -> bool:
    sm = str(recompute_record_sponsor_match(record)).strip().lower()
    if sm in ("exact", "direct match"):
        return True
    if sm != "partial":
        return False
    company = str(record.get("company") or record.get("query_company") or record.get("ticker") or "")
    meta = record.get("meta") if isinstance(record.get("meta"), dict) else {}
    lead = str(meta.get("lead_sponsor") or record.get("lead_sponsor") or "")
    return _meaningful_sponsor_overlap(company, lead)


def sanitize_snapshot_record(
    record: dict[str, Any],
    *,
    reannotate: bool = True,
) -> dict[str, Any]:
    """Reannotate events, recompute sponsor_match, return copy."""
    out = sanitize_record_events(record, reannotate=reannotate)
    out["sponsor_match"] = recompute_record_sponsor_match(out)
    return out


def filter_trusted_snapshot_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only sponsor-verified studies (Exact/Partial)."""
    out: list[dict[str, Any]] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if not is_valid_feed_ticker(rec.get("ticker")):
            continue
        clean = sanitize_snapshot_record(rec, reannotate=True)
        if is_study_sponsor_trusted(clean):
            out.append(clean)
    out.sort(key=lambda r: (r.get("ticker") or "", r.get("cd_date") or ""))
    return out


def sanitize_record_events(
    record: dict[str, Any],
    *,
    reannotate: bool = True,
) -> dict[str, Any]:
    """Re-run verification + filter on a snapshot record (in-place copy)."""
    from clinical_pre_cd_enrichment import (
        _drug_tokens_from_item,
        annotate_events_reference_verification,
    )

    if not is_valid_feed_ticker(record.get("ticker")):
        return record

    out = dict(record)
    events = list(out.get("clinical_events") or out.get("timeline_events") or [])
    if not events:
        return out

    drug_tokens: list[str] = []
    ctx = out.get("publication_context")
    if isinstance(ctx, dict):
        drug_tokens = list(ctx.get("drug_tokens_searched") or [])
    if not drug_tokens:
        drug_tokens = _drug_tokens_from_item(out, out.get("meta") or {})

    if reannotate:
        events = annotate_events_reference_verification(
            events,
            company=str(out.get("company") or out.get("ticker") or ""),
            ticker=str(out.get("ticker") or ""),
            drug_tokens=drug_tokens,
        )
    events = filter_verified_feed_events(events)
    out["clinical_events"] = events
    out["timeline_events"] = events
    return out


__all__ = [
    "INVALID_TICKERS",
    "event_has_usable_reference_text",
    "event_reference_text",
    "filter_trusted_snapshot_records",
    "filter_verified_feed_events",
    "is_study_sponsor_trusted",
    "is_valid_feed_ticker",
    "recompute_record_sponsor_match",
    "sanitize_record_events",
    "sanitize_snapshot_record",
    "verify_event_reference_strict",
]
