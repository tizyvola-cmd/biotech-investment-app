#!/usr/bin/env python3
"""
Elenca le chiavi coorte nel **cluster 1 — SuperNova** come nella sheet «Predizione — guida»
(k-means su traiettorie % vs −60 sessioni). Stessi default env del foglio.

Uso (dalla cartella progetto):
  python list_pred_cluster1.py
  python list_pred_cluster1.py path/to/past_catalyst_predictions.json
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def main() -> int:
    from datetime import date as _date_cls

    from past_pred_io import default_past_pred_json, load_past_pred_map

    from data_orchestrator import (
        _canonicalize_supernova_kmeans_two_clusters,
        _filter_past_pred_data_by_restricted_nct_relation,
        _is_restricted_nct_relation,
        _norm_nct_relation_label,
    )

    json_path = (
        os.path.normpath(sys.argv[1])
        if len(sys.argv) > 1
        else default_past_pred_json(_ROOT)
    )
    if not os.path.isfile(json_path):
        print(f"JSON non trovato: {json_path}", file=sys.stderr)
        return 1

    _ppd = _filter_past_pred_data_by_restricted_nct_relation(
        load_past_pred_map(json_path))
    _ppd_ctrl = load_past_pred_map(json_path)

    # --- Stessa logica di _write_prediction_explainer_sheet (cohorte + cluster) ---

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

    _universe = _ppd_ctrl

    def _get_cd_key_u(k):
        return (_universe.get(k) or {}).get("completion_date") or _date_cls.min

    _keys_u_sorted = sorted(_universe.keys(), key=_get_cd_key_u, reverse=True)
    _cohort: list[str] = []
    for _k in _keys_u_sorted:
        if _primary_eligible(_universe.get(_k) or {}, _k):
            _cohort.append(_k)

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
    _cols_n = len(_CLOSE_SPEC)

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

    try:
        _k_tgt = int(os.environ.get("PRED_EXPLAIN_N_CLUSTERS", "2"))
    except ValueError:
        _k_tgt = 2
    _k_tgt = max(2, _k_tgt)
    try:
        _min_obs_tp = int(os.environ.get("PRED_EXPLAIN_CLUSTER_MIN_VALID_TP", "6"))
    except ValueError:
        _min_obs_tp = 6

    _cluster_assign: dict[str, int] = {}
    _cluster_note = ""
    _km_eligible: frozenset[str] | None = None

    def _rets_vec_ok_for_cluster(k: str, src: dict) -> tuple[list[float | None], bool]:
        _dd = src.get(k) or {}
        _base = _px(_dd, "close_m60", "close_m60_cal")
        if _base is None or _base <= 0:
            return [None] * _cols_n, False
        _out: list[float | None] = []
        for pri, cal in _CLOSE_SPEC:
            _pv = _px(_dd, pri, cal)
            if _pv is None or _pv <= 0:
                _out.append(None)
            else:
                _out.append((_pv / _base - 1.0) * 100.0)
        _n_ok = sum(1 for x in _out if x is not None)
        return _out, _n_ok >= _min_obs_tp

    try:
        import numpy as _np
        from sklearn.cluster import KMeans as _KM
        from sklearn.impute import SimpleImputer as _SI
        from sklearn.metrics import silhouette_score as _sil_score
        from sklearn.preprocessing import StandardScaler as _SS

        def _env_cluster_bool(_ek: str, _default: bool) -> bool:
            _ev = os.environ.get(_ek)
            if _ev is None or str(_ev).strip() == "":
                return _default
            return str(_ev).strip().lower() not in ("0", "false", "no", "off")

        _use_deltas = _env_cluster_bool("PRED_EXPLAIN_CLUSTER_USE_DELTAS", True)
        _row_shape = _env_cluster_bool("PRED_EXPLAIN_CLUSTER_ROW_SHAPE", False)
        try:
            _sil_min_n = int(os.environ.get("PRED_EXPLAIN_CLUSTER_SILHOUETTE_MIN_N", "8"))
        except ValueError:
            _sil_min_n = 8
        _use_sil_k = _env_cluster_bool("PRED_EXPLAIN_CLUSTER_SILHOUETTE_K", True)

        _eligible_keys: list[str] = []
        _rows: list[list[float]] = []
        for _ck in _cohort:
            _vec, _ok = _rets_vec_ok_for_cluster(_ck, _universe)
            if not _ok:
                continue
            _eligible_keys.append(_ck)
            _rows.append([_np.nan if x is None else float(x) for x in _vec])
        _n_r = len(_rows)
        if _n_r >= 4:
            X = _np.asarray(_rows, dtype=float)
            X_imp = _SI(strategy="mean").fit_transform(X)
            X_feat = X_imp
            if _row_shape:
                _rm = X_feat.mean(axis=1, keepdims=True)
                _rs = X_feat.std(axis=1, keepdims=True)
                _rs = _np.where(_rs < 1e-9, 1.0, _rs)
                X_feat = (X_feat - _rm) / _rs
            if _use_deltas:
                X_d = _np.diff(X_feat, axis=1)
                X_feat = _np.hstack([X_feat, X_d])
            Xs = _SS().fit_transform(X_feat)
            _k_hi = max(2, min(_k_tgt, _n_r - 1))
            _k_use = _k_hi
            _sil_val = None
            if _use_sil_k and _n_r >= _sil_min_n and _k_hi >= 2:
                _best_k = 2
                _best_sc = -1.0
                for _k in range(2, _k_hi + 1):
                    try:
                        _lab_t = _KM(
                            n_clusters=_k, random_state=0, n_init=10,
                        ).fit_predict(Xs)
                    except Exception:
                        continue
                    if len(_np.unique(_lab_t)) < 2:
                        continue
                    try:
                        _sc = float(_sil_score(Xs, _lab_t))
                    except Exception:
                        continue
                    if _sc > _best_sc:
                        _best_sc = _sc
                        _best_k = _k
                if _best_sc >= 0:
                    _k_use = _best_k
                    _sil_val = _best_sc
            labels = _KM(
                n_clusters=_k_use, random_state=0, n_init=10,
            ).fit_predict(Xs)
            for _ii, _kk in enumerate(_eligible_keys):
                _cluster_assign[_kk] = int(labels[_ii])
            for _ck in _cohort:
                if _ck not in _cluster_assign:
                    _cluster_assign[_ck] = 0
            _km_eligible = frozenset(_eligible_keys)
            _parts = [
                f"k-means k={_k_use}",
                "livelli % + Δ tra TP" if _use_deltas else "solo livelli %",
                "forma per riga" if _row_shape else "livello assoluto",
            ]
            if _sil_val is not None:
                _parts.append(f"silhouette={_sil_val:.2f}")
            _cluster_note = "; ".join(_parts)
        else:
            raise RuntimeError(
                f"osservazioni clusterabili < 4 (≥{_min_obs_tp} TP validi ciascuna)."
            )
    except Exception as _cl_e:
        _cluster_note = f"fallback tutti cluster 0: {_cl_e}"
        _km_eligible = None
        for _ck in _cohort:
            _cluster_assign[_ck] = 0

    _cluster_assign, _cluster_keys, _sn_swap = (
        _canonicalize_supernova_kmeans_two_clusters(
            _cluster_assign, _cohort, eligible_for_swap=_km_eligible)
    )
    if _sn_swap:
        _cluster_note = (
            f"{_cluster_note} ; etichette 0/1 riallineate (id 1 = SuperNova · minoranza; id 0 = maggioranza)"
        )

    print(f"Coorte primaria N={len(_cohort)} | Nota clustering: {_cluster_note}")
    for _cid in sorted(_cluster_keys.keys()):
        _lst = sorted(_cluster_keys[_cid])
        _lab = (
            "SuperNova (minoranza)"
            if _cid == 1
            else ("coorte maggioritaria" if _cid == 0 else "")
        )
        _suffix = f" — {_lab}" if _lab else ""
        print(f"Cluster {_cid}{_suffix}: N={len(_lst)}")
    c1 = sorted(_cluster_keys.get(1, []))
    print(f"\nDettaglio SuperNova (cluster 1) — {len(c1)} chiavi:")
    for i, k in enumerate(c1, 1):
        dd = _universe.get(k) or {}
        nm = str(dd.get("company_name_full") or dd.get("companyName") or "—").strip()
        print(f"  {i}. {k}  |  {nm}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
