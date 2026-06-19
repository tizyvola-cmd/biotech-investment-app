"""
Traccia i token consumati per provider e stima il costo.
Persiste in data/ai_usage_log.json (append-only, max 10k righe).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

_LOG_FILE = Path("data/ai_usage_log.json")
_lock = Lock()

# Prezzi per 1M token (USD) — aggiornare se Anthropic/OpenAI cambiano tariffe
_PRICE_PER_1M: dict[str, dict[str, float]] = {
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-opus-4-7": {"input": 15.00, "output": 75.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "openai/gpt-4o": {"input": 2.50, "output": 10.00},
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
}
_DEFAULT_PRICE = {"input": 3.00, "output": 15.00}


def _normalize_model_key(model: str) -> str:
    m = (model or "").strip().lower()
    if m.startswith("openai/"):
        return m
    return m


def record_usage(
    provider: str,
    model: str,
    task: str,
    input_tokens: int,
    output_tokens: int,
) -> dict:
    """Registra utilizzo e ritorna il record con costo stimato."""
    model_key = _normalize_model_key(model)
    prices = _PRICE_PER_1M.get(model_key, _DEFAULT_PRICE)
    cost_usd = (
        max(0, int(input_tokens)) / 1_000_000 * prices["input"]
        + max(0, int(output_tokens)) / 1_000_000 * prices["output"]
    )
    record = {
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider": provider,
        "model": model,
        "task": task,
        "input_tokens": max(0, int(input_tokens)),
        "output_tokens": max(0, int(output_tokens)),
        "cost_usd": round(cost_usd, 6),
    }
    with _lock:
        rows: list = []
        if _LOG_FILE.exists():
            try:
                raw = json.loads(_LOG_FILE.read_text(encoding="utf-8"))
                if isinstance(raw, list):
                    rows = raw
            except Exception:
                rows = []
        rows.append(record)
        rows = rows[-10_000:]
        _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        _LOG_FILE.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return record


def get_usage_summary(days: int = 30) -> dict[str, dict[str, float | int]]:
    """Sommario ultimi N giorni per provider."""
    if not _LOG_FILE.exists():
        return {}
    try:
        rows = json.loads(_LOG_FILE.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            return {}
    except Exception:
        return {}

    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, days))).isoformat()
    summary: dict[str, dict[str, float | int]] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        if str(r.get("ts", "")) < cutoff:
            continue
        p = str(r.get("provider", "unknown"))
        if p not in summary:
            summary[p] = {
                "calls": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
            }
        summary[p]["calls"] = int(summary[p]["calls"]) + 1
        summary[p]["input_tokens"] = int(summary[p]["input_tokens"]) + int(
            r.get("input_tokens", 0)
        )
        summary[p]["output_tokens"] = int(summary[p]["output_tokens"]) + int(
            r.get("output_tokens", 0)
        )
        summary[p]["cost_usd"] = round(
            float(summary[p]["cost_usd"]) + float(r.get("cost_usd", 0)), 4
        )
    return summary
