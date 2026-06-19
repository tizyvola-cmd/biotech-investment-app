"""
Report post-refresh feed clinico / EIS — alimenta popup UI dopo scheduler mattutino.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

REPORT_PATH = Path(DATA_DIR) / "clinical_feed_refresh_report.json"
ACK_PATH = Path(DATA_DIR) / "clinical_feed_refresh_ack.json"


def _event_eis_score(ev: dict[str, Any]) -> float | None:
    eis = ev.get("eis")
    if isinstance(eis, dict):
        sc = eis.get("score")
        if sc is not None:
            try:
                return float(sc)
            except (TypeError, ValueError):
                return None
    return None


def _record_eis_summary(rec: dict[str, Any]) -> dict[str, Any]:
    events = list(rec.get("clinical_events") or rec.get("timeline_events") or [])
    scored = [e for e in events if isinstance(e, dict) and _event_eis_score(e) is not None]
    top = max(scored, key=lambda e: _event_eis_score(e) or 0.0, default=None)
    headline = ""
    if isinstance(rec.get("ai"), dict):
        headline = str(rec["ai"].get("headline") or "").strip()
    if not headline and top:
        headline = str(top.get("title") or top.get("headline") or "").strip()
    source_link = ""
    source_link_label = ""
    if top:
        source_link = str(top.get("link") or "").strip()
        source_link_label = str(top.get("link_label") or "").strip()
    ai_summary = ""
    if isinstance(rec.get("ai"), dict):
        ai_summary = str(rec["ai"].get("summary") or rec["ai"].get("headline") or "").strip()
    return {
        "event_count": len(events),
        "eis_event_count": len(scored),
        "top_eis": _event_eis_score(top) if top else None,
        "headline": headline[:160],
        "ai_summary": ai_summary[:240],
        "source_link": source_link[:500],
        "source_link_label": source_link_label[:80],
        "ai_ok": bool(rec.get("ai_ok")),
    }


def diff_clinical_feed_records(
    prev_records: list[dict[str, Any]],
    new_records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Righe nuove o con eventi/EIS aggiornati rispetto allo snapshot precedente."""
    from clinical_pre_cd_enrichment import feed_lookup_key

    prev_by: dict[str, dict[str, Any]] = {}
    for rec in prev_records:
        if not isinstance(rec, dict):
            continue
        fk = feed_lookup_key(rec)
        if fk:
            prev_by[fk] = rec

    changes: list[dict[str, Any]] = []
    for rec in new_records:
        if not isinstance(rec, dict):
            continue
        fk = feed_lookup_key(rec)
        if not fk:
            continue
        ticker = str(rec.get("ticker") or "").strip().upper()
        cd = str(rec.get("cd_date") or "")[:10]
        new_sum = _record_eis_summary(rec)
        prev = prev_by.get(fk)
        if not prev:
            if new_sum["event_count"] > 0 or new_sum["ai_ok"]:
                changes.append(
                    {
                        "kind": "new",
                        "ticker": ticker,
                        "cd": cd,
                        "feed_key": fk,
                        **new_sum,
                    }
                )
            continue
        prev_sum = _record_eis_summary(prev)
        if (
            new_sum["event_count"] != prev_sum["event_count"]
            or new_sum["eis_event_count"] != prev_sum["eis_event_count"]
            or new_sum["top_eis"] != prev_sum["top_eis"]
            or (new_sum["ai_ok"] and not prev_sum["ai_ok"])
        ):
            changes.append(
                {
                    "kind": "updated",
                    "ticker": ticker,
                    "cd": cd,
                    "feed_key": fk,
                    **new_sum,
                }
            )
    changes.sort(key=lambda c: (c.get("ticker") or "", c.get("cd") or ""))
    return changes


def write_refresh_report(
    *,
    run_type: str,
    stats: dict[str, Any],
    changes: list[dict[str, Any]],
    ai_provider: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    ts = datetime.now(timezone.utc).isoformat()
    report: dict[str, Any] = {
        "finished_at": ts,
        "run_type": run_type,
        "success": error is None,
        "error": error,
        "stats": stats,
        "changes": changes,
        "change_count": len(changes),
        "ai_provider": ai_provider or {},
        "report_id": ts,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = REPORT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(REPORT_PATH)
    return report


def load_refresh_report() -> dict[str, Any] | None:
    if not REPORT_PATH.is_file():
        return None
    try:
        doc = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def load_ack() -> dict[str, Any] | None:
    if not ACK_PATH.is_file():
        return None
    try:
        doc = json.loads(ACK_PATH.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def save_ack(report_id: str) -> None:
    ACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    ACK_PATH.write_text(
        json.dumps(
            {
                "report_id": report_id,
                "acked_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def should_show_report(report: dict[str, Any] | None) -> bool:
    if not report or not report.get("success"):
        return False
    if int(report.get("change_count") or 0) <= 0:
        return False
    rid = str(report.get("report_id") or report.get("finished_at") or "")
    if not rid:
        return False
    ack = load_ack()
    if ack and str(ack.get("report_id") or "") == rid:
        return False
    return True
