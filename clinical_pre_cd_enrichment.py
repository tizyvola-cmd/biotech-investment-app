"""
Clinical pre-CD enrichment (6 months before Completion Date)
============================================================
Aggregates public clinical evidence for Simulation tickers:
  - ClinicalTrials.gov (results, status, outcome measures, linked publications)
  - PubMed abstracts (NCT-linked + optional company search in the pre-CD window)

Output: data/clinical_pre_cd_enrichment_snapshot.json

Distinct from catalyst_extractor (SEC 8-K only).
AI synthesis runs when a provider is configured; structured CT.gov/PubMed data
is always stored even if AI fails.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import ai_provider
from prediction.eis_feed_quality import (
    filter_trusted_snapshot_records,
    filter_verified_feed_events as _filter_verified_feed_events,
    is_study_sponsor_trusted,
    is_valid_feed_ticker,
    recompute_record_sponsor_match,
    sanitize_snapshot_record,
    verify_event_reference_strict,
)
from clinical_cache_ttl import (
    needs_scheduled_deep_refresh,
    should_skip_enrichment_refresh,
)
from clinical_trial_summary import (
    _ctgov_get,
    _extract_results,
    _pubmed_fetch_abstracts,
    _pubmed_search_pmids,
)

_DATA_DIR = Path(__file__).resolve().parent / "data"
_SNAPSHOT_PATH = _DATA_DIR / "clinical_pre_cd_enrichment_snapshot.json"
_MONTHS_BEFORE_CD = int(__import__("os").environ.get("CLINICAL_PRE_CD_MONTHS", "6"))

# Programmi noti oltre al NCT in simulazione (es. CNSP → Berubicin/TPI-287 vs NCT Amisodin)
_TICKER_EXTRA_DRUGS: dict[str, list[str]] = {
    "CNSP": ["Berubicin", "TPI-287", "TPI 287", "WP1244"],
    "ANIK": ["Cingal", "Hyaluronate"],
}

_STATUS: dict[str, Any] = {
    "running": False,
    "message": "",
    "processed": 0,
    "total": 0,
    "ai_ok": 0,
    "error": None,
    "finished_at": None,
}
_LOCK = threading.Lock()


def get_status() -> dict[str, Any]:
    with _LOCK:
        out = dict(_STATUS)
    try:
        out["ai_provider"] = ai_provider.provider_info()
    except Exception:
        pass
    return out


def _set_status(**kw: Any) -> None:
    with _LOCK:
        _STATUS.update(kw)


def _parse_nct(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        raw = raw.get("text") or raw.get("href") or ""
    s = str(raw).strip().upper()
    m = re.search(r"NCT\d+", s)
    return m.group(0) if m else None


def _parse_date(s: Any) -> datetime | None:
    raw = str(s or "").strip()
    if not raw or raw in ("—", "None", "nan"):
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _fmt_iso(d: datetime | None) -> str | None:
    return d.strftime("%Y-%m-%d") if d else None


def _yf_close_bars(ticker: str, start: datetime, end_excl: datetime) -> list[tuple[datetime, float]]:
    """Return list of (session_date, close) for [start, end_excl)."""
    try:
        import yfinance as yf
        import pandas as pd
    except Exception:
        return []

    try:
        df = yf.download(
            ticker,
            start=start.strftime("%Y-%m-%d"),
            end=end_excl.strftime("%Y-%m-%d"),
            interval="1d",
            progress=False,
            auto_adjust=False,
            group_by="column",
        )
        if df is None or len(df) == 0:
            return []
        if isinstance(df.columns, pd.MultiIndex):
            close = df[("Close", ticker)]
        else:
            close = df["Close"]
        out: list[tuple[datetime, float]] = []
        for idx, v in close.items():
            try:
                c = float(v)
            except Exception:
                continue
            if c == c and c > 0:
                d = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else datetime.fromisoformat(str(idx))
                out.append((datetime(d.year, d.month, d.day), c))
        out.sort(key=lambda x: x[0])
        return out
    except Exception:
        return []


def _close_before_and_after_sessions(
    bars: list[tuple[datetime, float]],
    event_d: datetime,
    *,
    n_after: int = 5,
) -> tuple[float | None, list[float]]:
    """Baseline close strictly before event_d + up to ``n_after`` closes on/after event_d."""
    if not bars:
        return (None, [])
    before: float | None = None
    for d, c in reversed(bars):
        if d < event_d:
            before = c
            break
    after: list[float] = []
    for d, c in bars:
        if d >= event_d:
            after.append(c)
        if len(after) >= n_after:
            break
    return before, after


def _close_before_and_three_after(
    bars: list[tuple[datetime, float]],
    event_d: datetime,
) -> tuple[float | None, float | None, float | None, float | None]:
    """Baseline close strictly before event_d + next 3 closes on/after event_d."""
    before, after = _close_before_and_after_sessions(bars, event_d, n_after=3)
    return (
        before,
        after[0] if len(after) > 0 else None,
        after[1] if len(after) > 1 else None,
        after[2] if len(after) > 2 else None,
    )


def _pct(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    try:
        if a <= 0:
            return None
        return round((b / a - 1.0) * 100.0, 2)
    except Exception:
        return None


def _safe_frac_pct(raw: Any) -> float | None:
    """SEC snapshot stores Δ as fractional return (p1/p0 - 1); e.g. -0.064 → -6.4%, 2.39 → +239%."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in ("—", "None", "nan"):
        return None
    try:
        v = float(s.replace(",", "."))
    except ValueError:
        return None
    return round(v * 100.0, 2)


def _safe_price(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in ("—", "None", "nan"):
        return None
    try:
        v = float(s.replace(",", "."))
        return v if v > 0 else None
    except ValueError:
        return None


def _parse_items_from_content(content: str) -> str:
    m = re.search(r"Items 8-K:\s*([\d.,\s]+)", content or "")
    return m.group(1).strip() if m else ""


def _load_sec_k8_snapshot() -> dict[str, Any]:
    try:
        from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON

        path = Path(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    except ImportError:
        path = _DATA_DIR / "sec_k8_simulation_snapshot.json"
    if not path.is_file():
        return {"rows": [], "columns": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _sec_k8_col_map(snap: dict[str, Any]) -> dict[str, str]:
    cols = snap.get("columns") or []
    return {
        "filing": next((c for c in cols if "filing 8-K" in c.lower()), "Data filing 8-K"),
        "content": next((c for c in cols if "Contenuto" in c), "Contenuto 8-K\n(Items · doc SEC · temi)"),
        "baseline": next((c for c in cols if "Chiusura" in c and "prima" in c), "Chiusura ($)\nultima seduta\nprima del filing"),
        "d1": next((c for c in cols if "+1" in c), "Δ% vs baseline\n(seduta +1)"),
        "d2": next((c for c in cols if "+2" in c), "Δ% vs baseline\n(seduta +2)"),
        "d3": next((c for c in cols if "+3" in c), "Δ% vs baseline\n(seduta +3)"),
        "edgar_list": next((c for c in cols if "Elenco 8" in c), "Elenco 8‑K\n(SEC EDGAR)"),
    }


def _href_from_cell(cell: Any) -> str | None:
    if isinstance(cell, dict):
        h = str(cell.get("href") or "").strip()
        return h or None
    return None


def _volume_ratio_t1(ticker: str, event_d: datetime) -> float | None:
    try:
        import yfinance as yf
        import pandas as pd
    except Exception:
        return None
    try:
        start = event_d - timedelta(days=45)
        end = event_d + timedelta(days=10)
        df = yf.download(
            ticker,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            interval="1d",
            progress=False,
            auto_adjust=False,
            group_by="column",
        )
        if df is None or len(df) == 0:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            vol = df[("Volume", ticker)]
        else:
            vol = df["Volume"]
        rows: list[tuple[datetime, float]] = []
        for idx, v in vol.items():
            try:
                vv = float(v)
            except Exception:
                continue
            if vv != vv or vv <= 0:
                continue
            d = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else datetime.fromisoformat(str(idx))
            rows.append((datetime(d.year, d.month, d.day), vv))
        rows.sort(key=lambda x: x[0])
        if len(rows) < 5:
            return None
        after = [vv for d, vv in rows if d >= event_d]
        if not after:
            return None
        vol_t1 = after[0]
        prior = [vv for d, vv in rows if d < event_d][-30:]
        if not prior:
            return None
        avg30 = sum(prior) / len(prior)
        if avg30 <= 0:
            return None
        return round(vol_t1 / avg30, 3)
    except Exception:
        return None


def _timeline_events_from_sec_k8(
    ticker: str,
    *,
    window_start: str,
    window_end: str,
    drug: str | None,
    vol_cache: dict[str, float | None],
) -> list[dict[str, Any]]:
    from catalyst_extractor import _items_to_headline
    from prediction.event_impact_score import compute_eis, heuristic_sentiment

    snap = _load_sec_k8_snapshot()
    cmap = _sec_k8_col_map(snap)
    ws = _parse_date(window_start)
    we = _parse_date(window_end)
    if not ws or not we:
        return []

    catalyst_by_date: dict[str, dict[str, Any]] = {}
    cat_path = _DATA_DIR / "catalyst_feed_snapshot.json"
    if cat_path.is_file():
        try:
            cat = json.loads(cat_path.read_text(encoding="utf-8"))
            for ev in cat.get("events") or []:
                if str(ev.get("ticker", "")).upper() != ticker:
                    continue
                fd = str(ev.get("filing_date") or "")
                if fd:
                    catalyst_by_date[fd] = ev
        except Exception:
            pass

    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in snap.get("rows") or []:
        if str(row.get("Ticker", "")).strip().upper() != ticker:
            continue
        fd_raw = row.get(cmap["filing"])
        filing_date = _parse_date(fd_raw)
        if not filing_date or not ws <= filing_date <= we:
            continue
        content = str(row.get(cmap["content"]) or "")
        items_raw = _parse_items_from_content(content)
        dedupe = f"{filing_date.strftime('%Y-%m-%d')}|{items_raw}"
        if dedupe in seen:
            continue
        seen.add(dedupe)

        p0 = _safe_price(row.get(cmap["baseline"]))
        d1_pct = _safe_frac_pct(row.get(cmap["d1"]))
        d3_pct = _safe_frac_pct(row.get(cmap["d3"]))
        p1 = round(p0 * (1 + (d1_pct or 0) / 100.0), 4) if p0 and d1_pct is not None else None
        p3 = round(p0 * (1 + (d3_pct or 0) / 100.0), 4) if p0 and d3_pct is not None else None

        iso = filing_date.strftime("%Y-%m-%d")
        vol_key = f"{ticker}|{iso}"
        if vol_key not in vol_cache:
            vol_cache[vol_key] = _volume_ratio_t1(ticker, filing_date)
        vol_ratio = vol_cache.get(vol_key)
        sentiment = heuristic_sentiment(items_raw, d1_pct)
        eis = compute_eis(
            delta_p_1d=d1_pct,
            delta_p_3d=d3_pct,
            vol_ratio=vol_ratio,
            sentiment=sentiment,
        )

        cat = catalyst_by_date.get(iso) or {}
        extracted = cat.get("extracted") or {}
        summary = (
            str(extracted.get("headline") or "").strip()
            or str(extracted.get("key_metric") or "").strip()
            or _items_to_headline(items_raw)
        )
        link = cat.get("filing_doc_url") or _href_from_cell(row.get(cmap["edgar_list"])) or cat.get("edgar_browse_url")
        link_label = "SEC EDGAR" if link else ""

        is_corp = any(
            x in items_raw for x in ("2.02", "5.02", "1.01", "3.02", "2.03")
        ) and not any(x in items_raw for x in ("7.01", "8.01"))
        asset_label = drug if drug and not is_corp else ("Corporate" if is_corp else (drug or "SEC 8-K"))
        impact_bits: list[str] = []
        if d1_pct is not None:
            impact_bits.append(f"{d1_pct:+.1f}% T+1")
        if vol_ratio and vol_ratio > 1.5:
            impact_bits.append(f"volume {vol_ratio:.1f}× media")
        out.append(
            {
                "event_date": iso,
                "event_type": "sec_8k",
                "source_type": "sec_8k",
                "event_title": _items_to_headline(items_raw),
                "asset": asset_label,
                "summary": summary,
                "items_raw": items_raw,
                "sentiment": sentiment,
                "impact_note": " · ".join(impact_bits) if impact_bits else "8-K SEC",
                "price": {
                    "p_t0": p0,
                    "p_t1": p1,
                    "p_t3": p3,
                    "delta_p_1d": d1_pct,
                    "delta_p_3d": d3_pct,
                },
                "link": link,
                "link_label": link_label or "SEC",
                "eis": eis,
                "sec_filing_verified": True,
            }
        )

    out.sort(key=lambda e: e.get("event_date") or "")
    return out


def _timeline_ctgov_event(
    *,
    pub_date: str | None,
    window_start: str,
    window_end: str,
    drug: str | None,
    summary: str,
    nct_id: str,
    ticker: str,
    vol_cache: dict[str, float | None],
) -> dict[str, Any] | None:
    from prediction.event_impact_score import compute_eis, heuristic_sentiment

    if not pub_date:
        return None
    pd = _parse_date(pub_date)
    ws, we = _parse_date(window_start), _parse_date(window_end)
    if not pd or not ws or not we or not (ws <= pd <= we):
        return None

    bars = _yf_close_bars(ticker, pd - timedelta(days=45), pd + timedelta(days=14))
    p0, p1, _p2, p3 = _close_before_and_three_after(bars, pd)
    d1 = _pct(p0, p1)
    d3 = _pct(p0, p3)
    iso = pd.strftime("%Y-%m-%d")
    vol_key = f"{ticker}|{iso}"
    if vol_key not in vol_cache:
        vol_cache[vol_key] = _volume_ratio_t1(ticker, pd)
    eis = compute_eis(
        delta_p_1d=d1,
        delta_p_3d=d3,
        vol_ratio=vol_cache.get(vol_key),
        sentiment=heuristic_sentiment("7.01", d1),
    )
    return {
        "event_date": iso,
        "event_type": "clinicaltrials.gov",
        "event_title": "CT.gov registry update",
        "drug": drug,
        "summary": summary[:400] if summary else f"Registry update {nct_id}",
        "items_raw": "",
        "price": {
            "p_t0": p0,
            "p_t1": p1,
            "p_t3": p3,
            "delta_p_1d": d1,
            "delta_p_3d": d3,
        },
        "link": f"https://clinicaltrials.gov/study/{nct_id}",
        "link_label": "ClinicalTrials.gov",
        "eis": eis,
    }


def _nct_from_href(href: str | None) -> str | None:
    if not href:
        return None
    return _parse_nct(href)


def _load_clinical_rows() -> list[dict[str, Any]]:
    try:
        from orchestrator_io_paths import CLINICAL_SIMULATION_SNAPSHOT_JSON

        path = Path(CLINICAL_SIMULATION_SNAPSHOT_JSON)
    except ImportError:
        path = _DATA_DIR / "clinical_simulation_snapshot.json"
    if not path.is_file():
        return []
    snap = json.loads(path.read_text(encoding="utf-8"))
    return list(snap.get("rows") or [])


def _load_sec_k8_tickers() -> set[str]:
    try:
        from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON

        path = Path(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    except ImportError:
        path = _DATA_DIR / "sec_k8_simulation_snapshot.json"
    if not path.is_file():
        return set()
    snap = json.loads(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for row in snap.get("rows") or []:
        tk = str(row.get("Ticker", "")).strip().upper()
        if tk:
            out.add(tk)
    return out


def _portfolio_ticker_set() -> set[str]:
    """Tickers with capital > 0 and buy price > 0 (invest_sim_inputs.json)."""
    try:
        from orchestrator_io_paths import INVEST_SIM_INPUTS_JSON
    except ImportError:
        return set()
    p = Path(INVEST_SIM_INPUTS_JSON)
    if not p.is_file():
        return set()
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    raw = doc.get("inputs") if isinstance(doc, dict) else doc
    if not isinstance(raw, dict):
        return set()
    out: set[str] = set()

    def _num(v: Any) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    for key, slot in raw.items():
        if not isinstance(slot, dict):
            continue
        if _num(slot.get("capital")) <= 0 or _num(slot.get("buyPrice")) <= 0:
            continue
        tk = str(key).split("|", 1)[0].strip().upper()
        if tk:
            out.add(tk)
    return out


def _build_work_list() -> list[dict[str, Any]]:
    sec_tickers = _load_sec_k8_tickers()
    by_ticker: dict[str, dict[str, Any]] = {}
    for row in _load_clinical_rows():
        ticker = str(row.get("ticker", "")).strip().upper()
        if not is_valid_feed_ticker(ticker):
            continue
        if not _study_row_sponsor_ok(row):
            continue
        if sec_tickers and ticker not in sec_tickers:
            continue
        cd = _parse_date(row.get("primary_completion_date") or row.get("completion_date"))
        nct = _parse_nct(row.get("nct_id"))
        if not nct and row.get("study_href"):
            nct = _nct_from_href(str(row.get("study_href", "")))
        company = str(row.get("query_company") or ticker)
        prev = by_ticker.get(ticker)
        if prev and cd and prev.get("cd_date") and cd >= prev["cd_date"]:
            continue
        by_ticker[ticker] = {
            "ticker": ticker,
            "company": company,
            "nct_id": nct,
            "cd_date": cd.strftime("%Y-%m-%d") if cd else None,
            "phase": row.get("phase"),
            "brief_title": row.get("brief_title"),
            "overall_status": row.get("overall_status"),
            "conditions": row.get("conditions"),
            "interventions": row.get("interventions"),
            "last_update": row.get("last_update_posted_date"),
            "sponsor_match": row.get("sponsor_match"),
        }
    return [x for x in by_ticker.values() if x.get("nct_id") and x.get("cd_date")]


def _in_pre_cd_window(iso_date: str | None, cd: datetime, months: int) -> bool:
    if not iso_date:
        return False
    d = _parse_date(iso_date)
    if not d:
        return False
    start = cd - timedelta(days=months * 30)
    return start <= d <= cd


_STALE_SUMMARY_MARKERS = (
    "anthropic_api_key",
    "verifica github models / copilot o anthropic",
    "sintesi ai non disponibile",
    "dati strutturati da clinicaltrials",
    "dati da clinicaltrials.gov e pubmed",
)


def _is_stale_summary(text: str) -> bool:
    low = text.lower()
    return any(m in low for m in _STALE_SUMMARY_MARKERS)


def _digest_without_ai(extracted: dict[str, Any], *, months: int) -> str:
    parts: list[str] = []
    km = _format_outcomes_short(extracted.get("outcome_measures") or [])
    if km:
        parts.append(km)
    cites = extracted.get("citations") or []
    if cites:
        parts.append(f"Pubblicazione recente: {cites[0][:160]}")
    if not parts:
        return (
            f"Nessun nuovo esito pubblicato trovato nella finestra {months} mesi pre-CD "
            "(solo aggiornamenti registry)."
        )
    return " · ".join(parts)


def _structured_without_ai(extracted: dict[str, Any], *, months: int) -> dict[str, Any]:
    digest = _digest_without_ai(extracted, months=months)
    return {
        "outcome": "pending",
        "executive_summary": digest,
        "published_data_summary": digest,
        "primary_endpoint": None,
        "key_metrics": None,
        "safety_profile": None,
        "patient_population": None,
        "key_publications": (extracted.get("citations") or [])[:4],
        "data_gaps": "Sintesi AI non disponibile — verifica Copilot/GitHub Models.",
        "clinical_events": [],
        "clinical_indicators": _indicators_from_ctgov_extracted(extracted),
        "investment_note": None,
        "data_quality": "medium" if extracted.get("has_results") else "low",
        "_ai_skipped": True,
    }


# JSON schema fragments + extraction rules (STEP 2–4 — prompt-only, fields optional/null)
_CLINICAL_INDICATOR_JSON = """\
    {{
      "indicator_date": "YYYY-MM-DD",
      "label": "ORR | PFS (median) | SAE rate | Patients enrolled | ...",
      "kpi_type": "efficacy | safety | enrollment | regulatory | biomarker",
      "value": "42% | 8.2 mo | 12% | 48/60",
      "numeric_value": 42,
      "unit": "% | months | patients | null",
      "confidence_interval": "95% CI: 31–54% or N/D",
      "p_value": "0.003 or N/D",
      "p_value_numeric": 0.003,
      "hazard_ratio": null,
      "comparator_value_numeric": 15,
      "effect_size_delta_pp": 27,
      "confidence_interval_low": 31,
      "confidence_interval_high": 54,
      "data_maturity": "preliminary | interim | primary | final | N/D",
      "direction": "up | down | flat | unknown",
      "vs_prior_update": "improvement | stable | worsening | first_report | N/D",
      "vs_soc": "better | similar | worse | N/D",
      "n_patients": 48,
      "study_phase": "Phase 1 | Phase 2 | Phase 3",
      "endpoint_met": true,
      "source": "press_release | congress | publication | ctgov | company_site",
      "publication_venue": "ASCO 2024 | NEJM 2023 | company IR | N/D",
      "trend_note": "Breve nota IT su rilevanza clinica/investimento"
    }}"""

_STUDY_CLINICAL_PROFILE_JSON = """\
  "study_clinical_profile": {{
    "study_success": "success | failure | ongoing | unknown",
    "primary_endpoint_label": "ORR | PFS",
    "primary_endpoint_value": "42%",
    "primary_endpoint_met": true,
    "vs_standard_of_care": "ORR 42% vs SOC ~15%",
    "hr_pfs": 0.42,
    "hr_os": null,
    "fda_designation": "BreakthroughTherapy",
    "ema_designation": null,
    "blinding": "double_blind",
    "n_treatment_arm": 124,
    "n_control_arm": 121,
    "p_value_primary_numeric": 0.0003,
    "confidence_interval": "95% CI: 31–54% or N/D",
    "p_value": "0.003 or N/D",
    "secondary_endpoints_summary": "PFS 8.2mo, OS NR, DCR 78%",
    "soc_comparison_note": "e.g. ORR 42% vs SOC ~15% in 2L NSCLC",
    "patients_enrolled": null,
    "patients_target": null,
    "serious_ae_rate_pct": 12,
    "grade3_ae_rate_pct": null,
    "discontinuation_rate_pct": null,
    "deaths_on_study": null,
    "safety_summary": "Brief summary",
    "data_maturity": "interim | primary | final | not_reported"
  }}"""

_EXTRACTION_RULES_EN = """\
IMPORTANT extraction rules for new fields:
- p_value_numeric: always extract as float (0.0003, not "< 0.001"). If reported as range, use upper bound.
- hazard_ratio: extract only for time-to-event endpoints (PFS, OS, DFS). Range [0.1–2.0].
- effect_size_delta_pp: comparator arm value must come from the SAME trial, not external SOC estimates.
- fda_designation: search the DATA SUMMARY text AND company IR/press release for these exact strings:
  "Fast Track", "Breakthrough Therapy Designation", "Priority Review", "Orphan Drug".
  Return null if not found — do NOT infer.
- n_per_arm: extract from enrollment or randomization tables. Format: n_treatment_arm, n_control_arm integers.
"""

_PRE_CD_SYSTEM = (
    "You are a senior biotech investment analyst. "
    "Use the structured registry data provided below PLUS your training knowledge of published "
    "results for this company: press releases, IR updates, congress abstracts, peer-reviewed "
    "papers, ClinicalTrials.gov postings. "
    "Focus ONLY on clinical/scientific data — NOT pure financial/corporate-strategy events "
    "(those come from the SEC K-8 feed). "
    "For every event or KPI extract hard numbers (%, n, p-value, HR, months) when known. "
    "Do not invent results; mark missing data in data_gaps. "
    "Italian labels in trend_note and impact_note are preferred."
)

_PRE_CD_PROMPT = """\
Company: {company} ({ticker})
CD (Completion Date / primary readout): {cd_date}
Clinical window: {window_start} → {window_end}
Lead programs: {drug_list}

=== TASK: CLINICAL EVENT TIMELINE + KPI DASHBOARD ===

Recall from your training knowledge AND extract from the registry data below every clinical
publication, data update, or milestone for {company} in the window above.

Sources to cover (in priority order):
1. Company IR press releases with clinical data
2. Congress presentations: ASCO · ESMO · ASH · AACR · SNO · EHA · SITC · ENDO · ADA ·
   SABCS · ESMO-IO · ASCO-GI · WCLC · IDWeek (any biotech-relevant congress)
3. Peer-reviewed publications: NEJM · JCO · Lancet Oncology · Nature Medicine · JAMA ·
   Blood · CCR · Annals Oncology (any relevant journal)
4. ClinicalTrials.gov posted results or status updates
5. Company pipeline / website updates

SEC 8-K filings are in the SEC K-8 feed — include here ONLY if they announce clinical
trial results (e.g. interim readout, primary endpoint announcement).

For each event:
- event_date YYYY-MM-DD when known; estimate year-month if exact date unknown
- summary: hard numbers (ORR %, n=, p=, HR, months, enrollment fraction)
- indicators: 2–5 KPIs using the taxonomy below
- sentiment: −2 very negative → +2 very positive

KPI label taxonomy (use these exact names):
  Efficacy:    ORR · DCR · PFS (median) · OS (median) · DOR (median) · EFS · RFS · DFS ·
               pCR · CBR · ORR (biomarker+) · TTP
  Safety:      SAE rate · Grade 3-4 AE · Grade 5 (deaths) · Discontinuation rate · DLT rate
  Enrollment:  Patients enrolled · Screen failure rate
  Biomarker:   Biomarker positivity · Mutation frequency · PD-L1 TPS
  Regulatory:  FDA designation · EMA interaction · Phase advancement

""" + _EXTRACTION_RULES_EN + """
Return ONLY valid JSON:
{{
  "outcome": "positive | negative | mixed | pending | insufficient_data",
  "executive_summary": "2 sentences investor headline with key numbers",
  "clinical_indicators": [
""" + _CLINICAL_INDICATOR_JSON + """
  ],
  "clinical_events": [
    {{
      "event_date": "YYYY-MM-DD",
      "event_title": "Short title e.g. ASCO 2024 — Phase 2 interim data",
      "summary": "1–3 sentences with endpoints, n=, p=, key numbers",
      "drug": "Drug/program name",
      "source_type": "press_release | congress | publication | ctgov | company_site",
      "publication_venue": "ASCO 2024 | NEJM | company IR | N/D",
      "link": "URL or PMID or empty",
      "sentiment": 0,
      "impact_note": "breve nota IT su lettura clinica/mercato",
      "indicators": [
        {{
          "label": "ORR",
          "kpi_type": "efficacy",
          "value": "38%",
          "numeric_value": 38,
          "unit": "%",
          "confidence_interval": "N/D",
          "p_value": "N/D",
          "data_maturity": "interim",
          "direction": "up",
          "vs_soc": "N/D",
          "endpoint_met": null
        }}
      ]
    }}
  ],
""" + _STUDY_CLINICAL_PROFILE_JSON + """,
  "data_gaps": "what clinical sources were missing or not found",
  "data_quality": "high | medium | low"
}}

=== STUDIES (ClinicalTrials.gov) ===
{studies_text}

=== OUTCOMES / RESULTS (CT.gov) ===
{outcomes_text}

=== SAFETY ===
{ae_text}

=== PUBMED / PUBLICATIONS ===
{pubmed_text}

=== LINKED CITATIONS ===
{citations_text}
"""


_COPILOT_KPI_SYSTEM = (
    "You are a biotech clinical data analyst. "
    "Use the structured registry context provided below PLUS your training knowledge of "
    "published trial results, congress abstracts, and company IR press releases for this company. "
    "Answer with strict JSON only. Extract quantified KPIs from the context or your knowledge; "
    "use \"N/D\" only when genuinely not available. Do not invent numbers."
)

_COPILOT_KPI_PROMPT = (
"""\
Company: {company} ({ticker})
Completion Date (CD): {cd_date}
Window: {window_start} to {window_end}
Programs: {drug_list}

You have three tasks. Use the registry context below AND your training knowledge of {company}.

─── PART 1 — Primary study profile ─────────────────────────────────────────────
For the lead trial in the CD window above, extract:
• Primary endpoint: label, numeric result, 95% CI, p-value, met (true/false/null)
• Compare result vs. standard-of-care (SOC) benchmark if known
• Enrollment: actual vs. target patients
• Safety: SAE rate (%), grade≥3 AE (%), deaths on study, key toxicities
• Data maturity: "interim | primary | final | not_reported"

─── PART 2 — Event timeline table ──────────────────────────────────────────────
Generate a comprehensive chronological table of ALL events in the 6-month window
before the CD date involving {company} or its principal assets ({drug_list}) that
describe or affect the progress of clinical studies.

Cover ALL of the following event types — include negative and neutral events:
  • Company press releases: clinical data updates, strategy changes, leadership
  • Media coverage: Fierce Biotech, BioPharma Dive, STAT News, Reuters Health
  • Congress presentations and posters: ASCO, ESMO, ASH, AACR, SNO, EANO
  • Journal publications and preprints
  • Regulatory filings and decisions: FDA, EMA, breakthrough designation, etc.
  • Financing events that directly affect clinical program funding (raise, dilution)

For each event:
  - State which assets/trials are directly involved
  - Describe the clinical message honestly (including discontinuations, pauses,
    missed endpoints, strategic pivots away from a program)
  - Identify the milestone or KPI reached (positive, negative, or strategic)
  - Classify sentiment: "positive | negative | neutral | mixed"

KPI PRIORITY (clinical_indicators + event milestones):
  • Lead with outcome KPIs: ORR/PFS/OS/DCR, endpoint met/missed, study_success,
    congress/journal readouts with numbers, regulatory decisions.
  • Do NOT use recruitment count or RECRUITING/ACTIVE status as the primary KPI
    for publication/congress/IR events when any efficacy/safety data exists.
  • Registry enrollment/status belongs in study_clinical_profile only as context.

─── PART 3 — Related programs ──────────────────────────────────────────────────
List other trials or pipeline programs {company} is running that are mechanistically
or therapeutically related to the CD-window study (same drug other line, combination
arm, follow-on cohort, companion diagnostic). Provide summary KPIs where known.

=== REGISTRY CONTEXT (ClinicalTrials.gov — primary source) ===
{studies_text}

{outcomes_text}

{ae_text}

""" + _EXTRACTION_RULES_EN + """
Return ONLY valid JSON (no markdown fences):
{{
""" + _STUDY_CLINICAL_PROFILE_JSON + """,
  "clinical_indicators": [
""" + _CLINICAL_INDICATOR_JSON + """
  ],
  "event_timeline": [
    {{
      "event_date": "YYYY-MM-DD",
      "type": "press release | media coverage | congress | publication | regulatory | financing",
      "subject": "brief title of the event (1 line)",
      "assets_involved": ["drug name or NCT ID"],
      "key_clinical_message": "what this event says about clinical progress — be specific and honest",
      "milestones_kpis": "KPI or milestone reached/missed (positive, negative, or strategic)",
      "sentiment": "positive | negative | neutral | mixed",
      "venue": "company IR | Fierce Biotech | ASCO | NEJM | SEC 8-K | ...",
      "url_hint": "DOI / NCT / PR reference if known else null"
    }}
  ],
  "related_programs": [
    {{
      "program_name": "drug name or study ID",
      "indication": "tumor type or disease",
      "phase": "I | II | III | approved",
      "status": "recruiting | active | completed | discontinued",
      "relationship": "same drug different line | combination | follow-on cohort | companion Dx",
      "key_kpis": "ORR 55%, PFS 10.1 mo or N/D"
    }}
  ],
  "data_gaps": "brief description of what could not be found"
}}
"""
)

# Optional deep pass (manual Copilot-style) — weekly on portfolio or ?deep=1 refresh.
_DEEP_CLINICAL_SYSTEM = (
    "You are a senior biotech investment analyst performing a deep clinical diligence pass. "
    "Combine registry data below with your knowledge of press releases, congress readouts "
    "(ASCO, ESMO, ASH, AACR, ADA, WCLC, SITC, …), peer-reviewed publications, and CT.gov. "
    "Extract quantified efficacy/safety KPIs (ORR, PFS, OS, HR, p-value, n). "
    "Do not invent numbers; note gaps in data_gaps. Prefer Italian in trend_note / impact_note."
)

_DEEP_CLINICAL_PROMPT = (
"""\
Company: {company} ({ticker})
Completion Date (CD): {cd_date}
Clinical diligence window: {window_start} → {window_end}
Lead assets / programs: {drug_list}

=== DEEP CLINICAL DILIGENCE (Copilot-grade) ===

Build a complete investor timeline for {company} in the window above.

Sources (priority):
1. Company IR press releases and pipeline updates (clinical data only)
2. Congress: oral, poster, LBA — ASCO, ESMO, ASH, AACR, SNO, EHA, SITC, WCLC, ADA, …
3. Journals & preprints — emphasize **Results** section numbers (ORR, PFS, OS, DCR, HR, CI, p)
4. ClinicalTrials.gov results postings and status changes
5. SEC 8-K **only** when announcing trial results (routine 8-K are in the SEC feed)

For each clinical_events row include hard numbers when known.
KPI priority: ORR/PFS/OS/endpoint met >> enrollment-only or RECRUITING status.

""" + _EXTRACTION_RULES_EN + """
Return ONLY valid JSON (same schema as standard pre-CD enrichment):
{{
  "outcome": "positive | negative | mixed | pending | insufficient_data",
  "executive_summary": "2 sentences with key numbers",
  "clinical_indicators": [
""" + _CLINICAL_INDICATOR_JSON + """
  ],
  "clinical_events": [{{ "event_date": "YYYY-MM-DD", "event_title": "...",
    "summary": "with n=, p=, ORR/PFS/OS", "drug": "...", "source_type": "press_release | congress | publication | ctgov",
    "publication_venue": "...", "link": "URL/PMID or empty", "sentiment": 0,
    "impact_note": "IT", "indicators": [{{ "label": "ORR", "value": "38%", "numeric_value": 38, "p_value_numeric": 0.02, "kpi_type": "efficacy" }}] }}],
""" + _STUDY_CLINICAL_PROFILE_JSON + """,
  "data_gaps": "...",
  "data_quality": "high | medium | low"
}}

=== STUDIES (CT.gov) ===
{studies_text}

=== OUTCOMES / RESULTS (CT.gov) ===
{outcomes_text}

=== SAFETY ===
{ae_text}

=== PUBMED (abstracts — Results sections when present) ===
{pubmed_text}

=== CITATIONS ===
{citations_text}
"""
)


def _parse_ai_json(raw: str) -> dict[str, Any] | None:
    try:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        return json.loads(raw)
    except Exception:
        return None


def _success_direction(success: str | None) -> str:
    s = str(success or "").strip().lower()
    if s == "success":
        return "up"
    if s == "failure":
        return "down"
    if s in ("ongoing", "pending"):
        return "flat"
    return "unknown"


def _indicators_from_study_profile(ai: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Map ``study_clinical_profile`` from Copilot JSON to indicator chips."""
    if not ai or not isinstance(ai.get("study_clinical_profile"), dict):
        return []
    p = ai["study_clinical_profile"]
    success = str(p.get("study_success") or "unknown").strip().lower()
    date_ref = str(ai.get("indicator_as_of") or "")[:10] or None
    rows: list[dict[str, Any]] = []

    def _add(label: str, value: str, **kw: Any) -> None:
        row = _normalize_indicator_row({"label": label, "value": value, **kw})
        if row:
            if date_ref:
                row["indicator_date"] = date_ref
            rows.append(row)

    _add(
        "Esito studio",
        success if success != "unknown" else "N/D",
        direction=_success_direction(success),
        endpoint_met=True if success == "success" else False if success == "failure" else None,
        study_success=success,
    )
    pe_lab = str(p.get("primary_endpoint_label") or "Endpoint primario").strip()
    pe_val = str(p.get("primary_endpoint_value") or "N/D").strip()
    pe_met = p.get("primary_endpoint_met")
    _add(
        pe_lab[:80],
        pe_val,
        endpoint_met=pe_met if isinstance(pe_met, bool) else None,
        direction="up" if pe_met is True else "down" if pe_met is False else "unknown",
        numeric_value=_extract_first_number(pe_val),
        unit="%" if "%" in pe_val else None,
    )
    sec = str(p.get("secondary_endpoints_summary") or "").strip()
    if sec and sec.upper() not in ("N/D", "ND", "—"):
        _add("Endpoint secondari", sec[:48], direction="unknown")

    enr = p.get("patients_enrolled")
    tgt = p.get("patients_target")
    try:
        enr_i = int(enr) if enr is not None else None
    except (TypeError, ValueError):
        enr_i = None
    try:
        tgt_i = int(tgt) if tgt is not None else None
    except (TypeError, ValueError):
        tgt_i = None
    if enr_i is not None:
        val = f"n={enr_i}" if tgt_i is None else f"{enr_i}/{tgt_i}"
        _add(
            "Reclutamento",
            val,
            numeric_value=float(enr_i),
            n_patients=enr_i,
            direction="up" if tgt_i and enr_i >= tgt_i else "flat",
        )

    for label, key, unit in (
        ("SAE", "serious_ae_rate_pct", "%"),
        ("AE grado≥3", "grade3_ae_rate_pct", "%"),
    ):
        try:
            v = p.get(key)
            if v is None or v != v:
                continue
            fv = float(v)
            _add(label, f"{fv:g}%", numeric_value=fv, unit=unit, direction="unknown")
        except (TypeError, ValueError):
            continue

    try:
        deaths = p.get("deaths_on_study")
        if deaths is not None:
            di = int(deaths)
            _add(
                "Decessi in studio",
                f"n={di}",
                numeric_value=float(di),
                n_patients=di,
                direction="down" if di > 0 else "flat",
            )
    except (TypeError, ValueError):
        pass

    safety = str(p.get("safety_summary") or "").strip()
    if safety and safety.upper() not in ("N/D", "ND"):
        _add("Sicurezza", safety[:48], direction="unknown")

    return rows


def _indicators_from_ctgov_extracted(extracted: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Fallback KPI rows from CT.gov when Copilot returns nothing."""
    if not extracted:
        return []

    def _add(label: str, value: str, **kw: Any) -> list[dict[str, Any]]:
        row = _normalize_indicator_row({"label": label, "value": value, **kw})
        return [row] if row else []

    rows: list[dict[str, Any]] = []
    for om in (extracted.get("outcome_measures") or [])[:4]:
        if not isinstance(om, dict):
            continue
        title = str(om.get("title") or "").strip()[:60]
        vals = om.get("values") or []
        val = str(vals[0])[:48] if vals else "N/D"
        otype = str(om.get("type") or "").lower()
        label = "Endpoint primario" if "primary" in otype else (title[:48] or "Endpoint")
        reached = om.get("reached") if "reached" in om else None
        rows.extend(
            _add(
                label,
                val,
                kpi_type="efficacy",
                endpoint_met=reached if isinstance(reached, bool) else None,
                direction="up" if reached is True else "down" if reached is False else "unknown",
                source="ctgov",
            )
        )

    for ae in (extracted.get("ae_summary") or [])[:3]:
        txt = str(ae).strip()[:48]
        if txt:
            rows.extend(_add("Eventi avversi", txt, source="ctgov", kpi_type="safety", direction="unknown"))

    enr = extracted.get("enrollment")
    if enr is not None:
        try:
            ei = int(enr)
            rows.extend(
                _add(
                    "Reclutamento (CT.gov)",
                    f"n={ei}",
                    kpi_type="enrollment",
                    numeric_value=float(ei),
                    n_patients=ei,
                )
            )
        except (TypeError, ValueError):
            pass

    status = str(extracted.get("overall_status") or "").strip()
    if status:
        rows.extend(
            _add("Status studio", status[:48], kpi_type="enrollment", direction="unknown")
        )

    return _prioritize_outcome_indicators(rows)


def _merge_ai_kpi_payload(base: dict[str, Any] | None, kpi: dict[str, Any]) -> dict[str, Any]:
    out = dict(base or {})
    if kpi.get("study_clinical_profile") and not out.get("study_clinical_profile"):
        out["study_clinical_profile"] = kpi["study_clinical_profile"]
    merged_inds = list(out.get("clinical_indicators") or [])
    seen = {
        f"{i.get('label','')}|{i.get('value','')}"
        for i in merged_inds
        if isinstance(i, dict)
    }
    for raw in kpi.get("clinical_indicators") or []:
        if not isinstance(raw, dict):
            continue
        key = f"{raw.get('label','')}|{raw.get('value','')}"
        if key not in seen:
            merged_inds.append(raw)
            seen.add(key)
    out["clinical_indicators"] = merged_inds

    # Merge event_timeline (new rich schema); also accept legacy press_release_events
    tl_events = list(out.get("event_timeline") or out.get("press_release_events") or [])
    seen_tl = {
        f"{e.get('event_date','')}|{str(e.get('subject') or e.get('title',''))[:40]}"
        for e in tl_events
        if isinstance(e, dict)
    }
    for ev in (kpi.get("event_timeline") or kpi.get("press_release_events") or []):
        if not isinstance(ev, dict):
            continue
        key = f"{ev.get('event_date','')}|{str(ev.get('subject') or ev.get('title',''))[:40]}"
        if key not in seen_tl:
            tl_events.append(ev)
            seen_tl.add(key)
    if tl_events:
        out["event_timeline"] = tl_events

    rel_progs = list(out.get("related_programs") or [])
    seen_rp = {str(p.get("program_name", "")).lower() for p in rel_progs if isinstance(p, dict)}
    for prog in kpi.get("related_programs") or []:
        if not isinstance(prog, dict):
            continue
        key = str(prog.get("program_name", "")).lower()
        if key not in seen_rp:
            rel_progs.append(prog)
            seen_rp.add(key)
    if rel_progs:
        out["related_programs"] = rel_progs

    if kpi.get("data_gaps") and not out.get("data_gaps"):
        out["data_gaps"] = kpi["data_gaps"]
    out["_copilot_kpi_focus"] = True
    return out


def _call_copilot_clinical_kpi_focus(
    ctx: dict[str, Any],
    *,
    ticker: str,
    company: str,
    cd_date: str,
    window_start: str,
    window_end: str,
) -> dict[str, Any] | None:
    """Dedicated Copilot query for quantified clinical KPIs."""
    if not ai_provider.is_available():
        return None
    drugs = ctx.get("drug_tokens") or []
    prompt = _COPILOT_KPI_PROMPT.format(
        company=company,
        ticker=ticker,
        cd_date=cd_date,
        window_start=window_start,
        window_end=window_end,
        drug_list=", ".join(drugs) if drugs else "(pipeline)",
        studies_text=ctx.get("studies_text", "(none)")[:4500],
        outcomes_text=ctx.get("outcomes_text", "(none)")[:4500],
        ae_text=ctx.get("ae_text", "(none)")[:1500],
    )
    raw = ai_provider.call_ai(
        prompt,
        system=_COPILOT_KPI_SYSTEM,
        max_tokens=4000,
        task="clinical_kpi",
    )
    if not raw:
        return None
    parsed = _parse_ai_json(raw)
    if not parsed:
        print(f"[ClinicalPreCD] Copilot KPI parse error ({ticker})", flush=True)
    return parsed


def _ensure_clinical_indicators(
    ai: dict[str, Any] | None,
    extracted: dict[str, Any],
    pub_ctx: dict[str, Any],
    *,
    ticker: str,
    company: str,
    cd_date: str,
    window_start: str,
    window_end: str,
) -> dict[str, Any]:
    """Main AI + optional Copilot KPI focus + CT.gov fallback."""
    ai = dict(ai or {})
    inds = _normalize_global_indicators(ai)
    ctgov_inds = _indicators_from_ctgov_extracted(extracted)

    if ai_provider.is_available():
        kpi = _call_copilot_clinical_kpi_focus(
            pub_ctx,
            ticker=ticker,
            company=company,
            cd_date=cd_date,
            window_start=window_start,
            window_end=window_end,
        )
        if kpi:
            ai = _merge_ai_kpi_payload(ai, kpi)
            inds = _normalize_global_indicators(ai)

    inds = _dedupe_indicators(inds + ctgov_inds)
    ai["clinical_indicators"] = [{k: v for k, v in row.items()} for row in inds]
    return ai


_EFFICACY_LABEL_HINTS = (
    "ORR", "PFS", "OS ", "OVERALL SURVIVAL", "DCR", "CBR", "CRR", "RESPONSE",
    "EASI", "IGA", "PASI",
    "ENDPOINT", "HAZARD", "SURVIVAL", "EFFICACY", "ESITO STUDIO",
)


def _indicator_is_efficacy(ind: dict[str, Any]) -> bool:
    if str(ind.get("kpi_type") or "").lower() == "efficacy":
        return True
    lab = str(ind.get("label") or "").upper()
    return any(h in lab for h in _EFFICACY_LABEL_HINTS)


_CONTEXT_LABEL_RE = re.compile(
    r"reclutamento|status studio|recruiting|enrolling|screen failure|patients enrolled",
    re.IGNORECASE,
)


def _is_outcome_indicator(ind: dict[str, Any]) -> bool:
    """True for efficacy/safety/regulatory/endpoints — not bare enrollment/status."""
    if _indicator_is_efficacy(ind):
        return True
    kt = str(ind.get("kpi_type") or "").lower()
    if kt in ("efficacy", "safety", "regulatory", "biomarker"):
        return True
    if ind.get("endpoint_met") is not None:
        return True
    lab = str(ind.get("label") or "")
    if _CONTEXT_LABEL_RE.search(lab):
        return False
    return True


def _prioritize_outcome_indicators(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped = _dedupe_indicators(items)
    outcome = [i for i in deduped if _is_outcome_indicator(i)]
    context = [i for i in deduped if not _is_outcome_indicator(i)]
    return outcome + context


def _event_indicators_enrollment_only(indicators: list[dict[str, Any]] | None) -> bool:
    if not indicators:
        return True
    return not any(_indicator_is_efficacy(i) for i in indicators if isinstance(i, dict))


def _backfill_event_indicators(
    events: list[dict[str, Any]],
    global_indicators: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attach study-level **outcome** KPIs when events lack efficacy data (never enrollment-only)."""
    if not global_indicators:
        return events
    efficacy_pool = [g for g in global_indicators if _is_outcome_indicator(g)]
    out: list[dict[str, Any]] = []
    for ev in events:
        row = dict(ev)
        if str(row.get("source_type") or "").lower() == "sec_8k":
            row["indicators"] = []
            out.append(row)
            continue
        local = [i for i in (row.get("indicators") or []) if isinstance(i, dict)]
        if _event_indicators_enrollment_only(local) and efficacy_pool:
            merged = _dedupe_indicators(local + [dict(g) for g in efficacy_pool[:4]])
            row["indicators"] = _prioritize_outcome_indicators(merged)
        else:
            row["indicators"] = _prioritize_outcome_indicators(local)
        out.append(row)
    return out


def _indicators_for_eis_scoring(
    row: dict[str, Any],
    global_indicators: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Outcome KPIs for EIS — event-local only (no global KPI backfill)."""
    local = [i for i in (row.get("indicators") or []) if isinstance(i, dict)]
    return _prioritize_outcome_indicators(local)


def _drug_tokens_from_item(item: dict[str, Any], extracted: dict[str, Any]) -> list[str]:
    tokens: list[str] = []
    raw_iv = str(item.get("interventions") or extracted.get("interventions") or "")
    for part in re.split(r"[|,;/]", raw_iv):
        t = part.strip()
        if len(t) >= 3 and t.lower() not in ("placebo", "saline", "standard of care"):
            tokens.append(t)
    return tokens[:6]


def _load_study_rows_for_ticker(ticker: str) -> list[dict[str, Any]]:
    tk = ticker.strip().upper()
    return [
        r
        for r in _load_clinical_rows()
        if str(r.get("ticker", "")).strip().upper() == tk and _study_row_sponsor_ok(r)
    ]


def _format_pubmed_hits(hits: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for h in hits[:12]:
        yr = h.get("pub_year") or "?"
        pm = h.get("pmid") or ""
        title = h.get("title") or ""
        res = str(h.get("results_section") or "").strip()
        abst = str(h.get("abstract_for_ai") or h.get("abstract") or "")[:900]
        block = f"[{yr}] PMID {pm}: {title}"
        if res:
            block += f"\nRESULTS: {res[:1200]}"
        if abst:
            block += f"\n{abst}"
        lines.append(block)
    return "\n\n---\n\n".join(lines)


def _gather_multi_study_context(
    item: dict[str, Any],
    *,
    window_start: str,
    window_end: str,
) -> dict[str, Any]:
    """CT.gov + PubMed for all company studies in the pre-CD window."""
    from pubmed_eutils_fetch import search_pubmed_pre_cd_window

    ticker = item["ticker"]
    company = item.get("company") or ticker
    studies_blocks: list[str] = []
    all_outcomes: list[str] = []
    all_ae: list[str] = []
    all_citations: list[str] = []
    all_abstracts: list[str] = []
    pmids_seen: set[str] = set()
    drug_tokens: list[str] = []

    rows = _load_study_rows_for_ticker(ticker) or [item]
    for row in rows[:8]:
        nct = _parse_nct(row.get("nct_id"))
        if not nct and row.get("study_href"):
            nct = _nct_from_href(str(row.get("study_href", "")))
        if not nct:
            continue
        study = _ctgov_get(nct)
        if not study:
            continue
        ex = _extract_results(study)
        drug_tokens.extend(_drug_tokens_from_item(row, ex))
        last_up = ex.get("last_update") or row.get("last_update_posted_date")
        in_win = _in_pre_cd_window(str(last_up) if last_up else None, _parse_date(item["cd_date"]), _MONTHS_BEFORE_CD)
        block = (
            f"NCT {nct} | {ex.get('brief_title', row.get('brief_title', ''))[:120]}\n"
            f"Phase: {ex.get('phase') or row.get('phase')} | Status: {ex.get('overall_status')}\n"
            f"Conditions: {ex.get('conditions') or row.get('conditions')}\n"
            f"Interventions: {ex.get('interventions') or row.get('interventions')}\n"
            f"Last update: {last_up} | In 6m window: {in_win} | Has results: {ex.get('has_results')}"
        )
        studies_blocks.append(block)
        for om in ex.get("outcome_measures") or []:
            t = f"[{nct}] [{om.get('type', '?')}] {om.get('title', '')}"
            vals = om.get("values") or []
            if vals:
                t += f" -> {', '.join(vals[:4])}"
            all_outcomes.append(t)
        for ae in ex.get("ae_summary") or []:
            all_ae.append(f"[{nct}] {ae}")
        for c in ex.get("citations") or []:
            if c and c not in all_citations:
                all_citations.append(c)
        for p in ex.get("pmids") or []:
            if p and p not in pmids_seen:
                pmids_seen.add(str(p))

    extra = _TICKER_EXTRA_DRUGS.get(ticker.upper(), [])
    drug_tokens = list(dict.fromkeys(drug_tokens + extra))[:10]
    indication = str(item.get("conditions") or "")[:140]

    ws_dt = _parse_date(window_start)
    ext_start = (
        (ws_dt - timedelta(days=400)).strftime("%Y-%m-%d") if ws_dt else window_start
    )
    pubmed_bundle = search_pubmed_pre_cd_window(
        company=company,
        drug_tokens=drug_tokens,
        indication="",  # avoid cross-indication AND (e.g. ALS NCT vs GBM Berubicin)
        window_start=ext_start,
        window_end=window_end,
        retmax=12,
    )
    pubmed_hits = pubmed_bundle.get("hits") or []
    for h in pubmed_hits:
        pid = str(h.get("pmid") or "")
        if pid and pid not in pmids_seen:
            pmids_seen.add(pid)

    extra_pmids = list(pmids_seen)[:12]
    for p in _pubmed_search_pmids(item.get("nct_id") or ""):
        if p not in extra_pmids:
            extra_pmids.append(p)
    try:
        from pubmed_eutils_fetch import _efetch_pubmed_articles

        extra_hits = _efetch_pubmed_articles(extra_pmids[:8])
        all_abstracts = [
            str(h.get("abstract_for_ai") or h.get("abstract") or "").strip()
            for h in extra_hits
            if h.get("abstract") or h.get("abstract_for_ai")
        ]
        for h in extra_hits:
            pid = str(h.get("pmid") or "")
            if pid and not any(str(x.get("pmid")) == pid for x in pubmed_hits):
                pubmed_hits.append(h)
    except Exception:
        all_abstracts = _pubmed_fetch_abstracts(extra_pmids[:8])
    pubmed_text = _format_pubmed_hits(pubmed_hits)
    if all_abstracts:
        pubmed_text = (pubmed_text + "\n\n---\n\n" + "\n\n---\n\n".join(all_abstracts))[:6000]

    if extra:
        studies_blocks.insert(
            0,
            f"Additional programs to search (company pipeline, may differ from simulation NCT): {', '.join(extra)}",
        )

    return {
        "studies_text": "\n\n".join(studies_blocks)[:5000] or "(no studies)",
        "outcomes_text": "\n".join(all_outcomes)[:5000],
        "ae_text": "\n".join(all_ae)[:2000],
        "citations_text": "\n".join(all_citations)[:1500] or "(none)",
        "pubmed_text": pubmed_text[:6000] or "(none)",
        "pubmed_queries": pubmed_bundle.get("queries") or [],
        "drug_tokens": drug_tokens,
        "pubmed_hit_count": len(pubmed_hits),
        "pubmed_hits": pubmed_hits,
    }


def _reconcile_kpi_sec8k_against_filings(
    clinical: list[dict[str, Any]],
    sec_events: list[dict[str, Any]],
    *,
    max_align_days: int = 3,
    max_lookup_days: int = 10,
) -> list[dict[str, Any]]:
    """
    Timeline Intelligence sometimes tags press/IR as sec_8k with a guessed date.
    Only keep K-8 badge when event_date matches a real SEC K-8 row (±max_align_days),
    or snap to the nearest filing and inherit EDGAR link/prices.
    """
    if not sec_events:
        return clinical

    filings: list[tuple[datetime, dict[str, Any]]] = []
    for ev in sec_events:
        ed = _parse_date(ev.get("event_date"))
        if ed:
            filings.append((ed, ev))

    if not filings:
        return clinical

    out: list[dict[str, Any]] = []
    for ev in clinical:
        row = dict(ev)
        if not row.get("_from_kpi_timeline"):
            out.append(row)
            continue
        if str(row.get("source_type") or "").lower() != "sec_8k":
            out.append(row)
            continue

        ed = _parse_date(row.get("event_date"))
        if not ed:
            row["source_type"] = "press_release"
            row["impact_note"] = _append_impact_note(
                row.get("impact_note"),
                "AI date missing — not matched to SEC filing",
            )
            out.append(row)
            continue

        nearest: tuple[datetime, dict[str, Any]] | None = None
        best_days = max_lookup_days + 1
        for fd, sec in filings:
            delta = abs((fd - ed).days)
            if delta < best_days:
                best_days = delta
                nearest = (fd, sec)

        if nearest is None or best_days > max_lookup_days:
            row["source_type"] = "press_release"
            row["impact_note"] = _append_impact_note(
                row.get("impact_note"),
                "no SEC 8-K on this date (AI timeline)",
            )
            out.append(row)
            continue

        if best_days <= max_align_days:
            fd, sec = nearest
            row["event_date"] = fd.strftime("%Y-%m-%d")
            row["sec_filing_verified"] = True
            if sec.get("link"):
                row["link"] = sec["link"]
                row["link_label"] = sec.get("link_label") or "SEC EDGAR"
            if sec.get("price"):
                row["price"] = dict(sec["price"])
            if sec.get("eis"):
                row["eis"] = sec["eis"]
            if sec.get("summary"):
                row["summary"] = sec["summary"]
            row["impact_note"] = _append_impact_note(
                row.get("impact_note"),
                f"date aligned to SEC filing {row['event_date']}",
            )
            out.append(row)
            continue

        row["source_type"] = "press_release"
        row["impact_note"] = _append_impact_note(
            row.get("impact_note"),
            f"nearest SEC 8-K {nearest[0].strftime('%Y-%m-%d')} ({best_days}d away)",
        )
        out.append(row)

    return out


def _append_impact_note(note: Any, extra: str) -> str:
    base = str(note or "").strip()
    return f"{base} · {extra}" if base else extra


def _merge_clinical_and_sec_events(
    clinical: list[dict[str, Any]],
    sec_events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Unified chronological feed: AI clinical rows + SEC 8-K rows."""
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []

    def _key(ev: dict[str, Any]) -> str:
        return f"{ev.get('event_date')}|{ev.get('source_type')}|{ev.get('event_title')}"

    for ev in clinical + sec_events:
        k = _key(ev)
        if k in seen:
            continue
        seen.add(k)
        merged.append(ev)

    merged.sort(key=lambda e: e.get("event_date") or "")
    return merged


_COMPANY_SUFFIX = frozenset(
    {
        "inc", "inc.", "llc", "ltd", "limited", "corp", "corporation", "company",
        "co", "co.", "plc", "sa", "nv", "ag", "gmbh", "the", "and", "of",
    }
)
_GENERIC_DRUG = frozenset({"corporate", "—", "-", "n/a", "na", "none"})


def _study_row_sponsor_ok(row: dict[str, Any]) -> bool:
    """Exact/Partial sponsor match only — blocks wrong-ticker clinical rows (e.g. VERA noise)."""
    return is_study_sponsor_trusted(row)


def _company_search_terms(company: str, ticker: str) -> list[str]:
    terms: list[str] = []
    tk = str(ticker or "").strip().upper()
    if len(tk) >= 2:
        terms.append(tk.lower())
    raw = str(company or "").strip()
    if raw:
        cleaned = re.sub(r"[,.()]+", " ", raw.lower())
        words = [w for w in cleaned.split() if w and w not in _COMPANY_SUFFIX]
        if len(words) >= 2:
            terms.append(" ".join(words[:4]))
        for w in words:
            if len(w) >= 4:
                terms.append(w)
    return list(dict.fromkeys(terms))


def _drug_search_terms(drug_tokens: list[str], event_drug: str | None) -> list[str]:
    terms: list[str] = []
    for raw in drug_tokens or []:
        t = str(raw or "").strip()
        if len(t) < 3 or t.lower() in _GENERIC_DRUG:
            continue
        terms.append(t.lower())
        compact = re.sub(r"[\s\-_]+", "", t.lower())
        if len(compact) >= 3:
            terms.append(compact)
    d = str(event_drug or "").strip()
    if d and d.lower() not in _GENERIC_DRUG and len(d) >= 3:
        terms.append(d.lower())
        compact = re.sub(r"[\s\-_]+", "", d.lower())
        if len(compact) >= 3:
            terms.append(compact)
    return list(dict.fromkeys(terms))


def _event_reference_text(ev: dict[str, Any]) -> str:
    parts = [
        ev.get("event_title"),
        ev.get("summary"),
        ev.get("impact_note"),
    ]
    return " ".join(str(p) for p in parts if p).lower()


def _text_mentions_term(text: str, term: str) -> bool:
    if not text or not term:
        return False
    tl = term.lower()
    if len(tl) <= 5:
        return bool(re.search(rf"\b{re.escape(tl)}\b", text, flags=re.I))
    if tl in text:
        return True
    return bool(re.search(rf"\b{re.escape(tl)}\b", text, flags=re.I))


def verify_event_reference(
    ev: dict[str, Any],
    *,
    company: str,
    ticker: str,
    drug_tokens: list[str] | None = None,
    expected_nct_id: str | None = None,
) -> tuple[bool, str | None]:
    """True se titolo/summary citano società/farmaco/NCT atteso (gate EIS feed)."""
    return verify_event_reference_strict(
        ev,
        company=company,
        ticker=ticker,
        drug_tokens=drug_tokens,
        expected_nct_id=expected_nct_id,
        company_search_terms_fn=_company_search_terms,
        drug_search_terms_fn=_drug_search_terms,
    )


def annotate_events_reference_verification(
    events: list[dict[str, Any]],
    *,
    company: str,
    ticker: str,
    drug_tokens: list[str] | None = None,
    expected_nct_id: str | None = None,
) -> list[dict[str, Any]]:
    """Imposta ``reference_verified`` e ``reference_match`` su ogni evento."""
    out: list[dict[str, Any]] = []
    for ev in events:
        row = dict(ev)
        ok, match = verify_event_reference(
            row,
            company=company,
            ticker=ticker,
            drug_tokens=drug_tokens,
            expected_nct_id=expected_nct_id,
        )
        row["reference_verified"] = bool(ok)
        row["reference_match"] = match
        out.append(row)
    return out


def _normalize_event_row(ev: dict[str, Any]) -> dict[str, Any]:
    row = dict(ev)
    drug = (row.get("drug") or row.get("asset") or "—").strip() or "—"
    row["drug"] = drug
    row["asset"] = drug
    if not row.get("link_label") and row.get("source_type") == "sec_8k":
        row["link_label"] = "SEC EDGAR"
    elif not row.get("link_label") and row.get("source_type") == "publication":
        row["link_label"] = "PubMed"
    return row


def _enrich_clinical_events_market(
    ticker: str,
    events: list[dict[str, Any]],
    *,
    vol_cache: dict[str, float | None],
    global_indicators: list[dict[str, Any]] | None = None,
    skip_yfinance: bool = False,
) -> list[dict[str, Any]]:
    """Attach yfinance T/T+1/T+3 and EIS to each clinical event."""
    from prediction.event_impact_score import compute_eis, kpi_intrinsic_score

    out: list[dict[str, Any]] = []
    for ev in events:
        row = _normalize_event_row(ev)
        ed = _parse_date(row.get("event_date"))
        if not ed:
            row["price"] = {
                "p_t0": None,
                "p_t1": None,
                "p_t3": None,
                "p_t7": None,
                "delta_p_1d": None,
                "delta_p_3d": None,
                "delta_p_7d": None,
            }
            row["eis"] = None
            out.append(row)
            continue

        d1 = d3 = d7 = None
        p0 = p1 = p3 = p7 = None
        vol_ratio = None
        if not skip_yfinance:
            bars = _yf_close_bars(ticker, ed - timedelta(days=60), ed + timedelta(days=21))
            p0, after = _close_before_and_after_sessions(bars, ed, n_after=5)
            p1 = after[0] if len(after) > 0 else None
            p3 = after[2] if len(after) > 2 else None
            p7 = after[4] if len(after) > 4 else (after[-1] if after else None)
            d1 = _pct(p0, p1)
            d3 = _pct(p0, p3)
            d7 = _pct(p0, p7)
            iso = ed.strftime("%Y-%m-%d")
            vk = f"{ticker}|{iso}"
            if vk not in vol_cache:
                vol_cache[vk] = _volume_ratio_t1(ticker, ed)
            vol_ratio = vol_cache.get(vk)
        try:
            sent = float(row.get("sentiment", 0))
        except (TypeError, ValueError):
            sent = 0.0
        ind_for_eis = _indicators_for_eis_scoring(row, global_indicators)
        kpi_sc = kpi_intrinsic_score(ind_for_eis) if ind_for_eis else None
        eis = compute_eis(
            delta_p_1d=d1,
            delta_p_3d=d3,
            vol_ratio=vol_ratio,
            sentiment=sent,
            kpi_score=kpi_sc,
        )
        row["price"] = {
            "p_t0": round(p0, 4) if p0 else None,
            "p_t1": round(p1, 4) if p1 else None,
            "p_t3": round(p3, 4) if p3 else None,
            "p_t7": round(p7, 4) if p7 else None,
            "delta_p_1d": d1,
            "delta_p_3d": d3,
            "delta_p_7d": d7,
        }
        row["eis"] = eis
        out.append(row)

    out.sort(key=lambda e: e.get("event_date") or "")
    return out


def refresh_clinical_event_market_prices(
    *,
    portfolio_only: bool = True,
) -> dict[str, Any]:
    """Re-attach yfinance T+1/T+7 prices on existing clinical events (no AI).

    Used by the Model Lab weekday 16:30 refresh together with RA/SDS accuracy.
    """
    snap = load_snapshot()
    records = list(snap.get("records") or [])
    if not records:
        return {"records_updated": 0, "events_with_price_1d": 0, "events_with_price_7d": 0}

    portfolio = _portfolio_ticker_set() if portfolio_only else None
    vol_cache: dict[str, float | None] = {}
    prev_by_key = {_record_merge_key(r): r for r in records if isinstance(r, dict)}
    updated_records = 0
    events_with_d1 = 0
    events_with_d7 = 0

    for rec in records:
        if not isinstance(rec, dict):
            continue
        ticker = str(rec.get("ticker") or "").upper()
        if portfolio and ticker not in portfolio:
            continue
        events = list(rec.get("clinical_events") or rec.get("timeline_events") or [])
        if not events:
            continue
        enriched = _enrich_clinical_events_market(
            ticker,
            events,
            vol_cache=vol_cache,
            skip_yfinance=False,
        )
        rec["clinical_events"] = enriched
        if "timeline_events" in rec:
            rec["timeline_events"] = enriched
        updated_records += 1
        for ev in enriched:
            if not isinstance(ev, dict):
                continue
            pr = ev.get("price") if isinstance(ev.get("price"), dict) else {}
            if pr.get("delta_p_1d") is not None:
                events_with_d1 += 1
            if pr.get("delta_p_7d") is not None:
                events_with_d7 += 1

    if updated_records:
        _persist_snapshot_draft(records, prev_by_key, partial=False)

    return {
        "records_updated": updated_records,
        "events_with_price_1d": events_with_d1,
        "events_with_price_7d": events_with_d7,
    }


def _fallback_clinical_events_from_pubmed(
    pubmed_hits: list[dict[str, Any]],
    *,
    window_start: str,
    window_end: str,
) -> list[dict[str, Any]]:
    ws, we = _parse_date(window_start), _parse_date(window_end)
    out: list[dict[str, Any]] = []
    for h in pubmed_hits[:8]:
        yr = str(h.get("pub_year") or "")
        if len(yr) == 4:
            ed = _parse_date(f"{yr}-06-15")
        else:
            ed = None
        if ed and ws and we and not (ws <= ed <= we):
            continue
        title = str(h.get("title") or "PubMed publication")
        pmid = h.get("pmid") or ""
        out.append(
            {
                "event_date": ed.strftime("%Y-%m-%d") if ed else None,
                "event_title": title[:120],
                "summary": str(h.get("abstract") or "")[:400],
                "drug": "—",
                "asset": "—",
                "source_type": "publication",
                "link_label": "PubMed",
                "link": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
                "sentiment": 0,
                "impact_note": "Da PubMed",
            }
        )
    return out


def _call_pre_cd_ai(
    ctx: dict[str, Any],
    *,
    ticker: str,
    company: str,
    cd_date: str,
    window_start: str,
    window_end: str,
) -> dict[str, Any] | None:
    if not ai_provider.is_available():
        return None
    drugs = ctx.get("drug_tokens") or []
    prompt = _PRE_CD_PROMPT.format(
        company=company,
        ticker=ticker,
        cd_date=cd_date,
        window_start=window_start,
        window_end=window_end,
        drug_list=", ".join(drugs) if drugs else "(all pipeline programs)",
        studies_text=ctx.get("studies_text", "(none)")[:3500],
        outcomes_text=ctx.get("outcomes_text", "(none)")[:3000],
        ae_text=ctx.get("ae_text", "(none)")[:800],
        pubmed_text=ctx.get("pubmed_text", "(none)")[:6000],
        citations_text=ctx.get("citations_text", "(none)")[:1500],
    )
    raw = ai_provider.call_ai(prompt, system=_PRE_CD_SYSTEM, max_tokens=4800, task="summary")
    if not raw:
        return None
    parsed = _parse_ai_json(raw)
    if not parsed:
        print(f"[ClinicalPreCD] AI parse error ({ticker})", flush=True)
    return parsed


def _call_deep_clinical_ai(
    ctx: dict[str, Any],
    *,
    ticker: str,
    company: str,
    cd_date: str,
    window_start: str,
    window_end: str,
) -> dict[str, Any] | None:
    """Copilot-grade deep pass — press releases, congress, publications + KPIs."""
    if not ai_provider.is_available():
        return None
    drugs = ctx.get("drug_tokens") or []
    prompt = _DEEP_CLINICAL_PROMPT.format(
        company=company,
        ticker=ticker,
        cd_date=cd_date,
        window_start=window_start,
        window_end=window_end,
        drug_list=", ".join(drugs) if drugs else "(all pipeline programs)",
        studies_text=ctx.get("studies_text", "(none)")[:4500],
        outcomes_text=ctx.get("outcomes_text", "(none)")[:4500],
        ae_text=ctx.get("ae_text", "(none)")[:1500],
        pubmed_text=ctx.get("pubmed_text", "(none)")[:6000],
        citations_text=ctx.get("citations_text", "(none)")[:1500],
    )
    raw = ai_provider.call_ai(
        prompt,
        system=_DEEP_CLINICAL_SYSTEM,
        max_tokens=6000,
        task="deep_clinical",
    )
    if not raw:
        return None
    parsed = _parse_ai_json(raw)
    if not parsed:
        print(f"[ClinicalPreCD] Deep clinical parse error ({ticker})", flush=True)
    return parsed


def _format_outcomes_short(measures: list[dict[str, Any]]) -> str | None:
    parts: list[str] = []
    for om in measures[:4]:
        title = om.get("title", "")
        vals = om.get("values") or []
        if title and vals:
            parts.append(f"{title}: {vals[0]}")
        elif title:
            parts.append(title)
    return " | ".join(parts) if parts else None


def _extract_first_number(text: str) -> float | None:
    m = re.search(r"[-+]?\d+(?:\.\d+)?", text or "")
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _indicator_value_display(raw: dict[str, Any], nv: float | None) -> str:
    value = str(raw.get("value") or "").strip()[:48]
    if value and value.upper() not in ("", "N/D", "ND", "—", "-"):
        return value
    if nv is not None and nv == nv:
        unit = str(raw.get("unit") or "").strip()
        if unit == "%":
            return f"{nv:g}%"
        if unit:
            return f"{nv:g} {unit}"
        return str(nv)
    ss = raw.get("study_success")
    if ss:
        return str(ss)[:48]
    return "N/D"


def _coerce_optional_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _normalize_indicator_row(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get("label") or raw.get("name") or "").strip()[:80]
    if not label:
        return None
    nv = raw.get("numeric_value")
    if nv is None:
        nv = _extract_first_number(str(raw.get("value") or ""))
    else:
        try:
            nv = float(nv)
        except (TypeError, ValueError):
            nv = _extract_first_number(str(raw.get("value") or ""))
    value = _indicator_value_display(raw, nv)
    if not value or value.upper() in ("", "ND"):
        return None
    direction = str(raw.get("direction") or "unknown").strip().lower()
    if direction not in ("up", "down", "flat", "unknown"):
        direction = "unknown"
    n_pat = raw.get("n_patients")
    try:
        n_pat = int(n_pat) if n_pat is not None else None
    except (TypeError, ValueError):
        n_pat = None
    ep = raw.get("endpoint_met")
    if ep is not None and not isinstance(ep, bool):
        ep = str(ep).strip().lower() in ("1", "true", "yes", "si", "sì")
    row: dict[str, Any] = {
        "label": label,
        "value": value,
        "numeric_value": nv,
        "unit": (str(raw.get("unit")).strip()[:16] if raw.get("unit") else None),
        "direction": direction,
        "endpoint_met": ep,
    }
    if n_pat is not None:
        row["n_patients"] = n_pat
    if raw.get("study_phase"):
        row["study_phase"] = str(raw.get("study_phase"))[:24]
    if raw.get("source"):
        row["source"] = str(raw.get("source"))[:32]
    if raw.get("trend_note"):
        row["trend_note"] = str(raw.get("trend_note"))[:120]
    if raw.get("indicator_date") or raw.get("event_date"):
        row["indicator_date"] = str(raw.get("indicator_date") or raw.get("event_date"))[:10]
    for _f in ("kpi_type", "confidence_interval", "p_value", "data_maturity",
               "vs_soc", "vs_prior_update", "publication_venue"):
        v = raw.get(_f)
        if v is not None and str(v).strip().lower() not in ("", "null", "n/d"):
            row[_f] = str(v)[:200]
    for _nf in (
        "p_value_numeric",
        "hazard_ratio",
        "comparator_value_numeric",
        "effect_size_delta_pp",
        "confidence_interval_low",
        "confidence_interval_high",
    ):
        fv = _coerce_optional_float(raw.get(_nf))
        if fv is not None:
            row[_nf] = fv
    if row.get("effect_size_delta_pp") is None:
        nv_f = row.get("numeric_value")
        comp = row.get("comparator_value_numeric")
        if isinstance(nv_f, (int, float)) and isinstance(comp, (int, float)):
            row["effect_size_delta_pp"] = round(float(nv_f) - float(comp), 3)
    return row


def _dedupe_indicators(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for ind in items:
        key = f"{ind.get('label','').lower()}|{ind.get('value','')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(ind)
    return out


def _normalize_global_indicators(ai: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not ai:
        return []
    out: list[dict[str, Any]] = []
    for raw in ai.get("clinical_indicators") or []:
        row = _normalize_indicator_row(raw if isinstance(raw, dict) else None)
        if row:
            out.append(row)
    out.extend(_indicators_from_study_profile(ai))
    return _prioritize_outcome_indicators(_dedupe_indicators(out))


_SENTIMENT_MAP = {"positive": 1, "negative": -1, "mixed": 0, "neutral": 0}

_TYPE_TO_SOURCE: dict[str, str] = {
    "press release": "publication",
    "media coverage": "publication",
    "congress": "congress",
    "publication": "publication",
    "regulatory": "publication",
    "financing": "publication",
}

_MILESTONE_KPI_RE = re.compile(
    r"\b(ORR|Objective Response|CRR|CBR|DCR|pCR|mPFS|PFS|OS|Overall Survival|"
    r"HR|Hazard Ratio|DoR|Duration of [Rr]esponse)\s*[:=]?\s*"
    r"([\d.]+\s*%?|[\d.]+\s*(?:months?|mo|years?|yr))",
    re.IGNORECASE,
)


def _indicators_from_milestones_text(
    text: str,
    *,
    event_date: str | None = None,
) -> list[dict[str, Any]]:
    """Parse quantifiable KPIs embedded in Copilot milestones_kpis strings."""
    if not text or not str(text).strip():
        return []
    out: list[dict[str, Any]] = []
    for m in _MILESTONE_KPI_RE.finditer(str(text)):
        label = m.group(1).strip()
        val = m.group(2).strip()
        raw: dict[str, Any] = {
            "label": label.upper() if len(label) <= 5 else label.title(),
            "value": val,
            "kpi_type": "efficacy",
            "direction": "unknown",
            "source": "milestone",
        }
        if event_date:
            raw["indicator_date"] = event_date[:10]
        norm = _normalize_indicator_row(raw)
        if norm:
            out.append(norm)
    return _dedupe_indicators(out)


def _kpi_press_releases_to_events(
    pr_events: list[dict[str, Any]],
    *,
    window_start: str,
    window_end: str,
) -> list[dict[str, Any]]:
    """Convert event_timeline (or legacy press_release_events) to clinical event dicts."""
    ws, we = _parse_date(window_start), _parse_date(window_end)
    out: list[dict[str, Any]] = []
    for ev in pr_events:
        if not isinstance(ev, dict):
            continue
        ed = _parse_date(ev.get("event_date"))
        if ws and we and ed and not (ws <= ed <= we):
            continue
        venue = str(ev.get("venue") or "").strip()[:80]
        # Support both new schema (subject/key_clinical_message) and legacy (title/key_finding)
        title = str(ev.get("subject") or ev.get("title") or "").strip()[:120] or venue or "Event"
        summary = str(
            ev.get("key_clinical_message") or ev.get("key_finding") or ""
        ).strip()[:600]
        milestones = str(ev.get("milestones_kpis") or "").strip()[:300]
        if milestones:
            summary = f"{summary}\n{milestones}".strip() if summary else milestones
        url_hint = str(ev.get("url_hint") or "").strip()[:200] or None
        ev_type = str(ev.get("type") or "").strip().lower()
        venue_up = venue.upper()
        if "8-K" in venue_up or "SEC" in venue_up or ev_type == "financing":
            source_type = "sec_8k"
        elif any(k in venue_up for k in ("ASCO", "ESMO", "ASH", "AACR", "SNO", "EANO", "CONGRESS", "POSTER")):
            source_type = "congress"
        elif "press" in ev_type or ev_type in ("press release", "media coverage"):
            source_type = "press_release"
        else:
            source_type = _TYPE_TO_SOURCE.get(ev_type, "publication")
        assets = ev.get("assets_involved")
        drug = (
            str(assets[0]).strip()[:80]
            if isinstance(assets, list) and assets
            else "—"
        )
        sentiment_num = _SENTIMENT_MAP.get(str(ev.get("sentiment") or "neutral").lower(), 0)
        iso = ed.strftime("%Y-%m-%d") if ed else str(ev.get("event_date") or "")[:10]
        milestone_inds = _indicators_from_milestones_text(milestones, event_date=iso or None)
        row: dict[str, Any] = {
            "event_date": iso or ev.get("event_date"),
            "event_title": title,
            "summary": summary,
            "drug": drug,
            "asset": drug,
            "source_type": source_type,
            "link_label": venue or ev_type.title() or "Publication",
            "link": url_hint or "",
            "sentiment": sentiment_num,
            "impact_note": f"{ev_type.title()}: {venue}" if venue and ev_type else (venue or ev_type.title() or "KPI"),
            "_from_kpi_timeline": True,
        }
        if milestone_inds:
            row["indicators"] = milestone_inds
        out.append(row)
    return out


def _attach_indicators_to_events(
    events: list[dict[str, Any]],
    global_indicators: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge per-event indicators + global KPIs matched by date."""
    by_date: dict[str, list[dict[str, Any]]] = {}
    for g in global_indicators:
        d = str(g.get("indicator_date") or "")[:10]
        if d:
            by_date.setdefault(d, []).append(g)

    out: list[dict[str, Any]] = []
    for ev in events:
        row = dict(ev)
        local: list[dict[str, Any]] = []
        for raw in row.get("indicators") or []:
            norm = _normalize_indicator_row(raw if isinstance(raw, dict) else None)
            if norm:
                local.append(norm)
        ed = str(row.get("event_date") or "")[:10]
        if ed and ed in by_date:
            local.extend(by_date[ed])
        row["indicators"] = _dedupe_indicators(local)
        out.append(row)
    return out


def _build_structured_report(extracted: dict[str, Any], ai: dict[str, Any] | None) -> dict[str, Any]:
    measures = extracted.get("outcome_measures") or []
    endpoint_summary: list[dict[str, Any]] = []
    plot_points: list[dict[str, Any]] = []
    reached = 0
    failed = 0

    for om in measures[:8]:
        title = str(om.get("title") or "").strip()
        values = [str(v) for v in (om.get("values") or []) if str(v).strip()]
        row = {
            "type": om.get("type") or "",
            "title": title,
            "values": values[:3],
        }
        txt = " ".join(values).lower()
        if "p<" in txt or "p <" in txt or "met" in txt:
            row["reached"] = True
            reached += 1
        elif "ns" in txt or "not significant" in txt or "miss" in txt:
            row["reached"] = False
            failed += 1
        endpoint_summary.append(row)

        if values:
            num = _extract_first_number(values[0])
            if num is not None:
                plot_points.append(
                    {
                        "label": (title[:28] + "…") if len(title) > 29 else (title or f"Endpoint {len(plot_points)+1}"),
                        "value": num,
                    }
                )

    treated_patients = extracted.get("enrollment")
    safety_issues = list(extracted.get("ae_summary") or [])[:5]
    if ai and ai.get("safety_profile") and not safety_issues:
        safety_issues = [str(ai.get("safety_profile"))]

    return {
        "endpoint_summary": endpoint_summary[:6],
        "endpoint_reached": reached,
        "endpoint_failed": failed,
        "treated_patients": treated_patients,
        "safety_issues": safety_issues,
        "plot_points": plot_points[:6],
    }


def _enrich_one(
    item: dict[str, Any],
    *,
    deep: bool = False,
    skip_ai: bool = False,
    skip_yfinance: bool = False,
    skip_press: bool = False,
) -> dict[str, Any]:
    nct_id = item["nct_id"]
    cd = _parse_date(item["cd_date"])
    assert cd is not None
    window_start = (cd - timedelta(days=_MONTHS_BEFORE_CD * 30)).strftime("%Y-%m-%d")
    window_end = item["cd_date"]

    study = _ctgov_get(nct_id)
    if not study:
        return {
            **item,
            "error": f"CT.gov non disponibile per {nct_id}",
            "window_start": window_start,
            "window_end": window_end,
        }

    extracted = _extract_results(study)
    pmids = list(extracted.pop("pmids", []) or [])
    extra_pmids = _pubmed_search_pmids(nct_id)
    for p in extra_pmids:
        if p not in pmids:
            pmids.append(p)
    abstracts = _pubmed_fetch_abstracts(pmids[:5])
    citations = extracted.get("citations") or []

    sources: list[dict[str, str]] = [
        {"type": "clinicaltrials.gov", "label": "ClinicalTrials.gov study record", "ref": nct_id},
    ]
    for i, c in enumerate(citations[:5]):
        if c:
            sources.append({"type": "publication", "label": c[:120], "ref": ""})
    for pmid in pmids[:5]:
        sources.append({
            "type": "pubmed",
            "label": f"PubMed PMID {pmid}",
            "ref": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        })

    last_up = extracted.get("last_update") or item.get("last_update")
    in_window = _in_pre_cd_window(str(last_up) if last_up else None, cd, _MONTHS_BEFORE_CD)

    extracted["pubmed_abstracts"] = abstracts
    extracted["pubmed_pmids"] = pmids

    pub_ctx = _gather_multi_study_context(
        item, window_start=window_start, window_end=window_end
    )

    ai: dict[str, Any] | None = None
    if skip_ai or not ai_provider.is_available():
        ai = _structured_without_ai(extracted, months=_MONTHS_BEFORE_CD)
    else:
        ai = _call_pre_cd_ai(
            pub_ctx,
            ticker=item["ticker"],
            company=item["company"],
            cd_date=item["cd_date"],
            window_start=window_start,
            window_end=window_end,
        ) or _structured_without_ai(extracted, months=_MONTHS_BEFORE_CD)

    ai = _ensure_clinical_indicators(
        ai,
        extracted,
        pub_ctx,
        ticker=item["ticker"],
        company=str(item.get("company") or item["ticker"]),
        cd_date=item["cd_date"],
        window_start=window_start,
        window_end=window_end,
    )

    if deep and not skip_ai and ai_provider.is_available():
        deep_ai = _call_deep_clinical_ai(
            pub_ctx,
            ticker=item["ticker"],
            company=str(item.get("company") or item["ticker"]),
            cd_date=item["cd_date"],
            window_start=window_start,
            window_end=window_end,
        )
        if deep_ai:
            ai = _merge_ai_kpi_payload(ai or {}, deep_ai)
            kpi_extras = _kpi_press_releases_to_events(
                deep_ai.get("event_timeline") or deep_ai.get("clinical_events") or [],
                window_start=window_start,
                window_end=window_end,
            )
            if kpi_extras and ai:
                existing = list(ai.get("clinical_events") or [])
                keys = {
                    f"{e.get('event_date','')}|{str(e.get('event_title',''))[:40]}"
                    for e in existing
                }
                for ev in kpi_extras:
                    k = f"{ev.get('event_date','')}|{str(ev.get('event_title',''))[:40]}"
                    if k not in keys:
                        existing.append(ev)
                        keys.add(k)
                ai["clinical_events"] = existing

    summary = str(ai.get("published_data_summary") or ai.get("executive_summary") or "") if ai else ""
    structured = _build_structured_report(extracted, ai)

    # ── Stock reaction: +1/+2/+3 sessions after last public update ───────────
    pub_dt = _parse_date(last_up) if last_up else None
    stock_reaction: dict[str, Any] = {"pub_date": _fmt_iso(pub_dt), "d1": None, "d2": None, "d3": None}
    if pub_dt:
        bars = _yf_close_bars(item["ticker"], pub_dt - timedelta(days=45), pub_dt + timedelta(days=14))
        p0, p1, p2, p3 = _close_before_and_three_after(bars, pub_dt)
        stock_reaction = {
            "pub_date": _fmt_iso(pub_dt),
            "d1": _pct(p0, p1),
            "d2": _pct(p0, p2),
            "d3": _pct(p0, p3),
        }

    raw_events = list(ai.get("clinical_events") or []) if ai else []
    if not raw_events:
        raw_events = _fallback_clinical_events_from_pubmed(
            pub_ctx.get("pubmed_hits") or [],
            window_start=window_start,
            window_end=window_end,
        )

    # Inject event_timeline (or legacy press_release_events) from KPI call
    if ai:
        pr_extras = _kpi_press_releases_to_events(
            ai.get("event_timeline") or ai.get("press_release_events") or [],
            window_start=window_start,
            window_end=window_end,
        )
        existing_keys = {
            f"{e.get('event_date','')}|{str(e.get('event_title',''))[:40]}"
            for e in raw_events
        }
        for ev in pr_extras:
            key = f"{ev.get('event_date','')}|{str(ev.get('event_title',''))[:40]}"
            if key not in existing_keys:
                raw_events.append(ev)
                existing_keys.add(key)

    global_indicators = _normalize_global_indicators(ai)
    raw_events = _attach_indicators_to_events(raw_events, global_indicators)
    raw_events = _backfill_event_indicators(raw_events, global_indicators)

    company_str = str(item.get("company") or item["ticker"])
    drug_tokens = pub_ctx.get("drug_tokens") or _drug_tokens_from_item(item, extracted)
    raw_events = annotate_events_reference_verification(
        raw_events,
        company=company_str,
        ticker=item["ticker"],
        drug_tokens=drug_tokens,
        expected_nct_id=nct_id,
    )
    raw_events = _filter_verified_feed_events(raw_events)

    vol_cache: dict[str, float | None] = {}
    clinical_only = _enrich_clinical_events_market(
        item["ticker"],
        raw_events,
        vol_cache=vol_cache,
        global_indicators=global_indicators,
        skip_yfinance=skip_yfinance,
    )

    drug_label = None
    if item.get("interventions"):
        drug_label = str(item["interventions"]).split("|")[0].strip()[:80]

    press_events: list[dict[str, Any]] = []
    if not skip_press and not os.environ.get("PRESS_RELEASE_DISABLE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        try:
            from press_release_fetch import (
                fetch_press_releases_for_window,
                press_releases_to_clinical_events,
            )

            pr_items = fetch_press_releases_for_window(
                item["ticker"],
                str(item.get("company") or item["ticker"]),
                window_start=window_start,
                window_end=window_end,
                max_items=6,
            )
            press_events = press_releases_to_clinical_events(
                pr_items,
                drug=drug_label,
            )
        except Exception as exc:
            print(f"[ClinicalPreCD] Press fetch skip ({item['ticker']}): {exc}", flush=True)

    sec_events = _timeline_events_from_sec_k8(
        item["ticker"],
        window_start=window_start,
        window_end=window_end,
        drug=drug_label,
        vol_cache=vol_cache,
    )
    clinical_only = _reconcile_kpi_sec8k_against_filings(clinical_only, sec_events)
    clinical_events = _merge_clinical_and_sec_events(clinical_only, sec_events)
    if press_events:
        press_events = annotate_events_reference_verification(
            press_events,
            company=company_str,
            ticker=item["ticker"],
            drug_tokens=drug_tokens,
            expected_nct_id=nct_id,
        )
        press_events = _filter_verified_feed_events(press_events)
        clinical_events = _merge_clinical_and_sec_events(clinical_events, press_events)
    clinical_events = _filter_verified_feed_events(clinical_events)

    ai_ok = bool(
        ai
        and not ai.get("_ai_skipped")
        and (len(clinical_events) > 0 or (summary and not _is_stale_summary(summary)))
    )

    sponsor_match = recompute_record_sponsor_match(
        {
            **item,
            "meta": {
                "brief_title": extracted.get("brief_title") or item.get("brief_title"),
                "phase": extracted.get("phase") or item.get("phase"),
                "overall_status": extracted.get("overall_status") or item.get("overall_status"),
                "conditions": extracted.get("conditions") or item.get("conditions"),
                "interventions": extracted.get("interventions") or item.get("interventions"),
                "enrollment": extracted.get("enrollment"),
                "lead_sponsor": extracted.get("lead_sponsor"),
            },
        }
    )

    return {
        **item,
        "sponsor_match": sponsor_match,
        "window_start": window_start,
        "window_end": window_end,
        "last_ctgov_update": last_up,
        "update_in_pre_cd_window": in_window,
        "has_ctgov_results": bool(extracted.get("has_results")),
        "meta": {
            "brief_title": extracted.get("brief_title") or item.get("brief_title"),
            "phase": extracted.get("phase") or item.get("phase"),
            "overall_status": extracted.get("overall_status") or item.get("overall_status"),
            "conditions": extracted.get("conditions") or item.get("conditions"),
            "interventions": extracted.get("interventions") or item.get("interventions"),
            "enrollment": extracted.get("enrollment"),
            "lead_sponsor": extracted.get("lead_sponsor"),
        },
        "outcome_measures": extracted.get("outcome_measures") or [],
        "ae_summary": extracted.get("ae_summary") or [],
        "citations": citations,
        "pubmed_pmids": pmids,
        "pubmed_abstracts": abstracts,
        "sources": sources,
        "ai": ai or {},
        "ai_ok": ai_ok,
        "structured": structured,
        "stock_reaction": stock_reaction,
        "clinical_events": clinical_events,
        "timeline_events": clinical_events,
        "clinical_indicators": global_indicators,
        "sponsor_match": item.get("sponsor_match"),
        "publication_context": {
            "pubmed_queries": pub_ctx.get("pubmed_queries"),
            "pubmed_hit_count": pub_ctx.get("pubmed_hit_count"),
            "drug_tokens_searched": pub_ctx.get("drug_tokens"),
        },
        "enriched_at": datetime.now(timezone.utc).isoformat(),
        **(
            {
                "deep_enriched_at": datetime.now(timezone.utc).isoformat(),
                "enrichment_mode": "deep",
            }
            if deep
            else {}
        ),
    }


def load_snapshot() -> dict[str, Any]:
    try:
        data = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        try:
            data["ai_provider"] = ai_provider.provider_info()
        except Exception:
            pass
        return data
    except Exception:
        return {"count": 0, "records": [], "ai_provider": ai_provider.provider_info()}


def _record_merge_key(rec: dict[str, Any]) -> str:
    tk = str(rec.get("ticker") or "").strip().upper()
    nct = str(rec.get("nct_id") or rec.get("nct") or "").strip().upper()
    return f"{tk}|{nct}"


def _indicator_richness(ind: dict[str, Any]) -> int:
    score = 0
    if _is_outcome_indicator(ind):
        score += 10
    if ind.get("endpoint_met") is not None:
        score += 5
    if ind.get("numeric_value") is not None:
        score += 2
    val = str(ind.get("value") or "").upper()
    if val and val not in ("N/D", "ND", "—", "-"):
        score += 1
    return score


def _merge_indicator_lists(
    prev: list[dict[str, Any]],
    new: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for ind in list(new) + list(prev):
        if not isinstance(ind, dict):
            continue
        key = f"{ind.get('label', '')}|{ind.get('indicator_date', '')}"
        existing = by_key.get(key)
        if existing is None or _indicator_richness(ind) > _indicator_richness(existing):
            by_key[key] = ind
    return _prioritize_outcome_indicators(list(by_key.values()))


def _merge_study_profiles(prev: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    out = dict(new)
    for k, v in prev.items():
        pv = str(v or "").strip().upper()
        nv = str(out.get(k) or "").strip().upper()
        if pv and pv not in ("N/D", "ND", "—", "UNKNOWN", "NONE", "NULL") and nv in (
            "",
            "N/D",
            "ND",
            "—",
            "UNKNOWN",
        ):
            out[k] = v
    return out


def _merge_clinical_events(
    prev_events: list[dict[str, Any]],
    new_events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for ev in new_events:
        if not isinstance(ev, dict):
            continue
        key = f"{ev.get('event_date')}|{str(ev.get('event_title', ''))[:50]}"
        by_key[key] = ev
    for ev in prev_events:
        if not isinstance(ev, dict):
            continue
        key = f"{ev.get('event_date')}|{str(ev.get('event_title', ''))[:50]}"
        if key not in by_key:
            by_key[key] = ev
            continue
        merged = dict(by_key[key])
        merged["indicators"] = _merge_indicator_lists(
            list(ev.get("indicators") or []),
            list(merged.get("indicators") or []),
        )
        if len(str(ev.get("summary") or "")) > len(str(merged.get("summary") or "")):
            merged["summary"] = ev["summary"]
        by_key[key] = merged
    return list(by_key.values())


def _merge_enriched_record(prev: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Keep richer Copilot KPI / event indicators when a refresh returns sparser AI output."""
    out = dict(new)
    out["clinical_indicators"] = _merge_indicator_lists(
        list(prev.get("clinical_indicators") or []),
        list(new.get("clinical_indicators") or []),
    )
    merged_events = _merge_clinical_events(
        list(prev.get("clinical_events") or []),
        list(new.get("clinical_events") or []),
    )
    out["clinical_events"] = _filter_verified_feed_events(merged_events)
    out["timeline_events"] = out["clinical_events"]
    prev_ai = prev.get("ai") if isinstance(prev.get("ai"), dict) else {}
    new_ai = new.get("ai") if isinstance(new.get("ai"), dict) else {}
    merged_ai = dict(new_ai)
    prev_prof = prev_ai.get("study_clinical_profile")
    new_prof = new_ai.get("study_clinical_profile")
    if isinstance(prev_prof, dict) and isinstance(new_prof, dict):
        merged_ai["study_clinical_profile"] = _merge_study_profiles(prev_prof, new_prof)
    elif isinstance(prev_prof, dict) and not new_prof:
        merged_ai["study_clinical_profile"] = prev_prof
    merged_ai["clinical_indicators"] = out["clinical_indicators"]
    out["ai"] = merged_ai
    if prev.get("ai_ok") and not out.get("ai_ok"):
        out["ai_ok"] = True
    if prev.get("deep_enriched_at") and not out.get("deep_enriched_at"):
        out["deep_enriched_at"] = prev["deep_enriched_at"]
    return out


def _finalize_snapshot_records(
    refreshed: list[dict[str, Any]],
    prev_by_key: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Append prior sponsor-verified records not touched by this refresh."""
    refreshed_keys = {_record_merge_key(r) for r in refreshed}
    out = list(refreshed)
    for key, prev_rec in prev_by_key.items():
        if key in refreshed_keys:
            continue
        clean = sanitize_snapshot_record(prev_rec, reannotate=False)
        if is_study_sponsor_trusted(clean):
            out.append(clean)
    out.sort(key=lambda r: r.get("cd_date") or "")
    return out


def _write_snapshot(records: list[dict[str, Any]], *, partial: bool = False) -> None:
    """Persiste su ``data/clinical_pre_cd_enrichment_snapshot.json`` (scrittura atomica)."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    clean = filter_trusted_snapshot_records(records)
    snap = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "months_before_cd": _MONTHS_BEFORE_CD,
        "count": len(clean),
        "ai_ok_count": sum(1 for r in clean if r.get("ai_ok")),
        "records": clean,
    }
    if partial:
        snap["persist_mode"] = "incremental"
    payload = json.dumps(snap, ensure_ascii=False, indent=2, default=str)
    tmp_path = _SNAPSHOT_PATH.with_suffix(".json.tmp")
    tmp_path.write_text(payload, encoding="utf-8")
    tmp_path.replace(_SNAPSHOT_PATH)


def _persist_snapshot_draft(
    records: list[dict[str, Any]],
    prev_by_key: dict[str, dict[str, Any]],
    *,
    partial: bool = True,
) -> None:
    """Salva dopo ogni studio arricchito: merge con righe non ancora processate."""
    try:
        full = _finalize_snapshot_records(records, prev_by_key)
        _write_snapshot(full, partial=partial)
    except Exception as exc:
        print(f"[ClinicalPreCD][WARN] Salvataggio incrementale fallito: {exc}", flush=True)


def run_clinical_pre_cd_refresh(
    *,
    portfolio_only: bool = True,
    force: bool = False,
    deep: bool = False,
) -> dict[str, Any]:
    try:
        return _run(portfolio_only=portfolio_only, force=force, deep=deep)
    except Exception as exc:
        _set_status(running=False, error=str(exc), message=str(exc))
        return {"error": str(exc)}


def _run(
    *,
    portfolio_only: bool = True,
    force: bool = False,
    deep: bool = False,
) -> dict[str, Any]:
    work = _build_work_list()
    if portfolio_only:
        pt = _portfolio_ticker_set()
        if pt:
            work = [w for w in work if w.get("ticker") in pt]
        else:
            print("[ClinicalPreCD] portfolio_only: nessun ticker in invest_sim_inputs — tutti gli studi", flush=True)
    _set_status(
        running=True,
        message="Caricamento studi clinici…",
        processed=0,
        total=len(work),
        ai_ok=0,
        error=None,
    )
    if not work:
        _set_status(running=False, message="Nessuno studio con NCT + CD trovato", processed=0, total=0)
        return {"count": 0, "error": "no work items"}

    prev_by_key: dict[str, dict[str, Any]] = {}
    try:
        for r in load_snapshot().get("records") or []:
            if isinstance(r, dict):
                prev_by_key[_record_merge_key(r)] = r
    except Exception:
        pass

    pt = _portfolio_ticker_set() if portfolio_only else set()
    records: list[dict[str, Any]] = []
    ai_ok = 0
    skipped = 0
    try:
        for i, item in enumerate(work):
            tk = item["ticker"]
            key = f"{tk}|{str(item.get('nct_id') or '').strip().upper()}"
            prev = prev_by_key.get(key)
            run_deep = deep or (
                portfolio_only
                and tk in pt
                and needs_scheduled_deep_refresh(prev)
            )
            if should_skip_enrichment_refresh(prev, force=force, deep=run_deep):
                records.append(prev)
                skipped += 1
                if prev.get("ai_ok"):
                    ai_ok += 1
                _persist_snapshot_draft(records, prev_by_key)
                continue
            mode = "deep" if run_deep else "standard"
            _set_status(
                message=f"{item.get('company', tk)} ({tk}) — {item['nct_id']} [{mode}] ({i + 1}/{len(work)})",
                processed=i,
            )
            print(f"[ClinicalPreCD] {tk} {item['nct_id']} mode={mode}", flush=True)
            rec = _enrich_one(item, deep=run_deep)
            if prev:
                rec = _merge_enriched_record(prev, rec)
            if run_deep and not rec.get("deep_enriched_at"):
                rec["deep_enriched_at"] = datetime.now(timezone.utc).isoformat()
            records.append(rec)
            if rec.get("ai_ok"):
                ai_ok += 1
            _persist_snapshot_draft(records, prev_by_key)
    except Exception:
        if records:
            _persist_snapshot_draft(records, prev_by_key)
        raise

    records = _finalize_snapshot_records(records, prev_by_key)
    ai_ok = sum(1 for r in records if r.get("ai_ok"))
    _write_snapshot(records, partial=False)
    ts = datetime.now(timezone.utc).isoformat()
    _set_status(
        running=False,
        processed=len(records),
        ai_ok=ai_ok,
        message=f"Completato — {len(records)} studi, {ai_ok} con sintesi AI"
        + (f", {skipped} da cache (<{__import__('clinical_cache_ttl').CLINICAL_CACHE_TTL_DAYS}g)" if skipped else ""),
        finished_at=ts,
    )
    return {"count": len(records), "ai_ok": ai_ok}


def feed_lookup_key(rec: dict[str, Any]) -> str | None:
    """``TICKER|YYYY-MM-DD`` — same key as ``build_ai_feed_index``."""
    tk = str(rec.get("ticker") or "").strip().upper()
    cd = rec.get("cd_date")
    if not tk or not cd:
        return None
    return f"{tk}|{str(cd)[:10]}"


def _build_historic_work_from_past_pred(
    *,
    require_chart_pairs: bool = True,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Work items for each historical catalyst in past_catalyst_predictions.json."""
    from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
    from past_pred_io import load_past_pred_document, rows_map_from_doc

    rows = rows_map_from_doc(load_past_pred_document(str(PAST_CATALYST_PREDICTIONS_JSON)))
    work: list[dict[str, Any]] = []
    seen: set[str] = set()
    for key, rec in rows.items():
        if not isinstance(rec, dict):
            continue
        tk = str(rec.get("ticker") or (str(key).split("|")[0] if "|" in str(key) else "")).strip().upper()
        cd = rec.get("completion_date")
        nct = str(rec.get("nct_id") or "").strip().upper()
        if not is_valid_feed_ticker(tk) or cd is None or not nct:
            continue
        if require_chart_pairs:
            try:
                c60 = float(rec.get("close_m60") or 0)
                c5 = float(rec.get("close_m5") or 0)
            except (TypeError, ValueError):
                continue
            if c60 <= 0 or c5 <= 0:
                continue
        cd_s = cd.isoformat()[:10] if hasattr(cd, "isoformat") else str(cd)[:10]
        fk = f"{tk}|{cd_s}"
        if fk in seen:
            continue
        seen.add(fk)
        work.append(
            {
                "ticker": tk,
                "company": str(rec.get("company_name_full") or rec.get("company") or tk),
                "nct_id": nct,
                "cd_date": cd_s,
                "phase": rec.get("phase"),
                "brief_title": rec.get("brief_title"),
                "overall_status": rec.get("overall_status"),
                "conditions": rec.get("conditions"),
                "interventions": rec.get("interventions"),
                "last_update": rec.get("last_update"),
                "historic_source": "past_catalyst_predictions",
            }
        )
    work.sort(key=lambda w: (w.get("cd_date") or "", w.get("ticker") or ""))
    if limit is not None and limit > 0:
        work = work[: int(limit)]
    return work


def _historic_record_ready(rec: dict[str, Any]) -> bool:
    events = rec.get("clinical_events") or rec.get("timeline_events") or []
    if not events:
        return False
    for ev in events:
        if not isinstance(ev, dict):
            continue
        eis = ev.get("eis")
        if isinstance(eis, dict) and eis.get("score") is not None:
            return True
        try:
            if abs(float(ev.get("sentiment", 0))) >= 0.05:
                return True
        except (TypeError, ValueError):
            pass
    return len(events) > 0


def run_historic_past_catalyst_feed_enrichment(
    *,
    limit: int | None = None,
    force: bool = False,
    skip_ai: bool = True,
    skip_yfinance: bool = True,
    skip_press: bool = True,
    require_chart_pairs: bool = True,
    persist_every: int = 25,
    rebuild_past_pred: bool = True,
    rebuild_signal_calibration: bool = False,
) -> dict[str, Any]:
    """
    Enrich Catalyst Feed snapshot for historical ``TICKER|CD`` pairs from past_pred.

    Default is lite mode (no AI, no yfinance, no press) — KPI/CT.gov structured events
    only, fast enough for batch backfill. Re-run with ``skip_yfinance=False`` for market EIS.
    """
    work = _build_historic_work_from_past_pred(
        require_chart_pairs=require_chart_pairs,
        limit=limit,
    )
    if not work:
        return {"error": "no historic work items", "total": 0}

    existing = list(load_snapshot().get("records") or [])
    by_feed: dict[str, dict[str, Any]] = {}
    for rec in existing:
        if not isinstance(rec, dict):
            continue
        fk = feed_lookup_key(rec)
        if fk:
            by_feed[fk] = rec

    enriched = 0
    skipped = 0
    errors = 0
    _set_status(
        running=True,
        message=f"Historic feed enrich 0/{len(work)}…",
        processed=0,
        total=len(work),
        ai_ok=0,
        error=None,
    )

    try:
        for i, item in enumerate(work):
            fk = feed_lookup_key(item)
            if not fk:
                continue
            prev = by_feed.get(fk)
            if prev and not force and _historic_record_ready(prev):
                skipped += 1
                continue
            _set_status(
                message=f"Historic {item['ticker']} {item['cd_date']} ({i + 1}/{len(work)})",
                processed=i,
            )
            print(
                f"[HistoricFeed] {item['ticker']} {item['nct_id']} cd={item['cd_date']} "
                f"({i + 1}/{len(work)})",
                flush=True,
            )
            try:
                rec = _enrich_one(
                    item,
                    deep=False,
                    skip_ai=skip_ai,
                    skip_yfinance=skip_yfinance,
                    skip_press=skip_press,
                )
                rec["enrichment_mode"] = "historic_lite" if skip_yfinance else "historic_full"
                rec["historic_enriched_at"] = datetime.now(timezone.utc).isoformat()
                if prev:
                    rec = _merge_enriched_record(prev, rec)
                by_feed[fk] = rec
                enriched += 1
            except Exception as exc:
                errors += 1
                print(f"[HistoricFeed] ERR {fk}: {exc}", flush=True)
                if prev:
                    by_feed[fk] = prev
                continue
            if enriched > 0 and enriched % max(1, int(persist_every)) == 0:
                _write_snapshot(list(by_feed.values()), partial=True)
    finally:
        merged = list(by_feed.values())
        merged.sort(key=lambda r: r.get("cd_date") or "")
        _write_snapshot(merged, partial=False)
        try:
            from prediction.ai_feed_recalib import get_ai_feed_index

            get_ai_feed_index(reload=True)
        except Exception:
            pass

    pp_stats: dict[str, int] = {}
    if rebuild_past_pred:
        try:
            from prediction.past_pred_display_enrich import ensure_past_pred_display_enriched

            pp_stats = ensure_past_pred_display_enriched(persist=True, force=True)
        except Exception as exc:
            pp_stats = {"error": str(exc)}

    cal_ok = False
    if rebuild_signal_calibration:
        try:
            from prediction.signal_audit import build_calibration_document

            build_calibration_document(close_outcomes_first=False)
            cal_ok = True
        except Exception as exc:
            cal_ok = False
            print(f"[HistoricFeed] signal calibration rebuild failed: {exc}", flush=True)

    _set_status(
        running=False,
        processed=len(work),
        total=len(work),
        message=(
            f"Historic feed — enriched={enriched} skipped={skipped} errors={errors} "
            f"snapshot={len(by_feed)}"
        ),
        finished_at=datetime.now(timezone.utc).isoformat(),
    )
    return {
        "total": len(work),
        "enriched": enriched,
        "skipped": skipped,
        "errors": errors,
        "snapshot_count": len(by_feed),
        "past_pred_enrich": pp_stats,
        "signal_calibration_rebuilt": cal_ok,
    }
