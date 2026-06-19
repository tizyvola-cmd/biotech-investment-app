"""
Live research for Catalyst Copilot chat (PubMed + ClinicalTrials.gov).

Complements the local Catalyst Feed snapshot — not a full web browser.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any

_HEADERS = {"User-Agent": "biotech-investment-app/1.0 (research use)"}

# Ticker → default company search name (when not in feed / yfinance)
_TICKER_COMPANY_HINTS: dict[str, str] = {
    "BNTX": "BioNTech",
    "MRNA": "Moderna",
    "PFE": "Pfizer",
    "VRTX": "Vertex",
    "REGN": "Regeneron",
    "AMGN": "Amgen",
    "GILD": "Gilead",
    "BIIB": "Biogen",
    "ILMN": "Illumina",
    "EXAS": "Exact Sciences",
}


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _network_disabled() -> bool:
    return _env_truthy("PUBMED_DISABLE_NETWORK") or _env_truthy("COPILOT_DISABLE_LIVE_RESEARCH")


def _company_from_feed(ticker: str, records: list[dict[str, Any]]) -> str | None:
    tk = ticker.strip().upper()
    for r in records:
        if str(r.get("ticker") or "").upper() != tk:
            continue
        comp = str(r.get("company") or "").strip()
        if comp and comp not in ("-", "N/D", "ND"):
            return comp
    return None


def _company_from_yfinance(ticker: str) -> str | None:
    def _fetch() -> str | None:
        try:
            import yfinance as yf

            info = yf.Ticker(ticker).info or {}
            for key in ("longName", "shortName", "displayName"):
                v = str(info.get(key) or "").strip()
                if len(v) >= 4:
                    return v
        except Exception:
            pass
        return None

    timeout_s = float(os.environ.get("COPILOT_YFINANCE_TIMEOUT_S", "8"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(_fetch)
        try:
            return fut.result(timeout=timeout_s)
        except concurrent.futures.TimeoutError:
            return None


def resolve_company_name(
    *,
    ticker: str | None = None,
    message: str = "",
    feed_records: list[dict[str, Any]] | None = None,
) -> tuple[str | None, str | None]:
    """
    Return (ticker, company_search_name) best effort from hint, message, feed, map, yfinance.
    """
    records = feed_records or []
    msg = (message or "").lower()
    tk: str | None = (ticker or "").strip().upper() or None

    # Explicit ticker in message (e.g. BNTX)
    if not tk:
        for word in re.findall(r"\b[A-Z]{2,5}\b", message or ""):
            if word in _TICKER_COMPANY_HINTS or _company_from_feed(word, records):
                tk = word
                break

    # Company name in message
    company: str | None = None
    for alias, hint_tk in (
        ("biontech", "BNTX"),
        ("moderna", "MRNA"),
        ("vertex pharmaceuticals", "VRTX"),
    ):
        if alias in msg:
            company = alias.title() if alias != "biontech" else "BioNTech"
            tk = tk or hint_tk
            break

    if not company and "bio" in msg and "ntech" in msg.replace(" ", ""):
        company = "BioNTech"
        tk = tk or "BNTX"

    if tk and not company:
        company = _company_from_feed(tk, records)
    if tk and not company:
        company = _TICKER_COMPANY_HINTS.get(tk)
    if tk and not company:
        company = _company_from_yfinance(tk)

    # Free-text company phrase: "da biontech", "from Moderna"
    if not company:
        m = re.search(
            r"(?:da|from|for|su|about|on)\s+([A-Za-z][A-Za-z0-9\s\-&]{2,40})",
            message or "",
            re.I,
        )
        if m:
            company = m.group(1).strip().rstrip(".,;")

    return tk, company


def _pubmed_recent(company: str, *, months: int = 18, retmax: int = 10) -> list[dict[str, Any]]:
    if _network_disabled():
        return []
    try:
        from pubmed_eutils_fetch import _efetch_pubmed_articles, _esearch_pubmed
    except ImportError:
        return []

    end = datetime.now()
    start = end - timedelta(days=int(months * 30.5))
    mn, mx = start.strftime("%Y/%m/%d"), end.strftime("%Y/%m/%d")
    short = company.split(",")[0].strip()[:80]
    if len(short) < 4:
        return []
    q = f'("{short}"[Affiliation] OR "{short}"[Title/Abstract])'
    pmids = _esearch_pubmed(q, mn, mx, retmax=retmax)
    time.sleep(0.35)
    hits = _efetch_pubmed_articles(pmids) if pmids else []
    out: list[dict[str, Any]] = []
    for h in hits[:retmax]:
        pmid = str(h.get("pmid") or "")
        out.append(
            {
                "pmid": pmid,
                "title": h.get("title"),
                "abstract": (str(h.get("abstract") or ""))[:500],
                "year": h.get("pub_year"),
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
            }
        )
    return out


def _ctgov_recent(company: str, *, limit: int = 10) -> list[dict[str, Any]]:
    if _network_disabled():
        return []
    try:
        from BiotechClinicalTrialDataFetcher import fetch_clinicaltrials
    except ImportError:
        return []

    rows = fetch_clinicaltrials(company, limit=limit) or []
    out: list[dict[str, Any]] = []
    for r in rows[:limit]:
        nct = str(r.get("nct_id") or "").strip()
        out.append(
            {
                "nct_id": nct,
                "title": (str(r.get("brief_title") or ""))[:200],
                "status": r.get("overall_status"),
                "phase": r.get("phase"),
                "last_update": r.get("last_update_posted_date"),
                "sponsor": r.get("lead_sponsor"),
                "url": f"https://clinicaltrials.gov/study/{nct}" if nct else None,
            }
        )
    return out


def fetch_live_research(
    *,
    message: str,
    ticker: str | None = None,
    feed_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    PubMed + CT.gov for company/ticker inferred from the user question.
    """
    tk, company = resolve_company_name(
        ticker=ticker, message=message, feed_records=feed_records
    )
    if not company and not tk:
        return {
            "ok": False,
            "reason": "no_entity",
            "ticker": None,
            "company": None,
            "pubmed": [],
            "ctgov": [],
        }

    search_name = company or _TICKER_COMPANY_HINTS.get(tk or "", "") or tk or ""
    pubmed = _pubmed_recent(search_name) if search_name else []
    ctgov = _ctgov_recent(search_name) if search_name else []

    return {
        "ok": bool(pubmed or ctgov),
        "ticker": tk,
        "company": search_name,
        "pubmed": pubmed,
        "ctgov": ctgov,
        "network_disabled": _network_disabled(),
    }


def format_live_block(live: dict[str, Any], *, max_chars: int = 12_000) -> str:
    if not live.get("ok") and not live.get("pubmed") and not live.get("ctgov"):
        reason = live.get("reason")
        if reason == "no_entity":
            return json.dumps(
                {
                    "note": "No company/ticker detected for live search. "
                    "Mention a ticker (e.g. BNTX) or company name."
                },
                ensure_ascii=False,
            )
        if live.get("network_disabled"):
            return json.dumps(
                {"note": "Live research disabled (PUBMED_DISABLE_NETWORK or COPILOT_DISABLE_LIVE_RESEARCH)."},
                ensure_ascii=False,
            )
        return json.dumps({"note": "No PubMed/CT.gov hits for this query."}, ensure_ascii=False)

    text = json.dumps(live, ensure_ascii=False, indent=2)
    if len(text) > max_chars:
        text = text[:max_chars] + "\n…(truncated)"
    return text
