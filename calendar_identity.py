"""
Calendar identity index (Phase 1)
=================================
Maps tickers → identification sources + regulatory designations for the
Calendar tab. Read-only enrichment — does not change Soft BUY/SELL.

Sources (comma-joined when multiple):
  - Discovery
  - ClinicalTrials.gov  (Simulation sheet / CT.gov CD cohort)
  - FDA                 (FDA AdCom calendar)

Designations mined from Discovery matched_keywords + known phrase list.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DATA_DIR = Path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
_INDEX_PATH = _DATA_DIR / "calendar_identity_index.json"
_CACHE_TTL_SEC = int(os.environ.get("CALENDAR_IDENTITY_CACHE_SEC", str(6 * 3600)))

_DESIGNATION_MAP: list[tuple[str, str]] = [
    ("breakthrough therapy", "Breakthrough Therapy"),
    ("fast track", "Fast Track"),
    ("orphan drug", "Orphan Drug"),
    ("rmat", "RMAT"),
    ("regenerative medicine advanced therapy", "RMAT"),
    ("accelerated approval", "Accelerated Approval"),
    ("priority review", "Priority Review"),
    ("rare pediatric", "Rare Pediatric Disease"),
]

_LOCK = threading.Lock()
_MEM: dict[str, Any] | None = None
_MEM_AT = 0.0


def _load_json(path: Path) -> dict[str, Any]:
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def load_biotech_symbol_set() -> set[str]:
    path = _DATA_DIR / "biotech_symbols.json"
    raw = _load_json(path)
    out: set[str] = set()
    # Common shapes: {"symbols":[...]} | {"tickers":[...]} | list | {TK: ...}
    if isinstance(raw, list):
        for x in raw:
            if isinstance(x, str) and x.strip():
                out.add(x.strip().upper())
            elif isinstance(x, dict):
                tk = str(x.get("ticker") or x.get("symbol") or "").strip().upper()
                if tk:
                    out.add(tk)
        return out
    if not isinstance(raw, dict):
        return out
    for key in ("symbols", "tickers", "biotech", "list"):
        arr = raw.get(key)
        if isinstance(arr, list):
            for x in arr:
                tk = str(x if isinstance(x, str) else (x or {}).get("ticker") or "").strip().upper()
                if tk:
                    out.add(tk)
            if out:
                return out
    for k, v in raw.items():
        if isinstance(k, str) and k.isalpha() and len(k) <= 6:
            out.add(k.upper())
        elif isinstance(v, dict):
            tk = str(v.get("ticker") or v.get("symbol") or k).strip().upper()
            if tk:
                out.add(tk)
    return out


def designations_from_keywords(keywords: list[Any] | None) -> list[str]:
    blob = " | ".join(str(k).lower() for k in (keywords or []))
    found: list[str] = []
    for needle, label in _DESIGNATION_MAP:
        if needle in blob and label not in found:
            found.append(label)
    return found


def _simulation_tickers() -> set[str]:
    try:
        from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

        path = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    except Exception:
        path = _DATA_DIR / "simulation_sheet_snapshot.json"
    snap = _load_json(path)
    out: set[str] = set()
    for row in snap.get("rows") or []:
        tk = str(row.get("Ticker") or "").strip().upper()
        if tk and "TOTALE" not in tk:
            out.add(tk)
    return out


def _fda_tickers() -> set[str]:
    snap = _load_json(_DATA_DIR / "fda_adcom_calendar_snapshot.json")
    out: set[str] = set()
    for row in snap.get("rows") or []:
        tk = str(row.get("ticker") or "").strip().upper()
        if tk:
            out.add(tk)
    return out


def _discovery_rows() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        from universe_discovery import list_calendar_work, load_snapshot, load_store

        for w in list_calendar_work():
            out.append(
                {
                    "ticker": w.get("ticker"),
                    "cik": w.get("cik10"),
                    "matched_keywords": [],
                }
            )
        store = load_store().get("by_cik") or {}
        by_tk: dict[str, dict[str, Any]] = {}
        for cik, row in store.items():
            tk = str(row.get("ticker") or "").strip().upper()
            if not tk:
                continue
            by_tk[tk] = {
                "ticker": tk,
                "cik": cik,
                "matched_keywords": list(row.get("matched_keywords") or []),
                "status": row.get("status"),
            }
        snap = load_snapshot()
        for c in snap.get("candidates") or []:
            tk = str(c.get("ticker") or "").strip().upper()
            if not tk:
                continue
            prev = by_tk.get(tk) or {"ticker": tk, "matched_keywords": []}
            kws = list(prev.get("matched_keywords") or []) or list(c.get("matched_keywords") or [])
            by_tk[tk] = {
                **prev,
                "matched_keywords": kws,
                "cik": prev.get("cik") or c.get("cik"),
            }
        return list(by_tk.values())
    except Exception:
        return out


def build_identity_index(*, persist: bool = True) -> dict[str, Any]:
    """Rebuild ticker → sources / designations. Safe to call often (file+mem cache)."""
    biotech = load_biotech_symbol_set()
    sim = _simulation_tickers()
    fda = _fda_tickers()
    disc_rows = _discovery_rows()
    disc_tk = {str(r.get("ticker") or "").strip().upper() for r in disc_rows if r.get("ticker")}

    by_ticker: dict[str, dict[str, Any]] = {}

    def _ensure(tk: str) -> dict[str, Any]:
        row = by_ticker.get(tk)
        if not row:
            row = {
                "ticker": tk,
                "identification_sources": [],
                "regulatory_designations": [],
                "in_biotech_reference": tk in biotech,
            }
            by_ticker[tk] = row
        return row

    for tk in sorted(disc_tk):
        row = _ensure(tk)
        if "Discovery" not in row["identification_sources"]:
            row["identification_sources"].append("Discovery")
    for r in disc_rows:
        tk = str(r.get("ticker") or "").strip().upper()
        if not tk:
            continue
        row = _ensure(tk)
        for d in designations_from_keywords(r.get("matched_keywords")):
            if d not in row["regulatory_designations"]:
                row["regulatory_designations"].append(d)

    for tk in sorted(sim):
        row = _ensure(tk)
        if "ClinicalTrials.gov" not in row["identification_sources"]:
            row["identification_sources"].append("ClinicalTrials.gov")

    for tk in sorted(fda):
        row = _ensure(tk)
        if "FDA" not in row["identification_sources"]:
            row["identification_sources"].append("FDA")

    doc = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "biotech_reference_count": len(biotech),
        "ticker_count": len(by_ticker),
        "by_ticker": by_ticker,
        "schema": {
            "identification_sources": ["Discovery", "ClinicalTrials.gov", "FDA"],
            "regulatory_designations": [lab for _, lab in _DESIGNATION_MAP],
        },
    }
    if persist:
        _save_json(_INDEX_PATH, doc)
    global _MEM, _MEM_AT
    import time

    with _LOCK:
        _MEM = doc
        _MEM_AT = time.time()
    return doc


def load_identity_index(*, max_age_sec: int | None = None) -> dict[str, Any]:
    import time

    ttl = _CACHE_TTL_SEC if max_age_sec is None else max_age_sec
    with _LOCK:
        if _MEM is not None and (time.time() - _MEM_AT) < ttl:
            return _MEM
    disk = _load_json(_INDEX_PATH)
    if disk.get("by_ticker") and disk.get("updated_at"):
        # Refresh if older than TTL
        try:
            updated = datetime.fromisoformat(str(disk["updated_at"]).replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - updated).total_seconds()
            if age <= ttl:
                with _LOCK:
                    _MEM = disk
                    _MEM_AT = time.time()
                return disk
        except Exception:
            pass
    return build_identity_index(persist=True)


def enrich_event_fields(ticker: str, index: dict[str, Any] | None = None) -> dict[str, Any]:
    idx = index or load_identity_index()
    row = (idx.get("by_ticker") or {}).get(str(ticker or "").strip().upper()) or {}
    sources = list(row.get("identification_sources") or [])
    desigs = list(row.get("regulatory_designations") or [])
    return {
        "identification_sources": sources,
        "identification_sources_label": ", ".join(sources) if sources else "",
        "regulatory_designations": desigs,
        "regulatory_designations_label": ", ".join(desigs) if desigs else "",
        "in_biotech_reference": bool(row.get("in_biotech_reference")),
    }
