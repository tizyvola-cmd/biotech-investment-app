"""
Post–Catalyst Day outcome feed
==============================
Within 7 days after a Catalyst Day, look for press / 8-K / web coverage that
reports the expected event's result. Stage hits into Daily News as
``source_kind=catalyst_outcome`` (scored with the usual EIS taxonomy). After
Migrate → Deep Dive, mark the CD resolved so it leaves the Catalyst Days list.
Unresolved CDs still drop from the list after 7 days; Gantt / clinical history
is never deleted here.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from orchestrator_io_paths import DATA_DIR

logger = logging.getLogger(__name__)

_ROME = ZoneInfo("Europe/Rome")
_RESOLVED_PATH = Path(DATA_DIR) / "cache" / "catalyst_outcome_resolved.json"
_LOCK = threading.Lock()

# Keep completed CDs on the Catalyst Days desk this many days after event_date.
POST_CD_RETENTION_DAYS = 7

_OUTCOME_TITLE_RE = re.compile(
    r"(?i)\b("
    r"topline|top[- ]line|primary\s+endpoint|met\s+the\s+primary|"
    r"did\s+not\s+meet|failed\s+to\s+meet|phase\s*[123]\s+results?|"
    r"pdufa|fda\s+(?:approv|reject|crl|complete\s+response)|"
    r"adcom|advisory\s+committee|readout|data\s+readout|"
    r"positive\s+results?|negative\s+results?|interim\s+analysis"
    r")\b"
)


def _rome_today(now: datetime | None = None) -> date:
    if now is None:
        return datetime.now(_ROME).date()
    if now.tzinfo is None:
        return now.replace(tzinfo=_ROME).date()
    return now.astimezone(_ROME).date()


def catalyst_event_key(
    ticker: str,
    event_date: str,
    *,
    event_type: str = "",
    product: str = "",
) -> str:
    tk = (ticker or "").strip().upper()
    iso = str(event_date or "")[:10]
    et = re.sub(r"\s+", "_", (event_type or "").strip().lower())[:40]
    prod = re.sub(r"\s+", "_", (product or "").strip().lower())[:40]
    return f"{tk}|{iso}|{et}|{prod}".rstrip("|")


def _load_resolved() -> dict[str, Any]:
    if not _RESOLVED_PATH.is_file():
        return {"entries": {}}
    try:
        raw = json.loads(_RESOLVED_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("entries"), dict):
            return raw
    except Exception:
        pass
    return {"entries": {}}


def _save_resolved(doc: dict[str, Any]) -> None:
    _RESOLVED_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RESOLVED_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def is_catalyst_outcome_resolved(key: str) -> bool:
    k = (key or "").strip()
    if not k:
        return False
    with _LOCK:
        return k in (_load_resolved().get("entries") or {})


def mark_catalyst_outcome_resolved(
    key: str,
    *,
    ticker: str = "",
    event_date: str = "",
    news_id: str = "",
    source_url: str = "",
) -> None:
    k = (key or "").strip()
    if not k:
        return
    with _LOCK:
        doc = _load_resolved()
        entries = doc.setdefault("entries", {})
        entries[k] = {
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "ticker": (ticker or "").strip().upper() or None,
            "event_date": str(event_date or "")[:10] or None,
            "news_id": news_id or None,
            "source_url": source_url or None,
        }
        # Cap trail
        if len(entries) > 4000:
            for drop in sorted(entries.keys())[: max(0, len(entries) - 4000)]:
                entries.pop(drop, None)
        _save_resolved(doc)


def desk_keeps_past_catalyst(
    days_until: int | float | None,
    *,
    event_key: str = "",
    retention_days: int = POST_CD_RETENTION_DAYS,
) -> bool:
    """True when a completed CD still belongs on the Catalyst Days list."""
    if days_until is None or not isinstance(days_until, (int, float)):
        return False
    if event_key and is_catalyst_outcome_resolved(event_key):
        return False
    # Future / today always OK for the forward horizon (caller still applies +horizon).
    if days_until >= 0:
        return True
    return days_until >= -int(retention_days)


def in_post_cd_window(
    days_until: int | float | None,
    *,
    retention_days: int = POST_CD_RETENTION_DAYS,
) -> bool:
    """True for completed CDs still inside the outcome-search week."""
    if days_until is None or not isinstance(days_until, (int, float)):
        return False
    return -int(retention_days) <= days_until < 0 or days_until == 0


def _parse_iso(raw: Any) -> date | None:
    s = str(raw or "")[:10]
    if len(s) < 10:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def list_recent_catalyst_events(
    *,
    today: date | None = None,
    retention_days: int = POST_CD_RETENTION_DAYS,
) -> list[dict[str, Any]]:
    """
    Catalyst events with event_date in [today-retention, today].
    Sources: morning desk cache + guidance snapshot.
    """
    ref = today or _rome_today()
    start = ref - timedelta(days=retention_days)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _push(
        ticker: str,
        event_date: str,
        *,
        event_type: str = "",
        event_name: str = "",
        product: str = "",
        source: str = "",
    ) -> None:
        tk = (ticker or "").strip().upper()
        iso = str(event_date or "")[:10]
        d = _parse_iso(iso)
        if not tk or d is None or d < start or d > ref:
            return
        key = catalyst_event_key(tk, iso, event_type=event_type, product=product)
        if key in seen or is_catalyst_outcome_resolved(key):
            return
        seen.add(key)
        out.append(
            {
                "key": key,
                "ticker": tk,
                "event_date": iso,
                "days_until": (d - ref).days,
                "event_type": event_type or "cd",
                "event_name": event_name or event_type or "Catalyst Day",
                "product": product or None,
                "source": source,
            }
        )

    try:
        from catalyst_desk_cache import load_morning_cache

        morn = load_morning_cache()
        for ev in morn.get("events") or []:
            if not isinstance(ev, dict):
                continue
            _push(
                str(ev.get("ticker") or ""),
                str(ev.get("event_date") or ""),
                event_type=str(ev.get("event_type") or ""),
                event_name=str(ev.get("event_name") or ""),
                product="",
                source="morning_desk",
            )
    except Exception as exc:
        logger.debug("outcome feed morning cache: %s", exc)

    try:
        from guidance_calendar import load_snapshot

        snap = load_snapshot()
        for ev in snap.get("events") or []:
            if not isinstance(ev, dict):
                continue
            iso = str(ev.get("window_end") or ev.get("window_start") or "")[:10]
            _push(
                str(ev.get("ticker") or ""),
                iso,
                event_type=str(ev.get("event_type") or "cd"),
                event_name=str(ev.get("asset_name") or ev.get("event_type") or ""),
                product=str(ev.get("asset_name") or ""),
                source="guidance",
            )
    except Exception as exc:
        logger.debug("outcome feed guidance: %s", exc)

    out.sort(key=lambda x: (x.get("event_date") or "", x.get("ticker") or ""))
    return out


def _looks_like_outcome_title(title: str, *, product: str = "") -> bool:
    t = title or ""
    if _OUTCOME_TITLE_RE.search(t):
        return True
    if product and product.lower() in t.lower() and re.search(
        r"(?i)\b(result|data|approv|reject|endpoint|pdufa)\b", t
    ):
        return True
    return False


def _score_outcome_text(
    *,
    ticker: str,
    title: str,
    body: str,
    event_date: str,
) -> dict[str, Any]:
    dims: dict[str, Any] = {}
    blob = f"{title}\n{body}"[:12000]
    try:
        from eis_taxonomy_scoring import score_article_dimensions

        dims = score_article_dimensions(blob, use_ai=False) or {}
    except Exception:
        try:
            from eis_taxonomy_scoring import classify_8k_filing

            dims = classify_8k_filing(
                ticker=ticker,
                filing_date=event_date,
                text=blob,
                event_date=event_date,
            ) or {}
        except Exception as exc:
            logger.debug("outcome score failed %s: %s", ticker, exc)
            dims = {}
    return dims if isinstance(dims, dict) else {}


def _candidate_from_press(
    ev: dict[str, Any],
) -> dict[str, Any] | None:
    tk = str(ev.get("ticker") or "").upper()
    iso = str(ev.get("event_date") or "")[:10]
    product = str(ev.get("product") or ev.get("event_name") or "").strip()
    try:
        from daily_news_desk import (
            _fetch_article_via_title_search,
            _fetch_press_body_fallbacks,
            _ten_word_summary,
            _now_iso,
        )
        import hashlib

        text, err = _fetch_article_via_title_search(
            f"{tk} {product} {ev.get('event_name') or ''} results topline"
        )
        if not text or len(text) < 200:
            text2, _e2 = _fetch_press_body_fallbacks(
                tk, f"{product} results {iso}".strip()
            )
            if text2 and len(text2) > len(text or ""):
                text, err = text2, None
        if not text or len(text) < 180:
            return None
        head = " ".join(text.split()[:18])
        if not _looks_like_outcome_title(head, product=product) and not _looks_like_outcome_title(
            text[:400], product=product
        ):
            if not _OUTCOME_TITLE_RE.search(text[:2500]):
                return None
        title = head[:220]
        scored = _score_outcome_text(
            ticker=tk, title=title, body=text[:8000], event_date=iso
        )
        nid = hashlib.sha1(
            f"catalyst_outcome|{ev.get('key')}|{title[:80]}".encode()
        ).hexdigest()[:16]
        return {
            "id": nid,
            "ticker": tk,
            "title": title,
            "summary": _ten_word_summary(title),
            "summary_10w": _ten_word_summary(title),
            "summary_long": text[:900],
            "detail_summary": text[:2200],
            "link": None,
            "source_kind": "catalyst_outcome",
            "source_label": "CATALYST OUTCOME",
            "news_kind": "clinical"
            if (scored.get("clinical_score") or 0)
            else (
                "financial"
                if (scored.get("financial_score") or 0)
                else "other"
            ),
            "status": "staged",
            "found_at": _now_iso(),
            "published_at": iso,
            "event_date": iso,
            "catalyst_event_key": ev.get("key"),
            "catalyst_event_date": iso,
            "catalyst_event_name": ev.get("event_name"),
            "product": product or None,
            "clinical_score": scored.get("clinical_score"),
            "financial_score": scored.get("financial_score"),
            "corporate_score": scored.get("corporate_score"),
            "market_access_score": scored.get("market_access_score"),
            "eis_score": scored.get("eis_score") or scored.get("eis"),
            "taxonomy_dimensions": scored.get("taxonomy_dimensions"),
            "taxonomy_method": scored.get("taxonomy_method"),
            "fetch_error": err,
        }
    except Exception as exc:
        logger.debug("outcome press candidate %s: %s", tk, exc)
        return None


def _candidate_from_8k(ev: dict[str, Any]) -> dict[str, Any] | None:
    tk = str(ev.get("ticker") or "").upper()
    iso = str(ev.get("event_date") or "")[:10]
    try:
        from daily_news_desk import (
            _cik10_for_ticker,
            _now_iso,
            _ten_word_summary,
            _build_sec_8k_structured_brief,
        )
        from catalyst_extractor import (
            _fetch_8k_bundle_text,
            _fetch_submissions,
            _filing_html_url,
            _recent_8k_filings,
        )
        import hashlib

        cik10 = _cik10_for_ticker(tk)
        if not cik10:
            return None
        subs = _fetch_submissions(cik10)
        if not subs:
            return None
        cutoff = (_parse_iso(iso) or _rome_today()) - timedelta(days=1)
        end = (_parse_iso(iso) or _rome_today()) + timedelta(days=POST_CD_RETENTION_DAYS)
        for fil in _recent_8k_filings(subs, max_n=8):
            fd = str(fil.get("filing_date") or "")[:10]
            d = _parse_iso(fd)
            if d is None or d < cutoff or d > end:
                continue
            accession = str(fil.get("accession") or "")
            primary = str(fil.get("primary_doc") or "")
            if not accession or not primary:
                continue
            url = _filing_html_url(cik10, accession, primary)
            text = _fetch_8k_bundle_text(cik10, accession, primary) or ""
            if len(text) < 120:
                continue
            if not (
                _OUTCOME_TITLE_RE.search(text[:4000])
                or _looks_like_outcome_title(primary, product="")
            ):
                if re.search(
                    r"(?i)\b(underwriting|offering|shelf|item\s+2\.02)\b", text[:2000]
                ) and not _OUTCOME_TITLE_RE.search(text[:4000]):
                    continue
            brief = _build_sec_8k_structured_brief(
                text=text,
                ticker=tk,
                title_hint=f"{tk} post-catalyst 8-K",
                url=url or "",
                filing_date=fd,
            )
            title = str(brief.get("title") or f"{tk} 8-K {fd}")[:220]
            narr = str(brief.get("detail_summary") or "")
            if not _OUTCOME_TITLE_RE.search(title + " " + narr[:500]):
                if "8.01" not in str(brief.get("items_detected") or []):
                    continue
            nid = hashlib.sha1(
                f"catalyst_outcome|8k|{ev.get('key')}|{fd}".encode()
            ).hexdigest()[:16]
            return {
                "id": nid,
                "ticker": tk,
                "title": title,
                "summary": _ten_word_summary(title),
                "summary_10w": _ten_word_summary(title),
                "summary_long": narr[:900],
                "detail_summary": narr[:2200],
                "link": url,
                "source_kind": "catalyst_outcome",
                "source_label": "CATALYST OUTCOME · 8-K",
                "news_kind": brief.get("news_kind") or "clinical",
                "status": "staged",
                "found_at": _now_iso(),
                "published_at": fd,
                "event_date": iso,
                "catalyst_event_key": ev.get("key"),
                "catalyst_event_date": iso,
                "catalyst_event_name": ev.get("event_name"),
                "product": ev.get("product"),
                "clinical_score": brief.get("clinical_score"),
                "financial_score": brief.get("financial_score"),
                "corporate_score": brief.get("corporate_score"),
                "market_access_score": brief.get("market_access_score"),
                "eis_score": brief.get("eis_score") or brief.get("eis"),
                "taxonomy_dimensions": brief.get("taxonomy_dimensions"),
                "item_summaries": brief.get("item_summaries"),
                "section_summaries": brief.get("section_summaries"),
                "digest_method": brief.get("digest_method"),
            }
    except Exception as exc:
        logger.debug("outcome 8-K candidate %s: %s", tk, exc)
        return None


def discover_catalyst_outcome_rows(
    *,
    today: date | None = None,
    max_events: int = 12,
) -> list[dict[str, Any]]:
    events = list_recent_catalyst_events(today=today)
    events.sort(key=lambda e: abs(int(e.get("days_until") or 0)))
    rows: list[dict[str, Any]] = []
    for ev in events[:max_events]:
        if is_catalyst_outcome_resolved(str(ev.get("key") or "")):
            continue
        hit = _candidate_from_8k(ev) or _candidate_from_press(ev)
        if hit:
            rows.append(hit)
    return rows


def stage_catalyst_outcomes_into_daily_news(
    *,
    force: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """
    Find post-CD outcome coverage and append into Daily News items / top_news.
    Display only until Migrate → EIS.
    """
    from daily_news_desk import (
        _read,
        _write,
        _article_fingerprint,
        _now_iso,
        load_daily_news,
        _mark_row_seen,
        _is_article_seen,
    )

    del force  # reserved for future force-rescan
    ref = _rome_today(now)
    rows = discover_catalyst_outcome_rows(today=ref)
    doc = _read()
    items = [i for i in (doc.get("items") or []) if isinstance(i, dict)]
    top = [i for i in (doc.get("top_news") or []) if isinstance(i, dict)]
    existing_ids = {str(i.get("id") or "") for i in items + top}
    existing_keys = {
        str(i.get("catalyst_event_key") or "")
        for i in items + top
        if i.get("catalyst_event_key")
    }
    added = 0
    for row in rows:
        rid = str(row.get("id") or "")
        ckey = str(row.get("catalyst_event_key") or "")
        if rid in existing_ids or (ckey and ckey in existing_keys):
            continue
        fp = _article_fingerprint(
            ticker=str(row.get("ticker") or ""),
            title=str(row.get("title") or ""),
            url=str(row.get("link") or ""),
            item_id=rid,
        )
        if _is_article_seen(doc, fp):
            continue
        row["article_fp"] = fp
        row["section"] = "top"
        items.insert(0, row)
        top.insert(0, row)
        _mark_row_seen(doc, row, status="staged")
        existing_ids.add(rid)
        if ckey:
            existing_keys.add(ckey)
        added += 1
    if added:
        doc["items"] = items[:200]
        doc["top_news"] = top[:40]
        doc["top_news_updated_at"] = _now_iso()
        doc["updated_at"] = _now_iso()
        _write(doc)
    out = load_daily_news()
    out["ok"] = True
    out["catalyst_outcomes_added"] = added
    out["catalyst_outcomes_scanned"] = len(rows)
    return out


def resolve_from_migrated_news_row(row: dict[str, Any]) -> bool:
    """Mark CD resolved when a catalyst_outcome row is migrated to Deep Dive."""
    if not isinstance(row, dict):
        return False
    if str(row.get("source_kind") or "") != "catalyst_outcome":
        return False
    key = str(row.get("catalyst_event_key") or "").strip()
    if not key:
        key = catalyst_event_key(
            str(row.get("ticker") or ""),
            str(row.get("catalyst_event_date") or row.get("event_date") or ""),
            product=str(row.get("product") or ""),
        )
    if not key or key.startswith("|"):
        return False
    mark_catalyst_outcome_resolved(
        key,
        ticker=str(row.get("ticker") or ""),
        event_date=str(row.get("catalyst_event_date") or row.get("event_date") or ""),
        news_id=str(row.get("id") or ""),
        source_url=str(row.get("link") or row.get("source_ref") or ""),
    )
    return True
