"""
SDS Cluster A collector — openFDA unmet need, first-in-class, pipeline value.

Caches under ``data/sds_cluster_a_cache/``:
  - openFDA label counts: TTL 14 days
  - AI / heuristic classification: TTL 30 days
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from orchestrator_io_paths import CLINICAL_SIMULATION_SNAPSHOT_JSON, DATA_DIR
from prediction.supernova_score import (
    MARKET_SIZE_ESTIMATES,
    market_size_detail,
    market_size_score,
    normalize_indication,
    unmet_need_score,
)

_CACHE_DIR = Path(DATA_DIR) / "sds_cluster_a_cache"
_UNMET_CACHE_PATH = Path(DATA_DIR) / "sds_unmet_need_cache.json"
_OPENFDA_TTL_D = 14
_CLASS_TTL_D = 30
_UNMET_TTL_D = 7
_OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"
_OPENFDA_PAUSE_S = 0.2

# Peak-sales / TAM hints when AI is unavailable (USD billions) — mirrors MARKET_SIZE_ESTIMATES.
_TAM_HINTS: dict[str, float] = dict(MARKET_SIZE_ESTIMATES)

_PHASE_P_SUCCESS: list[tuple[str, float]] = [
    ("phase 3", 0.55),
    ("phase 2b", 0.28),
    ("phase 2a", 0.18),
    ("phase 2", 0.15),
    ("phase 1b", 0.08),
    ("phase 1", 0.05),
]

_NOVEL_MODALITY_KEYWORDS = (
    "adc",
    "antibody-drug conjugate",
    "car-t",
    "car t",
    "gene therapy",
    "crispr",
    "mrna",
    "bispecific",
    "radioligand",
    "protac",
    "degrader",
)


def _cache_path(kind: str, key: str) -> Path:
    safe = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return _CACHE_DIR / f"{kind}_{safe}.json"


def _read_cache(path: Path, ttl_days: int) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(doc, dict):
        return None
    fetched = doc.get("fetched_at")
    if not fetched:
        return doc
    try:
        ts = datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
        if ts.tzinfo:
            ts = ts.replace(tzinfo=None)
        if datetime.now() - ts > timedelta(days=ttl_days):
            return None
    except (TypeError, ValueError):
        pass
    return doc


def _write_cache(path: Path, payload: dict[str, Any]) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    doc = dict(payload)
    doc["fetched_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_unmet_cache() -> dict[str, Any]:
    if not _UNMET_CACHE_PATH.is_file():
        return {"entries": {}}
    try:
        doc = json.loads(_UNMET_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"entries": {}}
    if not isinstance(doc, dict):
        return {"entries": {}}
    doc.setdefault("entries", {})
    return doc


def _save_unmet_cache(doc: dict[str, Any]) -> None:
    _UNMET_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = dict(doc)
    out["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    _UNMET_CACHE_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


def _unmet_cache_key(indication: str | None) -> str:
    return f"unmet_{normalize_indication(indication)}"


def _read_unmet_entry(indication: str | None) -> dict[str, Any] | None:
    key = _unmet_cache_key(indication)
    if not key or key == "unmet_":
        return None
    doc = _load_unmet_cache()
    entry = (doc.get("entries") or {}).get(key)
    if not isinstance(entry, dict):
        return None
    fetched = entry.get("fetched_at")
    if fetched:
        try:
            ts = datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
            if ts.tzinfo:
                ts = ts.replace(tzinfo=None)
            if datetime.now() - ts > timedelta(days=_UNMET_TTL_D):
                return None
        except (TypeError, ValueError):
            pass
    return entry


def _write_unmet_entry(indication: str | None, payload: dict[str, Any]) -> None:
    key = _unmet_cache_key(indication)
    if not key or key == "unmet_":
        return
    doc = _load_unmet_cache()
    entries = doc.setdefault("entries", {})
    entries[key] = {**payload, "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds")}
    _save_unmet_cache(doc)


def _label_is_marketed(row: dict[str, Any]) -> bool:
    openfda = row.get("openfda") if isinstance(row.get("openfda"), dict) else {}
    product_types = openfda.get("product_type") or []
    if product_types:
        if not any("HUMAN PRESCRIPTION DRUG" in str(t).upper() for t in product_types):
            return False
    text_parts: list[str] = []
    for field in ("indications_and_usage", "purpose", "description"):
        val = row.get(field)
        if isinstance(val, list):
            text_parts.extend(str(x) for x in val)
        elif val:
            text_parts.append(str(val))
    blob = " ".join(text_parts).lower()
    if any(x in blob for x in ("placebo only", "investigational", "not approved")):
        return False
    marketing = row.get("marketing_status") or openfda.get("marketing_status")
    if marketing:
        ms = str(marketing).lower()
        if ms and "prescription" not in ms and "otc" not in ms:
            return False
    return True


def _count_filtered_labels(results: list[dict[str, Any]]) -> tuple[int, set[str]]:
    brands: set[str] = set()
    count = 0
    for row in results:
        if not isinstance(row, dict):
            continue
        if not _label_is_marketed(row):
            continue
        count += 1
        openfda = row.get("openfda") if isinstance(row.get("openfda"), dict) else {}
        for b in openfda.get("brand_name") or []:
            s = str(b).strip().upper()
            if s:
                brands.add(s)
        for g in openfda.get("generic_name") or []:
            s = str(g).strip().upper()
            if s:
                brands.add(s)
    return count, brands


def _parse_ai_json(raw: str) -> dict[str, Any] | None:
    try:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        return json.loads(raw)
    except Exception:
        return None


def _openfda_get(search: str, *, limit: int = 100) -> dict[str, Any] | None:
    q = urlencode({"search": search, "limit": str(limit)})
    url = f"{_OPENFDA_LABEL_URL}?{q}"
    try:
        req = Request(url, headers={"User-Agent": "SuperNova-SDS/1.0 (openFDA research)"})
        with urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, OSError, json.JSONDecodeError, TimeoutError):
        return None


def indication_search_phrases(indication: str | None) -> list[str]:
    """Build 1–3 openFDA search phrases from a condition string."""
    if not indication:
        return []
    raw = str(indication).strip()
    if not raw:
        return []
    phrases: list[str] = []
    for part in re.split(r"[|;]", raw):
        p = part.strip()
        if len(p) >= 4:
            phrases.append(p[:120])
    if not phrases:
        phrases.append(raw[:120])
    # Also try first segment before comma (more specific).
    first = phrases[0]
    if "," in first:
        head = first.split(",", 1)[0].strip()
        if len(head) >= 4 and head.lower() not in {x.lower() for x in phrases}:
            phrases.insert(0, head[:120])
    return phrases[:3]


def count_approved_drugs_openfda(
    indication: str | None,
    *,
    use_cache: bool = True,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """
    Count distinct marketed labels matching indication text (openFDA drug/label).
    Returns {approved_drugs_count, search_phrase, openfda_hits, error?}.
    """
    phrases = indication_search_phrases(indication)
    if not phrases:
        return {
            "approved_drugs_count": None,
            "search_phrase": None,
            "openfda_hits": 0,
            "error": "no_indication",
        }

    phrase = phrases[0]
    cache_key = phrase.lower()
    cache_p = _cache_path("openfda", cache_key)
    if use_cache and not force_refresh:
        cached_unmet = _read_unmet_entry(indication)
        if cached_unmet and cached_unmet.get("approved_drugs_count") is not None:
            return cached_unmet
        cached = _read_cache(cache_p, _OPENFDA_TTL_D)
        if cached and "approved_drugs_count" in cached:
            return cached

    escaped = phrase.replace('"', "").strip()
    search = f'indications_and_usage:"{escaped}"'
    payload = _openfda_get(search, limit=100)
    time.sleep(_OPENFDA_PAUSE_S)

    out: dict[str, Any] = {
        "approved_drugs_count": None,
        "search_phrase": phrase,
        "openfda_hits": 0,
        "source": "openfda_label",
    }
    if not payload or not isinstance(payload.get("results"), list):
        out["error"] = "empty_response"
        if use_cache:
            _write_cache(cache_p, out)
            _write_unmet_entry(indication, out)
        return out

    filtered_n, brands = _count_filtered_labels(payload["results"])
    hits = len(payload["results"])
    out["openfda_hits"] = hits
    out["openfda_filtered_hits"] = filtered_n
    if hits >= 100:
        out["approved_drugs_count"] = max(len(brands), filtered_n, 3)
        out["crowded_cap"] = True
    else:
        out["approved_drugs_count"] = max(len(brands), filtered_n)
    if use_cache:
        _write_cache(cache_p, out)
        _write_unmet_entry(indication, out)
    return out


def tam_hint_billions(indication: str | None) -> float | None:
    if not indication:
        return None
    key = indication.strip().lower()
    for k, v in _TAM_HINTS.items():
        if k in key:
            return v
    return None


def phase_success_prob(phase: str | None) -> float:
    if not phase:
        return 0.10
    p = phase.lower().replace("  ", " ")
    for token, prob in _PHASE_P_SUCCESS:
        if token.replace(" ", "") in p.replace(" ", "") or token in p:
            return prob
    m = re.search(r"phase\s*(\d)", p)
    if m:
        return {1: 0.05, 2: 0.15, 3: 0.55, 4: 0.65}.get(int(m.group(1)), 0.10)
    return 0.10


def estimate_pipeline_value_billions(
    *,
    phase: str | None,
    tam_billions: float | None,
    peak_sales_billions: float | None,
) -> float | None:
    p = phase_success_prob(phase)
    if peak_sales_billions is not None and peak_sales_billions > 0:
        return round(peak_sales_billions * p, 3)
    if tam_billions is not None and tam_billions > 0:
        return round(tam_billions * 0.12 * p, 3)
    return None


def heuristic_first_in_class(
    *,
    approved_count: int | None,
    interventions: str | None,
    phase: str | None,
) -> bool | None:
    if approved_count is None:
        return None
    inter = (interventions or "").lower()
    novel = any(k in inter for k in _NOVEL_MODALITY_KEYWORDS)
    ph = (phase or "").lower()
    late = "phase 3" in ph or "phase 2b" in ph or ph.endswith("2b")
    if approved_count == 0:
        return True
    if approved_count <= 1 and novel and late:
        return True
    return False


def _ai_first_in_class(
    *,
    drug_name: str | None,
    intervention_description: str | None,
    condition: str | None,
) -> dict[str, Any] | None:
    try:
        import ai_provider
    except ImportError:
        return None
    if not ai_provider.is_available():
        return None

    prompt = f"""Drug name: {drug_name or "unknown"}
Mechanism of action: {intervention_description or "unknown"}
Indication: {condition or "unknown"}

Question: Is this drug first-in-class for this specific mechanism of action in this indication?
Answer in JSON only, no other text:
{{"first_in_class": true/false, "confidence": "high/medium/low", "reasoning": "one sentence max"}}"""

    model = os.environ.get("SDS_FIC_CLAUDE_MODEL", "claude-sonnet-4-20250514")
    raw = ai_provider.call_ai(
        prompt,
        system="Reply with valid JSON only. No markdown.",
        max_tokens=150,
        task="clinical_kpi",
        model_override=model,
    )
    if not raw:
        return None
    parsed = _parse_ai_json(raw)
    if not isinstance(parsed, dict):
        return None
    parsed["source_ai"] = True
    return parsed


def _ai_classify_cluster_a(
    *,
    ticker: str,
    indication: str | None,
    interventions: str | None,
    phase: str | None,
    approved_count: int | None,
) -> dict[str, Any] | None:
    try:
        import ai_provider
    except ImportError:
        return None
    if not ai_provider.is_available():
        return None

    prompt = f"""You are a biotech investment analyst. Classify this clinical catalyst for SDS scoring.

Ticker: {ticker}
Indication: {indication or "unknown"}
Interventions: {interventions or "unknown"}
Phase: {phase or "unknown"}
FDA-approved distinct drugs in this indication (openFDA count): {approved_count if approved_count is not None else "unknown"}

Return JSON ONLY:
{{
  "first_in_class": true/false,
  "mechanism_class": "short MOA label",
  "tam_billions": number or null,
  "peak_sales_billions": number or null,
  "confidence": 0.0-1.0
}}

Rules:
- first_in_class = novel mechanism vs approved standard-of-care in this indication (not merely first company).
- tam_billions = US peak market estimate (rough).
- peak_sales_billions = realistic peak annual sales if drug succeeds.
"""
    raw = ai_provider.call_ai(
        prompt,
        system="Reply with valid JSON only. No markdown.",
        max_tokens=512,
        task="clinical_kpi",
    )
    if not raw:
        return None
    parsed = _parse_ai_json(raw)
    if not isinstance(parsed, dict):
        return None
    parsed["source_ai"] = True
    return parsed


def _load_clinical_by_ticker() -> dict[str, dict[str, Any]]:
    path = Path(CLINICAL_SIMULATION_SNAPSHOT_JSON)
    if not path.is_file():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rows = doc.get("rows") or []
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        tk = str(row.get("ticker") or row.get("Ticker") or "").strip().upper()
        if tk:
            out[tk] = row
    return out


_clinical_index: dict[str, dict[str, Any]] | None = None


def clinical_context_for_ticker(ticker: str) -> dict[str, Any]:
    global _clinical_index
    if _clinical_index is None:
        _clinical_index = _load_clinical_by_ticker()
    tk = ticker.upper()
    row = _clinical_index.get(tk) or {}
    indication = (
        row.get("conditions")
        or row.get("Indication")
        or row.get("indication")
        or row.get("purpose")
    )
    interventions = row.get("interventions") or row.get("generic_name") or row.get("brand_name")
    phase = row.get("phase") or row.get("Phase") or row.get("Studio Phase")
    from prediction.sds.ctgov_study_plan import normalize_nct_id

    return {
        "ticker": tk,
        "indication": str(indication).strip() if indication else None,
        "interventions": str(interventions).strip() if interventions else None,
        "phase": str(phase).strip() if phase else None,
        "nct_id": normalize_nct_id(row.get("nct_id") or row.get("NCT") or row.get("nctId")),
        "company": row.get("lead_sponsor") or row.get("query_company"),
    }


def load_cached_cluster_a(ticker: str) -> dict[str, Any] | None:
    tk = ticker.upper()
    cache_p = _cache_path("cluster_a", tk)
    return _read_cache(cache_p, _CLASS_TTL_D)


def collect_cluster_a(
    ticker: str,
    *,
    indication: str | None = None,
    interventions: str | None = None,
    phase: str | None = None,
    nct_id: str | None = None,
    use_cache: bool = True,
    force_refresh: bool = False,
    use_ai: bool | None = None,
) -> dict[str, Any]:
    """
    Cluster A enrichment: unmet need, market size, first-in-class, pipeline value.
    """
    from prediction.sds.catalyst_readout import readout_events_for_ticker, readout_summary_text
    from prediction.sds.ctgov_study_plan import fetch_study_plan_fields, normalize_nct_id

    ctx = clinical_context_for_ticker(ticker)
    tk = ticker.upper()
    ind = indication or ctx.get("indication")
    inter = interventions or ctx.get("interventions")
    ph = phase or ctx.get("phase")
    nct = normalize_nct_id(nct_id) or normalize_nct_id(ctx.get("nct_id"))

    cache_p = _cache_path("cluster_a", tk)
    if use_cache and not force_refresh:
        cached = _read_cache(cache_p, _CLASS_TTL_D)
        if cached and cached.get("ticker") == tk:
            return cached

    if use_ai is None:
        use_ai = os.environ.get("SDS_CLUSTER_A_USE_AI", "").strip().lower() in ("1", "true", "yes")

    fda_doc = count_approved_drugs_openfda(ind, use_cache=use_cache, force_refresh=force_refresh)

    study_plan: dict[str, Any] = {}
    if nct:
        sp_cache = _cache_path("ctgov_plan", nct)
        if use_cache and not force_refresh:
            cached_sp = _read_cache(sp_cache, _OPENFDA_TTL_D)
            if cached_sp and cached_sp.get("nct_id") == nct:
                study_plan = cached_sp
        if not study_plan or study_plan.get("error"):
            study_plan = fetch_study_plan_fields(nct)
            if use_cache and not study_plan.get("error"):
                _write_cache(sp_cache, study_plan)

    if not ind and study_plan.get("conditions"):
        ind = study_plan.get("conditions")
    if not inter and study_plan.get("interventions"):
        inter = study_plan.get("interventions")
    if not ph and study_plan.get("phase"):
        ph = study_plan.get("phase")

    readouts = readout_events_for_ticker(tk)
    readout_text = readout_summary_text(readouts)
    approved = fda_doc.get("approved_drugs_count")
    if isinstance(approved, (int, float)):
        approved_n = int(approved)
    else:
        approved_n = None

    ai_doc: dict[str, Any] | None = None
    if use_ai:
        ai_doc = _ai_classify_cluster_a(
            ticker=tk,
            indication=ind,
            interventions=inter,
            phase=ph,
            approved_count=approved_n,
        )

    fic: bool | None = None
    fic_conf: str | None = None
    fic_reason: str | None = None

    unmet_cached = _read_unmet_entry(ind) if use_cache and not force_refresh else None
    if unmet_cached and isinstance(unmet_cached.get("first_in_class"), bool):
        fic = unmet_cached.get("first_in_class")
        fic_conf = unmet_cached.get("confidence")
        fic_reason = unmet_cached.get("reasoning")
    elif use_ai:
        fic_ai = _ai_first_in_class(
            drug_name=inter,
            intervention_description=inter,
            condition=ind,
        )
        if fic_ai and isinstance(fic_ai.get("first_in_class"), bool):
            fic = fic_ai["first_in_class"]
            fic_conf = str(fic_ai.get("confidence") or "").strip().lower() or None
            fic_reason = fic_ai.get("reasoning")
            _write_unmet_entry(
                ind,
                {
                    "approved_drugs_count": approved_n,
                    "first_in_class": fic,
                    "confidence": fic_conf,
                    "reasoning": fic_reason,
                    "source": "claude_fic",
                },
            )
    if fic is None and ai_doc and isinstance(ai_doc.get("first_in_class"), bool):
        fic = ai_doc["first_in_class"]
    if fic is None:
        fic = heuristic_first_in_class(
            approved_count=approved_n,
            interventions=inter,
            phase=ph,
        )

    tam = None
    peak = None
    if ai_doc:
        try:
            tam = float(ai_doc["tam_billions"]) if ai_doc.get("tam_billions") is not None else None
        except (TypeError, ValueError):
            tam = None
        try:
            peak = float(ai_doc["peak_sales_billions"]) if ai_doc.get("peak_sales_billions") is not None else None
        except (TypeError, ValueError):
            peak = None
    if tam is None:
        tam = tam_hint_billions(ind)

    unmet = unmet_need_score(approved_n, fic, confidence=fic_conf)
    mkt = market_size_score(ind, tam_billions=tam)
    mkt_detail = market_size_detail(ind, tam_billions=tam)
    pipe_b = estimate_pipeline_value_billions(phase=ph, tam_billions=tam, peak_sales_billions=peak)
    pipeline_usd = pipe_b * 1_000_000_000.0 if pipe_b is not None else None

    out: dict[str, Any] = {
        "ticker": tk,
        "nct_id": nct,
        "indication": ind,
        "interventions": inter,
        "phase": ph,
        "primary_outcome": study_plan.get("primary_outcome"),
        "primary_outcomes": study_plan.get("primary_outcomes") or [],
        "study_description": study_plan.get("study_description"),
        "secondary_outcomes": study_plan.get("secondary_outcomes"),
        "trial_design": study_plan.get("trial_design"),
        "ctgov_brief_title": study_plan.get("brief_title"),
        "ctgov_status": study_plan.get("overall_status"),
        "ctgov_error": study_plan.get("error"),
        "catalyst_readout_events": readouts,
        "catalyst_readout_summary": readout_text,
        "approved_drugs_count": approved_n,
        "first_in_class": fic,
        "first_in_class_confidence": fic_conf,
        "first_in_class_reasoning": fic_reason,
        "tam_billions": tam,
        "tam_estimate_bn": mkt_detail.get("tam_estimate_bn"),
        "market_size_source": mkt_detail.get("source"),
        "peak_sales_billions": peak,
        "pipeline_value_estimate": pipeline_usd,
        "unmet_need_score": unmet,
        "market_size_score": mkt,
        "openfda_search_phrase": fda_doc.get("search_phrase"),
        "openfda_hits": fda_doc.get("openfda_hits"),
        "openfda_error": fda_doc.get("error"),
        "ai_enriched": bool(ai_doc),
        "mechanism_class": (ai_doc or {}).get("mechanism_class"),
    }
    if use_cache:
        _write_cache(cache_p, out)
    return out


__all__ = [
    "clinical_context_for_ticker",
    "collect_cluster_a",
    "count_approved_drugs_openfda",
    "estimate_pipeline_value_billions",
    "heuristic_first_in_class",
    "indication_search_phrases",
    "load_cached_cluster_a",
    "tam_hint_billions",
]
