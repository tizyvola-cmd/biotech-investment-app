#!/usr/bin/env python3
"""
Analisi empirica k-means sulla coorte «Predizione — guida» (traiettorie % vs −60).

Mostra come i dati si partizionano **prima** del riallineamento SuperNova (id 1 = minoranza)
e confronta k=2…k_max (silhouette, dimensioni cluster).

Uso:
  python scripts/check_cluster_empirico.py
  python scripts/check_cluster_empirico.py path/to/past_catalyst_predictions.json
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

_CLOSE_SPEC = [
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
_TP_LABELS = ["m60", "m30", "m10", "m7", "m5", "m3", "p3", "p4", "p5", "p7"]


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


def _build_cohort_and_features(universe: dict) -> tuple[list[str], dict[str, list[float | None]]]:
    from data_orchestrator import (
        _filter_past_pred_data_by_restricted_nct_relation,
        _is_restricted_nct_relation,
        _norm_nct_relation_label,
    )
    from datetime import date as _date_cls

    _ppd = _filter_past_pred_data_by_restricted_nct_relation(universe)
    _cols_n = len(_CLOSE_SPEC)

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
        for _k in (
            "d1_pct", "d3_pct", "d5_pct", "d10_pct", "d30_pct",
            "close_m60", "close_m30", "close_m10",
            "close_m60_cal", "close_m30_cal", "close_m10_cal", "close_p4",
        ):
            if dd.get(_k) is not None:
                return True
        return False

    def _primary_eligible(dd: dict, row_key: str) -> bool:
        if _excl_hist(dd):
            return False
        if _past_pred_sponsor_explainer_token(dd) not in ("exact", "partial"):
            return False
        if row_key in _ppd:
            return True
        if _is_restricted_nct_relation(dd.get("nct_relation_type")):
            return True
        if not _ppd:
            _rs = _norm_nct_relation_label(dd.get("nct_relation_type"))
            return _rs in ("", "n/d", "nd", "n.d.", "n.a.", "na", "—", "-", "none")
        return False

    def _get_cd_key_u(k):
        return (universe.get(k) or {}).get("completion_date") or _date_cls.min

    _keys_u_sorted = sorted(universe.keys(), key=_get_cd_key_u, reverse=True)
    cohort: list[str] = []
    for _k in _keys_u_sorted:
        if _primary_eligible(universe.get(_k) or {}, _k):
            cohort.append(_k)

    try:
        _min_obs_tp = int(os.environ.get("PRED_EXPLAIN_CLUSTER_MIN_VALID_TP", "6"))
    except ValueError:
        _min_obs_tp = 6

    features: dict[str, list[float | None]] = {}
    for ck in cohort:
        dd = universe.get(ck) or {}
        base = _px(dd, "close_m60", "close_m60_cal")
        if base is None or base <= 0:
            continue
        out: list[float | None] = []
        for pri, cal in _CLOSE_SPEC:
            pv = _px(dd, pri, cal)
            if pv is None or pv <= 0:
                out.append(None)
            else:
                out.append((pv / base - 1.0) * 100.0)
        if sum(1 for x in out if x is not None) >= _min_obs_tp:
            features[ck] = out
    return cohort, features


def _feature_matrix(
    eligible: list[str],
    features: dict[str, list[float | None]],
    *,
    use_deltas: bool,
    row_shape: bool,
):
    import numpy as np
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler

    rows = [
        [np.nan if x is None else float(x) for x in features[k]]
        for k in eligible
    ]
    X = np.asarray(rows, dtype=float)
    X_imp = SimpleImputer(strategy="mean").fit_transform(X)
    X_feat = X_imp
    if row_shape:
        rm = X_feat.mean(axis=1, keepdims=True)
        rs = X_feat.std(axis=1, keepdims=True)
        rs = np.where(rs < 1e-9, 1.0, rs)
        X_feat = (X_feat - rm) / rs
    if use_deltas:
        X_d = np.diff(X_feat, axis=1)
        X_feat = np.hstack([X_feat, X_d])
    Xs = StandardScaler().fit_transform(X_feat)
    return Xs, X_imp


def _mean_traj(keys: list[str], features: dict[str, list[float | None]]) -> list[str]:
    import numpy as np

    cols = len(_TP_LABELS)
    acc = [[] for _ in range(cols)]
    for k in keys:
        vec = features.get(k) or []
        for i in range(cols):
            v = vec[i] if i < len(vec) else None
            if v is not None:
                acc[i].append(float(v))
    parts = []
    for i, xs in enumerate(acc):
        if xs:
            parts.append(f"{_TP_LABELS[i]}={np.mean(xs):+.1f}%")
        else:
            parts.append(f"{_TP_LABELS[i]}=—")
    return ", ".join(parts)


def main() -> int:
    from past_pred_io import default_past_pred_json, load_past_pred_map

    from prediction.clustering import (
        canonicalize_supernova_kmeans_two_clusters,
        cluster_trajectories,
    )
    from prediction.config import get_config

    json_path = (
        os.path.normpath(sys.argv[1])
        if len(sys.argv) > 1
        else default_past_pred_json(_ROOT)
    )
    if not os.path.isfile(json_path):
        print(f"JSON non trovato: {json_path}", file=sys.stderr)
        return 1

    universe = load_past_pred_map(json_path)
    cohort, features = _build_cohort_and_features(universe)
    eligible = [k for k in cohort if k in features]
    n_r = len(eligible)
    cfg = get_config()

    print("=== Check cluster empirico (coorte Predizione — guida) ===")
    print(f"JSON: {json_path}")
    print(f"Coorte primaria: N={len(cohort)} | eleggibili k-means (≥TP): N={n_r}")
    print(
        f"Feature: livelli % + deltas={cfg.pred_explain_cluster_use_deltas} | "
        f"row_shape={cfg.pred_explain_cluster_row_shape}"
    )
    print()

    if n_r < 4:
        print("Troppo pochi eleggibili per k-means.")
        return 1

    try:
        import numpy as np
        from sklearn.cluster import KMeans
        from sklearn.metrics import silhouette_score
    except ImportError as exc:
        print(f"sklearn richiesto: {exc}", file=sys.stderr)
        return 1

    Xs, X_imp = _feature_matrix(
        eligible,
        features,
        use_deltas=cfg.pred_explain_cluster_use_deltas,
        row_shape=cfg.pred_explain_cluster_row_shape,
    )

    k_hi = max(2, min(6, n_r - 1))

    print("--- Sweep k (etichette k-means grezze, senza riallineamento SuperNova) ---")
    print(f"{'k':>3}  {'silhouette':>10}  {'inertia':>12}  distribuzione cluster")
    best_k, best_sil = 2, -1.0
    for k in range(2, k_hi + 1):
        try:
            lab = KMeans(n_clusters=k, random_state=0, n_init=10).fit_predict(Xs)
        except Exception as exc:
            print(f"{k:3d}  ERRORE: {exc}")
            continue
        uniq = sorted(int(x) for x in np.unique(lab))
        counts = {u: int((lab == u).sum()) for u in uniq}
        dist = ", ".join(f"id{u}={counts[u]}" for u in uniq)
        sil = None
        if len(uniq) >= 2:
            try:
                sil = float(silhouette_score(Xs, lab))
            except Exception:
                pass
        inert = float(
            KMeans(n_clusters=k, random_state=0, n_init=10).fit(Xs).inertia_
        )
        sil_s = f"{sil:.3f}" if sil is not None else "n/a"
        print(f"{k:3d}  {sil_s:>10}  {inert:12.1f}  {dist}")
        if sil is not None and sil > best_sil:
            best_sil = sil
            best_k = k

    print(f"\nMiglior silhouette nel range: k={best_k} (score={best_sil:.3f})")
    print()

    k_use = best_k if best_sil >= 0 else 2
    labels = KMeans(n_clusters=k_use, random_state=0, n_init=10).fit_predict(Xs)
    raw_assign = {eligible[i]: int(labels[i]) for i in range(n_r)}
    for ck in cohort:
        if ck not in raw_assign:
            raw_assign[ck] = -1

    print(f"--- k={k_use} GREZZO (come emerge da k-means) ---")
    raw_keys: dict[int, list[str]] = {}
    for ck in eligible:
        raw_keys.setdefault(raw_assign[ck], []).append(ck)
    for cid in sorted(raw_keys):
        keys = sorted(raw_keys[cid])
        print(f"  Cluster id {cid}: N={len(keys)}")
        print(f"    μ traiettoria: {_mean_traj(keys, features)}")

    canon_assign, canon_keys, swapped = canonicalize_supernova_kmeans_two_clusters(
        dict(raw_assign),
        cohort,
        eligible_for_swap=frozenset(eligible),
    )
    print()
    print(f"--- k={k_use} DOPO canonicalize_supernova (id 1 = minoranza → «SuperNova») ---")
    print(f"  Etichette scambiate 0↔1: {swapped}")
    for cid in sorted(c for c in canon_keys if c >= 0):
        keys = sorted(canon_keys.get(cid) or [])
        lab = "SuperNova (minoranza)" if cid == 1 else "maggioranza"
        print(f"  Cluster id {cid} ({lab}): N={len(keys)}")
        print(f"    μ traiettoria: {_mean_traj(keys, features)}")

    cl_res = cluster_trajectories(features, cohort, config=cfg)
    print()
    print("--- Modulo prediction.clustering.cluster_trajectories (produzione) ---")
    print(f"  reliable={cl_res.reliable} | method={cl_res.method} | n_clusters={cl_res.n_clusters}")
    print(f"  note: {cl_res.note}")
    for cid in sorted(c for c in cl_res.cluster_keys if c >= 0):
        print(f"  id {cid}: N={len(cl_res.cluster_keys[cid])}")

    if swapped and k_use == 2:
        print()
        print(
            "NOTA: con k=2 la maggior parte degli studi finisce in UN solo gruppo k-means grezzo;\n"
            "il riallineamento SuperNova forza id 0 = maggioranza e id 1 = minoranza.\n"
            "Per usare le etichette empiriche: PRED_CLUSTER_CANONICALIZE_SUPERNOVA=0"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
