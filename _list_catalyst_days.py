"""Dump all catalyst-day rows currently present in local SuperNova data snapshots."""
from __future__ import annotations

import json
from collections import Counter
from datetime import date
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
OUT = Path(__file__).resolve().parent / "data_exports" / "catalyst_days_today.txt"


def load(name: str) -> dict | list:
    p = DATA / name
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


rows: list[dict] = []


def add(src: str, ticker, etype, when, prec="", conf="", extra="") -> None:
    tk = str(ticker or "").strip().upper()
    if not tk or "TOTALE" in tk:
        return
    rows.append(
        {
            "src": src,
            "ticker": tk,
            "type": str(etype or ""),
            "when": str(when or ""),
            "prec": str(prec or ""),
            "conf": str(conf or ""),
            "extra": str(extra or "")[:60],
        }
    )


# 1) SEC forward calendar
snap = load("catalyst_calendar_snapshot.json")
if isinstance(snap, dict):
    for e in snap.get("entries") or []:
        when = e.get("date_value") or e.get("window_label") or ""
        add(
            "SEC forward",
            e.get("ticker"),
            e.get("event_type"),
            when,
            e.get("date_precision"),
            e.get("confidence"),
            e.get("raw_snippet") or e.get("filing_date") or "",
        )

# 2) Guidance calendar
snap = load("guidance_calendar_snapshot.json")
if isinstance(snap, dict):
    for e in snap.get("events") or []:
        when = e.get("window_start") or e.get("window_end") or ""
        if not when:
            when = str(e.get("timing_quote") or "")[:40]
        add(
            "Guidance",
            e.get("ticker"),
            e.get("event_type"),
            when,
            "",
            e.get("confidence"),
            e.get("asset_name") or "",
        )

# 3) FDA AdCom
snap = load("fda_adcom_calendar_snapshot.json")
if isinstance(snap, dict):
    items = snap.get("rows") or snap.get("events") or snap.get("meetings") or []
    for e in items:
        if not isinstance(e, dict):
            continue
        tk = e.get("ticker") or e.get("Ticker") or e.get("sponsor_ticker")
        when = e.get("meeting_date") or e.get("date") or e.get("window_start") or ""
        add(
            "FDA AdCom",
            tk,
            "AdCom",
            when,
            "exact_date" if when else "",
            "",
            e.get("drug") or e.get("title") or e.get("sponsor") or "",
        )

# 4) Discovery near-catalyst sim bridge
snap = load("discovery_catalyst_sim_entries.json")
if isinstance(snap, dict):
    for e in snap.get("entries") or []:
        add(
            "Discovery→Sim",
            e.get("Ticker"),
            e.get("guidance_event_type") or "catalyst",
            e.get("Completion Date"),
            "exact_date",
            "",
            "auto ≤20d",
        )

# 5) Guidance catalyst sim entries
snap = load("catalyst_sim_entries.json")
if isinstance(snap, dict):
    for e in snap.get("entries") or []:
        add(
            "CatalystSim",
            e.get("Ticker"),
            e.get("guidance_event_type") or "catalyst",
            e.get("Completion Date"),
            "",
            "",
            e.get("Drug") or "",
        )


def sort_key(r: dict) -> tuple:
    w = r["when"]
    iso = w[:10] if len(w) >= 10 and w[4:5] == "-" else "9999-99-99"
    return (0 if iso[0].isdigit() else 1, iso, r["ticker"], r["src"], r["type"])


rows.sort(key=sort_key)
seen: set[tuple] = set()
uniq: list[dict] = []
for r in rows:
    k = (r["ticker"], r["type"].lower(), r["when"][:16], r["src"])
    if k in seen:
        continue
    seen.add(k)
    uniq.append(r)

today = date.today().isoformat()
lines = [
    f"Catalyst days in SuperNova — as of {today}",
    f"Total unique rows: {len(uniq)}",
    f"By source: {dict(Counter(r['src'] for r in uniq))}",
    "",
    f"{'WHEN':16} | {'TICKER':6} | {'TYPE':18} | {'SOURCE':14} | {'PREC':14} | EXTRA",
    "-" * 110,
]
for r in uniq:
    lines.append(
        f"{r['when'][:16]:16} | {r['ticker']:6} | {r['type'][:18]:18} | "
        f"{r['src']:14} | {r['prec'][:14]:14} | {r['extra']}"
    )

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines[:8]))
print(f"... wrote {len(uniq)} rows → {OUT}")
