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

try:
    import ai_secrets_store

    ai_secrets_store.load_and_apply()
except Exception:
    pass

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


def _recent_8k_filings(
    submissions: dict[str, Any],
    max_n: int = 10,
    *,
    include_6k: bool = False,
    extra_forms: set[str] | frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """Return most recent current-report-style filings from EDGAR submissions JSON.

    Always includes 8-K / 8-K/A. Optional 6-K and any ``extra_forms`` (e.g. 424B5, DEF 14A).
    """
    recent = submissions.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accessions = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])
    items_list = recent.get("items", [])
    descs = recent.get("primaryDocDescription", [])

    allowed: set[str] = {"8-K", "8-K/A"}
    if include_6k:
        allowed |= {"6-K", "6-K/A"}
    if extra_forms:
        allowed |= {str(x).strip() for x in extra_forms if str(x).strip()}

    result: list[dict[str, Any]] = []
    for i, ft in enumerate(forms):
        if ft in allowed and len(result) < max_n:
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


def _extract_text_from_html(html: str, *, max_chars: int | None = None) -> str:
    limit = MAX_TEXT_CHARS if max_chars is None else max(1000, int(max_chars))
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(
        ["script", "style", "noscript", "svg", "iframe", "form", "button"]
    ):
        tag.decompose()
    # Prefer article body over site chrome (BioSpace keeps Subscribe/Menu outside <nav>).
    root = (
        soup.find("article")
        or soup.find("main")
        or soup.find(attrs={"role": "main"})
        or soup.find(class_=re.compile(r"(?i)article[-_]?body|post[-_]?content|entry[-_]?content"))
        or soup
    )
    for tag in list(root.find_all(["nav", "footer", "aside", "header"])):
        # Keep in-article headers (h1 wrappers); drop site chrome headers.
        if tag.name == "header" and tag.find("h1"):
            continue
        tag.decompose()
    for tag in list(root.find_all(True)):
        attrs = getattr(tag, "attrs", None) or {}
        raw_cls = attrs.get("class") if isinstance(attrs, dict) else None
        if isinstance(raw_cls, (list, tuple)):
            cls = " ".join(str(x) for x in raw_cls).lower()
        else:
            cls = str(raw_cls or "").lower()
        tid = str(attrs.get("id") or "").lower() if isinstance(attrs, dict) else ""
        role = str(attrs.get("role") or "").lower() if isinstance(attrs, dict) else ""
        if role in {"navigation", "banner", "search", "complementary"}:
            tag.decompose()
            continue
        if re.search(
            r"(?i)(nav|menu|subscribe|newsletter|cookie|modal|popup|share[-_]?bar|"
            r"social[-_]?share|site[-_]?header|global[-_]?header)",
            f"{cls} {tid}",
        ):
            tag.decompose()
    text = root.get_text(separator=" ", strip=True)
    text = re.sub(r"\s{3,}", "\n\n", text)
    return text[:limit]


def _extract_html_page_title(html: str) -> str | None:
    """og:title / twitter:title / h1 — never nav chrome."""
    soup = BeautifulSoup(html or "", "html.parser")
    for key, attr in (
        ("og:title", "property"),
        ("twitter:title", "name"),
        ("twitter:title", "property"),
    ):
        tag = soup.find("meta", attrs={attr: key})
        if tag and tag.get("content"):
            t = re.sub(r"\s+", " ", str(tag.get("content") or "")).strip()
            t = re.sub(r"\s*[-|–]\s*BioSpace\s*$", "", t, flags=re.I).strip()
            if len(t) >= 24:
                return t[:300]
    h1 = soup.find("h1")
    if h1:
        t = re.sub(r"\s+", " ", h1.get_text(" ", strip=True)).strip()
        if len(t) >= 24 and not re.match(
            r"(?i)^(subscribe|menu|show\s+search|search\s+query)\b", t
        ):
            return t[:300]
    title_tag = soup.find("title")
    if title_tag:
        t = re.sub(r"\s+", " ", title_tag.get_text(" ", strip=True)).strip()
        t = re.sub(r"\s*[-|–]\s*BioSpace\s*$", "", t, flags=re.I).strip()
        if len(t) >= 24 and not re.match(
            r"(?i)^(subscribe|menu|show\s+search)\b", t
        ):
            return t[:300]
    return None


def _dehyphenate_line_breaks(text: str) -> str:
    """Join PDF soft hyphens split across line breaks (tetrahy- drocannabinol)."""

    def _join(m: re.Match[str]) -> str:
        left, right = m.group(1), m.group(2)
        if right[:1].islower():
            return left + right
        return f"{left}- {right}"

    out = text or ""
    out = re.sub(r"(\w)-\s*\n\s*(\w)", _join, out)
    out = re.sub(r"(\w)-\s+(\w)", _join, out)
    return out


def _words_to_reading_order(words: list[dict[str, Any]], *, y_tolerance: float = 3.0) -> str:
    if not words:
        return ""
    ordered = sorted(
        words,
        key=lambda w: (round(float(w.get("top") or 0), 1), float(w.get("x0") or 0)),
    )
    lines: list[str] = []
    cur_top: float | None = None
    cur_parts: list[str] = []
    for w in ordered:
        top = float(w.get("top") or 0)
        token = str(w.get("text") or "").strip()
        if not token:
            continue
        if cur_top is None or abs(top - cur_top) <= y_tolerance:
            cur_parts.append(token)
            cur_top = top if cur_top is None else cur_top
        else:
            lines.append(" ".join(cur_parts))
            cur_parts = [token]
            cur_top = top
    if cur_parts:
        lines.append(" ".join(cur_parts))
    return "\n".join(lines)


def _extract_pdf_page_text(page: Any) -> str:
    """Column-aware page text for journal PDFs (avoids interleaved two-column garbage)."""
    try:
        words = page.extract_words(use_text_flow=True, keep_blank_chars=False) or []
    except TypeError:
        words = page.extract_words() or []
    if len(words) < 30:
        plain = page.extract_text() or ""
        return _dehyphenate_line_breaks(plain)
    width = float(getattr(page, "width", 0) or 0)
    if width <= 0:
        plain = page.extract_text() or ""
        return _dehyphenate_line_breaks(plain)
    mid = width * 0.52
    left = [w for w in words if float(w.get("x0") or 0) < mid]
    right = [w for w in words if float(w.get("x0") or 0) >= mid]
    if len(left) >= 20 and len(right) >= 20:
        return _dehyphenate_line_breaks(
            _words_to_reading_order(left) + "\n\n" + _words_to_reading_order(right)
        )
    plain = page.extract_text() or ""
    return _dehyphenate_line_breaks(plain)


def repair_pdf_text(text: str) -> str:
    """Normalize extracted PDF text while preserving paragraph/section line breaks."""
    s = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    s = _dehyphenate_line_breaks(s)
    lines: list[str] = []
    for ln in s.split("\n"):
        ln = re.sub(r"[ \t]+", " ", ln).strip()
        if ln:
            lines.append(ln)
    s = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def _extract_text_from_pdf(content: bytes, *, max_chars: int | None = None) -> str:
    limit = MAX_TEXT_CHARS if max_chars is None else max(1000, int(max_chars))
    if not content:
        return ""
    # pdfplumber (layout-aware)
    try:
        import io
        import pdfplumber

        with pdfplumber.open(io.BytesIO(content)) as pdf:
            parts: list[str] = []
            for page in pdf.pages[:30]:
                t = _extract_pdf_page_text(page)
                parts.append(t)
                if sum(len(p) for p in parts) >= limit:
                    break
        text = repair_pdf_text("\n\n".join(parts))[:limit].strip()
        if len(text) >= 40:
            return text
    except Exception as exc:
        print(f"[CatalystFeed] PDF pdfplumber error: {exc}", flush=True)

    # pypdf fallback (common on scientific PDFs when pdfplumber yields empty)
    try:
        import io
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        parts = []
        for page in reader.pages[:30]:
            t = page.extract_text() or ""
            parts.append(t)
            if sum(len(p) for p in parts) >= limit:
                break
        return repair_pdf_text("\n\n".join(parts))[:limit].strip()
    except Exception as exc:
        print(f"[CatalystFeed] PDF pypdf error: {exc}", flush=True)
        return ""


def _fetch_filing_text(
    cik10: str,
    accession: str,
    primary_doc: str,
    *,
    max_chars: int | None = None,
) -> str | None:
    url = _filing_html_url(cik10, accession, primary_doc)
    r = _edgar_get(url)
    if not r or r.status_code != 200:
        return None
    ct = r.headers.get("Content-Type", "")
    if "pdf" in ct.lower() or primary_doc.lower().endswith(".pdf"):
        return _extract_text_from_pdf(r.content, max_chars=max_chars) or None
    return _extract_text_from_html(r.text, max_chars=max_chars) or None


def _filing_index_docs(cik10: str, accession: str) -> list[dict[str, Any]]:
    """EDGAR filing index.json document list (primary + exhibits)."""
    cik_int = str(int(cik10))
    accession_flat = accession.replace("-", "")
    url = (
        f"https://www.sec.gov/Archives/edgar/data/"
        f"{cik_int}/{accession_flat}/index.json"
    )
    r = _edgar_get(url)
    if not r or r.status_code != 200:
        return []
    try:
        data = r.json()
    except Exception:
        return []
    items = (((data or {}).get("directory") or {}).get("item")) or []
    if isinstance(items, dict):
        items = [items]
    out: list[dict[str, Any]] = []
    for it in items:
        name = str(it.get("name") or "")
        if not name:
            continue
        out.append(
            {
                "name": name,
                "type": str(it.get("type") or ""),
                "size": int(it.get("size") or 0) if str(it.get("size") or "").isdigit() else 0,
            }
        )
    return out


def _fetch_8k_bundle_text(
    cik10: str,
    accession: str,
    primary_doc: str,
    *,
    max_chars: int = 120_000,
    fetch_exhibits: bool = True,
    force_exhibits: bool = False,
    meta_out: dict[str, Any] | None = None,
) -> str | None:
    """
    Primary 8-K body + optional Ex-99 press-release exhibits (where catalyst dates live).

    The AI Catalyst Feed still uses short ``_fetch_filing_text`` truncations;
    Calendar / Financial dossier need the full PR language (PDUFA / 2H / Qx / $).

    ``force_exhibits=True``: always try Ex-99 (wrapper Items 2.02/7.01/8.01/5.02),
    ignoring the keyword early-skip. Prefer truncating the primary over exhibits
    when the combined bundle would exceed ``max_chars``.
    """
    if meta_out is not None:
        meta_out.clear()
        meta_out.update(
            {
                "bundle_chars_primary": 0,
                "bundle_chars_exhibit": 0,
                "exhibit_names": [],
                "exhibit_fetch_mode": "skipped",
            }
        )

    # Leave headroom for exhibits when we intend to fetch them.
    primary_cap = max_chars
    if fetch_exhibits:
        # Keep ≥25k (or 35% of budget) for Ex-99 when forcing / normally fetching.
        reserve = max(25_000, int(max_chars * 0.35)) if force_exhibits else max(8_000, int(max_chars * 0.15))
        primary_cap = max(12_000, max_chars - reserve)

    primary = _fetch_filing_text(cik10, accession, primary_doc, max_chars=primary_cap)
    primary_len = len(primary or "")
    if meta_out is not None:
        meta_out["bundle_chars_primary"] = primary_len

    if not fetch_exhibits:
        if meta_out is not None:
            meta_out["exhibit_fetch_mode"] = "disabled"
        return (primary or "")[:max_chars] if primary else None

    # Legacy keyword skip — only when NOT forcing exhibits (Calendar/light paths).
    primary_has_signal = bool(
        primary
        and re.search(
            r"(?i)\b(?:pdufa|topline|top[- ]line|read[- ]?out|advisory\s+committee|"
            r"2H\s*20|1H\s*20|Q[1-4]\s*20|second\s+half|target\s+action)\b",
            primary,
        )
    )
    if (
        not force_exhibits
        and primary_has_signal
        and primary
        and len(primary) >= 8000
    ):
        if meta_out is not None:
            meta_out["exhibit_fetch_mode"] = "keyword_skip"
        return primary[:max_chars]

    docs = _filing_index_docs(cik10, accession)
    primary_l = primary_doc.lower()
    candidates: list[tuple[int, str]] = []
    for d in docs:
        name = d["name"]
        nl = name.lower()
        if nl == primary_l:
            continue
        if not (nl.endswith(".htm") or nl.endswith(".html") or nl.endswith(".txt")):
            continue
        if (
            "ex99" in nl
            or "ex-99" in nl
            or "exhibit99" in nl
            or re.search(r"ex[_-]?99", nl)
        ):
            candidates.append((d.get("size") or 0, name))
    candidates.sort(key=lambda x: -x[0])

    exhibit_parts: list[tuple[str, str]] = []  # (name, text)
    budget = max_chars - (len(primary) if primary else 0)
    if budget < 2000 and force_exhibits and primary:
        # Trim primary further so at least one exhibit can fit.
        keep = max(8_000, max_chars - 30_000)
        primary = primary[:keep]
        budget = max_chars - len(primary)
        if meta_out is not None:
            meta_out["bundle_chars_primary"] = len(primary)

    for _size, name in candidates[:2]:
        if budget < 2000:
            break
        part = _fetch_filing_text(cik10, accession, name, max_chars=min(budget, 60_000))
        if part and len(part) > 200:
            exhibit_parts.append((name, part))
            budget = max_chars - (len(primary) if primary else 0) - sum(len(t) for _, t in exhibit_parts)

    exhibit_blob = "\n\n".join(t for _, t in exhibit_parts)
    exhibit_names = [n for n, _ in exhibit_parts]
    if meta_out is not None:
        meta_out["bundle_chars_exhibit"] = len(exhibit_blob)
        meta_out["exhibit_names"] = exhibit_names
        meta_out["exhibit_fetch_mode"] = (
            "forced" if force_exhibits else ("fetched" if exhibit_parts else "none_found")
        )

    # Prefer keeping exhibits intact; trim primary if over budget.
    sep = "\n\n"
    if primary and exhibit_blob:
        overhead = len(sep)
        total = len(primary) + overhead + len(exhibit_blob)
        if total > max_chars:
            room = max_chars - len(exhibit_blob) - overhead
            primary = primary[: max(0, room)]
            if meta_out is not None:
                meta_out["bundle_chars_primary"] = len(primary)
        out = f"{primary}{sep}{exhibit_blob}"
    elif exhibit_blob:
        out = exhibit_blob[:max_chars]
    elif primary:
        out = primary[:max_chars]
    else:
        return None
    return out[:max_chars]


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
    for row in rows:
        ticker = str(row.get("Ticker", "")).strip().upper()
        if not ticker or ticker in seen_tickers:
            continue
        seen_tickers.add(ticker)
        if len(seen_tickers) > MAX_COMPANIES:
            break
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

    # Per-run diagnostics: distinguish error from legitimately empty
    provider = ai_provider.active_provider()
    no_provider = not ai_provider.is_available()
    result: dict[str, Any] = {
        "processed": len(events),
        "ai_ok": ai_ok,
        "total": len(work),
        "provider": provider or "none",
        "status": (
            "no_provider"   if no_provider else
            "ok"            if ai_ok > 0 else
            "provider_error"
        ),
        "note": (
            "No AI key configured — add ANTHROPIC_API_KEY, GITHUB_TOKEN, or "
            "OPENAI_API_KEY to .env and re-run to get AI-enriched extractions."
            if no_provider else
            f"Provider '{provider}' active but all AI calls returned None — "
            "check API key validity and quota."
            if ai_ok == 0 and len(events) > 0 else
            None
        ),
    }

    ts = datetime.now(timezone.utc).isoformat()
    _set_status(
        running=False,
        processed=len(events),
        ai_ok=ai_ok,
        message=f"8-K: {len(events)} filing — {ai_ok} con headline AI",
        finished_at=ts,
    )
    return result


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


if __name__ == "__main__":
    import sys

    result = run_catalyst_feed_refresh()
    print(json.dumps(result, indent=2, default=str))
    sys.exit(1 if result.get("error") else 0)
