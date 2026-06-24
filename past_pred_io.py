"""
I/O leggero per ``past_catalyst_predictions.json``.

Usato da ``refresh_accuracy_modello.py`` / ``refresh_predizione_guida.py`` e dal
``prediction.refresh_coordinator`` così il JSON si carica **senza** importare
``data_orchestrator`` (file molto grande → import lento).
"""
from __future__ import annotations

import json
import logging
import os
import pathlib
from datetime import date, datetime, timezone

from orchestrator_io_paths import FINAL_XLSX, PAST_CATALYST_PREDICTIONS_JSON
from prediction.errors import log_prediction_error

_log = logging.getLogger(__name__)

REFRESH_IO_VERSION = "past_pred_io@2"

_INVALID_TICKER = frozenset(
    {"", "NAN", "NONE", "NULL", "N/A", "#N/A", "NAT"},
)


def clean_ticker_symbol(value) -> str:
    """Simbolo quotazione; scarta NaN pandas/Excel e placeholder."""
    if value is None:
        return ""
    try:
        import math

        if isinstance(value, float) and math.isnan(value):
            return ""
    except Exception:
        pass
    try:
        import pandas as pd

        if pd.isna(value):
            return ""
    except Exception:
        pass
    s = str(value).strip().upper()
    if s in _INVALID_TICKER:
        return ""
    return s


def default_final_xlsx(project_root: str) -> str:
    """Workbook orchestrato (``orchestrator_io_paths.FINAL_XLSX``). ``project_root`` è ignorato (legacy)."""
    return FINAL_XLSX


def default_past_pred_json(project_root: str) -> str:
    """JSON past pred (``orchestrator_io_paths.PAST_CATALYST_PREDICTIONS_JSON``). ``project_root`` legacy."""
    return PAST_CATALYST_PREDICTIONS_JSON


def normalize_past_pred_record(rec: dict) -> dict:
    """Stessa logica di ``_past_pred_normalize_loaded``: ISO string → ``datetime.date``."""
    out = dict(rec)
    cd = out.get("completion_date")
    if isinstance(cd, str) and cd.strip():
        try:
            s = cd.strip()[:10]
            if len(s) >= 10 and s[4] == "-" and s[7] == "-":
                y, m, d = int(s[:4]), int(s[5:7]), int(s[8:10])
                out["completion_date"] = date(y, m, d)
        except (ValueError, TypeError, OSError):
            pass
    return out


def load_past_pred_document(json_path: str) -> dict:
    """Full JSON document (schema + rows + metadata)."""
    p = pathlib.Path(json_path)
    if not p.exists():
        return {"schema_version": 1, "rows": {}}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        log_prediction_error(f"load_past_pred_document:{p}", exc)
        _log.error("past_pred JSON parse failed: %s — %s", p, exc)
        return {
            "schema_version": 1,
            "rows": {},
            "_error": str(exc).strip() or type(exc).__name__,
            "partial": True,
            "errors": [f"load_past_pred_document:{p}: {exc}"],
        }
    if not isinstance(doc, dict):
        _log.warning("past_pred JSON root is not a dict: %s", p)
        return {"schema_version": 1, "rows": {}, "partial": True}
    if "rows" not in doc or not isinstance(doc.get("rows"), dict):
        doc["rows"] = {}
    return doc


def rows_map_from_doc(doc: dict) -> dict:
    rows = doc.get("rows") if isinstance(doc, dict) else {}
    if not isinstance(rows, dict):
        return {}
    out: dict = {}
    for k, rec in rows.items():
        if isinstance(rec, dict):
            out[str(k)] = normalize_past_pred_record(dict(rec))
    return out


def load_past_pred_map(json_path: str) -> dict:
    return rows_map_from_doc(load_past_pred_document(json_path))


def _record_to_jsonable(rec: dict) -> dict:
    out = dict(rec)
    cd = out.get("completion_date")
    if hasattr(cd, "isoformat"):
        out["completion_date"] = cd.isoformat()[:10]
    return out


def save_predictions(
    doc: dict,
    *,
    meta: dict | None = None,
    json_path: str | None = None,
) -> str:
    """
    Persist past pred JSON with optional ``refresh_meta`` block.

    ``meta`` keys are merged into ``doc["refresh_meta"]`` (e.g. last_refresh_kind).
    """
    path = pathlib.Path(json_path or PAST_CATALYST_PREDICTIONS_JSON)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not isinstance(doc, dict):
        doc = {"schema_version": 1, "rows": {}}
    rows = doc.get("rows")
    if not isinstance(rows, dict):
        doc["rows"] = {}
    else:
        doc["rows"] = {
            str(k): _record_to_jsonable(v) if isinstance(v, dict) else v
            for k, v in rows.items()
        }
    if meta:
        rm = doc.setdefault("refresh_meta", {})
        if isinstance(rm, dict):
            rm.update(meta)
        else:
            doc["refresh_meta"] = dict(meta)
    doc.setdefault("schema_version", 1)
    path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    return str(path)


def build_refresh_meta(
    *,
    last_refresh_kind: str,
    enrich_applied: bool = True,
    orchestrator_version: str | None = None,
) -> dict:
    return {
        "last_refresh_kind": last_refresh_kind,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "orchestrator_version": orchestrator_version or "refresh_coordinator@1",
        "enrich_applied": bool(enrich_applied),
        "io_version": REFRESH_IO_VERSION,
    }
