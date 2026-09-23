"""
Per-user (and per-IP) daily budgets for expensive AI / Gemini paths.

Shared Gemini quota must not be burnable by a single tester or anonymous IP.
Admin API token bypasses the daily cap (ops / prefetch still need headroom).
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

_lock = threading.Lock()
# key -> list of unix timestamps (hits in the rolling window)
_hits: dict[str, list[float]] = {}

# Defaults: generous for beta, hard enough to stop abuse / cost spikes.
_DEFAULT_MAX = 40
_DEFAULT_WINDOW_S = 24 * 3600.0


def _max_hits() -> int:
    raw = os.environ.get("SUPERNOVA_AI_BUDGET_PER_DAY", "").strip()
    try:
        n = int(raw) if raw else _DEFAULT_MAX
    except ValueError:
        n = _DEFAULT_MAX
    return max(1, min(5000, n))


def _window_s() -> float:
    raw = os.environ.get("SUPERNOVA_AI_BUDGET_WINDOW_S", "").strip()
    try:
        w = float(raw) if raw else _DEFAULT_WINDOW_S
    except ValueError:
        w = _DEFAULT_WINDOW_S
    return max(60.0, min(7 * 24 * 3600.0, w))


def budget_key(*, tester_id: str | None, client_ip: str | None) -> str:
    tid = (tester_id or "").strip()
    if tid:
        return f"tester:{tid}"
    ip = (client_ip or "unknown").strip()[:64] or "unknown"
    return f"ip:{ip}"


def allow(key: str) -> tuple[bool, dict[str, Any]]:
    """
    Record one AI hit for ``key`` if under budget.

    Returns (allowed, meta) where meta includes remaining / limit / retry_after_s.
    """
    now = time.time()
    limit = _max_hits()
    window = _window_s()
    with _lock:
        bucket = [t for t in (_hits.get(key) or []) if now - t < window]
        used = len(bucket)
        if used >= limit:
            _hits[key] = bucket
            oldest = bucket[0] if bucket else now
            retry = max(1, int(window - (now - oldest)))
            return False, {
                "allowed": False,
                "limit": limit,
                "used": used,
                "remaining": 0,
                "window_s": int(window),
                "retry_after_s": retry,
                "key": key.split(":", 1)[0],
            }
        bucket.append(now)
        _hits[key] = bucket
        if len(_hits) > 20_000:
            stale = [k for k, v in _hits.items() if not v or now - v[-1] > window]
            for k in stale[:2000]:
                _hits.pop(k, None)
        return True, {
            "allowed": True,
            "limit": limit,
            "used": used + 1,
            "remaining": max(0, limit - (used + 1)),
            "window_s": int(window),
            "retry_after_s": 0,
            "key": key.split(":", 1)[0],
        }


def peek(key: str) -> dict[str, Any]:
    now = time.time()
    limit = _max_hits()
    window = _window_s()
    with _lock:
        bucket = [t for t in (_hits.get(key) or []) if now - t < window]
    used = len(bucket)
    return {
        "limit": limit,
        "used": used,
        "remaining": max(0, limit - used),
        "window_s": int(window),
    }
