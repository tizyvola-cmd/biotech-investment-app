"""
Multi-provider AI abstraction
=============================
Default priority (when AI_PROVIDER is unset): Anthropic → OpenAI → GitHub Models.

Force a provider with AI_PROVIDER=github | anthropic | openai (needs matching key).

Configure via environment variables (in .env or system env):
  AI_PROVIDER        — optional: github | anthropic | openai
  ANTHROPIC_API_KEY  — Anthropic Claude (requires paid credits)
  OPENAI_API_KEY     — OpenAI (requires paid credits)
  GITHUB_TOKEN       — GitHub PAT with **models:read** (fine-grained) or **models**
                        scope (classic). Requires GitHub Copilot subscription.
                        Endpoint: https://models.github.ai/inference/

Model selection per provider:
  Anthropic  — CATALYST_CLAUDE_MODEL  (default: claude-haiku-4-5-20251001)
               SUMMARY_CLAUDE_MODEL   (default: claude-sonnet-4-6)
               CLINICAL_KPI_CLAUDE_MODEL (default: SUMMARY model — pre-CD / KPI / deep)
  GitHub     — GITHUB_MODELS_MODEL    (default: gpt-4o-mini)
               GITHUB_CLINICAL_MODEL    (default: openai/gpt-4o — clinical feed KPI)
  OpenAI     — OPENAI_MODELS_MODEL    (default: gpt-4o-mini)
               OPENAI_CLINICAL_MODEL    (default: gpt-4o)
"""

from __future__ import annotations

import json
import os
import pathlib
import time
from typing import Any

# Headlines written when a provider was missing or misconfigured — must re-extract.
_STALE_HEADLINE_MARKERS = (
    "anthropic_api_key not set",
    "ai provider not configured",
)

_PROVIDER_KEY = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "github": "GITHUB_TOKEN",
}

_PROVIDER_LABEL = {
    "anthropic": "Claude (Anthropic)",
    "openai": "OpenAI",
    "github": "GitHub Models (Copilot)",
}

_LAST_ERRORS: dict[str, str] = {}
_LAST_SUCCESS: bool = False
_GITHUB_RATE_LIMIT_UNTIL: float = 0.0

_DATA_ROOT = pathlib.Path(os.environ.get("DATA_DIR", "data"))
_OVERRIDE_FILE = _DATA_ROOT / "ai_provider_override.json"
_LEGACY_SESSION_FILE = _DATA_ROOT / "ai_provider_session.json"
_runtime_provider: str | None = None
_RUNTIME_LOADED = False

ANTHROPIC_BILLING_URL = "https://console.anthropic.com/settings/billing"


def _load_runtime_override() -> str | None:
    global _runtime_provider, _RUNTIME_LOADED
    if _RUNTIME_LOADED:
        return _runtime_provider
    _RUNTIME_LOADED = True
    for path in (_OVERRIDE_FILE, _LEGACY_SESSION_FILE):
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            p = str(data.get("provider") or "").strip().lower()
            if p in _PROVIDER_KEY:
                _runtime_provider = p
                if path == _LEGACY_SESSION_FILE and not _OVERRIDE_FILE.is_file():
                    _persist_runtime_override(p)
                return _runtime_provider
        except Exception:
            continue
    _runtime_provider = None
    return None


def _persist_runtime_override(provider: str) -> None:
    from datetime import datetime, timezone

    _OVERRIDE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _OVERRIDE_FILE.write_text(
        json.dumps(
            {
                "provider": provider,
                "set_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def get_active_provider() -> str:
    """Provider scelto: override runtime > AI_PROVIDER env > default anthropic."""
    global _runtime_provider
    if _runtime_provider is not None:
        return _runtime_provider
    loaded = _load_runtime_override()
    if loaded:
        return loaded
    env = os.environ.get("AI_PROVIDER", "").strip().lower()
    if env in _PROVIDER_KEY:
        return env
    return "anthropic"


def set_active_provider(provider: str) -> None:
    """Cambia provider a runtime e persiste in data/ai_provider_override.json."""
    global _runtime_provider, _RUNTIME_LOADED
    key = str(provider or "").strip().lower()
    if key not in _PROVIDER_KEY:
        raise ValueError(f"Provider non supportato: {provider}")
    if not _provider_if_key(key):
        raise ValueError(
            f"{_PROVIDER_LABEL.get(key, key)} non configurato "
            f"(inserisci la chiave nel feed clinico o in .env)"
        )
    _runtime_provider = key
    _RUNTIME_LOADED = True
    _persist_runtime_override(key)


def set_session_provider(name: str | None) -> dict[str, Any]:
    """Compat API: imposta override runtime (None non supportato — usa env default)."""
    key = (name or "").strip().lower()
    if not key:
        return {"ok": False, "error": "Provider richiesto (anthropic | openai | github)"}
    try:
        set_active_provider(key)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "provider": key,
        "session": key,
        "label": provider_label(key),
    }


# ── Provider detection ─────────────────────────────────────────────────────────


def get_api_key(provider: str) -> str | None:
    """Chiave API effettiva (env + eventuale data/ai_secrets.json via load_and_apply)."""
    env_name = _PROVIDER_KEY.get(provider, "")
    if not env_name:
        return None
    val = os.environ.get(env_name, "").strip()
    return val or None


def _provider_if_key(name: str) -> str | None:
    if get_api_key(name):
        return name
    return None


def configured_providers() -> list[str]:
    out: list[str] = []
    for name in ("anthropic", "openai", "github"):
        if _provider_if_key(name):
            out.append(name)
    return out


def active_provider() -> str | None:
    """Provider effettivo per chiamate AI (deve avere API key configurata)."""
    preferred = get_active_provider()
    if _provider_if_key(preferred):
        return preferred
    for name in ("anthropic", "openai", "github"):
        if _provider_if_key(name):
            return name
    return None


def provider_label(name: str | None = None) -> str:
    p = name or active_provider()
    if not p:
        return "none"
    return _PROVIDER_LABEL.get(p, p)


def is_available() -> bool:
    return active_provider() is not None


def is_stale_extraction(extracted: dict[str, Any] | None) -> bool:
    """True when cached AI output should be discarded and re-run."""
    if not extracted:
        return False
    headline = str(extracted.get("headline") or "").lower()
    return any(marker in headline for marker in _STALE_HEADLINE_MARKERS)


def _allow_fallback() -> bool:
    return os.environ.get("AI_ALLOW_FALLBACK", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _classify_error(exc: str) -> str:
    low = exc.lower()
    if "no_access" in low or "models` permission" in low or "models:read" in low:
        return "github_no_access"
    if "too many requests" in low or "rate limit" in low or "429" in low:
        return "rate_limit"
    if "credit balance" in low or "insufficient" in low and "anthropic" in low:
        return "anthropic_no_credits"
    if "unauthorized" in low or "401" in low:
        return "auth_failed"
    return "unknown"


def friendly_error_message(
    *,
    lang: str = "it",
    provider: str | None = None,
) -> str | None:
    """User-facing message from the last provider error (if any)."""
    p = provider or active_provider()
    if not p:
        return None
    err = _LAST_ERRORS.get(p, "")
    if not err:
        return None
    it = lang.startswith("it")
    kind = _classify_error(err)
    if kind == "rate_limit":
        alt = configured_providers()
        has_alt = len(alt) > 1
        wait_s = int(github_rate_limit_cooldown_s())
        wait_note = (
            f" Riprova tra ~{wait_s}s." if wait_s > 0 else " Attendi 1–2 minuti e riprova."
        )
        if it:
            msg = (
                "Limite richieste GitHub Models (troppe chiamate in poco tempo)."
                + wait_note
                + " Disattiva «Ricerca live» e invia un messaggio alla volta."
            )
            if has_alt:
                msg += " Provider alternativo in .env verrà usato automaticamente."
            else:
                msg += " Aggiungi ANTHROPIC_API_KEY o OPENAI_API_KEY in .env e riavvia l'API."
            return msg
        wait_en = f" Retry in ~{wait_s}s." if wait_s > 0 else " Wait 1–2 minutes and retry."
        return (
            "GitHub Models rate limit (too many requests)."
            + wait_en
            + " Disable live search and send one message at a time."
            + (
                " A fallback provider in .env will be used automatically."
                if has_alt
                else " Add ANTHROPIC_API_KEY or OPENAI_API_KEY in .env and restart the API."
            )
        )
    if kind == "github_no_access":
        return (
            "Account GitHub senza accesso ai modelli (Copilot Models)."
            if it
            else "GitHub account has no Models API access."
        )
    if kind == "auth_failed":
        return "Token API non valido o scaduto — controlla .env." if it else "Invalid or expired API token."
    return f"{provider_label(p)}: {err[:200]}"


def _build_user_hint(*, lang: str = "it") -> str:
    forced = os.environ.get("AI_PROVIDER", "").strip().lower()
    errs = dict(_LAST_ERRORS)
    it = lang.startswith("it")
    parts: list[str] = []

    if forced == "github" or "github" in configured_providers():
        ge = errs.get("github", "")
        if "no_access" in ge.lower():
            parts.append(
                "Copilot/GitHub Models: account senza accesso ai modelli (no_access). "
                "Serve abbonamento Copilot attivo + PAT con permesso Models (read). "
                "Prova il playground su github.com/marketplace/models."
                if it
                else "Copilot/GitHub Models: no model access (no_access). "
                "Need active Copilot + PAT with Models read. Try github.com/marketplace/models."
            )
        elif ge:
            fe = friendly_error_message(lang="it" if it else "en", provider="github")
            parts.append(fe or f"GitHub Models: {ge[:120]}")

    if forced != "github" and "anthropic" in configured_providers():
        ae = errs.get("anthropic", "")
        if "credit balance" in ae.lower():
            parts.append(
                "Provider alternativo: crediti API esauriti."
                if it
                else "Alternate provider: API credits exhausted."
            )

    if not parts:
        if not is_available():
            return (
                "Nessun provider AI configurato in .env (GITHUB_TOKEN + AI_PROVIDER=github)."
                if it
                else "No AI provider in .env (GITHUB_TOKEN + AI_PROVIDER=github)."
            )
        if _LAST_SUCCESS:
            return (
                "GitHub Copilot attivo — ultima chiamata AI riuscita."
                if it
                else "GitHub Copilot active — last AI call succeeded."
            )
        return (
            "Provider configurato; esegui di nuovo «Arricchisci clinico»."
            if it
            else "Provider configured; run «Enrich clinical» again."
        )
    return " ".join(parts)


def provider_info() -> dict[str, Any]:
    """Stato provider per UI (include override, usage, console billing)."""
    try:
        from ai_usage_tracker import get_usage_summary
    except ImportError:
        get_usage_summary = lambda days=30: {}  # type: ignore

    selected = get_active_provider()
    active = active_provider()
    return {
        "provider": selected,
        "active": active,
        "label": provider_label(active or selected),
        "session": selected,
        "forced": os.environ.get("AI_PROVIDER", "").strip().lower() or None,
        "configured": configured_providers(),
        "available": active is not None,
        "allow_fallback": _allow_fallback(),
        "errors": dict(_LAST_ERRORS),
        "hint_it": _build_user_hint(lang="it"),
        "hint_en": _build_user_hint(lang="en"),
        "last_success": _LAST_SUCCESS,
        "github_rate_limited": github_rate_limited(),
        "github_cooldown_s": round(github_rate_limit_cooldown_s()),
        "usage_30d": get_usage_summary(days=30),
        "anthropic_console_url": ANTHROPIC_BILLING_URL,
        "anthropic_balance": _anthropic_balance_for_ui(),
        "secrets": _secrets_status_for_provider_info(),
    }


def _anthropic_balance_for_ui() -> dict[str, Any]:
    try:
        from ai_billing import get_anthropic_balance

        return get_anthropic_balance()
    except Exception:
        return {"source": "unset", "remaining_eur": None, "remaining_usd": None}


def _secrets_status_for_provider_info() -> dict[str, Any]:
    try:
        import ai_secrets_store as _sec

        return _sec.get_status()
    except Exception:
        return {}


# ── Main call ──────────────────────────────────────────────────────────────────


def _call_provider(
    provider: str,
    prompt: str,
    *,
    system: str | None,
    max_tokens: int,
    model_override: str | None,
    task: str,
) -> str | None:
    if provider == "anthropic":
        return _call_anthropic(
            prompt,
            system=system,
            max_tokens=max_tokens,
            model_override=model_override,
            task=task,
        )
    if provider == "openai":
        oa_key = get_api_key("openai")
        if not oa_key:
            _LAST_ERRORS["openai"] = "OPENAI_API_KEY not set"
            return None
        return _call_openai_compat(
            prompt,
            system=system,
            max_tokens=max_tokens,
            base_url=None,
            api_key=oa_key,
            model=_openai_compat_model_for_task(task, "openai", model_override),
            provider_name="openai",
            task=task,
        )
    if provider == "github":
        gh_key = get_api_key("github")
        if not gh_key:
            _LAST_ERRORS["github"] = "GITHUB_TOKEN not set"
            return None
        model = _openai_compat_model_for_task(task, "github", model_override)
        if model and "/" not in model:
            model = f"openai/{model}"
        return _call_openai_compat(
            prompt,
            system=system,
            max_tokens=max_tokens,
            base_url="https://models.github.ai/inference",
            api_key=gh_key,
            model=model,
            provider_name="github",
            task=task,
        )
    return None


def github_rate_limited() -> bool:
    """True while GitHub Models is in a post-429 cooldown window."""
    return time.time() < _GITHUB_RATE_LIMIT_UNTIL


def github_rate_limit_cooldown_s() -> float:
    """Seconds until GitHub Models may be tried again (0 if not cooling down)."""
    return max(0.0, _GITHUB_RATE_LIMIT_UNTIL - time.time())


def _mark_github_rate_limit() -> None:
    global _GITHUB_RATE_LIMIT_UNTIL
    secs = max(30.0, float(os.environ.get("GITHUB_RATE_LIMIT_COOLDOWN_S", "120")))
    _GITHUB_RATE_LIMIT_UNTIL = time.time() + secs


def _provider_try_order(*, prefer_non_github: bool = False, task: str = "default") -> list[str]:
    preferred = get_active_provider()
    if task in ("clinical_kpi", "summary"):
        base = ("anthropic", "github", "openai")
    else:
        base = ("anthropic", "openai", "github")
    configured = [p for p in base if p in configured_providers()]
    if not configured:
        return []
    if prefer_non_github and github_rate_limited():
        configured = [p for p in configured if p != "github"] + (
            ["github"] if "github" in configured_providers() else []
        )
    if preferred in configured:
        if preferred == "github" and prefer_non_github and github_rate_limited():
            return [p for p in configured if p != preferred] + (
                ["github"] if "github" in configured_providers() else []
            )
        return [preferred] + [p for p in configured if p != preferred]
    return configured


def call_ai_chat(
    prompt: str,
    *,
    system: str | None = None,
    max_tokens: int = 1536,
    model_override: str | None = None,
) -> str | None:
    """
    Chat-oriented AI call: tries all configured providers (Anthropic/OpenAI before
    GitHub when GitHub is rate-limited). Use for Catalyst Copilot.
    """
    global _LAST_SUCCESS
    order = _provider_try_order(prefer_non_github=True)
    if not order:
        return None

    for provider in order:
        if provider == "github" and github_rate_limited():
            continue
        out = _call_provider(
            provider,
            prompt,
            system=system,
            max_tokens=max_tokens,
            model_override=model_override,
            task="summary",
        )
        if out:
            _LAST_SUCCESS = True
            _LAST_ERRORS.pop(provider, None)
            return out
        err = _LAST_ERRORS.get(provider, "")
        if provider == "github" and _classify_error(err) == "rate_limit":
            _mark_github_rate_limit()
            print(
                f"[ai_provider] GitHub rate limit — cooldown {_GITHUB_RATE_LIMIT_UNTIL - time.time():.0f}s",
                flush=True,
            )

    _LAST_SUCCESS = False
    return None


def call_ai(
    prompt: str,
    *,
    system: str | None = None,
    max_tokens: int = 1024,
    model_override: str | None = None,
    task: str = "default",  # "catalyst" | "summary" | "clinical_kpi" | "default"
) -> str | None:
    """Call configured AI provider(s). Returns raw text or None on failure."""
    primary = active_provider()
    if not primary:
        return None

    global _LAST_SUCCESS
    out = _call_provider(
        primary,
        prompt,
        system=system,
        max_tokens=max_tokens,
        model_override=model_override,
        task=task,
    )
    if out:
        _LAST_SUCCESS = True
        _LAST_ERRORS.pop(primary, None)
        return out

    if not _allow_fallback():
        _LAST_SUCCESS = False
        return None

    for fallback in _provider_try_order(task=task)[1:]:
        if fallback == primary:
            continue
        print(f"[ai_provider] {primary} failed — trying {fallback}", flush=True)
        out = _call_provider(
            fallback,
            prompt,
            system=system,
            max_tokens=max_tokens,
            model_override=model_override,
            task=task,
        )
        if out:
            _LAST_SUCCESS = True
            _LAST_ERRORS.pop(fallback, None)
            return out
    _LAST_SUCCESS = False
    return None


def no_provider_placeholder(task: str = "default") -> dict[str, Any]:
    """Structured placeholder returned when no AI provider is configured."""
    msg = (
        "No AI provider configured. Add one of these to your .env:\n"
        "  ANTHROPIC_API_KEY  (console.anthropic.com — requires credits)\n"
        "  GITHUB_TOKEN       (github.com/settings/tokens — free with Copilot)\n"
        "  OPENAI_API_KEY     (platform.openai.com — requires credits)"
    )
    if task == "catalyst":
        return {
            "catalyst_type": "other",
            "headline": "[AI provider not configured — see .env]",
            "trial_name": None,
            "phase": None,
            "endpoint_met": None,
            "key_metric": None,
            "next_milestone": None,
            "confidence": 0.0,
            "_no_provider_msg": msg,
        }
    if task == "summary":
        return {
            "outcome": "pending",
            "executive_summary": "[AI provider not configured — see .env]",
            "primary_endpoint": None,
            "key_metrics": None,
            "safety_profile": None,
            "patient_population": None,
            "key_publications": [],
            "investment_note": None,
            "data_quality": "low",
            "_no_provider_msg": msg,
        }
    return {"error": msg}


# ── Anthropic ──────────────────────────────────────────────────────────────────

_DEFAULT_CATALYST_MODEL = "claude-haiku-4-5-20251001"
_DEFAULT_SUMMARY_MODEL  = "claude-sonnet-4-6"
_CLINICAL_KPI_TASKS = frozenset({"summary", "clinical_kpi", "deep_clinical"})


def _anthropic_model_for_task(task: str, model_override: str | None) -> str:
    if model_override:
        return model_override
    if task == "catalyst":
        return (
            os.environ.get("CATALYST_CLAUDE_MODEL")
            or _DEFAULT_CATALYST_MODEL
        )
    if task in _CLINICAL_KPI_TASKS:
        return (
            os.environ.get("CLINICAL_KPI_CLAUDE_MODEL")
            or os.environ.get("SUMMARY_CLAUDE_MODEL")
            or _DEFAULT_SUMMARY_MODEL
        )
    return os.environ.get("SUMMARY_CLAUDE_MODEL") or _DEFAULT_SUMMARY_MODEL


def _openai_compat_model_for_task(task: str, provider: str, model_override: str | None) -> str:
    if model_override:
        return model_override
    if task in _CLINICAL_KPI_TASKS:
        if provider == "github":
            return os.environ.get(
                "GITHUB_CLINICAL_MODEL",
                os.environ.get("GITHUB_MODELS_MODEL", "openai/gpt-4o"),
            )
        return os.environ.get(
            "OPENAI_CLINICAL_MODEL",
            os.environ.get("OPENAI_MODELS_MODEL", "gpt-4o"),
        )
    if provider == "github":
        return os.environ.get("GITHUB_MODELS_MODEL", "openai/gpt-4o-mini")
    return os.environ.get("OPENAI_MODELS_MODEL", "gpt-4o-mini")


def _call_anthropic(
    prompt: str,
    *,
    system: str | None,
    max_tokens: int,
    model_override: str | None,
    task: str,
) -> str | None:
    model = _anthropic_model_for_task(task, model_override)
    try:
        import anthropic
        api_key = get_api_key("anthropic")
        if not api_key:
            _LAST_ERRORS["anthropic"] = "ANTHROPIC_API_KEY not set"
            return None
        timeout_s = float(os.environ.get("COPILOT_CHAT_TIMEOUT_S", "85"))
        client = anthropic.Anthropic(api_key=api_key, timeout=timeout_s)
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        msg = client.messages.create(**kwargs)
        usage = getattr(msg, "usage", None)
        if usage is not None:
            try:
                from ai_usage_tracker import record_usage

                record_usage(
                    "anthropic",
                    model,
                    task,
                    int(getattr(usage, "input_tokens", 0) or 0),
                    int(getattr(usage, "output_tokens", 0) or 0),
                )
                try:
                    from ai_billing import get_anthropic_balance

                    get_anthropic_balance(force_refresh=True)
                except Exception:
                    pass
            except Exception:
                pass
        return msg.content[0].text
    except Exception as exc:
        err = str(exc)
        _LAST_ERRORS["anthropic"] = err
        print(f"[ai_provider] Anthropic error: {exc}", flush=True)
        return None


# ── OpenAI-compatible (OpenAI direct + GitHub Models) ─────────────────────────


def _call_openai_compat(
    prompt: str,
    *,
    system: str | None,
    max_tokens: int,
    base_url: str | None,
    api_key: str,
    model: str,
    provider_name: str = "openai",
    task: str = "default",
) -> str | None:
    try:
        from openai import OpenAI
    except ImportError:
        print("[ai_provider] openai package not installed. Run: pip install openai", flush=True)
        return None

    timeout_s = float(os.environ.get("COPILOT_CHAT_TIMEOUT_S", "85"))
    kwargs: dict[str, Any] = {"api_key": api_key, "timeout": timeout_s}
    if base_url:
        kwargs["base_url"] = base_url
    client = OpenAI(**kwargs)
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    max_retries = max(0, min(4, int(os.environ.get("AI_RATE_LIMIT_RETRIES", "2"))))
    backoff = max(2.0, float(os.environ.get("AI_RATE_LIMIT_BACKOFF_S", "8")))

    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            r = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
            )
            usage = getattr(r, "usage", None)
            if usage is not None:
                try:
                    from ai_usage_tracker import record_usage

                    record_usage(
                        provider_name,
                        model,
                        task,
                        int(getattr(usage, "prompt_tokens", 0) or 0),
                        int(getattr(usage, "completion_tokens", 0) or 0),
                    )
                except Exception:
                    pass
            return r.choices[0].message.content
        except Exception as exc:
            last_exc = exc
            err = str(exc)
            _LAST_ERRORS[provider_name] = err
            if _classify_error(err) == "rate_limit" and attempt < max_retries:
                wait = backoff * (attempt + 1)
                print(
                    f"[ai_provider] {provider_name} rate limit — retry {attempt + 1}/{max_retries} in {wait:.0f}s",
                    flush=True,
                )
                time.sleep(wait)
                continue
            if provider_name == "github" and _classify_error(err) == "rate_limit":
                _mark_github_rate_limit()
            print(
                f"[ai_provider] OpenAI-compat error ({base_url or 'openai.com'}): {exc}",
                flush=True,
            )
            return None
    if last_exc is not None:
        _LAST_ERRORS[provider_name] = str(last_exc)
    return None
