"""
Cohort eventi chiusi per Investment Decision Lab (Fase A descrittiva).

Legge ``past_catalyst_predictions.json``, costruisce record decisionali e metriche
IC / quintili Affidabilità vs rendimento T−7→T+7.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    INVESTMENT_DECISION_COHORT_HISTORY_JSON,
    INVESTMENT_DECISION_COHORT_JSON,
    PAST_CATALYST_PREDICTIONS_JSON,
)
from past_pred_io import load_past_pred_document, rows_map_from_doc

HISTORY_MAX_ENTRIES = 30
HISTORY_TAIL_UI = 10

# Parametri env rilevanti per taratura modello (Decision Lab before/after).
DECISION_LAB_CONFIG_FIELDS: tuple[str, ...] = (
    "pred_engine",
    "pred_v4_curve_scale_precd",
    "pred_v4_curve_scale",
    "pred_curve_seq_calib",
    "pred_curve_apply_cal_factor",
    "pred_fundamental_shrink",
    "pred_fundamental_shrink_precd",
    "pred_k8_display_overlay",
    "pred_posthoc_reg",
    "pred_v5_cohort_prior",
    "pred_v5_sim_display",
    "pred_v5_calib",
    "pred_dir_fund_penalty",
    # Clinical/Catalyst Feed switches that influence pre-CD signal shape.
    "pred_ai_feed_seq_merge",
    "pred_eis_poly_enabled",
    "pred_eis_poly_alpha",
    "pred_eis_poly_max_shift",
    "pred_ai_feed_verified_only",
    "pred_clinical_indicators_poly",
    "pred_clinical_indicators_alpha",
    "pred_clinical_indicators_max_pp",
)
DECISION_LAB_ENV_EXTRA: tuple[str, ...] = (
    "PRED_CAP_ABS_PP_PRECD",
    "PRED_CAP_ABS_PP",
    "PRED_DAMP_DM60_EXTRAP",
    "PRED_V5_COHORT_PRIOR",
)

DECISION_OFFSET = -7
OUTCOME_END_OFFSET = 7
FLAT_BAND_PP = 0.5
SPONSOR_ALLOWED = frozenset({"exact", "partial"})

# ── Orizzonti rolling pre-CD (allineati al nuovo modello "predizione locale curva")
# Ciascun orizzonte definisce:
#   - close_start / close_end → barre prezzo per outcome realizzato
#   - model_start / model_end → punti curva modello per signal
#   - decision_offset / horizon_days → metadata UI
#   - flat_band_pp                   → soglia direzionale (default FLAT_BAND_PP)
HORIZON_DEFS: dict[str, dict[str, Any]] = {
    # PRE_LONG: stai a T-10, modello dice variazione 5gg avanti, controlli a T-5
    "pre5": {
        "label": "5gg rolling pre-CD (T-10 → T-5)",
        "decision_offset": -10,
        "horizon_days": 5,
        "close_start": "close_m10",
        "close_end": "close_m5",
        "model_start": "model_dm10_pct",
        "model_end": "model_dm5_pct",
        "flat_band_pp": 0.5,
    },
    # PRE_SHORT: stai a T-7, modello dice variazione 4gg avanti, controlli a T-3
    # (orizzonte di default, più vicino al CD ma ancora pre-evento)
    "pre4": {
        "label": "4gg rolling pre-CD (T-7 → T-3)",
        "decision_offset": -7,
        "horizon_days": 4,
        "close_start": "close_m7",
        "close_end": "close_m3",
        "model_start": "model_dm7_pct",
        "model_end": "model_dm3_pct",
        "flat_band_pp": 0.5,
    },
    # WIDE: vecchia metrica event-driven T-7→T+7 (mantenuta per storico e confronto)
    "wide": {
        "label": "14gg attorno al CD (T-7 → T+7)",
        "decision_offset": -7,
        "horizon_days": 14,
        "close_start": "close_m7",
        "close_end": "close_p7",
        "model_start": "model_dm7_pct",
        "model_end": "model_d7_pct",
        "flat_band_pp": 0.5,
    },
}

# Orizzonte di default per i KPI primari (banner + quintili UI). Il "wide" resta
# disponibile come secondo tab/selettore ma non è più la metrica primaria.
DEFAULT_HORIZON = "pre4"
NCT_ALLOWED = frozenset(
    {
        "direct sponsor",
        "collaborator",
        "correlated company/subsidiary",
        "",
    }
)

PROTOCOL: dict[str, Any] = {
    "schema_version": 2,
    "title": "Validazione modello — orizzonti rolling pre-CD",
    "default_horizon": DEFAULT_HORIZON,
    "horizons": [
        {
            "key": k,
            "label": d["label"],
            "decision_offset_days": d["decision_offset"],
            "horizon_days": d["horizon_days"],
            "close_pair": [d["close_start"], d["close_end"]],
            "model_pair": [d["model_start"], d["model_end"]],
            "flat_band_pp": d["flat_band_pp"],
        }
        for k, d in HORIZON_DEFS.items()
    ],
    "inclusion": [
        "Completion Date strettamente nel passato (evento realizzato)",
        "Sponsor match Exact o Partial",
        "Relazione NCT ammessa (direct / collaborator / correlated / vuota)",
        "Esclusi: non_quotata_al_tempo, pred_dataset_incomplete",
        "Per IC/quintili di un orizzonte: richiesti i 2 close + i 2 punti modello",
    ],
    "metrics": [
        "Per ciascun orizzonte: IC Spearman(pred_horizon, realized_horizon)",
        "Hit rate economico per orizzonte: segno pred = segno realizzato (±0.5 pp = flat)",
        "Quintili Affidabilità per orizzonte: R medio + Hit% per bucket Aff",
        "Diagnostica per segmento (sponsor/fase/run-up/direzione/Aff) sull'orizzonte WIDE",
        "Confronto before/after vs run precedente in history JSON",
    ],
    "limitations": [
        "Cohort biotech piccolo: interpretare CI e N per segmento",
        "Nessun backtest policy (solo attribuzione descrittiva)",
        "Confondenti (settore, regime mercato) non controllati",
        "Orizzonti pre-CD usano i close storici come proxy del rolling \"oggi → +5gg\"",
    ],
}


def _parse_date(v: Any) -> date | None:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, str) and v.strip():
        s = v.strip()[:10]
        try:
            y, m, d = int(s[:4]), int(s[5:7]), int(s[8:10])
            return date(y, m, d)
        except (ValueError, TypeError):
            return None
    return None


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _sponsor_ok(rec: dict) -> bool:
    sm = str(rec.get("sponsor_match") or "").strip().lower()
    return sm in SPONSOR_ALLOWED


def _nct_ok(rec: dict) -> bool:
    rel = str(rec.get("nct_relation_type") or "").strip().lower()
    return rel in NCT_ALLOWED


def _excluded_flags(rec: dict) -> bool:
    if rec.get("non_quotata_al_tempo"):
        return True
    if rec.get("pred_dataset_incomplete"):
        return True
    return False


def _forward_return_pp(rec: dict) -> float | None:
    m7 = _num(rec.get("close_m7"))
    p7 = _num(rec.get("close_p7"))
    if m7 is not None and p7 is not None and m7 > 0:
        return round((p7 / m7 - 1.0) * 100.0, 3)
    curve = rec.get("curve_act_pct")
    if isinstance(curve, dict):
        a = _num(curve.get("-7") or curve.get("−7"))
        b = _num(curve.get("+7"))
        if a is not None and b is not None:
            return round(b - a, 3)
    return None


def _pred_forward_pp(rec: dict) -> float | None:
    dm7 = _num(rec.get("model_dm7_pct"))
    d7 = _num(rec.get("model_d7_pct"))
    if dm7 is not None and d7 is not None:
        return round(d7 - dm7, 3)
    curve = rec.get("curve_act_pct")
    if isinstance(curve, dict):
        # fallback: usa solo pred a T−7 vs baseline se manca coppia modello
        pass
    return _num(rec.get("model_dm7_pct"))


def _aff_score(rec: dict) -> float | None:
    cal = _num(rec.get("affidabilita_calib"))
    if cal is not None:
        return cal if cal > 1.5 else cal * 100.0
    raw = _num(rec.get("affidabilita"))
    if raw is not None:
        return raw if raw > 1.5 else raw * 100.0
    return None


def _direction_hit(pred: float, actual: float, band: float = FLAT_BAND_PP) -> bool:
    if abs(actual) <= band:
        return abs(pred) <= band
    return (pred > band and actual > band) or (pred < -band and actual < -band)


def _horizon_metrics_for_row(rec: dict, horizon: dict[str, Any]) -> dict[str, Any]:
    """Calcola pred_pp / realized_pp / hit per un singolo orizzonte rolling."""
    c1 = _num(rec.get(horizon["close_start"]))
    c2 = _num(rec.get(horizon["close_end"]))
    m1 = _num(rec.get(horizon["model_start"]))
    m2 = _num(rec.get(horizon["model_end"]))
    band = float(horizon.get("flat_band_pp", FLAT_BAND_PP))

    pred_pp: float | None = None
    if m1 is not None and m2 is not None:
        pred_pp = round(m2 - m1, 3)

    realized_pp: float | None = None
    if c1 is not None and c2 is not None and c1 > 0:
        realized_pp = round((c2 / c1 - 1.0) * 100.0, 3)

    hit: bool | None = None
    if pred_pp is not None and realized_pp is not None:
        hit = _direction_hit(pred_pp, realized_pp, band)

    return {
        "pred_pp": pred_pp,
        "realized_pp": realized_pp,
        "direction_hit": hit,
    }


def _rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _spearman(xs: list[float], ys: list[float]) -> float | None:
    pairs = [(x, y) for x, y in zip(xs, ys) if math.isfinite(x) and math.isfinite(y)]
    if len(pairs) < 3:
        return None
    x = [p[0] for p in pairs]
    y = [p[1] for p in pairs]
    rx = _rank(x)
    ry = _rank(y)
    mx = sum(rx) / len(rx)
    my = sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den_x = math.sqrt(sum((a - mx) ** 2 for a in rx))
    den_y = math.sqrt(sum((b - my) ** 2 for b in ry))
    if den_x < 1e-12 or den_y < 1e-12:
        return None
    return round(num / (den_x * den_y), 4)


def _runup_label(v: float | None) -> str:
    if v is None:
        return "run-up n/d"
    if v < 0:
        return "run-up < 0%"
    if v < 5:
        return "run-up 0–5%"
    if v < 15:
        return "run-up 5–15%"
    if v < 30:
        return "run-up 15–30%"
    return "run-up > 30%"


def _phase_label(phase: str) -> str:
    s = (phase or "").strip().upper()
    if not s:
        return "Fase n/d"
    if "|" in s:
        return "Multi-fase"
    compact = s.replace(" ", "")
    if "PHASE4" in compact or compact.startswith("4"):
        return "Phase IV"
    if "PHASE3" in compact or "III" in s or compact.startswith("3"):
        return "Phase III"
    if "PHASE2" in compact or "II" in s or compact.startswith("2"):
        return "Phase II"
    if "PHASE1" in compact or compact.startswith("1"):
        return "Phase I"
    return (phase or "Altro")[:24]


def _dir_label(dir_v4: str) -> str:
    d = (dir_v4 or "").strip()
    if d.startswith("▲") or d.upper().startswith("UP"):
        return "▲ Up"
    if d.startswith("▼") or d.upper().startswith("DOWN"):
        return "▼ Down"
    return "Neutro / altro"


def _aff_label(v: float | None) -> str:
    if v is None:
        return "Affid. n/d"
    if v >= 70:
        return "Affid. ≥ 70%"
    if v >= 50:
        return "Affid. 50–70%"
    return "Affid. < 50%"


def _segment_metrics(rows: list[dict]) -> dict[str, Any]:
    ic_rows = [
        r
        for r in rows
        if r.get("pred_forward_pp") is not None and r.get("realized_forward_pp") is not None
    ]
    preds = [float(r["pred_forward_pp"]) for r in ic_rows]
    reals = [float(r["realized_forward_pp"]) for r in ic_rows]
    ic = _spearman(preds, reals)
    hits = [r for r in ic_rows if r.get("direction_hit") is not None]
    hit_rate = (
        round(100.0 * sum(1 for r in hits if r["direction_hit"]) / len(hits), 1)
        if hits
        else None
    )
    mean_r = round(sum(reals) / len(reals), 2) if reals else None
    mean_bias = (
        round(sum(p - r for p, r in zip(preds, reals)) / len(preds), 2) if preds else None
    )
    return {
        "n_events": len(rows),
        "n_ic_pairs": len(ic_rows),
        "ic_spearman": ic,
        "hit_rate_pct": hit_rate,
        "mean_r_hold_pp": mean_r,
        "mean_pred_bias_pp": mean_bias,
    }


def _segment_group(
    group_id: str,
    title: str,
    buckets: dict[str, list[dict]],
) -> dict[str, Any] | None:
    segments: list[dict[str, Any]] = []
    for label, chunk in buckets.items():
        if not chunk:
            continue
        segments.append({"label": label, **_segment_metrics(chunk)})
    if not segments:
        return None
    segments.sort(key=lambda s: s.get("n_ic_pairs", 0), reverse=True)
    return {"id": group_id, "title": title, "segments": segments}


def build_segment_diagnostics(rows: list[dict]) -> list[dict[str, Any]]:
    """IC / hit / bias per segmento — guida taratura modello e filtri cohort."""
    by_sponsor: dict[str, list[dict]] = {"Exact": [], "Partial": []}
    by_phase: dict[str, list[dict]] = {}
    by_runup: dict[str, list[dict]] = {}
    by_dir: dict[str, list[dict]] = {}
    by_aff: dict[str, list[dict]] = {}
    by_inferenza: dict[str, list[dict]] = {"Inferenza affidabile": [], "Inferenza non affidabile": []}

    for r in rows:
        sm = str(r.get("sponsor_match") or "").strip().lower()
        if sm == "exact":
            by_sponsor["Exact"].append(r)
        elif sm == "partial":
            by_sponsor["Partial"].append(r)

        pl = _phase_label(str(r.get("phase") or ""))
        by_phase.setdefault(pl, []).append(r)

        rl = _runup_label(_num(r.get("run_up_30d")))
        by_runup.setdefault(rl, []).append(r)

        dl = _dir_label(str(r.get("dir_v4") or ""))
        by_dir.setdefault(dl, []).append(r)

        al = _aff_label(_num(r.get("affidabilita_pct")))
        by_aff.setdefault(al, []).append(r)

        if r.get("model_inferenza_affidabile") is True:
            by_inferenza["Inferenza affidabile"].append(r)
        else:
            by_inferenza["Inferenza non affidabile"].append(r)

    runup_order = [
        "run-up < 0%",
        "run-up 0–5%",
        "run-up 5–15%",
        "run-up 15–30%",
        "run-up > 30%",
        "run-up n/d",
    ]
    aff_order = ["Affid. ≥ 70%", "Affid. 50–70%", "Affid. < 50%", "Affid. n/d"]
    ordered_runup = {k: by_runup[k] for k in runup_order if k in by_runup}
    ordered_aff = {k: by_aff[k] for k in aff_order if k in by_aff}

    groups: list[dict[str, Any]] = []
    for spec in (
        ("sponsor", "Sponsor match", by_sponsor),
        ("phase", "Fase trial", by_phase),
        ("runup", "Run-up 30gg (pre-CD)", ordered_runup),
        ("direction", "Direzione v4", by_dir),
        ("affidabilita", "Affidabilità", ordered_aff),
        ("inferenza", "Flag inferenza modello", by_inferenza),
    ):
        built = _segment_group(spec[0], spec[1], spec[2])
        if built:
            groups.append(built)
    return groups


def _quintile_buckets(rows: list[dict]) -> list[dict[str, Any]]:
    """Quintili sull'orizzonte legacy (T-7 → T+7) per retrocompatibilità."""
    return _quintile_buckets_for_keys(
        rows,
        realized_key="realized_forward_pp",
        hit_key="direction_hit",
    )


def _quintile_buckets_for_keys(
    rows: list[dict],
    *,
    realized_key: str,
    hit_key: str,
) -> list[dict[str, Any]]:
    """Stratificazione per Affidabilità con realized/hit configurabili.

    Generico: lo stesso codice produce i quintili sia per il campo legacy
    ``realized_forward_pp`` sia per ``horizons[hk].realized_pp`` (estratto dal
    chiamante).
    """
    scored = [(r, r.get("affidabilita_pct")) for r in rows if r.get("affidabilita_pct") is not None]
    if len(scored) < 5:
        return []
    scored.sort(key=lambda t: t[1])
    n = len(scored)
    out: list[dict[str, Any]] = []
    for q in range(5):
        lo = round(q * n / 5)
        hi = round((q + 1) * n / 5)
        chunk = scored[lo:hi]
        if not chunk:
            continue
        rets = [c[0][realized_key] for c in chunk if c[0].get(realized_key) is not None]
        hits = [c[0][hit_key] for c in chunk if c[0].get(hit_key) is not None]
        aff_lo = min(c[1] for c in chunk)
        aff_hi = max(c[1] for c in chunk)
        out.append(
            {
                "quintile": q + 1,
                "label": f"Q{q + 1}",
                "n": len(chunk),
                "aff_min": round(aff_lo, 1),
                "aff_max": round(aff_hi, 1),
                "mean_r_hold_pp": round(sum(rets) / len(rets), 2) if rets else None,
                "hit_rate_pct": round(100.0 * sum(1 for h in hits if h) / len(hits), 1) if hits else None,
            }
        )
    return out


def _horizon_summary(rows: list[dict[str, Any]], horizon_key: str) -> dict[str, Any]:
    """IC / Hit% / R medio per uno specifico orizzonte rolling."""
    pred_pairs: list[tuple[float, float]] = []
    hits: list[bool] = []
    for r in rows:
        h = (r.get("horizons") or {}).get(horizon_key) or {}
        p = h.get("pred_pp")
        a = h.get("realized_pp")
        if p is not None and a is not None:
            pred_pairs.append((float(p), float(a)))
        if h.get("direction_hit") is not None:
            hits.append(bool(h["direction_hit"]))
    preds = [p for p, _ in pred_pairs]
    reals = [a for _, a in pred_pairs]
    ic = _spearman(preds, reals) if preds else None
    hit_rate = round(100.0 * sum(1 for h in hits if h) / len(hits), 1) if hits else None
    mean_r = round(sum(reals) / len(reals), 2) if reals else None
    return {
        "n_events": len(rows),
        "n_ic_pairs": len(pred_pairs),
        "ic_spearman": ic,
        "hit_rate_pct": hit_rate,
        "mean_r_hold_pp": mean_r,
    }


def _horizon_quintiles(rows: list[dict[str, Any]], horizon_key: str) -> list[dict[str, Any]]:
    """Quintili Affidabilità con outcome preso da horizons[hk]."""
    enriched: list[dict[str, Any]] = []
    for r in rows:
        h = (r.get("horizons") or {}).get(horizon_key) or {}
        enriched.append(
            {
                **r,
                "_h_realized_pp": h.get("realized_pp"),
                "_h_direction_hit": h.get("direction_hit"),
            }
        )
    return _quintile_buckets_for_keys(
        enriched,
        realized_key="_h_realized_pp",
        hit_key="_h_direction_hit",
    )


def _build_row(row_key: str, rec: dict, today: date) -> dict[str, Any] | None:
    cd = _parse_date(rec.get("completion_date"))
    if cd is None or cd >= today:
        return None
    if not _sponsor_ok(rec) or not _nct_ok(rec):
        return None
    if _excluded_flags(rec):
        return None

    pred_fwd = _pred_forward_pp(rec)
    real_fwd = _forward_return_pp(rec)
    aff = _aff_score(rec)
    hit = (
        _direction_hit(pred_fwd, real_fwd)
        if pred_fwd is not None and real_fwd is not None
        else None
    )

    ticker = str(rec.get("ticker") or row_key.split("|")[0]).strip().upper()
    horizons_payload: dict[str, dict[str, Any]] = {}
    for key, hdef in HORIZON_DEFS.items():
        horizons_payload[key] = _horizon_metrics_for_row(rec, hdef)
    return {
        "row_key": row_key,
        "ticker": ticker,
        "completion_date": cd.isoformat(),
        "sponsor_match": rec.get("sponsor_match"),
        "phase": rec.get("phase") or "",
        "affidabilita_pct": round(aff, 2) if aff is not None else None,
        # Campi legacy: continuano a puntare all'orizzonte WIDE (T-7 → T+7) per
        # retrocompatibilità con UI/script che non sono ancora horizon-aware.
        "pred_forward_pp": pred_fwd,
        "realized_forward_pp": real_fwd,
        "direction_hit": hit,
        # Nuovo: metriche per ogni orizzonte rolling (allineato al nuovo modello).
        "horizons": horizons_payload,
        "model_inferenza_affidabile": rec.get("model_inferenza_affidabile"),
        "run_up_30d": _num(rec.get("run_up_30d")),
        "dir_v4": str(rec.get("dir_v4") or rec.get("direction") or "").strip(),
        "d5_pct_actual": _num(rec.get("d5_pct")),
        "score_v4": _num(rec.get("score_v4")),
    }


def build_investment_decision_cohort(
    *,
    past_pred_path: str | Path | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    doc = load_past_pred_document(str(past_pred_path or PAST_CATALYST_PREDICTIONS_JSON))
    rows_map = rows_map_from_doc(doc)

    cohort_rows: list[dict[str, Any]] = []
    for key, rec in rows_map.items():
        if not isinstance(rec, dict):
            continue
        built = _build_row(str(key), rec, today)
        if built:
            cohort_rows.append(built)

    ic_rows = [
        r
        for r in cohort_rows
        if r.get("pred_forward_pp") is not None and r.get("realized_forward_pp") is not None
    ]
    preds = [float(r["pred_forward_pp"]) for r in ic_rows]
    reals = [float(r["realized_forward_pp"]) for r in ic_rows]
    ic = _spearman(preds, reals)
    hits = [r for r in ic_rows if r.get("direction_hit") is not None]
    hit_rate = (
        round(100.0 * sum(1 for r in hits if r["direction_hit"]) / len(hits), 1)
        if hits
        else None
    )
    mean_r = round(sum(reals) / len(reals), 2) if reals else None

    # Nuove metriche stratificate per orizzonte rolling pre-CD (allineate al modello locale)
    summary_by_horizon: dict[str, dict[str, Any]] = {}
    quintiles_by_horizon: dict[str, list[dict[str, Any]]] = {}
    for hk in HORIZON_DEFS:
        summary_by_horizon[hk] = _horizon_summary(cohort_rows, hk)
        quintiles_by_horizon[hk] = _horizon_quintiles(cohort_rows, hk)

    return {
        "schema_version": 3,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(past_pred_path or PAST_CATALYST_PREDICTIONS_JSON),
        "protocol": PROTOCOL,
        "cohort_filter": {
            "past_cd_only": True,
            "sponsor_match": sorted(SPONSOR_ALLOWED),
            "decision_offset": DECISION_OFFSET,
            "outcome_end_offset": OUTCOME_END_OFFSET,
        },
        "default_horizon": DEFAULT_HORIZON,
        # Summary legacy (orizzonte WIDE T-7→T+7): mantenuto per retrocompatibilità
        "summary": {
            "n_events": len(cohort_rows),
            "n_ic_pairs": len(ic_rows),
            "ic_spearman": ic,
            "hit_rate_pct": hit_rate,
            "mean_r_hold_pp": mean_r,
        },
        # Summary per ogni orizzonte rolling (pre5, pre4, wide).
        # UI nuova legge summary_by_horizon[default_horizon] come primario.
        "summary_by_horizon": summary_by_horizon,
        "quintiles": _quintile_buckets(cohort_rows),       # legacy (WIDE)
        "quintiles_by_horizon": quintiles_by_horizon,      # nuovo: per ogni orizzonte
        "segment_groups": build_segment_diagnostics(cohort_rows),
        "rows": cohort_rows,
    }


def capture_decision_lab_env() -> dict[str, Any]:
    """Snapshot env/parametri prediction rilevanti per confronto run."""
    import os

    from prediction.config import PredictionConfig, get_config

    cfg = get_config()
    env_map = PredictionConfig._ENV_BY_FIELD
    out: dict[str, Any] = {}
    for field in DECISION_LAB_CONFIG_FIELDS:
        env_name = env_map.get(field, field.upper())
        out[env_name] = getattr(cfg, field, None)
    for key in DECISION_LAB_ENV_EXTRA:
        if key in os.environ:
            out[key] = os.environ.get(key)
    return out


def env_fingerprint(env: dict[str, Any]) -> str:
    canonical = json.dumps(env, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _source_mtime_iso(path: str | Path | None) -> str | None:
    p = Path(path or PAST_CATALYST_PREDICTIONS_JSON)
    if not p.is_file():
        return None
    return datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat()


def _compact_segment_groups(groups: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for g in groups or []:
        segments = []
        for s in g.get("segments") or []:
            segments.append(
                {
                    "label": s.get("label"),
                    "n_ic_pairs": s.get("n_ic_pairs"),
                    "ic_spearman": s.get("ic_spearman"),
                    "hit_rate_pct": s.get("hit_rate_pct"),
                    "mean_pred_bias_pp": s.get("mean_pred_bias_pp"),
                }
            )
        compact.append({"id": g.get("id"), "title": g.get("title"), "segments": segments})
    return compact


def compact_cohort_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    """Versione leggera per history (no righe evento)."""
    return {
        "generated_at": payload.get("generated_at"),
        "source_mtime": payload.get("source_mtime"),
        "env_snapshot": payload.get("env_snapshot") or {},
        "env_fingerprint": payload.get("env_fingerprint"),
        "summary": dict(payload.get("summary") or {}),
        "summary_by_horizon": {
            hk: dict(s or {}) for hk, s in (payload.get("summary_by_horizon") or {}).items()
        },
        "default_horizon": payload.get("default_horizon"),
        "segment_groups": _compact_segment_groups(payload.get("segment_groups")),
    }


def _delta_num(before: Any, after: Any, *, digits: int = 4) -> float | None:
    b = _num(before)
    a = _num(after)
    if b is None or a is None:
        return None
    return round(a - b, digits)


def build_cohort_comparison(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Delta metriche e env tra due snapshot compatti."""
    prev_sum = previous.get("summary") or {}
    cur_sum = current.get("summary") or {}
    prev_env = previous.get("env_snapshot") or {}
    cur_env = current.get("env_snapshot") or {}

    env_diff: list[dict[str, Any]] = []
    for key in sorted(set(prev_env) | set(cur_env)):
        if prev_env.get(key) != cur_env.get(key):
            env_diff.append({"key": key, "before": prev_env.get(key), "after": cur_env.get(key)})

    prev_seg: dict[tuple[str, str], dict[str, Any]] = {}
    for g in previous.get("segment_groups") or []:
        gid = str(g.get("id") or "")
        for s in g.get("segments") or []:
            prev_seg[(gid, str(s.get("label") or ""))] = s

    segment_delta: list[dict[str, Any]] = []
    for g in current.get("segment_groups") or []:
        gid = str(g.get("id") or "")
        for s in g.get("segments") or []:
            label = str(s.get("label") or "")
            ps = prev_seg.get((gid, label))
            if not ps:
                continue
            segment_delta.append(
                {
                    "group_id": gid,
                    "group_title": g.get("title"),
                    "label": label,
                    "n_ic_pairs": s.get("n_ic_pairs"),
                    "ic_before": ps.get("ic_spearman"),
                    "ic_after": s.get("ic_spearman"),
                    "delta_ic": _delta_num(ps.get("ic_spearman"), s.get("ic_spearman")),
                    "hit_before_pct": ps.get("hit_rate_pct"),
                    "hit_after_pct": s.get("hit_rate_pct"),
                    "delta_hit_pct": _delta_num(ps.get("hit_rate_pct"), s.get("hit_rate_pct"), digits=1),
                }
            )
    segment_delta.sort(
        key=lambda x: (x.get("delta_ic") is not None, x.get("delta_ic") or -999.0),
        reverse=True,
    )

    return {
        "previous_at": previous.get("generated_at"),
        "current_at": current.get("generated_at"),
        "env_changed": bool(env_diff),
        "env_fingerprint_before": previous.get("env_fingerprint"),
        "env_fingerprint_after": current.get("env_fingerprint"),
        "env_diff": env_diff,
        "summary_before": prev_sum,
        "summary_after": cur_sum,
        "summary_delta": {
            "ic_spearman": _delta_num(prev_sum.get("ic_spearman"), cur_sum.get("ic_spearman")),
            "hit_rate_pct": _delta_num(prev_sum.get("hit_rate_pct"), cur_sum.get("hit_rate_pct"), digits=1),
            "mean_r_hold_pp": _delta_num(prev_sum.get("mean_r_hold_pp"), cur_sum.get("mean_r_hold_pp"), digits=2),
            "n_events": _delta_num(prev_sum.get("n_events"), cur_sum.get("n_events"), digits=0),
        },
        "segment_delta": segment_delta,
    }


def read_decision_cohort_history(path: str | Path | None = None) -> list[dict[str, Any]]:
    p = Path(path or INVESTMENT_DECISION_COHORT_HISTORY_JSON)
    if not p.is_file():
        return []
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    rows = doc.get("snapshots") if isinstance(doc, dict) else doc
    return list(rows) if isinstance(rows, list) else []


def write_decision_cohort_history(
    snapshots: list[dict[str, Any]],
    path: str | Path | None = None,
) -> None:
    p = Path(path or INVESTMENT_DECISION_COHORT_HISTORY_JSON)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "snapshots": snapshots[-HISTORY_MAX_ENTRIES:],
    }
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _snapshot_duplicate(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if a.get("env_fingerprint") != b.get("env_fingerprint"):
        return False
    if a.get("source_mtime") != b.get("source_mtime"):
        return False
    sa = a.get("summary") or {}
    sb = b.get("summary") or {}
    for key in ("n_events", "n_ic_pairs", "ic_spearman", "hit_rate_pct"):
        if sa.get(key) != sb.get(key):
            return False
    return True


def write_investment_decision_cohort(
    path: str | Path | None = None,
    *,
    history_path: str | Path | None = None,
    record_history: bool = True,
    **kwargs: Any,
) -> dict[str, Any]:
    past_pred_path = kwargs.get("past_pred_path")
    payload = build_investment_decision_cohort(**kwargs)
    env_snapshot = capture_decision_lab_env()
    payload["env_snapshot"] = env_snapshot
    payload["env_fingerprint"] = env_fingerprint(env_snapshot)
    payload["source_mtime"] = _source_mtime_iso(past_pred_path)

    history: list[dict[str, Any]] = []
    previous: dict[str, Any] | None = None
    if record_history:
        history = read_decision_cohort_history(history_path)
        if history:
            previous = history[-1]

    compact_current = compact_cohort_snapshot(payload)
    if previous:
        payload["comparison"] = build_cohort_comparison(previous, compact_current)

    if record_history:
        if not history or not _snapshot_duplicate(history[-1], compact_current):
            history.append(compact_current)
            write_decision_cohort_history(history, history_path)
        payload["history_tail"] = history[-HISTORY_TAIL_UI:]

    out = Path(path or INVESTMENT_DECISION_COHORT_JSON)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def read_investment_decision_cohort(path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path or INVESTMENT_DECISION_COHORT_JSON)
    if not p.is_file():
        return {"schema_version": 1, "rows": [], "summary": {"n_events": 0}, "error": "file_missing"}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"schema_version": 1, "rows": [], "summary": {"n_events": 0}, "error": str(exc)}
