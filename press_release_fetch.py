"""
Live press / news headlines for clinical enrichment (pre-CD window).

Uses Google News RSS (no API key). Optional IR page scrape when
``COMPANY_IR_BASE_URL`` is set or passed.

Cache: data/cache/press_releases/{ticker}.json
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_DATA = Path(__file__).resolve().parent / "data" / "cache" / "press_releases"
_CACHE_TTL_H = int(os.environ.get("PRESS_RELEASE_CACHE_HOURS", "12"))

_CLINICAL_KW = re.compile(
    r"\b("
    r"clinical|trial|phase\s*[123iv]+|fda|ema|"
    r"orr|pfs|os\b|endpoint|readout|data|"
    r"asco|esmo|ash|aacr|approval|"
    r"biotech|drug|therapy|patient|"
    r"studio|clinico|farmaco|approvazione"
    r")\b",
    re.I,
)


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    s = str(s).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _cache_path(ticker: str, window_key: str) -> Path:
    h = hashlib.sha1(window_key.encode()).hexdigest()[:10]
    return _DATA / f"{ticker.upper()}_{h}.json"


def _load_cache(path: Path) -> list[dict] | None:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        ts = doc.get("fetched_at")
        if not ts:
            return None
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0
        if age_h > _CACHE_TTL_H:
            return None
        return list(doc.get("items") or [])
    except Exception:
        return None


def _save_cache(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"fetched_at": datetime.now(timezone.utc).isoformat(), "items": items},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _is_google_news_url(url: str) -> bool:
    u = (url or "").lower()
    return bool(
        "news.google.com" in u
        or "consent.google.com" in u
        or "batchexecute" in u
        or "/_/dotssplashui/" in u
    )


def _non_google_http_url(url: str) -> str:
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return ""
    if _is_google_news_url(u):
        return ""
    return u


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


def _rss_items(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    out: list[dict] = []
    for item in root.iter("item"):
        title = ""
        link = ""
        pub = ""
        desc = ""
        source_url = ""
        for child in item:
            tag = child.tag.split("}")[-1]
            if tag == "title":
                title = "".join(child.itertext()).strip()
            elif tag == "link":
                link = "".join(child.itertext()).strip()
            elif tag == "pubDate":
                pub = "".join(child.itertext()).strip()
            elif tag == "description":
                desc = re.sub(r"<[^>]+>", " ", "".join(child.itertext()))
                desc = re.sub(r"\s+", " ", desc).strip()
                raw_desc = "".join(child.itertext())
                if not source_url:
                    for href in re.findall(r'https?://[^\s<>"\']+', raw_desc):
                        got = _non_google_http_url(href.rstrip(").,;"))
                        if got:
                            source_url = got
                            break
            elif tag == "source":
                source_url = source_url or (child.attrib.get("url") or "").strip()
        if not title:
            continue
        event_d: str | None = None
        published_at: str | None = None
        if pub:
            try:
                from email.utils import parsedate_to_datetime

                dt = parsedate_to_datetime(pub)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                event_d = dt.date().isoformat()
                published_at = dt.isoformat()
            except Exception:
                event_d = None
        publisher = _non_google_http_url(source_url)
        gnews = link if _is_google_news_url(link) else ""
        article = publisher if _looks_like_article_url(publisher) else ""
        if not article:
            direct = _non_google_http_url(link)
            article = direct if _looks_like_article_url(direct) else ""
        out.append(
            {
                "title": title[:240],
                "link": (article or gnews or link)[:500],
                "gnews_link": gnews[:500] if gnews else "",
                "source_url": article[:500] if article else "",
                "summary": (desc or title)[:600],
                "event_date": event_d,
                "published_at": published_at,
                "source": "google_news_rss",
            }
        )
    return out


_rss_circuit_until = 0.0
_RSS_CIRCUIT_S = 5 * 60


def _fetch_google_news_rss(query: str, *, max_items: int = 10) -> list[dict]:
    global _rss_circuit_until
    if _env_truthy("PRESS_RELEASE_DISABLE_NETWORK"):
        return []
    if time.time() < _rss_circuit_until:
        return []
    q = urllib.parse.quote(query)
    url = (
        "https://news.google.com/rss/search?"
        f"q={q}&hl=en-US&gl=US&ceid=US:en"
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "BiotechOrchestrator/1.0 (clinical feed)"},
    )
    try:
        # 4s cap: a desk full of tickers must not hold an API thread past
        # Cloudflare's ~100s origin timeout when Google News returns 503.
        raw = urllib.request.urlopen(req, timeout=4).read()
        time.sleep(0.2)
        return _rss_items(raw)[:max_items]
    except Exception as exc:
        msg = str(exc).lower()
        if any(s in msg for s in ("429", "503", "timed out", "timeout")):
            _rss_circuit_until = time.time() + _RSS_CIRCUIT_S
        print(f"[PressRelease] Google News RSS failed: {exc}", flush=True)
        return []


def _clinical_filter(items: list[dict], *, ticker: str, company: str) -> list[dict]:
    tk = ticker.upper()
    comp_l = (company or "").lower()
    out: list[dict] = []
    for it in items:
        blob = f"{it.get('title','')} {it.get('summary','')}".lower()
        if tk.lower() not in blob and comp_l[:12] not in blob:
            continue
        if not _CLINICAL_KW.search(blob):
            continue
        out.append(it)
    return out


def fetch_press_releases_for_window(
    ticker: str,
    company: str,
    *,
    window_start: str,
    window_end: str,
    max_items: int = 8,
    use_cache: bool = True,
) -> list[dict]:
    """
    Headlines in [window_start, window_end] suitable for clinical timeline.
    Returns dicts ready for conversion to clinical_events.
    """
    ticker = str(ticker or "").strip().upper()
    company = str(company or ticker).strip()
    ws = _parse_date(window_start)
    we = _parse_date(window_end)
    if not ticker:
        return []

    window_key = f"{window_start}|{window_end}|{max_items}"
    cache_p = _cache_path(ticker, window_key)
    if use_cache:
        cached = _load_cache(cache_p)
        if cached is not None:
            return cached

    query = f'"{ticker}" OR "{company}" biotech clinical trial'
    raw_items = _fetch_google_news_rss(query, max_items=max_items * 2)
    items = _clinical_filter(raw_items, ticker=ticker, company=company)

    filtered: list[dict] = []
    for it in items:
        ed = _parse_date(it.get("event_date"))
        if ws and we and ed and not (ws <= ed <= we):
            continue
        filtered.append(it)
        if len(filtered) >= max_items:
            break

    if use_cache and filtered:
        _save_cache(cache_p, filtered)
    return filtered


def press_releases_to_clinical_events(
    items: list[dict],
    *,
    drug: str | None = None,
) -> list[dict]:
    """Map fetch_press_releases output → clinical_pre_cd event rows."""
    out: list[dict] = []
    seen: set[str] = set()
    for it in items:
        title = str(it.get("title") or "").strip()[:120]
        if not title:
            continue
        iso = str(it.get("event_date") or "")[:10]
        key = f"{iso}|{title[:40]}"
        if key in seen:
            continue
        seen.add(key)
        link = str(it.get("link") or "").strip()
        out.append(
            {
                "event_date": iso or None,
                "event_title": title,
                "summary": str(it.get("summary") or "")[:500],
                "drug": drug or "—",
                "asset": drug or "—",
                "source_type": "press_release",
                "event_type": "press_release",
                "link": link,
                "link_label": "Press",
                "sentiment": 0,
                "impact_note": "Live news RSS",
                "_from_press_fetch": True,
            }
        )
    return out
