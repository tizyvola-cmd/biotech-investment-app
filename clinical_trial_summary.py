"""
Clinical Trial Summary Generator
=================================
For a given NCT ID, fetches:
  1. Full study JSON (including resultsSection) from ClinicalTrials.gov v2 API
  2. Up to 3 PubMed abstracts linked to the study or found by NCT search
  3. Calls an AI provider to produce a structured, investment-focused summary

Cache: data/clinical_summaries_cache.json — keyed by NCT ID.
       TTL default 30 days (CLINICAL_CACHE_TTL_DAYS); CT.gov may post new results later.

AI provider (first configured wins):
  ANTHROPIC_API_KEY  — Claude Sonnet (default)
  GITHUB_TOKEN       — GitHub Models / gpt-4o-mini (free with Copilot)
  OPENAI_API_KEY     — OpenAI gpt-4o-mini
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

import ai_provider
from clinical_cache_ttl import is_cache_fresh

CTGOV_SLEEP_SEC   = float(os.environ.get("CTGOV_SLEEP_SEC", "0.5"))
PUBMED_SLEEP_SEC  = float(os.environ.get("PUBMED_SLEEP_SEC", "0.35"))

_DATA_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_CACHE_PATH = os.path.join(_DATA_DIR, "clinical_summaries_cache.json")

_CTGOV_STUDY_URL = "https://clinicaltrials.gov/api/v2/studies/{nct_id}"
_PUBMED_SEARCH   = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_PUBMED_FETCH    = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
_PUBMED_EMAIL    = os.environ.get("PUBMED_EMAIL", "biotech-app@example.com")

_HEADERS = {"User-Agent": "biotech-investment-app/1.0 (research use)"}


# ── Cache ──────────────────────────────────────────────────────────────────────


def _load_cache() -> dict[str, Any]:
    try:
        return json.loads(Path(_CACHE_PATH).read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(cache: dict[str, Any]) -> None:
    Path(_DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(_CACHE_PATH).write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def get_cached_summary(nct_id: str) -> dict[str, Any] | None:
    entry = _load_cache().get(nct_id.upper())
    if not entry:
        return None
    if is_cache_fresh(entry, ts_keys=("generated_at",)):
        return entry
    return None


# ── ClinicalTrials.gov helpers ─────────────────────────────────────────────────


def _ctgov_get(nct_id: str) -> dict[str, Any] | None:
    time.sleep(CTGOV_SLEEP_SEC)
    url = _CTGOV_STUDY_URL.format(nct_id=nct_id)
    try:
        r = requests.get(url, headers=_HEADERS, timeout=20)
        if r.status_code == 200:
            return r.json()
    except Exception as exc:
        print(f"[ClinicalSummary] CT.gov error for {nct_id}: {exc}", flush=True)
    return None


def _extract_results(study: dict[str, Any]) -> dict[str, Any]:
    """Pull structured outcome/safety data from a CT.gov study JSON."""
    results_section = study.get("resultsSection") or {}
    protocol        = study.get("protocolSection") or {}
    ident           = protocol.get("identificationModule") or {}
    design          = protocol.get("designModule") or {}
    status_mod      = protocol.get("statusModule") or {}
    sponsors        = protocol.get("sponsorCollaboratorsModule") or {}
    conditions_mod  = protocol.get("conditionsModule") or {}
    arms_mod        = protocol.get("armsInterventionsModule") or {}
    desc_mod        = protocol.get("descriptionModule") or {}

    # ── Primary / secondary outcomes ──────────────────────────────────────────
    outcome_measures: list[dict] = []
    om_module = results_section.get("outcomeMeasuresModule") or {}
    for om in (om_module.get("outcomeMeasures") or []):
        measure: dict[str, Any] = {
            "type":        om.get("type", ""),
            "title":       om.get("title", ""),
            "time_frame":  om.get("timeFrame", ""),
        }
        # Collect group values
        values: list[str] = []
        for cls in (om.get("classes") or []):
            for cat in (cls.get("categories") or []):
                for m in (cat.get("measurements") or []):
                    v = m.get("value", "")
                    lo = m.get("lowerLimit")
                    hi = m.get("upperLimit")
                    sp = m.get("spread")
                    if v:
                        suffix = ""
                        if lo and hi:
                            suffix = f" ({lo}–{hi})"
                        elif sp:
                            suffix = f" ±{sp}"
                        values.append(f"{v}{suffix}")
        if values:
            measure["values"] = values
        # p-value annotation if in title/description
        p_text = om.get("description") or om.get("title") or ""
        pm = re.search(r"p\s*[<=>]\s*[\d.]+", p_text, re.IGNORECASE)
        if pm:
            measure["p_value_hint"] = pm.group(0)
        outcome_measures.append(measure)

    # ── Adverse events ─────────────────────────────────────────────────────────
    ae_module = results_section.get("adverseEventsModule") or {}
    ae_summary: list[str] = []
    for ev in (ae_module.get("seriousEvents") or [])[:5]:
        term  = ev.get("term", "")
        stats = ev.get("stats") or []
        pcts  = [f"{s.get('numAffected','?')}/{s.get('numAtRisk','?')}" for s in stats[:2]]
        ae_summary.append(f"{term}: {', '.join(pcts)}")

    # ── Publications ───────────────────────────────────────────────────────────
    more_info = results_section.get("moreInfoModule") or {}
    refs = more_info.get("references") or []
    pmids: list[str] = [
        r["pmid"] for r in refs if r.get("pmid") and r.get("type") in ("RESULT", "DERIVED")
    ][:3]
    citations: list[str] = [r.get("citation", "") for r in refs[:4] if r.get("citation")]

    # ── Enrollment ─────────────────────────────────────────────────────────────
    enrollment = design.get("enrollmentInfo", {}).get("count")
    phases     = " / ".join(design.get("phases") or [])
    overall    = status_mod.get("overallStatus", "")
    brief_title   = ident.get("briefTitle", "")
    official_title= ident.get("officialTitle", "")
    lead_sponsor  = (sponsors.get("leadSponsor") or {}).get("name", "")
    conditions    = " | ".join(conditions_mod.get("conditions") or [])
    interventions = " | ".join(
        x.get("name", "") for x in (arms_mod.get("interventions") or [])[:4]
    )
    brief_summary = desc_mod.get("briefSummary", "")[:600]

    return {
        "nct_id":           ident.get("nctId", ""),
        "brief_title":      brief_title,
        "official_title":   official_title,
        "phase":            phases,
        "overall_status":   overall,
        "enrollment":       enrollment,
        "lead_sponsor":     lead_sponsor,
        "conditions":       conditions,
        "interventions":    interventions,
        "brief_summary":    brief_summary,
        "outcome_measures": outcome_measures[:8],
        "ae_summary":       ae_summary,
        "pmids":            pmids,
        "citations":        citations,
        "has_results":      bool(results_section),
    }


# ── PubMed helpers ─────────────────────────────────────────────────────────────


def _pubmed_search_pmids(nct_id: str) -> list[str]:
    time.sleep(PUBMED_SLEEP_SEC)
    try:
        r = requests.get(
            _PUBMED_SEARCH,
            params={"db": "pubmed", "term": nct_id, "retmax": 3,
                    "retmode": "json", "email": _PUBMED_EMAIL},
            headers=_HEADERS,
            timeout=15,
        )
        if r.status_code == 200:
            ids = r.json().get("esearchresult", {}).get("idlist", [])
            return [str(i) for i in ids[:3]]
    except Exception:
        pass
    return []


def _pubmed_fetch_abstracts(pmids: list[str]) -> list[str]:
    if not pmids:
        return []
    time.sleep(PUBMED_SLEEP_SEC)
    try:
        r = requests.get(
            _PUBMED_FETCH,
            params={"db": "pubmed", "id": ",".join(pmids),
                    "rettype": "abstract", "retmode": "text",
                    "email": _PUBMED_EMAIL},
            headers=_HEADERS,
            timeout=20,
        )
        if r.status_code == 200:
            text = r.text
            # Split by PMID blocks and truncate each
            blocks = re.split(r"\n\d+\.", text)
            return [b.strip()[:800] for b in blocks if b.strip()][:3]
    except Exception:
        pass
    return []


# ── Claude summarization ───────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a biotech investment analyst with deep expertise in clinical trial design
and drug development. You produce concise, evidence-based summaries for investors."""

_USER_PROMPT = """\
Generate a structured investment-focused summary for this clinical trial.
Return ONLY valid JSON — no markdown fences, no explanation.

=== TRIAL METADATA ===
NCT ID:       {nct_id}
Title:        {brief_title}
Phase:        {phase}
Status:       {overall_status}
Sponsor:      {lead_sponsor}
Indication:   {conditions}
Drug/regimen: {interventions}
Enrollment:   {enrollment}

=== BACKGROUND ===
{brief_summary}

=== OUTCOME MEASURES (from CT.gov results section) ===
{outcomes_text}

=== SAFETY (serious adverse events) ===
{ae_text}

=== PUBLISHED ABSTRACTS ===
{pubmed_text}

Return JSON with EXACTLY these keys:
{{
  "outcome":           "positive | negative | mixed | pending",
  "executive_summary": "2-3 sentences for an investor — what happened, why it matters",
  "primary_endpoint":  "what was measured and the numerical result",
  "key_metrics":       "ORR, OS, PFS, HR, p-value etc. in one compact sentence, or null",
  "safety_profile":    "brief safety summary or null",
  "patient_population":"N patients, indication, key inclusion criteria",
  "key_publications":  ["citation 1", "citation 2"],
  "investment_note":   "one sentence on investment relevance (approval path, market size, competition)",
  "data_quality":      "high | medium | low  (based on how complete the source data is)"
}}
"""


def _call_ai(data: dict[str, Any]) -> dict[str, Any] | None:
    if not ai_provider.is_available():
        placeholder = ai_provider.no_provider_placeholder(task="summary")
        placeholder["patient_population"] = f"{data.get('enrollment', '?')} patients"
        placeholder["key_publications"] = data.get("citations", [])[:2]
        return placeholder

    # Format outcomes for the prompt
    outcomes_lines: list[str] = []
    for om in data.get("outcome_measures", []):
        t = f"[{om.get('type','?')}] {om.get('title','')} ({om.get('time_frame','')})"
        vals = om.get("values", [])
        if vals:
            t += f" → {', '.join(vals[:4])}"
        outcomes_lines.append(t)
    outcomes_text = "\n".join(outcomes_lines) if outcomes_lines else "(no results posted yet)"

    ae_text     = "\n".join(data.get("ae_summary", [])) or "(none reported)"
    pubmed_text = "\n\n---\n\n".join(data.get("pubmed_abstracts", [])) or "(no publications found)"

    prompt = _USER_PROMPT.format(
        nct_id         = data.get("nct_id", ""),
        brief_title    = data.get("brief_title", ""),
        phase          = data.get("phase", ""),
        overall_status = data.get("overall_status", ""),
        lead_sponsor   = data.get("lead_sponsor", ""),
        conditions     = data.get("conditions", ""),
        interventions  = data.get("interventions", ""),
        enrollment     = data.get("enrollment", "?"),
        brief_summary  = data.get("brief_summary", "")[:500],
        outcomes_text  = outcomes_text[:2000],
        ae_text        = ae_text[:600],
        pubmed_text    = pubmed_text[:2000],
    )

    raw = ai_provider.call_ai(prompt, system=_SYSTEM_PROMPT, max_tokens=1024, task="clinical_kpi")
    if not raw:
        return None
    try:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        return json.loads(raw)
    except Exception as exc:
        print(f"[ClinicalSummary] AI parse error: {exc}", flush=True)
        return None


# ── Public entry point ─────────────────────────────────────────────────────────


def generate_summary(
    nct_id: str,
    ticker: str = "",
    company: str = "",
) -> dict[str, Any]:
    """
    Full pipeline: CT.gov → PubMed → Claude Sonnet.
    Returns a summary dict; caches by NCT ID with TTL (see clinical_cache_ttl).
    """
    nct_id = nct_id.strip().upper()
    if not nct_id.startswith("NCT"):
        return {"error": f"Invalid NCT ID: {nct_id}"}

    # Check cache (respect TTL)
    cache = _load_cache()
    cached = cache.get(nct_id)
    if cached and is_cache_fresh(cached, ts_keys=("generated_at",)):
        print(f"[ClinicalSummary] cache hit for {nct_id}", flush=True)
        return cached

    print(f"[ClinicalSummary] generating summary for {nct_id} ({company or ticker})", flush=True)

    # 1. Fetch CT.gov study data
    study = _ctgov_get(nct_id)
    if not study:
        return {"error": f"Could not fetch study data for {nct_id} from CT.gov"}

    extracted = _extract_results(study)

    # 2. PubMed: use PMIDs from CT.gov references, then search by NCT as fallback
    pmids = extracted.pop("pmids", [])
    if not pmids:
        pmids = _pubmed_search_pmids(nct_id)
    try:
        from pubmed_eutils_fetch import _efetch_pubmed_articles

        pm_hits = _efetch_pubmed_articles(pmids[:5])
        abstracts = [
            str(h.get("abstract_for_ai") or h.get("abstract") or "").strip()
            for h in pm_hits
            if h.get("abstract") or h.get("abstract_for_ai")
        ]
        extracted["pubmed_hits_structured"] = pm_hits
    except Exception:
        abstracts = _pubmed_fetch_abstracts(pmids)
    extracted["pubmed_abstracts"] = abstracts
    extracted["pubmed_pmids"]     = pmids

    # 3. AI summarization
    ai = _call_ai(extracted)

    result: dict[str, Any] = {
        "nct_id":      nct_id,
        "ticker":      ticker,
        "company":     company,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "has_results": extracted.get("has_results", False),
        # Raw data for reference
        "meta": {
            "brief_title":    extracted.get("brief_title", ""),
            "phase":          extracted.get("phase", ""),
            "overall_status": extracted.get("overall_status", ""),
            "enrollment":     extracted.get("enrollment"),
            "lead_sponsor":   extracted.get("lead_sponsor", ""),
            "conditions":     extracted.get("conditions", ""),
            "interventions":  extracted.get("interventions", ""),
        },
        "outcome_measures": extracted.get("outcome_measures", []),
        "ae_summary":       extracted.get("ae_summary", []),
        "citations":        extracted.get("citations", []),
        "pubmed_pmids":     pmids,
        # AI summary
        "ai": ai or {},
    }

    # Cache only if we got real data (not an error)
    if ai and not ai.get("error"):
        cache[nct_id] = result
        _save_cache(cache)

    return result


def get_protocol_meta(nct_id: str, company: str = "") -> dict[str, Any]:
    """
    Metadati protocollo CT.gov (senza AI) per banner Clinical UI.
    """
    nct_id = str(nct_id or "").strip().upper()
    if not nct_id.startswith("NCT"):
        return {"nct_id": nct_id, "error": "invalid_nct"}
    study = _ctgov_get(nct_id)
    if not study:
        return {"nct_id": nct_id, "error": "not_found"}
    extracted = _extract_results(study)
    protocol = study.get("protocolSection") or {}
    status_mod = protocol.get("statusModule") or {}
    sponsors = protocol.get("sponsorCollaboratorsModule") or {}
    arms_mod = protocol.get("armsInterventionsModule") or {}
    design = protocol.get("designModule") or {}

    collaborators = " | ".join(
        str((c or {}).get("name") or "").strip()
        for c in (sponsors.get("collaborators") or [])[:8]
        if str((c or {}).get("name") or "").strip()
    )
    intervention_types = " | ".join(
        dict.fromkeys(
            str((x or {}).get("type") or "").strip()
            for x in (arms_mod.get("interventions") or [])[:6]
            if str((x or {}).get("type") or "").strip()
        )
    )

    def _fmt_ctgov_date(struct) -> str:
        if not isinstance(struct, dict):
            return ""
        d = struct.get("date")
        if not d:
            return ""
        return str(d).strip()

    start_date = _fmt_ctgov_date(status_mod.get("startDateStruct"))
    last_update = _fmt_ctgov_date(status_mod.get("lastUpdatePostDateStruct"))
    study_type = str(design.get("studyType") or "").strip()

    relation = ""
    if str(company or "").strip():
        try:
            from data_orchestrator import (
                nct_relation_type_for_company_nct,
                _compute_sponsor_match_detailed,
            )

            relation = nct_relation_type_for_company_nct(company, nct_id)
            if (not relation or relation == "N/D") and extracted.get("lead_sponsor"):
                _det = _compute_sponsor_match_detailed(
                    company,
                    extracted.get("lead_sponsor") or "",
                    "",
                    collaborators,
                )
                _sm = str(_det.get("sponsor_match") or "").strip().lower()
                if _sm == "exact":
                    relation = "direct sponsor"
                elif _sm == "partial":
                    _ps = str(_det.get("partial_source") or "").strip()
                    if _ps and collaborators and _ps in collaborators.split(" | "):
                        relation = "collaborator"
                    else:
                        relation = "correlated company/subsidiary"
        except Exception:
            relation = ""

    return {
        "nct_id": nct_id,
        "brief_title": extracted.get("brief_title") or "",
        "official_title": extracted.get("official_title") or "",
        "phase": extracted.get("phase") or "",
        "overall_status": extracted.get("overall_status") or "",
        "conditions": extracted.get("conditions") or "",
        "interventions": extracted.get("interventions") or "",
        "intervention_type": intervention_types,
        "lead_sponsor": extracted.get("lead_sponsor") or "",
        "collaborators": collaborators,
        "study_type": study_type,
        "start_date": start_date,
        "last_update_posted_date": last_update,
        "nct_relation_type": relation,
        "source": "ctgov_v2",
    }
