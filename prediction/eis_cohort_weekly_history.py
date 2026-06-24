"""
Weekly EIS cohort comparison history — one snapshot per ISO week (Monday key).

Updated on each ``eis_morning_refresh`` run (Lun–Ven 10:00): the current week's
point is upserted until the next Monday opens a new week on the trend chart.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

HISTORY_PATH = Path(DATA_DIR) / "eis_cohort_weekly_history.json"
SCHEMA_VERSION = 1


def week_key_monday(d: date) -> str:
    """ISO date of the Monday starting the week that contains ``d``."""
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def _flatten_comparison(comparison: dict[str, Any]) -> dict[str, Any]:
    with_eis = comparison.get("with_eis") or {}
    without_eis = comparison.get("without_eis") or {}
    delta = comparison.get("delta_with_minus_without") or {}
    return {
        "with_eis_n": int(with_eis.get("n") or 0),
        "without_eis_n": int(without_eis.get("n") or 0),
        "with_eis_price_accuracy_pct": with_eis.get("price_accuracy_pct"),
        "without_eis_price_accuracy_pct": without_eis.get("price_accuracy_pct"),
        "with_eis_sign_hit_pct": with_eis.get("sign_hit_pct"),
        "without_eis_sign_hit_pct": without_eis.get("sign_hit_pct"),
        "delta_price_accuracy_pp": delta.get("price_accuracy_pp"),
        "delta_sign_hit_pp": delta.get("sign_hit_pp"),
    }


def load_weekly_history() -> dict[str, Any]:
    if not HISTORY_PATH.is_file():
        return {"schema_version": SCHEMA_VERSION, "weeks": []}
    try:
        doc = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            return {"schema_version": SCHEMA_VERSION, "weeks": []}
        weeks = doc.get("weeks")
        if not isinstance(weeks, list):
            doc["weeks"] = []
        return doc
    except (OSError, json.JSONDecodeError):
        return {"schema_version": SCHEMA_VERSION, "weeks": []}


def append_weekly_snapshot(
    comparison: dict[str, Any] | None,
    *,
    run_at: datetime | None = None,
) -> dict[str, Any] | None:
    """Upsert this ISO week's EIS cohort metrics. Returns the row written or None."""
    if not comparison:
        return None
    with_eis = comparison.get("with_eis") or {}
    without_eis = comparison.get("without_eis") or {}
    if int(with_eis.get("n") or 0) + int(without_eis.get("n") or 0) <= 0:
        return None

    ts = run_at or datetime.now(timezone.utc)
    wk = week_key_monday(ts.date())
    row = {
        "week_key": wk,
        "recorded_at": ts.isoformat(),
        **_flatten_comparison(comparison),
    }

    doc = load_weekly_history()
    weeks: list[dict[str, Any]] = list(doc.get("weeks") or [])
    replaced = False
    for i, existing in enumerate(weeks):
        if str(existing.get("week_key") or "") == wk:
            weeks[i] = row
            replaced = True
            break
    if not replaced:
        weeks.append(row)
    weeks.sort(key=lambda r: str(r.get("week_key") or ""))
    doc["schema_version"] = SCHEMA_VERSION
    doc["updated_at"] = ts.isoformat()
    doc["weeks"] = weeks[-104:]  # ~2 years

    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = HISTORY_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(HISTORY_PATH)
    return row


__all__ = [
    "HISTORY_PATH",
    "append_weekly_snapshot",
    "load_weekly_history",
    "week_key_monday",
]
