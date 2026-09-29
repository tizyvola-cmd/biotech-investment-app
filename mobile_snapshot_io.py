"""
Mobile dashboard snapshot I/O — slim poll payload + lazy curve charts.

``mobile_dashboard_snapshot.json`` is the companion poll file (no heavy charts).
``mobile_curve_charts.json`` holds ``curveChartsByKey`` for detail drill-down.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, MOBILE_DASHBOARD_SNAPSHOT_JSON

_log = logging.getLogger(__name__)

SNAPSHOT_PATH = Path(MOBILE_DASHBOARD_SNAPSHOT_JSON)
CURVE_CHARTS_PATH = Path(DATA_DIR) / "mobile_curve_charts.json"

_HEAVY_KEYS = frozenset({"curveChartsByKey"})


def _atomic_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # Compact JSON — indent=2 roughly doubles wire size for this payload.
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def split_snapshot(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (slim_snapshot, curve_charts_doc)."""
    charts_raw = payload.get("curveChartsByKey")
    charts = charts_raw if isinstance(charts_raw, dict) else {}
    slim = {k: v for k, v in payload.items() if k not in _HEAVY_KEYS}
    recs = slim.get("recommendations")
    if isinstance(recs, list):
        cleaned: list[Any] = []
        for row in recs:
            if isinstance(row, dict) and "curveCharts" in row:
                row = {k: v for k, v in row.items() if k != "curveCharts"}
            cleaned.append(row)
        slim["recommendations"] = cleaned
    charts_doc = {
        "version": 1,
        "updated_at": slim.get("updated_at"),
        "curveChartsByKey": charts,
    }
    return slim, charts_doc


def write_split_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist slim poll file + curve charts; also rewrite legacy full path as slim."""
    slim, charts_doc = split_snapshot(payload)
    _atomic_write(SNAPSHOT_PATH, slim)
    _atomic_write(CURVE_CHARTS_PATH, charts_doc)
    return {
        "snapshot_bytes": SNAPSHOT_PATH.stat().st_size,
        "charts_bytes": CURVE_CHARTS_PATH.stat().st_size,
        "chart_keys": len(charts_doc.get("curveChartsByKey") or {}),
    }


def ensure_split_on_disk() -> dict[str, Any]:
    """
    If the poll file still embeds curveChartsByKey (legacy), split it once.
    Safe to call on every GET — no-op when already slim.
    """
    if not SNAPSHOT_PATH.is_file():
        return {"ok": False, "reason": "missing"}
    try:
        raw = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"ok": False, "reason": str(exc)}
    if not isinstance(raw, dict):
        return {"ok": False, "reason": "invalid"}
    charts = raw.get("curveChartsByKey")
    if not isinstance(charts, dict) or not charts:
        # Already slim (or empty charts). Ensure charts file exists if missing
        # but payload had empty dict — still OK.
        if not CURVE_CHARTS_PATH.is_file() and isinstance(charts, dict):
            _atomic_write(
                CURVE_CHARTS_PATH,
                {
                    "version": 1,
                    "updated_at": raw.get("updated_at"),
                    "curveChartsByKey": {},
                },
            )
        return {"ok": True, "split": False, "bytes": SNAPSHOT_PATH.stat().st_size}
    info = write_split_snapshot(raw)
    _log.info(
        "mobile snapshot split: poll=%s charts=%s keys=%s",
        info["snapshot_bytes"],
        info["charts_bytes"],
        info["chart_keys"],
    )
    return {"ok": True, "split": True, **info}


def load_curve_charts() -> dict[str, Any]:
    if CURVE_CHARTS_PATH.is_file():
        try:
            data = json.loads(CURVE_CHARTS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    # Fallback: legacy embedded charts still in snapshot
    if SNAPSHOT_PATH.is_file():
        try:
            raw = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"version": 1, "curveChartsByKey": {}}
        if isinstance(raw, dict) and isinstance(raw.get("curveChartsByKey"), dict):
            return {
                "version": 1,
                "updated_at": raw.get("updated_at"),
                "curveChartsByKey": raw["curveChartsByKey"],
            }
    return {"version": 1, "curveChartsByKey": {}}


def curve_chart_for_key(key: str) -> dict[str, Any] | None:
    k = (key or "").strip()
    if not k:
        return None
    doc = load_curve_charts()
    charts = doc.get("curveChartsByKey") if isinstance(doc.get("curveChartsByKey"), dict) else {}
    hit = charts.get(k)
    return hit if isinstance(hit, dict) else None
