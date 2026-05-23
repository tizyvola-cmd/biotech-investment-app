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


@dataclass(frozen=True)
class SupernovaConfig:
    """SuperNova API security and server bind settings."""

    cors_permissive: bool  # SUPERNOVA_CORS_PERMISSIVE=1 → allow_origins *
    bind_all: bool  # SUPERNOVA_BIND_ALL=1 → uvicorn host 0.0.0.0
    api_token: str | None  # SUPERNOVA_API_TOKEN — required on mutating routes if set
    uvicorn_host: str
    uvicorn_port: int

    @classmethod
    def from_env(cls) -> SupernovaConfig:
        cors_permissive = _env_explicit_on("SUPERNOVA_CORS_PERMISSIVE")
        bind_all = _env_explicit_on("SUPERNOVA_BIND_ALL")
        token_raw = os.environ.get("SUPERNOVA_API_TOKEN", "").strip()
        api_token = token_raw or None
        try:
            port = int(os.environ.get("SUPERNOVA_PORT", str(DEFAULT_PORT)).strip() or str(DEFAULT_PORT))
        except ValueError:
            port = DEFAULT_PORT
        port = max(1, min(65535, port))
        host = "0.0.0.0" if bind_all else "127.0.0.1"
        return cls(
            cors_permissive=cors_permissive,
            bind_all=bind_all,
            api_token=api_token,
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
