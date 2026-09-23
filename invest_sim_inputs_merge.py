"""Merge invest_sim_inputs books from concurrent desktop / mobile writers.

Blind PUT replace used to wipe mobile buys when the desktop republished an
older local book. Open positions that exist only on one side are preserved;
explicit sells still win over stale opens when soldAt ≥ investedAt.
"""

from __future__ import annotations

from typing import Any


def _is_open(entry: dict[str, Any] | None) -> bool:
    if not isinstance(entry, dict):
        return False
    if entry.get("ignoreSheet"):
        return False
    try:
        return float(entry.get("capital") or 0) > 0
    except (TypeError, ValueError):
        return False


def _is_sold(entry: dict[str, Any] | None) -> bool:
    if not isinstance(entry, dict):
        return False
    return bool(entry.get("ignoreSheet") and entry.get("soldAt"))


def _parse_ts(raw: Any) -> float:
    if raw is None:
        return 0.0
    s = str(raw).strip()
    if not s:
        return 0.0
    try:
        # datetime.fromisoformat handles offsets; fall back to 0 on junk.
        from datetime import datetime

        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _pick_entry(
    existing: dict[str, Any] | None, incoming: dict[str, Any] | None
) -> dict[str, Any] | None:
    if existing is None and incoming is None:
        return None
    if existing is None:
        return dict(incoming) if isinstance(incoming, dict) else None
    if incoming is None:
        return dict(existing)

    ex_open, in_open = _is_open(existing), _is_open(incoming)
    ex_sold, in_sold = _is_sold(existing), _is_sold(incoming)

    # Mobile/desktop rebuy after a close.
    if ex_sold and in_open:
        if _parse_ts(incoming.get("investedAt")) > _parse_ts(existing.get("soldAt")):
            return dict(incoming)
        return dict(existing)
    if in_sold and ex_open:
        if _parse_ts(existing.get("investedAt")) > _parse_ts(incoming.get("soldAt")):
            return dict(existing)
        return dict(incoming)

    # Preserve opens that the other writer simply omitted (stale full replace).
    if ex_open and not in_open and not in_sold:
        return dict(existing)
    if in_open and not ex_open and not ex_sold:
        return dict(incoming)

    if ex_sold or in_sold:
        sold = existing if ex_sold else incoming
        other = incoming if ex_sold else existing
        out = dict(sold)
        # Keep richer closed PnL if present on the other side.
        for k in ("closedCapital", "closedValue", "closedPnlEur"):
            if out.get(k) is None and isinstance(other, dict) and other.get(k) is not None:
                out[k] = other[k]
        return out

    # Both open (or both empty): prefer incoming writer, but never drop capital.
    out = dict(incoming)
    try:
        out["capital"] = max(float(existing.get("capital") or 0), float(incoming.get("capital") or 0))
    except (TypeError, ValueError):
        out["capital"] = incoming.get("capital") or existing.get("capital") or 0
    if not out.get("buyPrice") and existing.get("buyPrice"):
        out["buyPrice"] = existing["buyPrice"]
    if not out.get("investedAt") and existing.get("investedAt"):
        out["investedAt"] = existing["investedAt"]
    return out


def merge_invest_sim_inputs(
    existing: dict[str, Any] | None, incoming: dict[str, Any] | None
) -> dict[str, Any]:
    """Union merge of two ``{ key: entry }`` books."""
    base = existing if isinstance(existing, dict) else {}
    overlay = incoming if isinstance(incoming, dict) else {}
    keys = set(base) | set(overlay)
    out: dict[str, Any] = {}
    for key in keys:
        picked = _pick_entry(
            base.get(key) if isinstance(base.get(key), dict) else None,
            overlay.get(key) if isinstance(overlay.get(key), dict) else None,
        )
        if picked is not None:
            out[key] = picked
    return out
