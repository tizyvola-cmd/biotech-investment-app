"""
FDA Advisory Committee calendar — next 3 months, NASDAQ names only.

Live sources: Federal Register notices + FDA.gov meeting pages.
Seed covers already-announced 2026 meetings so the desk is not empty
when FDA has not yet posted October–December.

Display only. Not a Soft BUY/SELL input.

Monthly refresh (1st of the month) rewrites the 3-month window.
"""
from __future__ import annotations

import calendar
import json
import logging
import re
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, time as dt_time, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("supernova.fda_adcom")

HORIZON_MONTHS = 3
SOURCE_URL = "https://www.fda.gov/advisory-committees/advisory-committee-calendar"
_DATA_DIR = Path("data")
_SNAPSHOT_PATH = _DATA_DIR / "fda_adcom_calendar_snapshot.json"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_PDF_HEADERS = {
    "User-Agent": _UA,
    "Accept": "application/pdf,application/octet-stream,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.fda.gov/advisory-committees/advisory-committee-calendar",
    "Connection": "close",
}

_STATUS: dict[str, Any] = {
    "running": False,
    "message": "",
    "error": None,
    "finished_at": None,
}
_STATUS_LOCK = threading.Lock()

# Sponsor fragment → NASDAQ ticker (public US listing).
_NASDAQ_SPONSORS: dict[str, tuple[str, str]] = {
    "grail": ("GRAL", "GRAIL, Inc."),
    "gilead": ("GILD", "Gilead Sciences, Inc."),
    "amgen": ("AMGN", "Amgen Inc."),
    "vericel": ("VCEL", "Vericel Corporation"),
    "seastar": ("ICU", "SeaStar Medical Holding Corporation"),
    "quelimmune": ("ICU", "SeaStar Medical Holding Corporation"),
    "profound": ("PROF", "Profound Medical Corp."),
    "sonalleve": ("PROF", "Profound Medical Corp."),
    "orthopediatrics": ("KIDS", "OrthoPediatrics Corp."),
    "apifix": ("KIDS", "OrthoPediatrics Corp."),
    "innoviva": ("INVA", "Innoviva, Inc."),
    "ligand": ("LGND", "Ligand Pharmaceuticals Incorporated"),
    "zelsuvmi": ("LGND", "Ligand Pharmaceuticals Incorporated"),
    "berdazimer": ("LGND", "Ligand Pharmaceuticals Incorporated"),
    "astrazeneca": ("AZN", "AstraZeneca PLC"),
    "moderna": ("MRNA", "Moderna, Inc."),
    "capricor": ("CAPR", "Capricor Therapeutics, Inc."),
    "replimune": ("REPL", "Replimune Group, Inc."),
    "vertex": ("VRTX", "Vertex Pharmaceuticals Incorporated"),
    "biogen": ("BIIB", "Biogen Inc."),
    "regeneron": ("REGN", "Regeneron Pharmaceuticals, Inc."),
    "sarepta": ("SRPT", "Sarepta Therapeutics, Inc."),
    "immunitybio": ("IBRX", "ImmunityBio, Inc."),
    "jazz pharmaceuticals": ("JAZZ", "Jazz Pharmaceuticals plc"),
    "eli lilly": ("LLY", "Eli Lilly and Company"),
    "lilly": ("LLY", "Eli Lilly and Company"),
    "inspire medical": ("INSP", "Inspire Medical Systems, Inc."),
}

_SEED: list[dict[str, Any]] = [
    {
        "id": "2026-09-16-GILD",
        "date": "2026-09-16",
        "ticker": "GILD",
        "company": "Gilead Sciences, Inc.",
        "product": "Veklury; Vemlidy",
        "eventEn": "PAC pediatric post-marketing safety review (Veklury, Vemlidy)",
        "eventIt": "PAC review sicurezza pediatrica post-marketing (Veklury, Vemlidy)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194287/download",
    },
    {
        "id": "2026-09-16-AMGN",
        "date": "2026-09-16",
        "ticker": "AMGN",
        "company": "Amgen Inc.",
        "product": "Aranesp (darbepoetin alfa)",
        "eventEn": "PAC pediatric post-marketing safety review (Aranesp)",
        "eventIt": "PAC review sicurezza pediatrica post-marketing (Aranesp)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194269/download",
    },
    {
        "id": "2026-09-16-VCEL",
        "date": "2026-09-16",
        "ticker": "VCEL",
        "company": "Vericel Corporation",
        "product": "Epicel",
        "eventEn": "PAC pediatric HDE safety review (Epicel)",
        "eventIt": "PAC review sicurezza pediatrica HDE (Epicel)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194305/download",
    },
    {
        "id": "2026-09-16-ICU",
        "date": "2026-09-16",
        "ticker": "ICU",
        "company": "SeaStar Medical Holding Corporation",
        "product": "Quelimmune",
        "eventEn": "PAC pediatric HDE safety review (Quelimmune)",
        "eventIt": "PAC review sicurezza pediatrica HDE (Quelimmune)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194306/download",
    },
    {
        "id": "2026-09-16-PROF",
        "date": "2026-09-16",
        "ticker": "PROF",
        "company": "Profound Medical Corp.",
        "product": "Sonalleve MR-HIFU",
        "eventEn": "PAC pediatric HDE safety review (Sonalleve)",
        "eventIt": "PAC review sicurezza pediatrica HDE (Sonalleve)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194295/download",
    },
    {
        "id": "2026-09-16-KIDS",
        "date": "2026-09-16",
        "ticker": "KIDS",
        "company": "OrthoPediatrics Corp.",
        "product": "MID-C / ApiFix",
        "eventEn": "PAC pediatric HDE safety review (MID-C System)",
        "eventIt": "PAC review sicurezza pediatrica HDE (MID-C System)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194303/download",
    },
    {
        "id": "2026-09-16-INVA",
        "date": "2026-09-16",
        "ticker": "INVA",
        "company": "Innoviva, Inc.",
        "product": "Zevtera (ceftobiprole)",
        "eventEn": "PAC pediatric post-marketing safety review (Zevtera)",
        "eventIt": "PAC review sicurezza pediatrica post-marketing (Zevtera)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194291/download",
    },
    {
        "id": "2026-09-16-LGND",
        "date": "2026-09-16",
        "ticker": "LGND",
        "company": "Ligand Pharmaceuticals Incorporated",
        "product": "Zelsuvmi (berdazimer)",
        "eventEn": "PAC pediatric post-marketing safety review (Zelsuvmi)",
        "eventIt": "PAC review sicurezza pediatrica post-marketing (Zelsuvmi)",
        "committee": "Pediatric Advisory Committee",
        "kind": "safety_review",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
        "briefingPdfHint": "https://www.fda.gov/media/194289/download",
    },
    {
        "id": "2026-09-23-GRAL",
        "date": "2026-09-23",
        "ticker": "GRAL",
        "company": "GRAIL, Inc.",
        "product": "Galleri",
        "eventEn": "CDRH panel vote: PMA Galleri multi-cancer early detection (adults ≥50)",
        "eventIt": "Voto panel CDRH: PMA Galleri screening multi-cancro (adulti ≥50)",
        "committee": "Molecular and Clinical Genetics Panel",
        "kind": "vote",
        "href": "https://www.fda.gov/advisory-committees/advisory-committee-calendar/september-23-2026-molecular-and-clinical-genetics-panel-medical-devices-advisory-committee-meeting",
        # Prefer FDA staff exec summary; sponsor package is media/194910.
        "briefingPdfHint": "https://www.fda.gov/media/194909/download",
    },
]


def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def horizon_window(today: date | None = None) -> tuple[date, date]:
    start = today or date.today()
    return start, add_months(start, HORIZON_MONTHS)


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def in_horizon(iso: str, start: date, end: date) -> bool:
    try:
        d = date.fromisoformat(iso[:10])
    except ValueError:
        return False
    return start <= d <= end


def rows_in_horizon(
    rows: list[dict[str, Any]],
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    return [r for r in rows if in_horizon(str(r.get("date") or ""), start, end)]


def get_status() -> dict[str, Any]:
    with _STATUS_LOCK:
        return dict(_STATUS)


def _set_status(**patch: Any) -> None:
    with _STATUS_LOCK:
        _STATUS.update(patch)


def load_snapshot() -> dict[str, Any]:
    if not _SNAPSHOT_PATH.is_file():
        start, end = horizon_window()
        return _payload(rows_in_horizon(_SEED, start, end), start, end, source="seed")
    try:
        doc = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        start, end = horizon_window()
        return _payload(rows_in_horizon(_SEED, start, end), start, end, source="seed")
    return doc if isinstance(doc, dict) else {}


def rows_including_seed(today: date | None = None) -> list[dict[str, Any]]:
    """Snapshot rows plus seed names still inside the 3-month horizon (e.g. AMGN PAC)."""
    start, end = horizon_window(today)
    snap = load_snapshot()
    raw = [r for r in (snap.get("rows") if isinstance(snap, dict) else None) or [] if isinstance(r, dict)]
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows_in_horizon(_SEED, start, end) + rows_in_horizon(raw, start, end):
        key = str(row.get("id") or f"{row.get('ticker')}|{row.get('date')}")
        by_id[key] = row
    return list(by_id.values())


def snapshot_month_stale(now: date | None = None) -> bool:
    today = now or date.today()
    if not _SNAPSHOT_PATH.is_file():
        return True
    snap = load_snapshot()
    return str(snap.get("refreshed_for_month") or "") != month_key(today)


def _payload(
    rows: list[dict[str, Any]],
    start: date,
    end: date,
    *,
    source: str,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "updated_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "refreshed_for_month": month_key(start),
        "horizon_start": start.isoformat(),
        "horizon_end": end.isoformat(),
        "horizon_months": HORIZON_MONTHS,
        "source": source,
        "source_url": SOURCE_URL,
        "count": len(rows),
        "rows": rows,
        "error": error,
    }


def _http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (ssl.SSLError, urllib.error.URLError) as exc:
        reason = getattr(exc, "reason", None)
        ssl_fail = isinstance(exc, ssl.SSLError) or isinstance(reason, ssl.SSLError)
        if not ssl_fail and "CERTIFICATE" not in str(exc).upper() and "CERTIFICATE" not in str(reason).upper():
            raise
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read().decode("utf-8", errors="replace")


def _http_get_bytes(url: str, timeout: int = 40) -> bytes:
    req = urllib.request.Request(url, headers=dict(_PDF_HEADERS))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        # Some FDA edges 403 the first hit; retry once with unverified SSL + alt Accept.
        if exc.code not in (403, 401, 429):
            raise
        hdrs = dict(_PDF_HEADERS)
        hdrs["Accept"] = "*/*"
        req2 = urllib.request.Request(url, headers=hdrs)
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req2, timeout=timeout, context=ctx) as resp:
            return resp.read()
    except (ssl.SSLError, urllib.error.URLError) as exc:
        reason = getattr(exc, "reason", None)
        ssl_fail = isinstance(exc, ssl.SSLError) or isinstance(reason, ssl.SSLError)
        if not ssl_fail and "CERTIFICATE" not in str(exc).upper() and "CERTIFICATE" not in str(reason).upper():
            raise
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read()


def preserve_briefings(
    rows: list[dict[str, Any]],
    previous: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    old = {
        str(r.get("id") or ""): r.get("briefing")
        for r in (previous or [])
        if isinstance(r, dict) and r.get("briefing")
    }
    seed_hints = {
        str(r.get("id") or ""): str(r.get("briefingPdfHint") or "").strip()
        for r in _SEED
        if str(r.get("briefingPdfHint") or "").strip()
    }
    out: list[dict[str, Any]] = []
    for row in rows:
        rid = str(row.get("id") or "")
        nxt = dict(row)
        if rid and rid in old and not nxt.get("briefing"):
            nxt["briefing"] = old[rid]
        if rid and rid in seed_hints and not str(nxt.get("briefingPdfHint") or "").strip():
            nxt["briefingPdfHint"] = seed_hints[rid]
        out.append(nxt)
    return out


_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def extract_meeting_dates(text: str) -> list[date]:
    """ISO dates and 'October 15, 2026' / '15 October 2026' from a notice."""
    out: list[date] = []
    seen: set[date] = set()

    def _add(d: date) -> None:
        if d not in seen:
            seen.add(d)
            out.append(d)

    for m in re.finditer(r"\b(20\d{2})-(\d{2})-(\d{2})\b", text):
        try:
            _add(date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass
    pat = re.compile(
        r"\b(" + "|".join(_MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b",
        re.I,
    )
    for m in pat.finditer(text):
        try:
            _add(date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2))))
        except ValueError:
            pass
    return out


def match_nasdaq_sponsor(text: str) -> list[tuple[str, str, str]]:
    """Return (ticker, company, fragment) hits in meeting text."""
    blob = re.sub(r"\s+", " ", text).lower()
    hits: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for key, (tk, company) in sorted(_NASDAQ_SPONSORS.items(), key=lambda x: -len(x[0])):
        if key in blob and tk not in seen:
            seen.add(tk)
            hits.append((tk, company, key))
    return hits


def _kind_from_text(text: str) -> str:
    low = text.lower()
    if "post-marketing" in low or "pediatric advisory" in low or "safety review" in low:
        return "safety_review"
    return "vote"


def _committee_from_text(text: str) -> str:
    m = re.search(
        r"([A-Z][A-Za-z0-9 ,&\-/]+Advisory Committee(?:\s+Meeting)?)",
        text,
    )
    if m:
        return m.group(1).strip()
    if "molecular and clinical genetics" in text.lower():
        return "Molecular and Clinical Genetics Panel"
    return "FDA Advisory Committee"


def _horizon_months(start: date, end: date) -> list[tuple[int, int]]:
    months: list[tuple[int, int]] = []
    cursor = date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    while cursor <= last:
        months.append((cursor.year, cursor.month))
        cursor = add_months(cursor, 1)
        cursor = date(cursor.year, cursor.month, 1)
    return months


def _rows_from_fr_items(
    items: list[Any],
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "")
        abstract = str(item.get("abstract") or "")
        href = str(item.get("html_url") or SOURCE_URL)
        blob = f"{title}\n{abstract}"
        if "renewal" in title.lower() or "termination" in title.lower():
            continue
        if "notice of meeting" not in title.lower() and "meeting" not in title.lower():
            continue
        dates = [d for d in extract_meeting_dates(blob) if start <= d <= end]
        if not dates:
            continue
        sponsors = match_nasdaq_sponsor(blob)
        if not sponsors:
            continue
        kind = _kind_from_text(blob)
        committee = _committee_from_text(blob)
        meet = dates[0]
        for tk, company, frag in sponsors:
            rows.append(
                {
                    "id": f"{meet.isoformat()}-{tk}",
                    "date": meet.isoformat(),
                    "ticker": tk,
                    "company": company,
                    "product": frag.title(),
                    "eventEn": title[:180],
                    "eventIt": title[:180],
                    "committee": committee,
                    "kind": kind,
                    "href": href,
                }
            )
    return rows


def _fr_search(term: str, *, per_page: int = 40) -> list[Any]:
    q = urllib.parse.urlencode(
        [
            ("conditions[agencies][]", "food-and-drug-administration"),
            ("conditions[type][]", "NOTICE"),
            ("conditions[term]", term),
            ("per_page", str(per_page)),
            ("order", "newest"),
        ]
    )
    raw = _http_get(f"https://www.federalregister.gov/api/v1/documents.json?{q}", timeout=25)
    doc = json.loads(raw)
    results = doc.get("results") or []
    return results if isinstance(results, list) else []


def _live_from_federal_register(start: date, end: date) -> list[dict[str, Any]]:
    items = _fr_search("advisory committee notice of meeting", per_page=50)
    return _rows_from_fr_items(items, start, end)


def _extract_calendar_hrefs(html: str) -> list[str]:
    hrefs: list[str] = []
    for m in re.finditer(
        r'href="(https://www\.fda\.gov/advisory-committees/advisory-committee-calendar/[^"]+)"',
        html,
    ):
        hrefs.append(m.group(1))
    for m in re.finditer(
        r'href="(/advisory-committees/advisory-committee-calendar/[^"#?]+)"',
        html,
    ):
        hrefs.append("https://www.fda.gov" + m.group(1))
    return hrefs


def _rows_from_meeting_pages(
    hrefs: list[str],
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen_href: set[str] = set()
    for href in hrefs:
        if href.rstrip("/") == SOURCE_URL.rstrip("/") or href in seen_href:
            continue
        seen_href.add(href)
        try:
            page = _http_get(href, timeout=20)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            logger.warning("FDA meeting page %s: %s", href, exc)
            continue
        dates = [d for d in extract_meeting_dates(page) if start <= d <= end]
        if not dates:
            continue
        sponsors = match_nasdaq_sponsor(page)
        if not sponsors:
            continue
        title_m = re.search(r"<title>([^<]+)</title>", page, re.I)
        title = re.sub(r"\s+\|\s+FDA\s*$", "", title_m.group(1) if title_m else "FDA AdCom").strip()
        kind = _kind_from_text(page)
        committee = _committee_from_text(page)
        meet = dates[0]
        for tk, company, frag in sponsors:
            rows.append(
                {
                    "id": f"{meet.isoformat()}-{tk}",
                    "date": meet.isoformat(),
                    "ticker": tk,
                    "company": company,
                    "product": frag.title(),
                    "eventEn": title[:180],
                    "eventIt": title[:180],
                    "committee": committee,
                    "kind": kind,
                    "href": href,
                }
            )
    return rows


def _live_from_fda_month_search(start: date, end: date) -> list[dict[str, Any]]:
    """Scan the FDA calendar page plus Federal Register month-by-month."""
    rows: list[dict[str, Any]] = []
    try:
        html = _http_get(SOURCE_URL, timeout=20)
        rows.extend(_rows_from_meeting_pages(_extract_calendar_hrefs(html), start, end))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning("FDA calendar page: %s", exc)

    for year, month in _horizon_months(start, end):
        label = calendar.month_name[month]
        try:
            items = _fr_search(f"{label} {year} advisory committee notice of meeting", per_page=20)
            rows.extend(_rows_from_fr_items(items, start, end))
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            logger.warning("FR month search %s %s: %s", label, year, exc)
    return rows


def _merge_rows(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for group in groups:
        for row in group:
            rid = str(row.get("id") or "")
            if not rid:
                continue
            prev = by_id.get(rid)
            if prev is None or (prev.get("kind") != "vote" and row.get("kind") == "vote"):
                by_id[rid] = row
    return list(by_id.values())


def refresh_fda_adcom_calendar(
    *,
    today: date | None = None,
    live: bool = True,
) -> dict[str, Any]:
    start, end = horizon_window(today)
    _set_status(running=True, message="Scanning FDA + Federal Register (3 months)", error=None)
    live_rows: list[dict[str, Any]] = []
    err: str | None = None
    if live:
        try:
            live_rows.extend(_live_from_federal_register(start, end))
        except Exception as exc:
            logger.warning("Federal Register AdCom scan failed: %s", exc)
            err = "federal_register_unavailable"
        try:
            live_rows.extend(_live_from_fda_month_search(start, end))
        except Exception as exc:
            logger.warning("FDA month search failed: %s", exc)
            if err:
                err = "live_unavailable"
            else:
                err = "fda_search_unavailable"
    merged = _merge_rows(_SEED, live_rows)
    windowed = rows_in_horizon(merged, start, end)
    prev_rows: list[dict[str, Any]] = []
    if _SNAPSHOT_PATH.is_file():
        prev = load_snapshot()
        raw_prev = prev.get("rows") if isinstance(prev, dict) else None
        if isinstance(raw_prev, list):
            prev_rows = [r for r in raw_prev if isinstance(r, dict)]
    windowed = preserve_briefings(windowed, prev_rows)
    source = "fda+federalregister+seed" if live_rows else "seed"
    payload = _payload(windowed, start, end, source=source, error=err)
    _SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _SNAPSHOT_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_SNAPSHOT_PATH)
    _set_status(
        running=False,
        message=f"{len(windowed)} NASDAQ AdCom rows · {start} → {end}",
        error=err,
        finished_at=payload["updated_at"],
    )
    try:
        from guidance_calendar import write_catalyst_sim_entries

        write_catalyst_sim_entries()
    except Exception as exc:
        logger.warning("FDA AdCom → catalyst sim entries failed: %s", exc)
    return payload


def run_fda_adcom_calendar_refresh(*, force: bool = False) -> dict[str, Any]:
    if get_status().get("running") and not force:
        return {"error": "already_running", **get_status()}
    return refresh_fda_adcom_calendar(live=True)


def should_run_fda_adcom_refresh(
    now: datetime,
    *,
    last_month: str | None,
    at: dt_time = dt_time(7, 15),
    grace_minutes: int = 30,
) -> bool:
    """True once on the 1st of the month after ``at`` (any weekday).

    No upper time bound: if the process starts later on the 1st, it still runs.
    ``grace_minutes`` is kept for callers; the gate is ``now >= at``.
    """
    if now.day != 1:
        return False
    key = month_key(now.date())
    if last_month == key:
        return False
    target_m = at.hour * 60 + at.minute
    now_m = now.hour * 60 + now.minute
    _ = grace_minutes
    return now_m >= target_m
