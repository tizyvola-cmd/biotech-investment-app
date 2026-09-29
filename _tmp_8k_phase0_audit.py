#!/usr/bin/env python3
"""Phase 0 read-only audit of ticker_8k_dossier_cache.json — no mutations."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

CACHE = Path(r"c:\coding\Biotech_Investment app 6\_tmp_8k_cache_vps.json")
OUT = Path(r"c:\coding\Biotech_Investment app 6\_tmp_8k_phase0_audit.json")

doc = json.loads(CACHE.read_text(encoding="utf-8"))
entries = doc.get("entries") or {}

all_filings: list[dict] = []
for tk, ent in entries.items():
    dossier = (ent or {}).get("dossier") or {}
    updated = (ent or {}).get("updated_at")
    for f in dossier.get("filings") or []:
        if not isinstance(f, dict):
            continue
        row = dict(f)
        row["_ticker"] = tk
        row["_entry_updated_at"] = updated
        all_filings.append(row)

all_filings.sort(key=lambda f: str(f.get("filing_date") or ""), reverse=True)

# digest_method distribution
methods = Counter(str(f.get("digest_method") or "MISSING") for f in all_filings)

# recent gemini samples
gemini = [f for f in all_filings if str(f.get("digest_method") or "") in ("gemini", "sec_8k_gemini")]
extractive = [f for f in all_filings if str(f.get("digest_method") or "") not in ("gemini", "sec_8k_gemini")]

# pick 15 most recent gemini
samples = []
for f in gemini[:15]:
    sessions = f.get("sessions") or []
    samples.append(
        {
            "ticker": f.get("_ticker"),
            "filing_date": f.get("filing_date"),
            "form": f.get("form"),
            "title": f.get("title"),
            "items_raw": f.get("items_raw"),
            "digest_method": f.get("digest_method"),
            "financial_score": f.get("financial_score"),
            "clinical_score": f.get("clinical_score"),
            "corporate_score": f.get("corporate_score"),
            "eis_score": f.get("eis_score"),
            "link": f.get("link"),
            "sessions": [
                {
                    "item": s.get("item"),
                    "item_title": s.get("item_title"),
                    "title": s.get("title"),
                    "summary": s.get("summary"),
                }
                for s in sessions
                if isinstance(s, dict)
            ],
        }
    )

# Item codes of interest
ITEM_RE = re.compile(r"\b([1-9]\.\d{2})\b")
interest = {"2.02", "7.01", "8.01", "5.02"}


def items_of(f: dict) -> set[str]:
    found: set[str] = set()
    raw = str(f.get("items_raw") or "")
    for m in ITEM_RE.finditer(raw):
        found.add(m.group(1))
    for s in f.get("sessions") or []:
        if isinstance(s, dict) and s.get("item"):
            code = str(s.get("item")).strip()
            if re.match(r"^\d\.\d{2}$", code):
                found.add(code)
    return found


item_counts = Counter()
filings_with_interest = 0
for f in all_filings:
    its = items_of(f)
    for c in its:
        if c in interest:
            item_counts[c] += 1
    if its & interest:
        filings_with_interest += 1

# Score mismatch: clinical or corporate nonzero, financial ≈ 0
def near0(x) -> bool:
    try:
        return abs(float(x)) < 0.15
    except (TypeError, ValueError):
        return True  # missing treated as ~0 for UI Fin badge


def nonzero(x) -> bool:
    try:
        return abs(float(x)) >= 0.15
    except (TypeError, ValueError):
        return False


mismatch = []
for f in all_filings:
    fin = f.get("financial_score")
    clin = f.get("clinical_score")
    corp = f.get("corporate_score")
    if near0(fin) and (nonzero(clin) or nonzero(corp)):
        mismatch.append(
            {
                "ticker": f.get("_ticker"),
                "filing_date": f.get("filing_date"),
                "title": (f.get("title") or "")[:120],
                "items_raw": f.get("items_raw"),
                "financial_score": fin,
                "clinical_score": clin,
                "corporate_score": corp,
                "eis_score": f.get("eis_score"),
                "news_kind": f.get("news_kind"),
                "digest_method": f.get("digest_method"),
            }
        )

# numeric specificity heuristic on gemini summaries
NUM_RE = re.compile(
    r"(?i)\$\s?\d|\d+(?:\.\d+)?\s*%|\b(?:Q[1-4]|2H|1H)\s*20\d{2}\b|"
    r"\b20\d{2}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|"
    r"September|October|November|December)\s+\d{1,2},?\s+20\d{2}\b|"
    r"\b(?:Phase\s*[I1-3]+|Ph\.?\s*[1-3]|NCT\d{8})\b|"
    r"\b(?:million|billion)\b"
)
gemini_sess_n = 0
gemini_sess_with_num = 0
for f in gemini:
    for s in f.get("sessions") or []:
        if not isinstance(s, dict):
            continue
        sm = str(s.get("summary") or "")
        if not sm.strip():
            continue
        gemini_sess_n += 1
        if NUM_RE.search(sm):
            gemini_sess_with_num += 1

# cache meta
tickers = sorted(entries.keys())
report = {
    "cache_source": "VPS /opt/biotech/data/ticker_8k_dossier_cache.json",
    "cache_file_mtime_note": "copied 2026-09-19 for audit",
    "ticker_count": len(tickers),
    "tickers": tickers,
    "filing_count": len(all_filings),
    "digest_method_counts": dict(methods),
    "gemini_count": len(gemini),
    "non_gemini_count": len(extractive),
    "gemini_pct": round(100 * len(gemini) / len(all_filings), 1) if all_filings else 0,
    "extractive_or_other_pct": round(100 * len(extractive) / len(all_filings), 1) if all_filings else 0,
    "gemini_sessions_total": gemini_sess_n,
    "gemini_sessions_with_numeric_heuristic": gemini_sess_with_num,
    "gemini_sessions_numeric_pct": round(100 * gemini_sess_with_num / gemini_sess_n, 1) if gemini_sess_n else 0,
    "item_interest_filing_counts": dict(item_counts),
    "filings_with_any_interest_item": filings_with_interest,
    "score_mismatch_fin0_other_nonzero_count": len(mismatch),
    "score_mismatch_examples": mismatch[:25],
    "gemini_samples_raw": samples,
    "limitations": [
        "Cache does not store raw primary/exhibit text or exhibit-fetched flags → B4/B6 not measurable from cache alone.",
        "Cache does not store classification_method / heuristic_fill flags → C8 activation count not measurable from cache.",
    ],
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: report[k] for k in report if k != "gemini_samples_raw"}, indent=2))
print("--- SAMPLES COUNT", len(samples))
