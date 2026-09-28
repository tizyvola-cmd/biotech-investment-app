"""
Product study dossier — CT.gov studies for one drug + PubMed papers
(drug in title or abstract; company affiliation optional — used to rank/★, not required).

Display-only for the CD / Deep Dive study window. Not Soft BUY/SELL.
"""
from __future__ import annotations

import json
import re
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

import ai_provider
from clinical_trial_summary import (
    CTGOV_SLEEP_SEC,
    PUBMED_SLEEP_SEC,
    _HEADERS,
    _PUBMED_EMAIL,
    _PUBMED_FETCH,
    _PUBMED_SEARCH,
    _ctgov_get,
    _extract_results,
)
from orchestrator_io_paths import DATA_DIR

_CACHE_PATH = Path(DATA_DIR) / "product_study_dossier_cache.json"
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_H = 12
_DOSSIER_VERSION = 7  # plain-language readout explainer on studies with posted results
_MAX_STUDIES = 6
_MAX_PUBMED = 8
_MAX_PAPER_REFS = 12
_PDF_NOT_AVAILABLE = "pdf not available"
_CTGOV_SEARCH = "https://clinicaltrials.gov/api/v2/studies"
# Section summary budgets (words) — Results needs room for studies / stats / endpoints.
_INTRO_WORDS = 100
_RESULTS_WORDS = 180
_CONCLUSION_WORDS = 100

_SYSTEM_PAPER = (
    "You are a biotech analyst summarizing a journal article for investors. "
    "Return strict JSON only — no markdown. "
    "Keys: introduction, results, discussion. "
    "introduction = representative summary of the article's aim, disease context, "
    "and study design (complete sentences; no truncation mid-clause). "
    "results = what studies were done (models, cohorts, arms, n), conditions/"
    "populations, primary/secondary readouts, outcomes, and statistics "
    "(n, %, HR, OR, p-values, CI) when present in the source. "
    "discussion = implications / takeaways from the discussion or conclusions. "
    "Use only facts present in the abstract or provided text; never invent numbers. "
    "Do not repeat the same sentence across keys."
)


_READOUT_WORDS = 70
_SYSTEM_READOUT = (
    "You explain clinical trial readouts to a non-clinical investor. "
    "Return strict JSON only — no markdown. "
    "Keys: what, why, impact. "
    "what = what the endpoint physically measures, in plain language (no jargon; "
    "expand acronyms; say the unit and whether lower or higher is better). "
    "why = why clinicians and regulators track this measure in this specific "
    "disease — what it says about the patient. "
    "impact = how to read the numbers actually reported in this study, including "
    "the typical effect size of the current standard of care for the same disease "
    "and endpoint, so the reader can tell whether the result is competitive. "
    "Name the standard-of-care comparator and its usual effect size when you know "
    "it, and say explicitly when the comparison is approximate. "
    "Never invent numbers for this study: use only the results provided."
)


def _cache_key(ticker: str, product: str, company: str) -> str:
    tk = (ticker or "").strip().upper()
    pr = re.sub(r"\s+", " ", (product or "").strip().lower())
    co = re.sub(r"\s+", " ", (company or "").strip().lower())
    return f"{tk}|{pr}|{co}"


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


def _cache_fresh(entry: dict[str, Any]) -> bool:
    if int(entry.get("dossier_version") or 0) < _DOSSIER_VERSION:
        return False
    ts = str(entry.get("updated_at") or "")
    if not ts:
        return False
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return False
    age_h = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600
    return age_h <= _CACHE_TTL_H


def _clean(raw: Any) -> str | None:
    s = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not s or re.match(r"^(n/?d|null|none|unknown|—|-)$", s, re.I):
        return None
    return s


def _cap_words(text: str | None, n: int = 50) -> str | None:
    s = _clean(text)
    if not s:
        return None
    words = s.split()
    if len(words) <= n:
        return s
    return " ".join(words[:n]).rstrip(",;:.") + "…"


def _product_needles(product: str, aliases: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in [product, *aliases]:
        tok = _clean(raw)
        if not tok:
            continue
        low = tok.lower()
        if low in seen or len(low) < 4:
            continue
        seen.add(low)
        out.append(tok)
    return out


def _mentions_product(blob: str, needles: list[str]) -> bool:
    hay = (blob or "").lower()
    for n in needles:
        if n.lower() in hay:
            return True
        compact = re.sub(r"[^a-z0-9]", "", n.lower())
        if len(compact) >= 5 and compact in re.sub(r"[^a-z0-9]", "", hay):
            return True
    return False


def _is_positive_stat(*, p_value: str | None, comment: str | None, values: str | None) -> bool:
    blob = " ".join(x for x in (p_value, comment, values) if x)
    if not blob:
        return False
    try:
        raw = str(p_value or "").strip()
        if re.fullmatch(r"[0-9]*\.?[0-9]+(?:e-?\d+)?", raw) and float(raw) < 0.05:
            return True
    except (TypeError, ValueError):
        pass
    if re.search(
        r"\bp\s*(?:value)?\s*[=<>≤]\s*(?:0?\.0*[0-4]\d*|0\.05(?!\d)|5e-\d|[0-4]?\.\d+e-\d+)",
        blob,
        re.I,
    ):
        return True
    try:
        m = re.search(r"\bp\s*(?:value)?\s*[=<>≤]\s*([0-9]*\.?[0-9]+(?:e-?\d+)?)", blob, re.I)
        if m and float(m.group(1)) < 0.05:
            return True
    except (TypeError, ValueError):
        pass
    return bool(
        re.search(
            r"statistically significant|superior to placebo|endpoint met|"
            r"significantly (?:higher|greater|improved|longer|lower)|favou?red",
            blob,
            re.I,
        )
    )


def _primary_secondary_oms(outcome_measures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    primary = [om for om in outcome_measures if re.search(r"primary", str(om.get("type") or ""), re.I)]
    secondary = [
        om for om in outcome_measures if re.search(r"secondary", str(om.get("type") or ""), re.I)
    ]
    other = [
        om
        for om in outcome_measures
        if om not in primary and om not in secondary
        and not re.search(r"other|exploratory|tertiary", str(om.get("type") or ""), re.I)
    ]
    out: list[dict[str, Any]] = []
    if len(primary) >= 2:
        return primary[:2]
    if primary:
        out.append(primary[0])
    elif other:
        out.append(other[0])
    if secondary:
        out.append(secondary[0])
    elif len(other) > 1 and len(out) < 2:
        out.append(other[1])
    return out[:2]


def _analyses_from_raw_outcome(om: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sa in om.get("statisticalAnalyses") or []:
        if not isinstance(sa, dict):
            continue
        p_val = _clean(sa.get("pValue"))
        param_type = _clean(sa.get("paramType"))
        param_val = _clean(sa.get("paramValue"))
        ci_lo = _clean(sa.get("ciLowerLimit"))
        ci_hi = _clean(sa.get("ciUpperLimit"))
        ci_pct = _clean(sa.get("ciPctValue"))
        comment = _clean(sa.get("estimateComment") or sa.get("pValueComment"))
        stat_bits = []
        if param_type and param_val:
            stat_bits.append(f"{param_type} {param_val}")
        elif param_val:
            stat_bits.append(param_val)
        if ci_lo and ci_hi:
            pct = f"{ci_pct}% " if ci_pct else ""
            stat_bits.append(f"{pct}CI {ci_lo}–{ci_hi}")
        if p_val:
            stat_bits.append(f"p={p_val}" if not re.search(r"\bp\s*[=<>]", p_val, re.I) else p_val)
        statistic = " · ".join(stat_bits) or None
        rows.append(
            {
                "statistic": statistic,
                "p_value": p_val,
                "comment": comment,
                "positive": _is_positive_stat(p_value=p_val, comment=comment, values=statistic),
            }
        )
    return rows


def _arm_result_text(om: dict[str, Any]) -> str | None:
    if not isinstance(om, dict):
        return None
    groups = {
        str(g.get("id") or ""): str(g.get("title") or g.get("id") or "").strip()
        for g in (om.get("groups") or [])
        if isinstance(g, dict)
    }
    bits: list[str] = []
    for cls in om.get("classes") or []:
        if not isinstance(cls, dict):
            continue
        for cat in cls.get("categories") or []:
            if not isinstance(cat, dict):
                continue
            for m in cat.get("measurements") or []:
                if not isinstance(m, dict):
                    continue
                val = _clean(m.get("value"))
                if not val:
                    continue
                gid = str(m.get("groupId") or "")
                name = groups.get(gid) or gid or "arm"
                spread = _clean(m.get("spread"))
                piece = f"{name}: {val}"
                if spread and spread.upper() != "NA":
                    piece += f" ±{spread}"
                bits.append(piece)
            if bits:
                break
        if bits:
            break
    return " · ".join(bits[:4]) or None


def _table_rows_for_study(raw_study: dict[str, Any], extracted: dict[str, Any]) -> list[dict[str, Any]]:
    raw_oms = (
        ((raw_study.get("resultsSection") or {}).get("outcomeMeasuresModule") or {}).get(
            "outcomeMeasures"
        )
        or []
    )
    raw_by_title = {
        str(om.get("title") or om.get("measure") or "").strip().lower(): om
        for om in raw_oms
        if isinstance(om, dict)
    }
    rows: list[dict[str, Any]] = []
    for om in _primary_secondary_oms(list(extracted.get("outcome_measures") or [])):
        title = str(om.get("title") or "").strip()
        raw_om = raw_by_title.get(title.lower()) or {}
        values = om.get("values") if isinstance(om.get("values"), list) else []
        value_txt = _arm_result_text(raw_om) or " · ".join(str(v) for v in values[:4] if v) or None
        analyses = _analyses_from_raw_outcome(raw_om)
        p_hint = _clean(om.get("p_value_hint"))
        if not analyses:
            analyses = [
                {
                    "statistic": p_hint,
                    "p_value": p_hint,
                    "comment": None,
                    "positive": _is_positive_stat(
                        p_value=p_hint, comment=None, values=value_txt
                    ),
                }
            ]
        stat = analyses[0] if analyses else {}
        positive = bool(stat.get("positive"))
        rows.append(
            {
                "endpoint": title,
                "type": str(om.get("type") or "").strip() or "PRIMARY",
                "time_frame": _clean(om.get("time_frame")),
                "result": value_txt,
                "statistic": stat.get("statistic") or p_hint,
                "p_value": stat.get("p_value") or p_hint,
                "positive": positive,
                "description": _clean(om.get("description")),
            }
        )
    return rows


def _ctgov_search(product: str, *, page_size: int = 20) -> list[dict[str, Any]]:
    drug = _clean(product)
    if not drug:
        return []
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for param_key in ("query.intr", "query.term"):
        params = {
            param_key: drug,
            "pageSize": str(page_size),
            "countTotal": "true",
        }
        time.sleep(CTGOV_SLEEP_SEC)
        try:
            r = requests.get(_CTGOV_SEARCH, params=params, headers=_HEADERS, timeout=22)
            if r.status_code != 200:
                continue
            data = r.json()
        except Exception:
            continue
        studies = data.get("studies") if isinstance(data, dict) else None
        for s in studies or []:
            if not isinstance(s, dict):
                continue
            ident = (s.get("protocolSection") or {}).get("identificationModule") or {}
            nct = str(ident.get("nctId") or "").strip().upper()
            if not nct or nct in seen:
                continue
            seen.add(nct)
            out.append(s)
    return out


def _study_mentions_product(study: dict[str, Any], needles: list[str]) -> bool:
    proto = study.get("protocolSection") or {}
    ident = proto.get("identificationModule") or {}
    arms = proto.get("armsInterventionsModule") or {}
    bits = [
        str(ident.get("briefTitle") or ""),
        str(ident.get("officialTitle") or ""),
    ]
    for iv in arms.get("interventions") or []:
        if isinstance(iv, dict):
            bits.append(str(iv.get("name") or ""))
    return _mentions_product(" ".join(bits), needles)


def _build_study_card(raw: dict[str, Any], extracted: dict[str, Any]) -> dict[str, Any]:
    nct = _clean(extracted.get("nct_id")) or ""
    return {
        "nct_id": nct,
        "title": _clean(extracted.get("brief_title")),
        "phase": _clean(extracted.get("phase")),
        "status": _clean(extracted.get("overall_status")),
        "enrollment": extracted.get("enrollment"),
        "design": _clean(extracted.get("study_design")),
        "conditions": _clean(extracted.get("conditions")),
        "interventions": _clean(extracted.get("interventions")),
        "sponsor": _clean(extracted.get("lead_sponsor")),
        "start_date": _clean(extracted.get("start_date")),
        "completion_date": _clean(
            extracted.get("primary_completion_date") or extracted.get("completion_date")
        ),
        "has_results": bool(extracted.get("has_results")),
        "ctgov_url": f"https://clinicaltrials.gov/study/{nct}" if nct else None,
        "results_table": _table_rows_for_study(raw, extracted),
    }


def _readout_explainer_ai(card: dict[str, Any], *, product: str) -> dict[str, str] | None:
    """Plain-language reading of the posted endpoints, benchmarked on standard of care."""
    rows = [r for r in (card.get("results_table") or []) if isinstance(r, dict)]
    if not rows or not ai_provider.is_available():
        return None

    lines: list[str] = []
    for row in rows[:6]:
        bits = [
            f"endpoint: {_clean(row.get('endpoint')) or '—'}",
            f"type: {_clean(row.get('type')) or '—'}",
            f"time frame: {_clean(row.get('time_frame')) or '—'}",
            f"result: {_clean(row.get('result')) or '—'}",
            f"statistic: {_clean(row.get('statistic')) or _clean(row.get('p_value')) or '—'}",
        ]
        lines.append(" · ".join(bits))

    prompt = (
        f"Drug / product: {product}\n"
        f"Disease / indication: {_clean(card.get('conditions')) or 'not reported'}\n"
        f"Study: {_clean(card.get('title')) or _clean(card.get('nct_id')) or '—'}\n"
        f"Phase: {_clean(card.get('phase')) or '—'} · "
        f"design: {_clean(card.get('design')) or '—'} · "
        f"patients: {card.get('enrollment') if card.get('enrollment') is not None else '—'}\n\n"
        "Posted endpoints (sole evidence for this study):\n"
        + "\n".join(lines)
        + "\n\nReturn JSON with keys what, why, impact.\n"
        f"- what: ≤{_READOUT_WORDS} words — what these readouts measure, in plain words.\n"
        f"- why: ≤{_READOUT_WORDS} words — why this measure is followed in this disease.\n"
        f"- impact: ≤{_READOUT_WORDS} words — how to read the reported numbers versus "
        "the standard of care for this disease and endpoint.\n"
        "Use null for a key you cannot support."
    )
    raw = ai_provider.call_ai(prompt, system=_SYSTEM_READOUT, max_tokens=700, task="clinical_kpi")
    if not raw:
        return None
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        parsed = json.loads(text)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    out: dict[str, str] = {}
    for key in ("what", "why", "impact"):
        val = _cap_words(parsed.get(key), _READOUT_WORDS)
        if val:
            out[key] = val
    return out or None


def _pubmed_search_drug_company(product: str, company: str) -> tuple[list[str], str]:
    """Optional boost: drug in title/abstract AND company in affiliation (rank ★ first)."""
    drug = _clean(product)
    aff = _clean(company)
    if aff and re.fullmatch(r"[A-Z]{1,5}", aff):
        aff = None
    if not drug:
        return [], ""
    token = _company_affiliation_token(aff)
    if not token:
        return [], ""
    term = f"{drug}[Title/Abstract] AND {token}[Affiliation]"
    time.sleep(PUBMED_SLEEP_SEC)
    try:
        r = requests.get(
            _PUBMED_SEARCH,
            params={
                "db": "pubmed",
                "term": term,
                "retmax": str(_MAX_PUBMED),
                "retmode": "json",
                "sort": "pub+date",
                "email": _PUBMED_EMAIL,
            },
            headers=_HEADERS,
            timeout=18,
        )
        if r.status_code != 200:
            return [], term
        ids = r.json().get("esearchresult", {}).get("idlist", [])
        return [str(i) for i in ids[:_MAX_PUBMED]], term
    except Exception:
        return [], term


def _pubmed_search_drug_title_or_abstract(
    product: str, *, retmax: int | None = None
) -> tuple[list[str], str]:
    """Primary PubMed search: drug name in title or abstract (affiliation not required)."""
    drug = _clean(product)
    if not drug:
        return [], ""
    term = f"{drug}[Title/Abstract]"
    limit = retmax or _MAX_PUBMED
    time.sleep(PUBMED_SLEEP_SEC)
    try:
        r = requests.get(
            _PUBMED_SEARCH,
            params={
                "db": "pubmed",
                "term": term,
                "retmax": str(limit),
                "retmode": "json",
                "sort": "pub+date",
                "email": _PUBMED_EMAIL,
            },
            headers=_HEADERS,
            timeout=18,
        )
        if r.status_code != 200:
            return [], term
        ids = r.json().get("esearchresult", {}).get("idlist", [])
        return [str(i) for i in ids[:limit]], term
    except Exception:
        return [], term


# Back-compat alias for older imports/tests.
def _pubmed_search_drug_title(product: str, *, retmax: int | None = None) -> tuple[list[str], str]:
    return _pubmed_search_drug_title_or_abstract(product, retmax=retmax)


def _company_affiliation_token(company: str | None) -> str | None:
    aff = _clean(company)
    if not aff or re.fullmatch(r"[A-Z]{1,5}", aff):
        return None
    token = re.split(r"[,/]", aff, maxsplit=1)[0]
    token = re.sub(
        r"\s+(inc|llc|ltd|corp|corporation|plc|co)\.?$",
        "",
        token,
        flags=re.I,
    ).strip()
    return token if len(token) >= 4 else None


def _affiliation_matches_company(affs: list[str], company: str | None) -> bool:
    token = _company_affiliation_token(company)
    if not token:
        return False
    needle = token.lower()
    for raw in affs:
        blob = re.sub(r"\s+", " ", str(raw or "")).strip().lower()
        if needle in blob:
            return True
    return False


def _pubmed_fetch_xml(pmids: list[str]) -> str:
    if not pmids:
        return ""
    time.sleep(PUBMED_SLEEP_SEC)
    try:
        r = requests.get(
            _PUBMED_FETCH,
            params={
                "db": "pubmed",
                "id": ",".join(pmids),
                "retmode": "xml",
                "email": _PUBMED_EMAIL,
            },
            headers=_HEADERS,
            timeout=24,
        )
        if r.status_code == 200:
            return r.text or ""
    except Exception:
        pass
    return ""


def _text_el(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", "".join(node.itertext())).strip()


def _article_id_map(node: ET.Element | None) -> dict[str, str]:
    out: dict[str, str] = {}
    if node is None:
        return out
    for aid in node.findall(".//ArticleId"):
        kind = (aid.get("IdType") or "").strip().lower()
        val = _text_el(aid)
        if kind and val:
            out[kind] = val
    return out


def _doi_url(doi: str | None) -> str | None:
    d = (doi or "").strip().lstrip("doi:").strip()
    if not d:
        return None
    if d.lower().startswith("http"):
        return d
    return f"https://doi.org/{d}"


def _pubmed_url(pmid: str | None) -> str | None:
    p = (pmid or "").strip()
    return f"https://pubmed.ncbi.nlm.nih.gov/{p}/" if p else None


def _pmc_url(pmc: str | None) -> str | None:
    p = (pmc or "").strip()
    if not p:
        return None
    if not p.upper().startswith("PMC"):
        p = f"PMC{p}"
    return f"https://www.ncbi.nlm.nih.gov/pmc/articles/{p}/"


def _parse_reference_nodes(root: ET.Element) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ref in root.findall(".//ReferenceList/Reference"):
        citation = _text_el(ref.find("Citation"))
        id_node = ref.find("ArticleIdList")
        ids = _article_id_map(id_node if id_node is not None else ref)
        r_pmid = ids.get("pubmed") or ids.get("pmid")
        r_doi = ids.get("doi")
        url = _pubmed_url(r_pmid) or _doi_url(r_doi)
        key = r_pmid or r_doi or (citation[:80] if citation else "")
        if not key or key in seen:
            continue
        if not citation and not url:
            continue
        seen.add(key)
        refs.append(
            {
                "citation": _cap_words(citation, 36) or (f"PMID {r_pmid}" if r_pmid else r_doi),
                "pmid": r_pmid,
                "doi": r_doi,
                "url": url,
            }
        )
        if len(refs) >= _MAX_PAPER_REFS:
            break
    return refs


def _parse_pubmed_articles(xml_text: str) -> list[dict[str, Any]]:
    if not xml_text.strip():
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    articles: list[dict[str, Any]] = []
    for art in root.iter("PubmedArticle"):
        medline = art.find("MedlineCitation")
        if medline is None:
            continue
        pmid_el = medline.find("PMID")
        pmid = _text_el(pmid_el)
        article = medline.find("Article")
        if article is None:
            continue
        title = _text_el(article.find("ArticleTitle"))
        journal = _text_el(article.find("Journal/Title"))
        year = _text_el(article.find("Journal/JournalIssue/PubDate/Year"))
        abstract_bits: dict[str, str] = {}
        abstract = article.find("Abstract")
        if abstract is not None:
            for block in abstract.findall("AbstractText"):
                label = (
                    (block.get("NlmCategory") or block.get("Label") or "UNASSIGNED")
                    .strip()
                    .upper()
                )
                txt = _text_el(block)
                if not txt:
                    continue
                abstract_bits[label] = txt
        affs: list[str] = []
        for aff in article.iter("Affiliation"):
            t = _text_el(aff)
            if t:
                affs.append(t)
        full_abs = " ".join(abstract_bits.values()) or _text_el(abstract)
        intro = (
            abstract_bits.get("BACKGROUND")
            or abstract_bits.get("INTRODUCTION")
            or abstract_bits.get("OBJECTIVE")
        )
        results = abstract_bits.get("RESULTS")
        disc = (
            abstract_bits.get("DISCUSSION")
            or abstract_bits.get("CONCLUSIONS")
            or abstract_bits.get("CONCLUSION")
        )
        ids = _article_id_map(art.find("PubmedData/ArticleIdList"))
        for eloc in article.findall("ELocationID"):
            kind = (eloc.get("EIdType") or "").strip().lower()
            val = _text_el(eloc)
            if kind and val:
                ids.setdefault(kind, val)
        doi = ids.get("doi")
        pmc = ids.get("pmc")
        structured = bool(intro or results or disc)
        articles.append(
            {
                "pmid": pmid,
                "title": title or None,
                "journal": journal or None,
                "year": year or None,
                "url": _pubmed_url(pmid),
                "doi": doi,
                "doi_url": _doi_url(doi),
                "pmc": pmc,
                "pmc_url": _pmc_url(pmc),
                "affiliations": affs[:8],
                "abstract": full_abs or None,
                "introduction": _cap_words(intro, _INTRO_WORDS),
                "results": _cap_words(results, _RESULTS_WORDS),
                "discussion": _cap_words(disc, _CONCLUSION_WORDS),
                # Legacy alias kept for older UI caches.
                "conclusion": _cap_words(disc, _CONCLUSION_WORDS),
                "structured_abstract": structured,
                "full_text_available": bool(pmc),
                "references": [],
            }
        )
    return articles


def _elink_cited_pmids(pmids: list[str]) -> dict[str, list[str]]:
    """PMID → cited PMIDs (pubmed_pubmed_refs)."""
    ids = [p for p in pmids if p]
    if not ids:
        return {}
    time.sleep(PUBMED_SLEEP_SEC)
    try:
        r = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi",
            params={
                "dbfrom": "pubmed",
                "db": "pubmed",
                "cmd": "neighbor",
                "linkname": "pubmed_pubmed_refs",
                "retmode": "json",
                "id": ",".join(ids),
                "email": _PUBMED_EMAIL,
            },
            headers=_HEADERS,
            timeout=18,
        )
        if r.status_code != 200:
            return {}
        payload = r.json()
    except Exception:
        return {}
    out: dict[str, list[str]] = {}
    for ls in payload.get("linksets") or []:
        src = ""
        raw_ids = ls.get("ids") or ls.get("id") or []
        if isinstance(raw_ids, list) and raw_ids:
            src = str(raw_ids[0])
            cited: list[str] = []
            for db in ls.get("linksetdbs") or []:
                if str(db.get("linkname") or "") != "pubmed_pubmed_refs":
                    continue
                for lid in db.get("links") or []:
                    if isinstance(lid, dict):
                        s = str(lid.get("id") or lid.get("Id") or "").strip()
                    else:
                        s = str(lid).strip()
                    if s and s not in cited:
                        cited.append(s)
                    if len(cited) >= _MAX_PAPER_REFS:
                        break
        if src and cited:
            out[src] = cited
    return out


def _esummary_titles(pmids: list[str]) -> dict[str, str]:
    ids = [p for p in pmids if p][:40]
    if not ids:
        return {}
    time.sleep(PUBMED_SLEEP_SEC)
    try:
        r = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
            params={
                "db": "pubmed",
                "id": ",".join(ids),
                "retmode": "json",
                "email": _PUBMED_EMAIL,
            },
            headers=_HEADERS,
            timeout=18,
        )
        if r.status_code != 200:
            return {}
        result = (r.json() or {}).get("result") or {}
    except Exception:
        return {}
    out: dict[str, str] = {}
    for pid in ids:
        row = result.get(pid) or {}
        title = str(row.get("title") or "").strip()
        if title:
            out[pid] = title.rstrip(".")
    return out


def _attach_cited_references(papers: list[dict[str, Any]]) -> None:
    need = [p for p in papers if p.get("pmid") and not p.get("references")]
    if not need:
        return
    cited_map = _elink_cited_pmids([str(p.get("pmid")) for p in need])
    all_ids: list[str] = []
    for ids in cited_map.values():
        for i in ids:
            if i not in all_ids:
                all_ids.append(i)
    titles = _esummary_titles(all_ids)
    for paper in need:
        pmid = str(paper.get("pmid") or "")
        cited = cited_map.get(pmid) or []
        refs: list[dict[str, Any]] = []
        for cid in cited:
            refs.append(
                {
                    "citation": _cap_words(titles.get(cid), 36) or f"PMID {cid}",
                    "pmid": cid,
                    "doi": None,
                    "url": _pubmed_url(cid),
                }
            )
        if refs:
            paper["references"] = refs


def _summarize_paper_ai(article: dict[str, Any], *, product: str) -> dict[str, Any]:
    """Fill Introduction / Results / Discussion (investor-quality summaries).

    Prefer AI polish from the full abstract when available. Structured PubMed
    labels are used as fallback seeds. Bibliography is not attached.
    """
    abstract = _clean(article.get("abstract"))
    article["abstract"] = abstract
    article["references"] = []
    # Prefer discussion; keep conclusion as alias for older clients.
    if not article.get("discussion") and article.get("conclusion"):
        article["discussion"] = article.get("conclusion")
    if not article.get("conclusion") and article.get("discussion"):
        article["conclusion"] = article.get("discussion")

    has_structured = bool(article.get("structured_abstract"))

    if not abstract:
        for key in ("introduction", "results", "discussion", "conclusion"):
            if not article.get(key):
                article[key] = _PDF_NOT_AVAILABLE
        return article

    if not ai_provider.is_available():
        # Keep structured bits; otherwise placeholders.
        for key in ("introduction", "results", "discussion"):
            if not article.get(key):
                article[key] = _PDF_NOT_AVAILABLE if not has_structured else article.get(key)
        article["conclusion"] = (
            article.get("conclusion") or article.get("discussion") or _PDF_NOT_AVAILABLE
        )
        article["discussion"] = article.get("discussion") or article.get("conclusion")
        return article

    prompt = (
        f"Drug / product: {product}\n"
        f"Title: {article.get('title') or ''}\n\n"
        f"Full abstract (use as sole evidence):\n{abstract[:6000]}\n\n"
        "Return JSON with keys introduction, results, discussion.\n"
        f"- introduction: ≤{_INTRO_WORDS} words — aim, disease context, design/"
        "population; complete sentences.\n"
        f"- results: ≤{_RESULTS_WORDS} words — studies/arms/models done, conditions, "
        "readouts/endpoints, outcomes, and statistics (n, %, HR, OR, p, CI) when present.\n"
        f"- discussion: ≤{_CONCLUSION_WORDS} words — implications / takeaways "
        "(from discussion or conclusions).\n"
        "Do not copy the same sentence into more than one key. "
        "If a section cannot be supported by the abstract, use null."
    )
    raw = ai_provider.call_ai(prompt, system=_SYSTEM_PAPER, max_tokens=900, task="clinical_kpi")
    if not raw:
        for key in ("introduction", "results", "discussion", "conclusion"):
            if not article.get(key):
                article[key] = _PDF_NOT_AVAILABLE
        return article
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        parsed = json.loads(text)
    except Exception:
        for key in ("introduction", "results", "discussion", "conclusion"):
            if not article.get(key):
                article[key] = _PDF_NOT_AVAILABLE
        return article
    if not isinstance(parsed, dict):
        return article
    disc = parsed.get("discussion") or parsed.get("conclusion")
    article["introduction"] = _cap_words(
        parsed.get("introduction"), _INTRO_WORDS
    ) or article.get("introduction")
    article["results"] = _cap_words(parsed.get("results"), _RESULTS_WORDS) or article.get(
        "results"
    )
    article["discussion"] = _cap_words(disc, _CONCLUSION_WORDS) or article.get("discussion")
    article["conclusion"] = _cap_words(disc, _CONCLUSION_WORDS) or article.get("conclusion")
    for key in ("introduction", "results", "discussion", "conclusion"):
        if not article.get(key):
            article[key] = _PDF_NOT_AVAILABLE

    # Investor Insight at the end of Intro / Results / Discussion.
    if not article.get("investor_insight") and abstract and ai_provider.is_available():
        try:
            from daily_news_desk import _ai_investor_insight

            bits = [
                str(article.get("title") or ""),
                str(article.get("introduction") or ""),
                str(article.get("results") or ""),
                str(article.get("discussion") or ""),
                abstract[:3000],
            ]
            insight = _ai_investor_insight(
                title=str(article.get("title") or product),
                body="\n".join(b for b in bits if b and b.strip()),
                ticker="",
                news_kind="paper",
                detail_summary=str(article.get("results") or "")[:600],
            )
            if insight:
                article["investor_insight"] = insight
        except Exception:
            pass
    return article


def _stamp_paper_affiliation(paper: dict[str, Any], company: str | None) -> dict[str, Any]:
    paper["company_affiliated"] = _affiliation_matches_company(
        list(paper.get("affiliations") or []), company
    )
    return paper


def _score_product_study_paper(paper: dict[str, Any]) -> dict[str, Any]:
    """Taxonomy clinical score for PubMed product papers (+ affiliation boost)."""
    try:
        from eis_taxonomy_scoring import score_scientific_paper
    except Exception:
        return paper
    bits = [
        str(paper.get("title") or ""),
        str(paper.get("abstract") or ""),
        str(paper.get("introduction") or ""),
        str(paper.get("results") or ""),
        str(paper.get("discussion") or paper.get("conclusion") or ""),
    ]
    blob = "\n".join(b.strip() for b in bits if b and b.strip())
    if len(blob) < 40:
        return paper
    try:
        scored = score_scientific_paper(
            blob,
            company_affiliated=bool(paper.get("company_affiliated")),
            use_ai=False,
        )
    except Exception:
        return paper
    out = dict(paper)
    for k in (
        "clinical_score",
        "financial_score",
        "corporate_score",
        "market_access_score",
        "taxonomy_dimensions",
        "taxonomy_audit",
        "taxonomy_method",
        "taxonomy_version",
        "heuristic_rev",
    ):
        if scored.get(k) is not None:
            out[k] = scored.get(k)
    out["is_paper"] = True
    out["company_affiliated"] = bool(paper.get("company_affiliated"))
    return out


def _collect_pubmed_papers(product: str, company: str | None) -> tuple[list[dict[str, Any]], str]:
    """Drug in title/abstract; company affiliation optional (★ / rank only, not a hard filter)."""
    aff_ids, aff_q = _pubmed_search_drug_company(product, company or "")
    tiab_ids, tiab_q = _pubmed_search_drug_title_or_abstract(
        product, retmax=_MAX_PUBMED * 2
    )
    ordered: list[str] = []
    seen: set[str] = set()
    # Affiliated hits first when available, then any title/abstract hit.
    for pid in aff_ids + tiab_ids:
        if not pid or pid in seen:
            continue
        seen.add(pid)
        ordered.append(pid)
        if len(ordered) >= _MAX_PUBMED:
            break
    query = tiab_q or aff_q
    if aff_q and tiab_q and aff_q != tiab_q:
        query = f"{aff_q} | {tiab_q}"
    papers = _parse_pubmed_articles(_pubmed_fetch_xml(ordered))
    by_pmid = {str(p.get("pmid") or ""): p for p in papers if p.get("pmid")}
    ordered_papers = [by_pmid[p] for p in ordered if p in by_pmid]
    return ordered_papers, query


def lookup_product_study_dossier(
    *,
    ticker: str,
    product_name: str,
    company: str | None = None,
    nct_id: str | None = None,
    aliases: list[str] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    tk = (ticker or "").strip().upper()
    product = (product_name or "").strip()
    co = (company or "").strip() or None
    if not tk or not product:
        return {"ok": False, "error": "ticker and product_name required"}

    needles = _product_needles(product, aliases or [])
    key = _cache_key(tk, product, co or "")
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        hit = cache_doc.get("entries", {}).get(key)
        if hit and not force and _cache_fresh(hit) and isinstance(hit.get("dossier"), dict):
            return {
                "ok": True,
                "cached": True,
                "updated_at": hit.get("updated_at"),
                "dossier": hit["dossier"],
            }

    hits = _ctgov_search(product)
    if nct_id:
        nct_u = nct_id.strip().upper()
        if nct_u.startswith("NCT") and not any(
            str(((s.get("protocolSection") or {}).get("identificationModule") or {}).get("nctId") or "")
            .strip()
            .upper()
            == nct_u
            for s in hits
        ):
            extra = _ctgov_get(nct_u)
            if extra:
                hits = [extra, *hits]

    matched = [s for s in hits if _study_mentions_product(s, needles)]
    matched.sort(key=lambda s: 0 if s.get("hasResults") else 1)
    cards: list[dict[str, Any]] = []
    seen_nct: set[str] = set()
    scored: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for raw in matched:
        ident = (raw.get("protocolSection") or {}).get("identificationModule") or {}
        nct = str(ident.get("nctId") or "").strip().upper()
        if not nct or nct in seen_nct:
            continue
        seen_nct.add(nct)
        full = raw if raw.get("resultsSection") or raw.get("hasResults") is False else _ctgov_get(nct)
        if not full:
            full = raw
        extracted = _extract_results(full)
        scored.append((full, extracted))
        if len(scored) >= _MAX_STUDIES * 2:
            break

    def _recency(extracted: dict[str, Any]) -> str:
        return str(
            extracted.get("primary_completion_date")
            or extracted.get("completion_date")
            or ""
        )

    with_res = [t for t in scored if t[1].get("has_results")]
    without = [t for t in scored if not t[1].get("has_results")]
    with_res.sort(key=lambda t: _recency(t[1]), reverse=True)
    without.sort(key=lambda t: _recency(t[1]), reverse=True)
    ordered = with_res + without

    for full, extracted in ordered[:_MAX_STUDIES]:
        card = _build_study_card(full, extracted)
        try:
            card["readout_explainer"] = _readout_explainer_ai(card, product=product)
        except Exception:
            card["readout_explainer"] = None
        cards.append(card)

    pmids_query_papers = _collect_pubmed_papers(product, co)
    papers, pubmed_query = pmids_query_papers
    # No bibliography — abstract + section summaries + article links only.
    papers = [
        _score_product_study_paper(
            _stamp_paper_affiliation(_summarize_paper_ai(p, product=product), co)
        )
        for p in papers
    ]
    # Affiliated company authors first in the dossier list.
    papers.sort(key=lambda p: (0 if p.get("company_affiliated") else 1))

    dossier = {
        "product_name": product,
        "company": co,
        "ticker": tk,
        "needles": needles,
        "studies": cards,
        "papers": papers,
        "ctgov_hits": len(matched),
        "pubmed_query": pubmed_query,
    }
    now = datetime.now(timezone.utc).isoformat()
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        cache_doc.setdefault("entries", {})[key] = {
            "updated_at": now,
            "dossier_version": _DOSSIER_VERSION,
            "dossier": dossier,
        }
        _save_cache(cache_doc)
    return {"ok": True, "cached": False, "updated_at": now, "dossier": dossier}
