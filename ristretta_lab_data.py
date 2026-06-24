"""
Dati coorte **Ristretta** (CD ±7, Exact/Partial) per il Data Lab.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, PAST_CATALYST_PREDICTIONS_JSON

# 10 nodi «Predizione — guida» (sessioni / calendario misti)
_GUIDA_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 3, 4, 5, 7)
# 8 nodi tabella / Simulation / CD+7
TABLE_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4, 7)

_RESTRICTED_REL = frozenset({
    "direct sponsor",
    "collaborator",
    "correlated company/subsidiary",
})


@dataclass
class RistrettaCompany:
    key: str
    ticker: str
    company: str
    cd: date
    days_to_cd: int
    curve_pct: list[float | None] = field(default_factory=list)
    pred_pct: list[float | None] = field(default_factory=list)
    stor_pct: list[float | None] = field(default_factory=list)
    direction: str = "—"
    cluster_id: int | None = None
    rmse_pp: float | None = None
    result: str = "—"


def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _parse_cd(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date):
        return v
    if hasattr(v, "date") and callable(v.date):
        try:
            d = v.date()
            if isinstance(d, date):
                return d
        except Exception:
            pass
    s = str(v).strip()[:10]
    if not s or s in ("—", "-", "N/D", "n/d"):
        return None
    try:
        return date.fromisoformat(s.replace("/", "-") if "/" in s[:10] else s)
    except ValueError:
        return None


def _sponsor_ok(v: Any) -> bool:
    return str(v or "").strip().lower() in ("exact", "partial")


def _relation_ok(v: Any) -> bool:
    s = str(v or "").strip().lower().replace("·", " ")
    s = " ".join(s.split())
    if not s or s in ("n/d", "nd", "—", "-", "none"):
        return True
    return s in _RESTRICTED_REL


def load_past_pred_map(path: str | Path | None = None) -> dict[str, dict]:
    p = Path(path or PAST_CATALYST_PREDICTIONS_JSON)
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rows = doc.get("rows") if isinstance(doc, dict) else doc
    if not isinstance(rows, dict):
        return {}
    out: dict[str, dict] = {}
    for k, r in rows.items():
        if isinstance(r, dict):
            out[str(k)] = r
    return out


def subsample_guida_to_table(series10: list[float | None]) -> list[float | None]:
    if len(series10) < len(_GUIDA_OFFSETS):
        series10 = list(series10) + [None] * (len(_GUIDA_OFFSETS) - len(series10))
    lut = {off: series10[i] for i, off in enumerate(_GUIDA_OFFSETS)}
    return [lut.get(off) for off in TABLE_OFFSETS]


def _trajectory_10(dd: dict) -> list[float | None]:
    from plot_predizione_guida import CLOSE_SPEC, _px

    base = _px(dd, "close_m60", "close_m60_cal")
    if base is None or base <= 0:
        return [None] * len(_GUIDA_OFFSETS)
    out: list[float | None] = []
    for pri, cal in CLOSE_SPEC:
        pv = _px(dd, pri, cal)
        if pv is None or pv <= 0:
            out.append(None)
        else:
            out.append((pv / base - 1.0) * 100.0)
    return out


def _curve_arrays(dd: dict) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """(curva, pred, storico) agli 8 offset tabella."""
    import data_orchestrator as _orch

    pw = dict(dd)
    _orch._accuracy_sim_impute_missing_pre_cd_model_pcts(pw)
    _orch._accuracy_sim_synthesize_interp_nodes_from_post_d_only(pw)
    pred = _orch._interp_pred_pct_vs_m60_calendar(pw, TABLE_OFFSETS)
    stor = _orch._sn7_traj_pct_at_table_offsets(pw, TABLE_OFFSETS)
    seq = pw.get("seq_curve_pct_vs_m60")
    curva: list[float | None] = []
    for i, off in enumerate(TABLE_OFFSETS):
        ps = None
        if isinstance(seq, list) and i < len(seq) and seq[i] is not None:
            ps = _safe_float(seq[i])
        if ps is not None:
            curva.append(ps)
        elif stor[i] is not None:
            curva.append(stor[i])
        elif pred[i] is not None:
            curva.append(pred[i])
        else:
            curva.append(None)
    return curva, pred, stor


def _rmse(a: list[float | None], b: list[float | None]) -> float | None:
    sq: list[float] = []
    for x, y in zip(a, b):
        if x is None or y is None:
            continue
        sq.append((float(x) - float(y)) ** 2)
    if len(sq) < 3:
        return None
    return round(math.sqrt(sum(sq) / len(sq)), 2)


def _result_label(direction: str, curve: list[float | None]) -> str:
    d = str(direction or "").strip()
    if d.startswith("↑"):
        return "Success"
    if d.startswith("↓"):
        return "Failure"
    for v in curve:
        if v is not None and abs(v) > 0.5:
            return "Success" if v > 0 else "Failure"
    return "Neutral"


def _curve_peak_pp(curve: list[float | None] | None) -> float | None:
    if not curve:
        return None
    vals = [float(x) for x in curve if x is not None]
    return max(vals) if vals else None


def _swap_cluster_ref_means_if_inverted(
    mean0: list[float | None] | None,
    mean1: list[float | None] | None,
    *,
    min_gap_pp: float = 8.0,
) -> tuple[list[float | None] | None, list[float | None] | None]:
    """
    k-means id 1 = minority count, not always surge shape. When the minority μ is
    flatter than the majority μ, swap the reference curves for Cluster 0 / SuperNova.
    """
    if not mean0 or not mean1:
        return mean0, mean1
    p0 = _curve_peak_pp(mean0)
    p1 = _curve_peak_pp(mean1)
    if p0 is None or p1 is None or p0 <= p1 + min_gap_pp:
        return mean0, mean1
    return mean1, mean0


def build_reference_curves_from_bundle(bundle: dict) -> dict[str, list[float | None]]:
    """μ da «Predizione — guida» (globale, cluster, controllo, post-CD)."""
    refs: dict[str, list[float | None]] = {}
    mg, _ = bundle.get("globale") or (None, None)
    mc, _ = bundle.get("controllo") or (None, None)
    if mg:
        refs["Globale primaria"] = subsample_guida_to_table(list(mg))
    if mc:
        refs["controllo negativo"] = subsample_guida_to_table(list(mc))
    clusters = bundle.get("clusters") or {}
    mean0 = list(clusters[0][0]) if 0 in clusters else None
    mean1 = list(clusters[1][0]) if 1 in clusters else None
    mean0, mean1 = _swap_cluster_ref_means_if_inverted(mean0, mean1)
    if mean0 is not None:
        refs["Cluster 0"] = subsample_guida_to_table(mean0)
    if mean1 is not None:
        refs["SuperNova (cl.1)"] = subsample_guida_to_table(mean1)
    m_up, _ = bundle.get("post_rialzo") or (None, None)
    m_dn, _ = bundle.get("post_ribasso") or (None, None)
    m_neu, _ = bundle.get("post_neutro") or (None, None)
    if m_up:
        refs["Post-CD rialzo"] = subsample_guida_to_table(list(m_up))
    if m_dn:
        refs["Post-CD ribasso"] = subsample_guida_to_table(list(m_dn))
    if m_neu:
        refs["Post-CD neutro"] = subsample_guida_to_table(list(m_neu))
    return refs


def build_reference_curves(ppd: dict[str, dict]) -> dict[str, list[float | None]]:
    from plot_predizione_guida import compute_bundle

    return build_reference_curves_from_bundle(compute_bundle(ppd, ppd))


def pick_ristretta_cohort(
    ppd: dict[str, dict],
    *,
    today: date | None = None,
    window_days: int = 7,
) -> list[tuple[str, date, dict]]:
    today = today or date.today()
    w = timedelta(days=int(window_days))
    out: list[tuple[str, date, dict]] = []
    for pk, r in ppd.items():
        if not isinstance(r, dict):
            continue
        if not _sponsor_ok(r.get("sponsor_match")):
            continue
        if not _relation_ok(r.get("nct_relation_type")):
            continue
        cd = _parse_cd(r.get("completion_date"))
        if cd is None:
            continue
        if today > cd + w or cd > today + w:
            continue
        out.append((pk, cd, r))
    out.sort(key=lambda t: t[1])
    return out


def build_ristretta_bundle(
    *,
    past_pred_path: str | Path | None = None,
    today: date | None = None,
    window_days: int = 7,
    max_companies: int = 24,
) -> dict[str, Any]:
    """
    Carica coorte Ristretta + curve + riferimenti.

    Ritorna dict con ``companies``, ``references``, ``n_cohort``, ``note``.
    """
    ppd = load_past_pred_map(past_pred_path)
    today = today or date.today()
    cohort = pick_ristretta_cohort(ppd, today=today, window_days=window_days)
    note_parts: list[str] = []
    if not cohort:
        note_parts.append(
            f"Nessuno studio con CD in [oggi±{window_days}] e sponsor Exact/Partial nel JSON."
        )
    rel_missing = sum(
        1 for _, _, r in cohort if not str(r.get("nct_relation_type") or "").strip()
    )
    if rel_missing and cohort:
        note_parts.append(
            f"Relazione CT assente su {rel_missing}/{len(cohort)} righe "
            "(filtro CT applicato solo se valorizzato)."
        )

    refs: dict[str, list[float | None]] = {}
    cluster_by_key: dict[str, int] = {}
    try:
        from plot_predizione_guida import _primary_eligible, _run_clustering, compute_bundle

        b = compute_bundle(ppd, ppd)
        refs = build_reference_curves_from_bundle(b)
        cohort_keys = [
            k
            for k in ppd
            if _primary_eligible(ppd[k], k, ppd, ppd)
        ]
        cluster_keys, _ = _run_clustering(
            cohort_keys[:8000] if cohort_keys else list(ppd.keys())[:8000],
            ppd,
        )
        for cid, keys in (cluster_keys or {}).items():
            for k in keys or []:
                cluster_by_key[str(k)] = int(cid)
    except Exception as exc:
        note_parts.append(f"Curve riferimento: {exc}")

    companies: list[RistrettaCompany] = []
    ref_super = refs.get("SuperNova (cl.1)")
    ref_c0 = refs.get("Cluster 0")

    for pk, cd, r in cohort[: max(1, max_companies)]:
        tk = str(r.get("ticker") or pk.split("|")[0]).strip().upper()
        nm = str(
            r.get("company_name_full")
            or r.get("companyName")
            or r.get("name")
            or tk
        ).strip() or tk
        curva, pred, stor = _curve_arrays(r)
        direction = str(r.get("direction") or r.get("dir_v4") or "—").strip()
        cid = cluster_by_key.get(pk)
        ref = ref_super if cid == 1 else ref_c0 if cid == 0 else ref_super or ref_c0
        rmse = _rmse(curva, ref) if ref else None
        companies.append(
            RistrettaCompany(
                key=pk,
                ticker=tk,
                company=nm,
                cd=cd,
                days_to_cd=(cd - today).days,
                curve_pct=curva,
                pred_pct=pred,
                stor_pct=stor,
                direction=direction,
                cluster_id=cid,
                rmse_pp=rmse,
                result=_result_label(direction, curva),
            )
        )

    return {
        "companies": companies,
        "references": refs,
        "n_cohort": len(cohort),
        "offsets": list(TABLE_OFFSETS),
        "note": " · ".join(note_parts) if note_parts else "",
        "loaded_at": today.isoformat(),
    }
