"""
Assemble SdsTickerInput from Supernova on-disk caches (Simulation cohort).
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

from orchestrator_io_paths import (
    DATA_DIR,
    MARKET_CONTEXT_JSON,
    SIM_LIVE_PRED_SNAPSHOT_JSON,
    SIMULATION_SHEET_SNAPSHOT_JSON,
)
from prediction.scoring_data import (
    ensure_price_series,
    ensure_xbi_closes,
    load_enrich,
    market_cap_from_enrich,
    _parse_cd_days,
)
from prediction.supernova_score import SdsTickerInput, SdsResult, compute_sds

_SDS_ROI_REFS: dict[str, list[float | None]] | None = None


def _sds_roi_reference_curves() -> dict[str, list[float | None]]:
    global _SDS_ROI_REFS
    if _SDS_ROI_REFS is None:
        from prediction.sds_roi_blend import load_reference_curves

        _SDS_ROI_REFS = load_reference_curves()
    return _SDS_ROI_REFS


_SDS_SNAPSHOT = Path(DATA_DIR) / "sds_snapshot.json"
_SDS_SNAPSHOT_GOOD = Path(DATA_DIR) / "sds_snapshot.last_good.json"

# Aligned with SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS / SIM_MONITOR_HORIZON_DAYS (cdHorizons.ts).
SDS_COHORT_MAX_DAYS_TO_CD = int(os.environ.get("SDS_COHORT_MAX_DAYS_TO_CD", "120"))
SDS_COHORT_POST_CD_DAYS = int(os.environ.get("SDS_COHORT_POST_CD_DAYS", "7"))


def is_sds_snapshot_degraded(doc: dict[str, Any] | None) -> bool:
    """True when B/C clusters are missing (timing-only recompute, max SDS ~10–15)."""
    if not doc or not isinstance(doc, dict):
        return True
    rows = doc.get("rows") or []
    if not rows:
        return True
    max_sds = max(float(r.get("sds") or 0) for r in rows)
    sample = max(rows, key=lambda r: float(r.get("sds") or 0))
    cs = sample.get("cluster_scores") or {}
    top_inst = float(cs.get("institutional_signal") or 0)
    top_price = float(cs.get("price_structure") or 0)
    return max_sds < 25 and top_inst < 1 and top_price < 1


def save_sds_snapshot(doc: dict[str, Any]) -> str:
    _SDS_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    degraded = is_sds_snapshot_degraded(doc)
    if degraded:
        good = load_sds_snapshot_good()
        if good.get("rows") and not is_sds_snapshot_degraded(good):
            _SDS_SNAPSHOT.write_text(
                json.dumps(good, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return str(_SDS_SNAPSHOT)
        current = load_sds_snapshot()
        if current.get("rows") and not is_sds_snapshot_degraded(current):
            return str(_SDS_SNAPSHOT)
        return str(_SDS_SNAPSHOT)
    try:
        _SDS_SNAPSHOT_GOOD.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass
    _SDS_SNAPSHOT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(_SDS_SNAPSHOT)


def _load_json(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _market_regime() -> str:
    doc = _load_json(Path(MARKET_CONTEXT_JSON))
    if isinstance(doc, dict):
        return str(doc.get("market_regime") or "NEUTRAL")
    return "NEUTRAL"


def _simulation_tickers() -> list[dict[str, Any]]:
    snap = _load_json(Path(SIMULATION_SHEET_SNAPSHOT_JSON))
    if not isinstance(snap, dict):
        return []
    rows = snap.get("rows") or []
    return [r for r in rows if isinstance(r, dict)]


def _live_pred_by_ticker() -> dict[str, dict[str, Any]]:
    doc = _load_json(Path(SIM_LIVE_PRED_SNAPSHOT_JSON))
    if not isinstance(doc, dict):
        return {}
    rows = doc.get("rows") or {}
    if not isinstance(rows, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for k, v in rows.items():
        if not isinstance(v, dict):
            continue
        tk = str(v.get("ticker") or str(k).split("|")[0]).strip().upper()
        if tk:
            out[tk] = v
    return out


def _phase_from_row(row: dict[str, Any]) -> str | None:
    for key in ("Studio Phase", "Phase", "Clinical Phase", "phase"):
        v = row.get(key)
        if v:
            return str(v).strip()
    return None


def _row_ticker(row: dict[str, Any]) -> str:
    return str(row.get("Ticker") or row.get("ticker") or "").strip().upper()


def _looks_like_ticker(sym: str) -> bool:
    """Exclude Simulation summary rows (e.g. TOTALE PORTAFOGLIO)."""
    if not sym or sym.startswith("──"):
        return False
    if " " in sym or "TOTALE" in sym or "PORTAFOGLIO" in sym:
        return False
    return bool(re.match(r"^[A-Z][A-Z0-9.-]{0,9}$", sym))


def _completion_date_str(sim_row: dict[str, Any], live_row: dict[str, Any] | None = None) -> str | None:
    cd_raw = sim_row.get("Completion Date") or sim_row.get("CD") or (live_row or {}).get("completion_date")
    if not cd_raw:
        return None
    s = str(cd_raw).strip()[:10]
    return s if len(s) >= 10 and s[4] == "-" else None


def _sim_row_in_sds_cohort(row: dict[str, Any]) -> bool:
    """Include Simulation rows within monitor horizon (default 120d pre-CD, 7d post-CD)."""
    tk = _row_ticker(row)
    if not tk or not _looks_like_ticker(tk):
        return False
    cd_raw = row.get("Completion Date") or row.get("CD") or row.get("completion_date")
    days = _parse_cd_days(cd_raw)
    if days is None:
        return False
    if days < -SDS_COHORT_POST_CD_DAYS:
        return False
    if days > SDS_COHORT_MAX_DAYS_TO_CD:
        return False
    return True


def simulation_cohort_tickers() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for row in _simulation_tickers():
        if not _sim_row_in_sds_cohort(row):
            continue
        tk = _row_ticker(row)
        if tk in seen:
            continue
        seen.add(tk)
        out.append(tk)
    return sorted(out)


def sds_cohort_ticker_set(doc: dict[str, Any] | None = None) -> set[str]:
    doc = doc or load_sds_snapshot()
    return {
        str(r.get("ticker", "")).strip().upper()
        for r in (doc.get("rows") or [])
        if r.get("ticker") and _looks_like_ticker(str(r.get("ticker", "")).strip().upper())
    }


def best_cached_sds_snapshot() -> dict[str, Any]:
    """Prefer non-degraded main, then last_good, then whatever exists."""
    for loader in (load_sds_snapshot, load_sds_snapshot_good):
        doc = loader()
        if doc.get("rows") and not is_sds_snapshot_degraded(doc):
            return doc
    good = load_sds_snapshot_good()
    if good.get("rows"):
        return good
    return load_sds_snapshot()


def restore_sds_snapshot_from_backup() -> dict[str, Any]:
    """Restore ``sds_snapshot.json`` from ``sds_snapshot.last_good.json``."""
    good = load_sds_snapshot_good()
    if not good.get("rows"):
        raise ValueError("Backup missing: data/sds_snapshot.last_good.json")
    if is_sds_snapshot_degraded(good):
        raise ValueError("Backup is degraded — run full SDS refresh with FMP")
    save_sds_snapshot(good)
    return good


def _finalize_sds_payload(base: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    payload = dict(base)
    payload["generated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    payload["n"] = len(rows)
    payload["rows"] = rows
    payload["top_candidates"] = rows[:3]
    payload["cohort_max_days_to_cd"] = SDS_COHORT_MAX_DAYS_TO_CD
    payload["cohort_post_cd_days"] = SDS_COHORT_POST_CD_DAYS
    return payload


def sync_sds_cohort_from_simulation(
    *,
    fetch_fmp: bool = False,
    fetch_cluster_a: bool = False,
) -> dict[str, Any]:
    """Merge Simulation cohort changes without recomputing existing FMP-backed rows."""
    target = set(simulation_cohort_tickers())
    cached = best_cached_sds_snapshot()
    existing = sds_cohort_ticker_set(cached)
    rows_by: dict[str, dict[str, Any]] = {
        str(r.get("ticker", "")).upper(): r
        for r in (cached.get("rows") or [])
        if str(r.get("ticker", "")).upper() in target
    }

    missing = sorted(target - existing)
    if not missing and len(rows_by) == len(target):
        return cached

    use_fmp = fetch_fmp or fetch_cluster_a
    if missing:
        new_doc = compute_sds_cohort(
            fetch_fmp=use_fmp,
            fetch_cluster_a=fetch_cluster_a or use_fmp,
            tickers=missing,
        )
        for row in new_doc.get("rows") or []:
            tk = str(row.get("ticker", "")).upper()
            if tk:
                rows_by[tk] = row

    results = sorted(rows_by.values(), key=lambda x: float(x.get("sds") or 0), reverse=True)
    doc = _finalize_sds_payload(cached, results)
    save_sds_snapshot(doc)
    if is_sds_snapshot_degraded(doc):
        return best_cached_sds_snapshot()
    return doc


def _shares_outstanding(enrich: dict[str, Any]) -> float | None:
    raw = enrich.get("sharesOutstanding") or enrich.get("shares_outstanding")
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def build_sds_input(
    ticker: str,
    *,
    sim_row: dict[str, Any] | None = None,
    live_row: dict[str, Any] | None = None,
    fetch_fmp: bool = False,
    fetch_cluster_a: bool = False,
    fetch_short: bool | None = None,
) -> SdsTickerInput:
    """``fetch_short`` is a legacy alias for ``fetch_fmp``."""
    tk = ticker.upper()
    use_fmp = fetch_fmp if fetch_short is None else fetch_short
    sim_row = sim_row or {}
    live_row = live_row or {}
    closes, vols = ensure_price_series(tk, min_bars=126)
    xbi = ensure_xbi_closes(min_bars=90)
    enrich = load_enrich(tk)

    from prediction.sds.ctgov_study_plan import nct_from_sim_row

    cd_raw = sim_row.get("Completion Date") or sim_row.get("CD") or live_row.get("completion_date")
    days_cd = _parse_cd_days(cd_raw)
    nct_id = nct_from_sim_row(sim_row)

    short_pct = None
    dtc = None
    analyst_score: float | None = None
    fmp_meta: dict[str, Any] = {}

    from prediction.sds_data_collector import collect_fmp_cluster_b, refresh_cluster_b_resilient

    if use_fmp:
        fmp_meta = collect_fmp_cluster_b(
            tk,
            use_cache=True,
            force_refresh=True,
            volumes=vols,
            shares_outstanding=_shares_outstanding(enrich),
        )
    else:
        light_fetch = os.environ.get("SDS_LIGHT_CLUSTER_B_FETCH", "1").strip().lower() not in (
            "0",
            "false",
            "no",
        )
        fmp_meta = refresh_cluster_b_resilient(
            tk,
            volumes=vols,
            shares_outstanding=_shares_outstanding(enrich),
            allow_network=light_fetch,
        )

    if fmp_meta:
        short_pct = fmp_meta.get("short_interest_pct")
        dtc = fmp_meta.get("days_to_cover")
        analyst_score = fmp_meta.get("analyst_upgrade_score")
    cluster_b_meta = dict(fmp_meta) if fmp_meta else {}

    cash_months = None
    cluster_d_meta: dict[str, Any] = {}

    from prediction.sds_cluster_d_collector import collect_cluster_d, load_cached_cluster_d

    refresh_fundamentals = use_fmp or os.environ.get("SDS_FETCH_CLUSTER_D", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    if refresh_fundamentals:
        cluster_d_meta = collect_cluster_d(tk, use_cache=True, force_refresh=use_fmp)
    else:
        cluster_d_meta = load_cached_cluster_d(tk) or {}

    cash_months = cluster_d_meta.get("runway_months")
    if cash_months is None:
        from prediction.scoring_data import _runway_from_enrich

        cash_months = _runway_from_enrich(enrich)
        if cash_months is not None:
            cluster_d_meta.setdefault("runway_months", cash_months)
            cluster_d_meta.setdefault("runway_status", "enrich_proxy")

    mcap = market_cap_from_enrich(enrich)

    vol_ratio = live_row.get("vol_ratio") or enrich.get("vol_ratio")
    try:
        vol_ratio_f = float(vol_ratio) if vol_ratio is not None else None
    except (TypeError, ValueError):
        vol_ratio_f = None

    pred5 = live_row.get("model_dm5_pct") or live_row.get("d5_pct")
    aff = live_row.get("affidabilita") or live_row.get("affidabilita_calib")
    try:
        pred5_f = float(pred5) if pred5 is not None else None
        conf_f = float(aff) / 100.0 if aff is not None else None
    except (TypeError, ValueError):
        pred5_f = None
        conf_f = None

    catalyst_types: list[str] = []
    cd_date_raw = sim_row.get("Completion Date") or sim_row.get("CD") or live_row.get("completion_date")
    cd_date_str = str(cd_date_raw).strip()[:10] if cd_date_raw else None

    from prediction.sds_cluster_e_collector import collect_cluster_e

    cluster_e_meta = collect_cluster_e(
        tk,
        days_to_cd=days_cd,
        cd_date=cd_date_str,
        sim_row=sim_row,
        analyst_meta=fmp_meta if fmp_meta else None,
    )
    catalyst_types = list(cluster_e_meta.get("catalyst_types") or [])
    if days_cd is not None and 0 < days_cd <= 90 and "clinical_readout" not in catalyst_types:
        catalyst_types.append("clinical_readout")

    indication = sim_row.get("Indication") or live_row.get("indication")
    phase_val = _phase_from_row(sim_row) or live_row.get("phase")
    cluster_a_meta: dict[str, Any] = {}

    from prediction.sds_cluster_a_collector import collect_cluster_a, load_cached_cluster_a

    refresh_cluster_a = fetch_cluster_a or fetch_fmp
    if refresh_cluster_a:
        cluster_a_meta = collect_cluster_a(
            tk,
            indication=indication,
            phase=phase_val,
            nct_id=nct_id,
            use_cache=True,
            force_refresh=True,
            use_ai=os.environ.get("SDS_CLUSTER_A_USE_AI", "").strip().lower() in ("1", "true", "yes"),
        )
    else:
        cluster_a_meta = load_cached_cluster_a(tk) or {}

    if not cluster_a_meta.get("indication") and indication:
        cluster_a_meta.setdefault("indication", indication)

    unmet_sc = cluster_a_meta.get("unmet_need_score")
    mkt_sc = cluster_a_meta.get("market_size_score")
    fic = cluster_a_meta.get("first_in_class")
    pipe_val = cluster_a_meta.get("pipeline_value_estimate")
    _ = unmet_sc, mkt_sc  # scores recomputed in compute_sds from raw Cluster A fields
    if indication is None and cluster_a_meta.get("indication"):
        indication = cluster_a_meta.get("indication")
    if phase_val is None and cluster_a_meta.get("phase"):
        phase_val = cluster_a_meta.get("phase")

    primary_outcome = (
        cluster_a_meta.get("primary_outcome")
        or live_row.get("primary_outcome")
        or sim_row.get("Primary Outcome")
    )
    primary_outcomes = cluster_a_meta.get("primary_outcomes") or []
    trial_design = cluster_a_meta.get("trial_design") or live_row.get("trial_design") or sim_row.get("Design")
    study_description = cluster_a_meta.get("study_description") or cluster_a_meta.get("ctgov_brief_title")
    condition = cluster_a_meta.get("indication") or indication
    intervention_name = cluster_a_meta.get("interventions") or sim_row.get("Drug") or sim_row.get("drug")
    approved_count = cluster_a_meta.get("approved_drugs_count")
    fic_conf = cluster_a_meta.get("first_in_class_confidence")

    phase_prob: float | None = None
    from prediction.phase_pos import get_phase_pos
    from prediction.supernova_score import _phase_num_from_text

    ph_num = _phase_num_from_text(phase_val)
    if ph_num is not None:
        phase_prob = get_phase_pos(ph_num)

    if cluster_a_meta.get("tam_estimate_bn"):
        cluster_d_meta.setdefault("tam_estimate_bn", cluster_a_meta.get("tam_estimate_bn"))

    return SdsTickerInput(
        ticker=tk,
        closes=closes,
        volumes=vols,
        xbi_closes=xbi,
        days_to_cd=days_cd,
        cd_date=cd_date_str,
        phase=phase_val,
        primary_outcome=primary_outcome,
        primary_outcomes=list(primary_outcomes) if isinstance(primary_outcomes, list) else [],
        trial_design=trial_design,
        study_description=str(study_description).strip() if study_description else None,
        indication=indication,
        condition=str(condition).strip() if condition else None,
        intervention_name=str(intervention_name).strip() if intervention_name else None,
        intervention_description=cluster_a_meta.get("interventions"),
        market_cap=mcap,
        cash_runway_months=cash_months,
        short_interest_pct=short_pct,
        days_to_cover=dtc,
        analyst_upgrade_score=analyst_score,
        cluster_b_meta=cluster_b_meta,
        cluster_d_meta=cluster_d_meta,
        phase_probability=phase_prob,
        institutional_delta_pct=fmp_meta.get("inst_delta_pct") if fmp_meta else None,
        first_in_class=fic if isinstance(fic, bool) else None,
        first_in_class_confidence=str(fic_conf).strip().lower() if fic_conf else None,
        approved_drugs_count=int(approved_count) if approved_count is not None else None,
        pipeline_value_estimate=float(pipe_val) if pipe_val is not None else None,
        volume_ratio_5d=vol_ratio_f,
        pred5_live=pred5_f,
        confidence_score=conf_f,
        market_regime=_market_regime(),
        catalyst_types_90d=catalyst_types,
        cluster_e_meta=cluster_e_meta,
        catalyst_events_90d=list(cluster_e_meta.get("catalyst_events_90d") or []),
    )


def compute_sds_for_ticker(
    ticker: str,
    *,
    fetch_fmp: bool = False,
    fetch_cluster_a: bool = False,
    fetch_short: bool | None = None,
) -> dict[str, Any]:
    tk = ticker.upper()
    live_map = _live_pred_by_ticker()
    sim_rows = _simulation_tickers()
    sim_row = next((r for r in sim_rows if _row_ticker(r) == tk), {})
    inp = build_sds_input(
        tk,
        sim_row=sim_row,
        live_row=live_map.get(tk),
        fetch_fmp=fetch_fmp,
        fetch_cluster_a=fetch_cluster_a,
        fetch_short=fetch_short,
    )
    result = compute_sds(inp)
    doc = result.to_dict()
    from prediction.sds_investment_decision import investment_decision

    doc["investment"] = investment_decision(inp, result)
    _attach_cluster_a_fields(doc, inp, result)
    try:
        from prediction.sds_roi_blend import enrich_sds_row_with_curve_roi

        enrich_sds_row_with_curve_roi(doc, sim_row)
    except Exception:
        pass
    return doc


def _attach_cluster_a_fields(doc: dict[str, Any], inp: SdsTickerInput, result: Any) -> None:
    from prediction.sds_cluster_a_collector import load_cached_cluster_a

    raw = result.component_raw or {}
    ca = load_cached_cluster_a(inp.ticker) or {}
    cluster_a = getattr(result, "cluster_a", None) or {}
    if cluster_a:
        doc["cluster_a"] = cluster_a
    cluster_b = getattr(result, "cluster_b", None) or {}
    if cluster_b:
        doc["cluster_b"] = cluster_b
    if inp.indication or ca.get("indication"):
        doc["indication"] = inp.indication or ca.get("indication")
    if inp.first_in_class is not None:
        doc["first_in_class"] = inp.first_in_class
    elif ca.get("first_in_class") is not None:
        doc["first_in_class"] = ca.get("first_in_class")
    if ca.get("approved_drugs_count") is not None:
        doc["approved_drugs_count"] = ca.get("approved_drugs_count")
    if raw.get("unmet_need") is not None:
        doc["unmet_need_score"] = raw.get("unmet_need")
    if raw.get("market_size") is not None:
        doc["market_size_score"] = raw.get("market_size")
    if inp.pipeline_value_estimate is not None:
        doc["pipeline_value_estimate"] = inp.pipeline_value_estimate
    if ca.get("tam_billions") is not None:
        doc["tam_billions"] = ca.get("tam_billions")
    if ca.get("peak_sales_billions") is not None:
        doc["peak_sales_billions"] = ca.get("peak_sales_billions")
    if ca.get("mechanism_class"):
        doc["mechanism_class"] = ca.get("mechanism_class")


def compute_sds_cohort(
    *,
    fetch_fmp: bool = False,
    fetch_cluster_a: bool = False,
    fetch_short: bool | None = None,
    tickers: list[str] | None = None,
    on_ticker: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    use_fmp = fetch_fmp if fetch_short is None else fetch_short
    use_cluster_a = fetch_cluster_a or use_fmp
    sim_rows = _simulation_tickers()
    live_map = _live_pred_by_ticker()
    tk_set = {t.upper() for t in tickers} if tickers else None
    results: list[dict[str, Any]] = []

    cohort_rows: list[tuple[str, dict[str, Any]]] = []
    seen: set[str] = set()
    for row in sim_rows:
        tk = _row_ticker(row)
        if not tk or not _looks_like_ticker(tk) or tk in seen:
            continue
        if not _sim_row_in_sds_cohort(row):
            continue
        if tk_set and tk not in tk_set:
            continue
        seen.add(tk)
        cohort_rows.append((tk, row))

    total = len(cohort_rows)
    for idx, (tk, row) in enumerate(cohort_rows, start=1):
        if on_ticker:
            on_ticker(idx, total, tk)
        inp = build_sds_input(
            tk,
            sim_row=row,
            live_row=live_map.get(tk),
            fetch_fmp=use_fmp,
            fetch_cluster_a=use_cluster_a,
        )
        res = compute_sds(inp)
        from prediction.sds_investment_decision import investment_decision

        item = res.to_dict()
        item["investment"] = investment_decision(inp, res)
        item["days_to_cd"] = inp.days_to_cd
        item["phase"] = inp.phase
        cd_str = _completion_date_str(row, live_map.get(tk))
        if cd_str:
            item["completion_date"] = cd_str
        if inp.short_interest_pct is not None:
            item["short_interest_pct"] = inp.short_interest_pct
        if inp.days_to_cover is not None:
            item["days_to_cover"] = inp.days_to_cover
        if inp.analyst_upgrade_score is not None:
            item["analyst_upgrade_score"] = inp.analyst_upgrade_score
        _attach_cluster_a_fields(item, inp, res)
        try:
            from prediction.sds_roi_blend import enrich_sds_row_with_curve_roi

            enrich_sds_row_with_curve_roi(item, row, refs=_sds_roi_reference_curves())
        except Exception:
            pass
        results.append(item)

    results.sort(key=lambda x: x.get("sds") or 0, reverse=True)
    from prediction.sds_data_collector import fmp_api_key

    payload = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "n": len(results),
        "market_regime": _market_regime(),
        "fmp_enabled": fmp_api_key() is not None,
        "fmp_fetched": use_fmp,
        "cluster_a_fetched": use_cluster_a,
        "cohort_max_days_to_cd": SDS_COHORT_MAX_DAYS_TO_CD,
        "cohort_post_cd_days": SDS_COHORT_POST_CD_DAYS,
        "rows": results,
        "top_candidates": results[:3],
    }
    try:
        from prediction.sds_roi_calibration import build_sds_roi_calibration, save_sds_roi_calibration

        payload["roi_calibration"] = build_sds_roi_calibration()
        save_sds_roi_calibration(payload["roi_calibration"])
        from prediction.sds_roi_correlation import build_sds_roi_correlation, save_sds_roi_correlation

        payload["roi_correlation"] = build_sds_roi_correlation()
        save_sds_roi_correlation(payload["roi_correlation"])
        try:
            from prediction.sds_roi_forecast_tracker import append_sds_roi_forecasts

            append_sds_roi_forecasts(payload)
        except Exception:
            pass
    except Exception:
        pass
    return payload


def _append_sds_roi_forecasts_if_available(payload: dict[str, Any]) -> None:
    try:
        from prediction.sds_roi_forecast_tracker import append_sds_roi_forecasts

        append_sds_roi_forecasts(payload)
    except Exception:
        pass


def refresh_sds_cohort_full(
    *,
    fetch_fmp: bool = True,
    fetch_cluster_a: bool = True,
    on_ticker: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    """Ricalcola tutti i ticker nella finestra SDS (~120g pre-CD) con dati freschi."""
    use_fmp = fetch_fmp
    use_cluster_a = fetch_cluster_a or fetch_fmp
    doc = compute_sds_cohort(
        fetch_fmp=use_fmp,
        fetch_cluster_a=use_cluster_a,
        on_ticker=on_ticker,
    )
    doc["refresh_mode"] = "full"
    if use_fmp:
        doc["last_fmp_refresh_at"] = doc.get("generated_at")
    save_sds_snapshot(doc)
    if is_sds_snapshot_degraded(doc):
        doc = best_cached_sds_snapshot()
    _append_sds_roi_forecasts_if_available(doc)
    return {
        "mode": "full",
        "doc": doc,
        "n": int(doc.get("n") or 0),
        "generated_at": doc.get("generated_at"),
        "fmp_fetched": bool(doc.get("fmp_fetched")),
        "cluster_a_fetched": bool(doc.get("cluster_a_fetched")),
    }


def refresh_sds_cohort_light(
    *,
    on_ticker: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    """
    Ricalcolo leggero (giornaliero): tutta la coorte con prezzi e live signals freschi.

    - Cluster **C** (price_structure) e **E** (timing) da ``price_cache`` (+ backfill Yahoo).
    - Cluster **B** via cache stale + refresh selettivo (yfinance short, FMP se abilitato).
    - Cluster **A/D** dalla cache on-disk.
    - Se il risultato è degradato, mantiene l'ultimo snapshot buono.
    """
    prior = best_cached_sds_snapshot()
    if not prior.get("rows"):
        return sync_sds_after_simulation(fetch_fmp=False, fetch_cluster_a=False)

    doc = compute_sds_cohort(fetch_fmp=False, fetch_cluster_a=False, on_ticker=on_ticker)
    doc["refresh_mode"] = "light"
    doc["fmp_fetched"] = bool(prior.get("fmp_fetched"))
    doc["cluster_a_fetched"] = bool(prior.get("cluster_a_fetched"))
    doc["last_fmp_refresh_at"] = prior.get("last_fmp_refresh_at") or (
        prior.get("generated_at") if prior.get("fmp_fetched") else None
    )
    save_sds_snapshot(doc)
    final = doc
    if is_sds_snapshot_degraded(doc):
        final = best_cached_sds_snapshot()
    else:
        _append_sds_roi_forecasts_if_available(doc)
    return {
        "mode": "light",
        "doc": final,
        "n": int(final.get("n") or 0),
        "generated_at": final.get("generated_at"),
        "fmp_fetched": bool(final.get("fmp_fetched")),
        "cluster_a_fetched": bool(final.get("cluster_a_fetched")),
        "last_fmp_refresh_at": final.get("last_fmp_refresh_at"),
    }


def sync_sds_after_simulation(
    *,
    fetch_fmp: bool = True,
    fetch_cluster_a: bool = True,
) -> dict[str, Any]:
    """
    Aggiorna Supernova quando Simulation cambia:
    calcola SDS per ticker appena entrati in finestra pre-CD, rimuove uscite.
    """
    cached = best_cached_sds_snapshot()
    before = sds_cohort_ticker_set(cached)
    target = set(simulation_cohort_tickers())
    doc = sync_sds_cohort_from_simulation(
        fetch_fmp=fetch_fmp,
        fetch_cluster_a=fetch_cluster_a or fetch_fmp,
    )
    after = sds_cohort_ticker_set(doc)
    added = sorted(after - before)
    removed = sorted(before - target)
    if added:
        _append_sds_roi_forecasts_if_available(doc)
    return {
        "mode": "sync",
        "doc": doc,
        "n": int(doc.get("n") or 0),
        "added_tickers": added,
        "removed_tickers": removed,
        "generated_at": doc.get("generated_at"),
        "fmp_fetched": bool(doc.get("fmp_fetched")),
    }


def load_sds_snapshot_good() -> dict[str, Any]:
    doc = _load_json(_SDS_SNAPSHOT_GOOD)
    return doc if isinstance(doc, dict) else {}


def load_sds_snapshot() -> dict[str, Any]:
    doc = _load_json(_SDS_SNAPSHOT)
    return doc if isinstance(doc, dict) else {}
