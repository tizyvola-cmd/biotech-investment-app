"""
Historical Deep Dive / EIS library
==================================
When a company's catalyst is more than 7 calendar days in the past
(``past_catalyst`` / T+8+), its Deep Dive clinical record (with EIS events)
is moved from the live pre-CD snapshot into a durable historical library —

  data/clinical_pre_cd_historical_library.json

— instead of being deleted. If the ticker later re-enters the Catalyst /
Simulation hot-zone for a new CD, historical cards are rehydrated into the
live snapshot so prior EIS history is available again.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("supernova.clinical_deep_dive_history")

_DATA_DIR = Path("data")
_LIBRARY_PATH = _DATA_DIR / "clinical_pre_cd_historical_library.json"

# Align with desktop-ui/src/sheet/cdLifecycle.ts POST_CD_WATCH_CAL_DAYS = 7
# Archive when days_from_today(cd) <= -8 (beyond T+7 inclusive watch).
POST_CD_WATCH_CAL_DAYS = 7


def library_path() -> Path:
    return _LIBRARY_PATH


def load_library() -> dict[str, Any]:
    try:
        raw = json.loads(_LIBRARY_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("entries"), list):
            return raw
    except Exception:
        pass
    return {"updated_at": None, "count": 0, "entries": []}


def _atomic_write(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    last_exc: BaseException | None = None
    for attempt in range(5):
        try:
            os.replace(str(tmp), str(path))
            return
        except OSError as exc:
            last_exc = exc
            import time

            time.sleep(0.12 * (attempt + 1))
    if last_exc:
        raise last_exc


def save_library(doc: dict[str, Any]) -> None:
    entries = [e for e in (doc.get("entries") or []) if isinstance(e, dict)]
    out = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(entries),
        "entries": entries,
        "post_cd_watch_days": POST_CD_WATCH_CAL_DAYS,
    }
    _atomic_write(
        _LIBRARY_PATH,
        json.dumps(out, ensure_ascii=False, indent=2, default=str) + "\n",
    )


def _parse_iso_date(raw: Any) -> date | None:
    s = str(raw or "").strip()[:10]
    if len(s) < 10:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def days_from_today(cd_raw: Any, *, today: date | None = None) -> int | None:
    cd = _parse_iso_date(cd_raw)
    if not cd:
        return None
    t = today or date.today()
    return (cd - t).days


def is_past_catalyst_archived(cd_raw: Any, *, today: date | None = None) -> bool:
    d = days_from_today(cd_raw, today=today)
    if d is None:
        return False
    return d <= -(POST_CD_WATCH_CAL_DAYS + 1)


def history_entry_key(rec: dict[str, Any]) -> str:
    tk = str(rec.get("ticker") or "").strip().upper()
    nct = str(rec.get("nct_id") or rec.get("nct") or "").strip().upper()
    cd = str(rec.get("cd_date") or "")[:10]
    return f"{tk}|{nct}|{cd}"


def _entry_from_record(
    rec: dict[str, Any],
    *,
    reason: str = "past_catalyst_t8",
) -> dict[str, Any]:
    tk = str(rec.get("ticker") or "").strip().upper()
    return {
        "key": history_entry_key(rec),
        "ticker": tk,
        "nct_id": str(rec.get("nct_id") or rec.get("nct") or "").strip().upper() or None,
        "cd_date": str(rec.get("cd_date") or "")[:10] or None,
        "company": rec.get("company"),
        "archived_at": datetime.now(timezone.utc).isoformat(),
        "archive_reason": reason,
        "record": dict(rec),
    }


def upsert_library_entries(entries: list[dict[str, Any]]) -> dict[str, Any]:
    doc = load_library()
    by_key: dict[str, dict[str, Any]] = {}
    for e in doc.get("entries") or []:
        if isinstance(e, dict) and e.get("key"):
            by_key[str(e["key"])] = e
    for e in entries:
        if not isinstance(e, dict) or not e.get("key"):
            continue
        prev = by_key.get(str(e["key"]))
        if prev and isinstance(prev.get("record"), dict) and isinstance(e.get("record"), dict):
            # Prefer richer clinical_events when re-archiving
            prev_ev = prev["record"].get("clinical_events") or []
            new_ev = e["record"].get("clinical_events") or []
            if len(new_ev) >= len(prev_ev):
                by_key[str(e["key"])] = e
            else:
                merged = dict(e)
                merged["record"] = dict(prev["record"])
                merged["record"].update(e["record"])
                merged["record"]["clinical_events"] = prev_ev
                by_key[str(e["key"])] = merged
        else:
            by_key[str(e["key"])] = e
    doc["entries"] = sorted(
        by_key.values(),
        key=lambda e: (str(e.get("ticker") or ""), str(e.get("cd_date") or "")),
    )
    save_library(doc)
    return doc


def archive_past_catalyst_from_live(
    live_records: list[dict[str, Any]],
    *,
    keep_tickers: set[str] | None = None,
    today: date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """
    Split live snapshot records: archive past-catalyst cards to the library,
    keep the rest on the live snapshot.

    Records whose ticker is still in ``keep_tickers`` (open portfolio /
    hot-zone) stay live even past T+7 so Deep Dive remains available while
    the name is actively monitored — but cards for CDs that are past_catalyst
    AND whose ticker is *not* in keep_tickers are migrated.
    """
    keep = {t.strip().upper() for t in (keep_tickers or set()) if t}
    stay: list[dict[str, Any]] = []
    to_archive: list[dict[str, Any]] = []
    for rec in live_records:
        if not isinstance(rec, dict):
            continue
        tk = str(rec.get("ticker") or "").strip().upper()
        cd = rec.get("cd_date")
        if is_past_catalyst_archived(cd, today=today) and tk and tk not in keep:
            to_archive.append(_entry_from_record(rec))
        else:
            stay.append(rec)
    if to_archive:
        upsert_library_entries(to_archive)
        logger.info(
            "Deep Dive history: archived %s past-catalyst card(s)",
            len(to_archive),
        )
    return stay, len(to_archive)


def historical_records_for_tickers(tickers: set[str] | list[str]) -> list[dict[str, Any]]:
    want = {str(t).strip().upper() for t in tickers if str(t).strip()}
    if not want:
        return []
    out: list[dict[str, Any]] = []
    for e in load_library().get("entries") or []:
        if not isinstance(e, dict):
            continue
        tk = str(e.get("ticker") or "").strip().upper()
        if tk not in want:
            continue
        rec = e.get("record")
        if isinstance(rec, dict):
            restored = dict(rec)
            restored["_from_historical_library"] = True
            restored["_historical_key"] = e.get("key")
            restored["_archived_at"] = e.get("archived_at")
            out.append(restored)
    return out


def rehydrate_historical_into_prev(
    prev_by_key: dict[str, dict[str, Any]],
    tickers: set[str] | list[str],
) -> int:
    """
    Merge library cards for re-entering tickers into ``prev_by_key``
    (keyed like live snapshot: TICKER|NCT). Does not remove from library.
    """
    added = 0
    for rec in historical_records_for_tickers(tickers):
        tk = str(rec.get("ticker") or "").strip().upper()
        nct = str(rec.get("nct_id") or rec.get("nct") or "").strip().upper()
        key = f"{tk}|{nct}"
        if key in prev_by_key:
            # Keep live version; optionally union events
            live = prev_by_key[key]
            live_ev = list(live.get("clinical_events") or [])
            hist_ev = list(rec.get("clinical_events") or [])
            if hist_ev:
                seen = {
                    f"{e.get('event_date')}|{str(e.get('event_title') or e.get('title') or '')[:60]}"
                    for e in live_ev
                    if isinstance(e, dict)
                }
                for e in hist_ev:
                    if not isinstance(e, dict):
                        continue
                    k = f"{e.get('event_date')}|{str(e.get('event_title') or e.get('title') or '')[:60]}"
                    if k not in seen:
                        live_ev.append(e)
                        seen.add(k)
                live["clinical_events"] = live_ev
            continue
        prev_by_key[key] = rec
        added += 1
    if added:
        logger.info(
            "Deep Dive history: rehydrated %s card(s) for %s",
            added,
            sorted({str(t).strip().upper() for t in tickers if str(t).strip()}),
        )
    return added


def library_summary(*, ticker: str | None = None) -> dict[str, Any]:
    doc = load_library()
    entries = [e for e in (doc.get("entries") or []) if isinstance(e, dict)]
    if ticker:
        tk = ticker.strip().upper()
        entries = [e for e in entries if str(e.get("ticker") or "").upper() == tk]
    slim = [
        {
            "key": e.get("key"),
            "ticker": e.get("ticker"),
            "company": e.get("company"),
            "nct_id": e.get("nct_id"),
            "cd_date": e.get("cd_date"),
            "archived_at": e.get("archived_at"),
            "archive_reason": e.get("archive_reason"),
            "events": len((e.get("record") or {}).get("clinical_events") or [])
            if isinstance(e.get("record"), dict)
            else 0,
        }
        for e in entries
    ]
    return {
        "ok": True,
        "updated_at": doc.get("updated_at"),
        "count": len(slim),
        "entries": slim,
        "post_cd_watch_days": POST_CD_WATCH_CAL_DAYS,
    }
