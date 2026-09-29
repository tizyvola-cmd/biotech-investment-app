"""
Ticker Financial SEC dossier — EDGAR current reports + offering/proxy docs.

Forms: 8-K / 6-K, 424B2–5 prospectus supplements, DEF 14A proxies.
Lookback: last 2 months. Cache until the next Wednesday 07:00 Europe/Rome.
Display only — not Soft BUY/SELL.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta, time as dt_time, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from orchestrator_io_paths import DATA_DIR

logger = logging.getLogger(__name__)

_ROME = ZoneInfo("Europe/Rome")
_CACHE_PATH = Path(DATA_DIR) / "ticker_8k_dossier_cache.json"
_CACHE_LOCK = threading.Lock()
_REFRESH_GUARD = threading.Lock()
_refreshing: set[str] = set()
_fail_until: dict[str, tuple[float, str]] = {}
_FAIL_HOLD_S = 90.0
_LOOKBACK_DAYS = 62
_MAX_FILINGS = 14
_MAX_WEEKLY_TICKERS = 28
_WEDNESDAY = 2  # datetime.weekday Monday=0
_WEDNESDAY_AT = dt_time(7, 15)
# v6: prefer Gemini session headings over taxonomy stub titles (Earnings reported…).
_DIGEST_VERSION = 6
_SUMMARY_MAX_WORDS = 65
_WRAPPER_ITEMS = frozenset({"2.02", "7.01", "8.01", "5.02", "1.01"})
# Extra EDGAR forms for the Financial dossier (beyond 8-K / 6-K).
_DOSSIER_EXTRA_FORMS = frozenset(
    {
        "424B2",
        "424B3",
        "424B4",
        "424B5",
        "DEF 14A",
    }
)

_SYSTEM_BASE = (
    "You are a biotech/medtech equity analyst reading an SEC filing. "
    "For every paragraph give a short title that names the event, then a "
    "conceptual summary of the MESSAGE (what management is telling investors). "
    "Max 65 English words. "
    "MUST include at least one concrete fact when present in the source text: "
    "dollar amount, percent, date, trial phase/name, NCT id, share count, "
    "offering price, warrant terms, or named counterparty. "
    "If no such fact exists in the source, say so explicitly "
    "(e.g. 'no financial terms disclosed') — never stay vague. "
    "Do not copy the first sentences. Skip signature legalese and checkbox cover text. "
    "Strict JSON only — no markdown."
)

_SYSTEM_8K = (
    _SYSTEM_BASE
    + " This is a Form 8-K / 6-K current report. "
    "Split each Item into the distinct investor paragraphs (usually 1–3)."
)

_SYSTEM_424B = (
    _SYSTEM_BASE
    + " This is a prospectus supplement (Form 424B). "
    "Prioritize the REAL offering economics: offer price per share, number of shares "
    "(or pre-funded warrants), gross proceeds, underwriter discount, warrant coverage/"
    "exercise price/expiry, and whether this is a shelf takedown. "
    "Prefer priced terms over vague 'up to $X' language."
)

_SYSTEM_DEF14A = (
    _SYSTEM_BASE
    + " This is a DEF 14A proxy statement. "
    "Prioritize shareholder proposals that can move the stock: reverse/forward split, "
    "authorized share increase, equity plan, M&A / merger approval, director elections "
    "only when contested, and notable say-on-pay / compensation votes. "
    "Skip routine boilerplate biographies unless they are the only substance."
)


def _normalize_form_key(form_type: str) -> str:
    return re.sub(r"\s+", " ", (form_type or "").strip().upper())


def _is_prospectus_form(form_type: str) -> bool:
    return _normalize_form_key(form_type).startswith("424B")


def _is_proxy_form(form_type: str) -> bool:
    key = _normalize_form_key(form_type).replace(" ", "")
    return key in {"DEF14A", "DEFA14A"}


def _is_foreign_current_report(form_type: str) -> bool:
    return _normalize_form_key(form_type).startswith("6-K")


def _system_for_form(form_type: str) -> str:
    if _is_prospectus_form(form_type):
        return _SYSTEM_424B
    if _is_proxy_form(form_type):
        return _SYSTEM_DEF14A
    return _SYSTEM_8K


def _form_session_meta(form_type: str) -> tuple[str, str]:
    """Return (session item code, official label) for non-Item filings."""
    form = _normalize_form_key(form_type) or "8-K"
    if _is_prospectus_form(form):
        return form, "Prospectus supplement (shelf takedown / offering terms)"
    if _is_proxy_form(form):
        return "DEF 14A", "Proxy statement (shareholder meeting)"
    if _is_foreign_current_report(form):
        return "6-K", "Report of foreign private issuer"
    return "8-K", "Current report"


def _normalize_filing_title(title: str, form_type: str) -> str:
    """Classifier often prefixes '8-K:' even for 6-K / 424B / DEF 14A."""
    t = (title or "").strip()
    form = _normalize_form_key(form_type) or "8-K"
    if not t:
        return t
    if form.startswith("8-K"):
        return t
    label = form
    if re.match(r"(?i)^8-K\b", t):
        return re.sub(r"(?i)^8-K", label, t, count=1)
    return t


_TAXONOMY_STUB_TITLES = frozenset(
    {
        "earnings reported",
        "competitor approval (increased competition)",
        "positive topline / interim results",
        "trial discontinued for futility",
        "key executive hire",
        "positive data",
        "negative data",
        "regulatory approval",
        "fda approval",
        "guidance update",
        "offering / financing",
        "litigation",
    }
)


def _strip_form_prefix(title: str) -> str:
    return re.sub(
        r"(?i)^(8-K|6-K|424B\d?|DEF\s*14A)\s*:\s*",
        "",
        (title or "").strip(),
    ).strip()


def _is_taxonomy_stub_title(title: str) -> bool:
    core = _strip_form_prefix(title).lower()
    if not core:
        return True
    if core in _TAXONOMY_STUB_TITLES:
        return True
    if len(core) <= 28 and not re.search(r"\d|\$|[A-Z]{2,}\d|\bNCT\d", title or ""):
        if any(k in core for k in ("earnings", "approval", "topline", "hire", "competitor")):
            return True
    return False


def _prefer_session_title(
    title: str,
    form_type: str,
    sessions: list[dict[str, Any]],
) -> str:
    """Replace taxonomy stub titles with the Gemini session heading when available."""
    if not _is_taxonomy_stub_title(title):
        return (title or "")[:240]
    for s in sessions or []:
        if not isinstance(s, dict):
            continue
        heading = str(s.get("title") or "").strip()
        if heading and not _is_taxonomy_stub_title(heading):
            form = _normalize_form_key(form_type) or "8-K"
            labeled = heading if re.match(rf"(?i)^{re.escape(form)}\b", heading) else f"{form}: {heading}"
            return _normalize_filing_title(labeled, form_type)[:240]
    return (title or "")[:240]

def _rome_now(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(_ROME)
    if now.tzinfo is None:
        return now.replace(tzinfo=_ROME)
    return now.astimezone(_ROME)


def last_wednesday_cutoff(now: datetime | None = None) -> datetime:
    """Most recent Wednesday 07:15 Europe/Rome at or before ``now``."""
    rn = _rome_now(now)
    days_since = (rn.weekday() - _WEDNESDAY) % 7
    day = rn.date() - timedelta(days=days_since)
    cutoff = datetime.combine(day, _WEDNESDAY_AT, tzinfo=_ROME)
    if rn < cutoff:
        cutoff -= timedelta(days=7)
    return cutoff


def next_wednesday_iso(now: datetime | None = None) -> str:
    rn = _rome_now(now)
    cutoff = last_wednesday_cutoff(rn)
    nxt = cutoff + timedelta(days=7)
    return nxt.isoformat()


def _cache_fresh(entry: dict[str, Any], now: datetime | None = None) -> bool:
    try:
        ver = int(entry.get("digest_version") or 0)
    except (TypeError, ValueError):
        ver = 0
    if ver < _DIGEST_VERSION:
        return False
    ts = str(entry.get("updated_at") or "")
    if not ts:
        return False
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_ROME) >= last_wednesday_cutoff(now)


def _load_cache() -> dict[str, Any]:
    if not _CACHE_PATH.is_file():
        return {"entries": {}}
    try:
        raw = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("entries"), dict):
            return raw
    except Exception:
        pass
    return {"entries": {}}


def _save_cache(doc: dict[str, Any]) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def _cap_words(text: str | None, n: int | None = None) -> str | None:
    limit = _SUMMARY_MAX_WORDS if n is None else n
    s = " ".join(str(text or "").split()).strip()
    if not s:
        return None
    words = s.split()
    if len(words) <= limit:
        return s
    return " ".join(words[:limit]).rstrip(",;:.") + "…"


def _exhibit_tail(text: str) -> str:
    """Press-release / exhibit body, skipping 8-K signature legalese."""
    raw = text or ""
    pr = list(re.finditer(r"(?i)\bFOR\s+IMMEDIATE\s+RELEASE\b", raw))
    if pr:
        return raw[pr[-1].start() :]
    numeric = _numeric_excerpt(raw, 80)
    if numeric:
        return numeric
    return ""


def _numeric_excerpt(text: str, max_words: int = 50) -> str | None:
    sents = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", text or "")
        if s.strip()
    ]
    picked: list[str] = []
    n = 0
    for s in sents:
        if re.search(
            r"(?i)pursuant to the requirements|duly authorized|emerging growth|"
            r"check the appropriate box|incorporated herein by reference|"
            r"shall not be deemed",
            s,
        ):
            continue
        if not re.search(
            r"(?i)\$\s?\d|\b(?:million|billion|EPS|revenue|net\s+income|diluted)\b",
            s,
        ):
            continue
        w = len(s.split())
        if w < 8:
            continue
        picked.append(s)
        n += w
        if n >= max_words - 5:
            break
    return _cap_words(" ".join(picked), max_words) if picked else None


def _parse_ai_json(raw: str) -> Any:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        return json.loads(text)
    except Exception:
        brace = re.search(r"\{[\s\S]*\}", text)
        if brace:
            try:
                return json.loads(brace.group(0))
            except Exception:
                return None
        return None


def _call_8k_summarizer(prompt: str, system: str) -> str | None:
    """Prefer Gemini for 8-K conceptual paragraphs; fall back to the active provider."""
    try:
        import ai_provider

        if "gemini" in ai_provider.configured_providers():
            out = ai_provider._call_provider(
                "gemini",
                prompt,
                system=system,
                max_tokens=1400,
                model_override=None,
                task="summary",
            )
            if out:
                return out
        if ai_provider.is_available():
            return ai_provider.call_ai(
                prompt, system=system, max_tokens=1400, task="summary"
            )
    except Exception as exc:
        logger.debug("8-K Gemini summarize failed: %s", exc)
    return None


def _normalize_gemini_paragraphs(
    parsed: Any,
    *,
    item_titles: dict[str, str],
) -> list[dict[str, Any]]:
    rows: list[Any] = []
    if isinstance(parsed, list):
        rows = parsed
    elif isinstance(parsed, dict):
        inner = parsed.get("paragraphs") or parsed.get("sessions") or parsed.get("items")
        if isinstance(inner, list):
            rows = inner
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("item") or row.get("item_no") or "").strip()
        code = re.sub(r"(?i)^item\s*", "", code).strip()
        official = item_titles.get(code) or str(row.get("item_title") or "").strip()
        nested = row.get("paragraphs")
        if isinstance(nested, list) and nested:
            for p in nested:
                if not isinstance(p, dict):
                    continue
                summary = _cap_words(p.get("summary") or p.get("message") or "")
                title = str(p.get("title") or p.get("heading") or "").strip()
                if not summary:
                    continue
                out.append(
                    {
                        "item": code or str(p.get("item") or "").strip(),
                        "item_title": official[:160] or None,
                        "title": (title or official or "Update")[:160],
                        "summary": summary,
                    }
                )
            continue
        summary = _cap_words(row.get("summary") or row.get("message") or "")
        title = str(row.get("title") or row.get("heading") or "").strip()
        if not summary:
            continue
        out.append(
            {
                "item": code,
                "item_title": official[:160] or None,
                "title": (title or official or "Update")[:160],
                "summary": summary,
            }
        )
    return [s for s in out if s.get("summary")]


def _item_body_for_ai(item: dict[str, Any], *, max_chars: int = 2500) -> str:
    return str(item.get("body") or "").strip()[:max_chars]


def _gemini_paragraphs_for_filing(
    *,
    ticker: str,
    items: list[dict[str, Any]],
    tail: str,
    form_type: str = "8-K",
) -> list[dict[str, Any]] | None:
    if not items:
        return None
    # Prospectus / proxy need a wider window so priced terms / proposals survive.
    body_cap = 14_000 if (_is_prospectus_form(form_type) or _is_proxy_form(form_type)) else 2500
    blocks: list[str] = []
    item_titles: dict[str, str] = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        code = str(it.get("item") or "").strip()
        official = str(it.get("title") or f"Item {code}").strip()
        if code:
            item_titles[code] = official
        body = _item_body_for_ai(it, max_chars=body_cap)
        if not body:
            continue
        blocks.append(f"ITEM {code} — {official}\n{body}")
    if tail and not (_is_prospectus_form(form_type) or _is_proxy_form(form_type)):
        blocks.append(
            "EXHIBIT / PRESS RELEASE BODY (use for substance when Items only furnish exhibits)\n"
            + tail[:5000]
        )
    if not blocks:
        return None
    sample_item = next(iter(item_titles), "7.01")
    prompt = (
        f"Ticker: {ticker}\nForm: {_normalize_form_key(form_type) or '8-K'}\n\n"
        + "\n\n----\n\n".join(blocks[:9])
        + "\n\nReturn JSON: {\"paragraphs\":[{\"item\":\""
        + sample_item
        + "\","
        "\"title\":\"short conceptual title\",\"summary\":\"max 65 words with "
        "at least one concrete fact from the source when available\"}]}\n"
        "Use the Item / section code of the source block. One object per paragraph. "
        "Item codes must be like 7.01, 424B5, or DEF 14A — not 'Item 7.01'."
    )
    raw = _call_8k_summarizer(prompt, _system_for_form(form_type))
    if not raw:
        return None
    parsed = _parse_ai_json(raw)
    paras = _normalize_gemini_paragraphs(parsed, item_titles=item_titles)
    return paras or None


def _extractive_sessions(
    brief: dict[str, Any],
    *,
    text: str,
    tail: str,
) -> list[dict[str, Any]]:
    from daily_news_desk import _summarize_8k_item_extractive

    sessions: list[dict[str, Any]] = []
    for it in brief.get("item_summaries") or []:
        if not isinstance(it, dict):
            continue
        code = str(it.get("item") or "").strip()
        official = str(it.get("title") or f"Item {code}")[:160]
        summary = _cap_words(it.get("summary"))
        thin = not summary or len(summary.split()) < 40 or re.search(
            r"(?i)press release announcing|furnished (?:herewith|as exhibit)|no substantive",
            summary,
        )
        if thin and code in {"2.02", "7.01", "8.01", "1.01"}:
            extra = None
            if tail:
                extra = _summarize_8k_item_extractive(
                    {"item": code, "title": official, "body": tail},
                    max_words=_SUMMARY_MAX_WORDS,
                )
            extra_c = _cap_words(extra) or _numeric_excerpt(text, _SUMMARY_MAX_WORDS)
            if extra_c and "no substantive" not in extra_c.lower() and "pursuant to the requirements" not in extra_c.lower():
                if "$" not in extra_c:
                    nums = _numeric_excerpt(text, _SUMMARY_MAX_WORDS)
                    if nums:
                        extra_c = _cap_words(f"{extra_c} {nums}")
                summary = extra_c
        sessions.append(
            {
                "item": code,
                "item_title": official,
                "title": official,
                "summary": summary,
            }
        )
    return sessions


def _classification_method_from_brief(brief: dict[str, Any]) -> str:
    """Overall classify path for observability (AI vs heuristic_fill)."""
    base = str(brief.get("taxonomy_method") or brief.get("classification_method") or "").strip()
    dims = brief.get("taxonomy_dimensions")
    fill_dims: list[str] = []
    if isinstance(dims, dict):
        for dim, block in dims.items():
            if isinstance(block, dict) and block.get("classification_method") == "heuristic_fill":
                fill_dims.append(str(dim))
    if fill_dims:
        root = base or "ai_8k"
        if "heuristic_fill" not in root:
            root = f"{root}+heuristic_fill"
        return root
    return base or "unknown"


def _synthetic_session_for_form(
    *,
    form_type: str,
    title: str,
    brief: dict[str, Any],
    text: str,
    ticker: str,
) -> tuple[list[dict[str, Any]], str]:
    """
    6-K / 424B / DEF 14A (and bare wraps) often have no Item.N segments.
    Build one Gemini/extractive card from the full body so the UI is not empty.
    Returns (sessions, digest_method).
    """
    code, official = _form_session_meta(form_type)
    body = (text or "").strip()
    body_cap = 20_000 if (_is_prospectus_form(form_type) or _is_proxy_form(form_type)) else 12_000
    if len(body) > 80:
        try:
            paras = _gemini_paragraphs_for_filing(
                ticker=ticker,
                items=[{"item": code, "title": official, "body": body[:body_cap]}],
                tail=_exhibit_tail(body),
                form_type=form_type,
            )
            if paras:
                return paras, "gemini"
        except Exception as exc:
            logger.debug("synthetic %s Gemini failed: %s", form_type, exc)

    summary = _cap_words(
        brief.get("detail_summary")
        or brief.get("summary_long")
        or brief.get("narrative_summary")
    )
    if not summary:
        summary = _numeric_excerpt(body, _SUMMARY_MAX_WORDS) or _cap_words(body)
    if not summary:
        return [], "empty"
    method = (
        "sec_424b_body"
        if _is_prospectus_form(form_type)
        else ("sec_def14a_body" if _is_proxy_form(form_type) else "sec_6k_body")
    )
    return [
        {
            "item": code,
            "item_title": official,
            "title": (title or official)[:160],
            "summary": summary,
        }
    ], method


def _digest_filing(
    *,
    ticker: str,
    text: str,
    filing_date: str,
    url: str,
    items_hint: str = "",
    form_type: str = "8-K",
    bundle_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from daily_news_desk import _build_sec_8k_structured_brief

    brief = _build_sec_8k_structured_brief(
        text=text,
        ticker=ticker,
        title_hint=f"{ticker} {form_type}",
        url=url,
        filing_date=filing_date,
    )
    tail = _exhibit_tail(text)
    gemini_sessions = brief.get("gemini_sessions")
    if isinstance(gemini_sessions, list) and gemini_sessions:
        sessions = gemini_sessions
        digest_method = "gemini"
    else:
        sessions = _extractive_sessions(brief, text=text, tail=tail)
        digest_method = brief.get("digest_method") or "sec_8k_items"
        if digest_method in ("sec_8k_gemini", "gemini"):
            digest_method = "sec_8k_items"

    if not sessions:
        sessions, digest_method = _synthetic_session_for_form(
            form_type=form_type,
            title=str(brief.get("title") or "").strip() or f"{ticker} {form_type}",
            brief=brief,
            text=text,
            ticker=ticker,
        )

    score = brief.get("financial_score")
    try:
        score_n = float(score) if score is not None else None
    except (TypeError, ValueError):
        score_n = None
    items_raw = ", ".join(
        dict.fromkeys(x["item"] for x in sessions if x.get("item"))
    ) or (items_hint or None)
    title = _normalize_filing_title(
        str(brief.get("title") or "").strip() or f"{ticker} {form_type}",
        form_type,
    )
    title = _prefer_session_title(title, form_type, sessions if isinstance(sessions, list) else [])
    meta = bundle_meta if isinstance(bundle_meta, dict) else {}
    return {
        "filing_date": filing_date,
        "event_date": brief.get("event_date") or filing_date,
        "form": form_type,
        "title": title[:240],
        "link": url or None,
        "items_raw": items_raw,
        "sessions": sessions,
        "financial_score": score_n,
        "clinical_score": brief.get("clinical_score"),
        "corporate_score": brief.get("corporate_score"),
        "eis_score": brief.get("eis_score"),
        "news_kind": brief.get("news_kind"),
        "digest_method": digest_method,
        "classification_method": _classification_method_from_brief(brief),
        "bundle_chars_primary": meta.get("bundle_chars_primary"),
        "bundle_chars_exhibit": meta.get("bundle_chars_exhibit"),
        "exhibit_names": meta.get("exhibit_names") or [],
        "exhibit_fetch_mode": meta.get("exhibit_fetch_mode"),
    }


def _filing_dedupe_key(card: dict[str, Any]) -> str:
    nid = str(card.get("_daily_news_id") or "").strip()
    if nid:
        return f"dn:{nid}"
    cluster = str(card.get("_daily_news_cluster") or "").strip()
    if cluster:
        return f"cl:{cluster}"
    link = str(card.get("link") or "").strip().lower()
    fd = str(card.get("filing_date") or card.get("event_date") or "")[:10]
    title = str(card.get("title") or "").strip().lower()[:80]
    return f"lk:{link}|{fd}|{title}"


def _merge_edgar_and_migrated(
    edgar: list[dict[str, Any]],
    migrated: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Migrated Daily News financial cards first, then EDGAR (deduped)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for card in list(migrated or []) + list(edgar or []):
        if not isinstance(card, dict):
            continue
        key = _filing_dedupe_key(card)
        if key in seen:
            continue
        seen.add(key)
        out.append(card)
    out.sort(key=lambda c: str(c.get("filing_date") or c.get("event_date") or ""), reverse=True)
    return out[: max(_MAX_FILINGS, 24)]


def _read_migrated_filings(entry: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(entry, dict):
        return []
    dossier = entry.get("dossier") if isinstance(entry.get("dossier"), dict) else {}
    raw = dossier.get("migrated_filings")
    if not isinstance(raw, list):
        raw = entry.get("migrated_filings")
    if not isinstance(raw, list):
        return []
    return [c for c in raw if isinstance(c, dict)]


def upsert_edgar_filing(
    *,
    ticker: str,
    filing: dict[str, Any],
) -> dict[str, Any]:
    """
    Merge one EDGAR digest card into the Financial dossier cache.
    Same shape as lookup_ticker_8k_dossier filings (sessions + Fin/Clin/Corp).
    Used by Daily News Top News / migrate so other surfaces share Financial logic.
    """
    tk = (ticker or "").strip().upper()
    if not tk or not isinstance(filing, dict):
        return {"ok": False, "error": "ticker_or_filing"}
    card = dict(filing)
    card.pop("_from_daily_news", None)
    card.setdefault("form", "8-K")
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        entries = cache_doc.setdefault("entries", {})
        entry = entries.setdefault(tk, {})
        dossier = entry.get("dossier") if isinstance(entry.get("dossier"), dict) else None
        if not isinstance(dossier, dict):
            dossier = {
                "ticker": tk,
                "lookback_days": _LOOKBACK_DAYS,
                "filings": [],
                "count": 0,
                "refresh": "wednesday_07:15_europe_rome",
                "next_refresh": next_wednesday_iso(),
                "digest_version": _DIGEST_VERSION,
                "migrated_filings": [],
            }
        mig = _read_migrated_filings({"dossier": dossier, **entry})
        edgar = [
            c
            for c in (dossier.get("filings") or [])
            if isinstance(c, dict) and not c.get("_from_daily_news")
        ]
        key = _filing_dedupe_key(card)
        edgar = [c for c in edgar if _filing_dedupe_key(c) != key]
        edgar.insert(0, card)
        edgar = edgar[:_MAX_FILINGS]
        merged = _merge_edgar_and_migrated(edgar, mig)
        dossier = {
            **dossier,
            "ticker": tk,
            "migrated_filings": mig,
            "filings": merged,
            "count": len(merged),
            "next_refresh": dossier.get("next_refresh") or next_wednesday_iso(),
            "digest_version": _DIGEST_VERSION,
        }
        now = datetime.now(timezone.utc).isoformat()
        entries[tk] = {
            **entry,
            "updated_at": now,
            "digest_version": _DIGEST_VERSION,
            "dossier": dossier,
            "migrated_filings": mig,
        }
        _save_cache(cache_doc)
    return {"ok": True, "ticker": tk, "count": len(merged)}


def append_migrated_daily_news_filing(
    *,
    ticker: str,
    filing: dict[str, Any],
) -> dict[str, Any]:
    """
    Persist a Daily News → Financial migrate card on the ticker dossier cache.
    Survives Wednesday EDGAR refreshes (kept under migrated_filings).
    """
    tk = (ticker or "").strip().upper()
    if not tk or not isinstance(filing, dict):
        return {"ok": False, "error": "ticker_or_filing"}
    card = dict(filing)
    card.setdefault("form", "News")
    card["_from_daily_news"] = True
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        entries = cache_doc.setdefault("entries", {})
        entry = entries.setdefault(tk, {})
        dossier = entry.get("dossier") if isinstance(entry.get("dossier"), dict) else None
        if not isinstance(dossier, dict):
            dossier = {
                "ticker": tk,
                "lookback_days": _LOOKBACK_DAYS,
                "filings": [],
                "count": 0,
                "refresh": "wednesday_07:15_europe_rome",
                "next_refresh": next_wednesday_iso(),
                "digest_version": _DIGEST_VERSION,
                "migrated_filings": [],
            }
        mig = _read_migrated_filings({"dossier": dossier, **entry})
        key = _filing_dedupe_key(card)
        mig = [c for c in mig if _filing_dedupe_key(c) != key]
        mig.insert(0, card)
        mig = mig[:40]
        edgar = [
            c
            for c in (dossier.get("filings") or [])
            if isinstance(c, dict) and not c.get("_from_daily_news")
        ]
        merged = _merge_edgar_and_migrated(edgar, mig)
        dossier = {
            **dossier,
            "ticker": tk,
            "migrated_filings": mig,
            "filings": merged,
            "count": len(merged),
            "next_refresh": dossier.get("next_refresh") or next_wednesday_iso(),
            "digest_version": _DIGEST_VERSION,
        }
        now = datetime.now(timezone.utc).isoformat()
        entries[tk] = {
            **entry,
            "updated_at": now,
            "digest_version": _DIGEST_VERSION,
            "dossier": dossier,
            "migrated_filings": mig,
        }
        _save_cache(cache_doc)
    return {"ok": True, "ticker": tk, "count": len(merged)}


def remove_migrated_daily_news_from_financial(
    *,
    ticker: str,
    daily_news_id: str | None = None,
    cluster: str | None = None,
) -> int:
    """Drop a migrated Daily News card from the Financial dossier (e.g. re-route to clinical)."""
    tk = (ticker or "").strip().upper()
    nid = str(daily_news_id or "").strip()
    cl = str(cluster or "").strip()
    if not tk or (not nid and not cl):
        return 0
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        entry = (cache_doc.get("entries") or {}).get(tk)
        if not isinstance(entry, dict):
            return 0
        dossier = entry.get("dossier") if isinstance(entry.get("dossier"), dict) else {}
        mig = _read_migrated_filings(entry)
        before = len(mig)

        def _keep(c: dict[str, Any]) -> bool:
            if nid and str(c.get("_daily_news_id") or "") == nid:
                return False
            if cl and str(c.get("_daily_news_cluster") or "") == cl:
                return False
            return True

        mig = [c for c in mig if _keep(c)]
        removed = before - len(mig)
        if not removed:
            return 0
        edgar = [
            c
            for c in (dossier.get("filings") or [])
            if isinstance(c, dict) and not c.get("_from_daily_news")
        ]
        merged = _merge_edgar_and_migrated(edgar, mig)
        dossier = {**dossier, "migrated_filings": mig, "filings": merged, "count": len(merged)}
        entry["dossier"] = dossier
        entry["migrated_filings"] = mig
        entry["updated_at"] = datetime.now(timezone.utc).isoformat()
        cache_doc.setdefault("entries", {})[tk] = entry
        _save_cache(cache_doc)
        return removed


def _fetch_recent_filings(ticker: str) -> list[dict[str, Any]]:
    tk = ticker.strip().upper()
    from daily_news_desk import _cik10_for_ticker
    from catalyst_extractor import (
        _fetch_8k_bundle_text,
        _fetch_submissions,
        _filing_html_url,
        _recent_8k_filings,
    )

    cik10 = _cik10_for_ticker(tk)
    if not cik10:
        return []
    subs = _fetch_submissions(cik10)
    if not subs:
        return []
    today = _rome_now().date().isoformat()
    cutoff = (_rome_now().date() - timedelta(days=_LOOKBACK_DAYS)).isoformat()
    cards: list[dict[str, Any]] = []
    for fil in _recent_8k_filings(
        subs,
        max_n=_MAX_FILINGS * 4,
        include_6k=True,
        extra_forms=_DOSSIER_EXTRA_FORMS,
    ):
        fd = str(fil.get("filing_date") or "")[:10]
        if not fd or fd < cutoff or fd > today:
            continue
        accession = str(fil.get("accession") or "")
        primary = str(fil.get("primary_doc") or "")
        if not accession or not primary:
            continue
        form_type = str(fil.get("form_type") or "8-K")
        # Hint items from EDGAR submissions when available (e.g. "2.02,7.01").
        items_hint = str(fil.get("items") or "")
        prospectus = _is_prospectus_form(form_type)
        proxy = _is_proxy_form(form_type)
        # 424B / DEF 14A: substance is in the primary doc — skip exhibit crawl.
        # 6-K / wrapper 8-K Items: always pull Ex-99 press releases.
        want_exhibits = not prospectus and not proxy
        force_exhibits = bool(
            want_exhibits
            and (
                _is_foreign_current_report(form_type)
                or not items_hint
                or any(code in items_hint for code in _WRAPPER_ITEMS)
            )
        )
        bundle_meta: dict[str, Any] = {}
        text = _fetch_8k_bundle_text(
            cik10,
            accession,
            primary,
            max_chars=80_000,
            fetch_exhibits=want_exhibits,
            force_exhibits=force_exhibits,
            meta_out=bundle_meta,
        )
        if not text or len(text.strip()) < 80:
            continue
        url = _filing_html_url(cik10, accession, primary)
        cards.append(
            _digest_filing(
                ticker=tk,
                text=text,
                filing_date=fd,
                url=url,
                items_hint=items_hint,
                form_type=form_type,
                bundle_meta=bundle_meta,
            )
        )
        if len(cards) >= _MAX_FILINGS:
            break
    cards.sort(key=lambda c: str(c.get("filing_date") or ""), reverse=True)
    return cards


def _public_fetch_error(exc: BaseException) -> str:
    """Never send a Cloudflare/HTML body back to the Financial tab."""
    msg = str(exc).strip()
    low = msg.lower()
    if "<!doctype" in low or "<html" in low or "cloudflare" in low or "524" in low:
        return "origin_timeout"
    return msg[:240]


def _response_from_hit(hit: dict[str, Any], *, stale: bool = False) -> dict[str, Any]:
    dossier = dict(hit.get("dossier") or {})
    migrated = _read_migrated_filings(hit)
    edgar = [
        c
        for c in (dossier.get("filings") or [])
        if isinstance(c, dict) and not c.get("_from_daily_news")
    ]
    if not migrated:
        migrated = [
            c
            for c in (dossier.get("filings") or [])
            if isinstance(c, dict) and c.get("_from_daily_news")
        ]
    merged = _merge_edgar_and_migrated(edgar, migrated)
    dossier["migrated_filings"] = migrated
    dossier["filings"] = merged
    dossier["count"] = len(merged)
    out: dict[str, Any] = {
        "ok": True,
        "cached": True,
        "updated_at": hit.get("updated_at"),
        "next_refresh": next_wednesday_iso(),
        "dossier": dossier,
    }
    if stale:
        out["stale"] = True
    return out


def _schedule_8k_refresh(tk: str) -> None:
    with _REFRESH_GUARD:
        if tk in _refreshing:
            return
        _refreshing.add(tk)

    def _run() -> None:
        try:
            lookup_ticker_8k_dossier(ticker=tk, force=True)
        except Exception:
            logger.exception("8-K background refresh failed %s", tk)
        finally:
            with _REFRESH_GUARD:
                _refreshing.discard(tk)

    threading.Thread(target=_run, name=f"8k-{tk}", daemon=True).start()


def lookup_ticker_8k_dossier(
    *,
    ticker: str,
    force: bool = False,
) -> dict[str, Any]:
    tk = (ticker or "").strip().upper()
    if not tk:
        return {"ok": False, "error": "ticker required"}

    with _CACHE_LOCK:
        cache_doc = _load_cache()
        hit = cache_doc.get("entries", {}).get(tk)
        if (
            isinstance(hit, dict)
            and isinstance(hit.get("dossier"), dict)
            and not force
        ):
            fresh = _cache_fresh(hit)
            if not fresh:
                _schedule_8k_refresh(tk)
            return _response_from_hit(hit, stale=not fresh)

    if not force:
        held = _fail_until.get(tk)
        if held and time.time() < held[0]:
            return {"ok": False, "error": held[1], "ticker": tk}
        _schedule_8k_refresh(tk)
        return {
            "ok": False,
            "error": "building",
            "ticker": tk,
            "hint": "Reading EDGAR filings in the background.",
        }

    try:
        filings = _fetch_recent_filings(tk)
    except Exception as exc:
        logger.warning("8-K dossier fetch failed %s: %s", tk, exc)
        err = _public_fetch_error(exc)
        _fail_until[tk] = (time.time() + _FAIL_HOLD_S, err)
        with _CACHE_LOCK:
            cache_doc = _load_cache()
            stale_hit = cache_doc.get("entries", {}).get(tk)
        if isinstance(stale_hit, dict) and isinstance(stale_hit.get("dossier"), dict):
            payload = _response_from_hit(stale_hit, stale=True)
            payload["hint"] = err
            return payload
        return {"ok": False, "error": err, "ticker": tk}

    with _CACHE_LOCK:
        cache_doc = _load_cache()
        hit = cache_doc.get("entries", {}).get(tk)
        migrated = _read_migrated_filings(hit if isinstance(hit, dict) else None)

    merged = _merge_edgar_and_migrated(filings, migrated)
    dossier = {
        "ticker": tk,
        "lookback_days": _LOOKBACK_DAYS,
        "filings": merged,
        "migrated_filings": migrated,
        "count": len(merged),
        "refresh": "wednesday_07:15_europe_rome",
        "next_refresh": next_wednesday_iso(),
        "digest_version": _DIGEST_VERSION,
    }
    now = datetime.now(timezone.utc).isoformat()
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        prev = cache_doc.get("entries", {}).get(tk) or {}
        cache_doc.setdefault("entries", {})[tk] = {
            **prev,
            "updated_at": now,
            "digest_version": _DIGEST_VERSION,
            "dossier": dossier,
            "migrated_filings": migrated,
        }
        _save_cache(cache_doc)
    _fail_until.pop(tk, None)
    return {
        "ok": True,
        "cached": False,
        "updated_at": now,
        "next_refresh": dossier["next_refresh"],
        "dossier": dossier,
    }


def _watchlist_tickers() -> list[str]:
    out: list[str] = []
    seen: set[str] = set()

    def _add(raw: Any) -> None:
        tk = str(raw or "").strip().upper()
        if not tk or tk in seen or not (2 <= len(tk) <= 5):
            return
        seen.add(tk)
        out.append(tk)

    with _CACHE_LOCK:
        for k in (_load_cache().get("entries") or {}):
            _add(k)
    try:
        from catalyst_desk_cache import load_morning_cache

        doc = load_morning_cache() or {}
        for tk in doc.get("tickers") or []:
            _add(tk)
    except Exception:
        pass
    try:
        from hype_volume_funnel import load_simulation_tickers

        if len(out) < 8:
            for tk in sorted(load_simulation_tickers() or []):
                _add(tk)
                if len(out) >= _MAX_WEEKLY_TICKERS:
                    break
    except Exception:
        pass
    return out[:_MAX_WEEKLY_TICKERS]


def refresh_watchlist_8k_dossiers(*, force: bool = False) -> dict[str, Any]:
    """Wednesday morning: re-search EDGAR for cached / desk tickers (last 2 months)."""
    tickers = _watchlist_tickers()
    ok_n = 0
    err: list[str] = []
    for tk in tickers:
        res = lookup_ticker_8k_dossier(ticker=tk, force=force)
        if res.get("ok"):
            ok_n += 1
        else:
            err.append(f"{tk}: {res.get('error')}")
    return {
        "ok": not err or ok_n > 0,
        "tickers": len(tickers),
        "refreshed": ok_n,
        "errors": err[:12],
        "next_refresh": next_wednesday_iso(),
    }
