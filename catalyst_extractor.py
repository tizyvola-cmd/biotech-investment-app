"""
Catalyst Feed Extractor
=======================
Fetches and LLM-extracts SEC 8-K filing content for companies in the
Simulation sheet. Reads from the existing sec_k8_simulation_snapshot.json
(produced by the SEC K-8 pipeline), downloads the actual HTML from EDGAR,
strips it to clean text, and calls an AI provider for structured extraction.

Cache: data/catalyst_feed_cache.json  — keyed by accession number, never
       re-processes a filing already seen.
Output: data/catalyst_feed_snapshot.json

AI provider (first configured wins):
  ANTHROPIC_API_KEY  — Claude Haiku (default)
  GITHUB_TOKEN       — GitHub Models / gpt-4o-mini (free with Copilot)
  OPENAI_API_KEY     — OpenAI gpt-4o-mini

Requirements (all in venv):
  requests>=2.28      already installed via yfinance
  bs4                 already installed
  pdfplumber>=0.11    for PDF exhibits (fallback, optional)
  anthropic>=0.40     if using Anthropic
  openai>=1.0         if using GitHub Models or OpenAI
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

import requests
from bs4 import BeautifulSoup

import ai_provider

# ── Config ─────────────────────────────────────────────────────────────────────
EDGAR_USER_AGENT = os.environ.get(
    "SEC_EDGAR_USER_AGENT",
    "biotech-investment-app research@example.com",
)
EDGAR_SLEEP_SEC = float(os.environ.get("SEC_EDGAR_SLEEP_SEC", "0.15"))
MAX_TEXT_CHARS = int(os.environ.get("CATALYST_MAX_TEXT_CHARS", "4000"))
MAX_COMPANIES = int(os.environ.get("CATALYST_MAX_COMPANIES", "60"))
MAX_8K_PER_COMPANY = int(os.environ.get("CATALYST_MAX_8K_PER_COMPANY", "3"))

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_CACHE_PATH = os.path.join(_DATA_DIR, "catalyst_feed_cache.json")
_SNAPSHOT_PATH = os.path.join(_DATA_DIR, "catalyst_feed_snapshot.json")

_HEADERS = {
    "User-Agent": EDGAR_USER_AGENT,
    "Accept-Encoding": "gzip, deflate",
    "Accept": "text/html,application/json",
}

# ── Status ─────────────────────────────────────────────────────────────────────

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
        out = dict(_STATUS)
    try:
        out["ai_provider"] = ai_provider.provider_info()
    except Exception:
        pass
    return out


def _set_status(**kw: Any) -> None:
    with _STATUS_LOCK:
        _STATUS.update(kw)


# ── Cache helpers ──────────────────────────────────────────────────────────────


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
        "events": events,
    }
    Path(_SNAPSHOT_PATH).write_text(
        json.dumps(snap, ensure_ascii=False, default=str),
        encoding="utf-8",
    )


def load_snapshot() -> dict[str, Any]:
    try:
        data = json.loads(Path(_SNAPSHOT_PATH).read_text(encoding="utf-8"))
        try:
            data["ai_provider"] = ai_provider.provider_info()
        except Exception:
            pass
        if data.get("events"):
            return data
    except Exception:
        pass
    # Snapshot missing or empty → auto-populate from sec_k8 on first call
    result = populate_from_sec_k8()
    if result.get("count", 0) > 0:
        try:
            return json.loads(Path(_SNAPSHOT_PATH).read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"events": [], "count": 0, "updated_at": None}


# ── EDGAR helpers ──────────────────────────────────────────────────────────────


def _edgar_get(url: str, timeout: int = 20) -> requests.Response | None:
    time.sleep(EDGAR_SLEEP_SEC)
    try:
        r = requests.get(url, headers=_HEADERS, timeout=timeout)
        return r
    except Exception as exc:
        print(f"[CatalystFeed] HTTP error {url}: {exc}", flush=True)
        return None


def _parse_cik_field(cik_field: Any) -> str | None:
    """
    The sec_k8 snapshot stores the CIK cell as a stringified dict like:
      "{'text': '0001729427', 'href': 'https://data.sec.gov/submissions/CIK0001729427.json'}"
    Extract the 10-digit CIK from whatever format we receive.
    """
    raw = str(cik_field) if not isinstance(cik_field, str) else cik_field
    # Direct 10-digit run
    m = re.search(r"CIK(\d{10})", raw)
    if m:
        return m.group(1)
    # query param CIK=1234567
    m = re.search(r"CIK[=:]\s*0*(\d+)", raw, re.IGNORECASE)
    if m:
        return m.group(1).zfill(10)
    # plain 10-digit number as "text"
    m = re.search(r"\b(\d{10})\b", raw)
    if m:
        return m.group(1)
    return None


def _fetch_submissions(cik10: str) -> dict[str, Any] | None:
    url = f"https://data.sec.gov/submissions/CIK{cik10}.json"
    r = _edgar_get(url)
    if r and r.status_code == 200:
        try:
            return r.json()
        except Exception:
            pass
    return None


def _recent_8k_filings(submissions: dict[str, Any], max_n: int = 10) -> list[dict[str, Any]]:
    """Return most recent 8-K filings from EDGAR submissions JSON."""
    recent = submissions.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accessions = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])
    items_list = recent.get("items", [])
    descs = recent.get("primaryDocDescription", [])

    result: list[dict[str, Any]] = []
    for i, ft in enumerate(forms):
        if ft in ("8-K", "8-K/A") and len(result) < max_n:
            result.append(
                {
                    "form_type": ft,
                    "filing_date": dates[i] if i < len(dates) else "",
                    "accession": accessions[i] if i < len(accessions) else "",
                    "primary_doc": docs[i] if i < len(docs) else "",
                    "items": items_list[i] if i < len(items_list) else "",
                    "description": descs[i] if i < len(descs) else "",
                }
            )
    return result


def _filing_html_url(cik10: str, accession: str, primary_doc: str) -> str:
    cik_int = str(int(cik10))
    accession_flat = accession.replace("-", "")
    return (
        f"https://www.sec.gov/Archives/edgar/data/"
        f"{cik_int}/{accession_flat}/{primary_doc}"
    )


def _extract_text_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "head", "nav", "footer"]):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
    text = re.sub(r"\s{3,}", "\n\n", text)
    return text[:MAX_TEXT_CHARS]


def _extract_text_from_pdf(content: bytes) -> str:
    try:
        import io
        import pdfplumber

        with pdfplumber.open(io.BytesIO(content)) as pdf:
            parts: list[str] = []
            for page in pdf.pages[:6]:
                t = page.extract_text() or ""
                parts.append(t)
                if sum(len(p) for p in parts) >= MAX_TEXT_CHARS:
                    break
        return "\n".join(parts)[:MAX_TEXT_CHARS]
    except Exception as exc:
        print(f"[CatalystFeed] PDF parse error: {exc}", flush=True)
        return ""


def _fetch_filing_text(cik10: str, accession: str, primary_doc: str) -> str | None:
    url = _filing_html_url(cik10, accession, primary_doc)
    r = _edgar_get(url)
    if not r or r.status_code != 200:
        return None
    ct = r.headers.get("Content-Type", "")
    if "pdf" in ct.lower() or primary_doc.lower().endswith(".pdf"):
        return _extract_text_from_pdf(r.content) or None
    return _extract_text_from_html(r.text) or None


# ── Claude extraction ──────────────────────────────────────────────────────────

_PROMPT_TEMPLATE = """\
You are a biotech investment analyst. Analyze the SEC 8-K excerpt below and \
extract structured data. Return ONLY a single valid JSON object — no markdown, \
no explanation.

Company: {company} (ticker: {ticker})
Filing date: {filing_date}
SEC Items declared: {items}

Filing text (truncated):
{text}

Required JSON keys:
  catalyst_type   – one of: efficacy | safety | regulatory | deal | financial | other
  headline        – one sentence, max 120 chars
  trial_name      – trial name or NCT number, or null
  phase           – "1" | "2" | "3" | null
  endpoint_met    – true | false | null
  key_metric      – main result number (e.g. "ORR 42% vs 18%, p=0.003"), or null
  next_milestone  – next expected event mentioned, or null
  confidence      – float 0.0–1.0 (your confidence in the extraction)
"""


def _call_ai(
    text: str,
    ticker: str,
    company: str,
    filing_date: str,
    items: str,
) -> dict[str, Any] | None:
    if not ai_provider.is_available():
        return ai_provider.no_provider_placeholder(task="catalyst")
    prompt = _PROMPT_TEMPLATE.format(
        company=company,
        ticker=ticker,
        filing_date=filing_date,
        items=items,
        text=text,
    )
    raw = ai_provider.call_ai(prompt, max_tokens=512, task="catalyst")
    if not raw:
        return None
    try:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        return json.loads(raw)
    except Exception as exc:
        print(f"[CatalystFeed] AI parse error ({ticker}): {exc}", flush=True)
        return None


# ── Date helpers ───────────────────────────────────────────────────────────────


def _parse_date(s: Any) -> str | None:
    """Convert Italian DD/MM/YYYY or ISO YYYY-MM-DD to ISO string."""
    raw = str(s or "").strip()
    if not raw or raw in ("—", "None", "nan"):
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ── Items → label (no Claude needed) ──────────────────────────────────────────

_ITEMS_LABELS: dict[str, str] = {
    "1.01": "Material definitive agreement",
    "1.02": "Termination of material agreement",
    "2.01": "Acquisition / disposal of assets",
    "2.02": "Results of operations (earnings)",
    "2.03": "Creation of direct financial obligation",
    "3.01": "Notice of delisting",
    "4.01": "Change of auditor",
    "5.01": "Change in control",
    "5.02": "Officer/director departure or appointment",
    "5.03": "Amendment to articles",
    "7.01": "Regulation FD disclosure",
    "8.01": "Other material events (press release)",
}

_ITEMS_CATALYST_TYPE: dict[str, str] = {
    "1.01": "deal",
    "1.02": "deal",
    "2.01": "deal",
    "2.02": "financial",
    "5.01": "financial",
    "5.02": "financial",
    "7.01": "regulatory",
    "8.01": "other",
}


def _items_to_headline(items_str: str) -> str:
    nums = [p.strip() for p in re.split(r"[,\s]+", items_str) if re.match(r"\d+\.\d+", p.strip())]
    labels = [_ITEMS_LABELS[n] for n in nums if n in _ITEMS_LABELS and n != "9.01"]
    return " · ".join(labels) if labels else "SEC 8-K filing"


def _infer_type_from_items(items_str: str) -> str:
    nums = set(re.findall(r"\d+\.\d+", items_str))
    for n in ("2.02", "5.02", "5.01", "2.01", "1.01", "7.01", "8.01"):
        if n in nums:
            return _ITEMS_CATALYST_TYPE.get(n, "other")
    return "other"


# ── Fast populate (no Claude, no EDGAR calls) ──────────────────────────────────


def populate_from_sec_k8() -> dict[str, Any]:
    """Instantly build basic catalyst events from the existing sec_k8 snapshot.

    No EDGAR HTTP calls, no Claude. Uses items + metadata already in the
    sec_k8 snapshot to produce readable cards. Called automatically when the
    feed snapshot doesn't exist yet so the tab is never empty.
    """
    try:
        from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON
        snap_path = Path(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    except ImportError:
        snap_path = Path(_DATA_DIR) / "sec_k8_simulation_snapshot.json"

    if not snap_path.is_file():
        return {"error": "sec_k8 snapshot missing — run SEC K-8 refresh first", "count": 0}

    snap = json.loads(snap_path.read_text(encoding="utf-8"))
    rows = snap.get("rows", [])
    cols = snap.get("columns") or []

    def _col(*keywords: str) -> str:
        return next((c for c in cols if all(k.lower() in c.lower() for k in keywords)), "")

    COL_CIK     = _col("CIK") or "CIK (SEC)"
    COL_CD      = _col("Completion") or "Completion Date"
    COL_FILING  = _col("filing", "8-K") or "Data filing 8-K"
    COL_CONTENT = _col("Contenuto") or "Contenuto 8-K\n(Items · doc SEC · temi)"
    COL_D1      = _col("+1") or ""
    COL_D2      = _col("+2") or ""
    COL_D3      = _col("+3") or ""

    # Load existing snapshot to preserve any Claude-enriched events
    existing_by_key: dict[str, dict] = {}
    try:
        ex = json.loads(Path(_SNAPSHOT_PATH).read_text(encoding="utf-8"))
        for ev in ex.get("events", []):
            tk = ev.get("ticker", "")
            fd = ev.get("filing_date", "")
            conf = (ev.get("extracted") or {}).get("confidence", 0.0) or 0.0
            if conf > 0 and tk:  # keep only Claude-enriched entries
                existing_by_key[f"{tk}|{fd}"] = ev
    except Exception:
        pass

    events: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in rows:
        ticker = str(row.get("Ticker", "")).strip().upper()
        filing_date = _parse_date(row.get(COL_FILING, ""))
        row_key = f"{ticker}|{filing_date or ''}"
        if not ticker or row_key in seen:
            continue
        seen.add(row_key)

        if row_key in existing_by_key:
            events.append(existing_by_key[row_key])
            continue

        if not filing_date:
            continue

        cik10     = _parse_cik_field(row.get(COL_CIK, ""))
        cd_date   = _parse_date(row.get(COL_CD, ""))
        content   = str(row.get(COL_CONTENT, ""))
        company   = str(row.get("Società", ticker))

        # Pull items string out of content cell
        m = re.search(r"Items 8-K:\s*([\d.,\s]+)", content)
        items_raw = m.group(1).strip() if m else ""

        # CD proximity
        days_before_cd: int | None = None
        cd_window_match = False
        if cd_date and filing_date:
            try:
                fd = datetime.strptime(filing_date, "%Y-%m-%d")
                cd = datetime.strptime(cd_date, "%Y-%m-%d")
                days_before_cd = (cd - fd).days
                cd_window_match = 0 <= days_before_cd <= 90
            except ValueError:
                pass

        cik_int_str = str(int(cik10)) if cik10 else "0"
        events.append(
            {
                "ticker": ticker,
                "company": company,
                "cik": cik10 or "",
                "filing_date": filing_date,
                "cd_date": cd_date,
                "days_before_cd": days_before_cd,
                "cd_window_match": cd_window_match,
                "accession": "",
                "form_type": "8-K",
                "items_raw": items_raw,
                "items_label": content,
                "edgar_browse_url": (
                    f"https://www.sec.gov/cgi-bin/browse-edgar?"
                    f"action=getcompany&CIK={cik_int_str}"
                    f"&type=8-K&owner=exclude&count=10"
                ),
                "filing_doc_url": "",
                "delta_d1": _safe_pct(row.get(COL_D1)),
                "delta_d2": _safe_pct(row.get(COL_D2)),
                "delta_d3": _safe_pct(row.get(COL_D3)),
                "extracted": {
                    "catalyst_type": _infer_type_from_items(items_raw),
                    "headline": _items_to_headline(items_raw),
                    "trial_name": None,
                    "phase": None,
                    "endpoint_met": None,
                    "key_metric": None,
                    "next_milestone": None,
                    "confidence": 0.0,
                },
            }
        )

    events.sort(key=lambda e: e.get("filing_date", "") or "", reverse=True)
    _write_snapshot(events)
    print(f"[CatalystFeed] populated {len(events)} base events from sec_k8 snapshot", flush=True)
    return {"count": len(events)}


# ── Main pipeline ──────────────────────────────────────────────────────────────


def run_catalyst_feed_refresh() -> dict[str, Any]:
    """
    Background-safe entry point. Reads sec_k8 snapshot, downloads and
    LLM-extracts any new 8-K filings, writes catalyst_feed_snapshot.json.
    """
    try:
        return _run()
    except Exception as exc:
        _set_status(running=False, error=str(exc), message=f"Error: {exc}")
        return {"error": str(exc)}


def _run() -> dict[str, Any]:
    _set_status(running=True, message="Loading sec_k8 snapshot…", processed=0, total=0, error=None)

    # ── Load sec_k8 snapshot ──────────────────────────────────────────────────
    try:
        from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON
        snap_path = Path(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    except ImportError:
        snap_path = Path(_DATA_DIR) / "sec_k8_simulation_snapshot.json"

    if not snap_path.is_file():
        _set_status(running=False, error="sec_k8_simulation_snapshot.json not found — run SEC K-8 refresh first")
        return {"error": "sec_k8 snapshot missing"}

    snap = json.loads(snap_path.read_text(encoding="utf-8"))
    rows = snap.get("rows", [])

    # ── Build work list ───────────────────────────────────────────────────────
    # Column names in snapshot contain newlines + special chars
    COL_CIK = next((c for c in (snap.get("columns") or []) if "CIK" in c), "CIK (SEC)")
    COL_CD = next((c for c in (snap.get("columns") or []) if "Completion" in c), "Completion Date")
    COL_FILING = next((c for c in (snap.get("columns") or []) if "filing 8-K" in c.lower()), "Data filing 8-K")
    COL_CONTENT = next((c for c in (snap.get("columns") or []) if "Contenuto" in c), "Contenuto 8-K\n(Items · doc SEC · temi)")
    COL_D1 = next((c for c in (snap.get("columns") or []) if "+1" in c), "")
    COL_D2 = next((c for c in (snap.get("columns") or []) if "+2" in c), "")
    COL_D3 = next((c for c in (snap.get("columns") or []) if "+3" in c), "")

    seen_tickers: set[str] = set()
    work: list[dict[str, Any]] = []
    for row in rows[:MAX_COMPANIES]:
        ticker = str(row.get("Ticker", "")).strip().upper()
        if not ticker or ticker in seen_tickers:
            continue
        seen_tickers.add(ticker)
        cik10 = _parse_cik_field(row.get(COL_CIK, ""))
        if not cik10:
            continue
        filing_date = _parse_date(row.get(COL_FILING, ""))
        if not filing_date:
            continue
        work.append(
            {
                "ticker": ticker,
                "company": str(row.get("Società", ticker)),
                "cik10": cik10,
                "filing_date": filing_date,
                "cd_date": _parse_date(row.get(COL_CD, "")),
                "items_label": str(row.get(COL_CONTENT, "")),
                "delta_d1": _safe_pct(row.get(COL_D1)),
                "delta_d2": _safe_pct(row.get(COL_D2)),
                "delta_d3": _safe_pct(row.get(COL_D3)),
            }
        )

    _set_status(total=len(work))
    cache = _load_cache()
    events: list[dict[str, Any]] = []

    # ── Process each company ──────────────────────────────────────────────────
    for idx, item in enumerate(work):
        ticker = item["ticker"]
        _set_status(message=f"Processing {ticker} ({idx + 1}/{len(work)})", processed=idx)
        print(f"[CatalystFeed] {ticker} ({idx + 1}/{len(work)})", flush=True)

        submissions = _fetch_submissions(item["cik10"])
        if not submissions:
            continue

        filings = _recent_8k_filings(submissions, max_n=MAX_8K_PER_COMPANY * 3)
        # Match to the filing date we have from sec_k8 (within ±2 days tolerance)
        target_date = item["filing_date"]
        matched = _match_filings(filings, target_date, max_n=MAX_8K_PER_COMPANY)

        for filing in matched:
            accession = filing["accession"]
            if not accession:
                continue

            # Check cache (skip stale placeholders from older Anthropic-only runs)
            if accession in cache:
                cached = cache[accession]
                extracted_cached = cached.get("extracted") if isinstance(cached, dict) else None
                if not ai_provider.is_stale_extraction(extracted_cached):
                    ev = dict(cached)
                    ev["cd_date"] = item["cd_date"]  # always refresh CD
                    events.append(ev)
                    continue

            if not filing["primary_doc"]:
                continue

            text = _fetch_filing_text(item["cik10"], accession, filing["primary_doc"])
            if not text:
                continue

            extracted = _call_ai(
                text=text,
                ticker=ticker,
                company=item["company"],
                filing_date=filing["filing_date"],
                items=filing["items"] or item["items_label"],
            )

            ev = _build_event(item, filing, extracted)
            cache[accession] = ev
            events.append(ev)

    events.sort(key=lambda e: e.get("filing_date", "") or "", reverse=True)
    _write_snapshot(events)
    _save_cache(cache)

    ai_ok = sum(
        1
        for ev in events
        if (ev.get("extracted") or {}).get("confidence", 0) > 0
        and not ai_provider.is_stale_extraction(ev.get("extracted"))
    )
    ts = datetime.now(timezone.utc).isoformat()
    _set_status(
        running=False,
        processed=len(events),
        ai_ok=ai_ok,
        message=f"8-K: {len(events)} filing — {ai_ok} con headline AI",
        finished_at=ts,
    )
    return {"processed": len(events), "ai_ok": ai_ok, "total": len(work)}


# ── Helpers ────────────────────────────────────────────────────────────────────


def _safe_pct(v: Any) -> float | None:
    if v in (None, "", "—", "nan"):
        return None
    try:
        f = float(str(v))
        return round(f * 100, 2)  # stored as decimal, display as %
    except (ValueError, TypeError):
        return None


def _match_filings(
    filings: list[dict[str, Any]],
    target_date: str,
    max_n: int = 3,
) -> list[dict[str, Any]]:
    """Return filings close to target_date (within ±2 days), else the most recent ones."""
    try:
        td = datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        return filings[:max_n]

    close: list[dict[str, Any]] = []
    for f in filings:
        raw_fd = f.get("filing_date")
        if not raw_fd:
            continue
        try:
            fd = datetime.strptime(str(raw_fd), "%Y-%m-%d")
        except ValueError:
            continue
        if abs((fd - td).days) <= 2:
            close.append(f)
    return (close or filings)[:max_n]


def _build_event(
    item: dict[str, Any],
    filing: dict[str, Any],
    extracted: dict[str, Any] | None,
) -> dict[str, Any]:
    filing_date = filing["filing_date"]
    cik10 = item["cik10"]
    accession = filing["accession"]
    cik_int = str(int(cik10))

    # CD proximity
    days_before_cd: int | None = None
    cd_window_match = False
    if item["cd_date"] and filing_date:
        try:
            fd = datetime.strptime(filing_date, "%Y-%m-%d")
            cd = datetime.strptime(item["cd_date"], "%Y-%m-%d")
            days_before_cd = (cd - fd).days
            cd_window_match = 0 <= days_before_cd <= 90
        except ValueError:
            pass

    return {
        "ticker": item["ticker"],
        "company": item["company"],
        "cik": cik10,
        "filing_date": filing_date,
        "cd_date": item["cd_date"],
        "days_before_cd": days_before_cd,
        "cd_window_match": cd_window_match,
        "accession": accession,
        "form_type": filing.get("form_type", "8-K"),
        "items_raw": filing.get("items", ""),
        "items_label": item["items_label"],
        "edgar_browse_url": (
            f"https://www.sec.gov/cgi-bin/browse-edgar?"
            f"action=getcompany&CIK={cik_int}&type=8-K&owner=exclude&count=10"
        ),
        "filing_doc_url": _filing_html_url(cik10, accession, filing.get("primary_doc", "")),
        "delta_d1": item["delta_d1"],
        "delta_d2": item["delta_d2"],
        "delta_d3": item["delta_d3"],
        "extracted": extracted or {},
    }
