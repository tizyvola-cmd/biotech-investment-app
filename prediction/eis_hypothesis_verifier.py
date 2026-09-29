"""
Re-verification pass for anticipated EIS events.

Reads the pending-verification registry, and for every hypothesis whose expected
window has opened goes looking for real evidence:

  1. PubMed (E-utilities) — an actual paper or abstract in the window
  2. ClinicalTrials.gov — results posted on the tracked NCT
  3. a targeted AI pass — allowed, but its answer is discarded unless it carries a
     resolvable source (URL, DOI, PMID or NCT id)

A hypothesis that resolves becomes a normal clinical event with a real date and a
real link, and is scored by the standard EIS path. One that never resolves expires
when its window closes: kept for the record, never scored.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from typing import Any

from prediction.eis_pending_verification import (
    STATUS_CONFIRMED,
    STATUS_EXPIRED,
    STATUS_PENDING,
    apply_outcomes,
    due_hypotheses,
    is_expired,
)

# Search a little wider than the stated window: congress dates slip.
_SEARCH_PAD_DAYS = 45
_HARD_SOURCE_RE = re.compile(r"(https?://|10\.\d{4,}/\S+|\bpmid[:\s]*\d+|\bnct\d{8}\b)", re.I)
_REVIEW_TITLE_RE = re.compile(
    r"\b(review|overview|landscape|perspectives?|emerging therapies|state of the art"
    r"|meta-analysis|systematic review|editorial|commentary)\b",
    re.I,
)
# Reviews often hide behind a neutral title and only declare themselves in the
# abstract ("This review describes the litifilimab development program…").
_REVIEW_ABSTRACT_RE = re.compile(
    r"\b((this|our|the present)\s+(narrative\s+|systematic\s+|scoping\s+)?review"
    r"|we review\b|review (describes|summarizes|summarises|discusses|provides))",
    re.I,
)


def _as_date(value: Any) -> date | None:
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def _search_window(item: dict[str, Any], *, as_of: date) -> tuple[str, str]:
    start = _as_date(item.get("expected_window_start")) or _as_date(item.get("hypothesis_date"))
    end = _as_date(item.get("expected_window_end")) or _as_date(item.get("hypothesis_date"))
    start = (start or as_of - timedelta(days=180)) - timedelta(days=_SEARCH_PAD_DAYS)
    end = min((end or as_of) + timedelta(days=_SEARCH_PAD_DAYS), as_of)
    if end < start:
        end = start
    return start.isoformat(), end.isoformat()


def _drug_tokens(item: dict[str, Any]) -> list[str]:
    raw = str(item.get("drug") or "")
    parts = re.split(r"[+/,;()]| and ", raw)
    return [p.strip() for p in parts if len(p.strip()) >= 3][:4]


def _pubmed_publication_date(pmid: str) -> str | None:
    """Exact publication date via E-utilities esummary.

    efetch only exposes the year, and a made-up day is precisely the bug this
    whole gate exists to prevent — better no date than an invented one.
    """
    try:
        import urllib.parse

        from pubmed_eutils_fetch import _http_get_xml

        query = urllib.parse.urlencode({"db": "pubmed", "id": pmid, "retmode": "xml"})
        root = _http_get_xml(
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?{query}"
        )
        if root is None:
            return None
        wanted = ("sortpubdate", "pubdate", "epubdate")
        found: dict[str, str] = {}
        for el in root.iter():
            if el.tag.split("}")[-1] != "Item":
                continue
            name = str(el.attrib.get("Name") or "").lower()
            if name in wanted and el.text:
                found.setdefault(name, el.text.strip())
        for name in wanted:
            parsed = _parse_pubmed_date(found.get(name, ""))
            if parsed:
                return parsed
    except Exception:  # noqa: BLE001 — best effort, never fatal
        return None
    return None


_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
        start=1,
    )
}


def _parse_pubmed_date(raw: str) -> str | None:
    """`2024/02/01 00:00` and `2024 Feb 1` — day-precision only."""
    text = str(raw or "").strip()
    if not text:
        return None
    numeric = re.match(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", text)
    if numeric:
        y, m, d = (int(g) for g in numeric.groups())
        return f"{y:04d}-{m:02d}-{d:02d}"
    named = re.match(r"(\d{4})\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2})", text)
    if named:
        month = _MONTHS.get(named.group(2).lower())
        if month:
            return f"{int(named.group(1)):04d}-{month:02d}-{int(named.group(3)):02d}"
    return None


def _pubmed_evidence(item: dict[str, Any], *, as_of: date) -> dict[str, Any] | None:
    """A real paper in the window mentioning the tracked drug."""
    try:
        from pubmed_eutils_fetch import search_pubmed_pre_cd_window
    except Exception:
        return None

    tokens = _drug_tokens(item)
    if not tokens and not item.get("company"):
        return None
    win_start, win_end = _search_window(item, as_of=as_of)
    try:
        bundle = search_pubmed_pre_cd_window(
            company=str(item.get("company") or ""),
            drug_tokens=tokens,
            window_start=win_start,
            window_end=win_end,
            retmax=8,
        )
    except Exception as exc:  # noqa: BLE001 — network flakiness must not kill the pass
        print(f"[EISVerify][WARN] PubMed failed for {item.get('ticker')}: {exc}", flush=True)
        return None

    hay = [t.lower() for t in tokens]
    company_terms = [w.lower() for w in str(item.get("company") or "").split() if len(w) >= 5]
    for hit in bundle.get("hits") or []:
        title = str(hit.get("title") or "").strip()
        low_title = title.lower()
        # The asset must headline the paper. A review that merely name-drops the
        # drug in its abstract is not the awaited readout.
        if hay:
            if not any(t in low_title for t in hay):
                continue
        elif not any(c in low_title for c in company_terms):
            continue
        abstract = str(hit.get("abstract") or "").strip()
        if _REVIEW_TITLE_RE.search(low_title) or _REVIEW_ABSTRACT_RE.search(abstract[:400]):
            continue
        pmid = str(hit.get("pmid") or "").strip()
        if not pmid:
            continue
        # None when the exact day is unknown: the event is then stored without
        # price attribution rather than pinned to a guessed date.
        pub_date = _pubmed_publication_date(pmid)
        # PubMed filters on print date but reports the electronic one, so a hit can
        # resolve outside the window it was searched in.
        if pub_date and not (win_start <= pub_date <= win_end):
            continue
        return {
            "source": "pubmed",
            "link": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            "event_date": pub_date,
            "date_precision": "day" if pub_date else "unknown",
            "pub_year": str(hit.get("pub_year") or ""),
            "title": title[:200],
            "summary": abstract[:600],
            "source_type": "publication",
            "venue": "PubMed",
        }
    return None


def _ctgov_evidence(item: dict[str, Any], *, as_of: date) -> dict[str, Any] | None:
    """Results posted on the tracked NCT after the hypothesis was filed."""
    nct = str(item.get("nct_id") or "").strip().upper()
    if not re.fullmatch(r"NCT\d{8}", nct):
        return None
    try:
        from clinical_trial_summary import _ctgov_get
    except Exception:
        return None
    study = _ctgov_get(nct)
    if not isinstance(study, dict):
        return None
    protocol = study.get("protocolSection") or {}
    status = protocol.get("statusModule") or {}
    if not (study.get("hasResults") or study.get("resultsSection")):
        return None
    posted = (
        (status.get("resultsFirstPostDateStruct") or {}).get("date")
        or (status.get("resultsFirstSubmitDateStruct") or {}).get("date")
        or ""
    )
    posted_day = _as_date(posted)
    created = _as_date(str(item.get("created_at") or "")[:10])
    if posted_day and created and posted_day < created:
        return None  # results predate the hypothesis — not the awaited readout
    title = (
        (protocol.get("identificationModule") or {}).get("briefTitle")
        or f"{nct} results posted"
    )
    return {
        "source": "ctgov",
        "link": f"https://clinicaltrials.gov/study/{nct}",
        "event_date": (posted_day or as_of).isoformat(),
        "title": f"{nct} — results posted: {str(title)[:140]}",
        "summary": f"ClinicalTrials.gov results section published for {nct}.",
        "source_type": "ctgov",
        "venue": f"ClinicalTrials.gov {nct}",
    }


_AI_VERIFY_SYSTEM = (
    "You verify whether a specific, previously hypothesised biotech event actually happened. "
    "You are a fact-checker, not a forecaster. Answer with strict JSON only. "
    "Report found=true ONLY when you can cite a real, resolvable source: a URL, a DOI, a PMID "
    "or an NCT id. If you cannot cite one, report found=false — a plausible guess is a failure, "
    "not an answer. Never fabricate a link, a date or an abstract number."
)

_AI_VERIFY_PROMPT = """\
Hypothesis filed on {created_at} for {company} ({ticker}):

  Title   : {title}
  Asset   : {drug}
  Venue   : {venue}
  Window  : {window_start} → {window_end}
  Look for: {hint}

Today is {today}. Did this event actually occur? Search your knowledge for the real
abstract, poster, publication, press release or filing.

Rules:
- found=true requires a citable source (URL / DOI / PMID / NCT). No source ⇒ found=false.
- event_date must be the real date of the event, never an estimate.
- Do not report a different event as if it were this one.

Return ONLY valid JSON:
{{
  "found": true | false,
  "link": "URL, DOI, PMID: 12345678 or NCT id — required when found=true",
  "event_date": "YYYY-MM-DD or null",
  "title": "real title of the event or null",
  "summary": "1-2 sentences with hard numbers when reported, or null",
  "source_type": "congress | publication | press_release | ctgov | regulatory",
  "venue": "congress or journal name, or null",
  "confidence": "high | medium | low"
}}
"""


def _ai_evidence(item: dict[str, Any], *, as_of: date) -> dict[str, Any] | None:
    """Targeted AI check — accepted only when it produces a resolvable source."""
    try:
        import ai_provider

        from clinical_pre_cd_enrichment import _parse_ai_json
    except Exception:
        return None
    if not ai_provider.is_available():
        return None

    win_start, win_end = _search_window(item, as_of=as_of)
    prompt = _AI_VERIFY_PROMPT.format(
        created_at=str(item.get("created_at") or "")[:10],
        company=item.get("company") or item.get("ticker"),
        ticker=item.get("ticker"),
        title=item.get("title"),
        drug=item.get("drug") or "N/D",
        venue=item.get("venue") or "N/D",
        window_start=win_start,
        window_end=win_end,
        hint=item.get("verification_hint") or item.get("title"),
        today=as_of.isoformat(),
    )
    raw = ai_provider.call_ai(
        prompt, system=_AI_VERIFY_SYSTEM, max_tokens=700, task="clinical_kpi"
    )
    data = _parse_ai_json(raw or "")
    if not isinstance(data, dict) or not data.get("found"):
        return None

    link = str(data.get("link") or "").strip()
    if not _HARD_SOURCE_RE.search(link):
        print(
            f"[EISVerify] {item.get('ticker')}: AI claimed a hit without a resolvable "
            f"source — discarded ({link[:60] or 'no link'})",
            flush=True,
        )
        return None
    event_day = _as_date(data.get("event_date"))
    if not event_day or event_day > as_of:
        return None

    return {
        "source": "ai",
        "link": link,
        "event_date": event_day.isoformat(),
        "title": str(data.get("title") or item.get("title") or "").strip()[:200],
        "summary": str(data.get("summary") or "").strip()[:600],
        "source_type": str(data.get("source_type") or "publication").strip(),
        "venue": str(data.get("venue") or item.get("venue") or "").strip(),
        "confidence": str(data.get("confidence") or "medium"),
    }


def _confirmed_event_from_evidence(
    item: dict[str, Any],
    evidence: dict[str, Any],
) -> dict[str, Any]:
    drug = str(item.get("drug") or "—") or "—"
    return {
        "event_date": evidence.get("event_date"),
        "event_title": evidence.get("title") or item.get("title"),
        "summary": evidence.get("summary") or "",
        "drug": drug,
        "asset": drug,
        "source_type": evidence.get("source_type") or "publication",
        "publication_venue": evidence.get("venue") or "",
        "link": evidence["link"],
        "link_label": evidence.get("venue") or "Source",
        "sentiment": 0,
        "impact_note": (
            "Ipotesi verificata: l'evento atteso è stato confermato da fonte reale "
            f"({evidence.get('source')})."
        ),
        "confirmation_status": "confirmed",
        "confirmed_from_hypothesis": item.get("id"),
        "reference_verified": True,
        "reference_match": "verified_hypothesis",
    }


def _materialize_confirmed_events(resolved: list[tuple[dict[str, Any], dict[str, Any]]]) -> int:
    """Write confirmed events into the enrichment snapshot and score them."""
    if not resolved:
        return 0
    from clinical_pre_cd_enrichment import (
        _SNAPSHOT_PATH,
        _enrich_clinical_events_market,
        _write_snapshot,
    )

    try:
        snap = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[EISVerify][WARN] snapshot unreadable, events not stored: {exc}", flush=True)
        return 0

    records = [r for r in (snap.get("records") or []) if isinstance(r, dict)]
    written = 0
    vol_cache: dict[str, float | None] = {}

    for item, evidence in resolved:
        ticker = str(item.get("ticker") or "").upper()
        nct = str(item.get("nct_id") or "").upper()
        target = None
        for rec in records:
            if str(rec.get("ticker") or "").upper() != ticker:
                continue
            if nct and str(rec.get("nct_id") or "").upper() == nct:
                target = rec
                break
            if target is None:
                target = rec
        if target is None:
            continue
        event = _confirmed_event_from_evidence(item, evidence)
        scored = _enrich_clinical_events_market(ticker, [event], vol_cache=vol_cache)
        events = list(target.get("clinical_events") or [])
        key = (str(event.get("event_date")), str(event["event_title"])[:50])
        if any((str(e.get("event_date")), str(e.get("event_title"))[:50]) == key for e in events):
            continue
        events.extend(scored)
        target["clinical_events"] = events
        target["timeline_events"] = events
        written += 1

    if written:
        _write_snapshot(records)
    return written


def verify_pending_hypotheses(
    *,
    tickers: set[str] | None = None,
    limit: int | None = None,
    force: bool = False,
    allow_ai: bool = True,
    as_of: date | None = None,
) -> dict[str, Any]:
    """Run one verification round over the hypotheses whose window has opened."""
    today = as_of or date.today()
    queue = due_hypotheses(as_of=today, tickers=tickers, force=force, limit=limit)
    outcomes: dict[str, dict[str, Any]] = {}
    resolved: list[tuple[dict[str, Any], dict[str, Any]]] = []
    by_source: dict[str, int] = {}

    for item in queue:
        evidence = _pubmed_evidence(item, as_of=today) or _ctgov_evidence(item, as_of=today)
        if evidence is None and allow_ai:
            evidence = _ai_evidence(item, as_of=today)

        if evidence:
            src = str(evidence.get("source"))
            by_source[src] = by_source.get(src, 0) + 1
            outcomes[str(item["id"])] = {
                "status": STATUS_CONFIRMED,
                "resolution": {**evidence, "verified_at": datetime.now().isoformat()},
            }
            resolved.append((item, evidence))
            print(
                f"[EISVerify] {item.get('ticker')}: confermata via {src} — {evidence['link'][:80]}",
                flush=True,
            )
        elif is_expired(item, as_of=today):
            outcomes[str(item["id"])] = {"status": STATUS_EXPIRED, "resolution": None}
        else:
            outcomes[str(item["id"])] = {"status": STATUS_PENDING, "resolution": None}

    counts = apply_outcomes(outcomes) if outcomes else {}
    materialized = _materialize_confirmed_events(resolved)
    return {
        "checked": len(queue),
        "confirmed": counts.get(STATUS_CONFIRMED, 0),
        "expired": counts.get(STATUS_EXPIRED, 0),
        "still_pending": counts.get(STATUS_PENDING, 0),
        "events_written": materialized,
        "by_source": by_source,
        "as_of": today.isoformat(),
    }


__all__ = ["verify_pending_hypotheses"]
