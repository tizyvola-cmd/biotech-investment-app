#!/usr/bin/env python3
"""
Mappa di similitudine tra studi della coorte «Predizione — guida» in un cluster k-means.

Usa le stesse feature del foglio (rendimenti % vs −60, opz. Δ tra timepoint, StandardScaler)
e distanza euclidea nello spazio scalato → similitudine = 1 / (1 + distanza).

Uso:
  python plot_cluster_similarity.py --cluster 3
  python plot_cluster_similarity.py --cluster 1 --out data/cluster_1_sim.png
  python plot_cluster_similarity.py --cluster 3 --no-silhouette --k 4
  python plot_cluster_similarity.py --cluster 3 --heatmap-max 48

Richiede: matplotlib, numpy, scikit-learn (come plot_predizione_guida.py).
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _short_label(key: str, universe: dict) -> str:
    dd = universe.get(key) or {}
    tk = str(dd.get("ticker") or key.split("|")[0] if "|" in key else key).strip()
    cd = str(dd.get("completion_date") or (key.split("|")[1] if "|" in key else "")).strip()[:10]
    nm = str(dd.get("company_name_full") or dd.get("companyName") or "").strip()
    if len(nm) > 28:
        nm = nm[:25] + "…"
    return f"{tk}|{cd}" + (f"\n{nm}" if nm else "")


def _build_feature_matrix(
    keys: list[str],
    universe: dict,
    *,
    min_obs: int,
) -> tuple[list[str], object, list[str]]:
    """Ritorna (keys_ok, X_scaled ndarray, feature_labels)."""
    import numpy as np
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler

    from plot_predizione_guida import CLOSE_SPEC, OFF_LABS, _COLS_N, _px, _env_bool

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

    rows: list[list[float]] = []
    ok_keys: list[str] = []
    for ck in keys:
        vec, ok = _rets_ok(ck)
        if not ok:
            continue
        ok_keys.append(ck)
        rows.append([np.nan if x is None else float(x) for x in vec])

    if len(rows) < 2:
        raise RuntimeError(
            f"meno di 2 studi con ≥{min_obs} timepoint validi nel cluster"
        )

    X = np.asarray(rows, dtype=float)
    X_imp = SimpleImputer(strategy="mean").fit_transform(X)
    X_feat = X_imp
    if _env_bool("PRED_EXPLAIN_CLUSTER_ROW_SHAPE", False):
        rm = X_feat.mean(axis=1, keepdims=True)
        rs = X_feat.std(axis=1, keepdims=True)
        rs = np.where(rs < 1e-9, 1.0, rs)
        X_feat = (X_feat - rm) / rs
    feat_labs = list(OFF_LABS)
    if _env_bool("PRED_EXPLAIN_CLUSTER_USE_DELTAS", True):
        X_d = np.diff(X_feat, axis=1)
        X_feat = np.hstack([X_feat, X_d])
        feat_labs = feat_labs + [f"Δ{a}→{b}" for a, b in zip(OFF_LABS[:-1], OFF_LABS[1:])]
    Xs = StandardScaler().fit_transform(X_feat)
    return ok_keys, Xs, feat_labs


def _similarity_from_scaled(Xs) -> tuple[object, object]:
    import numpy as np
    from sklearn.metrics.pairwise import euclidean_distances

    D = euclidean_distances(Xs)
    S = 1.0 / (1.0 + D)
    np.fill_diagonal(S, 1.0)
    return D, S


def _pick_heatmap_subset(keys: list[str], Xs, max_n: int) -> list[str]:
    if len(keys) <= max_n:
        return keys
    import numpy as np

    centroid = Xs.mean(axis=0)
    d = np.linalg.norm(Xs - centroid, axis=1)
    order = np.argsort(d)
    return [keys[i] for i in order[:max_n]]


def plot_similarity(
    *,
    cluster_id: int,
    out_path: str,
    json_path: str | None,
    skip_nct_filter: bool,
    no_silhouette: bool,
    k_override: int | None,
    heatmap_max: int,
) -> int:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    from past_pred_io import default_past_pred_json, load_past_pred_map
    from plot_predizione_guida import _primary_eligible, _run_clustering

    if no_silhouette:
        os.environ["PRED_EXPLAIN_CLUSTER_SILHOUETTE_K"] = "0"
    if k_override is not None:
        os.environ["PRED_EXPLAIN_N_CLUSTERS"] = str(max(2, k_override))

    jp = json_path or default_past_pred_json(_ROOT)
    if not os.path.isfile(jp):
        print(f"JSON non trovato: {jp}", file=sys.stderr)
        return 1

    from data_orchestrator import _filter_past_pred_data_by_restricted_nct_relation

    ppd_ctrl = load_past_pred_map(jp)
    ppd = ppd_ctrl if skip_nct_filter else _filter_past_pred_data_by_restricted_nct_relation(ppd_ctrl)

    from datetime import date as date_cls

    def _cd_key_u(k: str):
        return (ppd_ctrl.get(k) or {}).get("completion_date") or date_cls.min

    cohort: list[str] = []
    for k in sorted(ppd_ctrl.keys(), key=_cd_key_u, reverse=True):
        if _primary_eligible(ppd_ctrl.get(k) or {}, k, ppd, ppd_ctrl):
            cohort.append(k)

    cluster_keys, _k_max = _run_clustering(cohort, ppd_ctrl)
    members = list(cluster_keys.get(cluster_id) or [])
    if not members:
        print(
            f"Cluster {cluster_id} vuoto con la configurazione attuale "
            f"(cluster presenti: {sorted(cluster_keys.keys())}).\n"
            "Suggerimento: con k-means default (silhouette, k≈2) esistono solo cluster 0 e 1. "
            "Per un cluster 3 esplicito: --no-silhouette --k 4",
            file=sys.stderr,
        )
        return 1

    try:
        min_obs = int(os.environ.get("PRED_EXPLAIN_CLUSTER_MIN_VALID_TP", "6"))
    except ValueError:
        min_obs = 6

    ok_keys, Xs, _ = _build_feature_matrix(members, ppd_ctrl, min_obs=min_obs)
    D, S = _similarity_from_scaled(Xs)
    labels_full = [_short_label(k, ppd_ctrl) for k in ok_keys]

    hm_keys = _pick_heatmap_subset(ok_keys, Xs, heatmap_max)
    idx = [ok_keys.index(k) for k in hm_keys]
    S_sub = S[np.ix_(idx, idx)]
    labels_sub = [labels_full[i] for i in idx]

    fig = plt.figure(figsize=(14, 11))
    gs = fig.add_gridspec(2, 2, height_ratios=[1.15, 1], width_ratios=[1.2, 1])

    ax_hm = fig.add_subplot(gs[0, 0])
    im = ax_hm.imshow(S_sub, vmin=0, vmax=1, cmap="viridis", aspect="auto")
    ax_hm.set_xticks(range(len(labels_sub)))
    ax_hm.set_yticks(range(len(labels_sub)))
    ax_hm.set_xticklabels(labels_sub, rotation=55, ha="right", fontsize=7)
    ax_hm.set_yticklabels(labels_sub, fontsize=7)
    ax_hm.set_title(
        f"Similitudine (heatmap) — cluster {cluster_id} · "
        f"{len(hm_keys)}/{len(ok_keys)} studi più vicini al centroide"
    )
    fig.colorbar(im, ax=ax_hm, fraction=0.046, pad=0.04, label="1/(1+d_eucl)")

    ax_mds = fig.add_subplot(gs[0, 1])
    try:
        from sklearn.manifold import MDS

        pos = MDS(
            n_components=2,
            dissimilarity="precomputed",
            random_state=0,
            normalized_stress="auto",
        ).fit_transform(D)
        ax_mds.scatter(pos[:, 0], pos[:, 1], s=28, c="#2563eb", alpha=0.75, edgecolors="white", lw=0.4)
        for i, k in enumerate(ok_keys):
            if len(ok_keys) <= 35 or k in hm_keys:
                tk = k.split("|")[0] if "|" in k else k[:8]
                ax_mds.annotate(tk, (pos[i, 0], pos[i, 1]), fontsize=6, alpha=0.85)
        ax_mds.set_title(f"MDS 2D — tutti i {len(ok_keys)} studi (distanza euclidea scalata)")
        ax_mds.set_xlabel("dim 1")
        ax_mds.set_ylabel("dim 2")
        ax_mds.grid(True, alpha=0.25)
    except Exception as exc:
        ax_mds.text(0.5, 0.5, f"MDS non disponibile:\n{exc}", ha="center", va="center", transform=ax_mds.transAxes)

    ax_dend = fig.add_subplot(gs[1, :])
    try:
        from scipy.cluster.hierarchy import dendrogram, linkage
        from scipy.spatial.distance import squareform

        Z = linkage(squareform(D, checks=False), method="average")
        dendrogram(
            Z,
            labels=[k.split("|")[0] if "|" in k else k for k in ok_keys],
            ax=ax_dend,
            leaf_rotation=90,
            leaf_font_size=6,
            color_threshold=0,
        )
        ax_dend.set_title(
            f"Dendrogramma (linkage average) — cluster {cluster_id}, N={len(ok_keys)}"
        )
        ax_dend.set_ylabel("distanza euclidea")
    except ImportError:
        ax_dend.text(
            0.5,
            0.5,
            "Installa scipy per il dendrogramma",
            ha="center",
            va="center",
            transform=ax_dend.transAxes,
        )

    k_note = os.environ.get("PRED_EXPLAIN_N_CLUSTERS", "2")
    sil = os.environ.get("PRED_EXPLAIN_CLUSTER_SILHOUETTE_K", "1")
    fig.suptitle(
        f"Relazioni di similitudine · cluster {cluster_id} · N={len(ok_keys)} eleggibili "
        f"(su {len(members)} in cluster) · k_target≤{k_note}, silhouette={sil}",
        fontsize=10,
        y=0.995,
    )
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"Salvato: {out_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cluster", type=int, required=True, help="Id cluster k-means (es. 3)")
    ap.add_argument(
        "--out",
        default=None,
        help="PNG di output (default: data/cluster_similarity/cluster_<id>_sim.png)",
    )
    ap.add_argument("--json", default=None, help="path past_catalyst_predictions.json")
    ap.add_argument(
        "--skip-nct-relation-filter",
        action="store_true",
        help="usa tutto il JSON senza filtro NCT ristretto",
    )
    ap.add_argument(
        "--no-silhouette",
        action="store_true",
        help="disabilita scelta k via silhouette (usa --k)",
    )
    ap.add_argument("--k", type=int, default=None, help="forza PRED_EXPLAIN_N_CLUSTERS")
    ap.add_argument(
        "--heatmap-max",
        type=int,
        default=48,
        help="massimo studi nella heatmap (i più vicini al centroide)",
    )
    args = ap.parse_args()
    out = args.out or os.path.join(
        _ROOT, "data", "cluster_similarity", f"cluster_{args.cluster}_sim.png"
    )
    return plot_similarity(
        cluster_id=args.cluster,
        out_path=out,
        json_path=args.json,
        skip_nct_filter=args.skip_nct_relation_filter,
        no_silhouette=args.no_silhouette,
        k_override=args.k,
        heatmap_max=max(4, args.heatmap_max),
    )


if __name__ == "__main__":
    raise SystemExit(main())
