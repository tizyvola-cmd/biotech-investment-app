"""Smoke tests for CDN cache headers + Postgres opt-in (no live DB required)."""
from __future__ import annotations

from cdn_snapshots import (
    cache_control_for_cdn_object,
    cache_control_for_project_path,
    is_cacheable_snapshot,
    is_private_project_path,
    is_public_project_data_path,
)


def test_private_paths_not_cached():
    assert is_private_project_path("tester_feedback_store.json")
    assert is_private_project_path("invest_sim_inputs.json")
    assert is_private_project_path("ai_secrets.json")
    assert "no-store" in cache_control_for_project_path("tester_feedback_store.json")


def test_snapshots_are_edge_cacheable():
    assert is_cacheable_snapshot("simulation_sheet_snapshot.json")
    assert is_cacheable_snapshot("desktop_data_manifest.json")
    cc = cache_control_for_project_path("simulation_sheet_snapshot.json")
    assert "public" in cc
    assert "max-age=" in cc
    assert cache_control_for_project_path("desktop_data_manifest.json").startswith("public")


def test_public_project_data_allowlist_denies_secrets():
    assert is_public_project_data_path("simulation_sheet_snapshot.json")
    assert is_public_project_data_path("desktop_data_manifest.json")
    assert is_public_project_data_path("eis_super_score_learning.json")
    assert not is_public_project_data_path("ai_secrets.json")
    assert not is_public_project_data_path("tester_feedback_store.json")
    assert not is_public_project_data_path("invest_sim_inputs.json")
    assert not is_public_project_data_path("manual_feed_store.json")
    assert not is_public_project_data_path("desktop_ui_prefs.json")
    assert not is_public_project_data_path("../ai_secrets.json")
    assert not is_public_project_data_path("subdir/ai_secrets.json")
    assert not is_public_project_data_path("notes.txt")
    # Shared companion snapshot is intentionally public (same data as API GET).
    assert is_public_project_data_path("mobile_dashboard_snapshot.json")


def test_cdn_objects_immutable():
    assert "immutable" in cache_control_for_cdn_object()


def test_postgres_disabled_by_default(monkeypatch):
    monkeypatch.delenv("SUPERNOVA_DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    import supernova_pg as pg

    assert pg.enabled() is False
    assert pg.healthcheck()["backend"] == "json"
