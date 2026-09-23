#!/usr/bin/env python3
"""
Cross-check medtech_symbols.json against multiple independent sources.

  py -3 scripts/audit_medtech_universe.py
  py -3 scripts/audit_medtech_universe.py --json-only

Sources:
  1. Current medtech_symbols.json + hardcoded CURATED_MEDTECH
  2. yfinance top-10 holdings (IHI, XHE, IXJ, IHE) — note: yfinance caps at ~10
  3. Reference IHI/XHE constituent lists (public fund composition, ~52 + ~60 names)
  4. yf.json + SEC company titles with device/diagnostic keywords
  5. CT.gov INDUSTRY + DEVICE studies with CD <= 365d (mapped sponsors)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, timedelta

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from medtech_universe import (  # noqa: E402
    CURATED_MEDTECH,
    EXCLUDE_CTGOV_TICKERS,
    MEDTECH_SYMBOLS_JSON,
    REFERENCE_IHI,
    REFERENCE_SMALL_CAP,
    REFERENCE_XHE,
    _parse_iso_date,
    build_name_ticker_map,
    fetch_etf_holdings,
    load_json_list,
    match_sponsor_to_ticker,
    reference_medtech_symbols,
)

DATA = os.path.join(ROOT, "data")
YF_JSON = os.path.join(DATA, "yf.json")
SEC_JSON = os.path.join(DATA, "sec_company_tickers.json")
REPORT_JSON = os.path.join(DATA, "medtech_universe_gap_report.json")

NAME_PATTERNS = re.compile(
    r"\b("
    r"medical device|medtech|surgical|diagnostic|orthopedic|orthopaedic|"
    r"cardiovascular|implant|prosthetic|robotic surgery|health care equipment|"
    r"healthcare equipment|biomedical|in vitro|ivd|dental|endoscop|"
    r"pacemaker|defibrillator|ultrasound|life science instrument|"
    r"neuromodulation|electrophysiology|hemodialysis|insulin pump|"
    r"continuous glucose|surgical robot|tympanic|catheter|biomaterial|510\s*\(\s*k\s*\)"
    r")\b",
    re.I,
)

TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,5}$")

EXCLUDE_TICKERS = EXCLUDE_CTGOV_TICKERS | frozenset(
    {
        "NTRA", "ILMN", "EXAS", "DHR", "IQV", "LH", "WAT", "TECH", "RGEN", "DGX",
        "TXN", "VECO", "JAZZ", "ELAN", "ZTS", "VTRS", "RPRX", "CORT", "LQDA", "TVTX",
        "PASW", "PBM",
    }
)


def yf_top_holdings_union() -> set[str]:
    out: set[str] = set()
    try:
        import yfinance as yf
    except ImportError:
        return out
    for etf in ("IHI", "XHE", "IXJ", "IHE"):
        try:
            th = yf.Ticker(etf).funds_data.top_holdings
            if th is None or getattr(th, "empty", True):
                continue
            for sym in th.index:
                tk = str(sym).strip().upper()
                if TICKER_RE.match(tk):
                    out.add(tk)
        except Exception:
            pass
    return out


def load_name_hits(path: str, *, name_key: str, sym_key: str) -> dict[str, str]:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    out: dict[str, str] = {}
    if isinstance(raw, dict):
        items = raw.values()
    elif isinstance(raw, list):
        items = raw
    else:
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        sym = str(item.get(sym_key) or "").strip().upper()
        name = str(item.get(name_key) or "")
        if sym and NAME_PATTERNS.search(name) and sym not in EXCLUDE_TICKERS:
            out[sym] = name
    return out


def ctgov_device_tickers(*, horizon_days: int = 365, max_pages: int = 30) -> set[str]:
    name_map = build_name_ticker_map()
    today = date.today()
    end = today + timedelta(days=horizon_days)
    tickers: set[str] = set()
    page_token: str | None = None
    pages = 0
    while pages < max_pages:
        params: dict = {
            "filter.advanced": "AREA[LeadSponsorClass]INDUSTRY AND AREA[InterventionType]DEVICE",
            "pageSize": 100,
        }
        if page_token:
            params["pageToken"] = page_token
        r = requests.get("https://clinicaltrials.gov/api/v2/studies", params=params, timeout=45)
        r.raise_for_status()
        data = r.json()
        for study in data.get("studies") or []:
            p = study.get("protocolSection") or {}
            status = p.get("statusModule") or {}
            sponsor = p.get("sponsorCollaboratorsModule") or {}
            pc = (status.get("primaryCompletionDateStruct") or {}).get("date", "")
            cd = (status.get("completionDateStruct") or {}).get("date", "")
            dt = _parse_iso_date(pc or cd)
            if dt is None or dt < today or dt > end:
                continue
            lead = (sponsor.get("leadSponsor") or {}).get("name", "")
            tk = match_sponsor_to_ticker(lead, name_map)
            if tk and tk not in EXCLUDE_TICKERS:
                tickers.add(tk)
        pages += 1
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return tickers


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit medtech universe gaps")
    ap.add_argument("--json-only", action="store_true")
    args = ap.parse_args()

    med = set(load_json_list(MEDTECH_SYMBOLS_JSON))
    curated = set(reference_medtech_symbols())
    etf_top = fetch_etf_holdings()
    etf_yf_union = yf_top_holdings_union()
    ref_ihi = set(REFERENCE_IHI)
    ref_xhe = set(REFERENCE_XHE)
    ref_small = set(REFERENCE_SMALL_CAP)
    ref_union = set(reference_medtech_symbols())

    yf_hits = load_name_hits(YF_JSON, name_key="companyName", sym_key="symbol")
    sec_hits = load_name_hits(SEC_JSON, name_key="title", sym_key="ticker")
    ct_tickers = ctgov_device_tickers()

    gap_ihi = sorted(ref_ihi - med)
    gap_xhe = sorted(ref_xhe - med)
    gap_ref = sorted(ref_union - med)
    gap_ct = sorted(ct_tickers - med)
    gap_yf = sorted(set(yf_hits) - med)
    gap_sec = sorted(set(sec_hits) - med)

    priority = sorted((ref_union | ct_tickers) - med - EXCLUDE_TICKERS)

    report = {
        "generated_at": date.today().isoformat(),
        "current_count": len(med),
        "curated_count": len(curated),
        "etf_top10_yfinance_count": len(etf_top),
        "etf_top10_new_vs_curated": len(etf_top - curated),
        "reference_ihi_count": len(ref_ihi),
        "reference_xhe_count": len(ref_xhe),
        "reference_union_count": len(ref_union),
        "missing_from_reference_ihi": gap_ihi,
        "missing_from_reference_xhe": gap_xhe,
        "missing_from_reference_union": gap_ref,
        "missing_from_ctgov_365d": gap_ct,
        "missing_from_yf_names": gap_yf,
        "missing_from_sec_names": gap_sec,
        "priority_gaps": priority,
        "priority_gap_count": len(priority),
        "estimated_full_universe_if_merged": len(med | ref_union | ct_tickers),
        "current_tickers": sorted(med),
        "notes": [
            "Current 50 tickers are almost entirely the hand-curated seed list.",
            "yfinance ETF top_holdings returns only ~10 names per fund and adds 0 new tickers vs curated.",
            "Reference IHI/XHE lists target ~90-110 US medtech names when merged.",
        ],
    }

    os.makedirs(DATA, exist_ok=True)
    with open(REPORT_JSON, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)

    if args.json_only:
        print(REPORT_JSON)
        return 0

    print("=== MedTech universe cross-check ===\n")
    print(f"Current medtech_symbols.json     : {len(med)}")
    print(f"Hardcoded CURATED_MEDTECH        : {len(curated)}")
    print(f"yfinance ETF top-10 (IHI+XHE)    : {len(etf_top)} new vs curated: {len(etf_top - curated)}")
    print(f"Reference IHI constituents       : {len(ref_ihi)}  missing: {len(gap_ihi)}")
    print(f"Reference XHE constituents       : {len(ref_xhe)}  missing: {len(gap_xhe)}")
    print(f"Reference union (IHI+XHE+small)  : {len(ref_union)}  missing: {len(gap_ref)}")
    print(f"CT.gov device CD<=365d mapped    : {len(ct_tickers)}  missing: {len(gap_ct)} -> {', '.join(gap_ct)}")
    print(f"yf.json device-ish names         : missing {len(gap_yf)}")
    print(f"SEC title device-ish             : missing {len(gap_sec)}")
    print()
    print(f"PRIORITY GAPS (reference U CT.gov, excl. pharma): {len(priority)}")
    for tk in priority[:45]:
        src = []
        if tk in ref_ihi:
            src.append("IHI")
        if tk in ref_xhe:
            src.append("XHE")
        if tk in ref_small:
            src.append("small")
        if tk in ct_tickers:
            src.append("CT.gov")
        print(f"  {tk:6} [{', '.join(src)}]")
    if len(priority) > 45:
        print(f"  ... +{len(priority) - 45} more")
    print()
    print(f"If we merge current + reference + CT.gov -> ~{report['estimated_full_universe_if_merged']} tickers")
    print(f"Full report: {REPORT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
