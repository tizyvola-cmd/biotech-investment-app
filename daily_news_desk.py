"""
Catalyst Daily News desk
========================
Weekday 09:00 Europe/Rome: search latest company news / press releases for
hot-zone Catalyst tickers. Refresh every hour. The box shows articles
**published / filed on the current Europe/Rome calendar day** (or the last
NYSE session day when Rome is on a weekend/holiday — so Catalyst «News» is not
blank Sat–Sun). ``_DESK_FRESHNESS_DAYS = 1`` on trading days; older archive
material belongs in Deep Dive after Migrate → EIS. Migrated / dismissed rows
leave the box.
Items stay staged until the user clicks Migrate → EIS (manual only).

Migrate routing:
  - clinical / trial news → Clinical tab (pre-CD clinical_events)
  - financial / M&A / litigation / SEC → Financial tab (8-K dossier + migrated_filings)

Display + staging only for Soft BUY/SELL — migration writes EIS / Fin scores onto
company records the same way press_release_fetch / 8-K digest does.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

logger = logging.getLogger("supernova.daily_news_desk")

_CACHE_DIR = Path("data") / "cache"
_PATH = _CACHE_DIR / "daily_news_desk.json"

# Cap tickers per run — cover full Catalyst hot-zone (was 36 → missed many names).
_MAX_TICKERS = 80
_MAX_ITEMS_PER_TICKER = 5
# Soft payload cap for rest-universe headlines (all staged, not ±EIS extremes).
_HIGHLIGHT_LIMIT = 120
# Kept for API payload compatibility (no longer used to filter the list).
_HIGHLIGHT_EIS_ABS_MIN = 0.5
_HIGHLIGHT_POS_N = 5
_HIGHLIGHT_NEG_N = 5
# Top News ★ list — all starred Catalyst names (was 12).
_TOP_NEWS_TICKER_CAP = 80
_TOP_8K_PER_TICKER = 2
# Same Europe/Rome calendar day only — past-day PRs belong in Deep Dive after migrate.
_DESK_FRESHNESS_DAYS = 1
_TOP_8K_LOOKBACK_DAYS = 0  # filing_date == today (Rome)
_TOP_PRESS_PER_TICKER = 3
_TOP_NEWS_CACHE_KEY = "top_news"
_USER_ANALYSES_KEY = "user_analyses"
_USER_ANALYSES_CAP = 12
# Persistent across Rome-day resets: never re-stage the same article.
_SEEN_ARTICLES_KEY = "seen_articles"
_SEEN_ARTICLES_CAP = 8_000
# Cached News Brief payloads keyed by article fingerprint.
_BRIEFS_CACHE_KEY = "briefs"
_BRIEFS_CACHE_CAP = 500
_BRIEF_TIME_BUDGET_S = 42.0
# Bump to rebuild thin cached briefs (failed DNS / title-only / no paragraph digest).
_BRIEF_SCHEMA = 8
_HTTP_TIMEOUT_QUICK_S = 8.0
_ANALYZE_TEXT_MAX = 24_000
# Known IR hosts when headline → domain guessing invents junk (AZN “cancer drug cut…”).
_TICKER_IR_DOMAINS: dict[str, list[str]] = {
    "AZN": ["astrazeneca.com"],
    "PFE": ["pfizer.com"],
    "MRK": ["merck.com"],
    "LLY": ["lilly.com"],
    "NVO": ["novonordisk.com"],
    "BMY": ["bms.com", "bristolmyerssquibb.com"],
    "GILD": ["gilead.com"],
    "AMGN": ["amgen.com"],
    "REGN": ["regeneron.com"],
    "VRTX": ["vertexpharmaceuticals.com", "vrtx.com"],
    "BIIB": ["biogen.com"],
    "COCP": ["cocrystalpharma.com"],
    "JNJ": ["jnj.com", "johnsonandjohnson.com"],
    "ABBV": ["abbvie.com"],
    "GSK": ["gsk.com"],
    "SNY": ["sanofi.com"],
    "NVS": ["novartis.com"],
    "ROG": ["roche.com"],
    "RHHBY": ["roche.com"],
}
_STUDY_DEGREE_BLOCK = {
    "MBBS",
    "MD",
    "PHD",
    "MSC",
    "MPH",
    "FRCP",
    "FACC",
    "FACP",
    "DO",
    "RN",
    "BS",
    "BA",
    "MS",
    "CM",
    "HPED",
    "MSHPED",
}

_POS_RE = re.compile(
    r"\b("
    r"approv(?:ed|al|es)|positive|met (?:the )?primary|topline success|"
    r"breakthrough|fast[- ]track|orphan|upsize|oversubscribed|raised|"
    r"partnership|collaboration|license|buyout|acquire|acquisition|"
    r"extends?(?: overall)? survival|survival benefit|improv(?:es|ed) survival"
    r")\b",
    re.I,
)
_NEG_RE = re.compile(
    r"\b("
    r"crl|complete response|reject(?:ed|ion)|clinical hold|halt(?:ed)?|"
    r"discontinu|fail(?:ed|ure)|miss(?:ed)? (?:the )?primary|negative|"
    r"lawsuit|fraud|dilut(?:e|ion)|offering|downgrade|warning letter"
    r")\b",
    re.I,
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now_utc().astimezone().isoformat()


def _rome_now(now: datetime | None = None) -> datetime:
    ref = now or _now_utc()
    try:
        from zoneinfo import ZoneInfo

        return ref.astimezone(ZoneInfo("Europe/Rome"))
    except Exception:
        return ref.astimezone()


def _rome_date(now: datetime | None = None) -> str:
    return _rome_now(now).date().isoformat()


def _rome_hour_bucket(now: datetime | None = None) -> str:
    rn = _rome_now(now)
    return f"{rn.date().isoformat()}T{rn.hour:02d}"


def _read() -> dict[str, Any]:
    if not _PATH.is_file():
        return {}
    try:
        doc = json.loads(_PATH.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


@contextmanager
def _desk_file_lock() -> Iterator[None]:
    """Cross-process lock so 2 gunicorn workers don't clobber briefs/items."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = _PATH.with_suffix(".json.lock")
    fh = lock_path.open("a+", encoding="utf-8")
    try:
        if os.name == "nt":
            import msvcrt

            deadline = time.time() + 30.0
            while True:
                try:
                    msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.time() >= deadline:
                        raise
                    time.sleep(0.05)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        try:
            fh.close()
        except Exception:
            pass


def _write_atomic(doc: dict[str, Any]) -> None:
    """Atomic replace. Caller must hold ``_desk_file_lock`` when doing RMW."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _PATH.with_suffix(".json.tmp")
    payload = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    tmp.write_text(payload, encoding="utf-8")
    os.replace(str(tmp), str(_PATH))


def _merge_briefs_from_disk(doc: dict[str, Any], on_disk: dict[str, Any]) -> None:
    """Never let a stale in-memory doc wipe briefs written by another worker."""
    disk_briefs = on_disk.get(_BRIEFS_CACHE_KEY)
    local_briefs = doc.get(_BRIEFS_CACHE_KEY)
    if isinstance(disk_briefs, dict) and isinstance(local_briefs, dict):
        merged = dict(disk_briefs)
        merged.update(local_briefs)
        doc[_BRIEFS_CACHE_KEY] = _prune_keyed_cap(merged, cap=_BRIEFS_CACHE_CAP)
    elif isinstance(disk_briefs, dict) and not isinstance(local_briefs, dict):
        doc[_BRIEFS_CACHE_KEY] = disk_briefs


def _write(doc: dict[str, Any]) -> None:
    """Locked atomic write; re-merges ``briefs`` from disk to avoid multi-worker clobber."""
    with _desk_file_lock():
        on_disk = _read()
        _merge_briefs_from_disk(doc, on_disk)
        _write_atomic(doc)


def _update_desk(mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """Locked read → mutate(doc) → atomic write (safe under multi-worker)."""
    with _desk_file_lock():
        doc = _read()
        mutate(doc)
        _write_atomic(doc)
        return doc


def persist_brief_cache(
    fp: str,
    brief: dict[str, Any],
    *,
    item_id: str = "",
) -> None:
    """Merge one brief into the shared desk cache without losing sibling keys."""
    if not fp or not isinstance(brief, dict):
        return

    def _mut(doc: dict[str, Any]) -> None:
        _brief_cache_put(doc, fp, brief, item_id=item_id)

    _update_desk(_mut)
def _item_id(ticker: str, title: str, event_date: str) -> str:
    raw = f"{ticker}|{event_date}|{title[:80]}".lower()
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


_MONTH_NUM: dict[str, int] = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _iso_ymd(y: int | str, m: int | str, d: int | str) -> str | None:
    try:
        return date(int(y), int(m), int(d)).isoformat()
    except (TypeError, ValueError):
        return None


def _parse_human_date_token(blob: str) -> str | None:
    """Parse a single date token → YYYY-MM-DD (best effort)."""
    s = re.sub(r"\s+", " ", str(blob or "").strip())
    if not s:
        return None
    m = re.fullmatch(r"(20\d{2})-(\d{2})-(\d{2})", s)
    if m:
        return _iso_ymd(m.group(1), m.group(2), m.group(3))
    m = re.fullmatch(
        r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})",
        s,
        re.I,
    )
    if m:
        key = re.sub(r"[^a-z]", "", m.group(1).lower())
        mon = _MONTH_NUM.get(key) or _MONTH_NUM.get(key[:3]) or 0
        return _iso_ymd(m.group(3), mon, m.group(2)) if mon else None
    m = re.fullmatch(r"(\d{1,2})[./\-](\d{1,2})[./\-](20\d{2})", s)
    if m:
        # Prefer D/M/Y for EU/press; swap if month>12
        d1, d2, y = int(m.group(1)), int(m.group(2)), m.group(3)
        if d1 > 12 and d2 <= 12:
            return _iso_ymd(y, d2, d1)
        if d2 > 12 and d1 <= 12:
            return _iso_ymd(y, d1, d2)
        return _iso_ymd(y, d2, d1)  # assume D/M/Y
    m = re.fullmatch(r"(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
                     r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
                     r"Nov(?:ember)?|Dec(?:ember)?)\.?\s+(20\d{2})", s, re.I)
    if m:
        key = re.sub(r"[^a-z]", "", m.group(2).lower())
        mon = _MONTH_NUM.get(key) or _MONTH_NUM.get(key[:3]) or 0
        return _iso_ymd(m.group(3), mon, m.group(1)) if mon else None
    return None


def _extract_publication_date(
    text: str,
    *,
    title: str = "",
    fallback: str | None = None,
) -> str | None:
    """
    Best-effort publication / press-release / PDF issue date → YYYY-MM-DD.
    Prefers explicit 'Published' labels, then PR datelines, then early dates.
    """
    title_s = str(title or "")
    body = str(text or "")
    head = f"{title_s}\n{body}"[:4500]
    # 1) Explicit publication labels (PDF journals, PR pages)
    label_re = re.compile(
        r"(?is)(?:published\s+online(?:\s+\([^)]+\))?|published\s+(?:on|date)?|"
        r"publication\s+date|date\s+of\s+publication|online\s+publication|"
        r"released\s+on|issue\s+date|posted\s+on|press\s+release\s+date|"
        r"available\s+online|epub\s+(?:ahead\s+of\s+print)?)\s*[:\-]?\s*"
        r"("
        r"20\d{2}-\d{2}-\d{2}"
        r"|\d{1,2}[./\-]\d{1,2}[./\-]20\d{2}"
        r"|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}"
        r"|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
        r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
        r"Nov(?:ember)?|Dec(?:ember)?)\.?\s+20\d{2}"
        r")",
    )
    m = label_re.search(head)
    if m:
        iso = _parse_human_date_token(m.group(1))
        if iso:
            return iso
    # 2) PRNewswire / GlobeNewswire dateline: CITY, Month Day, Year —
    m = re.search(
        r"(?i)\b(?:[A-Z][A-Za-z .]{2,40},\s+)?"
        r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\s*"
        r"(?:/PRNewswire|/GlobeNewswire|/Business\s*Wire|—|--)",
        head,
    )
    if m:
        iso = _parse_human_date_token(f"{m.group(1)} {m.group(2)}, {m.group(3)}")
        if iso:
            return iso
    # 3) "Received … Accepted … Published DD Month YYYY"
    m = re.search(
        r"(?i)\b(?:accepted|published)\s+(?:online\s+)?"
        r"(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
        r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
        r"Nov(?:ember)?|Dec(?:ember)?)\.?\s+20\d{2})",
        head,
    )
    if m:
        iso = _parse_human_date_token(m.group(1))
        if iso:
            return iso
    # 4) First clear calendar date in the first ~1200 chars (avoid year-only)
    early = head[:1200]
    for m in re.finditer(
        r"\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}"
        r"|20\d{2}-\d{2}-\d{2}"
        r"|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
        r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
        r"Nov(?:ember)?|Dec(?:ember)?)\.?\s+20\d{2})\b",
        early,
        re.I,
    ):
        iso = _parse_human_date_token(m.group(1))
        if iso:
            return iso
    fb = str(fallback or "").strip()[:10]
    if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", fb):
        return fb
    return None


def _publication_date_from_html(html: str) -> str | None:
    """Pull article:published_time / datePublished / time datetime from HTML."""
    blob = str(html or "")
    if len(blob) < 40:
        return None
    patterns = (
        r'property=["\']article:published_time["\']\s+content=["\']([^"\']+)',
        r'content=["\']([^"\']+)["\']\s+property=["\']article:published_time["\']',
        r'name=["\']pubdate["\']\s+content=["\']([^"\']+)',
        r'name=["\']publish[_-]?date["\']\s+content=["\']([^"\']+)',
        r'itemprop=["\']datePublished["\']\s+(?:content|datetime)=["\']([^"\']+)',
        r'datetime=["\'](20\d{2}-\d{2}-\d{2}[^"\']*)["\']',
        r'"datePublished"\s*:\s*"(20\d{2}-\d{2}-\d{2}[^"]*)"',
        r'"dateCreated"\s*:\s*"(20\d{2}-\d{2}-\d{2}[^"]*)"',
    )
    for pat in patterns:
        m = re.search(pat, blob, re.I)
        if not m:
            continue
        raw = m.group(1).strip()
        iso = raw[:10]
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", iso):
            return iso
        parsed = _parse_human_date_token(raw)
        if parsed:
            return parsed
        try:
            from email.utils import parsedate_to_datetime

            return parsedate_to_datetime(raw).date().isoformat()
        except Exception:
            pass
    return None


def _publication_date_from_url(url: str) -> str | None:
    u = str(url or "").strip()
    if not u.startswith(("http://", "https://")):
        return None
    if "news.google.com" in u.lower():
        return None
    try:
        import requests

        r = requests.get(
            u, timeout=_HTTP_TIMEOUT_QUICK_S, headers=_HTTP_HEADERS, allow_redirects=True
        )
        if r.status_code >= 400:
            return None
        return _publication_date_from_html(r.text or "")
    except Exception as exc:
        logger.debug("publication date URL fetch failed: %s", exc)
        return None


def _headline_published_iso(h: dict[str, Any], *, fallback_day: str) -> str:
    """Prefer RSS datetime; fall back to the calendar day used for desk freshness."""
    raw = str(h.get("published_at") or "").strip()
    if re.search(r"T\d{2}:\d{2}", raw):
        return raw
    pub = str(h.get("pub_date") or h.get("pubDate") or "").strip()
    if pub:
        try:
            from email.utils import parsedate_to_datetime

            dt = parsedate_to_datetime(pub)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except Exception:
            pass
    day = str(fallback_day or "").strip()[:10]
    return day if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", day) else fallback_day


def _ensure_published_at(row: dict[str, Any]) -> dict[str, Any]:
    """Fill published_at from event_date / found_at / text when missing."""
    if not isinstance(row, dict):
        return row
    existing = str(row.get("published_at") or "").strip()[:10]
    if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", existing):
        return row
    ed = str(row.get("event_date") or "").strip()[:10]
    if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", ed):
        out = dict(row)
        out["published_at"] = ed
        return out
    # Try extract from stored body (manual / PDF)
    blob = " ".join(
        str(row.get(k) or "")
        for k in (
            "title",
            "summary_10w",
            "summary",
            "summary_long",
            "detail_summary",
            "source_excerpt",
            "abstract",
            "source_label",
        )
    )
    extracted = _extract_publication_date(
        blob,
        title=str(row.get("title") or row.get("summary_10w") or ""),
    )
    if extracted:
        out = dict(row)
        out["published_at"] = extracted
        if not out.get("event_date"):
            out["event_date"] = extracted
        return out
    # Same-day PR language without calendar date → use discovery day
    if re.search(r"(?i)\btoday\s+(?:announced|reported|disclosed)\b", blob):
        fa = str(row.get("found_at") or "")[:10]
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", fa):
            out = dict(row)
            out["published_at"] = fa
            if not out.get("event_date"):
                out["event_date"] = fa
            return out
    return row


def _row_publication_day(row: dict[str, Any] | None) -> str | None:
    """ISO date (YYYY-MM-DD) for when the article was published / filed / found."""
    if not isinstance(row, dict):
        return None
    for key in ("published_at", "event_date", "found_at"):
        raw = str(row.get(key) or "").strip()[:10]
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw):
            return raw
    return None


def _row_is_active_on_desk(row: dict[str, Any] | None) -> bool:
    """False when dismissed or already migrated → Deep Dive (leave Daily News)."""
    if not isinstance(row, dict):
        return False
    if row.get("dismissed"):
        return False
    if row.get("migrated_to_eis"):
        return False
    st = str(row.get("status") or "").strip().lower()
    if st in {"migrated", "dismissed"}:
        return False
    return True


def _desk_fresh_cutoff_iso(*, today: str | None = None) -> str:
    """Oldest ISO date still eligible for the Daily News desk window."""
    day = date.fromisoformat((today or _rome_date())[:10])
    back = max(0, int(_DESK_FRESHNESS_DAYS) - 1)
    return (day - timedelta(days=back)).isoformat()


def _row_is_desk_fresh(
    row: dict[str, Any] | None,
    *,
    today: str | None = None,
) -> bool:
    """True when publication day is within the Rome desk freshness window.

    Undated rows are excluded — Daily News must not carry undated archive items;
    those belong in Deep Dive after migrate (or never enter the desk).

    On weekends / NYSE holidays, keep news from the last regular session day so
    the Catalyst «News» column is not blank Saturday–Sunday.
    """
    day = (today or _rome_date())[:10]
    pub = _row_publication_day(row)
    if not pub:
        return False
    cutoff = _desk_fresh_cutoff_iso(today=day)
    if cutoff <= pub <= day:
        return True
    try:
        from us_equity_session import is_nyse_trading_day, last_regular_session_close

        d = date.fromisoformat(day)
        trading, _ = is_nyse_trading_day(d)
        if trading:
            return False
        last_day = last_regular_session_close(
            datetime(d.year, d.month, d.day, 12, 0, tzinfo=timezone.utc)
        ).date()
        last_iso = last_day.isoformat()
        last_cutoff = _desk_fresh_cutoff_iso(today=last_iso)
        return last_cutoff <= pub <= last_iso
    except Exception:
        return False


def _row_visible_on_desk(
    row: dict[str, Any] | None,
    *,
    today: str | None = None,
) -> bool:
    """Fresh + not yet migrated/dismissed — what the Daily News box may show."""
    return _row_is_active_on_desk(row) and _row_is_desk_fresh(row, today=today)


# Back-compat alias used by older call sites / tests.
def _row_is_same_rome_day(
    row: dict[str, Any] | None,
    *,
    today: str | None = None,
) -> bool:
    return _row_is_desk_fresh(row, today=today)


def _filter_desk_fresh(
    rows: list[Any] | None,
    *,
    today: str | None = None,
    active_only: bool = True,
) -> list[dict[str, Any]]:
    day = today or _rome_date()
    out: list[dict[str, Any]] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        if active_only and not _row_is_active_on_desk(r):
            continue
        if _row_is_desk_fresh(r, today=day):
            out.append(r)
    return out


def _filter_same_rome_day(
    rows: list[Any] | None,
    *,
    today: str | None = None,
) -> list[dict[str, Any]]:
    return _filter_desk_fresh(rows, today=today)


def _normalize_article_title(title: str) -> str:
    """Stable title key: lowercase, collapse space, strip publisher suffix."""
    t = re.sub(r"\s+", " ", str(title or "").strip().lower())
    t = re.sub(r"\s*[-–|]\s+[a-z0-9][a-z0-9 .,&'’]{1,60}\s*$", "", t)
    return t[:160].strip()


def _normalize_article_url(url: str) -> str:
    u = str(url or "").strip()
    if not u:
        return ""
    # Drop Google News RSS wrappers — they rotate tokens daily
    if "news.google.com" in u.lower():
        return ""
    try:
        from urllib.parse import urlsplit, urlunsplit

        parts = urlsplit(u)
        host = (parts.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        path = (parts.path or "").rstrip("/")
        return urlunsplit((parts.scheme.lower() or "https", host, path, "", ""))
    except Exception:
        return u.split("?")[0].rstrip("/").lower()


def _article_fingerprint(
    *,
    ticker: str = "",
    title: str = "",
    url: str = "",
    item_id: str = "",
) -> str:
    """
    Cross-day identity for an article (title/ticker or publisher URL).
    Independent of Rome date so the same headline is not re-staged daily.
    """
    link = _normalize_article_url(url)
    if link:
        raw = f"u|{link}"
    else:
        nt = _normalize_article_title(title)
        tk = str(ticker or "").strip().upper()
        if nt:
            raw = f"t|{tk}|{nt}"
        elif item_id:
            raw = f"id|{item_id}"
        else:
            raw = f"x|{tk}|{str(title or '')[:80].lower()}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def _seen_map(doc: dict[str, Any] | None = None) -> dict[str, Any]:
    d = doc if isinstance(doc, dict) else _read()
    raw = d.get(_SEEN_ARTICLES_KEY)
    return raw if isinstance(raw, dict) else {}


def _briefs_map(doc: dict[str, Any] | None = None) -> dict[str, Any]:
    d = doc if isinstance(doc, dict) else _read()
    raw = d.get(_BRIEFS_CACHE_KEY)
    return raw if isinstance(raw, dict) else {}


def _prune_keyed_cap(store: dict[str, Any], *, cap: int, ts_key: str = "at") -> dict[str, Any]:
    if len(store) <= cap:
        return store
    ranked = sorted(
        store.items(),
        key=lambda kv: str((kv[1] or {}).get(ts_key) or "")
        if isinstance(kv[1], dict)
        else "",
    )
    drop = len(store) - cap
    for k, _ in ranked[:drop]:
        store.pop(k, None)
    return store


def _mark_article_seen(
    doc: dict[str, Any],
    fp: str,
    *,
    status: str,
    ticker: str = "",
    title: str = "",
    url: str = "",
    item_id: str = "",
) -> None:
    if not fp:
        return
    seen = _seen_map(doc)
    prev = seen.get(fp) if isinstance(seen.get(fp), dict) else {}
    # Never downgrade dismissed/migrated back to staged
    prev_status = str(prev.get("status") or "")
    if prev_status in {"dismissed", "migrated"} and status == "staged":
        status = prev_status
    seen[fp] = {
        **prev,
        "status": status,
        "at": _now_iso(),
        "ticker": (ticker or prev.get("ticker") or "")[:12],
        "title": (title or prev.get("title") or "")[:180],
        "url": (url or prev.get("url") or "")[:400],
        "item_id": (item_id or prev.get("item_id") or "")[:32],
    }
    doc[_SEEN_ARTICLES_KEY] = _prune_keyed_cap(seen, cap=_SEEN_ARTICLES_CAP)


def _is_article_seen(doc: dict[str, Any], fp: str) -> bool:
    if not fp:
        return False
    entry = _seen_map(doc).get(fp)
    return isinstance(entry, dict) and bool(entry.get("status"))


_PASSED_STATUSES = frozenset({"dismissed", "migrated"})

_STORY_FAMILY_CUES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "analyst",
        (
            "rating",
            "price target",
            "overweight",
            "outperform",
            "underperform",
            "underweight",
            "initiate",
            "maintains",
            "reiterat",
            "buy rating",
            "target price",
            "raises target",
            "cuts target",
            "pt to",
        ),
    ),
    (
        "financing",
        (
            "warrant",
            "offering",
            "raises $",
            "raised $",
            "raise cash",
            "raises cash",
            "path to raise",
            "to raise cash",
            "to raise capital",
            "financing",
            "placement",
            " atm",
            "dilut",
            "priced offering",
            "public offering",
            "private placement",
            "bought deal",
            "capital raise",
        ),
    ),
    (
        "clinical",
        (
            "phase ",
            "phase-1",
            "phase-2",
            "phase-3",
            "clinical trial",
            " fda",
            "pdufa",
            "readout",
            "enrollment",
            "pivotal",
            "endpoint",
            "topline",
            "top-line",
        ),
    ),
    (
        "corporate",
        (
            "merger",
            "acquire",
            "acquisition",
            " ceo",
            " cfo",
            "resign",
            "appoint",
        ),
    ),
)


def _story_family(title: str) -> str:
    blob = f" {str(title or '').lower()} "
    for fam, cues in _STORY_FAMILY_CUES:
        if any(c in blob for c in cues):
            return fam
    return "other"


def _significant_title_tokens(title: str, ticker: str = "") -> list[str]:
    stop = {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
        "by", "as", "at", "is", "are", "was", "were", "be", "its", "inc",
        "plc", "ltd", "corp", "therapeutics", "pharma", "pharmaceuticals",
        "biotech", "se", "sa", "ag", "nv", "co", "company", "stock",
    }
    tk = str(ticker or "").strip().lower()
    if tk:
        stop.add(tk)
    words = re.findall(r"[a-z0-9$%]{3,}", str(title or "").lower())
    out: list[str] = []
    seen: set[str] = set()
    for w in words:
        if w in stop or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out


def _story_cluster_key(*, ticker: str, title: str, day: str = "") -> str:
    """One key per ticker+day+event family (warrants, analyst note, …)."""
    tk = str(ticker or "").strip().upper()
    d = str(day or "").strip()[:10]
    fam = _story_family(title)
    if fam != "other":
        return f"{tk}|{d}|{fam}"
    toks = _significant_title_tokens(title, tk)
    core = "|".join(toks[:8])
    if core:
        return f"{tk}|{d}|t|{core}"
    nt = _normalize_article_title(title)
    return f"{tk}|{d}|t|{nt[:80]}"


def _cluster_store_key(cluster: str) -> str:
    c = str(cluster or "").strip()
    return f"c|{c}" if c else ""


def _seen_status(doc: dict[str, Any], key: str) -> str:
    if not key:
        return ""
    entry = _seen_map(doc).get(key)
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("status") or "").strip().lower()


def _is_article_passed(
    doc: dict[str, Any],
    *,
    fp: str = "",
    cluster: str = "",
    ticker: str = "",
    title: str = "",
    day: str = "",
) -> bool:
    """True when this article (or its same-day event cluster) was dismissed/migrated."""
    if _seen_status(doc, fp) in _PASSED_STATUSES:
        return True
    ck = cluster or (
        _story_cluster_key(ticker=ticker, title=title, day=day)
        if (ticker or title)
        else ""
    )
    return _seen_status(doc, _cluster_store_key(ck)) in _PASSED_STATUSES


def _is_cluster_known(doc: dict[str, Any], cluster: str) -> bool:
    return bool(_seen_status(doc, _cluster_store_key(cluster)))


def _mark_row_seen(
    doc: dict[str, Any],
    row: dict[str, Any],
    *,
    status: str,
) -> None:
    title = str(row.get("title") or row.get("summary_10w") or "")
    ticker = str(row.get("ticker") or "")
    url = str(row.get("link") or row.get("source_ref") or "")
    iid = str(row.get("id") or "")
    day = _row_publication_day(row) or _rome_date()
    fp = str(row.get("article_fp") or "").strip() or _article_fingerprint(
        ticker=ticker, title=title, url=url, item_id=iid
    )
    ck = str(row.get("story_cluster") or "").strip() or _story_cluster_key(
        ticker=ticker, title=title, day=day
    )
    if fp:
        row["article_fp"] = fp
        _mark_article_seen(
            doc,
            fp,
            status=status,
            ticker=ticker,
            title=title,
            url=url,
            item_id=iid,
        )
    if ck:
        row["story_cluster"] = ck
        _mark_article_seen(
            doc,
            _cluster_store_key(ck),
            status=status,
            ticker=ticker,
            title=title,
            url=url,
            item_id=iid,
        )


def _dedupe_desk_rows(
    rows: list[Any] | None,
    *,
    doc: dict[str, Any] | None = None,
    today: str | None = None,
) -> list[dict[str, Any]]:
    """Drop passed stories and keep one headline per ticker+day+event family."""
    day = today or _rome_date()
    ranked = [r for r in (rows or []) if isinstance(r, dict)]
    ranked.sort(
        key=lambda i: (
            abs(float(i.get("eis_score") or 0.0)),
            str(i.get("event_date") or i.get("found_at") or ""),
        ),
        reverse=True,
    )
    out: list[dict[str, Any]] = []
    seen_fp: set[str] = set()
    seen_ck: set[str] = set()
    for r in ranked:
        title = str(r.get("title") or r.get("summary_10w") or "").strip()
        ticker = str(r.get("ticker") or "").strip().upper()
        pub = _row_publication_day(r) or day
        url = str(r.get("link") or r.get("source_ref") or "")
        iid = str(r.get("id") or "")
        fp = str(r.get("article_fp") or "").strip() or _article_fingerprint(
            ticker=ticker, title=title, url=url, item_id=iid
        )
        ck = _story_cluster_key(ticker=ticker, title=title, day=pub)
        if doc is not None and _is_article_passed(
            doc, fp=fp, cluster=ck, ticker=ticker, title=title, day=pub
        ):
            continue
        if fp and fp in seen_fp:
            continue
        if ck and ck in seen_ck:
            continue
        if fp:
            seen_fp.add(fp)
            r["article_fp"] = fp
        if ck:
            seen_ck.add(ck)
            r["story_cluster"] = ck
        out.append(r)
    return out


def _brief_cache_get(fp: str, doc: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if not fp:
        return None
    entry = _briefs_map(doc).get(fp)
    if not isinstance(entry, dict):
        return None
    brief = entry.get("brief")
    return brief if isinstance(brief, dict) and brief else None


def _brief_cache_put(
    doc: dict[str, Any],
    fp: str,
    brief: dict[str, Any],
    *,
    item_id: str = "",
) -> None:
    if not fp or not isinstance(brief, dict):
        return
    store = _briefs_map(doc)
    store[fp] = {
        "at": _now_iso(),
        "item_id": item_id[:32],
        "brief": brief,
    }
    doc[_BRIEFS_CACHE_KEY] = _prune_keyed_cap(store, cap=_BRIEFS_CACHE_CAP)


def _brief_cache_delete(doc: dict[str, Any], fp: str) -> None:
    if not fp:
        return
    store = _briefs_map(doc)
    if fp in store:
        store.pop(fp, None)
        doc[_BRIEFS_CACHE_KEY] = store


def _attach_cached_brief_for_desk(
    row: dict[str, Any], doc: dict[str, Any] | None = None
) -> dict[str, Any]:
    """
    Attach warmed investor brief onto desk rows so the UI can seed its cache
    as soon as the headline appears — without waiting for the first modal open.
    """
    if not isinstance(row, dict):
        return row
    if isinstance(row.get("cached_brief"), dict) and row.get("cached_brief"):
        return row
    fp = str(row.get("article_fp") or "").strip()
    if not fp:
        fp = _article_fingerprint(
            ticker=str(row.get("ticker") or ""),
            title=str(row.get("title") or row.get("summary_10w") or ""),
            url=str(
                row.get("resolved_link")
                or row.get("link")
                or row.get("source_ref")
                or ""
            ),
            item_id=str(row.get("id") or ""),
        )
    brief = _brief_cache_get(fp, doc) if fp else None
    if not isinstance(brief, dict) or not brief:
        return row
    out = dict(row)
    out["cached_brief"] = brief
    if not out.get("article_fp") and fp:
        out["article_fp"] = fp
    return out


def _headline_sentiment(text: str) -> float:
    blob = str(text or "")
    pos = 1 if _POS_RE.search(blob) else 0
    neg = 1 if _NEG_RE.search(blob) else 0
    if pos and not neg:
        return 1.5 if re.search(r"\b(approv|breakthrough|acquire)\b", blob, re.I) else 1.0
    if neg and not pos:
        return -2.0 if re.search(r"\b(crl|clinical hold|fail)\b", blob, re.I) else -1.0
    if pos and neg:
        return 0.0
    return 0.25  # neutral but still surfaceable vs empty


def _provisional_eis(title: str, summary: str) -> dict[str, Any]:
    from prediction.event_impact_score import compute_eis

    sent = _headline_sentiment(f"{title} {summary}")
    return compute_eis(
        delta_p_1d=None,
        delta_p_3d=None,
        vol_ratio=None,
        sentiment=sent,
    )


def _dimension_scores(
    title: str,
    summary: str = "",
    *,
    use_ai: bool = False,
) -> dict[str, Any]:
    """
    Clin / Fin / Societaria / Market-access via taxonomy classification.
    Scores are deterministic from config/eis_event_taxonomy.json.
    Card EIS is a reproducible proxy from those scores (not EIS_market).
    """
    from eis_taxonomy_scoring import score_article_dimensions

    blob = f"{title or ''} {summary or ''}".strip()
    if len(blob) < 12:
        blob = title or "news"
    scored = score_article_dimensions(blob, use_ai=use_ai)
    return {
        "clinical_score": scored.get("clinical_score"),
        "financial_score": scored.get("financial_score"),
        "corporate_score": scored.get("corporate_score"),
        "eis_score": scored.get("eis_score"),
        "eis": scored.get("eis"),
        "market_access_score": scored.get("market_access_score"),
        "market_access_notes": scored.get("market_access_notes"),
        "taxonomy_version": scored.get("taxonomy_version"),
        "taxonomy_method": scored.get("taxonomy_method"),
        "taxonomy_dimensions": scored.get("taxonomy_dimensions"),
        "taxonomy_review_flags": scored.get("taxonomy_review_flags"),
        "taxonomy_audit": scored.get("taxonomy_audit"),
        "heuristic_rev": scored.get("heuristic_rev"),
    }


def _merge_dimension_scores(row: dict[str, Any]) -> dict[str, Any]:
    """
    Fill missing Clin/Fin/Soc/Access on a news row (cached items / older digests).
    Never clobber an existing desk eis_score — taxonomy is a fill-in, not a rewrite.
    Never re-score on every GET when dimension scores are already present (that
    made /api/market/daily-news hang past the UI timeout → empty box).
    Re-score sticky unclassified 0.0 rows after heuristic pattern upgrades.
    """
    if not isinstance(row, dict):
        return row
    try:
        from eis_taxonomy_scoring import HEURISTIC_REV, DIMENSIONS
    except Exception:
        HEURISTIC_REV = 0
        DIMENSIONS = ("clinical", "financial", "corporate", "market_access")

    need_missing = any(
        row.get(k) is None
        for k in (
            "clinical_score",
            "financial_score",
            "corporate_score",
            "market_access_score",
        )
    )
    dims = row.get("taxonomy_dimensions")
    stale_heur = int(row.get("heuristic_rev") or 0) != int(HEURISTIC_REV)
    # Fresh enough — skip taxonomy on the hot GET path.
    if not need_missing and not stale_heur:
        return row
    try:
        dims_scored = _dimension_scores(
            str(row.get("title") or row.get("summary_10w") or ""),
            str(
                row.get("summary")
                or row.get("summary_long")
                or row.get("source_excerpt")
                or ""
            ),
        )
    except Exception as exc:
        logger.debug("dimension score fill skipped: %s", exc)
        return row
    out = dict(row)
    preserved_eis = out.get("eis_score")
    preserved_eis_obj = out.get("eis") if isinstance(out.get("eis"), dict) else None
    # Sticky unclassified zeros OR heuristic pattern upgrades (e.g. earnings vs
    # incidental clinical) must rewrite Clin/Fin/EIS, not keep the old chips.
    replace_scores = stale_heur or (
        isinstance(dims, dict)
        and dims
        and all(bool((dims.get(d) or {}).get("unclassified", True)) for d in DIMENSIONS)
    )
    for k, v in dims_scored.items():
        if k.startswith("taxonomy_") or k == "heuristic_rev":
            out[k] = v
            continue
        if replace_scores or out.get(k) is None:
            out[k] = v
    if preserved_eis is not None and not replace_scores:
        out["eis_score"] = preserved_eis
    if preserved_eis_obj is not None and not replace_scores:
        out["eis"] = preserved_eis_obj
    out["heuristic_rev"] = dims_scored.get("heuristic_rev", HEURISTIC_REV)
    # Align news_kind chip with the winning dimension after refresh.
    if replace_scores:
        tdims = out.get("taxonomy_dimensions") or {}
        if isinstance(tdims, dict):
            if (tdims.get("financial") or {}).get("event_id"):
                out["news_kind"] = "financial"
            elif (tdims.get("clinical") or {}).get("event_id"):
                out["news_kind"] = "clinical"
    return out


def _company_map() -> dict[str, str]:
    """ticker → company from desk morning events + clinical snapshot."""
    out: dict[str, str] = {}
    try:
        from catalyst_desk_cache import load_desk_cache

        desk = load_desk_cache() or {}
        morning = desk.get("morning") if isinstance(desk.get("morning"), dict) else {}
        for ev in morning.get("events") or []:
            if not isinstance(ev, dict):
                continue
            tk = str(ev.get("ticker") or "").strip().upper()
            co = str(ev.get("company") or "").strip()
            if tk and co and tk not in out:
                out[tk] = co
    except Exception:
        pass
    try:
        from clinical_pre_cd_enrichment import load_snapshot

        snap = load_snapshot()
        for rec in snap.get("records") or []:
            if not isinstance(rec, dict):
                continue
            tk = str(rec.get("ticker") or "").strip().upper()
            co = str(rec.get("company") or "").strip()
            if tk and co and tk not in out:
                out[tk] = co
    except Exception:
        pass
    try:
        from catalyst_interest import list_interest_entries

        for e in list_interest_entries():
            tk = str(e.get("ticker") or "").strip().upper()
            co = str(e.get("company") or "").strip()
            if tk and tk not in out:
                out[tk] = co or tk
    except Exception:
        pass
    return out


# Tickers that are also everyday English (or 1–2 letters). Never match the
# lowercase word "kids" / "on" / "lung" as OrthoPediatrics / … symbols.
_AMBIGUOUS_TICKER_WORDS = frozenset(
    {
        "A",
        "I",
        "ON",
        "IT",
        "OR",
        "AT",
        "GO",
        "UP",
        "BY",
        "TO",
        "SO",
        "NO",
        "BE",
        "AGE",
        "AIR",
        "ARM",
        "ART",
        "BIO",
        "CAN",
        "CAR",
        "CAT",
        "COO",
        "DOC",
        "EYE",
        "FAN",
        "FIT",
        "FIX",
        "FUN",
        "GAP",
        "GEL",
        "GEM",
        "GH",
        "HAE",
        "ICE",
        "KEY",
        "KID",
        "KIDS",
        "LAB",
        "NET",
        "NOW",
        "NEW",
        "OIL",
        "ONE",
        "OUT",
        "PEN",
        "PET",
        "PRO",
        "RED",
        "RUN",
        "SEE",
        "SET",
        "SKY",
        "SUN",
        "TAX",
        "TOP",
        "TOY",
        "TWO",
        "USE",
        "VAN",
        "WAR",
        "WAY",
        "WEB",
        "WIN",
        "BIG",
        "LOW",
        "MAX",
        "OLD",
        "CURE",
        "CARE",
        "LIFE",
        "HOPE",
        "OPEN",
        "REAL",
        "BEST",
        "GOOD",
        "PLAY",
        "LOVE",
        "BABY",
        "HERO",
        "MIND",
        "BODY",
        "PEAK",
        "RISE",
        "WAVE",
        "WIND",
        "STAR",
        "MOON",
        "PLUS",
        "GOLD",
        "TREE",
        "BOLD",
        "TRUE",
        "GLOW",
        "HEAL",
        "PAIN",
        "BONE",
        "SKIN",
        "CELL",
        "GENE",
        "MASS",
        "ATOM",
        "AURA",
        "BEAM",
        "EDIT",
        "PATH",
        "GATE",
        "FOCUS",
        "SIGHT",
        "LIGHT",
        "POWER",
        "TRUST",
        "SHARE",
        "PRICE",
        "STOCK",
        "TRADE",
        "NEWS",
        "DATA",
        "TEST",
        "DRUG",
        "PILL",
        "DOSE",
        "LUNG",
        "SENS",
        "GUTS",
        "SILK",
        "TELA",
        "SER",
        "EW",
        "ZD",
        "STE",
        "SHC",
        "HUMA",
    }
)


def _is_ambiguous_ticker(ticker: str) -> bool:
    tk = str(ticker or "").strip().upper()
    if not tk:
        return False
    if len(tk) <= 2:
        return True
    return tk in _AMBIGUOUS_TICKER_WORDS


def _ticker_as_symbol(text: str, ticker: str) -> bool:
    """True only when the text uses the ticker as a market symbol, not a word."""
    raw = text or ""
    tk = str(ticker or "").strip().upper()
    if not tk:
        return False
    if re.search(rf"\(\s*{re.escape(tk)}\s*\)", raw, re.I):
        return True
    if re.search(rf"\$\s*{re.escape(tk)}\b", raw, re.I):
        return True
    if re.search(
        rf"\b(?:NASDAQ|NYSE|AMEX|NYSEAMERICAN|NYSE\s*MKT)\s*[:\-/ ]\s*{re.escape(tk)}\b",
        raw,
        re.I,
    ):
        return True
    # All-caps token KIDS — not "kids" / "Kids". Skip all-caps headlines.
    if re.search(rf"(?<![A-Za-z]){re.escape(tk)}(?![A-Za-z])", raw):
        letters = re.sub(r"[^A-Za-z]", "", raw)
        if letters and letters != letters.upper():
            return True
    return False


def _company_name_in_text(text: str, company: str) -> bool:
    blob = (text or "").lower()
    co = (company or "").strip()
    if len(co) < 4:
        return False
    co_l = co.lower()
    if co_l in blob:
        return True
    core = re.sub(
        r"\b(inc\.?|corp\.?|ltd\.?|llc|plc|therapeutics|pharmaceuticals|"
        r"pharma|corporation|company)\b",
        "",
        co_l,
        flags=re.I,
    )
    core = re.sub(r"\s+", " ", core).strip(" ,.-")
    if len(core) >= 5 and core in blob:
        return True
    first = (co.split() or [""])[0]
    if len(first) >= 8 and first.lower() in blob:
        return True
    return False


def _blob_mentions_ticker(
    title: str,
    summary: str = "",
    ticker: str = "",
    company: str = "",
) -> bool:
    blob = f"{title or ''} {summary or ''}"
    tk = str(ticker or "").strip().upper()
    if not tk:
        return False
    if _company_name_in_text(blob, company):
        return True
    if _is_ambiguous_ticker(tk):
        return _ticker_as_symbol(blob, tk)
    return bool(re.search(rf"(?<![A-Za-z]){re.escape(tk)}(?![A-Za-z])", blob, re.I))


def _row_ticker_is_grounded(row: dict[str, Any]) -> bool:
    """Drop rest-universe rows whose ticker is a common word with no company hit."""
    if not isinstance(row, dict):
        return True
    tk = str(row.get("ticker") or "").strip().upper()
    if not tk or not _is_ambiguous_ticker(tk):
        return True
    source = str(row.get("source") or row.get("source_kind") or "").lower()
    if source in {"sec_8k", "clinicaltrials", "ctgov", "fda_adcom"}:
        return True
    company = str(row.get("company") or "")
    title = str(row.get("title") or "")
    summary = str(row.get("summary") or "")
    return _blob_mentions_ticker(title, summary, tk, company)


def _infer_ticker_from_text(text: str) -> str | None:
    """
    Resolve a universe ticker from free text (Manual news / migrate).
    Prefers explicit (CRDL) / bare ticker tokens, then company-name match.
    Common-word tickers (KIDS, ON, LUNG) require $TICKER / (TICKER) / company.
    """
    blob = _clean_fetched_text(text or "")
    if len(blob) < 8:
        return None
    cmap = _company_map()
    if not cmap:
        return None
    # Explicit (TICKER)
    for m in re.finditer(r"\(([A-Za-z]{1,5})\)", blob):
        tk = m.group(1).upper()
        if tk in cmap:
            return tk
    # Bare ticker token present in universe (word boundary)
    for tk in sorted(cmap.keys(), key=len, reverse=True):
        if _is_ambiguous_ticker(tk):
            if _ticker_as_symbol(blob, tk):
                return tk
            continue
        if re.search(rf"(?<![A-Za-z]){re.escape(tk)}(?![A-Za-z])", blob, re.I):
            return tk
    # Full / partial company name (longest first)
    pairs = sorted(
        ((co, tk) for tk, co in cmap.items() if co and len(co) >= 5),
        key=lambda x: len(x[0]),
        reverse=True,
    )
    low = blob.lower()
    for co, tk in pairs:
        if _company_name_in_text(blob, co):
            return tk
        co_l = co.lower()
        if co_l in low:
            return tk
        # Drop Inc./Corp. suffix and retry
        core = re.sub(
            r"\b(inc\.?|corp\.?|ltd\.?|llc|plc|therapeutics|pharmaceuticals|pharma)\b",
            "",
            co_l,
            flags=re.I,
        )
        core = re.sub(r"\s+", " ", core).strip(" ,.-")
        if len(core) >= 5 and core in low:
            return tk
        first = (co.split() or [""])[0]
        if len(first) >= 6 and first.lower() in low:
            return tk
    return None


def _universe_tickers() -> list[str]:
    try:
        from catalyst_desk_cache import desk_hot_tickers

        tickers = desk_hot_tickers()
    except Exception:
        tickers = []
    if not tickers:
        tickers = list(_company_map().keys())
    interest: list[str] = []
    try:
        from catalyst_interest import list_interest_entries

        for e in list_interest_entries():
            tk = str(e.get("ticker") or "").strip().upper()
            if tk:
                interest.append(tk)
    except Exception:
        pass
    return list(dict.fromkeys([*interest, *tickers]))[:_MAX_TICKERS]


def _fetch_company_news(ticker: str, company: str) -> list[dict[str, Any]]:
    """Search: latest news / press release from the company."""
    from press_release_fetch import _fetch_google_news_rss

    tk = ticker.strip().upper()
    co = (company or tk).strip()
    # Common-word tickers (KIDS) must not OR the English word into Google News.
    if _is_ambiguous_ticker(tk) and co.upper() != tk:
        query = (
            f'("{co}") ("press release" OR "latest news" OR "corporate update" '
            f"OR NASDAQ OR NYSE OR stock) when:1d"
        )
    else:
        query = (
            f'("{co}" OR "{tk}") ("press release" OR "latest news" OR "corporate update" OR biotech) when:1d'
        )
    raw = _fetch_google_news_rss(query, max_items=_MAX_ITEMS_PER_TICKER * 3)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in raw:
        title = str(it.get("title") or "").strip()
        if not title:
            continue
        if not _blob_mentions_ticker(title, str(it.get("summary") or ""), tk, co):
            continue
        key = title[:60].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
        if len(out) >= _MAX_ITEMS_PER_TICKER:
            break
    return out


def _item_eis_score(it: dict[str, Any]) -> float | None:
    try:
        if it.get("eis_score") is not None:
            return float(it.get("eis_score"))
    except (TypeError, ValueError):
        pass
    eis = it.get("eis")
    if isinstance(eis, dict) and eis.get("score") is not None:
        try:
            return float(eis.get("score"))
        except (TypeError, ValueError):
            return None
    return None


def _build_highlights(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Rest-universe Daily News: every staged headline still on the desk
    (same-day / not migrated). Sorted by |EIS| then recency — no ±extreme trim.
    One row per ticker+day+event family so the same story is not queued twice.
    """
    staged: list[dict[str, Any]] = []
    for i in items:
        if not isinstance(i, dict):
            continue
        if i.get("status") != "staged" or i.get("dismissed"):
            continue
        if str(i.get("status") or "").strip().lower() == "migrated":
            continue
        if not _row_ticker_is_grounded(i):
            continue
        staged.append(i)
    return _dedupe_desk_rows(staged)[:_HIGHLIGHT_LIMIT]


def load_daily_news() -> dict[str, Any]:
    doc = _read()
    today = _rome_date()
    items_raw = list(doc.get("items") or [])
    # Age-prune staged+migrated history; migrated rows stay for counts but leave the box.
    items = _filter_desk_fresh(items_raw, today=today, active_only=False)
    items = [
        i
        for i in items
        if not (
            isinstance(i, dict)
            and i.get("status") == "staged"
            and not i.get("dismissed")
            and not _row_ticker_is_grounded(i)
        )
    ]
    # Always re-rank rest headlines from current staged items (full list).
    highlights = _build_highlights(items)
    doc["highlights"] = highlights
    top_news = _dedupe_desk_rows(
        _filter_desk_fresh(doc.get(_TOP_NEWS_CACHE_KEY), today=today, active_only=True),
        doc=doc,
        today=today,
    )
    # Hourly Top cache can freeze an unscored RSS title while a later staged
    # row for the same ★ ticker already has taxonomy scores — merge + keep |EIS|.
    prio_tickers = [
        str(t).strip().upper()
        for t in (doc.get("top_news_tickers") or [])
        if str(t).strip()
    ]
    if prio_tickers:
        merged_top = list(top_news)
        merged_top.extend(
            r
            for r in _staged_rows_for_top_tickers(doc, prio_tickers)
            if _row_visible_on_desk(r, today=today)
        )
        top_news = _dedupe_desk_rows(merged_top, doc=doc, today=today)
    top_news = [r for r in top_news if _row_ticker_is_grounded(r)]
    analyses = _filter_desk_fresh(doc.get(_USER_ANALYSES_KEY), today=today, active_only=True)
    cached_top = [r for r in (doc.get(_TOP_NEWS_CACHE_KEY) or []) if isinstance(r, dict)]
    # Persist prune when cache still holds prior-day Top / Manual / staged.
    prune_dirty = (
        len(items) != len([i for i in items_raw if isinstance(i, dict)])
        or [r.get("id") for r in top_news] != [r.get("id") for r in cached_top]
        or len(analyses)
        != len([r for r in (doc.get(_USER_ANALYSES_KEY) or []) if isinstance(r, dict)])
    )
    if prune_dirty:
        doc["items"] = items
        doc[_TOP_NEWS_CACHE_KEY] = top_news
        doc[_USER_ANALYSES_KEY] = analyses
        doc["rome_date"] = today
        doc["updated_at"] = _now_iso()
        try:
            _write(doc)
        except Exception:
            pass
    # Backfill ticker on Manual news so Migrate → EIS includes them
    analyses_dirty = False
    for a in analyses:
        if not isinstance(a, dict) or a.get("dismissed"):
            continue
        if not a.get("ticker"):
            tk = _infer_ticker_from_text(
                " ".join(
                    str(a.get(k) or "")
                    for k in (
                        "summary_10w",
                        "summary_long",
                        "source_excerpt",
                        "source_label",
                        "source_ref",
                    )
                )
            )
            if tk:
                a["ticker"] = tk
                analyses_dirty = True
        # Re-score with taxonomy when audit payload is missing (legacy cache)
        if not isinstance(a.get("taxonomy_dimensions"), dict):
            blob = " ".join(
                str(a.get(k) or "")
                for k in (
                    "summary_10w",
                    "summary_long",
                    "source_excerpt",
                    "abstract",
                    "results_note",
                    "title",
                )
            )
            dims = _dimension_scores(
                str(a.get("summary_10w") or a.get("title") or ""),
                blob,
                use_ai=False,
            )
            for k, v in dims.items():
                if k.startswith("taxonomy_"):
                    a[k] = v
                elif a.get(k) is None:
                    a[k] = v
            analyses_dirty = True
        if a.get("is_paper") is None and (
            str(a.get("source_kind") or "") == "pdf"
            or _looks_like_academic_paper(
                " ".join(
                    str(a.get(k) or "")
                    for k in ("summary_long", "source_excerpt", "abstract")
                )
            )
        ):
            a["is_paper"] = True
            analyses_dirty = True
        # Upgrade thin Manual digests to structured investor briefs (once per digest_v)
        # v3: richer paper AI + recover analyses with empty source_excerpt
        if int(a.get("digest_v") or 0) < 4:
            body_up = str(a.get("source_excerpt") or "").strip()
            if len(body_up) < 80:
                body_up = "\n".join(
                    str(a.get(k) or "").strip()
                    for k in (
                        "summary_10w",
                        "summary_long",
                        "results_note",
                        "abstract",
                    )
                    if str(a.get(k) or "").strip()
                ).strip()
            # Still thin → try to fetch the real PR from the headline
            if len(body_up) < 120 and str(a.get("summary_10w") or "").strip():
                try:
                    richer, found_url, _e = _enrich_thin_news_body(
                        title=str(a.get("summary_10w") or "")[:160],
                        ticker=str(a.get("ticker") or ""),
                        body=body_up,
                    )
                    if richer and len(richer) > len(body_up) + 40:
                        body_up = richer
                        if found_url and not str(a.get("source_ref") or "").startswith(
                            "http"
                        ):
                            a["source_ref"] = found_url
                        if not a.get("source_excerpt") or len(
                            str(a.get("source_excerpt") or "")
                        ) < 200:
                            a["source_excerpt"] = _clean_fetched_text(richer)[:8000]
                except Exception:
                    pass
            if len(body_up) >= 60:
                try:
                    dig = _build_investor_digest(
                        title=str(
                            a.get("summary_10w") or a.get("summary_long") or "Manual"
                        )[:200],
                        body=body_up,
                        url=str(a.get("source_ref") or "")
                        if str(a.get("source_ref") or "").startswith("http")
                        else "",
                        ticker=str(a.get("ticker") or ""),
                        is_paper=bool(
                            a.get("is_paper")
                            or str(a.get("source_kind") or "") == "pdf"
                        ),
                        abstract=a.get("abstract")
                        if isinstance(a.get("abstract"), str)
                        else None,
                        section_summaries=a.get("section_summaries")
                        if isinstance(a.get("section_summaries"), list)
                        else None,
                        product=a.get("product")
                        if isinstance(a.get("product"), str)
                        else None,
                        study=a.get("study")
                        if isinstance(a.get("study"), str)
                        else None,
                        phase=a.get("phase")
                        if isinstance(a.get("phase"), str)
                        else None,
                    )
                    a.update(_merge_investor_digest_into_row(a, dig))
                    a["digest_v"] = 4
                    analyses_dirty = True
                except Exception as exc:
                    logger.debug("Manual digest upgrade failed: %s", exc)
                    a["digest_v"] = 4  # avoid retry loop on hard failures
                    analyses_dirty = True
            else:
                a["digest_v"] = 4
                analyses_dirty = True
    if analyses_dirty:
        doc[_USER_ANALYSES_KEY] = analyses
        try:
            _write(doc)
        except Exception:
            pass
    # Backfill Clin/Fin/Access for older cached headlines
    highlights = [
        _attach_cached_brief_for_desk(
            _ensure_published_at(_merge_dimension_scores(h)), doc
        )
        for h in highlights
        if isinstance(h, dict) and _row_is_active_on_desk(h)
    ]
    top_news = [
        _attach_cached_brief_for_desk(
            _ensure_published_at(_merge_dimension_scores(h)), doc
        )
        for h in top_news
        if isinstance(h, dict) and _row_is_active_on_desk(h)
    ]
    analyses = [
        _ensure_published_at(a)
        for a in analyses
        if isinstance(a, dict) and _row_is_active_on_desk(a)
    ]
    return {
        "updated_at": doc.get("updated_at"),
        "rome_date": doc.get("rome_date") or _rome_date(),
        "last_search_at": doc.get("last_search_at"),
        "last_search_hour": doc.get("last_search_hour"),
        "hour_bucket": doc.get("hour_bucket"),
        "count": len([i for i in items if i.get("status") == "staged"]),
        "migrated_count": len([i for i in items if i.get("status") == "migrated"]),
        "highlights": highlights,
        "items": items,
        "top_news": top_news,
        "top_news_updated_at": doc.get("top_news_updated_at"),
        "top_news_tickers": doc.get("top_news_tickers") or [],
        "user_analyses": analyses,
        "eis_abs_min": _HIGHLIGHT_EIS_ABS_MIN,
        "last_migrate_at": doc.get("last_migrate_at"),
        "staged_count": len([i for i in items if i.get("status") == "staged"]),
    }


def migrate_expired_hourly_news(*, now: datetime | None = None) -> dict[str, Any]:
    """
    Deprecated auto path — Daily News → Deep Dive EIS is manual only
    (POST /api/market/daily-news/migrate from the Daily News box).
    Kept as a no-op so schedulers/old callers do not push EIS without the user.
    """
    _ = now
    return {
        "migrated": 0,
        "skipped": True,
        "reason": "manual_only",
        "hint": "Use migrate_daily_news_to_eis / Daily News Migrate to EIS",
    }


def _clinical_snapshot_tools():
    from clinical_pre_cd_enrichment import (
        _SNAPSHOT_PATH,
        _merge_clinical_events,
        annotate_events_reference_verification,
    )

    return _SNAPSHOT_PATH, _merge_clinical_events, annotate_events_reference_verification


def _finite_score(v: Any) -> float | None:
    try:
        if v is None:
            return None
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n and abs(n) != float("inf") else None


def _daily_news_migrate_lane(it: dict[str, Any]) -> str:
    """
    Route Daily News migrate:
      - scientific papers → clinical cache (UI: Scientific Publications session)
      - clinical press / trial → Clinical News session
      - financial / M&A / litigation / SEC → Financial dossier
    Prefer explicit news_kind / taxonomy hits, then score magnitude, then SEC source.
    """
    # Papers always land on Clinical tab feed with is_paper — UI routes them to
    # Scientific Publications (not Clinical News).
    if bool(it.get("is_paper")):
        return "clinical"
    sk0 = str(it.get("source_kind") or it.get("source") or "").strip().lower()
    if sk0 in {"pdf", "pubmed", "publication"}:
        it["is_paper"] = True
        return "clinical"
    link0 = str(it.get("resolved_link") or it.get("link") or it.get("source_ref") or "").lower()
    if any(x in link0 for x in ("pubmed.ncbi", "doi.org", "pmc.ncbi")):
        it["is_paper"] = True
        return "clinical"

    kind = str(it.get("news_kind") or "").strip().lower()
    if kind == "clinical":
        return "clinical"
    if kind in {"financial", "ma", "litigation"}:
        return "financial"

    tdims = it.get("taxonomy_dimensions")
    if isinstance(tdims, dict):
        fin_hit = bool((tdims.get("financial") or {}).get("event_id")) if isinstance(tdims.get("financial"), dict) else False
        clin_hit = bool((tdims.get("clinical") or {}).get("event_id")) if isinstance(tdims.get("clinical"), dict) else False
        corp_hit = bool((tdims.get("corporate") or {}).get("event_id")) if isinstance(tdims.get("corporate"), dict) else False
        acc_hit = (
            bool((tdims.get("market_access") or {}).get("event_id"))
            if isinstance(tdims.get("market_access"), dict)
            else False
        )
        if clin_hit and not fin_hit and not corp_hit:
            return "clinical"
        if (fin_hit or corp_hit) and not clin_hit:
            return "financial"
        if clin_hit and (fin_hit or corp_hit):
            # Dual hit: prefer the larger absolute dimension score.
            pass
        if acc_hit and not clin_hit and not fin_hit:
            return "clinical"

    fin = _finite_score(it.get("financial_score"))
    clin = _finite_score(it.get("clinical_score"))
    corp = _finite_score(it.get("corporate_score"))
    if fin is not None or clin is not None or corp is not None:
        fa = abs(fin or 0.0)
        ca = abs(clin or 0.0)
        oa = abs(corp or 0.0)
        if ca > fa + 0.05 and ca >= oa:
            return "clinical"
        if fa > ca + 0.05 or oa > ca + 0.05:
            return "financial"

    sk = str(it.get("source_kind") or it.get("source") or "").strip().lower()
    if any(x in sk for x in ("8-k", "8k", "sec", "edgar", "6-k", "6k", "424b", "def 14")):
        return "financial"

    # Biotech desk default: press / trial-like → Clinical
    return "clinical"


def _cap_summary_words(text: str, max_words: int = 65) -> str:
    words = re.findall(r"\S+", (text or "").strip())
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).rstrip(",;:") + "…"


def _item_to_financial_filing(
    it: dict[str, Any],
    *,
    default_date: str,
) -> dict[str, Any] | None:
    """Build a Financial-tab dossier card from a Daily News / Top / Manual row."""
    tk = str(it.get("ticker") or "").strip().upper()
    title = str(
        it.get("title")
        or it.get("summary_10w")
        or it.get("summary_long")
        or "Daily News"
    ).strip()
    if not title:
        return None
    summary = _cap_summary_words(
        str(
            it.get("detail_summary")
            or it.get("abstract")
            or it.get("summary")
            or it.get("results_note")
            or it.get("summary_long")
            or it.get("market_access_notes")
            or title
        ).strip()
    )
    pub = str(it.get("published_at") or "").strip()[:10]
    if re.match(r"^\d{4}-\d{2}-\d{2}$", pub):
        day = pub
    else:
        day = default_date
    nid = str(it.get("id") or "").strip()
    link = str(
        it.get("resolved_link") or it.get("link") or it.get("source_ref") or ""
    ).strip()
    cluster = _story_cluster_key(ticker=tk, title=title, day=day)
    eis = it.get("eis") if isinstance(it.get("eis"), dict) else {}
    eis_score = _finite_score(it.get("eis_score"))
    if eis_score is None:
        eis_score = _finite_score(eis.get("score"))
    return {
        "filing_date": day,
        "event_date": day,
        "form": "News",
        "title": title[:240],
        "link": link or None,
        "items_raw": "DN",
        "sessions": [
            {
                "item": "DN",
                "item_title": "Daily News",
                "title": title[:160],
                "summary": summary or title[:220],
            }
        ],
        "financial_score": _finite_score(it.get("financial_score")),
        "clinical_score": _finite_score(it.get("clinical_score")),
        "corporate_score": _finite_score(it.get("corporate_score")),
        "eis_score": eis_score,
        "news_kind": str(it.get("news_kind") or "financial"),
        "digest_method": "daily_news_migrate",
        "classification_method": it.get("taxonomy_method") or "daily_news",
        "_from_daily_news": True,
        "_daily_news_id": nid or None,
        "_daily_news_cluster": cluster,
    }


def _strip_daily_news_from_clinical_records(
    records: list[dict[str, Any]],
    *,
    ticker: str,
    daily_news_id: str = "",
    cluster: str = "",
) -> int:
    """Remove a Daily News event from clinical_events (wrong-lane cleanup)."""
    tk = (ticker or "").strip().upper()
    nid = str(daily_news_id or "").strip()
    cl = str(cluster or "").strip()
    if not tk or (not nid and not cl):
        return 0
    removed = 0
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if str(rec.get("ticker") or "").strip().upper() != tk:
            continue
        for key in ("clinical_events", "timeline_events"):
            prev = list(rec.get(key) or [])
            if not prev:
                continue
            kept: list[Any] = []
            for ev in prev:
                if not isinstance(ev, dict):
                    kept.append(ev)
                    continue
                if nid and str(ev.get("_daily_news_id") or "") == nid:
                    removed += 1
                    continue
                if cl and str(ev.get("_daily_news_cluster") or "") == cl:
                    removed += 1
                    continue
                kept.append(ev)
            rec[key] = kept
    return removed


def _item_to_eis_event(
    it: dict[str, Any],
    *,
    default_date: str,
    pending: bool = False,
) -> dict[str, Any] | None:
    tk = str(it.get("ticker") or "").strip().upper()
    title = str(
        it.get("title")
        or it.get("summary_10w")
        or it.get("summary_long")
        or ""
    ).strip()
    if not tk or not title:
        return None
    iso = str(it.get("event_date") or default_date)[:10]
    # Market EIS is filled later at 12h/24h/36h after publish — never copy
    # Daily News taxonomy / thermometer score into eis.score (that is Clin/Fin/Acc).
    eis_raw = it.get("eis") if isinstance(it.get("eis"), dict) else {}
    try:
        sent = float(eis_raw.get("sentiment") or 0)
    except (TypeError, ValueError):
        sent = 0.0
    eis: dict[str, Any] = {"sentiment": sent, "horizons": {}}
    source_kind = str(it.get("source_kind") or it.get("source") or "press")
    # Prefer Daily News investor digest when present (same engine as Brief modal).
    summary = str(
        it.get("detail_summary")
        or it.get("abstract")
        or it.get("summary")
        or it.get("results_note")
        or it.get("summary_long")
        or it.get("market_access_notes")
        or ""
    ).strip()
    nid = str(it.get("id") or "").strip()
    # Prefer calendar publish day for Volume vs EIS dots (not a future catalyst).
    pub = str(it.get("published_at") or "").strip()[:10]
    if re.match(r"^\d{4}-\d{2}-\d{2}$", pub):
        iso = pub
    pub_full = str(it.get("published_at") or "").strip() or None
    is_paper = bool(it.get("is_paper") or source_kind in {"pdf", "pubmed", "publication"})
    abstract_out = str(it.get("abstract") or "").strip()[:3500] or None
    section_out = (
        it.get("section_summaries")
        if isinstance(it.get("section_summaries"), list)
        else None
    )
    link_out = str(
        it.get("resolved_link")
        or it.get("link")
        or it.get("source_ref")
        or ""
    )
    # PubMed URL without stored abstract → copy AbstractText from eutils once at migrate.
    if (is_paper or _pmid_from_url(link_out)) and _pmid_from_url(link_out) and (
        not abstract_out or not section_out
    ):
        seed = _fetch_pubmed_brief_seed(link_out)
        if seed:
            if not abstract_out:
                abstract_out = str(seed.get("abstract") or "")[:3500] or None
            if not section_out and seed.get("section_summaries"):
                section_out = seed["section_summaries"]
            is_paper = True
            pub_iso = str(seed.get("pub_date") or "").strip()
            if re.match(r"^\d{4}-\d{2}-\d{2}$", pub_iso):
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", iso or ""):
                    iso = pub_iso
                if not pub_full:
                    pub_full = pub_iso
            if seed.get("title") and (
                not title or _looks_like_nav_chrome(title) or len(title) < 24
            ):
                title = str(seed["title"])[:160]
            if abstract_out and (
                not summary or summary == title or len(summary) < 80
            ):
                summary = abstract_out[:2200]

    is_fda = source_kind in {"fda_briefing", "fda_adcom"} or str(
        it.get("digest_method") or ""
    ).strip().lower() in {"fda_briefing", "fda_adcom"}
    if is_fda:
        src = "fda_briefing"
        link_label = "FDA Briefing"
        impact = (
            "FDA Briefings session · Clinical tab / product summary "
            "(market EIS at 12h / 24h / 36h pending)"
            if not pending
            else "FDA Briefings (pending migrate) · EIS 12/24/36h later"
        )
        ref_match = "fda_briefing"
    elif is_paper:
        src = "publication"
        link_label = "Daily News (pending)" if pending else "Daily News"
        impact = (
            "Daily News desk → clinical cache (pre-migrate)"
            if pending
            else "Daily News desk → company EIS (manual migrate)"
        )
        ref_match = "daily_news"
    elif source_kind == "pdf":
        src = "pdf"
        link_label = "Daily News (pending)" if pending else "Daily News"
        impact = (
            "Daily News desk → clinical cache (pre-migrate)"
            if pending
            else "Daily News desk → company EIS (manual migrate)"
        )
        ref_match = "daily_news"
    elif "8" in source_kind:
        src = "sec_8k"
        link_label = "Daily News (pending)" if pending else "Daily News"
        impact = (
            "Daily News desk → clinical cache (pre-migrate)"
            if pending
            else "Daily News desk → company EIS (manual migrate)"
        )
        ref_match = "daily_news"
    else:
        src = "press_release"
        link_label = "Daily News (pending)" if pending else "Daily News"
        impact = (
            "Daily News desk → clinical cache (pre-migrate)"
            if pending
            else "Daily News desk → company EIS (manual migrate)"
        )
        ref_match = "daily_news"

    out: dict[str, Any] = {
        "event_date": iso,
        "published_at": pub_full,
        "event_title": title[:160],
        "summary": summary[:2200],
        "drug": str(it.get("product") or "—")[:80] or "—",
        "asset": str(it.get("study") or "—")[:80] or "—",
        "phase": str(it.get("phase") or "")[:40] or None,
        "source_type": src,
        "event_type": src,
        "link": link_out,
        "link_label": link_label,
        "sentiment": sent,
        "impact_note": impact,
        "_from_daily_news": True,
        "_from_press_fetch": True,
        "_daily_news_pending": bool(pending),
        "_daily_news_id": nid or None,
        "_daily_news_cluster": _story_cluster_key(
            ticker=tk,
            title=title,
            day=iso,
        ),
        "reference_verified": True,
        "reference_match": ref_match,
        "eis": eis,
        "eis_score": None,
        "clinical_score": it.get("clinical_score"),
        "financial_score": it.get("financial_score"),
        "corporate_score": it.get("corporate_score"),
        "market_access_score": it.get("market_access_score"),
        "taxonomy_dimensions": it.get("taxonomy_dimensions"),
        "taxonomy_review_flags": it.get("taxonomy_review_flags"),
        "taxonomy_audit": it.get("taxonomy_audit"),
        "abstract": abstract_out,
        "section_summaries": section_out,
        "is_paper": False if is_fda else bool(
            is_paper or source_kind in {"pdf", "pubmed", "publication"}
        ),
        "company_affiliated": bool(it.get("company_affiliated")),
        "investor_insight": (
            str(it.get("investor_insight") or "").strip()[:1200] or None
        ),
    }
    if is_fda:
        out["fda_adcom_id"] = str(it.get("fda_adcom_id") or "").strip() or None
        out["fda_stance"] = str(it.get("fda_stance") or "").strip() or None
        try:
            out["fda_score"] = (
                float(it["fda_score"]) if it.get("fda_score") is not None else None
            )
        except (TypeError, ValueError):
            out["fda_score"] = None
        out["eis_horizons_pending"] = ["12h", "24h", "36h"]
        if out.get("drug") in {None, "", "—"} and it.get("product"):
            out["drug"] = str(it.get("product"))[:80]
    return out


def _iter_desk_rows_for_clinical_cache(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Staged / Top / Manual analyses not yet migrated or dismissed."""
    rows: list[dict[str, Any]] = []
    for it in doc.get("items") or []:
        if not isinstance(it, dict):
            continue
        if it.get("status") != "staged" or it.get("dismissed"):
            continue
        rows.append(it)
    for it in doc.get(_TOP_NEWS_CACHE_KEY) or []:
        if not isinstance(it, dict) or it.get("migrated_to_eis") or it.get("dismissed"):
            continue
        rows.append(it)
    for it in doc.get(_USER_ANALYSES_KEY) or []:
        if not isinstance(it, dict) or it.get("migrated_to_eis") or it.get("dismissed"):
            continue
        row = dict(it)
        if not str(row.get("ticker") or "").strip():
            tk = _infer_ticker_from_text(
                " ".join(
                    str(row.get(k) or "")
                    for k in (
                        "summary_10w",
                        "summary_long",
                        "source_excerpt",
                        "source_label",
                        "source_ref",
                        "title",
                        "abstract",
                    )
                )
            )
            if tk:
                row["ticker"] = tk
        row.setdefault(
            "title",
            row.get("summary_long") or row.get("summary_10w") or "Manual news",
        )
        row.setdefault(
            "summary",
            row.get("abstract")
            or row.get("results_note")
            or row.get("summary_long")
            or "",
        )
        row.setdefault("link", row.get("source_ref"))
        rows.append(row)
    return rows


def cache_staged_daily_news_to_clinical(
    *,
    now: datetime | None = None,
    only_ids: set[str] | None = None,
) -> dict[str, Any]:
    """
    Push staged Daily News / Top / Manual analyses into the clinical pre-CD
    snapshot cache so Deep Dive can show them BEFORE Migrate → EIS.
    Does not mark rows migrated and does not write the guidance calendar
    (that remains Migrate's job).
    """
    rn = _rome_now(now)
    default_date = rn.date().isoformat()
    doc = _read()
    due = _iter_desk_rows_for_clinical_cache(doc)
    if only_ids:
        due = [it for it in due if str(it.get("id") or "") in only_ids]
    if not due:
        return {"ok": True, "cached": 0, "reason": "nothing_to_cache"}

    try:
        _SNAPSHOT_PATH, _merge_clinical_events, annotate_events_reference_verification = (
            _clinical_snapshot_tools()
        )
    except Exception as exc:
        logger.debug("Daily news clinical cache: tools unavailable: %s", exc)
        return {"ok": False, "cached": 0, "error": str(exc)}

    if not _SNAPSHOT_PATH.is_file():
        return {"ok": False, "cached": 0, "error": "no_clinical_snapshot"}

    try:
        snap = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"ok": False, "cached": 0, "error": str(exc)}

    records = list(snap.get("records") or [])
    by_ticker: dict[str, list[dict[str, Any]]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        tk = str(rec.get("ticker") or "").strip().upper()
        if tk:
            by_ticker.setdefault(tk, []).append(rec)

    cached_n = 0
    skipped_no_record = 0
    for it in due:
        if not str(it.get("ticker") or "").strip():
            inferred = _infer_ticker_from_text(
                " ".join(
                    str(it.get(k) or "")
                    for k in (
                        "title",
                        "summary_10w",
                        "summary_long",
                        "source_excerpt",
                        "summary",
                        "abstract",
                    )
                )
            )
            if inferred:
                it["ticker"] = inferred
        event = _item_to_eis_event(it, default_date=default_date, pending=True)
        if not event:
            continue
        if _daily_news_migrate_lane(it) == "financial":
            # Financial-lane rows belong on the Financial tab — never pre-cache into Clinical.
            continue
        tk = str(it.get("ticker") or "").strip().upper()
        company = str(it.get("company") or tk)
        targets = _ensure_daily_news_clinical_stub(
            ticker=tk,
            company=company,
            records=records,
            by_ticker=by_ticker,
        )
        if not targets:
            skipped_no_record += 1
            continue
        try:
            annotated = annotate_events_reference_verification(
                [event],
                company=company,
                ticker=tk,
                drug_tokens=[],
                expected_nct_id=None,
            )
            if annotated:
                event = annotated[0]
                event["reference_verified"] = True
                event["reference_match"] = event.get("reference_match") or "daily_news"
                event["_daily_news_pending"] = True
                event["_daily_news_id"] = event.get("_daily_news_id") or it.get("id")
        except Exception:
            pass
        event["reference_verified"] = True
        event["reference_match"] = "daily_news"
        event["_from_daily_news"] = True
        event["_daily_news_pending"] = True
        nid = str(event.get("_daily_news_id") or "")
        for rec in targets:
            prev = list(rec.get("clinical_events") or [])
            if nid:
                prev = [
                    ev
                    for ev in prev
                    if not (
                        isinstance(ev, dict)
                        and str(ev.get("_daily_news_id") or "") == nid
                    )
                ]
            merged = _merge_clinical_events(prev, [event])
            rec["clinical_events"] = merged
            rec["timeline_events"] = merged
        cached_n += 1
        it["cached_to_clinical"] = True
        it["cached_to_clinical_at"] = _now_iso()

    if cached_n:
        snap["updated_at"] = _now_iso()
        snap["count"] = len(records)
        snap["records"] = records
        try:
            import os

            tmp = _SNAPSHOT_PATH.with_suffix(".json.tmp")
            tmp.write_text(
                json.dumps(snap, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            os.replace(str(tmp), str(_SNAPSHOT_PATH))
        except Exception as exc:
            logger.warning("Daily news clinical cache write failed: %s", exc)
            return {"ok": False, "cached": 0, "error": str(exc)}
        # Persist cached flags on desk rows
        doc["updated_at"] = _now_iso()
        _write(doc)

    logger.info(
        "Daily news → clinical cache (pre-migrate): %s cached, %s no clinical record",
        cached_n,
        skipped_no_record,
    )
    return {
        "ok": True,
        "cached": cached_n,
        "skipped_no_record": skipped_no_record,
    }


_MONTH_MAP = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _classify_news_catalyst_type(blob: str, *, title: str = "") -> str:
    # Title wins: "heads to … conference" must not become readout because the
    # brief body mixed in unrelated Phase II journal text.
    head = str(title or "")
    if re.search(
        r"\b(conference|fireside|investor day|wainwright|jefferies|jpmorgan|"
        r"ash\b|asco\b|esmo\b)\b",
        head,
        re.I,
    ):
        return "conference"
    b = f"{head}\n{blob}".lower()
    if re.search(r"\b(pdufa|adcom|advisory committee)\b", b):
        return "pdufa" if "pdufa" in b else "fda_vote"
    if re.search(
        r"\b(phase\s*[i1-3]+|topline|readout|endpoint|efficacy|trial data)\b", b
    ):
        return "readout"
    if re.search(
        r"\b(conference|fireside|investor day|wainwright|jefferies|jpmorgan|"
        r"ash\b|asco\b|esmo\b|abstract)\b",
        b,
    ):
        return "conference"  # IR / conference → calendar + Deep Dive price markers
    if re.search(r"\b(approv|nda|bla|submission)\b", b):
        return "submission" if re.search(r"\b(nda|bla|submi)\b", b) else "approval"
    return "other"


def _hydrate_news_item_from_brief(
    it: dict[str, Any], doc: dict[str, Any] | None = None
) -> dict[str, Any]:
    """
    Merge cached News Brief dates / lede onto a desk row before EIS migrate.
    Top News rows often lack `dates` until the brief was opened once.
    """
    out = dict(it)
    fp = str(out.get("article_fp") or "").strip()
    if not fp:
        fp = _article_fingerprint(
            ticker=str(out.get("ticker") or ""),
            title=str(out.get("title") or out.get("summary_10w") or ""),
            url=str(out.get("link") or out.get("source_ref") or ""),
            item_id=str(out.get("id") or ""),
        )
    brief = _brief_cache_get(fp, doc) if fp else None
    if isinstance(brief, dict):
        # Prefer brief dates when the row has none
        row_dates = out.get("dates") if isinstance(out.get("dates"), list) else []
        brief_dates = brief.get("dates") if isinstance(brief.get("dates"), list) else []
        if brief_dates and (not row_dates or len(row_dates) < len(brief_dates)):
            out["dates"] = brief_dates
        ds = str(brief.get("detail_summary") or "").strip()
        title_l = str(out.get("title") or out.get("summary_10w") or "").lower()
        looks_conf = bool(
            re.search(
                r"\b(conference|fireside|wainwright|jefferies|investor\s+day|jpmorgan)\b",
                title_l,
                re.I,
            )
        )
        polluted_clinical = bool(
            looks_conf
            and ds
            and not re.search(
                r"\b(conference|fireside|wainwright|jefferies|investor\s+day)\b",
                ds,
                re.I,
            )
            and re.search(
                r"\b(phase\s*[i1-3]|topline|endpoint|journal of the|pericarditis)\b",
                ds,
                re.I,
            )
        )
        if (
            ds
            and not polluted_clinical
            and len(ds) > len(str(out.get("summary") or "").strip())
        ):
            out["summary"] = ds[:2000]
        if (
            not polluted_clinical
            and not str(out.get("detail_summary") or "").strip()
            and ds
        ):
            out["detail_summary"] = ds[:2200]
        for k in ("product", "study", "phase", "indication", "news_kind"):
            if not out.get(k) and brief.get(k):
                out[k] = brief.get(k)
        krs = brief.get("key_results")
        if isinstance(krs, list) and krs and not out.get("key_results"):
            out["key_results"] = krs
        kps = brief.get("key_points")
        if isinstance(kps, list) and kps and not out.get("key_points"):
            out["key_points"] = kps

    # Conference / fireside with no dates yet → one light fetch for calendar markers
    title_l = str(out.get("title") or out.get("summary_10w") or "").lower()
    needs_dates = not (out.get("dates") or [])
    looks_conf = bool(
        re.search(
            r"\b(conference|fireside|wainwright|jefferies|investor\s+day|jpmorgan)\b",
            title_l,
            re.I,
        )
    )
    if needs_dates and looks_conf:
        url = str(
            out.get("resolved_link") or out.get("link") or out.get("source_ref") or ""
        ).strip()
        if url.startswith("http"):
            try:
                # Not quick: Google News RSS links need unwrap → publisher page
                body, _err = _fetch_url_text(
                    url,
                    title_hint=str(out.get("title") or "")[:180] or None,
                    ticker_hint=str(out.get("ticker") or "") or None,
                    quick=False,
                )
            except Exception:
                body, _err = "", "fetch_failed"
            if body and len(body) > 120:
                mined = _extract_dates_from_article_text(
                    body[:12000],
                    title=str(out.get("title") or ""),
                )
                if mined:
                    out["dates"] = mined
                # Prefer article lede over thin RSS snippet for date mining
                if len(str(out.get("summary") or "")) < 200:
                    out["summary"] = (out.get("summary") or "") + "\n" + body[:2500]
    return out


def _news_item_text_blob(it: dict[str, Any]) -> str:
    """Title + summaries + brief dates/keypoints for catalyst date mining."""
    parts: list[str] = [
        str(it.get("title") or it.get("summary_10w") or ""),
        str(it.get("summary") or ""),
        str(it.get("detail_summary") or ""),
        str(it.get("summary_long") or ""),
        str(it.get("market_access_notes") or ""),
        str(it.get("abstract") or ""),
        str(it.get("results") or ""),
        str(it.get("results_note") or ""),
    ]
    for d in it.get("dates") or []:
        if isinstance(d, dict):
            parts.append(str(d.get("date") or ""))
            parts.append(str(d.get("what_happens") or ""))
    for kr in it.get("key_results") or []:
        if isinstance(kr, dict):
            parts.append(str(kr.get("label") or ""))
            parts.append(str(kr.get("detail") or ""))
        else:
            parts.append(str(kr))
    for p in it.get("key_points") or []:
        parts.append(str(p))
    return " ".join(p for p in parts if p).strip()


def _extract_catalyst_dates_from_news(
    it: dict[str, Any],
    *,
    future_only: bool = True,
    require_catalyst: bool = True,
) -> list[dict[str, Any]]:
    """
    Pull catalyst / conference dates from a Daily News item.

    Calendar inject (default): only **future** dates that match the catalyst
    benchmark (scheduled clinical/regulatory/etc.) or a scientific/business
    conference. Past publish-day noise and non-catalyst dates stay out.
    """
    title = str(it.get("title") or it.get("summary_10w") or "")
    blob = _news_item_text_blob(it)
    # Shelf / ATM / offering alone is not a calendar catalyst unless dated conference.
    financing_only = bool(
        re.search(r"\b(shelf|atm|offering|dilut|financ)\b", blob, re.I)
    ) and not re.search(
        r"\b(conference|fireside|pdufa|phase|readout|trial|approv)\b", blob, re.I
    )
    if financing_only:
        return []

    event_type = _classify_news_catalyst_type(blob, title=title)
    try:
        from catalyst_benchmark import is_calendar_catalyst

        catalyst_ok = is_calendar_catalyst(
            text=blob, event_type=event_type, timing_quote=title
        )
    except Exception:
        catalyst_ok = event_type not in {"other"}
    if require_catalyst and not catalyst_ok:
        return []

    found: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _push(start: str, end: str | None = None, *, label: str = "") -> None:
        if not re.match(r"^20\d{2}-\d{2}-\d{2}$", start):
            return
        try:
            from datetime import date as date_cls

            d0 = date_cls.fromisoformat(start)
            today = _rome_now().date()
            if future_only:
                # Strict: only today-or-future catalyst windows enter the calendar
                if d0 < today:
                    return
            elif d0 < today - timedelta(days=14):
                return
        except Exception:
            pass
        # Per-date catalyst check (quote may carry the real event)
        if require_catalyst:
            try:
                from catalyst_benchmark import is_calendar_catalyst

                if not is_calendar_catalyst(
                    text=blob,
                    event_type=event_type,
                    timing_quote=label or title,
                ):
                    return
            except Exception:
                pass
        key = f"{start}|{end or start}|{event_type}"
        if key in seen:
            return
        seen.add(key)
        found.append(
            {
                "window_start": start,
                "window_end": end or start,
                "event_type": event_type,
                "timing_quote": (label or title)[:240],
            }
        )

    # Structured brief dates first (highest quality)
    for d in it.get("catalyst_dates") or it.get("dates") or []:
        if not isinstance(d, dict):
            continue
        raw = str(d.get("date") or d.get("window_start") or "").strip()
        wh = str(d.get("what_happens") or d.get("timing_quote") or "").strip()
        # Range like "September 8-10, 2026"
        m_range = re.match(
            r"^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
            r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
            r"Dec(?:ember)?)\.?\s+(\d{1,2})\s*[-–—to]+\s*(\d{1,2}),?\s+(20\d{2})$",
            raw,
            re.I,
        )
        if m_range:
            mon = _MONTH_MAP.get(m_range.group(1).lower().rstrip("."), 0)
            if mon:
                y = int(m_range.group(4))
                _push(
                    f"{y:04d}-{mon:02d}-{int(m_range.group(2)):02d}",
                    f"{y:04d}-{mon:02d}-{int(m_range.group(3)):02d}",
                    label=wh or title[:160],
                )
                continue
        parsed = _coerce_date_token(raw)
        if parsed:
            _push(parsed[0], parsed[1], label=wh or title[:160])

    # Also mine article-style dates from the full blob (title + brief lede)
    for d in _extract_dates_from_article_text(blob, title=title):
        raw = str(d.get("date") or "").strip()
        wh = str(d.get("what_happens") or "").strip()
        m_range = re.match(
            r"^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
            r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
            r"Dec(?:ember)?)\.?\s+(\d{1,2})\s*[-–—to]+\s*(\d{1,2}),?\s+(20\d{2})$",
            raw,
            re.I,
        )
        if m_range:
            mon = _MONTH_MAP.get(m_range.group(1).lower().rstrip("."), 0)
            if mon:
                y = int(m_range.group(4))
                _push(
                    f"{y:04d}-{mon:02d}-{int(m_range.group(2)):02d}",
                    f"{y:04d}-{mon:02d}-{int(m_range.group(3)):02d}",
                    label=wh or title[:160],
                )
                continue
        parsed = _coerce_date_token(raw)
        if parsed:
            _push(parsed[0], parsed[1], label=wh or title[:160])

    # Publish-day fallback: never for conference/IR — only when we mined no date
    # and the story is a dated clinical/regulatory catalyst.
    if not found and event_type not in {"conference", "other"}:
        ed = str(it.get("event_date") or "")[:10]
        if re.match(r"^20\d{2}-\d{2}-\d{2}$", ed):
            _push(ed, label=title[:160])

    # Qx YYYY windows
    for m in re.finditer(r"\bQ([1-4])\s*(20\d{2})\b", blob, re.I):
        q, y = int(m.group(1)), int(m.group(2))
        start_m = (q - 1) * 3 + 1
        end_m = start_m + 2
        _push(
            f"{y:04d}-{start_m:02d}-01",
            f"{y:04d}-{end_m:02d}-28",
            label=f"Q{q} {y}: {title[:120]}",
        )

    return found[:4]


def _coerce_date_token(raw: str) -> tuple[str, str] | None:
    s = str(raw or "").strip()
    if not s:
        return None
    if re.match(r"^20\d{2}-\d{2}-\d{2}$", s[:10]):
        return s[:10], s[:10]
    m = re.match(
        r"^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})$",
        s,
        re.I,
    )
    if m:
        mon = _MONTH_MAP.get(m.group(1).lower().rstrip("."), 0)
        if mon:
            iso = f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(2)):02d}"
            return iso, iso
    m = re.match(r"^Q([1-4])\s*(20\d{2})$", s, re.I)
    if m:
        q, y = int(m.group(1)), int(m.group(2))
        start_m = (q - 1) * 3 + 1
        end_m = start_m + 2
        return f"{y:04d}-{start_m:02d}-01", f"{y:04d}-{end_m:02d}-28"
    return None


def _push_news_dates_to_calendar(it: dict[str, Any]) -> int:
    """
    Inject future catalyst / conference dates into guidance calendar.
    Does not wait for Migrate. Non-catalyst or past dates are skipped.
    """
    tk = str(it.get("ticker") or "").strip().upper()
    if not tk:
        return 0
    company = str(it.get("company") or tk)
    link = str(it.get("link") or it.get("source_ref") or "") or None
    n = 0
    try:
        from manual_catalyst_insert import inject_guidance_calendar_event
    except Exception as exc:
        logger.debug("calendar inject import failed: %s", exc)
        return 0
    for d in _extract_catalyst_dates_from_news(
        it, future_only=True, require_catalyst=True
    ):
        ok = inject_guidance_calendar_event(
            {
                "ticker": tk,
                "company": company,
                "event_type": d.get("event_type") or "other",
                "timing_quote": d.get("timing_quote") or "",
                "window_start": d["window_start"],
                "window_end": d.get("window_end") or d["window_start"],
                "source_type": "daily_news_auto",
                "source_date": _rome_date(),
                "estimation_method": "daily_news_catalyst_benchmark",
                "confidence": 0.7,
                "link": link,
                "_from_daily_news": True,
            }
        )
        if ok:
            n += 1
    return n


def dismiss_daily_news_item(
    *,
    item_id: str | None = None,
    ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    Close / hide a Daily News row without migrating to EIS.
    Marks staged items dismissed; Top / analyses get dismissed=True.
    """
    id_set = {
        str(x).strip()
        for x in ([item_id] if item_id else []) + list(ids or [])
        if str(x).strip()
    }
    if not id_set:
        return {"ok": False, "error": "id_required", "dismissed": 0}

    doc = _read()
    items = list(doc.get("items") or [])
    top_news = list(doc.get(_TOP_NEWS_CACHE_KEY) or [])
    analyses = list(doc.get(_USER_ANALYSES_KEY) or [])
    n = 0
    now = _now_iso()
    touched_fps: list[str] = []

    def _touch_dismiss(row: dict[str, Any]) -> None:
        fp = str(row.get("article_fp") or "").strip() or _article_fingerprint(
            ticker=str(row.get("ticker") or ""),
            title=str(row.get("title") or row.get("summary_10w") or ""),
            url=str(row.get("link") or row.get("source_ref") or ""),
            item_id=str(row.get("id") or ""),
        )
        if fp:
            touched_fps.append(fp)
            _brief_cache_delete(doc, fp)
        _mark_row_seen(doc, row, status="dismissed")

    for row in items:
        if not isinstance(row, dict):
            continue
        if str(row.get("id") or "") in id_set:
            row["status"] = "dismissed"
            row["dismissed_at"] = now
            _touch_dismiss(row)
            n += 1
    for row in top_news:
        if not isinstance(row, dict):
            continue
        if str(row.get("id") or "") in id_set:
            row["dismissed"] = True
            row["dismissed_at"] = now
            _touch_dismiss(row)
            n += 1
    for row in analyses:
        if not isinstance(row, dict):
            continue
        if str(row.get("id") or "") in id_set:
            row["dismissed"] = True
            row["dismissed_at"] = now
            _touch_dismiss(row)
            n += 1

    # Drop dismissed from Top cache so they stay gone after reload
    top_news = [
        r
        for r in top_news
        if isinstance(r, dict) and not r.get("dismissed")
    ]
    analyses = [
        r
        for r in analyses
        if isinstance(r, dict) and not r.get("dismissed")
    ]
    # Also drop dismissed staged items from the live list (keep trail short)
    items = [
        r
        for r in items
        if isinstance(r, dict) and r.get("status") != "dismissed"
    ]
    doc["items"] = items
    doc[_TOP_NEWS_CACHE_KEY] = top_news
    doc[_USER_ANALYSES_KEY] = analyses
    doc["highlights"] = _build_highlights(items)
    doc["updated_at"] = now
    _write(doc)
    out = load_daily_news()
    out["ok"] = True
    out["dismissed"] = n
    out["cleared_briefs"] = len(set(touched_fps))
    return out



def _ensure_daily_news_clinical_stub(
    *,
    ticker: str,
    company: str,
    records: list[dict[str, Any]],
    by_ticker: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """
    Attach Daily News EIS to an existing pre-CD card, or create a ticker stub so
    Volume vs EIS / Deep Dive can show the migrated event even without an NCT row.
    """
    tk = ticker.strip().upper()
    existing = by_ticker.get(tk) or []
    if existing:
        return existing
    stub: dict[str, Any] = {
        "ticker": tk,
        "company": (company or tk).strip() or tk,
        "nct_id": None,
        "cd_date": None,
        "sponsor_match": "exact",
        "clinical_events": [],
        "timeline_events": [],
        "meta": {
            "brief_title": f"{tk} — Daily News EIS",
            "lead_sponsor": (company or tk).strip() or tk,
        },
        "_daily_news_stub": True,
    }
    records.append(stub)
    by_ticker[tk] = [stub]
    return [stub]


def migrate_daily_news_to_eis(
    *,
    now: datetime | None = None,
    item_id: str | None = None,
    ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    Manual command: push staged Daily News (+ Top News + user analyses with ticker)
    into Deep Dive tabs:
      - clinical / trial → Clinical tab (pre-CD clinical_events)
      - financial / M&A / litigation / SEC → Financial tab (8-K dossier migrated_filings)
    Does not change Soft BUY/SELL.

    Optional ``item_id`` / ``ids`` limits the run to those Daily News rows
    (single-row Migrate button). Empty filter = migrate the full queue.
    """
    id_set = {
        str(x).strip()
        for x in ([item_id] if item_id else []) + list(ids or [])
        if str(x).strip()
    }
    rn = _rome_now(now)
    default_date = rn.date().isoformat()
    doc = _read()
    items = list(doc.get("items") or [])
    top_news = list(doc.get(_TOP_NEWS_CACHE_KEY) or [])
    analyses = list(doc.get(_USER_ANALYSES_KEY) or [])

    # Heal rows marked migrated in status but missing the desk flag — otherwise
    # clients that cache top_news keep showing Mig buttons that always 404.
    heal = False
    for bucket in (items, top_news, analyses):
        for it in bucket:
            if not isinstance(it, dict):
                continue
            st = str(it.get("status") or "").strip().lower()
            if st == "migrated" and not it.get("migrated_to_eis"):
                it["migrated_to_eis"] = True
                heal = True
            if it.get("migrated_to_eis") and st not in {"migrated", "dismissed"}:
                it["status"] = "migrated"
                heal = True
    if heal:
        doc["items"] = items
        doc[_TOP_NEWS_CACHE_KEY] = top_news
        doc[_USER_ANALYSES_KEY] = analyses
        try:
            _write(doc)
        except Exception:
            pass

    # Staged headlines waiting for the user migrate button.
    due: list[dict[str, Any]] = [
        it
        for it in items
        if isinstance(it, dict)
        and str(it.get("status") or "").strip().lower() == "staged"
        and not it.get("dismissed")
        and not it.get("migrated_to_eis")
    ]
    # Top News / analyses not yet marked migrated (Manual news always included).
    for it in top_news:
        if not isinstance(it, dict) or it.get("migrated_to_eis") or it.get("dismissed"):
            continue
        due.append(it)
    for it in analyses:
        if (
            not isinstance(it, dict)
            or it.get("migrated_to_eis")
            or it.get("dismissed")
        ):
            continue
        tk = str(it.get("ticker") or "").strip().upper()
        if not tk:
            tk = (
                _infer_ticker_from_text(
                    " ".join(
                        str(it.get(k) or "")
                        for k in (
                            "summary_10w",
                            "summary_long",
                            "source_excerpt",
                            "source_label",
                            "source_ref",
                            "title",
                        )
                    )
                )
                or ""
            )
            if tk:
                it["ticker"] = tk
        if not tk:
            # Still migrate calendar dates when possible; EIS card needs a ticker
            it.setdefault(
                "title",
                it.get("summary_long") or it.get("summary_10w") or "Manual news",
            )
            it.setdefault("link", it.get("source_ref"))
            due.append(it)
            continue
        it.setdefault(
            "title",
            it.get("summary_long") or it.get("summary_10w") or "Manual news",
        )
        it.setdefault(
            "summary",
            it.get("results_note")
            or it.get("summary_long")
            or it.get("market_access_notes")
            or "",
        )
        it.setdefault("link", it.get("source_ref"))
        due.append(it)

    if id_set:
        due = [it for it in due if str(it.get("id") or "").strip() in id_set]
        if not due:
            out = load_daily_news()
            out["ok"] = False
            out["migrated"] = 0
            out["error"] = "id_not_found"
            out["reason"] = "id_not_found"
            return out

    if not due:
        # Already-migrated Top/Manual: still push brief dates → calendar / price plot
        calendar_n = 0
        for it in list(top_news) + list(analyses):
            if not isinstance(it, dict) or it.get("dismissed"):
                continue
            if not (it.get("migrated_to_eis") or it.get("status") == "migrated"):
                continue
            hydrated = _hydrate_news_item_from_brief(it, doc)
            it.update(hydrated)
            calendar_n += _push_news_dates_to_calendar(it)
        if calendar_n:
            doc[_TOP_NEWS_CACHE_KEY] = top_news
            doc[_USER_ANALYSES_KEY] = analyses
            doc["updated_at"] = _now_iso()
            _write(doc)
            out = load_daily_news()
            out["ok"] = True
            out["migrated"] = 0
            out["calendar_dates"] = calendar_n
            out["skipped_no_record"] = 0
            out["reason"] = "calendar_backfill"
            return out
        out = load_daily_news()
        out["ok"] = True
        out["migrated"] = 0
        out["reason"] = "nothing_to_migrate"
        return out

    try:
        _SNAPSHOT_PATH, _merge_clinical_events, annotate_events_reference_verification = (
            _clinical_snapshot_tools()
        )
    except Exception as exc:
        logger.warning("Daily news migrate: cannot load clinical tools: %s", exc)
        return {"ok": False, "migrated": 0, "error": str(exc)}

    if not _SNAPSHOT_PATH.is_file():
        return {"ok": False, "migrated": 0, "error": "no_clinical_snapshot"}

    try:
        snap = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"ok": False, "migrated": 0, "error": str(exc)}

    records = list(snap.get("records") or [])
    by_ticker: dict[str, list[dict[str, Any]]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        tk = str(rec.get("ticker") or "").strip().upper()
        if tk:
            by_ticker.setdefault(tk, []).append(rec)

    migrated_n = 0
    calendar_n = 0
    skipped_no_record = 0
    item_ids = {str(i.get("id")) for i in items if isinstance(i, dict) and i.get("id")}
    migrated_clusters: set[str] = set()

    for it in due:
        # Ensure ticker for EIS attach (Manual rows may have been inferred above)
        if not str(it.get("ticker") or "").strip():
            inferred = _infer_ticker_from_text(
                " ".join(
                    str(it.get(k) or "")
                    for k in (
                        "title",
                        "summary_10w",
                        "summary_long",
                        "source_excerpt",
                        "summary",
                    )
                )
            )
            if inferred:
                it["ticker"] = inferred
        # Pull dates / lede from News Brief cache so conference days hit the calendar
        hydrated = _hydrate_news_item_from_brief(it, doc)
        it.update(hydrated)
        catalyst_dates = _extract_catalyst_dates_from_news(it)
        if catalyst_dates and not it.get("dates"):
            it["dates"] = [
                {
                    "date": d["window_start"],
                    "what_happens": d.get("timing_quote") or "",
                }
                for d in catalyst_dates
            ]
        # Catalyst dates go to the guidance calendar / price CD markers.
        # Keep EIS event_date = publish day so Volume vs EIS shows the news pallino.
        lane = _daily_news_migrate_lane(it)
        it["migrate_lane"] = lane
        event = _item_to_eis_event(it, default_date=default_date, pending=False)
        cluster = (
            str((event or {}).get("_daily_news_cluster") or "").strip()
            or _story_cluster_key(
                ticker=str(it.get("ticker") or ""),
                title=str(it.get("title") or it.get("summary_10w") or ""),
                day=_row_publication_day(it) or default_date,
            )
        )
        if cluster and cluster in migrated_clusters:
            it["migrated_to_eis"] = True
            it["migrated_at"] = _now_iso()
            it["migrated_duplicate"] = True
            _mark_row_seen(doc, it, status="migrated")
            migrated_n += 1
            continue
        if cluster:
            migrated_clusters.add(cluster)

        tk = str(it.get("ticker") or "").strip().upper()
        company = str(it.get("company") or tk)

        # ── Financial lane → Financial tab dossier (not clinical_events) ──
        if lane == "financial":
            filing = None
            link_fin = str(
                it.get("resolved_link") or it.get("link") or it.get("source_ref") or ""
            ).strip()
            # EDGAR URL → same digest as Financial Deep Dive (not thin DN stub).
            if tk and link_fin and _is_sec_edgar_archives_url(link_fin):
                try:
                    from ticker_8k_dossier import _digest_filing, upsert_edgar_filing

                    body_ed, _err_ed = _fetch_edgar_8k_text_from_url(link_fin)
                    if body_ed and len(body_ed.strip()) >= 80:
                        pub_d = str(it.get("published_at") or it.get("event_date") or default_date)[
                            :10
                        ]
                        if not re.match(r"^\d{4}-\d{2}-\d{2}$", pub_d):
                            pub_d = default_date
                        card = _digest_filing(
                            ticker=tk,
                            text=body_ed,
                            filing_date=pub_d,
                            url=link_fin,
                            form_type="8-K",
                        )
                        nid = str(it.get("id") or "").strip()
                        if nid:
                            card["_daily_news_id"] = nid
                        card["_daily_news_cluster"] = _story_cluster_key(
                            ticker=tk,
                            title=str(card.get("title") or it.get("title") or ""),
                            day=pub_d,
                        )
                        upsert_edgar_filing(ticker=tk, filing=card)
                        filing = card
                except Exception as exc:
                    logger.debug(
                        "Daily news financial EDGAR digest %s failed: %s", tk, exc
                    )
            if filing is None:
                filing = _item_to_financial_filing(it, default_date=default_date)
            if not filing and not tk:
                cal = _push_news_dates_to_calendar(it)
                if cal or it.get("source_kind") or it.get("summary_10w"):
                    calendar_n += cal
                    it["migrated_to_eis"] = True
                    it["migrated_at"] = _now_iso()
                    it["migrated_calendar_only"] = True
                    migrated_n += 1
                continue
            if filing and tk:
                try:
                    from ticker_8k_dossier import (
                        append_migrated_daily_news_filing,
                    )

                    # EDGAR cards already upserted above; press/M&A → migrated_filings.
                    already_edgar = bool(
                        link_fin
                        and _is_sec_edgar_archives_url(link_fin)
                        and str(filing.get("form") or "").upper() not in {"", "NEWS"}
                        and (filing.get("sessions") or [])
                    )
                    if not already_edgar:
                        append_migrated_daily_news_filing(ticker=tk, filing=filing)
                except Exception as exc:
                    logger.warning(
                        "Daily news financial migrate %s failed: %s", tk, exc
                    )
                # Wrong-lane cleanup: drop same story from Clinical if it was pre-cached.
                nid = str(filing.get("_daily_news_id") or it.get("id") or "")
                _strip_daily_news_from_clinical_records(
                    records,
                    ticker=tk,
                    daily_news_id=nid,
                    cluster=str(filing.get("_daily_news_cluster") or cluster or ""),
                )
            calendar_n += _push_news_dates_to_calendar(it)
            iid = str(it.get("id") or "")
            if iid and iid in item_ids:
                for row in items:
                    if str(row.get("id")) == iid:
                        row["status"] = "migrated"
                        row["migrated_at"] = _now_iso()
                        row["migrate_lane"] = "financial"
                        break
            else:
                it["migrated_to_eis"] = True
                it["migrated_at"] = _now_iso()
            it["migrated_to_eis"] = True
            it["migrate_lane"] = "financial"
            _mark_row_seen(doc, it, status="migrated")
            migrated_n += 1
            try:
                from catalyst_outcome_feed import resolve_from_migrated_news_row

                resolve_from_migrated_news_row(it)
            except Exception:
                pass
            continue

        # ── Clinical lane → Clinical tab (pre-CD clinical_events) ──
        if not event:
            # Manual news with dates but no ticker → calendar only
            cal = _push_news_dates_to_calendar(it)
            if cal or it.get("source_kind") or it.get("summary_10w"):
                calendar_n += cal
                it["migrated_to_eis"] = True
                it["migrated_at"] = _now_iso()
                it["migrated_calendar_only"] = True
                migrated_n += 1
            continue
        # Ensure clinical source_type (never mark clinical migrates as sec_8k).
        if str(event.get("source_type") or "").lower() in {"sec_8k", "sec"}:
            event["source_type"] = "press_release"
            event["event_type"] = "press_release"
        targets = _ensure_daily_news_clinical_stub(
            ticker=tk,
            company=company,
            records=records,
            by_ticker=by_ticker,
        )
        if not targets:
            skipped_no_record += 1
            calendar_n += _push_news_dates_to_calendar(it)
            iid = str(it.get("id") or "")
            if iid and iid in item_ids:
                for row in items:
                    if str(row.get("id")) == iid:
                        row["status"] = "migrated"
                        row["migrated_at"] = _now_iso()
                        row["migrated_calendar_only"] = True
                        break
            else:
                it["migrated_to_eis"] = True
                it["migrated_at"] = _now_iso()
                it["migrated_calendar_only"] = True
            migrated_n += 1
            continue
        try:
            annotated = annotate_events_reference_verification(
                [event],
                company=company,
                ticker=tk,
                drug_tokens=[],
                expected_nct_id=None,
            )
            if annotated:
                event = annotated[0]
                event["reference_verified"] = True
                event["reference_match"] = event.get("reference_match") or "daily_news"
        except Exception:
            pass
        event["_daily_news_pending"] = False
        event["link_label"] = "Daily News"
        event["impact_note"] = "Daily News desk → Clinical tab (manual migrate)"
        event["reference_verified"] = True
        event["reference_match"] = "daily_news"
        event["_from_daily_news"] = True
        event["news_kind"] = it.get("news_kind") or "clinical"

        nid = str(event.get("_daily_news_id") or it.get("id") or "")
        ncluster = str(event.get("_daily_news_cluster") or cluster or "")
        # Drop from Financial dossier if previously mis-routed.
        if tk and (nid or ncluster):
            try:
                from ticker_8k_dossier import remove_migrated_daily_news_from_financial

                remove_migrated_daily_news_from_financial(
                    ticker=tk,
                    daily_news_id=nid or None,
                    cluster=ncluster or None,
                )
            except Exception:
                pass
        for rec in targets:
            prev = list(rec.get("clinical_events") or [])
            if ncluster and any(
                isinstance(ev, dict)
                and str(ev.get("_daily_news_cluster") or "") == ncluster
                for ev in prev
            ):
                continue
            if nid:
                prev = [
                    ev
                    for ev in prev
                    if not (
                        isinstance(ev, dict)
                        and str(ev.get("_daily_news_id") or "") == nid
                    )
                ]
            merged = _merge_clinical_events(prev, [event])
            rec["clinical_events"] = merged
            rec["timeline_events"] = merged

        calendar_n += _push_news_dates_to_calendar(it)

        iid = str(it.get("id") or "")
        if iid and iid in item_ids:
            for row in items:
                if str(row.get("id")) == iid:
                    row["status"] = "migrated"
                    row["migrated_at"] = _now_iso()
                    row["migrate_lane"] = "clinical"
                    break
        else:
            it["migrated_to_eis"] = True
            it["migrated_at"] = _now_iso()
        it["migrate_lane"] = "clinical"
        _mark_row_seen(doc, it, status="migrated")
        migrated_n += 1
        try:
            from catalyst_outcome_feed import resolve_from_migrated_news_row

            resolve_from_migrated_news_row(it)
        except Exception:
            pass

    # Drop migrated rows from the desk (keep seen_articles so they never return).
    for it in due:
        if not isinstance(it, dict):
            continue
        if it.get("migrated_to_eis") or str(it.get("status") or "") == "migrated":
            _mark_row_seen(doc, it, status="migrated")
            try:
                from catalyst_outcome_feed import resolve_from_migrated_news_row

                resolve_from_migrated_news_row(it)
            except Exception:
                pass
    top_news = [
        r
        for r in top_news
        if isinstance(r, dict)
        and not r.get("migrated_to_eis")
        and not r.get("dismissed")
        and str(r.get("status") or "").lower() != "migrated"
    ]
    analyses = [
        r
        for r in analyses
        if isinstance(r, dict)
        and not r.get("migrated_to_eis")
        and not r.get("dismissed")
        and str(r.get("status") or "").lower() != "migrated"
    ]

    if migrated_n:
        snap["updated_at"] = _now_iso()
        snap["count"] = len(records)
        snap["records"] = records
        try:
            import os

            tmp = _SNAPSHOT_PATH.with_suffix(".json.tmp")
            tmp.write_text(
                json.dumps(snap, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            os.replace(str(tmp), str(_SNAPSHOT_PATH))
        except Exception as exc:
            logger.warning("Daily news migrate write failed: %s", exc)
            return {"ok": False, "migrated": 0, "error": str(exc)}

    doc["items"] = items
    doc[_TOP_NEWS_CACHE_KEY] = top_news
    doc[_USER_ANALYSES_KEY] = analyses
    doc["highlights"] = _build_highlights(items)
    doc["updated_at"] = _now_iso()
    doc["last_migrate_at"] = _now_iso()
    _write(doc)
    logger.info(
        "Daily news manual migrate → EIS: %s migrated, %s calendar dates, %s no clinical record",
        migrated_n,
        calendar_n,
        skipped_no_record,
    )
    out = load_daily_news()
    out["ok"] = True
    out["migrated"] = migrated_n
    out["calendar_dates"] = calendar_n
    out["skipped_no_record"] = skipped_no_record
    return out


def _normalize_priority_tickers(raw: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for t in raw or []:
        tk = str(t or "").strip().upper()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        out.append(tk)
        if len(out) >= _TOP_NEWS_TICKER_CAP:
            break
    return out


def _cik10_for_ticker(ticker: str) -> str | None:
    tk = ticker.strip().upper()
    if not tk:
        return None
    try:
        from edgar_silent_money import cik_for_ticker

        cik = cik_for_ticker(tk)
        if cik is not None:
            return f"{int(cik):010d}"
    except Exception:
        pass
    try:
        from catalyst_calendar import _ticker_cik_fallback

        m = _ticker_cik_fallback()
        raw = str(m.get(tk) or "").strip()
        if raw.isdigit():
            return f"{int(raw):010d}"
    except Exception:
        pass
    return None


def _ticker_for_cik10(cik10: str) -> str | None:
    """Reverse CIK → ticker for Manual News EDGAR URLs."""
    raw = re.sub(r"\D", "", str(cik10 or ""))
    if not raw:
        return None
    target = f"{int(raw):010d}"
    try:
        from edgar_silent_money import load_ticker_cik_map

        for tk, cik in (load_ticker_cik_map() or {}).items():
            try:
                if f"{int(cik):010d}" == target:
                    return str(tk).strip().upper()
            except Exception:
                continue
    except Exception:
        pass
    try:
        from catalyst_calendar import _ticker_cik_fallback

        for tk, cik in (_ticker_cik_fallback() or {}).items():
            s = str(cik or "").strip()
            if s.isdigit() and f"{int(s):010d}" == target:
                return str(tk).strip().upper()
    except Exception:
        pass
    return None


_8K_ITEM_LABELS = {
    "2.02": "Results of Operations",
    "7.01": "Regulation FD Disclosure",
    "8.01": "Other Events",
}
_8K_ITEM_HEADER_RE = re.compile(
    r"^\s*Item\s+(\d\.\d{2})\s*[.:\u2013\u2014-]*\s*"
    r"(?:(?:Other\s+Events|Regulation\s+FD\s+Disclosure|"
    r"Results\s+of\s+Operations(?:\s+and\s+Financial\s+Condition)?)"
    r"\s*[.:\u2013\u2014-]*\s*)?",
    re.I,
)


_ABBREVIATIONS = (
    "Inc.",
    "Corp.",
    "Ltd.",
    "Co.",
    "LLC.",
    "L.L.C.",
    "plc.",
    "S.A.",
    "N.V.",
    "Dr.",
    "Mr.",
    "Mrs.",
    "Ms.",
    "Jr.",
    "Sr.",
    "St.",
    "U.S.",
    "U.K.",
    "No.",
    "Nos.",
    "vs.",
    "etc.",
    "approx.",
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'\u201c])")
_ABBREV_SENTINEL = "\x00"

# "On September 10, 2026, Acme Inc. issued a press release announcing that X" → "X"
_8K_LEDE_BOILERPLATE_RE = re.compile(
    r"^(?:on\s+\w+\.?\s+\d{1,2},?\s+20\d{2},?\s*)?"
    r"(?:[A-Z][\w.,&'\u2019\- ]{2,60}?\s+)?"
    r"(?:issued\s+a\s+press\s+release\s+)?"
    r"(?:announc(?:ed|ing)|report(?:ed|ing)|disclos(?:ed|ing))\s+(?:that\s+)?",
    re.I,
)


def _split_sentences(text: str) -> list[str]:
    """Sentence split that survives 'Inc.' / 'U.S.' / 'Exhibit 99.1' periods."""
    s = text or ""
    for abbr in _ABBREVIATIONS:
        s = s.replace(abbr, abbr.replace(".", _ABBREV_SENTINEL))
    return [
        p.replace(_ABBREV_SENTINEL, ".").strip()
        for p in _SENTENCE_SPLIT_RE.split(s)
        if p.strip()
    ]


def _split_8k_item_header(chunk: str) -> tuple[str, str]:
    """('7.01', 'Company announced …') — drops the Item caption EDGAR repeats."""
    m = _8K_ITEM_HEADER_RE.match(chunk or "")
    if not m:
        return "", (chunk or "").strip()
    return m.group(1), (chunk or "")[m.end() :].strip()


def _8k_point_title(item_no: str, body: str) -> str:
    """
    Headline for one 8-K finding.

    Splitting on '.' turned 'Item 7.01' into the title 'Item 7'; take the first
    real sentence instead, drop the press-release lede boilerplate, then prefix
    the Item label.
    """
    sent = _split_sentences(body)
    head = (sent[0] if sent else "").strip(" .;:\u2013\u2014-")
    if len(head) < 24:
        head = body.strip()[:140].strip(" .;:\u2013\u2014-")
    stripped = _8K_LEDE_BOILERPLATE_RE.sub("", head).strip(" .;:\u2013\u2014-")
    if len(stripped) >= 30:
        head = stripped[0].upper() + stripped[1:]
    label = _8K_ITEM_LABELS.get(item_no, "")
    if head and label:
        return f"{label}: {head}"[:200]
    return head[:200] or label or "8-K update"


def _extractive_8k_points(text: str, *, limit: int = 4) -> list[dict[str, Any]]:
    """Fallback digest when AI is unavailable — score keyword hits."""
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if not clean:
        return []
    # Prefer Item 8.01 / 2.02 / 7.01 windows when present. Each window stops at
    # the next Item header, otherwise the first chunk swallowed the later sections.
    chunks: list[str] = []
    starts = [
        m.start()
        for m in re.finditer(r"Item\s+\d\.\d{2}\b", clean, flags=re.I)
    ]
    for i, m in enumerate(
        re.finditer(r"Item\s+(?:8\.01|2\.02|7\.01)\b", clean, flags=re.I)
    ):
        nxt = next((s for s in starts if s > m.start()), len(clean))
        chunks.append(clean[m.start() : min(nxt, m.start() + 1800)][:900])
        if len(chunks) >= limit:
            break
    if not chunks:
        chunks = [clean[:1200]]
    points: list[dict[str, Any]] = []
    for chunk in chunks[:limit]:
        item_no, prose = _split_8k_item_header(chunk)
        sent = _split_sentences(prose)
        body = " ".join(s.strip() for s in sent[:3] if s.strip())[:420]
        if len(body) < 40:
            continue
        title = _8k_point_title(item_no, body)
        dims = _dimension_scores(title, body)
        points.append(
            {
                "title": title,
                "summary": body,
                "eis_score": dims.get("eis_score"),
                "eis": dims.get("eis"),
                "clinical_score": dims.get("clinical_score"),
                "financial_score": dims.get("financial_score"),
                "corporate_score": dims.get("corporate_score"),
                "market_access_score": dims.get("market_access_score"),
                "market_access_notes": dims.get("market_access_notes"),
                "taxonomy_dimensions": dims.get("taxonomy_dimensions"),
                "taxonomy_review_flags": dims.get("taxonomy_review_flags"),
                "taxonomy_method": dims.get("taxonomy_method"),
                "taxonomy_version": dims.get("taxonomy_version"),
                "taxonomy_audit": dims.get("taxonomy_audit"),
                "digest_method": "extractive",
            }
        )
    return points


# ---------------------------------------------------------------------------
# SEC 8-K structural segmentation (cover = metadata only; Items = content)
# ---------------------------------------------------------------------------

_8K_ITEM_SPLIT_RE = re.compile(
    r"(?im)^\s*Item\s+(\d\.\d{2})\s*[.:\u2013\u2014-]?\s*"
    r"([^\n\r]{0,120}?)\s*$"
)
_8K_ITEM_INLINE_RE = re.compile(
    r"(?i)\bItem\s+(\d\.\d{2})\s*[.:\u2013\u2014-]?\s*"
    r"(Entry into a Material Definitive Agreement|"
    r"Termination of a Material Definitive Agreement|"
    r"Completion of Acquisition or Disposition of Assets|"
    r"Results of Operations and Financial Condition|"
    r"Creation of a Direct Financial Obligation|"
    r"Triggering Events That Accelerate or Increase|"
    r"Costs Associated with Exit or Disposal|"
    r"Material Impairments|"
    r"Notice of Delisting|"
    r"Unregistered Sales of Equity Securities|"
    r"Material Modification to Rights|"
    r"Changes in Registrant's Certifying Accountant|"
    r"Non-Reliance on Previously Issued|"
    r"Departure of Directors or Certain Officers|"
    r"Amendments to Articles of Incorporation|"
    r"Submission of Matters to a Vote|"
    r"Regulation FD Disclosure|"
    r"Other Events|"
    r"Financial Statements and Exhibits|"
    r"[A-Z][^\n\r.]{2,80})"
)
_8K_END_RE = re.compile(
    r"(?im)^\s*(?:SIGNATURES?|EXHIBIT\s+INDEX|INDEX\s+TO\s+EXHIBITS)\b"
)
_8K_COVER_NOISE_RE = re.compile(
    r"(?i)("
    r"date of earliest event reported|"
    r"exact name of registrant|"
    r"commission file number|"
    r"irs employer|"
    r"central index key|"
    r"check the appropriate box|"
    r"title of each class|"
    r"trading symbol|"
    r"name of each exchange|"
    r"emerging growth company|"
    r"indicate by check mark|"
    r"sec file number|"
    r"form\s+8-k"
    r")"
)

# Item code → Daily News news_kind (reconcile with EIS taxonomy later).
_8K_ITEM_NEWS_KIND: dict[str, str] = {
    "1.01": "financial",  # material agreement — often financing SPA; not auto-M&A
    "1.02": "financial",
    "2.01": "ma",
    "2.02": "financial",
    "2.03": "financial",
    "2.04": "financial",
    "2.05": "other",
    "2.06": "financial",
    "3.01": "other",
    "3.02": "financial",
    "3.03": "other",
    "4.01": "other",
    "4.02": "other",
    "5.02": "other",  # executive change
    "5.03": "other",
    "5.07": "other",
    "7.01": "financial",  # often FD pricing / offering PR
    "8.01": "other",
    "9.01": "other",
}


def _extract_8k_cover_metadata(cover: str) -> dict[str, Any]:
    """Structured fields from the pre-Item cover page only."""
    blob = cover or ""
    out: dict[str, Any] = {
        "registrant": None,
        "event_date": None,
        "cik": None,
        "file_number": None,
    }
    m = re.search(
        r"(?i)(?:COMPANY\s+CONFORMED\s+NAME|Exact\s+Name\s+of\s+Registrant[^:]*):\s*"
        r"([^\n\r]{3,90})",
        blob,
    )
    if m:
        out["registrant"] = re.sub(r"\s+", " ", m.group(1)).strip(" ,.")
    m = re.search(
        r"(?i)date of earliest event reported\)?:\s*"
        r"((?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})",
        blob,
    )
    if m:
        raw = m.group(1).strip()
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw):
            out["event_date"] = raw
        else:
            try:
                from datetime import datetime as _dt

                out["event_date"] = (
                    _dt.strptime(raw.replace(",", ""), "%B %d %Y").date().isoformat()
                )
            except Exception:
                out["event_date"] = raw
    m = re.search(r"(?i)CENTRAL\s+INDEX\s+KEY:\s*(\d{1,10})", blob)
    if m:
        out["cik"] = m.group(1).zfill(10)
    m = re.search(r"(?i)SEC\s+FILE\s+NUMBER:\s*([\d-]+)", blob)
    if m:
        out["file_number"] = m.group(1)
    return out


def _segment_8k_filing(text: str) -> dict[str, Any]:
    """
    Split an 8-K bundle into cover (metadata only) + Item sections.
    Cover is everything before the first Item header; never used as summary content.
    """
    raw = text or ""
    # Prefer line-anchored headers; fall back to inline Item titles in flat HTML text.
    matches = list(_8K_ITEM_SPLIT_RE.finditer(raw))
    if len(matches) < 1:
        matches = list(_8K_ITEM_INLINE_RE.finditer(raw))
    # Inline matches can re-hit the same Item number inside body text — keep first only.
    if matches:
        seen_codes: set[str] = set()
        uniq: list[Any] = []
        for m in matches:
            code = str(m.group(1) or "").strip()
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)
            uniq.append(m)
        matches = uniq
    if not matches:
        return {
            "cover": raw,
            "items": [],
            "metadata": _extract_8k_cover_metadata(raw),
            "body_without_cover": raw,
        }

    cover = raw[: matches[0].start()].strip()
    end_m = _8K_END_RE.search(raw, matches[0].start())
    end_pos = end_m.start() if end_m else len(raw)

    items: list[dict[str, Any]] = []
    for i, m in enumerate(matches):
        if m.start() >= end_pos:
            break
        item_no = m.group(1)
        title = re.sub(r"\s+", " ", (m.group(2) or "").strip(" .:-\u2013\u2014"))
        nxt = matches[i + 1].start() if i + 1 < len(matches) else end_pos
        nxt = min(nxt, end_pos)
        body = raw[m.end() : nxt].strip()
        body = re.sub(r"\s+", " ", body).strip()
        # Drop forward-looking boilerplate tails inside an Item
        body = re.split(
            r"(?i)\bForward[- ]Looking\s+Statements\b", body, maxsplit=1
        )[0].strip()
        items.append(
            {
                "item": item_no,
                "title": title[:120] or f"Item {item_no}",
                "body": body,
            }
        )

    body_wo = "\n\n".join(
        f"Item {it['item']} {it['title']}. {it['body']}".strip()
        for it in items
        if it.get("body")
    )
    return {
        "cover": cover,
        "items": items,
        "metadata": _extract_8k_cover_metadata(cover),
        "body_without_cover": body_wo,
    }


def _news_kind_from_8k_items(
    items: list[dict[str, Any]] | list[str],
    *,
    body_hint: str = "",
) -> str:
    """
    Derive news_kind from Item codes (not free-text 'definitive agreement' → M&A).
    Priority: 2.01 M&A > financing items > clinical cues in 8.01 > other.
    """
    codes: list[str] = []
    for it in items or []:
        if isinstance(it, dict):
            c = str(it.get("item") or "").strip()
        else:
            c = str(it or "").strip()
        if c:
            codes.append(c)
    if any(c == "2.01" for c in codes):
        return "ma"
    financing = {"1.01", "1.02", "2.02", "2.03", "2.04", "2.06", "3.02", "7.01"}
    if any(c in financing for c in codes):
        # True asset acquisition disguised as 1.01 only — rare; keep financial default.
        if re.search(
            r"(?i)\b(complet(?:es|ed)\s+(?:the\s+)?acquisition|merger\s+agreement|"
            r"to\s+be\s+acquired|all[- ]cash\s+tender)\b",
            body_hint or "",
        ) and "2.01" not in codes:
            # Still prefer financial for SPA / registered direct language
            if re.search(
                r"(?i)\b(registered\s+direct|securities\s+purchase\s+agreement|"
                r"public\s+offering|pre[- ]funded\s+warrant)\b",
                body_hint or "",
            ):
                return "financial"
        # Licensing / collaboration under 1.01 is a deal, not a financing: the "ma"
        # template covers M&A *and* licensing, so the brief gets deal-shaped prose.
        if "1.01" in codes and not re.search(
            r"(?i)\b(registered\s+direct|securities\s+purchase\s+agreement|"
            r"public\s+offering|pre[- ]funded\s+warrant|at[- ]the[- ]market|"
            r"equity\s+line|credit\s+agreement|loan\s+agreement)\b",
            body_hint or "",
        ):
            if re.search(
                r"(?i)\b(licen[sc]e\s+agreement|licensing\s+agreement|collaboration\s+agreement|"
                r"co[-\s]development\s+agreement|option\s+and\s+licen[sc]e|"
                r"strategic\s+(?:partnership|alliance|collaboration)|joint\s+venture)\b",
                body_hint or "",
            ) and re.search(
                r"(?i)\b(upfront\s+(?:payment|fee)|milestone\s+payments?|royalt(?:y|ies)|"
                r"exclusive\s+(?:worldwide\s+)?(?:rights|licen[sc]e))\b",
                body_hint or "",
            ):
                return "ma"
        return "financial"
    if "8.01" in codes and re.search(
        r"(?i)\b(phase\s*[i1-3]|topline|endpoint|clinical\s+trial|fda|pdufa)\b",
        body_hint or "",
    ):
        return "clinical"
    if "5.02" in codes:
        return "other"
    for c in codes:
        kind = _8K_ITEM_NEWS_KIND.get(c)
        if kind:
            return kind
    return "other"


def _summarize_8k_item_extractive(item: dict[str, Any], *, max_words: int = 50) -> str:
    """~50-word Item summary; short when substance is thin (e.g. Item 9.01)."""
    item_no = str(item.get("item") or "")
    title = str(item.get("title") or f"Item {item_no}")
    body = str(item.get("body") or "").strip()
    if not body or len(body) < 40:
        return f"Item {item_no} ({title}): no substantive text beyond the header."

    # Exhibit index — list exhibits, do not invent narrative
    if item_no == "9.01" or re.search(r"(?i)financial statements and exhibits", title):
        exhibits = re.findall(
            r"(?i)(?:Exhibit\s+)?(\d{1,2}\.\d{1,2})\s+([^\n\r.]{5,80})",
            body,
        )
        if exhibits:
            bits = [f"{n} {t.strip()}" for n, t in exhibits[:6]]
            return f"Item 9.01 — exhibits: " + "; ".join(bits) + "."
        return "Item 9.01 — financial statements and exhibits (index only)."

    # Drop cover-like noise if it leaked into an Item
    cleaned = " ".join(
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", body)
        if s.strip()
        and not _8K_COVER_NOISE_RE.search(s)
        and len(s.strip()) > 35
    )
    if not cleaned:
        cleaned = body
    words = cleaned.split()
    if len(words) <= max_words:
        return cleaned[:600]
    # Prefer whole sentences within budget
    sents = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", cleaned)
        if len(s.strip()) > 30 and not _8K_COVER_NOISE_RE.search(s)
    ]
    out: list[str] = []
    n = 0
    for s in sents:
        w = len(s.split())
        if out and n + w > max_words:
            break
        out.append(s)
        n += w
        if n >= max_words - 8:
            break
    if out:
        return " ".join(out)
    return " ".join(words[:max_words]) + "…"


def _build_sec_8k_structured_brief(
    *,
    text: str,
    ticker: str = "",
    title_hint: str = "",
    url: str = "",
    filing_date: str | None = None,
) -> dict[str, Any]:
    """
    SEC-only brief: Item blocks + overall narrative; never PAGE CHECK Q&A;
    cover page used only for metadata.
    """
    seg = _segment_8k_filing(text)
    items = list(seg.get("items") or [])
    meta = seg.get("metadata") if isinstance(seg.get("metadata"), dict) else {}
    body_wo = str(seg.get("body_without_cover") or "")

    item_summaries: list[dict[str, str]] = []
    for it in items:
        # Skip pure empty 9.01-only noise only when body is tiny
        sm = _summarize_8k_item_extractive(it)
        if _8K_COVER_NOISE_RE.search(sm) and "Item 9.01" not in sm:
            # Refuse cover-echo summaries
            continue
        item_summaries.append(
            {
                "item": str(it.get("item") or ""),
                "title": str(it.get("title") or ""),
                "summary": sm,
            }
        )

    filing_iso, event_iso = _8k_filing_and_event_dates(
        text, fallback_filing=filing_date or _rome_date()
    )
    if meta.get("event_date") and not event_iso:
        event_iso = str(meta.get("event_date"))[:10]

    # Taxonomy / English offering narrative on content without cover
    scored: dict[str, Any] | None = None
    try:
        from eis_taxonomy_scoring import classify_8k_filing

        scored = classify_8k_filing(
            ticker=ticker or "UNK",
            filing_date=filing_iso,
            text=body_wo or text,
            event_date=event_iso or filing_iso,
        )
    except Exception as exc:
        logger.debug("SEC structured brief classify failed: %s", exc)
        scored = None

    narr = ""
    if scored and scored.get("narrative_summary"):
        narr = str(scored.get("narrative_summary") or "").strip()
    if not narr or _8K_COVER_NOISE_RE.search(narr[:120] or ""):
        # Fallback: join Item summaries (no cover)
        bits = [
            f"Item {x['item']} ({x['title']}): {x['summary']}"
            for x in item_summaries
            if x.get("item") != "9.01"
        ]
        narr = "\n\n".join(bits) if bits else (title_hint or "8-K filing")

    # Item-code news_kind (never free-text "definitive agreement" → M&A)
    kind = _news_kind_from_8k_items(items, body_hint=body_wo)
    if scored:
        dims = scored.get("taxonomy_dimensions") or {}
        if isinstance(dims, dict) and (dims.get("clinical") or {}).get("event_id"):
            if kind != "ma":
                kind = "clinical"
        if isinstance(dims, dict) and (dims.get("financial") or {}).get("event_id"):
            if kind != "ma":
                kind = "financial"

    title_card = str((scored or {}).get("title") or "").strip()
    if not title_card or _8K_COVER_NOISE_RE.search(title_card):
        tk = (ticker or "").strip().upper()
        file_en = None
        ev_en = None
        try:
            from eis_taxonomy_scoring import _english_date_long

            file_en = _english_date_long(filing_iso)
            ev_en = _english_date_long(event_iso) if event_iso else None
        except Exception:
            file_en, ev_en = filing_iso, event_iso
        title_card = f"{tk or '8-K'} — {file_en or filing_iso}"
        if ev_en and ev_en != file_en:
            title_card += f" (event date {ev_en})"

    brief: dict[str, Any] = {
        "detail_summary": narr[:3500],
        "summary_long": narr[:3500],
        "title": title_card[:240],
        "headline": title_card[:240],
        "ticker": (ticker or "").strip().upper() or None,
        "news_kind": kind,
        "digest_method": "sec_8k_items",
        "key_points": [
            f"Item {x['item']}: {x['summary']}"[:220] for x in item_summaries[:6]
        ],
        "key_results": [
            {
                "label": f"Item {x['item']} — {x['title']}"[:80],
                "detail": x["summary"][:500],
            }
            for x in item_summaries
        ],
        "item_summaries": item_summaries,
        "cover_metadata": meta,
        "dates": [],
        "digest_answers": [],
        "has_summary": bool(narr),
        "has_bullet_summary": False,
        "skip_page_check": True,
        "source_url": url or None,
        "product": None,
        "study": None,
        "phase": None,
        "items_detected": [x["item"] for x in item_summaries if x.get("item")],
        "event_date": event_iso,
        "published_at": filing_iso,
    }
    if scored:
        for k in (
            "clinical_score",
            "financial_score",
            "corporate_score",
            "market_access_score",
            "eis_score",
            "eis",
            "market_access_notes",
            "taxonomy_dimensions",
            "taxonomy_review_flags",
            "taxonomy_method",
            "taxonomy_version",
            "taxonomy_audit",
            "taxonomy_classification",
        ):
            if scored.get(k) is not None:
                brief[k] = scored.get(k)
        if scored.get("items_detected"):
            brief["items_detected"] = scored.get("items_detected")
    _attach_8k_gemini_paragraphs(
        brief, items=items, text=text, ticker=ticker or ""
    )
    return brief


_8K_PARA_SKIP_RE = re.compile(
    r"(?i)forward[- ]looking statements|private securities litigation|"
    r"pursuant to the requirements of the securities exchange|"
    r"duly caused this report|emerging growth company|"
    r"check the appropriate box|furnished and shall not be deemed"
)


def _extractive_8k_section_paragraphs(
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fallback: one card per Item paragraph when Gemini is unavailable."""
    out: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        code = str(it.get("item") or "").strip()
        official = str(it.get("title") or (f"Item {code}" if code else "8-K")).strip()
        body = str(it.get("body") or "").strip()
        if not body or len(body) < 40:
            continue
        chunks = [p.strip() for p in re.split(r"\n\s*\n+", body) if len(p.strip()) > 40]
        if len(chunks) <= 1:
            sents = [
                s.strip()
                for s in re.split(r"(?<=[.!?])\s+", body)
                if len(s.strip()) > 40 and not _8K_PARA_SKIP_RE.search(s)
            ]
            chunks = []
            buf: list[str] = []
            n = 0
            for s in sents:
                buf.append(s)
                n += len(s.split())
                if n >= 40:
                    chunks.append(" ".join(buf))
                    buf, n = [], 0
            if buf:
                chunks.append(" ".join(buf))
        for chunk in chunks:
            if _8K_PARA_SKIP_RE.search(chunk[:120] or ""):
                continue
            words = chunk.split()
            summary = " ".join(words[:50]) + ("…" if len(words) > 50 else "")
            heading = official if code == "9.01" else (_8k_point_title(code, chunk) or official)
            out.append(
                {
                    "item": code,
                    "item_title": official[:160],
                    "title": str(heading)[:160],
                    "summary": summary,
                }
            )
            if len(out) >= 10:
                return out
    return out


def _attach_8k_gemini_paragraphs(
    brief: dict[str, Any],
    *,
    items: list[dict[str, Any]],
    text: str,
    ticker: str,
) -> None:
    """
    Paragraph-by-paragraph conceptual summaries (title + ≤65 words) for Daily News 8-K briefs.
    Gemini first; extractive paragraphs if the model is unavailable.
    """
    gemini: list[dict[str, Any]] | None = None
    try:
        from ticker_8k_dossier import _exhibit_tail, _gemini_paragraphs_for_filing

        gemini = _gemini_paragraphs_for_filing(
            ticker=ticker or "",
            items=items,
            tail=_exhibit_tail(text),
        )
    except Exception as exc:
        logger.debug("8-K Gemini paragraphs failed: %s", exc)
        gemini = None

    used_gemini = bool(gemini)
    paras = list(gemini or []) or _extractive_8k_section_paragraphs(items)
    if not paras:
        return

    if used_gemini:
        brief["gemini_sessions"] = paras
        brief["digest_method"] = "sec_8k_gemini"

    section_summaries: list[dict[str, str]] = []
    by_item: dict[str, list[str]] = {}
    for p in paras:
        if not isinstance(p, dict):
            continue
        sm = " ".join(str(p.get("summary") or "").split()).strip()
        if not sm:
            continue
        heading = str(p.get("title") or p.get("heading") or "").strip()
        item_no = str(p.get("item") or "").strip()
        if item_no and heading and not re.match(r"(?i)^item\s+", heading):
            heading = f"Item {item_no} — {heading}"
        elif item_no and not heading:
            heading = f"Item {item_no}"
        section_summaries.append({"heading": heading[:160], "summary": sm[:600]})
        if item_no:
            by_item.setdefault(item_no, []).append(sm)

    if section_summaries:
        brief["section_summaries"] = section_summaries
        brief["is_paper"] = False

    try:
        from ticker_8k_dossier import _cap_words as _cap50
    except Exception:
        def _cap50(text: str | None, n: int = 50) -> str | None:  # type: ignore[misc]
            words = str(text or "").split()
            if not words:
                return None
            return " ".join(words[:n]) + ("…" if len(words) > n else "")

    for row in brief.get("item_summaries") or []:
        if not isinstance(row, dict):
            continue
        bits = by_item.get(str(row.get("item") or "")) or []
        if bits:
            rolled = _cap50(" ".join(bits), 50)
            if rolled:
                row["summary"] = rolled

    if used_gemini and section_summaries:
        bits = [
            f"{x['heading']}: {x['summary']}" for x in section_summaries[:8]
        ]
        narr = "\n\n".join(bits)
        brief["detail_summary"] = narr[:3500]
        brief["summary_long"] = narr[:3500]
        brief["key_points"] = [
            f"{x['heading']}: {x['summary']}"[:220] for x in section_summaries[:6]
        ]
        brief["key_results"] = [
            {"label": x["heading"][:80], "detail": x["summary"][:500]}
            for x in section_summaries
        ]
        brief["has_summary"] = True


def _8k_filing_and_event_dates(
    text: str, *, fallback_filing: str | None = None
) -> tuple[str, str | None]:
    """Return (filing_date_iso, event_date_iso) from EDGAR 8-K body."""
    blob = text or ""
    fallback = (fallback_filing or _rome_date())[:10]
    event: str | None = None
    m_ev = re.search(
        r"(?i)date of earliest event reported\)?:\s*"
        r"((?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})",
        blob,
    )
    if m_ev:
        raw_ev = m_ev.group(1).strip()
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw_ev):
            event = raw_ev
        else:
            try:
                from datetime import datetime as _dt

                event = _dt.strptime(raw_ev.replace(",", ""), "%B %d %Y").date().isoformat()
            except Exception:
                event = None

    filing = fallback
    for pat in (
        r"(?i)FILED AS OF DATE:\s*(\d{8})",
        r"(?i)expected to close on\s+"
        r"((?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+\d{1,2},?\s+20\d{2})",
        r"(?i)On\s+"
        r"((?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+\d{1,2},?\s+20\d{2}),\s+the\s+Company\s+issued\s+a\s+press\s+release",
    ):
        m = re.search(pat, blob)
        if not m:
            continue
        raw = m.group(1).strip()
        if re.fullmatch(r"\d{8}", raw):
            filing = f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
            break
        try:
            from datetime import datetime as _dt

            filing = _dt.strptime(raw.replace(",", ""), "%B %d %Y").date().isoformat()
            break
        except Exception:
            continue
    return filing, event


def _ai_digest_8k(ticker: str, text: str, filing_date: str) -> list[dict[str, Any]]:
    """
    Classify 8-K via taxonomy system prompt (no free sentiment).
    Scores are deterministic from event_id + magnitude modifiers.
    """
    clip = re.sub(r"\s+", " ", (text or "")).strip()
    if len(clip) < 80:
        return []
    filing_iso, event_iso = _8k_filing_and_event_dates(
        text, fallback_filing=filing_date
    )
    try:
        from eis_taxonomy_scoring import classify_8k_filing

        scored = classify_8k_filing(
            ticker=ticker,
            filing_date=filing_iso,
            text=text,
            event_date=event_iso or filing_iso,
        )
    except Exception as exc:
        logger.debug("8-K AI classify failed %s: %s", ticker, exc)
        scored = None
    if not scored:
        return []
    title = str(scored.get("title") or "").strip()
    summary = str(scored.get("narrative_summary") or "").strip()
    if not title and not summary:
        return []
    return [
        {
            "title": (title or summary.split("\n", 1)[0])[:240],
            "summary": (summary or title)[:3500],
            "eis_score": scored.get("eis_score"),
            "eis": scored.get("eis"),
            "clinical_score": scored.get("clinical_score"),
            "financial_score": scored.get("financial_score"),
            "corporate_score": scored.get("corporate_score"),
            "market_access_score": scored.get("market_access_score"),
            "market_access_notes": scored.get("market_access_notes"),
            "taxonomy_dimensions": scored.get("taxonomy_dimensions"),
            "taxonomy_review_flags": scored.get("taxonomy_review_flags"),
            "taxonomy_method": scored.get("taxonomy_method") or "ai_8k",
            "taxonomy_version": scored.get("taxonomy_version"),
            "taxonomy_audit": scored.get("taxonomy_audit"),
            "taxonomy_classification": scored.get("taxonomy_classification"),
            "items_detected": scored.get("items_detected"),
            "digest_method": scored.get("taxonomy_method") or "ai_8k",
            "detail_summary": summary[:3500],
            "event_date": event_iso,
            "published_at": filing_iso,
            "news_kind": (
                "financial"
                if ((scored.get("taxonomy_dimensions") or {}).get("financial") or {}).get(
                    "event_id"
                )
                else "other"
            ),
        }
    ]


def _parse_edgar_filing_url(url: str) -> dict[str, str] | None:
    """Parse www.sec.gov/Archives/edgar/data/{cik}/{accession_flat}/{doc}."""
    u = (url or "").strip()
    m = re.search(
        r"(?i)sec\.gov/Archives/edgar/data/(\d+)/(\d{18}|\d{10}-\d{2}-\d{6})/([^?#]+)",
        u,
    )
    if not m:
        m = re.search(
            r"(?i)sec\.gov/Archives/edgar/data/(\d+)/([0-9-]+)/([^?#]+)",
            u,
        )
    if not m:
        return None
    cik = m.group(1)
    acc_raw = m.group(2).replace("-", "")
    if len(acc_raw) == 18 and acc_raw.isdigit():
        accession = f"{acc_raw[:10]}-{acc_raw[10:12]}-{acc_raw[12:]}"
    else:
        accession = m.group(2)
    doc = m.group(3).split("/")[-1]
    if not doc:
        return None
    return {
        "cik10": str(int(cik)).zfill(10),
        "accession": accession,
        "primary_doc": doc,
    }


def _fetch_edgar_8k_text_from_url(url: str) -> tuple[str, str | None]:
    """Fetch 8-K primary + Ex-99 via EDGAR UA (avoids browser http_403)."""
    parsed = _parse_edgar_filing_url(url)
    if not parsed:
        return "", "not_edgar_url"
    try:
        from catalyst_extractor import _fetch_8k_bundle_text

        text = _fetch_8k_bundle_text(
            parsed["cik10"],
            parsed["accession"],
            parsed["primary_doc"],
            max_chars=80_000,
            fetch_exhibits=True,
        )
    except Exception as exc:
        return "", str(exc)[:200]
    if text and len(text.strip()) >= 80:
        return text.strip(), None
    return "", "edgar_empty"


def _recent_8k_digests_for_ticker(
    ticker: str,
    company: str,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Same-day EDGAR 8-K for Top News — digest via Financial dossier engine
    (_digest_filing / _build_sec_8k_structured_brief) and upsert into the dossier cache.
    """
    rn = _rome_now(now)
    today = rn.date().isoformat()
    cutoff = (rn.date() - timedelta(days=max(0, int(_TOP_8K_LOOKBACK_DAYS)))).isoformat()
    cik10 = _cik10_for_ticker(ticker)
    if not cik10:
        return []
    try:
        from catalyst_extractor import (
            _fetch_8k_bundle_text,
            _fetch_submissions,
            _filing_html_url,
            _recent_8k_filings,
        )
        from ticker_8k_dossier import _digest_filing, upsert_edgar_filing
    except Exception as exc:
        logger.debug("8-K tools unavailable: %s", exc)
        return []

    subs = _fetch_submissions(cik10)
    if not subs:
        return []
    filings = _recent_8k_filings(subs, max_n=_TOP_8K_PER_TICKER * 3)
    rows: list[dict[str, Any]] = []
    used = 0
    for fil in filings:
        fd = str(fil.get("filing_date") or "")[:10]
        if not fd or fd < cutoff or fd > today:
            continue
        accession = str(fil.get("accession") or "")
        primary = str(fil.get("primary_doc") or "")
        if not accession or not primary:
            continue
        text = _fetch_8k_bundle_text(
            cik10,
            accession,
            primary,
            max_chars=80_000,
            fetch_exhibits=True,
        )
        if not text:
            continue
        link = _filing_html_url(cik10, accession, primary)
        form_type = str(fil.get("form_type") or "8-K")
        try:
            card = _digest_filing(
                ticker=ticker,
                text=text,
                filing_date=fd,
                url=link,
                items_hint=str(fil.get("items") or ""),
                form_type=form_type,
            )
        except Exception as exc:
            logger.debug("8-K dossier digest failed %s %s: %s", ticker, accession, exc)
            card = None
        if not card:
            # Fallback: taxonomy-only (legacy) if structured brief fails.
            digests = _ai_digest_8k(ticker, text, fd) or _extractive_8k_points(text)
            if not digests:
                continue
            d0 = digests[0]
            card = {
                "filing_date": fd,
                "event_date": d0.get("event_date") or fd,
                "form": form_type,
                "title": str(d0.get("title") or "8-K update")[:240],
                "link": link,
                "sessions": [
                    {
                        "item": "8-K",
                        "title": str(d0.get("title") or "")[:160],
                        "summary": str(d0.get("summary") or "")[:800],
                    }
                ],
                "financial_score": d0.get("financial_score"),
                "clinical_score": d0.get("clinical_score"),
                "corporate_score": d0.get("corporate_score"),
                "eis_score": d0.get("eis_score"),
                "eis": d0.get("eis"),
                "digest_method": d0.get("digest_method") or "ai_8k",
                "taxonomy_dimensions": d0.get("taxonomy_dimensions"),
                "taxonomy_method": d0.get("taxonomy_method"),
                "market_access_score": d0.get("market_access_score"),
                "market_access_notes": d0.get("market_access_notes"),
            }
        try:
            upsert_edgar_filing(ticker=ticker, filing=card)
        except Exception as exc:
            logger.debug("8-K dossier upsert failed %s: %s", ticker, exc)

        title = str(card.get("title") or "8-K update")
        session_bits: list[str] = []
        for s in card.get("sessions") or []:
            if not isinstance(s, dict):
                continue
            sm = str(s.get("summary") or "").strip()
            if sm:
                session_bits.append(sm)
        summary = " ".join(session_bits)[:3500] or title
        iid = _item_id(ticker, f"8k|{accession}|{title}", fd or rn.date().isoformat())
        used += 1
        rows.append(
            {
                "id": iid,
                "ticker": ticker,
                "company": company,
                "title": title[:240],
                "summary": summary[:500],
                "detail_summary": summary[:3500],
                "link": link,
                "event_date": str(card.get("event_date") or fd or rn.date().isoformat())[:10],
                "published_at": (fd or rn.date().isoformat())[:10],
                "source": "sec_8k",
                "source_kind": "sec_8k",
                "source_label": "8-K",
                "accession": accession,
                "eis_score": card.get("eis_score"),
                "eis": card.get("eis"),
                "clinical_score": card.get("clinical_score"),
                "financial_score": card.get("financial_score"),
                "corporate_score": card.get("corporate_score"),
                "market_access_score": card.get("market_access_score"),
                "market_access_notes": card.get("market_access_notes"),
                "taxonomy_dimensions": card.get("taxonomy_dimensions"),
                "taxonomy_method": card.get("classification_method")
                or card.get("taxonomy_method"),
                "digest_method": card.get("digest_method") or "sec_8k_items",
                "section_summaries": [
                    {
                        "heading": str(s.get("title") or s.get("item") or "Item"),
                        "summary": str(s.get("summary") or ""),
                    }
                    for s in (card.get("sessions") or [])
                    if isinstance(s, dict) and str(s.get("summary") or "").strip()
                ][:12],
                "item_summaries": card.get("sessions"),
                "news_kind": card.get("news_kind") or "financial",
                "section": "top",
                "found_at": _now_iso(),
            }
        )
        if used >= _TOP_8K_PER_TICKER:
            break
    return rows


def _press_rows_for_ticker(
    ticker: str,
    company: str,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    rn = _rome_now(now)
    today = rn.date().isoformat()
    cutoff = _desk_fresh_cutoff_iso(today=today)
    try:
        headlines = _fetch_company_news(ticker, company)
    except Exception as exc:
        logger.debug("Top press fetch %s failed: %s", ticker, exc)
        return []
    rows: list[dict[str, Any]] = []
    doc = _read()
    for h in headlines[:_TOP_PRESS_PER_TICKER]:
        title = str(h.get("title") or "").strip()
        if not title:
            continue
        link = _best_openable_news_url(h)
        raw_link = str(h.get("link") or h.get("gnews_link") or "").strip()
        if not link and not raw_link:
            continue  # always require reference link
        ed = str(h.get("event_date") or "").strip()[:10]
        # Live RSS without a date: stamp as found today (feed is current).
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", ed):
            ed = today
        elif ed < cutoff or ed > today:
            continue
        iid = _item_id(ticker, f"press|{title}", ed)
        fp = _article_fingerprint(
            ticker=ticker, title=title, url=link or raw_link, item_id=iid
        )
        ck = _story_cluster_key(ticker=ticker, title=title, day=ed)
        # Already dismissed/migrated (same URL or same event family) → stay off the desk.
        if _is_article_passed(
            doc, fp=fp, cluster=ck, ticker=ticker, title=title, day=ed
        ):
            continue
        if _is_cluster_known(doc, ck):
            continue
        summary = str(h.get("summary") or "")[:500]
        dims = _dimension_scores(title, summary)
        gnews = str(h.get("gnews_link") or "").strip()
        if not gnews and _is_google_news_shell_url(raw_link):
            gnews = raw_link
        rows.append(
            {
                "id": iid,
                "article_fp": fp,
                "story_cluster": ck,
                "ticker": ticker,
                "company": company,
                "title": title[:240],
                "summary": summary,
                "link": link[:500],
                "gnews_link": gnews[:500] if gnews else "",
                "event_date": ed,
                "published_at": _headline_published_iso(h, fallback_day=ed),
                "source": str(h.get("source") or "google_news_rss"),
                "source_kind": "press",
                "source_label": "Press",
                "eis_score": dims.get("eis_score"),
                "eis": dims.get("eis"),
                "clinical_score": dims.get("clinical_score"),
                "financial_score": dims.get("financial_score"),
                "corporate_score": dims.get("corporate_score"),
                "market_access_score": dims.get("market_access_score"),
                "market_access_notes": dims.get("market_access_notes"),
                "taxonomy_dimensions": dims.get("taxonomy_dimensions"),
                "taxonomy_review_flags": dims.get("taxonomy_review_flags"),
                "taxonomy_method": dims.get("taxonomy_method"),
                "taxonomy_version": dims.get("taxonomy_version"),
                "taxonomy_audit": dims.get("taxonomy_audit"),
                "heuristic_rev": dims.get("heuristic_rev"),
                "section": "top",
                "found_at": _now_iso(),
            }
        )
        if not _is_article_seen(doc, fp):
            _mark_row_seen(
                doc,
                {
                    "id": iid,
                    "article_fp": fp,
                    "story_cluster": ck,
                    "ticker": ticker,
                    "title": title,
                    "link": link,
                    "published_at": ed,
                    "event_date": ed,
                },
                status="staged",
            )
    if rows:
        try:
            _write(doc)
        except Exception:
            pass
    return rows


def _staged_rows_for_top_tickers(
    doc: dict[str, Any],
    tickers: list[str],
) -> list[dict[str, Any]]:
    """Reuse staged universe / manual rows when live Top fetch is empty."""
    prio = {t.upper() for t in tickers}
    out: list[dict[str, Any]] = []
    seen_title: set[str] = set()
    pools: list[Any] = []
    pools.extend(doc.get("items") or [])
    pools.extend(doc.get(_USER_ANALYSES_KEY) or [])
    for it in pools:
        if not isinstance(it, dict):
            continue
        if it.get("dismissed") or it.get("migrated_to_eis"):
            continue
        if str(it.get("status") or "").strip().lower() == "migrated":
            continue
        tk = str(it.get("ticker") or "").strip().upper()
        if tk not in prio:
            continue
        title = str(it.get("title") or it.get("summary_10w") or "").strip()
        link = str(it.get("link") or it.get("source_ref") or "").strip()
        if not title or not link.startswith("http"):
            continue
        key = title.lower()
        if key in seen_title:
            continue
        seen_title.add(key)
        row = dict(it)
        row["ticker"] = tk
        row["title"] = title[:240]
        row["link"] = link[:500]
        row["section"] = "top"
        row["source_kind"] = row.get("source_kind") or "press"
        row["source_label"] = row.get("source_label") or "Press"
        out.append(row)
    out.sort(
        key=lambda i: (
            abs(float(i.get("eis_score") or 0.0)),
            str(i.get("event_date") or i.get("found_at") or ""),
        ),
        reverse=True,
    )
    return out[: max(3 * len(tickers), 6)]


def build_top_news(
    priority_tickers: list[str] | None,
    *,
    force: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """
    Top News for Daily News box: all ★ attention tickers (client-selected).
    Press releases + digested SEC 8-K findings, each scored, each with a
    reference link. Momentum↑ only affects client-side ordering of the ★ list.
    """
    tickers = _normalize_priority_tickers(priority_tickers)
    doc = _read()
    rn = _rome_now(now)
    if not tickers:
        # Empty client priority → leave existing Top alone (UI may briefly
        # race with an empty list; wiping erased CRDL/NTHI mid-session).
        out = load_daily_news()
        out["ok"] = True
        out["top_count"] = len(out.get("top_news") or [])
        out["skipped_empty_priority"] = True
        return out
    if (
        not force
        and tickers
        and doc.get("top_news_tickers") == tickers
        and doc.get("top_news_hour_bucket") == _rome_hour_bucket(rn)
        and isinstance(doc.get(_TOP_NEWS_CACHE_KEY), list)
        and doc.get(_TOP_NEWS_CACHE_KEY)
    ):
        out = load_daily_news()
        out["ok"] = True
        out["skipped_top"] = True
        return out

    # Only a couple of desks may hit Google News at once. Everyone else gets
    # the staged box immediately so the thread pool stays free for other users.
    if not _top_news_slots.acquire(blocking=False):
        out = load_daily_news()
        out["ok"] = True
        out["skipped_busy"] = True
        out["top_count"] = len(out.get("top_news") or [])
        return out
    try:
        return _build_top_news_locked(tickers, doc, rn)
    finally:
        _top_news_slots.release()


_top_news_slots = threading.BoundedSemaphore(2)
_TOP_NEWS_BUDGET_S = 8.0


def _build_top_news_locked(
    tickers: list[str],
    doc: dict[str, Any],
    rn: datetime,
) -> dict[str, Any]:
    companies = _company_map()
    rows: list[dict[str, Any]] = []
    deadline = time.monotonic() + _TOP_NEWS_BUDGET_S
    for tk in tickers:
        if time.monotonic() > deadline:
            break
        co = companies.get(tk) or tk
        rows.extend(_press_rows_for_ticker(tk, co, now=rn))
        rows.extend(_recent_8k_digests_for_ticker(tk, co, now=rn))

    # Always merge staged / previous Top for these ★ tickers so a thin or
    # empty live fetch cannot erase headlines already known in the window.
    today = rn.date().isoformat()
    merged = list(rows)
    merged.extend(
        r
        for r in _staged_rows_for_top_tickers(doc, tickers)
        if _row_visible_on_desk(r, today=today)
    )
    prev = doc.get(_TOP_NEWS_CACHE_KEY)
    if isinstance(prev, list):
        prio_set = {t.upper() for t in tickers}
        merged.extend(
            r
            for r in prev
            if isinstance(r, dict)
            and str(r.get("ticker") or "").strip().upper() in prio_set
            and str(r.get("link") or "").strip()
            and _row_visible_on_desk(r, today=today)
        )

    live_n = len(rows)
    rows = [
        r
        for r in _dedupe_desk_rows(merged, doc=doc, today=today)
        if str(r.get("link") or r.get("source_ref") or "").strip()
        and str(r.get("title") or r.get("summary_10w") or "").strip()
        and _row_visible_on_desk(r, today=today)
    ]
    kept_previous = len(rows) > live_n

    doc[_TOP_NEWS_CACHE_KEY] = rows
    doc["top_news_updated_at"] = _now_iso()
    doc["top_news_tickers"] = tickers
    doc["top_news_hour_bucket"] = _rome_hour_bucket(rn)
    doc["updated_at"] = _now_iso()
    _write(doc)
    try:
        cache_staged_daily_news_to_clinical(now=rn)
    except Exception as exc:
        logger.debug("Top news clinical pre-cache failed: %s", exc)
    out = load_daily_news()
    out["ok"] = True
    out["top_count"] = len(rows)
    if kept_previous:
        out["kept_previous_top"] = True
    logger.info(
        "Daily News top_news tickers=%s items=%s kept_previous=%s",
        len(tickers),
        len(rows),
        kept_previous,
    )
    # Warm briefs so testers open cache-hit modals without waiting on Gemini.
    if rows:
        _spawn_brief_prefetch(rows)
    return out


def run_daily_news_search(
    *,
    force: bool = False,
    now: datetime | None = None,
    priority_tickers: list[str] | None = None,
) -> dict[str, Any]:
    """
    09:00 + hourly: search latest news/press for Catalyst universe and stage
    highlights. Interest-watchlist tickers are always in this universe. Dated
    catalysts in new articles are injected into the guidance calendar as they
    arrive. Also writes pending EIS events into the clinical pre-CD snapshot
    cache so Deep Dive can show them before Migrate → EIS.
    Full migrate (pending→confirmed EIS cards) remains manual via
    migrate_daily_news_to_eis (Daily News box button).
    Optional priority_tickers also refresh the Top News (★ + momentum) block.
    """
    rn = _rome_now(now)
    # Weekdays only (align with Catalyst desk)
    if not force and rn.weekday() >= 5:
        return {"ok": False, "reason": "weekend", "count": 0}

    bucket = _rome_hour_bucket(rn)
    doc = _read()
    # New Rome day → prune desk lists to freshness window (older → Deep Dive)
    if doc.get("rome_date") != rn.date().isoformat():
        today_iso = rn.date().isoformat()
        prev_items = [
            i
            for i in (doc.get("items") or [])
            if isinstance(i, dict)
            and (
                (
                    i.get("status") == "migrated"
                    and str(i.get("migrated_at") or "")[:10]
                    >= (rn.date() - timedelta(days=2)).isoformat()
                )
                or _row_is_desk_fresh(i, today=today_iso)
            )
        ]
        keep_meta = {
            k: doc.get(k)
            for k in (
                "last_migrate_at",
                _SEEN_ARTICLES_KEY,
                _BRIEFS_CACHE_KEY,
            )
            if k in doc
        }
        keep_top = _filter_desk_fresh(doc.get(_TOP_NEWS_CACHE_KEY), today=today_iso)
        keep_analyses = _filter_desk_fresh(
            doc.get(_USER_ANALYSES_KEY),
            today=today_iso,
        )
        prev_tickers = doc.get("top_news_tickers") if keep_top else []
        doc = {
            "rome_date": today_iso,
            "items": prev_items,
            _TOP_NEWS_CACHE_KEY: keep_top,
            "top_news_updated_at": doc.get("top_news_updated_at") if keep_top else None,
            "top_news_tickers": prev_tickers if isinstance(prev_tickers, list) else [],
            "top_news_hour_bucket": None,
            _USER_ANALYSES_KEY: keep_analyses,
            **keep_meta,
        }

    if not force and doc.get("hour_bucket") == bucket and doc.get("last_search_at"):
        if priority_tickers:
            build_top_news(priority_tickers, force=force, now=rn)
        out = load_daily_news()
        out["ok"] = True
        out["skipped_search"] = True
        return out

    companies = _company_map()
    tickers = _universe_tickers()
    # Put priority tickers first so Top ★ names are always scanned.
    prio = _normalize_priority_tickers(priority_tickers)
    if prio:
        tickers = list(dict.fromkeys([*prio, *tickers]))[:_MAX_TICKERS]
    existing = {
        str(i.get("id")): i
        for i in (doc.get("items") or [])
        if isinstance(i, dict) and i.get("id")
    }
    new_count = 0
    new_rows: list[dict[str, Any]] = []

    for tk in tickers:
        co = companies.get(tk) or tk
        try:
            headlines = _fetch_company_news(tk, co)
        except Exception as exc:
            logger.debug("Daily news fetch %s failed: %s", tk, exc)
            continue
        for h in headlines:
            title = str(h.get("title") or "").strip()
            if not title:
                continue
            ed = str(h.get("event_date") or "").strip()[:10]
            today_iso = rn.date().isoformat()
            cutoff = _desk_fresh_cutoff_iso(today=today_iso)
            # Freshness window; undated live RSS stamped as found today.
            if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", ed):
                ed = today_iso
            elif ed < cutoff or ed > today_iso:
                continue
            iid = _item_id(tk, title, ed)
            link = _best_openable_news_url(h)
            gnews = str(h.get("gnews_link") or "").strip()
            if not gnews and _is_google_news_shell_url(str(h.get("link") or "")):
                gnews = str(h.get("link") or "").strip()
            fp = _article_fingerprint(ticker=tk, title=title, url=link, item_id=iid)
            ck = _story_cluster_key(ticker=tk, title=title, day=ed)
            if _is_article_seen(doc, fp) or _is_cluster_known(doc, ck):
                continue
            if _is_article_passed(
                doc, fp=fp, cluster=ck, ticker=tk, title=title, day=ed
            ):
                continue
            if iid in existing and existing[iid].get("status") == "migrated":
                continue
            if iid in existing and existing[iid].get("status") == "staged":
                continue
            summary = str(h.get("summary") or "")[:500]
            dims = _dimension_scores(title, summary)
            row = {
                "id": iid,
                "article_fp": fp,
                "story_cluster": ck,
                "ticker": tk,
                "company": co,
                "title": title[:240],
                "summary": summary,
                "link": link,
                "gnews_link": gnews[:500] if gnews else "",
                "event_date": ed,
                "published_at": _headline_published_iso(h, fallback_day=ed),
                "source": str(h.get("source") or "google_news_rss"),
                "source_kind": "press",
                "source_label": "Press",
                "found_at": _now_iso(),
                "found_hour": rn.hour,
                "hour_bucket": bucket,
                "eis_score": dims.get("eis_score"),
                "eis": dims.get("eis"),
                "clinical_score": dims.get("clinical_score"),
                "financial_score": dims.get("financial_score"),
                "corporate_score": dims.get("corporate_score"),
                "market_access_score": dims.get("market_access_score"),
                "market_access_notes": dims.get("market_access_notes"),
                "taxonomy_dimensions": dims.get("taxonomy_dimensions"),
                "taxonomy_review_flags": dims.get("taxonomy_review_flags"),
                "taxonomy_method": dims.get("taxonomy_method"),
                "taxonomy_version": dims.get("taxonomy_version"),
                "taxonomy_audit": dims.get("taxonomy_audit"),
                "status": "staged",
                "migrated_at": None,
            }
            existing[iid] = row
            _mark_row_seen(doc, row, status="staged")
            new_count += 1
            new_rows.append(row)
            try:
                _push_news_dates_to_calendar(row)
            except Exception as exc:
                logger.debug("Daily news calendar inject %s failed: %s", tk, exc)

    items = list(existing.values())
    # Prefer today's staged first in storage order
    items.sort(
        key=lambda i: (
            0 if i.get("status") == "staged" else 1,
            str(i.get("found_at") or ""),
        ),
        reverse=True,
    )
    doc.update(
        {
            "rome_date": rn.date().isoformat(),
            "updated_at": _now_iso(),
            "last_search_at": _now_iso(),
            "last_search_hour": rn.hour,
            "hour_bucket": bucket,
            "items": items,
            "highlights": _build_highlights(items),
            "tickers_scanned": len(tickers),
            "new_count": new_count,
        }
    )
    _write(doc)
    if prio:
        build_top_news(prio, force=True, now=rn)
    try:
        cache_staged_daily_news_to_clinical(now=rn)
    except Exception as exc:
        logger.debug("Daily news clinical pre-cache after search failed: %s", exc)
    outcome_added = 0
    try:
        from catalyst_outcome_feed import stage_catalyst_outcomes_into_daily_news

        oc = stage_catalyst_outcomes_into_daily_news(force=force, now=rn)
        outcome_added = int(oc.get("catalyst_outcomes_added") or 0)
    except Exception as exc:
        logger.debug("Catalyst outcome stage failed: %s", exc)
    out = load_daily_news()
    out["ok"] = True
    out["new_count"] = new_count
    out["catalyst_outcomes_added"] = outcome_added
    logger.info(
        "Daily news search hour=%s new=%s staged=%s outcomes=%s (migrate is manual)",
        rn.hour,
        new_count,
        out.get("count"),
        outcome_added,
    )
    # Warm investor briefs in background so opening the modal is cache-hit.
    if new_rows:
        _spawn_brief_prefetch(new_rows)
    return out


def due_for_daily_news_morning(
    now_local: datetime,
    *,
    last_date: date | None,
    at_hour: int = 9,
    at_minute: int = 0,
) -> bool:
    if now_local.weekday() >= 5:
        return False
    if last_date == now_local.date():
        return False
    return (now_local.hour, now_local.minute) >= (at_hour, at_minute)


def _clamp_score(v: Any, default: float = 0.0) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        n = default
    if not (n == n):  # NaN
        n = default
    return max(-2.0, min(2.0, round(n, 2)))


# Corporate-finance language only — never bare "offering" / "raises" / "shelf" / "ATM".
_FIN_NEG_RE = re.compile(
    r"(?i)\b("
    r"(?:public|secondary|follow[- ]on|registered\s+direct|at[- ]the[- ]market)\s+offering|"
    r"(?:equity|share|stock|common\s+stock)\s+offering|"
    r"offering\s+of\s+(?:common\s+)?(?:shares|stock|securities)|"
    r"(?:share|equity|stock)\s+dilut\w*|"
    r"dilutive\s+(?:financ\w*|offering|issuance)|"
    r"warrant\s+exercise|down\s*round"
    r")\b"
)
_FIN_POS_RE = re.compile(
    r"(?i)\b("
    r"revenue\s+(?:beat|growth|increase)|sales\s+(?:beat|growth)|"
    r"guidance\s+raise|earnings\s+beat|non[- ]dilutive|"
    r"cash\s+runway\s+(?:extend\w*|to\s+20\d{2})"
    r")\b"
)
_FIN_TOPIC_RE = re.compile(
    r"(?i)\b("
    r"cash\s+runway|shelf\s+registration|ATM\s+program|at[- ]the[- ]market\s+"
    r"(?:offering|program|facility)|"
    r"convertible\s+(?:note|debt|preferred)|private\s+placement|"
    r"financ(?:ing|e)\s+(?:round|facility|agreement)|"
    r"gross\s+proceeds|net\s+proceeds|equity\s+raise|capital\s+raise"
    r")\b"
)
_ACCESS_SIGNAL_RE = re.compile(
    r"(?i)\b("
    r"post[- ]market|real[- ]world|uptake|formulary|reimburs\w*|payer|"
    r"script\s+growth|commercial\s+launch|patient\s+access|"
    r"prescription\s+(?:growth|volume|trends?)|"
    r"safety\s+update|efficacy\s+update"
    r")\b"
)


def _has_corporate_finance_signal(text: str) -> bool:
    blob = text or ""
    return bool(
        _FIN_NEG_RE.search(blob)
        or _FIN_POS_RE.search(blob)
        or _FIN_TOPIC_RE.search(blob)
    )


def _score_financial_dimension(text: str) -> float:
    """Fin score only from real corporate-finance events (never English 'offering')."""
    blob = text or ""
    if _FIN_NEG_RE.search(blob):
        return -1.0
    if _FIN_POS_RE.search(blob):
        return 1.0
    if _FIN_TOPIC_RE.search(blob):
        return 0.5
    return 0.0


def _calibrate_dimension_scores(
    scored: dict[str, Any],
    text: str = "",
    *,
    force_paper: bool = False,
) -> dict[str, Any]:
    """
    Paper flag + light cleanup only.
    Dimension scores come from eis_taxonomy_scoring — do not overwrite with
    legacy regex/sentiment when taxonomy_dimensions is present.
    Scientific papers always get a clinical baseline; company-affiliated
    authors get ×1.5 on clinical.
    """
    out = dict(scored)
    blob = text or " ".join(
        str(out.get(k) or "")
        for k in (
            "summary_10w",
            "summary_long",
            "source_excerpt",
            "abstract",
            "results_note",
        )
    )
    is_paper = bool(
        force_paper
        or out.get("is_paper")
        or _looks_like_academic_paper(blob)
    )
    if is_paper:
        out["is_paper"] = True

    # Taxonomy path: scores already deterministic — leave them alone
    if isinstance(out.get("taxonomy_dimensions"), dict):
        if is_paper:
            try:
                from eis_taxonomy_scoring import (
                    apply_company_affiliation_boost,
                    ensure_paper_clinical_baseline,
                )

                out = ensure_paper_clinical_baseline(out, text=blob)
                out = apply_company_affiliation_boost(
                    out, company_affiliated=bool(out.get("company_affiliated"))
                )
            except Exception as exc:
                logger.debug("paper clinical calibrate skipped: %s", exc)
        return out

    # Legacy fallback (pre-taxonomy rows / paper digest without scores yet)
    if is_paper:
        try:
            from eis_taxonomy_scoring import score_scientific_paper

            dims = score_scientific_paper(
                blob,
                company_affiliated=bool(out.get("company_affiliated")),
                use_ai=False,
            )
            for k, v in dims.items():
                if v is not None:
                    out[k] = v
            out["is_paper"] = True
            return out
        except Exception as exc:
            logger.debug("paper score_scientific_paper skipped: %s", exc)

    from eis_taxonomy_scoring import score_article_dimensions

    dims = score_article_dimensions(blob, use_ai=False)
    for k in (
        "clinical_score",
        "financial_score",
        "corporate_score",
        "market_access_score",
        "market_access_notes",
        "eis_score",
        "eis",
        "taxonomy_version",
        "taxonomy_method",
        "taxonomy_dimensions",
        "taxonomy_review_flags",
        "taxonomy_audit",
    ):
        if out.get(k) is None and dims.get(k) is not None:
            out[k] = dims.get(k)
        elif k.startswith("taxonomy_") and dims.get(k) is not None:
            out[k] = dims.get(k)
        elif k in (
            "clinical_score",
            "financial_score",
            "corporate_score",
            "market_access_score",
            "eis_score",
            "eis",
            "market_access_notes",
        ):
            # Prefer fresh taxonomy over stale free-judgment numbers
            out[k] = dims.get(k)
    return out


def _ten_word_summary(text: str) -> str:
    words = re.findall(r"[A-Za-z0-9$%./+-]+", text or "")
    if not words:
        return "No usable content to summarize."
    clipped = " ".join(words[:10])
    return clipped if len(words) <= 10 else clipped


_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _clean_fetched_text(text: str) -> str:
    """Decode HTML entities and normalize whitespace (fixes visible &nbsp;)."""
    import html as html_lib

    s = text or ""
    # Multi-pass: RSS often stores &amp;nbsp; → &nbsp; → \xa0
    for _ in range(3):
        prev = s
        s = html_lib.unescape(s)
        if s == prev:
            break
    s = (
        s.replace("\xa0", " ")
        .replace("\u200b", "")
        .replace("\u2011", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    s = re.sub(r"(?i)&nbsp;?", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Drop trailing publisher labels common in Google News / Stock Titan titles
    s = re.sub(
        r"\s*(?:[-–|]\s*)?(?:Stock Titan|Yahoo Finance|GlobeNewswire|PR Newswire|"
        r"Business Wire|Seeking Alpha|Benzinga)\s*$",
        "",
        s,
        flags=re.I,
    ).strip()
    return s


def _clean_paper_text(text: str) -> str:
    """Normalize journal/PDF text without destroying section line breaks."""
    import html as html_lib

    s = text or ""
    for _ in range(3):
        prev = s
        s = html_lib.unescape(s)
        if s == prev:
            break
    s = (
        s.replace("\xa0", " ")
        .replace("\u200b", "")
        .replace("\u2011", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    s = re.sub(r"(?i)&nbsp;?", " ", s)
    try:
        from catalyst_extractor import repair_pdf_text

        s = repair_pdf_text(s)
    except Exception:
        s = s.replace("\r\n", "\n").replace("\r", "\n")
        s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


_JOURNAL_HOST_HINTS = (
    "ahajournals.org",
    "doi.org",
    "ncbi.nlm.nih.gov",
    "pubmed",
    "science.org",
    "nature.com",
    "cell.com",
    "thelancet.com",
    "nejm.org",
    "jamanetwork.com",
    "wiley.com",
    "springer.com",
    "biomedcentral.com",
)


def _is_academic_journal_url(url: str) -> bool:
    from urllib.parse import urlparse

    host = (urlparse(url).netloc or "").lower()
    return any(h in host for h in _JOURNAL_HOST_HINTS)


_PMID_URL_RE = re.compile(
    r"(?i)(?:https?://)?(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov/(?:pubmed/)?(\d{5,12})\b"
)


def _pmid_from_url(url: str) -> str:
    m = _PMID_URL_RE.search(str(url or "").strip())
    return m.group(1) if m else ""


def _section_summaries_from_pubmed_hit(hit: dict[str, Any]) -> list[dict[str, str]]:
    """Map PubMed AbstractText labels → Intro / Results / Discussion cards only."""
    secs = (
        hit.get("abstract_sections")
        if isinstance(hit.get("abstract_sections"), dict)
        else {}
    )
    abs_t = str(hit.get("abstract") or "").strip()
    sections_raw = {
        "Introduction": str(
            secs.get("introduction") or secs.get("background") or ""
        ).strip(),
        "Methods": str(secs.get("methods") or secs.get("method") or "").strip(),
        "Results": str(secs.get("results") or "").strip(),
        "Discussion": str(
            secs.get("discussion")
            or secs.get("conclusion")
            or secs.get("conclusions")
            or ""
        ).strip(),
        "Conclusions": str(
            secs.get("conclusion") or secs.get("conclusions") or ""
        ).strip(),
        "Abstract": abs_t,
    }
    return _sanitize_paper_section_cards(
        _build_paper_chapter_summaries(sections_raw, abstract=abs_t)
    )


def _fetch_pubmed_brief_seed(url: str) -> dict[str, Any] | None:
    """
    Copy abstract (+ labeled sections + pub date) from NCBI eutils for a PubMed URL.
    PubMed HTML often needs cookies / is chrome-only — eutils AbstractText is the source of truth.
    """
    pmid = _pmid_from_url(url)
    if not pmid:
        return None
    try:
        from pubmed_eutils_fetch import _efetch_pubmed_articles

        hits = _efetch_pubmed_articles([pmid])
    except Exception as exc:
        logger.debug("pubmed efetch seed failed pmid=%s: %s", pmid, exc)
        return None
    if not hits:
        return None
    h = hits[0] if isinstance(hits[0], dict) else {}
    abs_t = str(h.get("abstract") or "").strip()
    if len(abs_t) < 40:
        return None
    return {
        "pmid": pmid,
        "title": str(h.get("title") or "").strip(),
        "abstract": abs_t[:3500],
        "section_summaries": _section_summaries_from_pubmed_hit(h),
        "pub_year": str(h.get("pub_year") or "").strip(),
        "pub_date": str(h.get("pub_date") or "").strip(),
    }


def _find_user_analysis_row(item_id: str) -> dict[str, Any] | None:
    iid = str(item_id or "").strip()
    if not iid:
        return None
    doc = _read()
    for row in doc.get(_USER_ANALYSES_KEY) or []:
        if isinstance(row, dict) and str(row.get("id") or "") == iid:
            return row
    return None


_TITLE_TOPIC_STOP = frozenset(
    {
        "journal",
        "original",
        "research",
        "american",
        "heart",
        "association",
        "clinical",
        "trial",
        "efficacy",
        "safety",
        "phase",
        "study",
        "results",
        "original research",
        "manufactured",
        "pharmaceutically",
    }
)


def _title_topic_tokens(title: str) -> set[str]:
    out: set[str] = set()
    for w in re.findall(r"[A-Za-z]{5,}", title or ""):
        wl = w.lower()
        if wl in _TITLE_TOPIC_STOP:
            continue
        out.add(wl)
    return out


def _content_matches_title(content: str, title: str) -> bool:
    tokens = _title_topic_tokens(title)
    if len(tokens) < 2:
        return True
    low = (content or "").lower()
    hits = sum(1 for t in tokens if t in low)
    # Disease tokens are high-signal — one shared hit is enough.
    disease_hit = any(
        d in tokens and d in low
        for d in ("alzheimer", "dravet", "parkinson", "sclerosis")
    )
    if disease_hit:
        return True
    return hits >= max(1, min(2, len(tokens) // 2))


_TITLE_INDICATION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Alzheimer's disease", re.compile(r"(?i)\balzheimer'?s?\b")),
    ("Dravet syndrome", re.compile(r"(?i)\bdravet\b")),
    ("Parkinson's disease", re.compile(r"(?i)\bparkinson'?s?\b")),
    ("multiple sclerosis", re.compile(r"(?i)\bmultiple\s+sclerosis\b")),
    ("SMA", re.compile(r"(?i)\bspinal\s+muscular\s+atrophy\b|\b\bsma\b")),
)

_TITLE_PRODUCT_BLOCK = frozenset(
    {
        "FDA",
        "EMA",
        "NMPA",
        "MHRA",
        "PMDA",
        "PDUFA",
        "NASDAQ",
        "NYSE",
        "CEO",
        "USA",
        "CHINA",
        "WEEKLY",
        "HOME",
        "PRESS",
        "NEWS",
        "SHAREHOLDER",
        "ALERT",
        "ANNO",
        "ANNOUNCES",
        "INVESTIGATION",
        "INVESTORS",
        "INVESTOR",
        "GROSSMAN",
        "BRONSTEIN",
        "GEWIRTZ",
        "REVIEW",
        "NATIONAL",
        "CLASS",
        "ACTION",
        "SECURITIES",
        "LAWSUIT",
    }
)


def _extract_indication_from_title(title: str) -> str | None:
    t = title or ""
    for label, pat in _TITLE_INDICATION_PATTERNS:
        if pat.search(t):
            return label
    return _extract_indication(t)


def _extract_product_from_title(title: str) -> str | None:
    """Brand / INN from the headline only (never from a mismatched body)."""
    t = title or ""
    for m in re.finditer(r"\b([A-Z]{4,}[A-Z0-9-]*)\b", t):
        brand = m.group(1)
        if brand in _TITLE_PRODUCT_BLOCK:
            continue
        if re.fullmatch(r"[A-Z]{1,5}", brand) and brand.isupper():
            # Short all-caps → usually ticker (BIIB); skip ≤5 char tickers
            if len(brand) <= 5:
                continue
        return brand
    m = re.search(
        r"\b([a-z][a-z0-9-]{5,}(?:umab|mab|ciclib|tinib|fenib|ersen|otide))\b",
        t,
        re.I,
    )
    if m:
        return m.group(1)
    return None


def _extract_product_from_title_aligned_body(title: str, body: str) -> str | None:
    """If the title lacks a brand, take a drug name only from title-matching sentences."""
    direct = _extract_product_from_title(title)
    if direct:
        return direct
    for sent in re.split(r"(?<=[.!?])\s+|\n+", body or ""):
        s = sent.strip()
        if len(s) < 40 or not _content_matches_title(s, title):
            continue
        facts = _extract_clinical_facts(s)
        prod = str(facts.get("product") or "").strip()
        if prod and (
            prod.lower() in (title or "").lower() or _content_matches_title(prod, title)
        ):
            return prod[:80]
        # Brand in a matching sentence (LEQEMBI in China approval PR)
        for m in re.finditer(r"\b([A-Z]{4,}[A-Z0-9-]*)\b", s):
            brand = m.group(1)
            if brand in _TITLE_PRODUCT_BLOCK or len(brand) <= 5:
                continue
            return brand
        m = re.search(
            r"\b([a-z][a-z0-9-]{5,}(?:umab|mab|ciclib|tinib|fenib|ersen|otide))\b",
            s,
            re.I,
        )
        if m:
            return m.group(1)
    return None


def _align_brief_to_headline(
    brief: dict[str, Any],
    title: str,
    body: str = "",
) -> dict[str, Any]:
    """
    Drop product / indication / key_points that belong to another franchise
    when they do not match the article headline (e.g. BIIB zorevunersen brief
    on a LEQEMBI / Alzheimer's China-approval headline).
    """
    if not isinstance(brief, dict):
        return brief
    title_s = _clean_fetched_text(title or "")
    if len(title_s) < 12:
        return brief
    out = dict(brief)
    title_ind = _extract_indication_from_title(title_s)
    title_product = _extract_product_from_title_aligned_body(title_s, body or "")

    prod = str(out.get("product") or "").strip()
    ind = str(out.get("indication") or "").strip()
    article_blob = f"{prod} {ind}".strip()
    if article_blob and not _content_matches_title(article_blob, title_s):
        out["product"] = title_product
        out["indication"] = title_ind
        # Phase/study were almost certainly for the wrong asset
        if out.get("phase") and not _content_matches_title(str(out.get("phase")), title_s):
            out["phase"] = None
        if out.get("study") and not _content_matches_title(str(out.get("study")), title_s):
            out["study"] = None
    else:
        if not prod and title_product:
            out["product"] = title_product
        if (not ind or not _content_matches_title(ind, title_s)) and title_ind:
            out["indication"] = title_ind

    kps = out.get("key_points") if isinstance(out.get("key_points"), list) else []
    if kps:
        kept = [str(p) for p in kps if _content_matches_title(str(p), title_s)]
        if not kept:
            kept = [title_s[:220]]
            for sent in re.split(r"(?<=[.!?])\s+|\n+", body or ""):
                s = sent.strip()
                if len(s) < 40 or not _content_matches_title(s, title_s):
                    continue
                kept.append(s[:220])
                if len(kept) >= 4:
                    break
        out["key_points"] = kept[:6]

    krs = out.get("key_results") if isinstance(out.get("key_results"), list) else []
    if krs:
        kept_kr: list[dict[str, Any]] = []
        for kr in krs:
            if not isinstance(kr, dict):
                continue
            det = str(kr.get("detail") or "")
            if det and _content_matches_title(det, title_s):
                kept_kr.append(kr)
        out["key_results"] = kept_kr

    detail = str(out.get("detail_summary") or "").strip()
    if detail and not _content_matches_title(detail, title_s):
        # Prefer a title-aligned lede from matching body sentences
        bits: list[str] = []
        if title_product or title_ind:
            bits.append(
                " · ".join(x for x in (title_product, title_ind) if x) + "."
            )
        for sent in re.split(r"(?<=[.!?])\s+|\n+", body or ""):
            s = sent.strip()
            if len(s) < 50 or not _content_matches_title(s, title_s):
                continue
            bits.append(s)
            if sum(len(b) for b in bits) > 280:
                break
        if bits:
            out["detail_summary"] = " ".join(bits)[:600]
        else:
            out["detail_summary"] = title_s[:280]

    return out


def _sentence_looks_garbled(sentence: str) -> bool:
    s = sentence or ""
    if re.search(r"\ban\s+sidered\b", s, re.I):
        return True
    if re.search(r"\b\w{2,5}-\s+(?:Pharmaceutically|medication|background|history)\b", s):
        return True
    if len(re.findall(r"\b\w{2,}-\s+\w", s)) >= 2:
        return True
    if re.search(r"\b(?:syndrome|patients?)\s+\w{1,4}-\s+[A-Z]", s):
        return True
    return False


def _strip_article_chrome(text: str) -> str:
    """Remove Stock Titan / news-site chrome so briefs start on real content."""
    s = _clean_fetched_text(text or "")
    if not s:
        return ""
    # Drop leading nav / login boilerplate
    s = re.sub(
        r"(?i)^(STOCK TITAN\s+)?(Login\s+Sign up\s+)+0?\s*(Home\s+News\s+\w+\s+)?",
        "",
        s,
    ).strip()
    s = re.sub(
        r"(?i)^(?:Australia|North America|World|Europe|Asia|Login|Videos)\s+",
        "",
        s,
    )
    s = re.sub(
        r"(?i)^Investing News Network\b[^.…]{0,80}?(?=Companies|Press|Cardiol|[A-Z][a-z]+ Therapeutics)",
        "",
        s,
    )
    # BioSpace / INN / aggregator chrome — wipe leading nav tokens repeatedly
    for _ in range(50):
        nxt = re.sub(
            r"(?i)^(Companies|Press Releases?|Private Placements|SUBSCRIBE|Menu|"
            r"Show Search|Search Query|Submit Search|Podcasts|Events|Jobs|"
            r"Hotbeds|Advertise|Talent Solutions|Post Jobs|Submit a Press Release|"
            r"Submit an Event|Drug Development|Cell and Gene Therapy|"
            r"All News\s*&\s*Releases|Reports?\s*&?\s*Guides?|Market Outlook(?:\s+Reports)?|"
            r"Investing Guides|Button Resource|Precious Metals|Battery Metals|Base Metals|"
            r"Energy|Critical Minerals|Tech|Life Science|"
            r"Pharmaceutical(?:\s+(?:Market|News|Stocks))?|"
            r"News|FDA|Manufacturing|Deals|Business|Job Trends|Cancer|Opinions|"
            r"Career Advice|NextGen|Best Places to Work|Employer Resources)\s+",
            "",
            s,
        ).strip()
        if nxt == s:
            break
        s = nxt
    s = re.sub(
        r"(?i)\bRhea-AI\s+(?:Impact|Sentiment|Summary)\b(?:\s*\([^)]*\))?",
        " ",
        s,
    )
    s = re.sub(
        r"(?i)\bTags\b\s+(?:English|Arabic|French|German|Italian|Korean|Spanish)"
        r"(?:\s+(?:English|Arabic|French|German|Italian|Korean|Spanish))*",
        " ",
        s,
    )
    s = re.sub(
        r"(?i)\bTags\s+See more from StockTitan\b.{0,220}?(?=\d{2}/\d{2}/\d{4}|Recommendation|TOKYO|--\(|BUSINESS WIRE)",
        " ",
        s,
    )
    s = re.sub(
        r"(?i)\bSee more from StockTitan in Google Search and AI answers\b.{0,160}",
        " ",
        s,
    )
    s = re.sub(r"\s+", " ", s).strip()
    # Hard cut to real headline / PR lede only while chrome still leads.
    if _looks_like_nav_chrome(s[:160]) or re.match(
        r"(?i)^(press releases?|news|subscribe|menu)\b", s
    ):
        for pat in (
            # H1-style: Company … Files/Announces … (non-greedy so verb is not eaten)
            r"(?i)\b([A-Z][^.!?]{12,200}?\b(?:Files?|Announces?|Reports?|Completes?|"
            r"Receives?|Prices?|Closes?|Presents?|Publishes?)\b[^.!?]{10,180})",
            r"(?i)\b([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,4}\s+"
            r"(?:Inc\.?|Therapeutics|Pharma(?:ceuticals)?)\s*"
            r"\((?:NASDAQ|NYSE|TSX|TSXV|AMEX)\s*:\s*[A-Z.]{1,6}\).{120,})",
            r"(?i)\b((?:[A-Z][A-Za-z0-9.&'-]+\s+){1,6}"
            r"(?:Inc\.?|Therapeutics|Pharma(?:ceuticals)?|Corp\.?|Ltd\.?)?\s*"
            r"(?:today\s+)?(?:announced|announces|reported|reports|filed|files)\b.{120,})",
        ):
            m = re.search(pat, s)
            if m and len(m.group(1)) > 80:
                s = m.group(1).strip()
                break
    # Truncate legal / risk-factor / company-bio / FAQ / Stock Titan AI widgets
    cut = re.search(
        r"(?i)\b(?:Forward[- ]Looking Statements|These risks and uncertainties|"
        r"Cautionary Note|About Cardiol Therapeutics|About the Company|"
        r"About\s+[A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3}\b|"
        r"Media Contact:|Investor Contact:|"
        r"AI-generated questions|How Rhea-AI works|AI-generated analysis|"
        r"View All Latest News|Related\s+[A-Z]|"
        # Stock Titan Rhea / Argus market-reaction appendices
        r"\.\.\.\s*Positive\b|Positive\s+Acquisition\b|Negative\s+None\b|"
        r"Key Figures\b|Key Terms\b|Previous Acquisition Reports\b|"
        r"Analysis\s+The stock moved\b|"
        r"In the (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        r"[a-z]*\s+\d{1,2}\s+session\b|"
        r"\$[\d.]+B\s+Market Cap\b|"
        r"close to close\b|\d+(?:\.\d+)?x\s+rel\.\s+volume\b)",
        s,
    )
    if cut and cut.start() > 280:
        s = s[: cut.start()].strip()
    # Drop Stock Titan Argus / market-reaction widgets glued into the body
    s = re.sub(
        r"(?i)\b(?:News Market Reaction|Market Context|Argus\b|Loading\.+\s*)[^.!]{0,200}",
        " ",
        s,
    )
    s = re.sub(r"\s+", " ", s).strip()
    # Stock Titan often concatenates the same headline twice with no period
    for n in range(60, min(220, len(s) // 2 + 1)):
        a = s[:n]
        if not a.endswith(" "):
            continue
        if s[n : n + n] == a:
            rest = s[n + n :].lstrip()
            s = (a.strip() + ". " + rest).strip() if rest else a.strip()
            break
    return s[:_ANALYZE_TEXT_MAX]


def _looks_like_nav_chrome(text: str) -> bool:
    """True when a 'title' is site chrome (BioSpace Subscribe/Menu/Search…)."""
    t = _clean_fetched_text(text or "")
    if not t:
        return False
    if re.match(
        r"(?i)^(subscribe|menu|show\s+search|search\s+query|submit\s+search)\b",
        t,
    ):
        return True
    head = t[:220]
    hits = len(
        re.findall(
            r"(?i)\b(subscribe|show\s+search|search\s+query|submit\s+search|"
            r"\bmenu\b|sign\s+in|log\s*in|cookie\s+settings|accept\s+all|"
            r"talent\s+solutions|post\s+jobs)\b",
            head,
        )
    )
    if hits >= 2 and len(t) < 180:
        return True
    if hits >= 3 and not re.search(
        r"(?i)\b(announc|filed|files|reports?|phase\s*[123]|million|fda|"
        r"therapeutics|prospectus|offering)\b",
        t,
    ):
        return True
    return False


def _title_from_news_url_slug(url: str) -> str | None:
    """Recover a readable headline from a publisher URL slug."""
    from urllib.parse import urlparse, unquote

    path = unquote(urlparse(url or "").path or "").rstrip("/")
    if not path:
        return None
    slug = path.split("/")[-1]
    slug = re.sub(r"\.(html?|aspx?|php)$", "", slug, flags=re.I)
    if len(slug) < 24 or "-" not in slug:
        return None
    words = [w for w in slug.replace("-", " ").split() if w]
    if len(words) < 5:
        return None
    # Title-case small words lightly for display
    small = {
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "for",
        "to",
        "in",
        "on",
        "by",
        "with",
        "from",
        "us",
    }
    out_words: list[str] = []
    for i, w in enumerate(words):
        lw = w.lower()
        if i > 0 and lw in small:
            out_words.append(lw)
        elif re.fullmatch(r"\d+(?:m|k|b)?", lw):
            out_words.append(w.upper() if lw.endswith(("m", "k", "b")) else w)
        else:
            out_words.append(lw[:1].upper() + lw[1:])
    return " ".join(out_words)[:240]


def _clean_recovered_headline(text: str) -> str:
    s = _clean_fetched_text(text or "")
    s = re.sub(
        r"(?i)\s+(?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+\d{1,2},?\s+20\d{2}\s*"
        r"(?:\|\s*)?(?:\d+\s*min(?:ute)?s?\s*read)?.*$",
        "",
        s,
    ).strip()
    s = re.sub(
        r"(?i)\s+(?:Twitter|LinkedIn|Facebook|Email|Print)\b.*$",
        "",
        s,
    ).strip()
    s = re.sub(r"\s*[-|–]\s*BioSpace\s*$", "", s, flags=re.I).strip()
    return s[:240]


def _headline_verb_re(*, start: bool = False) -> re.Pattern[str]:
    """Match '... Company Files/Announces …' headlines without eating the verb as a word."""
    verb = (
        r"(?:Files?|Announces?|Reports?|Completes?|Receives?|Prices?|Closes?|"
        r"Presents?|Publishes?|Enters?|Signs?)"
    )
    body = rf"([A-Z][^.!?\n]{{12,200}}?\b{verb}\b[^.!?\n]{{5,180}})"
    if start:
        return re.compile(rf"(?i)^\s*{body}")
    return re.compile(rf"(?i)\b{body}")


def _recover_article_headline(body: str, *, url: str = "", title_hint: str = "") -> str | None:
    """When list/title is nav chrome, recover H1-like headline from body or URL."""
    hint = _clean_fetched_text(title_hint or "")
    if hint and not _looks_like_nav_chrome(hint) and len(hint) >= 28:
        return _clean_recovered_headline(hint)

    raw = _clean_fetched_text(body or "")
    m0 = _headline_verb_re(start=True).search(raw)
    if m0:
        cand = _clean_recovered_headline(m0.group(1))
        if cand and not _looks_like_nav_chrome(cand) and len(cand) >= 28:
            return cand

    cleaned = _strip_article_chrome(body or "")
    m = _headline_verb_re(start=False).search(cleaned[:700])
    if m:
        cand = _clean_recovered_headline(m.group(1))
        if cand and not _looks_like_nav_chrome(cand) and len(cand) >= 28:
            return cand

    slug = _title_from_news_url_slug(url)
    if slug:
        return _clean_recovered_headline(slug)

    # Last resort: first substantive sentence that looks like news, not boilerplate
    for sent in re.split(r"(?<=[.!?])\s+", cleaned):
        s = _clean_recovered_headline(sent)
        if not (40 <= len(s) <= 240) or _looks_like_nav_chrome(s):
            continue
        if re.match(
            r"(?i)^(common\s+shares|debt\s+securities|copies\s+of|no\s+securities|"
            r"once\s+a\s+receipt|the\s+filing\s+of|in\s+connection\s+with|"
            r"preliminary\s+short\s+form)\b",
            s,
        ):
            continue
        if re.search(
            r"(?i)\b(files?|announc|reports?|fda|phase|prospectus|offering|"
            r"therapeutics|trial)\b",
            s,
        ):
            return s
    return None

def _unwrap_google_news_url(
    url: str, *, timeout_s: float = 20.0, allow_http: bool = True
) -> str:
    """
    Google News RSS article links do not contain the publisher page.
    Try base64/protobuf decode of the article id, then the post-2024
    batchexecute resolver, then HTML scrape of redirects.
    """
    u = (url or "").strip()
    if "news.google.com" not in u.lower():
        return u

    def _ok_publisher(pub: str) -> bool:
        try:
            from urllib.parse import urlparse

            host = (urlparse(pub).netloc or "").lower()
        except Exception:
            return False
        if not host or not pub.startswith("http"):
            return False
        if _is_google_news_shell_url(pub):
            return False
        blocked = (
            "google.",
            "gstatic.",
            "youtube.",
            "blogger.",
            "googleusercontent.",
            "schema.org",
            "w3.org",
            "example.com",
        )
        if any(b in host for b in blocked):
            return False
        return not _is_junk_news_host(host)

    m = re.search(r"/articles/([^?\s#]+)", u)
    if m:
        token = m.group(1)
        try:
            import base64
            from urllib.parse import unquote

            token = unquote(token)
            pad = "=" * ((4 - len(token) % 4) % 4)
            raw = base64.urlsafe_b64decode(token + pad)
            # Prefer the longest non-Google http(s) string embedded in the blob
            found = re.findall(rb"https?://[^\x00-\x1f\x7f-\xff\"'<>]{12,500}", raw)
            pubs = []
            for fb in found:
                pub = fb.decode("utf-8", errors="ignore").rstrip("%").rstrip("\\")
                if _ok_publisher(pub):
                    pubs.append(pub)
            if pubs:
                pubs.sort(key=len, reverse=True)
                return pubs[0]
        except Exception:
            pass

    try:
        from urllib.parse import parse_qs, unquote, urlparse

        qs = parse_qs(urlparse(u).query)
        for key in ("url", "q"):
            for cand in qs.get(key) or []:
                cand = unquote(cand or "").strip()
                if _ok_publisher(cand):
                    return cand
    except Exception:
        pass

    if not allow_http:
        return u

    # Post-2024 Google News: article id is opaque — resolve via batchexecute RPC.
    decoded = _decode_google_news_batchexecute(u, timeout_s=min(timeout_s, 14.0))
    if decoded and _ok_publisher(decoded):
        return decoded

    try:
        import requests
        from bs4 import BeautifulSoup
        from urllib.parse import unquote, parse_qs, urlparse

        r = requests.get(u, timeout=timeout_s, headers=_HTTP_HEADERS, allow_redirects=True)
        final = str(r.url or "")
        if _ok_publisher(final):
            return final
        soup = BeautifulSoup(r.text or "", "html.parser")
        for a in soup.find_all("a", href=True):
            href = str(a.get("href") or "").strip()
            if href.startswith("./") or href.startswith("/articles/"):
                continue
            if "google.com/url" in href:
                try:
                    q = parse_qs(urlparse(href).query).get("q") or []
                    if q and _ok_publisher(unquote(q[0])):
                        return unquote(q[0])
                except Exception:
                    pass
                continue
            if _ok_publisher(href):
                return href
        meta = soup.find("meta", attrs={"http-equiv": re.compile("refresh", re.I)})
        if meta and meta.get("content"):
            mm = re.search(r"url=(.+)", str(meta.get("content")), re.I)
            if mm:
                cand = mm.group(1).strip().strip("'\"")
                if _ok_publisher(cand):
                    return cand
    except Exception as exc:
        logger.debug("google news unwrap failed: %s", exc)
    return u


def _decode_google_news_batchexecute(url: str, *, timeout_s: float = 12.0) -> str | None:
    """
    Resolve news.google.com/rss/articles/CBMi… → publisher URL (post-2024).
    Fetches signature/timestamp from the splash page, then calls Fbv4je batchexecute.
    """
    u = (url or "").strip()
    m = re.search(r"/(?:rss/)?articles/([^?\s#/]+)", u)
    if not m:
        return None
    from urllib.parse import unquote, quote

    article_id = unquote(m.group(1))
    if not article_id:
        return None
    try:
        import requests

        html = ""
        cookies = {
            "CONSENT": "YES+",
            "SOCS": "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg",
        }
        for prefix in ("articles", "rss/articles"):
            try:
                r = requests.get(
                    f"https://news.google.com/{prefix}/{article_id}",
                    timeout=timeout_s,
                    headers=_HTTP_HEADERS,
                    cookies=cookies,
                    allow_redirects=True,
                )
                if r.status_code < 400 and r.text and "consent.google.com" not in (
                    r.url or ""
                ):
                    html = r.text
                    if re.search(r'data-n-a-sg="', html):
                        break
            except Exception:
                continue
        if not html:
            return None
        sg = re.search(r'data-n-a-sg="([^"]+)"', html)
        ts = re.search(r'data-n-a-ts="([^"]+)"', html)
        if not sg or not ts or not str(ts.group(1)).isdigit():
            return None
        request_body = [
            "garturlreq",
            [
                [
                    "en-US",
                    "US",
                    ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"],
                    None,
                    None,
                    1,
                    1,
                    "US:en",
                    None,
                    1,
                    None,
                    None,
                    None,
                    None,
                    None,
                    0,
                    1,
                ],
                "en-US",
                "US",
                1,
                [1, 1, 1],
                1,
                1,
                None,
                0,
                0,
                None,
                0,
            ],
            article_id,
            int(ts.group(1)),
            sg.group(1),
        ]
        f_req = json.dumps(
            [[["Fbv4je", json.dumps(request_body, separators=(",", ":")), None, "generic"]]],
            separators=(",", ":"),
        )
        r2 = requests.post(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            data=f"f.req={quote(f_req)}",
            timeout=timeout_s,
            headers={
                **_HTTP_HEADERS,
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
        )
        text = r2.text or ""
        # Response is )]}'\n\n<json>
        if "\n\n" in text:
            text = text.split("\n\n", 1)[1]
        rows = json.loads(text)
        decoded = json.loads(rows[0][2])
        if (
            isinstance(decoded, list)
            and len(decoded) >= 2
            and decoded[0] == "garturlres"
            and isinstance(decoded[1], str)
            and decoded[1].startswith("http")
        ):
            return decoded[1]
    except Exception as exc:
        logger.debug("google news batchexecute decode failed: %s", exc)
    return None


def _publisher_from_title(title: str) -> str | None:
    m = re.search(r"\s[-–|]\s+([A-Za-z0-9][A-Za-z0-9 .,&'’.-]{1,60})\s*$", title or "")
    if not m:
        return None
    pub = m.group(1).strip()
    if len(pub) < 3 or pub.lower() in {"yahoo", "google", "reuters finance"}:
        return pub
    return pub


_PUBLISHER_HOSTS: dict[str, str] = {
    "the national law review": "natlawreview.com",
    "national law review": "natlawreview.com",
    "natlawreview": "natlawreview.com",
    "simply wall st": "simplywall.st",
    "simplywall.st": "simplywall.st",
    "globe newswire": "globenewswire.com",
    "globenewswire": "globenewswire.com",
    "pr newswire": "prnewswire.com",
    "business wire": "businesswire.com",
    "investing news network": "investingnews.com",
    "investing news": "investingnews.com",
    "streetwise reports": "streetwisereports.com",
    "stock titan": "stocktitan.net",
    "biospace": "biospace.com",
    "ad-hoc-news": "ad-hoc-news.de",
    "ad-hoc-news.de": "ad-hoc-news.de",
    "adhoc news": "ad-hoc-news.de",
    "stocktwits": "stocktwits.com",
    "seeking alpha": "seekingalpha.com",
    "seekingalpha": "seekingalpha.com",
}


def _publisher_host_from_title(title: str) -> str | None:
    """Map 'The National Law Review' (and similar) to a real publisher host."""
    pub = (_publisher_from_title(title) or "").strip().lower()
    if not pub:
        return None
    if pub in _PUBLISHER_HOSTS:
        return _PUBLISHER_HOSTS[pub]
    host = re.sub(r"^www\.", "", pub)
    if "." in host and " " not in host and re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", host):
        return host
    for name, mapped in _PUBLISHER_HOSTS.items():
        if name in pub or pub in name:
            return mapped
    return None


def _is_junk_news_host(host: str, title: str = "") -> bool:
    """Parked / concatenated domains like www.bbnxshareholderalert….com."""
    h = (host or "").lower().split(":")[0].removeprefix("www.").strip(".")
    if not h or "." not in h:
        return True
    name, _, _tld = h.rpartition(".")
    name = name.split(".")[-1]
    if len(name) >= 40 and h.count(".") <= 1:
        return True
    if re.fullmatch(r"[a-z0-9]{25,}\.(com|net|org|info|biz)", h):
        return True
    if title and len(name) >= 22:
        compact = re.sub(r"[^a-z0-9]", "", title.lower())
        host_alnum = re.sub(r"[^a-z0-9]", "", name)
        if compact and host_alnum[:16] in compact:
            return True
    return False


# JS/bot walls — HTTP GET from the desk returns 403/404; search a syndicated copy.
_BLOCKED_NEWS_HOSTS = frozenset(
    {
        "stocktwits.com",
        "seekingalpha.com",
        "marketscreener.com",
        "investors.com",
    }
)


def _is_blocked_news_host(host: str) -> bool:
    h = (host or "").lower().split(":")[0].removeprefix("www.").strip(".")
    if not h:
        return False
    return any(h == b or h.endswith("." + b) for b in _BLOCKED_NEWS_HOSTS)


def _news_url_is_junk(url: str, title: str = "") -> bool:
    try:
        from urllib.parse import urlparse

        return _is_junk_news_host(urlparse(url or "").netloc or "", title)
    except Exception:
        return False


def _is_google_news_shell_url(url: str) -> bool:
    """RSS / consent / batchexecute URLs that browsers open as Google 400."""
    u = (url or "").strip().lower()
    if not u:
        return False
    if "news.google.com" in u or "consent.google.com" in u:
        return True
    if "batchexecute" in u or "/_/dotssplashui/" in u:
        return True
    return False


def _looks_like_article_url(url: str) -> bool:
    try:
        from urllib.parse import urlparse

        path = (urlparse(url).path or "").strip("/")
    except Exception:
        return False
    if not path:
        return False
    leaf = path.split("/")[0].lower()
    if leaf in {"news", "index.html", "home", "en", "us"} and "/" not in path:
        return False
    return "/" in path or len(path) > 16


def _best_openable_news_url(h: dict[str, Any] | None) -> str:
    """Publisher article if we have one; never prefer a Google News shell."""
    row = h if isinstance(h, dict) else {}
    for key in ("resolved_link", "source_url", "link"):
        u = str(row.get(key) or "").strip()
        if (
            u.startswith(("http://", "https://"))
            and not _is_google_news_shell_url(u)
            and not _news_url_is_junk(u)
            and _looks_like_article_url(u)
        ):
            return u[:500]
    gnews = str(row.get("gnews_link") or row.get("link") or "").strip()
    if gnews.startswith("http") and _is_google_news_shell_url(gnews):
        try:
            unwrapped = _unwrap_google_news_url(
                gnews, timeout_s=8.0, allow_http=False
            )
        except Exception:
            unwrapped = ""
        if (
            unwrapped
            and unwrapped.startswith("http")
            and not _is_google_news_shell_url(unwrapped)
            and not _news_url_is_junk(unwrapped)
        ):
            return unwrapped[:500]
    return str(row.get("link") or "")[:500]


def _is_shareholder_alert(title: str, body: str = "") -> bool:
    blob = f"{title or ''}\n{body or ''}"
    return bool(
        re.search(
            r"(?i)\b("
            r"shareholder\s+alert|investor\s+alert|"
            r"class\s+action(?:\s+lawsuit)?|"
            r"securities\s+(?:class\s+action|investigation|litigation)|"
            r"lead\s+plaintiff(?:\s+deadline)?|"
            r"plaintiff\s+deadline|"
            r"remind(?:s|ing)?\s+.{0,40}investors?\s+of\s+.{0,40}deadline|"
            r"investigat(?:es|ing|ion)\s+(?:potential\s+)?(?:claims|violations)"
            r")\b",
            blob,
        )
    ) or bool(
        re.search(
            r"(?i)\b(bronstein|gewirtz and grossman|pomerantz\s+llp|"
            r"rosen\s+law\s+firm|kahn\s+swick|glancy\s+prongay|"
            r"kaplan\s+fox|the\s+rosen\s+law|schall\s+law|"
            r"levi\s+&\s+korsinsky|portnoy\s+law)\b",
            blob,
        )
        and re.search(
            r"(?i)\b(shareholder|class\s+action|securities|plaintiff|investors?)\b",
            blob,
        )
    )


def _shareholder_alert_firm(title: str, body: str = "") -> str | None:
    blob = f"{title or ''}\n{(body or '')[:800]}"
    m = re.search(
        r"(?i)(?:shareholder\s+alert|investor\s+alert|class\s+action)\s*[:\-–]\s*"
        r"([A-Z][A-Za-z0-9,&.'’\s-]{4,80}?(?:LLC|LLP|P\.?C\.?|PC)\b)",
        blob,
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip(" ,")
    m = re.search(
        r"\b([A-Z][A-Za-z]+(?:,\s+[A-Z][A-Za-z]+){0,3}\s+and\s+[A-Z][A-Za-z]+,\s+LLC)\b",
        blob,
    )
    if m:
        return m.group(1).strip()
    m = re.search(
        r"(?i)\b("
        r"Kaplan\s+Fox(?:\s+&\s+Kilsheimer)?|"
        r"Bronstein,\s*Gewirtz\s+and\s+Grossman|"
        r"Pomerantz\s+LLP|"
        r"Rosen\s+Law\s+Firm|"
        r"Glancy\s+Prongay|"
        r"Levi\s+&\s+Korsinsky|"
        r"Schall\s+Law\s+Firm"
        r")\b",
        blob,
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    return None


def _fetch_article_via_title_search(
    title: str, *, timeout_s: float | None = None
) -> tuple[str, str | None]:
    """
    When Google News unwrap fails, search the open web for the headline and
    fetch the first non-Google publisher hit (DuckDuckGo HTML).
    Returns (text, error). On success error is None; winning URL is not returned
    here — use _enrich_thin_news_body for URL capture.
    """
    text, _url, err = _search_and_fetch_article(title, timeout_s=timeout_s)
    return text, err


def _search_and_fetch_article(
    title: str, *, timeout_s: float | None = None
) -> tuple[str, str | None, str | None]:
    """Return (text, publisher_url, error)."""
    q = re.sub(r"\s+", " ", (title or "")).strip()
    if len(q) < 24:
        return "", None, "title_too_short"
    pub = _publisher_from_title(q)
    core = re.sub(r"\s[-–|]\s+[A-Za-z0-9].*$", "", q).strip() or q
    # Drop trailing truncated fragments ("… results for")
    core = re.sub(r"\b(for|the|a|an|of|and|with)\s*$", "", core, flags=re.I).strip()
    study_codes = re.findall(r"\b([A-Z]{3,}(?:-[A-Z0-9]{1,8})+)\b", core)
    queries = [f'"{core[:110]}"']
    mapped_host = _publisher_host_from_title(q)
    if mapped_host and _is_blocked_news_host(mapped_host):
        mapped_host = None
        # Blocked wall (Seeking Alpha / Stocktwits): prefer open wires / free mirrors.
        queries.insert(
            0,
            f'"{core[:70]}" (site:globenewswire.com OR site:prnewswire.com OR '
            f"site:businesswire.com OR site:stocktitan.net OR site:biospace.com)",
        )
        # Drop publisher suffix for a cleaner open-web hit.
        core_no_pub = re.sub(
            r"\s[-–|]\s+(Seeking Alpha|Stocktwits|MarketScreener).*$",
            "",
            core,
            flags=re.I,
        ).strip()
        if core_no_pub and len(core_no_pub) >= 28:
            queries.insert(0, f'"{core_no_pub[:90]}"')
    if mapped_host:
        queries.insert(0, f'"{core[:90]}" site:{mapped_host}')
    if pub:
        queries.insert(0 if not mapped_host else 1, f'"{core[:90]}" "{pub}"')
        # Domain-like publisher (simplywall.st) → site: search
        host = re.sub(r"^www\.", "", pub.strip().lower())
        if "." in host and " " not in host and re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", host):
            if host != mapped_host and not _is_blocked_news_host(host):
                queries.insert(0, f'"{core[:80]}" site:{host}')
    if study_codes:
        sc = study_codes[0]
        queries.insert(
            0,
            f"{sc} Cardiol Therapeutics topline OR results (site:globenewswire.com OR site:prnewswire.com OR site:cardiolrx.com OR stocktitan)",
        )
    if re.search(r"\b(phase|topline|trial|pdufa|shelf|fireside)\b", core, re.I):
        queries.append(f'"{core[:80]}" (press release OR newsroom)')
    # Quoted full headline often misses syndicated copies (Stocktwits vs Reuters).
    colon_cut = re.sub(
        r":\s*[A-Z]{1,5}(?:,\s*[A-Z]{1,5})+\b.*$", "", core
    ).strip()
    if colon_cut and len(colon_cut) >= 28 and colon_cut.lower() != core.lower():
        queries.append(colon_cut[:110])
    queries.append(re.sub(r'["\']', "", core[:90]))

    try:
        import requests
        from bs4 import BeautifulSoup
        from urllib.parse import unquote, urlparse, quote_plus

        to = float(timeout_s if timeout_s is not None else 20.0)
        snippets: list[str] = []

        def _collect_candidates(html: str) -> list[str]:
            soup = BeautifulSoup(html or "", "html.parser")
            out: list[str] = []
            for a in soup.select("a.result__a, a.result-link, a[href]"):
                href = str(a.get("href") or "")
                if "uddg=" in href:
                    m = re.search(r"uddg=([^&]+)", href)
                    if m:
                        href = unquote(m.group(1))
                if "bing.com/ck/a" in href and "u=a1" in href:
                    # Bing redirect — skip opaque
                    continue
                if not href.startswith("http"):
                    continue
                host = (urlparse(href).netloc or "").lower().removeprefix("www.")
                if any(
                    b in host
                    for b in (
                        "google.",
                        "duckduckgo.",
                        "bing.com",
                        "youtube.",
                        "facebook.",
                        "twitter.",
                    )
                ):
                    continue
                # Spam / parked domains from bad DDG hits
                # (e.g. biogenwinschinaapprovalforathomeweekly….com)
                if _is_junk_news_host(host, q) or _is_blocked_news_host(host):
                    continue
                out.append(href)
                if len(out) >= 8:
                    break
            for node in soup.select(
                ".result__snippet, .result__body, .b_caption p, .b_algo p"
            ):
                sn = " ".join((node.get_text(" ", strip=True) or "").split())
                if len(sn) >= 60:
                    snippets.append(sn)
            return out

        preferred_host = mapped_host
        if pub and not preferred_host:
            host = re.sub(r"^www\.", "", pub.strip().lower())
            if "." in host and " " not in host and re.match(
                r"^[a-z0-9.-]+\.[a-z]{2,}$", host
            ):
                if not _is_blocked_news_host(host):
                    preferred_host = host

        candidates: list[str] = []
        last_err: str | None = None
        for query in queries[:6]:
            try:
                r = requests.post(
                    "https://html.duckduckgo.com/html/",
                    data={"q": query},
                    timeout=to,
                    headers={
                        **_HTTP_HEADERS,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                )
                if r.status_code >= 400:
                    last_err = f"search_http_{r.status_code}"
                    continue
                candidates.extend(_collect_candidates(r.text or ""))
            except Exception as exc:
                last_err = str(exc)[:120]
            if not candidates:
                # Bing HTML fallback
                try:
                    br = requests.get(
                        "https://www.bing.com/search",
                        params={"q": query},
                        timeout=to,
                        headers=_HTTP_HEADERS,
                    )
                    if br.status_code < 400:
                        soup = BeautifulSoup(br.text or "", "html.parser")
                        for a in soup.select("li.b_algo h2 a, h2 a"):
                            href = str(a.get("href") or "")
                            if href.startswith("http"):
                                host = (urlparse(href).netloc or "").lower()
                                if "bing." in host or "microsoft." in host:
                                    continue
                                if _is_junk_news_host(host, q) or _is_blocked_news_host(
                                    host
                                ):
                                    continue
                                candidates.append(href)
                            if len(candidates) >= 6:
                                break
                        for node in soup.select(".b_caption p, .b_algo p"):
                            sn = " ".join((node.get_text(" ", strip=True) or "").split())
                            if len(sn) >= 60:
                                snippets.append(sn)
                except Exception as exc:
                    last_err = last_err or str(exc)[:120]
            if candidates:
                break

        # Prefer wire / company IR hosts first; publisher from title wins hardest.
        def _rank(url: str) -> int:
            host = (urlparse(url).netloc or "").lower().removeprefix("www.")
            score = 0
            if preferred_host and (
                host == preferred_host or host.endswith("." + preferred_host)
            ):
                score += 50
            for i, pref in enumerate(
                (
                    "globenewswire.com",
                    "prnewswire.com",
                    "businesswire.com",
                    "cardiolrx.com",
                    "stocktitan.net",
                    "simplywall.st",
                )
            ):
                if pref in host:
                    score += 20 - i
            if study_codes and study_codes[0].lower().replace("-", "") in url.lower().replace(
                "-", ""
            ):
                score += 15
            return score

        candidates = list(dict.fromkeys(candidates))
        candidates.sort(key=_rank, reverse=True)
        # When the headline names a publisher domain, only try that host first.
        if preferred_host:
            preferred = [
                c
                for c in candidates
                if preferred_host
                in (urlparse(c).netloc or "").lower().removeprefix("www.")
            ]
            if preferred:
                candidates = preferred + [c for c in candidates if c not in preferred]
        for href in candidates:
            text, err = _fetch_url_text_direct(href)
            text = _strip_article_chrome(text or "")
            if not text or len(text) < 280 or err:
                continue
            if study_codes:
                low = text.lower()
                ok = any(
                    c.lower() in low or c.split("-")[0].lower() in low
                    for c in study_codes
                )
                if not ok:
                    continue
            if not _body_matches_headline(q, text):
                continue
            return text, href, None
        blob = _clean_fetched_text(" ".join(dict.fromkeys(snippets)))
        if len(blob) >= 180 and _body_matches_headline(q, blob):
            return blob[: min(len(blob), 4000)], None, None
        return "", None, last_err or "title_search_no_body"
    except Exception as exc:
        return "", None, str(exc)[:200]


def _news_body_needs_enrichment(body: str, *, title: str = "") -> bool:
    """True when pasted/snippet text is too thin for a Google-quality brief."""
    b = _clean_fetched_text(body or "")
    t = _clean_fetched_text(title or "")
    if len(b) < 320:
        return True
    if re.search(r"\b(for|the|a|an|of|and|with)\s*$", b, re.I):
        return True
    if t and b.lower().startswith(t[:50].lower()) and len(b) < len(t) + 80:
        return True
    # Heuristic polarity-only fragments
    if re.fullmatch(
        r"(?i)positive\s+phase\s*[i1-3]+\s+[A-Z0-9-]+\s+topline\.?",
        b.strip(),
    ):
        return True
    return False


def _slugify_news_headline(title: str) -> str:
    core = re.sub(r"\s[-–|]\s+[A-Za-z0-9].*$", "", title or "").strip()
    # Investing News keeps trademark tokens in the path (…cardiolrx-tm-in-…)
    core = re.sub(r"[\u2122\u00ae]", " tm ", core)
    core = re.sub(r"\((TM|R|SM)\)", r" \1 ", core, flags=re.I)
    # Alzheimer's → alzheimers (not alzheimer-s)
    core = re.sub(r"[''`´]", "", core)
    core = re.sub(r"[^a-zA-Z0-9]+", "-", core).strip("-").lower()
    return core[:160]


def _guess_publisher_urls_from_title(title: str) -> list[str]:
    """Common biotech wire / aggregator URL shapes from a Google News headline."""
    slug = _slugify_news_headline(title)
    if len(slug) < 20:
        return []
    pub = (_publisher_from_title(title) or "").lower()
    host = _publisher_host_from_title(title) or ""
    urls: list[str] = []
    if host == "natlawreview.com" or "national law" in pub:
        urls.extend(
            [
                f"https://natlawreview.com/press-releases/{slug}",
                f"https://www.natlawreview.com/press-releases/{slug}",
                f"https://natlawreview.com/article/{slug}",
                f"https://www.natlawreview.com/article/{slug}",
            ]
        )
        return urls
    # Simply Wall St — path ends with /news/{slug} under the equity page
    if "simplywall" in pub or "simply wall" in pub or host == "simplywall.st":
        # Equity-scoped paths (US biotech nasdaq) — common for BIIB / peers
        m_tk = re.search(r"\(([A-Z]{1,5})\)", title or "")
        tk = (m_tk.group(1).lower() if m_tk else "").strip()
        # Real Simply Wall paths often truncate trailing words (…-alzheimer)
        # and hard-cut the slug at 60 chars mid-token (…-smmt-investment… → …-smm).
        slug_alts = [slug]
        if len(slug) > 60:
            hard = slug[:60].rstrip("-")
            if hard and hard not in slug_alts and len(hard) >= 20:
                slug_alts.append(hard)
        for cut in (
            re.sub(r"-treatment$", "", slug),
            re.sub(r"-s-treatment$", "", slug),
            re.sub(r"s-treatment$", "", slug),
            re.sub(r"-alzheimers-treatment$", "-alzheimer", slug),
            re.sub(r"-alzheimer-s-treatment$", "-alzheimer", slug),
        ):
            if cut and cut not in slug_alts and len(cut) >= 20:
                slug_alts.append(cut)
        # Prefer shorter (truncated) slugs first — full slug almost always 404s.
        slug_alts = sorted(set(slug_alts), key=lambda s: (len(s), s))
        if tk:
            # Company slug: "Biogen (BIIB) …" or "… Summit Therapeutics (SMMT) …"
            # Limit to 1–2 Title-Case tokens immediately before (TICKER) so mid-headline
            # verbs ("… Shift Summit Therapeutics …") are not swallowed.
            co = ""
            m_co = re.search(
                rf"\b([A-Z][A-Za-z0-9&.-]{{1,30}}"
                rf"(?:\s+[A-Z][A-Za-z0-9&.-]{{1,30}})?)\s*"
                rf"\({re.escape(tk.upper())}\)",
                title or "",
            )
            if m_co:
                co = re.sub(r"[^a-z0-9]+", "-", m_co.group(1).lower()).strip("-")
            # Prefer equity+company paths first (canonical Simply Wall news URLs).
            if co:
                for s in slug_alts:
                    urls.append(
                        f"https://simplywall.st/stocks/us/pharmaceuticals-biotech/nasdaq-{tk}/{co}/news/{s}"
                    )
            for s in slug_alts:
                urls.append(
                    f"https://simplywall.st/stocks/us/pharmaceuticals-biotech/nasdaq-{tk}/news/{s}"
                )
        for s in slug_alts:
            urls.append(f"https://simplywall.st/news/{s}")
    # Investing News Network (common Google News host for CRDL / biotech PRs)
    if "investing news" in pub or "inn" in pub or (
        "simplywall" not in pub and "simply wall" not in pub
    ):
        urls.append(f"https://investingnews.com/{slug}/")
        # Some wires drop the trailing trademark token
        slug_no_tm = re.sub(r"-tm(?=-|$)", "", slug)
        if slug_no_tm != slug and len(slug_no_tm) >= 20:
            urls.append(f"https://investingnews.com/{slug_no_tm}/")
    if "streetwise" in pub:
        urls.append(f"https://www.streetwisereports.com/article/{slug}")
    if "ad-hoc-news" in pub or host.endswith("ad-hoc-news.de"):
        urls.extend(
            [
                f"https://www.ad-hoc-news.de/boerse/news/corporate-news/{slug}",
                f"https://www.ad-hoc-news.de/news/{slug}",
            ]
        )
    return urls


def _study_codes_from_text(text: str) -> list[str]:
    return [
        c.upper()
        for c in re.findall(r"\b([A-Z]{3,}(?:-[A-Z0-9]{1,8})+)\b", text or "", re.I)
    ]


def _study_roots(codes: list[str]) -> list[str]:
    roots: list[str] = []
    for c in codes:
        root = c.split("-")[0].upper()
        if root and root not in roots:
            roots.append(root)
        if c not in roots:
            roots.append(c)
    return roots


def _headline_mentions_study(headline: str, codes: list[str]) -> bool:
    if not codes:
        return True
    low = (headline or "").lower()
    return any(r.lower() in low for r in _study_roots(codes))


def _body_is_target_article(
    text: str,
    *,
    study_codes: list[str],
    want_topline: bool,
) -> bool:
    """Reject hub pages / wrong-story unwraps that only mention the trial in passing."""
    body = (text or "").strip()
    if len(body) < 400:
        return False
    low = body.lower()
    head = low[:2500]
    if study_codes:
        roots = [r.lower() for r in _study_roots(study_codes)]
        if not any(r in low for r in roots):
            return False
        # Prefer the study named early in the article, not only in related-links chrome
        if not any(r in head for r in roots):
            return False
    if want_topline:
        hard = bool(
            re.search(
                r"\b(p\s*[<=]\s*0?\.\d+|primary endpoint|n\s*=\s*\d+|ecv|gls|"
                r"extracellular volume|statistically significant|"
                r"topline results?|double[- ]blind)\b",
                low,
                re.I,
            )
        )
        soft = bool(re.search(r"\b(topline|endpoint|efficacy|phase\s*[i1-3])\b", head, re.I))
        if not (hard or soft):
            return False
    return True


def _enrich_search_queries(title: str, *, ticker: str = "") -> list[str]:
    """
    Build Google News queries that work even when Manual titles are truncated
    (…results for) or use a compound study code (ARCHER-CMF → ARCHER).
    """
    core = re.sub(r"\s[-–|]\s+[A-Za-z0-9].*$", "", title or "").strip()
    core = re.sub(r"\b(for|the|a|an|of|and|with)\s*$", "", core, flags=re.I).strip()
    codes = _study_codes_from_text(core)
    roots = [c.split("-")[0] for c in codes]
    company = ""
    m = re.match(
        r"^([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})",
        core,
    )
    if m:
        company = m.group(1).strip()
    phase = ""
    pm = re.search(r"\b(Phase\s*(?:[I1]{1,3}|[123]|IV|4)[abcABC]?)\b", core, re.I)
    if pm:
        phase = re.sub(r"\s+", " ", pm.group(1))
    product = ""
    prod_m = re.search(
        r"\b([A-Z][A-Za-z0-9]*(?:Rx|umab|ciclib|tinib))\b",
        core,
    )
    if prod_m:
        product = prod_m.group(1)
    want_topline = bool(re.search(r"\btopline\b", core, re.I))
    out: list[str] = []

    def _add(q: str) -> None:
        q = re.sub(r"\s+", " ", q).strip()
        if len(q) < 12 or q in out:
            return
        out.append(q)

    if company and roots:
        bits = [company, roots[0]]
        if phase:
            bits.append(phase)
        if want_topline:
            bits.append("topline")
        if product:
            bits.append(product)
        _add(" ".join(bits))
        _add(f"{company} {roots[0]} trial {product or ''} topline".strip())
    if roots and ticker:
        _add(f"{ticker} {roots[0]} topline results")
    if len(core) >= 28:
        _add(core[:100])
        if ticker:
            _add(f"{core[:90]} {ticker}")
    return out[:5]


def _enrich_via_google_news_rss(
    title: str, *, ticker: str = ""
) -> tuple[str, str | None, str | None]:
    """Use Google News RSS hits + publisher URL guesses to recover full PR text."""
    core = re.sub(r"\s[-–|]\s+[A-Za-z0-9].*$", "", title or "").strip()
    core = re.sub(r"\b(for|the|a|an|of|and|with)\s*$", "", core, flags=re.I).strip()
    if len(core) < 16:
        return "", None, "title_too_short"
    study_codes = _study_codes_from_text(core)
    want_topline = bool(re.search(r"\btopline\b", core, re.I))
    try:
        from press_release_fetch import _fetch_google_news_rss
    except Exception as exc:
        return "", None, str(exc)[:160]

    items: list[dict] = []
    seen_links: set[str] = set()
    for q in _enrich_search_queries(core, ticker=ticker):
        try:
            batch = _fetch_google_news_rss(q, max_items=6) or []
        except Exception:
            continue
        for it in batch:
            if not isinstance(it, dict):
                continue
            link = str(it.get("link") or "").strip()
            key = link or str(it.get("title") or "")
            if key in seen_links:
                continue
            seen_links.add(key)
            items.append(it)
        if len(items) >= 10:
            break

    if not items:
        return "", None, "google_news_enrich_empty"

    def _item_score(it: dict) -> int:
        ht = str(it.get("title") or "")
        sc = _score_headline_match(core, ht)
        if _headline_mentions_study(ht, study_codes):
            sc += 4
        if want_topline and re.search(r"\btopline\b", ht, re.I):
            sc += 3
        if re.search(r"\b(results?|endpoint)\b", ht, re.I):
            sc += 1
        # Deprioritize later corporate updates / conference promos
        if re.search(
            r"\b(year-end|conference|fireside|interview|financing|shelf)\b",
            ht,
            re.I,
        ):
            sc -= 3
        return sc

    items.sort(key=_item_score, reverse=True)
    last_err: str | None = None
    for it in items:
        ht = str(it.get("title") or "").strip()
        if study_codes and not _headline_mentions_study(ht, study_codes):
            continue
        if want_topline and not re.search(
            r"\b(topline|results?|endpoint|trial)\b", ht, re.I
        ):
            continue
        # 1) Publisher URL from headline slug (most reliable for archived PRs)
        for guess in _guess_publisher_urls_from_title(ht or core):
            text, err = _fetch_url_text_direct(guess)
            text = _strip_article_chrome(text or "")
            if text and _body_is_target_article(
                text, study_codes=study_codes, want_topline=want_topline
            ):
                return text, guess, None
            if err:
                last_err = err
        # 2) Google News link unwrap / fetch
        link = str(it.get("link") or "").strip()
        if link.startswith("http"):
            text, err = _fetch_url_text(
                link, title_hint=ht or core, ticker_hint=ticker
            )
            text = _strip_article_chrome(text or "")
            if text and _body_is_target_article(
                text, study_codes=study_codes, want_topline=want_topline
            ):
                return text, link, None
            if err:
                last_err = err
            elif text:
                last_err = "wrong_story_body"
    return "", None, last_err or "google_news_enrich_empty"


def _enrich_thin_news_body(
    *,
    title: str,
    ticker: str,
    body: str,
) -> tuple[str, str | None, str | None]:
    """
    Expand thin Manual / Google-News snippets by fetching the real article.
    Returns (body, resolved_url_or_None, err_or_None).
    """
    cur = _strip_article_chrome(body or "")
    if not _news_body_needs_enrichment(cur, title=title):
        return cur, None, None
    best = cur
    best_url: str | None = None
    last_err: str | None = None
    title_l = (title or cur[:120]).strip()
    study_codes = _study_codes_from_text(title_l)
    want_topline = bool(re.search(r"\btopline\b", title_l, re.I))

    def _ok(text: str) -> bool:
        return _body_is_target_article(
            text, study_codes=study_codes, want_topline=want_topline
        )

    # 1) Google News RSS + publisher slug (best for archived PRs like ARCHER)
    t0, u0, e0 = _enrich_via_google_news_rss(title_l, ticker=ticker or "")
    if t0 and _ok(t0):
        return t0, u0, None
    if e0:
        last_err = e0

    # 2) Open-web search with cleaned queries
    for q in _enrich_search_queries(title_l, ticker=ticker or ""):
        t2, u2, e2 = _search_and_fetch_article(q)
        if t2 and _ok(t2):
            return t2, u2, None
        if e2:
            last_err = last_err or e2

    tk = (ticker or "").strip().upper()
    if tk:
        # Prefer a cleaned headline for Stock Titan matching
        st_title = title_l
        for q in _enrich_search_queries(title_l, ticker=tk):
            if len(q) > len(st_title):
                st_title = q
                break
        t1, e1 = _fetch_via_stock_titan(tk, st_title)
        if t1 and _ok(t1) and len(t1) > len(best) + 40:
            best = t1
            best_url = f"https://www.stocktitan.net/news/{tk}/"
        elif e1:
            last_err = last_err or e1

    return best, best_url, (None if (best is not cur and _ok(best)) else last_err)


def _title_token_set(title: str) -> set[str]:
    stop = {
        "therapeutics",
        "inc",
        "ltd",
        "corp",
        "announces",
        "announce",
        "announced",
        "participate",
        "annual",
        "global",
        "stock",
        "titan",
        "news",
        "lets",
        "line",
        "with",
        "from",
        "that",
        "this",
        "will",
        "have",
        "into",
        "over",
        "under",
        "after",
        "before",
        "about",
        "new",
        "alert",
        "investors",
        "investor",
        "for",
        "that",
        "suffered",
        "approaching",
    }
    return {
        w.lower()
        for w in re.findall(r"[A-Za-z]{3,}", title or "")
        if w.lower() not in stop
    }


_HEADLINE_STORY_CUES = (
    (re.compile(r"(?i)\bclass\s+actions?\b"), re.compile(r"(?i)\bclass\s+actions?\b")),
    (re.compile(r"(?i)\bsecurities\s+fraud\b"), re.compile(r"(?i)\bsecurities\s+fraud\b|\bfraud\b")),
    (re.compile(r"(?i)\blawsuit\b|\blitigation\b"), re.compile(r"(?i)\blawsuit\b|\blitigation\b|\bcomplaint\b")),
    (re.compile(r"(?i)\bcourt\s+alert\b"), re.compile(r"(?i)\bcourt\b|\bclass\s+action\b|\blawsuit\b")),
    (re.compile(r"(?i)\bfda\s+clearance\b"), re.compile(r"(?i)\bfda\s+clearance\b|\b510\s*\(?k\)?\b|\bcleared\b")),
    (re.compile(r"(?i)\bfda\s+approv"), re.compile(r"(?i)\bfda\s+approv|\bapproved\b")),
    (re.compile(r"(?i)\bprimary\s+endpoint\b"), re.compile(r"(?i)\bprimary\s+endpoint\b")),
    (re.compile(r"(?i)\btopline\b"), re.compile(r"(?i)\btopline\b")),
    (re.compile(r"(?i)\boffering\b|\batm\b"), re.compile(r"(?i)\boffering\b|\batm\b|\bshelf\b")),
)


def _body_matches_headline(title: str, body: str) -> bool:
    """
    Guard against ticker press fallbacks that fetch a *different* BBNX story
    (e.g. Mint FDA PR when the card title is a securities class-action alert).
    """
    title_s = (title or "").strip()
    body_s = (body or "").strip()
    if not title_s:
        return True
    # Empty / tiny bodies are never a match for a real headline check.
    if len(body_s) < 80:
        return False
    blow = body_s[:5500]
    for title_rx, body_rx in _HEADLINE_STORY_CUES:
        if title_rx.search(title_s) and not body_rx.search(blow):
            return False
    qtoks = _title_token_set(title_s)
    # Drop very common issuer words that appear on every company PR
    qtoks -= {
        "beta",
        "bionics",
        "medical",
        "pharma",
        "pharmaceuticals",
        "therapeutics",
        "biosciences",
        "company",
        "shares",
        "stock",
    }
    # Generic verbs/nouns that appear on almost every PR — do not count as story match.
    weak = {
        "treatment",
        "treatments",
        "weekly",
        "wins",
        "home",
        "approval",
        "approves",
        "approved",
        "phase",
        "trial",
        "study",
        "data",
        "results",
        "patients",
        "patient",
        "drug",
        "medicine",
        "presents",
        "present",
        "long",
        "term",
    }
    # Ticker in parentheses never proves the right story.
    weak |= {w.lower() for w in re.findall(r"\(([A-Z]{1,5})\)", title_s)}
    strong = {t for t in qtoks if t not in weak and len(t) >= 4}
    low = blow.lower()
    if strong:
        strong_hits = sum(1 for t in strong if t in low)
        need_strong = 1 if len(strong) == 1 else min(2, len(strong))
        if strong_hits < need_strong:
            return False
        return True
    if len(qtoks) < 3:
        return True
    hits = sum(1 for t in qtoks if t in low)
    need = 3 if len(qtoks) >= 6 else 2
    return hits >= need


def _score_headline_match(query_title: str, candidate: str) -> int:
    qt = (query_title or "").lower()
    ct = (candidate or "").lower()
    if not qt or not ct:
        return 0
    qtoks = _title_token_set(query_title)
    ctoks = _title_token_set(candidate)
    score = len(qtoks & ctoks)
    for theme in (
        "shelf",
        "financing",
        "offering",
        "prospectus",
        "atm",
        "dilution",
        "fireside",
        "conference",
        "topline",
        "phase",
        "pdufa",
        "fda",
        "earnings",
        "fraud",
        "lawsuit",
        "litigation",
        "class",
        "action",
        "court",
        "settlement",
        "clearance",
        "deadline",
    ):
        if theme in qt and theme in ct:
            score += 4
    # Distinctive trial codes (ARCHER-CMF, MAvERIC, …) — hard preference
    q_codes = set(
        re.findall(r"\b([A-Z]{3,}(?:-[A-Z0-9]{1,8})+)\b", query_title or "", re.I)
    )
    c_codes = set(re.findall(r"\b([A-Z]{3,}(?:-[A-Z0-9]{1,8})+)\b", candidate or "", re.I))
    q_codes = {c.upper() for c in q_codes}
    c_codes = {c.upper() for c in c_codes}
    if q_codes:
        if q_codes & c_codes:
            score += 12
        else:
            # Also accept base acronym (ARCHER from ARCHER-CMF)
            q_bases = {c.split("-")[0] for c in q_codes}
            c_bases = {c.split("-")[0] for c in c_codes} | {
                w.upper()
                for w in re.findall(r"\b([A-Za-z]{4,})\b", candidate or "")
            }
            if q_bases & c_bases:
                score += 10
            else:
                score -= 8  # wrong trial story
    # Numeric hooks: 25-month, $150, US$150
    for m in re.findall(r"\b\d{1,3}(?:\.\d+)?\b", qt):
        if m in ct:
            score += 2
    return score


def _fetch_via_stock_titan(ticker: str, title: str) -> tuple[str, str | None]:
    """
    Fallback for biotech press: resolve the best matching Stock Titan article
    for this ticker (not just the listing page), then return article body text.
    """
    tk = str(ticker or "").strip().upper()
    if not tk or len(tk) > 6:
        return "", "no_ticker"
    list_url = f"https://www.stocktitan.net/news/{tk}/"
    try:
        import requests

        r = requests.get(
            list_url, timeout=25, headers=_HTTP_HEADERS, allow_redirects=True
        )
        if r.status_code >= 400:
            return "", f"http_{r.status_code}"
        html = r.text or ""
    except Exception as exc:
        return "", str(exc)[:200]

    candidates: list[tuple[int, str, str]] = []
    # JSON-LD NewsArticle entries (headline + url)
    for m in re.finditer(
        rf'"headline"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"url"\s*:\s*"'
        rf'(https://www\.stocktitan\.net/news/{re.escape(tk)}/[^"]+\.html)"',
        html,
        re.I,
    ):
        headline = (
            m.group(1)
            .encode("utf-8")
            .decode("unicode_escape", errors="ignore")
            .replace('\\"', '"')
        )
        url = m.group(2)
        candidates.append((_score_headline_match(title, headline), headline, url))
    # Href fallbacks on the ticker feed
    for href in re.findall(
        rf'href="(/news/{re.escape(tk)}/[a-z0-9][^"]+\.html)"', html, re.I
    ):
        if "page-" in href.lower():
            continue
        slug = href.rsplit("/", 1)[-1].replace("-", " ").replace(".html", "")
        full = f"https://www.stocktitan.net{href}"
        if any(full == c[2] for c in candidates):
            continue
        candidates.append((_score_headline_match(title, slug), slug, full))

    candidates.sort(key=lambda x: x[0], reverse=True)
    # Require a meaningful thematic match before opening an article
    if candidates and candidates[0][0] >= 4:
        text, err = _fetch_url_text_direct(candidates[0][2])
        if text and len(text) > 280 and _body_matches_headline(title, text):
            return _strip_article_chrome(text), None
        if err:
            pass

    # Do NOT slice the ticker listing page — it mixes other headlines
    # (e.g. Mint FDA PR under a class-action card title).
    return "", "stock_titan_no_headline_match"


def _looks_like_analysis_headline(title: str) -> bool:
    """Seeking Alpha / Barron's style: ``Issuer: Thesis (TICKER)``."""
    core = re.sub(r"\([^)]*\)", " ", title or "")
    core = re.sub(r"\s[-–|]\s+[A-Za-z0-9].*$", "", core).strip()
    if ":" not in core:
        return False
    left, right = core.split(":", 1)
    return len(left.strip()) >= 3 and len(right.strip()) >= 20


def _company_domain_candidates_from_title(title: str) -> list[str]:
    """
    Derive likely IR hostnames from a headline like
    ``Cocrystal Pharma (COCP) finishes dosing…`` → cocrystalpharma.com.
    Never invent parked domains from full analysis titles
    (``Beta Bionics: Mint Clearance Marks…`` → betabionics.com, not slug.com).
    """
    core = re.sub(r"\s[-–|]\s+[A-Za-z0-9].*$", "", title or "").strip()
    # Drop publisher tails glued without a dash (rare) and possessives.
    core = re.sub(
        r"(?i)\s+(?:stock\s*titan|biospace|business\s*wire|globe\s*newswire|"
        r"pr\s*newswire|seeking\s*alpha)\s*$",
        "",
        core,
    ).strip()
    core = re.sub(r"([A-Za-z])['’]s\b", r"\1", core)
    core = re.sub(r"\([^)]*\)", " ", core)
    # Opinion / thesis: keep only the issuer left of the colon.
    if ":" in core:
        left, right = core.split(":", 1)
        if len(left.strip()) >= 3 and len(right.strip()) >= 12:
            core = left.strip()
    # Keep leading proper-name chunk before a verb / event word.
    # Do NOT split on bare "cut" ("cut recurrence risk") — only financing cuts.
    core = re.split(
        r"(?i)\b(?:announces?|finishes?|completes?|receives?|reports?|"
        r"provides?|appoints?|prices?|files?|eyes?|to\s+present|"
        r"marks?|shifts?|raises?|cuts?\s+(?:guidance|price|outlook|forecast|"
        r"staff|jobs|workforce)|slides?|unveils?|"
        r"cancer\s+drug|drug\s+cut|committee\s+recommends?)\b",
        core,
        maxsplit=1,
    )[0]
    words = re.findall(r"[A-Za-z0-9]+", core)
    stop = {
        "inc", "incorporated", "corp", "corporation", "ltd", "limited",
        "plc", "co", "company", "therapeutics", "therapeutics", "pharma",
        "pharmaceuticals", "pharmaceutical", "biosciences", "bioscience",
        "biotech", "biotechnology", "holdings", "group", "the",
    }
    # Prefer compact slug that keeps Pharma/Bio when present in name.
    keep = [w for w in words if w.lower() not in {"the", "a", "an", "of", "and"}]
    # Company legal names are short — long token runs are article theses.
    keep = keep[:4]
    if not keep:
        return []
    # cocrystalpharma.com style (drop Inc/Corp only)
    compact = "".join(
        w
        for w in keep
        if w.lower()
        not in {"inc", "incorporated", "corp", "corporation", "ltd", "limited", "plc", "co"}
    )
    dashed = "-".join(w.lower() for w in keep if w.lower() not in stop)
    out: list[str] = []
    if compact and 6 <= len(compact) <= 36:
        out.append(f"{compact.lower()}.com")
    if dashed and 6 <= len(dashed) <= 40 and dashed + ".com" not in out:
        out.append(f"{dashed}.com")
    # Also try without therapeutics/pharma stripped for dashed form including pharma
    dashed2 = "-".join(
        w.lower()
        for w in keep
        if w.lower()
        not in {
            "inc",
            "incorporated",
            "corp",
            "corporation",
            "ltd",
            "limited",
            "plc",
            "co",
            "the",
            "a",
            "an",
        }
    )
    if dashed2 and 6 <= len(dashed2) <= 40 and f"{dashed2}.com" not in out:
        out.append(f"{dashed2}.com")
    # Drop parked / concatenated guesses before any DNS hit.
    return [d for d in out[:4] if not _is_junk_news_host(d, title or "")]


def _fetch_via_company_ir_press(ticker: str, title: str) -> tuple[str, str | None]:
    """
    Fallback when Google / Stock Titan are rate-limited (HTTP 429):
    scrape the company IR press-releases index and open the best headline match.
    """
    # Analysis theses invent nonsense hosts (www.betabionicsmintclearance….com).
    if _looks_like_analysis_headline(title):
        return "", "analysis_headline_skip_ir"
    tk = str(ticker or "").strip().upper()
    domains = list(_TICKER_IR_DOMAINS.get(tk) or [])
    for d in _company_domain_candidates_from_title(title):
        if d not in domains:
            domains.append(d)
    # Prefer compact hosts (cocrystalpharma.com); dashed DNS guesses often fail.
    compact = [d for d in domains if "-" not in d]
    domains = compact or domains
    domains = [d for d in domains if not _is_junk_news_host(d, title or "")]
    if not domains:
        return "", "no_company_domain"
    paths = (
        "/news/press-releases",
        "/news/press-releases?year=2026",
        "/investors/news-events/press-releases",
        "/investors/news/press-releases",
        "/news",
    )
    last_err: str | None = None
    try:
        import requests
        from urllib.parse import urljoin
    except Exception as exc:
        return "", str(exc)[:120]

    title_l = (title or "").lower()
    dosing_q = bool(re.search(r"(?i)\bdos(?:e|ed|ing)\b", title_l))

    for domain in domains:
        got_live_host = False
        for path in paths:
            list_url = f"https://www.{domain}{path}"
            try:
                r = requests.get(
                    list_url, timeout=18, headers=_HTTP_HEADERS, allow_redirects=True
                )
            except Exception as exc:
                last_err = str(exc)[:160]
                continue
            if r.status_code >= 400:
                last_err = f"http_{r.status_code}"
                continue
            html = r.text or ""
            if len(html) < 800:
                last_err = "ir_empty"
                continue
            got_live_host = True
            candidates: list[tuple[int, str, str]] = []
            for m in re.finditer(
                r'href="([^"]*press-releases/detail/[^"]+)"[\s\S]{0,320}?'
                r'(?:class="media-heading"[^>]*>|<h[12][^>]*>)\s*([^<]{20,220})\s*<',
                html,
                re.I,
            ):
                href, lab = m.group(1), re.sub(r"\s+", " ", m.group(2)).strip()
                full = urljoin(list_url, href)
                sc = _score_headline_match(title, lab)
                if dosing_q and re.search(r"(?i)\bdos(?:e|ed|ing)\b", lab):
                    sc += 3
                if "norovirus" in lab.lower() and "norovirus" in title_l:
                    sc += 2
                candidates.append((sc, lab, full))
            for m in re.finditer(
                r'href="([^"]*press-releases/detail/[^"]+)"',
                html,
                re.I,
            ):
                href = m.group(1)
                full = urljoin(list_url, href)
                if any(full == c[2] for c in candidates):
                    continue
                slug = href.rstrip("/").rsplit("/", 1)[-1].replace("-", " ")
                sc = _score_headline_match(title, slug)
                if dosing_q and re.search(r"(?i)\bdos", slug):
                    sc += 3
                candidates.append((sc, slug, full))
            candidates.sort(key=lambda x: x[0], reverse=True)
            seen: set[str] = set()
            uniq: list[tuple[int, str, str]] = []
            for sc, lab, full in candidates:
                if full in seen:
                    continue
                seen.add(full)
                uniq.append((sc, lab, full))
            candidates = uniq
            min_score = 2 if dosing_q else 3
            if candidates and candidates[0][0] >= min_score:
                text, err = _fetch_url_text_direct(candidates[0][2])
                text = _strip_article_chrome(text or "")
                if text and len(text) > 280:
                    return text, None
                if err:
                    last_err = err
            elif candidates:
                last_err = f"ir_no_headline_match(best={candidates[0][0]})"
        if got_live_host:
            break
    return "", last_err or "company_ir_empty"


def _fetch_press_body_fallbacks(ticker: str, title: str) -> tuple[str, str | None]:
    """Company IR first when Titan/Google are rate-limited; else Titan."""
    e_ir: str | None = None
    if not _looks_like_analysis_headline(title):
        t_ir, e_ir = _fetch_via_company_ir_press(ticker, title)
        if t_ir and len(t_ir) > 200 and _body_matches_headline(title, t_ir):
            return t_ir, None
    t1, e1 = _fetch_via_stock_titan(ticker, title)
    if t1 and len(t1) > 200 and _body_matches_headline(title, t1):
        return t1, None
    return "", e_ir or e1 or "press_fallback_empty"


def _extract_financing_facts(text: str) -> dict[str, str | None]:
    """Shelf / offering / ATM facts for financing headlines."""
    blob = _clean_fetched_text(text or "")
    amount = None
    m = re.search(
        r"\b(?:US\s*\$|USD\s*|\$)\s*([\d.,]+)\s*(million|billion|m|bn)\b",
        blob,
        re.I,
    )
    if m:
        unit = m.group(2).lower()
        unit = {"m": "million", "bn": "billion"}.get(unit, unit)
        amount = f"US${m.group(1)} {unit}"
    duration = None
    m = re.search(r"\b(\d{1,2})\s*[-–‑-]?\s*month(?:s)?\b", blob, re.I)
    if m:
        duration = f"{m.group(1)}-month"
    kind = None
    if re.search(r"\b(?:base\s+)?shelf(?:\s+prospectus)?\b", blob, re.I):
        kind = "shelf prospectus"
    elif re.search(r"\bATM\b|\bat-the-market\b", blob, re.I):
        kind = "ATM program"
    elif re.search(r"\b(public offering|follow-on|registered direct)\b", blob, re.I):
        kind = "equity offering"
    no_offer_now = bool(
        re.search(
            r"\bno securities are being offered\b|\bnot obligated to (?:conduct|complete) any offering\b",
            blob,
            re.I,
        )
    )
    instruments = None
    m = re.search(
        r"\b((?:Class A )?common shares(?:,?\s+(?:debt securities|warrants|subscription receipts|units))+)",
        blob,
        re.I,
    )
    if m:
        instruments = re.sub(r"\s+", " ", m.group(1)).strip()[:160]
    summary = None
    bits = []
    if kind and amount:
        bits.append(f"{amount} {kind}")
    elif kind:
        bits.append(kind)
    elif amount:
        bits.append(f"{amount} financing capacity")
    if duration:
        bits.append(f"issuance window {duration}")
    if no_offer_now:
        bits.append("no offering priced now (shelf only)")
    if instruments:
        bits.append(f"may cover {instruments}")
    if bits:
        summary = "; ".join(bits)
    return {
        "amount": amount,
        "duration": duration,
        "kind": kind,
        "instruments": instruments,
        "summary": summary,
        "no_offer_now": "1" if no_offer_now else None,
    }


def _is_sec_edgar_archives_url(url: str) -> bool:
    return "sec.gov/archives/edgar/" in (url or "").lower()


def _extract_paywall_teaser_html(html: str) -> str:
    """Pull og:description / JSON-LD articleBody from soft-wall HTML (SA 403)."""
    h = html or ""
    bits: list[str] = []
    for pat in (
        r'property=["\']og:description["\']\s+content=["\']([^"\']+)["\']',
        r'content=["\']([^"\']+)["\']\s+property=["\']og:description["\']',
        r'name=["\']description["\']\s+content=["\']([^"\']+)["\']',
        r'"articleBody"\s*:\s*"((?:\\.|[^"\\]){80,})"',
        r'"description"\s*:\s*"((?:\\.|[^"\\]){80,600})"',
    ):
        for m in re.finditer(pat, h, re.I):
            raw = m.group(1)
            try:
                raw = (
                    raw.encode("utf-8")
                    .decode("unicode_escape", errors="ignore")
                    .replace('\\"', '"')
                )
            except Exception:
                pass
            clean = _clean_fetched_text(raw)
            if len(clean) >= 60 and clean not in bits:
                bits.append(clean)
            if sum(len(b) for b in bits) >= 2500:
                break
        if sum(len(b) for b in bits) >= 2500:
            break
    # Seeking Alpha often embeds bullet theses as <li> under summary
    for m in re.finditer(
        r"<li[^>]*>\s*([^<]{40,280})\s*</li>", h, re.I
    ):
        clean = _clean_fetched_text(m.group(1))
        if len(clean) >= 40 and clean not in bits:
            bits.append(clean)
        if len(bits) >= 10:
            break
    # Soft walls (RTTNews) keep a short public lede in <p> while the rest is gated.
    for m in re.finditer(r"<p[^>]*>\s*([^<]{80,900})\s*</p>", h, re.I):
        clean = _clean_fetched_text(m.group(1))
        if len(clean) < 80:
            continue
        if re.search(r"(?i)for comments and feedback|editorial@|subscribe|sign[- ]?in", clean):
            continue
        if clean not in bits:
            bits.append(clean)
        if sum(len(b) for b in bits) >= 2500:
            break
    return _clean_fetched_text(" ".join(bits))[:4000]


def _fetch_paywall_teaser(url: str, *, timeout_s: float = 12.0) -> tuple[str, str | None]:
    """GET a blocked publisher once and salvage public teaser text."""
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return "", "url_must_be_http"
    try:
        import requests

        r = requests.get(
            u, timeout=float(timeout_s), headers=_HTTP_HEADERS, allow_redirects=True
        )
        teaser = _extract_paywall_teaser_html(r.text or "")
        if len(teaser) >= 120:
            return teaser, None
        return "", f"paywall_teaser_thin_http_{r.status_code}"
    except Exception as exc:
        return "", str(exc)[:160]


def _fetch_url_text_direct(
    url: str, *, timeout_s: float | None = None
) -> tuple[str, str | None]:
    """Fetch a concrete publisher URL (no Google News unwrap)."""
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return "", "url_must_be_http"
    try:
        from urllib.parse import urlparse

        host = (urlparse(u).netloc or "")
        if _is_junk_news_host(host):
            return "", "junk_publisher_host"
        if _is_blocked_news_host(host):
            return "", "blocked_publisher_host"
    except Exception:
        pass
    # SEC blocks generic browser UA (http_403). Use EDGAR-compliant bundle fetch.
    if _is_sec_edgar_archives_url(u):
        body, err = _fetch_edgar_8k_text_from_url(u)
        if body:
            return body, None
        if err and err != "not_edgar_url":
            return "", err
    try:
        import requests

        to = float(timeout_s if timeout_s is not None else 25)
        r = None
        last_status = 0
        for attempt in range(2):
            r = requests.get(u, timeout=to, headers=_HTTP_HEADERS, allow_redirects=True)
            last_status = int(r.status_code or 0)
            if last_status != 429:
                break
            time.sleep(1.1 + attempt)
        if r is None or last_status >= 400:
            return "", f"http_{last_status or 0}"
        ctype = (r.headers.get("content-type") or "").lower()
        if "pdf" in ctype or u.lower().endswith(".pdf"):
            from catalyst_extractor import _extract_text_from_pdf

            return (
                _extract_text_from_pdf(r.content, max_chars=_ANALYZE_TEXT_MAX),
                None,
            )
        from catalyst_extractor import _extract_html_page_title, _extract_text_from_html

        html = r.text or ""
        page_title = None
        try:
            page_title = _extract_html_page_title(html)
        except Exception:
            page_title = None
        text = _clean_fetched_text(
            _extract_text_from_html(html, max_chars=_ANALYZE_TEXT_MAX)
        )
        text = _strip_article_chrome(text)
        if page_title and not _looks_like_nav_chrome(page_title):
            if _looks_like_nav_chrome(text[:160]) or page_title.lower() not in text[
                :500
            ].lower():
                # Lead with the real H1 / og:title (BioSpace nav otherwise wins).
                text = _strip_article_chrome(text)
                if page_title.lower() not in text[:500].lower():
                    text = f"{page_title}. {text}"
                elif _looks_like_nav_chrome(text[:120]):
                    text = f"{page_title}. {_strip_article_chrome(text)}"
        # Soft walls (RTTNews / SA shells): visible DOM is title-only but meta /
        # JSON-LD still carries a usable teaser — salvage before Google title-search.
        if len(text) < 180:
            teaser = _extract_paywall_teaser_html(html)
            if len(teaser) >= 80:
                lead = page_title if page_title and not _looks_like_nav_chrome(page_title) else ""
                if lead and lead.lower() not in teaser[:200].lower():
                    text = f"{lead}. {teaser}"
                else:
                    text = teaser
        return text[:_ANALYZE_TEXT_MAX], None
    except Exception as exc:
        return "", str(exc)[:200]


def _fetch_url_text(
    url: str,
    *,
    title_hint: str | None = None,
    ticker_hint: str | None = None,
    quick: bool = False,
) -> tuple[str, str | None]:
    """Return (text, error). Unwraps Google News → publisher page when possible."""
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return "", "url_must_be_http"
    is_gnews = _is_google_news_shell_url(u)
    timeout_s = _HTTP_TIMEOUT_QUICK_S if quick else 25.0
    # Always allow HTTP follow for Google News unwrap — quick=False used to be
    # required or unwrap stays on the rss/articles shell and body fetch dies.
    resolved = (
        _unwrap_google_news_url(u, timeout_s=20.0 if not quick else 12.0, allow_http=True)
        if is_gnews
        else u
    )
    try:
        from urllib.parse import urlparse as _urlparse

        if resolved and _is_junk_news_host(_urlparse(resolved).netloc or "", title_hint or ""):
            resolved = "" if _news_url_is_junk(u, title_hint or "") else u
    except Exception:
        pass
    if _news_url_is_junk(resolved or u, title_hint or "") or (
        resolved and _news_url_is_junk(resolved, title_hint or "")
    ):
        if title_hint:
            t2, e2 = _fetch_article_via_title_search(
                title_hint, timeout_s=_HTTP_TIMEOUT_QUICK_S if quick else 20.0
            )
            if t2 and len(t2) > 180 and _body_matches_headline(title_hint, t2):
                return t2, None
            return "", e2 or "junk_publisher_host"
        return "", "junk_publisher_host"
    try:
        from urllib.parse import urlparse as _up_block

        blocked = _is_blocked_news_host(_up_block(resolved or u).netloc or "")
    except Exception:
        blocked = False
    if blocked:
        # Seeking Alpha / Stocktwits walls — find an open syndicated copy.
        # Never invent company-IR DNS from analysis titles (burns budget + junk host).
        if title_hint:
            t2, e2 = _fetch_article_via_title_search(
                title_hint, timeout_s=_HTTP_TIMEOUT_QUICK_S if quick else 20.0
            )
            if t2 and len(t2) > 180 and _body_matches_headline(title_hint, t2):
                return t2, None
            # Salvage public teaser (og:description / bullets) from the wall HTML.
            teaser, _te = _fetch_paywall_teaser(
                resolved or u, timeout_s=_HTTP_TIMEOUT_QUICK_S if quick else 12.0
            )
            if teaser and len(teaser) >= 120:
                blob = f"{title_hint}\n{teaser}".strip()
                if _body_matches_headline(title_hint, blob):
                    return blob, None
            if ticker_hint and not _looks_like_analysis_headline(title_hint):
                t3, e3 = _fetch_press_body_fallbacks(ticker_hint, title_hint)
                if t3 and len(t3) > 200 and _body_matches_headline(title_hint, t3):
                    return t3, None
                return "", e2 or e3 or "blocked_publisher_host"
            return "", e2 or "blocked_publisher_host"
        return "", "blocked_publisher_host"
    # If unwrap still points at Google, skip direct fetch of the shell page
    # (browser GET of /rss/articles/… is Google 400 malformed).
    if is_gnews and _is_google_news_shell_url(resolved or u):
        # Publisher URL guess from headline (simplywall.st / investingnews / …)
        for guess in _guess_publisher_urls_from_title(title_hint or ""):
            text, err = _fetch_url_text_direct(guess, timeout_s=timeout_s)
            text = _strip_article_chrome(text or "")
            if (
                text
                and len(text) > 280
                and _body_matches_headline(title_hint or "", text)
            ):
                return text, None
        if quick:
            # Prefer headline (+ publisher) search over a random same-ticker press PR.
            text, err = _fetch_article_via_title_search(title_hint or "")
            if text and len(text) > 280 and _body_matches_headline(title_hint or "", text):
                return text, None
            if ticker_hint and not _is_litigation_news(title_hint or ""):
                t2, e2 = _fetch_press_body_fallbacks(ticker_hint, title_hint or "")
                if t2 and len(t2) > 200 and _body_matches_headline(title_hint or "", t2):
                    return t2, None
                return "", e2 or err or "google_news_no_article_body"
            return "", err or "google_news_no_article_body"
        text, err = _fetch_article_via_title_search(title_hint or "")
        if text and len(text) > 280 and _body_matches_headline(title_hint or "", text):
            return text, None
        if ticker_hint and not _is_litigation_news(title_hint or ""):
            t2, e2 = _fetch_press_body_fallbacks(ticker_hint, title_hint or "")
            if t2 and len(t2) > 200 and _body_matches_headline(title_hint or "", t2):
                return t2, None
            return "", err or e2 or "google_news_no_article_body"
        return text, err or "google_news_no_article_body"
    if is_gnews and resolved != u and "google." not in resolved.lower():
        text, err = _fetch_url_text_direct(resolved, timeout_s=timeout_s)
        if text and len(text) > 200:
            if title_hint and not _body_matches_headline(title_hint, text):
                text, err = "", "headline_body_mismatch"
            else:
                return text, err
    target = (resolved if resolved != u else u) or u
    if _is_google_news_shell_url(target):
        if title_hint:
            t2, e2 = _fetch_article_via_title_search(title_hint)
            if t2 and len(t2) > 280 and _body_matches_headline(title_hint, t2):
                return t2, None
            return "", e2 or "google_news_no_article_body"
        return "", "google_news_no_article_body"
    text, err = _fetch_url_text_direct(target, timeout_s=timeout_s)

    def _usable_soft_body(t: str | None) -> bool:
        """Soft-wall teaser (≥120 chars, headline-matched) is enough to brief."""
        if not t or len(t) < 120:
            return False
        if title_hint and not _body_matches_headline(title_hint, t):
            return False
        return True

    # Soft walls (RTTNews / SA shells): do NOT fall into Google/DDG title-search
    # when we already salvaged a usable teaser — search often hangs on 429 and
    # trips the client 60s brief timeout → "Could not build the brief."
    if _usable_soft_body(text) and (not text or len(text) < 280):
        return text, None

    if quick:
        if (not text or len(text) < 280) and title_hint:
            t2, e2 = _fetch_article_via_title_search(title_hint)
            if t2 and len(t2) > len(text or "") and _body_matches_headline(
                title_hint, t2
            ):
                return t2, None
            err = err or e2
        if (
            (not text or len(text) < 280)
            and ticker_hint
            and not _is_shareholder_alert(title_hint or "")
            and not _is_litigation_news(title_hint or "")
            and not _looks_like_analysis_headline(title_hint or "")
        ):
            t3, e3 = _fetch_press_body_fallbacks(ticker_hint, title_hint or "")
            if (
                t3
                and len(t3) > len(text or "")
                and _body_matches_headline(title_hint or "", t3)
            ):
                return t3, None
        if text and title_hint and not _body_matches_headline(title_hint, text):
            return "", err or "headline_body_mismatch"
        return text, err
    if (not text or len(text) < 280) and title_hint:
        t2, e2 = _fetch_article_via_title_search(title_hint)
        if t2 and len(t2) > len(text or ""):
            return t2, None
        if ticker_hint and not _looks_like_analysis_headline(title_hint):
            t3, e3 = _fetch_press_body_fallbacks(ticker_hint, title_hint)
            if t3 and len(t3) > len(text or ""):
                return t3, None
        if not text:
            return "", err or e2 or "content_too_short"
    if is_gnews and len(text or "") < 280:
        return text, err or "google_news_no_article_body"
    return text, err


def _is_specific_event_date(what: str, *, ctx: str = "") -> bool:
    """
    Keep only dates tied to a concrete catalyst/event (conference, PDUFA, shelf…).
    Drop bare “date mentioned in the article” noise.
    """
    wh = (what or "").strip()
    blob = f"{wh}\n{ctx or ''}"
    if not wh and not ctx:
        return False
    if re.search(
        r"^(date|iso date|month/?year)\b.*\bmentioned\b|"
        r"^date mentioned in the article|"
        r"^iso date mentioned|"
        r"^month/year mentioned",
        wh,
        re.I,
    ):
        return False
    return bool(
        re.search(
            r"\b("
            r"conference|fireside|present(?:ation|ing)?|speak(?:er|s|ing)?|panel|"
            r"wainwright|jefferies|cowen|jpmorgan|jp\s*morgan|investor\s+day|"
            r"annual\s+(?:meeting|general)|earnings|webcast|call|"
            r"pdufa|adcom|advisory\s+committee|fda|approv|crl|hold|"
            r"readout|topline|abstract|asco|esmo|aahks|aacr|ash\b|sabcs|eular|"
            r"bio\s+(?:international|europe)|jefferies\s+healthcare|"
            r"shelf|financ(?:e|ing)|prospectus|registration\s+statement|"
            r"offering|ATM|dilut|"
            r"catalyst|regulatory|enrollment|first\s+patient|dosing|"
            r"event\s+window|event\s+date|data\s+(?:release|cut|readout)|"
            r"closing|closed|complet(?:e|ed|ion)|upfront|milestone|deal\s+close|"
            r"acqui(?:re|red|res|sition)|merger|announc(?:e|ed|ement)|definitive\s+agreement"
            r")\b",
            blob,
            re.I,
        )
    )


def _filter_event_only_dates(dates: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Drop date rows that are not linked to a specific event."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for d in dates or []:
        if not isinstance(d, dict):
            continue
        ds = str(d.get("date") or "").strip()
        wh = str(d.get("what_happens") or "").strip()
        if not ds and not wh:
            continue
        if re.search(r"(?i)from the article\.?$", wh):
            continue
        if not _is_specific_event_date(wh):
            continue
        key = ds.lower() or wh.lower()[:40]
        if key in seen:
            continue
        seen.add(key)
        out.append({"date": ds[:48], "what_happens": wh[:240]})
        if len(out) >= 6:
            break
    return out


def _extract_dates_from_article_text(text: str, *, title: str = "") -> list[dict[str, str]]:
    """
    Pull conference / catalyst dates from article body (and title).
    Only keep dates tied to a specific event — not bare calendar mentions.
    """
    blob = _clean_fetched_text(f"{title}\n{text}")
    out: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add(date_s: str, what: str, *, ctx: str = "") -> None:
        if not _is_specific_event_date(what, ctx=ctx):
            return
        key = date_s.lower()
        if key in seen or len(out) >= 6:
            return
        seen.add(key)
        out.append({"date": date_s[:48], "what_happens": what[:240]})

    # Range: September 8-10, 2026 / Sept. 8 – 10, 2026
    for m in re.finditer(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+(\d{1,2})\s*[-–—to]+\s*(\d{1,2}),?\s+(20\d{2})\b",
        blob,
        re.I,
    ):
        mon = m.group(1)
        ctx = blob[max(0, m.start() - 80) : m.end() + 80]
        _add(
            f"{mon} {m.group(2)}-{m.group(3)}, {m.group(4)}",
            "Conference / event window mentioned in the article.",
            ctx=ctx,
        )

    # Exact: September 9, 2026 — only if the SAME sentence names an event
    for m in re.finditer(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b",
        blob,
        re.I,
    ):
        label = f"{m.group(1)} {m.group(2)}, {m.group(3)}"
        # Same-sentence window (avoid neighboring event words polluting bare dates)
        left = blob.rfind(".", 0, m.start())
        left_q = blob.rfind("?", 0, m.start())
        left_e = blob.rfind("!", 0, m.start())
        sent_start = max(left, left_q, left_e, -1) + 1
        right_candidates = [
            i
            for i in (
                blob.find(".", m.end()),
                blob.find("?", m.end()),
                blob.find("!", m.end()),
            )
            if i >= 0
        ]
        sent_end = min(right_candidates) + 1 if right_candidates else min(len(blob), m.end() + 120)
        ctx = blob[sent_start:sent_end].strip()
        what = ""
        if re.search(
            r"conference|fireside|present|speak|panel|wainwright|jefferies|"
            r"investor\s+day|webcast|earnings",
            ctx,
            re.I,
        ):
            what = "Conference / fireside / presentation date from the article."
        elif re.search(
            r"shelf|prospectus|registration statement|offering|ATM|financ",
            ctx,
            re.I,
        ):
            what = "Shelf / financing / registration date from the article."
        elif re.search(
            r"pdufa|fda|approv|readout|topline|abstract|enrollment|catalyst|"
            r"data\s+(?:cut|release|readout)",
            ctx,
            re.I,
        ):
            what = "Catalyst / regulatory / data date from the article."
        else:
            continue  # bare calendar mention — skip
        _add(label, what, ctx=ctx)

    # Month + day WITHOUT year (common in headlines) — borrow year from same text
    years_in_blob = re.findall(r"\b(20\d{2})\b", blob)
    year_guess = years_in_blob[-1] if years_in_blob else str(_rome_now().year)
    for m in re.finditer(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b"
        r"(?!\s*,?\s*20\d{2})",
        blob,
        re.I,
    ):
        label = f"{m.group(1)} {m.group(2)}, {year_guess}"
        left = max(
            blob.rfind(".", 0, m.start()),
            blob.rfind("?", 0, m.start()),
            blob.rfind("!", 0, m.start()),
            -1,
        )
        ctx = blob[left + 1 : min(len(blob), m.end() + 100)].strip()
        if not re.search(
            r"conference|fireside|present|speak|panel|wainwright|jefferies|"
            r"pdufa|readout|investor\s+day",
            ctx,
            re.I,
        ):
            continue
        _add(
            label,
            "Conference / event date inferred from headline (year from context).",
            ctx=ctx,
        )

    # ISO — only with event context in the same sentence
    for m in re.finditer(r"\b(20\d{2}-\d{2}-\d{2})\b", blob):
        left = max(
            blob.rfind(".", 0, m.start()),
            blob.rfind("?", 0, m.start()),
            blob.rfind("!", 0, m.start()),
            -1,
        )
        right_candidates = [
            i
            for i in (
                blob.find(".", m.end()),
                blob.find("?", m.end()),
                blob.find("!", m.end()),
            )
            if i >= 0
        ]
        sent_end = min(right_candidates) + 1 if right_candidates else min(len(blob), m.end() + 100)
        ctx = blob[left + 1 : sent_end].strip()
        if not _is_specific_event_date("event date", ctx=ctx):
            continue
        what = "Catalyst / event date from the article."
        if re.search(r"conference|fireside|present|panel", ctx, re.I):
            what = "Conference / fireside / presentation date from the article."
        elif re.search(r"shelf|prospectus|offering|financ", ctx, re.I):
            what = "Shelf / financing / registration date from the article."
        _add(m.group(1), what, ctx=ctx)

    return out


def _parse_labeled_clinical_fields(text: str) -> dict[str, str | None]:
    """Pick up Product:/Study:/Phase:/Results: lines already structured upstream."""
    out: dict[str, str | None] = {
        "product": None,
        "study": None,
        "phase": None,
        "results": None,
    }
    for key, pat in (
        ("product", r"(?im)^\s*Product:\s*(.+?)\s*$"),
        ("study", r"(?im)^\s*Study:\s*(.+?)\s*$"),
        ("phase", r"(?im)^\s*Phase:\s*(.+?)\s*$"),
        ("results", r"(?im)^\s*Results(?:_note)?:\s*(.+?)\s*$"),
    ):
        m = re.search(pat, text or "")
        if m:
            out[key] = m.group(1).strip()[:500] or None
    return out


def _extract_fda_designations(text: str) -> list[str]:
    """FDA designation labels mentioned in press / brief prose."""
    blob = text or ""
    out: list[str] = []
    for label in (
        "Breakthrough Therapy",
        "Orphan Drug",
        "Fast Track",
        "Rare Pediatric Disease",
        "Priority Review",
        "RMAT",
        "Accelerated Approval",
    ):
        if re.search(re.escape(label), blob, re.I) and label not in out:
            out.append(label)
    return out


def _extract_clinical_facts(text: str) -> dict[str, str | None]:
    """
    Pull product / study / phase / results snippets from free text.
    Used by Manual analyze + news brief when AI is thin or unavailable.
    """
    blob = _clean_fetched_text(text or "")
    labeled = _parse_labeled_clinical_fields(text or "")
    product = labeled.get("product")
    study = labeled.get("study")
    phase = labeled.get("phase")
    results = labeled.get("results")

    # Prefer names that look like trial codes (ARCHER, ARCHER-CMF, …)
    # over internal compound IDs (CRD-38) when both appear.
    if not study:
        cands: list[str] = []
        for m in re.finditer(
            r"\b([A-Z]{3,}(?:-[A-Z0-9]{1,8})+)\b"
            r"|\b(?:study|trial)\s+([A-Z][A-Za-z0-9-]{2,})\b"
            r"|\b(?:from|in|of|the)\s+([A-Z]{4,})\b(?=\s*,|\s+trial|\s+the\s+Company|\s+Phase|\s+findings)",
            blob,
        ):
            cand = (m.group(1) or m.group(2) or m.group(3) or "").strip()
            if not cand:
                continue
            up = cand.upper()
            if up in {
                "NASDAQ",
                "NYSE",
                "FDA",
                "PDUFA",
                "CEO",
                "USA",
                "TSX",
                *_STUDY_DEGREE_BLOCK,
            }:
                continue
            cands.append(cand)
        # Also accept bare trial acronyms (ARCHER) near Phase / topline / trial
        for m in re.finditer(
            r"\b(Phase\s*(?:[I1]{1,3}|[123])[^.%]{0,40}?)\b([A-Z]{4,})\b"
            r"|\b([A-Z]{4,})\b(?=,?\s+the Company'?s Phase|\s+trial\b|\s+findings\b|\s+results\b)",
            blob,
        ):
            cand = (m.group(2) or m.group(3) or "").strip()
            if cand and cand.upper() not in {
                "NASDAQ",
                "NYSE",
                "PHASE",
                "TRIAL",
                "WITH",
                "FROM",
                "THIS",
                "THAT",
                "COMPANY",
                "UNITED",
                "STATES",
                "FRANCE",
                "BRAZIL",
                "ISRAEL",
                *_STUDY_DEGREE_BLOCK,
            }:
                cands.append(cand)
        def _study_rank(c: str) -> tuple[int, int]:
            up = c.upper()
            # Prefer letter-heavy acronyms (ARCHER) over CRD-38 style codes
            letterish = 2 if re.fullmatch(r"[A-Z]{4,}(?:-[A-Z]+)?", up) else 0
            digitish = -2 if re.search(r"\d", up) else 0
            in_trial_ctx = 1 if re.search(
                rf"(?i)\b(?:phase|trial|study|topline)\b[^.]{{0,40}}{re.escape(c)}"
                rf"|{re.escape(c)}[^.]{{0,40}}\b(?:trial|study|phase|findings)\b",
                blob,
            ) else 0
            return (letterish + digitish + in_trial_ctx, len(c))
        if cands:
            # unique preserve order then rank
            uniq: list[str] = []
            seen_u: set[str] = set()
            for c in cands:
                cu = c.upper()
                if cu in seen_u:
                    continue
                seen_u.add(cu)
                uniq.append(c)
            study = sorted(uniq, key=_study_rank, reverse=True)[0]

    if not phase:
        m = re.search(
            r"\b(Phase\s*(?:[I1]{1,3}|[123]|IV|4)[abcABC]?)\b",
            blob,
            re.I,
        )
        if m:
            phase = re.sub(r"\s+", " ", m.group(1)).strip()

    # Product / drug candidates: prefer *Rx / -umab / -tinib (never bare "for Cardiol")
    if not product:
        m = re.search(
            r"\b([A-Z][A-Za-z0-9]*(?:Rx|umab|ciclib|tinib|fenib|fen|olol))"
            r"(?:\s*[\(（]?\s*(?:TM|R|SM|®|™)\s*[\)）]?)?",
            blob,
        )
        if m:
            product = m.group(1)
        else:
            m = re.search(
                r"\b(?:drug|candidate|therapy|asset)\s+([A-Z][A-Za-z0-9-]{2,})\b",
                blob,
            )
            if m:
                product = m.group(1)
    if not product:
        # Codes with or without hyphen: NEO-100 / NEO100 / ALK-001
        m = re.search(r"\b([A-Z]{2,6}-\d{1,4}[A-Z]?)\b", blob)
        if m:
            product = m.group(1)
        else:
            m = re.search(r"\b([A-Z]{2,6}\d{2,4}[A-Z]?)\b", blob)
            if m:
                product = m.group(1)

    # Results: whole sentences only (avoids title||body glue duplication)
    if not results:
        result_kw = re.compile(
            r"\b(?:topline|primary endpoint|met the|missed the|reduction|"
            r"improved|statistically significant|p\s*[<=]\s*0?\.\d+|"
            r"efficacy|safety)\b",
            re.I,
        )
        best = ""
        best_sc = -1
        for sent in re.split(r"(?<=[.!?])\s+|\n+", blob):
            s = sent.strip()
            if len(s) < 28 or not result_kw.search(s):
                continue
            if re.search(r"\b(for|the|a|an|of|and|with)\s*$", s, re.I):
                continue
            if re.search(
                r"\b(look forward|business development|forward[- ]looking)\b",
                s,
                re.I,
            ):
                continue
            sc = 0
            if re.search(r"\bp\s*[<=]\s*0?\.\d+", s, re.I):
                sc += 5
            if re.search(r"\b(primary endpoint|ecv|gls|n\s*=\s*\d+)\b", s, re.I):
                sc += 3
            if re.search(r"\b(topline|statistically significant)\b", s, re.I):
                sc += 2
            if len(s) > 350:
                sc -= 2
            if sc > best_sc or (sc == best_sc and len(s) > len(best)):
                best_sc = sc
                best = s
        if best:
            results = best[:500]
    if not results and re.search(r"\b(positive|negative)\s+Phase\b", blob, re.I):
        for sent in re.split(r"(?<=[.!?])\s+|\n+", blob):
            s = sent.strip()
            if not re.search(r"\b(?:positive|negative)\s+Phase\b", s, re.I):
                continue
            if len(s) < 20:
                continue
            if re.search(r"\b(for|the|a|an|of|and|with)\s*$", s, re.I):
                if not results:
                    results = s[:500]
                continue
            results = s[:500]
            break

    return {
        "product": product[:80] if product else None,
        "study": study[:80] if study else None,
        "phase": phase[:40] if phase else None,
        "results": results,
    }


def _extract_indication(text: str) -> str | None:
    blob = _clean_fetched_text(text or "")
    # Prefer explicit disease phrases common in biotech PRs
    for pat in (
        r"\b((?:acute|chronic|relapsing|refractory)\s+myocarditis)\b",
        r"\b((?:acute|chronic|recurrent|idiopathic)\s+pericarditis)\b",
        r"\bin patients with\s+([A-Za-z][A-Za-z0-9 /-]{3,40}?)(?=\s*[.,;]|\s+from\b|\s+in\b|$)",
        r"\bfor the treatment of\s+([A-Za-z][A-Za-z0-9 /-]{3,40}?)(?=\s*[.,;]|$)",
        r"\b(?:in|for)\s+((?:acute|chronic|relapsing|refractory)\s+[A-Za-z][A-Za-z0-9 /-]{2,30})\b",
    ):
        m = re.search(pat, blob, re.I)
        if not m:
            continue
        ind = re.sub(r"\s+", " ", m.group(1).strip(" .,;"))
        if len(ind) < 4 or re.search(
            r"\b(phase|topline|press|nasdaq|year|quarter|million|heart disease)\b",
            ind,
            re.I,
        ):
            continue
        return ind[:80]
    return None


def _extract_key_results_from_text(text: str) -> list[dict[str, str]]:
    """Regex fallback for Google-style Key Trial Results when AI is unavailable."""
    blob = _clean_fetched_text(text or "")
    if len(blob) < 200:
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add(label: str, detail: str) -> None:
        d = re.sub(r"\s+", " ", (detail or "").strip())
        if len(d) < 28:
            return
        key = d.lower()[:90]
        if key in seen:
            return
        seen.add(key)
        out.append({"label": label, "detail": d[:400]})

    # Primary / co-primary endpoints + n=
    m = re.search(
        r"([^.]{0,80}\b(?:co-?primary|primary)\s+endpoints?\b[^.…]{10,220})",
        blob,
        re.I,
    )
    if m:
        _add("Primary endpoints", m.group(1))
    m = re.search(
        r"([^.]{0,40}\b(?:randomized|enrolled|included)\b[^.]{0,80}\b(\d{2,4})\s+patients?\b[^.…]{0,120})",
        blob,
        re.I,
    )
    if m:
        _add("Patients", m.group(1))

    # Sentences with p-values / hard effect sizes
    for sent in re.split(r"(?<=[.!?])\s+", blob):
        s = sent.strip()
        if len(s) < 40 or len(s) > 420:
            continue
        if re.search(r"\bp\s*[<=]\s*0?\.\d+", s, re.I):
            label = "Efficacy"
            if re.search(r"\becv|extracellular volume\b", s, re.I):
                label = "ECV"
            elif re.search(r"\bgls|global longitudinal\b", s, re.I):
                label = "GLS"
            elif re.search(r"\bleft ventricular mass|lvm\b", s, re.I):
                label = "Left ventricular mass"
            elif re.search(r"\b9\.?\d*\s*grams?\b", s, re.I):
                label = "Left ventricular mass"
            _add(label, s)
        elif re.search(
            r"\b(reduction of\s+\d|improved by\s+\d|\d+(?:\.\d+)?\s*%|"
            r"\d+(?:\.\d+)?\s*grams?)\b",
            s,
            re.I,
        ) and re.search(r"\b(endpoint|ecv|gls|mass|inflammation|remodel)\b", s, re.I):
            label = "Key finding"
            if re.search(r"\bmass|grams?\b", s, re.I):
                label = "Left ventricular mass"
            _add(label, s)
        if len(out) >= 5:
            break

    if not any(x["label"] == "Safety" for x in out):
        m = re.search(
            r"([^.]{0,20}\b(?:well tolerated|favorable safety|no (?:new )?safety|"
            r"safety profile|adverse events?)\b[^.…]{10,200})",
            blob,
            re.I,
        )
        if m:
            _add("Safety", m.group(1))
    return out[:6]


_PAPER_SECTION_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("Abstract", ("abstract",)),
    ("Introduction", ("introduction", "background")),
    ("Methods", ("methods", "methods and results", "materials and methods", "study design")),
    ("Results", ("results", "results and discussion")),
    ("Discussion", ("discussion",)),
    ("Conclusions", ("conclusions", "conclusion", "summary and conclusions")),
]


def _looks_like_academic_paper(text: str) -> bool:
    t = text or ""
    low = t.lower()
    # Press wires / aggregator chrome must not trip journal heuristics
    if re.search(
        r"(?i)\b("
        r"stock\s*titan|globenewswire|prnewswire|businesswire|"
        r"forward[- ]looking statements|nasdaq\s*:|nyse\s*:|"
        r"rhea-ai|key figures|market cap|news market reaction|"
        r"completes?\s+acquisition|definitive\s+(?:merger\s+)?agreement|"
        # Corporate clinical PRs (topline / announced) are not journal PDFs
        r"\bannounc(?:ed|es|ing)\b|\btopline\b|\bpress\s+release\b|"
        r"\binvestor\s+relations\b|\bwire\s+service\b"
        r")\b",
        low,
    ):
        return False
    hits = 0
    if re.search(r"\babstract\b", low):
        hits += 2
    if re.search(
        r"\b(original research|journal of the|jaha|circulation|lancet|nejm|jama|bmj|"
        r"double[- ]blind|doi\s*:|https?://doi\.org/)\b",
        low,
    ):
        hits += 2
    if re.search(
        r"\b(randomized|clinical trial)\b",
        low,
    ):
        hits += 1
    if re.search(r"\b(introduction|methods|results|discussion|conclusions?)\b", low):
        hits += 1
    if re.search(r"\b(doi\s*:|https?://doi\.org/|received\s+\w+\s+\d{1,2},?\s+20\d{2})", low):
        hits += 1
    # Author-line pattern: Name, MD; Name, PhD
    if re.search(r"\b[A-Z][a-z]+\s+[A-Z][a-z]+.+\b(?:MD|PhD|MBBS)\b", t):
        hits += 1
    return hits >= 4


def _paper_heading_norm(h: str) -> str | None:
    key = re.sub(r"\s+", " ", (h or "").strip().lower())
    key = re.sub(r"[^a-z0-9 ]+", "", key).strip()
    for canon, aliases in _PAPER_SECTION_ALIASES:
        if key in aliases or any(key.startswith(a) for a in aliases):
            return canon
    return None


def _compress_section_blurb(text: str, *, max_chars: int = 320) -> str:
    """1–2 clean sentences from a paper section (skip citations-only noise)."""
    blob = _clean_fetched_text(text or "")
    blob = re.sub(r"\s+", " ", blob).strip()
    if not blob:
        return ""
    sents = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", blob)
        if s.strip() and len(s.strip()) > 35
    ]
    picked: list[str] = []
    for s in sents:
        if re.match(r"(?i)^(figure|table|supplemental|corresponding author)\b", s):
            continue
        if _sentence_looks_garbled(s):
            continue
        if re.search(r"\b(for|the|a|an|of|and|with)\s*$", s, re.I):
            continue
        # Prefer sentences with substance
        sc = 0
        if re.search(
            r"\b(patient|trial|endpoint|efficac|safety|dose|random|primary|"
            r"secondary|p\s*[<=]|n\s*=|significan|method|we\s+(?:enrolled|found|observed))\b",
            s,
            re.I,
        ):
            sc += 2
        if sc <= 0 and len(picked) == 0:
            sc = 1
        if sc <= 0:
            continue
        picked.append(s)
        if len(picked) >= 2 or sum(len(x) for x in picked) >= max_chars:
            break
    out = " ".join(picked) if picked else blob[:max_chars]
    return out[:max_chars].strip()


_PAPER_INTRO_WORDS = 90
_PAPER_RESULTS_WORDS = 160
_PAPER_DISCUSSION_WORDS = 100
_PAPER_SECTION_WORDS = _PAPER_RESULTS_WORDS  # legacy alias (Results budget)
_PAPER_SECTION_SUMMARY_MAX = 1100
_PAPER_SECTION_ORDER = ("Introduction", "Results", "Discussion")
_PDF_NOT_AVAILABLE = "pdf not available"


def _summarize_to_word_budget(
    text: str, *, words: int = _PAPER_SECTION_WORDS, prefer_stats: bool = False
) -> str:
    """Extractive ~N-word summary from a chapter (complete sentences when possible)."""
    blob = _clean_fetched_text(text or "")
    blob = re.sub(r"\s+", " ", blob).strip()
    if not blob:
        return ""
    # Drop structured-abstract labels noise at start
    blob = re.sub(
        r"(?i)^(background|methods|results|conclusions?|objectives?|discussion)\s*[:.\-–]\s*",
        "",
        blob,
    ).strip()
    # Drop leading leftover punctuation from label splits (", perioperative…")
    blob = re.sub(r"^[\s,;:.\-–—]+", "", blob).strip()
    sents = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", blob)
        if s.strip() and len(s.strip()) > 28
    ]
    # Score sentences for investor-relevant content
    scored: list[tuple[int, str]] = []
    for s in sents:
        if re.match(
            r"(?i)^(figure|table|supplemental|corresponding|disclaimer|copyright|"
            r"downloaded from|key words|keywords)\b",
            s,
        ):
            continue
        if _sentence_looks_garbled(s):
            continue
        if re.search(r"\b(MD|PhD|MBBS|MSc)\b", s) and s.count(",") >= 2:
            continue
        sc = 0
        if re.search(
            r"\b(patient|trial|endpoint|efficac|safety|dose|random|primary|"
            r"phase|pain|crp|inflammation|tolerat|conclu|warrant|"
            r"p\s*[<=]|n\s*=|significan|enrolled|found|observed|support|"
            r"cohort|arm|versus|vs\.?|placebo|control|readout|ORR|PFS|OS|EFS|"
            r"HR|hazard|CI|confidence)\b",
            s,
            re.I,
        ):
            sc += 3
        if prefer_stats and re.search(
            r"(?:\d+(?:\.\d+)?\s*%|\bn\s*=\s*\d+|p\s*[<=>]\s*0?\.\d+|"
            r"\bHR\s*[=:]?\s*\d|95%\s*CI|OR\s*=)",
            s,
            re.I,
        ):
            sc += 4
        if re.search(r"\d", s):
            sc += 1
        if len(s) > 280:
            sc -= 1
        if sc > 0:
            scored.append((sc, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    # Rebuild in original order among top picks, then fill toward word budget
    top = {s for _, s in scored[:8]}
    ordered = [s for s in sents if s in top]
    if not ordered:
        ordered = sents[:5] or [blob]
    # If still short of budget, append remaining sentences in order
    for s in sents:
        if s not in ordered:
            ordered.append(s)
    out_words: list[str] = []
    last_complete = ""
    for s in ordered:
        piece = s.split()
        if len(out_words) + len(piece) > words and out_words:
            # Prefer ending on a completed sentence rather than mid-cut.
            break
        out_words.extend(piece)
        last_complete = " ".join(out_words).strip()
        if len(out_words) >= words:
            break
    if not last_complete:
        last_complete = " ".join(blob.split()[:words]).strip()
    summary = last_complete
    if summary and not re.search(r"[.!?]$", summary):
        # Only append period if we finished a sentence; else trim to last .!?
        m = re.search(r"^(.+[.!?])(?:\s+\S+)*$", summary)
        if m and len(m.group(1).split()) >= max(20, words // 3):
            summary = m.group(1).strip()
        else:
            summary = summary.rstrip(",;:") + "."
    cap = max(_PAPER_SECTION_SUMMARY_MAX, words * 8)
    return summary[:cap]


def _build_paper_chapter_summaries(
    sections_raw: dict[str, str], *, abstract: str
) -> list[dict[str, str]]:
    """
    Paper digest chapters only (no Abstract card):
    - Introduction — aim / design / population
    - Results — studies, conditions, readouts, outcomes + statistics
    - Discussion — implications / takeaways
    """
    out: list[dict[str, str]] = []
    abs_src = abstract or sections_raw.get("Abstract") or ""

    intro_src = (
        sections_raw.get("Introduction")
        or sections_raw.get("Background")
        or ""
    )
    if not intro_src and abs_src:
        m = re.search(
            r"(?is)\bBackground\b[:\s]*(.+?)(?=\bMethods\b|$)",
            abs_src,
        )
        if m:
            intro_src = m.group(1)
    if intro_src:
        out.append(
            {
                "heading": "Introduction",
                "summary": _summarize_to_word_budget(
                    intro_src, words=_PAPER_INTRO_WORDS
                ),
            }
        )

    results_src = sections_raw.get("Results") or ""
    if not results_src and abs_src:
        m = re.search(
            r"(?is)\bResults\b[:\s]*(.+?)(?=\bConclusions?\b|\bDiscussion\b|$)",
            abs_src,
        )
        if m:
            results_src = m.group(1)
    # Fold METHODS into Results when present — studies / arms / conditions.
    methods_src = sections_raw.get("Methods") or ""
    if not methods_src and abs_src:
        m = re.search(
            r"(?is)\bMethods\b[:\s]*(.+?)(?=\bResults\b|$)",
            abs_src,
        )
        if m:
            methods_src = m.group(1)
    if methods_src and results_src:
        results_blob = f"{methods_src} {results_src}"
    else:
        results_blob = results_src or methods_src
    if results_blob:
        out.append(
            {
                "heading": "Results",
                "summary": _summarize_to_word_budget(
                    results_blob, words=_PAPER_RESULTS_WORDS, prefer_stats=True
                ),
            }
        )

    conc_src = sections_raw.get("Conclusions") or ""
    if not conc_src and abs_src:
        m = re.search(r"(?is)\bConclusions?\b[:\s]*(.+?)$", abs_src)
        if m:
            conc_src = m.group(1)
    if not conc_src:
        conc_src = sections_raw.get("Discussion") or ""
    conc_blob = conc_src
    disc_src = sections_raw.get("Discussion") or ""
    if conc_src and disc_src and len(conc_src.split()) < _PAPER_DISCUSSION_WORDS:
        # Short conclusion block: include preceding discussion for fuller digest
        if conc_src.strip() not in disc_src:
            conc_blob = f"{disc_src} {conc_src}"
        else:
            conc_blob = disc_src
    if conc_blob:
        out.append(
            {
                "heading": "Discussion",
                "summary": _summarize_to_word_budget(
                    conc_blob, words=_PAPER_DISCUSSION_WORDS
                ),
            }
        )

    order = {h: i for i, h in enumerate(_PAPER_SECTION_ORDER)}
    out.sort(key=lambda x: order.get(str(x.get("heading")), 9))
    return [s for s in out if (s.get("summary") or "").strip()]


def _extract_paper_structure(text: str) -> dict[str, Any]:
    """
    Pull abstract + major chapter bodies from a journal PDF/text extract.
    Returns {paper_title, abstract, sections:[{heading, text, summary}]}.
    """
    raw = _clean_paper_text(text or "")
    # Keep newlines for heading detection; collapse weird form-feeds
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw = re.sub(r"[ \t]+\n", "\n", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    if not _looks_like_academic_paper(raw):
        return {}

    # Paper title: first long Title-ish line after journal chrome, before authors
    paper_title = ""
    head = raw[:2500]
    for ln in head.splitlines():
        s = ln.strip()
        if len(s) < 28 or len(s) > 220:
            continue
        if re.search(
            r"(?i)^(journal|original research|clinical trial|article|doi|received|"
            r"accepted|published|volume|issue|copyright|downloaded|http)\b",
            s,
        ):
            continue
        if re.search(r"\b(MD|PhD|MBBS|MSc)\b", s) and s.count(",") >= 1:
            continue
        if re.search(r"(?i)\befficacy and safety\b|\bphase\s*[i1-3]\b|\btrial\b", s):
            paper_title = s
            break
        if s[:1].isupper() and not s.isupper() and len(s.split()) >= 6:
            paper_title = s
            break

    # Find section starts (line headings preferred)
    heading_re = re.compile(
        r"(?m)^(?:\s*)("
        r"Abstract|ABSTRACT|"
        r"Introduction|INTRODUCTION|"
        r"Background|BACKGROUND|"
        r"Methods|METHODS|Materials and Methods|MATERIALS AND METHODS|"
        r"Results|RESULTS|"
        r"Discussion|DISCUSSION|"
        r"Conclusions?|CONCLUSIONS?"
        r")\s*$"
    )
    inline_re = re.compile(
        r"\b(Abstract|INTRODUCTION|METHODS|RESULTS|DISCUSSION|CONCLUSIONS?)\b(?=\s+[A-Z])"
    )
    matches: list[tuple[int, str]] = []
    for m in heading_re.finditer(raw):
        canon = _paper_heading_norm(m.group(1) or "")
        if canon:
            matches.append((m.start(), canon))
    if len(matches) < 2:
        for m in inline_re.finditer(raw):
            canon = _paper_heading_norm(m.group(1) or "")
            if canon:
                matches.append((m.start(), canon))
    matches.sort(key=lambda x: x[0])

    # Dedupe consecutive same headings (keep first)
    cleaned: list[tuple[int, str]] = []
    for pos, canon in matches:
        if cleaned and cleaned[-1][1] == canon and pos - cleaned[-1][0] < 80:
            continue
        cleaned.append((pos, canon))
    matches = cleaned

    sections_raw: dict[str, str] = {}
    for i, (pos, canon) in enumerate(matches):
        hm = re.match(
            r"(?is).{0,40}?(Abstract|INTRODUCTION|METHODS|RESULTS|DISCUSSION|"
            r"CONCLUSIONS?|Introduction|Background|Methods|Results|Discussion|"
            r"Conclusions?|Materials and Methods)\s*",
            raw[pos : pos + 80],
        )
        body_start = pos + (hm.end() if hm else 0)
        end = matches[i + 1][0] if i + 1 < len(matches) else min(len(raw), pos + 6000)
        chunk = raw[body_start:end].strip()
        if canon == "Abstract":
            # Stop at body INTRODUCTION, not at structured-abstract "Methods …"
            cut = re.search(
                r"(?i)(?:^|\n)\s*(INTRODUCTION|Key Words|Keywords|"
                r"Clinical Trial Registration)\b",
                chunk,
            )
            if cut and cut.start() > 120:
                chunk = chunk[: cut.start()].strip()
            # Also stop before a standalone METHODS chapter heading (all-caps line)
            cut2 = re.search(r"(?m)^\s*METHODS\s*$", chunk)
            if cut2 and cut2.start() > 120:
                chunk = chunk[: cut2.start()].strip()
        if len(chunk) < 40:
            continue
        prev = sections_raw.get(canon) or ""
        if not prev or (canon != "Abstract" and len(chunk) > len(prev) + 80):
            sections_raw[canon] = chunk[:8000]
        elif canon == "Abstract" and not prev:
            sections_raw[canon] = chunk[:5000]

    abstract = sections_raw.get("Abstract") or ""
    if not abstract:
        m = re.search(
            r"(?is)\bAbstract\b\s*(.+?)(?=\b(?:Introduction|INTRODUCTION|Methods|METHODS|"
            r"Key Words|Keywords)\b)",
            raw,
        )
        if m:
            abstract = re.sub(r"\s+", " ", m.group(1)).strip()[:3500]

    abstract_clean = re.sub(r"\s+", " ", abstract).strip()[:3500] if abstract else ""
    section_summaries = _build_paper_chapter_summaries(
        sections_raw, abstract=abstract_clean
    )
    if not abstract_clean and not section_summaries:
        return {}
    return {
        "paper_title": paper_title[:240] if paper_title else "",
        # Full abstract verbatim (whitespace-normalized only)
        "abstract": abstract_clean,
        "section_summaries": section_summaries,
        "sections_raw": {k: v[:2000] for k, v in sections_raw.items()},
        "is_paper": True,
    }


def _ai_enrich_paper_sections(
    *,
    abstract: str,
    sections: list[dict[str, str]],
    full_text: str,
    sections_raw: dict[str, str] | None = None,
) -> list[dict[str, str]] | None:
    """AI rewrite of Introduction, Results, Conclusions (~80 words each). Abstract stays verbatim."""
    if not sections and not abstract:
        return None
    raw_by_h = sections_raw or {}
    pack = []
    for s in sections[:6]:
        heading = str(s.get("heading") or "").strip()
        excerpt = raw_by_h.get(heading) or s.get("summary") or ""
        pack.append(
            {
                "heading": heading,
                "excerpt": str(excerpt)[:2500],
            }
        )
    clip = re.sub(r"\s+", " ", (full_text or ""))[:12000]
    prompt = (
        "Summarize Introduction, Results, and Conclusions of this clinical journal "
        "article for a biotech investor.\n"
        "Return ONLY JSON:\n"
        '{"section_summaries":['
        '{"heading":"Introduction","summary":"~80 words"},'
        '{"heading":"Results","summary":"~80 words"},'
        '{"heading":"Conclusions","summary":"~80 words"}'
        "]}\n"
        "Rules:\n"
        "- Do NOT rewrite or summarize the Abstract (it is shown verbatim elsewhere).\n"
        "- Each of Introduction, Results, and Conclusions ≈ 80 words (70–90), dense and factual.\n"
        "- Results must include hard numbers (n=, %, p-values, endpoints) when present.\n"
        "- Include hard numbers when present; do not invent data.\n"
        "- Skip author bios / degrees (MBBS, MD, PhD); do not echo the journal name.\n"
        f"ABSTRACT (context only):\n{(abstract or '')[:2500]}\n"
        f"EXTRACTED_SECTION_BLURBS:\n{json.dumps(pack, ensure_ascii=False)}\n"
        f"ARTICLE_CLIP:\n{clip}"
    )
    try:
        from ai_provider import call_ai

        raw = call_ai(
            prompt,
            system="Return valid JSON only. No markdown.",
            max_tokens=1100,
            task="summary",
        )
    except Exception as exc:
        logger.debug("paper section AI failed: %s", exc)
        return None
    if not raw:
        return None
    blob = raw.strip()
    if blob.startswith("```"):
        blob = re.sub(r"^```(?:json)?\s*", "", blob)
        blob = re.sub(r"\s*```$", "", blob)
    try:
        start = blob.find("{")
        end = blob.rfind("}")
        if start >= 0 and end > start:
            blob = blob[start : end + 1]
        obj = json.loads(blob)
    except Exception:
        return None
    prefer = _PAPER_SECTION_ORDER
    by_h: dict[str, str] = {}
    for s in (obj.get("section_summaries") or []) if isinstance(obj, dict) else []:
        if not isinstance(s, dict):
            continue
        h = str(s.get("heading") or "").strip()
        sm = _clean_fetched_text(str(s.get("summary") or "").strip())
        if not h or len(sm) < 20:
            continue
        hn = h[:40]
        for p in prefer:
            if p.lower() in hn.lower():
                hn = p
                break
        if hn not in prefer:
            continue
        by_h[hn] = sm[:_PAPER_SECTION_SUMMARY_MAX]
    out = [{"heading": h, "summary": by_h[h]} for h in prefer if h in by_h]
    return out or None


def _sanitize_paper_section_cards(
    sections: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Keep only Introduction / Results / Discussion; drop Abstract and noise."""
    by_h: dict[str, str] = {}
    for s in sections:
        h_raw = str(s.get("heading") or "").strip()
        sm = str(s.get("summary") or "").strip()
        if not h_raw or not sm or _sentence_looks_garbled(sm):
            continue
        if re.match(r"(?i)^abstract$", h_raw):
            continue
        if re.match(r"(?i)^(article|brief|article\s*/\s*brief)$", h_raw):
            continue
        if re.match(r"(?i)^(introduction|background|obiettivo|introduzione)", h_raw):
            h = "Introduction"
        elif re.match(r"(?i)^(results?|risultat|methods?)", h_raw):
            h = "Results"
        elif re.match(r"(?i)^(discussion|discussione|conclusions?)", h_raw):
            h = "Discussion"
        else:
            continue
        # Prefer longer / richer summary if duplicate heading
        prev = by_h.get(h)
        if prev and len(prev) >= len(sm):
            continue
        by_h[h] = sm[:_PAPER_SECTION_SUMMARY_MAX]
    return [{"heading": h, "summary": by_h[h]} for h in _PAPER_SECTION_ORDER if h in by_h]


def _apply_paper_brief_overrides(
    brief: dict[str, Any],
    *,
    paper: dict[str, Any],
    body: str,
    title: str,
) -> dict[str, Any]:
    """For journal papers: prefer abstract-led brief; drop contaminated news fields."""
    abstract_full = str(paper.get("abstract") or "").strip()
    if abstract_full:
        brief["abstract"] = abstract_full[:3500]
        brief["is_paper"] = True
        brief["detail_summary"] = _compress_section_blurb(abstract_full, max_chars=320)
    detail = str(brief.get("detail_summary") or "")
    if detail and not _content_matches_title(detail, title):
        if abstract_full:
            brief["detail_summary"] = _compress_section_blurb(abstract_full, max_chars=320)
        else:
            brief["detail_summary"] = _compress_section_blurb(body, max_chars=320)
    kr_src = abstract_full or body
    rx_kr = _extract_key_results_from_text(kr_src)
    if rx_kr:
        brief["key_results"] = rx_kr
        brief["key_points"] = [
            f"{kr['label']}: {kr['detail']}"[:220] for kr in rx_kr
        ][:6]
    elif not _content_matches_title(str(brief.get("results") or ""), title):
        brief["key_results"] = []
    results = str(brief.get("results") or "")
    if results and (
        not _content_matches_title(results, title)
        or re.search(r"(?i)journal of the|original research|jaha|mbbs trial", results)
    ):
        brief["results"] = None
    if abstract_full and not brief.get("indication"):
        brief["indication"] = _extract_indication(abstract_full) or _extract_indication(body)
    if brief.get("is_paper"):
        # Keep conference / catalyst dates for calendar migrate; drop placeholders only
        brief["dates"] = _filter_event_only_dates(
            brief.get("dates") if isinstance(brief.get("dates"), list) else []
        )
    facts = _extract_clinical_facts(abstract_full or body)
    if facts.get("product") and not brief.get("product"):
        brief["product"] = facts.get("product")
    if facts.get("phase") and not brief.get("phase"):
        brief["phase"] = facts.get("phase")
    st = str(brief.get("study") or facts.get("study") or "").strip().upper()
    if st in _STUDY_DEGREE_BLOCK:
        brief["study"] = None
    elif facts.get("study") and not brief.get("study"):
        brief["study"] = facts.get("study")
    return brief


def _apply_paper_digest_to_scores(
    scored: dict[str, Any], body: str
) -> dict[str, Any]:
    """Attach full abstract + ~80w Intro/Results/Conclusions; fix title-echo digests."""
    paper = _extract_paper_structure(body)
    if not paper:
        return scored
    abstract = str(paper.get("abstract") or "").strip()
    sections = list(paper.get("section_summaries") or [])
    ai_sections = _ai_enrich_paper_sections(
        abstract=abstract,
        sections=sections,
        full_text=body,
        sections_raw=paper.get("sections_raw")
        if isinstance(paper.get("sections_raw"), dict)
        else None,
    )
    if ai_sections:
        # Merge AI section summaries over extractive
        by_h = {str(s.get("heading")): s for s in sections if s.get("heading")}
        for s in ai_sections:
            by_h[str(s.get("heading"))] = s
        sections = [
            by_h[h]
            for h in _PAPER_SECTION_ORDER
            if h in by_h and by_h[h].get("summary")
        ]
    paper_title = str(paper.get("paper_title") or "").strip()
    scored["is_paper"] = True
    # Abstract verbatim (cleaned whitespace only)
    scored["abstract"] = abstract[:3500] if abstract else None
    cards: list[dict[str, str]] = []
    seen_h: set[str] = set()
    for s in sections:
        h = str(s.get("heading") or "").strip()
        sm = str(s.get("summary") or "").strip()
        if h not in set(_PAPER_SECTION_ORDER) or not sm:
            continue
        if h in seen_h:
            continue
        seen_h.add(h)
        cards.append({"heading": h, "summary": sm[:_PAPER_SECTION_SUMMARY_MAX]})
    order = {h: i for i, h in enumerate(_PAPER_SECTION_ORDER)}
    cards.sort(key=lambda x: order.get(x["heading"], 9))
    scored["section_summaries"] = _sanitize_paper_section_cards(cards)
    if paper_title and (
        not scored.get("summary_10w")
        or re.search(
            r"(?i)journal of the|original research|jaha is available",
            str(scored.get("summary_10w") or ""),
        )
    ):
        words = paper_title.split()
        scored["summary_10w"] = " ".join(words[:12])[:160]
    if abstract:
        lead = _compress_section_blurb(abstract, max_chars=420)
        if lead and (
            not scored.get("summary_long")
            or re.search(
                r"(?i)journal of the|original research|jaha is available|mbbs",
                str(scored.get("summary_long") or ""),
            )
            or len(str(scored.get("summary_long") or "")) < 80
        ):
            scored["summary_long"] = lead[:600]
        if not scored.get("results_note"):
            m = re.search(
                r"(?is)\bResults\b[:\s]*(.+?)(?=\bConclusions?\b|$)",
                abstract,
            )
            if m:
                scored["results_note"] = _summarize_to_word_budget(
                    m.group(1), words=40
                )
    st = str(scored.get("study") or "").strip().upper()
    if st in _STUDY_DEGREE_BLOCK:
        scored["study"] = None
    return _calibrate_dimension_scores(scored, body, force_paper=True)


def _heuristic_source_scores(text: str) -> dict[str, Any]:
    """Extractive digest + taxonomy heuristic scores (no free sentiment judgment)."""
    from eis_taxonomy_scoring import score_article_dimensions

    facts = _extract_clinical_facts(text)
    sents = re.split(r"(?<=[.!?])\s+", _clean_fetched_text(text))
    summary_long = " ".join(s.strip() for s in sents[:4] if s.strip())[:480]
    dims = score_article_dimensions(text, use_ai=False)
    scored = {
        "summary_10w": _ten_word_summary(text),
        "summary_long": summary_long or _ten_word_summary(text),
        "ticker": _infer_ticker_from_text(text),
        "clinical_score": dims.get("clinical_score"),
        "financial_score": dims.get("financial_score"),
        "corporate_score": dims.get("corporate_score"),
        "eis_score": dims.get("eis_score"),
        "market_access_score": dims.get("market_access_score"),
        "market_access_notes": dims.get("market_access_notes"),
        "taxonomy_version": dims.get("taxonomy_version"),
        "taxonomy_method": dims.get("taxonomy_method"),
        "taxonomy_dimensions": dims.get("taxonomy_dimensions"),
        "taxonomy_review_flags": dims.get("taxonomy_review_flags"),
        "taxonomy_audit": dims.get("taxonomy_audit"),
        "product": facts.get("product"),
        "study": facts.get("study"),
        "phase": facts.get("phase"),
        "results_note": facts.get("results"),
        "digest_method": "extractive",
        "eis": dims.get("eis"),
    }
    if _looks_like_academic_paper(text):
        scored["is_paper"] = True
    return scored


def _ai_analyze_source(text: str, *, source_label: str) -> dict[str, Any] | None:
    clip = re.sub(r"\s+", " ", (text or "")).strip()[:_ANALYZE_TEXT_MAX]
    if len(clip) < 40:
        return None
    prompt = (
        "You are a biotech equity / clinical analyst. Digest the SOURCE below.\n"
        "Return ONLY one JSON object (no markdown) with keys:\n"
        '{"summary_10w":"exactly ~10 words factual digest",'
        '"summary_long":"2-3 sentence factual summary with product, study, phase, outcome",'
        '"ticker":"optional ticker or null",'
        '"product":"drug/device/candidate name or null",'
        '"study":"trial/study name or acronym or null",'
        '"phase":"e.g. Phase II or null",'
        '"results_note":"what the data showed (endpoints, effect, safety) or null"}\n'
        "Do NOT invent numeric Clin/Fin/EIS/Access scores — scoring is done separately.\n"
        f"SOURCE ({source_label}):\n{clip}"
    )
    try:
        from ai_provider import call_ai

        raw = call_ai(
            prompt,
            system="Return valid JSON object only. No markdown fences. No numeric scores.",
            max_tokens=500,
            task="summary",
        )
    except Exception as exc:
        logger.debug("user source AI analyze failed: %s", exc)
        return None
    if not raw:
        return None
    blob = raw.strip()
    if blob.startswith("```"):
        blob = re.sub(r"^```(?:json)?\s*", "", blob)
        blob = re.sub(r"\s*```$", "", blob)
    try:
        start = blob.find("{")
        end = blob.rfind("}")
        if start >= 0 and end > start:
            blob = blob[start : end + 1]
        obj = json.loads(blob)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None

    from eis_taxonomy_scoring import score_article_dimensions

    dims = score_article_dimensions(clip, use_ai=True)
    summary = str(obj.get("summary_10w") or "").strip()
    if not summary:
        summary = _ten_word_summary(clip)
    else:
        w = summary.split()
        if len(w) > 14:
            summary = " ".join(w[:10])
    ticker = str(obj.get("ticker") or "").strip().upper() or None
    if ticker and (len(ticker) > 6 or not re.fullmatch(r"[A-Z.]{1,6}", ticker)):
        ticker = None
    if not ticker:
        ticker = _infer_ticker_from_text(clip)
    facts = _extract_clinical_facts(clip)
    summary_long = str(obj.get("summary_long") or "").strip()
    if not summary_long:
        summary_long = str(facts.get("results") or summary)[:480]
    product = str(obj.get("product") or facts.get("product") or "").strip() or None
    study = str(obj.get("study") or facts.get("study") or "").strip() or None
    phase = str(obj.get("phase") or facts.get("phase") or "").strip() or None
    results_note = (
        str(obj.get("results_note") or facts.get("results") or "").strip() or None
    )
    out = {
        "summary_10w": summary[:160],
        "summary_long": summary_long[:600],
        "ticker": ticker,
        "product": product[:80] if product else None,
        "study": study[:80] if study else None,
        "phase": phase[:40] if phase else None,
        "results_note": results_note[:500] if results_note else None,
        "clinical_score": dims.get("clinical_score"),
        "financial_score": dims.get("financial_score"),
        "corporate_score": dims.get("corporate_score"),
        "eis_score": dims.get("eis_score"),
        "market_access_score": dims.get("market_access_score"),
        "market_access_notes": dims.get("market_access_notes"),
        "taxonomy_version": dims.get("taxonomy_version"),
        "taxonomy_method": dims.get("taxonomy_method"),
        "taxonomy_dimensions": dims.get("taxonomy_dimensions"),
        "taxonomy_review_flags": dims.get("taxonomy_review_flags"),
        "taxonomy_audit": dims.get("taxonomy_audit"),
        "digest_method": "ai",
        "eis": dims.get("eis"),
    }
    if _looks_like_academic_paper(clip):
        out["is_paper"] = True
    return out


def _build_structured_paper_brief(
    *,
    title: str,
    body: str,
    url: str = "",
    ticker: str = "",
    abstract: str | None = None,
    section_summaries: list[dict[str, Any]] | None = None,
    product: str | None = None,
    study: str | None = None,
    phase: str | None = None,
) -> dict[str, Any]:
    """Investor digest for journal PDFs — same quality bar as news briefs."""
    abs_t = _clean_fetched_text(abstract or "")
    if not abs_t:
        paper = _extract_paper_structure(body)
        if paper:
            abs_t = _clean_fetched_text(str(paper.get("abstract") or ""))
            if not section_summaries:
                section_summaries = list(paper.get("section_summaries") or [])
            if not title:
                title = str(paper.get("paper_title") or title)
    facts = _extract_clinical_facts(f"{title}\n{abs_t}\n{body[:3000]}")
    product = product or facts.get("product")
    study = study or facts.get("study")
    phase = phase or facts.get("phase")
    indication = _extract_indication(f"{title}\n{abs_t}") or facts.get("indication")

    bits: list[str] = []
    if product or study or phase:
        bits.append(
            " · ".join(
                x
                for x in (
                    product,
                    f"{study} trial" if study else None,
                    phase,
                    f"in {indication}" if indication else None,
                )
                if x
            )
            + "."
        )
    if abs_t:
        bits.append(_compress_section_blurb(abs_t, max_chars=520))
    detail = " ".join(b for b in bits if b).strip()

    key_results: list[dict[str, str]] = []

    def _kr(label: str, detail_s: str | None) -> None:
        d = _clean_fetched_text(detail_s or "")
        if len(d) < 12:
            return
        key_results.append({"label": label, "detail": d[:400]})

    _kr(
        "Study setup",
        " · ".join(x for x in (phase, study, product, indication) if x) or None,
    )
    for s in section_summaries or []:
        if not isinstance(s, dict):
            continue
        h = str(s.get("heading") or "").strip()
        sm = str(s.get("summary") or "").strip()
        if re.search(r"(?i)^introduction$", h):
            _kr("Background", sm)
        elif re.search(r"(?i)^results$", h):
            _kr("Key efficacy", sm)
        elif re.search(r"(?i)^conclusions?$", h):
            _kr("Conclusions", sm)
    if abs_t and not any(k["label"] == "Key efficacy" for k in key_results):
        m = re.search(
            r"(?is)\bResults\b[:\s]*(.+?)(?=\bConclusions?\b|$)",
            abs_t,
        )
        if m:
            _kr("Key efficacy", _summarize_to_word_budget(m.group(1), words=45))
    if not key_results:
        rx = _extract_key_results_from_text(abs_t or body)
        key_results = rx[:6]

    return {
        "detail_summary": detail[:2200],
        "news_kind": "clinical",
        "indication": indication,
        "dates": [],
        "results": facts.get("results"),
        "key_results": key_results[:8],
        "product": product,
        "study": study,
        "phase": phase,
        "key_points": [
            f"{kr['label']}: {kr['detail']}"[:220] for kr in key_results[:6]
        ],
        "source_url": url or None,
        "ticker": ticker or None,
        "digest_method": "paper_structured",
        "is_paper": True,
        "abstract": abs_t[:3500] if abs_t else None,
        "section_summaries": list(section_summaries or []) or None,
    }


def _build_investor_digest(
    *,
    title: str,
    body: str,
    url: str = "",
    ticker: str = "",
    enrich_text: str = "",
    is_paper: bool = False,
    abstract: str | None = None,
    section_summaries: list | None = None,
    product: str | None = None,
    study: str | None = None,
    phase: str | None = None,
    allow_ai: bool = True,
) -> dict[str, Any]:
    """
    Shared type-aware investor digest used by Daily News briefs AND Manual analyze.
    Same templates: M&A / clinical / financial / other (+ paper structured).
    """
    title_s = _clean_fetched_text(title or "") or "News"
    body_s = body or ""
    ticker_s = (ticker or "").strip().upper()
    url_s = (url or "").strip()

    if is_paper or (
        _looks_like_academic_paper(body_s)
        and not re.search(r"(?i)stocktitan|globenewswire|prnewswire", url_s)
    ):
        paper_brief = _build_structured_paper_brief(
            title=title_s,
            body=body_s,
            url=url_s,
            ticker=ticker_s,
            abstract=abstract,
            section_summaries=section_summaries
            if isinstance(section_summaries, list)
            else None,
            product=product,
            study=study,
            phase=phase,
        )
        qa_paper = _run_digest_questionnaire(
            title=title_s, body=body_s, url=url_s, ticker=ticker_s
        )
        paper_brief["digest_answers"] = _normalize_digest_news_event_type(
            qa_paper.get("answers") or []
        )
        paper_brief["has_summary"] = bool(
            qa_paper.get("has_summary") or abstract or paper_brief.get("detail_summary")
        )
        paper_brief["has_bullet_summary"] = bool(qa_paper.get("has_bullet_summary"))
        paper_brief["headline"] = qa_paper.get("headline") or title_s
        # Thin extractive paper card → enrich with AI clinical template
        if len(str(paper_brief.get("detail_summary") or "")) < 220:
            abs_clip = str(
                abstract
                or ""
            ).strip()
            if len(abs_clip) < 200:
                abs_clip = body_s[:12_000]
            ai = (
                _ai_news_brief(abs_clip, title=title_s, ticker=ticker_s, url=url_s)
                if allow_ai
                else None
            )
            if ai and len(str(ai.get("detail_summary") or "")) >= 120:
                merged = dict(paper_brief)
                merged["detail_summary"] = ai.get("detail_summary")
                if ai.get("key_results"):
                    merged["key_results"] = ai.get("key_results")
                    merged["key_points"] = ai.get("key_points") or merged.get(
                        "key_points"
                    )
                for k in ("indication", "product", "study", "phase", "results"):
                    if ai.get(k) and not merged.get(k):
                        merged[k] = ai.get(k)
                merged["digest_method"] = "paper_ai"
                merged["is_paper"] = True
                merged["news_kind"] = "clinical"
                return merged
            # AI unavailable → clinical extractive brief on abstract/body
            heur = _heuristic_news_brief(
                title=title_s,
                summary=abs_clip[:800],
                url=url_s,
                ticker=ticker_s,
                article_text=abs_clip,
            )
            if len(str(heur.get("detail_summary") or "")) > len(
                str(paper_brief.get("detail_summary") or "")
            ):
                merged = dict(paper_brief)
                for k, v in heur.items():
                    if k in ("digest_method",):
                        continue
                    if v not in (None, "", []):
                        merged[k] = v
                merged["digest_method"] = "paper_extractive"
                merged["is_paper"] = True
                merged["news_kind"] = "clinical"
                return merged
        return paper_brief

    if _is_shareholder_alert(title_s, body_s):
        return _build_shareholder_alert_brief(
            title=title_s,
            body=body_s,
            url=url_s,
            ticker=ticker_s,
        )

    kind = _detect_news_kind(f"{title_s}\n{body_s}", title=title_s)
    # Always run Q&A framework (works even on thin title-only fetches)
    qa = _run_digest_questionnaire(
        title=title_s, body=body_s, url=url_s, ticker=ticker_s
    )
    if qa.get("speculative_ma") or kind != "ma":
        ma_enrich = enrich_text or ""
    else:
        ma_enrich = enrich_text or ""
    work_body = body_s
    if kind == "ma" and not qa.get("speculative_ma"):
        if not ma_enrich and allow_ai:
            try:
                ma_enrich = _enrich_ma_announcement_body(
                    title=title_s, ticker=ticker_s, body=work_body
                )
            except Exception:
                ma_enrich = ""
        if ma_enrich and len(ma_enrich) > 200:
            work_body = (
                f"{work_body}\n\n--- PRIOR ACQUISITION ANNOUNCEMENT (economics/context) ---\n"
                f"{ma_enrich}"
            )[:_ANALYZE_TEXT_MAX]

    # Thin body / failed fetch → Q&A from headline, then Gemini paragraph cards.
    thin_body = len(_clean_fetched_text(work_body)) < 280
    para_src = work_body if len(_clean_fetched_text(work_body)) >= 80 else (
        f"{title_s}\n{work_body}"
    )
    want_paras = len(_clean_fetched_text(para_src)) >= 80 and (
        allow_ai or thin_body
    )

    def _with_gemini_paragraphs(card: dict[str, Any]) -> dict[str, Any]:
        if not want_paras or (card.get("section_summaries") or []):
            return card
        paras = _gemini_news_paragraphs(title=title_s, text=para_src)
        if paras:
            card["section_summaries"] = paras
            card["is_paper"] = False
        return card

    if thin_body or (
        qa.get("has_bullet_summary") and len(work_body) < 900
    ):
        qa_brief = _brief_from_digest_qa(qa, ticker=ticker_s, url=url_s)
        qa_brief = _with_gemini_paragraphs(qa_brief)
        if (
            len(str(qa_brief.get("detail_summary") or "")) >= 60
            or (qa_brief.get("section_summaries") or [])
        ):
            return _align_brief_to_headline(
                _dedupe_brief_sections(qa_brief), title_s, work_body
            )

    brief = None
    if allow_ai:
        brief = _ai_news_brief(
            work_body, title=title_s, ticker=ticker_s, url=url_s
        )
    if not brief:
        brief = _heuristic_news_brief(
            title=title_s,
            summary=work_body[:500],
            url=url_s,
            ticker=ticker_s,
            article_text=work_body,
            enrich_text=ma_enrich,
        )

    if (kind == "ma" or brief.get("news_kind") == "ma") and not qa.get(
        "speculative_ma"
    ):
        ds = str(brief.get("detail_summary") or "")
        contaminated = bool(
            re.search(r"(?i)\b(positive topline|Demodex|XDEMVY|blepharitis)\b", ds)
        ) and not re.search(
            r"(?i)\b(Demodex|XDEMVY|blepharitis)\b",
            f"{title_s}\n{work_body[:1500]}",
        )
        thin_ma = len(ds) < 120 or not brief.get("key_results")
        invented_target = bool(
            re.search(r"(?i)acquire the target company|acquisition of the target", ds)
        )
        if contaminated or thin_ma or invented_target:
            brief = _build_structured_ma_brief(
                title=title_s,
                body=work_body,
                url=url_s,
                ticker=ticker_s,
                enrich_text=ma_enrich,
            )
    elif qa.get("speculative_ma"):
        # Never keep closed-deal MA template on speculative pieces
        brief = _brief_from_digest_qa(qa, ticker=ticker_s, url=url_s)

    # Merge Q&A metadata + upgrade thin AI/heuristic with bullets/headline
    brief["digest_answers"] = _normalize_digest_news_event_type(qa.get("answers") or [])
    brief["has_summary"] = bool(qa.get("has_summary"))
    brief["has_bullet_summary"] = bool(qa.get("has_bullet_summary"))
    brief["headline"] = qa.get("headline") or title_s
    if qa.get("bullet_points") and (
        not brief.get("key_results")
        or len(str(brief.get("detail_summary") or "")) < 160
        or re.search(r"(?i)acquire the target company", str(brief.get("detail_summary") or ""))
    ):
        # Financing already has a structured lede — do not replace it with echoed bullets.
        if str(brief.get("news_kind") or kind) != "financial":
            qa_brief = _brief_from_digest_qa(qa, ticker=ticker_s, url=url_s)
            brief["detail_summary"] = qa_brief.get("detail_summary")
            brief["key_results"] = qa_brief.get("key_results")
            brief["key_points"] = qa_brief.get("key_points")
            brief["news_kind"] = qa_brief.get("news_kind")
            brief["digest_method"] = "qa_framework"
    elif qa.get("bullet_points") and not brief.get("key_results"):
        if str(brief.get("news_kind") or kind) != "financial":
            brief["key_results"] = [
                {"label": f"Key point {i}", "detail": str(b)[:400]}
                for i, b in enumerate(qa["bullet_points"][:6], 1)
            ]

    # Thin clinical AI → merge regex key_results
    if len(work_body) > 500 and not (brief.get("key_results") or []):
        rx = _extract_key_results_from_text(work_body)
        if rx:
            brief["key_results"] = rx
            brief["key_points"] = [
                f"{kr['label']}: {kr['detail']}"[:220] for kr in rx[:6]
            ]
    if not brief.get("indication"):
        brief["indication"] = _extract_indication(work_body)
    if not brief.get("news_kind"):
        brief["news_kind"] = kind
    # Fill product/study/phase from caller/facts when AI omitted
    facts = _extract_clinical_facts(f"{title_s}\n{work_body[:4000]}")
    for k, v in (
        ("product", product or facts.get("product")),
        ("study", study or facts.get("study")),
        ("phase", phase or facts.get("phase")),
    ):
        if not brief.get(k) and v:
            brief[k] = v
    desigs = _extract_fda_designations(f"{title_s}\n{work_body[:6000]}\n{brief.get('detail_summary') or ''}")
    if desigs:
        brief["fda_designations"] = desigs
    if (
        allow_ai
        and not is_paper
        and not brief.get("is_paper")
        and not (brief.get("section_summaries") or [])
        and len(work_body) >= 80
    ):
        paras = _gemini_news_paragraphs(title=title_s, text=work_body)
        if paras:
            brief["section_summaries"] = paras
            brief["is_paper"] = False
    # Investor Insight: Clin / Corp / Fin / Market Access + stock-price (Gemini).
    # Papers included — shown at the end of Intro/Results/Discussion digests.
    if (
        allow_ai
        and not brief.get("investor_insight")
        and len(str(brief.get("detail_summary") or work_body or "")) >= 80
    ):
        insight = _ai_investor_insight(
            title=title_s,
            body=work_body,
            ticker=ticker_s,
            news_kind=str(brief.get("news_kind") or kind or ("paper" if is_paper else "")),
            detail_summary=str(brief.get("detail_summary") or ""),
        )
        if insight:
            brief["investor_insight"] = insight
    return _align_brief_to_headline(_dedupe_brief_sections(brief), title_s, work_body)


def _merge_investor_digest_into_row(
    row: dict[str, Any], digest: dict[str, Any]
) -> dict[str, Any]:
    """Attach structured digest fields onto a Manual analysis / news row."""
    out = dict(row)
    if not isinstance(digest, dict):
        return out
    ds = str(digest.get("detail_summary") or "").strip()
    if ds:
        out["detail_summary"] = ds[:2200]
        # Prefer investor digest over title-echo / chrome summaries
        sl = str(out.get("summary_long") or "")
        if (
            len(ds) > len(sl) + 40
            or re.search(
                r"(?i)journal of the|original research|jaha|mbbs|stock titan",
                sl,
            )
            or len(sl) < 80
        ):
            out["summary_long"] = ds[:600]
    for k in (
        "news_kind",
        "indication",
        "dates",
        "key_results",
        "key_points",
        "results",
        "product",
        "study",
        "phase",
        "fda_designations",
        "section_summaries",
        "is_paper",
        "investor_insight",
    ):
        v = digest.get(k)
        if v is None or v == "" or v == []:
            continue
        if k in ("product", "study", "phase") and out.get(k):
            continue
        if k == "fda_designations":
            prev = out.get("fda_designations")
            merged = list(prev) if isinstance(prev, list) else []
            for d in v if isinstance(v, list) else []:
                if d and d not in merged:
                    merged.append(d)
            if merged:
                out["fda_designations"] = merged
            continue
        out[k] = v
    if digest.get("results") and not out.get("results_note"):
        out["results_note"] = str(digest.get("results"))[:500]
    if digest.get("digest_method"):
        # Keep score method; tag digest separately
        out["brief_digest_method"] = digest.get("digest_method")
    out["digest_v"] = 4
    return out


def analyze_user_source(
    *,
    text: str | None = None,
    url: str | None = None,
    pdf_bytes: bytes | None = None,
    pdf_name: str | None = None,
) -> dict[str, Any]:
    """
    Digest pasted text, a web page, or a PDF into a ~10-word summary plus
    clinical / financial / EIS / market-access scores. Display only — not Soft BUY/SELL.
    """
    source_kind = "text"
    source_label = "pasted text"
    source_ref = ""
    body = (text or "").strip()
    err: str | None = None

    if pdf_bytes:
        source_kind = "pdf"
        source_label = pdf_name or "upload.pdf"
        source_ref = source_label
        try:
            from catalyst_extractor import _extract_text_from_pdf

            body = _extract_text_from_pdf(pdf_bytes, max_chars=_ANALYZE_TEXT_MAX)
            body = _clean_paper_text(body)
        except Exception as exc:
            err = str(exc)[:200]
            body = ""
    elif (url or "").strip():
        source_kind = "url"
        source_label = (url or "").strip()
        source_ref = source_label
        # Prefer EDGAR path for Manual News SEC links (same as News Brief).
        if _is_sec_edgar_archives_url(source_label):
            body, err = _fetch_edgar_8k_text_from_url(source_label)
            if not body:
                body, err = _fetch_url_text(source_label)
        else:
            body, err = _fetch_url_text(source_label)
    elif body:
        source_kind = "text"
        source_ref = ""
        m = re.search(r"https?://[^\s<>\"']+", body)
        if m:
            source_ref = m.group(0).rstrip(".,);:!")
            source_label = source_ref
        # Short paste → try to pull the full press article for a richer digest
        if _news_body_needs_enrichment(body):
            richer, found_url, _e = _enrich_thin_news_body(
                title=body[:160],
                ticker=_infer_ticker_from_text(body) or "",
                body=body,
            )
            if richer and len(richer) > len(body) + 40:
                body = richer
                if found_url and not source_ref:
                    source_ref = found_url
                    source_label = found_url
    else:
        return {"ok": False, "error": "provide_text_url_or_pdf"}

    if err and not body:
        return {"ok": False, "error": err, "source_kind": source_kind, "source_ref": source_ref}
    if len(body.strip()) < 40:
        return {
            "ok": False,
            "error": (
                "pdf_text_empty"
                if source_kind == "pdf"
                else "content_too_short"
            ),
            "source_kind": source_kind,
            "source_ref": source_ref,
            "hint": (
                "Could not extract text from this PDF (scanned/image-only or encrypted). "
                "Paste the abstract text or use a text-based PDF."
                if source_kind == "pdf"
                else None
            ),
        }

    scored: dict[str, Any] | None = None
    # SEC 8-K Manual News: structural Item brief + taxonomy (never PAGE CHECK Q&A).
    if _is_sec_edgar_archives_url(source_ref or source_label) and body:
        parsed = _parse_edgar_filing_url(source_ref or source_label)
        tk_hint = _ticker_for_cik10(parsed["cik10"]) if parsed else None
        if not tk_hint:
            tk_hint = _infer_ticker_from_text(body)
        pub_hint = (
            _extract_publication_date(body, title="", fallback=None)
            or _publication_date_from_url(str(source_ref or source_label))
            or _rome_date()
        )
        sec_brief = _build_sec_8k_structured_brief(
            text=body,
            ticker=tk_hint or "",
            title_hint="",
            url=source_ref or source_label,
            filing_date=pub_hint,
        )
        scored = {
            "ticker": tk_hint or sec_brief.get("ticker"),
            "summary_10w": _ten_word_summary(
                str(sec_brief.get("title") or sec_brief.get("detail_summary") or "")
            ),
            "summary_long": str(sec_brief.get("detail_summary") or "")[:3500],
            "detail_summary": str(sec_brief.get("detail_summary") or "")[:3500],
            "title": str(sec_brief.get("title") or "")[:240] or None,
            "clinical_score": sec_brief.get("clinical_score"),
            "financial_score": sec_brief.get("financial_score"),
            "corporate_score": sec_brief.get("corporate_score"),
            "market_access_score": sec_brief.get("market_access_score"),
            "market_access_notes": sec_brief.get("market_access_notes"),
            "eis_score": sec_brief.get("eis_score"),
            "eis": sec_brief.get("eis"),
            "taxonomy_dimensions": sec_brief.get("taxonomy_dimensions"),
            "taxonomy_review_flags": sec_brief.get("taxonomy_review_flags"),
            "taxonomy_method": sec_brief.get("taxonomy_method"),
            "taxonomy_version": sec_brief.get("taxonomy_version"),
            "taxonomy_audit": sec_brief.get("taxonomy_audit"),
            "taxonomy_classification": sec_brief.get("taxonomy_classification"),
            "items_detected": sec_brief.get("items_detected"),
            "item_summaries": sec_brief.get("item_summaries"),
            "section_summaries": sec_brief.get("section_summaries"),
            "cover_metadata": sec_brief.get("cover_metadata"),
            "digest_method": sec_brief.get("digest_method") or "sec_8k_items",
            "news_kind": sec_brief.get("news_kind") or "financial",
            "is_paper": False,
            "digest_answers": [],
            "has_summary": True,
            "has_bullet_summary": False,
            "skip_page_check": True,
            "product": None,
            "study": None,
            "phase": None,
            "published_at": sec_brief.get("published_at"),
            "event_date": sec_brief.get("event_date"),
            "key_results": sec_brief.get("key_results"),
            "key_points": sec_brief.get("key_points"),
        }
        try:
            insight = _ai_investor_insight(
                title=str(scored.get("title") or scored.get("summary_10w") or ""),
                body=body,
                ticker=str(scored.get("ticker") or ""),
                news_kind="financial",
                detail_summary=str(scored.get("detail_summary") or ""),
            )
            if insight:
                scored["investor_insight"] = insight
        except Exception:
            pass

    if not scored:
        scored = _ai_analyze_source(body, source_label=source_kind) or _heuristic_source_scores(
            body
        )
    if not scored.get("ticker"):
        scored["ticker"] = _infer_ticker_from_text(
            f"{body}\n{scored.get('summary_10w') or ''}\n{scored.get('summary_long') or ''}"
        )
    if scored.get("digest_method") not in (
        "ai_8k",
        "extractive",
        "heuristic_8k",
        "sec_8k_items",
        "sec_8k_gemini",
    ):
        scored = _apply_paper_digest_to_scores(scored, body)
        scored = _calibrate_dimension_scores(
            scored,
            body,
            force_paper=bool(scored.get("is_paper") or source_kind == "pdf"),
        )
    # Same structured investor digest as Daily News briefs (M&A/clinical/financial/paper)
    title_for_digest = (
        str(scored.get("title") or scored.get("summary_10w") or "").strip()
        or str(scored.get("summary_long") or "").strip()
        or (body[:160] if body else "Manual news")
    )
    if scored.get("digest_method") not in (
        "ai_8k",
        "extractive",
        "heuristic_8k",
        "sec_8k_items",
        "sec_8k_gemini",
    ):
        try:
            digest = _build_investor_digest(
                title=title_for_digest,
                body=body,
                url=source_ref if str(source_ref).startswith("http") else "",
                ticker=str(scored.get("ticker") or ""),
                is_paper=bool(scored.get("is_paper") or source_kind == "pdf"),
                abstract=scored.get("abstract") if isinstance(scored.get("abstract"), str) else None,
                section_summaries=scored.get("section_summaries")
                if isinstance(scored.get("section_summaries"), list)
                else None,
                product=scored.get("product") if isinstance(scored.get("product"), str) else None,
                study=scored.get("study") if isinstance(scored.get("study"), str) else None,
                phase=scored.get("phase") if isinstance(scored.get("phase"), str) else None,
            )
            scored = _merge_investor_digest_into_row(scored, digest)
        except Exception as exc:
            logger.debug("Manual investor digest failed: %s", exc)
    # Keep a longer excerpt for papers (abstract + early chapters for re-brief)
    excerpt_lim = 12_000 if scored.get("is_paper") else 4000
    excerpt = (
        _clean_paper_text(body)[:excerpt_lim]
        if scored.get("is_paper")
        else _clean_fetched_text(body)[:excerpt_lim]
    )
    pub = _extract_publication_date(
        body,
        title=title_for_digest,
        fallback=None,
    )
    if not pub and str(source_ref).startswith("http"):
        pub = _publication_date_from_url(str(source_ref))
    if not pub and re.search(r"(?i)\btoday\s+(?:announced|reported|disclosed)\b", body):
        pub = _rome_date()
    row = {
        "id": hashlib.sha1(f"{source_kind}|{source_ref}|{scored.get('summary_10w')}".encode()).hexdigest()[:16],
        "source_kind": source_kind,
        "source_ref": source_ref[:500],
        "source_label": source_label[:240],
        "source_excerpt": excerpt,
        "found_at": _now_iso(),
        "published_at": pub,
        "event_date": pub,
        **scored,
    }
    # scored may overwrite — restore publication fields if digest omitted them
    if pub:
        row["published_at"] = pub
        row["event_date"] = pub
    elif row.get("event_date") and not row.get("published_at"):
        row["published_at"] = str(row.get("event_date"))[:10]
    doc = _read()
    prev = [a for a in (doc.get(_USER_ANALYSES_KEY) or []) if isinstance(a, dict)]
    prev = [a for a in prev if a.get("id") != row["id"]]
    prev.insert(0, row)
    doc[_USER_ANALYSES_KEY] = prev[:_USER_ANALYSES_CAP]
    doc["updated_at"] = _now_iso()
    _write(doc)
    try:
        rid = str(row.get("id") or "")
        cache_staged_daily_news_to_clinical(
            only_ids={rid} if rid else None,
        )
    except Exception as exc:
        logger.debug("Manual analysis clinical pre-cache failed: %s", exc)
    out = load_daily_news()
    out["ok"] = True
    out["analysis"] = row
    # Manual paste/URL — warm the same investor brief the modal will open.
    try:
        _spawn_brief_prefetch(
            [
                {
                    "id": row.get("id"),
                    "title": row.get("title") or row.get("summary_10w"),
                    "summary": row.get("detail_summary") or row.get("summary_long") or "",
                    "ticker": row.get("ticker"),
                    "link": row.get("source_ref") or row.get("link") or "",
                    "resolved_link": row.get("resolved_link") or "",
                    "article_fp": row.get("article_fp") or "",
                }
            ]
        )
    except Exception:
        pass
    return out


def _strip_heuristic_noise(text: str) -> str:
    """Remove market-access heuristic lines that pollute Manual briefs."""
    lines = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if re.match(r"(?i)^heuristic:\s*", s):
            continue
        if re.match(r"(?i)^little market-access signal", s):
            continue
        lines.append(s)
    return "\n".join(lines).strip()


def _extract_ma_deal_facts(text: str, *, title: str = "") -> dict[str, Any]:
    """Structured facts for M&A / license digests (deal + asset + clinical + dates)."""
    blob = _clean_fetched_text(f"{title}\n{text}")
    out: dict[str, Any] = {
        "buyer": None,
        "target": None,
        "product": None,
        "product_aka": None,
        "indication": None,
        "phase": None,
        "study": None,
        "moa": None,
        "unmet_need": None,
        "fda_designations": [],
        "rights": None,
        "route": None,
        "economics": None,
        "announce_date": None,
        "close_date": None,
        "readout_date": None,
        "is_close": bool(
            re.search(
                r"\b(complet(?:es|ed)|clos(?:es|ed|ing)|has\s+closed)\b.{0,40}\b"
                r"(acquisition|merger|transaction|deal)\b|"
                r"\b(acquisition|merger|transaction)\b.{0,40}\b"
                r"(complet(?:es|ed)|clos(?:es|ed))\b",
                blob,
                re.I,
            )
        ),
    }
    m = re.search(
        r"\b([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})\s*"
        r"\((?:Nasdaq|NYSE|TSX|TSXV|AMEX)\s*:\s*([A-Z.]{1,6})\)",
        blob,
        re.I,
    )
    if m:
        out["buyer"] = m.group(1).strip()
    m = re.search(
        r"\bacquisition of\s+([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,4})"
        r"(?:\s*,|\s+Inc|\s+Ltd|\s+Corp|\s+a\s+privately)",
        blob,
        re.I,
    )
    if m:
        out["target"] = re.sub(r"\s+", " ", m.group(1)).strip(" ,.")
    # Product: prefer INN (aka CODE) then CODE alone
    m = re.search(
        r"\b([a-z][a-z0-9-]{5,})\s*\(([A-Z]{2,6}-\d{1,4})\)",
        blob,
    )
    if m:
        out["product"] = m.group(1)
        out["product_aka"] = m.group(2)
    if not out["product_aka"]:
        m = re.search(r"\b([A-Z]{2,6}-\d{1,4})\b", blob)
        if m:
            out["product_aka"] = m.group(1)
    if not out["product_aka"]:
        # Codes without hyphen (NEO100, NTHI's NEO212, …)
        m = re.search(r"\b([A-Z]{2,6}\d{2,4}[A-Z]?)\b", blob)
        if m:
            out["product_aka"] = m.group(1)
    if not out["product"] and out["product_aka"]:
        out["product"] = out["product_aka"]
    ind = _extract_indication(blob)
    if ind:
        out["indication"] = ind
    if re.search(r"(?i)\bstargardt", blob):
        out["indication"] = "Stargardt disease"
    m = re.search(r"(?i)\b(Phase\s*[I1-3]+[abc]?)\b", blob)
    if m:
        out["phase"] = re.sub(r"\s+", " ", m.group(1)).strip()
    codes = _study_codes_from_text(blob)
    # Prefer named Phase 3 trial acronym near "Phase 3"
    m = re.search(
        r"(?i)\b(?:global\s+)?([A-Z]{4,})\s+Phase\s*[I1-3]|Phase\s*[I1-3]\s+([A-Z]{4,})\b",
        blob,
    )
    if m:
        out["study"] = (m.group(1) or m.group(2) or "").upper()
    elif codes:
        # Skip product-like codes ALK-001
        for c in codes:
            if not re.match(r"^[A-Z]{2,6}-\d+", c):
                out["study"] = c
                break
    m = re.search(
        r"(?i)designed to\s+([^.]{20,180})|"
        r"targeting\s+([^.]{15,140})|"
        r"reduce(?:s|ing)?\s+the\s+accumulation of\s+([^.]{10,120})",
        blob,
    )
    if m:
        out["moa"] = _clean_fetched_text(
            next(g for g in m.groups() if g)
        )[:200]
    if re.search(
        r"(?i)no\s+FDA-approved\s+(?:therapy|treatment|drug)|"
        r"with\s+no\s+FDA-approved|"
        r"unmet\s+(?:medical\s+)?need",
        blob,
    ):
        out["unmet_need"] = (
            f"No FDA-approved therapy for {out['indication']}"
            if out.get("indication")
            else "No FDA-approved therapy in this indication"
        )
    des: list[str] = []
    for label in (
        "Breakthrough Therapy",
        "Orphan Drug",
        "Fast Track",
        "Rare Pediatric Disease",
        "Priority Review",
        "RMAT",
        "Accelerated Approval",
    ):
        if re.search(re.escape(label), blob, re.I):
            des.append(label)
    out["fda_designations"] = des
    if re.search(r"(?i)worldwide\s+rights|global\s+rights", blob):
        out["rights"] = "worldwide rights"
    if re.search(r"(?i)\bonce-daily\s+oral|oral\s+(?:investigational|tablet|small)", blob):
        out["route"] = "once-daily oral"
    # Economics — only real deal terms with $ / shares (never stock-move % chrome)
    m = re.search(
        r"([^.%]{0,50}"
        r"(?:\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|m|bn|b)?|"
        r"\d[\d,]*(?:\.\d+)?\s*(?:million|billion)\s+(?:shares|in\s+(?:cash|stock)))"
        r"[^.%]{0,40}\b(?:upfront|milestone|earn-?out|royalt(?:y|ies)|"
        r"consideration|cash\s+and\s+stock|total\s+(?:deal|transaction)\s+value)\b"
        r"[^.%]{0,160}|"
        r"[^.%]{0,40}\b(?:upfront|total\s+consideration|purchase\s+price)\b[^.%]{0,40}"
        r"(?:\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|m|bn|b)?)"
        r"[^.%]{0,160})",
        blob,
        re.I,
    )
    if m:
        eco = _clean_fetched_text(m.group(1))[:280]
        if not re.search(r"(?i)\b(?:24-?hour|session|stock moved|market reaction)\b", eco):
            out["economics"] = eco
    # Dates (prose + Stock Titan Key Figures labels)
    _mon = (
        r"(?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
    )
    m = re.search(
        rf"(?i)(?:Acquisition\s+Announcement\s+Date:?\s*|"
        rf"announced on\s+|previously announced on\s+)"
        rf"(({_mon})\.?\s+\d{{1,2}},?\s+20\d{{2}})",
        blob,
    )
    if m:
        out["announce_date"] = re.sub(r"\s+", " ", m.group(1)).strip()
    m = re.search(
        rf"(?i)(?:Acquisition\s+Completion\s+Date:?\s*|"
        rf"(?:IRVINE|CAMBRIDGE|NEW YORK|SAN FRANCISCO|BOSTON|SEATTLE)[^.,]{{0,50}},\s*)"
        rf"(({_mon})\.?\s+\d{{1,2}},?\s+20\d{{2}})",
        blob,
    )
    if m:
        out["close_date"] = re.sub(r"\s+", " ", m.group(1)).strip()
    if not out["close_date"] and out.get("is_close"):
        m = re.search(
            rf"(?i)(?:closed|completed|closing)\s+(?:on\s+)?(({_mon})\.?\s+\d{{1,2}},?\s+20\d{{2}})",
            blob,
        )
        if m:
            out["close_date"] = re.sub(r"\s+", " ", m.group(1)).strip()
    m = re.search(
        r"(?i)topline\s+data\s+(?:anticipated|expected|guided)\s+in\s+(20\d{2})",
        blob,
    )
    if m:
        out["readout_date"] = m.group(1)
    # Buyer from title when body was truncated mid-sentence
    if not out.get("buyer") and title:
        m = re.search(
            r"^([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,4})"
            r"\s+(?:Completes|Completed|Announces|to\s+Acquire|Acquires)\b",
            title.strip(),
        )
        if m:
            out["buyer"] = m.group(1).strip()
    return out


def _build_structured_ma_brief(
    *,
    title: str,
    body: str,
    url: str,
    ticker: str,
    enrich_text: str = "",
) -> dict[str, Any]:
    """
    Investor digest for M&A / license close or announcement.
    Matches the analysis template: deal, asset, unmet need, regulatory,
    clinical status, economics (if stated), calendar dates.
    """
    primary = _strip_article_chrome(_clean_fetched_text(body or ""))
    extra = _strip_article_chrome(_clean_fetched_text(enrich_text or ""))
    # Key Figures / widget dates often live past the chrome cut — harvest from raw too
    raw_blob = _clean_fetched_text(f"{body or ''}\n{enrich_text or ''}")
    facts = _extract_ma_deal_facts(primary, title=title)
    if extra:
        more = _extract_ma_deal_facts(extra, title=title)
        for k, v in more.items():
            if not facts.get(k) and v:
                facts[k] = v
            elif k == "fda_designations" and v:
                facts[k] = list(dict.fromkeys([*(facts.get(k) or []), *v]))
            elif k == "economics" and v and not facts.get("economics"):
                facts[k] = v
    if raw_blob:
        raw_facts = _extract_ma_deal_facts(raw_blob, title=title)
        for k in (
            "announce_date",
            "close_date",
            "readout_date",
            "economics",
            "buyer",
            "target",
        ):
            if not facts.get(k) and raw_facts.get(k):
                facts[k] = raw_facts[k]
        if not facts.get("fda_designations") and raw_facts.get("fda_designations"):
            facts["fda_designations"] = raw_facts["fda_designations"]

    product_label = facts.get("product") or ""
    if facts.get("product_aka") and facts.get("product") != facts.get("product_aka"):
        product_label = f"{facts['product']} ({facts['product_aka']})"
    elif facts.get("product_aka"):
        product_label = str(facts["product_aka"])

    # detail_summary — multi-sentence structured lede (never clinical topline template)
    bits: list[str] = []
    buyer = facts.get("buyer") or (ticker.upper() if ticker else "The company")
    target = facts.get("target") or "the target company"
    if facts.get("is_close"):
        bits.append(
            f"{buyer} completed its acquisition of {target}"
            + (
                f" on {facts['close_date']}"
                if facts.get("close_date")
                else ""
            )
            + (
                f", following the agreement announced on {facts['announce_date']}"
                if facts.get("announce_date")
                else ""
            )
            + "."
        )
    else:
        bits.append(
            f"{buyer} announced an agreement to acquire {target}"
            + (
                f" on {facts['announce_date']}"
                if facts.get("announce_date")
                else ""
            )
            + "."
        )
    asset_bits = []
    if product_label:
        asset_bits.append(product_label)
    if facts.get("route"):
        asset_bits.append(facts["route"])
    if facts.get("phase"):
        asset_bits.append(facts["phase"])
    if facts.get("rights"):
        asset_bits.append(facts["rights"])
    if asset_bits or facts.get("indication"):
        line = "The deal adds "
        if asset_bits:
            line += ", ".join(asset_bits)
        if facts.get("indication"):
            line += f" for {facts['indication']}"
        if facts.get("moa"):
            line += f", designed to {facts['moa'].rstrip('.')}"
        line += "."
        bits.append(line)
    if facts.get("unmet_need"):
        bits.append(f"{facts['unmet_need']}.")
    if facts.get("fda_designations"):
        bits.append(
            "FDA designations: " + ", ".join(facts["fda_designations"]) + "."
        )
    if facts.get("study") or facts.get("readout_date"):
        clin = []
        if facts.get("study") and facts.get("phase"):
            clin.append(
                f"being evaluated in the {facts['study']} {facts['phase']} trial"
            )
        elif facts.get("study"):
            clin.append(f"in the {facts['study']} trial")
        elif facts.get("phase"):
            clin.append(f"in {facts['phase']}")
        if facts.get("readout_date"):
            clin.append(f"topline data anticipated in {facts['readout_date']}")
        if clin:
            bits.append("Program is " + "; ".join(clin) + ".")
    if facts.get("economics"):
        bits.append(facts["economics"].rstrip(".") + ".")
    elif facts.get("is_close"):
        bits.append(
            "Upfront / milestone economics are not restated in this closing release "
            "(see the original acquisition announcement for deal terms)."
        )
    detail = " ".join(bits).strip()

    key_results: list[dict[str, str]] = []

    def _kr(label: str, detail: str | None) -> None:
        d = (detail or "").strip()
        if len(d) < 12:
            return
        key_results.append({"label": label, "detail": d[:400]})

    _kr(
        "Deal structure",
        (
            f"{'Completed acquisition' if facts.get('is_close') else 'Acquisition agreement'} "
            f"of {target} by {buyer}"
            + (f"; {facts['rights']}" if facts.get("rights") else "")
        ),
    )
    if facts.get("economics"):
        _kr("Economics (upfront/milestones)", facts["economics"])
    else:
        _kr(
            "Economics (upfront/milestones)",
            "Not disclosed in this article — check the definitive agreement / announcement PR.",
        )
    timing = []
    if facts.get("announce_date"):
        timing.append(f"announced {facts['announce_date']}")
    if facts.get("close_date"):
        timing.append(f"closed {facts['close_date']}")
    _kr("Timing & close", "; ".join(timing) if timing else None)
    _kr(
        "Product & stage",
        ", ".join(
            x
            for x in (
                product_label or None,
                facts.get("route"),
                facts.get("phase"),
                facts.get("moa"),
            )
            if x
        ),
    )
    _kr(
        "Indication / unmet need",
        " — ".join(
            x
            for x in (facts.get("indication"), facts.get("unmet_need"))
            if x
        ),
    )
    if facts.get("fda_designations"):
        _kr("FDA designations", ", ".join(facts["fda_designations"]))
    clin_d = []
    if facts.get("study"):
        clin_d.append(facts["study"])
    if facts.get("phase"):
        clin_d.append(facts["phase"])
    if facts.get("readout_date"):
        clin_d.append(f"topline {facts['readout_date']}")
    _kr("Clinical status", " · ".join(clin_d) if clin_d else None)
    impact = None
    if facts.get("is_close") or product_label:
        ind = facts.get("indication")
        impact = (
            f"Adds a complementary clinical-stage asset"
            + (f" in {ind}" if ind else "")
            + (
                f"; near-term focus is advancing {facts['study']} toward topline"
                if facts.get("study")
                else "; near-term focus is advancing the acquired program"
            )
            + "."
        )
    _kr("Expected impact", impact)

    dates: list[dict[str, str]] = []
    if facts.get("announce_date"):
        dates.append(
            {
                "date": str(facts["announce_date"])[:48],
                "what_happens": f"Acquisition agreement announced ({target})",
            }
        )
    if facts.get("close_date"):
        dates.append(
            {
                "date": str(facts["close_date"])[:48],
                "what_happens": f"Acquisition closed — {target}",
            }
        )
    if facts.get("readout_date"):
        dates.append(
            {
                "date": str(facts["readout_date"])[:48],
                "what_happens": (
                    f"{facts.get('study') or product_label or 'Program'} "
                    f"{facts.get('phase') or ''} topline data readout"
                ).strip(),
            }
        )
    dates = _filter_event_only_dates(dates)

    results_bits = [
        product_label,
        facts.get("indication"),
        facts.get("phase"),
        f"{facts['study']} topline {facts['readout_date']}"
        if facts.get("study") and facts.get("readout_date")
        else None,
    ]
    results = " · ".join(x for x in results_bits if x) or None

    return {
        "detail_summary": detail[:2200],
        "news_kind": "ma",
        "indication": facts.get("indication"),
        "dates": dates,
        "results": results,
        "key_results": key_results[:8],
        "product": (product_label or None),
        "study": facts.get("study"),
        "phase": facts.get("phase"),
        "key_points": [
            f"{kr['label']}: {kr['detail']}"[:220] for kr in key_results[:6]
        ],
        "source_url": url,
        "ticker": ticker or None,
        "digest_method": "extractive_ma",
    }


def _enrich_ma_announcement_body(
    *,
    title: str,
    ticker: str,
    body: str,
) -> str:
    """
    Closing PRs often omit upfront/milestones. Pull the prior announcement
    page when the current article is a close/completion notice.
    """
    if not re.search(
        r"(?i)\b(complet(?:es|ed)|clos(?:es|ed)|has\s+closed)\b",
        f"{title}\n{body[:800]}",
    ):
        return ""
    target = None
    m = re.search(
        r"(?i)acquisition of\s+([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})",
        f"{title}\n{body[:1200]}",
    )
    if m:
        target = m.group(1).strip()
    queries = []
    if ticker and target:
        queries.append(f"{ticker} {target} acquisition agreement announced")
        queries.append(f"{ticker} acquires {target} definitive agreement")
        queries.append(f"{ticker} {target} upfront milestones")
    elif ticker:
        queries.append(f"{ticker} acquisition announced upfront milestones")
    # Prefer announce PR with $ economics; skip another close notice
    for q in queries[:3]:
        try:
            text, _err = _fetch_article_via_title_search(q)
        except Exception:
            continue
        text = _strip_article_chrome(text or "")
        if len(text) < 400:
            continue
        if re.search(
            r"(?i)\b(complet(?:es|ed)|has\s+closed)\b.{0,40}\bacquisition\b",
            text[:600],
        ) and not re.search(r"(?i)\$\s?\d", text):
            continue
        if not re.search(
            r"(?i)\b(upfront|milestone|consideration|definitive\s+agreement)\b",
            text,
        ):
            continue
        if re.search(r"(?i)\$\s?\d|\bmillion\b|\bbillion\b", text) or re.search(
            r"(?i)\b(enter(?:ed|s)? into|announc(?:ed|es)|definitive)\b", text
        ):
            return text[:12_000]
    return ""


def _build_shareholder_alert_brief(
    *,
    title: str,
    body: str = "",
    url: str = "",
    ticker: str = "",
) -> dict[str, Any]:
    """
    Law-firm 'SHAREHOLDER ALERT' / class-action solicitation.
    Always produce a readable summary from the headline, even when the page fetch fails.
    """
    title_c = _clean_fetched_text(title)
    ticker_s = (ticker or "").strip().upper()
    firm = _shareholder_alert_firm(title_c, body)
    firm_bit = f"Law firm {firm}" if firm else "A plaintiffs’ law firm"
    tk_bit = f" ({ticker_s})" if ticker_s else ""
    detail = (
        f"{firm_bit} issued a shareholder / securities alert on {ticker_s or 'this stock'}{tk_bit}. "
        "These notices typically invite investors who bought the shares to contact the firm "
        "about a possible class action or investigation. This is a law-firm press release, "
        "not a company announcement about products, clinical trials, or earnings."
    )
    extra = ""
    body_c = _strip_article_chrome(_clean_fetched_text(body or ""))
    if body_c and len(body_c) > len(title_c) + 80 and not _body_is_title_echo(title_c, body_c):
        sents = [
            s.strip()
            for s in re.split(r"(?<=[.!?])\s+", body_c)
            if len(s.strip()) > 50
            and re.search(
                r"(?i)\b(class action|shareholder|investors? who purchased|"
                r"securities|investigation|lawsuit|complaint)\b",
                s,
            )
        ]
        if sents:
            extra = " ".join(sents[:2])[:700]
            if extra and extra.lower() not in detail.lower():
                detail = f"{detail} {extra}"
    keys = [
        "Type: shareholder / securities alert (law-firm solicitation)",
    ]
    if firm:
        keys.append(f"Firm: {firm}")
    if ticker_s:
        keys.append(f"Ticker: {ticker_s}")
    keys.append("Not a clinical, FDA, or earnings event")
    takeaway = (
        f"Legal notice{tk_bit}: {firm or 'plaintiffs’ firm'} is soliciting shareholders. "
        "Not a product or earnings catalyst."
    )
    answers = [
        {
            "id": "news_event_type",
            "question": "What type of news is this?",
            "answer": "shareholder alert",
            "present": True,
        },
        {
            "id": "investor_takeaway",
            "question": "Investor takeaway",
            "answer": takeaway,
            "present": True,
        },
    ]
    return {
            "detail_summary": detail[:2200],
            "summary_long": detail[:2200],
            "news_kind": "litigation",
            "indication": None,
            "dates": [],
            "results": None,
            "key_results": [
                {"label": "Event", "detail": keys[0].replace("Type: ", "")},
                *([{"label": "Law firm", "detail": firm}] if firm else []),
                {"label": "Takeaway", "detail": takeaway},
            ],
            "product": None,
            "study": None,
            "phase": None,
            "key_points": keys,
            "source_url": url,
            "ticker": ticker_s or None,
            "digest_method": "shareholder_alert",
            "digest_answers": answers,
            "has_summary": True,
            "has_bullet_summary": True,
            "headline": title_c,
        }


def _heuristic_news_brief(
    *,
    title: str,
    summary: str,
    url: str,
    ticker: str,
    article_text: str = "",
    enrich_text: str = "",
) -> dict[str, Any]:
    title_c = _clean_fetched_text(title)
    summary_c = _strip_heuristic_noise(_clean_fetched_text(summary))
    body = _strip_article_chrome(
        _strip_heuristic_noise(_clean_fetched_text(article_text) if article_text else "")
    )
    # Fact source: richest text only — never glue truncated title onto body
    fact_src = body if len(body) >= len(summary_c) else summary_c
    if len(fact_src) < 40:
        fact_src = title_c
    kind = _detect_news_kind(f"{title_c}\n{fact_src}", title=title_c)
    if kind == "litigation" or _is_shareholder_alert(title_c, fact_src):
        return _build_shareholder_alert_brief(
            title=title_c,
            body=body or fact_src,
            url=url,
            ticker=ticker,
        )
    if kind == "ma" and not _is_speculative_ma_article(
        title=title_c, body=body or fact_src
    ):
        return _build_structured_ma_brief(
            title=title_c,
            body=body or fact_src,
            url=url,
            ticker=ticker,
            enrich_text=enrich_text,
        )
    if _is_speculative_ma_article(title=title_c, body=body or fact_src):
        qa = _run_digest_questionnaire(
            title=title_c,
            body=body or fact_src,
            url=url,
            ticker=ticker,
        )
        return _brief_from_digest_qa(qa, ticker=ticker, url=url)
    facts = _extract_clinical_facts(fact_src)
    title_facts = _extract_clinical_facts(title_c) if title_c else {}
    for k in ("product", "study", "phase", "results"):
        if not facts.get(k) and title_facts.get(k):
            facts[k] = title_facts[k]
    # Title study codes win over later body mentions (e.g. ARCHER vs MAVERIC)
    title_codes = _study_codes_from_text(title_c)
    if title_codes:
        roots = _study_roots(title_codes)
        body_l = (body or fact_src or "").lower()
        pick = None
        for r in roots:
            if r.lower() in body_l or r.lower() in title_c.lower():
                # Prefer full title code if present in body, else root
                pick = next(
                    (c for c in title_codes if c.upper() == r.upper() or c.split("-")[0].upper() == r.upper()),
                    r,
                )
                if r.lower() in body_l:
                    # Prefer bare root when body uses ARCHER not ARCHER-CMF
                    if re.search(rf"\b{re.escape(r)}\b", body or fact_src or "", re.I):
                        pick = r
                break
        if pick:
            facts["study"] = pick
    elif facts.get("study"):
        # Prefer the study named in the first ~900 chars of the article body
        head = (body or fact_src or "")[:900]
        head_codes = _study_codes_from_text(head)
        bare = re.findall(
            r"\b(?:from|in)\s+([A-Z]{4,})\b(?=,?\s+the Company|\s+trial\b)",
            head,
        )
        preferred = head_codes + bare
        if preferred:
            facts["study"] = preferred[0]
    fin = _extract_financing_facts(fact_src)
    if not fin.get("summary"):
        fin = _extract_financing_facts(f"{title_c} {summary_c} {body}")
    is_financing = bool(
        fin.get("kind")
        or re.search(
            r"\b(shelf|financing|offering|ATM|prospectus|dilut)\b",
            f"{title_c} {summary_c}",
            re.I,
        )
    )
    # Financing pages often embed old clinical boilerplate — don't pollute the brief
    if is_financing:
        facts = {"product": None, "study": None, "phase": None, "results": None}
    dates = _filter_event_only_dates(
        _extract_dates_from_article_text(body or summary_c or title_c, title=title_c)
    )
    year_now = _rome_now().year
    filtered_dates = []
    for d in dates:
        ys = re.findall(r"20\d{2}", d.get("date") or "")
        if ys and int(ys[-1]) < year_now - 1:
            continue
        filtered_dates.append(d)
    dates = filtered_dates[:3]
    results = ""
    if is_financing and fin.get("summary"):
        results = fin["summary"]
    else:
        results = facts.get("results") or ""
        if results and re.search(r"\b(for|the|a|an|of|and|with)\s*$", results, re.I):
            results = ""
        if not results and fin.get("summary"):
            results = fin["summary"]
    blob = f"{title_c} {summary_c} {body}".strip()
    if not results and not is_financing and (
        facts.get("phase") or facts.get("study") or re.search(r"\btopline\b", blob, re.I)
    ):
        polarity = ""
        if re.search(r"\bpositive\b", blob, re.I):
            polarity = "Positive"
        elif re.search(r"\bnegative\b", blob, re.I):
            polarity = "Negative"
        bits_r = [
            polarity,
            facts.get("phase") or "",
            f"{facts['study']} topline" if facts.get("study") else "topline results",
            f"for {facts['product']}" if facts.get("product") else "",
        ]
        built = " ".join(b for b in bits_r if b).strip()
        if built:
            results = built

    detail = ""
    rich = body if len(body) >= max(len(summary_c), 80) else summary_c
    if rich and len(rich) > len(title_c) + 40:
        sents = [
            s.strip()
            for s in re.split(r"(?<=[.!?])\s+", rich)
            if s.strip()
            and not re.match(r"(?i)^\s*(Product|Study|Phase|Results)\s*:", s)
            and not re.match(r"(?i)^(STOCK TITAN|Login|Sign up|Home News|Tags)\b", s)
            and len(s.strip()) > 40
        ]
        scored = []
        for s in sents:
            sc = 0
            if re.search(
                r"\b(filed|files|shelf|offering|million|prospectus|phase|topline|"
                r"endpoint|fda|conference|fireside|announced)\b",
                s,
                re.I,
            ):
                sc += 2
            if re.search(
                r"\b(p\s*[<=]\s*0?\.\d+|primary endpoint|n\s*=\s*\d+|ecv|gls|"
                r"extracellular|myocarditis|cardiolrx)\b",
                s,
                re.I,
            ):
                sc += 4
            if re.search(
                r"\b(forward[- ]looking|risks and uncertainties|annual information form|"
                r"no fda-approved|cautionary)\b",
                s,
                re.I,
            ):
                sc -= 6
            if re.search(r"\$|US\$|\d+\s*-?\s*month", s, re.I):
                sc += 2
            if is_financing and re.search(
                r"\b(filed a|files a|may issue|shelf prospectus|registration statement|sets up)\b",
                s,
                re.I,
            ):
                sc += 3
            if re.search(r"(?i)^.{0,20}files?\s+us\$", s):
                sc += 1  # prefer the filing lede over the bare headline clone
            if is_financing and re.search(
                r"\b(phase\s*[i1-3]|topline|ARCHER|endpoint|NCT\d+)\b", s, re.I
            ):
                sc -= 4
            letters = re.sub(r"[^A-Za-z]", "", s)
            if letters and letters.upper() == letters and len(s) > 50:
                sc -= 4
            # Penalize long Title-Case headline without verbs like filed/sets
            if len(s) > 90 and not re.search(
                r"\b(filed|files|sets up|may issue|announced)\b", s, re.I
            ):
                sc -= 2
            if title_c and s.lower()[:50] == title_c.lower()[:50]:
                sc -= 3
            scored.append((sc, s))
        scored.sort(key=lambda x: x[0], reverse=True)
        picked = []
        seen_pfx: set[str] = set()
        for sc, s in scored:
            if sc <= 0:
                continue
            pfx = s.lower()[:70]
            if pfx in seen_pfx:
                continue
            if any(pfx[:40] in prev or prev[:40] in pfx for prev in seen_pfx):
                continue
            seen_pfx.add(pfx)
            picked.append(s)
            if len(picked) >= 3:
                break
        if not picked:
            picked = sents[:2]
        # Prefer substantive ledes over the bare repeated headline
        if (
            len(picked) >= 2
            and len(picked[0]) > 100
            and not re.search(r"\b(filed a|sets up|may issue)\b", picked[0], re.I)
            and re.search(r"\b(filed a|sets up|may issue)\b", picked[1], re.I)
        ):
            picked = picked[1:]
        detail = " ".join(picked)[:1200]
    if not detail and fin.get("summary"):
        company = ""
        m = re.search(
            r"\b([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})\s*\([A-Z]{1,5}\)",
            title_c,
        )
        if m:
            company = m.group(1)
        detail = (f"{company + ' — ' if company else ''}{fin['summary']}.").strip()
    # Google-style lede when we have clinical identity fields
    if not is_financing and (
        facts.get("study") or facts.get("product") or facts.get("phase")
    ):
        company = ""
        m = re.search(
            r"\b([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})\b"
            r"(?:\s*\((?:NASDAQ|NYSE|TSX)[^)]*\))?",
            body or title_c,
        )
        if m and (
            "therapeutics" in m.group(0).lower()
            or "pharma" in m.group(0).lower()
            or len(m.group(1).split()) >= 2
        ):
            company = m.group(1)
        if not company:
            m2 = re.match(
                r"^([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})",
                title_c,
            )
            if m2:
                company = m2.group(1)
        indication = _extract_indication(body or fact_src or title_c)
        polarity = "positive" if re.search(r"\bpositive\b", blob, re.I) else (
            "negative" if re.search(r"\bnegative\b", blob, re.I) else "topline"
        )
        bits_lede = []
        if company:
            bits_lede.append(company)
        verb = "announced"
        bits_lede.append(
            f"{verb} {polarity} topline results"
            if polarity in {"positive", "negative"}
            else f"{verb} topline results"
        )
        if facts.get("phase") and facts.get("study"):
            bits_lede.append(f"from its {facts['phase']} {facts['study']} trial")
        elif facts.get("study"):
            bits_lede.append(f"from its {facts['study']} trial")
        elif facts.get("phase"):
            bits_lede.append(f"from its {facts['phase']} trial")
        if facts.get("product"):
            bits_lede.append(f"evaluating {facts['product']}")
        if indication:
            bits_lede.append(f"for {indication}")
        google_lede = " ".join(bits_lede).strip()
        if google_lede and (
            not detail
            or detail.lower().startswith("(nasdaq")
            or len(detail) > 280
            or title_c.lower()[:40] in detail.lower()[:80]
        ):
            detail = google_lede[:480]
            if not detail.endswith("."):
                detail += "."
    if not detail:
        bits = [
            (
                f"{facts['product']} ({facts['phase']})"
                if facts.get("product") and facts.get("phase")
                else (facts.get("product") or "")
            ),
            f"{facts['study']} study" if facts.get("study") else "",
            results or "",
        ]
        detail = ". ".join(b for b in bits if b).strip() or title_c
    if detail and re.search(r"\b(for|the|a|an|of|and|with)\s*$", detail, re.I):
        detail = results or fin.get("summary") or detail
    detail = _clean_fetched_text(detail)
    if detail and title_c and detail.lower().rstrip(".") == title_c.lower().rstrip("."):
        if fin.get("summary"):
            detail = fin["summary"]
        elif results and results.lower() != detail.lower():
            detail = results

    keys: list[str] = []
    if fin.get("amount"):
        keys.append(f"Size: {fin['amount']}")
    if fin.get("kind"):
        keys.append(f"Type: {fin['kind']}")
    if fin.get("duration"):
        keys.append(f"Window: {fin['duration']}")
    if fin.get("no_offer_now"):
        keys.append("No offering priced with this filing")
    if facts.get("product"):
        keys.append(f"Product: {facts['product']}")
    if facts.get("study"):
        keys.append(f"Study: {facts['study']}")
    if facts.get("phase"):
        keys.append(f"Phase: {facts['phase']}")
    if results and results.lower() not in {k.lower() for k in keys}:
        if title_c.lower()[:40] not in results.lower()[:80] or fin.get("summary"):
            if results != fin.get("summary"):
                keys.append(results[:220])
    if dates:
        keys.append(f"Date: {dates[0]['date']} — {dates[0]['what_happens']}"[:200])
    title_l = title_c.lower()
    uniq: list[str] = []
    seen_k: set[str] = set()
    for k in keys:
        kl = k.strip().lower()
        if not kl or kl in seen_k:
            continue
        labeled = kl.startswith(
            ("size:", "type:", "window:", "product:", "study:", "phase:", "date:")
        )
        if not labeled and (
            kl == title_l
            or title_l.startswith(kl[: max(20, len(kl))])
            or kl in title_l
        ):
            continue
        seen_k.add(kl)
        uniq.append(k.strip())
    keys = uniq[:5]
    if not keys and fin.get("summary"):
        keys = [fin["summary"][:200]]
    if not keys and title_c:
        keys = [title_c[:160]]
    key_results: list[dict[str, str]] = []
    indication = None
    if not is_financing:
        key_results = _extract_key_results_from_text(body or fact_src)
        indication = _extract_indication(body or fact_src or title_c)
        if key_results and (
            not keys
            or all(
                k.lower().startswith(("product:", "study:", "phase:")) for k in keys
            )
        ):
            keys = [f"{kr['label']}: {kr['detail']}"[:220] for kr in key_results][:5]
    # Financing: only compact Size/Type/Window chips — never prose that echoes the lede.
    if is_financing:
        key_results = [
            {
                "label": k.split(":", 1)[0].strip(),
                "detail": k.split(":", 1)[-1].strip()[:400],
            }
            for k in keys[:6]
            if ":" in k and _BRIEF_CHIP_LABEL_RE.match(k.split(":", 1)[0].strip())
        ]
        keys = [
            k
            for k in keys
            if ":" in k and _BRIEF_CHIP_LABEL_RE.match(k.split(":", 1)[0].strip())
            or k.lower().startswith("no offering")
        ]
    return _dedupe_brief_sections(
        {
            "detail_summary": detail[:1800] or title_c,
            "news_kind": _detect_news_kind(blob, title=title_c),
            "indication": indication,
            "dates": dates,
            # Financing: facts live in chips when unique — never repeat the lede in results.
            "results": None if is_financing else (results or None),
            "key_results": key_results,
            "product": facts.get("product"),
            "study": facts.get("study"),
            "phase": facts.get("phase"),
            "key_points": keys[:5],
            "source_url": url,
            "ticker": ticker or None,
            "digest_method": "extractive",
        }
    )



_BRIEF_CHIP_LABEL_RE = re.compile(
    r"(?i)^(size|type|window|no offering|product|study|phase|date|hard number)\b"
)


def _brief_text_overlap(a: str, b: str) -> float:
    """Token overlap in [0,1] — high means a and b say essentially the same thing."""
    ta = set(re.findall(r"[a-z0-9$%]+", (a or "").lower()))
    tb = set(re.findall(r"[a-z0-9$%]+", (b or "").lower()))
    stop = {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
        "by", "as", "at", "is", "are", "was", "were", "be", "been", "that",
        "this", "from", "its", "it", "has", "have", "had", "will", "may",
    }
    ta -= stop
    tb -= stop
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / float(max(min(len(ta), len(tb)), 1))


def _brief_text_contained(needle: str, hay: str, *, min_chars: int = 48) -> bool:
    n = re.sub(r"\s+", " ", (needle or "").lower()).strip()
    h = re.sub(r"\s+", " ", (hay or "").lower()).strip()
    if len(n) < min_chars or not h:
        return False
    head = n[: max(min_chars, min(90, len(n)))]
    return head in h or n in h


def _chip_covered_by_anchor(detail: str, anchors: list[str]) -> bool:
    """True when a Size/Type/Window chip only restates facts already in the lede."""
    det = re.sub(r"\s+", " ", (detail or "").strip().lower())
    if not det or not anchors:
        return False
    # Strip common unit fluff so "us$150 million" matches lede wording variants
    compact = re.sub(r"[^\w$%]+", "", det)
    for a in anchors:
        al = a.lower()
        if det in al:
            return True
        if len(det) >= 6 and det[: max(6, min(24, len(det)))] in al:
            return True
        a_compact = re.sub(r"[^\w$%]+", "", al)
        if len(compact) >= 6 and compact in a_compact:
            return True
        if _brief_text_overlap(det, a) >= 0.55:
            return True
    return False


def _is_brief_fact_chip(label: str, detail: str) -> bool:
    """Compact structured chip (Size: $150M)."""
    lab = (label or "").strip()
    det = (detail or "").strip()
    if not det or len(det) > 120:
        return False
    if lab and _BRIEF_CHIP_LABEL_RE.match(lab):
        return True
    if ":" in det and _BRIEF_CHIP_LABEL_RE.match(det):
        return True
    return False


def _dedupe_brief_sections(brief: dict[str, Any] | None) -> dict[str, Any]:
    """
    One fact → one place. Drop Key points / Data-results that only echo detail_summary.
    Empty sections stay empty (UI omits them).
    """
    if not isinstance(brief, dict):
        return {}
    out = dict(brief)
    if out.get("digest_answers"):
        out["digest_answers"] = _normalize_digest_news_event_type(out.get("digest_answers"))
    detail = str(out.get("detail_summary") or "").strip()
    takeaway = ""
    for a in out.get("digest_answers") or []:
        if isinstance(a, dict) and a.get("id") == "investor_takeaway":
            takeaway = str(a.get("answer") or "").strip()
            break
    anchors = [x for x in (detail, takeaway) if len(x) >= 40]

    def _echoes_anchor(text: str) -> bool:
        t = (text or "").strip()
        if len(t) < 20:
            return False
        tl = t.lower()
        for a in anchors:
            al = a.lower()
            # Any substring already inside the lede (including short chips/fragments)
            if tl in al:
                return True
            if _brief_text_contained(t, a, min_chars=28) or _brief_text_overlap(t, a) >= 0.68:
                return True
        return False

    kept_kr: list[dict[str, Any]] = []
    for kr in out.get("key_results") or []:
        if not isinstance(kr, dict):
            continue
        label = str(kr.get("label") or "").strip()
        det = str(kr.get("detail") or "").strip()
        if not det:
            continue
        if _is_brief_fact_chip(label, det):
            # Drop chips that only restate the lede — no unique fact → no section row
            if _chip_covered_by_anchor(det, anchors):
                continue
            if any(
                _brief_text_overlap(det, str(x.get("detail") or "")) >= 0.9
                for x in kept_kr
            ):
                continue
            kept_kr.append({"label": label or "Fact", "detail": det[:400]})
            continue
        # Drop prose Key points that only restate the finance / study lede
        if _echoes_anchor(det) or (
            label.lower().startswith("key point") and _echoes_anchor(det)
        ):
            continue
        if any(
            _brief_text_overlap(det, str(x.get("detail") or "")) >= 0.85
            for x in kept_kr
        ):
            continue
        kept_kr.append({"label": label or None, "detail": det[:400]})
    out["key_results"] = kept_kr

    kept_pts: list[str] = []
    for p in out.get("key_points") or []:
        s = str(p or "").strip()
        if not s:
            continue
        chip_like = _is_brief_fact_chip("", s) or (
            ":" in s and len(s) < 120 and _BRIEF_CHIP_LABEL_RE.match(s.split(":", 1)[0].strip())
        )
        if chip_like:
            chip_det = s.split(":", 1)[-1].strip() if ":" in s else s
            if _chip_covered_by_anchor(chip_det, anchors):
                continue
            if s.lower() not in {x.lower() for x in kept_pts}:
                kept_pts.append(s[:220])
            continue
        if _echoes_anchor(s):
            continue
        if any(_brief_text_overlap(s, x) >= 0.85 for x in kept_pts):
            continue
        kept_pts.append(s[:220])
    out["key_points"] = kept_pts

    res = str(out.get("results") or "").strip()
    if res and (
        _echoes_anchor(res)
        or any(
            _brief_text_overlap(res, str(kr.get("detail") or "")) >= 0.7
            for kr in kept_kr
        )
        or any(_brief_text_overlap(res, p) >= 0.7 for p in kept_pts)
    ):
        out["results"] = None

    return out


def _is_litigation_news(title: str, body: str = "") -> bool:
    if _is_shareholder_alert(title, body):
        return True
    blob = f"{title or ''}\n{body or ''}"
    return bool(
        re.search(
            r"(?i)\b("
            r"lawsuit|lawsuits|litigation|legal\s+overhang|"
            r"patent\s+infringement|infringement\s+suit|"
            r"class\s+action|complaint\s+filed|sued\s+(?:over|for)"
            r")\b",
            blob,
        )
    )


def _is_partnership_or_deal_article(*, title: str = "", body: str = "") -> bool:
    """True for partnership / collaboration / licensing / M&A deal coverage."""
    if _is_speculative_ma_article(title=title, body=body):
        return False
    blob = f"{title}\n{(body or '')[:4000]}"
    return bool(
        re.search(
            r"(?i)\b("
            r"acquir(?:e|es|ed|ing)|acquisition|merger|m&a|buyout|takeover|"
            r"definitive\s+(?:merger\s+)?agreement|to\s+be\s+acquired|"
            r"partnership|collaboration|co[- ]develop|co[- ]promote|"
            r"strategic\s+(?:alliance|partnership)|joint\s+venture|"
            r"licen[sc](?:e|ing)\s+agreement|exclusive\s+licen[sc]e|"
            r"upfront(?:\s+payment)?|milestone\s+payments?|earn[- ]?out"
            r")\b",
            blob,
        )
    )


def _extract_deal_financial_terms(
    *,
    title: str = "",
    body: str = "",
) -> dict[str, str] | None:
    """
    Financial-component explanation for partnership / M&A / licensing:
    how much was paid, for what, objectives, milestones.
    Never invent dollar amounts — say when undisclosed.
    """
    title_s = _clean_fetched_text(title or "")
    body_s = body or ""
    if not _is_partnership_or_deal_article(title=title_s, body=body_s):
        return None
    blob = f"{title_s}\n{body_s[:12000]}"
    blob_c = _clean_fetched_text(blob)

    deal_type = "deal"
    if re.search(r"(?i)\b(acquir|acquisition|merger|buyout|takeover|m&a)\b", blob):
        deal_type = "M&A"
    elif re.search(r"(?i)\b(licen[sc]e|licensing)\b", blob):
        deal_type = "licensing"
    elif re.search(r"(?i)\b(partnership|collaboration|alliance|joint\s+venture)\b", blob):
        deal_type = "partnership"

    paid_bits: list[str] = []
    for m in re.finditer(
        r"([^.\n]{0,60}\$\s?[\d,]+(?:\.\d+)?\s*(?:billion|million|bn|mn|m|b)?[^.\n]{0,100}"
        r"(?:upfront|milestone|consideration|purchase\s+price|cash|equity|"
        r"total\s+(?:deal|transaction)\s+value|earn[- ]?out|royalt)[^.\n]{0,80})",
        blob_c,
        re.I,
    ):
        bit = _clean_fetched_text(m.group(1))
        if bit and not _is_stock_tape_number_context(bit) and bit not in paid_bits:
            paid_bits.append(bit[:220])
        if len(paid_bits) >= 4:
            break
    if not paid_bits:
        # Broader money+deal role from hard-number helper.
        for n in _extract_hard_numbers(blob)[:8]:
            if re.search(
                r"(?i)\b(upfront|milestone|royalt|acquisition|consideration|"
                r"purchase|partnership|license|deal)\b",
                n,
            ):
                paid_bits.append(n[:220])
            if len(paid_bits) >= 3:
                break
    paid = (
        "; ".join(paid_bits)
        if paid_bits
        else "Cash / equity consideration not disclosed in available text."
    )

    for_what = ""
    for pat in (
        r"(?i)((?:to\s+integrate|integrat(?:e|ing|ion)\s+of)\s+[^.\n]{10,160})",
        r"(?i)((?:for\s+the\s+(?:exclusive\s+)?(?:rights?|license|acquisition)\s+of)\s+[^.\n]{8,160})",
        r"(?i)((?:to\s+(?:acquire|license|develop|co[- ]develop|commercialize))\s+[^.\n]{8,160})",
        r"(?i)((?:combining|combine[sd]?)\s+[^.\n]{10,160})",
        r"(?i)((?:collaboration|partnership)\s+(?:to|for)\s+[^.\n]{10,160})",
    ):
        m = re.search(pat, blob_c)
        if m:
            for_what = _clean_fetched_text(m.group(1))[:280]
            break
    if not for_what:
        # Fallback: headline after company / announces.
        h = re.sub(
            r"(?i)^.{0,40}?\b(?:announces?|enters?|signs?|partners?(?:\s+with)?)\s+",
            "",
            title_s,
        ).strip(" -–|")
        for_what = (h or title_s)[:280]

    objectives: list[str] = []
    for pat in (
        r"(?i)(?:aimed\s+at|intended\s+to|objective[s]?\s*(?:is|are|:)|"
        r"goal\s*(?:is|are|:)|designed\s+to|in\s+order\s+to|"
        r"to\s+(?:expand|capture|strengthen|accelerate|enable|support))\s+"
        r"([^.\n]{12,180})",
        r"(?i)(?:value\s+proposition|competitive\s+moat|market\s+share)[^.\n]{0,120}",
    ):
        for m in re.finditer(pat, blob_c):
            bit = _clean_fetched_text(m.group(0))[:220]
            if bit and bit not in objectives:
                objectives.append(bit)
            if len(objectives) >= 3:
                break
        if len(objectives) >= 3:
            break
    objectives_s = "; ".join(objectives) if objectives else (
        "Strategic / commercial objective not spelled out beyond the deal headline."
    )

    milestones: list[str] = []
    for pat in (
        r"(?i)(?:milestone(?:s)?(?:\s+payment(?:s)?)?[^.\n]{0,140})",
        r"(?i)(?:commerciali[sz]ation\s+(?:timeline|target|expected)[^.\n]{0,100})",
        r"(?i)(?:expected\s+(?:to\s+)?(?:close|launch|initiate|complete)[^.\n]{0,100})",
        r"(?i)(?:Q[1-4]\s*20\d{2}|20\d{2})[^.\n]{0,80}"
        r"(?:commercial|launch|close|milestone|readout|approval)[^.\n]{0,60}",
        r"(?i)(?:upon\s+(?:FDA|EMA|approval|first\s+sale|closing)[^.\n]{0,100})",
    ):
        for m in re.finditer(pat, blob_c):
            bit = _clean_fetched_text(m.group(0))[:220]
            if bit and len(bit) >= 12 and bit not in milestones:
                if _is_stock_tape_number_context(bit):
                    continue
                milestones.append(bit)
            if len(milestones) >= 4:
                break
        if len(milestones) >= 4:
            break
    milestones_s = (
        "; ".join(milestones)
        if milestones
        else "No explicit payment milestones or timeline disclosed in available text."
    )

    summary = (
        f"{deal_type.capitalize()}: paid — {paid}. "
        f"For — {for_what}. "
        f"Objectives — {objectives_s}. "
        f"Milestones / timing — {milestones_s}."
    )
    return {
        "deal_type": deal_type,
        "paid": paid[:500],
        "for_what": for_what[:400],
        "objectives": objectives_s[:500],
        "milestones": milestones_s[:500],
        "summary": summary[:1200],
    }


def _seed_financial_deal_evidence(
    dims: dict[str, Any] | None,
    deal_terms: dict[str, str] | None,
) -> dict[str, Any] | None:
    """Attach deal economics evidence onto the Fin taxonomy axis (compact view tip)."""
    if not isinstance(dims, dict) or not isinstance(deal_terms, dict):
        return dims
    out = dict(dims)
    fin = dict(out.get("financial") or {}) if isinstance(out.get("financial"), dict) else {}
    evid = str(deal_terms.get("summary") or "").strip()[:180]
    if not evid:
        return out
    # Keep an existing non-trivial Fin score; otherwise seed a mild strategic-deal read.
    try:
        score = float(fin.get("score")) if fin.get("score") is not None else None
    except (TypeError, ValueError):
        score = None
    if score is None or abs(score) < 0.01 or fin.get("unclassified"):
        # Undisclosed cash → still a financial/commercial event at low magnitude.
        undisclosed = bool(
            re.search(r"(?i)not disclosed", str(deal_terms.get("paid") or ""))
        )
        score = 0.25 if undisclosed else 0.55
    fin.update(
        {
            "score": round(float(score), 2),
            "base_weight": round(float(score), 2),
            "event_id": fin.get("event_id") or "financial_deal_partnership_economics",
            "event_type": fin.get("event_type")
            or f"Deal economics ({deal_terms.get('deal_type') or 'deal'})",
            "evidence": evid,
            "unclassified": False,
            "classification_method": fin.get("classification_method") or "deal_terms",
        }
    )
    out["financial"] = fin
    return out


def _detect_news_kind(text: str, *, title: str = "") -> str:
    """Classify article for brief templates: ma | clinical | financial | litigation | other."""
    blob = f"{title}\n{text}"
    if _is_litigation_news(title, text):
        return "litigation"
    # Price-action / market-wrap press is financial framing even when the body
    # cites a prior clinical catalyst as the *reason* for the move.
    try:
        from eis_taxonomy_scoring import (
            _clinical_readout_is_headline,
            _is_stock_tape_market_wrap,
        )

        if _is_stock_tape_market_wrap(blob) and not _clinical_readout_is_headline(blob):
            return "financial"
    except Exception:
        pass
    # Speculative buyout / "next deal" pieces are NOT closed M&A announcements
    if _is_speculative_ma_article(title=title, body=text):
        if re.search(
            r"\b(phase\s*[i1-3]|topline|endpoint|clinical\s+trial|fda\s+fil|"
            r"patent\s+cliff|pdufa)\b",
            blob,
            re.I,
        ):
            return "clinical"
        return "other"
    if re.search(
        r"\b("
        r"acquir(?:e|es|ed|ing)|acquisition|merger|m&a|buyout|takeover|"
        r"definitive\s+agreement|to\s+be\s+acquired|all[- ]cash|"
        r"upfront|milestone\s+payment|earn[- ]?out|licensing\s+deal|"
        r"exclusive\s+license|collaboration\s+and\s+license|"
        r"partnership|collaboration|strategic\s+alliance|joint\s+venture|"
        r"co[- ]develop(?:ment)?|licen[sc]e\s+agreement"
        r")\b",
        blob,
        re.I,
    ) and not _is_speculative_ma_article(title=title, body=text):
        return "ma"
    if re.search(
        r"\b("
        r"shelf|ATM|at-the-market|prospectus|follow-on|public\s+offering|"
        r"registered\s+direct|private\s+placement|convertible|"
        r"cash\s+(?:runway|position)|dilut|financing|raise[sd]?\s+\$|"
        r"board\s+(?:change|appointment)|ceo\s+(?:appoint|resign)|"
        r"restructuring|spin[- ]?off|divestiture"
        r")\b",
        blob,
        re.I,
    ) and not re.search(
        r"\b(phase\s*[i1-3]|topline|endpoint|nct\d+|clinical\s+trial)\b",
        blob,
        re.I,
    ):
        return "financial"
    if re.search(
        r"\b("
        r"phase\s*[i1-3]|topline|endpoint|clinical\s+trial|randomized|"
        r"nct\d+|readout|efficacy|safety|patients?\s+enrolled|"
        r"primary\s+endpoint|p\s*[<=]\s*0|patent\s+cliff|fda\s+fil"
        r")\b",
        blob,
        re.I,
    ):
        return "clinical"
    return "other"


def _label_news_event_type(
    *,
    kind: str = "other",
    speculative: bool = False,
    raw: str | None = None,
) -> str:
    """
    Human label matching DIGEST_QA_CATALOG news_event_type options
    (closed M&A | speculative M&A | clinical | financing | other).
    Never return the internal code ``ma``.
    """
    if speculative:
        return "speculative M&A"
    token = str(raw if raw is not None else kind or "").strip()
    if not token:
        return "other"
    key = (
        token.lower()
        .replace("&", "and")
        .replace("-", "_")
        .replace(" ", "_")
        .replace("/", "_")
    )
    key = re.sub(r"_+", "_", key).strip("_")
    if key in {
        "speculative_ma",
        "speculative",
        "ma_speculative",
        "speculative_manda",
        "speculative_m_and_a",
        "manda_speculativo",
        "ma_speculativo",
    } or ("speculative" in key and ("ma" in key or "manda" in key or "merger" in key)):
        return "speculative M&A"
    if key in {
        "ma",
        "m_and_a",
        "manda",
        "closed_ma",
        "closed_m_and_a",
        "closed_manda",
        "merger",
        "acquisition",
        "buyout",
        "ma_chiuso",
        "manda_chiuso",
    } or ("closed" in key and ("ma" in key or "manda" in key or "merger" in key)):
        return "closed M&A"
    if key in {
        "partnership",
        "collaboration",
        "licensing",
        "license",
        "strategic_alliance",
        "joint_venture",
    }:
        return "partnership" if key != "licensing" and key != "license" else "licensing"
    if key in {"financial", "financing", "finance", "finanziario", "finanziamento"}:
        return "financing"
    if key in {"clinical", "clinico", "clinica"}:
        return "clinical"
    if key in {
        "litigation",
        "lawsuit",
        "shareholder_alert",
        "shareholder",
        "class_action",
        "classaction",
    } or "shareholder alert" in token.lower() or "class action" in token.lower():
        return "shareholder alert"
    if key in {"other", "altro", "unknown", "n_a", "na"}:
        return "other"
    # Already a display label (or close)
    low = token.lower()
    if "speculative" in low and ("m&a" in low or "m and a" in low or "ma" in low):
        return "speculative M&A"
    if "closed" in low and ("m&a" in low or "m and a" in low or "ma" in low):
        return "closed M&A"
    if low in {"clinical", "financing", "other"}:
        return low
    if low == "financial":
        return "financing"
    return token


def _normalize_digest_news_event_type(answers: list[Any] | None) -> list[Any]:
    """Rewrite cached ``ma`` / ``speculative_ma`` codes into catalog labels."""
    if not isinstance(answers, list):
        return []
    out: list[Any] = []
    speculative = False
    for a in answers:
        if isinstance(a, dict) and a.get("id") == "news_event_type":
            ans = str(a.get("answer") or "").strip().lower()
            if "speculative" in ans:
                speculative = True
    for a in answers:
        if not isinstance(a, dict):
            out.append(a)
            continue
        row = dict(a)
        if row.get("id") == "news_event_type":
            row["answer"] = _label_news_event_type(
                kind=str(row.get("answer") or "other"),
                speculative=speculative
                or str(row.get("answer") or "").strip().lower()
                in {"speculative_ma", "speculative"},
                raw=str(row.get("answer") or ""),
            )
            row["present"] = True
        out.append(row)
    return out


# ---------------------------------------------------------------------------
# Digest Q&A framework — questions the digester must answer for web/PDF/text
# ---------------------------------------------------------------------------

DIGEST_QA_CATALOG: list[dict[str, str]] = [
    {
        "id": "headline",
        "q_en": "What is the article headline?",
        "q_it": "Qual è il titolo (headline) dell’articolo?",
        "search": "title tag / H1 / RSS title / first line",
    },
    {
        "id": "has_summary",
        "q_en": "Is there an editorial summary or lede paragraph?",
        "q_it": "C’è un summary / sommario editoriale o lede?",
        "search": "lede after headline; Summary / Abstract / Overview heading",
    },
    {
        "id": "has_bullet_summary",
        "q_en": "Is there a bullet key-points block near the top of the page?",
        "q_it": "C’è un blocco bullet riassuntivo a inizio pagina?",
        "search": "Key points / Puntos clave / Key takeaways / TL;DR / Highlights",
    },
    {
        "id": "bullet_points",
        "q_en": "What are those bullet key points (verbatim if short)?",
        "q_it": "Quali sono i bullet point (verbatim se brevi)?",
        "search": "list items under key-points heading",
    },
    {
        "id": "tickers_companies",
        "q_en": "Which tickers / companies are named?",
        "q_it": "Quali ticker / società sono citati?",
        "search": "Nasdaq/NYSE tickers; company proper names",
    },
    {
        "id": "news_event_type",
        "q_en": "What type of news is this (closed M&A, speculative M&A, clinical, financing, other)?",
        "q_it": "Che tipo di news è (M&A chiuso, M&A speculativo, clinico, financing, altro)?",
        "search": "closed/announced acquisition vs 'next buyout' / candidates / rumor",
    },
    {
        "id": "products_assets",
        "q_en": "Which products / drug codes / assets are discussed?",
        "q_it": "Quali prodotti / codici farmaco / asset sono discussi?",
        "search": "INN, CODE-123, brand names (Keytruda, GPS, Sonelokimab…)",
    },
    {
        "id": "clinical_status",
        "q_en": "What is the clinical / regulatory status stated?",
        "q_it": "Qual è lo status clinico / regolatorio dichiarato?",
        "search": "Phase, trial name, events reached, FDA filing, PDUFA, patent cliff",
    },
    {
        "id": "hard_numbers",
        "q_en": "Key figures: each hard number as a one-line key point summarizing the full sentence (deal $ / n= / clinical %). Skip peer stock-tape prices.",
        "q_it": "Cifre chiave: ogni numero come key point che riassume la frase intera (deal $ / n= / %). Niente prezzi di pezzi di mercato.",
        "search": "$/M deal, n=/patients, dates+conference, clinical % — not session share prices",
    },
    {
        "id": "deal_economics",
        "q_en": (
            "Deal / partnership economics for the Fin axis: how much was paid (or "
            "not disclosed), for what, objectives, and milestones/timelines."
        ),
        "q_it": (
            "Economia del deal/partnership per l’asse Fin: quanto pagato (o non "
            "dichiarato), per fare cosa, objective e milestone/timeline."
        ),
        "search": "upfront, milestones, royalties, consideration, partnership scope, timelines",
    },
    {
        "id": "catalyst_dates",
        "q_en": "Which catalyst dates should go on the calendar?",
        "q_it": "Quali date-catalizzatore vanno in calendario?",
        "search": "readout, PDUFA, filing, conference, close date",
    },
    {
        "id": "investor_takeaway",
        "q_en": "One dense investor takeaway paragraph (no invented facts).",
        "q_it": "Un paragrafo denso di takeaway per l’investitore (niente fatti inventati).",
        "search": "synthesize only from headline + bullets + body facts",
    },
]


def _is_speculative_ma_article(*, title: str = "", body: str = "") -> bool:
    """True for 'next buyout / candidates / race to pick' — not a closed deal PR."""
    blob = f"{title}\n{(body or '')[:2500]}"
    if re.search(
        r"(?i)\b("
        r"next\s+(?:biotech\s+)?buyout|buyout\s+candidate|"
        r"race\s+to\s+pick|leading\s+candidates?|"
        r"potential\s+(?:acquisition|buyout|takeover)|"
        r"could\s+(?:be\s+)?(?:acquired|buyout)|"
        r"rumou?red\s+(?:deal|acquisition|buyout)|"
        r"acquisition\s+target|takeout\s+candidate|"
        r"patent\s+cliff\s+nears|life\s+beyond\s+\w+"
        r")\b",
        blob,
    ):
        # Real closed deal language overrides speculation cues
        if re.search(
            r"(?i)\b("
            r"complet(?:es|ed)\s+(?:its\s+)?acquisition|"
            r"has\s+closed|definitive\s+(?:merger\s+)?agreement|"
            r"enter(?:ed|s)?\s+into\s+a\s+definitive"
            r")\b",
            blob,
        ):
            return False
        return True
    return False


_BULLET_HEADING_RE = re.compile(
    r"(?im)^(?:\s*)("
    r"key\s+points?|key\s+takeaways?|puntos?\s+clave|"
    r"highlights?|tl;?\s*dr|in\s+brief|at\s+a\s+glance|"
    r"sommario|punti\s+chiave|takeaways?"
    r")\s*:?\s*$"
)
_BULLET_INLINE_RE = re.compile(
    r"(?i)\b("
    r"key\s+points?|key\s+takeaways?|puntos?\s+clave|"
    r"highlights?|punti\s+chiave"
    r")\s*:?\s*"
)


def _is_market_reaction_chrome(text: str) -> bool:
    """Stock Titan / Argus price-reaction widgets — not article key points."""
    return bool(
        re.search(
            r"(?i)\b("
            r"24h\s*move|market\s+reaction|rel\.?\s*volume|argus\b|"
            r"news\s+market\s+reaction|\$[\d.]+B\s+market\s+cap|"
            r"close\s+to\s+close|loading\.+"
            r")\b",
            text or "",
        )
    )


def _is_truncated_bullet_fragment(text: str) -> bool:
    """Reject mid-word fragments like 'ing MAVERIC Phase III…'."""
    t = (text or "").strip()
    if not t or len(t) < 28:
        return True
    if re.match(r"^[a-z]", t):
        return True
    return False


def _filter_digest_bullets(bullets: list[str], *, headline: str = "") -> list[str]:
    out: list[str] = []
    head = _clean_fetched_text(headline).lower()
    for raw in bullets or []:
        b = _clean_fetched_text(str(raw or ""))
        if not b or _is_truncated_bullet_fragment(b) or _is_market_reaction_chrome(b):
            continue
        if head and (b.lower() == head or (len(head) >= 40 and b.lower().startswith(head[:50]))):
            continue
        if b not in out:
            out.append(b[:400])
        if len(out) >= 6:
            break
    return out


def _build_investor_takeaway(
    *,
    headline: str,
    bullets: list[str],
    lede: str | None,
    kind: str,
    products: list[str],
    facts: dict[str, Any],
    speculative: bool,
    title_only: bool,
    ticker: str = "",
) -> str:
    """
    Dense investor paragraph — must NOT simply echo headline + 'Key points: …'.
    Prefer editorial lede / fact synthesis over repeating Q&A blocks.
    """
    if title_only:
        bits = [
            "Full article text could not be fetched (publisher blocked or rate-limited). "
            "Only the headline is available — open the source URL for the real story."
        ]
        if headline:
            bits.append(f"Headline: {headline.rstrip('.')}.")
        return " ".join(bits)[:900]

    parts: list[str] = []
    head = _clean_fetched_text(headline)
    if lede:
        lede_c = _clean_fetched_text(lede)
        if lede_c and not (
            head
            and len(head) >= 20
            and lede_c.lower().startswith(head[: min(40, len(head))].lower())
            and len(lede_c) < len(head) + 40
        ):
            parts.append(lede_c[:520])

    if not parts:
        syn: list[str] = []
        tk = (ticker or "").strip().upper()
        if kind == "clinical":
            assets = ", ".join(products[:3]) if products else None
            phase = str(facts.get("phase") or "").strip() or None
            study = str(facts.get("study") or "").strip() or None
            chunk = tk or "The company"
            if assets:
                chunk += f" clinical update on {assets}"
            else:
                chunk += " clinical update"
            if phase:
                chunk += f" ({phase})"
            if study:
                chunk += f" — {study}"
            syn.append(chunk.rstrip(".") + ".")
            res = str(facts.get("results") or "").strip()
            if res and len(res) > 40:
                syn.append(res[:280].rstrip(".") + ".")
        elif kind == "financial":
            syn.append(
                f"{tk or 'The company'} financing / capital-structure update "
                "as stated in the article."
            )
        elif kind == "ma":
            syn.append(
                f"{tk or 'The company'} M&A / licensing event as reported — "
                "see deal economics below."
            )
        for b in bullets[:3]:
            if len(syn) >= 2:
                break
            if head and len(head) >= 20 and b.lower().startswith(head[:40].lower()):
                continue
            syn.append(b.rstrip(".") + ".")
        if not syn and head:
            syn.append(head.rstrip(".") + ".")
        parts.extend(syn)

    if speculative:
        parts.append(
            "This is speculative M&A / positioning commentary — not a closed acquisition PR."
        )
    out = " ".join(parts)
    out = re.sub(r"(?i)\bKey points:\s*", "", out)
    return out[:900]


def _extract_page_bullet_summary(text: str) -> list[str]:
    """Pull Key Points / Puntos clave style bullets from page text."""
    raw = text or ""
    if len(raw) < 40:
        return []
    lines = [ln.strip() for ln in raw.replace("\r", "").split("\n")]
    bullets: list[str] = []
    # 1) Heading on its own line → following bullet-like lines
    for i, ln in enumerate(lines):
        if not _BULLET_HEADING_RE.match(ln):
            continue
        for j in range(i + 1, min(i + 16, len(lines))):
            b = lines[j]
            if not b:
                if bullets:
                    break
                continue
            if _BULLET_HEADING_RE.match(b) or re.match(
                r"(?i)^(abstract|introduction|methods|results|about\s+the)\b", b
            ):
                break
            b = re.sub(r"^[\u2022\u2023\u25E6•●▪◦\-\*\–—]\s*", "", b).strip()
            if len(b) < 28:
                continue
            if len(b) > 420:
                b = b[:417] + "…"
            bullets.append(b)
            if len(bullets) >= 8:
                break
        if bullets:
            break
    # 2) Inline "Key points: …" in flattened HTML (TradingView often collapses)
    if not bullets:
        m = _BULLET_INLINE_RE.search(raw)
        if m:
            chunk = raw[m.end() : m.end() + 2200]
            # Split on bullet glyphs or sentence-ish separators used by aggregators
            parts = re.split(r"[\u2022\u2023•●▪◦]|(?:\n\s*[-*]\s+)", chunk)
            for p in parts:
                p = _clean_fetched_text(p)
                if len(p) < 40:
                    continue
                # Stop when body lede starts repeating
                if re.search(r"(?i)^(sellas|moonlake|in\s+this\s+article)\b", p) and bullets:
                    break
                bullets.append(p[:400])
                if len(bullets) >= 6:
                    break
    # 3) Heuristic: consecutive dense fact sentences early in article
    if not bullets:
        head = _clean_fetched_text(raw)[:1800]
        sents = [
            s.strip()
            for s in re.split(r"(?<=[.!?])\s+", head)
            if 50 <= len(s.strip()) <= 320
        ]
        factish = [
            s
            for s in sents
            if re.search(
                r"(?i)\$\d|\bphase\s*[i1-3]|\bfda\b|\bpatent\b|\bevents?\b|"
                r"\bbillion\b|\bmillion\b|\bpivotal\b|\bfil(?:e|ing)\b",
                s,
            )
        ]
        bullets = factish[:5]
    return bullets[:8]


def _extract_lede_summary(text: str, *, title: str = "") -> str | None:
    """First substantive paragraph after the headline (editorial lede)."""
    blob = _clean_fetched_text(text or "")
    if len(blob) < 60:
        return None
    title_c = _clean_fetched_text(title or "")
    # Drop leading title echo
    if title_c and blob.lower().startswith(title_c.lower()[: min(40, len(title_c))]):
        blob = blob[len(title_c) :].lstrip(" -–—:|")
    sents = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", blob)
        if len(s.strip()) > 55
        and not re.match(r"(?i)^(login|sign up|home|subscribe|advertisement)\b", s)
    ]
    if not sents:
        return None
    lede = " ".join(sents[:2])
    return lede[:700] if len(lede) >= 60 else None


_MONTH_TOKEN = (
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
)

# Pure tape / publisher chrome — not useful as "Numbers" bullets.
_HARD_NUMBER_NOISE = re.compile(
    r"(?i)\b(?:"
    r"hoc\s+news|business\s+herald|yahoo\s+finance|seeking\s+alpha|"
    r"nasdaq|nyse|otc(?:mkts)?|"
    r"stock\s+(?:finished|closed|fell|rose|traded)|"
    r"(?:shares?|equity)\s+trading|"
    r"finished\s+at|closed\s+at\s+usd|"
    r"down\s+\d+(?:\.\d+)?\s*%|up\s+\d+(?:\.\d+)?\s*%|"
    # Market-wrap peer tape ($108.08 topping the session… / FSLY rising 15…)
    r"topping\s+the\s+session|dramatic\s+moves|broadly\s+bullish\s+session|"
    r"rounding\s+out\s+a\s+broadly|"
    r"(?:rising|climbed|shed|fell|gained|dropped|slid|surged)\s+\d+(?:\.\d+)?\s*%?|"
    r"while\s+[A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,3}\s*\([A-Z]{1,5}\)"
    r")\b"
)


def _is_stock_tape_number_context(text: str) -> bool:
    """True for share-price / peer-tape chrome (not deal or clinical figures)."""
    t = text or ""
    if _HARD_NUMBER_NOISE.search(t):
        return True
    if re.search(
        r"(?i)\b("
        r"session(?:'s)?\s+(?:most\s+)?dramatic|"
        r"bullish\s+session|technology\s+sector|"
        r"\([A-Z]{1,5}\)\s+(?:rising|climbed|shed|fell|gained|dropped)|"
        r"(?:rising|climbed|shed|fell|gained|dropped)\s+\d+"
        r")\b",
        t,
    ):
        return True
    # Bare share-price shape ($27.57 / $147.69) with no $M/$B / deal / clinical cue.
    if re.search(r"\$\s?\d{1,3}(?:,\d{3})*\.\d{2}\b", t) and not re.search(
        r"(?i)\b("
        r"million|billion|upfront|milestone|proceeds|offering|raised|"
        r"patients?|enrolled|ORR|PFS|n\s*=|phase\s*[123]|pdufa"
        r")\b",
        t,
    ):
        return True
    return False


def _sentence_around(blob: str, start: int, end: int) -> str:
    """Full sentence containing [start:end] — used to turn a number into a key point."""
    if not blob or start < 0:
        return ""
    left = blob.rfind(".", 0, start)
    left2 = blob.rfind("!", 0, start)
    left3 = blob.rfind("?", 0, start)
    left4 = blob.rfind("\n", 0, start)
    lo = max(left, left2, left3, left4)
    lo = 0 if lo < 0 else lo + 1
    right_candidates = [
        blob.find(ch, end) for ch in (".", "!", "?", "\n")
    ]
    rights = [r for r in right_candidates if r >= 0]
    hi = (min(rights) + 1) if rights else min(len(blob), end + 160)
    return _clean_fetched_text(blob[lo:hi])


def _number_key_point_from_sentence(sentence: str, *, money: str = "") -> str | None:
    """
    Compress the host sentence into one investor key point that still carries the figure.
    Drops peer/session stock-tape chrome.
    """
    sent = _clean_fetched_text(sentence or "")
    if not sent or _is_stock_tape_number_context(sent):
        return None
    # Prefer keeping the money token + the actionable clause.
    if money and money.lower() not in sent.lower():
        sent = f"{money}: {sent}"
    if len(sent) > 180:
        # Keep start through ~160 chars on a word boundary.
        cut = sent[:177]
        sp = cut.rfind(" ")
        sent = (cut if sp < 80 else cut[:sp]).rstrip(" ,;:") + "…"
    if sent and sent[0].islower():
        sent = sent[0].upper() + sent[1:]
    return sent[:200] if len(sent) >= 12 else None


def _fmt_compact_money(num_raw: str, unit_raw: str | None) -> str:
    num = (num_raw or "").replace(",", "").strip()
    try:
        val = float(num)
    except ValueError:
        return f"${num_raw}".strip()
    unit = (unit_raw or "").strip().lower()
    if unit in ("billion", "bn", "b"):
        if val >= 1 and abs(val - int(val)) < 1e-9:
            return f"{int(val)}B"
        return f"{val:g}B"
    if unit in ("million", "m", "mn"):
        if val >= 1 and abs(val - int(val)) < 1e-9:
            return f"{int(val)}M"
        return f"{val:g}M"
    # Bare $ amounts: compress large figures.
    if val >= 1_000_000_000:
        return f"{val / 1_000_000_000:g}B"
    if val >= 1_000_000:
        return f"{val / 1_000_000:g}M"
    if val >= 1000 and abs(val - int(val)) < 1e-9:
        return f"${int(val):,}"
    if abs(val - int(val)) < 1e-9:
        return f"${int(val)}"
    return f"${val:g}"


def _normalize_number_bullet(s: str) -> str:
    s = _clean_fetched_text(s or "")
    s = re.sub(r"\s*[·|]\s*", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—,;:.")
    if not s:
        return ""
    # Drop leading publisher crumbs.
    s = re.sub(r"(?i)^(hoc\s+news|reuters|bloomberg|pr\s+newswire)\s*[:\-–]?\s*", "", s)
    if len(s) > 180:
        s = s[:177].rstrip(" -–—,;:") + "…"
    # Capitalize first letter if it starts with a word.
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    return s


def _dedupe_number_bullets(items: list[str], *, limit: int = 6) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    seen_heads: set[str] = set()

    def _head_token(s: str) -> str:
        m = re.match(r"^(n=\d+|\$?\d[\d,]*(?:\.\d+)?\s*[MBmb%]?)", s.strip())
        return re.sub(r"\s+", "", m.group(1).lower()) if m else ""

    for raw in items:
        bullet = _normalize_number_bullet(raw)
        if not bullet or len(bullet) < 4:
            continue
        if _is_stock_tape_number_context(bullet):
            continue
        if _HARD_NUMBER_NOISE.search(bullet) and not re.search(
            r"(?i)\b(million|billion|patients?|enrolled|ORR|PFS|upfront|milestone|"
            r"proceeds|partnership|conference|pdufa)\b",
            bullet,
        ):
            continue
        key = re.sub(r"[^a-z0-9%]+", "", bullet.lower())
        if not key or key in seen:
            continue
        head = _head_token(bullet)
        if head and head in seen_heads:
            continue
        seen.add(key)
        if head:
            seen_heads.add(head)
        out.append(bullet)
        if len(out) >= limit:
            break
    return out


def _extract_hard_numbers(text: str) -> list[str]:
    """
    Short contextual bullets for the Numbers box — not raw prose windows.

    Examples:
      - 50M partnership with Acme
      - 270 patients enrolled
      - 17 September conference participation
    """
    blob = _clean_fetched_text(text or "")
    if not blob:
        return []

    found: list[str] = []

    def _add(s: str) -> None:
        if s:
            found.append(s)

    # --- Money + meaning (partnership / deal / financing / …) ---
    for m in re.finditer(
        r"\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|bn|mn|m|b)?\b"
        r"([^\n.!?]{0,90}?)(?=(?:\.|\n|$))",
        blob,
        re.I,
    ):
        money = _fmt_compact_money(m.group(1), m.group(2))
        tail = _clean_fetched_text(m.group(3) or "")
        host = _sentence_around(blob, m.start(), m.end())
        if _is_stock_tape_number_context(m.group(0) + " " + tail) or _is_stock_tape_number_context(
            host
        ):
            continue
        # Prefer a crisp role + counterparty when present.
        role = None
        for pat, label in (
            (r"(?i)\b(upfront(?:\s+payment)?)\b", "upfront"),
            (r"(?i)\b(milestone(?:s)?)\b", "milestones"),
            (r"(?i)\b(royalt(?:y|ies))\b", "royalties"),
            (r"(?i)\b(partnership|collaboration)\b", "partnership"),
            (r"(?i)\b(license|licensing)\b", "license"),
            (r"(?i)\b(financing|offering|raised|private\s+placement)\b", "financing"),
            (r"(?i)\b(acquisition|acquire[ds]?|buyout)\b", "acquisition"),
            (r"(?i)\b(deal|agreement)\b", "deal"),
        ):
            if re.search(pat, tail) or re.search(pat, host):
                role = label
                break
        partner = None
        pm = re.search(
            r"(?i)\b(?:with|between|from|to)\s+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,3})",
            f"{tail} {host}",
        )
        if pm:
            partner = pm.group(1).strip(" ,;.")
            if partner.lower() in {"the", "a", "an", "its", "their", "our"}:
                partner = None
        if role and partner:
            _add(f"{money} {role} with {partner}")
        elif role:
            # Keep a short slice of trailing context after the role word.
            rm = re.search(
                rf"(?i)\b{re.escape(role)}\b([^\n.!?]{{0,50}})",
                f"{tail} {host}",
            )
            extra = _clean_fetched_text(rm.group(1) if rm else "")
            extra = re.sub(r"(?i)^(payment|payments|deal|agreement)\s+", "", extra)
            if extra and len(extra) > 3:
                _add(f"{money} {role} {extra}".strip())
            else:
                _add(f"{money} {role}")
        else:
            # Key point = compressed full sentence (not orphan $xx.xx + clause fragment).
            kp = _number_key_point_from_sentence(host or f"{money} {tail}".strip(), money=money)
            if kp:
                _add(kp)
    # --- Patients / n= ---
    for m in re.finditer(
        r"\b(\d{2,5})\s+(patients?|subjects?|participants?)\b"
        r"((?:\s+\w+){0,6})",
        blob,
        re.I,
    ):
        n = m.group(1)
        who = "patients" if m.group(2).lower().startswith("patient") else m.group(2).lower()
        rest = _clean_fetched_text(m.group(3) or "")
        verb = None
        for v in ("enrolled", "randomized", "treated", "dosed", "recruited", "evaluable"):
            if re.search(rf"(?i)\b{v}\b", rest) or re.search(
                rf"(?i)\b{v}\b", blob[max(0, m.start() - 40) : m.end() + 40]
            ):
                verb = v
                break
        _add(f"{n} {who} {verb}".strip() if verb else f"{n} {who}")

    for m in re.finditer(
        r"\b(enrolled|randomized|treated|dosed|recruited)\s+(\d{2,5})\s+"
        r"(patients?|subjects?|participants?)\b",
        blob,
        re.I,
    ):
        who = "patients" if m.group(3).lower().startswith("patient") else m.group(3).lower()
        _add(f"{m.group(2)} {who} {m.group(1).lower()}")

    for m in re.finditer(r"\bn\s*=\s*(\d{2,5})\b", blob, re.I):
        _add(f"n={m.group(1)}")

    # --- Date + conference / catalyst calendar ---
    date_pat = (
        rf"(?:"
        rf"\d{{1,2}}\s+{_MONTH_TOKEN}(?:\s+20\d{{2}})?"
        rf"|{_MONTH_TOKEN}\s+\d{{1,2}}(?:,?\s+20\d{{2}})?"
        rf")"
    )
    for m in re.finditer(
        rf"\b({date_pat})\b([^\n.!?]{{0,100}}?\b"
        rf"(?:conference|congress|symposium|presentation|webcast|"
        rf"ASCO|ESMO|AACR|JPM|PDUFA|investor\s+day)\b[^\n.!?]{{0,40}})",
        blob,
        re.I,
    ):
        when = _clean_fetched_text(m.group(1))
        ctx = _clean_fetched_text(m.group(2))
        # Compress to date + short role.
        if re.search(r"(?i)\bPDUFA\b", ctx):
            _add(f"{when} PDUFA")
        elif re.search(r"(?i)\b(ASCO|ESMO|AACR|JPM)\b", ctx):
            conf = re.search(r"(?i)\b(ASCO|ESMO|AACR|JPM)\b", ctx)
            _add(f"{when} {conf.group(1).upper()} participation")
        elif re.search(r"(?i)\binvestor\s+day\b", ctx):
            _add(f"{when} investor day")
        elif re.search(r"(?i)\b(conference|congress|symposium)\b", ctx):
            _add(f"{when} conference participation")
        elif re.search(r"(?i)\bpresentation\b", ctx):
            _add(f"{when} presentation")
        else:
            _add(f"{when} {ctx[:50]}".strip())

    # --- Clinical % with label ---
    for m in re.finditer(
        r"\b(ORR|CR|PR|PFS|OS|DCR|CBR|EFS|DoR)\b(?:\s*(?:of|was|were|:))?\s*"
        r"(\d{1,3}(?:\.\d+)?%)",
        blob,
        re.I,
    ):
        _add(f"{m.group(1).upper()} {m.group(2)}")
    for m in re.finditer(
        r"\b(\d{1,3}(?:\.\d+)?%)\s*"
        r"(ORR|CR|PR|PFS|OS|DCR|CBR|overall\s+response(?:\s+rate)?|"
        r"complete\s+response|progression[- ]free|overall\s+survival)",
        blob,
        re.I,
    ):
        label = m.group(2)
        if re.search(r"(?i)overall\s+response", label):
            label = "ORR"
        elif re.search(r"(?i)complete\s+response", label):
            label = "CR"
        elif re.search(r"(?i)progression", label):
            label = "PFS"
        elif re.search(r"(?i)overall\s+survival", label):
            label = "OS"
        else:
            label = label.upper()
        _add(f"{label} {m.group(1)}")

    # --- Required events (pivotal) ---
    for m in re.finditer(
        r"\b(\d{1,3})\s*(?:of\s*)?(\d{1,3})\s+required\s+events?\b",
        blob,
        re.I,
    ):
        _add(f"{m.group(1)} of {m.group(2)} required events")

    return _dedupe_number_bullets(found, limit=6)


def _body_is_title_echo(title: str, body: str) -> bool:
    """True when body is empty or just repeats the headline (failed fetch path)."""
    t = _clean_fetched_text(title or "").lower()
    b = _clean_fetched_text(body or "").lower()
    if not b:
        return True
    if not t:
        return len(b) < 80
    t_core = re.sub(r"\s*[-–|]\s+[^-–|]{2,40}$", "", t).strip()
    # Wipe every copy of the headline (with/without publisher suffix).
    remainder = f" {b} "
    for prefix in sorted({t, t_core}, key=len, reverse=True):
        if not prefix:
            continue
        remainder = remainder.replace(prefix, " ")
    remainder = re.sub(r"\s+", " ", remainder).strip(" -–—:|.")
    # Leftover publisher crumbs alone ("the manila times") don't count as body.
    if remainder and len(remainder) < 48 and not re.search(
        r"(?i)\b(neo\d|phase|fda|orphan|fast\s*track|trial|data|\$\d)\b",
        remainder,
    ):
        return True
    if not remainder:
        return True
    return len(remainder) < 40


def _run_digest_questionnaire(
    *,
    title: str,
    body: str,
    url: str = "",
    ticker: str = "",
) -> dict[str, Any]:
    """
    Answer the Digest Q&A catalog from available text.
    Used for web pages, PDFs, and free-text pastes — even when fetch is thin.
    """
    title_s = _clean_fetched_text(title or "")
    body_s = body or ""
    if _looks_like_nav_chrome(title_s):
        recovered = _recover_article_headline(body_s, url=url, title_hint="")
        if recovered:
            title_s = recovered
    title_only = _body_is_title_echo(title_s, body_s)
    # Prefer a clean headline (strip publisher suffix)
    headline = re.sub(
        r"\s*[-–|]\s*(?:es\.)?tradingview\.com.*$",
        "",
        title_s,
        flags=re.I,
    ).strip() or title_s
    if _looks_like_nav_chrome(headline):
        recovered = _recover_article_headline(body_s, url=url)
        if recovered:
            headline = recovered
            title_s = recovered
    bullets: list[str] = []
    lede: str | None = None
    if not title_only:
        bullets = _filter_digest_bullets(
            _extract_page_bullet_summary(body_s), headline=headline
        )
        lede = _extract_lede_summary(body_s, title=headline)
    has_summary = bool(lede) and not title_only
    speculative = _is_speculative_ma_article(title=headline, body=body_s)
    kind = _detect_news_kind(f"{headline}\n{body_s}", title=headline)
    if speculative and kind == "ma":
        kind = "other"
    tickers = []
    for m in re.finditer(r"\(([A-Z]{1,5})\)|\b([A-Z]{2,5})\b(?=\s*:)", f"{headline} {body_s[:2000]}"):
        tk = (m.group(1) or m.group(2) or "").upper()
        if tk and tk not in tickers and tk not in {
            "THE", "AND", "FOR", "FDA", "AML", "USD", "CEO", "PDF", "RSS", "GMT",
        }:
            tickers.append(tk)
        if len(tickers) >= 8:
            break
    if ticker and ticker.upper() not in tickers:
        tickers.insert(0, ticker.upper())
    facts = (
        {"product": None, "study": None, "phase": None, "results": None}
        if title_only
        else _extract_clinical_facts(f"{headline}\n{body_s[:6000]}")
    )
    products = []
    if not title_only:
        for p in (facts.get("product"),):
            if p:
                products.append(p)
        for m in re.finditer(
            r"\b(Keytruda|Sonelokimab|CardiolRx|gildeuretinol|"
            r"[A-Z]{2,6}-\d{1,4}|[A-Z]{2,6}\d{2,4}|GPS)\b",
            f"{headline}\n{body_s[:5000]}",
        ):
            if m.group(1) not in products:
                products.append(m.group(1))
    numbers = [] if title_only else _extract_hard_numbers(f"{headline}\n{body_s[:8000]}")
    takeaway = _build_investor_takeaway(
        headline=headline,
        bullets=bullets,
        lede=lede,
        kind=kind,
        products=products,
        facts=facts if isinstance(facts, dict) else {},
        speculative=speculative,
        title_only=title_only,
        ticker=ticker or (tickers[0] if tickers else ""),
    )

    answers: list[dict[str, Any]] = []

    def _ans(qid: str, answer: Any, *, present: bool | None = None) -> None:
        meta = next((c for c in DIGEST_QA_CATALOG if c["id"] == qid), None)
        answers.append(
            {
                "id": qid,
                "question_en": (meta or {}).get("q_en") or qid,
                "question_it": (meta or {}).get("q_it") or qid,
                "search": (meta or {}).get("search") or "",
                "present": present if present is not None else bool(answer),
                "answer": answer,
            }
        )

    _ans("headline", headline or None, present=bool(headline))
    _ans("has_summary", "yes" if has_summary else "no", present=has_summary)
    _ans(
        "has_bullet_summary",
        "yes" if bullets else "no",
        present=bool(bullets),
    )
    _ans("bullet_points", bullets, present=bool(bullets))
    _ans("tickers_companies", tickers, present=bool(tickers))
    _ans(
        "news_event_type",
        _label_news_event_type(kind=kind, speculative=speculative),
        present=True,
    )
    _ans("products_assets", products, present=bool(products))
    clin = " · ".join(
        x
        for x in (
            facts.get("phase"),
            facts.get("study"),
            facts.get("results"),
        )
        if x
    ) or None
    if (
        not title_only
        and not clin
        and re.search(r"(?i)phase\s*3|fda\s+fil|patent\s+cliff", f"{headline} {body_s[:2000]}")
    ):
        bits = []
        if re.search(r"(?i)phase\s*3|pivotal", f"{headline}\n{body_s[:3000]}"):
            bits.append("pivotal / Phase 3 mentioned")
        if re.search(r"(?i)fda\s+fil", f"{headline}\n{body_s[:3000]}"):
            bits.append("FDA filing mentioned")
        if re.search(r"(?i)patent\s+cliff", f"{headline}\n{body_s[:3000]}"):
            bits.append("patent cliff context")
        clin = "; ".join(bits) if bits else None
    _ans("clinical_status", clin, present=bool(clin))
    _ans("hard_numbers", numbers, present=bool(numbers))
    deal_terms = None
    if not speculative and (
        kind == "ma"
        or _is_partnership_or_deal_article(title=headline, body=body_s)
    ):
        deal_terms = _extract_deal_financial_terms(title=headline, body=body_s)
        if deal_terms:
            _ans("deal_economics", deal_terms.get("summary"), present=True)
            dtype = str(deal_terms.get("deal_type") or "").strip().lower()
            if dtype in {"partnership", "licensing"}:
                # Replace the generic closed-M&A label for collaboration PRs.
                for a in answers:
                    if isinstance(a, dict) and a.get("id") == "news_event_type":
                        a["answer"] = dtype
                        break
        else:
            _ans(
                "deal_economics",
                "Deal/partnership noted — economics not extractable from available text.",
                present=True,
            )
    elif speculative:
        _ans(
            "deal_economics",
            "Not a closed deal — no upfront/milestones disclosed (speculation / thesis piece).",
            present=True,
        )
    else:
        _ans("deal_economics", None, present=False)
    dates = _filter_event_only_dates(
        _extract_dates_from_article_text(body_s or headline, title=headline)
    )
    _ans("catalyst_dates", dates, present=bool(dates))
    _ans("investor_takeaway", takeaway, present=bool(takeaway))

    return {
        "headline": headline,
        "has_summary": has_summary,
        "has_bullet_summary": bool(bullets),
        "bullet_points": bullets,
        "lede": lede,
        "tickers": tickers,
        "news_kind": kind,
        "speculative_ma": speculative,
        "products": products,
        "hard_numbers": numbers,
        "deal_terms": deal_terms,
        "takeaway": takeaway,
        "answers": answers,
        "source_url": url or None,
    }


def _brief_from_digest_qa(qa: dict[str, Any], *, ticker: str = "", url: str = "") -> dict[str, Any]:
    """Build a News Brief payload from questionnaire answers (never invent deals)."""
    bullets = list(qa.get("bullet_points") or [])
    headline = str(qa.get("headline") or "").strip()
    takeaway = str(qa.get("takeaway") or "").strip()
    kind = str(qa.get("news_kind") or "other")
    if qa.get("speculative_ma"):
        kind = "other"
    key_results: list[dict[str, str]] = []
    if bullets:
        for i, b in enumerate(bullets[:6], 1):
            key_results.append({"label": f"Key point {i}", "detail": str(b)[:400]})
    else:
        for n in (qa.get("hard_numbers") or [])[:4]:
            key_results.append({"label": "Hard number", "detail": str(n)[:400]})
        for p in (qa.get("products") or [])[:3]:
            key_results.append({"label": "Product / asset", "detail": str(p)[:120]})
    if qa.get("speculative_ma"):
        key_results.insert(
            0,
            {
                "label": "Event type",
                "detail": "Speculative M&A / buyout thesis — not a completed acquisition.",
            },
        )
    deal_terms = qa.get("deal_terms") if isinstance(qa.get("deal_terms"), dict) else None
    if deal_terms:
        # Surface Fin-axis deal economics as labeled key results.
        for label, key in (
            ("Paid / consideration", "paid"),
            ("For what", "for_what"),
            ("Objectives", "objectives"),
            ("Milestones / timing", "milestones"),
        ):
            val = str(deal_terms.get(key) or "").strip()
            if val:
                key_results.append({"label": label, "detail": val[:400]})
    detail = takeaway or headline
    # Do not prepend headline when takeaway already synthesizes the story.
    if (
        headline
        and detail
        and takeaway
        and headline.lower() not in detail.lower()[: max(len(headline) + 20, 80)]
        and not takeaway.lower().startswith(headline[:30].lower())
        and len(takeaway) < 80
    ):
        detail = f"{headline}. {detail}"
    return _dedupe_brief_sections(
        {
            "detail_summary": detail[:2200],
            "news_kind": kind,
            "indication": None,
            "dates": [],
            "results": None,
            "key_results": key_results[:10],
            "product": (qa.get("products") or [None])[0],
            "study": None,
            "phase": None,
            "key_points": [str(b)[:220] for b in bullets[:6]],
            "source_url": url or qa.get("source_url"),
            "ticker": ticker or ((qa.get("tickers") or [None])[0]),
            "digest_method": "qa_framework",
            "digest_answers": _normalize_digest_news_event_type(qa.get("answers") or []),
            "has_summary": bool(qa.get("has_summary")),
            "has_bullet_summary": bool(qa.get("has_bullet_summary")),
            "headline": headline,
            "deal_terms": deal_terms,
        }
    )


def _cap_news_words(text: str, n: int = 50) -> str:
    words = re.findall(r"\S+", str(text or "").strip())
    if not words:
        return ""
    if len(words) <= n:
        return " ".join(words)
    return " ".join(words[:n]).rstrip(".,;:") + "."


def _ai_investor_insight(
    *,
    title: str,
    body: str,
    ticker: str = "",
    news_kind: str = "",
    detail_summary: str = "",
) -> str | None:
    """
    4–6 sentences: investor lens on Clin / Corp / Fin / Market Access + stock price.
    Gemini-first; no invented facts.
    """
    tk = (ticker or "").strip().upper() or "the company"
    clip = _clean_fetched_text(
        f"{title}\n{detail_summary}\n{(body or '')[:5000]}"
    )[:6500]
    if len(clip) < 80:
        return None
    prompt = (
        f"You are a biotech equity analyst. Write an INVESTOR INSIGHT for {tk}.\n"
        "Return plain English only (no markdown, no bullets, no JSON) — 4 to 6 short sentences.\n"
        "Cover, in order, only what the source supports (skip a dimension if absent):\n"
        "1) Clinical development — trial/readout/regulatory bearing on the pipeline.\n"
        "2) Corporate — leadership, M&A, partnerships, governance, messaging.\n"
        "3) Financial — cash, revenue, financing, dilution, earnings, deal economics.\n"
        "4) Market access — reimbursement, labeling, competitive positioning, demand.\n"
        "5) Stock-price implication — bullish / bearish / mixed / likely noise, and WHY "
        "(cite hard facts: $, %, n=, HR, dates when present).\n"
        "Rules: do NOT invent deal terms, clinical results, or dates. "
        "If the piece is a market wrap / peer-tape with no company-specific catalyst, say it is noise.\n"
        f"NEWS_KIND: {news_kind or 'unknown'}\n"
        f"TICKER: {tk}\n"
        f"ARTICLE:\n{clip}"
    )
    try:
        raw = _prefer_gemini_summary(
            prompt,
            "Return 4–6 plain sentences only. Investor lens: clinical, corporate, "
            "financial, market access, then stock-price implication. No markdown.",
            max_tokens=520,
        )
    except Exception as exc:
        logger.debug("investor insight AI failed: %s", exc)
        return None
    if not raw:
        return None
    text = _clean_fetched_text(raw)
    text = re.sub(r"^```(?:\w+)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = re.sub(r"(?i)^(investor\s+insight|insight)\s*[:\-–]\s*", "", text)
    if len(text) < 60:
        return None
    # Cap at ~6 sentences.
    parts = re.split(r"(?<=[.!?])\s+", text)
    parts = [p.strip() for p in parts if p.strip()]
    if parts:
        text = " ".join(parts[:6])
    return text[:1200]


def _prefer_gemini_summary(prompt: str, system: str, max_tokens: int = 1800) -> str | None:
    """Prefer Gemini for article paragraph digests; fall back to the active provider."""
    try:
        import ai_provider

        if "gemini" in ai_provider.configured_providers():
            out = ai_provider._call_provider(
                "gemini",
                prompt,
                system=system,
                max_tokens=max_tokens,
                model_override=None,
                task="summary",
            )
            if out:
                return out
        if ai_provider.is_available():
            return ai_provider.call_ai(
                prompt, system=system, max_tokens=max_tokens, task="summary"
            )
    except Exception as exc:
        logger.debug("gemini news summary failed: %s", exc)
    return None


def _parse_ai_json_obj(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    blob = raw.strip()
    if blob.startswith("```"):
        blob = re.sub(r"^```(?:json)?\s*", "", blob)
        blob = re.sub(r"\s*```$", "", blob)
    try:
        start = blob.find("{")
        end = blob.rfind("}")
        if start >= 0 and end > start:
            blob = blob[start : end + 1]
        obj = json.loads(blob)
    except Exception:
        return None
    return obj if isinstance(obj, dict) else None


def _normalize_news_paragraphs(rows: Any) -> list[dict[str, str]]:
    if not isinstance(rows, list):
        return []
    out: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        heading = str(row.get("heading") or row.get("title") or "").strip()[:80]
        summary = _cap_news_words(
            _clean_fetched_text(str(row.get("summary") or row.get("message") or "")),
            50,
        )
        if not heading or len(summary) < 20:
            continue
        if re.search(r"(?i)^abstract$", heading):
            continue
        out.append({"heading": heading, "summary": summary})
        if len(out) >= 12:
            break
    return out


def _gemini_news_paragraphs(*, title: str, text: str) -> list[dict[str, str]]:
    clip = re.sub(r"\s+", " ", (text or "").strip())[:8000]
    if len(clip) < 80:
        return []
    prompt = (
        f"HEADLINE: {title}\n\nARTICLE:\n{clip}\n\n"
        "Split the article into the author's paragraphs (skip nav, ads, tickers, disclaimers).\n"
        "For EACH paragraph return a conceptual heading (what the paragraph is about) "
        "and a summary of its general meaning in MAX 50 words — do not copy the paragraph.\n"
        'Return JSON: {"paragraphs":[{"heading":"…","summary":"…"}]}'
    )
    raw = _prefer_gemini_summary(
        prompt,
        "Return valid JSON only. One object per article paragraph. "
        "Summarize meaning, do not quote. Max 50 words per summary.",
        max_tokens=1600,
    )
    obj = _parse_ai_json_obj(raw)
    if not obj:
        return []
    return _normalize_news_paragraphs(obj.get("paragraphs") or obj.get("section_summaries"))


def _ai_news_brief(
    text: str,
    *,
    title: str,
    ticker: str,
    url: str,
) -> dict[str, Any] | None:
    clip = re.sub(r"\s+", " ", (text or "")).strip()[:_ANALYZE_TEXT_MAX]
    if len(clip) < 40:
        return None
    kind = _detect_news_kind(clip, title=title)
    kind_rules = {
        "ma": (
            "NEWS TYPE = M&A / licensing / collaboration / partnership deal "
            "(announcement OR closing).\n"
            "Build the brief exactly like an equity-research digest with these blocks "
            "(omit a block only if truly absent — never invent):\n"
            "1) DEAL — buyer/partner, counterparty, announce date, close date, customary conditions.\n"
            "2) ASSET — product INN + code / device, route, rights "
            "(worldwide?), development stage/phase.\n"
            "3) MECHANISM / UNMET NEED — MoA in plain language; indication; whether "
            "any FDA-approved therapy exists.\n"
            "4) REGULATORY — list every FDA designation named (Breakthrough, Orphan, "
            "Fast Track, Rare Pediatric, etc.).\n"
            "5) CLINICAL — trial name (e.g. NORTHSTAR), phase, geography, topline timing.\n"
            "6) ECONOMICS (mandatory for Fin axis) — how much was paid / to be paid "
            "(upfront, milestones, royalties, cash vs stock) AND for what; if terms "
            "are not disclosed, say so explicitly. Also list objectives and any "
            "milestones / commercialization timelines.\n"
            "7) STRATEGY / IMPACT — why complementary; near-term focus (e.g. advance Ph3).\n"
            "8) DATES — announce, close, and future readout/conference dates for calendar.\n"
            "- detail_summary: 4–7 dense sentences covering blocks 1–7.\n"
            "- key_results labels MUST include where possible: Deal structure; "
            "Paid / consideration; For what; Objectives; Milestones / timing; "
            "Product & stage; Indication / unmet need; Expected impact.\n"
            "- deal_terms object MUST be filled: "
            '{"paid":"…","for_what":"…","objectives":"…","milestones":"…","deal_type":'
            '"partnership|licensing|M&A"}.\n'
            "- NEVER invent a clinical topline outcome for an acquisition close.\n"
            "- NEVER invent dollar amounts — use 'not disclosed' when absent.\n"
            "- NEVER pull unrelated marketed products from company boilerplate "
            "(e.g. Demodex / other franchises) into the deal asset.\n"
        ),
        "clinical": (
            "NEWS TYPE = clinical trial / study results.\n"
            "- detail_summary: start with study setup (design, phase, n=, population, "
            "primary endpoint, randomization/control), then development status "
            "(ongoing / topline / final / published), then published efficacy & safety "
            "results with hard numbers (%, p-values, n=).\n"
            "- key_results labels: Study setup; Population / n; Primary endpoint; "
            "Key efficacy; Safety; Next steps.\n"
        ),
        "financial": (
            "NEWS TYPE = financing / corporate structure.\n"
            "- detail_summary: name the operation (shelf/ATM/offering/placement/board change), "
            "give hard $ amounts, share counts, price, gross/net proceeds, use of proceeds, "
            "dilution or runway impact, and any governance/structure change. "
            "End with expected impact on cash runway / ownership.\n"
            "- key_results labels: Operation; Size / terms; Timing; Dilution / runway; "
            "Structure change; Expected impact.\n"
        ),
        "other": (
            "NEWS TYPE = other biotech news.\n"
            "- detail_summary: factual lede with company, event, product/indication if any, "
            "and hard numbers when present.\n"
            "- key_results: 3–6 factual Label: detail bullets.\n"
        ),
        "litigation": (
            "NEWS TYPE = lawsuit / litigation / legal overhang.\n"
            "- detail_summary: who sued whom, products named, alleged issue, court/status "
            "if stated, and the stock or commercial implication. Do not invent docket numbers.\n"
            "- key_results labels: Parties; Product; Claim; Status; Market implication.\n"
            "- paragraphs: one object per article paragraph (conceptual heading + ≤50 word meaning).\n"
        ),
    }.get(kind, "")
    prompt = (
        "You are writing a Google AI Overview–quality brief for a biotech investor.\n"
        "Read the ARTICLE and return ONLY one JSON object (no markdown):\n"
        "{"
        '"news_kind":"ma|clinical|financial|litigation|other",'
        '"detail_summary":"dense multi-sentence investor brief per NEWS TYPE rules below",'
        '"indication":"disease/condition treated or null",'
        '"product":"drug/device/candidate name or null",'
        '"study":"trial/study name or acronym or null",'
        '"phase":"e.g. Phase II or null",'
        '"abstract":"if journal paper: FULL abstract text verbatim (do not shorten); else null",'
        '"paragraphs":['
        '{"heading":"short conceptual title of this paragraph",'
        '"summary":"max 50 words: the general meaning of this paragraph, not a copy"}'
        "],"
        '"section_summaries":['
        '{"heading":"Introduction","summary":"~80 words"},'
        '{"heading":"Results","summary":"~80 words"},'
        '{"heading":"Conclusions","summary":"~80 words"}'
        "],"
        '"key_results":['
        '{"label":"…","detail":"…"}'
        "],"
        '"dates":[{"date":"Month Day, Year or YYYY-MM-DD",'
        '"what_happens":"concrete future/past catalyst: conference name, fireside, PDUFA, '
        'deal close, shelf filing, readout — these dates migrate to the calendar"}],'
        '"results":"one short paragraph synthesizing the main outcome with hard numbers",'
        '"key_points":["up to 6 short bullets — prefer Label: detail form"],'
        '"deal_terms":{"deal_type":"partnership|licensing|M&A|null",'
        '"paid":"how much paid / consideration or not disclosed",'
        '"for_what":"what the payment or partnership is for",'
        '"objectives":"stated objectives",'
        '"milestones":"milestones / timelines or not disclosed"},'
        '"investor_insight":"4-6 sentences: investor lens on clinical development, corporate, '
        'financial, and market-access impact when supported by the text, then bullish/bearish/'
        'mixed/noise stock-price implication; cite hard facts; no invented catalysts",'
        '"ticker":"ticker if clear else null"'
        "}\n"
        f"{kind_rules}"
        "QUALITY BAR:\n"
        "- Prefer hard numbers ($, %, p-values, n=, doses, dates) over vague adjectives.\n"
        "- Do not invent statistics, deal terms, or dates.\n"
        "- Always name product, study, phase, and indication when present.\n"
        "- key_results: 3–6 bullets; skip empty labels.\n"
        "- For journal papers: abstract = FULL text verbatim; section_summaries = ONLY "
        "Introduction, Results, and Conclusions at ~80 words each. Never put Abstract "
        "inside section_summaries.\n"
        "- For news / press / wire articles: fill paragraphs with one object per "
        "author paragraph. heading = conceptual title of what that paragraph is saying; "
        "summary = the general meaning in ≤50 words (do not copy the paragraph).\n"
        "- DATES (critical for calendar migration): ALWAYS extract conference / investor-day / "
        "fireside / PDUFA / deal-close / readout dates when stated (ASCO, ESMO, ASH, AACR, "
        "Jefferies, JPM, BIO, Wainwright, etc.). what_happens must name the event. "
        "Omit bare calendar mentions with no catalyst.\n"
        "- For financing/shelf/ATM: size, window, instruments, whether anything is priced now.\n"
        f"DETECTED_KIND: {kind}\n"
        f"TICKER HINT: {ticker or 'unknown'}\n"
        f"HEADLINE: {title}\n"
        f"URL: {url}\n"
        f"ARTICLE:\n{clip}"
    )
    try:
        raw = _prefer_gemini_summary(
            prompt,
            "Return valid JSON object only. No markdown fences. "
            "Write like a Google AI Overview: dense, factual, number-rich. "
            "Follow the NEWS TYPE rules exactly. "
            "For news articles fill paragraphs (conceptual heading + ≤50 word meaning per paragraph).",
            max_tokens=2200,
        )
    except Exception as exc:
        logger.debug("news brief AI failed: %s", exc)
        return None
    if not raw:
        return None
    blob = raw.strip()
    if blob.startswith("```"):
        blob = re.sub(r"^```(?:json)?\s*", "", blob)
        blob = re.sub(r"\s*```$", "", blob)
    try:
        start = blob.find("{")
        end = blob.rfind("}")
        if start >= 0 and end > start:
            blob = blob[start : end + 1]
        obj = json.loads(blob)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    dates_out: list[dict[str, str]] = []
    for d in obj.get("dates") or []:
        if not isinstance(d, dict):
            continue
        ds = str(d.get("date") or "").strip()
        wh = str(d.get("what_happens") or "").strip()
        if not (ds or wh):
            continue
        if not _is_specific_event_date(wh):
            continue
        dates_out.append({"date": ds[:40], "what_happens": wh[:240]})
        if len(dates_out) >= 6:
            break
    # Merge regex dates if the model missed them
    for d in _extract_dates_from_article_text(clip, title=title):
        if len(dates_out) >= 6:
            break
        if not any(
            str(x.get("date") or "").lower() == d["date"].lower() for x in dates_out
        ):
            dates_out.append(d)
    dates_out = _filter_event_only_dates(dates_out)
    key_results: list[dict[str, str]] = []
    for kr in obj.get("key_results") or []:
        if not isinstance(kr, dict):
            continue
        label = str(kr.get("label") or "").strip()[:80]
        detail = _clean_fetched_text(str(kr.get("detail") or "").strip())[:400]
        if not detail:
            continue
        key_results.append({"label": label or "Finding", "detail": detail})
        if len(key_results) >= 6:
            break
    keys = [
        str(x).strip()[:220]
        for x in (obj.get("key_points") or [])
        if str(x).strip()
    ][:6]
    # Prefer key_results as bullets when key_points are thin/title-echo
    if key_results and (not keys or all(len(k) < 40 for k in keys)):
        keys = [
            f"{kr['label']}: {kr['detail']}"[:220]
            for kr in key_results
        ][:6]
    tk = str(obj.get("ticker") or ticker or "").strip().upper() or None
    if tk and (len(tk) > 6 or not re.fullmatch(r"[A-Z.]{1,6}", tk)):
        tk = ticker or None
    results = obj.get("results")
    if results is not None:
        results = str(results).strip()[:900] or None
    facts = _extract_clinical_facts(clip)
    product = str(obj.get("product") or facts.get("product") or "").strip() or None
    study = str(obj.get("study") or facts.get("study") or "").strip() or None
    phase = str(obj.get("phase") or facts.get("phase") or "").strip() or None
    indication = str(obj.get("indication") or "").strip() or None
    if not results:
        results = facts.get("results")
    detail = _clean_fetched_text(
        str(obj.get("detail_summary") or "").strip()[:3200] or title
    )
    abstract = _clean_fetched_text(str(obj.get("abstract") or "").strip())[:3500] or None
    news_kind = str(obj.get("news_kind") or kind or "other").strip().lower()
    if news_kind not in {"ma", "clinical", "financial", "other", "litigation"}:
        news_kind = kind if kind in {"ma", "clinical", "financial", "other", "litigation"} else "other"
    section_summaries: list[dict[str, str]] = []
    news_paragraphs = _normalize_news_paragraphs(obj.get("paragraphs"))
    if news_paragraphs:
        section_summaries = news_paragraphs
    for s in obj.get("section_summaries") or []:
        if news_paragraphs:
            break
        if not isinstance(s, dict):
            continue
        h = str(s.get("heading") or "").strip()[:40]
        sm = _clean_fetched_text(str(s.get("summary") or "").strip())[
            :_PAPER_SECTION_SUMMARY_MAX
        ]
        if not h or len(sm) < 20:
            continue
        # Abstract is stored separately verbatim — never as a chapter card
        if re.search(r"(?i)^abstract$", h.strip()):
            if not abstract and len(sm) > 80:
                abstract = sm[:3500]
            continue
        if not re.search(r"(?i)introduction|conclusions?|results", h):
            continue
        if re.search(r"(?i)introduction", h):
            h = "Introduction"
        elif re.search(r"(?i)conclusion", h):
            h = "Conclusions"
        elif re.search(r"(?i)results", h):
            h = "Results"
        if any(x.get("heading") == h for x in section_summaries):
            continue
        section_summaries.append({"heading": h, "summary": sm})
        if len(section_summaries) >= len(_PAPER_SECTION_ORDER):
            break
    if not news_paragraphs:
        order = {h: i for i, h in enumerate(_PAPER_SECTION_ORDER)}
        section_summaries.sort(key=lambda x: order.get(str(x.get("heading")), 9))
    is_paper = bool(abstract) and not news_paragraphs
    if study and study.upper() in _STUDY_DEGREE_BLOCK:
        study = None
    deal_terms = None
    raw_dt = obj.get("deal_terms")
    if isinstance(raw_dt, dict):
        deal_terms = {
            "deal_type": str(raw_dt.get("deal_type") or "").strip()[:40] or None,
            "paid": _clean_fetched_text(str(raw_dt.get("paid") or ""))[:500] or None,
            "for_what": _clean_fetched_text(str(raw_dt.get("for_what") or ""))[:400]
            or None,
            "objectives": _clean_fetched_text(str(raw_dt.get("objectives") or ""))[:500]
            or None,
            "milestones": _clean_fetched_text(str(raw_dt.get("milestones") or ""))[:500]
            or None,
        }
        if not any(deal_terms.get(k) for k in ("paid", "for_what", "objectives", "milestones")):
            deal_terms = None
        elif deal_terms:
            deal_terms["summary"] = (
                f"{(deal_terms.get('deal_type') or 'Deal')}: "
                f"paid — {deal_terms.get('paid') or 'n/a'}. "
                f"For — {deal_terms.get('for_what') or 'n/a'}. "
                f"Objectives — {deal_terms.get('objectives') or 'n/a'}. "
                f"Milestones / timing — {deal_terms.get('milestones') or 'n/a'}."
            )[:1200]
    if not deal_terms and (
        news_kind == "ma"
        or _is_partnership_or_deal_article(title=title, body=clip)
    ):
        deal_terms = _extract_deal_financial_terms(title=title, body=clip)
    if deal_terms:
        # Ensure Fin-axis labels appear in key_results.
        have = {str(kr.get("label") or "").lower() for kr in key_results}
        for label, key in (
            ("Paid / consideration", "paid"),
            ("For what", "for_what"),
            ("Objectives", "objectives"),
            ("Milestones / timing", "milestones"),
        ):
            val = str(deal_terms.get(key) or "").strip()
            if not val or label.lower() in have:
                continue
            key_results.append({"label": label, "detail": val[:400]})
            if len(key_results) >= 10:
                break
    return {
        "detail_summary": detail,
        "news_kind": news_kind,
        "indication": indication[:120] if indication else None,
        "dates": dates_out,
        "results": results,
        "key_results": key_results,
        "abstract": abstract,
        "section_summaries": section_summaries,
        "is_paper": is_paper,
        "product": product[:80] if product else None,
        "study": study[:80] if study else None,
        "phase": phase[:40] if phase else None,
        "key_points": [_clean_fetched_text(k) for k in keys],
        "investor_insight": (
            _clean_fetched_text(str(obj.get("investor_insight") or "").strip())[:1200]
            or None
        ),
        "deal_terms": deal_terms,
        "source_url": url,
        "ticker": tk,
        "digest_method": "ai",
    }


_brief_prefetch_lock = threading.Lock()
_brief_prefetch_inflight = False
_brief_prefetch_queue: list[dict[str, Any]] = []


def prefetch_daily_news_briefs(
    rows: list[dict[str, Any]],
    *,
    max_items: int = 12,
) -> dict[str, Any]:
    """
    Build investor briefs for newly staged headlines (page fetch + digest).
    Skips fingerprints already in the brief cache. Bounded so hourly search
    does not block on every headline.
    """
    built = 0
    skipped = 0
    errors = 0
    for row in rows:
        if built >= max_items:
            break
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        url = str(row.get("resolved_link") or row.get("link") or "").strip()
        summary = str(row.get("summary") or "").strip()
        ticker = str(row.get("ticker") or "").strip().upper()
        iid = str(row.get("id") or "").strip()
        if not title and not url:
            continue
        fp = str(row.get("article_fp") or "").strip() or _article_fingerprint(
            ticker=ticker, title=title, url=url, item_id=iid
        )
        if _brief_cache_get(fp):
            skipped += 1
            continue
        try:
            res = brief_daily_news_item(
                title=title,
                url=url or None,
                summary=summary or None,
                ticker=ticker or None,
                item_id=iid or None,
            )
            if res.get("ok") and res.get("brief"):
                built += 1
            else:
                errors += 1
        except Exception as exc:
            errors += 1
            logger.debug("brief prefetch %s failed: %s", ticker or iid, exc)
    return {
        "ok": True,
        "built": built,
        "skipped_cached": skipped,
        "errors": errors,
        "considered": len(rows),
    }


def _spawn_brief_prefetch(rows: list[dict[str, Any]]) -> None:
    """
    Daemon: warm briefs as soon as headlines land on the desk — before the
    user opens the News Brief modal. Queues while a worker is already running
    so later batches are never dropped.
    """
    global _brief_prefetch_inflight
    if not rows:
        return
    # Newest first (search appends in scan order; reverse prefers last found).
    incoming = [r for r in reversed(list(rows)) if isinstance(r, dict)][:24]
    if not incoming:
        return

    start_worker = False
    with _brief_prefetch_lock:
        _brief_prefetch_queue.extend(incoming)
        # Cap queue so a stalled Gemini run cannot grow forever.
        if len(_brief_prefetch_queue) > 48:
            del _brief_prefetch_queue[:-48]
        if not _brief_prefetch_inflight:
            _brief_prefetch_inflight = True
            start_worker = True

    if not start_worker:
        return

    def _run() -> None:
        global _brief_prefetch_inflight
        try:
            while True:
                with _brief_prefetch_lock:
                    if not _brief_prefetch_queue:
                        _brief_prefetch_inflight = False
                        return
                    batch = list(_brief_prefetch_queue)
                    _brief_prefetch_queue.clear()
                seen: set[str] = set()
                unique: list[dict[str, Any]] = []
                for row in batch:
                    key = (
                        str(row.get("id") or "").strip()
                        or str(row.get("article_fp") or "").strip()
                        or str(row.get("title") or "").strip().lower()[:120]
                    )
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    unique.append(row)
                try:
                    stats = prefetch_daily_news_briefs(unique, max_items=16)
                    logger.info(
                        "Daily news brief prefetch built=%s skipped=%s errors=%s queued=%s",
                        stats.get("built"),
                        stats.get("skipped_cached"),
                        stats.get("errors"),
                        len(unique),
                    )
                except Exception as exc:
                    logger.debug("Daily news brief prefetch batch failed: %s", exc)
        except Exception as exc:
            logger.debug("Daily news brief prefetch failed: %s", exc)
            with _brief_prefetch_lock:
                _brief_prefetch_inflight = False

    threading.Thread(
        target=_run,
        name="daily-news-brief-prefetch",
        daemon=True,
    ).start()


def _is_fda_media_pdf_url(url: str) -> bool:
    u = str(url or "").strip().lower()
    if "fda.gov" not in u:
        return False
    return "/media/" in u or u.endswith(".pdf") or "/download" in u


def _find_daily_news_row(item_id: str) -> dict[str, Any] | None:
    iid = str(item_id or "").strip()
    if not iid:
        return None
    doc = _read()
    for bucket in ("top_news", "items", "highlights"):
        for row in doc.get(bucket) or []:
            if isinstance(row, dict) and str(row.get("id") or "") == iid:
                return row
    return None


def _build_fda_briefing_daily_news_brief(
    *,
    url: str,
    title: str = "",
    ticker: str = "",
    item_id: str = "",
    summary: str = "",
) -> dict[str, Any] | None:
    """
    Download FDA AdCom PDF bytes and build a chaptered investor brief.
    Avoids HTML scrape (http_403) on fda.gov/media/.../download.
    """
    try:
        import fda_adcom_briefing as fab
        import fda_adcom_calendar as fac
    except Exception as exc:
        logger.debug("FDA briefing import failed: %s", exc)
        return None

    stored = _find_daily_news_row(item_id) if item_id else None
    # Reuse a rich staged row when already present (sections + insight).
    if (
        stored
        and str(stored.get("source_kind") or "") == "fda_briefing"
        and (
            (isinstance(stored.get("section_summaries"), list) and stored.get("section_summaries"))
            or len(str(stored.get("detail_summary") or stored.get("summary_long") or "")) >= 200
        )
        and str(stored.get("investor_insight") or "").strip()
    ):
        return {
            "title": str(stored.get("title") or title)[:240],
            "headline": str(stored.get("title") or title)[:240],
            "ticker": str(stored.get("ticker") or ticker).strip().upper() or None,
            "product": stored.get("product"),
            "detail_summary": str(
                stored.get("detail_summary") or stored.get("summary_long") or ""
            )[:2200],
            "summary": str(stored.get("summary") or "")[:400],
            "key_points": stored.get("key_points") or [],
            "results": (
                "\n".join(f"• {r}" for r in (stored.get("results") or [])[:20])
                if isinstance(stored.get("results"), list)
                else stored.get("results")
            ),
            "section_summaries": stored.get("section_summaries") or [],
            "investor_insight": str(stored.get("investor_insight") or "")[:1200] or None,
            "company_summary": str(stored.get("company_summary") or "")[:900] or None,
            "product_inset": stored.get("product_inset")
            if isinstance(stored.get("product_inset"), dict)
            else None,
            "panel_qa": stored.get("panel_qa")
            if isinstance(stored.get("panel_qa"), list)
            else None,
            "clinical_score": stored.get("clinical_score"),
            "financial_score": stored.get("financial_score"),
            "corporate_score": stored.get("corporate_score"),
            "market_access_score": stored.get("market_access_score"),
            "eis_score": stored.get("eis_score"),
            "taxonomy_dimensions": stored.get("taxonomy_dimensions"),
            "taxonomy_method": stored.get("taxonomy_method") or "fda_briefing",
            "news_kind": "clinical",
            "source_kind": "fda_briefing",
            "source_label": "FDA BRIEFING",
            "digest_method": "fda_briefing",
            "link": str(stored.get("link") or url)[:500],
            "source_url": str(stored.get("link") or url)[:500],
            "fetch_error": None,
            "fda_score": stored.get("fda_score"),
            "fda_stance": stored.get("fda_stance"),
            "skip_page_check": True,
        }

    row: dict[str, Any] = {
        "ticker": (ticker or (stored or {}).get("ticker") or "").strip().upper(),
        "company": str((stored or {}).get("company") or "")[:120],
        "product": str((stored or {}).get("product") or "")[:160],
        "committee": str((stored or {}).get("committee") or "")[:160],
        "date": str((stored or {}).get("event_date") or (stored or {}).get("published_at") or "")[:10],
        "id": str((stored or {}).get("fda_adcom_id") or item_id or ""),
    }
    # Enrich from AdCom calendar when possible.
    try:
        snap = fac.load_snapshot()
        for r in snap.get("rows") or []:
            if not isinstance(r, dict):
                continue
            same_tk = str(r.get("ticker") or "").upper() == row["ticker"]
            brief = r.get("briefing") if isinstance(r.get("briefing"), dict) else None
            pdf = str((brief or {}).get("pdfUrl") or r.get("briefingPdfHint") or "")
            if same_tk and (
                (url and pdf and url.split("?")[0] in pdf)
                or str(r.get("id") or "") == row["id"]
                or (
                    row["product"]
                    and row["product"].lower()[:8] in str(r.get("product") or "").lower()
                )
            ):
                row = {
                    **row,
                    "company": str(r.get("company") or row["company"])[:120],
                    "product": str(r.get("product") or row["product"])[:160],
                    "committee": str(r.get("committee") or row["committee"])[:160],
                    "date": str(r.get("date") or row["date"])[:10],
                    "id": str(r.get("id") or row["id"]),
                    "href": str(r.get("href") or ""),
                }
                # Ready card already digested — reuse without re-download or Gemini.
                # Open-modal must stay cache-fast; AI taxonomy is for background staging only.
                if brief and brief.get("status") == "ready" and (
                    brief.get("sectionSummariesEn")
                    or brief.get("summaryEn")
                    or brief.get("resultsEn")
                    or brief.get("executiveSummaryEn")
                    or brief.get("investorInsightEn")
                ):
                    dims: dict[str, Any] = {}
                    try:
                        dims = _dimension_scores(
                            title or str(brief.get("title") or ""),
                            fab._compose_daily_news_long(brief),
                            use_ai=False,
                        )
                    except Exception:
                        logger.debug("FDA ready-card heuristic dims failed", exc_info=True)
                    return fab.card_to_daily_news_brief(
                        row, brief, title=title or None, dims=dims
                    )
                break
    except Exception:
        logger.debug("FDA calendar enrich failed", exc_info=True)

    try:
        raw = fac._http_get_bytes(url, timeout=12)
    except Exception as exc:
        logger.warning("FDA PDF download failed %s: %s", url, exc)
        return None
    text = fab.extract_pdf_text(raw)
    if len(text) < 200:
        return None
    card = fab.build_briefing_card(
        text,
        row,
        materials_url=str(row.get("href") or fab.MATERIALS_URL),
        pdf_url=url,
        title=title or f"FDA AdCom briefing · {row.get('product') or row.get('ticker')}",
        match_ok=True,
        match_hint="pdf_brief",
    )
    # Live PDF path: heuristic dims only — Gemini already ran inside build_briefing_card.
    dims: dict[str, Any] = {}
    try:
        dims = _dimension_scores(
            title or str(card.get("title") or ""),
            fab._compose_daily_news_long(card),
            use_ai=False,
        )
    except Exception:
        pass
    return fab.card_to_daily_news_brief(row, card, title=title or None, dims=dims)


def brief_daily_news_item(
    *,
    title: str | None = None,
    url: str | None = None,
    summary: str | None = None,
    ticker: str | None = None,
    item_id: str | None = None,
) -> dict[str, Any]:
    """
    Open-from-list detail brief for a Daily News headline.
    Fetches the page when possible, digests dates / results, keeps source URL.
    Results are cached by article fingerprint — reopen is instant; dismiss clears cache.
    Display only — not Soft BUY/SELL.
    """
    t0 = time.monotonic()

    def _remaining() -> float:
        return _BRIEF_TIME_BUDGET_S - (time.monotonic() - t0)

    title_s = str(title or "").strip()
    url_s = str(url or "").strip()
    summary_s = _strip_heuristic_noise(str(summary or "").strip())
    ticker_s = str(ticker or "").strip().upper()
    iid = str(item_id or "").strip()
    if not title_s and not url_s and not summary_s:
        return {"ok": False, "error": "provide_title_url_or_summary"}

    # Law-firm solicitation / lead-plaintiff reminders: never wait on Barchart /
    # NatLawReview / paywalled publisher fetches — brief from the headline.
    if _is_shareholder_alert(title_s, summary_s):
        brief = _build_shareholder_alert_brief(
            title=title_s or summary_s,
            body=summary_s or title_s,
            url=url_s,
            ticker=ticker_s,
        )
        brief["brief_schema"] = _BRIEF_SCHEMA
        brief["article_fp"] = _article_fingerprint(
            ticker=ticker_s, title=title_s, url=url_s, item_id=iid
        )
        brief["fetch_error"] = None
        # Mild corporate overhang — not Clin/Fin product catalysts.
        try:
            from eis_taxonomy_scoring import score_article_dimensions

            scored = score_article_dimensions(
                f"{title_s}\n{summary_s}\nclass action lawsuit filed legal overhang",
                use_ai=False,
            )
            for k in (
                "clinical_score",
                "financial_score",
                "corporate_score",
                "market_access_score",
                "taxonomy_dimensions",
                "taxonomy_method",
            ):
                if scored.get(k) is not None:
                    brief[k] = scored.get(k)
        except Exception:
            brief.setdefault("corporate_score", -1.0)
        fp_early = brief["article_fp"]
        try:
            persist_brief_cache(fp_early, brief)
        except Exception:
            pass
        return {"ok": True, "brief": brief, "cached": False, "article_fp": fp_early}

    fp = _article_fingerprint(
        ticker=ticker_s, title=title_s, url=url_s, item_id=iid
    )
    doc0 = _read()
    cached = _brief_cache_get(fp, doc0)
    if cached:
        # Rebuild stale EDGAR briefs (PAGE CHECK Q&A / missing Item blocks).
        edgar_url = "sec.gov/archives/edgar/" in url_s.lower()
        stale_edgar = edgar_url and (
            not cached.get("skip_page_check")
            or bool(cached.get("digest_answers"))
            or not cached.get("item_summaries")
            or not (cached.get("section_summaries") or [])
            or cached.get("digest_method")
            not in (
                "sec_8k_items",
                "sec_8k_gemini",
                "ai_8k",
                "heuristic_8k",
                "extractive",
            )
            # Narrative is the raw "Item X.YZ (…)" concatenation → the classifier was
            # down when this brief was built; rebuild now that it answers again.
            or bool(
                re.match(
                    r"(?i)^\s*Item\s+\d\.\d{2}\s*\(",
                    str(cached.get("detail_summary") or ""),
                )
            )
        )
        cached_title = str(cached.get("title") or cached.get("headline") or "")
        # Force rebuild when request title is chrome OR cached title is chrome/boilerplate.
        stale_chrome = (
            _looks_like_nav_chrome(title_s)
            or _looks_like_nav_chrome(cached_title)
            or bool(
                re.match(
                    r"(?i)^(common\s+shares|debt\s+securities|preliminary\s+short\s+form|"
                    r"once\s+a\s+receipt|the\s+filing\s+of\s+the\s+shelf)\b",
                    cached_title,
                )
            )
        )
        # Old briefs echoed headline + "Key points:" into the takeaway / detail.
        stale_echo = False
        try:
            answers = cached.get("digest_answers") or []
            for a in answers:
                if not isinstance(a, dict):
                    continue
                if a.get("id") == "investor_takeaway" and re.search(
                    r"(?i)\bKey points:\s*", str(a.get("answer") or "")
                ):
                    stale_echo = True
                    break
            detail = str(cached.get("detail_summary") or "")
            if re.search(r"(?i)\bKey points:\s*", detail):
                stale_echo = True
        except Exception:
            stale_echo = False
        if not stale_edgar and not stale_chrome and not stale_echo:
            brief = dict(cached)
            stale_schema = int(brief.get("brief_schema") or 0) < _BRIEF_SCHEMA
            stale_junk_fetch = bool(
                re.search(
                    r"(?i)NameResolution|junk_publisher_host|blocked_publisher_host|"
                    r"http_403|http_401|http_429|Failed to resolve|"
                    r"shareholderalert|Max retries exceeded|"
                    r"no_company_domain|press_fallback_empty|title_search_no_body|"
                    r"google_news_no_article_body|content_too_short|stock_titan_no_headline_match",
                    str(brief.get("fetch_error") or ""),
                )
            )
            stale_thin_alert = _is_shareholder_alert(title_s) and (
                len(str(brief.get("detail_summary") or "").strip()) < 80
                or str(brief.get("digest_method") or "") != "shareholder_alert"
            )
            stale_no_paragraphs = (
                not brief.get("is_paper")
                and not (brief.get("section_summaries") or [])
                and len(str(brief.get("detail_summary") or "").strip()) < 400
            )
            # PubMed page always has AbstractText via eutils — never keep empty abstract cache.
            stale_pubmed_no_abs = bool(_pmid_from_url(url_s)) and (
                not str(brief.get("abstract") or "").strip()
                or not str(brief.get("pub_date") or "").strip()
            )
            # Rebuild once to attach Investor Insight (Clin/Corp/Fin/Access + stock).
            stale_no_insight = (
                not brief.get("skip_page_check")
                and len(str(brief.get("detail_summary") or brief.get("abstract") or "").strip())
                >= 80
                and not str(brief.get("investor_insight") or "").strip()
            )
            stale_zero_fetch = bool(brief.get("fetch_error")) and not any(
                abs(float(brief.get(k) or 0) or 0) >= 0.01
                for k in (
                    "clinical_score",
                    "financial_score",
                    "corporate_score",
                    "market_access_score",
                )
            )
            stale_fda_thin = _is_fda_media_pdf_url(url_s) and (
                str(brief.get("digest_method") or "") != "fda_briefing"
                or bool(brief.get("fetch_error"))
                or not (brief.get("section_summaries") or [])
                or not str(brief.get("investor_insight") or "").strip()
                or (
                    # MCED/PMA digests must carry the panel Q&A block once schema ships.
                    bool(
                        re.search(
                            r"(?i)galleri|pathfinder|mced|cancer signal origin",
                            f"{title_s} {brief.get('product') or ''} {brief.get('detail_summary') or ''}",
                        )
                    )
                    and not (
                        isinstance(brief.get("panel_qa"), list) and brief.get("panel_qa")
                    )
                )
            )
            stale_missing_deal_terms = (
                _is_partnership_or_deal_article(
                    title=title_s,
                    body=str(brief.get("detail_summary") or summary_s or ""),
                )
                and not (
                    isinstance(brief.get("deal_terms"), dict) and brief.get("deal_terms")
                )
            )
            if (
                stale_schema
                or stale_junk_fetch
                or stale_thin_alert
                or stale_no_paragraphs
                or stale_pubmed_no_abs
                or stale_no_insight
                or stale_zero_fetch
                or stale_fda_thin
                or stale_missing_deal_terms
            ):
                pass  # fall through and rebuild
            else:
                # Reject cached digests that drifted to a different same-ticker story
                # (e.g. Google News unwrap failed → wrong press PR → Stoke vs China approval).
                # Only detail_summary — digest Q&A often echoes the card headline.
                cached_blob = str(brief.get("detail_summary") or "")
                if title_s and len(cached_blob.strip()) >= 80 and not _body_matches_headline(
                    title_s, cached_blob
                ):
                    pass  # fall through and rebuild
                else:
                    if brief.get("digest_answers"):
                        brief["digest_answers"] = _normalize_digest_news_event_type(
                            brief.get("digest_answers")
                        )
                    return {"ok": True, "brief": brief, "cached": True, "article_fp": fp}

    stored_row = _find_user_analysis_row(iid) if iid else None
    use_stored_pdf = bool(
        stored_row
        and str(stored_row.get("source_kind") or "") == "pdf"
        and len(str(stored_row.get("source_excerpt") or "")) >= 40
    )

    body = ""
    err: str | None = None
    resolved_url = url_s
    url_for_brief = url_s
    raw_pre_chrome = ""
    brief_taxonomy: dict[str, Any] | None = None
    # PubMed: copy AbstractText (+ date) via NCBI eutils — do not scrape the HTML page.
    pubmed_seed = (
        _fetch_pubmed_brief_seed(url_s)
        if _pmid_from_url(url_s) and _remaining() > 3
        else None
    )
    if pubmed_seed:
        if pubmed_seed.get("title") and (
            not title_s or _looks_like_nav_chrome(title_s) or len(title_s) < 24
        ):
            title_s = str(pubmed_seed["title"])
        if not summary_s or len(summary_s) < 80:
            summary_s = str(pubmed_seed.get("abstract") or "")[:900]
    if pubmed_seed:
        # Already have AbstractText from eutils — skip scraping pubmed HTML (cookie wall).
        body = (
            f"{pubmed_seed.get('title') or title_s}\n\n"
            f"{pubmed_seed.get('abstract') or ''}"
        ).strip()
        err = None
        url_for_brief = url_s
    elif use_stored_pdf:
        body = _clean_paper_text(str(stored_row.get("source_excerpt") or ""))
        url_for_brief = str(stored_row.get("source_ref") or url_s)
        title_s = str(
            stored_row.get("summary_long")
            or stored_row.get("summary_10w")
            or stored_row.get("source_label")
            or title_s
        ).strip() or title_s
        ticker_s = str(stored_row.get("ticker") or ticker_s).strip().upper() or ticker_s
    elif _is_fda_media_pdf_url(url_s) and _remaining() > 6:
        # FDA /media/.../download is a PDF — never scrape as HTML (http_403).
        fda_brief = _build_fda_briefing_daily_news_brief(
            url=url_s,
            title=title_s,
            ticker=ticker_s,
            item_id=iid,
            summary=summary_s,
        )
        if fda_brief:
            fda_brief["brief_schema"] = _BRIEF_SCHEMA
            fda_brief["article_fp"] = fp
            try:
                persist_brief_cache(fp, fda_brief, item_id=iid)
            except Exception:
                pass
            return {"ok": True, "brief": fda_brief, "cached": False, "article_fp": fp}
        body = f"{title_s}\n{summary_s}".strip()
        err = "fda_pdf_brief_failed"
    elif url_s.startswith(("http://", "https://")) and _remaining() > 4:
        # Resolve Google News wrappers (batchexecute) — allow HTTP; budget-capped.
        resolved_url = _unwrap_google_news_url(
            url_s, timeout_s=max(6.0, min(14.0, _remaining() - 2)), allow_http=True
        )
        # SEC EDGAR HTML returns http_403 to browser UA — use EDGAR bundle fetch.
        if _is_sec_edgar_archives_url(resolved_url or url_s):
            body, err = _fetch_edgar_8k_text_from_url(resolved_url or url_s)
            if body:
                url_for_brief = resolved_url or url_s
                err = None
        if not body:
            # Prefer unwrapped publisher URL — GNews shells + quick=True used to
            # skip HTTP follow and fall into no_company_domain IR guesses.
            fetch_target = url_s
            if resolved_url and not _is_google_news_shell_url(resolved_url):
                fetch_target = resolved_url
            body, err = _fetch_url_text(
                fetch_target,
                title_hint=title_s,
                ticker_hint=ticker_s,
                quick=False,
            )
            if (not body or len(body) < 280) and fetch_target != url_s:
                body2, err2 = _fetch_url_text(
                    url_s,
                    title_hint=title_s,
                    ticker_hint=ticker_s,
                    quick=False,
                )
                if body2 and len(body2) > len(body or ""):
                    body, err = body2, err2
        if resolved_url and not _is_google_news_shell_url(resolved_url):
            url_for_brief = resolved_url
        elif _is_google_news_shell_url(url_for_brief):
            url_for_brief = ""
    if (
        body
        and title_s
        and not _is_sec_edgar_archives_url(resolved_url or url_s)
        and not _body_matches_headline(title_s, body)
    ):
        # Wrong-story press fallback (same ticker, different article).
        err = "headline_body_mismatch"
        body = f"{title_s}\n{summary_s}".strip()
    if not body:
        body = f"{title_s}\n{summary_s}".strip()
    # BioSpace / aggregator chrome must never remain as the card title.
    if _looks_like_nav_chrome(title_s):
        recovered = _recover_article_headline(
            body, url=url_for_brief or url_s, title_hint=summary_s
        )
        if recovered:
            title_s = recovered
    is_edgar_brief = _is_sec_edgar_archives_url(url_for_brief or url_s)
    # EDGAR 8-K: structural Item brief — never PAGE CHECK / M&A Q&A.
    if is_edgar_brief and body and len(body) > 80:
        brief = _build_sec_8k_structured_brief(
            text=body,
            ticker=ticker_s,
            title_hint=title_s,
            url=url_for_brief or url_s,
            filing_date=_rome_date(),
        )
        dates = list(brief.get("dates") or [])
        for d in _extract_dates_from_article_text(
            str(brief.get("detail_summary") or ""),
            title=str(brief.get("title") or ""),
        ):
            if len(dates) >= 6:
                break
            if not any(
                str(x.get("date") or "").lower() == d["date"].lower()
                for x in dates
                if isinstance(x, dict)
            ):
                dates.append(d)
        brief["dates"] = _filter_event_only_dates(dates)
        if not brief.get("investor_insight"):
            try:
                insight = _ai_investor_insight(
                    title=str(brief.get("title") or title_s or ""),
                    body=body,
                    ticker=ticker_s,
                    news_kind=str(brief.get("news_kind") or "financial"),
                    detail_summary=str(brief.get("detail_summary") or ""),
                )
                if insight:
                    brief["investor_insight"] = insight
            except Exception:
                pass
        payload_brief = {
            **brief,
            "fetch_error": err,
            "article_fp": fp,
        }
        doc = _read()
        if iid:
            for key in ("items", _TOP_NEWS_CACHE_KEY, _USER_ANALYSES_KEY):
                rows = doc.get(key)
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    if str(row.get("id") or "") != iid:
                        continue
                    row["article_fp"] = fp
                    if url_for_brief and url_for_brief != url_s and not _news_url_is_junk(
                        url_for_brief, title_s
                    ):
                        row["resolved_link"] = url_for_brief
                    for k in (
                        "clinical_score",
                        "financial_score",
                        "corporate_score",
                        "market_access_score",
                        "eis_score",
                        "eis",
                        "market_access_notes",
                        "taxonomy_dimensions",
                        "taxonomy_review_flags",
                        "taxonomy_method",
                        "taxonomy_version",
                        "taxonomy_audit",
                        "taxonomy_classification",
                        "items_detected",
                        "item_summaries",
                        "section_summaries",
                        "cover_metadata",
                        "detail_summary",
                        "summary_long",
                        "news_kind",
                        "digest_method",
                        "skip_page_check",
                        "title",
                        "product",
                        "study",
                        "phase",
                        "investor_insight",
                        "abstract",
                        "is_paper",
                    ):
                        if brief.get(k) is not None:
                            row[k] = brief.get(k)
                    narr = str(brief.get("detail_summary") or "")
                    if narr:
                        row["summary"] = narr[:500]
                        row["summary_long"] = narr[:3500]
                        row["detail_summary"] = narr[:3500]
                    row["digest_answers"] = []
                    row["has_bullet_summary"] = False
                    break
        try:
            if fp:
                _brief_cache_put(doc, fp, payload_brief, item_id=iid)
            _write(doc)
        except Exception as exc:
            logger.debug("brief cache write failed: %s", exc)
        out = load_daily_news()
        out["ok"] = True
        out["brief"] = payload_brief
        return out

    # News / PR pages: strip chrome first, then decide paper vs news.
    is_journal_url = _is_academic_journal_url(url_for_brief or url_s)
    if use_stored_pdf:
        body = _clean_paper_text(body)
    elif is_journal_url or (
        _looks_like_academic_paper(body)
        and not re.search(
            r"(?i)stocktitan|globenewswire|prnewswire|businesswire",
            f"{url_for_brief}\n{url_s}\n{body[:400]}",
        )
    ):
        body = _clean_paper_text(body)
    else:
        raw_pre_chrome = _clean_fetched_text(body)
        body = _strip_article_chrome(
            _strip_heuristic_noise(_clean_fetched_text(body))
        )

    # Thin Manual TEXT — only enrich if we still have budget (skip DDG on brief path)
    if (
        _remaining() > 18
        and not use_stored_pdf
        and not _looks_like_academic_paper(body)
        and not _is_academic_journal_url(url_for_brief or url_s)
        and _news_body_needs_enrichment(body, title=title_s)
        and ticker_s
        and not _is_litigation_news(title_s)
        and not _looks_like_analysis_headline(title_s)
    ):
        try:
            t2, e2 = _fetch_press_body_fallbacks(ticker_s, title_s or body[:120])
            if t2 and len(t2) > len(body):
                body = t2
                err = None
            elif e2 and not err:
                err = e2
        except Exception as exc:
            logger.debug("brief press-fallback enrich skipped: %s", exc)
    if len(body) < 40:
        src = url_for_brief or url_s
        return {
            "ok": False,
            "error": err or "content_too_short",
            "source_url": "" if _is_google_news_shell_url(src) else src,
        }

    if pubmed_seed and (
        len(body) < 280
        or not _looks_like_academic_paper(body)
        or "Abstract not available" in body
        or "cookies must be enabled" in body.lower()
    ):
        body = (
            f"{pubmed_seed.get('title') or title_s}\n\n"
            f"{pubmed_seed.get('abstract') or ''}"
        ).strip()
        err = None

    is_paper_body = (
        use_stored_pdf or _looks_like_academic_paper(body) or bool(pubmed_seed)
    )
    ma_enrich = ""
    allow_ai = _remaining() > 22 and len(_clean_fetched_text(body)) >= 280
    if (
        allow_ai
        and not is_paper_body
        and not is_edgar_brief
        and _detect_news_kind(f"{title_s}\n{body}", title=title_s) == "ma"
        and not _is_speculative_ma_article(title=title_s, body=body)
        and _remaining() > 25
    ):
        try:
            ma_enrich = _enrich_ma_announcement_body(
                title=title_s, ticker=ticker_s, body=body
            )
        except Exception:
            ma_enrich = ""
        if ma_enrich and len(ma_enrich) > 200:
            body = (
                f"{body}\n\n--- PRIOR ACQUISITION ANNOUNCEMENT (economics/context) ---\n"
                f"{ma_enrich}"
            )[:_ANALYZE_TEXT_MAX]
        if raw_pre_chrome and len(raw_pre_chrome) > len(body):
            ma_enrich = f"{ma_enrich}\n{raw_pre_chrome}".strip()

    # Re-evaluate AI budget after network. Failed fetches (403) still get Gemini
    # on title + snippet; do not require 20s leftover after the title search.
    allow_ai = _remaining() > 8 and len(_clean_fetched_text(body)) >= (
        80 if err else 280
    )
    brief = _build_investor_digest(
        title=title_s or "News",
        body=body,
        url=url_for_brief,
        ticker=ticker_s,
        enrich_text=ma_enrich,
        is_paper=is_paper_body,
        abstract=(pubmed_seed or {}).get("abstract"),
        section_summaries=(pubmed_seed or {}).get("section_summaries"),
        allow_ai=allow_ai,
    )
    if pubmed_seed:
        brief["abstract"] = str(pubmed_seed.get("abstract") or "")[:3500]
        if pubmed_seed.get("section_summaries"):
            brief["section_summaries"] = pubmed_seed["section_summaries"]
        brief["is_paper"] = True
        pub_iso = str(pubmed_seed.get("pub_date") or "").strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}$", pub_iso):
            brief["pub_date"] = pub_iso
            dates0 = (
                list(brief.get("dates") or [])
                if isinstance(brief.get("dates"), list)
                else []
            )
            if not any(
                str(x.get("date") or "")[:10] == pub_iso
                for x in dates0
                if isinstance(x, dict)
            ):
                dates0.insert(
                    0,
                    {
                        "date": pub_iso,
                        "what_happens": "Publication abstract on PubMed",
                    },
                )
                brief["dates"] = dates0
        if pubmed_seed.get("title") and (
            not brief.get("headline") or _looks_like_nav_chrome(str(brief.get("headline") or ""))
        ):
            brief["headline"] = pubmed_seed["title"][:240]
    if is_paper_body:
        ai_kr = brief.get("key_results") if isinstance(brief.get("key_results"), list) else []
        if not ai_kr:
            rx_kr = _extract_key_results_from_text(body)
            if rx_kr:
                brief["key_results"] = rx_kr
                if not brief.get("key_points") or all(
                    len(str(k)) < 40 for k in (brief.get("key_points") or [])
                ):
                    brief["key_points"] = [
                        f"{kr['label']}: {kr['detail']}"[:220] for kr in rx_kr
                    ][:6]
        if not brief.get("indication"):
            brief["indication"] = _extract_indication(body)

    # Academic PDF / journal article — skip heavy AI section enrich when low budget
    paper = _extract_paper_structure(body) if is_paper_body else None
    if paper and _remaining() > 12:
        abstract_full = str(paper.get("abstract") or "").strip()
        sections = list(paper.get("section_summaries") or [])
        ai_sections = None
        if allow_ai and _remaining() > 22:
            ai_sections = _ai_enrich_paper_sections(
                abstract=abstract_full,
                sections=sections,
                full_text=body,
                sections_raw=paper.get("sections_raw")
                if isinstance(paper.get("sections_raw"), dict)
                else None,
            )
        if ai_sections:
            by_h = {str(s.get("heading")): s for s in sections if s.get("heading")}
            for s in ai_sections:
                by_h[str(s.get("heading"))] = s
            sections = [
                by_h[h]
                for h in _PAPER_SECTION_ORDER
                if h in by_h and by_h[h].get("summary")
            ]
        else:
            sections = [
                s
                for s in sections
                if s.get("heading") in set(_PAPER_SECTION_ORDER)
                and s.get("summary")
            ]
        sections = _sanitize_paper_section_cards(sections)
        if abstract_full or sections:
            brief = _apply_paper_brief_overrides(
                brief,
                paper=paper,
                body=body,
                title=title_s,
            )
        if sections:
            brief["section_summaries"] = sections
            brief["is_paper"] = True
        pt = str(paper.get("paper_title") or "").strip()
        if pt and re.search(
            r"(?i)journal of the|original research|jaha",
            title_s or "",
        ):
            title_s = pt

    # Stored Manual PDF: reuse persisted scores/abstract only when fresh extract failed
    if stored_row and use_stored_pdf:
        if not brief.get("abstract") and stored_row.get("abstract"):
            brief["abstract"] = str(stored_row.get("abstract"))[:3500]
        if not brief.get("section_summaries") and isinstance(
            stored_row.get("section_summaries"), list
        ):
            brief["section_summaries"] = _sanitize_paper_section_cards(
                list(stored_row.get("section_summaries") or [])
            )
        if stored_row.get("is_paper"):
            brief["is_paper"] = True
        for k in ("clinical_score", "financial_score", "eis_score", "product", "phase"):
            if stored_row.get(k) is not None and brief.get(k) is None:
                brief[k] = stored_row.get(k)
    elif iid and (not brief.get("abstract") or not brief.get("section_summaries")):
        doc = _read()
        for row in doc.get(_USER_ANALYSES_KEY) or []:
            if not isinstance(row, dict):
                continue
            if str(row.get("id") or "") != iid:
                continue
            if not brief.get("abstract") and row.get("abstract"):
                brief["abstract"] = str(row.get("abstract"))[:3500]
            if not brief.get("section_summaries") and isinstance(
                row.get("section_summaries"), list
            ):
                brief["section_summaries"] = row.get("section_summaries")
            if row.get("is_paper"):
                brief["is_paper"] = True
            break

    # Always merge dates from title + summary + body
    merged_dates = list(brief.get("dates") or []) if isinstance(brief.get("dates"), list) else []
    for d in _extract_dates_from_article_text(
        f"{title_s}\n{summary_s}\n{body}", title=title_s
    ):
        if len(merged_dates) >= 6:
            break
        if not any(
            str(x.get("date") or "").lower() == d["date"].lower() for x in merged_dates
        ):
            merged_dates.append(d)
    brief["dates"] = _filter_event_only_dates(merged_dates)
    # Keep PubMed publication day even if the generic event-date filter dropped it.
    pub_iso = str(brief.get("pub_date") or "").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", pub_iso):
        dates_keep = list(brief.get("dates") or [])
        if not any(str(x.get("date") or "")[:10] == pub_iso for x in dates_keep if isinstance(x, dict)):
            dates_keep.insert(
                0, {"date": pub_iso, "what_happens": "Publication abstract on PubMed"}
            )
            brief["dates"] = dates_keep[:6]

    dates = brief.get("dates") if isinstance(brief.get("dates"), list) else []
    payload_title = _clean_fetched_text(
        str(brief.get("headline") or "").strip()
        or title_s
        or (brief.get("detail_summary") or "")[:120]
    )
    if _looks_like_nav_chrome(payload_title):
        payload_title = (
            _recover_article_headline(
                body, url=url_for_brief or url_s, title_hint=title_s
            )
            or title_s
            or payload_title
        )
    payload_brief = {
        **brief,
        "title": payload_title,
        "ticker": brief.get("ticker") or ticker_s or None,
        "source_url": (
            ""
            if _is_google_news_shell_url(
                url_for_brief or url_s or brief.get("source_url") or ""
            )
            else (url_for_brief or url_s or brief.get("source_url") or "")
        ),
        "fetch_error": err,
        "article_fp": fp,
        "brief_schema": _BRIEF_SCHEMA,
    }
    if (
        payload_brief.get("digest_method") == "shareholder_alert"
        and payload_brief.get("detail_summary")
        and err
        and re.search(
            r"(?i)NameResolution|junk_publisher_host|Failed to resolve|Max retries",
            str(err),
        )
    ):
        payload_brief["fetch_error"] = None
    # Prefer deterministic 8-K taxonomy scores when EDGAR body was classified.
    if isinstance(brief_taxonomy, dict):
        for k in (
            "clinical_score",
            "financial_score",
            "corporate_score",
            "market_access_score",
            "eis_score",
            "eis",
            "market_access_notes",
            "taxonomy_dimensions",
            "taxonomy_review_flags",
            "taxonomy_method",
            "taxonomy_version",
            "taxonomy_audit",
        ):
            if brief_taxonomy.get(k) is not None:
                payload_brief[k] = brief_taxonomy.get(k)
        if brief_taxonomy.get("narrative_summary"):
            payload_brief["detail_summary"] = str(brief_taxonomy["narrative_summary"])[:1200]
            payload_brief["summary_long"] = str(brief_taxonomy["narrative_summary"])[:800]
        if brief_taxonomy.get("title"):
            payload_brief["title"] = str(brief_taxonomy["title"])[:240]
        if brief_taxonomy.get("items_detected"):
            payload_brief["items_detected"] = brief_taxonomy.get("items_detected")
        # news_kind hint for UI chips
        dims = brief_taxonomy.get("taxonomy_dimensions") or {}
        if isinstance(dims, dict):
            if (dims.get("financial") or {}).get("event_id"):
                payload_brief["news_kind"] = "financial"
            elif (dims.get("clinical") or {}).get("event_id"):
                payload_brief["news_kind"] = "clinical"
    else:
        # Press / RSS: thermometer follows key information in Results / body.
        # Always re-score so incidental FDA wording cannot outrank earnings facts.
        try:
            kr_bits: list[str] = []
            for kr in brief.get("key_results") or []:
                if isinstance(kr, dict):
                    kr_bits.append(
                        f"{kr.get('label') or ''} {kr.get('detail') or kr.get('value') or ''}"
                    )
                else:
                    kr_bits.append(str(kr))
            kp_bits = [str(p) for p in (brief.get("key_points") or [])[:10]]
            para_bits: list[str] = []
            for s in brief.get("section_summaries") or []:
                if isinstance(s, dict):
                    para_bits.append(
                        f"{s.get('heading') or ''} {s.get('summary') or ''}"
                    )
            key_blob = "\n".join(
                [
                    " ".join(kr_bits),
                    " ".join(kp_bits),
                    " ".join(para_bits),
                    str(brief.get("detail_summary") or ""),
                    str(brief.get("summary_long") or ""),
                    summary_s,
                    body[:2500],
                ]
            ).strip()
            use_ai_score = _remaining() > 16 and len(body) >= 280
            dims = _dimension_scores(
                payload_title or title_s,
                key_blob or f"{summary_s}\n{body[:2500]}",
                use_ai=use_ai_score,
            )
            for k, v in dims.items():
                if v is not None:
                    payload_brief[k] = v
            tdims = dims.get("taxonomy_dimensions") or {}
            if isinstance(tdims, dict) and payload_brief.get("news_kind") != "litigation":
                if (tdims.get("financial") or {}).get("event_id"):
                    payload_brief["news_kind"] = "financial"
                elif (tdims.get("clinical") or {}).get("event_id"):
                    payload_brief["news_kind"] = "clinical"
                else:
                    try:
                        from eis_taxonomy_scoring import _is_stock_tape_market_wrap

                        if _is_stock_tape_market_wrap(
                            f"{payload_title or title_s}\n{key_blob}"
                        ):
                            payload_brief["news_kind"] = "financial"
                    except Exception:
                        pass
        except Exception as exc:
            logger.debug("brief taxonomy from key info failed: %s", exc)

    # Partnership / M&A: always explain Fin terms (paid / for what / objectives / milestones).
    if not isinstance(payload_brief.get("deal_terms"), dict):
        try:
            dt = _extract_deal_financial_terms(
                title=payload_title or title_s,
                body="\n".join(
                    [
                        str(payload_brief.get("detail_summary") or ""),
                        " ".join(
                            f"{kr.get('label') or ''} {kr.get('detail') or ''}"
                            for kr in (payload_brief.get("key_results") or [])
                            if isinstance(kr, dict)
                        ),
                        body[:8000],
                    ]
                ),
            )
            if dt:
                payload_brief["deal_terms"] = dt
        except Exception:
            logger.debug("deal_terms extract failed", exc_info=True)
    if isinstance(payload_brief.get("deal_terms"), dict):
        try:
            seeded = _seed_financial_deal_evidence(
                payload_brief.get("taxonomy_dimensions")
                if isinstance(payload_brief.get("taxonomy_dimensions"), dict)
                else {},
                payload_brief.get("deal_terms"),
            )
            if seeded:
                payload_brief["taxonomy_dimensions"] = seeded
                fin = seeded.get("financial") or {}
                try:
                    fs = float(fin.get("score"))
                    if abs(fs) >= 0.01:
                        payload_brief["financial_score"] = round(fs, 2)
                except (TypeError, ValueError):
                    pass
        except Exception:
            logger.debug("deal_terms Fin seed failed", exc_info=True)

    # Persist brief + mark seen (so the same article is not re-staged tomorrow)
    doc = _read()
    desigs = _extract_fda_designations(
        "\n".join(
            [
                title_s,
                summary_s,
                str(brief.get("detail_summary") or ""),
                str(brief.get("summary_long") or ""),
                " ".join(str(x) for x in (brief.get("key_points") or [])[:8]),
                body[:4000],
            ]
        )
    )
    product_s = str(brief.get("product") or "").strip() or None
    if product_s and product_s.upper() in _TITLE_PRODUCT_BLOCK:
        product_s = None
        brief["product"] = None
        payload_brief["product"] = None
    if _is_shareholder_alert(title_s, str(brief.get("detail_summary") or "")):
        product_s = None
        brief["product"] = None
        payload_brief["product"] = None
    if not product_s and not _is_shareholder_alert(title_s):
        facts_pd = _extract_clinical_facts(
            f"{title_s}\n{summary_s}\n{brief.get('detail_summary') or ''}\n{body[:3000]}"
        )
        product_s = facts_pd.get("product")
    if product_s and not brief.get("product"):
        brief["product"] = product_s
        payload_brief["product"] = product_s
    if desigs:
        brief["fda_designations"] = desigs
        payload_brief["fda_designations"] = desigs
    if iid:
        for key in ("items", _TOP_NEWS_CACHE_KEY, _USER_ANALYSES_KEY):
            rows = doc.get(key)
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                if str(row.get("id") or "") != iid:
                    continue
                if dates:
                    row["catalyst_dates"] = dates
                row["article_fp"] = fp
                if url_for_brief and url_for_brief != url_s and not _news_url_is_junk(
                    url_for_brief, title_s
                ):
                    row["resolved_link"] = url_for_brief
                if product_s and not row.get("product"):
                    row["product"] = product_s
                if desigs:
                    prev = row.get("fda_designations")
                    merged = list(prev) if isinstance(prev, list) else []
                    for d in desigs:
                        if d not in merged:
                            merged.append(d)
                    row["fda_designations"] = merged
                # Always push brief scores onto the list row (press + 8-K).
                # Previously only brief_taxonomy (8-K) was copied — press chips
                # stayed empty/stale while the modal showed fresh scores.
                for k in (
                    "clinical_score",
                    "financial_score",
                    "corporate_score",
                    "market_access_score",
                    "eis_score",
                    "eis",
                    "market_access_notes",
                    "taxonomy_dimensions",
                    "taxonomy_review_flags",
                    "taxonomy_method",
                    "taxonomy_version",
                    "taxonomy_audit",
                    "heuristic_rev",
                    "news_kind",
                    "investor_insight",
                    "section_summaries",
                    "detail_summary",
                    "abstract",
                    "is_paper",
                ):
                    if payload_brief.get(k) is not None:
                        row[k] = payload_brief.get(k)
                if isinstance(brief_taxonomy, dict):
                    if brief_taxonomy.get("title") and (
                        not row.get("title")
                        or str(row.get("title") or "").strip().lower().startswith("item ")
                    ):
                        row["title"] = str(brief_taxonomy["title"])[:240]
                    if brief_taxonomy.get("narrative_summary"):
                        row["summary"] = str(brief_taxonomy["narrative_summary"])[:500]
                ds = str(brief.get("detail_summary") or "").strip()
                if ds and len(ds) > len(str(row.get("summary") or "")):
                    # Enrich staged summary so Top KPI can mine designations without reopening brief
                    if not row.get("summary") or len(str(row.get("summary") or "")) < 80:
                        row["summary"] = ds[:500]
                break
    # Do not persist title-only / rate-limited stubs — reopen can retry the publisher.
    thin_stub = _body_is_title_echo(title_s, body) or (
        err and re.search(r"(?i)429|403|401|blocked|captcha|timeout", str(err))
    )
    if not thin_stub:
        _brief_cache_put(doc, fp, payload_brief, item_id=iid)
    else:
        _brief_cache_delete(doc, fp)
    _mark_article_seen(
        doc,
        fp,
        status="staged",
        ticker=ticker_s,
        title=title_s,
        url=url_for_brief or url_s,
        item_id=iid,
    )
    doc["updated_at"] = _now_iso()
    try:
        _write(doc)
    except Exception as exc:
        logger.debug("brief cache write failed: %s", exc)

    return {
        "ok": True,
        "brief": payload_brief,
        "cached": False,
        "article_fp": fp,
        "elapsed_ms": int((time.monotonic() - t0) * 1000),
    }


__all__ = [
    "load_daily_news",
    "run_daily_news_search",
    "build_top_news",
    "migrate_expired_hourly_news",
    "migrate_daily_news_to_eis",
    "cache_staged_daily_news_to_clinical",
    "dismiss_daily_news_item",
    "due_for_daily_news_morning",
    "analyze_user_source",
    "brief_daily_news_item",
    "prefetch_daily_news_briefs",
]
