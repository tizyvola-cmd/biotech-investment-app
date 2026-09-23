"""
Universe Discovery Screener — SEC 8-K full-text, no ticker filter
================================================================
Finds biotech/pharma filers **outside** the current SuperNova watchlist that
recently disclosed high-signal regulatory language (designations / PDUFA / etc.).

Uses ``edgar_fulltext_search`` (efts.sec.gov). Does **not** auto-add to watchlist.
Does **not** modify catalyst / 10-Q / calendar modules.

Output:
  data/universe_discovery_snapshot.json
  data/universe_discovery_store.json   # persistent status by CIK
"""

from __future__ import annotations

import json
import os
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from edgar_fulltext_search import (
    BIOTECH_SICS,
    filter_hits_by_sic,
    search_fulltext,
)

SignalTier = Literal["A", "B"]
ReviewStatus = Literal["new", "reviewed_added", "reviewed_rejected"]

_DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
if not _DATA_DIR.is_absolute():
    _DATA_DIR = Path(__file__).resolve().parent / "data"

_SNAPSHOT_PATH = _DATA_DIR / "universe_discovery_snapshot.json"
_STORE_PATH = _DATA_DIR / "universe_discovery_store.json"
_CALENDAR_QUEUE_PATH = _DATA_DIR / "discovery_calendar_queue.json"
_SCHEDULE_MARKER_PATH = _DATA_DIR / "universe_discovery_schedule.json"
# Near-catalyst promotion into Simulation / Catalyst desk (user pipeline: ≤20 days).
DISCOVERY_NEAR_CATALYST_DAYS = int(os.environ.get("DISCOVERY_NEAR_CATALYST_DAYS", "20"))
_DISCOVERY_SIM_ENTRIES_PATH = _DATA_DIR / "discovery_catalyst_sim_entries.json"
# Monthly auto-scan on the server (2nd of each month, Europe/Rome).
DISCOVERY_MONTHLY_DAY = int(os.environ.get("DISCOVERY_MONTHLY_DAY", "2"))
DISCOVERY_MONTHLY_AT = os.environ.get("DISCOVERY_MONTHLY_AT", "07:30")

LOOKBACK_DAYS = int(os.environ.get("DISCOVERY_LOOKBACK_DAYS", "7"))
MAX_HITS_PER_KW = int(os.environ.get("DISCOVERY_MAX_HITS_PER_KW", "100"))

# Livello A — early designation (discover NEW names)
KEYWORDS_TIER_A: list[str] = [
    "Breakthrough Therapy",
    "Fast Track",
    "Orphan Drug",
    "Regenerative Medicine Advanced Therapy",
    "Accelerated Approval",
]

# Livello B — late event language (noisier)
KEYWORDS_TIER_B: list[str] = [
    "PDUFA",
    "target action date",
    "Advisory Committee meeting",
    "topline data",
    "data readout",
]

_STATUS: dict[str, Any] = {
    "running": False,
    "message": "",
    "processed": 0,
    "total": 0,
    "error": None,
    "finished_at": None,
    "sics_param_effective": None,
}
_STATUS_LOCK = threading.Lock()


def get_status() -> dict[str, Any]:
    with _STATUS_LOCK:
        return dict(_STATUS)


def _set_status(**kw: Any) -> None:
    with _STATUS_LOCK:
        _STATUS.update(kw)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_json(path: Path, data: dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def load_snapshot() -> dict[str, Any]:
    data = _load_json(_SNAPSHOT_PATH)
    if not data:
        return {"candidates": [], "count": 0, "updated_at": None}
    return data


def load_store() -> dict[str, Any]:
    """Persistent review state keyed by CIK."""
    data = _load_json(_STORE_PATH)
    if not isinstance(data.get("by_cik"), dict):
        data["by_cik"] = {}
    return data


def save_store(store: dict[str, Any]) -> None:
    store["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_json(_STORE_PATH, store)


def set_candidate_status(cik: str, status: ReviewStatus) -> dict[str, Any]:
    cik10 = str(cik or "").strip().zfill(10)
    if not cik10.isdigit():
        return {"ok": False, "error": "invalid cik"}
    if status not in ("new", "reviewed_added", "reviewed_rejected"):
        return {"ok": False, "error": "invalid status"}
    store = load_store()
    row = dict(store["by_cik"].get(cik10) or {})
    # Enrich from live snapshot if store is thin.
    snap = load_snapshot()
    cand = next(
        (
            c
            for c in (snap.get("candidates") or [])
            if str(c.get("cik") or "").zfill(10) == cik10
        ),
        None,
    )
    if cand:
        for k in (
            "ticker",
            "company_name",
            "sic_code",
            "matched_keywords",
            "signal_tier",
            "first_seen_at",
            "source_filing_url",
        ):
            if cand.get(k) and not row.get(k):
                row[k] = cand[k]
            elif cand.get(k):
                row[k] = cand[k]

    row["status"] = status
    row["status_updated_at"] = datetime.now(timezone.utc).isoformat()
    store["by_cik"][cik10] = row
    save_store(store)

    queued = False
    if status == "reviewed_added":
        queued = bool(upsert_calendar_queue_from_row(row, cik10))
    elif status == "reviewed_rejected":
        remove_from_calendar_queue(cik10)

    changed = False
    for c in snap.get("candidates") or []:
        if str(c.get("cik") or "").zfill(10) == cik10:
            c["status"] = status
            changed = True
    if changed:
        snap["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_json(_SNAPSHOT_PATH, snap)
    # Also sync Discovery queue into the calendar roster immediately on Add.
    if status == "reviewed_added" and queued:
        try:
            from catalyst_calendar import upsert_roster_entries

            upsert_roster_entries(
                [
                    {
                        "ticker": str(row.get("ticker") or ""),
                        "cik10": cik10,
                        "company": str(row.get("company_name") or row.get("ticker") or ""),
                        "source": "universe_discovery",
                    }
                ]
            )
        except Exception:
            pass
    return {
        "ok": True,
        "cik": cik10,
        "status": status,
        "queued_for_calendar": queued,
        "ticker": str(row.get("ticker") or "") or None,
    }


def load_calendar_queue() -> dict[str, Any]:
    data = _load_json(_CALENDAR_QUEUE_PATH)
    if not isinstance(data.get("entries"), list):
        data["entries"] = []
    return data


def save_calendar_queue(data: dict[str, Any]) -> None:
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_json(_CALENDAR_QUEUE_PATH, data)


def upsert_calendar_queue_from_row(row: dict[str, Any], cik10: str) -> dict[str, Any] | None:
    """Add / refresh a Discovery name on the Calendar work-list queue."""
    ticker = str(row.get("ticker") or "").strip().upper()
    if not ticker:
        return None
    company = str(row.get("company_name") or ticker).strip()
    q = load_calendar_queue()
    entries = [e for e in q["entries"] if str(e.get("cik") or "").zfill(10) != cik10]
    entry = {
        "ticker": ticker,
        "company": company,
        "cik10": cik10,
        "cik": cik10,
        "added_at": datetime.now(timezone.utc).isoformat(),
        "source": "universe_discovery",
        "signal_tier": row.get("signal_tier"),
        "matched_keywords": row.get("matched_keywords") or [],
        "first_seen_at": row.get("first_seen_at"),
    }
    entries.append(entry)
    q["entries"] = entries
    save_calendar_queue(q)
    return entry


def remove_from_calendar_queue(cik: str) -> None:
    cik10 = str(cik or "").zfill(10)
    q = load_calendar_queue()
    before = len(q["entries"])
    removed_tickers = [
        str(e.get("ticker") or "").upper()
        for e in q["entries"]
        if str(e.get("cik") or "").zfill(10) == cik10
    ]
    q["entries"] = [e for e in q["entries"] if str(e.get("cik") or "").zfill(10) != cik10]
    if len(q["entries"]) != before:
        save_calendar_queue(q)
    if removed_tickers:
        try:
            from catalyst_calendar import load_roster, save_roster

            roster = load_roster()
            by_tk = dict(roster.get("by_ticker") or {})
            dirty = False
            for tk in removed_tickers:
                if tk in by_tk:
                    del by_tk[tk]
                    dirty = True
            if dirty:
                roster["by_ticker"] = by_tk
                save_roster(roster)
        except Exception:
            pass


def list_calendar_work() -> list[dict[str, Any]]:
    """Ticker/CIK rows for catalyst_calendar / guidance work-list union."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for e in load_calendar_queue().get("entries") or []:
        ticker = str(e.get("ticker") or "").strip().upper()
        cik10 = str(e.get("cik10") or e.get("cik") or "").zfill(10)
        if not ticker or not cik10.isdigit() or ticker in seen:
            continue
        seen.add(ticker)
        out.append(
            {
                "ticker": ticker,
                "company": str(e.get("company") or ticker),
                "cik10": cik10,
                "source": "universe_discovery",
            }
        )
    return out


def sync_near_catalyst_sim_entries(
    calendar_entries: list[dict[str, Any]] | None = None,
    *,
    horizon_days: int | None = None,
) -> dict[str, Any]:
    """
    Calendar → Catalyst / Eval bridge: tickers with a catalyst date within
    ``horizon_days`` (default 20) become Simulation sidecar rows.

    Phase 1: promote **all** SEC calendar tickers (not only Discovery queue).
    Exact dates use ``date_value``; fuzzy windows use **window start**
    (conservative — avoids false negatives on open ranges that already began
    only when start is still in the future / within horizon).

    Does not change Soft BUY/SELL gates.
    """
    from datetime import date as date_cls

    from catalyst_calendar_parse import window_label_end_iso

    horizon = horizon_days if horizon_days is not None else DISCOVERY_NEAR_CATALYST_DAYS
    today = date_cls.today()

    if calendar_entries is None:
        try:
            from catalyst_calendar import load_snapshot as _cal_snap

            calendar_entries = list((_cal_snap().get("entries") or []))
        except Exception:
            calendar_entries = []

    company_by_tk = {w["ticker"]: w["company"] for w in list_calendar_work()}
    try:
        from catalyst_calendar import load_roster

        for tk, row in (load_roster().get("by_ticker") or {}).items():
            company_by_tk.setdefault(str(tk).upper(), str(row.get("company") or tk))
    except Exception:
        pass

    def _anchor_date(e: dict[str, Any]) -> date_cls | None:
        if str(e.get("date_precision") or "") == "exact_date" or e.get("date_value"):
            dv = str(e.get("date_value") or "")[:10]
            if len(dv) >= 10:
                try:
                    return date_cls.fromisoformat(dv)
                except ValueError:
                    pass
        # Fuzzy: conservative start of window from label (Q4/2H → start month)
        wl = str(e.get("window_label") or "").strip()
        if not wl:
            return None
        # Reuse end helper inversely via calendarPhase1 logic: parse start in Python
        m = __import__("re").match(r"(?i)^Q([1-4])\s*(20\d{2})$", wl)
        if m:
            q, y = int(m.group(1)), int(m.group(2))
            return date_cls(y, (q - 1) * 3 + 1, 1)
        m = __import__("re").match(r"(?i)^(?:2H|H2)\s*(20\d{2})$", wl)
        if m:
            return date_cls(int(m.group(1)), 7, 1)
        m = __import__("re").match(r"(?i)^(?:1H|H1)\s*(20\d{2})$", wl)
        if m:
            return date_cls(int(m.group(1)), 1, 1)
        m = __import__("re").match(r"(?i)^mid[- ]?(20\d{2})$", wl)
        if m:
            return date_cls(int(m.group(1)), 6, 1)
        # If only end known, skip fuzzy migrate (need start)
        _ = window_label_end_iso(wl)
        return None

    best: dict[str, dict[str, Any]] = {}
    for e in calendar_entries:
        tk = str(e.get("ticker") or "").strip().upper()
        if not tk:
            continue
        d = _anchor_date(e)
        if d is None:
            continue
        delta = (d - today).days
        if delta < 0 or delta > horizon:
            continue
        prev = best.get(tk)
        if not prev or delta < int(prev.get("_days") or 9999):
            best[tk] = {**e, "_days": delta, "_date": d.isoformat()}

    entries: list[dict[str, Any]] = []
    for tk, e in best.items():
        company = company_by_tk.get(tk) or tk
        dv = e["_date"]
        entries.append(
            {
                "Ticker": tk,
                "Società": company,
                "Completion Date": dv,
                "Exact·Partial vs Unmatch": "Catalyst",
                "Lead sponsor": company,
                "Società (full name)": company,
                "NCT": "",
                "Sponsor (da NCT)": "",
                "Relazione sponsor": "",
                "Link studio": "",
                "Studio Phase": "",
                "Drug": "",
                "Indication": "",
                "guidance_calendar_catalyst": True,
                "discovery_calendar_catalyst": True,
                "guidance_event_type": str(e.get("event_type") or "other").lower(),
                "guidance_window_start": dv,
                "guidance_window_end": dv,
                "guidance_source_quote": str(e.get("raw_snippet") or "")[:400],
                "guidance_confidence": e.get("confidence"),
            }
        )

    doc = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "horizon_days": horizon,
        "entries": entries,
    }
    _save_json(_DISCOVERY_SIM_ENTRIES_PATH, doc)

    synced = 0
    try:
        from guidance_calendar import _sync_catalyst_into_sim_snapshot

        synced = _sync_catalyst_into_sim_snapshot(entries)
    except Exception as exc:
        print(f"[UniverseDiscovery] sim sync skipped: {exc}", flush=True)

    return {"entries": len(entries), "synced": synced, "horizon_days": horizon}


def watchlist_tickers_and_ciks() -> tuple[set[str], set[str]]:
    """Tickers + CIKs already monitored (sec_k8 / simulation snapshots)."""
    tickers: set[str] = set()
    ciks: set[str] = set()
    paths = [
        _DATA_DIR / "sec_k8_simulation_snapshot.json",
        _DATA_DIR / "simulation_sheet_snapshot.json",
    ]
    try:
        from orchestrator_io_paths import (
            SEC_K8_SIMULATION_SNAPSHOT_JSON,
            SIMULATION_SHEET_SNAPSHOT_JSON,
        )

        paths = [
            Path(SEC_K8_SIMULATION_SNAPSHOT_JSON),
            Path(SIMULATION_SHEET_SNAPSHOT_JSON),
        ]
    except Exception:
        pass

    for path in paths:
        if not path.is_file():
            continue
        try:
            snap = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for row in snap.get("rows") or []:
            tk = str(row.get("Ticker") or row.get("ticker") or "").strip().upper()
            if tk:
                tickers.add(tk)
            for key, val in row.items():
                if "CIK" in str(key).upper():
                    digits = "".join(ch for ch in str(val) if ch.isdigit())
                    if len(digits) >= 6:
                        ciks.add(digits[-10:].zfill(10))
    return tickers, ciks


def _merge_candidate(
    bucket: dict[str, dict[str, Any]],
    hit: dict[str, Any],
    *,
    keyword: str,
    tier: SignalTier,
) -> None:
    cik = str(hit.get("cik") or "").zfill(10)
    if not cik or cik == "0000000000":
        return
    row = bucket.get(cik)
    file_date = str(hit.get("file_date") or "")[:10]
    if not row:
        bucket[cik] = {
            "ticker": str(hit.get("ticker") or "").upper() or None,
            "cik": cik,
            "company_name": hit.get("company_name") or hit.get("display_name") or "",
            "sic_code": hit.get("sic") or "",
            "matched_keywords": [keyword],
            "signal_tier": tier,
            "first_seen_at": file_date or None,
            "source_filing_url": hit.get("source_filing_url") or "",
            "raw_snippet": hit.get("snippet") or "",
            "status": "new",
            "adsh": hit.get("adsh") or "",
            "file_date": file_date,
        }
        return
    kws = list(row.get("matched_keywords") or [])
    if keyword not in kws:
        kws.append(keyword)
    row["matched_keywords"] = kws
    # Tier A wins if any A keyword matched.
    if tier == "A" or row.get("signal_tier") == "A":
        row["signal_tier"] = "A"
    else:
        row["signal_tier"] = "B"
    prev = str(row.get("first_seen_at") or "")
    if file_date and (not prev or file_date < prev):
        row["first_seen_at"] = file_date
        row["source_filing_url"] = hit.get("source_filing_url") or row.get("source_filing_url")
        row["raw_snippet"] = hit.get("snippet") or row.get("raw_snippet")
        row["adsh"] = hit.get("adsh") or row.get("adsh")
        row["file_date"] = file_date
    if hit.get("ticker") and not row.get("ticker"):
        row["ticker"] = str(hit["ticker"]).upper()
    if hit.get("sic") and not row.get("sic_code"):
        row["sic_code"] = hit["sic"]


def run_universe_discovery_refresh(
    *,
    lookback_days: int | None = None,
    include_tier_b: bool = True,
) -> dict[str, Any]:
    try:
        result = _run(lookback_days=lookback_days, include_tier_b=include_tier_b)
        if result.get("calendar_refresh_needed"):
            _kick_calendar_refresh_async()
        return result
    except Exception as exc:
        _set_status(running=False, error=str(exc), message=f"Error: {exc}")
        return {"ok": False, "error": str(exc)}


def _kick_calendar_refresh_async() -> None:
    """After Discovery auto-intake, deep-scan Calendar for catalyst days."""

    def _target() -> None:
        try:
            import catalyst_calendar as _cc

            if _cc.get_status().get("running"):
                print("[UniverseDiscovery] calendar already running — skip kick", flush=True)
                return
            print("[UniverseDiscovery] kicking catalyst calendar refresh…", flush=True)
            _cc.run_catalyst_calendar_refresh()
        except Exception as exc:
            print(f"[UniverseDiscovery] calendar kick failed: {exc}", flush=True)

    threading.Thread(target=_target, name="discovery-calendar-kick", daemon=True).start()


def _run(*, lookback_days: int | None, include_tier_b: bool) -> dict[str, Any]:
    days = lookback_days if lookback_days is not None else LOOKBACK_DAYS
    end = date.today()
    start = end - timedelta(days=max(1, days))
    sics_csv = ",".join(sorted(BIOTECH_SICS))

    keywords: list[tuple[str, SignalTier]] = [(k, "A") for k in KEYWORDS_TIER_A]
    if include_tier_b:
        keywords.extend((k, "B") for k in KEYWORDS_TIER_B)

    _set_status(
        running=True,
        message="EDGAR universe discovery…",
        processed=0,
        total=len(keywords),
        error=None,
        sics_param_effective=None,
    )

    wl_tickers, wl_ciks = watchlist_tickers_and_ciks()
    bucket: dict[str, dict[str, Any]] = {}
    sics_eff_flags: list[bool] = []
    errors: list[str] = []
    raw_hit_n = 0
    sic_hit_n = 0

    for idx, (kw, tier) in enumerate(keywords):
        _set_status(message=f"Search «{kw}» ({tier})", processed=idx)
        res = search_fulltext(
            kw,
            forms="8-K",
            start=start,
            end=end,
            sics=sics_csv,
            max_hits=MAX_HITS_PER_KW,
        )
        if res.get("error"):
            errors.append(f"{kw}: {res['error']}")
        if res.get("sics_param_effective") is not None:
            sics_eff_flags.append(bool(res["sics_param_effective"]))
        hits = list(res.get("hits") or [])
        raw_hit_n += len(hits)
        # Always client-filter SIC (server may or may not apply `sics=`).
        hits = filter_hits_by_sic(hits, BIOTECH_SICS)
        sic_hit_n += len(hits)
        for h in hits:
            _merge_candidate(bucket, h, keyword=kw, tier=tier)

    sics_effective = all(sics_eff_flags) if sics_eff_flags else None
    _set_status(sics_param_effective=sics_effective)

    store = load_store()
    by_cik_store: dict[str, Any] = store.get("by_cik") or {}

    biotech_ref: set[str] = set()
    try:
        from calendar_identity import load_biotech_symbol_set

        biotech_ref = load_biotech_symbol_set()
    except Exception:
        biotech_ref = set()

    candidates: list[dict[str, Any]] = []
    skipped_watchlist = 0
    skipped_reviewed = 0
    for cik, row in bucket.items():
        tk = str(row.get("ticker") or "").upper()
        if cik in wl_ciks or (tk and tk in wl_tickers):
            skipped_watchlist += 1
            continue
        prev = by_cik_store.get(cik) or {}
        status = str(prev.get("status") or "new")
        # Preserve first_seen_at across rolling windows.
        if prev.get("first_seen_at"):
            old = str(prev["first_seen_at"])[:10]
            cur = str(row.get("first_seen_at") or "")[:10]
            if old and (not cur or old < cur):
                row["first_seen_at"] = old
        if status in ("reviewed_added", "reviewed_rejected"):
            skipped_reviewed += 1
            row["status"] = status
        else:
            row["status"] = "new"
            status = "new"
        row["in_biotech_reference"] = bool(tk and tk in biotech_ref)
        # Upsert store skeleton without flipping reviewed statuses.
        store_row = dict(prev)
        store_row.update(
            {
                "ticker": row.get("ticker"),
                "company_name": row.get("company_name"),
                "sic_code": row.get("sic_code"),
                "matched_keywords": row.get("matched_keywords"),
                "signal_tier": row.get("signal_tier"),
                "first_seen_at": row.get("first_seen_at"),
                "source_filing_url": row.get("source_filing_url"),
                "status": status,
                "in_biotech_reference": row["in_biotech_reference"],
            }
        )
        by_cik_store[cik] = store_row
        candidates.append(row)

    candidates_a = [c for c in candidates if c.get("signal_tier") == "A"]
    candidates_b = [c for c in candidates if c.get("signal_tier") != "A"]
    candidates_a.sort(key=lambda c: str(c.get("first_seen_at") or ""), reverse=True)
    candidates_b.sort(key=lambda c: str(c.get("first_seen_at") or ""), reverse=True)
    candidates = candidates_a + candidates_b

    store["by_cik"] = by_cik_store
    save_store(store)

    # Auto-intake: every non-rejected Discovery hit with a ticker enters Calendar.
    auto_queued = auto_enqueue_candidates_to_calendar(candidates)
    if auto_queued:
        # Reflect status flip in the in-memory candidate list.
        queued_ciks = {q["cik"] for q in auto_queued}
        for c in candidates:
            if str(c.get("cik") or "").zfill(10) in queued_ciks:
                c["status"] = "reviewed_added"

    finished = datetime.now(timezone.utc).isoformat()
    new_count = sum(1 for c in candidates if (c.get("status") or "new") == "new")
    snap = {
        "updated_at": finished,
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "count": new_count,
        "candidates": candidates,
        "meta": {
            "raw_hits": raw_hit_n,
            "sic_filtered_hits": sic_hit_n,
            "skipped_watchlist": skipped_watchlist,
            "skipped_reviewed": skipped_reviewed,
            "auto_queued_to_calendar": len(auto_queued),
            "auto_queued_tickers": [q.get("ticker") for q in auto_queued if q.get("ticker")],
            "sics_param_effective": sics_effective,
            "sics": sorted(BIOTECH_SICS),
            "keywords_a": KEYWORDS_TIER_A,
            "keywords_b": KEYWORDS_TIER_B,
            "errors": errors[:12],
            "watchlist_tickers": len(wl_tickers),
            "watchlist_ciks": len(wl_ciks),
            "biotech_reference_size": len(biotech_ref),
            "in_biotech_reference": sum(
                1 for c in candidates if c.get("in_biotech_reference")
            ),
        },
        "schema": {
            "DiscoveryCandidate": [
                "ticker",
                "cik",
                "company_name",
                "sic_code",
                "matched_keywords",
                "signal_tier",
                "first_seen_at",
                "source_filing_url",
                "raw_snippet",
                "status",
            ],
            "notes": (
                "New Discovery hits auto-enter Calendar (catalyst-day search). "
                "reviewed_rejected stays out. Never auto Soft BUY/SELL."
            ),
        },
    }
    _save_json(_SNAPSHOT_PATH, snap)
    new_a = sum(1 for c in candidates_a if (c.get("status") or "new") == "new")
    new_b = sum(1 for c in candidates_b if (c.get("status") or "new") == "new")
    _set_status(
        running=False,
        message=(
            f"Done — {len(auto_queued)} auto→Calendar"
            f" (open A={sum(1 for c in candidates if c.get('signal_tier')=='A' and (c.get('status') or 'new')=='new')}"
            f" B={sum(1 for c in candidates if c.get('signal_tier')!='A' and (c.get('status') or 'new')=='new')})"
        ),
        processed=len(keywords),
        finished_at=finished,
        error=None,
        sics_param_effective=sics_effective,
    )
    return {
        "ok": True,
        "count": new_count,
        "tier_a": new_a,
        "tier_b": new_b,
        "skipped_watchlist": skipped_watchlist,
        "skipped_reviewed": skipped_reviewed,
        "auto_queued_to_calendar": len(auto_queued),
        "calendar_refresh_needed": bool(auto_queued),
        "sics_param_effective": sics_effective,
        "updated_at": finished,
        "errors": errors,
    }


def auto_enqueue_candidates_to_calendar(
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Push Discovery hits into the Calendar work queue automatically.

    Skips ``reviewed_rejected`` and rows without a ticker. Marks queued rows
    ``reviewed_added`` so they do not re-surface as brand-new every day.
    """
    store = load_store()
    by_cik: dict[str, Any] = store.get("by_cik") or {}
    queued: list[dict[str, Any]] = []
    roster_rows: list[dict[str, Any]] = []

    for c in candidates:
        status = str(c.get("status") or "new")
        if status == "reviewed_rejected":
            continue
        ticker = str(c.get("ticker") or "").strip().upper()
        cik10 = str(c.get("cik") or "").zfill(10)
        if not ticker or not cik10.isdigit():
            continue
        entry = upsert_calendar_queue_from_row(
            {
                "ticker": ticker,
                "company_name": c.get("company_name") or ticker,
                "signal_tier": c.get("signal_tier"),
                "matched_keywords": c.get("matched_keywords") or [],
                "first_seen_at": c.get("first_seen_at"),
            },
            cik10,
        )
        if not entry:
            continue
        row = dict(by_cik.get(cik10) or {})
        row.update(
            {
                "ticker": ticker,
                "company_name": c.get("company_name") or ticker,
                "sic_code": c.get("sic_code"),
                "matched_keywords": c.get("matched_keywords"),
                "signal_tier": c.get("signal_tier"),
                "first_seen_at": c.get("first_seen_at") or row.get("first_seen_at"),
                "source_filing_url": c.get("source_filing_url"),
                "status": "reviewed_added",
                "status_updated_at": datetime.now(timezone.utc).isoformat(),
                "auto_queued_to_calendar": True,
            }
        )
        by_cik[cik10] = row
        queued.append({"ticker": ticker, "cik": cik10})
        roster_rows.append(
            {
                "ticker": ticker,
                "cik10": cik10,
                "company": c.get("company_name") or ticker,
                "source": "universe_discovery",
            }
        )

    if queued:
        store["by_cik"] = by_cik
        save_store(store)
        try:
            from catalyst_calendar import upsert_roster_entries

            upsert_roster_entries(roster_rows)
        except Exception as exc:
            print(f"[UniverseDiscovery] roster upsert skipped: {exc}", flush=True)
    return queued


def sync_discovery_snapshot_to_calendar_queue() -> dict[str, Any]:
    """
    Take the latest Discovery Feed snapshot and enqueue every non-rejected
    ticker into the Calendar work list (no Soft BUY). Safe to call from
    Calendar Refresh — does not re-run the EDGAR screener.
    """
    snap = load_snapshot()
    candidates = list(snap.get("candidates") or [])
    # Also pick up store rows that may not be in the last snapshot payload.
    store = load_store()
    by_cik = store.get("by_cik") or {}
    seen = {
        str(c.get("cik") or "").zfill(10)
        for c in candidates
        if str(c.get("cik") or "").isdigit()
    }
    for cik10, row in by_cik.items():
        if str(cik10).zfill(10) in seen:
            continue
        if str(row.get("status") or "") == "reviewed_rejected":
            continue
        candidates.append(
            {
                "cik": cik10,
                "ticker": row.get("ticker"),
                "company_name": row.get("company_name"),
                "sic_code": row.get("sic_code"),
                "matched_keywords": row.get("matched_keywords"),
                "signal_tier": row.get("signal_tier"),
                "first_seen_at": row.get("first_seen_at"),
                "source_filing_url": row.get("source_filing_url"),
                "status": row.get("status") or "new",
            }
        )
    queued = auto_enqueue_candidates_to_calendar(candidates)
    return {
        "ok": True,
        "snapshot_candidates": len(snap.get("candidates") or []),
        "queued": len(queued),
        "tickers": [q["ticker"] for q in queued],
        "queue_size": len(list_calendar_work()),
    }


def month_key(d: date | None = None) -> str:
    d = d or date.today()
    return f"{d.year:04d}-{d.month:02d}"


def load_schedule_marker() -> dict[str, Any]:
    return _load_json(_SCHEDULE_MARKER_PATH)


def mark_monthly_run(month: str | None = None) -> None:
    key = month or month_key()
    _save_json(
        _SCHEDULE_MARKER_PATH,
        {
            "last_monthly_month": key,
            "last_monthly_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def last_monthly_month() -> str | None:
    raw = load_schedule_marker().get("last_monthly_month")
    return str(raw) if raw else None


def should_run_universe_discovery_monthly(
    now: datetime,
    *,
    last_month: str | None = None,
    day: int | None = None,
    at_hhmm: str | None = None,
) -> bool:
    """
    True once on the N-th day of the month (default: 2nd) after ``at`` local time.

    No upper bound: if the API starts later on the 2nd, it still runs that day.
    ``last_month`` is ``YYYY-MM``; when omitted, reads the persistent marker.
    """
    from datetime import time as dt_time

    target_day = int(day if day is not None else DISCOVERY_MONTHLY_DAY)
    if now.day != target_day:
        return False
    key = month_key(now.date())
    prev = last_month if last_month is not None else last_monthly_month()
    if prev == key:
        return False
    raw = (at_hhmm or DISCOVERY_MONTHLY_AT or "07:30").strip()
    try:
        hh, mm = raw.split(":")
        at = dt_time(int(hh), int(mm))
    except Exception:
        at = dt_time(7, 30)
    now_m = now.hour * 60 + now.minute
    target_m = at.hour * 60 + at.minute
    return now_m >= target_m


def run_scheduled_universe_discovery() -> dict[str, Any]:
    """Monthly job entry-point used by the web host scheduler."""
    if get_status().get("running"):
        return {"ok": False, "error": "already_running"}
    result = run_universe_discovery_refresh()
    if result.get("ok"):
        mark_monthly_run()
        result["scheduled_month"] = month_key()
    return result
