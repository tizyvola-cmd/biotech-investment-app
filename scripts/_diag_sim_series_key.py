"""Diag: per ogni ticker del foglio Simulation, qual è la series key e c'e' match nel bundle?"""
from __future__ import annotations
import io
import json
import re
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

snap = json.loads(Path("data/simulation_sheet_snapshot.json").read_text(encoding="utf-8"))
bundle = json.loads(Path("data/simulation_charts_snapshot.json").read_text(encoding="utf-8"))
series_keys = set(bundle.get("series", {}).keys())

def parse_sheet_date_to_iso(s: str) -> str | None:
    s = s.strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    return None

rows = snap.get("rows", [])
print(f"Totale righe Simulation: {len(rows)}")
print(f"Totale serie nel bundle: {len(series_keys)}")
print()

target_tickers = {"OLMA", "BCAB", "BNTX", "PBYI"}
for r in rows:
    tk = str(r.get("Ticker", "")).strip().upper()
    if tk not in target_tickers:
        continue
    cd_raw = str(r.get("Completion Date", "")).strip()
    iso = parse_sheet_date_to_iso(cd_raw)
    key = f"co:{tk}|{iso}" if iso else None
    in_bundle = key in series_keys if key else False
    print(f"  {tk:<6}  CD_raw={cd_raw!r:<14}  iso={iso!r:<12}  key={key!r:<24}  bundle_match={in_bundle}")
    if not in_bundle and key:
        candidates = [k for k in series_keys if k.startswith(f"co:{tk}|")]
        print(f"      → candidati nel bundle per {tk}: {candidates}")
