"""
Configuration for the SuperNova local HTTP API (``SUPERNOVA_*`` environment variables).

Load via ``get_supernova_config()`` or ``SupernovaConfig.from_env()``.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

_TRUTHY_ON = frozenset({"1", "true", "yes", "on"})

# http://127.0.0.1:8765 and http://localhost:3000 (any port)
LOCALHOST_ORIGIN_REGEX = r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$"

TOKEN_HEADER = "X-SuperNova-Token"
DEFAULT_PORT = 8765


def _env_explicit_on(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY_ON


def _parse_cors_origins() -> tuple[str, ...]:
    raw = os.environ.get("SUPERNOVA_CORS_ORIGINS", "").strip()
    if not raw:
        return ()
    return tuple(o.strip() for o in raw.split(",") if o.strip())


@dataclass(frozen=True)
class SupernovaConfig:
    """SuperNova API security and server bind settings."""

    cors_permissive: bool  # SUPERNOVA_CORS_PERMISSIVE=1 → allow_origins *
    cors_origins: tuple[str, ...]  # SUPERNOVA_CORS_ORIGINS comma-separated (v3 host)
    bind_all: bool  # SUPERNOVA_BIND_ALL=1 → uvicorn host 0.0.0.0
    api_token: str | None  # SUPERNOVA_API_TOKEN — required on mutating routes if set
    serve_mobile: bool  # SUPERNOVA_SERVE_MOBILE=1 → PWA da mobile-ui/dist sulla root
    mobile_dist: str  # SUPERNOVA_MOBILE_DIST path
    serve_desktop: bool  # SUPERNOVA_SERVE_DESKTOP=1 → UI da desktop-ui/dist + /project-data/
    desktop_dist: str  # SUPERNOVA_DESKTOP_DIST path
    scheduled_refresh_minutes: int  # SUPERNOVA_SCHEDULED_REFRESH_MINUTES — legacy live (0=off)
    daily_refresh_hour: int  # SUPERNOVA_DAILY_REFRESH_HOUR — legacy daily fast ( -1=off )
    schedule_timezone: str  # SUPERNOVA_SCHEDULE_TIMEZONE — e.g. Europe/Rome
    hourly_financial_enabled: bool  # SUPERNOVA_HOURLY_FINANCIAL=1
    hourly_financial_start: str  # SUPERNOVA_HOURLY_FINANCIAL_START — HH:MM
    hourly_financial_end: str  # SUPERNOVA_HOURLY_FINANCIAL_END — HH:MM
    morning_refresh_enabled: bool  # SUPERNOVA_MORNING_REFRESH=1
    morning_refresh_time: str  # SUPERNOVA_MORNING_REFRESH_TIME — HH:MM
    sds_refresh_enabled: bool  # SUPERNOVA_SDS_REFRESH=1
    sds_refresh_time: str  # SUPERNOVA_SDS_REFRESH_TIME — HH:MM (full cohort recompute)
    eis_refresh_enabled: bool  # SUPERNOVA_EIS_REFRESH=1
    eis_refresh_time: str  # SUPERNOVA_EIS_REFRESH_TIME — HH:MM (clinical feed + EIS)
    model_lab_refresh_enabled: bool  # SUPERNOVA_MODEL_LAB_REFRESH=1
    model_lab_refresh_time: str  # SUPERNOVA_MODEL_LAB_REFRESH_TIME — HH:MM (RA + SDS accuracy)
    saturday_weekly_full_enabled: bool  # SUPERNOVA_SATURDAY_WEEKLY_FULL=1
    saturday_weekly_full_time: str  # SUPERNOVA_SATURDAY_WEEKLY_FULL_TIME — HH:MM (WeeklyFull sabato)
    saturday_weekly_full_window_end: str  # SUPERNOVA_SATURDAY_WEEKLY_FULL_END — HH:MM (fine finestra)
    scheduler_poll_seconds: int  # SUPERNOVA_SCHEDULER_POLL_SECONDS
    uvicorn_host: str
    uvicorn_port: int

    @classmethod
    def from_env(cls) -> SupernovaConfig:
        cors_permissive = _env_explicit_on("SUPERNOVA_CORS_PERMISSIVE")
        cors_origins = _parse_cors_origins()
        bind_all = _env_explicit_on("SUPERNOVA_BIND_ALL")
        token_raw = os.environ.get("SUPERNOVA_API_TOKEN", "").strip()
        api_token = token_raw or None
        serve_mobile = _env_explicit_on("SUPERNOVA_SERVE_MOBILE")
        mobile_dist = os.environ.get("SUPERNOVA_MOBILE_DIST", "").strip()
        serve_desktop = _env_explicit_on("SUPERNOVA_SERVE_DESKTOP")
        desktop_dist = os.environ.get("SUPERNOVA_DESKTOP_DIST", "").strip()
        try:
            scheduled_refresh_minutes = int(
                os.environ.get("SUPERNOVA_SCHEDULED_REFRESH_MINUTES", "0").strip() or "0"
            )
        except ValueError:
            scheduled_refresh_minutes = 0
        scheduled_refresh_minutes = max(0, min(24 * 60, scheduled_refresh_minutes))
        try:
            daily_refresh_hour = int(
                os.environ.get("SUPERNOVA_DAILY_REFRESH_HOUR", "-1").strip() or "-1"
            )
        except ValueError:
            daily_refresh_hour = -1
        daily_refresh_hour = max(-1, min(23, daily_refresh_hour))
        schedule_timezone = (
            os.environ.get("SUPERNOVA_SCHEDULE_TIMEZONE", "Europe/Rome").strip()
            or "Europe/Rome"
        )
        hourly_financial_enabled = _env_explicit_on("SUPERNOVA_HOURLY_FINANCIAL")
        hourly_financial_start = (
            os.environ.get("SUPERNOVA_HOURLY_FINANCIAL_START", "15:30").strip() or "15:30"
        )
        hourly_financial_end = (
            os.environ.get("SUPERNOVA_HOURLY_FINANCIAL_END", "22:00").strip() or "22:00"
        )
        morning_refresh_enabled = _env_explicit_on("SUPERNOVA_MORNING_REFRESH")
        morning_refresh_time = (
            os.environ.get("SUPERNOVA_MORNING_REFRESH_TIME", "07:00").strip() or "07:00"
        )
        sds_refresh_enabled = _env_explicit_on("SUPERNOVA_SDS_REFRESH")
        sds_refresh_time = (
            os.environ.get("SUPERNOVA_SDS_REFRESH_TIME", "09:00").strip() or "09:00"
        )
        eis_refresh_enabled = _env_explicit_on("SUPERNOVA_EIS_REFRESH")
        eis_refresh_time = (
            os.environ.get("SUPERNOVA_EIS_REFRESH_TIME", "10:00").strip() or "10:00"
        )
        model_lab_refresh_enabled = _env_explicit_on("SUPERNOVA_MODEL_LAB_REFRESH")
        model_lab_refresh_time = (
            os.environ.get("SUPERNOVA_MODEL_LAB_REFRESH_TIME", "16:30").strip() or "16:30"
        )
        saturday_weekly_full_enabled = _env_explicit_on("SUPERNOVA_SATURDAY_WEEKLY_FULL")
        saturday_weekly_full_time = (
            os.environ.get("SUPERNOVA_SATURDAY_WEEKLY_FULL_TIME", "07:00").strip() or "07:00"
        )
        saturday_weekly_full_window_end = (
            os.environ.get("SUPERNOVA_SATURDAY_WEEKLY_FULL_END", "14:00").strip() or "14:00"
        )
        try:
            scheduler_poll_seconds = int(
                os.environ.get("SUPERNOVA_SCHEDULER_POLL_SECONDS", "60").strip() or "60"
            )
        except ValueError:
            scheduler_poll_seconds = 60
        scheduler_poll_seconds = max(30, min(300, scheduler_poll_seconds))
        try:
            port = int(os.environ.get("SUPERNOVA_PORT", str(DEFAULT_PORT)).strip() or str(DEFAULT_PORT))
        except ValueError:
            port = DEFAULT_PORT
        port = max(1, min(65535, port))
        host = "0.0.0.0" if bind_all else "127.0.0.1"
        return cls(
            cors_permissive=cors_permissive,
            cors_origins=cors_origins,
            bind_all=bind_all,
            api_token=api_token,
            serve_mobile=serve_mobile,
            mobile_dist=mobile_dist,
            serve_desktop=serve_desktop,
            desktop_dist=desktop_dist,
            scheduled_refresh_minutes=scheduled_refresh_minutes,
            daily_refresh_hour=daily_refresh_hour,
            schedule_timezone=schedule_timezone,
            hourly_financial_enabled=hourly_financial_enabled,
            hourly_financial_start=hourly_financial_start,
            hourly_financial_end=hourly_financial_end,
            morning_refresh_enabled=morning_refresh_enabled,
            morning_refresh_time=morning_refresh_time,
            sds_refresh_enabled=sds_refresh_enabled,
            sds_refresh_time=sds_refresh_time,
            eis_refresh_enabled=eis_refresh_enabled,
            eis_refresh_time=eis_refresh_time,
            model_lab_refresh_enabled=model_lab_refresh_enabled,
            model_lab_refresh_time=model_lab_refresh_time,
            saturday_weekly_full_enabled=saturday_weekly_full_enabled,
            saturday_weekly_full_time=saturday_weekly_full_time,
            saturday_weekly_full_window_end=saturday_weekly_full_window_end,
            scheduler_poll_seconds=scheduler_poll_seconds,
            uvicorn_host=host,
            uvicorn_port=port,
        )


_config: SupernovaConfig | None = None


def get_supernova_config(*, reload: bool = False) -> SupernovaConfig:
    global _config
    if _config is None or reload:
        _config = SupernovaConfig.from_env()
    return _config


def reset_supernova_config() -> None:
    """Clear cached config (tests)."""
    global _config
    _config = None


__all__ = [
    "DEFAULT_PORT",
    "LOCALHOST_ORIGIN_REGEX",
    "TOKEN_HEADER",
    "SupernovaConfig",
    "get_supernova_config",
    "reset_supernova_config",
]
