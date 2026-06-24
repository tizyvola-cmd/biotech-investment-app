"""
Catalyst feed helpers for SDS — prior clinical readouts (8-K / press release window).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

_CATALYST_SNAPSHOT = Path(DATA_DIR) / "catalyst_feed_snapshot.json"


def load_catalyst_events() -> list[dict[str, Any]]:
    if not _CATALYST_SNAPSHOT.is_file():
        return []
    try:
        doc = json.loads(_CATALYST_SNAPSHOT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    events = doc.get("events") or []
    return [e for e in events if isinstance(e, dict)]


def readout_events_for_ticker(ticker: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Recent catalyst-feed rows for a ticker (clinical readout filings)."""
    tk = ticker.upper()
    out: list[dict[str, Any]] = []
    for ev in load_catalyst_events():
        if str(ev.get("ticker") or "").upper() != tk:
            continue
        label = str(ev.get("items_label") or ev.get("items_raw") or "")
        out.append(
            {
                "filing_date": ev.get("filing_date"),
                "cd_date": ev.get("cd_date"),
                "items_label": label,
                "delta_d1": ev.get("delta_d1"),
                "delta_d3": ev.get("delta_d3"),
                "extracted": ev.get("extracted") if isinstance(ev.get("extracted"), dict) else {},
            }
        )
    out.sort(key=lambda x: str(x.get("filing_date") or ""), reverse=True)
    return out[:limit]


def readout_summary_text(events: list[dict[str, Any]]) -> str | None:
    """Concatenate catalyst labels / extracted snippets for endpoint context."""
    parts: list[str] = []
    for ev in events:
        label = str(ev.get("items_label") or "").strip()
        if label:
            parts.append(label)
        extracted = ev.get("extracted") or {}
        if isinstance(extracted, dict):
            for key in ("headline", "summary", "primary_endpoint", "efficacy", "results"):
                val = extracted.get(key)
                if val:
                    parts.append(str(val).strip())
    return " | ".join(parts)[:1200] if parts else None


__all__ = ["load_catalyst_events", "readout_events_for_ticker", "readout_summary_text"]
