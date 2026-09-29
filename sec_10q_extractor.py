"""
SEC 10-Q → EIS feed (MD&A / Recent Developments only)
=====================================================
Reuses the EDGAR submissions client from ``catalyst_extractor`` (same UA,
sleep, ticker→CIK via sec_k8 snapshot). Does **not** process the full 10-Q:
isolates Recent Developments / Item 2 MD&A via ``sec_10q_mda``.

Cache: data/sec_10q_feed_cache.json  — keyed by accession (never reprocess)
Output: data/sec_10q_feed_snapshot.json

Independent of the 8-K catalyst path — failures here must not break 8-K EIS.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from sec_10q_mda import (
    DEFAULT_SECTION_MAX_CHARS,
    extract_10q_pipeline_section,
    headline_from_10q_section,
)

# Reuse EDGAR helpers from the 8-K catalyst module (same client / UA / sleep).
from catalyst_extractor import (
    _DATA_DIR,
    _edgar_get,
    _fetch_submissions,
    _filing_html_url,
    _parse_cik_field,
    _parse_date,
)

MAX_COMPANIES = int(os.environ.get("SEC_10Q_MAX_COMPANIES", "60"))
MAX_10Q_PER_COMPANY = int(os.environ.get("SEC_10Q_MAX_PER_COMPANY", "2"))
# Raw HTML→text budget before section isolation (10-Q is long).
RAW_TEXT_MAX_CHARS = int(os.environ.get("SEC_10Q_RAW_TEXT_CHARS", "250000"))
LOOKBACK_DAYS = int(os.environ.get("SEC_10Q_LOOKBACK_DAYS", "400"))

_CACHE_PATH = os.path.join(_DATA_DIR, "sec_10q_feed_cache.json")
_SNAPSHOT_PATH = os.path.join(_DATA_DIR, "sec_10q_feed_snapshot.json")

_STATUS: dict[str, Any] = {
    "running": False,
    "message": "",
    "processed": 0,
    "total": 0,
    "error": None,
    "finished_at": None,
}
_STATUS_LOCK = threading.Lock()


def get_status() -> dict[str, Any]:
    with _STATUS_LOCK:
        return dict(_STATUS)


def _set_status(**kw: Any) -> None:
    with _STATUS_LOCK:
        _STATUS.update(kw)


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


def _write_snapshot(events: list[dict[str, Any]]) -> None:
    Path(_DATA_DIR).mkdir(parents=True, exist_ok=True)
    snap = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(events),
        "form": "10-Q",
        "events": events,
    }
    Path(_SNAPSHOT_PATH).write_text(
        json.dumps(snap, ensure_ascii=False, default=str),
        encoding="utf-8",
    )


def load_snapshot() -> dict[str, Any]:
    try:
        return json.loads(Path(_SNAPSHOT_PATH).read_text(encoding="utf-8"))
    except Exception:
        return {"events": [], "count": 0, "updated_at": None, "form": "10-Q"}


def _form_is_10q(fm: str) -> bool:
    return bool(re.match(r"\s*10-Q", str(fm or ""), flags=re.I))


def recent_10q_filings(
    submissions: dict[str, Any],
    *,
    max_n: int = 4,
    lookback_days: int = LOOKBACK_DAYS,
) -> list[dict[str, Any]]:
    """Most recent 10-Q / 10-Q/A from submissions JSON (same shape as 8-K helper)."""
    recent = submissions.get("filings", {}).get("recent", {})
    forms = recent.get("form", []) or []
    dates = recent.get("filingDate", []) or []
    accessions = recent.get("accessionNumber", []) or []
    docs = recent.get("primaryDocument", []) or []
    descs = recent.get("primaryDocDescription", []) or []

    cutoff = None
    if lookback_days > 0:
        from datetime import date, timedelta

        cutoff = date.today() - timedelta(days=lookback_days)

    result: list[dict[str, Any]] = []
    for i, ft in enumerate(forms):
        if not _form_is_10q(str(ft)):
            continue
        fd = dates[i] if i < len(dates) else ""
        if cutoff and fd:
            try:
                from datetime import date as date_cls

                d = date_cls.fromisoformat(str(fd)[:10])
                if d < cutoff:
                    continue
            except ValueError:
                pass
        result.append(
            {
                "form_type": str(ft),
                "filing_date": fd,
                "accession": accessions[i] if i < len(accessions) else "",
                "primary_doc": docs[i] if i < len(docs) else "",
                "description": descs[i] if i < len(descs) else "",
            }
        )
        if len(result) >= max_n:
            break
    return result


def _extract_text_from_html_long(html: str) -> str:
    """Like catalyst HTML extract but keeps newlines for heading detection."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "head", "nav", "footer"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:RAW_TEXT_MAX_CHARS]


def _fetch_10q_raw_text(cik10: str, accession: str, primary_doc: str) -> str | None:
    url = _filing_html_url(cik10, accession, primary_doc)
    r = _edgar_get(url)
    if not r or r.status_code != 200:
        return None
    ct = (r.headers.get("Content-Type") or "").lower()
    if "pdf" in ct or primary_doc.lower().endswith(".pdf"):
        # PDF 10-Q: best-effort first pages (same helper as 8-K, larger budget).
        try:
            from catalyst_extractor import _extract_text_from_pdf
            import catalyst_extractor as _ce

            old = getattr(_ce, "MAX_TEXT_CHARS", 4000)
            try:
                _ce.MAX_TEXT_CHARS = min(RAW_TEXT_MAX_CHARS, 80_000)
                return _extract_text_from_pdf(r.content) or None
            finally:
                _ce.MAX_TEXT_CHARS = old
        except Exception:
            return None
    return _extract_text_from_html_long(r.text) or None


def _work_list_from_sec_k8() -> list[dict[str, Any]]:
    try:
        from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON

        snap_path = Path(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    except ImportError:
        snap_path = Path(_DATA_DIR) / "sec_k8_simulation_snapshot.json"
    if not snap_path.is_file():
        return []
    snap = json.loads(snap_path.read_text(encoding="utf-8"))
    cols = snap.get("columns") or []
    col_cik = next((c for c in cols if "CIK" in c), "CIK (SEC)")
    seen: set[str] = set()
    work: list[dict[str, Any]] = []
    for row in snap.get("rows") or []:
        ticker = str(row.get("Ticker", "")).strip().upper()
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        if len(seen) > MAX_COMPANIES:
            break
        cik10 = _parse_cik_field(row.get(col_cik, ""))
        if not cik10:
            continue
        work.append(
            {
                "ticker": ticker,
                "company": str(row.get("Società", ticker)),
                "cik10": cik10,
            }
        )
    return work


def run_sec_10q_feed_refresh() -> dict[str, Any]:
    """Fetch new 10-Q filings, isolate MD&A/Recent Developments, write snapshot."""
    try:
        return _run()
    except Exception as exc:
        _set_status(running=False, error=str(exc), message=f"Error: {exc}")
        return {"error": str(exc), "ok": False}


def _run() -> dict[str, Any]:
    _set_status(
        running=True,
        message="Loading company list from sec_k8 snapshot…",
        processed=0,
        total=0,
        error=None,
    )
    work = _work_list_from_sec_k8()
    if not work:
        msg = "sec_k8 snapshot missing or empty — run SEC K-8 refresh first"
        _set_status(running=False, error=msg, message=msg)
        return {"error": msg, "ok": False, "count": 0}

    _set_status(total=len(work))
    cache = _load_cache()
    events: list[dict[str, Any]] = []
    new_n = 0
    skip_n = 0
    fail_n = 0

    for idx, item in enumerate(work):
        ticker = item["ticker"]
        _set_status(
            message=f"10-Q {ticker} ({idx + 1}/{len(work)})",
            processed=idx,
        )
        try:
            submissions = _fetch_submissions(item["cik10"])
            if not submissions:
                fail_n += 1
                continue
            filings = recent_10q_filings(
                submissions, max_n=MAX_10Q_PER_COMPANY * 2
            )[:MAX_10Q_PER_COMPANY]
            for filing in filings:
                accession = str(filing.get("accession") or "").strip()
                if not accession:
                    continue
                if accession in cache and isinstance(cache[accession], dict):
                    ev = dict(cache[accession])
                    events.append(ev)
                    skip_n += 1
                    continue
                primary = str(filing.get("primary_doc") or "").strip()
                if not primary:
                    fail_n += 1
                    continue
                raw = _fetch_10q_raw_text(item["cik10"], accession, primary)
                if not raw:
                    fail_n += 1
                    continue
                isolated = extract_10q_pipeline_section(
                    raw, max_chars=DEFAULT_SECTION_MAX_CHARS
                )
                section_text = str(isolated.get("text") or "")
                section_kind = str(isolated.get("section") or "none")
                if not section_text or section_kind == "none":
                    # Do not fall back to full document — skip matching noise.
                    fail_n += 1
                    cache[accession] = {
                        "ticker": ticker,
                        "accession": accession,
                        "form_type": filing.get("form_type") or "10-Q",
                        "filing_date": filing.get("filing_date"),
                        "skipped": True,
                        "skip_reason": "no_mda_section",
                    }
                    continue
                doc_url = _filing_html_url(item["cik10"], accession, primary)
                headline = headline_from_10q_section(section_text)
                ev = {
                    "ticker": ticker,
                    "company": item["company"],
                    "cik": item["cik10"],
                    "filing_date": filing.get("filing_date"),
                    "accession": accession,
                    "form_type": filing.get("form_type") or "10-Q",
                    "section_kind": section_kind,
                    "section_chars": isolated.get("chars") or len(section_text),
                    "headline": headline,
                    "section_text": section_text,
                    "filing_doc_url": doc_url,
                    "extracted_at": datetime.now(timezone.utc).isoformat(),
                }
                cache[accession] = ev
                events.append(ev)
                new_n += 1
        except Exception as exc:
            fail_n += 1
            print(f"[Sec10Q] {ticker} failed: {exc}", flush=True)
            continue

    # Prefer non-skipped events; keep newest filing_date first per ticker for UI.
    usable = [e for e in events if not e.get("skipped") and e.get("section_text")]
    usable.sort(
        key=lambda e: (str(e.get("ticker") or ""), str(e.get("filing_date") or "")),
        reverse=False,
    )
    _save_cache(cache)
    _write_snapshot(usable)
    finished = datetime.now(timezone.utc).isoformat()
    _set_status(
        running=False,
        message=f"Done — {len(usable)} 10-Q sections ({new_n} new, {skip_n} cached)",
        processed=len(work),
        finished_at=finished,
        error=None,
    )
    return {
        "ok": True,
        "count": len(usable),
        "new": new_n,
        "cached": skip_n,
        "failed": fail_n,
        "updated_at": finished,
    }


def load_10q_events_for_ticker(ticker: str) -> list[dict[str, Any]]:
    tk = str(ticker or "").strip().upper()
    if not tk:
        return []
    snap = load_snapshot()
    return [
        ev
        for ev in (snap.get("events") or [])
        if str(ev.get("ticker") or "").upper() == tk and not ev.get("skipped")
    ]
