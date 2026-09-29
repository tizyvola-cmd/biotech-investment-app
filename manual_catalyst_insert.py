"""
Manual Calendar → Simulation catalyst insert
============================================
Persist free-text Calendar inserts into ``data/manual_sim_entries.json``
so they survive guidance refresh (unlike ``catalyst_sim_entries.json``).

Also injects a CD day into ``guidance_calendar_snapshot.json`` so the
Calendar tab shows the event immediately.

Does not change Soft BUY/SELL gates.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parent / "data"
_MANUAL_PATH = _DATA_DIR / "manual_sim_entries.json"
_GUIDANCE_SNAP = _DATA_DIR / "guidance_calendar_snapshot.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_cd_iso(raw: Any) -> str | None:
    s = str(raw or "").strip()
    if not s:
        return None
    if re.match(r"^20\d{2}-\d{2}-\d{2}", s):
        return s[:10]
    m = re.match(r"^(\d{1,2})[/.](\d{1,2})[/.](20\d{2})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def _iso_to_sim_cd(iso: str) -> str:
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d")
        return d.strftime("%d/%m/%Y")
    except ValueError:
        return iso


def _normalize_cd_key(raw: Any) -> str:
    try:
        from excel_sheet_reader import _normalize_cd_for_key

        return _normalize_cd_for_key(raw)
    except Exception:
        iso = _parse_cd_iso(raw)
        return iso or str(raw or "").strip()


def load_manual_sim_doc() -> dict[str, Any]:
    if not _MANUAL_PATH.is_file():
        return {
            "generated_at": _now_iso(),
            "description": "Manual Simulation overrides (Calendar insert / ops)",
            "entries": [],
        }
    try:
        doc = json.loads(_MANUAL_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "generated_at": _now_iso(),
            "description": "Manual Simulation overrides (Calendar insert / ops)",
            "entries": [],
        }
    if not isinstance(doc, dict):
        return {
            "generated_at": _now_iso(),
            "description": "Manual Simulation overrides (Calendar insert / ops)",
            "entries": [],
        }
    if not isinstance(doc.get("entries"), list):
        doc["entries"] = []
    return doc


def save_manual_sim_doc(doc: dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    doc = dict(doc)
    doc["generated_at"] = _now_iso()
    entries = doc.get("entries") if isinstance(doc.get("entries"), list) else []
    doc["entries"] = entries
    tmp = _MANUAL_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(_MANUAL_PATH)


def _row_cd_iso(row: dict[str, Any]) -> str | None:
    return _parse_cd_iso(row.get("guidance_window_start") or row.get("Completion Date"))


def build_manual_sim_row(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize API / UI payload into a Simulation sidecar row.

    A Completion Date is preferred (Catalyst / Top KPI scoring) but not
    required — interest enroll can land a pending row so the ticker is in
    Simulation even before a catalyst date is known.
    """
    ticker = str(payload.get("ticker") or payload.get("Ticker") or "").strip().upper()
    if not ticker or len(ticker) > 8:
        return None
    cd_iso = _parse_cd_iso(
        payload.get("cd_iso")
        or payload.get("cd_date")
        or payload.get("Completion Date")
        or payload.get("CD")
    )
    company = str(
        payload.get("company")
        or payload.get("Società")
        or payload.get("company_name")
        or ticker
    ).strip()
    nct = str(payload.get("nct_id") or payload.get("NCT") or "").strip().upper()
    if nct and not nct.startswith("NCT") and re.match(r"^\d{8}$", nct):
        nct = f"NCT{nct}"
    drug = str(payload.get("drug") or payload.get("Drug") or "").strip()
    phase = str(payload.get("phase") or payload.get("Studio Phase") or "").strip()
    indication = str(payload.get("indication") or payload.get("Indication") or "").strip()
    note = str(payload.get("note") or payload.get("_note") or "").strip()
    event_type = str(payload.get("event_type") or payload.get("guidance_event_type") or "").strip().lower()
    if not event_type:
        event_type = "cd" if cd_iso else "watch"
    sim_cd = _iso_to_sim_cd(cd_iso) if cd_iso else "—"
    pending = not bool(cd_iso)
    return {
        "Ticker": ticker,
        "Società": company,
        "Società (full name)": company,
        "Lead sponsor": company,
        "Completion Date": sim_cd,
        "NCT": nct,
        "Drug": drug,
        "Indication": indication,
        "Studio Phase": phase,
        "Exact·Partial vs Unmatch": "Catalyst",
        "Link studio": f"https://clinicaltrials.gov/study/{nct}" if nct.startswith("NCT") else "",
        "guidance_calendar_catalyst": True,
        "manual_calendar_insert": True,
        "_manual": True,
        "_pending_catalyst": pending,
        "_note": note
        or (
            "Interest watch — pending catalyst date"
            if pending
            else "Calendar free-text insert → Catalyst / Eval Lab"
        ),
        "_reinjected_at": _now_iso(),
        "guidance_event_type": event_type,
        "guidance_window_start": cd_iso or "",
        "guidance_window_end": cd_iso or "",
        "guidance_source_quote": note
        or (f"Manual {event_type} insert {cd_iso}" if cd_iso else "Interest watchlist"),
    }


def append_manual_sim_entry(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Upsert by Ticker|CD into manual_sim_entries.json and inject CD into
    the guidance Calendar snapshot.
    """
    row = build_manual_sim_row(payload)
    if not row:
        return {"ok": False, "error": "ticker_required", "entry": None}

    ticker = str(row.get("Ticker") or "").strip().upper()
    dated = bool(_row_cd_iso(row))
    doc = load_manual_sim_doc()
    entries: list[dict[str, Any]] = [
        e for e in (doc.get("entries") or []) if isinstance(e, dict)
    ]
    if dated:
        entries = [
            e
            for e in entries
            if not (
                str(e.get("Ticker") or "").strip().upper() == ticker
                and not _row_cd_iso(e)
            )
        ]
    elif any(
        str(e.get("Ticker") or "").strip().upper() == ticker and _row_cd_iso(e)
        for e in entries
    ):
        existing = next(
            e
            for e in entries
            if str(e.get("Ticker") or "").strip().upper() == ticker and _row_cd_iso(e)
        )
        return {
            "ok": True,
            "replaced": False,
            "skipped_pending": True,
            "entry": existing,
            "count": len(entries),
            "calendar_injected": False,
        }

    key = f"{row['Ticker']}|{_normalize_cd_key(row['Completion Date'])}"
    replaced = False
    for i, existing in enumerate(entries):
        ek = (
            f"{str(existing.get('Ticker') or '').strip().upper()}|"
            f"{_normalize_cd_key(existing.get('Completion Date'))}"
        )
        if ek == key:
            merged = {**existing, **row}
            entries[i] = merged
            row = merged
            replaced = True
            break
    if not replaced:
        entries.append(row)
    doc["entries"] = entries
    save_manual_sim_doc(doc)

    calendar_injected = False
    try:
        calendar_injected = _inject_guidance_cd_event(row)
    except Exception as exc:
        print(f"[ManualCatalyst] guidance inject failed: {exc}", flush=True)

    return {
        "ok": True,
        "replaced": replaced,
        "entry": row,
        "count": len(entries),
        "calendar_injected": calendar_injected,
    }


def _inject_guidance_cd_event(row: dict[str, Any]) -> bool:
    """Add / replace a CD event in guidance_calendar_snapshot.json."""
    ticker = str(row.get("Ticker") or "").strip().upper()
    cd_iso = _parse_cd_iso(row.get("guidance_window_start") or row.get("Completion Date"))
    if not ticker or not cd_iso:
        return False
    nct = str(row.get("NCT") or "").strip().upper()
    company = str(row.get("Società") or ticker)
    ev = {
        "ticker": ticker,
        "company": company,
        "event_type": "cd",
        "asset_name": row.get("Drug") or None,
        "trial_phase": row.get("Studio Phase") or None,
        "indication": row.get("Indication") or None,
        "timing_quote": (
            f"Primary completion {cd_iso}"
            + (f" ({nct})" if nct else "")
            + " · manual insert"
        ),
        "window_start": cd_iso,
        "window_end": cd_iso,
        "source_type": "manual_calendar_insert",
        "source_date": cd_iso,
        "confidence": 0.95,
        "estimation_method": "manual_calendar_insert",
        "sim_cd_date": cd_iso,
        "link": row.get("Link studio") or None,
        "nct_id": nct or None,
    }
    return inject_guidance_calendar_event(ev)


def inject_guidance_calendar_event(ev: dict[str, Any]) -> bool:
    """
    Upsert one event into guidance_calendar_snapshot.json.
    Used by manual Calendar insert and Daily News migrate (conference / catalyst dates).
    Deep Dive price plot reads this via useTickerGuidanceEvents.
    """
    ticker = str(ev.get("ticker") or "").strip().upper()
    window_start = str(ev.get("window_start") or "")[:10]
    event_type = str(ev.get("event_type") or "other").strip().lower() or "other"
    if not ticker or not re.match(r"^20\d{2}-\d{2}-\d{2}$", window_start):
        return False
    company = str(ev.get("company") or ticker)
    normalized = {
        **ev,
        "ticker": ticker,
        "company": company,
        "event_type": event_type,
        "window_start": window_start,
        "window_end": str(ev.get("window_end") or window_start)[:10],
        "source_type": str(ev.get("source_type") or "daily_news_migrate"),
        "estimation_method": str(
            ev.get("estimation_method") or "daily_news_migrate"
        ),
        "confidence": float(ev.get("confidence") or 0.7),
    }
    if _GUIDANCE_SNAP.is_file():
        try:
            snap = json.loads(_GUIDANCE_SNAP.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            snap = {"events": [], "count": 0}
    else:
        snap = {"events": [], "count": 0}
    events = [e for e in (snap.get("events") or []) if isinstance(e, dict)]
    key = f"{ticker}|{event_type}|{window_start}"
    out: list[dict[str, Any]] = []
    replaced = False
    for e in events:
        ek = (
            f"{str(e.get('ticker') or '').upper()}|"
            f"{str(e.get('event_type') or '').lower()}|"
            f"{str(e.get('window_start') or '')[:10]}"
        )
        if ek == key:
            out.append({**e, **normalized})
            replaced = True
        else:
            out.append(e)
    if not replaced:
        out.append(normalized)
    out.sort(key=lambda e: e.get("window_start") or e.get("window_end") or "9999")
    snap = {
        **snap,
        "updated_at": _now_iso(),
        "count": len(out),
        "events": out,
    }
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _GUIDANCE_SNAP.write_text(
        json.dumps(snap, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    return True
