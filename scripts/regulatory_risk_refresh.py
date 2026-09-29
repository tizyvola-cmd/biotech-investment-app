#!/usr/bin/env python3
"""
regulatory_risk_refresh.py — Automated regulatory risk snapshot (Lun–Ven, ~07:30 IT).

Scans portfolio and simulation tickers for regulatory signals:
  1. ``catalyst_feed_snapshot.json`` — SEC 8-K AI headlines / catalyst_type
  2. ``catalyst_feed_cache.json`` — cached filing extraction text
  3. ``sec_k8_simulation_snapshot.json`` — sheet labels (item codes; usually empty NLP)
  4. ``clinical_pre_cd_enrichment_snapshot.json`` — FDA designations, regulatory KPIs,
     press/8-K event titles (Phase 1 primary coverage lift)
  5. Writes ``data/regulatory_risk_snapshot.json`` — consumed by the frontend at runtime

The frontend merges this automatic snapshot with manual data in localStorage
(catalystAnalysisStore) — this file never writes to localStorage.

Scheduled by the web scheduler once per weekday after morning research.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import (
    DATA_DIR,
    INVEST_SIM_INPUTS_JSON,
    INVESTMENT_SIM_OUTCOMES_JSON,
    REGULATORY_RISK_SNAPSHOT_JSON,
    SIMULATION_SHEET_SNAPSHOT_JSON,
)

_log = logging.getLogger("regulatory_risk_refresh")

# ── Keyword lists ─────────────────────────────────────────────────────────────

CRL_KEYWORDS = [
    "complete response letter",
    "refuse to file",
    "refusal to file",
    "fda rejection",
    "warning letter",
    " not approved",
    " crl ",
    "crl.",
]

# PDUFA / submission risk — keep short tokens (nda/bla) padded so _kw_match
# applies word boundaries; bare "fda approval" removed (FP on foreign deals).
PDUFA_KEYWORDS = [
    "pdufa",
    "action date",
    "user fee",
    "new drug application",
    "biologics license",
    "nda submission",
    "bla submission",
    "nda accepted",
    "bla accepted",
    "nda filing",
    "bla filing",
    "under fda review",
    "fda accepted",
    "fda review",
    " nda ",
    " bla ",
]

CMC_KEYWORDS = [
    "cmc",
    "manufacturing",
    "chemistry, manufacturing",
    "facility",
    "gmp",
    "inspection",
    "deficiency",
    "manufacturing issue",
    "process validation",
]

# Positive catalyst keywords — confirmed good outcomes that reduce regulatory risk.
# These push the score NEGATIVE (lower = better outlook).
FDA_APPROVAL_KEYWORDS = [
    "fda approved",
    "fda approves",
    "fda grants approval",
    "approved by the fda",
    "approval granted",
    "marketing approval",
    "nda approved",
    "bla approved",
    "marketing authorization granted",
    "510(k) cleared",
    "510(k) clearance",
    "fda clearance",
    "fda cleared",
    "pma approved",
    "pma approval",
    "premarket approval granted",
]

POSITIVE_CATALYST_KEYWORDS = [
    "primary endpoint met",
    "primary endpoint achieved",
    "met its primary endpoint",
    "phase 3 success",
    "phase iii success",
    "pivotal trial met",
    "statistically significant improvement",
    "breakthrough therapy designation",
    "breakthrough therapy",
    "breakthrough device",
    "fda breakthrough",
    "fast track designation",
    "fast track",
    "priority review designation",
    "priority review",
    "orphan drug designation",
    "orphan drug",
    "accelerated approval",
    "ind clearance",
    "ind cleared",
    "positive topline",
    "positive top-line",
]

# Efficacy phrases that must NOT count as regulatory risk (CRL false friends).
_CRL_FALSE_FRIENDS = (
    "complete response rate",
    "overall response rate",
    "objective response rate",
    "confirmed response rate",
    "best overall response",
)

# When "facility" appears alongside these financial terms it refers to a loan/credit
# facility, not a manufacturing/GMP facility — exclude from CMC hits.
_FACILITY_FINANCIAL_CONTEXT = [
    "loan facility",
    "credit facility",
    "term loan",
    "revolving facility",
    "debt facility",
    "financing facility",
    "lending facility",
    "senior secured",
    "hercules",
    "silicon valley bank",
    "expand",
    "tranche",
    "milestone-based",
]

# Short PDUFA tokens need nearby submission/review context; exclude pre-BLA noise.
_PDUFA_SHORT_NEED_CONTEXT = frozenset({"nda", "bla"})
_PDUFA_SHORT_CONTEXT = (
    "submission",
    "submitted",
    "accepted",
    "filing",
    "filed",
    "pdufa",
    "user fee",
    "under review",
    "fda review",
)
_PDUFA_SHORT_EXCLUDE = (
    "pre-bla",
    "pre bla",
    "pre-nda",
    "pre nda",
    "prebla",
    "prenda",
)

# Foreign / non-US approval context — do not treat as US FDA approval/PDUFA.
_FOREIGN_REG_CONTEXT = (
    "japan",
    "pmda",
    " ema",
    "mhra",
    "nmpa",
    "health canada",
    " tga",
    "ce mark",
    "china ",
)


def _kw_match(text: str, keywords: list[str]) -> list[str]:
    """Return matched keywords (case-insensitive).

    Keywords with leading/trailing spaces (e.g. ``\" bla \"``) are treated as
    word-boundary matches — ``.strip()`` alone must not turn them into bare
    substrings (``bla`` inside ``pre-bla`` / random words).
    """
    if not text:
        return []
    lower = f" {text.lower()} "
    # Neutralize efficacy "complete response rate" before CRL family matches
    for ff in _CRL_FALSE_FRIENDS:
        lower = lower.replace(ff, " ")

    hits: list[str] = []
    for raw_kw in keywords:
        padded = raw_kw != raw_kw.strip()
        needle = raw_kw.strip().lower()
        if not needle:
            continue
        if padded or len(needle) <= 4:
            if not re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", lower):
                continue
        elif needle not in lower:
            continue

        _pdufa_tokenish = needle in _PDUFA_SHORT_NEED_CONTEXT or needle in {
            "bla submission",
            "nda submission",
            "bla filing",
            "nda filing",
            "bla accepted",
            "nda accepted",
        }
        if _pdufa_tokenish:
            if any(ex in lower for ex in _PDUFA_SHORT_EXCLUDE):
                continue
            if needle in _PDUFA_SHORT_NEED_CONTEXT and not any(
                ctx in lower for ctx in _PDUFA_SHORT_CONTEXT
            ):
                continue

        if needle in ("fda approval", "fda approved", "fda approves", "approval granted"):
            if any(fx in lower for fx in _FOREIGN_REG_CONTEXT):
                # Allow only when explicit US FDA phrasing co-occurs
                if "u.s. fda" not in lower and "us fda" not in lower and "fda of the united" not in lower:
                    continue

        hits.append(needle)
    return hits


# When "deficiency" appears in a stock-exchange compliance context it is a listing
# compliance notice, not an FDA manufacturing deficiency — exclude from CMC hits.
_DEFICIENCY_EXCHANGE_CONTEXT = [
    "nasdaq",
    "bid price",
    "listing",
    "exchange notice",
    "nyse",
    "stock exchange",
]


def _filter_cmc_false_positives(hits: list[str], text: str) -> list[str]:
    """Remove CMC false positives caused by financial/exchange context."""
    lower = text.lower()
    if "facility" in hits:
        if any(ctx in lower for ctx in _FACILITY_FINANCIAL_CONTEXT):
            hits = [h for h in hits if h != "facility"]
    if "deficiency" in hits:
        if any(ctx in lower for ctx in _DEFICIENCY_EXCHANGE_CONTEXT):
            hits = [h for h in hits if h != "deficiency"]
    return hits


# ── Data loaders ──────────────────────────────────────────────────────────────


def _load_json(path: str | Path) -> Any:
    p = Path(path)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _portfolio_tickers() -> set[str]:
    """All tickers from investment sim inputs (open positions)."""
    doc = _load_json(INVEST_SIM_INPUTS_JSON)
    tickers: set[str] = set()
    if not isinstance(doc, dict):
        return tickers
    inputs = doc.get("inputs") or {}
    for key, entry in inputs.items():
        if not isinstance(entry, dict):
            continue
        if entry.get("ignoreSheet") or entry.get("soldAt"):
            continue
        if (entry.get("capital") or 0) <= 0:
            continue
        ticker = str(key).split("|")[0].strip().upper()
        if ticker:
            tickers.add(ticker)
    return tickers


def _simulation_tickers() -> set[str]:
    """All tickers from simulation sheet snapshot."""
    doc = _load_json(SIMULATION_SHEET_SNAPSHOT_JSON)
    tickers: set[str] = set()
    if not isinstance(doc, dict):
        return tickers
    for row in doc.get("rows") or []:
        tk = str(row.get("Ticker") or "").strip().upper()
        if tk and re.match(r"^[A-Z][A-Z0-9.-]{0,9}$", tk):
            tickers.add(tk)
    return tickers


def _outcome_tickers() -> set[str]:
    """All tickers from closed outcomes (investment_sim_outcomes.json)."""
    doc = _load_json(INVESTMENT_SIM_OUTCOMES_JSON)
    tickers: set[str] = set()
    if not isinstance(doc, dict):
        return tickers
    for row in doc.get("rows") or []:
        tk = str(row.get("ticker") or "").strip().upper()
        if tk and re.match(r"^[A-Z][A-Z0-9.-]{0,9}$", tk):
            tickers.add(tk)
    return tickers


# ── Signal extraction ─────────────────────────────────────────────────────────

_CATALYST_FEED_SNAPSHOT = str(Path(DATA_DIR) / "catalyst_feed_snapshot.json")
_CATALYST_FEED_CACHE = str(Path(DATA_DIR) / "catalyst_feed_cache.json")
_CLINICAL_PRE_CD_SNAPSHOT = str(Path(DATA_DIR) / "clinical_pre_cd_enrichment_snapshot.json")

try:
    from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON
except ImportError:
    SEC_K8_SIMULATION_SNAPSHOT_JSON = str(Path(DATA_DIR) / "sec_k8_simulation_snapshot.json")

_SIGNAL_TYPES = ("crl", "pdufa", "cmc", "approved", "positive")

_NULLISH_RE = re.compile(
    r"^(n/?d|n\.?a\.?|none|null|unknown|—|-|no\b.*designation|nessuna\b)",
    re.I,
)

# Regulatory KPI labels/values worth emitting (allowlist).
_REG_INDICATOR_ALLOW = re.compile(
    r"510\s*\(\s*k\s*\)|510k|pma\b|breakthrough|orphan|fast\s*track|"
    r"accelerated\s+approval|priority\s+review|ind\s+clear|fda\s+clear|"
    r"fda\s+approv|bla\b|nda\b|pdufa|crl\b|complete\s+response\s+letter|"
    r"refuse\s+to\s+file|warning\s+letter|marketing\s+author",
    re.I,
)

_FDA_DESIGNATION_POSITIVE = re.compile(
    r"breakthrough|orphan|fast\s*track|priority\s+review|accelerated|"
    r"regenerative|rmat|qualified\s+infectious",
    re.I,
)


def _empty_signal_bucket() -> dict[str, Any]:
    return {"detected": False, "hits": [], "sources": []}


def _empty_entry(ticker: str) -> dict[str, Any]:
    return {
        "ticker": ticker,
        "crl": _empty_signal_bucket(),
        "pdufa": _empty_signal_bucket(),
        "cmc": _empty_signal_bucket(),
        "approved": _empty_signal_bucket(),
        "positive": _empty_signal_bucket(),
    }


def _add_hit(
    entry: dict[str, Any],
    signal_type: str,
    hits: list[str],
    source_info: dict[str, Any],
) -> None:
    if not hits:
        return
    bucket = entry.setdefault(signal_type, _empty_signal_bucket())
    bucket["detected"] = True
    bucket["hits"].extend(hits)
    bucket["sources"].append(source_info)


def _classify_text_hits(all_text: str) -> dict[str, list[str]]:
    """Run the five keyword families on a text blob."""
    crl_hits = _kw_match(all_text, CRL_KEYWORDS)
    # Guard: bare "complete response" without "letter" is usually ORR, not CRL
    crl_hits = [h for h in crl_hits if h != "complete response" or "complete response letter" in all_text.lower()]
    return {
        "crl": crl_hits,
        "pdufa": _kw_match(all_text, PDUFA_KEYWORDS),
        "cmc": _filter_cmc_false_positives(_kw_match(all_text, CMC_KEYWORDS), all_text),
        "approved": _kw_match(all_text, FDA_APPROVAL_KEYWORDS),
        "positive": _kw_match(all_text, POSITIVE_CATALYST_KEYWORDS),
    }


def _parse_iso_dt(raw: str | None) -> dt.datetime | None:
    if not raw:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _file_mtime_iso(path: str | Path) -> str | None:
    p = Path(path)
    if not p.is_file():
        return None
    try:
        return dt.datetime.fromtimestamp(p.stat().st_mtime, tz=dt.timezone.utc).isoformat()
    except OSError:
        return None


def _catalyst_feed_lag_days() -> float | None:
    """Days that catalyst_feed_snapshot lags behind sec_k8 (mtime)."""
    feed_m = _parse_iso_dt(_file_mtime_iso(_CATALYST_FEED_SNAPSHOT))
    k8_m = _parse_iso_dt(_file_mtime_iso(SEC_K8_SIMULATION_SNAPSHOT_JSON))
    if feed_m is None or k8_m is None:
        return None
    return max(0.0, (k8_m - feed_m).total_seconds() / 86400.0)


def refresh_catalyst_feed_if_stale(*, max_lag_days: float = 7.0, force: bool = False) -> dict[str, Any]:
    """Run catalyst_extractor when feed is behind sec_k8 (or ``force``).

    Returns a small status dict; never raises to the caller.
    """
    lag = _catalyst_feed_lag_days()
    if not force and (lag is None or lag < max_lag_days):
        return {"ran": False, "lag_days": lag, "reason": "fresh_or_unknown"}
    try:
        from catalyst_extractor import run_catalyst_feed_refresh

        result = run_catalyst_feed_refresh()
        return {"ran": True, "lag_days": lag, "result": result}
    except Exception as exc:
        _log.warning("catalyst feed refresh failed: %s", exc)
        return {"ran": False, "lag_days": lag, "error": str(exc)}


def _extract_from_catalyst_feed(tickers: set[str]) -> dict[str, dict[str, Any]]:
    """Scan catalyst_feed_snapshot.json for regulatory signals per ticker."""
    doc = _load_json(_CATALYST_FEED_SNAPSHOT)
    signals: dict[str, dict[str, Any]] = {}
    if not isinstance(doc, dict):
        return signals

    for event in doc.get("events") or []:
        ticker = str(event.get("ticker") or "").strip().upper()
        if ticker not in tickers:
            continue

        extracted = event.get("extracted") or {}
        headline = str(extracted.get("headline") or "")
        catalyst_type = str(extracted.get("catalyst_type") or "")
        next_milestone = str(extracted.get("next_milestone") or "")
        items_label = str(event.get("items_label") or "")
        filing_date = str(event.get("filing_date") or "")

        # Combine all text for keyword search
        all_text = " ".join([headline, catalyst_type, next_milestone, items_label])

        crl_hits      = _kw_match(all_text, CRL_KEYWORDS)
        pdufa_hits    = _kw_match(all_text, PDUFA_KEYWORDS)
        cmc_hits      = _filter_cmc_false_positives(_kw_match(all_text, CMC_KEYWORDS), all_text)
        approved_hits = _kw_match(all_text, FDA_APPROVAL_KEYWORDS)
        positive_hits = _kw_match(all_text, POSITIVE_CATALYST_KEYWORDS)

        has_any = crl_hits or pdufa_hits or cmc_hits or approved_hits or positive_hits or catalyst_type == "regulatory"
        if not has_any:
            continue

        entry = signals.setdefault(ticker, {
            "ticker": ticker,
            "crl":      {"detected": False, "hits": [], "sources": []},
            "pdufa":    {"detected": False, "hits": [], "sources": []},
            "cmc":      {"detected": False, "hits": [], "sources": []},
            "approved": {"detected": False, "hits": [], "sources": []},
            "positive": {"detected": False, "hits": [], "sources": []},
        })

        source_info = {
            "headline": headline,
            "filing_date": filing_date,
            "type": catalyst_type,
            "source": "catalyst_feed",
        }

        if crl_hits:
            entry["crl"]["detected"] = True
            entry["crl"]["hits"].extend(crl_hits)
            entry["crl"]["sources"].append(source_info)
        if pdufa_hits:
            entry["pdufa"]["detected"] = True
            entry["pdufa"]["hits"].extend(pdufa_hits)
            entry["pdufa"]["sources"].append(source_info)
        if cmc_hits:
            entry["cmc"]["detected"] = True
            entry["cmc"]["hits"].extend(cmc_hits)
            entry["cmc"]["sources"].append(source_info)
        if approved_hits:
            entry["approved"]["detected"] = True
            entry["approved"]["hits"].extend(approved_hits)
            entry["approved"]["sources"].append(source_info)
        if positive_hits:
            entry["positive"]["detected"] = True
            entry["positive"]["hits"].extend(positive_hits)
            entry["positive"]["sources"].append(source_info)

        # If classified as regulatory by AI but no specific keyword → flag generically
        if catalyst_type == "regulatory" and not any([crl_hits, pdufa_hits, cmc_hits, approved_hits, positive_hits]):
            entry["cmc"]["detected"] = True
            entry["cmc"]["hits"].append("regulatory_event")
            entry["cmc"]["sources"].append(source_info)

    return signals


def _extract_from_catalyst_cache(tickers: set[str]) -> dict[str, dict[str, Any]]:
    """Scan catalyst_feed_cache.json for keyword matches in cached filing texts.

    The cache is keyed by accession number (not ticker). Each value is an event
    dict with a "ticker" field and an "extracted" sub-dict containing the AI
    headline and other fields. We invert the structure to group by ticker first.
    """
    doc = _load_json(_CATALYST_FEED_CACHE)
    signals: dict[str, dict[str, Any]] = {}
    if not isinstance(doc, dict):
        return signals

    # Invert accession-keyed cache → ticker → [event, ...]
    by_ticker: dict[str, list[dict[str, Any]]] = {}
    for _acc, ev in doc.items():
        if not isinstance(ev, dict):
            continue
        ticker = str(ev.get("ticker") or "").strip().upper()
        if ticker:
            by_ticker.setdefault(ticker, []).append(ev)

    for ticker, events in by_ticker.items():
        if ticker not in tickers:
            continue
        for ev in events:
            extracted = ev.get("extracted") or {}
            headline = str(extracted.get("headline") or "")
            items_label = str(ev.get("items_label") or "")
            next_milestone = str(extracted.get("next_milestone") or "")
            # Skip placeholder entries written when no AI key was configured
            if "[ai provider not configured" in headline.lower():
                continue
            combined = f"{headline} {items_label} {next_milestone}"

            crl_hits      = _kw_match(combined, CRL_KEYWORDS)
            pdufa_hits    = _kw_match(combined, PDUFA_KEYWORDS)
            cmc_hits      = _filter_cmc_false_positives(_kw_match(combined, CMC_KEYWORDS), combined)
            approved_hits = _kw_match(combined, FDA_APPROVAL_KEYWORDS)
            positive_hits = _kw_match(combined, POSITIVE_CATALYST_KEYWORDS)

            if not any([crl_hits, pdufa_hits, cmc_hits, approved_hits, positive_hits]):
                continue

            entry = signals.setdefault(ticker, {
                "ticker": ticker,
                "crl":      {"detected": False, "hits": [], "sources": []},
                "pdufa":    {"detected": False, "hits": [], "sources": []},
                "cmc":      {"detected": False, "hits": [], "sources": []},
                "approved": {"detected": False, "hits": [], "sources": []},
                "positive": {"detected": False, "hits": [], "sources": []},
            })

            source_info = {
                "headline": headline[:120],
                "filing_date": str(ev.get("filing_date") or ""),
                "source": "catalyst_cache",
            }

            if crl_hits:
                entry["crl"]["detected"] = True
                entry["crl"]["hits"].extend(crl_hits)
                entry["crl"]["sources"].append(source_info)
            if pdufa_hits:
                entry["pdufa"]["detected"] = True
                entry["pdufa"]["hits"].extend(pdufa_hits)
                entry["pdufa"]["sources"].append(source_info)
            if cmc_hits:
                entry["cmc"]["detected"] = True
                entry["cmc"]["hits"].extend(cmc_hits)
                entry["cmc"]["sources"].append(source_info)
            if approved_hits:
                entry["approved"]["detected"] = True
                entry["approved"]["hits"].extend(approved_hits)
                entry["approved"]["sources"].append(source_info)
            if positive_hits:
                entry["positive"]["detected"] = True
                entry["positive"]["hits"].extend(positive_hits)
                entry["positive"]["sources"].append(source_info)

    return signals


def _sec_k8_content_stats(doc: dict[str, Any] | None) -> dict[str, Any]:
    """Honest diagnostics: sec_k8 rows are item labels, rarely FDA narrative."""
    rows = (doc or {}).get("rows") or [] if isinstance(doc, dict) else []
    item_701 = 0
    item_801 = 0
    narrative_rows = 0
    content_key = None
    if rows and isinstance(rows[0], dict):
        for k in rows[0]:
            if "contenuto" in str(k).lower() or "items" in str(k).lower():
                content_key = k
                break
    for row in rows:
        if not isinstance(row, dict):
            continue
        blob = " ".join(str(v) for v in row.values() if isinstance(v, str))
        low = blob.lower()
        if "7.01" in low:
            item_701 += 1
        if "8.01" in low:
            item_801 += 1
        cell = str(row.get(content_key) or "") if content_key else ""
        # Narrative = more than item codes / "Documento: 8-K"
        if len(cell) > 120 and re.search(r"fda|pdufa|crl|cmc|approv", cell, re.I):
            narrative_rows += 1
    return {
        "item_7_01_count": item_701,
        "item_8_01_count": item_801,
        "narrative_fda_rows": narrative_rows,
        "content_note": (
            "labels_only — sheet cells are Item codes (e.g. 2.02,7.01,9.01) + "
            "Documento: 8-K; FDA/PDUFA/CRL body text is not present. "
            "signals_found=0 with status ok means file exists, not 'no regulatory activity'."
        ),
    }


def _extract_from_sec_k8(tickers: set[str]) -> dict[str, dict[str, Any]]:
    """Scan sec_k8 sheet strings for keyword hits (usually none — labels only)."""
    doc = _load_json(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    signals: dict[str, dict[str, Any]] = {}
    if not isinstance(doc, dict):
        return signals

    for row in doc.get("rows") or []:
        ticker = str(row.get("Ticker") or "").strip().upper()
        if ticker not in tickers:
            continue

        content_cols = [str(v) for v in row.values() if isinstance(v, str) and len(v) >= 3]
        combined = " ".join(content_cols)
        families = _classify_text_hits(combined)
        if not any(families.values()):
            continue

        entry = signals.setdefault(ticker, _empty_entry(ticker))
        source_info = {"headline": combined[:120], "source": "sec_k8"}
        for signal_type, hits in families.items():
            _add_hit(entry, signal_type, hits, source_info)

    return signals


def _extract_from_clinical_pre_cd(tickers: set[str]) -> dict[str, dict[str, Any]]:
    """Phase 1: FDA designations + regulatory KPIs + strong press/8-K event titles."""
    doc = _load_json(_CLINICAL_PRE_CD_SNAPSHOT)
    signals: dict[str, dict[str, Any]] = {}
    if not isinstance(doc, dict):
        return signals

    for rec in doc.get("records") or []:
        if not isinstance(rec, dict):
            continue
        ticker = str(rec.get("ticker") or "").strip().upper()
        if not ticker or ticker not in tickers:
            continue

        entry = signals.get(ticker)
        if entry is None:
            entry = _empty_entry(ticker)

        # ── AI fda_designation → positive ──────────────────────────────────
        ai = rec.get("ai") or {}
        profile = ai.get("study_clinical_profile") if isinstance(ai, dict) else None
        if not isinstance(profile, dict):
            profile = {}
        fda_des = str(profile.get("fda_designation") or "").strip()
        if fda_des and not _NULLISH_RE.search(fda_des) and _FDA_DESIGNATION_POSITIVE.search(fda_des):
            label = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", fda_des)  # BreakthroughTherapy → Breakthrough Therapy
            _add_hit(
                entry,
                "positive",
                [f"fda_designation:{label}"],
                {
                    "headline": f"FDA designation: {label}"[:160],
                    "source": "clinical_pre_cd",
                    "kind": "fda_designation",
                },
            )

        # ── Allowlisted regulatory indicators ──────────────────────────────
        for ind in rec.get("clinical_indicators") or []:
            if not isinstance(ind, dict):
                continue
            if str(ind.get("kpi_type") or "").lower() != "regulatory":
                continue
            lab = str(ind.get("label") or "").strip()
            val = str(ind.get("value") or "").strip()
            blob = f"{lab} {val}".strip()
            if not blob or _NULLISH_RE.search(val) or _NULLISH_RE.search(lab):
                continue
            if not _REG_INDICATOR_ALLOW.search(blob):
                continue
            # Skip "no new designation" style notes
            if re.search(r"no new designation|not confirmed|nessuna designazione", blob, re.I):
                continue

            families = _classify_text_hits(blob)
            # Structured fallbacks when keyword lists miss CamelCase / short labels
            if not any(families.values()):
                low = blob.lower()
                if re.search(r"510\s*\(\s*k\s*\)|fda\s+clear|pma\s+approv", low):
                    families["approved"] = ["regulatory_indicator_clearance"]
                elif re.search(r"breakthrough|orphan|fast\s*track|accelerated|priority\s+review|ind\s+clear", low):
                    families["positive"] = ["regulatory_indicator_designation"]
                elif re.search(r"crl|complete response letter|refuse to file|warning letter", low):
                    families["crl"] = ["regulatory_indicator_crl"]
                elif re.search(r"pdufa|nda|bla", low):
                    families["pdufa"] = ["regulatory_indicator_pdufa"]

            if not any(families.values()):
                continue

            source_info = {
                "headline": blob[:160],
                "source": "clinical_pre_cd",
                "kind": "clinical_indicator",
                "indicator_date": str(ind.get("indicator_date") or ""),
            }
            for signal_type, hits in families.items():
                _add_hit(entry, signal_type, hits, source_info)

        # ── press_release / sec_8k event titles + summaries ─────────────────
        for ev in rec.get("clinical_events") or []:
            if not isinstance(ev, dict):
                continue
            st = str(ev.get("source_type") or "").lower()
            if st not in ("press_release", "sec_8k"):
                continue
            title = str(ev.get("event_title") or ev.get("title") or "").strip()
            summary = str(ev.get("summary") or "").strip()
            blob = f"{title} {summary}".strip()
            if len(blob) < 8:
                continue
            # Skip weak item-only 8-K titles without FDA lexicon
            if st == "sec_8k" and not re.search(
                r"fda|pdufa|crl|cmc|approv|breakthrough|orphan|fast\s*track|"
                r"510\s*\(|pma\b|ind\s+clear|refuse to file|warning letter",
                blob,
                re.I,
            ):
                continue

            families = _classify_text_hits(blob)
            if not any(families.values()):
                continue

            source_info = {
                "headline": (title or summary)[:160],
                "filing_date": str(ev.get("event_date") or ""),
                "source": "clinical_pre_cd",
                "kind": f"event:{st}",
            }
            for signal_type, hits in families.items():
                _add_hit(entry, signal_type, hits, source_info)

        if any(entry.get(t, {}).get("detected") for t in _SIGNAL_TYPES):
            signals[ticker] = entry

    return signals


def _merge_signals(
    a: dict[str, dict[str, Any]],
    b: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Merge two signal dicts, combining hits and sources per ticker."""
    merged = dict(a)
    for ticker, entry_b in b.items():
        if ticker not in merged:
            merged[ticker] = entry_b
            continue
        entry_a = merged[ticker]
        for signal_type in _SIGNAL_TYPES:
            b_sig = entry_b.get(signal_type, {})
            if b_sig.get("detected"):
                a_sig = entry_a.setdefault(signal_type, _empty_signal_bucket())
                a_sig["detected"] = True
                a_sig["hits"].extend(b_sig.get("hits", []))
                a_sig["sources"].extend(b_sig.get("sources", []))
    return merged


def _ticker_phase_map() -> dict[str, str]:
    """Best clinical phase per ticker from simulation sheet snapshot."""
    doc = _load_json(SIMULATION_SHEET_SNAPSHOT_JSON)
    phases: dict[str, str] = {}
    if not isinstance(doc, dict):
        return phases

    def _phase_rank(phase: str) -> int:
        p = phase.lower()
        if any(k in p for k in ("approv", "market", "commercial", "launched", "registrat")):
            return 5
        if re.search(r"phase\s*iii|phase\s*3|fase\s*iii|fase\s*3|pivotal", p):
            return 4
        if re.search(r"phase\s*ii|phase\s*2|fase\s*ii|fase\s*2", p):
            return 3
        if re.search(r"phase\s*i\b|phase\s*1|fase\s*i\b|fase\s*1", p):
            return 2
        if "preclinical" in p or "pre-clinical" in p:
            return 1
        return 0

    for row in doc.get("rows") or []:
        tk = str(row.get("Ticker") or "").strip().upper()
        if not tk:
            continue
        phase = ""
        for key, val in row.items():
            if re.search(r"fase|phase", str(key), re.I):
                phase = str(val or "").strip()
                break
        if not phase or phase == "—":
            continue
        prev = phases.get(tk)
        if not prev or _phase_rank(phase) > _phase_rank(prev):
            phases[tk] = phase

    return phases


def _clinical_phase_bonus(phase: str | None) -> int:
    if not phase:
        return 0
    p = phase.lower()
    if any(k in p for k in ("approv", "market", "commercial", "launched", "registrat")):
        return -35
    if re.search(r"phase\s*iii|phase\s*3|fase\s*iii|fase\s*3|pivotal", p):
        return -18
    if re.search(r"phase\s*ii|phase\s*2|fase\s*ii|fase\s*2", p):
        return -8
    if re.search(r"phase\s*i\b|phase\s*1|fase\s*i\b|fase\s*1", p):
        return -4
    if "preclinical" in p or "pre-clinical" in p:
        return -2
    return 0


def _has_active_risk(entry: dict[str, Any]) -> bool:
    return bool(
        entry.get("crl", {}).get("detected")
        or entry.get("pdufa", {}).get("detected")
        or entry.get("cmc", {}).get("detected")
    )


def _approved_hits_bonus(hits: list[str]) -> int:
    unique = list(dict.fromkeys(h.strip().lower() for h in hits if h and h.strip()))
    if not unique:
        return 0
    return -min(50, len(unique) * 15)


def _positive_hits_bonus(hits: list[str]) -> int:
    bonus = 0
    seen: set[str] = set()
    for raw in hits:
        lower = raw.lower().strip()
        if not lower or lower in seen:
            continue
        seen.add(lower)
        if re.search(r"fda approv|approval granted|marketing approval|nda approved|bla approved", lower):
            bonus -= 12
        elif re.search(r"primary endpoint|phase 3 success|phase iii success|pivotal trial", lower):
            bonus -= 10
        elif re.search(r"breakthrough|fast track|priority review|orphan drug|accelerated approval", lower):
            bonus -= 8
        else:
            bonus -= 5
    return max(-30, bonus)


def _compute_score(
    entry: dict[str, Any],
    *,
    clinical_phase: str | None = None,
    clean_scan: bool = False,
) -> int:
    """Bidirectional score -100..+100 matching frontend regulatoryRiskIndex.ts."""
    score = 0
    if entry.get("crl", {}).get("detected"):
        score += 50
    if entry.get("pdufa", {}).get("detected"):
        score += 35
    if entry.get("cmc", {}).get("detected"):
        score += 15

    if _has_active_risk(entry):
        return max(-100, min(100, score))

    approved = entry.get("approved", {})
    if approved.get("detected"):
        hits = approved.get("hits") or []
        score += _approved_hits_bonus(hits) if hits else -50

    positive = entry.get("positive", {})
    if positive.get("detected"):
        hits = positive.get("hits") or []
        score += _positive_hits_bonus(hits) if hits else -30

    phase_bonus = _clinical_phase_bonus(clinical_phase)
    score += phase_bonus

    has_favorable = bool(
        approved.get("detected")
        or positive.get("detected")
        or phase_bonus < 0
    )
    if not has_favorable and clean_scan:
        score -= 5

    return max(-100, min(100, score))


# ── Axis 2: Severity / Recoverability (keyword classification) ───────────────

# Must mirror the lists in regulatoryRiskIndex.ts — keep in sync
_CRL_CMC_REASON_KW = [
    "manufacturing", "cmc", "chemistry, manufacturing", "facility", "gmp",
    "inspection", "form 483", "process validation", "quality control",
    "supply chain", "packaging", "labeling", "sterility", "contamination",
]

_CRL_EFFICACY_SAFETY_KW = [
    "efficacy", "clinical hold", "safety signal", "additional trial",
    "additional study", "additional study required", "mortality",
    "adverse event", "adverse reaction", "failed endpoint",
    "primary endpoint not met", "lack of efficacy", "hepatotoxicity",
    "cardiotoxicity", "black box", "boxed warning", "patient death",
    "serious adverse", "insufficient evidence",
]


def _classify_crl_severity(entry: dict[str, Any]) -> dict[str, Any]:
    """Classify CRL reason into CMC (recoverable) vs efficacy/safety (severe).

    Returns dict with:
      severity_score: int | None (null if ambiguous/unclassified)
      crl_reason_bucket: "cmc_manufacturing" | "efficacy_safety" | "mixed" | "unclassified" | None
      crl_reason_source: "auto" | "manual_review_needed"
      cmc_matched: list[str]
      efficacy_matched: list[str]
    """
    has_crl = entry.get("crl", {}).get("detected", False)
    has_cmc = entry.get("cmc", {}).get("detected", False)

    if not has_crl and not has_cmc:
        return {
            "severity_score": 0,
            "crl_reason_bucket": None,
            "crl_reason_source": "auto",
            "cmc_matched": [],
            "efficacy_matched": [],
        }

    if has_crl:
        # Gather all CRL text from sources
        crl_texts = " ".join(
            s.get("headline", "") for s in entry.get("crl", {}).get("sources", [])
        ).lower()
        # Also include CMC hit texts
        cmc_texts = " ".join(entry.get("cmc", {}).get("hits", [])).lower()
        all_text = f"{crl_texts} {cmc_texts}"

        cmc_matched = [k for k in _CRL_CMC_REASON_KW if k in all_text]
        eff_matched = [k for k in _CRL_EFFICACY_SAFETY_KW if k in all_text]

        if eff_matched and not cmc_matched:
            return {
                "severity_score": 80,  # TODO: calibrate 70-90
                "crl_reason_bucket": "efficacy_safety",
                "crl_reason_source": "auto",
                "cmc_matched": cmc_matched,
                "efficacy_matched": eff_matched,
            }
        if cmc_matched and not eff_matched:
            return {
                "severity_score": 30,  # TODO: calibrate 20-40
                "crl_reason_bucket": "cmc_manufacturing",
                "crl_reason_source": "auto",
                "cmc_matched": cmc_matched,
                "efficacy_matched": eff_matched,
            }
        if cmc_matched and eff_matched:
            return {
                "severity_score": None,
                "crl_reason_bucket": "mixed",
                "crl_reason_source": "manual_review_needed",
                "cmc_matched": cmc_matched,
                "efficacy_matched": eff_matched,
            }
        # CRL detected, no keywords matched
        return {
            "severity_score": None,
            "crl_reason_bucket": "unclassified",
            "crl_reason_source": "manual_review_needed",
            "cmc_matched": [],
            "efficacy_matched": [],
        }

    # CMC only (no CRL)
    if has_cmc:
        return {
            "severity_score": 15,  # TODO: calibrate 10-20
            "crl_reason_bucket": None,
            "crl_reason_source": "auto",
            "cmc_matched": entry.get("cmc", {}).get("hits", []),
            "efficacy_matched": [],
        }

    return {
        "severity_score": 0,
        "crl_reason_bucket": None,
        "crl_reason_source": "auto",
        "cmc_matched": [],
        "efficacy_matched": [],
    }


# ── Main ──────────────────────────────────────────────────────────────────────


def _source_diagnostics(
    tickers: set[str],
    feed_signals: dict,
    cache_signals: dict,
    k8_signals: dict,
    clinical_signals: dict,
    *,
    catalyst_refresh: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return per-source scan stats to distinguish 'no data' from 'error'."""
    feed_doc = _load_json(_CATALYST_FEED_SNAPSHOT)
    cache_doc = _load_json(_CATALYST_FEED_CACHE)
    k8_doc = _load_json(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    clinical_doc = _load_json(_CLINICAL_PRE_CD_SNAPSHOT)

    feed_events_total = len((feed_doc or {}).get("events") or []) if isinstance(feed_doc, dict) else 0
    cache_entries_total = len(cache_doc) if isinstance(cache_doc, dict) else 0
    k8_rows_total = len((k8_doc or {}).get("rows") or []) if isinstance(k8_doc, dict) else 0
    clinical_records = len((clinical_doc or {}).get("records") or []) if isinstance(clinical_doc, dict) else 0

    ai_enriched = 0
    if isinstance(cache_doc, dict):
        for ev in cache_doc.values():
            if isinstance(ev, dict) and (ev.get("extracted") or {}).get("confidence", 0) > 0:
                ai_enriched += 1

    k8_stats = _sec_k8_content_stats(k8_doc if isinstance(k8_doc, dict) else None)
    lag = _catalyst_feed_lag_days()

    notes: list[str] = []
    if ai_enriched == 0 and cache_entries_total > 0:
        notes.append(
            "no_ai_data: catalyst_extractor.py ran but no AI provider was configured — "
            "add ANTHROPIC_API_KEY or GITHUB_TOKEN to .env and re-run."
        )
    if k8_doc is not None and len(k8_signals) == 0:
        notes.append(k8_stats["content_note"])
    if lag is not None and lag >= 7:
        notes.append(
            f"catalyst_feed_stale: snapshot is {lag:.1f}d behind sec_k8 mtime — "
            "pass --refresh-catalyst-feed or set REGULATORY_RISK_REFRESH_CATALYST=1."
        )

    return {
        "catalyst_feed": {
            "file_found": feed_doc is not None,
            "events_total": feed_events_total,
            "signals_found": len(feed_signals),
            "updated_at": (feed_doc or {}).get("updated_at") if isinstance(feed_doc, dict) else None,
            "mtime": _file_mtime_iso(_CATALYST_FEED_SNAPSHOT),
            "lag_days_vs_sec_k8": lag,
            "status": "ok" if feed_doc is not None else "file_missing",
        },
        "catalyst_cache": {
            "file_found": cache_doc is not None,
            "entries_total": cache_entries_total,
            "ai_enriched_entries": ai_enriched,
            "signals_found": len(cache_signals),
            "status": (
                "ok" if ai_enriched > 0
                else "no_ai_data" if cache_entries_total > 0
                else "file_missing" if cache_doc is None
                else "empty"
            ),
        },
        "sec_k8": {
            "file_found": k8_doc is not None,
            "rows_total": k8_rows_total,
            "signals_found": len(k8_signals),
            "mtime": _file_mtime_iso(SEC_K8_SIMULATION_SNAPSHOT_JSON),
            "item_7_01_count": k8_stats["item_7_01_count"],
            "item_8_01_count": k8_stats["item_8_01_count"],
            "narrative_fda_rows": k8_stats["narrative_fda_rows"],
            "status": (
                "labels_only"
                if k8_doc is not None and k8_stats["narrative_fda_rows"] == 0
                else "ok" if k8_doc is not None
                else "file_missing"
            ),
            "note": k8_stats["content_note"],
        },
        "clinical_pre_cd": {
            "file_found": clinical_doc is not None,
            "records_total": clinical_records,
            "signals_found": len(clinical_signals),
            "updated_at": (clinical_doc or {}).get("updated_at") if isinstance(clinical_doc, dict) else None,
            "status": "ok" if clinical_doc is not None else "file_missing",
        },
        "catalyst_refresh": catalyst_refresh,
        "scan_ticker_count": len(tickers),
        "note": " | ".join(notes) if notes else None,
    }


def build_regulatory_risk_snapshot(
    *,
    refresh_catalyst_if_stale: bool = False,
    force_catalyst_refresh: bool = False,
) -> dict[str, Any]:
    """Build the full snapshot. Can be called from the API as well."""
    catalyst_refresh: dict[str, Any] | None = None
    if refresh_catalyst_if_stale or force_catalyst_refresh:
        catalyst_refresh = refresh_catalyst_feed_if_stale(
            max_lag_days=7.0,
            force=force_catalyst_refresh,
        )

    tickers = _portfolio_tickers() | _simulation_tickers() | _outcome_tickers()
    if not tickers:
        return {"updated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "tickers": {}}

    feed_signals = _extract_from_catalyst_feed(tickers)
    cache_signals = _extract_from_catalyst_cache(tickers)
    k8_signals = _extract_from_sec_k8(tickers)
    clinical_signals = _extract_from_clinical_pre_cd(tickers)
    merged = _merge_signals(feed_signals, cache_signals)
    merged = _merge_signals(merged, k8_signals)
    merged = _merge_signals(merged, clinical_signals)
    phases = _ticker_phase_map()

    for ticker, entry in merged.items():
        for signal_type in _SIGNAL_TYPES:
            if signal_type in entry:
                entry[signal_type]["hits"] = list(dict.fromkeys(entry[signal_type]["hits"]))
        entry["severity"] = _classify_crl_severity(entry)
        phase = phases.get(ticker)
        if phase:
            entry["clinical_phase"] = phase
        entry["score"] = _compute_score(
            entry,
            clinical_phase=phase,
            clean_scan=False,
        )

    _empty_severity = _classify_crl_severity({})
    for ticker in sorted(tickers):
        if ticker not in merged:
            merged[ticker] = {
                **_empty_entry(ticker),
                "severity": _empty_severity,
                "no_signals": True,
            }
        entry = merged[ticker]
        phase = phases.get(ticker)
        if phase:
            entry["clinical_phase"] = phase
        if entry.get("no_signals"):
            entry["score"] = _compute_score(
                entry,
                clinical_phase=phase,
                clean_scan=True,
            )

    diagnostics = _source_diagnostics(
        tickers,
        feed_signals,
        cache_signals,
        k8_signals,
        clinical_signals,
        catalyst_refresh=catalyst_refresh,
    )
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    return {
        "updated_at": now_iso,
        "last_successful_update": now_iso,
        "update_status": "ok",
        "ticker_count": len(tickers),
        "signal_count": sum(1 for e in merged.values() if not e.get("no_signals")),
        "diagnostics": diagnostics,
        "tickers": merged,
    }


def save_snapshot(snapshot: dict[str, Any]) -> None:
    p = Path(REGULATORY_RISK_SNAPSHOT_JSON)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Regulatory risk snapshot refresh")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument(
        "--refresh-catalyst-feed",
        action="store_true",
        help="Force catalyst_extractor refresh before building the snapshot",
    )
    args = ap.parse_args()

    if not args.quiet:
        print(f"[RegulatoryRisk] Starting regulatory risk refresh — {dt.datetime.now().isoformat(timespec='seconds')}")

    env_refresh = os.environ.get("REGULATORY_RISK_REFRESH_CATALYST", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    snapshot = build_regulatory_risk_snapshot(
        refresh_catalyst_if_stale=env_refresh or args.refresh_catalyst_feed,
        force_catalyst_refresh=args.refresh_catalyst_feed,
    )

    if args.dry_run:
        # Compact dry-run: diagnostics + signal tickers only
        compact = {
            "updated_at": snapshot.get("updated_at"),
            "ticker_count": snapshot.get("ticker_count"),
            "signal_count": snapshot.get("signal_count"),
            "diagnostics": snapshot.get("diagnostics"),
            "signal_tickers": sorted(
                t
                for t, e in (snapshot.get("tickers") or {}).items()
                if isinstance(e, dict) and not e.get("no_signals")
            ),
        }
        print(json.dumps(compact, indent=2, ensure_ascii=False))
        return 0

    save_snapshot(snapshot)
    sig_count = snapshot.get("signal_count", 0)
    tk_count = snapshot.get("ticker_count", 0)
    if not args.quiet:
        diag = snapshot.get("diagnostics") or {}
        clin = (diag.get("clinical_pre_cd") or {}).get("signals_found")
        print(
            f"[RegulatoryRisk] Done — {sig_count} signals / {tk_count} tickers "
            f"(clinical_pre_cd={clin}) → {REGULATORY_RISK_SNAPSHOT_JSON}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
