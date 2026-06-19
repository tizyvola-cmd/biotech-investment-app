"""
Cluster E — catalyst timing events from on-disk Supernova feeds (no new APIs).

Sources: catalyst_feed_snapshot (8-K), simulation CD row, analyst grades metadata.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from prediction.sds.catalyst_readout import load_catalyst_events

CATALYST_TYPE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "clinical_readout": (
        "completion_date",
        "primary_endpoint",
        "data_readout",
        "topline",
        "clinical trial",
        "phase ",
        "efficacy",
        "primary endpoint",
    ),
    "regulatory": (
        "pdufa",
        "fda decision",
        "nda",
        "bla",
        "breakthrough_therapy",
        "fast_track",
        "fda",
        "regulatory",
    ),
    "conference": (
        "asco",
        "esmo",
        "ash",
        "aacr",
        "acc",
        "presentation",
        "poster",
        "oral",
        "conference",
    ),
    "financial": (
        "offering",
        "private_placement",
        "partnership",
        "licensing",
        "milestone",
        "financing",
        "equity",
    ),
    "publication": (
        "nejm",
        "lancet",
        "jama",
        "nature",
        "peer_reviewed",
        "publication",
        "published",
    ),
    "analyst_event": (
        "analyst_day",
        "investor_day",
        "key_opinion_leader",
        "kol",
        "upgrade",
        "initiated",
        "analyst",
    ),
}


def _parse_date(raw: Any) -> date | None:
    if not raw:
        return None
    s = str(raw).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _event_description(ev: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("items_label", "items_raw", "headline", "summary"):
        val = ev.get(key)
        if val:
            parts.append(str(val))
    extracted = ev.get("extracted")
    if isinstance(extracted, dict):
        for key in ("headline", "summary", "primary_endpoint", "efficacy", "results"):
            val = extracted.get(key)
            if val:
                parts.append(str(val))
    return " ".join(parts).lower()


def classify_event_type(description: str) -> str | None:
    text = description.lower()
    if not text.strip():
        return None
    for cat_type, keywords in CATALYST_TYPE_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return cat_type
    return None


def get_events_in_window(
    ticker: str,
    *,
    days: int = 90,
    sim_row: dict[str, Any] | None = None,
    analyst_meta: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Collect catalyst-like events in the rolling ``days`` window."""
    tk = ticker.upper()
    today = date.today()
    window_start = today - timedelta(days=int(days))
    events: list[dict[str, Any]] = []

    for ev in load_catalyst_events():
        if str(ev.get("ticker") or "").upper() != tk:
            continue
        fd = _parse_date(ev.get("filing_date"))
        if fd is None or fd < window_start:
            continue
        desc = _event_description(ev)
        events.append(
            {
                "description": desc,
                "date": fd.isoformat(),
                "source": "8-K",
                "form_type": ev.get("form_type"),
            }
        )

    sim = sim_row or {}
    po = sim.get("Primary Outcome") or sim.get("primary_outcome")
    if po:
        events.append(
            {
                "description": f"primary endpoint {po}".lower(),
                "date": today.isoformat(),
                "source": "simulation",
            }
        )

    am = analyst_meta or {}
    for grade in am.get("all_grades_60d") or am.get("analyst_events_60d") or []:
        if not isinstance(grade, dict):
            continue
        gd = _parse_date(grade.get("date"))
        if gd is not None and gd < window_start:
            continue
        firm = grade.get("firm") or ""
        action = grade.get("action") or ""
        events.append(
            {
                "description": f"analyst {action} {firm}".lower(),
                "date": (gd or today).isoformat(),
                "source": "analyst_grade",
            }
        )

    return events


def classify_catalyst_types(
    events: list[dict[str, Any]],
    *,
    days_to_cd: int | None = None,
) -> tuple[list[str], int]:
    types_present: set[str] = set()
    for ev in events:
        desc = str(ev.get("description") or "")
        cat = classify_event_type(desc)
        if cat:
            types_present.add(cat)

    if days_to_cd is not None and 0 < int(days_to_cd) <= 90:
        types_present.add("clinical_readout")

    ordered = sorted(types_present)
    return ordered, len(events)


def collect_cluster_e(
    ticker: str,
    *,
    days_to_cd: int | None = None,
    cd_date: str | None = None,
    sim_row: dict[str, Any] | None = None,
    analyst_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    events = get_events_in_window(
        ticker,
        days=90,
        sim_row=sim_row,
        analyst_meta=analyst_meta,
    )
    types, n_events = classify_catalyst_types(events, days_to_cd=days_to_cd)
    return {
        "ticker": ticker.upper(),
        "cd_date": cd_date,
        "days_to_cd": days_to_cd,
        "catalyst_types": types,
        "catalyst_events_90d": events[:30],
        "events_detected": n_events,
    }


__all__ = [
    "CATALYST_TYPE_KEYWORDS",
    "classify_catalyst_types",
    "classify_event_type",
    "collect_cluster_e",
    "get_events_in_window",
]
