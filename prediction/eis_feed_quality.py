"""
EIS clinical feed quality gates — reduce cross-company contamination.

Used by ``clinical_pre_cd_enrichment`` (annotate/filter) and sanitize scripts.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

INVALID_TICKERS = frozenset(
    {"NAN", "NONE", "NULL", "N/A", "NA", "UNKNOWN", "UNDEFINED", "TBD", "—", "-"}
)
_MIN_REFERENCE_CHARS = 12
_MIN_DRUG_ONLY_TERM_LEN = 5
_SHORT_TICKER_MAX = 4

# SOC / IO backbone — common across many trials; never sufficient alone for
# drug-only PubMed attach (blocks Keytruda papers on unrelated tickers).
SHARED_SOC_DRUG_TERMS = frozenset(
    {
        "pembrolizumab",
        "keytruda",
        "nivolumab",
        "opdivo",
        "atezolizumab",
        "tecentriq",
        "durvalumab",
        "imfinzi",
        "ipilimumab",
        "yervoy",
        "cemiplimab",
        "libtayo",
        "carboplatin",
        "paclitaxel",
        "cisplatin",
        "docetaxel",
        "gemcitabine",
        "rituximab",
        "trastuzumab",
        "bevacizumab",
        "lenalidomide",
        "dexamethasone",
        "prednisone",
        "methotrexate",
        "chemotherapy",
        "placebo",
        "saline",
    }
)


def _norm_drug_term(term: str) -> str:
    return re.sub(r"[\s\-_]+", "", str(term or "").lower())


def is_shared_soc_drug_term(term: str) -> bool:
    t = str(term or "").strip().lower()
    if not t:
        return False
    if t in SHARED_SOC_DRUG_TERMS:
        return True
    return _norm_drug_term(t) in SHARED_SOC_DRUG_TERMS


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
    if st in ("sec_8k", "sec_10q", "cd_milestone"):
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
    if st in ("sec_8k", "sec_10q"):
        if ev.get("_from_kpi_timeline") and not ev.get("sec_filing_verified"):
            pass
        else:
            return True, st
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

    specific_hits = [
        t for t in dr_terms if _text_mentions_term(text, t) and not is_shared_soc_drug_term(t)
    ]
    backbone_hits = [
        t for t in dr_terms if _text_mentions_term(text, t) and is_shared_soc_drug_term(t)
    ]
    dr_hit = bool(specific_hits or backbone_hits)
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
    # Study-specific drug alone is OK; shared SOC (pembrolizumab, …) alone is not
    # unless the expected NCT is explicitly mentioned in the paper.
    if specific_hits:
        return True, "drug"
    if backbone_hits:
        nct = (expected_nct_id or "").strip().upper()
        if nct and nct in text.upper():
            return True, "drug"
        return False, None
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
        if st in ("sec_8k", "sec_10q"):
            out.append(ev)
            continue
        if ev.get("reference_verified") is True:
            out.append(ev)
    return out


# ---------------------------------------------------------------------------
# Confirmation gate — hypothetical events must never carry a price-derived EIS.
#
# The AI passes are asked to combine registry data with training knowledge, so
# they also emit plausible-but-unverified milestones ("Potential ESMO 2026
# presentation"). Those rows used to receive an invented ``event_date``, which
# the market enrichment then resolved against yfinance: an unrelated price move
# became clinical alpha. Anticipated rows are kept (they are useful leads) but
# routed to the pending-verification registry with a neutral score instead.
# ---------------------------------------------------------------------------

CONFIRMED = "confirmed"
ANTICIPATED = "anticipated"

_HARD_SOURCE_RE = re.compile(r"(https?://|10\.\d{4,}/\S+|\bpmid[:\s]*\d+|\bnct\d{8}\b)", re.I)

# Hedged claim in the *title* — the event itself is a guess, not a fact.
# Deliberately not matched against the summary body: real events (earnings,
# approvals) routinely mention what is "expected" next without being guesses.
_HYPOTHESIS_CLAIM_RE = re.compile(
    r"(\bpotential(ly)?\b|\banticipat(ed|es|ing|ion)\b|\bexpected\b|\bestimated\b"
    r"|\bspeculative\b|\bplausible\b|\bpossible\b|\bprojected\b|\bprobable\b"
    r"|\bif accepted\b|\bmay be (presented|submitted|reported)\b"
    r"|abstract submission window)",
    re.I,
)

# Explicit self-disclaimers — trustworthy anywhere in the row.
_HYPOTHESIS_DISCLAIMER_RE = re.compile(
    r"(based on (my )?training knowledge"
    r"|no abstract (submission )?(is |was )?confirmed"
    r"|abstract submission (is )?not confirmed"
    r"|not (yet )?(been )?confirmed"
    r"|has not been confirmed"
    r"|awaiting confirmation"
    r"|subject to abstract acceptance"
    r"|plausible venue"
    r"|not (yet )?publicly available"
    r"|no (new )?(clinical )?data (are |is )?publicly available)",
    re.I,
)

_ANTICIPATED_WINDOW_LEAD_DAYS = 30
_ANTICIPATED_WINDOW_TRAIL_DAYS = 60


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def event_has_hard_source(ev: dict[str, Any]) -> bool:
    """True when the row points at something verifiable (URL, DOI, PMID, NCT)."""
    if ev.get("sec_filing_verified") is True:
        return True
    blob = " ".join(
        str(ev.get(f) or "")
        for f in ("link", "url", "url_hint", "publication_venue", "link_label")
    )
    return bool(_HARD_SOURCE_RE.search(blob))


def classify_event_confirmation(
    ev: dict[str, Any],
    *,
    as_of: date | str | None = None,
) -> dict[str, Any]:
    """Split verifiable events from unverified hypotheses.

    Returns ``{"status", "reason", "expected_window_start", "expected_window_end"}``.
    An explicit ``confirmation_status`` from the AI pass wins; otherwise a row is
    ``anticipated`` when it has no hard source and either hedges its own claim or
    sits in the future (an event that has not happened cannot have been observed).
    """
    declared = str(ev.get("confirmation_status") or "").strip().lower()
    if declared in (CONFIRMED, ANTICIPATED):
        # Keep the original reason when re-gating an already annotated row,
        # otherwise a second pass would relabel our own verdict as the model's.
        status = declared
        reason = str(ev.get("confirmation_reason") or "") or "declared_by_model"
    else:
        status, reason = CONFIRMED, None
        if not event_has_hard_source(ev):
            claim = " ".join(
                str(ev.get(f) or "") for f in ("event_title", "publication_venue")
            )
            body = " ".join(
                str(ev.get(f) or "")
                for f in ("event_title", "summary", "impact_note", "publication_venue")
            )
            today = _as_date(as_of) or date.today()
            event_day = _as_date(ev.get("event_date"))
            if _HYPOTHESIS_DISCLAIMER_RE.search(body):
                status, reason = ANTICIPATED, "self_disclaimed"
            elif _HYPOTHESIS_CLAIM_RE.search(claim):
                status, reason = ANTICIPATED, "hedged_claim"
            elif event_day and event_day > today:
                status, reason = ANTICIPATED, "future_dated"

    out: dict[str, Any] = {"status": status, "reason": reason}
    if status == ANTICIPATED:
        start = _as_date(ev.get("expected_window_start"))
        end = _as_date(ev.get("expected_window_end"))
        anchor = _as_date(ev.get("event_date"))
        if start is None and anchor is not None:
            start = anchor - timedelta(days=_ANTICIPATED_WINDOW_LEAD_DAYS)
        if end is None and anchor is not None:
            end = anchor + timedelta(days=_ANTICIPATED_WINDOW_TRAIL_DAYS)
        out["expected_window_start"] = start.isoformat() if start else None
        out["expected_window_end"] = end.isoformat() if end else None
    return out


def annotate_event_confirmation(
    ev: dict[str, Any],
    *,
    as_of: date | str | None = None,
) -> dict[str, Any]:
    """Copy of ``ev`` carrying ``confirmation_status`` and its expected window."""
    verdict = classify_event_confirmation(ev, as_of=as_of)
    out = dict(ev)
    out["confirmation_status"] = verdict["status"]
    if verdict.get("reason"):
        out["confirmation_reason"] = verdict["reason"]
    if verdict["status"] == ANTICIPATED:
        out["expected_window_start"] = verdict.get("expected_window_start")
        out["expected_window_end"] = verdict.get("expected_window_end")
    else:
        out.pop("confirmation_reason", None)
    return out


def is_anticipated_event(ev: dict[str, Any], *, as_of: date | str | None = None) -> bool:
    return classify_event_confirmation(ev, as_of=as_of)["status"] == ANTICIPATED


EIS_GATE_REASON = "unverified_hypothesis"

_NEUTRAL_PRICE_BLOCK = {
    "p_t0": None,
    "p_t1": None,
    "p_t3": None,
    "p_t7": None,
    "delta_p_1d": None,
    "delta_p_3d": None,
    "delta_p_7d": None,
}


def neutralize_anticipated_event_score(ev: dict[str, Any]) -> dict[str, Any]:
    """Strip price attribution and EIS from a hypothesis row.

    The event date of a hypothesis is a guess, so any price move read at that
    date belongs to something else.
    """
    out = dict(ev)
    out["eis"] = None
    out["eis_gated"] = EIS_GATE_REASON
    out["price"] = dict(_NEUTRAL_PRICE_BLOCK)
    return out


def recompute_record_sponsor_match(record: dict[str, Any]) -> str:
    """Always recompute sponsor_match from company + CT.gov sponsors in meta.

    Never trust a stored Exact/Partial — stale Exact caused ETON↔PMV contamination.
    """
    company = str(record.get("company") or record.get("query_company") or record.get("ticker") or "")
    meta = record.get("meta") if isinstance(record.get("meta"), dict) else {}
    lead = str(meta.get("lead_sponsor") or record.get("lead_sponsor") or "")
    rpo = str(meta.get("responsible_party_org") or record.get("responsible_party_org") or "")
    collab = str(meta.get("collaborators") or record.get("collaborators") or "")
    if not lead and not rpo and not collab:
        return str(record.get("sponsor_match") or "").strip() or "N/D"
    try:
        from data_orchestrator import _compute_sponsor_match as orch_match

        return orch_match(company, lead, rpo, collab)
    except Exception:
        from fetch_edgar import _compute_sponsor_match

        return _compute_sponsor_match(company, lead, rpo, collab)


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
        "inc",
        "ltd",
        "llc",
        "corp",
        "corporation",
        "company",
        "co",
        "plc",
        "sa",
        "nv",
        "ag",
        "gmbh",
        "group",
        "holdings",
        "holding",
    }
)


def _sponsor_tokens(text: str) -> set[str]:
    t = re.sub(r"[^a-z0-9]+", " ", str(text or "").lower())
    # len≥3 keeps short distinctive names (PMV, BMS acronyms as tokens).
    return {w for w in t.split() if len(w) >= 3}


def _meaningful_sponsor_overlap(company: str, lead: str) -> bool:
    """True when company and lead share a non-generic token (blocks *Biosciences-only partial)."""
    common = _sponsor_tokens(company) & _sponsor_tokens(lead)
    if not common:
        return False
    return bool(common - _GENERIC_SPONSOR_TOKENS)


def _normalize_sponsor_name(text: str) -> str:
    t = re.sub(r"[^a-z0-9]+", " ", str(text or "").lower())
    return " ".join(t.split())


def _sponsor_names_equivalent(company: str, sponsor: str) -> bool:
    """Exact CT.gov sponsor string match (handles C4 Therapeutics where «c4» is len 2)."""
    norm_co = _normalize_sponsor_name(company)
    norm_sp = _normalize_sponsor_name(sponsor)
    return bool(norm_co and norm_sp and norm_co == norm_sp)


def is_study_sponsor_trusted(record: dict[str, Any]) -> bool:
    """Exact/Partial only when recomputed match + non-generic name overlap."""
    sm = str(recompute_record_sponsor_match(record)).strip().lower()
    if sm not in ("exact", "direct match", "partial"):
        return False
    company = str(record.get("company") or record.get("query_company") or record.get("ticker") or "")
    meta = record.get("meta") if isinstance(record.get("meta"), dict) else {}
    lead = str(meta.get("lead_sponsor") or record.get("lead_sponsor") or "")
    rpo = str(meta.get("responsible_party_org") or record.get("responsible_party_org") or "")
    # Exact after recompute already requires identity on lead/RPO; still require
    # a distinctive token so "… Pharmaceuticals" alone never trusts — unless the
    # sponsor string is literally the same (e.g. C4 Therapeutics, Inc.).
    if sm in ("exact", "direct match"):
        if _sponsor_names_equivalent(company, lead) or _sponsor_names_equivalent(company, rpo):
            return True
        return _meaningful_sponsor_overlap(company, lead) or _meaningful_sponsor_overlap(company, rpo)
    return _meaningful_sponsor_overlap(company, lead) or _meaningful_sponsor_overlap(company, rpo)


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
    events = [gate_event_confirmation(ev) for ev in events]
    out["clinical_events"] = events
    out["timeline_events"] = events
    return out


def gate_event_confirmation(
    ev: dict[str, Any],
    *,
    as_of: date | str | None = None,
) -> dict[str, Any]:
    """Annotate confirmation status and neutralize the score of hypotheses."""
    out = annotate_event_confirmation(ev, as_of=as_of)
    if out.get("confirmation_status") == ANTICIPATED:
        out = neutralize_anticipated_event_score(out)
    return out


__all__ = [
    "ANTICIPATED",
    "CONFIRMED",
    "EIS_GATE_REASON",
    "INVALID_TICKERS",
    "annotate_event_confirmation",
    "classify_event_confirmation",
    "event_has_hard_source",
    "event_has_usable_reference_text",
    "event_reference_text",
    "gate_event_confirmation",
    "is_anticipated_event",
    "neutralize_anticipated_event_score",
    "filter_trusted_snapshot_records",
    "filter_verified_feed_events",
    "is_study_sponsor_trusted",
    "is_valid_feed_ticker",
    "recompute_record_sponsor_match",
    "sanitize_record_events",
    "sanitize_snapshot_record",
    "verify_event_reference_strict",
]
