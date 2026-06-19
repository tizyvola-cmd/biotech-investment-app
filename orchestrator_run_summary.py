"""
Riepilogo run orchestrator (domenica / full): durata, fine, nuovi ticker e nuove CD
Exact/Partial con relazione sponsor–company ristretta.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from orchestrator_io_paths import DATA_DIR, FINAL_XLSX

ORCHESTRATOR_RUN_SUMMARY_JSON = os.path.join(DATA_DIR, "orchestrator_run_summary.json")

_RESTRICTED_REL = frozenset({
    "direct sponsor",
    "collaborator",
    "correlated company/subsidiary",
    "subsidiary",
})

_SESSION: dict[str, Any] = {}


def _stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _norm_rel(v: object) -> str:
    s = str(v or "").strip().lower().replace("·", " ")
    return " ".join(s.split())


def _norm_sm(v: object) -> str:
    s = str(v or "").strip().lower()
    if s in ("exact", "partial"):
        return s.capitalize()
    return str(v or "").strip()


def _harvest_key(r: dict) -> str | None:
    try:
        tk = str(r.get("ticker") or "").strip().upper()
        if not tk:
            return None
        cd = r.get("completion_date")
        if cd is None:
            return None
        if hasattr(cd, "isoformat"):
            cd_s = cd.isoformat()[:10]
        else:
            cd_s = str(cd).strip()[:10]
        if len(cd_s) < 8:
            return None
        return f"{tk}|{cd_s}"
    except Exception:
        return None


def _cohort_row_ok(r: dict) -> bool:
    sm = _norm_sm(r.get("sponsor_match")).lower()
    if sm not in ("exact", "partial"):
        return False
    rel = _norm_rel(r.get("nct_relation_type"))
    if not rel or rel in ("n/d", "nd", "—", "-", "none", "nan", "n/a", "na", "null"):
        return False
    return rel in _RESTRICTED_REL


def _entry_from_row(r: dict, key: str) -> dict[str, str]:
    cd = r.get("completion_date")
    if hasattr(cd, "isoformat"):
        cd_s = cd.isoformat()[:10]
    else:
        cd_s = str(cd or "").strip()[:10]
    company = (
        str(r.get("companyName") or r.get("name") or r.get("query_company") or "")
        .strip()
    )
    sponsor = str(
        r.get("lead_sponsor")
        or r.get("partial_source")
        or r.get("sponsor")
        or ""
    ).strip()
    return {
        "key": key,
        "ticker": str(r.get("ticker") or "").strip().upper(),
        "completion_date": cd_s,
        "sponsor_match": _norm_sm(r.get("sponsor_match")),
        "nct_relation_type": str(r.get("nct_relation_type") or "").strip(),
        "partial_type": str(r.get("partial_type") or "").strip(),
        "company": company,
        "sponsor": sponsor,
        "nct_id": str(r.get("nct_id") or r.get("NCT") or "").strip().upper(),
    }


def load_last_summary() -> dict[str, Any] | None:
    if not os.path.isfile(ORCHESTRATOR_RUN_SUMMARY_JSON):
        return None
    try:
        with open(ORCHESTRATOR_RUN_SUMMARY_JSON, encoding="utf-8") as fh:
            doc = json.load(fh)
        return doc if isinstance(doc, dict) else None
    except Exception:
        return None


def _load_previous_keys() -> set[str]:
    prev = load_last_summary()
    if not prev:
        return set()
    keys = prev.get("simulation_keys")
    if isinstance(keys, list):
        return {str(k) for k in keys if k}
    return set()


def begin_orchestrator_run(profile: str = "weekly_full") -> None:
    _SESSION.clear()
    _SESSION.update({
        "profile": profile,
        "started_at": _iso_now(),
        "started_at_display": _stamp(),
        "new_tickers_discovery": [],
        "new_tickers_extra": [],
    })


def record_discovery_tickers(tickers: list[str]) -> None:
    if not tickers:
        return
    seen = set(_SESSION.get("new_tickers_discovery") or [])
    for t in tickers:
        u = str(t).strip().upper()
        if u and u not in seen:
            seen.add(u)
            _SESSION.setdefault("new_tickers_discovery", []).append(u)


def record_extra_config_tickers(tickers: list[str]) -> None:
    if not tickers:
        return
    seen = set(_SESSION.get("new_tickers_extra") or [])
    for t in tickers:
        u = str(t).strip().upper()
        if u and u not in seen:
            seen.add(u)
            _SESSION.setdefault("new_tickers_extra", []).append(u)


def record_simulation_cohort(sim_rows: list[dict] | None) -> None:
    """Calcola nuove coppie ticker|CD vs ultimo summary (solo Exact/Partial + rel. ristretta)."""
    prev_keys = _load_previous_keys()
    current_keys: set[str] = set()
    cohort_entries: list[dict] = []
    new_entries: list[dict] = []

    for r in sim_rows or []:
        if not isinstance(r, dict):
            continue
        key = _harvest_key(r)
        if not key:
            continue
        current_keys.add(key)
        if not _cohort_row_ok(r):
            continue
        ent = _entry_from_row(r, key)
        cohort_entries.append(ent)
        if key not in prev_keys:
            new_entries.append(ent)

    _SESSION["simulation_keys"] = sorted(current_keys)
    _SESSION["cohort_entries_count"] = len(cohort_entries)
    _SESSION["new_catalyst_rows"] = new_entries


def format_summary_message(doc: dict[str, Any], *, lang: str = "it") -> str:
    """Testo compatto per status file / popup."""
    it = lang == "it"
    ok = bool(doc.get("ok"))
    finished = doc.get("finished_at_display") or doc.get("finished_at") or "—"
    started = doc.get("started_at_display") or doc.get("started_at") or "—"
    elapsed = int(doc.get("elapsed_sec") or 0)
    m, s = divmod(max(0, elapsed), 60)
    dur = f"{m}m {s:02d}s" if m else f"{s}s"

    lines: list[str] = []
    if ok:
        lines.append(
            f"Orchestrator completato alle {finished} (durata {dur}, avvio {started})."
            if it
            else f"Orchestrator finished at {finished} (duration {dur}, started {started})."
        )
    else:
        lines.append(
            f"Orchestrator terminato con errori alle {finished} (durata {dur})."
            if it
            else f"Orchestrator ended with errors at {finished} (duration {dur})."
        )

    disc = doc.get("new_tickers_discovery") or []
    extra = doc.get("new_tickers_extra") or []
    ipo = doc.get("new_tickers_ipo") or []
    all_new = sorted(set(disc) | set(extra) | set(ipo))
    if all_new:
        preview = ", ".join(all_new[:12])
        if len(all_new) > 12:
            preview += f" (+{len(all_new) - 12})"
        lines.append(
            f"Nuovi ticker biotech: {len(all_new)} — {preview}"
            if it
            else f"New biotech tickers: {len(all_new)} — {preview}"
        )
    else:
        lines.append(
            "Nessun nuovo ticker nell'universo (discovery/extra)."
            if it
            else "No new tickers in universe (discovery/extra)."
        )

    new_cd = doc.get("new_catalyst_rows") or []
    if new_cd:
        lines.append(
            f"Nuove CD registrate (Exact/Partial, rel. diretta/collab./subsidiary): {len(new_cd)}"
            if it
            else f"New catalyst dates (Exact/Partial, direct/collab./subsidiary rel.): {len(new_cd)}"
        )
        for ent in new_cd[:8]:
            tk = ent.get("ticker", "?")
            cd = ent.get("completion_date", "?")
            sm = ent.get("sponsor_match", "?")
            rel = ent.get("nct_relation_type", "?")
            co = (ent.get("company") or "")[:28]
            sp = (ent.get("sponsor") or "")[:28]
            lines.append(f"  · {tk} CD {cd} — {sm} · {rel} · {co} ↔ {sp}")
        if len(new_cd) > 8:
            lines.append(f"  … +{len(new_cd) - 8} altre" if it else f"  … +{len(new_cd) - 8} more")
    else:
        lines.append(
            "Nessuna nuova coppia ticker|CD in coorte rispetto al run precedente."
            if it
            else "No new ticker|CD pairs in cohort vs previous run."
        )

    staged = doc.get("staged_workbook")
    if staged:
        lines.append(f"Staged: {os.path.basename(staged)}")
    return " ".join(lines)


def finalize_orchestrator_run(
    *,
    ok: bool,
    elapsed_sec: float,
    staged_workbook: str | None = None,
    exit_code: int = 0,
    error: str | None = None,
) -> dict[str, Any]:
    """Scrive JSON + aggiorna refresh_fast_status con messaggio leggibile."""
    finished = datetime.now()
    started_iso = _SESSION.get("started_at")
    started_display = _SESSION.get("started_at_display") or _stamp()
    try:
        if started_iso:
            started_dt = datetime.fromisoformat(started_iso)
            elapsed_sec = max(0, int((finished - started_dt).total_seconds()))
    except Exception:
        elapsed_sec = max(0, int(elapsed_sec))

    doc: dict[str, Any] = {
        "profile": _SESSION.get("profile") or "weekly_full",
        "ok": ok,
        "exit_code": exit_code,
        "error": error or "",
        "started_at": started_iso or finished.isoformat(timespec="seconds"),
        "started_at_display": started_display,
        "finished_at": finished.isoformat(timespec="seconds"),
        "finished_at_display": _stamp(),
        "elapsed_sec": int(elapsed_sec),
        "workbook": os.path.abspath(FINAL_XLSX),
        "staged_workbook": staged_workbook or "",
        "new_tickers_discovery": list(_SESSION.get("new_tickers_discovery") or []),
        "new_tickers_extra": list(_SESSION.get("new_tickers_extra") or []),
        "new_tickers_ipo": list(_SESSION.get("new_tickers_ipo") or []),
        "simulation_keys": list(_SESSION.get("simulation_keys") or []),
        "cohort_entries_count": int(_SESSION.get("cohort_entries_count") or 0),
        "new_catalyst_rows": list(_SESSION.get("new_catalyst_rows") or []),
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(ORCHESTRATOR_RUN_SUMMARY_JSON, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)

    msg = format_summary_message(doc, lang="it")
    doc["message"] = msg
    try:
        from refresh_fast_status import write_refresh_fast_status

        write_refresh_fast_status(
            state="ok" if ok else "error",
            ok=ok,
            message=msg,
            workbook=FINAL_XLSX,
            staged_workbook=staged_workbook,
        )
    except Exception:
        pass

    _SESSION.clear()
    return doc
