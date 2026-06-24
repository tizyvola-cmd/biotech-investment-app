#!/usr/bin/env python3
"""
Visualizza le tre «viste» del foglio «Predizione — guida» come grafici μ ± σ.

Legge gli stessi dati di ``refresh_predizione_guida.py`` e replica la logica di coorte /
cluster / Post‑CD usata in ``data_orchestrator._write_prediction_explainer_sheet`` (allineamento
ai valori del foglio Excel dopo refresh).

Uso:
  python plot_predizione_guida.py
  python plot_predizione_guida.py --json data/past_catalyst_predictions.json --out views.png
  python plot_predizione_guida.py --skip-nct-relation-filter
  python plot_predizione_guida.py --diagnose-post-cd-cluster

Richiede: matplotlib, numpy, scikit-learn (come l’orchestrator per il clustering).
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

CLOSE_SPEC = [
    ("close_m60", "close_m60_cal"),
    ("close_m30", "close_m30_cal"),
    ("close_m10", "close_m10_cal"),
    ("close_m7", None),
    ("close_m5", None),
    ("close_m3", None),
    ("close_p3", None),
    ("close_p4", None),
    ("close_p5", None),
    ("close_p7", None),
]
OFF_LABS = ["−60", "−30", "−10", "−7", "−5", "−3", "+3", "+4", "+5", "+7"]
_COLS_N = len(OFF_LABS)


def pred_guida_cluster_legend_label(cid: int, *, reliable: bool = True) -> str:
    """Etichette allineate al workbook (id 1 = SuperNova minoritaria)."""
    if cid == 1 and reliable:
        return "Cluster 1 — SuperNova"
    if cid == 0 and reliable:
        return "Cluster 0 — coorte maggioritaria"
    if cid == 0 and not reliable:
        return "Coorte intera (clustering non affidabile)"
    return f"Cluster {cid}"


def _px(dd: dict, pri: str, cal: str | None):
    v = dd.get(pri)
    if v is not None:
        try:
            return float(v)
        except (TypeError, ValueError):
            pass
    if cal:
        v2 = dd.get(cal)
        if v2 is not None:
            try:
                return float(v2)
            except (TypeError, ValueError):
                pass
    return None


def _past_pred_sponsor_explainer_token(dd: dict) -> str:
    _raw = None
    for _ky in ("sponsor_match", "match_type"):
        _v = (dd or {}).get(_ky)
        if _v is not None and str(_v).strip():
            _raw = str(_v).strip()
            break
    if _raw is None:
        return ""
    _s = _raw.strip().lower().replace("·", " ").replace("–", "-")
    _s = " ".join(_s.split())
    if not _s or _s in ("n/d", "nd", "n.d.", "n.a.", "na", "—", "-", "none"):
        return ""
    if _s in ("exact", "partial"):
        return _s
    _parts = _s.split()
    if _parts and _parts[0] in ("exact", "partial"):
        return _parts[0]
    if _s.startswith("exact"):
        return "exact"
    if _s.startswith("partial"):
        return "partial"
    if _s in ("no match", "nomatch", "unmatch") or _s.startswith("no match"):
        return "no match"
    return _s


def _excl_hist(dd: dict) -> bool:
    if not isinstance(dd, dict):
        return False
    if not bool(dd.get("non_quotata_al_tempo")):
        return False
    try:
        _pre0 = int(dd.get("pre_catalyst_days") or 0) == 0
    except (TypeError, ValueError):
        _pre0 = False
    if not _pre0:
        return False
    if dd.get("price_at_cd") is not None:
        return True
    for _k in ("d1_pct", "d3_pct", "d5_pct", "d10_pct", "d30_pct",
               "close_m60", "close_m30", "close_m10",
               "close_m60_cal", "close_m30_cal", "close_m10_cal", "close_p4"):
        if dd.get(_k) is not None:
            return True
    return False


def _mean_sd(vals: list[float]) -> tuple[float | None, float | None]:
    if not vals:
        return None, None
    m = float(statistics.mean(vals))
    if len(vals) < 2:
        return m, 0.0
    return m, float(statistics.stdev(vals))


def _aggregate_paths(
    keys: list[str],
    src: dict,
) -> list[list[float]]:
    sg: list[list[float]] = [[] for _ in range(_COLS_N)]
    for ck in keys:
        dd = src.get(ck) or {}
        base = _px(dd, "close_m60", "close_m60_cal")
        if base is None or base <= 0:
            continue
        for i, (pri, cal) in enumerate(CLOSE_SPEC):
            pv = _px(dd, pri, cal)
            if pv is None or pv <= 0:
                continue
            sg[i].append((pv / base - 1.0) * 100.0)
    return sg


def _means_sds(series_cols: list[list[float]]) -> tuple[list[float | None], list[float | None]]:
    means: list[float | None] = []
    sds: list[float | None] = []
    for col in series_cols:
        m, s = _mean_sd(col)
        means.append(m)
        sds.append(s)
    return means, sds


def _env_bool(key: str, default: bool) -> bool:
    v = os.environ.get(key)
    if v is None or str(v).strip() == "":
        return default
    return str(v).strip().lower() not in ("0", "false", "no", "off")


def _run_clustering(cohort: list[str], universe: dict) -> tuple[dict[int, list[str]], int]:
    """Ritorna cluster_keys e k_usato (max id cluster)."""
    try:
        k_tgt = max(2, int(os.environ.get("PRED_EXPLAIN_N_CLUSTERS", "2")))
    except ValueError:
        k_tgt = 2
    try:
        min_obs = int(os.environ.get("PRED_EXPLAIN_CLUSTER_MIN_VALID_TP", "6"))
    except ValueError:
        min_obs = 6

    def _rets_ok(k: str) -> tuple[list[float | None], bool]:
        dd = universe.get(k) or {}
        base = _px(dd, "close_m60", "close_m60_cal")
        if base is None or base <= 0:
            return [None] * _COLS_N, False
        out: list[float | None] = []
        for pri, cal in CLOSE_SPEC:
            pv = _px(dd, pri, cal)
            if pv is None or pv <= 0:
                out.append(None)
            else:
                out.append((pv / base - 1.0) * 100.0)
        n_ok = sum(1 for x in out if x is not None)
        return out, n_ok >= min_obs

    cluster_assign: dict[str, int] = {}
    eligible: list[str] = []
    try:
        import numpy as np
        from sklearn.impute import SimpleImputer
        from sklearn.preprocessing import StandardScaler
        from sklearn.cluster import KMeans
        from sklearn.metrics import silhouette_score
        rows: list[list[float]] = []
        for ck in cohort:
            vec, ok = _rets_ok(ck)
            if not ok:
                continue
            eligible.append(ck)
            rows.append([np.nan if x is None else float(x) for x in vec])
        n_r = len(rows)
        if n_r < 4:
            raise RuntimeError("troppo pochi punti per cluster")
        X_imp = SimpleImputer(strategy="mean").fit_transform(np.asarray(rows, dtype=float))
        X_feat = X_imp
        if _env_bool("PRED_EXPLAIN_CLUSTER_ROW_SHAPE", False):
            rm = X_feat.mean(axis=1, keepdims=True)
            rs = X_feat.std(axis=1, keepdims=True)
            rs = np.where(rs < 1e-9, 1.0, rs)
            X_feat = (X_feat - rm) / rs
        if _env_bool("PRED_EXPLAIN_CLUSTER_USE_DELTAS", True):
            X_feat = np.hstack([X_feat, np.diff(X_feat, axis=1)])
        Xs = StandardScaler().fit_transform(X_feat)
        k_hi = max(2, min(k_tgt, n_r - 1))
        k_use = k_hi
        try:
            sil_min = int(os.environ.get("PRED_EXPLAIN_CLUSTER_SILHOUETTE_MIN_N", "8"))
        except ValueError:
            sil_min = 8
        if _env_bool("PRED_EXPLAIN_CLUSTER_SILHOUETTE_K", True) and n_r >= sil_min and k_hi >= 2:
            best_k, best_sc = 2, -1.0
            for k in range(2, k_hi + 1):
                try:
                    lab_t = KMeans(n_clusters=k, random_state=0, n_init=10).fit_predict(Xs)
                except Exception:
                    continue
                if len(np.unique(lab_t)) < 2:
                    continue
                try:
                    sc = float(silhouette_score(Xs, lab_t))
                except Exception:
                    continue
                if sc > best_sc:
                    best_sc = sc
                    best_k = k
            if best_sc >= 0:
                k_use = best_k
        labels = KMeans(n_clusters=k_use, random_state=0, n_init=10).fit_predict(Xs)
        for ii, kk in enumerate(eligible):
            cluster_assign[kk] = int(labels[ii])
        for ck in cohort:
            if ck not in cluster_assign:
                cluster_assign[ck] = 0
    except Exception:
        for ck in cohort:
            cluster_assign[ck] = 0

    from data_orchestrator import _canonicalize_supernova_kmeans_two_clusters

    _ca2, cluster_keys, _ = _canonicalize_supernova_kmeans_two_clusters(
        cluster_assign,
        cohort,
        eligible_for_swap=frozenset(eligible) if eligible else None,
    )
    cluster_assign.clear()
    cluster_assign.update(_ca2)
    return cluster_keys, max(cluster_keys.keys()) if cluster_keys else 0


def _post_cd_split(
    cohort: list[str],
    universe: dict,
    eps_pp: float,
) -> tuple[list[str], list[str]]:
    try:
        min_pre = int(os.environ.get("PRED_EXPLAIN_POST_CD_MIN_PRE", "2"))
    except ValueError:
        min_pre = 2
    try:
        min_post = int(os.environ.get("PRED_EXPLAIN_POST_CD_MIN_POST", "2"))
    except ValueError:
        min_post = 2
    idx_pre = (3, 4, 5)
    idx_post = (6, 7, 8, 9)
    up_k: list[str] = []
    dn_k: list[str] = []
    neu_k: list[str] = []

    for ck in cohort:
        dd = universe.get(ck) or {}
        base = _px(dd, "close_m60", "close_m60_cal")
        if base is None or base <= 0:
            continue
        rets: list[float | None] = []
        for pri, cal in CLOSE_SPEC:
            pv = _px(dd, pri, cal)
            if pv is None or pv <= 0:
                rets.append(None)
            else:
                rets.append((pv / base - 1.0) * 100.0)
        pre_v = [rets[i] for i in idx_pre if rets[i] is not None]
        post_v = [rets[i] for i in idx_post if rets[i] is not None]
        if len(pre_v) < min_pre or len(post_v) < min_post:
            continue
        pre_m = sum(pre_v) / len(pre_v)
        post_m = sum(post_v) / len(post_v)
        dlt = post_m - pre_m
        if dlt > eps_pp:
            up_k.append(ck)
        elif dlt < -eps_pp:
            dn_k.append(ck)
        else:
            neu_k.append(ck)
    return up_k, dn_k, neu_k


def post_cd_cluster_diagnostic(
    cohort: list[str],
    universe: dict,
    eps_pp: float,
    cluster_keys: dict[int, list[str]],
) -> dict:
    """
    Incrocia la classificazione supervisionata Post‑CD (rialzo / ribasso / altro)
    con i cluster k‑means (stessa coorte primaria del foglio «Predizione — guida»).

    Utile per capire se rialzo/ribasso sono sottogruppi quasi esclusivi della coorte SuperNova (cluster 1)
    oppure se coinvolgono in misura rilevante anche la coorte maggioritaria (cluster 0).
    """
    up_k, dn_k, _neu_k = _post_cd_split(cohort, universe, eps_pp)
    up_s, dn_s = set(up_k), set(dn_k)
    cohort_s = set(cohort)

    cid_by_key: dict[str, int] = {}
    for cid in sorted(cluster_keys.keys()):
        for ck in cluster_keys.get(cid) or []:
            cid_by_key[str(ck)] = int(cid)

    cids = sorted(cluster_keys.keys())
    by_cluster: dict[str, dict[str, float | int]] = {}
    for cid in cids:
        ks = set(cluster_keys.get(cid) or [])
        n = len(ks)
        u = len(ks & up_s)
        d = len(ks & dn_s)
        ne = n - u - d
        by_cluster[str(cid)] = {
            "n": n,
            "post_up": u,
            "post_dn": d,
            "post_neither": ne,
            "frac_post_up_of_cluster": round(100.0 * u / n, 1) if n else None,
            "frac_post_dn_of_cluster": round(100.0 * d / n, 1) if n else None,
            "frac_post_neither_of_cluster": round(100.0 * ne / n, 1) if n else None,
        }

    by_post: dict[str, dict[str, int | float | None]] = {}
    for label, s in (("post_up", up_s), ("post_dn", dn_s)):
        n = len(s)
        row: dict[str, int | float | None] = {"n": n}
        if n:
            for cid in cids:
                cnt = len(s & set(cluster_keys.get(cid) or []))
                row[f"cluster_{cid}"] = cnt
                row[f"frac_in_cluster_{cid}"] = round(100.0 * cnt / n, 1)
        by_post[label] = row

    neither_s = cohort_s - up_s - dn_s
    neither_row: dict[str, int | float | None] = {"n": len(neither_s)}
    if neither_s:
        for cid in cids:
            cnt = len(neither_s & set(cluster_keys.get(cid) or []))
            neither_row[f"cluster_{cid}"] = cnt
            neither_row[f"frac_in_cluster_{cid}"] = (
                round(100.0 * cnt / len(neither_s), 1) if neither_s else None
            )
    by_post["post_neither"] = neither_row

    return {
        "eps_pp": eps_pp,
        "n_cohort": len(cohort),
        "n_post_up": len(up_k),
        "n_post_dn": len(dn_k),
        "n_post_neither": len(neither_s),
        "cluster_ids": [int(x) for x in cids],
        "by_cluster": by_cluster,
        "by_post": by_post,
    }


def format_post_cd_cluster_diagnostic(diag: dict | None) -> str:
    """Testo compatto (Italiano) per CLI o nota Excel."""
    if not isinstance(diag, dict) or not diag:
        return ""
    lines: list[str] = []
    eps = diag.get("eps_pp")
    lines.append(
        "Diagnostica Post-CD x cluster (stessi criteri del foglio; eps "
        f"{eps:g} pp sulla media post - pre)."
    )
    lines.append(
        "I cluster sono una partizione k-means sulla traiettoria; Post-CD rialzo/ribasso "
        "sono due sottoinsiemi supervisionati indipendenti. I numeri sotto mostrano "
        "quanto si sovrappongono nella tua coorte attuale."
    )
    lines.append(
        f"Coorte primaria N={diag.get('n_cohort', '-')} | Post-CD rialzo N={diag.get('n_post_up', '-')} "
        f"| ribasso N={diag.get('n_post_dn', '-')} | ne rialzo ne ribasso (dati insufficienti / "
        f"delta entro +/- eps) N={diag.get('n_post_neither', '-')}"
    )
    by_c = diag.get("by_cluster") or {}
    if by_c:
        lines.append("Per cluster (conteggi assoluti):")
        for cid in sorted(by_c.keys(), key=lambda x: int(x)):
            row = by_c[cid]
            lines.append(
                f"  cluster {cid}: N={row.get('n', '-')} | rialzo={row.get('post_up', '-')} "
                f"({row.get('frac_post_up_of_cluster', '-')}%) | ribasso={row.get('post_dn', '-')} "
                f"({row.get('frac_post_dn_of_cluster', '-')}%) | altro={row.get('post_neither', '-')} "
                f"({row.get('frac_post_neither_of_cluster', '-')}%)"
            )
    by_p = diag.get("by_post") or {}
    pu = by_p.get("post_up") or {}
    pd_ = by_p.get("post_dn") or {}
    if pu.get("n"):
        lines.append(
            "Tra i soli titoli classificati Post-CD rialzo: "
            + ", ".join(
                f"{pu.get(f'frac_in_cluster_{c}', '-')}% in cluster {c}"
                for c in diag.get("cluster_ids") or []
                if f"frac_in_cluster_{c}" in pu
            )
            + "."
        )
    if pd_.get("n"):
        lines.append(
            "Tra i soli titoli classificati Post-CD ribasso: "
            + ", ".join(
                f"{pd_.get(f'frac_in_cluster_{c}', '-')}% in cluster {c}"
                for c in diag.get("cluster_ids") or []
                if f"frac_in_cluster_{c}" in pd_
            )
            + "."
        )
    n_co = int(diag.get("n_cohort") or 0)
    if n_co > 0 and by_c:
        _sizes = sorted(
            [(int(cid), int(row.get("n") or 0)) for cid, row in by_c.items()],
            key=lambda t: t[1],
        )
        if _sizes:
            _n_min = _sizes[0][1]
            if _n_min < max(5, int(0.03 * n_co)):
                lines.append(
                    f"Nota: almeno un cluster ha N={_n_min} (su {n_co} in coorte): la partizione k-means "
                    "è molto sbilanciata. Il cluster 1 (SuperNova) è la minoranza: è normale che la maggior "
                    "parte dei titoli Post-CD rialzo/ribasso compaia in cluster 0 (coorte maggioritaria), "
                    "senza implicare che l'esito Post-CD sia indipendente dalla forma di traiettoria."
                )
    lines.append(
        "Interpretazione: Post-CD rialzo e ribasso sono due sottoinsiemi disgiunti della coorte "
        "(ogni titolo va in al massimo uno dei due); il cluster 1 (SuperNova) contiene in genere entrambi i tipi "
        "oltre ai titoli 'altro'. Non sono due alternative che esauriscono il cluster 1: controlla "
        "i conteggi rialzo/ribasso/altro sulla riga del cluster 0 (coorte maggioritaria) e del cluster 1 (SuperNova)."
    )
    return "\n".join(lines)


def _primary_eligible(dd: dict, row_key: str, ppd: dict, universe: dict) -> bool:
    from data_orchestrator import _is_restricted_nct_relation, _norm_nct_relation_label

    if _excl_hist(dd):
        return False
    if _past_pred_sponsor_explainer_token(dd) not in ("exact", "partial"):
        return False
    if row_key in ppd:
        return True
    if _is_restricted_nct_relation(dd.get("nct_relation_type")):
        return True
    if not ppd:
        rs = _norm_nct_relation_label(dd.get("nct_relation_type"))
        return rs in ("", "n/d", "nd", "n.d.", "n.a.", "na", "—", "-", "none")
    return False


def compute_bundle(
    ppd: dict,
    ppd_ctrl: dict,
) -> dict:
    from datetime import date as date_cls

    def cd_key_u(k: str):
        return (ppd_ctrl.get(k) or {}).get("completion_date") or date_cls.min

    keys_sorted = sorted(ppd_ctrl.keys(), key=cd_key_u, reverse=True)
    cohort: list[str] = []
    cohort_ctrl: list[str] = []

    from data_orchestrator import _past_pred_is_control_sponsor_cohort

    def ctrl_nm(dd: dict) -> bool:
        return _past_pred_is_control_sponsor_cohort(dd)

    for k in keys_sorted:
        dd = ppd_ctrl.get(k) or {}
        if _primary_eligible(dd, k, ppd, ppd_ctrl):
            cohort.append(k)
    for k in keys_sorted:
        dd = ppd_ctrl.get(k) or {}
        if _excl_hist(dd):
            continue
        if _past_pred_sponsor_explainer_token(dd) in ("exact", "partial"):
            continue
        if ctrl_nm(dd):
            cohort_ctrl.append(k)

    from prediction.clustering import cluster_trajectories, guida_clusters_to_render
    from prediction.config import get_config

    _pred_cfg = get_config()
    try:
        _min_obs_tp = int(os.environ.get("PRED_EXPLAIN_CLUSTER_MIN_VALID_TP", "6"))
    except ValueError:
        _min_obs_tp = _pred_cfg.pred_explain_cluster_min_valid_tp

    def _rets_vec_ok_for_cluster(k: str, src: dict) -> tuple[list[float | None], bool]:
        dd = src.get(k) or {}
        base = _px(dd, "close_m60", "close_m60_cal")
        if base is None or base <= 0:
            return [None] * _COLS_N, False
        out: list[float | None] = []
        for pri, cal in CLOSE_SPEC:
            pv = _px(dd, pri, cal)
            if pv is None or pv <= 0:
                out.append(None)
            else:
                out.append((pv / base - 1.0) * 100.0)
        n_ok = sum(1 for x in out if x is not None)
        return out, n_ok >= _min_obs_tp

    features: dict[str, list[float | None]] = {}
    for ck in cohort:
        vec, ok = _rets_vec_ok_for_cluster(ck, ppd_ctrl)
        if ok:
            features[ck] = vec
    cl_res = cluster_trajectories(features, cohort, config=_pred_cfg)
    cluster_reliable = bool(cl_res.reliable)
    cluster_ids, cluster_keys_render = guida_clusters_to_render(cl_res, cohort)
    cluster_keys = {cid: cluster_keys_render.get(cid, []) for cid in cluster_ids}

    sg = _aggregate_paths(cohort, ppd_ctrl)
    sg_ctrl = _aggregate_paths(cohort_ctrl, ppd_ctrl)
    mg, sglob_sd = _means_sds(sg)
    mc, sctrl_sd = _means_sds(sg_ctrl)

    clusters_ms: dict[int, tuple[list[float | None], list[float | None]]] = {}
    for cid in cluster_ids:
        if not cluster_reliable and cid == 0:
            clusters_ms[cid] = (mg, sglob_sd)
        else:
            keys_c = cluster_keys_render.get(cid) or []
            sc = _aggregate_paths(keys_c, ppd_ctrl)
            clusters_ms[cid] = _means_sds(sc)

    try:
        eps = float(os.environ.get("PRED_EXPLAIN_POST_CD_SPLIT_EPS_PP", "0.25"))
    except ValueError:
        eps = 0.25
    up_k, dn_k, neu_k = _post_cd_split(cohort, ppd_ctrl, eps)
    sup = _aggregate_paths(up_k, ppd_ctrl)
    sdn = _aggregate_paths(dn_k, ppd_ctrl)
    sneu = _aggregate_paths(neu_k, ppd_ctrl)
    m_up, s_up = _means_sds(sup)
    m_dn, s_dn = _means_sds(sdn)
    m_neu, s_neu = _means_sds(sneu)

    post_cd_cluster_diagnostic_payload = post_cd_cluster_diagnostic(
        cohort, ppd_ctrl, eps, cluster_keys
    )

    frac: list[float | None] = []
    for j in range(_COLS_N):
        mu_g, sig_g = mg[j], sglob_sd[j]
        if mu_g is None or sig_g is None:
            frac.append(None)
            continue
        lo, hi = mu_g - 2.0 * sig_g, mu_g + 2.0 * sig_g
        hit = tot = 0
        for k in cohort:
            dd = ppd_ctrl.get(k) or {}
            base = _px(dd, "close_m60", "close_m60_cal")
            if base is None or base <= 0:
                continue
            pri, cal = CLOSE_SPEC[j]
            pv = _px(dd, pri, cal)
            if pv is None or pv <= 0:
                continue
            v = (pv / base - 1.0) * 100.0
            tot += 1
            if lo <= v <= hi:
                hit += 1
        frac.append(100.0 * hit / tot if tot else None)

    return {
        "off_labs": list(OFF_LABS),
        "globale": (mg, sglob_sd),
        "controllo": (mc, sctrl_sd),
        "clusters": clusters_ms,
        "cluster_reliable": cluster_reliable,
        "post_rialzo": (m_up, s_up),
        "post_ribasso": (m_dn, s_dn),
        "post_neutro": (m_neu, s_neu),
        "frac_in_glob_band": frac,
        "n_cohort": len(cohort),
        "n_ctrl": len(cohort_ctrl),
        "n_post_up": len(up_k),
        "n_post_dn": len(dn_k),
        "n_post_neu": len(neu_k),
        "post_cd_cluster_diagnostic": post_cd_cluster_diagnostic_payload,
    }


def _plot_series(
    ax,
    title: str,
    series: list[tuple[str, list[float | None], list[float | None], str | None]],
    show_frac: bool = False,
    frac: list[float | None] | None = None,
    band_means: tuple[list[float | None], list[float | None]] | None = None,
):
    import matplotlib.pyplot as plt
    import numpy as np

    x = np.arange(_COLS_N)
    ax.set_xticks(x)
    ax.set_xticklabels(OFF_LABS, fontsize=8, rotation=35, ha="right")
    ax.axhline(0.0, color="#bbbbbb", linewidth=0.8, zorder=0)
    ax.set_title(title, fontsize=11)
    ax.set_ylabel("% vs −60 sessioni")

    if band_means is not None:
        bm, bs = band_means
        y_lo = []
        y_hi = []
        for j in range(_COLS_N):
            m, s = bm[j], bs[j]
            if m is None or s is None:
                y_lo.append(np.nan)
                y_hi.append(np.nan)
            else:
                y_lo.append(m - 2 * s)
                y_hi.append(m + 2 * s)
        ax.fill_between(
            x,
            y_lo,
            y_hi,
            color="#cccccc",
            alpha=0.35,
            label="μ glob ± 2σ glob",
            zorder=1,
        )

    prop_cycle = plt.rcParams["axes.prop_cycle"].by_key()["color"]
    for i, (lab, means, sds, color) in enumerate(series):
        c = color or prop_cycle[i % len(prop_cycle)]
        ym = [float(means[j]) if means[j] is not None else np.nan for j in range(_COLS_N)]
        ys = [
            float(sds[j]) if sds[j] is not None else np.nan for j in range(_COLS_N)
        ]
        ax.plot(x, ym, "o-", label=lab, color=c, linewidth=1.8, markersize=4, zorder=3)
        ax.fill_between(
            x,
            np.array(ym) - np.array(ys),
            np.array(ym) + np.array(ys),
            alpha=0.18,
            color=c,
            zorder=2,
        )

    if show_frac and frac:
        ax2 = ax.twinx()
        yf = [float(frac[j]) if frac[j] is not None else np.nan for j in range(_COLS_N)]
        ax2.bar(x + 0.15, yf, width=0.28, alpha=0.35, color="#7cb342", label="% in μ_glob±2σ")
        ax2.set_ylabel("% oss. in fascia", fontsize=9, color="#558b2f")
        ax2.set_ylim(0, 105)
        ax2.tick_params(axis="y", labelcolor="#558b2f")

    ax.legend(loc="upper left", fontsize=7)
    ax.grid(True, alpha=0.25)


def build_tre_viste_figure(bundle: dict):
    """
    Costruisce la figura matplotlib con i tre pannelli (riepilogo, numerica+fascia, Post‑CD).
    Usata dal CLI e da ``_write_prediction_explainer_sheet`` per incorporarla nell’Excel.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    mg, sg = bundle["globale"]
    mc, sc = bundle["controllo"]
    mup, sup = bundle["post_rialzo"]
    mdn, sdn = bundle["post_ribasso"]

    fig, axes = plt.subplots(3, 1, figsize=(11.5, 12), constrained_layout=True)
    fig.suptitle(
        "Predizione — guida · distribuzione μ ± σ (tre viste tabella)",
        fontsize=13,
        fontweight="bold",
    )

    _cl_rel = bool(bundle.get("cluster_reliable", True))
    s1 = [
        ("Globale primaria", mg, sg, None),
        ("Post-CD rialzo", mup, sup, None),
        ("Post-CD ribasso", mdn, sdn, None),
    ]
    for cid in sorted(bundle["clusters"].keys()):
        cm, cs = bundle["clusters"][cid]
        s1.append((pred_guida_cluster_legend_label(cid, reliable=_cl_rel), cm, cs, None))
    s1.append(("Controllo non match", mc, sc, None))
    _plot_series(
        axes[0],
        f"Vista 1 — Riepilogo (N primaria={bundle['n_cohort']}, controllo={bundle['n_ctrl']})",
        s1,
    )

    s2 = [("Globale primaria", mg, sg, None)]
    for cid in sorted(bundle["clusters"].keys()):
        cm, cs = bundle["clusters"][cid]
        s2.append((pred_guida_cluster_legend_label(cid, reliable=_cl_rel), cm, cs, None))
    s2.append(("Controllo non match", mc, sc, None))
    _plot_series(
        axes[1],
        "Vista 2 — Numerica principale (cluster + controllo · fascia μ glob ± 2σ)",
        s2,
        show_frac=True,
        frac=bundle["frac_in_glob_band"],
        band_means=(mg, sg),
    )

    s3 = [
        ("Globale primaria", mg, sg, None),
        ("Post-CD rialzo", mup, sup, None),
        ("Post-CD ribasso", mdn, sdn, None),
        ("Controllo non match", mc, sc, None),
    ]
    _plot_series(
        axes[2],
        f"Vista 3 — Post-CD supervisionato (rialzo N={bundle['n_post_up']}, ribasso N={bundle['n_post_dn']})",
        s3,
    )
    return fig


def main() -> int:
    ap = argparse.ArgumentParser(description="Plot predizione guida — tre viste tabella.")
    ap.add_argument("--json", default=None, help="past_catalyst_predictions.json")
    ap.add_argument("--skip-nct-relation-filter", action="store_true")
    ap.add_argument(
        "--diagnose-post-cd-cluster",
        action="store_true",
        help="Stampa incrocio Post‑CD rialzo/ribasso × cluster (stdout) e termina senza grafico.",
    )
    ap.add_argument("-o", "--out", default="predizione_guida_tre_viste.png")
    ap.add_argument("--dpi", type=int, default=140)
    args = ap.parse_args()

    from refresh_predizione_guida import _load_past_pred_map
    from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
    from data_orchestrator import _filter_past_pred_data_by_restricted_nct_relation

    json_path = os.path.abspath(args.json or PAST_CATALYST_PREDICTIONS_JSON)
    pp_pre = _load_past_pred_map(json_path)
    if not pp_pre:
        print(f"[plot] Nessun dato in {json_path}", file=sys.stderr)
        return 1

    pp_filt = _filter_past_pred_data_by_restricted_nct_relation(dict(pp_pre))
    if args.skip_nct_relation_filter:
        ppd = dict(pp_pre)
        print(f"[plot] Pre={len(pp_pre)} | filtro NCT: OFF")
    else:
        ppd = dict(pp_filt)
        print(f"[plot] Pre={len(pp_pre)} | dopo filtro NCT={len(pp_filt)}")
        if len(pp_filt) == 0 and len(pp_pre) > 0:
            print(
                "[plot] Suggerimento: --skip-nct-relation-filter se il JSON non ha relazioni NCT.",
                file=sys.stderr,
            )

    ppd_ctrl = dict(pp_pre)
    b = compute_bundle(ppd, ppd_ctrl)

    if args.diagnose_post_cd_cluster:
        txt = format_post_cd_cluster_diagnostic(b.get("post_cd_cluster_diagnostic"))
        print(txt or "[plot] Diagnostica vuota.", flush=True)
        return 0

    import matplotlib.pyplot as plt

    fig = build_tre_viste_figure(b)

    out_path = os.path.abspath(args.out)
    fig.savefig(out_path, dpi=args.dpi)
    print(f"[plot] Salvato → {out_path}")
    plt.close(fig)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
