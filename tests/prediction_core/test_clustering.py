"""Tests for prediction.clustering (Predizione guida k-means guardrails)."""
from __future__ import annotations

import pytest

from prediction.clustering import (
    ClusterResult,
    cluster_trajectories,
    guida_cluster_mu_caption,
    guida_clusters_to_render,
)
from prediction.config import PredictionConfig


def _cfg(**overrides) -> PredictionConfig:
    base = PredictionConfig.from_env()
    for k, v in overrides.items():
        object.__setattr__(base, k, v)
    return base


def test_n2_reliable_false_no_supernova_cluster():
    cohort = ["a", "b"]
    features = {
        "a": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
        "b": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
    }
    res = cluster_trajectories(
        features,
        cohort,
        config=_cfg(pred_cluster_min_obs=4, pred_cluster_min_k=2, pred_cluster_min_per_cluster=2),
    )
    assert res.reliable is False
    assert res.method in ("fallback_unclustered", "kmeans_unreliable")
    assert all(res.assignments[k] == -1 for k in cohort)
    assert 1 not in res.cluster_keys
    assert "SuperNova" not in res.note or "non affidabile" in res.note
    _ids, _keys = guida_clusters_to_render(res, cohort)
    assert _ids == [0] and _keys[0] == cohort


def test_n10_synthetic_kmeans_reliable():
    pytest.importorskip("sklearn")
    cohort = [f"k{i}" for i in range(10)]
    features = {}
    for i, k in enumerate(cohort):
        base = float(i * 5)
        features[k] = [base + j * (1 if i < 5 else 3) for j in range(8)]
    res = cluster_trajectories(
        features,
        cohort,
        config=_cfg(
            pred_cluster_min_obs=4,
            pred_cluster_min_k=2,
            pred_cluster_min_per_cluster=2,
            pred_explain_cluster_silhouette_k=False,
        ),
    )
    assert res.reliable is True
    assert res.method == "kmeans"
    assert res.n_clusters >= 2
    assert 1 in res.cluster_keys
    assert len(res.cluster_keys[1]) >= 2
    assert len(res.cluster_keys[0]) >= 2


def test_guida_clusters_to_render_unreliable_cohort_wide_cluster0():
    cohort = ["a", "b", "c"]
    cl = ClusterResult(
        assignments={k: -1 for k in cohort},
        cluster_keys={-1: cohort},
        n_clusters=0,
        method="fallback_unclustered",
        reliable=False,
        note="test",
    )
    sorted_ids, keys = guida_clusters_to_render(cl, cohort)
    assert sorted_ids == [0]
    assert keys[0] == cohort
    assert "SuperNova" not in guida_cluster_mu_caption(0, reliable=False)


def test_guida_clusters_to_render_reliable_keeps_kmeans_ids():
    cohort = ["a", "b"]
    cl = ClusterResult(
        assignments={"a": 0, "b": 1},
        cluster_keys={0: ["a"], 1: ["b"]},
        n_clusters=2,
        method="kmeans",
        reliable=True,
        note="ok",
    )
    sorted_ids, keys = guida_clusters_to_render(cl, cohort)
    assert sorted_ids == [0, 1]
    assert keys[0] == ["a"] and keys[1] == ["b"]


def test_guida_clusters_to_render_unreliable_uses_cohort_zero():
    cohort = ["a", "b"]
    features = {
        "a": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
        "b": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
    }
    res = cluster_trajectories(
        features,
        cohort,
        config=_cfg(pred_cluster_min_obs=4, pred_cluster_min_k=2, pred_cluster_min_per_cluster=2),
    )
    assert res.reliable is False
    ids, keys = guida_clusters_to_render(res, cohort)
    assert ids == [0]
    assert keys[0] == cohort
    assert guida_cluster_mu_caption(0, reliable=False).startswith("μ · Coorte intera")


def test_fallback_note_documents_reason():
    res = cluster_trajectories(
        {"only": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]},
        ["only"],
        config=_cfg(pred_cluster_min_obs=4),
    )
    assert res.reliable is False
    assert res.assignments["only"] == -1
    assert "osservazioni clusterabili=1" in res.note
    assert "ATTENZIONE" in res.note
