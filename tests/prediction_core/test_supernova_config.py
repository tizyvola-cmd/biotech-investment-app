"""Tests for supernova_config (no FastAPI dependency).

For API security tests see ``test_supernova_api.py`` (needs ``fastapi`` + ``httpx``).
Install with ``pip install fastapi httpx`` or ``pip install -r requirements-dev.txt`` in the project venv.
"""
from __future__ import annotations

import supernova_config as cfg


def test_from_env_defaults(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.delenv("SUPERNOVA_CORS_PERMISSIVE", raising=False)
    monkeypatch.delenv("SUPERNOVA_BIND_ALL", raising=False)
    monkeypatch.delenv("SUPERNOVA_API_TOKEN", raising=False)
    c = cfg.SupernovaConfig.from_env()
    assert c.cors_permissive is False
    assert c.bind_all is False
    assert c.api_token is None
    assert c.uvicorn_host == "127.0.0.1"
    assert c.uvicorn_port == cfg.DEFAULT_PORT


def test_cors_allow_origin_regex_includes_public_host(monkeypatch):
    monkeypatch.delenv("SUPERNOVA_PUBLIC_HOST", raising=False)
    monkeypatch.delenv("SUPERNOVA_PUBLIC_BASE_URL", raising=False)
    assert "localhost" in cfg.cors_allow_origin_regex()
    monkeypatch.setenv("SUPERNOVA_PUBLIC_HOST", "91.99.15.48")
    rx = cfg.cors_allow_origin_regex()
    assert "91\\.99\\.15\\.48" in rx
    assert "localhost" in rx


def test_bind_all_host(monkeypatch):
    monkeypatch.setenv("SUPERNOVA_BIND_ALL", "1")
    c = cfg.SupernovaConfig.from_env()
    assert c.bind_all is True
    assert c.uvicorn_host == "0.0.0.0"


def test_sds_refresh_env(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_SDS_REFRESH", "1")
    monkeypatch.setenv("SUPERNOVA_SDS_REFRESH_TIME", "09:15")
    c = cfg.SupernovaConfig.from_env()
    assert c.sds_refresh_enabled is True
    assert c.sds_refresh_time == "09:15"


def test_model_lab_refresh_env(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_MODEL_LAB_REFRESH", "1")
    monkeypatch.setenv("SUPERNOVA_MODEL_LAB_REFRESH_TIME", "16:30")
    c = cfg.SupernovaConfig.from_env()
    assert c.model_lab_refresh_enabled is True
    assert c.model_lab_refresh_time == "16:30"


def test_precat_flags_default_and_override(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.delenv("SUPERNOVA_PRECAT_CALENDAR", raising=False)
    monkeypatch.delenv("SUPERNOVA_VOLUME_DELTA", raising=False)
    monkeypatch.delenv("SUPERNOVA_TRENDS", raising=False)
    c = cfg.SupernovaConfig.from_env()
    assert c.precat_calendar_enabled is True
    assert c.volume_delta_enabled is True
    assert c.trends_enabled is True
    assert c.trends_pilot_tickers == ""

    monkeypatch.setenv("SUPERNOVA_PRECAT_CALENDAR", "0")
    monkeypatch.setenv("SUPERNOVA_VOLUME_DELTA", "off")
    monkeypatch.setenv("SUPERNOVA_TRENDS", "0")
    monkeypatch.setenv("SUPERNOVA_TRENDS_TICKERS", "CANF,BDSX")
    c2 = cfg.SupernovaConfig.from_env()
    assert c2.precat_calendar_enabled is False
    assert c2.volume_delta_enabled is False
    assert c2.trends_enabled is False
    assert c2.trends_pilot_tickers == "CANF,BDSX"


def test_saturday_weekly_full_env(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_SATURDAY_WEEKLY_FULL", "1")
    monkeypatch.setenv("SUPERNOVA_SATURDAY_WEEKLY_FULL_TIME", "07:30")
    monkeypatch.setenv("SUPERNOVA_SATURDAY_WEEKLY_FULL_END", "13:00")
    c = cfg.SupernovaConfig.from_env()
    assert c.saturday_weekly_full_enabled is True
    assert c.saturday_weekly_full_time == "07:30"
    assert c.saturday_weekly_full_window_end == "13:00"
