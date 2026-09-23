"""
Pure parsing helpers for SEC forward catalyst calendar (Part 2).

No network I/O — unit-testable date/window/keyword extraction.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any, Literal

EventType = Literal["PDUFA", "AdCom", "Readout", "Conference", "Partnership"]
DatePrecision = Literal["exact_date", "quarter_window", "half_year_window"]
Confidence = Literal["high", "medium", "low"]

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
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

_PDUFA_HINT = re.compile(
    r"(?i)\b(?:pdufa|target\s+action\s+date|pdufa\s+date|"
    r"pdufa\s+target(?:\s+action)?\s+date)\b"
)
# NDA/BLA acceptance often carries the PDUFA target in the same 8.01 — the filing IS the calendar.
_NDA_BLA_ACCEPT = re.compile(
    r"(?i)\b(?:(?:s)?NDA|(?:s)?BLA)\b.{0,120}\b(?:accept(?:ed|ance)|filing\s+accepted)\b"
    r"|\b(?:accept(?:ed|ance)|FDA\s+accepted)\b.{0,120}\b(?:(?:s)?NDA|(?:s)?BLA)\b"
)
_ADCOM_HINT = re.compile(
    r"(?i)\b(?:advisory\s+committee|adcom|ad\s*com|odac|advisory\s+panel|"
    r"advisory\s+committee\s+meeting|scheduled\s+(?:an?\s+)?advisory)\b"
)
_READOUT_HINT = re.compile(
    r"(?i)\b(?:topline|top[- ]line|data\s+readout|primary\s+endpoint|"
    r"interim\s+(?:analysis|data|results)|read[- ]?out|"
    r"expect(?:s|ed)?\s+(?:to\s+)?(?:announce|report|release|present)\s+"
    r"(?:topline|top[- ]line|data|results|read[- ]?out)|"
    r"pivotal\s+(?:data|results)\s+expected|"
    r"data\s+(?:are|is)\s+expected|"
    r"results?\s+(?:are\s+)?expected|"
    r"anticipate(?:s|d)?\s+(?:reporting|announcing|releasing)\s+(?:data|results)|"
    r"guidance\s+(?:for|on)\s+(?:data|readout|results))\b"
)
_CONF_HINT = re.compile(
    r"(?i)\b(?:will\s+present|presentation\s+at|oral\s+presentation|"
    r"poster\s+presentation|abstract\s+(?:accepted|presentation)|"
    r"accepted\s+for\s+(?:oral|poster)\s+presentation|"
    r"data\s+(?:will\s+be\s+)?presented\s+at)\b"
)
_CONF_NAMES = re.compile(
    r"(?i)\b(?:ASCO|ASH|AACR|ESMO|SITC|EASL|AAN|ADA|ERS|ATS|EULAR|"
    r"IDWeek|WCLC|SABCS|EHA|ECTRIMS|AAO|ACC|AHA|"
    r"World\s+Congress|Annual\s+Meeting)\b"
)

# Partnership / licensing — 8-K Item 1.01 (material definitive agreement) + PR bodies.
_PARTNERSHIP_HINT = re.compile(
    r"(?i)\b(?:"
    r"(?:licen[sc]e|licensing|collaboration|co[-\s]development|co[-\s]promotion|"
    r"co[-\s]commercialization|option\s+and\s+licen[sc]e|research\s+collaboration|"
    r"development\s+and\s+(?:licen[sc]e|commercialization)|joint\s+venture|"
    r"strategic\s+(?:partnership|alliance|collaboration))\s+agreement"
    r"|(?:enter(?:ed|s|ing)?\s+into|signed|executed)\s+(?:an?|the)\s+"
    r"(?:[\w-]+\s+){0,4}?(?:licen[sc]e|licensing|collaboration|partnership|alliance|joint\s+venture)"
    r"|(?:strategic\s+)?partnership\s+with|collaborat\w+\s+with"
    r"|(?:out|in)[-\s]?licens\w+|exclusive\s+(?:worldwide\s+)?licen[sc]\w*"
    r")\b"
)
# A real deal names money or rights — filters generic "collaboration with academia" prose.
_DEAL_TERMS_HINT = re.compile(
    r"(?i)\b(?:upfront\s+(?:payment|fee|cash|consideration)|milestone\s+payments?|"
    r"(?:development|regulatory|commercial|sales)\s+milestones?|royalt(?:y|ies)|"
    r"equity\s+investment|up\s+to\s+\$\s?\d|opt(?:[-\s]?in|ion\s+(?:to|exercise|period))|"
    r"exclusive\s+(?:worldwide\s+)?(?:rights|licen[sc]e)|co[-\s]fund\w*)\b"
)
# Only forward legs land on the calendar: closing, opt-in, milestone, term start.
_DEAL_FORWARD_HINT = re.compile(
    r"(?i)\b(?:(?:expect|anticipat)\w*\s+to\s+(?:close|complete|receive|enter|sign|initiate|launch)"
    r"|clos(?:e|ing)\s+(?:is\s+)?(?:expected|anticipated)|expected\s+to\s+clos\w+"
    r"|milestone\s+(?:payment\s+)?(?:is\s+|are\s+)?(?:expected|anticipated|due|payable)"
    r"|opt(?:[-\s]?in)\s+(?:decision|deadline|window)"
    r"|option\s+(?:exercise\s+)?(?:period\s+)?(?:expires|ends|deadline|runs\s+through)"
    r"|(?:collaboration|partnership|licen[sc]e\s+agreement)\s+(?:is\s+)?expected\s+to"
    r"|(?:first|next)\s+(?:milestone|payment)\s+(?:is\s+)?expected)\b"
)
_PARTNER_ORG_SUFFIX = (
    r"Pharmaceuticals?|Pharma|Therapeutics|Biosciences?|Biotech\w*|Biopharma\w*|Sciences|"
    r"Laboratories|Labs|Medicines|Oncology|Healthcare|Health|Holdings|Group|"
    r"Incorporated|Inc\.?|Limited|Ltd\.?|LLC|L\.L\.C\.|PLC|plc|S\.A\.|S\.p\.A\.|AG|"
    r"N\.V\.|NV|GmbH|A/S|Corporation|Corp\.?|University|Institute|Hospital|Foundation"
)
_PARTNER_WITH_RE = re.compile(
    r"\b(?:with|between|from|to)\s+"
    r"((?:[A-Z][\w&'\-]*\.?\s+){0,4}"
    rf"(?:{_PARTNER_ORG_SUFFIX}))"
)

# Exact calendar dates near PDUFA/AdCom language
_EXACT_DATE = re.compile(
    r"(?i)\b("
    r"(?:january|february|march|april|may|june|july|august|september|"
    r"october|november|december|"
    r"jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)"
    r"\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+20\d{2}"
    r"|"
    r"\d{1,2}[-/]\d{1,2}[-/]20\d{2}"
    r"|"
    r"20\d{2}-\d{2}-\d{2}"
    r")\b"
)

_HALF_YEAR = re.compile(
    r"(?i)\b(?:(?:in\s+)?(?:the\s+)?(?:second|2nd)\s+half(?:\s+of)?\s*"
    r"|2H\s*|H2\s*)(20\d{2})\b"
    r"|\b(?:(?:in\s+)?(?:the\s+)?(?:first|1st)\s+half(?:\s+of)?\s*"
    r"|1H\s*|H1\s*)(20\d{2})\b"
)
_QUARTER = re.compile(
    r"(?i)\b(?:Q([1-4])\s*'?\s*(20\d{2}|'\d{2}|\d{2})"
    r"|(?:first|second|third|fourth)\s+quarter(?:\s+of)?\s*(20\d{2}))\b"
)
_MID_YEAR = re.compile(r"(?i)\bmid[- ]?(20\d{2})\b")


def parse_items_field(items: Any) -> set[str]:
    """Normalize EDGAR `items` (string or list) to item codes like {'8.01','9.01'}."""
    out: set[str] = set()
    if items is None:
        return out
    if isinstance(items, (list, tuple)):
        parts = [str(x) for x in items]
    else:
        parts = re.split(r"[,;\s]+", str(items))
    for p in parts:
        m = re.search(r"(\d+\.\d+)", p.strip())
        if m:
            out.add(m.group(1))
    return out


def items_match(items: Any, wanted: set[str]) -> bool:
    have = parse_items_field(items)
    return bool(have & wanted)


def _parse_exact_date_token(token: str) -> str | None:
    raw = token.strip().rstrip(".,;")
    # ISO
    m = re.match(r"^(20\d{2})-(\d{2})-(\d{2})$", raw)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            return None
    # US numeric
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](20\d{2})$", raw)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Prefer MDY
        try:
            return date(y, a, b).isoformat()
        except ValueError:
            try:
                return date(y, b, a).isoformat()
            except ValueError:
                return None
    # Month name
    m = re.match(
        r"(?i)^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})$",
        raw,
    )
    if m:
        mon = _MONTHS.get(m.group(1).lower())
        if not mon:
            return None
        try:
            return date(int(m.group(3)), mon, int(m.group(2))).isoformat()
        except ValueError:
            return None
    return None


def extract_exact_date_near(text: str, anchor: re.Match[str], *, radius: int = 220) -> str | None:
    """Find an exact calendar date near an anchor match (PDUFA dates can sit 6–10 months out)."""
    start = max(0, anchor.start() - 60)
    end = min(len(text), anchor.end() + radius)
    window = text[start:end]
    # Prefer dates that look like target dates (often AFTER the keyword).
    after = text[anchor.end() : min(len(text), anchor.end() + radius)]
    for chunk in (after, window):
        for m in _EXACT_DATE.finditer(chunk):
            iso = _parse_exact_date_token(m.group(1))
            if iso:
                return iso
    return None


def _append_pdufa_from_match(
    out: list[dict[str, Any]],
    *,
    text: str,
    m: re.Match[str],
    ticker: str,
    source_form: str,
    source_filing_url: str,
    extracted_at: str,
    accession: str,
    filing_date: str | None,
) -> None:
    iso = extract_exact_date_near(text, m, radius=260)
    if not iso:
        return
    out.append(
        make_entry(
            ticker=ticker,
            event_type="PDUFA",
            date_precision="exact_date",
            date_value=iso,
            window_label=None,
            source_filing_url=source_filing_url,
            source_form=source_form,
            source_item="8.01",
            extracted_at=extracted_at,
            raw_snippet=_snippet_around(text, m),
            confidence="high",
            accession=accession,
            filing_date=filing_date,
        )
    )

def extract_window_label(text: str) -> tuple[str | None, DatePrecision | None]:
    """Return (window_label, precision). Never invents an exact date_value."""
    if not text:
        return None, None
    m = _HALF_YEAR.search(text)
    if m:
        y = m.group(1) or m.group(2)
        # Which half?
        span = m.group(0).lower()
        if "1h" in span or "h1" in span or "first" in span or "1st" in span:
            return f"1H {y}", "half_year_window"
        return f"2H {y}", "half_year_window"
    m = _QUARTER.search(text)
    if m:
        if m.group(1):
            q = m.group(1)
            yraw = m.group(2)
            if len(yraw) == 2 or yraw.startswith("'"):
                y = "20" + yraw.replace("'", "")[-2:]
            else:
                y = yraw
            return f"Q{q} {y}", "quarter_window"
        # "fourth quarter of 2026"
        y = m.group(3)
        word = m.group(0).lower()
        qmap = {"first": "1", "second": "2", "third": "3", "fourth": "4"}
        for w, q in qmap.items():
            if w in word:
                return f"Q{q} {y}", "quarter_window"
    m = _MID_YEAR.search(text)
    if m:
        return f"mid-{m.group(1)}", "half_year_window"
    return None, None


def extract_partner_name(text: str) -> str | None:
    """Counterparty of a deal ("license agreement with Novartis Pharma AG" → that name)."""
    for m in _PARTNER_WITH_RE.finditer(text or ""):
        name = re.sub(r"\s+", " ", m.group(1)).strip(" ,.;")
        if len(name) < 4 or len(name) > 60:
            continue
        if re.match(r"(?i)^(?:the|a|an|this|its|our|such|certain)\b", name):
            continue
        return name
    return None


def _snippet_around(text: str, m: re.Match[str], *, radius: int = 120) -> str:
    a = max(0, m.start() - radius)
    b = min(len(text), m.end() + radius)
    snip = re.sub(r"\s+", " ", text[a:b]).strip()
    return snip[:280]


def entry_id(
    *,
    ticker: str,
    event_type: str,
    accession: str,
    date_value: str | None,
    window_label: str | None,
    raw_snippet: str,
) -> str:
    base = "|".join(
        [
            ticker.upper(),
            event_type,
            accession or "",
            date_value or "",
            window_label or "",
            hashlib.sha1((raw_snippet or "")[:160].encode("utf-8", errors="ignore")).hexdigest()[:10],
        ]
    )
    return base


def make_entry(
    *,
    ticker: str,
    event_type: EventType,
    date_precision: DatePrecision,
    date_value: str | None,
    window_label: str | None,
    source_filing_url: str,
    source_form: str,
    source_item: str | None,
    extracted_at: str,
    raw_snippet: str,
    confidence: Confidence,
    accession: str = "",
    filing_date: str | None = None,
) -> dict[str, Any]:
    # Honesty guard: never keep an exact date on window precision.
    if date_precision != "exact_date":
        date_value = None
    if date_precision == "exact_date":
        window_label = None
    eid = entry_id(
        ticker=ticker,
        event_type=event_type,
        accession=accession,
        date_value=date_value,
        window_label=window_label,
        raw_snippet=raw_snippet,
    )
    return {
        "id": eid,
        "ticker": ticker.upper(),
        "event_type": event_type,
        "date_precision": date_precision,
        "date_value": date_value,
        "window_label": window_label,
        "source_filing_url": source_filing_url,
        "source_form": source_form,
        "source_item": source_item,
        "extracted_at": extracted_at,
        "filing_date": filing_date,
        "accession": accession,
        "raw_snippet": raw_snippet,
        "confidence": confidence,
    }


def extract_events_from_text(
    text: str,
    *,
    ticker: str,
    source_form: str,
    source_items: Any,
    source_filing_url: str,
    extracted_at: str,
    accession: str = "",
    filing_date: str | None = None,
) -> list[dict[str, Any]]:
    """
    Extract calendar entries from one filing body (or 10-Q section).

    Item filtering is the caller's job for 8-K; for 10-Q pass items=None
    and only Readout extraction runs (no PDUFA/AdCom/Conference without 8.01).
    """
    if not text or not ticker:
        return []
    items = parse_items_field(source_items)
    is_8k = str(source_form).upper().startswith("8-K")
    is_10q = str(source_form).upper().startswith("10-Q")
    out: list[dict[str, Any]] = []

    # 1–2 PDUFA / AdCom — require 8.01 when form is 8-K
    # Best case: the 8-K itself is the calendar (NDA accepted → PDUFA target date).
    allow_801 = (not is_8k) or ("8.01" in items) or (not items)
    if allow_801 and is_8k:
        for m in _PDUFA_HINT.finditer(text):
            _append_pdufa_from_match(
                out,
                text=text,
                m=m,
                ticker=ticker,
                source_form=source_form,
                source_filing_url=source_filing_url,
                extracted_at=extracted_at,
                accession=accession,
                filing_date=filing_date,
            )
        # NDA/BLA acceptance + nearby exact date (often "target action date of …")
        for m in _NDA_BLA_ACCEPT.finditer(text):
            # Prefer an explicit target-action / PDUFA phrase in the local window.
            local = text[max(0, m.start() - 40) : min(len(text), m.end() + 280)]
            if not (_PDUFA_HINT.search(local) or re.search(r"(?i)\btarget\s+action\b", local)):
                # Still accept if an exact future-ish date sits right after acceptance language.
                if not extract_exact_date_near(text, m, radius=200):
                    continue
            _append_pdufa_from_match(
                out,
                text=text,
                m=m,
                ticker=ticker,
                source_form=source_form,
                source_filing_url=source_filing_url,
                extracted_at=extracted_at,
                accession=accession,
                filing_date=filing_date,
            )
        for m in _ADCOM_HINT.finditer(text):
            iso = extract_exact_date_near(text, m, radius=200)
            if not iso:
                continue
            out.append(
                make_entry(
                    ticker=ticker,
                    event_type="AdCom",
                    date_precision="exact_date",
                    date_value=iso,
                    window_label=None,
                    source_filing_url=source_filing_url,
                    source_form=source_form,
                    source_item="8.01",
                    extracted_at=extracted_at,
                    raw_snippet=_snippet_around(text, m),
                    confidence="high",
                    accession=accession,
                    filing_date=filing_date,
                )
            )

    # 3 Readout — 8-K 2.02/7.01/8.01 (earnings + other events often carry windows) or 10-Q
    # Windows only (2H / Qx) — never invent an exact day; history accumulates as guidance narrows.
    allow_readout = (
        is_10q
        or (not is_8k)
        or bool(items & {"2.02", "7.01", "8.01"})
        or (is_8k and not items)
    )
    if allow_readout:
        for m in _READOUT_HINT.finditer(text):
            local = text[max(0, m.start() - 80) : min(len(text), m.end() + 260)]
            label, prec = extract_window_label(local)
            if not label or not prec:
                label, prec = extract_window_label(text[m.start() : m.end() + 320])
            if not label or not prec:
                continue
            item_code = None
            if "2.02" in items:
                item_code = "2.02"
            elif "7.01" in items:
                item_code = "7.01"
            elif "8.01" in items:
                item_code = "8.01"
            out.append(
                make_entry(
                    ticker=ticker,
                    event_type="Readout",
                    date_precision=prec,
                    date_value=None,
                    window_label=label,
                    source_filing_url=source_filing_url,
                    source_form=source_form,
                    source_item=item_code,
                    extracted_at=extracted_at,
                    raw_snippet=_snippet_around(text, m),
                    confidence="medium",
                    accession=accession,
                    filing_date=filing_date,
                )
            )

    # 4 Conference — date of congress is public months ahead; content of data is not.
    # Prefer exact congress date when stated; otherwise keep confirmation with low/medium confidence.
    allow_conf = (not is_8k) or bool(items & {"7.01", "8.01"}) or (is_8k and not items)
    if allow_conf and is_8k:
        for m in _CONF_HINT.finditer(text):
            local = text[max(0, m.start() - 40) : min(len(text), m.end() + 220)]
            has_name = bool(_CONF_NAMES.search(local) or _CONF_NAMES.search(text[m.start() : m.end() + 140]))
            if not has_name:
                continue  # avoid noise without a known congress name
            iso = extract_exact_date_near(text, m, radius=200)
            label, wprec = extract_window_label(local)
            if iso:
                prec: DatePrecision = "exact_date"
                conf: Confidence = "medium"  # date known; data content unknown
                label = None
            elif label and wprec:
                prec = wprec
                conf = "low"
            else:
                # No usable date/window — skip (was polluting Calendar with undated rows).
                continue
            item_code = "7.01" if "7.01" in items else ("8.01" if "8.01" in items else None)
            out.append(
                make_entry(
                    ticker=ticker,
                    event_type="Conference",
                    date_precision=prec,
                    date_value=iso,
                    window_label=None if iso else label,
                    source_filing_url=source_filing_url,
                    source_form=source_form,
                    source_item=item_code,
                    extracted_at=extracted_at,
                    raw_snippet=_snippet_around(text, m),
                    confidence=conf,
                    accession=accession,
                    filing_date=filing_date,
                )
            )

    # 5 Partnership — license / collaboration deals (8-K Item 1.01, Ex-99 PR, 10-Q).
    # Forward legs only (closing, opt-in, milestone): the signature date is already past
    # by the time we parse it and `entry_is_current` would drop it.
    allow_partner = (
        is_10q
        or (not is_8k)
        or bool(items & {"1.01", "7.01", "8.01"})
        or (is_8k and not items)
    )
    if allow_partner:
        kept = 0
        for m in _PARTNERSHIP_HINT.finditer(text):
            if kept >= 2:
                break
            local = text[max(0, m.start() - 200) : min(len(text), m.end() + 420)]
            if not _DEAL_TERMS_HINT.search(local):
                continue
            fwd = _DEAL_FORWARD_HINT.search(local)
            if not fwd:
                continue
            label, wprec = extract_window_label(local[fwd.start() :])
            if not label:
                label, wprec = extract_window_label(local)
            iso: str | None = None
            dm = _EXACT_DATE.search(local[fwd.end() : fwd.end() + 180])
            if dm:
                cand = _parse_exact_date_token(dm.group(1))
                # Guard: never reuse the "On <date>, the Company entered into…" signature date.
                if cand and (not filing_date or cand > str(filing_date)[:10]):
                    iso = cand
            item_code = next((c for c in ("1.01", "8.01", "7.01") if c in items), None)
            if iso:
                prec_p: DatePrecision = "exact_date"
            elif label and wprec:
                prec_p = wprec
            else:
                continue
            entry = make_entry(
                ticker=ticker,
                event_type="Partnership",
                date_precision=prec_p,
                date_value=iso,
                window_label=None if iso else label,
                source_filing_url=source_filing_url,
                source_form=source_form,
                source_item=item_code,
                extracted_at=extracted_at,
                raw_snippet=_snippet_around(text, m, radius=160),
                confidence="medium" if item_code == "1.01" else "low",
                accession=accession,
                filing_date=filing_date,
            )
            partner = extract_partner_name(local)
            if partner:
                entry["partner"] = partner
            out.append(entry)
            kept += 1

    return _dedupe_batch(out)


def _dedupe_batch(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    exact_seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for e in entries:
        dv = str(e.get("date_value") or "")
        et = str(e.get("event_type") or "")
        tk = str(e.get("ticker") or "")
        if dv and et:
            ek = f"{tk}|{et}|{dv}"
            if ek in exact_seen:
                continue
            exact_seen.add(ek)
        k = str(e.get("id") or "")
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


def sort_key_for_entry(e: dict[str, Any]) -> tuple:
    """Sort: exact dates first by date_value, then windows by label year."""
    dv = e.get("date_value")
    if dv:
        return (0, str(dv), e.get("ticker") or "")
    wl = str(e.get("window_label") or "")
    ym = re.search(r"(20\d{2})", wl)
    y = ym.group(1) if ym else "9999"
    return (1, y, wl, e.get("ticker") or "")


def window_label_end_iso(label: str | None) -> str | None:
    """Inclusive end date for readout/conference window labels (Q4/2H/mid)."""
    s = (label or "").strip()
    if not s:
        return None
    m = re.match(r"(?i)^Q([1-4])\s*(20\d{2})$", s)
    if m:
        q = int(m.group(1))
        y = int(m.group(2))
        end_month = q * 3
        end_day = 28 if end_month == 2 else (30 if end_month in (4, 6, 9, 11) else 31)
        try:
            return date(y, end_month, end_day).isoformat()
        except ValueError:
            return None
    m = re.match(r"(?i)^(?:2H|H2)\s*(20\d{2})$", s)
    if m:
        return f"{m.group(1)}-12-31"
    m = re.match(r"(?i)^(?:1H|H1)\s*(20\d{2})$", s)
    if m:
        return f"{m.group(1)}-06-30"
    m = re.match(r"(?i)^mid[- ]?(20\d{2})$", s)
    if m:
        return f"{m.group(1)}-07-31"
    return None


def entry_is_current(e: dict[str, Any], today: date | None = None) -> bool:
    """
    Keep exact dates on/after today; keep open windows (end ≥ today).
    Drop rows with neither date_value nor a parseable window_label.
    """
    ref = today or date.today()
    dv = str(e.get("date_value") or "")[:10]
    if re.match(r"^20\d{2}-\d{2}-\d{2}$", dv):
        try:
            return datetime.strptime(dv, "%Y-%m-%d").date() >= ref
        except ValueError:
            return False
    end = window_label_end_iso(str(e.get("window_label") or "") or None)
    if end:
        try:
            return datetime.strptime(end, "%Y-%m-%d").date() >= ref
        except ValueError:
            return False
    return False
