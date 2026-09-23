"""
SEC Forward Catalyst Calendar (Part 2)
======================================
Extracts PDUFA / AdCom / Readout windows / Conference confirmations from
8-K (item-filtered client-side) and 10-Q MD&A sections (Part 1 snapshot).

Reuses EDGAR helpers from ``catalyst_extractor`` / ``sec_10q_extractor``.
Readout rows **accumulate** (never overwrite prior window guidance).

Output: data/catalyst_calendar_snapshot.json
History: data/catalyst_calendar_history.json  (append-only by entry id)
"""

from __future__ import annotations

import json
import os
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from catalyst_calendar_parse import (
    entry_is_current,
    extract_events_from_text,
    items_match,
    sort_key_for_entry,
)
from catalyst_extractor import (
    _DATA_DIR,
    _fetch_8k_bundle_text,
    _fetch_submissions,
    _filing_html_url,
    _parse_cik_field,
    _recent_8k_filings,
)

# Eval Lab / Catalyst names: deep enough to catch PDUFA announced 6–10 months ahead.
MAX_COMPANIES = int(os.environ.get("CATALYST_CAL_MAX_COMPANIES", "200"))
# When scanning the full biotech_symbols gap, raise the cap (roster ≈ 90; universe ≈ 745).
BIOTECH_MAX_COMPANIES = int(os.environ.get("CATALYST_CAL_BIOTECH_MAX", "900"))
MAX_8K_SCAN = int(os.environ.get("CATALYST_CAL_MAX_8K", "12"))
# Biotech gap: fewer 8-Ks + parallel workers (default ~8× faster than sequential ×12).
GAP_MAX_8K_SCAN = int(os.environ.get("CATALYST_CAL_GAP_MAX_8K", "4"))
GAP_WORKERS = int(os.environ.get("CATALYST_CAL_GAP_WORKERS", "8"))
# Filing lookback (~13 months) — PDUFA target is often set at NDA acceptance.
LOOKBACK_DAYS = int(os.environ.get("CATALYST_CAL_LOOKBACK_DAYS", "400"))
# Simulation / Eval Lab near-CD priority (align with SIM_MONITOR_HORIZON_DAYS ≈ 120).
EVAL_PRIORITY_DAYS = int(os.environ.get("CATALYST_CAL_EVAL_PRIORITY_DAYS", "120"))

_CALENDAR_ITEMS = frozenset({"8.01", "2.02", "7.01"})
_SNAPSHOT_PATH = Path(_DATA_DIR) / "catalyst_calendar_snapshot.json"
_HISTORY_PATH = Path(_DATA_DIR) / "catalyst_calendar_history.json"
_ROSTER_PATH = Path(_DATA_DIR) / "catalyst_calendar_roster.json"

_STATUS: dict[str, Any] = {
    "running": False,
    "message": "",
    "processed": 0,
    "total": 0,
    "error": None,
    "finished_at": None,
}
_STATUS_LOCK = threading.Lock()
_SCHEDULE_MARKER = Path(_DATA_DIR) / "catalyst_calendar_schedule.json"


def get_status() -> dict[str, Any]:
    with _STATUS_LOCK:
        return dict(_STATUS)


def _set_status(**kw: Any) -> None:
    with _STATUS_LOCK:
        _STATUS.update(kw)


def last_monthly_month() -> str | None:
    try:
        raw = json.loads(_SCHEDULE_MARKER.read_text(encoding="utf-8"))
        v = raw.get("last_monthly_month")
        return str(v) if v else None
    except Exception:
        return None


def mark_monthly_run(month: str | None = None) -> None:
    from datetime import date as date_cls

    key = month or f"{date_cls.today().year:04d}-{date_cls.today().month:02d}"
    _SCHEDULE_MARKER.parent.mkdir(parents=True, exist_ok=True)
    _SCHEDULE_MARKER.write_text(
        json.dumps(
            {
                "last_monthly_month": key,
                "last_monthly_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def should_run_catalyst_calendar_monthly(
    now_local: datetime,
    *,
    last_month: str | None = None,
    day: int = 2,
    hour: int = 8,
    minute: int = 0,
) -> bool:
    """2nd of month ≥ 08:00 Rome — full Simulation+Discovery SEC re-scan."""
    if now_local.day != day:
        return False
    if (now_local.hour, now_local.minute) < (hour, minute):
        return False
    key = f"{now_local.year:04d}-{now_local.month:02d}"
    prior = last_month if last_month is not None else last_monthly_month()
    return prior != key


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_json(path: Path, data: dict[str, Any]) -> None:
    Path(_DATA_DIR).mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def load_snapshot() -> dict[str, Any]:
    data = _load_json(_SNAPSHOT_PATH)
    if not data:
        return {"entries": [], "count": 0, "updated_at": None}
    entries = data.get("entries")
    if not isinstance(entries, list):
        return {"entries": [], "count": 0, "updated_at": data.get("updated_at")}
    today = date.today()
    future = [e for e in entries if isinstance(e, dict) and entry_is_current(e, today)]
    future = _annotate_rows(future)
    if len(future) != len(entries):
        data = {**data, "entries": future, "count": len(future)}
        try:
            _save_json(_SNAPSHOT_PATH, data)
        except OSError:
            pass
    else:
        data = {**data, "entries": future, "count": len(future)}
    return data


def load_history() -> list[dict[str, Any]]:
    data = _load_json(_HISTORY_PATH)
    rows = data.get("entries")
    return list(rows) if isinstance(rows, list) else []


def load_roster() -> dict[str, Any]:
    data = _load_json(_ROSTER_PATH)
    if not isinstance(data.get("by_ticker"), dict):
        data["by_ticker"] = {}
    return data


def save_roster(data: dict[str, Any]) -> None:
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    data["count"] = len(data.get("by_ticker") or {})
    _save_json(_ROSTER_PATH, data)


def upsert_roster_entries(entries: list[dict[str, Any]]) -> None:
    """Persist Calendar companies so every refresh re-scans them (all event types)."""
    if not entries:
        return
    roster = load_roster()
    by_tk: dict[str, Any] = dict(roster.get("by_ticker") or {})
    now = datetime.now(timezone.utc).isoformat()
    for e in entries:
        tk = str(e.get("ticker") or "").strip().upper()
        cik10 = str(e.get("cik10") or "").zfill(10)
        if not tk or not cik10.isdigit():
            continue
        prev = dict(by_tk.get(tk) or {})
        prev.update(
            {
                "ticker": tk,
                "cik10": cik10,
                "company": str(e.get("company") or prev.get("company") or tk),
                "source": e.get("source") or prev.get("source") or "calendar",
                "last_seen_at": now,
            }
        )
        if not prev.get("first_seen_at"):
            prev["first_seen_at"] = now
        by_tk[tk] = prev
    roster["by_ticker"] = by_tk
    save_roster(roster)


def _cik_map_from_sec_k8() -> dict[str, dict[str, str]]:
    """ticker → {cik10, company} from sec_k8 snapshot."""
    try:
        from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON

        snap_path = Path(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    except ImportError:
        snap_path = Path(_DATA_DIR) / "sec_k8_simulation_snapshot.json"
    out: dict[str, dict[str, str]] = {}
    if not snap_path.is_file():
        return out
    try:
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
    except Exception:
        return out
    cols = snap.get("columns") or []
    col_cik = next((c for c in cols if "CIK" in c), "CIK (SEC)")
    for row in snap.get("rows") or []:
        ticker = str(row.get("Ticker", "")).strip().upper()
        if not ticker:
            continue
        cik10 = _parse_cik_field(row.get(col_cik, ""))
        if not cik10:
            continue
        out[ticker] = {
            "cik10": cik10,
            "company": str(row.get("Società", ticker)),
        }
    return out


def _ticker_cik_fallback() -> dict[str, str]:
    """Broad SEC ticker→CIK map for Simulation names missing from sec_k8."""
    try:
        from data_orchestrator import _build_ticker_cik_map

        raw = _build_ticker_cik_map() or {}
        return {
            str(tk).strip().upper(): str(cik).zfill(10)
            for tk, cik in raw.items()
            if str(tk).strip() and str(cik).strip().isdigit()
        }
    except Exception as exc:
        print(f"[CatalystCalendar] ticker CIK fallback skipped: {exc}", flush=True)
        return {}


def _load_biotech_symbols() -> list[str]:
    """Master biotech universe from ``data/biotech_symbols.json``."""
    path = Path(_DATA_DIR) / "biotech_symbols.json"
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        tk = str(item or "").strip().upper()
        if not tk or tk in seen or "TOTALE" in tk:
            continue
        seen.add(tk)
        out.append(tk)
    return out


def _sec_company_title_map() -> dict[str, str]:
    """ticker → legal title from SEC company_tickers cache (best-effort)."""
    path = Path(_DATA_DIR) / "sec_company_tickers.json"
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for row in raw.values():
        if not isinstance(row, dict):
            continue
        tk = str(row.get("ticker") or "").strip().upper()
        title = str(row.get("title") or "").strip()
        if tk and title:
            out[tk] = title
    return out


def _load_simulation_sheet_rows() -> list[dict[str, Any]]:
    """All Simulation sheet rows (Ticker / Società / Completion Date)."""
    try:
        from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

        sim_path = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    except ImportError:
        sim_path = Path(_DATA_DIR) / "simulation_sheet_snapshot.json"
    if not sim_path.is_file():
        return []
    try:
        snap = json.loads(sim_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for row in snap.get("rows") or []:
        tk = str(row.get("Ticker") or "").strip().upper()
        if not tk or "TOTALE" in tk:
            continue
        company = str(
            row.get("Società")
            or row.get("Societa")
            or row.get("Company")
            or tk
        ).strip()
        out.append(
            {
                "ticker": tk,
                "company": company or tk,
                "completion_date": str(row.get("Completion Date") or "")[:10],
                "guidance_calendar_catalyst": bool(row.get("guidance_calendar_catalyst")),
                "discovery_calendar_catalyst": bool(row.get("discovery_calendar_catalyst")),
            }
        )
    return out


def _tickers_already_on_calendar() -> set[str]:
    """Tickers present in current snapshot / history (need full typology re-scan)."""
    out: set[str] = set()
    for e in (load_snapshot().get("entries") or []):
        tk = str(e.get("ticker") or "").strip().upper()
        if tk:
            out.add(tk)
    for e in load_history():
        tk = str(e.get("ticker") or "").strip().upper()
        if tk:
            out.add(tk)
    return out


def _sim_priority_tickers() -> set[str]:
    """Tickers in Simulation / Eval Lab with CD within EVAL_PRIORITY_DAYS."""
    from datetime import date, datetime as dt

    today = date.today()
    out: set[str] = set()
    for row in _load_simulation_sheet_rows():
        tk = row["ticker"]
        cd_raw = str(row.get("completion_date") or "")
        if len(cd_raw) < 10:
            if row.get("guidance_calendar_catalyst") or row.get("discovery_calendar_catalyst"):
                out.add(tk)
            continue
        try:
            cd = dt.strptime(cd_raw, "%Y-%m-%d").date()
        except ValueError:
            continue
        delta = (cd - today).days
        if 0 <= delta <= EVAL_PRIORITY_DAYS:
            out.add(tk)
    return out


def _work_list(
    *,
    include_biotech: bool = False,
    biotech_gap_only: bool = False,
) -> list[dict[str, Any]]:
    """
    Companies to deep-scan for PDUFA / AdCom / Readout / Conference / Partnership.

    Order (Simulation is always fully included for a complete calendar picture):
      1. Discovery queue
      2. **All Simulation sheet tickers** (full universe — not only near-CD)
      3. Persistent calendar roster + tickers already in snapshot/history
      4. Remaining sec_k8 universe (fill)
      5. Optional: ``biotech_symbols.json`` names not yet on the calendar list

    ``biotech_gap_only``: skip 1–4 and scan only biotech tickers missing from
    roster / current calendar history (the “not yet in list” set).
    """
    cik_map = _cik_map_from_sec_k8()
    cik_fb = _ticker_cik_fallback()
    titles = _sec_company_title_map() if (include_biotech or biotech_gap_only) else {}
    roster_by_tk = load_roster().get("by_ticker") or {}
    seen: set[str] = set()
    work: list[dict[str, Any]] = []
    must_sources = frozenset(
        {
            "universe_discovery",
            "simulation",
            "simulation_priority",
            "roster",
            "calendar_rescan",
        }
    )
    cap = (
        max(MAX_COMPANIES, BIOTECH_MAX_COMPANIES)
        if (include_biotech or biotech_gap_only)
        else MAX_COMPANIES
    )

    def _resolve_cik(ticker: str, preferred: str | None = None) -> str | None:
        if preferred and str(preferred).strip().isdigit():
            return str(preferred).zfill(10)
        if (cik_map.get(ticker) or {}).get("cik10"):
            return str(cik_map[ticker]["cik10"]).zfill(10)
        roster_row = roster_by_tk.get(ticker) or {}
        if roster_row.get("cik10") and str(roster_row["cik10"]).strip().isdigit():
            return str(roster_row["cik10"]).zfill(10)
        if cik_fb.get(ticker):
            return cik_fb[ticker]
        return None

    def _add(
        ticker: str,
        *,
        cik10: str | None = None,
        company: str | None = None,
        source: str,
        priority: bool,
    ) -> None:
        tk = str(ticker or "").strip().upper()
        if not tk or tk in seen:
            return
        roster_row = roster_by_tk.get(tk) or {}
        resolved = _resolve_cik(tk, cik10)
        if not resolved:
            return
        seen.add(tk)
        work.append(
            {
                "ticker": tk,
                "company": company
                or (cik_map.get(tk) or {}).get("company")
                or roster_row.get("company")
                or titles.get(tk)
                or tk,
                "cik10": resolved,
                "source": source,
                "priority": priority,
            }
        )

    on_cal = _tickers_already_on_calendar()

    if biotech_gap_only:
        # Only skip names that already have Calendar history/snapshot rows.
        # Roster membership alone is NOT enough — a prior run may have upserted
        # the universe before the SEC scan finished.
        already = on_cal
        biotech = _load_biotech_symbols()
        for tk in biotech:
            if tk in already:
                continue
            _add(tk, company=titles.get(tk), source="biotech_universe", priority=False)
        result = work[:cap]
        skipped_no_cik = max(0, len(biotech) - len(already & set(biotech)) - len(work))
        print(
            f"[CatalystCalendar] biotech gap-only: {len(result)} with CIK "
            f"(universe={len(biotech)} already_on_calendar={len(already & set(biotech))} "
            f"no_cik≈{skipped_no_cik} cap={cap})",
            flush=True,
        )
        return result

    # 1. Discovery queue
    try:
        from universe_discovery import list_calendar_work

        for item in list_calendar_work():
            _add(
                str(item.get("ticker") or ""),
                cik10=str(item.get("cik10") or "") or None,
                company=str(item.get("company") or "") or None,
                source="universe_discovery",
                priority=True,
            )
    except Exception as exc:
        print(f"[CatalystCalendar] discovery queue skipped: {exc}", flush=True)

    # 2. Full Simulation sheet — complete event picture for every sim name
    near_cd = _sim_priority_tickers()
    sim_rows = _load_simulation_sheet_rows()
    for row in sim_rows:
        tk = row["ticker"]
        _add(
            tk,
            company=row.get("company"),
            source="simulation_priority" if tk in near_cd else "simulation",
            priority=True,
        )
    print(
        f"[CatalystCalendar] Simulation universe: {len(sim_rows)} rows → "
        f"{sum(1 for w in work if str(w['source']).startswith('simulation'))} with CIK",
        flush=True,
    )

    # 3. Roster + already-on-calendar (full typology re-scan)
    for tk, row in roster_by_tk.items():
        _add(
            tk,
            cik10=str(row.get("cik10") or "") or None,
            company=str(row.get("company") or "") or None,
            source="roster",
            priority=True,
        )
    for tk in sorted(on_cal):
        _add(tk, source="calendar_rescan", priority=True)

    # 4. Remaining sec_k8 fill (after core Simulation + Discovery)
    for tk, info in cik_map.items():
        _add(tk, cik10=info["cik10"], company=info["company"], source="sec_k8", priority=False)

    # 5. Full biotech universe fill (names not yet in work)
    if include_biotech:
        before = len(work)
        for tk in _load_biotech_symbols():
            _add(tk, company=titles.get(tk), source="biotech_universe", priority=False)
        print(
            f"[CatalystCalendar] biotech universe fill: +{len(work) - before} "
            f"(total candidates {len(work)})",
            flush=True,
        )

    # Never drop Discovery / Simulation / roster — only trim fill sources.
    must = [w for w in work if w["source"] in must_sources]
    must_tk = {w["ticker"] for w in must}
    fill_rest = [w for w in work if w["ticker"] not in must_tk]
    if len(must) >= cap:
        print(
            f"[CatalystCalendar] work list {len(must)} (must-only, over cap {cap})",
            flush=True,
        )
        return must
    budget = cap - len(must)
    result = must + fill_rest[:budget]
    print(
        f"[CatalystCalendar] work list {len(result)} "
        f"(must={len(must)} fill={min(budget, len(fill_rest))} cap={cap}"
        f"{' biotech=on' if include_biotech else ''})",
        flush=True,
    )
    return result

def _calendar_8k_filings(
    submissions: dict[str, Any],
    *,
    max_8k: int | None = None,
) -> list[dict[str, Any]]:
    """
    Deeper 8-K set for calendar extraction.

    Prefer Item 8.01 / 2.02 / 7.01 within LOOKBACK_DAYS so PDUFA announced
    6–10 months ago is still visible; fill remaining slots with other recent 8-Ks.
    """
    from datetime import date, datetime, timedelta

    limit = max(1, int(max_8k if max_8k is not None else MAX_8K_SCAN))
    cutoff = date.today() - timedelta(days=max(30, LOOKBACK_DAYS))
    # Pull a wide recent list then filter by date + item priority.
    raw = _recent_8k_filings(submissions, max_n=max(limit * 3, 80))
    preferred: list[dict[str, Any]] = []
    other: list[dict[str, Any]] = []
    for f in raw:
        fd_raw = str(f.get("filing_date") or "")[:10]
        try:
            fd = datetime.strptime(fd_raw, "%Y-%m-%d").date()
        except ValueError:
            fd = None
        if fd is not None and fd < cutoff:
            continue
        items_raw = f.get("items")
        from catalyst_calendar_parse import parse_items_field

        have = parse_items_field(items_raw)
        if have & _CALENDAR_ITEMS or not have:
            preferred.append(f)
        else:
            other.append(f)
    out = preferred + other
    return out[:limit]


def _annotate_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach main-inflection flags (ochre highlight in Calendar UI)."""
    try:
        from catalyst_benchmark import annotate_main_inflection
    except Exception:
        return rows
    out: list[dict[str, Any]] = []
    for e in rows:
        try:
            out.append(annotate_main_inflection(dict(e)))
        except Exception:
            out.append(e)
    return out


def _scan_one_company(
    item: dict[str, Any],
    *,
    extracted_at: str,
    max_8k: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch submissions + up to ``max_8k`` 8-Ks for one ticker (thread-safe)."""
    ticker = str(item.get("ticker") or "").strip().upper()
    cik10 = str(item.get("cik10") or "").zfill(10)
    if not ticker or not cik10.isdigit():
        return []
    rows: list[dict[str, Any]] = []
    try:
        submissions = _fetch_submissions(cik10)
        if not submissions:
            return []
        filings = _calendar_8k_filings(submissions, max_8k=max_8k)
        for filing in filings:
            try:
                rows.extend(
                    _extract_from_8k_filing(
                        ticker=ticker,
                        cik10=cik10,
                        filing=filing,
                        extracted_at=extracted_at,
                    )
                )
            except Exception as exc:
                print(f"[CatalystCalendar] {ticker} filing skip: {exc}", flush=True)
    except Exception as exc:
        print(f"[CatalystCalendar] {ticker} failed: {exc}", flush=True)
    return _annotate_rows(rows)


def _merge_history(existing: list[dict[str, Any]], new_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Append-only by entry id — critical for Readout window narrowing history."""
    by_id = {str(e.get("id")): e for e in existing if e.get("id")}
    for e in new_rows:
        eid = str(e.get("id") or "")
        if not eid or eid in by_id:
            continue
        by_id[eid] = e
    return list(by_id.values())


def _latest_view(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Snapshot «current» view: for PDUFA/AdCom/Conference keep newest per
    (ticker, event_type, date_value|window); for Readout keep newest per
    (ticker, window_label) — full append-only history stays in the history file.
    Past / undated rows are dropped.
    """
    from datetime import date as date_cls

    today = date_cls.today()
    best: dict[str, dict[str, Any]] = {}
    for e in history:
        if not entry_is_current(e, today):
            continue
        et = str(e.get("event_type") or "")
        if et == "Readout" or (et == "Partnership" and e.get("window_label")):
            # Window rows narrow over time (2H 2026 → Q4 2026): key on the window.
            key = "|".join(
                [
                    str(e.get("ticker") or ""),
                    et,
                    str(e.get("window_label") or ""),
                ]
            )
        else:
            key = "|".join(
                [
                    str(e.get("ticker") or ""),
                    et,
                    str(e.get("date_value") or e.get("window_label") or ""),
                ]
            )
        prev = best.get(key)
        if not prev or str(e.get("extracted_at") or "") >= str(prev.get("extracted_at") or ""):
            best[key] = e
    combined = list(best.values())
    combined = _annotate_rows(combined)
    combined.sort(key=sort_key_for_entry)
    return combined


def parse_items_safe(items: Any) -> set[str]:
    from catalyst_calendar_parse import parse_items_field

    return parse_items_field(items)


def _extract_from_8k_filing(
    *,
    ticker: str,
    cik10: str,
    filing: dict[str, Any],
    extracted_at: str,
) -> list[dict[str, Any]]:
    items = filing.get("items")
    # Candidate if items match any of our buckets (or items empty → still try keywords).
    interesting = (
        # 1.01 = material definitive agreement → licensing / partnership deals.
        items_match(items, {"8.01", "2.02", "7.01", "1.01"})
        or not parse_items_safe(items)
    )
    if not interesting:
        return []
    accession = str(filing.get("accession") or "")
    primary = str(filing.get("primary_doc") or "")
    if not accession or not primary:
        return []
    # Full body + Ex-99 PR — 4k truncation was dropping every PDUFA/2H phrase.
    items_set = parse_items_safe(items)
    want_ex = bool(items_set & {"8.01", "7.01", "1.01"}) or not items_set
    text = _fetch_8k_bundle_text(
        cik10,
        accession,
        primary,
        max_chars=100_000,
        fetch_exhibits=want_ex,
    )
    if not text:
        return []
    url = _filing_html_url(cik10, accession, primary)
    return extract_events_from_text(
        text,
        ticker=ticker,
        source_form=str(filing.get("form_type") or "8-K"),
        # Full typology on body+Ex99 — item filter already applied above.
        source_items=None,
        source_filing_url=url,
        extracted_at=extracted_at,
        accession=accession,
        filing_date=str(filing.get("filing_date") or "") or None,
    )


def _extract_from_10q_snapshot(extracted_at: str) -> list[dict[str, Any]]:
    try:
        from sec_10q_extractor import load_snapshot
    except Exception:
        return []
    snap = load_snapshot()
    out: list[dict[str, Any]] = []
    for ev in snap.get("events") or []:
        text = str(ev.get("section_text") or "")
        ticker = str(ev.get("ticker") or "").strip().upper()
        if not text or not ticker:
            continue
        out.extend(
            extract_events_from_text(
                text,
                ticker=ticker,
                source_form=str(ev.get("form_type") or "10-Q"),
                source_items=None,
                source_filing_url=str(ev.get("filing_doc_url") or ""),
                extracted_at=extracted_at,
                accession=str(ev.get("accession") or ""),
                filing_date=str(ev.get("filing_date") or "") or None,
            )
        )
    return out


def scan_ticker_sec_filings(
    ticker: str,
    cik10: str,
    *,
    company: str | None = None,
    max_8k: int = 6,
) -> list[dict[str, Any]]:
    """
    Live 8-K extract for one company (enroll / weekly interest refresh).
    Merges hits into the calendar history + snapshot so the desk sees them.
    """
    tk = str(ticker or "").strip().upper()
    cik = str(cik10 or "").zfill(10)
    if not tk or not cik.isdigit():
        return []
    extracted_at = datetime.now(timezone.utc).isoformat()
    try:
        submissions = _fetch_submissions(cik)
    except Exception as exc:
        print(f"[CatalystCalendar] {tk} submissions failed: {exc}", flush=True)
        return []
    if not submissions:
        return []
    filings = _calendar_8k_filings(submissions)[: max(1, int(max_8k))]
    new_rows: list[dict[str, Any]] = []
    for filing in filings:
        try:
            new_rows.extend(
                _extract_from_8k_filing(
                    ticker=tk,
                    cik10=cik,
                    filing=filing,
                    extracted_at=extracted_at,
                )
            )
        except Exception as exc:
            print(f"[CatalystCalendar] {tk} filing skip: {exc}", flush=True)
    if not new_rows:
        return []
    try:
        history = _merge_history(load_history(), new_rows)
        _save_json(
            _HISTORY_PATH,
            {
                "updated_at": extracted_at,
                "count": len(history),
                "entries": history,
            },
        )
        view = _latest_view(history)
        snap = load_snapshot()
        snap = dict(snap) if isinstance(snap, dict) else {}
        snap["entries"] = view
        snap["count"] = len(view)
        snap["history_count"] = len(history)
        snap["updated_at"] = extracted_at
        _save_json(_SNAPSHOT_PATH, snap)
        upsert_roster_entries(
            [
                {
                    "ticker": tk,
                    "cik10": cik,
                    "company": company or tk,
                    "source": "catalyst_interest",
                }
            ]
        )
    except Exception as exc:
        print(f"[CatalystCalendar] {tk} snapshot merge failed: {exc}", flush=True)
    return [r for r in new_rows if str(r.get("ticker") or "").strip().upper() == tk]


def run_catalyst_calendar_refresh(
    *,
    include_biotech: bool = False,
    biotech_gap_only: bool = False,
) -> dict[str, Any]:
    try:
        return _run(
            include_biotech=include_biotech,
            biotech_gap_only=biotech_gap_only,
        )
    except Exception as exc:
        _set_status(running=False, error=str(exc), message=f"Error: {exc}")
        return {"ok": False, "error": str(exc)}


def _run(
    *,
    include_biotech: bool = False,
    biotech_gap_only: bool = False,
) -> dict[str, Any]:
    mode_label = (
        "biotech gap (not yet on calendar)"
        if biotech_gap_only
        else ("Simulation+Discovery+biotech" if include_biotech else "Simulation+Discovery")
    )
    _set_status(
        running=True,
        message=(
            "Biotech gap → Calendar: enqueue…"
            if biotech_gap_only
            else "Discovery → Calendar: enqueue…"
        ),
        processed=0,
        total=0,
        error=None,
    )

    discovery_sync: dict[str, Any] = {"queued": 0}
    if not biotech_gap_only:
        try:
            from universe_discovery import sync_discovery_snapshot_to_calendar_queue

            discovery_sync = sync_discovery_snapshot_to_calendar_queue()
            nq = int(discovery_sync.get("queued") or 0)
            _set_status(
                message=f"Discovery → Calendar: {nq} in coda, avvio scan SEC…",
            )
            print(
                f"[CatalystCalendar] discovery sync queued={nq} "
                f"queue_size={discovery_sync.get('queue_size')}",
                flush=True,
            )
        except Exception as exc:
            print(f"[CatalystCalendar] discovery sync skipped: {exc}", flush=True)

    work = _work_list(
        include_biotech=include_biotech,
        biotech_gap_only=biotech_gap_only,
    )
    if not work:
        msg = (
            "No biotech gap to scan (all biotech_symbols already on calendar roster, or no CIK)"
            if biotech_gap_only
            else "No calendar work list (sec_k8 snapshot empty and Discovery queue empty)"
        )
        _set_status(running=False, error=msg, message=msg)
        return {"ok": False, "error": msg, "count": 0, "discovery_sync": discovery_sync}

    # Persist roster for normal refreshes. Gap-only upserts after each company
    # so an interrupted run does not mark unscanned names as "already listed".
    if not biotech_gap_only:
        upsert_roster_entries(work)

    biotech_n = sum(1 for w in work if w.get("source") == "biotech_universe")
    fast_gap = bool(biotech_gap_only or include_biotech)
    max_8k = GAP_MAX_8K_SCAN if fast_gap else MAX_8K_SCAN
    workers = GAP_WORKERS if fast_gap else 1
    _set_status(
        total=len(work),
        message=(
            f"Scan {mode_label}: {len(work)} società"
            f"{f' (gap biotech {biotech_n})' if biotech_n else ''} "
            f"· {workers} worker · ≤{max_8k} 8-K/co "
            f"(PDUFA/AdCom/Readout/Conference/Partnership)…"
        ),
    )
    extracted_at = datetime.now(timezone.utc).isoformat()
    new_rows: list[dict[str, Any]] = []

    # 10-Q sections (Part 1) — independent try (skip on gap-only: focus on new names)
    if not biotech_gap_only:
        try:
            q_rows = _annotate_rows(_extract_from_10q_snapshot(extracted_at))
            new_rows.extend(q_rows)
        except Exception as exc:
            print(f"[CatalystCalendar] 10-Q extract skipped: {exc}", flush=True)

    processed_box = {"n": 0}
    lock = threading.Lock()

    def _on_done(ticker: str, item: dict[str, Any] | None = None) -> None:
        with lock:
            processed_box["n"] += 1
            n = processed_box["n"]
        if biotech_gap_only and item is not None:
            try:
                upsert_roster_entries([item])
            except Exception as exc:
                print(f"[CatalystCalendar] roster upsert {ticker}: {exc}", flush=True)
        _set_status(
            message=f"Calendar {ticker} ({n}/{len(work)})",
            processed=n,
        )
        if n % 25 == 0 or n == len(work):
            print(f"[CatalystCalendar] progress {n}/{len(work)} …", flush=True)

    if workers <= 1:
        for idx, item in enumerate(work):
            ticker = item["ticker"]
            _set_status(
                message=f"Calendar {ticker} ({idx + 1}/{len(work)})",
                processed=idx,
            )
            print(f"[CatalystCalendar] {idx + 1}/{len(work)} {ticker}…", flush=True)
            new_rows.extend(
                _scan_one_company(item, extracted_at=extracted_at, max_8k=max_8k)
            )
            if biotech_gap_only:
                try:
                    upsert_roster_entries([item])
                except Exception as exc:
                    print(f"[CatalystCalendar] roster upsert {ticker}: {exc}", flush=True)
    else:
        from concurrent.futures import ThreadPoolExecutor, as_completed

        print(
            f"[CatalystCalendar] parallel scan workers={workers} max_8k={max_8k} "
            f"companies={len(work)}",
            flush=True,
        )
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {
                pool.submit(
                    _scan_one_company,
                    item,
                    extracted_at=extracted_at,
                    max_8k=max_8k,
                ): item
                for item in work
            }
            for fut in as_completed(futs):
                item = futs[fut]
                ticker = str(item.get("ticker") or "")
                try:
                    new_rows.extend(fut.result())
                except Exception as exc:
                    print(f"[CatalystCalendar] {ticker} worker failed: {exc}", flush=True)
                _on_done(ticker, item)

    history = _merge_history(load_history(), new_rows)
    _save_json(
        _HISTORY_PATH,
        {
            "updated_at": extracted_at,
            "count": len(history),
            "entries": history,
        },
    )
    view = _latest_view(history)
    snap = {
        "updated_at": extracted_at,
        "count": len(view),
        "history_count": len(history),
        "entries": view,
        "meta": {
            "max_8k_scan": MAX_8K_SCAN,
            "lookback_days": LOOKBACK_DAYS,
            "eval_priority_days": EVAL_PRIORITY_DAYS,
            "companies_scanned": len(work),
            "priority_companies": sum(1 for w in work if w.get("priority")),
            "roster_count": len(load_roster().get("by_ticker") or {}),
            "include_biotech": bool(include_biotech or biotech_gap_only),
            "biotech_gap_only": bool(biotech_gap_only),
            "gap_workers": workers if fast_gap else 1,
            "gap_max_8k": max_8k if fast_gap else MAX_8K_SCAN,
            "biotech_tickers": sorted(
                {w["ticker"] for w in work if w.get("source") == "biotech_universe"}
            ),
            "discovery_tickers": sorted(
                {w["ticker"] for w in work if w.get("source") == "universe_discovery"}
            ),
            "simulation_tickers": sorted(
                {
                    w["ticker"]
                    for w in work
                    if str(w.get("source") or "").startswith("simulation")
                }
            ),
            "discovery_queued": int(discovery_sync.get("queued") or 0),
            "scanned_tickers": [w["ticker"] for w in work],
            "event_types": ["PDUFA", "AdCom", "Readout", "Conference", "Partnership"],
        },
        "schema": {
            "event_type": ["PDUFA", "AdCom", "Readout", "Conference", "Partnership"],
            "date_precision": ["exact_date", "quarter_window", "half_year_window"],
            "confidence": ["high", "medium", "low"],
            "notes": (
                "PDUFA/AdCom: exact dates from 8-K Item 8.01 (NDA/BLA acceptance → target action date). "
                "Readout: window-only (2H/Qx), append-only history as guidance narrows. "
                "Conference: congress DATE when stated (content of data unknown). "
                "Partnership: 8-K Item 1.01 licensing/collaboration — forward leg only "
                "(closing, opt-in, milestone), with counterparty in `partner`. "
                "Scan lookback ~13 months so PDUFA announced 6–10 months ahead is retained. "
                "Optional biotech gap: biotech_symbols.json names not yet on the calendar roster."
            ),
        },
    }
    _save_json(_SNAPSHOT_PATH, snap)

    promoted = {"entries": 0}
    try:
        from universe_discovery import sync_near_catalyst_sim_entries

        promoted = sync_near_catalyst_sim_entries(view)
    except Exception as exc:
        print(f"[CatalystCalendar] discovery→sim promote skipped: {exc}", flush=True)

    try:
        from calendar_identity import build_identity_index

        build_identity_index(persist=True)
    except Exception as exc:
        print(f"[CatalystCalendar] identity index skipped: {exc}", flush=True)

    try:
        mark_monthly_run()
    except Exception:
        pass

    _set_status(
        running=False,
        message=f"Done — {len(view)} view / {len(history)} history (+{len(new_rows)} scanned)",
        processed=len(work),
        finished_at=extracted_at,
        error=None,
    )
    return {
        "ok": True,
        "count": len(view),
        "history_count": len(history),
        "new_scanned": len(new_rows),
        "companies_scanned": len(work),
        "biotech_gap": biotech_n,
        "discovery_promoted": promoted.get("entries", 0),
        "discovery_sync": discovery_sync,
        "updated_at": extracted_at,
    }
