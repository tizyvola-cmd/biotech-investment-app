"""
PubMed tramite NCBI Entrez eutils — ricerca pubblicazioni cliniche dopo completion.

Linee guida NCBI: passare sempre `tool` + `email` (env NCBI_EMAIL).
Cache disco persistente sotto data/cache/pubmed/.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

DATA_DIR = "data"
PUBMED_CACHE_DIR = os.path.join(DATA_DIR, "cache", "pubmed")
ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

_FETCH_PAUSE_S = 0.12
# Budget testo «esito»: priorizzare abstract (titolo solo come coda breve).
_SUMMARY_LINE_CAP = 2200
_ABSTRACT_HIT_CAP = 3400
_RESULTS_LABELS = frozenset({
    "results",
    "result",
    "findings",
    "main outcomes",
    "outcomes",
    "primary outcome",
    "efficacy",
})
_CONCLUSIONS_LABELS = frozenset({"conclusions", "conclusion", "interpretation"})

# Prefer abstracts with quantified trial outcomes (reduces background-only hits).
OUTCOME_TERMS = [
    '"overall response rate"',
    '"progression-free survival"',
    '"hazard ratio"',
    '"primary endpoint"',
    '"phase 3" OR "phase III"',
    '"randomized"',
]


def _outcome_filter_clause() -> str:
    """OR-group: at least one outcome term in Title/Abstract."""
    parts = [f"({t}[Title/Abstract])" for t in OUTCOME_TERMS]
    return "(" + " OR ".join(parts) + ")"


def _with_outcome_filter(term: str) -> str:
    """AND outcome filter onto a PubMed query (best-effort)."""
    t = (term or "").strip()
    if not t:
        return t
    filt = _outcome_filter_clause()
    return f"({t}) AND {filt}"[:1900]


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)).strip() or str(default))
    except Exception:
        return int(default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)).strip() or str(default))
    except Exception:
        return float(default)


def _phase_roman_suffix(tier: int | None) -> list[str]:
    if tier not in (1, 2, 3, 4):
        return []
    rm = {1: "i", 2: "ii", 3: "iii", 4: "iv"}
    t = rm[tier]
    return [
        f"phase {tier}",
        f"phase {t}",
        f"phase{t}",
        f"p{t}",
    ]


def _sanitize_term_piece(s: str, max_len: int = 80) -> str:
    x = str(s or "").strip()
    x = x.replace('"', " ").replace("[", " ").replace("]", " ")
    x = " ".join(x.split())
    return x[:max_len]


def _build_pubmed_query(
    drug_token: str,
    indication: str,
    company: str,
    phase_tier: int | None,
) -> str:
    """Query AND best-effort; segmenti vuoti sono omessi."""
    chunks: list[str] = []
    dtok = _sanitize_term_piece(drug_token, 64)
    if len(dtok) >= 3:
        chunks.append(f'("{dtok}"[Title/Abstract] OR {dtok}[nm])')

    ind = _sanitize_term_piece(indication, 140)
    if len(ind) >= 4:
        words = ind.replace(",", " ").split()
        if len(words) >= 2:
            phrase = " ".join(words[:4])
            chunks.append(f"({phrase}[Title/Abstract])")
        else:
            chunks.append(f"({ind}[Title/Abstract])")

    comp = _sanitize_term_piece(company, 120)
    if len(comp) >= 4:
        ch = comp.split()[0][:40]
        if len(ch) >= 4:
            chunks.append(f'({ch}[Affiliation] OR "{ch}"[Title/Abstract])')

    if phase_tier:
        pv = []
        for ptx in _phase_roman_suffix(phase_tier):
            pv.append(f'"{ptx}"[Title/Abstract]')
        chunks.append("(" + " OR ".join(pv) + ")")

    chunks.append("(clinical trial[pt] OR randomized[tiab])")
    q = " AND ".join(chunks) if chunks else ""
    q = q[:1900]
    return q.strip()


def _date_window_cd_plus_months(cd, months: int):
    """(mindate, maxdate) formato YYYY/MM/DD — ~18 mesi = months×30.5 giorni."""
    from datetime import timedelta as _td
    hi = cd + _td(days=int(round(float(months) * 30.5)))
    if hi < cd:
        hi = cd
    return cd.strftime("%Y/%m/%d"), hi.strftime("%Y/%m/%d")


def _http_get_xml(url: str) -> ET.Element | None:
    if _env_truthy("PUBMED_DISABLE_NETWORK"):
        return None
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "BiotechOrchestrator/1.0 (PMC educational)"},
        method="GET",
    )
    timeout_s = max(3.0, _env_float("PUBMED_HTTP_TIMEOUT_S", 8.0))
    retries = max(0, min(4, _env_int("PUBMED_HTTP_RETRIES", 0)))
    for i in range(retries + 1):
        try:
            raw = urllib.request.urlopen(req, timeout=timeout_s).read()
            return ET.fromstring(raw)
        except KeyboardInterrupt:
            raise
        except (urllib.error.URLError, ET.ParseError, OSError, socket.timeout):
            if i >= retries:
                return None
            # Backoff breve per non bloccare lungamente la run.
            time.sleep(min(1.5, 0.25 * (i + 1)))
    return None


def _esearch_pubmed(term: str, mindate: str, maxdate: str, retmax: int = 12) -> list[str]:
    if not term:
        return []
    email = os.environ.get("NCBI_EMAIL", "biotech-orchestrator@local").strip()
    tool = os.environ.get("NCBI_TOOL", "BiotechOrchestrator").strip()
    q = urllib.parse.urlencode(
        {
            "db": "pubmed",
            "term": term,
            "retmax": str(retmax),
            "sort": "relevance",
            "mindate": mindate,
            "maxdate": maxdate,
            "datetype": "pdat",
            "retmode": "xml",
            "tool": tool,
            "email": email,
        }
    )
    root = _http_get_xml(f"{ESEARCH_URL}?{q}")
    if root is None:
        return []
    ids: list[str] = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "Id" and el.text and el.text.isdigit():
            ids.append(el.text.strip())
        elif tag.startswith("ERROR"):
            break
    return ids[:retmax]


def _sections_from_abstract_parts(abst_parts: list[tuple[str, str]]) -> dict[str, str]:
    """Group PubMed structured abstract fragments by section label."""
    sections: dict[str, str] = {}
    unlabeled: list[str] = []
    for lab, bit in abst_parts:
        t = (bit or "").strip()
        if not t:
            continue
        if lab:
            key = lab.strip().lower()
            prev = sections.get(key, "")
            sections[key] = (prev + " " + t).strip() if prev else t
        else:
            unlabeled.append(t)
    if unlabeled and "background" not in sections:
        sections["background"] = " ".join(unlabeled).strip()
    return sections


def _pick_results_text(sections: dict[str, str], full_abstract: str) -> str:
    for key, text in sections.items():
        if any(lbl in key for lbl in _RESULTS_LABELS) and text.strip():
            return text.strip()
    # Heuristic: Results paragraph inside unstructured abstract
    m = re.search(
        r"(?is)\bresults?\s*[:\-]\s*(.+?)(?=\bconclusions?\s*[:\-]|\bconclusion\s*[:\-]|\Z)",
        full_abstract or "",
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()[:2400]
    return ""


def _europepmc_abstract_supplement(pmid: str) -> str:
    """Optional longer abstract / mined text from Europe PMC (open-access)."""
    if _env_truthy("EUROPEPMC_DISABLE") or _env_truthy("PUBMED_DISABLE_NETWORK"):
        return ""
    pid = str(pmid or "").strip()
    if not pid.isdigit():
        return ""
    q = urllib.parse.urlencode(
        {
            "query": f"EXT_ID:{pid}",
            "format": "json",
            "resultType": "core",
            "pageSize": "1",
        }
    )
    url = f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?{q}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "BiotechOrchestrator/1.0 (EuropePMC)"},
            method="GET",
        )
        timeout_s = max(3.0, _env_float("EUROPEPMC_HTTP_TIMEOUT_S", 6.0))
        raw = urllib.request.urlopen(req, timeout=timeout_s).read()
        data = json.loads(raw.decode("utf-8", errors="replace"))
        results = (data.get("resultList") or {}).get("result") or []
        if not results:
            return ""
        row = results[0] if isinstance(results[0], dict) else {}
        text = str(row.get("abstractText") or "").strip()
        return re.sub(r"\s+", " ", text)[:3400]
    except Exception:
        return ""


def enrich_pubmed_hit(hit: dict) -> dict:
    """Add results_section + abstract_for_ai (Results-first for KPI extraction)."""
    out = dict(hit)
    sections = out.get("abstract_sections") if isinstance(out.get("abstract_sections"), dict) else {}
    full = str(out.get("abstract") or "")
    results = str(out.get("results_section") or "") or _pick_results_text(sections, full)
    if not results and out.get("pmid"):
        epmc = _europepmc_abstract_supplement(str(out["pmid"]))
        if epmc and len(epmc) > len(full) + 80:
            out["abstract"] = epmc[:_ABSTRACT_HIT_CAP]
            full = out["abstract"]
            results = _pick_results_text({}, full) or ""
            if results:
                out["results_section"] = results[:2400]
        elif epmc and not full:
            out["abstract"] = epmc[:_ABSTRACT_HIT_CAP]
            full = out["abstract"]
    if results:
        out["results_section"] = results[:2400]
    concl = ""
    for key, text in sections.items():
        if any(lbl in key for lbl in _CONCLUSIONS_LABELS):
            concl = text.strip()
            break
    parts = []
    if results:
        parts.append(f"RESULTS: {results[:2000]}")
    if concl:
        parts.append(f"CONCLUSIONS: {concl[:900]}")
    if full:
        parts.append(full[:2200])
    out["abstract_for_ai"] = "\n\n".join(parts)[:_ABSTRACT_HIT_CAP]
    return out


def _efetch_pubmed_articles(pmids: list[str]) -> list[dict]:
    if not pmids:
        return []
    email = os.environ.get("NCBI_EMAIL", "biotech-orchestrator@local").strip()
    tool = os.environ.get("NCBI_TOOL", "BiotechOrchestrator").strip()
    pid = ",".join(pmids[:8])
    q = urllib.parse.urlencode(
        {
            "db": "pubmed",
            "id": pid,
            "retmode": "xml",
            "rettype": "abstract",
            "tool": tool,
            "email": email,
        }
    )
    root = _http_get_xml(f"{EFETCH_URL}?{q}")
    if root is None:
        return []
    out: list[dict] = []
    pubs = []
    tag_tail = lambda t: (t.split("}")[-1] if isinstance(t, str) else "")  # noqa: E731
    for pg in root.iter():
        tt = tag_tail(pg.tag)
        if tt == "PubmedArticle":
            pubs.append(pg)
    if not pubs:
        for pg in root.iter():
            if tag_tail(pg.tag) == "MedlineCitation":
                pubs.append(pg)

    for art in pubs:
        pmid = ""
        title = ""
        abst_parts: list[tuple[str, str]] = []
        ymd = ""

        for el in art.iter():
            tl = tag_tail(el.tag)
            if tl == "PMID":
                pid_t = "".join(el.itertext()).strip()
                if pid_t.isdigit() and len(pid_t) < 13:
                    pmid = pid_t
            elif tl == "ArticleTitle":
                title = "".join(el.itertext()).strip()
            elif tl == "AbstractText":
                lab = (el.attrib.get("Label") or "").strip()
                bit = "".join(el.itertext()).strip()
                abst_parts.append((lab, bit))
            elif tl == "Year" and el.text and len(el.text.strip()) == 4:
                ymd = el.text.strip()
            elif tl == "MedlineDate" and el.text and len(ymd) < 4:
                ym = el.text.strip()[:7]
                ymd = ym[:4] if len(ym) >= 4 else ymd

        labeled_lines = [
            f"{lab}: {bit}" if lab else bit for lab, bit in abst_parts if bit.strip()
        ]
        sections = _sections_from_abstract_parts(abst_parts)
        abs_full = " ".join(labeled_lines).strip()
        abst_norm = abs_full.replace("\n", " ")
        abst_norm = re.sub(r"\s+", " ", abst_norm).strip()
        results_section = _pick_results_text(sections, abst_norm)
        abst_stored = (
            (abst_norm[:_ABSTRACT_HIT_CAP - 1] + "…")
            if len(abst_norm) > _ABSTRACT_HIT_CAP
            else abst_norm
        )

        if pmid or title:
            row = {
                "pmid": pmid,
                "title": title[:400],
                "abstract": abst_stored,
                "abstract_sections": sections,
                "results_section": results_section[:2400] if results_section else "",
                "pub_year": ymd[:4] if len(ymd) >= 4 else "",
            }
            out.append(enrich_pubmed_hit(row))

    # dedupe by pmid
    seen = set()
    ded: list[dict] = []
    for h in out:
        pid = h.get("pmid")
        key = pid or h.get("title", "")
        if key and key not in seen:
            seen.add(key)
            ded.append(h)
    return ded


def _make_summary_line(hits: list[dict]) -> str:
    if not hits:
        return ""
    h = hits[0]
    pn = (h.get("pub_year") or "").strip()
    pm = str(h.get("pmid") or "").strip()
    tt = str(h.get("title") or "").strip()
    ab = str(h.get("abstract_for_ai") or h.get("abstract") or "").strip()
    res = str(h.get("results_section") or "").strip()
    head = ""
    if pm:
        head = f"PMID {pm}"
    if pn:
        head = (head + f" ({pn})") if head else pn
    # Esito letto sull’abstract: testo principale = abstract; titolo solo accenno.
    body = ""
    if res and res not in ab:
        body = f"Results: {res[: min(900, len(res))]}"
    if ab:
        room = _SUMMARY_LINE_CAP - len(head) - len(body) - 24
        if tt:
            room -= min(len(tt), 180) + 12
        room = max(120, room)
        ab_bit = ab if len(ab) <= room else (ab[: room - 1] + "…")
        body = (body + " " + ab_bit).strip() if body else ab_bit
    elif tt:
        body = tt
    tail = ""
    if ab and tt and len(tt) <= 220:
        tail = f" — {tt}"
    elif ab and tt:
        tail = f" — {tt[:177]}…"
    elif not ab and tt:
        body = tt
    bit = ((head + ": ") if head else "") + body + tail
    if len(bit) > _SUMMARY_LINE_CAP:
        bit = bit[: _SUMMARY_LINE_CAP - 1] + "…"
    return bit.strip()


def cached_pubmed_hint_for_completion(
    completion_dt,
    *,
    phase_str: str = "",
    indication: str = "",
    sponsor_or_company: str = "",
    drug_token: str = "",
    window_months: int | None = None,
    allow_network: bool = True,
) -> dict:
    """
    Restituisce dict: hits[], summary_line (testo sintetico), query, dates.

    Fenestra pubblicazione: dal completion alla data completion + window_months
    (default 18 mesi, env PUBMED_MONTHS_AFTER_CD).
    """
    from datetime import date as date_cls

    if completion_dt is None:
        return {"hits": [], "summary_line": "", "query": "", "mindate": "", "maxdate": ""}

    try:
        wmo = int(window_months if window_months is not None
                  else os.environ.get("PUBMED_MONTHS_AFTER_CD", "18") or "18")
    except ValueError:
        wmo = 18

    cd = completion_dt
    if hasattr(completion_dt, "date") and callable(completion_dt.date):
        try:
            cd = completion_dt.date()
        except Exception:
            pass
    if isinstance(cd, str):
        try:
            import pandas as _pd

            cd = _pd.Timestamp(cd).date()
        except Exception:
            return {"hits": [], "summary_line": "", "query": "", "mindate": "", "maxdate": ""}

    if not isinstance(cd, date_cls):
        return {"hits": [], "summary_line": "", "query": "", "mindate": "", "maxdate": ""}

    tier = None
    if phase_str:
        nums = sorted({int(x) for x in re.findall(r"\b([1-4])\b", str(phase_str).lower())})
        if nums:
            tier = nums[-1]

    q = _build_pubmed_query(
        drug_token.strip(),
        indication.strip(),
        sponsor_or_company.strip(),
        tier,
    )
    payload_key = "|".join(
        [
            str(cd),
            q,
            str(wmo),
        ]
    ).lower()
    keyhx = hashlib.sha256(payload_key.encode("utf-8", errors="ignore")).hexdigest()[:26]
    path = os.path.join(PUBMED_CACHE_DIR, f"{keyhx}.json")
    os.makedirs(PUBMED_CACHE_DIR, exist_ok=True)

    if not _env_truthy("FORCE_PUBMED_REFRESH") and os.path.isfile(path):
        try:
            return json.loads(
                pathlib.Path(path).read_text(encoding="utf-8", errors="replace"))
        except Exception:
            pass
    if (not allow_network) or _env_truthy("PUBMED_CACHE_ONLY"):
        return {"hits": [], "summary_line": "", "query": q[:800], "mindate": "", "maxdate": ""}

    mn, mx = _date_window_cd_plus_months(cd, wmo)

    pmids = _esearch_pubmed(q, mn, mx, retmax=12)
    time.sleep(_FETCH_PAUSE_S)

    hits: list[dict] = []
    if pmids:
        hits = _efetch_pubmed_articles(pmids)
        time.sleep(_FETCH_PAUSE_S)

    summ = _make_summary_line(hits)

    bundle = {
        "hits": hits[:5],
        "summary_line": summ,
        "query": q[:800],
        "mindate": mn,
        "maxdate": mx,
    }
    try:
        pathlib.Path(path).write_text(
            json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass

    return bundle


def search_pubmed_pre_cd_window(
    *,
    company: str = "",
    drug_tokens: list[str] | None = None,
    indication: str = "",
    window_start: str,
    window_end: str,
    phase_tier: int | None = None,
    retmax: int = 12,
    allow_network: bool = True,
) -> dict:
    """
  PubMed in [window_start, window_end] (YYYY-MM-DD) — finestra 6m pre-CD.
  Esegue query per company e per ogni drug token; deduplica per PMID.
    """
    mn = str(window_start or "").replace("-", "/")[:10]
    mx = str(window_end or "").replace("-", "/")[:10]
    if not mn or not mx:
        return {"hits": [], "queries": [], "mindate": mn, "maxdate": mx}

    if (not allow_network) or _env_truthy("PUBMED_CACHE_ONLY") or _env_truthy("PUBMED_DISABLE_NETWORK"):
        return {"hits": [], "queries": [], "mindate": mn, "maxdate": mx}

    queries: list[str] = []
    all_hits: list[dict] = []
    seen_pmids: set[str] = set()

    def _run_query(q: str) -> None:
        q = (q or "").strip()
        if not q:
            return
        q_filtered = _with_outcome_filter(q)
        queries.append(q_filtered[:800])
        pmids = _esearch_pubmed(q_filtered, mn, mx, retmax=retmax)
        time.sleep(_FETCH_PAUSE_S)
        if not pmids:
            return
        for h in _efetch_pubmed_articles(pmids):
            pid = str(h.get("pmid") or "")
            if pid and pid in seen_pmids:
                continue
            if pid:
                seen_pmids.add(pid)
            all_hits.append(h)
        time.sleep(_FETCH_PAUSE_S)

    comp = company.strip()
    drugs = [d.strip() for d in (drug_tokens or []) if d and len(d.strip()) >= 3][:5]
    ind = indication.strip()

    for drug in drugs:
        dtok = _sanitize_term_piece(drug, 64)
        if len(dtok) >= 3:
            qd = f'("{dtok}"[Title/Abstract] OR {dtok}[Title/Abstract])'
            if ind and len(ind) >= 4:
                ind_s = _sanitize_term_piece(ind, 80)
                qd += f" AND ({ind_s}[Title/Abstract])"
            _run_query(qd)

    if comp and len(comp) >= 4:
        short = _sanitize_term_piece(comp.split(",")[0], 80)
        first_word = short.split()[0].lower() if short.split() else ""
        ambiguous_co = len(first_word) <= 5
        if not (ambiguous_co and not drugs):
            _run_query(f'("{short}"[Affiliation] OR "{short}"[Title/Abstract])')

    if not drugs and comp:
        _run_query(_build_pubmed_query("", ind, comp, phase_tier))

    return {
        "hits": all_hits[:20],
        "queries": queries,
        "mindate": mn,
        "maxdate": mx,
    }
