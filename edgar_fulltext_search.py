"""
EDGAR Full-Text Search (efts.sec.gov) — thin client for universe discovery.

Endpoint: GET https://efts.sec.gov/LATEST/search-index
No auth. Requires a descriptive User-Agent.

Does **not** use the submissions JSON path (8-K sheet / catalyst_extractor).
"""

from __future__ import annotations

import os
import re
import time
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote, urlencode

import requests

EDGAR_USER_AGENT = os.environ.get(
    "SEC_EDGAR_USER_AGENT",
    "biotech-investment-app research@example.com",
)
EFTS_BASE = "https://efts.sec.gov/LATEST/search-index"
EFTS_SLEEP_SEC = float(os.environ.get("SEC_EFTS_SLEEP_SEC", "0.25"))
EFTS_PAGE_SIZE = 10  # fixed by SEC
EFTS_MAX_HITS = int(os.environ.get("SEC_EFTS_MAX_HITS", "200"))

_HEADERS = {
    "User-Agent": EDGAR_USER_AGENT,
    "Accept": "application/json",
    "Accept-Encoding": "gzip, deflate",
}

# Biotech / pharma SIC codes from the brief.
BIOTECH_SICS = frozenset({"2833", "2834", "2835", "2836"})

_TICKER_IN_DISPLAY = re.compile(
    r"\(\s*([A-Z][A-Z0-9.\-]{0,9})\s*\)\s*(?:\(CIK|\(CIK\s)",
    re.I,
)
_TICKER_FALLBACK = re.compile(r"\(\s*([A-Z]{1,5})\s*\)")
_CIK_IN_DISPLAY = re.compile(r"CIK\s*0*(\d+)", re.I)


def _sleep() -> None:
    time.sleep(EFTS_SLEEP_SEC)


def search_fulltext(
    query: str,
    *,
    forms: str = "8-K",
    start: date | str | None = None,
    end: date | str | None = None,
    sics: str | None = None,
    max_hits: int = EFTS_MAX_HITS,
) -> dict[str, Any]:
    """
    Paginated full-text search. Returns:
      hits: list of normalized hit dicts
      total: int | None
      aggregations: raw aggs (may include sic_filter)
      sics_param_effective: bool | None — whether request ``sics`` appeared to filter
    """
    if start is None:
        start = date.today() - timedelta(days=7)
    if end is None:
        end = date.today()
    start_s = start.isoformat() if isinstance(start, date) else str(start)[:10]
    end_s = end.isoformat() if isinstance(end, date) else str(end)[:10]

    # Phrase queries: wrap in quotes if not already.
    q = query.strip()
    if q and not (q.startswith('"') and q.endswith('"')):
        q = f'"{q}"'

    all_hits: list[dict[str, Any]] = []
    total: int | None = None
    aggregations: dict[str, Any] = {}
    from_off = 0
    pages = 0
    max_pages = max(1, (max_hits + EFTS_PAGE_SIZE - 1) // EFTS_PAGE_SIZE)

    while from_off < max_hits and pages < max_pages:
        params: dict[str, str] = {
            "q": q,
            "forms": forms,
            "dateRange": "custom",
            "startdt": start_s,
            "enddt": end_s,
            "from": str(from_off),
        }
        if sics:
            params["sics"] = sics
        url = f"{EFTS_BASE}?{urlencode(params, quote_via=quote)}"
        _sleep()
        try:
            r = requests.get(url, headers=_HEADERS, timeout=45)
        except Exception as exc:
            return {
                "hits": all_hits,
                "total": total,
                "aggregations": aggregations,
                "error": str(exc),
                "sics_param_effective": None,
            }
        if r.status_code != 200:
            return {
                "hits": all_hits,
                "total": total,
                "aggregations": aggregations,
                "error": f"HTTP {r.status_code}: {r.text[:200]}",
                "sics_param_effective": None,
            }
        try:
            data = r.json()
        except Exception as exc:
            return {
                "hits": all_hits,
                "total": total,
                "aggregations": aggregations,
                "error": f"JSON: {exc}",
                "sics_param_effective": None,
            }

        if not aggregations and isinstance(data.get("aggregations"), dict):
            aggregations = data["aggregations"]

        hits_block = data.get("hits") or {}
        if total is None:
            tv = hits_block.get("total")
            if isinstance(tv, dict):
                total = int(tv.get("value") or 0)
            elif isinstance(tv, int):
                total = tv

        batch = hits_block.get("hits") or []
        if not batch:
            break
        for h in batch:
            norm = normalize_efts_hit(h)
            if norm:
                all_hits.append(norm)
        if len(batch) < EFTS_PAGE_SIZE:
            break
        from_off += EFTS_PAGE_SIZE
        pages += 1

    sics_effective = None
    if sics:
        wanted = {x.strip() for x in sics.split(",") if x.strip()}
        seen = {str(h.get("sic") or "").strip() for h in all_hits if h.get("sic")}
        # If we got hits outside wanted SICs, server filter did not apply.
        if seen:
            sics_effective = seen.issubset(wanted)

    return {
        "hits": all_hits[:max_hits],
        "total": total,
        "aggregations": aggregations,
        "error": None,
        "sics_param_effective": sics_effective,
        "query": q,
        "startdt": start_s,
        "enddt": end_s,
    }


def normalize_efts_hit(raw: dict[str, Any]) -> dict[str, Any] | None:
    src = raw.get("_source") if isinstance(raw, dict) else None
    if not isinstance(src, dict):
        return None
    ciks = src.get("ciks") or []
    cik = ""
    if isinstance(ciks, list) and ciks:
        cik = str(ciks[0]).zfill(10)
    elif ciks:
        cik = str(ciks).zfill(10)

    display_names = src.get("display_names") or []
    display = ""
    if isinstance(display_names, list) and display_names:
        display = str(display_names[0])
    elif display_names:
        display = str(display_names)

    ticker, company = parse_display_name(display)
    if not cik:
        m = _CIK_IN_DISPLAY.search(display)
        if m:
            cik = m.group(1).zfill(10)

    sic = _extract_sic(src)
    adsh = str(src.get("adsh") or "").strip()
    file_date = str(src.get("file_date") or "").strip()[:10]
    form = str(src.get("form") or src.get("root_forms") or "8-K")
    if isinstance(src.get("root_forms"), list) and src["root_forms"]:
        form = str(src["root_forms"][0])

    snippet = ""
    hl = raw.get("highlight") or {}
    if isinstance(hl, dict):
        for v in hl.values():
            if isinstance(v, list) and v:
                snippet = re.sub(r"<[^>]+>", "", str(v[0]))
                break
    if not snippet:
        snippet = str(src.get("file_description") or src.get("file_type") or "")[:280]

    filing_url = ""
    if cik and adsh:
        flat = adsh.replace("-", "")
        cik_int = str(int(cik))
        filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{flat}/"

    return {
        "cik": cik,
        "ticker": (ticker or "").upper(),
        "company_name": company or display.split("(")[0].strip(),
        "display_name": display,
        "sic": sic,
        "form": form,
        "file_date": file_date,
        "adsh": adsh,
        "items": src.get("items"),
        "snippet": snippet[:400],
        "source_filing_url": filing_url,
        "raw_source": {k: src.get(k) for k in ("sics", "sic", "biz_locations", "file_type")},
    }


def parse_display_name(display: str) -> tuple[str | None, str]:
    """'Foo Inc.  (FOO)  (CIK 0001234567)' → ('FOO', 'Foo Inc.')."""
    raw = (display or "").strip()
    if not raw:
        return None, ""
    company = raw.split("(")[0].strip()
    m = _TICKER_IN_DISPLAY.search(raw)
    if m:
        return m.group(1).upper(), company
    # Avoid matching (CIK …)
    for m2 in _TICKER_FALLBACK.finditer(raw):
        tok = m2.group(1).upper()
        if tok == "CIK":
            continue
        return tok, company
    return None, company


def _extract_sic(src: dict[str, Any]) -> str:
    for key in ("sics", "sic", "sic_codes"):
        val = src.get(key)
        if val is None:
            continue
        if isinstance(val, list) and val:
            return str(val[0]).strip()
        s = str(val).strip()
        if s.isdigit() or (len(s) == 4 and s[:4].isdigit()):
            return s[:4]
    return ""


def filter_hits_by_sic(
    hits: list[dict[str, Any]],
    allowed: frozenset[str] = BIOTECH_SICS,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for h in hits:
        sic = str(h.get("sic") or "").strip()
        if not sic:
            # Keep unknown SIC but mark — caller may drop; brief says filter to biotech.
            continue
        if sic in allowed:
            out.append(h)
    return out
