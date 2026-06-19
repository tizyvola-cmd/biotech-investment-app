"""
Cohort trajectory k-means for Predizione — guida (SuperNova cluster 1).

Small-sample guardrails: when N is too low for a stable two-cluster split, assignments
use cluster id ``-1`` (non clusterato) and ``reliable=False`` so the workbook does not
imply a SuperNova minority that k-means did not support.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from prediction.config import PredictionConfig


@dataclass
class ClusterResult:
    """Output of ``cluster_trajectories``."""

    assignments: dict[str, int]
    cluster_keys: dict[int, list[str]]
    n_clusters: int
    method: str
    reliable: bool
    note: str
    eligible_for_swap: frozenset[str] | None = None
    swapped_supernova: bool = False


def minority_cluster_id(cluster_keys: dict[int, list[str]]) -> int | None:
    """Id del cluster con meno membri tra quelli ≥ 0 (per foglio SuperNova)."""
    candidates = [
        (cid, len(keys))
        for cid, keys in cluster_keys.items()
        if cid >= 0 and keys
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda x: x[1])[0]


def _mean_trajectory_peak(
    keys: list[str],
    features: dict[str, list[float | None]],
) -> float | None:
    peaks: list[float] = []
    for ck in keys:
        vec = features.get(ck)
        if not vec:
            continue
        vals = [float(x) for x in vec if x is not None]
        if vals:
            peaks.append(max(vals))
    if not peaks:
        return None
    return sum(peaks) / len(peaks)


def canonicalize_supernova_by_peak_shape(
    cluster_assign: dict[str, int],
    cohort: list[str],
    features: dict[str, list[float | None]],
    *,
    eligible_for_swap: frozenset[str] | None = None,
    min_peak_gap_pp: float = 8.0,
) -> tuple[dict[str, int], dict[int, list[str]], bool]:
    """
    Ensure cluster **1** carries the higher pre-CD surge profile (SuperNova semantics).

    k-means count canonicalization only guarantees id 1 = minority, not shape. When the
    minority partition is flatter than the majority, swap labels 0 ↔ 1.
    """
    keys0 = [
        ck
        for ck in cohort
        if int(cluster_assign.get(ck, -1)) == 0
        and (eligible_for_swap is None or ck in eligible_for_swap)
    ]
    keys1 = [
        ck
        for ck in cohort
        if int(cluster_assign.get(ck, -1)) == 1
        and (eligible_for_swap is None or ck in eligible_for_swap)
    ]
    if not keys0 or not keys1:
        keys_all = _build_cluster_keys(cluster_assign, cohort)
        return cluster_assign, keys_all, False

    peak0 = _mean_trajectory_peak(keys0, features)
    peak1 = _mean_trajectory_peak(keys1, features)
    if peak0 is None or peak1 is None or peak0 <= peak1 + min_peak_gap_pp:
        keys_all = _build_cluster_keys(cluster_assign, cohort)
        return cluster_assign, keys_all, False

    out = dict(cluster_assign)
    for ck in cohort:
        if int(out.get(ck, -1)) not in (0, 1):
            continue
        if eligible_for_swap is not None and ck not in eligible_for_swap:
            continue
        out[ck] = 1 if out[ck] == 0 else 0
    keys_all = _build_cluster_keys(out, cohort)
    return out, keys_all, True


def canonicalize_supernova_kmeans_two_clusters(
    cluster_assign: dict[str, int],
    cohort: list[str],
    *,
    eligible_for_swap: frozenset[str] | None = None,
) -> tuple[dict[str, int], dict[int, list[str]], bool]:
    """
    Align k-means labels 0/1 so **id 1** = SuperNova (minority among eligible members).

    Only swaps when both clusters 0 and 1 exist among eligible keys with n0 < n1.
    """
    out = dict(cluster_assign)
    keys_all: dict[int, list[str]] = {}
    for ck in cohort:
        keys_all.setdefault(int(out.get(ck, -1)), []).append(ck)
    if set(keys_all.keys()) != {0, 1}:
        return out, keys_all, False

    keys_e: dict[int, list[str]] = {0: [], 1: []}
    for ck in cohort:
        if eligible_for_swap is not None and ck not in eligible_for_swap:
            continue
        cid = int(out.get(ck, 0))
        if cid in (0, 1):
            keys_e[cid].append(ck)
    if not keys_e[0] or not keys_e[1]:
        return out, keys_all, False
    n0, n1 = len(keys_e[0]), len(keys_e[1])
    if n0 >= n1:
        return out, keys_all, False
    for ck in cohort:
        if int(out.get(ck, 0)) not in (0, 1):
            continue
        if eligible_for_swap is not None and ck not in eligible_for_swap:
            continue
        c = out.get(ck)
        if c == 0:
            out[ck] = 1
        elif c == 1:
            out[ck] = 0
    keys2: dict[int, list[str]] = {}
    for ck in cohort:
        keys2.setdefault(int(out.get(ck, -1)), []).append(ck)
    return out, keys2, True


def _build_cluster_keys(
    assignments: dict[str, int], cohort: list[str]
) -> dict[int, list[str]]:
    keys: dict[int, list[str]] = {}
    for ck in cohort:
        keys.setdefault(int(assignments.get(ck, -1)), []).append(ck)
    return keys


def guida_clusters_to_render(
    cl_res: ClusterResult,
    cohort: list[str],
) -> tuple[list[int], dict[int, list[str]]]:
    """
    Cluster ids and member lists for «Predizione — guida» μ/σ tables and Grafici.

    When k-means is not reliable, expose a single cluster 0 = full primary cohort
    (cohort-wide historical μ) without advertising SuperNova (cluster 1).
    Internal ``cl_res.assignments`` may still use -1 for non-clustered studies.
    """
    if cl_res.reliable:
        keys = dict(cl_res.cluster_keys)
        sorted_ids = sorted(cid for cid in keys if cid >= 0)
        return sorted_ids, keys
    return [0], {0: list(cohort)}


def guida_cluster_stats_caption(cid: int, n_st: int, *, reliable: bool) -> str:
    if cid == 1 and reliable:
        return f"Cluster 1 — SuperNova k-means (studi={n_st})"
    if cid == 0 and reliable:
        return f"Cluster 0 — maggioranza / non in k-means (studi={n_st})"
    if cid == 0:
        return f"Coorte intera — k-means non affidabile (studi={n_st})"
    return f"Cluster {cid} (studi={n_st})"


def guida_cluster_mu_caption(cid: int, *, reliable: bool) -> str:
    if cid == 1 and reliable:
        return "μ · Cluster 1 — SuperNova (minoranza elegg.)"
    if cid == 0 and reliable:
        return "μ · Cluster 0 — maggioranza / non k-means"
    if cid == 0:
        return "μ · Coorte intera (senza partizione SuperNova)"
    return f"μ · Cluster {cid}"


def guida_cluster_sd_caption(cid: int, *, reliable: bool) -> str:
    if cid == 1 and reliable:
        return "σ · Cluster 1 — SuperNova (minoranza elegg.)"
    if cid == 0 and reliable:
        return "σ · Cluster 0 — maggioranza / non k-means"
    if cid == 0:
        return "σ · Coorte intera (senza partizione SuperNova)"
    return f"σ · Cluster {cid}"


def cluster_trajectories(
    features: dict[str, list[float | None]],
    cohort: list[str],
    *,
    min_obs: int | None = None,
    min_clusters: int | None = None,
    min_per_cluster: int | None = None,
    config: PredictionConfig | None = None,
) -> ClusterResult:
    """
    Cluster trajectory feature rows (one vector per study key).

    ``features`` should only include keys with enough valid timepoints; keys in
    ``cohort`` missing from ``features`` are treated as non eleggibili (cluster -1).

    When ``reliable`` is False, all cohort members get assignment ``-1`` and no
    SuperNova (cluster 1) partition is advertised.
    """
    if config is not None:
        cfg_min_obs = config.pred_cluster_min_obs
        cfg_min_k = config.pred_cluster_min_k
        cfg_min_pc = config.pred_cluster_min_per_cluster
        k_tgt = max(2, config.pred_explain_n_clusters)
        use_deltas = config.pred_explain_cluster_use_deltas
        row_shape = config.pred_explain_cluster_row_shape
        sil_min_n = config.pred_explain_cluster_silhouette_min_n
        use_sil_k = config.pred_explain_cluster_silhouette_k
        small_n_cap = config.pred_cluster_small_n_max_k
        canonicalize_sn = config.pred_cluster_canonicalize_supernova
    else:
        cfg_min_obs = 4
        cfg_min_k = 2
        cfg_min_pc = 2
        k_tgt = 2
        use_deltas = True
        row_shape = False
        sil_min_n = 8
        use_sil_k = True
        small_n_cap = 2
        canonicalize_sn = True

    _min_obs = max(2, int(min_obs if min_obs is not None else cfg_min_obs))
    _min_k = max(2, int(min_clusters if min_clusters is not None else cfg_min_k))
    _min_pc = max(1, int(min_per_cluster if min_per_cluster is not None else cfg_min_pc))
    _need_for_reliable = max(_min_obs, _min_k * _min_pc)

    def _fallback(note: str, method: str = "fallback_unclustered") -> ClusterResult:
        assign = {ck: -1 for ck in cohort}
        for ck in features:
            if ck in cohort:
                assign[ck] = -1
        keys = _build_cluster_keys(assign, cohort)
        banner = (
            "ATTENZIONE: clustering non affidabile — etichette SuperNova (cluster 1) "
            "non applicate. "
        )
        return ClusterResult(
            assignments=assign,
            cluster_keys=keys,
            n_clusters=0,
            method=method,
            reliable=False,
            note=banner + note,
            eligible_for_swap=None,
            swapped_supernova=False,
        )

    eligible_keys = [k for k in cohort if k in features]
    n_r = len(eligible_keys)
    if n_r < _min_obs:
        return _fallback(
            f"osservazioni clusterabili={n_r} < min_obs={_min_obs}; "
            "tutti i studi marcati come non clusterati (id -1)."
        )
    if n_r < _need_for_reliable:
        return _fallback(
            f"osservazioni clusterabili={n_r} < {_min_k}×{_min_pc}={_need_for_reliable} "
            "richieste per una partizione affidabile."
        )

    try:
        import numpy as np
        from sklearn.cluster import KMeans
        from sklearn.impute import SimpleImputer
        from sklearn.metrics import silhouette_score
        from sklearn.preprocessing import StandardScaler
    except ImportError as exc:
        return _fallback(f"sklearn non disponibile: {exc}")

    rows: list[list[float]] = []
    for k in eligible_keys:
        vec = features[k]
        rows.append([np.nan if x is None else float(x) for x in vec])

    try:
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

        if n_r <= 7:
            k_hi = min(small_n_cap, max(2, min(k_tgt, n_r - 1)))
            small_note = "campione piccolo (N≤7): k limitato."
        else:
            k_hi = max(2, min(k_tgt, n_r - 1))
            small_note = ""

        k_use = k_hi
        sil_val: float | None = None
        if use_sil_k and n_r >= sil_min_n and k_hi >= 2:
            best_k = 2
            best_sc = -1.0
            for k in range(2, k_hi + 1):
                try:
                    lab_t = KMeans(
                        n_clusters=k, random_state=0, n_init=10
                    ).fit_predict(Xs)
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
                sil_val = best_sc

        labels = KMeans(
            n_clusters=k_use, random_state=0, n_init=10
        ).fit_predict(Xs)
        unique_labels = sorted(int(x) for x in np.unique(labels))
        n_unique = len(unique_labels)

        counts: dict[int, int] = {}
        assign_eligible: dict[str, int] = {}
        for ii, kk in enumerate(eligible_keys):
            lid = int(labels[ii])
            assign_eligible[kk] = lid
            counts[lid] = counts.get(lid, 0) + 1

        min_count = min(counts.values()) if counts else 0
        reliable_split = (
            n_unique >= 2
            and min_count >= _min_pc
            and n_r >= _need_for_reliable
        )

        if not reliable_split:
            note_parts = [
                small_note.strip() if small_note else "",
                f"k-means eseguito (k={k_use}, etichette={unique_labels}) ma partizione "
                f"non affidabile (min per cluster={min_count}, richiesto ≥{_min_pc}).",
            ]
            return _fallback(
                " ".join(p for p in note_parts if p).strip(),
                method="kmeans_unreliable",
            )

        assign_full: dict[str, int] = {ck: -1 for ck in cohort}
        for kk, lid in assign_eligible.items():
            assign_full[kk] = lid
        km_eligible = frozenset(eligible_keys)

        swapped = False
        if canonicalize_sn and k_use == 2:
            assign_full, cluster_keys, swapped = canonicalize_supernova_kmeans_two_clusters(
                assign_full, cohort, eligible_for_swap=km_eligible
            )
        else:
            cluster_keys = _build_cluster_keys(assign_full, cohort)

        parts = [
            f"k-means k={k_use}",
            "livelli % + Δ tra TP" if use_deltas else "solo livelli %",
            "forma per riga" if row_shape else "livello assoluto",
        ]
        if sil_val is not None:
            parts.append(f"silhouette={sil_val:.2f}")
        if small_note:
            parts.append(small_note.strip())
        note = (
            f"{'; '.join(parts)} (N eleggibili={n_r}; "
            f"StandardScaler sul blocco feature)."
        )
        if swapped:
            note += (
                " ; etichette 0/1 riallineate sugli eleggibili: id 1 = SuperNova "
                "(minoranza eleggibili); id 0 = maggioranza eleggibili."
            )
        n_cl = len([c for c in cluster_keys if c >= 0])
        return ClusterResult(
            assignments=assign_full,
            cluster_keys=cluster_keys,
            n_clusters=n_cl,
            method="kmeans",
            reliable=True,
            note=note,
            eligible_for_swap=km_eligible,
            swapped_supernova=swapped,
        )
    except Exception as exc:
        return _fallback(f"errore k-means: {exc}")
