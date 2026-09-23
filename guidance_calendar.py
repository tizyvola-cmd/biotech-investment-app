"""
Guidance Calendar — Corporate Catalyst Timeline Extractor
==========================================================
Scans existing press releases, SEC 8-K filings, and external PDUFA
calendars for biotech catalyst guidance.  Uses the AI provider to
extract forward-looking phrases like:

  "topline data expected in 2H 2026"
  "NDA submission planned mid-2027"
  "PDUFA date set for October 2026"

Also estimates PDUFA windows from submission announcements:
  - Priority review ≈ 8 months from submission
  - Standard review ≈ 10-12 months from submission
  - AdCom/CHMP dates from public FDA calendar

Sponsor matching reuses the same Exact/Partial mechanism as the
clinical enrichment pipeline (data_orchestrator._compute_sponsor_match).

Output: data/guidance_calendar_snapshot.json

Sources:
  - press_release_fetch.py   → data/cache/press_releases/
  - catalyst_extractor.py    → data/catalyst_feed_snapshot.json
  - clinical_pre_cd_enrichment.py → data/clinical_pre_cd_enrichment_snapshot.json
  - BiopharmCatalyst PDUFA calendar (optional, scrape)
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import ai_provider

try:
    import ai_secrets_store
    ai_secrets_store.load_and_apply()
except Exception:
    pass

# ── Paths ──────────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).resolve().parent / "data"
_PRESS_CACHE_DIR = _DATA_DIR / "cache" / "press_releases"
_SNAPSHOT_PATH = _DATA_DIR / "guidance_calendar_snapshot.json"
_CACHE_PATH = _DATA_DIR / "guidance_calendar_cache.json"
_PDUFA_CACHE_PATH = _DATA_DIR / "pdufa_calendar_cache.json"
_SCHEDULE_MARKER = _DATA_DIR / "guidance_calendar_weekly_marker.json"

# ── Config ─────────────────────────────────────────────────────────────────────
MAX_TICKERS = int(os.environ.get("GUIDANCE_MAX_TICKERS", "300"))
MAX_PRESS_PER_TICKER = int(os.environ.get("GUIDANCE_MAX_PRESS_PER_TICKER", "6"))
PDUFA_CACHE_TTL_H = int(os.environ.get("PDUFA_CACHE_TTL_HOURS", "48"))
# Calendar tab forward horizon for CT.gov / Simulation CD days (~6 months)
CALENDAR_CD_HORIZON_DAYS = int(os.environ.get("CALENDAR_CD_HORIZON_DAYS", "180"))
_CTGOV_STUDIES_URL = "https://clinicaltrials.gov/api/v2/studies"
_DISCOVERY_CD_CACHE_PATH = _DATA_DIR / "discovery_ctgov_cd_cache.json"

# Priority review: ~8 months; Standard: ~10-12 months
PRIORITY_REVIEW_DAYS = 243   # ~8 months
STANDARD_REVIEW_DAYS_MIN = 304  # ~10 months
STANDARD_REVIEW_DAYS_MAX = 365  # ~12 months

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
    try:
        out["last_weekly_week"] = last_weekly_week()
        marker = json.loads(_SCHEDULE_MARKER.read_text(encoding="utf-8"))
        out["last_weekly_at"] = marker.get("last_weekly_at")
    except Exception:
        out.setdefault("last_weekly_week", last_weekly_week())
        out.setdefault("last_weekly_at", None)
    return out


def last_weekly_week() -> str | None:
    """ISO week key of the last successful Monday/catch-up Calendar refresh."""
    try:
        raw = json.loads(_SCHEDULE_MARKER.read_text(encoding="utf-8"))
        v = raw.get("last_weekly_week")
        return str(v) if v else None
    except Exception:
        return None


def mark_weekly_run(week: str | None = None) -> None:
    """Persist successful weekly Calendar refresh (survives process restart)."""
    from supernova_schedule import iso_week_key

    key = week or iso_week_key(date.today())
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _SCHEDULE_MARKER.write_text(
        json.dumps(
            {
                "last_weekly_week": key,
                "last_weekly_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _set_status(**kw: Any) -> None:
    with _STATUS_LOCK:
        _STATUS.update(kw)


# ── Sponsor matching (reuse data_orchestrator logic) ──────────────────────────

def _verify_sponsor(company: str, external_company: str) -> bool:
    """Return True if `external_company` is a sponsor match for `company`.

    Uses the same Exact/Partial mechanism as the clinical enrichment pipeline.
    """
    if not company or not external_company:
        return False
    try:
        from data_orchestrator import _compute_sponsor_match
        result = _compute_sponsor_match(company, external_company)
        return result in ("Exact", "Partial")
    except ImportError:
        pass
    try:
        from fetch_edgar import _compute_sponsor_match
        result = _compute_sponsor_match(company, external_company)
        return result in ("Exact", "Partial")
    except ImportError:
        pass
    c1 = company.lower().split()
    c2 = external_company.lower().split()
    stopwords = {"inc", "inc.", "llc", "ltd", "corp", "corporation", "co", "co.", "plc", "the"}
    w1 = {w for w in c1 if w not in stopwords and len(w) > 2}
    w2 = {w for w in c2 if w not in stopwords and len(w) > 2}
    if not w1 or not w2:
        return False
    overlap = w1 & w2
    return bool(overlap) and len(overlap) / min(len(w1), len(w2)) >= 0.5


def _ticker_company_map() -> dict[str, str]:
    """Build ticker → company name mapping from Simulation snapshot."""
    out: dict[str, str] = {}
    sim_path = _DATA_DIR / "simulation_sheet_snapshot.json"
    if sim_path.is_file():
        try:
            snap = json.loads(sim_path.read_text(encoding="utf-8"))
            for row in snap.get("rows", []):
                tk = str(row.get("Ticker", "")).strip().upper()
                co = str(
                    row.get("Società", "") or row.get("Società (full name)", "")
                    or row.get("Company", "") or ""
                ).strip()
                if tk and co:
                    out[tk] = co
        except Exception:
            pass
    yf_path = _DATA_DIR / "yf.json"
    if yf_path.is_file():
        try:
            yf = json.loads(yf_path.read_text(encoding="utf-8"))
            yf_items = yf if isinstance(yf, list) else list(yf.values()) if isinstance(yf, dict) else []
            for info in yf_items:
                if not isinstance(info, dict):
                    continue
                tk_u = str(
                    info.get("symbol") or info.get("ticker") or ""
                ).strip().upper()
                if not tk_u or tk_u in out:
                    continue
                name = str(
                    info.get("companyName")
                    or info.get("shortName")
                    or info.get("longName")
                    or ""
                ).strip()
                if name and name != "None":
                    out[tk_u] = name
        except Exception:
            pass
    return out


# ── PDUFA estimation from submission announcements ────────────────────────────

_SUBMISSION_RE = re.compile(
    r"(?:NDA|BLA|sNDA|sBLA|MAA|supplemental\s+NDA)\s+(?:accept|fil|submis|submit)",
    re.IGNORECASE,
)
_PRIORITY_RE = re.compile(r"priority\s+review", re.IGNORECASE)
_PDUFA_EXPLICIT_RE = re.compile(
    r"PDUFA\s+(?:date|target|action\s+date)\s*[:\-]?\s*(\w+\s+\d{1,2},?\s+\d{4}|\w+\s+\d{4})",
    re.IGNORECASE,
)

# ── Regex-based guidance extraction (no LLM) ────────────────────────────

_TIMING_PHRASES = re.compile(
    r"(?:expect|anticipat|plan|target|project|schedul|aim)\w*\s+"
    r"(?:to\s+(?:report|release|announce|present|initiate|submit|file|complete|receive|"
    r"close|enter|sign|partner|out-?licen[sc]e|in-?licen[sc]e)|"
    r"(?:topline|top-line|interim|preliminary|pivotal|phase)\s+\w+\s+)"
    r".*?"
    r"(?:"
    r"(?:in|by|during|for)\s+"
    r"(?:(?:the\s+)?(?:first|second)\s+half|[12]H|H[12]|Q[1-4]|"
    r"(?:early|mid|late|end\s+of|year[- ]?end)\s*(?:-?\s*)?)"
    r"\s*(?:of\s+)?20\d{2}"
    r"|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{4})"
    r"|(?:20\d{2})"
    r")",
    re.IGNORECASE,
)

_HALF_YEAR_RE = re.compile(
    r"(?:(?:first|1st)\s+half|1H|H1)\s*(?:of\s+)?(20\d{2})", re.IGNORECASE
)
_HALF_YEAR_2_RE = re.compile(
    r"(?:(?:second|2nd)\s+half|2H|H2)\s*(?:of\s+)?(20\d{2})", re.IGNORECASE
)
_QUARTER_RE = re.compile(
    r"Q([1-4])\s*(?:of\s+)?(20\d{2})", re.IGNORECASE
)
_EARLY_RE = re.compile(r"(?:early|begin\w*)\s*(?:of\s+)?(20\d{2})", re.IGNORECASE)
_MID_RE = re.compile(r"mid[- ]?(20\d{2})", re.IGNORECASE)
_LATE_RE = re.compile(r"(?:late|end\s+of|year[- ]?end)\s*(?:of\s+)?(20\d{2})", re.IGNORECASE)
_MONTH_YEAR_RE = re.compile(
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?)\s+(20\d{2})",
    re.IGNORECASE,
)
_BARE_YEAR_RE = re.compile(r"\b(20\d{2})\b")

_READOUT_KW = re.compile(
    r"topline|top-line|readout|data\s+read|interim\s+(?:data|results|analysis)|"
    r"primary\s+endpoint|pivotal\s+(?:data|results)|phase\s+[123].*(?:data|results)",
    re.IGNORECASE,
)
_INITIATION_KW = re.compile(
    r"initiat|first\s+patient|dose\s+first|enroll\s+first|commence|begin\s+(?:phase|enrollment)",
    re.IGNORECASE,
)
_PARTNERSHIP_KW = re.compile(
    r"partner\w*|collaborat\w*|licen[sc]\w*|alliance|joint\s+venture|"
    r"milestone\s+payment|upfront\s+payment|opt(?:-|\s)?in|option\s+exercise|"
    r"clos\w+\s+(?:of\s+)?(?:the\s+)?(?:transaction|deal|agreement)",
    re.IGNORECASE,
)


def _infer_window_from_phrase(phrase: str) -> tuple[str | None, str | None]:
    """Infer window_start/end from a timing phrase."""
    m = _HALF_YEAR_RE.search(phrase)
    if m:
        yr = m.group(1)
        return f"{yr}-01-01", f"{yr}-06-30"
    m = _HALF_YEAR_2_RE.search(phrase)
    if m:
        yr = m.group(1)
        return f"{yr}-07-01", f"{yr}-12-31"
    m = _QUARTER_RE.search(phrase)
    if m:
        q, yr = int(m.group(1)), m.group(2)
        starts = {1: "01-01", 2: "04-01", 3: "07-01", 4: "10-01"}
        ends = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}
        return f"{yr}-{starts[q]}", f"{yr}-{ends[q]}"
    m = _EARLY_RE.search(phrase)
    if m:
        yr = m.group(1)
        return f"{yr}-01-01", f"{yr}-04-30"
    m = _MID_RE.search(phrase)
    if m:
        yr = m.group(1)
        return f"{yr}-04-01", f"{yr}-08-31"
    m = _LATE_RE.search(phrase)
    if m:
        yr = m.group(1)
        return f"{yr}-09-01", f"{yr}-12-31"
    m = _MONTH_YEAR_RE.search(phrase)
    if m:
        d = _try_parse_fuzzy_date(f"{m.group(1)} {m.group(2)}")
        if d:
            end = (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
            return d.replace(day=1).isoformat(), end.isoformat()
    m = _BARE_YEAR_RE.search(phrase)
    if m:
        yr = m.group(1)
        return f"{yr}-01-01", f"{yr}-12-31"
    return None, None


def _extract_guidance_regex(sources: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Extract guidance events from text using regex (no LLM needed)."""
    events: list[dict[str, Any]] = []
    seen: set[str] = set()

    for src in sources:
        text = src.get("text", "")
        if len(text) < 30:
            continue

        for m in _TIMING_PHRASES.finditer(text):
            phrase = m.group(0).strip()
            ws, we = _infer_window_from_phrase(phrase)
            if not ws:
                continue

            if _READOUT_KW.search(phrase):
                etype = "readout"
            elif _INITIATION_KW.search(phrase):
                etype = "initiation"
            elif _SUBMISSION_RE.search(phrase):
                etype = "submission"
            elif _PARTNERSHIP_KW.search(phrase):
                etype = "partnership"
            else:
                etype = "other"

            key = f"{etype}|{ws}"
            if key in seen:
                continue
            seen.add(key)

            events.append({
                "event_type": etype,
                "timing_quote": phrase[:120],
                "window_start": ws,
                "window_end": we,
                "source_type": src.get("source_type", "unknown"),
                "source_date": src.get("date", ""),
                "confidence": 0.5,
                "estimation_method": "regex_extract",
            })

    return events


def _estimate_pdufa_from_submission(
    text: str,
    source_date: str | None,
) -> dict[str, Any] | None:
    """If text announces a submission acceptance, estimate PDUFA window."""
    if not _SUBMISSION_RE.search(text):
        return None
    explicit = _PDUFA_EXPLICIT_RE.search(text)
    if explicit:
        raw_date = explicit.group(1).strip()
        pdufa_date = _try_parse_fuzzy_date(raw_date)
        if pdufa_date:
            return {
                "event_type": "pdufa",
                "timing_quote": explicit.group(0)[:120],
                "window_start": pdufa_date.isoformat(),
                "window_end": pdufa_date.isoformat(),
                "confidence": 0.9,
                "estimation_method": "explicit_pdufa",
            }

    if not source_date:
        return None
    try:
        sub_date = datetime.strptime(source_date[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None

    is_priority = bool(_PRIORITY_RE.search(text))
    if is_priority:
        est = sub_date + timedelta(days=PRIORITY_REVIEW_DAYS)
        return {
            "event_type": "pdufa",
            "timing_quote": f"Priority review — estimated PDUFA ~{est.strftime('%b %Y')}",
            "window_start": est.isoformat(),
            "window_end": (est + timedelta(days=30)).isoformat(),
            "confidence": 0.65,
            "estimation_method": "priority_review_estimate",
        }
    else:
        est_min = sub_date + timedelta(days=STANDARD_REVIEW_DAYS_MIN)
        est_max = sub_date + timedelta(days=STANDARD_REVIEW_DAYS_MAX)
        return {
            "event_type": "pdufa",
            "timing_quote": f"Standard review — estimated PDUFA {est_min.strftime('%b')}–{est_max.strftime('%b %Y')}",
            "window_start": est_min.isoformat(),
            "window_end": est_max.isoformat(),
            "confidence": 0.55,
            "estimation_method": "standard_review_estimate",
        }


def _try_parse_fuzzy_date(s: str) -> date | None:
    """Parse 'October 2026', 'Oct 15, 2026', etc."""
    for fmt in ("%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y", "%B %Y", "%b %Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


# ── External PDUFA calendar (BiopharmCatalyst / RSS) ──────────────────────────

def _load_pdufa_cache() -> list[dict[str, Any]]:
    try:
        doc = json.loads(_PDUFA_CACHE_PATH.read_text(encoding="utf-8"))
        fetched = doc.get("fetched_at")
        if fetched:
            dt = datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
            age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
            if age_h <= PDUFA_CACHE_TTL_H:
                return doc.get("events", [])
    except Exception:
        pass
    return []


def _save_pdufa_cache(events: list[dict[str, Any]]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _PDUFA_CACHE_PATH.write_text(
        json.dumps({
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "events": events,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


_PDUFA_DATE_RE = re.compile(
    r"(\b(?:January|February|March|April|May|June|July|August|September|October|November|December"
    r"|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})",
)

_UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _fetch_pdufa_calendar(
    ticker_company: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Fetch PDUFA dates from Drugs@FDA API (free, no key needed).

    Optionally pass ticker→company map for targeted sponsor search.
    """
    cached = _load_pdufa_cache()
    if cached:
        return cached

    events: list[dict[str, Any]] = []

    # ── Source 1: RTTNews FDA Calendar (HTML scrape) ─────────────────────
    try:
        events.extend(_scrape_rttnews_pdufa())
    except Exception as exc:
        print(f"[GuidanceCal] RTTNews scrape failed: {exc}", flush=True)

    # ── Source 2: Drugs@FDA API (targeted for our tickers) ───────────────
    try:
        events.extend(_fetch_drugsfda_for_tickers(ticker_company or {}))
    except Exception as exc:
        print(f"[GuidanceCal] Drugs@FDA API failed: {exc}", flush=True)

    if events:
        _save_pdufa_cache(events)
        print(f"[GuidanceCal] Fetched {len(events)} PDUFA events total", flush=True)

    return events


def _scrape_rttnews_pdufa() -> list[dict[str, Any]]:
    """Scrape RTTNews FDA calendar page (returns HTML, not RSS)."""
    import html.parser

    req = urllib.request.Request(
        "https://www.rttnews.com/corpinfo/fdacalendar.aspx",
        headers={"User-Agent": _UA_BROWSER},
    )
    raw = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="replace")

    events: list[dict[str, Any]] = []
    today = date.today()

    # RTTNews renders the calendar as <a> links with structured text.
    # Pattern: company name near a date like "August 13, 2026"
    # Extract all anchor text blocks that contain a future date
    blocks = re.findall(
        r'<a[^>]*href="[^"]*fdacalendar[^"]*"[^>]*>(.*?)</a>',
        raw,
        re.DOTALL | re.IGNORECASE,
    )

    # Also try plain text blocks between tags
    if not blocks:
        blocks = re.findall(r">([^<]{20,300})</", raw)

    seen: set[str] = set()
    for block in blocks:
        text = re.sub(r"<[^>]+>", " ", block).strip()
        text = re.sub(r"\s+", " ", text)
        if len(text) < 10:
            continue

        m = _PDUFA_DATE_RE.search(text)
        if not m:
            continue

        pdufa_date = _try_parse_fuzzy_date(m.group(1))
        if not pdufa_date or pdufa_date < today:
            continue

        company = _extract_company_from_text(text, m.start())
        if not company or len(company) < 3:
            continue

        key = f"{company}|{pdufa_date.isoformat()}"
        if key in seen:
            continue
        seen.add(key)

        events.append({
            "company": company,
            "pdufa_date": pdufa_date.isoformat(),
            "title": text[:200],
            "description": "",
            "source": "rttnews_fda_calendar",
        })

    # Fallback: scan the full HTML for date+company patterns
    if not events:
        for m in _PDUFA_DATE_RE.finditer(raw):
            pdufa_date = _try_parse_fuzzy_date(m.group(1))
            if not pdufa_date or pdufa_date < today:
                continue
            context = raw[max(0, m.start() - 200):m.end() + 50]
            context_clean = re.sub(r"<[^>]+>", " ", context)
            context_clean = re.sub(r"\s+", " ", context_clean).strip()
            company = _extract_company_from_context(context_clean)
            if not company:
                continue
            key = f"{company}|{pdufa_date.isoformat()}"
            if key in seen:
                continue
            seen.add(key)
            events.append({
                "company": company,
                "pdufa_date": pdufa_date.isoformat(),
                "title": context_clean[:200],
                "description": "",
                "source": "rttnews_fda_calendar",
            })

    print(f"[GuidanceCal] RTTNews: {len(events)} future PDUFA dates scraped", flush=True)
    return events


def _fetch_drugsfda_for_tickers(ticker_company: dict[str, str]) -> list[dict[str, Any]]:
    """Search Drugs@FDA for our specific simulation companies (free, no key).

    Looks for recent NDA/BLA submissions from our companies to find pending
    PDUFA dates or recent approval actions.
    """
    events: list[dict[str, Any]] = []
    today = date.today()

    # Batch: search for recent original submissions and match to our companies
    for search_q in [
        "submissions.submission_type:ORIG+AND+submissions.submission_status:AP",
        "submissions.submission_type:ORIG+AND+submissions.submission_status:TA",
        "submissions.submission_type:ORIG+AND+submissions.submission_status:CR",
        "submissions.submission_type:BLA",
    ]:
        try:
            url = (
                f"https://api.fda.gov/drug/drugsfda.json?"
                f"search={search_q}&limit=50"
                f"&sort=submissions.submission_status_date:desc"
            )
            req = urllib.request.Request(url, headers={"User-Agent": _UA_BROWSER})
            data = json.loads(urllib.request.urlopen(req, timeout=10).read().decode("utf-8"))

            for r in data.get("results", []):
                sponsor = r.get("sponsor_name", "")
                brand_names = r.get("openfda", {}).get("brand_name", []) if r.get("openfda") else []
                brand = brand_names[0] if brand_names else ""

                # Match sponsor to our tickers
                matched_ticker = None
                for tk, co in ticker_company.items():
                    if _verify_sponsor(co, sponsor):
                        matched_ticker = tk
                        break
                if not matched_ticker:
                    continue

                for sub in r.get("submissions", []):
                    sub_type = sub.get("submission_type", "")
                    sub_status = sub.get("submission_status", "")
                    sub_date_raw = sub.get("submission_status_date", "")

                    if not sub_date_raw or len(sub_date_raw) < 8:
                        continue
                    try:
                        sub_date = datetime.strptime(sub_date_raw[:8], "%Y%m%d").date()
                    except ValueError:
                        continue

                    if sub_status == "AP" and sub_date >= today - timedelta(days=180):
                        events.append({
                            "company": sponsor,
                            "ticker": matched_ticker,
                            "pdufa_date": sub_date.isoformat(),
                            "title": f"{sponsor} — {brand} — FDA approval {sub_date.isoformat()}",
                            "drug": brand,
                            "description": f"NDA/BLA approved: {brand}",
                            "source": "drugsfda_api",
                            "submission_status": "AP",
                            "fda_outcome": "approved",
                        })
                    elif sub_status == "CR" and sub_date >= today - timedelta(days=180):
                        events.append({
                            "company": sponsor,
                            "ticker": matched_ticker,
                            "pdufa_date": sub_date.isoformat(),
                            "title": f"{sponsor} — {brand} — FDA CRL {sub_date.isoformat()}",
                            "drug": brand,
                            "description": f"Complete response letter: {brand}",
                            "source": "drugsfda_api",
                            "submission_status": "CR",
                            "fda_outcome": "crl",
                        })
                    elif sub_status == "TA" and sub_date >= today - timedelta(days=365):
                        est_pdufa = sub_date + timedelta(days=STANDARD_REVIEW_DAYS_MIN)
                        if est_pdufa >= today:
                            events.append({
                                "company": sponsor,
                                "ticker": matched_ticker,
                                "pdufa_date": est_pdufa.isoformat(),
                                "title": f"{sponsor} — {brand} — est. PDUFA {est_pdufa}",
                                "drug": brand,
                                "description": f"Tentative approval {sub_date}",
                                "source": "drugsfda_api",
                                "submission_status": "TA",
                                "fda_outcome": "tentative_approval",
                            })
        except Exception as exc:
            print(f"[GuidanceCal] Drugs@FDA query failed: {exc}", flush=True)

    # Targeted search for top simulation tickers by company name (limited)
    sim_tickers = list(ticker_company.items())[:50]
    searched = 0
    for tk, company in sim_tickers:
        if searched >= 8:
            break
        if any(e.get("ticker") == tk for e in events):
            continue
        # Clean company name for FDA search
        search_name = re.sub(
            r"\b(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Co\.?|PLC|SA|NV|SE)\b",
            "",
            company,
            flags=re.IGNORECASE,
        ).strip().rstrip(",. ")
        if len(search_name) < 4:
            continue
        search_name_q = search_name.replace(" ", "+").replace("&", "")[:60]
        try:
            url = (
                f"https://api.fda.gov/drug/drugsfda.json?"
                f'search=sponsor_name:"{search_name_q}"&limit=5'
            )
            req = urllib.request.Request(url, headers={"User-Agent": _UA_BROWSER})
            resp_data = json.loads(urllib.request.urlopen(req, timeout=10).read().decode("utf-8"))
            searched += 1

            for r in resp_data.get("results", []):
                fda_sponsor = r.get("sponsor_name", "")
                brand_names = r.get("openfda", {}).get("brand_name", []) if r.get("openfda") else []
                brand = brand_names[0] if brand_names else ""
                for sub in r.get("submissions", []):
                    sub_date_raw = sub.get("submission_status_date", "")
                    sub_status = sub.get("submission_status", "")
                    if not sub_date_raw or len(sub_date_raw) < 8:
                        continue
                    try:
                        sub_date = datetime.strptime(sub_date_raw[:8], "%Y%m%d").date()
                    except ValueError:
                        continue
                    if sub_date >= today - timedelta(days=365) and sub_status in ("AP", "TA", "CR"):
                        outcome = (
                            "approved"
                            if sub_status == "AP"
                            else "tentative_approval"
                            if sub_status == "TA"
                            else "crl"
                        )
                        events.append({
                            "company": fda_sponsor,
                            "ticker": tk,
                            "pdufa_date": sub_date.isoformat(),
                            "title": f"{fda_sponsor} — {brand} — {sub_status} {sub_date}",
                            "drug": brand,
                            "description": f"FDA {sub_status}: {brand}",
                            "source": "drugsfda_api_targeted",
                            "submission_status": sub_status,
                            "fda_outcome": outcome,
                        })
        except Exception:
            continue

    print(f"[GuidanceCal] Drugs@FDA: {len(events)} events matched to our tickers", flush=True)
    return events


def _extract_company_from_text(text: str, date_pos: int) -> str | None:
    """Extract company name from text, typically before the date."""
    before = text[:date_pos].strip().rstrip("–-—·,: ")
    if not before:
        return None
    parts = re.split(r"\s*[-–—|·]\s*", before)
    if parts:
        candidate = parts[0].strip()
        if len(candidate) >= 3:
            return candidate
    return before[:80]


def _extract_company_from_context(context: str) -> str | None:
    """Extract company name from surrounding HTML context of a date match."""
    words = context.split()
    candidates: list[str] = []
    for w in words:
        if re.match(r"^[A-Z][a-z]", w) and len(w) >= 3:
            candidates.append(w)
        elif candidates and not re.match(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", w):
            if re.match(r"^[A-Z]", w):
                candidates.append(w)
            else:
                break
        elif candidates:
            break
    if candidates:
        return " ".join(candidates[:4])
    return None


def _fda_outcome_from_raw(pev: dict[str, Any]) -> str | None:
    structured = str(pev.get("fda_outcome") or "").strip().lower()
    if structured in {"approved", "tentative_approval", "crl", "pending"}:
        return structured
    status = str(pev.get("submission_status") or "").upper()
    if status == "AP":
        return "approved"
    if status == "TA":
        return "tentative_approval"
    if status == "CR":
        return "crl"
    blob = f"{pev.get('title', '')} {pev.get('description', '')}".lower()
    if "complete response" in blob or re.search(r"\bcrl\b", blob):
        return "crl"
    if "tentative approval" in blob:
        return "tentative_approval"
    if "fda approval" in blob or "nda/bla approved" in blob:
        return "approved"
    return None


def _match_pdufa_to_tickers(
    pdufa_events: list[dict[str, Any]],
    ticker_company_map: dict[str, str],
) -> list[dict[str, Any]]:
    """Match external PDUFA calendar entries to our universe via sponsor matching.

    Events that already carry a `ticker` field (from targeted FDA search) are
    included directly; others are matched by sponsor name.
    """
    matched: list[dict[str, Any]] = []
    for pev in pdufa_events:
        ext_company = pev.get("company", "")
        pdufa_date = pev.get("pdufa_date")
        if not pdufa_date:
            continue
        fda_outcome = _fda_outcome_from_raw(pev)
        event_type = "approval" if fda_outcome == "approved" else "pdufa"

        # Already matched by the targeted FDA search
        pre_ticker = pev.get("ticker")
        if pre_ticker:
            matched.append({
                "ticker": pre_ticker,
                "company": ticker_company_map.get(pre_ticker, ext_company),
                "event_type": event_type,
                "asset_name": pev.get("drug"),
                "trial_phase": None,
                "indication": None,
                "timing_quote": pev.get("title", ""),
                "window_start": pdufa_date,
                "window_end": pdufa_date,
                "source_type": "pdufa_calendar",
                "source_date": pdufa_date,
                "confidence": 0.85,
                "estimation_method": "external_calendar",
                "fda_outcome": fda_outcome,
            })
            continue

        if not ext_company:
            continue

        for ticker, our_company in ticker_company_map.items():
            if _verify_sponsor(our_company, ext_company):
                matched.append({
                    "ticker": ticker,
                    "company": our_company,
                    "event_type": event_type,
                    "asset_name": pev.get("drug"),
                    "trial_phase": None,
                    "indication": None,
                    "timing_quote": pev.get("title", ""),
                    "window_start": pdufa_date,
                    "window_end": pdufa_date,
                    "source_type": "pdufa_calendar",
                    "source_date": pdufa_date,
                    "confidence": 0.85,
                    "estimation_method": "external_calendar",
                    "fda_outcome": fda_outcome,
                })
                break
    return matched


# ── LLM Prompt ─────────────────────────────────────────────────────────────────

_GUIDANCE_PROMPT = """\
You are a biotech investment analyst. Extract ALL forward-looking catalyst \
timing guidance from the texts below for {company} ({ticker}).

Look for phrases like:
- "topline data expected in 2H 2026"
- "NDA submission planned mid-2027"
- "PDUFA date set for October 2026"
- "Phase 3 initiation by year-end"
- "data readout anticipated Q1 2027"
- "we expect to report results in the second half of 2026"
- "partnership milestone expected by…"

For EACH guidance item found, return a JSON object with:
  event_type     – "readout" | "submission" | "approval" | "pdufa" | "partnership" | "preclinical" | "initiation" | "other"
  asset_name     – drug/product name mentioned, or null
  trial_phase    – "1" | "1/2" | "2" | "2/3" | "3" | null
  indication     – disease/condition, or null
  timing_quote   – exact phrase from text (max 120 chars)
  window_start   – ISO date YYYY-MM-DD (infer: "2H 2026" → "2026-07-01", "mid-2027" → "2027-04-01", "Q3" → first day of quarter)
  window_end     – ISO date YYYY-MM-DD (infer: "2H 2026" → "2026-12-31", "by year-end" → "2026-12-31", "Q3 2026" → "2026-09-30")
  source_type    – "press_release" | "sec_8k" | "sec_10q" | "sec_10k" | "earnings"
  source_date    – ISO date of the source document
  confidence     – 0.0–1.0

Return a JSON array. If no forward-looking guidance found, return [].
Return ONLY valid JSON — no markdown, no explanation.

--- TEXTS ---
{texts}
"""


def _build_texts_block(items: list[dict[str, str]], max_chars: int = 6000) -> str:
    """Concatenate source text excerpts into a single block for the prompt."""
    parts: list[str] = []
    total = 0
    for it in items:
        header = f"[{it.get('source_type', 'unknown')} · {it.get('date', '?')}]"
        body = str(it.get("text", "")).strip()
        if not body:
            continue
        chunk = f"{header}\n{body}\n"
        if total + len(chunk) > max_chars:
            remaining = max_chars - total
            if remaining > 200:
                parts.append(chunk[:remaining] + "…")
            break
        parts.append(chunk)
        total += len(chunk)
    return "\n".join(parts)


_AI_CIRCUIT_BREAKER: dict[str, Any] = {"tripped": False, "reason": ""}
_CREDIT_KEYWORDS = ("credit", "balance", "quota", "billing", "too low", "exceeded")


def _trip_circuit_breaker(reason: str) -> None:
    _AI_CIRCUIT_BREAKER["tripped"] = True
    _AI_CIRCUIT_BREAKER["reason"] = reason[:200]
    print(
        f"[GuidanceCal] AI circuit breaker tripped — skipping LLM for remaining tickers: {reason[:120]}",
        flush=True,
    )


def _call_guidance_ai(
    ticker: str,
    company: str,
    texts_block: str,
) -> list[dict[str, Any]]:
    """Call AI provider with the guidance extraction prompt.

    Has a circuit breaker: after the first unrecoverable error (credit
    exhaustion, auth failure) it stops calling for the rest of the run.
    """
    if _AI_CIRCUIT_BREAKER["tripped"]:
        return []
    if not ai_provider.is_available():
        return []
    prompt = _GUIDANCE_PROMPT.format(
        company=company,
        ticker=ticker,
        texts=texts_block,
    )
    try:
        raw = ai_provider.call_ai(prompt, max_tokens=1024, task="guidance_extract")
    except Exception as exc:
        _trip_circuit_breaker(str(exc))
        return []

    if not raw:
        last_errs = getattr(ai_provider, "_LAST_ERRORS", {})
        for _prov, err in last_errs.items():
            err_low = str(err).lower()
            if any(kw in err_low for kw in _CREDIT_KEYWORDS):
                _trip_circuit_breaker(str(err))
                return []
        return []

    try:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
        return []
    except Exception as exc:
        print(f"[GuidanceCal] AI parse error ({ticker}): {exc}", flush=True)
        return []


# ── Source collectors ──────────────────────────────────────────────────────────

def _collect_press_releases(ticker: str) -> list[dict[str, str]]:
    """Load cached press releases for this ticker."""
    items: list[dict[str, str]] = []
    if not _PRESS_CACHE_DIR.is_dir():
        return items
    prefix = ticker.upper() + "_"
    for path in _PRESS_CACHE_DIR.iterdir():
        if not path.name.startswith(prefix) or not path.suffix == ".json":
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
            for it in doc.get("items", [])[:MAX_PRESS_PER_TICKER]:
                title = str(it.get("title", "")).strip()
                summary = str(it.get("summary", "")).strip()
                text = f"{title}. {summary}" if summary and summary != title else title
                if len(text) < 20:
                    continue
                items.append({
                    "source_type": "press_release",
                    "date": str(it.get("event_date", ""))[:10],
                    "text": text,
                    "link": str(it.get("link", "")),
                })
        except Exception:
            continue
    return items


def _collect_catalyst_feed_events(ticker: str) -> list[dict[str, str]]:
    """Load 8-K extracted events from the catalyst feed snapshot."""
    items: list[dict[str, str]] = []
    snap_path = _DATA_DIR / "catalyst_feed_snapshot.json"
    if not snap_path.is_file():
        return items
    try:
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
        for ev in snap.get("events", []):
            if str(ev.get("ticker", "")).strip().upper() != ticker.upper():
                continue
            ext = ev.get("extracted") or {}
            headline = str(ext.get("headline", "")).strip()
            items_label = str(ev.get("items_label", "")).strip()
            text = headline or items_label
            if not text or len(text) < 15:
                continue
            items.append({
                "source_type": "sec_8k",
                "date": str(ev.get("filing_date", ""))[:10],
                "text": text,
                "link": str(ev.get("filing_doc_url") or ev.get("edgar_browse_url") or ""),
            })
    except Exception:
        pass
    return items


def _collect_clinical_events(ticker: str) -> list[dict[str, str]]:
    """Load clinical pre-CD events that may contain guidance phrases."""
    items: list[dict[str, str]] = []
    snap_path = _DATA_DIR / "clinical_pre_cd_enrichment_snapshot.json"
    if not snap_path.is_file():
        return items
    try:
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
        records = snap.get("records") or snap.get("data") or {}
        if isinstance(records, list):
            records_list = records
        elif isinstance(records, dict):
            records_list = list(records.values())
        else:
            return items
        for rec in records_list:
            rec_ticker = str(rec.get("ticker", "")).strip().upper()
            if rec_ticker != ticker.upper():
                continue
            for ev in rec.get("clinical_events", []):
                title = str(ev.get("event_title", "")).strip()
                summary = str(ev.get("summary", "")).strip()
                text = f"{title}. {summary}" if summary and summary != title else title
                if len(text) < 20:
                    continue
                items.append({
                    "source_type": str(ev.get("source_type", "clinical")),
                    "date": str(ev.get("event_date", ""))[:10],
                    "text": text[:500],
                    "link": str(ev.get("link", "")),
                })
    except Exception:
        pass
    return items


# ── Work list from Simulation ─────────────────────────────────────────────────

def _build_ticker_list() -> list[dict[str, str]]:
    """Build the list of tickers to scan.

    Priority order:
    1. Simulation sheet (approaching CD) — highest priority
    2. Hype volume funnel entries
    3. Clinical pre-CD enrichment tickers (broader universe with data)
    4. Press release cache tickers (have text to scan)
    5. Full yf.json biotech universe (broadest, lowest priority)
    """
    tickers: list[dict[str, str]] = []
    seen: set[str] = set()
    tk_company = _ticker_company_map()

    def _add(tk: str, company: str = "", cd: str = "") -> None:
        if not tk or tk in seen or len(tk) > 6 or tk == "TOTALE PORTAFOGLIO":
            return
        seen.add(tk)
        co = company or tk_company.get(tk, tk)
        tickers.append({"ticker": tk, "company": co, "cd_date": cd})

    # ── 1. Simulation sheet (priority: approaching CD) ────────────────
    sim_path = _DATA_DIR / "simulation_sheet_snapshot.json"
    if sim_path.is_file():
        try:
            snap = json.loads(sim_path.read_text(encoding="utf-8"))
            for row in snap.get("rows", []):
                tk = str(row.get("Ticker", "")).strip().upper()
                company = str(
                    row.get("Società", "") or row.get("Società (full name)", "")
                    or row.get("Company", "") or ""
                ).strip()
                cd = str(row.get("Completion Date", ""))[:10]
                _add(tk, company, cd)
        except Exception:
            pass

    # ── 1b. Universe Discovery queue (manual Aggiungi → Calendar) ─────
    try:
        from universe_discovery import list_calendar_work

        for item in list_calendar_work():
            _add(str(item.get("ticker") or ""), str(item.get("company") or ""))
    except Exception:
        pass

    # ── 2. Hype volume funnel ─────────────────────────────────────────
    hype_path = _DATA_DIR / "hype_volume_funnel_entries.json"
    if hype_path.is_file():
        try:
            entries = json.loads(hype_path.read_text(encoding="utf-8"))
            if isinstance(entries, list):
                for entry in entries:
                    tk = str(entry.get("Ticker", "") or entry.get("ticker", "")).strip().upper()
                    company = str(entry.get("Società", "") or entry.get("company", "") or "").strip()
                    _add(tk, company)
        except Exception:
            pass

    # ── 3. Clinical pre-CD enrichment tickers (have clinical data) ────
    pre_cd_path = _DATA_DIR / "clinical_pre_cd_enrichment_snapshot.json"
    if pre_cd_path.is_file():
        try:
            snap = json.loads(pre_cd_path.read_text(encoding="utf-8"))
            records = snap.get("records") or snap.get("data") or {}
            recs = records if isinstance(records, list) else list(records.values()) if isinstance(records, dict) else []
            for rec in recs:
                tk = str(rec.get("ticker", "")).strip().upper()
                _add(tk)
        except Exception:
            pass

    # ── 4. Press release cache tickers (have text to scan) ────────────
    if _PRESS_CACHE_DIR.is_dir():
        try:
            for path in _PRESS_CACHE_DIR.iterdir():
                if path.suffix == ".json":
                    tk = path.stem.split("_")[0].upper()
                    _add(tk)
        except Exception:
            pass

    # ── 5. yf.json biotech universe (broadest scan) ───────────────────
    yf_path = _DATA_DIR / "yf.json"
    if yf_path.is_file() and len(tickers) < MAX_TICKERS:
        try:
            yf = json.loads(yf_path.read_text(encoding="utf-8"))
            yf_items = yf if isinstance(yf, list) else list(yf.values()) if isinstance(yf, dict) else []
            for info in yf_items:
                if not isinstance(info, dict):
                    continue
                tk = str(info.get("symbol") or info.get("ticker") or "").strip().upper()
                industry = str(info.get("industry", "")).lower()
                if "biotech" not in industry and "pharma" not in industry:
                    continue
                _add(tk)
                if len(tickers) >= MAX_TICKERS:
                    break
        except Exception:
            pass

    return tickers[:MAX_TICKERS]


# ── Cache ──────────────────────────────────────────────────────────────────────

def _load_cache() -> dict[str, Any]:
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(cache: dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def _cache_key(ticker: str) -> str:
    return f"{ticker.upper()}|{date.today().isoformat()}"


# ── Snapshot I/O ───────────────────────────────────────────────────────────────

def load_snapshot() -> dict[str, Any]:
    try:
        data = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"events": [], "count": 0, "updated_at": None, "tickers_scanned": 0}
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list):
        return {"events": [], "count": 0, "updated_at": None, "tickers_scanned": 0}
    today = date.today()
    future = [e for e in events if isinstance(e, dict) and _event_is_future(e, today)]
    # Overlay CT.gov / Simulation CD days so Calendar always includes them
    # even when the last guidance refresh only found PDUFA/readout phrases.
    try:
        cd_events = _collect_ctgov_cd_events(include_discovery_live=False)
        future = _merge_event_lists(future, cd_events)
    except Exception as exc:
        print(f"[GuidanceCal] CD overlay skipped: {exc}", flush=True)

    def _keys(rows: list[dict[str, Any]]) -> set[tuple[str, str, str]]:
        return {
            (
                str(e.get("ticker") or "").upper(),
                str(e.get("event_type") or ""),
                str(e.get("window_start") or "")[:10],
            )
            for e in rows
            if isinstance(e, dict)
        }

    if _keys(future) != _keys([e for e in events if isinstance(e, dict)]):
        data = {
            **data,
            "count": len(future),
            "events": future,
            "purged_past_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            _SNAPSHOT_PATH.write_text(
                json.dumps(data, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
        except OSError:
            pass
        return data
    data = {**data, "count": len(future), "events": future}
    return data


def _event_is_future(ev: dict[str, Any], today: date | None = None) -> bool:
    """Keep only future / still-open events (drop fully past)."""
    ref = today or date.today()
    start_s = str(ev.get("window_start") or "")[:10]
    end_s = str(ev.get("window_end") or "")[:10]
    check = end_s if len(end_s) >= 10 else start_s
    if len(check) < 10:
        return False
    try:
        return datetime.strptime(check, "%Y-%m-%d").date() >= ref
    except ValueError:
        return False


def _parse_cd_iso(raw: Any) -> str | None:
    """Normalize Completion Date / CD to YYYY-MM-DD."""
    s = str(raw or "").strip()
    if not s:
        return None
    if re.match(r"^20\d{2}-\d{2}-\d{2}", s):
        return s[:10]
    # CT.gov often returns month-only primary completion (YYYY-MM)
    m = re.match(r"^(20\d{2})-(\d{2})$", s)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12:
            # Use month-end as conservative CD day
            if mo == 12:
                return f"{y}-12-31"
            nxt = date(y, mo + 1, 1)
            end = nxt - timedelta(days=1)
            return end.isoformat()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(20\d{2})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def _make_cd_event(
    *,
    ticker: str,
    company: str,
    cd_iso: str,
    nct_id: str = "",
    phase: str = "",
    asset: str = "",
    indication: str = "",
    confidence: float = 0.92,
    source_type: str = "clinicaltrials.gov",
    estimation_method: str = "ctgov_primary_completion",
) -> dict[str, Any]:
    link = f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else None
    quote = (
        f"Primary completion {cd_iso}"
        + (f" ({nct_id})" if nct_id else "")
    )
    return {
        "ticker": ticker.strip().upper(),
        "company": company or ticker,
        "event_type": "cd",
        "asset_name": asset or None,
        "trial_phase": phase or None,
        "indication": indication or None,
        "timing_quote": quote,
        "window_start": cd_iso,
        "window_end": cd_iso,
        "source_type": source_type,
        "source_date": cd_iso,
        "confidence": confidence,
        "estimation_method": estimation_method,
        "sim_cd_date": cd_iso,
        "link": link,
        "nct_id": nct_id or None,
    }


def _cd_within_horizon(cd_iso: str, today: date, horizon_days: int = CALENDAR_CD_HORIZON_DAYS) -> bool:
    try:
        d = datetime.strptime(cd_iso[:10], "%Y-%m-%d").date()
    except ValueError:
        return False
    delta = (d - today).days
    return 0 <= delta <= horizon_days


def _merge_event_lists(
    base: list[dict[str, Any]],
    extra: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Union by ticker|event_type|window_start; prefer higher confidence."""
    seen: dict[str, dict[str, Any]] = {}
    for ev in list(base) + list(extra):
        if not isinstance(ev, dict):
            continue
        key = (
            f"{str(ev.get('ticker') or '').upper()}|"
            f"{ev.get('event_type') or ''}|"
            f"{str(ev.get('window_start') or '')[:10]}"
        )
        prev = seen.get(key)
        if not prev or (ev.get("confidence") or 0) > (prev.get("confidence") or 0):
            seen[key] = ev
    out = list(seen.values())
    out.sort(key=lambda e: e.get("window_start") or e.get("window_end") or "9999")
    return out


def _collect_ctgov_cd_events(*, include_discovery_live: bool = False) -> list[dict[str, Any]]:
    """
    Build Calendar rows for ClinicalTrials.gov / Simulation Completion Dates.

    Sources (local snapshots — no Soft BUY/SELL impact):
      1. Simulation sheet Completion Date
      2. clinical_simulation_snapshot.simulation_cd_by_ticker
      3. clinical_pre_cd_enrichment_snapshot future cd_date
      4. Discovery queue → optional live CT.gov sponsor lookup (refresh only)
    """
    today = date.today()
    out: list[dict[str, Any]] = []
    seen_tk_cd: set[str] = set()

    def _push(ev: dict[str, Any]) -> None:
        tk = str(ev.get("ticker") or "").upper()
        cd = str(ev.get("window_start") or "")[:10]
        if not tk or not _cd_within_horizon(cd, today):
            return
        key = f"{tk}|{cd}"
        if key in seen_tk_cd:
            return
        seen_tk_cd.add(key)
        out.append(ev)

    # 1. Simulation sheet
    sim_path = _DATA_DIR / "simulation_sheet_snapshot.json"
    if sim_path.is_file():
        try:
            snap = json.loads(sim_path.read_text(encoding="utf-8"))
            for row in snap.get("rows") or []:
                if not isinstance(row, dict):
                    continue
                tk = str(row.get("Ticker") or row.get("ticker") or "").strip().upper()
                cd = _parse_cd_iso(row.get("Completion Date") or row.get("CD"))
                if not tk or not cd:
                    continue
                company = str(
                    row.get("Società")
                    or row.get("Società (full name)")
                    or row.get("Company")
                    or tk
                ).strip()
                nct = str(row.get("NCT") or row.get("nct_id") or "").strip().upper()
                _push(
                    _make_cd_event(
                        ticker=tk,
                        company=company,
                        cd_iso=cd,
                        nct_id=nct if nct.startswith("NCT") else "",
                        phase=str(row.get("Studio Phase") or row.get("Phase") or ""),
                        asset=str(row.get("Drug") or ""),
                        indication=str(row.get("Indication") or ""),
                        estimation_method="simulation_completion_date",
                    )
                )
        except Exception as exc:
            print(f"[GuidanceCal] sim CD collect failed: {exc}", flush=True)

    # 2. Clinical simulation CD map (Eval Lab CT.gov picks)
    clin_path = _DATA_DIR / "clinical_simulation_snapshot.json"
    if clin_path.is_file():
        try:
            snap = json.loads(clin_path.read_text(encoding="utf-8"))
            by_tk = snap.get("simulation_cd_by_ticker") or {}
            if isinstance(by_tk, dict):
                for tk, info in by_tk.items():
                    if not isinstance(info, dict):
                        continue
                    cd = _parse_cd_iso(info.get("completion_date") or info.get("cd_date"))
                    if not cd:
                        continue
                    nct = str(info.get("nct") or info.get("nct_id") or "").strip().upper()
                    _push(
                        _make_cd_event(
                            ticker=str(tk).upper(),
                            company=str(info.get("company") or tk),
                            cd_iso=cd,
                            nct_id=nct if nct.startswith("NCT") else "",
                            estimation_method="clinical_simulation_cd",
                        )
                    )
        except Exception as exc:
            print(f"[GuidanceCal] clinical-sim CD collect failed: {exc}", flush=True)

    # 3. Clinical pre-CD enrichment (broader CT.gov set)
    pre_path = _DATA_DIR / "clinical_pre_cd_enrichment_snapshot.json"
    if pre_path.is_file():
        try:
            snap = json.loads(pre_path.read_text(encoding="utf-8"))
            records = snap.get("records") or []
            if isinstance(records, dict):
                records = list(records.values())
            for rec in records:
                if not isinstance(rec, dict):
                    continue
                tk = str(rec.get("ticker") or "").strip().upper()
                cd = _parse_cd_iso(rec.get("cd_date") or rec.get("completion_date"))
                if not tk or not cd:
                    continue
                meta = rec.get("meta") if isinstance(rec.get("meta"), dict) else {}
                nct = str(rec.get("nct_id") or "").strip().upper()
                _push(
                    _make_cd_event(
                        ticker=tk,
                        company=str(rec.get("company") or tk),
                        cd_iso=cd,
                        nct_id=nct if nct.startswith("NCT") else "",
                        phase=str(
                            rec.get("study_phase")
                            or meta.get("phase")
                            or ""
                        ),
                        asset=str(meta.get("interventions") or "")[:80],
                        indication=str(meta.get("conditions") or "")[:80],
                        estimation_method="clinical_pre_cd",
                    )
                )
        except Exception as exc:
            print(f"[GuidanceCal] pre-CD collect failed: {exc}", flush=True)

    # 4. Discovery public companies — fill CD gaps via CT.gov (refresh / live)
    if include_discovery_live:
        try:
            for ev in _resolve_discovery_ctgov_cds(existing_keys=seen_tk_cd):
                _push(ev)
        except Exception as exc:
            print(f"[GuidanceCal] discovery CT.gov CD resolve failed: {exc}", flush=True)
    else:
        # Use cached Discovery CT.gov hits without network
        try:
            cache = json.loads(_DISCOVERY_CD_CACHE_PATH.read_text(encoding="utf-8"))
            for row in cache.get("entries") or []:
                if not isinstance(row, dict):
                    continue
                tk = str(row.get("ticker") or "").upper()
                cd = _parse_cd_iso(row.get("cd_date"))
                if not tk or not cd:
                    continue
                _push(
                    _make_cd_event(
                        ticker=tk,
                        company=str(row.get("company") or tk),
                        cd_iso=cd,
                        nct_id=str(row.get("nct_id") or ""),
                        phase=str(row.get("phase") or ""),
                        estimation_method="discovery_ctgov_cache",
                    )
                )
        except Exception:
            pass

    return out


def _resolve_discovery_ctgov_cds(
    *,
    existing_keys: set[str] | None = None,
) -> list[dict[str, Any]]:
    """
    For Discovery-queue public tickers missing a Calendar CD, query CT.gov by
    company/sponsor and take the nearest future primary completion ≤ 12 months.
    """
    today = date.today()
    have = set(existing_keys or ())
    work: list[dict[str, str]] = []
    try:
        from universe_discovery import list_calendar_work

        work = list_calendar_work()
    except Exception:
        return []

    cache: dict[str, Any] = {"updated_at": None, "entries": []}
    try:
        cache = json.loads(_DISCOVERY_CD_CACHE_PATH.read_text(encoding="utf-8"))
        if not isinstance(cache.get("entries"), list):
            cache["entries"] = []
    except Exception:
        cache = {"updated_at": None, "entries": []}
    by_tk = {
        str(e.get("ticker") or "").upper(): e
        for e in cache["entries"]
        if isinstance(e, dict)
    }

    out: list[dict[str, Any]] = []
    for item in work:
        tk = str(item.get("ticker") or "").strip().upper()
        company = str(item.get("company") or tk).strip()
        if not tk:
            continue
        # Skip if we already have any CD for this ticker in the collected set
        if any(k.startswith(f"{tk}|") for k in have):
            continue
        cached = by_tk.get(tk)
        cd_cached = _parse_cd_iso((cached or {}).get("cd_date"))
        if cached and cd_cached and _cd_within_horizon(cd_cached, today):
            ev = _make_cd_event(
                ticker=tk,
                company=str(cached.get("company") or company),
                cd_iso=cd_cached,
                nct_id=str(cached.get("nct_id") or ""),
                phase=str(cached.get("phase") or ""),
                estimation_method="discovery_ctgov_cache",
            )
            out.append(ev)
            have.add(f"{tk}|{cd_cached}")
            continue

        hit = _ctgov_nearest_cd_for_company(company)
        if not hit:
            continue
        cd = hit["cd_date"]
        if not _cd_within_horizon(cd, today):
            continue
        entry = {
            "ticker": tk,
            "company": company,
            "cd_date": cd,
            "nct_id": hit.get("nct_id") or "",
            "phase": hit.get("phase") or "",
            "title": hit.get("title") or "",
            "queried_at": datetime.now(timezone.utc).isoformat(),
        }
        by_tk[tk] = entry
        out.append(
            _make_cd_event(
                ticker=tk,
                company=company,
                cd_iso=cd,
                nct_id=str(hit.get("nct_id") or ""),
                phase=str(hit.get("phase") or ""),
                asset=str(hit.get("title") or "")[:80],
                estimation_method="discovery_ctgov_live",
            )
        )
        have.add(f"{tk}|{cd}")
        print(f"[GuidanceCal] Discovery CT.gov CD {tk}: {cd} {hit.get('nct_id')}", flush=True)

    cache = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "entries": list(by_tk.values()),
    }
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _DISCOVERY_CD_CACHE_PATH.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass
    return out


def _ctgov_company_query_terms(company: str) -> list[str]:
    """Build CT.gov sponsor/term variants from a legal company name."""
    raw = (company or "").strip()
    if len(raw) < 3:
        return []
    terms: list[str] = []
    cleaned = raw
    for junk in (
        ", Inc.",
        " Inc.",
        " Inc",
        ", Corp.",
        " Corp.",
        " Corp",
        " Corporation",
        " Ltd.",
        " Limited",
        " PLC",
        " plc",
        " N.V.",
        " AG",
        " S.A.",
        " Co.",
        " Company",
    ):
        if cleaned.lower().endswith(junk.lower()):
            cleaned = cleaned[: -len(junk)].strip(" ,")
    for candidate in (raw, cleaned):
        c = candidate.strip()
        if len(c) >= 3 and c not in terms:
            terms.append(c)
    # First significant token (e.g. Liquidia, Aptevo, Intellia)
    token = re.split(r"[\s,]+", cleaned)[0] if cleaned else ""
    if len(token) >= 4 and token not in terms and token.lower() not in {
        "the",
        "bio",
        "therapeutics",
        "pharma",
        "pharmaceuticals",
    }:
        terms.append(token)
    return terms[:5]


def _ctgov_nearest_cd_for_company(company: str) -> dict[str, str] | None:
    """Query CT.gov API v2 for nearest future primary completion for a sponsor."""
    today = date.today()
    best: tuple[int, dict[str, str]] | None = None
    for term in _ctgov_company_query_terms(company):
        for query_key in ("query.spons", "query.lead", "query.term"):
            try:
                params = urllib.parse.urlencode({query_key: term, "pageSize": "40"})
                url = f"{_CTGOV_STUDIES_URL}?{params}"
                req = urllib.request.Request(url, headers={"User-Agent": "SuperNova/1.0"})
                with urllib.request.urlopen(req, timeout=40) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except Exception:
                continue
            for study in data.get("studies") or []:
                if not isinstance(study, dict):
                    continue
                p = study.get("protocolSection") or {}
                ident = p.get("identificationModule") or {}
                status = p.get("statusModule") or {}
                sponsor = p.get("sponsorCollaboratorsModule") or {}
                lead = str((sponsor.get("leadSponsor") or {}).get("name") or "")
                # Soft sponsor filter: require company token in lead/collaborator when possible
                token = term.split()[0].lower() if term else ""
                blob = lead.lower()
                for c in sponsor.get("collaborators") or []:
                    if isinstance(c, dict):
                        blob += " " + str(c.get("name") or "").lower()
                if token and len(token) >= 4 and query_key in ("query.spons", "query.lead"):
                    if token not in blob:
                        continue
                nct = str(ident.get("nctId") or "").strip().upper()
                title = str(ident.get("briefTitle") or "")
                pc = (status.get("primaryCompletionDateStruct") or {}).get("date") or ""
                cd = (status.get("completionDateStruct") or {}).get("date") or ""
                cd_iso = _parse_cd_iso(pc) or _parse_cd_iso(cd)
                if not cd_iso:
                    continue
                try:
                    d = datetime.strptime(cd_iso, "%Y-%m-%d").date()
                except ValueError:
                    continue
                delta = (d - today).days
                if delta < 0 or delta > CALENDAR_CD_HORIZON_DAYS:
                    continue
                phases = (p.get("designModule") or {}).get("phases") or []
                phase = ", ".join(phases) if isinstance(phases, list) else str(phases or "")
                cand = {
                    "cd_date": cd_iso,
                    "nct_id": nct,
                    "phase": phase,
                    "title": title,
                }
                if best is None or delta < best[0]:
                    best = (delta, cand)
    return best[1] if best else None


def _write_snapshot(events: list[dict[str, Any]], tickers_scanned: int) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today()
    future = [e for e in events if _event_is_future(e, today)]
    snap = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(future),
        "tickers_scanned": tickers_scanned,
        "events": future,
    }
    _SNAPSHOT_PATH.write_text(
        json.dumps(snap, ensure_ascii=False, default=str),
        encoding="utf-8",
    )


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_guidance_calendar_refresh(*, force: bool = False) -> dict[str, Any]:
    """Background-safe entry point."""
    try:
        return _run(force=force)
    except Exception as exc:
        _set_status(running=False, error=str(exc), message=f"Error: {exc}")
        return {"error": str(exc)}


def _run(*, force: bool = False) -> dict[str, Any]:
    _AI_CIRCUIT_BREAKER["tripped"] = False
    _AI_CIRCUIT_BREAKER["reason"] = ""
    _set_status(
        running=True,
        message="Building ticker list from Simulation…",
        processed=0,
        total=0,
        error=None,
        finished_at=None,
    )

    ticker_list = _build_ticker_list()
    if not ticker_list:
        _set_status(running=False, error="No tickers in Simulation snapshot")
        return {"error": "No tickers found", "count": 0}

    _set_status(total=len(ticker_list), message=f"Scanning {len(ticker_list)} tickers…")
    print(
        f"[GuidanceCal] Starting guidance extraction for {len(ticker_list)} tickers",
        flush=True,
    )

    # ── Phase 0: Build ticker→company map for sponsor matching ───────────
    tk_company = _ticker_company_map()
    for tk_info in ticker_list:
        tk = tk_info["ticker"]
        if tk not in tk_company and tk_info.get("company"):
            tk_company[tk] = tk_info["company"]

    # ── Phase 1: External PDUFA calendar (sponsor-matched) ───────────────
    _set_status(message="Fetching external PDUFA calendar…")
    pdufa_external: list[dict[str, Any]] = []
    try:
        pdufa_raw = _fetch_pdufa_calendar(ticker_company=tk_company)
        pdufa_external = _match_pdufa_to_tickers(pdufa_raw, tk_company)
        if pdufa_external:
            print(
                f"[GuidanceCal] {len(pdufa_external)} PDUFA dates matched from external calendar",
                flush=True,
            )
    except Exception as exc:
        print(f"[GuidanceCal] PDUFA calendar phase failed: {exc}", flush=True)

    # ── Phase 2: Per-ticker LLM extraction + PDUFA estimation ────────────
    cache = _load_cache()
    all_events: list[dict[str, Any]] = list(pdufa_external)
    tickers_with_guidance = 0
    ai_calls = 0
    pdufa_estimated = 0

    for idx, tk_info in enumerate(ticker_list):
        ticker = tk_info["ticker"]
        company = tk_info["company"]
        cd_date = tk_info.get("cd_date", "")
        _set_status(
            message=f"Scanning {ticker} ({idx + 1}/{len(ticker_list)})",
            processed=idx,
        )

        ck = _cache_key(ticker)
        if not force and ck in cache:
            cached_items = cache[ck]
            if isinstance(cached_items, list):
                for ev in cached_items:
                    ev["ticker"] = ticker
                    ev["company"] = company
                all_events.extend(cached_items)
                if cached_items:
                    tickers_with_guidance += 1
                continue

        sources: list[dict[str, str]] = []
        sources.extend(_collect_press_releases(ticker))
        sources.extend(_collect_catalyst_feed_events(ticker))
        sources.extend(_collect_clinical_events(ticker))

        # ── PDUFA estimation from submission text (no LLM needed) ────
        pdufa_from_text: list[dict[str, Any]] = []
        for src in sources:
            est = _estimate_pdufa_from_submission(src.get("text", ""), src.get("date"))
            if est:
                est["ticker"] = ticker
                est["company"] = company
                est["sim_cd_date"] = cd_date
                est["source_type"] = src.get("source_type", "unknown")
                est["source_date"] = src.get("date", "")
                pdufa_from_text.append(est)
                pdufa_estimated += 1

        # ── Regex-based guidance extraction (no LLM needed) ──────
        regex_events: list[dict[str, Any]] = []
        for item in _extract_guidance_regex(sources):
            item["ticker"] = ticker
            item["company"] = company
            item["sim_cd_date"] = cd_date
            regex_events.append(item)

        no_llm_events = pdufa_from_text + regex_events

        if not sources:
            cache[ck] = no_llm_events
            if no_llm_events:
                all_events.extend(no_llm_events)
                tickers_with_guidance += 1
            continue

        # ── LLM extraction (if provider available) ───────────────
        valid: list[dict[str, Any]] = list(no_llm_events)

        if ai_provider.is_available() and not _AI_CIRCUIT_BREAKER["tripped"]:
            texts_block = _build_texts_block(sources, max_chars=5000)
            if len(texts_block.strip()) >= 50:
                extracted = _call_guidance_ai(ticker, company, texts_block)
                if not _AI_CIRCUIT_BREAKER["tripped"]:
                    ai_calls += 1

                for item in extracted:
                    if not isinstance(item, dict):
                        continue
                    if not item.get("timing_quote") and not item.get("window_start"):
                        continue
                    item["ticker"] = ticker
                    item["company"] = company
                    item["sim_cd_date"] = cd_date
                    item["estimation_method"] = "llm_extract"
                    valid.append(item)

        cache[ck] = valid
        all_events.extend(valid)
        if valid:
            tickers_with_guidance += 1
            print(
                f"[GuidanceCal]   {ticker}: {len(valid)} guidance items "
                f"({len(pdufa_from_text)} PDUFA estimated)",
                flush=True,
            )

        if (idx + 1) % 25 == 0:
            _save_cache(cache)
            print(
                f"[GuidanceCal] Progress: {idx + 1}/{len(ticker_list)} tickers, "
                f"{len(all_events)} events so far",
                flush=True,
            )

    _save_cache(cache)

    # ── Deduplicate: prefer higher confidence for same ticker + window ───
    all_events = _deduplicate_events(all_events)
    # Always include CT.gov / Simulation CD days + Discovery public CD lookup.
    try:
        cd_events = _collect_ctgov_cd_events(include_discovery_live=True)
        all_events = _merge_event_lists(all_events, cd_events)
        print(f"[GuidanceCal] CD days merged: {len(cd_events)}", flush=True)
    except Exception as exc:
        print(f"[GuidanceCal] CD merge failed: {exc}", flush=True)
    # Never persist or promote fully past events into Calendar / Simulation.
    today = date.today()
    all_events = [e for e in all_events if _event_is_future(e, today)]

    all_events.sort(
        key=lambda e: e.get("window_start") or e.get("window_end") or "9999",
    )

    _write_snapshot(all_events, tickers_scanned=len(ticker_list))
    try:
        mark_weekly_run()
    except Exception as exc:
        print(f"[GuidanceCal] weekly marker write failed: {exc}", flush=True)

    # ── Phase 3: Sync catalyst entries into Simulation sidecar ────────────
    try:
        cat_result = write_catalyst_sim_entries(all_events)
    except Exception as exc:
        print(f"[GuidanceCal] catalyst sim-entry write failed: {exc}", flush=True)
        cat_result = {"error": str(exc)}

    _set_status(
        running=False,
        message=(
            f"Done — {len(all_events)} guidance items from "
            f"{tickers_with_guidance}/{len(ticker_list)} tickers "
            f"({len(pdufa_external)} PDUFA ext, {pdufa_estimated} PDUFA est)"
        ),
        processed=len(ticker_list),
        finished_at=datetime.now(timezone.utc).isoformat(),
    )

    summary = {
        "count": len(all_events),
        "tickers_scanned": len(ticker_list),
        "tickers_with_guidance": tickers_with_guidance,
        "ai_calls": ai_calls,
        "pdufa_external_matched": len(pdufa_external),
        "pdufa_estimated": pdufa_estimated,
    }
    print(f"[GuidanceCal] Finished: {summary}", flush=True)
    return summary


def _deduplicate_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove near-duplicates: same ticker + event_type + overlapping window → keep highest confidence."""
    seen: dict[str, dict[str, Any]] = {}
    for ev in events:
        key = f"{ev.get('ticker', '')}|{ev.get('event_type', '')}|{ev.get('window_start', '')}"
        existing = seen.get(key)
        if not existing or (ev.get("confidence") or 0) > (existing.get("confidence") or 0):
            seen[key] = ev
    return list(seen.values())


# ── Catalyst → Simulation sidecar entries ─────────────────────────────────────
#
# Follows the same pattern as hype_volume_funnel_entries.json: create sim-row
# dicts that get merged into the Simulation snapshot at read time so that
# catalyst-only tickers receive the full scoring pipeline (recommendation,
# P(cont), cycle, Decision Chart, etc.).

_CATALYST_SIM_ENTRIES_PATH = _DATA_DIR / "catalyst_sim_entries.json"


def _best_future_event(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the nearest *future* event, or the most recent if all past."""
    today_iso = date.today().isoformat()
    future = [e for e in events if (e.get("window_start") or "9999") >= today_iso]
    if future:
        future.sort(key=lambda e: e.get("window_start") or "9999")
        return future[0]
    # all past — pick latest
    past = sorted(events, key=lambda e: e.get("window_start") or "", reverse=True)
    return past[0] if past else None


def _cd_display_from_iso(iso: str | None) -> str:
    """Convert ISO date to dd/mm/yyyy display string for sim row."""
    if not iso:
        return ""
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d")
        return f"{d.day:02d}/{d.month:02d}/{d.year}"
    except (ValueError, TypeError):
        return iso[:10] if iso else ""


def _fda_events_as_guidance() -> list[dict[str, Any]]:
    """FDA AdCom snapshot + seed rows as guidance-shaped events (Calendar → Simulation)."""
    try:
        from fda_adcom_calendar import rows_including_seed
    except ImportError:
        return []
    out: list[dict[str, Any]] = []
    for row in rows_including_seed():
        if not isinstance(row, dict):
            continue
        tk = str(row.get("ticker") or "").strip().upper()
        date = str(row.get("date") or "")[:10]
        if not tk or not date:
            continue
        kind = str(row.get("kind") or "vote")
        out.append(
            {
                "ticker": tk,
                "company": str(row.get("company") or tk).strip(),
                "event_type": "fda_safety" if kind == "safety_review" else "fda_vote",
                "asset_name": str(row.get("product") or ""),
                "window_start": date,
                "window_end": date,
                "timing_quote": str(row.get("eventEn") or row.get("eventIt") or ""),
                "source_type": "fda_adcom",
                "confidence": 0.95,
                "estimation_method": "fda_calendar",
                "link": str(row.get("href") or ""),
            }
        )
    return out


def _merge_calendar_events_for_sim(
    events: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if events is None:
        snap = _load_snapshot()
        events = snap.get("events", []) if snap else []
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for ev in list(events) + _fda_events_as_guidance():
        if not isinstance(ev, dict):
            continue
        tk = str(ev.get("ticker") or "").strip().upper()
        start = str(ev.get("window_start") or ev.get("window_end") or "")[:10]
        kind = str(ev.get("event_type") or "")
        key = (tk, start, kind)
        if not tk or key in seen:
            continue
        seen.add(key)
        merged.append(ev)
    return merged


def build_catalyst_sim_entries(
    events: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build simulation-sheet–compatible row dicts from guidance + FDA calendar.

    Each unique ticker gets one entry: the nearest future catalyst becomes
    the Completion Date.  The ``guidance_calendar_catalyst`` flag is set so
    the merge layer can identify and filter these rows.
    """
    events = _merge_calendar_events_for_sim(events)

    # Group by ticker
    by_ticker: dict[str, list[dict[str, Any]]] = {}
    for ev in events:
        tk = str(ev.get("ticker") or "").strip().upper()
        if not tk:
            continue
        by_ticker.setdefault(tk, []).append(ev)

    entries: list[dict[str, Any]] = []
    for ticker, tk_events in by_ticker.items():
        best = _best_future_event(tk_events)
        if not best:
            continue

        window_start_iso = best.get("window_start") or ""
        window_end_iso = best.get("window_end") or ""
        cd_iso = window_start_iso or window_end_iso
        company = str(best.get("company") or ticker).strip()
        event_type = str(best.get("event_type") or "other")
        asset_name = str(best.get("asset_name") or "")
        phase = str(best.get("trial_phase") or "")
        indication = str(best.get("indication") or "").strip()
        nct = str(best.get("nct_id") or best.get("nct") or "").strip()
        quote = str(best.get("timing_quote") or "")
        # Catalizzatore datato (PDUFA) spesso non ha il trial — prendi i campi studio dagli altri eventi.
        for ev in tk_events:
            if not asset_name:
                asset_name = str(ev.get("asset_name") or "")
            if not phase:
                phase = str(ev.get("trial_phase") or "")
            if not indication:
                indication = str(ev.get("indication") or "").strip()
            if not nct:
                nct = str(ev.get("nct_id") or ev.get("nct") or "").strip()
            if not quote:
                quote = str(ev.get("timing_quote") or "")
        asset_clean = (
            asset_name
            if asset_name.upper()
            not in {"PDUFA", "NDA", "BLA", "CRL", "READOUT", "SUBMISSION", "APPROVAL", ""}
            else ""
        )

        # Trial phase only — never the catalyst type (PDUFA / readout).
        phase_display = (
            f"Phase {phase}"
            if phase and not str(phase).lower().startswith("phase")
            else (phase or "")
        )
        study_phase = phase_display

        entry: dict[str, Any] = {
            "Ticker": ticker,
            "Società": company,
            "Completion Date": _cd_display_from_iso(cd_iso),
            "Exact·Partial vs Unmatch": "Catalyst",
            "Lead sponsor": company,
            "Società (full name)": company,
            "NCT": nct,
            "Sponsor (da NCT)": "",
            "Relazione sponsor": "",
            "Link studio": "",
            "Studio Phase": study_phase,
            "Drug": asset_clean,
            "Indication": indication,
            "guidance_calendar_catalyst": True,
            "guidance_event_type": event_type,
            "guidance_asset_name": asset_name,
            "guidance_confidence": best.get("confidence"),
            "guidance_trial_phase": phase,
            "guidance_indication": indication,
            "guidance_window_start": window_start_iso,
            "guidance_window_end": window_end_iso,
            "guidance_source_quote": quote,
        }
        entries.append(entry)

    return entries


def write_catalyst_sim_entries(events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Write ``data/catalyst_sim_entries.json`` and sync into the sim snapshot.

    Called automatically at the end of ``run_guidance_calendar_refresh``.
    """
    entries = build_catalyst_sim_entries(events)
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    doc = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }
    _CATALYST_SIM_ENTRIES_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # Sync into the simulation snapshot (like hype funnel does)
    synced = 0
    try:
        synced = _sync_catalyst_into_sim_snapshot(entries)
    except Exception as exc:
        print(f"[GuidanceCal] catalyst sim-snapshot sync failed: {exc}", flush=True)

    result = {"entries": len(entries), "synced": synced}
    print(f"[GuidanceCal] Catalyst sim entries written: {result}", flush=True)
    return result


def _sync_catalyst_into_sim_snapshot(entries: list[dict[str, Any]]) -> int:
    """Merge catalyst entries directly into simulation_sheet_snapshot.json.

    Replaces any existing ``guidance_calendar_catalyst`` rows, then adds new
    ones.  After insertion, patches rows with Yahoo Finance data (price,
    daily change, beta, etc.) from the enrich cache.
    Returns number of rows added/updated.
    """
    from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

    path = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return 0

    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0

    rows: list[dict] = doc.get("rows") or []

    # Remove old catalyst-only rows, then re-add every upcoming calendar CD.
    rows = [r for r in rows if not r.get("guidance_calendar_catalyst")]

    def _cd_key(tk: str, cd: object) -> str:
        try:
            from excel_sheet_reader import _normalize_cd_for_key
            return f"{tk}|{_normalize_cd_for_key(cd)}"
        except Exception:
            return f"{tk}|{str(cd or '').strip()}"

    existing_keys: set[str] = set()
    for r in rows:
        tk = str(r.get("Ticker") or "").strip().upper()
        if tk:
            existing_keys.add(_cd_key(tk, r.get("Completion Date")))

    added = 0
    for entry in entries:
        tk = str(entry.get("Ticker") or "").strip().upper()
        if not tk:
            continue
        key = _cd_key(tk, entry.get("Completion Date"))
        if key in existing_keys:
            for r in rows:
                rtk = str(r.get("Ticker") or "").strip().upper()
                if rtk == tk and _cd_key(rtk, r.get("Completion Date")) == key:
                    r["guidance_calendar_catalyst"] = True
                    break
            continue
        rows.append(dict(entry))
        existing_keys.add(key)
        added += 1

    doc["rows"] = rows
    doc["row_count"] = len(rows)

    tmp = path.with_suffix(".json.cat-tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)

    # Enrich catalyst rows with live Yahoo Finance data
    _enrich_catalyst_rows_yf(path)
    _patch_catalyst_financials_from_enrich_cache(path)

    return added


def _patch_catalyst_financials_from_enrich_cache(
    snapshot_path: Path,
    *,
    cache_dir: Path | None = None,
) -> int:
    """Fill missing Liquidità (FY) on catalyst rows from ``data/enrich_cache``.

    Yahoo quote enrich writes price/beta and then skips the row, so FY
    ratios never landed on guidance-calendar sidecars.
    """
    try:
        doc = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0
    if not isinstance(doc, dict):
        return 0
    rows = [r for r in (doc.get("rows") or []) if isinstance(r, dict)]
    cdir = Path(cache_dir) if cache_dir is not None else _DATA_DIR / "enrich_cache"
    try:
        from prediction.financial_liquidity import (
            format_liquidity_display,
            load_liquidity_from_enrich_cache,
        )
    except ImportError:
        return 0

    def _empty(val: Any) -> bool:
        return val in (None, "", "—", "-")

    changed = 0
    for r in rows:
        if not r.get("guidance_calendar_catalyst"):
            continue
        tk = str(r.get("Ticker") or "").strip().upper()
        if not tk:
            continue
        fy_empty = _empty(r.get("Liquidità (FY)")) and _empty(r.get("liquidita_fy"))
        score_empty = _empty(r.get("liquidity_score"))
        if not fy_empty and not score_empty:
            continue
        liq = load_liquidity_from_enrich_cache(tk, cache_dir=cdir)
        if not liq:
            continue
        patched = False
        if score_empty and liq.get("liquidity_score") is not None:
            r["liquidity_score"] = liq["liquidity_score"]
            patched = True
        for src, dest in (
            ("current_ratio", "current_ratio"),
            ("quick_ratio", "quick_ratio"),
            ("cash_ratio", "cash_ratio"),
        ):
            if _empty(r.get(dest)) and liq.get(src) is not None:
                r[dest] = liq[src]
                patched = True
        if fy_empty:
            try:
                disp = format_liquidity_display(row=liq)
            except Exception:
                disp = None
            if disp and disp not in ("—", "N/D (sanity)"):
                r["Liquidità (FY)"] = disp
                r["liquidita_fy"] = disp
                patched = True
        if patched:
            changed += 1

    if not changed:
        return 0
    tmp = snapshot_path.with_suffix(".json.cat-liq-tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(snapshot_path)
    print(f"[GuidanceCal] Filled liquidity on {changed} catalyst row(s) from enrich cache", flush=True)
    return changed


def _enrich_catalyst_rows_yf(snapshot_path: Path) -> int:
    """Patch catalyst sim rows with live Yahoo Finance quotes (price, daily change, etc.).

    Uses ``fetch_yfinance.fetch_symbol`` to get real-time data for each
    catalyst ticker that is missing price data.
    """
    try:
        doc = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0

    rows: list[dict] = doc.get("rows") or []
    cat_rows = [r for r in rows if r.get("guidance_calendar_catalyst")]
    if not cat_rows:
        return 0

    try:
        import fetch_yfinance as yf_mod
    except ImportError:
        return 0

    changed = 0
    for r in cat_rows:
        tk = str(r.get("Ticker") or "").strip().upper()
        if not tk:
            continue
        # Skip if already has price
        if r.get("Prezzo Corrente ($)") not in (None, "", "—", "-"):
            continue
        try:
            data = yf_mod.fetch_symbol(tk)
            if not data:
                continue
            price = data.get("currentPrice")
            if price is not None:
                r["Prezzo Corrente ($)"] = float(price)
                changed += 1
            prev_close = data.get("previousClose")
            if prev_close is not None and price is not None:
                try:
                    chg = round((float(price) - float(prev_close)) / float(prev_close) * 100, 2)
                    r["Var. Giorn. %"] = chg
                except (ZeroDivisionError, TypeError, ValueError):
                    pass
            beta = data.get("beta")
            if beta is not None:
                r["Beta (5Y vs mercato)"] = beta
            mcap = data.get("marketCap")
            if mcap is not None:
                r["Market Cap"] = mcap
        except Exception as exc:
            print(f"[GuidanceCal] YF enrich failed for {tk}: {exc}", flush=True)
            continue

    if changed:
        tmp = snapshot_path.with_suffix(".json.cat-enr-tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(snapshot_path)
        print(f"[GuidanceCal] Enriched {changed} catalyst rows with YF data", flush=True)

    return changed


def _load_snapshot() -> dict[str, Any] | None:
    if not _SNAPSHOT_PATH.is_file():
        return None
    try:
        # Public loader purges past events on read/write.
        return load_snapshot()
    except Exception:
        return None
