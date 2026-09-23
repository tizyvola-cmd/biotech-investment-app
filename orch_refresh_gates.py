"""
Marker leggeri per evitare refresh duplicati (scheduler + UI).

Nessun import di ``data_orchestrator`` — sicuro da usare negli script hourly.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MARKER_DIR = DATA_DIR / "markers"

YFINANCE_MARKER = MARKER_DIR / "yfinance_last_run.json"
SDS_LIGHT_MARKER = MARKER_DIR / "sds_light_last_run.json"
SEC_K8_MARKER = MARKER_DIR / "sec_k8_last_run.json"
POST_PIPELINE_STATUS = DATA_DIR / "post_refresh_pipeline_status.json"

_MARKER_PATHS: dict[str, Path] = {
    "yfinance": YFINANCE_MARKER,
    "sds_light": SDS_LIGHT_MARKER,
    "sec_k8": SEC_K8_MARKER,
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts or not str(ts).strip():
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _age_minutes(ts: str | None) -> float | None:
    dt = _parse_iso(ts)
    if dt is None:
        return None
    return (datetime.now(timezone.utc) - dt).total_seconds() / 60.0


def mark_run(kind: str, *, stats: dict | None = None) -> None:
    """Persist ``yfinance``, ``sds_light`` or ``sec_k8`` completion timestamp."""
    path = _MARKER_PATHS.get(kind)
    if path is None:
        return
    MARKER_DIR.mkdir(parents=True, exist_ok=True)
    doc = {"finished_at": _utc_now_iso(), "kind": kind}
    if stats:
        doc["stats"] = stats
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def ran_within_minutes(kind: str, minutes: float) -> bool:
    path = _MARKER_PATHS.get(kind)
    if path is None or not path.is_file():
        return False
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    age = _age_minutes(doc.get("finished_at"))
    return age is not None and age < max(0.0, minutes)


def ran_within_hours(kind: str, hours: float) -> bool:
    return ran_within_minutes(kind, hours * 60.0)


def ran_within_days(kind: str, days: float) -> bool:
    return ran_within_minutes(kind, days * 24.0 * 60.0)


def mark_sec_k8_run(*, stats: dict | None = None) -> None:
    mark_run("sec_k8", stats=stats)


def sec_k8_fresh_within_days(days: float) -> bool:
    return ran_within_days("sec_k8", days)


def mark_post_pipeline_ok(message: str = "", *, kind: str = "full") -> None:
    """Persist full/light post-pipeline completion (shared with API + scheduler)."""
    MARKER_DIR.mkdir(parents=True, exist_ok=True)
    POST_PIPELINE_STATUS.write_text(
        json.dumps(
            {
                "state": "ok",
                "message": message,
                "updated_at": _utc_now_iso(),
                "kind": kind,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def post_pipeline_ok_within(minutes: float) -> bool:
    if not POST_PIPELINE_STATUS.is_file():
        return False
    try:
        doc = json.loads(POST_PIPELINE_STATUS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if str(doc.get("state", "")).lower() != "ok":
        return False
    kind = str(doc.get("kind", "full")).lower()
    if kind not in ("full", ""):
        return False
    age = _age_minutes(doc.get("updated_at"))
    return age is not None and age < max(0.0, minutes)


def gate_status() -> dict[str, object]:
    """Snapshot per debug / health check."""
    out: dict[str, object] = {}
    for kind, path in (
        ("yfinance", YFINANCE_MARKER),
        ("sds_light", SDS_LIGHT_MARKER),
        ("sec_k8", SEC_K8_MARKER),
    ):
        if not path.is_file():
            out[kind] = {"present": False}
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            out[kind] = {"present": True, "parse_error": True}
            continue
        out[kind] = {
            "present": True,
            "finished_at": doc.get("finished_at"),
            "age_minutes": _age_minutes(doc.get("finished_at")),
            "stats": doc.get("stats"),
        }
    if POST_PIPELINE_STATUS.is_file():
        try:
            pp = json.loads(POST_PIPELINE_STATUS.read_text(encoding="utf-8"))
            out["post_pipeline"] = {
                "state": pp.get("state"),
                "kind": pp.get("kind", "full"),
                "updated_at": pp.get("updated_at"),
                "age_minutes": _age_minutes(pp.get("updated_at")),
                "message": pp.get("message"),
            }
        except (OSError, json.JSONDecodeError):
            out["post_pipeline"] = {"parse_error": True}
    return out
