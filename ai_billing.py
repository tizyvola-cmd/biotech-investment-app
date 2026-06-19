"""
Saldo crediti Anthropic per UI feed clinico.

1. Se possibile, legge il prepaid live dalla console Anthropic (org id + API key).
2. Altrimenti: crediti caricati (€) − spesa stimata locale dal top-up.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ai_secrets_store import get_status as _secrets_status

# 1 EUR ≈ USD (stima per convertire cost_usd del log locale → €)
EUR_PER_USD = float(os.environ.get("AI_EUR_PER_USD", "0.92") or "0.92")

_DATA_ROOT = Path(os.environ.get("DATA_DIR", "data"))
_USAGE_LOG = _DATA_ROOT / "ai_usage_log.json"
_BALANCE_CACHE = _DATA_ROOT / "ai_anthropic_balance_cache.json"
_CACHE_TTL_S = 120


def _read_secrets_meta() -> dict[str, Any]:
    st = _secrets_status()
    return {
        "anthropic_prepaid_eur": st.get("anthropic_prepaid_eur"),
        "anthropic_prepaid_set_at": st.get("anthropic_prepaid_set_at"),
        "anthropic_org_id": st.get("anthropic_org_id"),
        "has_key": bool(st.get("providers", {}).get("anthropic", {}).get("set")),
    }


def get_provider_cost_usd_since(provider: str, since_iso: str | None = None) -> float:
    if not _USAGE_LOG.is_file():
        return 0.0
    try:
        rows = json.loads(_USAGE_LOG.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            return 0.0
    except Exception:
        return 0.0
    total = 0.0
    since = (since_iso or "").strip()
    for r in rows:
        if not isinstance(r, dict):
            continue
        if str(r.get("provider", "")) != provider:
            continue
        if since and str(r.get("ts", "")) < since:
            continue
        try:
            total += float(r.get("cost_usd", 0) or 0)
        except (TypeError, ValueError):
            continue
    return round(total, 4)


def _write_balance_cache(payload: dict[str, Any]) -> None:
    try:
        _BALANCE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        _BALANCE_CACHE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _read_balance_cache() -> dict[str, Any] | None:
    if not _BALANCE_CACHE.is_file():
        return None
    try:
        data = json.loads(_BALANCE_CACHE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _fetch_live_prepaid_usd(api_key: str, org_id: str) -> tuple[float | None, str | None]:
    """Tenta GET console prepaid/credits (amount in centesimi USD). Non ufficiale."""
    org = (org_id or "").strip()
    key = (api_key or "").strip()
    if not org or not key:
        return None, "org_or_key_missing"

    url = f"https://console.anthropic.com/api/organizations/{org}/prepaid/credits"
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Accept": "application/json",
        "User-Agent": "BiotechDesktop/1.0",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            if isinstance(data, dict):
                cents = data.get("amount")
                if cents is not None:
                    return round(float(cents) / 100.0, 2), None
                bal = data.get("balance_usd") or data.get("balance")
                if bal is not None:
                    return round(float(bal), 2), None
            return None, "unexpected_response"
    except urllib.error.HTTPError as e:
        return None, f"http_{e.code}"
    except Exception as exc:
        return None, str(exc)[:120]


def get_anthropic_balance(*, force_refresh: bool = False) -> dict[str, Any]:
    """
    Ritorna saldo per UI:
      remaining_eur, remaining_usd, source, spent_eur, prepaid_eur, updated_at, hint
    """
    now = datetime.now(timezone.utc)
    if not force_refresh:
        cached = _read_balance_cache()
        if cached:
            try:
                ts = datetime.fromisoformat(str(cached.get("updated_at", "")).replace("Z", "+00:00"))
                if (now - ts).total_seconds() < _CACHE_TTL_S:
                    return cached
            except Exception:
                pass

    meta = _read_secrets_meta()
    prepaid_eur_raw = meta.get("anthropic_prepaid_eur")
    prepaid_set_at = str(meta.get("anthropic_prepaid_set_at") or "").strip() or None
    org_id = str(meta.get("anthropic_org_id") or os.environ.get("ANTHROPIC_ORG_ID") or "").strip()

    try:
        from ai_provider import get_api_key

        api_key = get_api_key("anthropic") or ""
    except Exception:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()

    prepaid_eur: float | None = None
    if prepaid_eur_raw is not None:
        try:
            prepaid_eur = round(float(prepaid_eur_raw), 2)
        except (TypeError, ValueError):
            prepaid_eur = None

    spent_usd = get_provider_cost_usd_since("anthropic", prepaid_set_at)
    spent_eur = round(spent_usd * EUR_PER_USD, 2)

    live_usd: float | None = None
    live_err: str | None = None
    if org_id and api_key:
        live_usd, live_err = _fetch_live_prepaid_usd(api_key, org_id)

    remaining_eur: float | None = None
    remaining_usd: float | None = None
    source = "unset"

    if live_usd is not None:
        remaining_usd = live_usd
        remaining_eur = round(live_usd * EUR_PER_USD, 2)
        source = "live"
    elif prepaid_eur is not None and prepaid_eur > 0:
        remaining_eur = round(max(0.0, prepaid_eur - spent_eur), 2)
        remaining_usd = round(remaining_eur / EUR_PER_USD, 2) if EUR_PER_USD else None
        source = "estimated"

    out: dict[str, Any] = {
        "remaining_eur": remaining_eur,
        "remaining_usd": remaining_usd,
        "prepaid_eur": prepaid_eur,
        "spent_eur": spent_eur,
        "spent_usd": spent_usd,
        "source": source,
        "live_error": live_err,
        "org_id_set": bool(org_id),
        "prepaid_set_at": prepaid_set_at,
        "updated_at": now.isoformat().replace("+00:00", "Z"),
    }
    _write_balance_cache(out)
    return out
