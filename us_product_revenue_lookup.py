"""
US product commercial table for Deep Dive → Financial tab.
Brand rows with indication, therapeutic area, MoA/protein target, modality,
USA prevalence, US FDA approval year, patent cliff, line of therapy, and US
earnings for latest quarter / half / year. Display-only.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import ai_provider
from orchestrator_io_paths import DATA_DIR

logger = logging.getLogger(__name__)
from product_briefing_lookup import _clean_field, _ddg_patent_snippets, _parse_ai_json

_CACHE_PATH = Path(DATA_DIR) / "us_product_revenue_ai_cache.json"
_CACHE_LOCK = threading.Lock()
_BUILD_GUARD = threading.Lock()
_BUILD_LOCKS: dict[str, threading.Lock] = {}
# v7: us_approval_year (FDA / US first approval year).
_SCHEMA = 7
_MAX_PRODUCTS = 28
# Soft floor: prefer keeping brands whose US annual (or LTM) is disclosed ≤ this ($M).
_MID_TIER_FY_USD_M = 350.0
_MAX_TOKENS = 4000
_DDG_SNIPPET_CAP = 12

_SYSTEM = (
    "You are a biotech equity analyst for US commercial brands. "
    "Use public IR / 10-Q / earnings / FDA label / LOE sources plus the snippets. "
    "US market only for revenue figures — never Total / WW / ex-US as the primary number. "
    "If a US figure is unknown, use null. Return strict JSON only — no markdown. "
    "Cover the full disclosed US brand ladder — not only the top 5–6 mega brands. "
    "Map each indication to one broad therapeutic_area bucket. "
    "For partnered / co-commercialized brands, use the partner's disclosed US brand sales "
    "when the ticker itself does not break out US brand $ (e.g. Pfizer US Comirnaty for BioNTech). "
    "Never return a brand row with all revenue fields null — omit it instead. "
    "us_approval_year is the calendar year of first FDA / US approval for that brand "
    "(integer year, e.g. 2018) — not LOE / patent expiry."
)

# Extra web queries when the issuer is a known alliance partner for US brand sales.
_PARTNER_US_SALES_QUERIES: dict[str, tuple[str, ...]] = {
    "BNTX": (
        "Pfizer Comirnaty US sales revenue latest quarter year",
        "Pfizer BioNTech COVID vaccine US revenue Comirnaty",
        "BioNTech COVID-19 vaccine revenues collaboration US",
    ),
    "MRNA": (
        "Moderna Spikevax US sales revenue latest quarter year",
        "Moderna COVID vaccine US product sales",
    ),
}

# Canonical TA labels (English UI). First match wins when inferring from text.
_TA_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "Oncology",
        (
            "cancer",
            "carcinoma",
            "tumor",
            "tumour",
            "nsclc",
            "sclc",
            "leukemia",
            "leukaemia",
            "lymphoma",
            "myeloma",
            "melanoma",
            "oncolog",
            "her2",
            "egfr",
            "brca",
            "parp",
            "adc",
            "solid tumor",
            "breast",
            "lung cancer",
            "ovarian",
            "prostate cancer",
            "cll",
            "aml",
            "all ",
        ),
    ),
    (
        "Cardiovascular",
        (
            "heart failure",
            "cardiovascular",
            "myocardial",
            "acs",
            "stroke",
            "atheroscler",
            "hypertension",
            "coronary",
            "thromb",
            "antiplatelet",
            "arrhythm",
            "hyperkalemia",
            "hyperkalaemia",
        ),
    ),
    (
        "Metabolic / endocrinology",
        (
            "diabetes",
            "t2d",
            "type 2",
            "obesity",
            "glp-1",
            "sglt2",
            "metabolic",
            "thyroid",
            "endocrin",
            "ckd",
            "chronic kidney",
            "nephropath",
            "hypercholester",
            "dyslipid",
        ),
    ),
    (
        "Respiratory",
        (
            "asthma",
            "copd",
            "respiratory",
            "bronch",
            "eosinophil",
            "nasal polyp",
            "lung disease",
            "rsv",
            "influenza",
            "flu ",
        ),
    ),
    (
        "Immunology / rheumatology",
        (
            "lupus",
            "sle",
            "rheumat",
            "psoriasis",
            "psoriatic",
            "ibd",
            "crohn",
            "ulcerative colitis",
            "atopic",
            "eczema",
            "autoimmune",
            "immunolog",
            "il-5",
            "il-4",
            "tslp",
            "anaphylaxis",
            "allergy",
        ),
    ),
    (
        "Hematology",
        (
            "hemophilia",
            "haemophilia",
            "anemia",
            "anaemia",
            "hematolog",
            "haematolog",
            "sickle",
            "platelet",
            "thrombocytopen",
            "pnh",
            "ahus",
            "complement",
            "mg ",
            "myasthenia",
            "gmg",
            "nmosd",
        ),
    ),
    (
        "Infectious disease / vaccines",
        (
            "vaccine",
            "infectious",
            "infection",
            "antiviral",
            "antibacter",
            "hiv",
            "hepatitis",
            "covid",
            "rsv",
            "influenza",
            "meningit",
            "pneumococ",
        ),
    ),
    (
        "Neurology / CNS",
        (
            "alzheimer",
            "parkinson",
            "multiple sclerosis",
            "ms ",
            "epilepsy",
            "migraine",
            "neurolog",
            "cns",
            "depression",
            "schizophren",
            "als",
            "sma",
        ),
    ),
    (
        "Rare disease",
        (
            "orphan",
            "rare disease",
            "amyloid",
            "fabry",
            "gaucher",
            "pompe",
            "cystic fibrosis",
            "duchenne",
            "angelman",
        ),
    ),
    (
        "Gastroenterology",
        ("gastro", "ibs", "gerd", "nash", "masld", "hepatic", "cirrhosis", "pancreat"),
    ),
    (
        "Ophthalmology",
        ("ophthalm", "retina", "macular", "glaucoma", "uveitis", "dry eye"),
    ),
    (
        "Dermatology",
        ("dermatolog", "skin", "acne", "hidradenitis"),
    ),
    (
        "Women's health",
        ("endometri", "uterine", "ovarian endometriosis", "contracept", "menopaus"),
    ),
)

_TA_ALIASES: dict[str, str] = {
    "onco": "Oncology",
    "oncology": "Oncology",
    "cancer": "Oncology",
    "cardio": "Cardiovascular",
    "cardiovascular": "Cardiovascular",
    "cv": "Cardiovascular",
    "heart": "Cardiovascular",
    "metabolic": "Metabolic / endocrinology",
    "endocrinology": "Metabolic / endocrinology",
    "diabetes": "Metabolic / endocrinology",
    "renal": "Metabolic / endocrinology",
    "nephrology": "Metabolic / endocrinology",
    "respiratory": "Respiratory",
    "pulm": "Respiratory",
    "pulmonary": "Respiratory",
    "immunology": "Immunology / rheumatology",
    "rheumatology": "Immunology / rheumatology",
    "inflammation": "Immunology / rheumatology",
    "heme": "Hematology",
    "hematology": "Hematology",
    "haematology": "Hematology",
    "id": "Infectious disease / vaccines",
    "infectious": "Infectious disease / vaccines",
    "vaccine": "Infectious disease / vaccines",
    "vaccines": "Infectious disease / vaccines",
    "neuro": "Neurology / CNS",
    "neurology": "Neurology / CNS",
    "cns": "Neurology / CNS",
    "rare": "Rare disease",
    "orphan": "Rare disease",
    "gi": "Gastroenterology",
    "gastroenterology": "Gastroenterology",
    "ophthalmology": "Ophthalmology",
    "eye": "Ophthalmology",
    "dermatology": "Dermatology",
    "women": "Women's health",
    "women's health": "Women's health",
}


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
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _cache_key(ticker: str) -> str:
    return f"{(ticker or '').strip().upper()}|s{_SCHEMA}"


_REV_INFLIGHT: set[str] = set()
_REV_FAIL: dict[str, tuple[float, dict[str, Any]]] = {}
_REV_FAIL_S = 90.0


def _recent_revenue_fail(ticker: str) -> dict[str, Any] | None:
    rec = _REV_FAIL.get(ticker)
    if not rec or time.time() - rec[0] >= _REV_FAIL_S:
        return None
    return rec[1]


def _remember_revenue_fail(ticker: str, payload: dict[str, Any]) -> dict[str, Any]:
    _REV_FAIL[ticker] = (time.time(), payload)
    return payload


def _revenue_build_lock(ticker: str) -> threading.Lock:
    tk = (ticker or "").strip().upper()
    with _BUILD_GUARD:
        lock = _BUILD_LOCKS.get(tk)
        if lock is None:
            lock = threading.Lock()
            _BUILD_LOCKS[tk] = lock
        return lock


def _find_cache_entry(cache_doc: dict[str, Any], ticker: str) -> dict[str, Any] | None:
    """Prefer current schema; fall back to any prior ticker entry with products."""
    entries = cache_doc.get("entries") if isinstance(cache_doc.get("entries"), dict) else {}
    tk = (ticker or "").strip().upper()
    if not tk or not isinstance(entries, dict):
        return None
    primary = entries.get(_cache_key(tk))
    if (
        isinstance(primary, dict)
        and isinstance(primary.get("products"), list)
        and primary.get("products")
    ):
        return primary
    prefix = f"{tk}|"
    best: dict[str, Any] | None = None
    best_schema = -1
    for key, hit in entries.items():
        if not isinstance(hit, dict):
            continue
        if not (key == tk or str(key).startswith(prefix)):
            continue
        products = hit.get("products")
        if not isinstance(products, list) or not products:
            continue
        schema = int(hit.get("schema") or 0)
        if schema >= best_schema:
            best = hit
            best_schema = schema
    return best


def _collect_revenue_snippets(tk: str, company: str | None) -> list[str]:
    """Few parallel DDG queries — sequential 7×12s was the cold-start bottleneck."""
    co = (company or "").strip()
    label = co or tk
    queries = [
        f"{label} {tk} US product sales by brand latest quarter year",
        f"{label} {tk} 10-Q earnings US revenue brand breakdown",
        f"{label} {tk} US LOE patent cliff key brands",
    ]
    partner = _PARTNER_US_SALES_QUERIES.get(tk)
    if partner:
        queries.append(partner[0])

    snippets: list[str] = []
    seen: set[str] = set()

    def _one(q: str) -> list[str]:
        try:
            return _ddg_patent_snippets(q, limit=3)
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=min(4, len(queries))) as pool:
        futures = [pool.submit(_one, q) for q in queries]
        for fut in as_completed(futures):
            for sn in fut.result() or []:
                key = sn[:120].lower()
                if key in seen:
                    continue
                seen.add(key)
                snippets.append(sn)
                if len(snippets) >= _DDG_SNIPPET_CAP:
                    return snippets
    return snippets


def _parse_usd_m(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        n = float(raw)
        return n if n >= 0 and n == n else None
    s = str(raw).strip().lower().replace(",", "").replace("$", "")
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*(b|bn|billion)?", s)
    if not m:
        m2 = re.search(r"(-?\d+(?:\.\d+)?)\s*(m|mm|million)?", s)
        if not m2:
            return None
        n = float(m2.group(1))
        if m2.group(2):
            return n
        return n / 1e6 if n >= 50_000 else n
    n = float(m.group(1))
    if m.group(2):
        return n * 1000.0
    # trailing m in original string
    if re.search(r"\d\s*m\b", s):
        return n
    return n


def _fmt_usd_m(usd_m: float | None, label: str | None = None) -> str | None:
    if label:
        return label
    if usd_m is None:
        return None
    if usd_m >= 1000:
        return f"${usd_m / 1000:.2f}B"
    return f"${usd_m:.0f}M"


def _norm_line_of_therapy(raw: Any) -> str | None:
    s = _clean_field(raw, max_len=48)
    if not s:
        return None
    low = s.lower()
    if re.search(r"\b(1st|first|1ª|prima)\b", low) or low in ("1", "l1", "1l"):
        return "1st line"
    if re.search(r"\b(2nd|second|2ª|seconda)\b", low) or low in ("2", "l2", "2l"):
        return "2nd line"
    if re.search(r"\b(3rd|third|3ª|terza)\b", low) or low in ("3", "l3", "3l"):
        return "3rd line"
    if re.search(r"\b(4th|fourth|4ª|quarta)\b", low) or low in ("4", "l4", "4l"):
        return "4th line"
    if "adjuvant" in low or "neoadjuvant" in low or "maintenance" in low:
        return s[:48]
    return s[:48]


def _norm_us_approval_year(raw: Any) -> str | None:
    """First FDA / US approval calendar year as a 4-digit string (e.g. '2018')."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        y = int(raw)
        if 1980 <= y <= 2100:
            return str(y)
        return None
    s = _clean_field(raw, max_len=48)
    if not s:
        return None
    # Prefer an explicit year token (avoid picking LOE years from "approved … LOE 2035")
    m = re.search(
        r"(?i)(?:fda|us|u\.s\.|approved|approval|bla|nda)\D{0,24}((?:19|20)\d{2})",
        s,
    )
    if m:
        y = int(m.group(1))
        if 1980 <= y <= 2100:
            return str(y)
    m2 = re.fullmatch(r"(19|20)\d{2}", s.strip())
    if m2:
        return s.strip()
    m3 = re.search(r"\b((?:19|20)\d{2})\b", s)
    if m3:
        y = int(m3.group(1))
        if 1980 <= y <= 2100:
            return str(y)
    return None


def _norm_modality(raw: Any) -> str | None:
    s = _clean_field(raw, max_len=80)
    if not s:
        return None
    return s[:80]


def _norm_moa_target(item: dict[str, Any]) -> str | None:
    """Combine MoA + protein/therapeutic target into one display cell (if present)."""
    moa = _clean_field(
        item.get("moa_target")
        or item.get("mechanism_of_action")
        or item.get("moa")
        or item.get("mechanism"),
        max_len=160,
    )
    target = _clean_field(
        item.get("protein_target")
        or item.get("therapeutic_target")
        or item.get("target")
        or item.get("molecular_target"),
        max_len=120,
    )
    if moa and target:
        # Avoid "EGFR · EGFR" style duplicates
        if target.lower() in moa.lower() or moa.lower() in target.lower():
            return moa if len(moa) >= len(target) else target
        return f"{moa} · {target}"[:220]
    return moa or target


def _infer_therapeutic_area_from_text(text: str) -> str | None:
    low = (text or "").lower()
    if not low.strip():
        return None
    for label, keys in _TA_RULES:
        for k in keys:
            if k in low:
                return label
    return None


def _norm_therapeutic_area(
    raw: Any,
    *,
    indication: str | None = None,
) -> str | None:
    """Broad TA bucket — AI value preferred, else inferred from indication."""
    s = _clean_field(
        raw
        if raw is not None
        else None,
        max_len=80,
    )
    if s:
        low = s.lower().strip()
        if low in _TA_ALIASES:
            return _TA_ALIASES[low]
        for alias, label in _TA_ALIASES.items():
            if alias in low or low in alias:
                return label
        # Already a canonical / near-canonical free string from the model
        for label, _keys in _TA_RULES:
            if label.lower() == low or label.lower() in low or low in label.lower():
                return label
        inferred = _infer_therapeutic_area_from_text(s)
        if inferred:
            return inferred
        # Title-case unknown but keep short
        return s[:60]
    return _infer_therapeutic_area_from_text(indication or "")


def normalize_us_product_revenue(parsed: dict[str, Any]) -> dict[str, Any]:
    period = _clean_field(
        parsed.get("period")
        or parsed.get("reporting_period")
        or parsed.get("quarter")
        or parsed.get("latest_quarter"),
        max_len=48,
    )
    period_half = _clean_field(
        parsed.get("period_half") or parsed.get("half_period") or parsed.get("semester"),
        max_len=48,
    )
    period_year = _clean_field(
        parsed.get("period_year") or parsed.get("year_period") or parsed.get("fy"),
        max_len=48,
    )
    period_type = _clean_field(
        parsed.get("period_type") or parsed.get("cadence"),
        max_len=24,
    )
    if period_type:
        pt = period_type.lower()
        if "half" in pt or pt in ("h1", "h2", "1h", "2h", "semestr"):
            period_type = "half"
        elif "q" in pt or "quarter" in pt:
            period_type = "quarter"
        else:
            period_type = period_type[:24]

    rows_in = parsed.get("products") or parsed.get("revenues") or []
    if not isinstance(rows_in, list):
        rows_in = []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in rows_in:
        if not isinstance(item, dict):
            continue
        name = _clean_field(
            item.get("name") or item.get("product") or item.get("brand"),
            max_len=80,
        )
        if not name:
            continue
        key = re.sub(r"[^a-z0-9]+", "", name.lower())
        if key in seen:
            continue
        seen.add(key)

        q_m = _parse_usd_m(
            item.get("us_revenue_q_usd_m")
            or item.get("us_quarter_usd_m")
            or item.get("us_revenue_usd_m")
            or item.get("us_sales_usd_m")
            or item.get("revenue_usd_m")
        )
        h_m = _parse_usd_m(
            item.get("us_revenue_h_usd_m")
            or item.get("us_half_usd_m")
            or item.get("us_semester_usd_m")
        )
        y_m = _parse_usd_m(
            item.get("us_revenue_y_usd_m")
            or item.get("us_year_usd_m")
            or item.get("us_fy_usd_m")
            or item.get("us_annual_usd_m")
        )
        sort_m = q_m if q_m is not None else (h_m if h_m is not None else y_m)

        indication = _clean_field(
            item.get("indication") or item.get("disease"),
            max_len=220,
        )
        therapeutic_area = _norm_therapeutic_area(
            item.get("therapeutic_area")
            or item.get("therapy_area")
            or item.get("ta")
            or item.get("franchise")
            or item.get("disease_area"),
            indication=indication,
        )

        out.append(
            {
                "name": name,
                "indication": indication,
                "therapeutic_area": therapeutic_area,
                "moa_target": _norm_moa_target(item),
                "modality": _norm_modality(
                    item.get("modality")
                    or item.get("drug_modality")
                    or item.get("product_modality")
                    or item.get("technology")
                ),
                "usa_prevalence": _clean_field(
                    item.get("usa_prevalence")
                    or item.get("us_prevalence")
                    or item.get("prevalence"),
                    max_len=220,
                ),
                "us_approval_year": _norm_us_approval_year(
                    item.get("us_approval_year")
                    or item.get("fda_approval_year")
                    or item.get("approval_year")
                    or item.get("us_fda_year")
                    or item.get("first_us_approval")
                ),
                "patent_cliff": _clean_field(
                    item.get("patent_cliff")
                    or item.get("loe")
                    or item.get("loe_estimate")
                    or item.get("us_patent_expiry")
                    or item.get("loss_of_exclusivity"),
                    max_len=120,
                ),
                "line_of_therapy": _norm_line_of_therapy(
                    item.get("line_of_therapy")
                    or item.get("therapy_line")
                    or item.get("lot")
                    or item.get("guideline_line")
                ),
                "us_revenue_q_usd_m": q_m,
                "us_revenue_q_label": _fmt_usd_m(
                    q_m,
                    _clean_field(
                        item.get("us_revenue_q_label") or item.get("us_revenue_label"),
                        max_len=48,
                    ),
                ),
                "us_revenue_h_usd_m": h_m,
                "us_revenue_h_label": _fmt_usd_m(
                    h_m,
                    _clean_field(item.get("us_revenue_h_label"), max_len=48),
                ),
                "us_revenue_y_usd_m": y_m,
                "us_revenue_y_label": _fmt_usd_m(
                    y_m,
                    _clean_field(item.get("us_revenue_y_label"), max_len=48),
                ),
                # Back-compat sort / simple list consumers
                "us_revenue_usd_m": sort_m,
                "us_revenue_label": _fmt_usd_m(
                    sort_m,
                    _clean_field(
                        item.get("us_revenue_q_label") or item.get("us_revenue_label"),
                        max_len=48,
                    ),
                ),
                "notes": _clean_field(item.get("notes") or item.get("source_note"), max_len=160),
            }
        )
        # Drop rows with no usable US revenue figure (avoid empty $ columns).
        last = out[-1]
        if (
            last.get("us_revenue_q_usd_m") is None
            and last.get("us_revenue_h_usd_m") is None
            and last.get("us_revenue_y_usd_m") is None
        ):
            out.pop()
            continue
        if len(out) >= _MAX_PRODUCTS:
            break

    out.sort(
        key=lambda r: (
            -(
                r["us_revenue_usd_m"]
                if isinstance(r.get("us_revenue_usd_m"), (int, float))
                else -1.0
            ),
            str(r.get("name") or "").lower(),
        )
    )
    return {
        "period": period,
        "period_half": period_half,
        "period_year": period_year,
        "period_type": period_type or "quarter",
        "market": "US",
        "products": out,
    }


def lookup_us_product_revenue(
    *,
    ticker: str,
    company: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    tk = (ticker or "").strip().upper()
    if not tk:
        return {"ok": False, "error": "ticker required"}
    key = _cache_key(tk)

    def _serve_cache(*, allow_stale: bool = False) -> dict[str, Any] | None:
        with _CACHE_LOCK:
            cache_doc = _load_cache()
            hit = _find_cache_entry(cache_doc, tk)
            # Prefer current-schema hits unless force — do not re-call Gemini on remount.
            # Older schemas (missing us_approval_year etc.) rebuild when AI works;
            # if AI is down, allow_stale keeps the previous table visible.
            if not (
                hit
                and not force
                and isinstance(hit.get("products"), list)
                and hit.get("products")
            ):
                return None
            schema = int(hit.get("schema") or 0)
            if schema < _SCHEMA and not allow_stale:
                return None
            if cache_doc.get("entries", {}).get(key) is not hit:
                try:
                    upgraded = {**hit, "ticker": tk, "schema": max(schema, _SCHEMA)}
                    if schema >= _SCHEMA:
                        cache_doc.setdefault("entries", {})[key] = upgraded
                        _save_cache(cache_doc)
                except Exception:
                    pass
            return {
                "ok": True,
                "cached": True,
                "stale_schema": schema < _SCHEMA,
                "provider": hit.get("provider"),
                "updated_at": hit.get("updated_at"),
                "period": hit.get("period"),
                "period_half": hit.get("period_half"),
                "period_year": hit.get("period_year"),
                "period_type": hit.get("period_type"),
                "market": "US",
                "products": hit.get("products") or [],
            }

    early = _serve_cache(allow_stale=False)
    if early:
        return early

    # Prefer a prior-schema table immediately over a long Gemini rebuild that
    # often times out in the UI (AZN etc.). Force=true still rebuilds.
    if not force:
        stale_quick = _serve_cache(allow_stale=True)
        if stale_quick:
            stale_quick["hint"] = "Prior-schema cache · US market only"
            return stale_quick

        # Cold miss + no force: never block the UI on a multi-minute Gemini call.
        # One background build per ticker. A recent failure is returned as-is so
        # the tab does not spin on "building" for several minutes.
        failed = _recent_revenue_fail(tk)
        if failed:
            return failed
        with _BUILD_GUARD:
            already = tk in _REV_INFLIGHT
            if not already:
                _REV_INFLIGHT.add(tk)

        if not already:
            def _bg() -> None:
                try:
                    lookup_us_product_revenue(ticker=tk, company=company, force=True)
                except Exception:
                    logger.exception("US revenue background build failed %s", tk)
                finally:
                    with _BUILD_GUARD:
                        _REV_INFLIGHT.discard(tk)

            threading.Thread(target=_bg, name=f"us-rev-{tk}", daemon=True).start()
        return {
            "ok": False,
            "error": "building",
            "products": [],
            "hint": (
                "Building US product table in background — results appear "
                "automatically when ready."
            ),
        }

    with _revenue_build_lock(tk):
        again = _serve_cache(allow_stale=False)
        if again:
            return again
        stale_locked = _serve_cache(allow_stale=True)
        if stale_locked:
            stale_locked["hint"] = "Prior-schema cache · US market only"
            return stale_locked

        co = (company or "").strip()
        snippets = _collect_revenue_snippets(tk, co or None)

        if not ai_provider.is_available():
            return _remember_revenue_fail(tk, {
                "ok": False,
                "error": "no_ai_provider",
                "products": [],
                "hint": ai_provider.provider_info().get("hint_it"),
            })

        lines = [
            "Build a US commercial product table for this company.",
            f"Return UP TO {_MAX_PRODUCTS} US-marketed brands with disclosed US sales.",
            "Include BOTH:",
            "1) Top US brands by revenue (blockbusters / mega brands), AND",
            f"2) Mid-tier / smaller US brands with annual (FY or LTM) US revenue up to about ${_MID_TIER_FY_USD_M:.0f}M — do NOT stop after the top 5–6 names.",
            "If IR discloses more brands in the ≤$350M FY band, list them (e.g. Saphnelo, Breztri, Tezspire, Beyfortus, FluMist, other specialty brands when relevant).",
            "PARTNERED / CO-COMMERCIALIZED brands (critical):",
            "- If this ticker shares a brand with a partner (e.g. BioNTech BNTX + Pfizer for Comirnaty),",
            "  use the partner's disclosed US brand sales when available (Pfizer often reports US Comirnaty).",
            "- Put a short notes field naming the source (e.g. 'US Comirnaty from Pfizer IR').",
            "- Convert EUR figures to USD if only EUR is disclosed; note the FX assumption briefly.",
            "- NEVER return a brand with all of us_revenue_q/h/y null — omit that brand instead.",
            "For each brand include:",
            "- primary indication (disease only — do NOT put prevalence in this field)",
            "- therapeutic_area: ONE broad bucket grouping that indication "
            "(Oncology, Cardiovascular, Metabolic / endocrinology, Respiratory, "
            "Immunology / rheumatology, Hematology, Infectious disease / vaccines, "
            "Neurology / CNS, Rare disease, Gastroenterology, Ophthalmology, Dermatology, "
            "Women's health — use the closest fit)",
            "- MoA / protein target when known (e.g. 'EGFR TKI · EGFR', 'SGLT2 inhibitor · SGLT2', 'HER2 ADC · HER2')",
            "- modality (e.g. small molecule, mAb, ADC, bispecific, cell therapy, vaccine, peptide)",
            "- approximate USA prevalence/incidence of that indication (separate field)",
            "- expected US patent cliff / LOE (year or range)",
            "- guideline / label line of therapy (1st / 2nd / 3rd / 4th line when applicable)",
            "- US revenue for latest quarter, latest half (semester), and latest full year (FY or LTM)",
            "Rank by latest quarter US revenue descending (else half, else year).",
            "US dollars only — never WW/Total as the primary figure.",
            "",
            f"Ticker: {tk}",
            f"Company: {co or '(unknown)'}",
        ]
        if snippets:
            lines.append("")
            lines.append("Web search snippets:")
            for sn in snippets[:_DDG_SNIPPET_CAP]:
                lines.append(f"- {sn}")
        lines.extend(
            [
                "",
                "Return JSON with EXACTLY this shape:",
                "{",
                '  "period": "Q3 2025",',
                '  "period_half": "1H 2025",',
                '  "period_year": "FY 2024",',
                '  "period_type": "quarter",',
                '  "products": [',
                "    {",
                '      "name": "brand",',
                '      "indication": "primary disease only",',
                '      "therapeutic_area": "Oncology",',
                '      "moa_target": "MoA · protein target" | null,',
                '      "modality": "small molecule|mAb|ADC|bispecific|…" | null,',
                '      "usa_prevalence": "approx US prevalence/incidence",',
                '      "us_approval_year": 2018,',
                '      "patent_cliff": "US LOE ~2028",',
                '      "line_of_therapy": "1st line" | "2nd line" | "3rd line" | "4th line" | null,',
                '      "us_revenue_q_usd_m": 722.0,',
                '      "us_revenue_q_label": "$722M",',
                '      "us_revenue_h_usd_m": 1400.0,',
                '      "us_revenue_h_label": "$1.40B",',
                '      "us_revenue_y_usd_m": 280.0,',
                '      "us_revenue_y_label": "$280M",',
                '      "notes": "optional source note or null"',
                "    }",
                "  ]",
                "}",
                "All *_usd_m values are millions of USD, US market only. Omit brands with no usable US figure.",
                "Put prevalence ONLY in usa_prevalence — never append it to indication.",
                "us_approval_year = first FDA / US approval calendar year (integer) — not LOE.",
                "therapeutic_area must be a broad franchise bucket, not the narrow indication.",
                "For partnered brands, fill US $ from the partner IR when needed; never leave all revenues null.",
                f"Aim for a long list (target {_MAX_PRODUCTS // 2}+ rows when disclosed), including FY ≤ ${_MID_TIER_FY_USD_M:.0f}M brands.",
            ]
        )
        prompt = "\n".join(lines)

        provider_used = "gemini"
        raw: str | None = None
        if ai_provider.get_api_key("gemini"):
            raw = ai_provider._call_provider(  # noqa: SLF001
                "gemini",
                prompt,
                system=_SYSTEM,
                max_tokens=_MAX_TOKENS,
                model_override=None,
                task="catalyst",
            )
            if not raw:
                provider_used = "fallback"
                raw = ai_provider.call_ai(
                    prompt, system=_SYSTEM, max_tokens=_MAX_TOKENS, task="clinical_kpi"
                )
        else:
            provider_used = "active"
            raw = ai_provider.call_ai(
                prompt, system=_SYSTEM, max_tokens=_MAX_TOKENS, task="clinical_kpi"
            )

        if not raw:
            stale = _serve_cache(allow_stale=True)
            if stale:
                stale["hint"] = "Showing cached US table (AI empty / provider error)."
                stale["detail"] = ai_provider.friendly_error_message(lang="en")
                return stale
            return _remember_revenue_fail(tk, {
                "ok": False,
                "error": "ai_empty",
                "products": [],
                "detail": ai_provider.friendly_error_message(lang="it"),
            })

        parsed = _parse_ai_json(raw)
        if not parsed:
            stale = _serve_cache(allow_stale=True)
            if stale:
                stale["hint"] = "Showing cached US table (AI parse failed)."
                return stale
            return _remember_revenue_fail(tk, {"ok": False, "error": "ai_parse", "products": []})

        norm = normalize_us_product_revenue(parsed)
        if not norm["products"]:
            stale = _serve_cache(allow_stale=True)
            if stale:
                stale["hint"] = "Showing cached US table (AI returned no brands)."
                return stale
            return _remember_revenue_fail(
                tk, {"ok": False, "error": "ai_sparse", "products": [], **norm}
            )

        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        entry = {
            "ticker": tk,
            "schema": _SCHEMA,
            "provider": provider_used,
            "updated_at": stamp,
            **norm,
        }
        with _CACHE_LOCK:
            cache_doc = _load_cache()
            cache_doc.setdefault("entries", {})[key] = entry
            _save_cache(cache_doc)

        _REV_FAIL.pop(tk, None)
        return {
            "ok": True,
            "cached": False,
            "provider": provider_used,
            "updated_at": stamp,
            **norm,
        }
