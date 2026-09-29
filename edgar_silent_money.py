"""
Free SEC EDGAR fallback for Silent Money / Exec Exit (Form 4, 13D/G, 8-K 5.02).

Used when sec-api.io is rate-limited / exhausted and FMP per-ticker insider is
paywalled. Polite User-Agent + small delay — never invent filings.
"""
from __future__ import annotations

import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger("supernova.edgar_silent")

_UA = "SuperNovaSilentMoney/1.0 (biotech-desk; contact=local)"
_TIMEOUT_S = 25
_SLEEP_S = 0.12
_CIK_CACHE: dict[str, int] | None = None
_LAST_REQ_TS = 0.0

_CIK_PATHS = (
    Path("data") / "sec_company_tickers.json",
    Path("data") / "cache" / "sec_company_tickers.json",
)


def _throttle() -> None:
    global _LAST_REQ_TS
    gap = time.time() - _LAST_REQ_TS
    if gap < _SLEEP_S:
        time.sleep(_SLEEP_S - gap)
    _LAST_REQ_TS = time.time()


def _http_get(url: str) -> bytes | None:
    _throttle()
    req = Request(
        url,
        headers={
            "User-Agent": _UA,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate",
        },
    )
    try:
        with urlopen(req, timeout=_TIMEOUT_S) as resp:
            payload = resp.read()
            encoding = (resp.headers.get("Content-Encoding") or "").lower()
            if encoding == "gzip" or payload[:2] == b"\x1f\x8b":
                import gzip

                payload = gzip.decompress(payload)
            return payload
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        logger.warning("edgar get failed %s: %s", url, exc)
        return None


def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _xml_value(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    for child in el:
        if _local(child.tag) == "value" and (child.text or "").strip():
            return child.text.strip()
    text = (el.text or "").strip()
    return text or None


def load_ticker_cik_map() -> dict[str, int]:
    global _CIK_CACHE
    if _CIK_CACHE is not None:
        return _CIK_CACHE
    out: dict[str, int] = {}
    for path in _CIK_PATHS:
        if not path.is_file():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError):
            continue
        if not isinstance(doc, dict):
            continue
        for row in doc.values():
            if not isinstance(row, dict):
                continue
            tk = str(row.get("ticker") or "").strip().upper()
            cik_raw = row.get("cik_str")
            try:
                cik = int(cik_raw)
            except (TypeError, ValueError):
                continue
            if tk and cik > 0:
                out[tk] = cik
        if out:
            break
    _CIK_CACHE = out
    return out


def cik_for_ticker(ticker: str) -> int | None:
    tk = ticker.strip().upper()
    if not tk:
        return None
    return load_ticker_cik_map().get(tk)


def fetch_submissions(cik: int) -> dict[str, Any] | None:
    url = f"https://data.sec.gov/submissions/CIK{str(int(cik)).zfill(10)}.json"
    raw = _http_get(url)
    if not raw:
        return None
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def _recent_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    recent = (doc.get("filings") or {}).get("recent") or {}
    if not isinstance(recent, dict):
        return []
    forms = recent.get("form") or []
    n = len(forms) if isinstance(forms, list) else 0
    out: list[dict[str, Any]] = []
    for i in range(n):
        out.append(
            {
                "form": forms[i] if i < len(forms) else None,
                "filingDate": (recent.get("filingDate") or [None] * n)[i],
                "reportDate": (recent.get("reportDate") or [None] * n)[i],
                "accessionNumber": (recent.get("accessionNumber") or [None] * n)[i],
                "primaryDocument": (recent.get("primaryDocument") or [None] * n)[i],
                "items": (recent.get("items") or [None] * n)[i],
            }
        )
    return out


def _form4_xml_url(cik: int, accession: str, primary_document: str | None = None) -> str | None:
    clean = accession.replace("-", "")
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{clean}"
    candidates: list[str] = []
    prim = str(primary_document or "").strip()
    if prim and not prim.lower().startswith("xsl"):
        candidates.append(prim)
    idx_raw = _http_get(f"{base}/index.json")
    if idx_raw:
        try:
            idx = json.loads(idx_raw.decode("utf-8"))
            items = ((idx.get("directory") or {}).get("item")) or []
            names = [str(it.get("name") or "") for it in items if isinstance(it, dict)]
            for name in names:
                low = name.lower()
                if low == "form4.xml" or (low.endswith(".xml") and "form4" in low and "xsl" not in low):
                    candidates.append(name)
            for name in names:
                low = name.lower()
                if low.endswith(".xml") and "xsl" not in low and name not in candidates:
                    candidates.append(name)
            # Last resort: ownership .txt package
            for name in names:
                if name.lower().endswith(".txt") and accession.lower() in name.lower():
                    candidates.append(name)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, AttributeError):
            pass
    candidates.append("form4.xml")
    # Deduplicate while preserving order
    seen: set[str] = set()
    ordered: list[str] = []
    for name in candidates:
        if not name or name in seen:
            continue
        seen.add(name)
        ordered.append(name)
    for name in ordered:
        url = f"{base}/{name}"
        raw = _http_get(url)
        if raw and (b"<ownershipDocument" in raw[:4000] or b"ownershipDocument" in raw[:8000]):
            # Cache hit path: caller will re-fetch; return URL only.
            # To avoid double download, stash bytes on a tiny module cache.
            _XML_BYTES_CACHE[url] = raw
            return url
    return None


_XML_BYTES_CACHE: dict[str, bytes] = {}


def _get_cached_or_fetch(url: str) -> bytes | None:
    cached = _XML_BYTES_CACHE.pop(url, None)
    if cached is not None:
        return cached
    return _http_get(url)


def parse_form4_xml(
    xml_bytes: bytes,
    *,
    filing_date: str | None = None,
    link: str | None = None,
) -> list[dict[str, Any]]:
    """Flatten ownershipDocument Form 4 XML into FMP-like transaction rows."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    owner_name = None
    officer_title = None
    is_officer = False
    is_director = False
    for el in root.iter():
        tag = _local(el.tag)
        if tag == "rptOwnerName" and el.text:
            owner_name = el.text.strip()
        elif tag == "officerTitle" and el.text:
            officer_title = el.text.strip()
        elif tag == "isOfficer" and (el.text or "").strip() in {"1", "true", "True"}:
            is_officer = True
        elif tag == "isDirector" and (el.text or "").strip() in {"1", "true", "True"}:
            is_director = True

    title_bits = []
    if officer_title:
        title_bits.append(officer_title)
    if is_officer:
        title_bits.append("officer")
    if is_director:
        title_bits.append("director")
    owner_title = " ".join(title_bits) or (owner_name or "")

    foot_bits: list[str] = []
    for el in root.iter():
        if _local(el.tag) == "footnote" and (el.text or "").strip():
            foot_bits.append(el.text.strip())
    foot_text = " ".join(foot_bits)
    aff = bool(re.search(r"10b5[\s\-]?1", foot_text, re.I))

    out: list[dict[str, Any]] = []
    for tx in root.iter():
        if _local(tx.tag) != "nonDerivativeTransaction":
            continue
        code = None
        shares = None
        price = None
        acq = None
        tx_date = None
        for child in tx.iter():
            tag = _local(child.tag)
            if tag == "transactionCode" and child.text:
                code = child.text.strip().upper()
            elif tag == "transactionShares":
                shares = _xml_value(child)
            elif tag == "transactionPricePerShare":
                price = _xml_value(child)
            elif tag == "transactionAcquiredDisposedCode":
                acq = (_xml_value(child) or "").upper() or None
            elif tag == "transactionDate":
                tx_date = _xml_value(child)
        if code and code not in {"P", "S"}:
            continue
        try:
            shares_n = float(shares) if shares is not None else None
        except (TypeError, ValueError):
            shares_n = None
        try:
            price_n = float(price) if price is not None else None
        except (TypeError, ValueError):
            price_n = None
        out.append(
            {
                "transactionType": "P-Purchase" if code == "P" or acq == "A" else "S-Sale",
                "transactionCode": code or ("P" if acq == "A" else "S"),
                "acquisitionOrDisposition": acq or ("A" if code == "P" else "D"),
                "securitiesTransacted": shares_n,
                "price": price_n,
                "transactionDate": (tx_date or "")[:10] or None,
                "filingDate": (filing_date or "")[:10] or None,
                "reportingName": owner_name or "",
                "typeOfOwner": owner_title,
                "aff10b5One": aff,
                "footnotes_text": foot_text,
                "link": link,
                "source": "edgar",
            }
        )
    return out


def fetch_form4_rows(
    ticker: str,
    *,
    lookback_days: int = 30,
    max_filings: int = 6,
    today: date | None = None,
) -> list[dict[str, Any]] | None:
    """
    Open-market Form 4 rows from EDGAR.
    Returns None if CIK/submissions unavailable; [] if checked but no hits.
    """
    cik = cik_for_ticker(ticker)
    if cik is None:
        return None
    doc = fetch_submissions(cik)
    if doc is None:
        return None
    ref = today or date.today()
    cutoff = (ref - timedelta(days=int(lookback_days))).isoformat()
    rows: list[dict[str, Any]] = []
    seen = 0
    for filing in _recent_rows(doc):
        form = str(filing.get("form") or "")
        if not form.startswith("4"):
            continue
        fdate = str(filing.get("filingDate") or "")[:10]
        if not fdate or fdate < cutoff or fdate > ref.isoformat():
            continue
        accession = str(filing.get("accessionNumber") or "").strip()
        if not accession:
            continue
        seen += 1
        if seen > max_filings:
            break
        xml_url = _form4_xml_url(cik, accession, str(filing.get("primaryDocument") or "") or None)
        if not xml_url:
            continue
        raw = _get_cached_or_fetch(xml_url)
        if not raw:
            continue
        link = (
            f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
            f"{accession.replace('-', '')}/{accession}-index.html"
        )
        rows.extend(parse_form4_xml(raw, filing_date=fdate, link=link))
    return rows


def fetch_13d_filings(
    ticker: str,
    *,
    lookback_days: int = 90,
    today: date | None = None,
) -> list[dict[str, Any]] | None:
    cik = cik_for_ticker(ticker)
    if cik is None:
        return None
    doc = fetch_submissions(cik)
    if doc is None:
        return None
    ref = today or date.today()
    cutoff = (ref - timedelta(days=int(lookback_days))).isoformat()
    out: list[dict[str, Any]] = []
    for filing in _recent_rows(doc):
        form = str(filing.get("form") or "")
        compact = re.sub(r"[\s-]+", "", form).upper()
        if "13D" not in compact and "13G" not in compact:
            continue
        fdate = str(filing.get("filingDate") or "")[:10]
        if not fdate or fdate < cutoff or fdate > ref.isoformat():
            continue
        accession = str(filing.get("accessionNumber") or "").strip()
        link = None
        if accession:
            link = (
                f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{accession.replace('-', '')}/{accession}-index.html"
            )
        out.append(
            {
                "formType": form,
                "filedAt": fdate,
                "accessionNo": accession,
                "cik": str(cik),
                "linkToFilingDetails": link,
                "source": "edgar",
            }
        )
    return out


def fetch_8k_item_502_events(
    ticker: str,
    *,
    lookback_days: int = 60,
    today: date | None = None,
) -> list[dict[str, Any]] | None:
    cik = cik_for_ticker(ticker)
    if cik is None:
        return None
    doc = fetch_submissions(cik)
    if doc is None:
        return None
    ref = today or date.today()
    cutoff = (ref - timedelta(days=int(lookback_days))).isoformat()
    out: list[dict[str, Any]] = []
    for filing in _recent_rows(doc):
        form = str(filing.get("form") or "")
        if "8-K" not in form.upper():
            continue
        items = str(filing.get("items") or "")
        if "5.02" not in items:
            continue
        fdate = str(filing.get("filingDate") or "")[:10]
        if not fdate or fdate < cutoff or fdate > ref.isoformat():
            continue
        accession = str(filing.get("accessionNumber") or "").strip()
        link = None
        if accession:
            link = (
                f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{accession.replace('-', '')}/{accession}-index.html"
            )
        out.append(
            {
                "ticker": ticker.strip().upper(),
                "filedAt": fdate,
                "cik": str(cik),
                "accessionNo": accession,
                "items": items,
                "items_raw": f"Item {items}",
                "event_title": "8-K Item 5.02",
                "linkToFilingDetails": link,
                "source": "edgar",
            }
        )
    return out


def fetch_silent_money_bundle(
    ticker: str,
    *,
    form4_lookback_days: int = 30,
    lookback_13d_days: int = 90,
    gov_lookback_days: int = 60,
    max_form4_filings: int = 6,
    today: date | None = None,
    want_form4: bool = True,
    want_13d: bool = True,
    want_8k: bool = True,
) -> dict[str, Any] | None:
    """
    One submissions round-trip for Form 4 / 13D / 8-K 5.02.
    Returns None if CIK or submissions unavailable.
    """
    cik = cik_for_ticker(ticker)
    if cik is None:
        return None
    doc = fetch_submissions(cik)
    if doc is None:
        return None
    ref = today or date.today()
    recent = _recent_rows(doc)
    out: dict[str, Any] = {
        "form4": [] if want_form4 else None,
        "filings_13d": [] if want_13d else None,
        "gov_events": [] if want_8k else None,
    }

    if want_form4:
        cutoff4 = (ref - timedelta(days=int(form4_lookback_days))).isoformat()
        rows: list[dict[str, Any]] = []
        seen = 0
        for filing in recent:
            form = str(filing.get("form") or "")
            if not form.startswith("4"):
                continue
            fdate = str(filing.get("filingDate") or "")[:10]
            if not fdate or fdate < cutoff4 or fdate > ref.isoformat():
                continue
            accession = str(filing.get("accessionNumber") or "").strip()
            if not accession:
                continue
            seen += 1
            if seen > max_form4_filings:
                break
            xml_url = _form4_xml_url(cik, accession, str(filing.get("primaryDocument") or "") or None)
            if not xml_url:
                continue
            raw = _get_cached_or_fetch(xml_url)
            if not raw:
                continue
            link = (
                f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{accession.replace('-', '')}/{accession}-index.html"
            )
            rows.extend(parse_form4_xml(raw, filing_date=fdate, link=link))
        out["form4"] = rows

    if want_13d:
        cutoff13 = (ref - timedelta(days=int(lookback_13d_days))).isoformat()
        filings: list[dict[str, Any]] = []
        for filing in recent:
            form = str(filing.get("form") or "")
            compact = re.sub(r"[\s-]+", "", form).upper()
            if "13D" not in compact and "13G" not in compact:
                continue
            fdate = str(filing.get("filingDate") or "")[:10]
            if not fdate or fdate < cutoff13 or fdate > ref.isoformat():
                continue
            accession = str(filing.get("accessionNumber") or "").strip()
            link = None
            if accession:
                link = (
                    f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                    f"{accession.replace('-', '')}/{accession}-index.html"
                )
            filings.append(
                {
                    "formType": form,
                    "filedAt": fdate,
                    "accessionNo": accession,
                    "cik": str(cik),
                    "linkToFilingDetails": link,
                    "source": "edgar",
                }
            )
        out["filings_13d"] = filings

    if want_8k:
        cutoff8 = (ref - timedelta(days=int(gov_lookback_days))).isoformat()
        events: list[dict[str, Any]] = []
        for filing in recent:
            form = str(filing.get("form") or "")
            if "8-K" not in form.upper():
                continue
            items = str(filing.get("items") or "")
            if "5.02" not in items:
                continue
            fdate = str(filing.get("filingDate") or "")[:10]
            if not fdate or fdate < cutoff8 or fdate > ref.isoformat():
                continue
            accession = str(filing.get("accessionNumber") or "").strip()
            link = None
            if accession:
                link = (
                    f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                    f"{accession.replace('-', '')}/{accession}-index.html"
                )
            events.append(
                {
                    "ticker": ticker.strip().upper(),
                    "filedAt": fdate,
                    "cik": str(cik),
                    "accessionNo": accession,
                    "items": items,
                    "items_raw": f"Item {items}",
                    "event_title": "8-K Item 5.02",
                    "linkToFilingDetails": link,
                    "source": "edgar",
                }
            )
        out["gov_events"] = events

    return out
