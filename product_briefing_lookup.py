"""
On-demand product card fields (modality / MoA / target) via Gemini when CT.gov / Deep are sparse.
Display-only — not Soft BUY/SELL.
"""
from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import ai_provider

from orchestrator_io_paths import DATA_DIR

_CACHE_PATH = Path(DATA_DIR) / "product_briefing_ai_cache.json"
_CACHE_LOCK = threading.Lock()
_BRIEFING_SCHEMA = 2

_SYSTEM = (
    "You are a biotech analyst. Answer from well-established public drug facts only. "
    "If uncertain, use null. Return strict JSON only — no markdown."
)


def _cache_key(ticker: str, product: str) -> str:
    tk = (ticker or "").strip().upper()
    pr = re.sub(r"\s+", " ", (product or "").strip().lower())
    return f"{tk}|{pr}"


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
    _CACHE_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_ai_json(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _clean_field(raw: Any, *, max_len: int = 420) -> str | None:
    s = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not s or re.match(r"^(n/?d|null|none|unknown|—|-)$", s, re.I):
        return None
    if len(s) > max_len:
        s = s[: max_len - 1].rstrip() + "…"
    return s


def _join_products(raw: Any) -> str | None:
    if isinstance(raw, list):
        parts: list[str] = []
        for item in raw:
            if isinstance(item, dict):
                name = _clean_field(
                    item.get("product")
                    or item.get("name")
                    or item.get("drug")
                    or item.get("asset"),
                    max_len=80,
                )
                co = _clean_field(item.get("company") or item.get("sponsor"), max_len=60)
                phase = _clean_field(item.get("phase"), max_len=24)
                line = " · ".join(p for p in (name, co, phase) if p)
                if line:
                    parts.append(line)
            else:
                got = _clean_field(item, max_len=160)
                if got:
                    parts.append(got)
        return "; ".join(parts[:10]) or None
    return _clean_field(raw, max_len=800)


def _looks_like_disease_not_molecular_target(
    target: str | None, indication: str | None = None
) -> bool:
    t = (target or "").strip().lower()
    if not t:
        return True
    ind = (indication or "").strip().lower()
    if ind and (t == ind or ind in t or t in ind):
        return True
    if re.search(
        r"\b(disease|syndrome|disorder|cancer|carcinoma|leukemia|lymphoma|"
        r"melanoma|myeloma|hemophilia|haemophilia|psoriasis|diabetes|arthritis|"
        r"fibrosis|bullosa|anemia|anaemia|dystrophy|deficiency|infection|"
        r"obesity|migraine|epilepsy|asthma|copd|nash|cah|aml|all|cll|cml)\b",
        t,
        re.I,
    ):
        if re.search(
            r"\b(receptor|kinase|protein|pathway|signaling|signalling|enzyme|"
            r"gene|factor\s*[ivx0-9]+|glp-?\d|pd-?1|pd-?l1|vegf|egfr|her2|"
            r"cd\d+|menin|kmt2a|nmda|antibody|agonist|antagonist|inhibitor)\b",
            t,
            re.I,
        ):
            return False
        return True
    return False


def _normalize_briefing(parsed: dict[str, Any]) -> dict[str, Any]:
    modality = _clean_field(parsed.get("modality") or parsed.get("product_modality"))
    moa = _clean_field(
        parsed.get("mechanism_of_action")
        or parsed.get("mechanismOfAction")
        or parsed.get("moa"),
        max_len=520,
    )
    target = _clean_field(
        parsed.get("therapeutic_target")
        or parsed.get("therapeuticTarget")
        or parsed.get("target")
    )
    tech = _clean_field(parsed.get("product_technology") or parsed.get("technology"))
    indication = _clean_field(
        parsed.get("indication") or parsed.get("disease") or parsed.get("condition"),
        max_len=220,
    )
    if target and _looks_like_disease_not_molecular_target(target, indication):
        target = None
    prevalence = _clean_field(
        parsed.get("usa_prevalence")
        or parsed.get("us_prevalence")
        or parsed.get("prevalence"),
        max_len=280,
    )
    soc = _clean_field(
        parsed.get("standard_of_care")
        or parsed.get("soc")
        or parsed.get("standardOfCare"),
        max_len=420,
    )
    p34 = _join_products(
        parsed.get("phase_3_and_4_products")
        or parsed.get("phase3_phase4")
        or parsed.get("competitors_phase_3_4")
    )
    return {
        "modality": modality,
        "mechanism_of_action": moa,
        "therapeutic_target": target,
        "product_technology": tech,
        "indication": indication,
        "usa_prevalence": prevalence,
        "standard_of_care": soc,
        "phase_3_and_4_products": p34,
    }


def _briefing_cache_hit(hit: Any) -> dict[str, Any] | None:
    if not isinstance(hit, dict):
        return None
    if int(hit.get("schema") or 0) < _BRIEFING_SCHEMA:
        return None
    briefing = hit.get("briefing")
    if not isinstance(briefing, dict):
        return None
    return briefing


def _ddg_briefing_snippets(query: str, *, limit: int = 5) -> list[str]:
    return _ddg_patent_snippets(query, limit=limit)


def _build_prompt(
    *,
    ticker: str,
    company: str | None,
    product_name: str,
    nct_id: str | None,
    interventions: str | None,
    conditions: str | None,
    web_hits: list[str] | None = None,
) -> str:
    lines = [
        "Using public biopharma knowledge and the web snippets, describe this asset.",
        "Separate molecular target from disease indication. Do not list the focal product",
        "in phase_3_and_4_products — only OTHER drugs in Phase III or IV for the same disease.",
        "",
        f"Ticker: {ticker.upper()}",
        f"Company: {company or '(unknown)'}",
        f"Product / drug name: {product_name}",
    ]
    if nct_id:
        lines.append(f"NCT ID (context): {nct_id.upper()}")
    if conditions:
        lines.append(f"Indication / conditions (Deep Dive): {conditions[:400]}")
    if interventions:
        lines.append(f"CT.gov interventions (context): {interventions[:400]}")
    if web_hits:
        lines.append("")
        lines.append("Web search snippets:")
        for sn in web_hits[:10]:
            lines.append(f"- {sn}")
    lines.extend(
        [
            "",
            "Return JSON with EXACTLY these keys (string, list, or null):",
            "{",
            '  "modality": "e.g. Cell therapy, Small molecule, Biologic / antibody",',
            '  "product_technology": "short technology class if distinct from modality",',
            '  "mechanism_of_action": "1-2 sentences, investor-readable MoA",',
            '  "therapeutic_target": "molecular target only: protein, gene, receptor, or signalling pathway (NEVER the disease / indication name)",',
            '  "indication": "primary disease / therapeutic indication",',
            '  "usa_prevalence": "approximate US prevalence or incidence, with year if known",',
            '  "standard_of_care": "current US standard of care for this indication",',
            '  "phase_3_and_4_products": ["Product (Company, Phase 3/4)", "..."]',
            "}",
        ]
    )
    return "\n".join(lines)


def lookup_product_briefing(
    *,
    ticker: str,
    product_name: str,
    company: str | None = None,
    nct_id: str | None = None,
    interventions: str | None = None,
    conditions: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Gemini-first lookup with disk cache."""
    tk = (ticker or "").strip().upper()
    product = (product_name or "").strip()
    if not tk or not product:
        return {"ok": False, "error": "ticker and product_name required"}

    key = _cache_key(tk, product)
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        hit = cache_doc.get("entries", {}).get(key)
        cached = _briefing_cache_hit(hit) if not force else None
        if cached:
            return {
                "ok": True,
                "cached": True,
                "provider": (hit or {}).get("provider"),
                "updated_at": (hit or {}).get("updated_at"),
                "briefing": cached,
            }

    disease_q = (conditions or "").strip() or product
    snippets: list[str] = []
    for q in (
        f"{product} {disease_q} indication US prevalence",
        f"{disease_q} standard of care United States",
        f"{disease_q} Phase 3 Phase 4 drugs pipeline ClinicalTrials.gov 2026",
    ):
        snippets.extend(_ddg_briefing_snippets(q, limit=4))
        if len(snippets) >= 10:
            break

    if not ai_provider.is_available():
        return {
            "ok": False,
            "error": "no_ai_provider",
            "hint": ai_provider.provider_info().get("hint_it"),
        }

    prompt = _build_prompt(
        ticker=tk,
        company=company,
        product_name=product,
        nct_id=nct_id,
        interventions=interventions,
        conditions=conditions,
        web_hits=snippets[:10],
    )
    provider_used = "gemini"
    raw: str | None = None
    if ai_provider.get_api_key("gemini"):
        raw = ai_provider._call_provider(  # noqa: SLF001 — intentional Gemini-only desk lookup
            "gemini",
            prompt,
            system=_SYSTEM,
            max_tokens=1400,
            model_override=None,
            task="catalyst",
        )
        if not raw:
            provider_used = "fallback"
            raw = ai_provider.call_ai(
                prompt, system=_SYSTEM, max_tokens=1400, task="clinical_kpi"
            )
    else:
        provider_used = "active"
        raw = ai_provider.call_ai(
            prompt, system=_SYSTEM, max_tokens=1400, task="clinical_kpi"
        )

    if not raw:
        return {
            "ok": False,
            "error": "ai_empty",
            "detail": ai_provider.friendly_error_message(lang="it"),
        }

    parsed = _parse_ai_json(raw)
    if not parsed:
        return {"ok": False, "error": "ai_parse"}

    briefing = _normalize_briefing(parsed)
    if not any(briefing.values()):
        return {"ok": False, "error": "ai_sparse"}

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry = {
        "ticker": tk,
        "product_name": product,
        "schema": _BRIEFING_SCHEMA,
        "provider": provider_used,
        "updated_at": stamp,
        "briefing": briefing,
    }
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        cache_doc.setdefault("entries", {})[key] = entry
        _save_cache(cache_doc)

    return {
        "ok": True,
        "cached": False,
        "provider": provider_used,
        "updated_at": stamp,
        "briefing": briefing,
    }


_PATENT_CACHE_PATH = Path(DATA_DIR) / "product_patent_ai_cache.json"
_PATENT_SCHEMA = 3  # Google Patents family + Anticipated expiration per title
_PATENT_SYSTEM = (
    "You are a biotech IP analyst. Use the web snippets and established public facts "
    "(Orange Book, EMA, company 10-K / LOE commentary). If uncertain, use null. "
    "Return strict JSON only — no markdown."
)
_ALIAS_SYSTEM = (
    "You are a biotech nomenclature specialist. List every public name for this product "
    "(brand, INN/generic, research codes, former names). Do not invent. "
    "Return strict JSON only — no markdown."
)
_DEVICE_IP_SYSTEM = (
    "You are a medtech IP / regulatory analyst. Devices are NOT Orange Book drugs. "
    "Do not invent Orange Book LOE. Prefer USPTO / Google Patents for core device patents "
    "and FDA product codes / 510(k) / PMA for competitive clearance signals. "
    "If uncertain, use null. Return strict JSON only — no markdown."
)
_DEVICE_PRODUCT_RE = re.compile(
    r"\b(?:medical\s+device|closure\s+device|catheter|implant|wearable|"
    r"510\s*\(\s*k\s*\)|510k|pma\b|premarket|predicate\s+device|"
    r"diagnostic\s+system|samd|in\s+vitro\s+diagnostic|ivd|"
    r"stent|pacemaker|defibrillator|ablation\s+system|sensor)\b",
    re.I,
)


def _is_medtech_ticker(ticker: str) -> bool:
    tk = (ticker or "").strip().upper()
    if not tk:
        return False
    try:
        from medtech_universe import CURATED_MEDTECH, MEDTECH_SYMBOLS_JSON, load_json_list

        return tk in (set(load_json_list(MEDTECH_SYMBOLS_JSON)) | set(CURATED_MEDTECH))
    except Exception:
        return False


def _detect_device_product(
    *,
    ticker: str,
    product_name: str,
    product_kind: str | None = None,
) -> bool:
    kind = (product_kind or "").strip().lower()
    if kind in {"device", "medtech", "medical_device"}:
        return True
    if kind in {"drug", "biologic", "pharma"}:
        return False
    if _is_medtech_ticker(ticker):
        return True
    return bool(_DEVICE_PRODUCT_RE.search(product_name or ""))


def _patent_cache_key(ticker: str, product: str, *, device: bool) -> str:
    base = _cache_key(ticker, product)
    return f"{base}|device|s{_PATENT_SCHEMA}" if device else f"{base}|drug|s{_PATENT_SCHEMA}"


def _load_patent_cache() -> dict[str, Any]:
    if not _PATENT_CACHE_PATH.is_file():
        return {"entries": {}}
    try:
        raw = json.loads(_PATENT_CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("entries"), dict):
            return raw
    except Exception:
        pass
    return {"entries": {}}


def _save_patent_cache(doc: dict[str, Any]) -> None:
    _PATENT_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATENT_CACHE_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _strip_html(raw: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", text).strip()


def _ddg_patent_snippets(query: str, *, limit: int = 6) -> list[str]:
    """Lightweight DuckDuckGo HTML search — context for Gemini, not a legal source."""
    import urllib.parse
    import urllib.request

    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 SuperNovaPatent/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return []
    titles = re.findall(
        r'class="result__a"[^>]*>(.*?)</a>', html, flags=re.I | re.S
    )
    snips = re.findall(
        r'class="result__snippet"[^>]*>(.*?)</(?:a|td|div|span)>',
        html,
        flags=re.I | re.S,
    )
    out: list[str] = []
    for i in range(max(len(titles), len(snips))):
        title = _strip_html(titles[i]) if i < len(titles) else ""
        snip = _strip_html(snips[i]) if i < len(snips) else ""
        line = " — ".join(p for p in (title, snip) if p)
        if line:
            out.append(line[:420])
        if len(out) >= limit:
            break
    return out


_GP_PUB_RE = re.compile(r"^[A-Z]{1,3}\d{4,}[A-Z]?\d*$", re.I)


def _google_patents_search(query: str, *, limit: int = 10) -> list[dict[str, Any]]:
    """Search Google Patents (XHR), fall back to DuckDuckGo site:patents.google.com."""
    import urllib.parse
    import urllib.request

    q = re.sub(r"\s+", " ", (query or "").strip())
    if len(q) < 3:
        return []

    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(pub: str | None, title: str | None, assignee: str | None = None) -> None:
        nonlocal out
        if not pub:
            return
        pub_key = pub.upper()
        if pub_key in seen:
            return
        seen.add(pub_key)
        out.append(
            {
                "patent_number": pub,
                "title": title,
                "assignee": assignee,
                "url": f"https://patents.google.com/patent/{urllib.parse.quote(pub)}/en",
            }
        )

    # 1) Official XHR (preferred)
    url = "https://patents.google.com/xhr/query?" + urllib.parse.urlencode(
        {"url": f"q={q}"}
    )
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json",
            "Referer": "https://patents.google.com/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
        results = payload.get("results") if isinstance(payload, dict) else None
        clusters = results.get("cluster") if isinstance(results, dict) else None
        raw_items = (
            clusters[0].get("result")
            if isinstance(clusters, list) and clusters and isinstance(clusters[0], dict)
            else None
        )
        if isinstance(raw_items, list):
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                patent = item.get("patent") if isinstance(item.get("patent"), dict) else item
                if not isinstance(patent, dict):
                    continue
                pub = _clean_field(patent.get("publication_number") or patent.get("number"))
                title = _clean_field(patent.get("title"), max_len=220)
                assignee_raw = patent.get("assignee") or patent.get("assignee_organization")
                if isinstance(assignee_raw, list):
                    assignee = _clean_field(
                        "; ".join(str(x) for x in assignee_raw[:3]), max_len=160
                    )
                else:
                    assignee = _clean_field(assignee_raw, max_len=160)
                _add(pub, title, assignee)
                if len(out) >= limit:
                    return out
    except Exception:
        pass

    # 2) DuckDuckGo: extract /patent/XXXX links + titles
    ddg_q = f"{q} site:patents.google.com/patent"
    ddg_url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": ddg_q})
    ddg_req = urllib.request.Request(
        ddg_url,
        headers={"User-Agent": "Mozilla/5.0 SuperNovaPatent/1.0"},
    )
    try:
        with urllib.request.urlopen(ddg_req, timeout=16) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return out

    anchors = re.findall(
        r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        html,
        flags=re.I | re.S,
    )
    for href, title_html in anchors:
        decoded = urllib.parse.unquote(href)
        m_pub = re.search(
            r"patents\.google\.com/patent/([A-Z]{1,3}\d+[A-Z]?\d*)",
            decoded,
            flags=re.I,
        )
        if not m_pub:
            # DDG redirect URLs sometimes encode the target in uddg=
            m_uddg = re.search(r"[?&]uddg=([^&]+)", href)
            if m_uddg:
                decoded = urllib.parse.unquote(m_uddg.group(1))
                m_pub = re.search(
                    r"patents\.google\.com/patent/([A-Z]{1,3}\d+[A-Z]?\d*)",
                    decoded,
                    flags=re.I,
                )
        if not m_pub:
            continue
        pub = m_pub.group(1).upper()
        title_txt = _strip_html(title_html)
        # "WO2025… - Title - Google Patents"
        title = title_txt
        parts = [p.strip() for p in title_txt.split(" - ") if p.strip()]
        if parts and parts[0].upper().startswith(pub[:2]):
            title = " - ".join(parts[1:]) if len(parts) > 1 else parts[0]
            title = re.sub(r"\s*Google Patents\s*$", "", title, flags=re.I).strip() or title_txt
        _add(pub, _clean_field(title, max_len=220))
        if len(out) >= limit:
            break
    return out


def _google_patents_detail(publication_number: str) -> dict[str, Any] | None:
    """Fetch Google Patents page — title + Anticipated expiration from Events."""
    import time
    import urllib.error
    import urllib.parse
    import urllib.request

    pub = _clean_field(publication_number)
    if not pub:
        return None
    url = f"https://patents.google.com/patent/{urllib.parse.quote(pub)}/en"
    html: str | None = None
    last_err: Exception | None = None
    for attempt in range(3):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://patents.google.com/",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            break
        except Exception as exc:
            last_err = exc
            time.sleep(1.2 * (attempt + 1))

    if not html:
        # Gemini fallback when Google Patents HTML is blocked (503 etc.)
        return _gemini_patent_anticipated(pub, last_err=last_err)

    expiry: str | None = None
    # Events timeline: <time datetime="YYYY-MM-DD">…</time><span itemprop="title">Anticipated expiration
    m_exp = re.search(
        r'datetime="(\d{4}-\d{2}-\d{2})"[^>]*>[^<]*</time>\s*'
        r'<span[^>]*itemprop="title"[^>]*>\s*Anticipated expiration',
        html,
        flags=re.I | re.S,
    )
    if m_exp:
        expiry = m_exp.group(1)

    filing: str | None = None
    m_fil = re.search(
        r'<time[^>]+itemprop="date"[^>]+datetime="(\d{4}-\d{2}-\d{2})"[^>]*>'
        r".{0,80}?"
        r"Application filed",
        html,
        flags=re.I | re.S,
    )
    if m_fil:
        filing = m_fil.group(1)

    title: str | None = None
    m_title = re.search(
        r'<meta[^>]+name="DC\.title"[^>]+content="([^"]+)"',
        html,
        flags=re.I,
    )
    if m_title:
        title = _clean_field(m_title.group(1), max_len=220)
    if not title:
        m_title2 = re.search(r"<title>\s*([^|<]+)", html, flags=re.I)
        if m_title2:
            raw_t = m_title2.group(1)
            parts = [p.strip() for p in raw_t.split(" - ") if p.strip()]
            if len(parts) >= 2 and re.match(r"^[A-Z]{1,3}\d", parts[0], re.I):
                title = _clean_field(parts[1], max_len=220)
            elif parts:
                title = _clean_field(parts[0], max_len=220)

    expiry_out, years, method = _estimate_expiry(filing, expiry)
    return {
        "patent_number": pub,
        "title": title,
        "filing_date": filing,
        "expiry_date": expiry_out,
        "years_remaining": years,
        "method": "google_patents_anticipated" if expiry else method,
        "url": url,
    }


def _gemini_patent_anticipated(
    publication_number: str,
    *,
    last_err: Exception | None = None,
) -> dict[str, Any] | None:
    """When Google Patents HTML is unreachable, ask Gemini for Events Anticipated expiration."""
    if not ai_provider.is_available():
        return {
            "patent_number": publication_number,
            "title": None,
            "filing_date": None,
            "expiry_date": None,
            "years_remaining": None,
            "method": "unknown",
            "url": f"https://patents.google.com/patent/{publication_number}/en",
            "notes": f"Google Patents unreachable ({type(last_err).__name__ if last_err else 'error'})",
        }
    prompt = "\n".join(
        [
            "Look up this publication on Google Patents.",
            "From the Events timeline on the patent page, report the date labeled "
            '"Anticipated expiration" (not invent a 20-year estimate).',
            "Also return the invention title.",
            "",
            f"Publication number: {publication_number}",
            f"URL: https://patents.google.com/patent/{publication_number}/en",
            "",
            "Return JSON with EXACTLY these keys:",
            "{",
            '  "title": "invention title or null",',
            '  "filing_date": "YYYY-MM-DD or null",',
            '  "anticipated_expiration": "YYYY-MM-DD or null",',
            '  "notes": "1 short sentence"',
            "}",
            "If you cannot verify Anticipated expiration, set it to null.",
        ]
    )
    raw: str | None = None
    if ai_provider.get_api_key("gemini"):
        raw = ai_provider._call_provider(  # noqa: SLF001
            "gemini",
            prompt,
            system=_PATENT_SYSTEM,
            max_tokens=350,
            model_override=None,
            task="catalyst",
        )
    if not raw:
        raw = ai_provider.call_ai(
            prompt, system=_PATENT_SYSTEM, max_tokens=350, task="clinical_kpi"
        )
    parsed = _parse_ai_json(raw or "") or {}
    filing = _clean_field(parsed.get("filing_date"))
    expiry_in = _clean_field(
        parsed.get("anticipated_expiration") or parsed.get("expiry_date")
    )
    expiry, years, method = _estimate_expiry(filing, expiry_in)
    return {
        "patent_number": publication_number,
        "title": _clean_field(parsed.get("title"), max_len=220),
        "filing_date": filing,
        "expiry_date": expiry,
        "years_remaining": years,
        "method": "google_patents_anticipated" if expiry_in else method,
        "url": f"https://patents.google.com/patent/{publication_number}/en",
        "notes": _clean_field(parsed.get("notes")),
    }


def _gemini_product_aliases(
    *,
    ticker: str,
    product: str,
    company: str | None,
) -> dict[str, Any]:
    """Ask Gemini for brand / INN / research codes / aliases for Google Patents search."""
    if not ai_provider.is_available():
        return {
            "brand_name": None,
            "generic_name": None,
            "aliases": [product] if product else [],
        }
    lines = [
        "List every public name associated with this clinical product.",
        "Include brand name, INN/generic, research codes (e.g. REGN3767), and former names.",
        "Do not invent codes. Prefer null over guesses.",
        "",
        f"Ticker: {ticker}",
        f"Company: {(company or '').strip() or '(unknown)'}",
        f"Product name as shown: {product}",
        "",
        "Return JSON with EXACTLY these keys:",
        "{",
        '  "brand_name": "string or null",',
        '  "generic_name": "INN or null",',
        '  "aliases": ["other names and research codes"]',
        "}",
    ]
    prompt = "\n".join(lines)
    raw: str | None = None
    if ai_provider.get_api_key("gemini"):
        raw = ai_provider._call_provider(  # noqa: SLF001
            "gemini",
            prompt,
            system=_ALIAS_SYSTEM,
            max_tokens=400,
            model_override=None,
            task="catalyst",
        )
    if not raw:
        raw = ai_provider.call_ai(
            prompt, system=_ALIAS_SYSTEM, max_tokens=400, task="clinical_kpi"
        )
    parsed = _parse_ai_json(raw or "") or {}
    aliases_raw = parsed.get("aliases") or []
    aliases = [
        s
        for s in (
            _clean_field(x, max_len=80)
            for x in (aliases_raw if isinstance(aliases_raw, list) else [aliases_raw])
        )
        if s
    ]
    brand = _clean_field(parsed.get("brand_name") or parsed.get("brand"), max_len=80)
    generic = _clean_field(
        parsed.get("generic_name") or parsed.get("inn"), max_len=80
    )
    # Always include the displayed product name
    names: list[str] = []
    for n in [product, brand, generic, *aliases]:
        if not n:
            continue
        key = n.casefold()
        if any(x.casefold() == key for x in names):
            continue
        names.append(n)
    return {
        "brand_name": brand,
        "generic_name": generic,
        "aliases": names[:12],
    }


def _assignee_matches_company(assignee: str | None, company: str | None) -> bool:
    a = (assignee or "").casefold()
    c = (company or "").casefold()
    if not a or not c:
        return False
    # "Regeneron Pharmaceuticals, Inc." vs "Regeneron"
    token = re.split(r"[\s,./]+", c)[0]
    return len(token) >= 4 and token in a


def _gemini_patent_family_ids(
    *,
    ticker: str,
    product: str,
    company: str | None,
    names: list[str],
) -> list[dict[str, Any]]:
    """When search engines block us, ask Gemini for known Google Patents publication numbers."""
    if not ai_provider.is_available():
        return []
    name_list = ", ".join(names[:10]) or product
    prompt = "\n".join(
        [
            "List Google Patents publication numbers for the patent family covering this product.",
            "Prefer composition-of-matter / antibody sequence, formulation, and key method-of-use patents "
            "owned by the company. Include WO / US / EP numbers when known.",
            "Do not invent numbers — only well-documented public filings. If unsure, omit.",
            "",
            f"Ticker: {ticker}",
            f"Company: {(company or '').strip() or '(unknown)'}",
            f"Product names: {name_list}",
            "",
            "Return JSON with EXACTLY these keys:",
            "{",
            '  "patents": [',
            '    {"patent_number": "WOxxxxxxxxA1 or USxxxxxxxB2", "title": "short title or null"}',
            "  ]",
            "}",
        ]
    )
    raw: str | None = None
    if ai_provider.get_api_key("gemini"):
        raw = ai_provider._call_provider(  # noqa: SLF001
            "gemini",
            prompt,
            system=_PATENT_SYSTEM,
            max_tokens=700,
            model_override=None,
            task="catalyst",
        )
    if not raw:
        raw = ai_provider.call_ai(
            prompt, system=_PATENT_SYSTEM, max_tokens=700, task="clinical_kpi"
        )
    parsed = _parse_ai_json(raw or "") or {}
    rows = parsed.get("patents") or parsed.get("family") or []
    if not isinstance(rows, list):
        return []
    import urllib.parse

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in rows[:10]:
        if isinstance(item, str):
            pub = _clean_field(item)
            title = None
        elif isinstance(item, dict):
            pub = _clean_field(
                item.get("patent_number") or item.get("publication_number") or item.get("number")
            )
            title = _clean_field(item.get("title"), max_len=220)
        else:
            continue
        if not pub:
            continue
        # Normalize spaces
        pub = re.sub(r"\s+", "", pub).upper()
        if pub in seen:
            continue
        seen.add(pub)
        out.append(
            {
                "patent_number": pub,
                "title": title,
                "assignee": company,
                "url": f"https://patents.google.com/patent/{urllib.parse.quote(pub)}/en",
            }
        )
    return out


def _patent_title_relevant(title: str | None, names: list[str]) -> bool:
    t = (title or "").casefold()
    if not t:
        return True  # keep unknowns; detail may fill title later
    for name in names:
        n = (name or "").strip().casefold()
        if len(n) >= 4 and n in t:
            return True
    # Common target / class tokens when INN is in title elsewhere in family
    if re.search(r"\blag[\s-]?3\b|\blag3\b", t):
        return True
    return False


def _lookup_google_patents_family(
    *,
    names: list[str],
    company: str | None,
    limit_search: int = 8,
    limit_detail: int = 8,
    ticker: str | None = None,
) -> list[dict[str, Any]]:
    """
    Search Google Patents with every product name, then resolve Anticipated expiration
    from each patent's Events timeline (Google Patents initial page).
    """
    co = (company or "").strip()
    hits: list[dict[str, Any]] = []
    seen_pub: set[str] = set()
    for name in names[:8]:
        queries = [f"{name} {co}".strip() if co else name]
        if co:
            queries.append(f"{name} assignee:({co.split(',')[0].split()[0]})")
        for q in queries:
            for row in _google_patents_search(q, limit=limit_search):
                pub = (row.get("patent_number") or "").upper()
                if not pub or pub in seen_pub:
                    continue
                seen_pub.add(pub)
                hits.append(row)
            if len(hits) >= limit_detail * 2:
                break
        if len(hits) >= limit_detail * 2:
            break

    # Gemini publication numbers when search engines are blocked / empty
    if len(hits) < 2:
        for row in _gemini_patent_family_ids(
            ticker=(ticker or "").strip().upper() or "UNK",
            product=names[0] if names else "",
            company=co or None,
            names=names,
        ):
            pub = (row.get("patent_number") or "").upper()
            if not pub or pub in seen_pub:
                continue
            seen_pub.add(pub)
            hits.append(row)

    # Prefer title match to product names, then assignee match
    relevant = [h for h in hits if _patent_title_relevant(h.get("title"), names)]
    if relevant:
        hits = relevant + [h for h in hits if h not in relevant]
    if co:
        preferred = [h for h in hits if _assignee_matches_company(h.get("assignee"), co)]
        other = [h for h in hits if h not in preferred]
        hits = preferred + other

    family: list[dict[str, Any]] = []
    for hit in hits[: max(limit_detail * 2, 12)]:
        detail = _google_patents_detail(str(hit.get("patent_number") or ""))
        if not detail:
            row = {
                "patent_number": hit.get("patent_number"),
                "title": hit.get("title"),
                "filing_date": None,
                "expiry_date": None,
                "years_remaining": None,
                "url": hit.get("url"),
            }
        else:
            if not detail.get("title"):
                detail["title"] = hit.get("title")
            row = {
                "patent_number": detail.get("patent_number") or hit.get("patent_number"),
                "title": detail.get("title") or hit.get("title"),
                "filing_date": detail.get("filing_date"),
                "expiry_date": detail.get("expiry_date"),
                "years_remaining": detail.get("years_remaining"),
                "url": detail.get("url") or hit.get("url"),
            }
        # Drop clear off-target titles after detail fill
        if row.get("title") and not _patent_title_relevant(row.get("title"), names):
            continue
        family.append(row)
        if len(family) >= limit_detail:
            break
    return family


def _parse_yearish(raw: Any) -> datetime | None:
    s = str(raw or "").strip()[:10]
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        try:
            return datetime.strptime(s, "%Y-%m-%d")
        except ValueError:
            return None
    if re.match(r"^\d{4}-\d{2}$", s):
        try:
            return datetime.strptime(s + "-01", "%Y-%m-%d")
        except ValueError:
            return None
    if re.match(r"^\d{4}$", s):
        try:
            return datetime.strptime(s + "-12-31", "%Y-%m-%d")
        except ValueError:
            return None
    return None


def _estimate_expiry(
    filing: str | None,
    expiry: str | None,
    today: datetime | None = None,
) -> tuple[str | None, float | None, str]:
    now = today or datetime.now(timezone.utc).replace(tzinfo=None)
    exp_d = _parse_yearish(expiry)
    method = "published_loe"
    if exp_d is None:
        fil_d = _parse_yearish(filing)
        if fil_d is None:
            return None, None, "unknown"
        try:
            exp_d = fil_d.replace(year=fil_d.year + 20)
        except ValueError:
            exp_d = datetime(fil_d.year + 20, 2, 28)
        method = "20y_from_filing"
    years = round((exp_d - now).days / 365.25, 1)
    return exp_d.date().isoformat(), years, method


def _openfda_get(url: str) -> dict[str, Any] | None:
    import urllib.error
    import urllib.request

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 SuperNovaDeviceIP/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _openfda_clearance_row(
    *,
    clearance_type: str,
    row: dict[str, Any],
) -> dict[str, Any]:
    decision = _clean_field(
        row.get("decision_date") or row.get("date_received") or row.get("decision_date_iso")
    )
    clearance_id = _clean_field(
        row.get("k_number")
        or row.get("pma_number")
        or row.get("supplement_number")
        or row.get("submission_number")
    )
    return {
        "clearance_type": clearance_type,
        "product_code": _clean_field(row.get("product_code")),
        "clearance_id": clearance_id,
        "decision_date": decision,
        "applicant": _clean_field(row.get("applicant") or row.get("sponsor_name")),
        "device_name": _clean_field(row.get("device_name") or row.get("trade_name")),
        "notes": None,
        "source": "openfda",
    }


def _openfda_first_same_code(product_code: str) -> dict[str, Any] | None:
    """Earliest 510(k) or PMA decision for an FDA product code."""
    import urllib.parse

    code = (product_code or "").strip().upper()
    if not re.match(r"^[A-Z0-9]{2,4}$", code):
        return None
    q = urllib.parse.quote(f'product_code:"{code}"')
    candidates: list[dict[str, Any]] = []
    for kind, path, id_key in (
        ("510(k)", "device/510k.json", "k_number"),
        ("PMA", "device/pma.json", "pma_number"),
    ):
        url = (
            f"https://api.fda.gov/{path}?search={q}"
            f"&sort=decision_date:asc&limit=1"
        )
        payload = _openfda_get(url)
        results = (payload or {}).get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list) or not results:
            continue
        row = results[0] if isinstance(results[0], dict) else None
        if not row:
            continue
        # Prefer explicit id field if present
        if id_key and not row.get(id_key) and row.get("submission_number"):
            row = {**row, id_key: row.get("submission_number")}
        candidates.append(_openfda_clearance_row(clearance_type=kind, row=row))
    if not candidates:
        return None

    def _sort_key(c: dict[str, Any]) -> str:
        return str(c.get("decision_date") or "9999-99-99")

    return sorted(candidates, key=_sort_key)[0]


def _openfda_search_device_name(device_name: str) -> dict[str, Any] | None:
    """Fallback: earliest 510(k) hit by device_name search (no product code yet)."""
    import urllib.parse

    name = re.sub(r"\s+", " ", (device_name or "").strip())
    if len(name) < 4:
        return None
    q = urllib.parse.quote(f'device_name:"{name}"')
    url = (
        f"https://api.fda.gov/device/510k.json?search={q}"
        f"&sort=decision_date:asc&limit=1"
    )
    payload = _openfda_get(url)
    results = (payload or {}).get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        return None
    return _openfda_clearance_row(clearance_type="510(k)", row=results[0])


def _normalize_core_patents(raw: Any) -> list[dict[str, Any]]:
    rows: list[Any]
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = [raw]
    elif isinstance(raw, str) and raw.strip():
        rows = [{"patent_number": raw.strip()}]
    else:
        rows = []
    out: list[dict[str, Any]] = []
    for item in rows[:6]:
        if isinstance(item, str):
            num = _clean_field(item)
            if num:
                out.append(
                    {
                        "patent_number": num,
                        "title": None,
                        "filing_date": None,
                        "expiry_date": None,
                        "years_remaining": None,
                    }
                )
            continue
        if not isinstance(item, dict):
            continue
        filing = _clean_field(item.get("filing_date") or item.get("patent_filing_date"))
        expiry_in = _clean_field(
            item.get("expiry_date")
            or item.get("patent_expiry_date")
            or item.get("loe_date")
            or item.get("anticipated_expiration")
        )
        expiry, years, _method = _estimate_expiry(filing, expiry_in)
        num = _clean_field(item.get("patent_number") or item.get("patent") or item.get("number"))
        title = _clean_field(item.get("title") or item.get("summary") or item.get("name"))
        url = _clean_field(item.get("url") or item.get("link"), max_len=320)
        if not num and not title and not expiry:
            continue
        out.append(
            {
                "patent_number": num,
                "title": title,
                "filing_date": filing,
                "expiry_date": expiry,
                "years_remaining": years,
                "url": url,
            }
        )
    return out


def _normalize_competitive_signal(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    clearance_type = _clean_field(
        raw.get("clearance_type") or raw.get("pathway") or raw.get("type")
    )
    product_code = _clean_field(raw.get("product_code") or raw.get("fda_product_code"))
    clearance_id = _clean_field(
        raw.get("clearance_id")
        or raw.get("k_number")
        or raw.get("pma_number")
        or raw.get("submission_number")
    )
    decision_date = _clean_field(
        raw.get("decision_date")
        or raw.get("clearance_date")
        or raw.get("first_clearance_date")
    )
    applicant = _clean_field(raw.get("applicant") or raw.get("sponsor") or raw.get("company"))
    device_name = _clean_field(raw.get("device_name") or raw.get("trade_name") or raw.get("name"))
    notes = _clean_field(raw.get("notes") or raw.get("summary"))
    if not any((clearance_type, product_code, clearance_id, decision_date, notes)):
        return None
    return {
        "clearance_type": clearance_type,
        "product_code": product_code.upper() if product_code else None,
        "clearance_id": clearance_id,
        "decision_date": decision_date,
        "applicant": applicant,
        "device_name": device_name,
        "notes": notes,
        "source": _clean_field(raw.get("source")) or "ai",
    }


def _enrich_competitive_signal_openfda(
    signal: dict[str, Any] | None,
    *,
    device_name: str | None,
) -> dict[str, Any] | None:
    """Prefer openFDA earliest same-code clearance when a product code is known."""
    code = (signal or {}).get("product_code") if signal else None
    hit = _openfda_first_same_code(str(code or "")) if code else None
    if not hit and device_name:
        hit = _openfda_search_device_name(device_name)
        # If name search found a code, upgrade to first-same-code chronology
        if hit and hit.get("product_code"):
            same = _openfda_first_same_code(str(hit["product_code"]))
            if same:
                hit = same
    if not hit:
        return signal
    if not signal:
        return hit
    # Keep AI notes / fill gaps; openFDA wins on clearance chronology + ids
    merged = {**signal, **{k: v for k, v in hit.items() if v}}
    if signal.get("notes") and not hit.get("notes"):
        merged["notes"] = signal["notes"]
    merged["source"] = "openfda" if signal.get("source") in (None, "ai") else "mixed"
    return merged


def _normalize_patent(parsed: dict[str, Any], *, device: bool = False) -> dict[str, Any]:
    aliases = parsed.get("aliases") or parsed.get("synonyms") or []
    alias_list = [
        s
        for s in (_clean_field(x) for x in (aliases if isinstance(aliases, list) else [aliases]))
        if s
    ][:8]
    filing = _clean_field(parsed.get("filing_date") or parsed.get("patent_filing_date"))
    expiry_in = _clean_field(
        parsed.get("expiry_date")
        or parsed.get("patent_expiry_date")
        or parsed.get("loe_date")
    )
    expiry, years, method = _estimate_expiry(filing, expiry_in)
    core_patents = _normalize_core_patents(
        parsed.get("core_patents")
        or parsed.get("patents")
        or parsed.get("family_patents")
        or parsed.get("core_patent")
    )
    if str(parsed.get("method") or "").strip() in {
        "published_loe",
        "20y_from_filing",
        "unknown",
        "device_ip",
        "google_patents_family",
        "google_patents_anticipated",
    } and (expiry_in or device or core_patents):
        method = str(parsed.get("method")).strip() or method
    if device:
        method = "device_ip"
    sources = parsed.get("sources") or []
    source_list = [
        s
        for s in (_clean_field(x) for x in (sources if isinstance(sources, list) else [sources]))
        if s
    ][:6]
    # core_patents used for devices AND drug Google Patents family
    if device and not core_patents:
        single = _normalize_core_patents(
            [
                {
                    "patent_number": parsed.get("patent_number") or parsed.get("patent"),
                    "title": parsed.get("notes") or parsed.get("summary"),
                    "filing_date": filing,
                    "expiry_date": expiry_in,
                    "url": parsed.get("url"),
                }
            ]
        )
        core_patents = single
    if not device and core_patents:
        # Prefer the farthest Google Patents Anticipated expiration as summary LOE
        dated = [p for p in core_patents if p.get("expiry_date")]
        if dated:
            dated.sort(key=lambda p: str(p.get("expiry_date") or ""))
            pick = dated[-1]
            if not expiry_in or method in {
                "google_patents_family",
                "google_patents_anticipated",
                "unknown",
                "20y_from_filing",
            }:
                filing = filing or pick.get("filing_date")
                expiry_in = pick.get("expiry_date")
                expiry, years, _m = _estimate_expiry(filing, expiry_in)
                method = "google_patents_family"
            if not parsed.get("patent_number"):
                parsed = {**parsed, "patent_number": pick.get("patent_number")}

    competitive = _normalize_competitive_signal(
        parsed.get("competitive_signal")
        or parsed.get("first_same_code_clearance")
        or parsed.get("fda_clearance")
    )
    product_kind = "device" if device else "drug"
    kind_raw = _clean_field(parsed.get("product_kind") or parsed.get("kind"))
    if kind_raw and kind_raw.lower() in {"device", "medtech", "medical_device"}:
        product_kind = "device"
        method = "device_ip"

    out: dict[str, Any] = {
        "product_kind": product_kind,
        "brand_name": _clean_field(parsed.get("brand_name") or parsed.get("brand")),
        "generic_name": _clean_field(parsed.get("generic_name") or parsed.get("inn")),
        "aliases": alias_list,
        "patent_number": _clean_field(parsed.get("patent_number") or parsed.get("patent")),
        "filing_date": filing,
        "expiry_date": expiry if product_kind == "drug" else None,
        "years_remaining": years if product_kind == "drug" else None,
        "method": method,
        "notes": _clean_field(parsed.get("notes") or parsed.get("summary")),
        "sources": source_list,
        "core_patents": core_patents,
        "competitive_signal": competitive if product_kind == "device" else None,
    }
    if product_kind == "device" and core_patents and not out["patent_number"]:
        out["patent_number"] = core_patents[0].get("patent_number")
        out["filing_date"] = out["filing_date"] or core_patents[0].get("filing_date")
    if product_kind == "drug" and core_patents and not out["patent_number"]:
        out["patent_number"] = core_patents[0].get("patent_number")
    return out


def lookup_product_patent(
    *,
    ticker: str,
    product_name: str,
    company: str | None = None,
    nct_id: str | None = None,
    force: bool = False,
    product_kind: str | None = None,
) -> dict[str, Any]:
    """Gemini + web snippets: drug LOE, or device core patents + FDA clearance signal."""
    tk = (ticker or "").strip().upper()
    product = (product_name or "").strip()
    if not tk or not product:
        return {"ok": False, "error": "ticker and product_name required"}

    device = _detect_device_product(
        ticker=tk, product_name=product, product_kind=product_kind
    )
    key = _patent_cache_key(tk, product, device=device)
    with _CACHE_LOCK:
        cache_doc = _load_patent_cache()
        hit = cache_doc.get("entries", {}).get(key)
        if hit and not force and isinstance(hit.get("patent"), dict):
            patent = dict(hit["patent"])
            if device:
                patent["product_kind"] = "device"
                patent["method"] = "device_ip"
                if not patent.get("competitive_signal"):
                    patent["competitive_signal"] = _enrich_competitive_signal_openfda(
                        None, device_name=product
                    )
                elif (patent.get("competitive_signal") or {}).get("source") != "openfda":
                    patent["competitive_signal"] = _enrich_competitive_signal_openfda(
                        patent.get("competitive_signal"),
                        device_name=product,
                    )
            else:
                # Recompute years from cached expiry / Google Patents family
                cores = patent.get("core_patents") or []
                if isinstance(cores, list) and cores:
                    dated = [p for p in cores if isinstance(p, dict) and p.get("expiry_date")]
                    if dated:
                        dated.sort(key=lambda p: str(p.get("expiry_date") or ""))
                        pick = dated[-1]
                        patent["expiry_date"] = pick.get("expiry_date")
                        patent["filing_date"] = patent.get("filing_date") or pick.get(
                            "filing_date"
                        )
                        patent["patent_number"] = patent.get("patent_number") or pick.get(
                            "patent_number"
                        )
                expiry, years, method = _estimate_expiry(
                    patent.get("filing_date"), patent.get("expiry_date")
                )
                if expiry:
                    patent["expiry_date"] = expiry
                    patent["years_remaining"] = years
                    patent["method"] = patent.get("method") or method
                patent.setdefault("product_kind", "drug")
                patent.setdefault("core_patents", cores if isinstance(cores, list) else [])
            return {
                "ok": True,
                "cached": True,
                "provider": hit.get("provider"),
                "updated_at": hit.get("updated_at"),
                "web_hits": hit.get("web_hits") or [],
                "patent": patent,
            }

    snippets: list[str] = []
    co = (company or "").strip()
    alias_meta: dict[str, Any] = {
        "brand_name": None,
        "generic_name": None,
        "aliases": [product],
    }
    family_patents: list[dict[str, Any]] = []

    if device:
        queries = (
            f"{product} {co} patent USPTO medical device",
            f"{product} {co} FDA product code 510(k) PMA",
            f"{product} predicate device clearance",
        )
        for q in queries:
            snippets.extend(_ddg_patent_snippets(q, limit=4))
            if len(snippets) >= 8:
                break
    else:
        # 1) Gemini: all names for this product
        # 2) Google Patents: patent family + Anticipated expiration per title
        alias_meta = _gemini_product_aliases(
            ticker=tk, product=product, company=co or None
        )
        names = list(alias_meta.get("aliases") or [product])
        family_patents = _lookup_google_patents_family(
            names=names,
            company=co or None,
            ticker=tk,
            limit_search=8,
            limit_detail=8,
        )
        for fp in family_patents[:6]:
            title = fp.get("title") or ""
            pub = fp.get("patent_number") or ""
            exp = fp.get("expiry_date") or "n/a"
            snippets.append(f"Google Patents {pub}: {title} · Anticipated expiration {exp}")
        if not family_patents:
            for q in (
                f"{product} {co} patent expiration LOE",
                f"{product} composition of matter patent filing date Orange Book",
            ):
                snippets.extend(_ddg_patent_snippets(q, limit=4))
                if len(snippets) >= 8:
                    break

    if not ai_provider.is_available() and not family_patents:
        # Still try openFDA for devices without AI
        if device:
            competitive = _enrich_competitive_signal_openfda(None, device_name=product)
            if competitive:
                patent = _normalize_patent(
                    {
                        "product_kind": "device",
                        "brand_name": product,
                        "competitive_signal": competitive,
                        "notes": "Core patents unavailable (no AI). FDA clearance from openFDA.",
                        "method": "device_ip",
                    },
                    device=True,
                )
                return {
                    "ok": True,
                    "cached": False,
                    "provider": "openfda",
                    "web_hits": snippets[:8],
                    "patent": patent,
                }
        return {
            "ok": False,
            "error": "no_ai_provider",
            "web_hits": snippets[:8],
            "hint": ai_provider.provider_info().get("hint_it"),
        }

    # Drug path: Google Patents family is enough — skip Gemini LOE inventing
    if not device and family_patents:
        patent = _normalize_patent(
            {
                "product_kind": "drug",
                "brand_name": alias_meta.get("brand_name") or product,
                "generic_name": alias_meta.get("generic_name"),
                "aliases": [
                    a
                    for a in (alias_meta.get("aliases") or [])
                    if a and a.casefold() != product.casefold()
                ],
                "core_patents": family_patents,
                "method": "google_patents_family",
                "notes": (
                    "Patent family from Google Patents. "
                    "Expiry = Anticipated expiration on each patent Events timeline."
                ),
                "sources": ["Google Patents", "Gemini aliases"],
            },
            device=False,
        )
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        entry = {
            "ticker": tk,
            "product_name": product,
            "provider": "google_patents+gemini",
            "updated_at": stamp,
            "web_hits": snippets[:8],
            "schema": _PATENT_SCHEMA,
            "product_kind": "drug",
            "patent": patent,
        }
        with _CACHE_LOCK:
            cache_doc = _load_patent_cache()
            cache_doc.setdefault("entries", {})[key] = entry
            _save_patent_cache(cache_doc)
        return {
            "ok": True,
            "cached": False,
            "provider": "google_patents+gemini",
            "updated_at": stamp,
            "web_hits": snippets[:8],
            "patent": patent,
        }

    if not ai_provider.is_available():
        return {
            "ok": False,
            "error": "no_ai_provider",
            "web_hits": snippets[:8],
            "hint": ai_provider.provider_info().get("hint_it"),
        }

    if device:
        lines = [
            "This product is a MEDICAL DEVICE (not an Orange Book drug).",
            "Do NOT report Orange Book LOE or invent drug exclusivity.",
            "Return core device patent(s) if known, and the first same FDA product-code "
            "510(k)/PMA competitive clearance signal.",
            "",
            f"Ticker: {tk}",
            f"Company: {co or '(unknown)'}",
            f"Product / device name: {product}",
        ]
        if nct_id:
            lines.append(f"NCT ID (context): {nct_id.upper()}")
        if snippets:
            lines.append("")
            lines.append("Web search snippets:")
            for sn in snippets[:8]:
                lines.append(f"- {sn}")
        lines.extend(
            [
                "",
                "Return JSON with EXACTLY these keys:",
                "{",
                '  "product_kind": "device",',
                '  "brand_name": "string or null",',
                '  "generic_name": "common device name or null",',
                '  "aliases": ["other names"],',
                '  "core_patents": [',
                "    {",
                '      "patent_number": "string or null",',
                '      "title": "short title or null",',
                '      "filing_date": "YYYY-MM-DD or YYYY or null",',
                '      "expiry_date": "YYYY-MM-DD or YYYY or null"',
                "    }",
                "  ],",
                '  "competitive_signal": {',
                '    "clearance_type": "510(k) | PMA | De Novo | null",',
                '    "product_code": "FDA product code e.g. DXC or null",',
                '    "clearance_id": "K###### or P###### or null",',
                '    "decision_date": "YYYY-MM-DD or YYYY or null",',
                '    "applicant": "first clearance applicant or null",',
                '    "device_name": "cleared device name or null",',
                '    "notes": "1 sentence on competitive barrier / predicate landscape"',
                "  },",
                '  "notes": "1-2 sentences — device IP/regulatory context only",',
                '  "sources": ["short source names"]',
                "}",
            ]
        )
        system = _DEVICE_IP_SYSTEM
    else:
        lines = [
            "Estimate key US composition-of-matter / Orange Book LOE for this product.",
            "Prefer a published loss-of-exclusivity date. If missing, use filing date + 20 years.",
            "",
            f"Ticker: {tk}",
            f"Company: {co or '(unknown)'}",
            f"Product / drug name: {product}",
        ]
        if nct_id:
            lines.append(f"NCT ID (context): {nct_id.upper()}")
        if snippets:
            lines.append("")
            lines.append("Web search snippets:")
            for sn in snippets[:8]:
                lines.append(f"- {sn}")
        lines.extend(
            [
                "",
                "Return JSON with EXACTLY these keys:",
                "{",
                '  "product_kind": "drug",',
                '  "brand_name": "string or null",',
                '  "generic_name": "INN / generic, string or null",',
                '  "aliases": ["other names"],',
                '  "patent_number": "string or null",',
                '  "filing_date": "YYYY-MM-DD or YYYY or null",',
                '  "expiry_date": "published LOE YYYY-MM-DD or YYYY or null",',
                '  "method": "published_loe | 20y_from_filing | unknown",',
                '  "notes": "1-2 sentences on remaining exclusivity",',
                '  "sources": ["short source names"]',
                "}",
            ]
        )
        system = _PATENT_SYSTEM
    prompt = "\n".join(lines)

    provider_used = "gemini"
    raw: str | None = None
    if ai_provider.get_api_key("gemini"):
        raw = ai_provider._call_provider(  # noqa: SLF001
            "gemini",
            prompt,
            system=system,
            max_tokens=900 if device else 700,
            model_override=None,
            task="catalyst",
        )
        if not raw:
            provider_used = "fallback"
            raw = ai_provider.call_ai(
                prompt, system=system, max_tokens=900 if device else 700, task="clinical_kpi"
            )
    else:
        provider_used = "active"
        raw = ai_provider.call_ai(
            prompt, system=system, max_tokens=900 if device else 700, task="clinical_kpi"
        )

    if not raw:
        if device:
            competitive = _enrich_competitive_signal_openfda(None, device_name=product)
            if competitive:
                patent = _normalize_patent(
                    {
                        "product_kind": "device",
                        "brand_name": product,
                        "competitive_signal": competitive,
                        "notes": "AI empty — FDA clearance from openFDA only.",
                        "method": "device_ip",
                    },
                    device=True,
                )
                return {
                    "ok": True,
                    "cached": False,
                    "provider": "openfda",
                    "web_hits": snippets[:8],
                    "patent": patent,
                }
        return {
            "ok": False,
            "error": "ai_empty",
            "web_hits": snippets[:8],
            "detail": ai_provider.friendly_error_message(lang="it"),
        }

    parsed = _parse_ai_json(raw)
    if not parsed:
        return {"ok": False, "error": "ai_parse", "web_hits": snippets[:8]}

    patent = _normalize_patent(parsed, device=device)
    if device:
        patent["competitive_signal"] = _enrich_competitive_signal_openfda(
            patent.get("competitive_signal"),
            device_name=product,
        )
        # Drop misleading Orange-Book-style "not found" notes when we have device fields
        notes = patent.get("notes") or ""
        if re.search(r"orange\s+book|not a standard biopharmaceutical", notes, re.I):
            if patent.get("core_patents") or patent.get("competitive_signal"):
                patent["notes"] = None

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry = {
        "ticker": tk,
        "product_name": product,
        "provider": provider_used,
        "updated_at": stamp,
        "web_hits": snippets[:8],
        "schema": _PATENT_SCHEMA,
        "product_kind": "device" if device else "drug",
        "patent": patent,
    }
    with _CACHE_LOCK:
        cache_doc = _load_patent_cache()
        cache_doc.setdefault("entries", {})[key] = entry
        _save_patent_cache(cache_doc)

    return {
        "ok": True,
        "cached": False,
        "provider": provider_used,
        "updated_at": stamp,
        "web_hits": snippets[:8],
        "patent": patent,
    }


_PIPELINE_CACHE_PATH = Path(DATA_DIR) / "pipeline_overview_ai_cache.json"
# Ticker-scoped key (ignore fluctuating product hints) so Deep Dive remounts
# do not miss cache and re-call Gemini.
# v6: therapeutic_area on pipeline rows.
_PIPELINE_SCHEMA = 6
_PIPELINE_MAX_PRODUCTS = 40
_PIPELINE_MAX_APPROVED = 12
_PIPELINE_MAX_DEVELOPMENT = 28
# Soft freshness for UI note only — we still serve disk cache until force=True.
_PIPELINE_TTL_H = 24 * 90
_CTGOV_STUDIES_URL = "https://clinicaltrials.gov/api/v2/studies"
# One Gemini build at a time per ticker (UI remounts used to double-call).
_PIPELINE_BUILD_GUARD = threading.Lock()
_PIPELINE_BUILD_LOCKS: dict[str, threading.Lock] = {}
_PIPELINE_SYSTEM = (
    "You are a biotech pipeline analyst. Use established public facts "
    "(ClinicalTrials.gov, company pipeline / IR pages, FDA labels) plus the snippets. "
    "List the company's OWN products only — not competitors. "
    "PRIORITY: exhaustive clinical-development list (Ph1/Ph2/Ph3/registrational) "
    "with indication, therapeutic_area (broad bucket), USA prevalence, and CURRENT clinical phase. "
    "Also include major US-marketed brands separately (lifecycle=approved). "
    "Never return only the 1–2 near-CD catalyst names. If uncertain, use null. "
    "Return strict JSON only — no markdown."
)


def _pipeline_build_lock(ticker: str) -> threading.Lock:
    tk = (ticker or "").strip().upper()
    with _PIPELINE_BUILD_GUARD:
        lock = _PIPELINE_BUILD_LOCKS.get(tk)
        if lock is None:
            lock = threading.Lock()
            _PIPELINE_BUILD_LOCKS[tk] = lock
        return lock


def _pipeline_therapeutic_area(
    raw: Any,
    *,
    indication: str | None = None,
) -> str | None:
    """Lazy import avoids circular import with us_product_revenue_lookup."""
    try:
        from us_product_revenue_lookup import _norm_therapeutic_area

        return _norm_therapeutic_area(raw, indication=indication)
    except Exception:
        return None


def _load_pipeline_cache() -> dict[str, Any]:
    if not _PIPELINE_CACHE_PATH.is_file():
        return {"entries": {}}
    try:
        raw = json.loads(_PIPELINE_CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("entries"), dict):
            return raw
    except Exception:
        pass
    return {"entries": {}}


def _save_pipeline_cache(doc: dict[str, Any]) -> None:
    _PIPELINE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PIPELINE_CACHE_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _pipeline_cache_key(ticker: str, products: list[str] | None = None) -> str:
    """Stable per-ticker key — product hint lists must not bust Gemini cache."""
    _ = products
    return f"{(ticker or '').strip().upper()}|s{_PIPELINE_SCHEMA}"


def _pipeline_cache_fresh(hit: dict[str, Any]) -> bool:
    if int(hit.get("schema") or 0) < _PIPELINE_SCHEMA:
        return False
    stamp = str(hit.get("updated_at") or "")
    try:
        dt = datetime.strptime(stamp.replace("Z", ""), "%Y-%m-%dT%H:%M:%S").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return False
    age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    return 0 <= age_h < _PIPELINE_TTL_H


def _find_pipeline_cache_entry(
    cache_doc: dict[str, Any], ticker: str
) -> dict[str, Any] | None:
    """Only accept current-schema ticker entries (ignore sparse legacy keys)."""
    entries = cache_doc.get("entries") if isinstance(cache_doc.get("entries"), dict) else {}
    tk = (ticker or "").strip().upper()
    if not tk or not isinstance(entries, dict):
        return None
    primary = entries.get(_pipeline_cache_key(tk))
    if (
        isinstance(primary, dict)
        and isinstance(primary.get("products"), list)
        and primary.get("products")
        and int(primary.get("schema") or 0) >= _PIPELINE_SCHEMA
    ):
        return primary
    return None


def _phase_rank_label(phase_raw: Any) -> tuple[int, str | None]:
    s = str(phase_raw or "").upper()
    if "PHASE4" in s or "PHASE 4" in s or s == "4":
        return 4, "Phase 4"
    if "PHASE3" in s or "PHASE 3" in s or s == "3":
        return 3, "Phase 3"
    if "PHASE2" in s or "PHASE 2" in s or s == "2":
        return 2, "Phase 2"
    if "PHASE1" in s or "PHASE 1" in s or s == "1":
        return 1, "Phase 1"
    if "EARLY" in s:
        return 1, "Early Phase 1"
    return 0, _clean_field(phase_raw, max_len=48)


def _ctgov_development_seeds(
    ticker: str,
    company: str | None,
    *,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """
    Active/clinical CT.gov studies for the sponsor → development program seeds
    (name, phase, indication). Used so big pharma is not stuck on near-CD feed hints.
    """
    try:
        import requests
    except ImportError:
        return []

    tk = (ticker or "").strip().upper()
    co = (company or "").strip()
    terms: list[str] = []
    if co:
        terms.append(co)
        # short form e.g. AstraZeneca PLC → AstraZeneca
        short = re.sub(r"\b(inc|corp|corporation|plc|ltd|limited|company|co)\b\.?", "", co, flags=re.I)
        short = re.sub(r"\s+", " ", short).strip(" ,.")
        if short and short.lower() != co.lower():
            terms.append(short)
    if tk and tk not in {t.upper() for t in terms}:
        terms.append(tk)
    if not terms:
        return []

    alive = {
        "RECRUITING",
        "ACTIVE_NOT_RECRUITING",
        "ENROLLING_BY_INVITATION",
        "NOT_YET_RECRUITING",
        "AVAILABLE",
    }
    by_key: dict[str, dict[str, Any]] = {}

    for term in terms[:3]:
        try:
            r = requests.get(
                _CTGOV_STUDIES_URL,
                params={
                    "query.spons": term,
                    "pageSize": min(50, max(limit * 2, 30)),
                },
                timeout=12,
            )
            r.raise_for_status()
            data = r.json()
        except Exception:
            continue
        for study in data.get("studies") or []:
            p = study.get("protocolSection") or {}
            sponsor_mod = p.get("sponsorCollaboratorsModule") or {}
            lead = str((sponsor_mod.get("leadSponsor") or {}).get("name") or "")
            lead_l = lead.lower()
            # Prefer lead-sponsored studies; allow AZN/AstraZeneca substring.
            if co:
                co_tok = re.sub(r"[^a-z0-9]+", " ", co.lower()).split()
                co_tok = [t for t in co_tok if len(t) > 3][:2]
                if co_tok and not any(t in lead_l for t in co_tok):
                    if tk.lower() not in lead_l and "astrazeneca" not in lead_l:
                        continue
            elif tk and tk.lower() not in lead_l:
                continue
            status_mod = p.get("statusModule") or {}
            status = str(status_mod.get("overallStatus") or "").upper()
            if status and status not in alive:
                continue
            design = p.get("designModule") or {}
            phases = design.get("phases") or []
            if isinstance(phases, str):
                phases = [phases]
            best_rank, phase_label = 0, None
            for ph in phases:
                rank, lab = _phase_rank_label(ph)
                if rank > best_rank:
                    best_rank, phase_label = rank, lab
            if best_rank < 1:
                continue
            conds = p.get("conditionsModule") or {}
            conditions = conds.get("conditions") or []
            indication = None
            if isinstance(conditions, list) and conditions:
                indication = _clean_field(conditions[0], max_len=160)
            arms = p.get("armsInterventionsModule") or {}
            interventions = arms.get("interventions") or []
            names: list[str] = []
            for iv in interventions:
                if not isinstance(iv, dict):
                    continue
                itype = str(iv.get("type") or "").upper()
                if itype and itype not in ("DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT"):
                    continue
                nm = _clean_field(iv.get("name"), max_len=80)
                if not nm:
                    continue
                # Drop dose-only noise: "Olaparib 300mg tablets"
                if re.search(r"\b\d+\s*mg\b", nm, re.I) and len(nm.split()) <= 4:
                    nm = re.sub(r"\b\d+\s*mg\b.*", "", nm, flags=re.I).strip(" -/," )
                if nm:
                    names.append(nm)
            if not names:
                continue
            for nm in names[:2]:
                key = re.sub(r"[^a-z0-9]+", "", nm.lower())
                if not key or len(key) < 3:
                    continue
                if re.search(r"\b(placebo|standard of care|soc|rosuvastatin)\b", nm, re.I):
                    continue
                prev = by_key.get(key)
                row = {
                    "name": nm,
                    "lifecycle": "development",
                    "phase": phase_label,
                    "indication": indication,
                    "therapeutic_area": _pipeline_therapeutic_area(None, indication=indication),
                    "usa_prevalence": None,
                    "modality": None,
                    "mechanism_of_action": None,
                    "patent_cliff": None,
                    "_phase_rank": best_rank,
                }
                if not prev or best_rank > int(prev.get("_phase_rank") or 0):
                    by_key[key] = row
        if len(by_key) >= limit:
            break

    ranked = sorted(
        by_key.values(),
        key=lambda r: (-int(r.get("_phase_rank") or 0), str(r.get("name") or "").lower()),
    )
    out: list[dict[str, Any]] = []
    for r in ranked[:limit]:
        r.pop("_phase_rank", None)
        out.append(r)
    return out


def _merge_pipeline_with_ctgov(
    ai_rows: list[dict[str, Any]],
    ctgov_rows: list[dict[str, Any]],
    feed_hints: list[str],
) -> list[dict[str, Any]]:
    """CT.gov development + AI enrichment/approved; feed hints only as last resort."""
    approved: list[dict[str, Any]] = []
    development: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _key(name: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", (name or "").lower())

    def _push(bucket: list[dict[str, Any]], row: dict[str, Any]) -> None:
        name = str(row.get("name") or "").strip()
        k = _key(name)
        if not k or k in seen:
            # Enrich existing development row with AI fields when CT.gov came first.
            if k in seen and row.get("lifecycle") != "approved":
                for existing in development:
                    if _key(str(existing.get("name") or "")) == k:
                        for fld in (
                            "usa_prevalence",
                            "indication",
                            "phase",
                            "modality",
                            "mechanism_of_action",
                        ):
                            if not existing.get(fld) and row.get(fld):
                                existing[fld] = row[fld]
                        break
            return
        seen.add(k)
        bucket.append(row)

    for r in ai_rows:
        if str(r.get("lifecycle") or "") == "approved":
            _push(approved, r)
        else:
            _push(development, r)

    # CT.gov seeds fill gaps in development (and come first for ranking preference).
    ct_first: list[dict[str, Any]] = []
    for r in ctgov_rows:
        k = _key(str(r.get("name") or ""))
        if not k:
            continue
        if k in seen:
            for existing in development:
                if _key(str(existing.get("name") or "")) == k:
                    for fld in ("indication", "phase"):
                        if not existing.get(fld) and r.get(fld):
                            existing[fld] = r[fld]
                    break
            continue
        seen.add(k)
        ct_first.append(r)

    development = ct_first + development

    for hint in feed_hints:
        name = _clean_field(hint, max_len=80)
        if not name:
            continue
        k = _key(name)
        if k in seen:
            continue
        seen.add(k)
        development.append(
            {
                "name": name,
                "lifecycle": "development",
                "phase": None,
                "indication": None,
                "usa_prevalence": None,
                "modality": None,
                "mechanism_of_action": None,
                "patent_cliff": None,
            }
        )

    approved = approved[:_PIPELINE_MAX_APPROVED]
    development = development[:_PIPELINE_MAX_DEVELOPMENT]
    return approved + development


def _infer_pipeline_lifecycle(phase: str | None, raw: Any = None) -> str:
    """Return 'approved' or 'development'."""
    for candidate in (raw, phase):
        s = str(candidate or "").strip().lower()
        if not s:
            continue
        if s in ("approved", "marketed", "commercial", "on_market", "on-market"):
            return "approved"
        if s in ("development", "clinical", "pipeline", "in_development", "investigational"):
            return "development"
        if re.search(
            r"approv|marketed|commercial|launched|on[\s-]?market|510\s*\(\s*k\s*\)|cleared|\bpma\b",
            s,
            re.I,
        ):
            return "approved"
    return "development"


def normalize_pipeline_overview(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    rows = parsed.get("products") or parsed.get("pipeline") or []
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in rows:
        if not isinstance(item, dict):
            continue
        name = _clean_field(
            item.get("name") or item.get("product") or item.get("asset"),
            max_len=80,
        )
        if not name:
            continue
        key = re.sub(r"[^a-z0-9]+", "", name.lower())
        if key in seen:
            continue
        seen.add(key)
        phase = _clean_field(item.get("phase") or item.get("clinical_phase"), max_len=48)
        lifecycle = _infer_pipeline_lifecycle(
            phase,
            item.get("lifecycle") or item.get("status") or item.get("commercial_status"),
        )
        indication = _clean_field(
            item.get("indication") or item.get("disease"),
            max_len=220,
        )
        out.append(
            {
                "name": name,
                "modality": _clean_field(item.get("modality") or item.get("product_technology")),
                "mechanism_of_action": _clean_field(
                    item.get("mechanism_of_action")
                    or item.get("moa")
                    or item.get("mechanismOfAction")
                    or item.get("moa_target"),
                    max_len=420,
                ),
                "indication": indication,
                "therapeutic_area": _pipeline_therapeutic_area(
                    item.get("therapeutic_area")
                    or item.get("therapy_area")
                    or item.get("ta")
                    or item.get("disease_area"),
                    indication=indication,
                ),
                "usa_prevalence": _clean_field(
                    item.get("usa_prevalence")
                    or item.get("us_prevalence")
                    or item.get("prevalence"),
                    max_len=220,
                ),
                "phase": phase,
                "lifecycle": lifecycle,
                "patent_cliff": _clean_field(
                    item.get("patent_cliff")
                    or item.get("loe")
                    or item.get("loe_estimate")
                    or item.get("us_patent_expiry")
                    or item.get("loss_of_exclusivity"),
                    max_len=120,
                ),
            }
        )
        if len(out) >= _PIPELINE_MAX_PRODUCTS:
            break
    # Approved first (by name), then development — UI also splits, but cache stays stable.
    out.sort(
        key=lambda r: (
            0 if r.get("lifecycle") == "approved" else 1,
            str(r.get("name") or "").lower(),
        )
    )
    return out


def _merge_pipeline_hints(
    rows: list[dict[str, Any]], hints: list[str]
) -> list[dict[str, Any]]:
    """Prefer AI/company rows; append feed hints only when missing (do not crowd out marketed brands)."""
    by_key = {
        re.sub(r"[^a-z0-9]+", "", str(r.get("name") or "").lower()): r for r in rows
    }
    ordered: list[dict[str, Any]] = []
    used: set[str] = set()

    # 1) AI / normalized rows first (full commercial + pipeline summary).
    for r in rows:
        key = re.sub(r"[^a-z0-9]+", "", str(r.get("name") or "").lower())
        if not key or key in used:
            continue
        ordered.append(r)
        used.add(key)

    # 2) Near-CD feed hints only if Gemini missed them.
    for hint in hints:
        name = _clean_field(hint, max_len=80)
        if not name:
            continue
        key = re.sub(r"[^a-z0-9]+", "", name.lower())
        if key in used:
            continue
        existing = by_key.get(key)
        if existing:
            ordered.append(existing)
        else:
            ordered.append(
                {
                    "name": name,
                    "modality": None,
                    "mechanism_of_action": None,
                    "indication": None,
                    "therapeutic_area": None,
                    "usa_prevalence": None,
                    "phase": None,
                    "lifecycle": "development",
                    "patent_cliff": None,
                }
            )
        used.add(key)
        if len(ordered) >= _PIPELINE_MAX_PRODUCTS:
            break
    return ordered[:_PIPELINE_MAX_PRODUCTS]


def lookup_pipeline_overview(
    *,
    ticker: str,
    company: str | None = None,
    products: list[str] | None = None,
    nct_id: str | None = None,
    conditions: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    tk = (ticker or "").strip().upper()
    if not tk:
        return {"ok": False, "error": "ticker required"}
    hints = [str(p).strip() for p in (products or []) if str(p).strip()][:12]
    key = _pipeline_cache_key(tk)

    def _serve_cache() -> dict[str, Any] | None:
        with _CACHE_LOCK:
            cache_doc = _load_pipeline_cache()
            hit = _find_pipeline_cache_entry(cache_doc, tk)
            # Serve any disk hit unless force — do not re-call Gemini on Deep Dive remount.
            if hit and not force and isinstance(hit.get("products"), list) and hit.get("products"):
                cached_rows = [r for r in hit["products"] if isinstance(r, dict)]
                if cache_doc.get("entries", {}).get(key) is not hit:
                    try:
                        upgraded = {
                            **hit,
                            "ticker": tk,
                            "schema": _PIPELINE_SCHEMA,
                        }
                        cache_doc.setdefault("entries", {})[key] = upgraded
                        _save_pipeline_cache(cache_doc)
                    except Exception:
                        pass
                return {
                    "ok": True,
                    "cached": True,
                    "provider": hit.get("provider"),
                    "updated_at": hit.get("updated_at"),
                    "products": list(cached_rows),
                }
        return None

    early = _serve_cache()
    if early:
        return early

    with _pipeline_build_lock(tk):
        again = _serve_cache()
        if again:
            return again

        co = (company or "").strip()
        ctgov_seeds = _ctgov_development_seeds(tk, co or None, limit=_PIPELINE_MAX_DEVELOPMENT)
        ctgov_names = [str(r.get("name") or "") for r in ctgov_seeds if r.get("name")]

        snippets: list[str] = []
        for q in (
            f"{co or tk} {tk} clinical pipeline Phase 1 2 3 assets",
            f"{co or tk} {tk} US marketed brands pipeline overview",
        ):
            if not q:
                continue
            snippets.extend(_ddg_patent_snippets(q, limit=3))
            if len(snippets) >= 8:
                break

        if not ai_provider.is_available():
            return {
                "ok": False,
                "error": "no_ai_provider",
                "products": _merge_pipeline_with_ctgov([], ctgov_seeds, hints),
                "hint": ai_provider.provider_info().get("hint_it"),
            }

        lines = [
            "Build a company product summary for investors.",
            f"Return UP TO {_PIPELINE_MAX_PRODUCTS} of the company's OWN products in TWO categories:",
            f"1) Approved / on-market (US) — up to {_PIPELINE_MAX_APPROVED} major commercial brands.",
            f"2) In clinical development — up to {_PIPELINE_MAX_DEVELOPMENT} Ph1/Ph2/Ph3/registrational assets.",
            "For EVERY product include when known: modality, MoA/protein target (mechanism_of_action), "
            "indication, therapeutic_area (broad bucket), usa_prevalence.",
            "For development: phase is required (current stage). For approved: also patent_cliff (US LOE).",
            "Put prevalence ONLY in usa_prevalence — never append it to indication.",
            "Do NOT stop at 1–2 near-CD names — cover the broad clinical pipeline.",
            "",
            f"Ticker: {tk}",
            f"Company: {co or '(unknown)'}",
        ]
        if ctgov_names:
            lines.append(
                "ClinicalTrials.gov active sponsor studies (KEEP these development assets; enrich indication/prevalence/phase):"
            )
            for nm, seed in zip(ctgov_names[:24], ctgov_seeds[:24]):
                bits = [nm]
                if seed.get("phase"):
                    bits.append(str(seed["phase"]))
                if seed.get("indication"):
                    bits.append(str(seed["indication"])[:80])
                lines.append(f"- {' · '.join(bits)}")
        if hints:
            lines.append("Near-term catalyst names from our clinical feed (keep if real):")
            for h in hints:
                lines.append(f"- {h}")
        if nct_id:
            lines.append(f"Completing NCT (context only): {nct_id.upper()}")
        if conditions:
            lines.append(f"Lead indication / conditions: {conditions[:300]}")
        if snippets:
            lines.append("")
            lines.append("Web search snippets:")
            for sn in snippets[:8]:
                lines.append(f"- {sn}")
        lines.extend(
            [
                "",
                "Return JSON with EXACTLY this shape:",
                "{",
                '  "products": [',
                "    {",
                '      "name": "product name",',
                '      "lifecycle": "approved" | "development",',
                '      "modality": "Small molecule | Biologic | …",',
                '      "mechanism_of_action": "MoA · protein target (e.g. EGFR TKI · EGFR) or null",',
                '      "indication": "primary disease only (no prevalence here)",',
                '      "therapeutic_area": "Oncology | Respiratory | …",',
                '      "usa_prevalence": "approximate US prevalence/incidence",',
                '      "phase": "Phase 3 | Phase 2 | Phase 1 | Approved | …",',
                '      "patent_cliff": "US LOE ~2028 or null if development"',
                "    }",
                "  ]",
                "}",
                "Put prevalence ONLY in usa_prevalence. Prefer MoA with protein target when known.",
                "therapeutic_area must be a broad franchise bucket, not the narrow indication.",
                f"Target ~{_PIPELINE_MAX_APPROVED} approved + as many development assets as known (max {_PIPELINE_MAX_DEVELOPMENT}).",
            ]
        )
        prompt = "\n".join(lines)

        provider_used = "gemini"
        raw: str | None = None
        if ai_provider.get_api_key("gemini"):
            raw = ai_provider._call_provider(  # noqa: SLF001
                "gemini",
                prompt,
                system=_PIPELINE_SYSTEM,
                max_tokens=3600,
                model_override=None,
                task="catalyst",
            )
            if not raw:
                provider_used = "fallback"
                raw = ai_provider.call_ai(
                    prompt, system=_PIPELINE_SYSTEM, max_tokens=3600, task="clinical_kpi"
                )
        else:
            provider_used = "active"
            raw = ai_provider.call_ai(
                prompt, system=_PIPELINE_SYSTEM, max_tokens=3600, task="clinical_kpi"
            )

        if not raw:
            return {
                "ok": False,
                "error": "ai_empty",
                "products": _merge_pipeline_with_ctgov([], ctgov_seeds, hints),
                "detail": ai_provider.friendly_error_message(lang="it"),
            }

        parsed = _parse_ai_json(raw)
        if not parsed:
            return {
                "ok": False,
                "error": "ai_parse",
                "products": _merge_pipeline_with_ctgov([], ctgov_seeds, hints),
            }

        products_out = _merge_pipeline_with_ctgov(
            normalize_pipeline_overview(parsed), ctgov_seeds, hints
        )
        if not products_out:
            return {"ok": False, "error": "ai_sparse", "products": []}

        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        entry = {
            "ticker": tk,
            "schema": _PIPELINE_SCHEMA,
            "provider": provider_used,
            "updated_at": stamp,
            "products": products_out,
            "ctgov_seed_count": len(ctgov_seeds),
        }
        with _CACHE_LOCK:
            cache_doc = _load_pipeline_cache()
            cache_doc.setdefault("entries", {})[key] = entry
            _save_pipeline_cache(cache_doc)

        return {
            "ok": True,
            "cached": False,
            "provider": provider_used,
            "updated_at": stamp,
            "products": products_out,
            "ctgov_seed_count": len(ctgov_seeds),
        }
