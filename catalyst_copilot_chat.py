"""
Interactive Copilot chat for Catalyst Feed (clinical pre-CD context).

Uses the same AI stack as enrichment (GitHub Models / Copilot, Claude, OpenAI).
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
from typing import Any, Callable, TypeVar

_T = TypeVar("_T")

import ai_provider

_MAX_HISTORY_TURNS = 8
_MAX_CONTEXT_CHARS = 14_000
_MAX_LIVE_CHARS = 5_000
_SUMMARY_CHARS = 900
_MAX_PAGE_RECORDS = 10


def _run_with_timeout(fn: Callable[[], _T], timeout_s: float, *, default: _T) -> _T:
    if timeout_s <= 0:
        return fn()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(fn)
        try:
            return fut.result(timeout=timeout_s)
        except concurrent.futures.TimeoutError:
            return default


def _load_feed_records() -> list[dict[str, Any]]:
    try:
        from clinical_pre_cd_enrichment import load_snapshot

        snap = load_snapshot()
        recs = snap.get("records") or []
        return [r for r in recs if isinstance(r, dict)]
    except Exception:
        return []


def _tokenize(text: str) -> set[str]:
    return {
        w.lower()
        for w in re.findall(r"[a-zA-Z0-9][a-zA-Z0-9\-]{2,}", text or "")
        if len(w) >= 3
    }


def _event_id(ticker: str, ev: dict[str, Any], index: int) -> str:
    d = str(ev.get("event_date") or "na").replace(" ", "")
    return f"{ticker}|{d}|{index}"


def _rich_indicator(ind: dict[str, Any]) -> dict[str, Any]:
    return {
        "label": ind.get("label"),
        "value": ind.get("value"),
        "kpi_type": ind.get("kpi_type"),
        "direction": ind.get("direction"),
        "endpoint_met": ind.get("endpoint_met"),
        "p_value": ind.get("p_value"),
        "data_maturity": ind.get("data_maturity"),
        "confidence_interval": ind.get("confidence_interval"),
    }


def _rich_event(ev: dict[str, Any], *, ticker: str, index: int) -> dict[str, Any]:
    price = ev.get("price") if isinstance(ev.get("price"), dict) else {}
    eis = ev.get("eis") if isinstance(ev.get("eis"), dict) else {}
    inds = [_rich_indicator(i) for i in (ev.get("indicators") or [])[:10] if isinstance(i, dict)]
    summary = str(ev.get("summary") or "").strip()
    if len(summary) > _SUMMARY_CHARS:
        summary = summary[: _SUMMARY_CHARS - 1] + "…"
    row: dict[str, Any] = {
        "id": _event_id(ticker, ev, index),
        "date": ev.get("event_date"),
        "title": ev.get("event_title"),
        "summary": summary or None,
        "drug": ev.get("drug") or ev.get("asset"),
        "source": ev.get("source_type"),
        "link_label": ev.get("link_label"),
        "link": ev.get("link"),
        "impact_note": (str(ev.get("impact_note") or "").strip()[:400] or None),
        "reference_verified": ev.get("reference_verified"),
        "indicators": inds or None,
        "eis": {
            "score": eis.get("score"),
            "delta_p_1d": eis.get("delta_p_1d"),
            "delta_p_3d": eis.get("delta_p_3d"),
            "kpi_score": eis.get("kpi_score"),
        }
        if eis
        else None,
        "price_t_t1_t3": {
            "p_t0": price.get("p_t0"),
            "p_t1": price.get("p_t1"),
            "p_t3": price.get("p_t3"),
            "delta_p_1d": price.get("delta_p_1d"),
            "delta_p_3d": price.get("delta_p_3d"),
        }
        if price
        else None,
    }
    return row


def _rich_record(rec: dict[str, Any]) -> dict[str, Any]:
    ticker = str(rec.get("ticker") or "").upper()
    events = rec.get("clinical_events") or rec.get("timeline_events") or []
    ev_out = [
        _rich_event(e, ticker=ticker, index=i)
        for i, e in enumerate(events[:20])
        if isinstance(e, dict)
    ]
    study_inds = [
        _rich_indicator(i)
        for i in (rec.get("clinical_indicators") or [])[:12]
        if isinstance(i, dict)
    ]
    nct = str(rec.get("nct_id") or "").strip().upper() or None
    nct_extra: dict[str, Any] | None = None
    if nct:
        try:
            from clinical_trial_summary import get_cached_summary

            cached = get_cached_summary(nct)
            if cached:
                nct_extra = {
                    "nct_id": nct,
                    "executive_summary": (str(cached.get("executive_summary") or ""))[:1200],
                    "key_metrics": cached.get("key_metrics"),
                    "outcome": cached.get("outcome"),
                }
        except Exception:
            pass
    return {
        "ticker": ticker,
        "company": rec.get("company"),
        "nct_id": nct,
        "completion_date": rec.get("completion_date"),
        "window": f"{rec.get('window_start')} – {rec.get('window_end')}",
        "study_phase": rec.get("study_phase"),
        "data_gaps": (str(rec.get("data_gaps") or ""))[:300] or None,
        "study_level_indicators": study_inds or None,
        "nct_cached_summary": nct_extra,
        "events_on_page": ev_out,
    }


def _find_relevant_events(
    records: list[dict[str, Any]],
    user_message: str,
    *,
    limit: int = 4,
) -> list[dict[str, Any]]:
    """Rank feed events by overlap with the user question (titles, summaries, drugs)."""
    q_tokens = _tokenize(user_message)
    if not q_tokens:
        return []
    scored: list[tuple[float, dict[str, Any]]] = []
    for rec in records:
        ticker = str(rec.get("ticker") or "").upper()
        for i, ev in enumerate(rec.get("clinical_events") or rec.get("timeline_events") or []):
            if not isinstance(ev, dict):
                continue
            blob = " ".join(
                [
                    str(rec.get("company") or ""),
                    ticker,
                    str(ev.get("event_title") or ""),
                    str(ev.get("summary") or ""),
                    str(ev.get("drug") or ev.get("asset") or ""),
                ]
            )
            e_tokens = _tokenize(blob)
            if not e_tokens:
                continue
            overlap = len(q_tokens & e_tokens)
            if ticker.upper() in user_message.upper():
                overlap += 3
            if overlap <= 0:
                continue
            rich = _rich_event(ev, ticker=ticker, index=i)
            rich["relevance_score"] = overlap
            scored.append((float(overlap), rich))
    scored.sort(key=lambda x: -x[0])
    return [e for _, e in scored[:limit]]


def build_page_context(
    page_records: list[dict[str, Any]] | None,
    user_message: str,
    *,
    ticker: str | None = None,
    tickers: list[str] | None = None,
) -> str:
    """Rich context from rows visible on Catalyst Feed (preferred over bare snapshot)."""
    records = [r for r in (page_records or []) if isinstance(r, dict)]
    if not records:
        records = _load_feed_records()
        t_set: set[str] = set()
        if ticker:
            t_set.add(ticker.strip().upper())
        for t in tickers or []:
            if t:
                t_set.add(str(t).strip().upper())
        if t_set:
            records = [r for r in records if str(r.get("ticker") or "").upper() in t_set]

    matched = _find_relevant_events(records, user_message)
    payload: dict[str, Any] = {
        "note": (
            "Contesto = studi/report visibili ORA nella tabella Catalyst Feed dell'utente. "
            "Usa questi testi per approfondire; non inventare dati oltre quanto indicato."
        ),
        "matched_for_question": matched,
        "companies": [_rich_record(r) for r in records[:12]],
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if len(text) > _MAX_CONTEXT_CHARS:
        text = text[:_MAX_CONTEXT_CHARS] + "\n…(truncated)"
    return text


def _compact_event(ev: dict[str, Any]) -> dict[str, Any]:
    price = ev.get("price") if isinstance(ev.get("price"), dict) else {}
    eis = ev.get("eis") if isinstance(ev.get("eis"), dict) else {}
    inds = []
    for ind in (ev.get("indicators") or [])[:5]:
        if not isinstance(ind, dict):
            continue
        inds.append(
            {
                "label": ind.get("label"),
                "value": ind.get("value"),
                "kpi_type": ind.get("kpi_type"),
                "direction": ind.get("direction"),
            }
        )
    return {
        "date": ev.get("event_date"),
        "title": (str(ev.get("event_title") or ""))[:160],
        "summary": (str(ev.get("summary") or ""))[:320],
        "drug": ev.get("drug") or ev.get("asset"),
        "source": ev.get("source_type"),
        "link": ev.get("link_label"),
        "eis": eis.get("score"),
        "delta_p_1d": price.get("delta_p_1d"),
        "delta_p_3d": price.get("delta_p_3d"),
        "indicators": inds or None,
    }


def _compact_record(rec: dict[str, Any]) -> dict[str, Any]:
    events = rec.get("clinical_events") or rec.get("timeline_events") or []
    ev_out = [_compact_event(e) for e in events[:12] if isinstance(e, dict)]
    inds = []
    for ind in (rec.get("clinical_indicators") or [])[:6]:
        if isinstance(ind, dict):
            inds.append({"label": ind.get("label"), "value": ind.get("value")})
    return {
        "ticker": rec.get("ticker"),
        "company": rec.get("company"),
        "nct_id": rec.get("nct_id"),
        "completion_date": rec.get("completion_date"),
        "window": f"{rec.get('window_start')} – {rec.get('window_end')}",
        "study_phase": rec.get("study_phase"),
        "clinical_indicators": inds or None,
        "events": ev_out,
        "data_gaps": (str(rec.get("data_gaps") or ""))[:200] or None,
    }


def build_context_block(
    *,
    ticker: str | None = None,
    tickers: list[str] | None = None,
) -> str:
    """JSON context from latest clinical pre-CD snapshot."""
    records = _load_feed_records()
    t_set: set[str] = set()
    if ticker:
        t_set.add(ticker.strip().upper())
    for t in tickers or []:
        if t:
            t_set.add(str(t).strip().upper())

    if t_set:
        records = [r for r in records if str(r.get("ticker") or "").upper() in t_set]

    compact = [_compact_record(r) for r in records[:25]]
    if not compact:
        return json.dumps(
            {"note": "No Catalyst Feed records in snapshot for the requested scope."},
            ensure_ascii=False,
        )
    text = json.dumps(compact, ensure_ascii=False, indent=2)
    if len(text) > _MAX_CONTEXT_CHARS:
        text = text[:_MAX_CONTEXT_CHARS] + "\n…(truncated)"
    return text


def _system_prompt(*, lang: str, live_research: bool) -> str:
    it = lang.startswith("it")
    if it:
        base = (
            "Sei un analista biotech che aiuta l'utente ad APPROFONDIRE studi clinici, report e 8-K "
            "già mostrati nella tabella Catalyst Feed. "
            "Rispondi in italiano salvo richiesta esplicita di inglese. "
            "Priorità: (1) eventi in «matched_for_question» e testi in «events_on_page» / summary, "
            "(2) indicatori KPI ed EIS/prezzi T+1/T+3 nella stessa riga, "
            "(3) eventuale LIVE RESEARCH PubMed/CT.gov solo se serve integrare. "
            "Se l'utente chiede summary/criticità/passi avanti, usa titoli markdown: "
            "## Contesto, ## Passi avanti, ## Criticità e rischi, ## KPI e prezzo (EIS, T+1/T+3), ## Lacune dati. "
            "Struttura la risposta: contesto → dati chiave → implicazione investimento → cosa manca. "
            "Cita id evento, NCT, PMID e link. Non inventare numeri. Non è consulenza finanziaria."
        )
        if not live_research:
            base += " Ricerca live disattivata: usa solo lo snapshot locale."
        return base
    base = (
        "You are a senior biotech analyst in SuperNova Catalyst Feed. "
        "Reply in English unless the user asks for Italian. "
        "Combine: (1) local feed snapshot, (2) LIVE RESEARCH block from PubMed + ClinicalTrials.gov when present. "
        "For recent publications/trials prefer LIVE RESEARCH; for EIS and T+1/T+3 prices use the snapshot. "
        "Cite PMIDs, NCT IDs and URLs. Do not invent figures not in sources. Not financial advice."
    )
    if not live_research:
        base += " Live research off — local snapshot only."
    return base


def _format_history(history: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for msg in history[-_MAX_HISTORY_TURNS:]:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "user").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        label = "USER" if role == "user" else "ASSISTANT"
        lines.append(f"{label}:\n{content[:4000]}")
    return "\n\n".join(lines)


def chat(
    message: str,
    *,
    history: list[dict[str, Any]] | None = None,
    ticker: str | None = None,
    tickers: list[str] | None = None,
    page_records: list[dict[str, Any]] | None = None,
    lang: str = "it",
    use_live_research: bool = False,
) -> dict[str, Any]:
    """
    Send a user message with optional multi-turn history.

    Returns { ok, reply, provider, error? }.
    """
    user_msg = str(message or "").strip()
    if not user_msg:
        return {"ok": False, "error": "empty_message", "reply": None}

    if page_records:
        if ticker:
            tku = ticker.strip().upper()
            page_records = [
                r
                for r in page_records
                if isinstance(r, dict) and str(r.get("ticker") or "").upper() == tku
            ]
        page_records = [r for r in page_records if isinstance(r, dict)][:_MAX_PAGE_RECORDS]

    if not ai_provider.is_available():
        info = ai_provider.provider_info()
        hint = info.get("hint_it") if lang.startswith("it") else info.get("hint_en")
        return {
            "ok": False,
            "error": "ai_unavailable",
            "reply": None,
            "hint": hint or "Configure ANTHROPIC_API_KEY, GITHUB_TOKEN, or OPENAI_API_KEY in .env",
            "provider": info,
        }

    feed_records = _load_feed_records()
    if page_records:
        context = build_page_context(
            page_records,
            user_msg,
            ticker=ticker,
            tickers=tickers,
        )
    else:
        context = build_context_block(ticker=ticker, tickers=tickers)
    hist_block = _format_history(history or [])
    scope = ticker.strip().upper() if ticker else (", ".join(tickers) if tickers else "portfolio feed")

    def _assemble_prompt(*, with_live: bool, live_text: str) -> str:
        parts = [
            "=== CATALYST FEED — STUDI E REPORT VISIBILI IN PAGINA (JSON) ===",
            context,
            f"\n=== SCOPE: {scope} ===",
        ]
        if with_live and live_text:
            parts.extend(
                [
                    "\n=== LIVE RESEARCH (PubMed + ClinicalTrials.gov, internet) ===",
                    live_text,
                ]
            )
        if hist_block:
            parts.extend(["\n=== CONVERSATION SO FAR ===", hist_block])
        parts.extend(["\n=== NEW USER MESSAGE ===", user_msg])
        return "\n".join(parts)

    live_meta: dict[str, Any] | None = None
    live_block = ""
    live_on = use_live_research and not ai_provider.github_rate_limited()
    if use_live_research and ai_provider.github_rate_limited():
        live_block = json.dumps(
            {"note": "Ricerca live saltata — cooldown GitHub Models; solo snapshot."},
            ensure_ascii=False,
        )
    if live_on:
        try:
            from catalyst_copilot_research import fetch_live_research, format_live_block

            live_timeout = float(os.environ.get("COPILOT_LIVE_RESEARCH_TIMEOUT_S", "22"))
            live_meta = _run_with_timeout(
                lambda: fetch_live_research(
                    message=user_msg,
                    ticker=ticker,
                    feed_records=feed_records,
                ),
                live_timeout,
                default={
                    "ok": False,
                    "error": "live_research_timeout",
                    "pubmed": [],
                    "ctgov": [],
                },
            )
            live_block = format_live_block(live_meta, max_chars=_MAX_LIVE_CHARS)
        except Exception as exc:
            live_meta = {"ok": False, "error": str(exc)}
            live_block = json.dumps({"error": str(exc)}, ensure_ascii=False)

    max_tokens = min(2048, int(os.environ.get("COPILOT_CHAT_MAX_TOKENS", "1536")))
    system = _system_prompt(lang=lang, live_research=live_on)
    raw = ai_provider.call_ai_chat(
        _assemble_prompt(with_live=live_on, live_text=live_block),
        system=system,
        max_tokens=max_tokens,
    )
    if not raw and live_on:
        live_on = False
        raw = ai_provider.call_ai_chat(
            _assemble_prompt(with_live=False, live_text=""),
            system=_system_prompt(lang=lang, live_research=False),
            max_tokens=max_tokens,
        )
    info = ai_provider.provider_info()

    if not raw:
        err_text = ai_provider.friendly_error_message(lang=lang) or (
            info.get("hint_it") if lang.startswith("it") else info.get("hint_en")
        )
        err_code = "rate_limit"
        if err_text and "rate" not in err_text.lower() and "limite" not in err_text.lower():
            err_code = "ai_call_failed"
        return {
            "ok": False,
            "error": err_code,
            "reply": None,
            "provider": info,
            "hint": err_text,
            "user_message": err_text,
            "github_cooldown_s": info.get("github_cooldown_s"),
        }

    sources = ["snapshot"]
    if live_on and live_meta:
        if live_meta.get("pubmed"):
            sources.append("pubmed")
        if live_meta.get("ctgov"):
            sources.append("ctgov")

    return {
        "ok": True,
        "reply": raw.strip(),
        "sources": sources,
        "live_research": live_meta,
        "provider": {
            "active": info.get("active"),
            "label": info.get("label"),
            "last_success": info.get("last_success"),
        },
    }
