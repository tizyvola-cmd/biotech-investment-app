"""
Salvataggio locale chiavi API AI (feed clinico / desktop UI).

File: data/ai_secrets.json (gitignored via data/).
Le chiavi vengono applicate a os.environ nel processo API — effetto immediato, no restart.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

_DATA_ROOT = Path(os.environ.get("DATA_DIR", "data"))
_SECRETS_FILE = _DATA_ROOT / "ai_secrets.json"
_lock = Lock()

# JSON field → env var
_FIELD_TO_ENV = {
    "anthropic_api_key": "ANTHROPIC_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
    "github_token": "GITHUB_TOKEN",
}

_ENV_TO_FIELD = {v: k for k, v in _FIELD_TO_ENV.items()}


def _mask(value: str) -> str:
    v = (value or "").strip()
    if len(v) <= 8:
        return "••••••••" if v else ""
    return f"{v[:7]}…{v[-4:]}"


def _read_file_raw() -> dict[str, Any]:
    if not _SECRETS_FILE.is_file():
        return {}
    try:
        raw = json.loads(_SECRETS_FILE.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _read_file() -> dict[str, str]:
    raw = _read_file_raw()
    out: dict[str, str] = {}
    for field, env_name in _FIELD_TO_ENV.items():
        val = str(raw.get(field) or "").strip()
        if val:
            out[field] = val
    return out


def load_and_apply() -> None:
    """Carica secrets da file e imposta os.environ (solo chiavi presenti nel file)."""
    with _lock:
        data = _read_file()
    for field, val in data.items():
        env_name = _FIELD_TO_ENV.get(field)
        if env_name and val:
            os.environ[env_name] = val


def get_status() -> dict[str, Any]:
    """Stato per UI: quali provider hanno chiave (senza esporre il valore completo)."""
    file_data = _read_file()
    providers: dict[str, Any] = {}
    for prov, env_name in (
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("openai", "OPENAI_API_KEY"),
        ("github", "GITHUB_TOKEN"),
    ):
        field = _ENV_TO_FIELD[env_name]
        from_file = field in file_data
        env_val = os.environ.get(env_name, "").strip()
        effective = env_val
        source = None
        if from_file:
            source = "ui"
            effective = file_data[field]
        elif env_val:
            source = "env"
        providers[prov] = {
            "set": bool(effective),
            "masked": _mask(effective) if effective else "",
            "source": source,
        }
    raw = _read_file_raw()
    prepaid_eur = raw.get("anthropic_prepaid_eur")
    try:
        prepaid_eur_f = round(float(prepaid_eur), 2) if prepaid_eur is not None else None
    except (TypeError, ValueError):
        prepaid_eur_f = None
    org_id = str(raw.get("anthropic_org_id") or "").strip() or None
    return {
        "providers": providers,
        "storage_hint": str(_SECRETS_FILE),
        "anthropic_console_url": "https://console.anthropic.com/settings/billing",
        "anthropic_prepaid_eur": prepaid_eur_f,
        "anthropic_prepaid_set_at": raw.get("anthropic_prepaid_set_at"),
        "anthropic_org_id": org_id,
    }


def save_secrets(
    *,
    anthropic_api_key: str | None = None,
    openai_api_key: str | None = None,
    github_token: str | None = None,
    anthropic_prepaid_eur: float | str | None = None,
    anthropic_org_id: str | None = None,
    clear_anthropic: bool = False,
    clear_openai: bool = False,
    clear_github: bool = False,
    clear_anthropic_prepaid: bool = False,
) -> dict[str, Any]:
    """
    Aggiorna data/ai_secrets.json. Valori None = non modificare.
    Stringa vuota o clear_* = rimuovi dal file e unset env.
    """
    updates: dict[str, str | None] = {}
    if anthropic_api_key is not None or clear_anthropic:
        updates["anthropic_api_key"] = "" if clear_anthropic else (anthropic_api_key or "").strip()
    if openai_api_key is not None or clear_openai:
        updates["openai_api_key"] = "" if clear_openai else (openai_api_key or "").strip()
    if github_token is not None or clear_github:
        updates["github_token"] = "" if clear_github else (github_token or "").strip()

    meta_updates: dict[str, Any] = {}
    if clear_anthropic_prepaid:
        meta_updates["anthropic_prepaid_eur"] = None
        meta_updates["anthropic_prepaid_set_at"] = None
    elif anthropic_prepaid_eur is not None:
        try:
            prepaid_f = round(float(str(anthropic_prepaid_eur).replace(",", ".")), 2)
            if prepaid_f >= 0:
                meta_updates["anthropic_prepaid_eur"] = prepaid_f
                from datetime import datetime, timezone

                meta_updates["anthropic_prepaid_set_at"] = (
                    datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                )
        except (TypeError, ValueError):
            pass
    if anthropic_org_id is not None:
        oid = str(anthropic_org_id or "").strip()
        meta_updates["anthropic_org_id"] = oid if oid else None

    with _lock:
        data = _read_file_raw()
        for field, val in updates.items():
            if val:
                data[field] = val
            elif field in data:
                del data[field]
        for mk, mv in meta_updates.items():
            if mv is None:
                data.pop(mk, None)
            else:
                data[mk] = mv
        _SECRETS_FILE.parent.mkdir(parents=True, exist_ok=True)
        if data:
            _SECRETS_FILE.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        elif _SECRETS_FILE.is_file():
            _SECRETS_FILE.unlink(missing_ok=True)

        for field, env_name in _FIELD_TO_ENV.items():
            if field in updates:
                if updates[field]:
                    os.environ[env_name] = updates[field]  # type: ignore[arg-type]
                else:
                    os.environ.pop(env_name, None)

    load_and_apply()
    try:
        from ai_billing import get_anthropic_balance

        get_anthropic_balance(force_refresh=True)
    except Exception:
        pass
    status = get_status()
    try:
        from ai_provider import provider_info

        status["provider"] = provider_info()
    except Exception:
        pass
    return status
