#!/usr/bin/env python3
"""
Audit clinical / EIS feed gaps for all Simulation tickers (biotech + medtech).

Usage:
  py -3 scripts/audit_clinical_gaps_all.py
  py -3 scripts/audit_clinical_gaps_all.py --ticker CLRB
  py -3 scripts/audit_clinical_gaps_all.py --csv data_exports/clinical_gaps_audit.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from medtech_universe import CURATED_MEDTECH, MEDTECH_SYMBOLS_JSON, load_json_list  # noqa: E402

DATA = os.path.join(ROOT, "data")
CLINICAL_SIM = os.path.join(DATA, "clinical_simulation_snapshot.json")
PRE_CD = os.path.join(DATA, "clinical_pre_cd_enrichment_snapshot.json")
SIM_SNAP = os.path.join(DATA, "simulation_sheet_snapshot.json")


def _load_json(path: str) -> dict:
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return raw if isinstance(raw, dict) else {}


def _ticker_kind(tk: str, medtech: set[str]) -> str:
    return "medtech" if tk in medtech else "biotech"


def _assess_ticker(
    tk: str,
    *,
    pre_by: dict[str, list],
    clin_by: dict[str, list],
) -> dict:
    enrich = pre_by.get(tk, [])
    clin = clin_by.get(tk, [])
    has_nct = any(str(r.get("nct_id") or "").startswith("NCT") for r in clin)
    has_eis = any((r.get("clinical_events") or r.get("timeline_events")) for r in enrich)
    has_kpis = any(r.get("clinical_indicators") for r in enrich)
    has_enrich = bool(enrich)

    gaps: list[str] = []
    if not has_enrich:
        gaps.append("no_pre_cd_record")
    if has_enrich and not has_eis:
        gaps.append("no_eis_events")
    if has_enrich and not has_kpis:
        gaps.append("no_quantifiable_kpis")
    if not has_nct:
        gaps.append("no_nct_in_clinical_sim")

    # UI shows empty clinical panel when no EIS events (same as Evaluation Lab drawer)
    ui_empty = not has_eis or not has_kpis

    return {
        "ticker": tk,
        "has_enrich": has_enrich,
        "enrich_count": len(enrich),
        "clinical_sim_rows": len(clin),
        "has_nct": has_nct,
        "has_eis": has_eis,
        "has_kpis": has_kpis,
        "gaps": gaps,
        "ui_empty_clinical": ui_empty,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit clinical/EIS gaps for all Simulation tickers")
    ap.add_argument("--ticker", help="Single ticker filter")
    ap.add_argument("--csv", help="Write CSV report to path")
    ap.add_argument("--include-ok", action="store_true", help="Print tickers with full clinical data")
    args = ap.parse_args()

    medtech = set(load_json_list(MEDTECH_SYMBOLS_JSON)) | set(CURATED_MEDTECH)

    clinical_rows = _load_json(CLINICAL_SIM).get("rows") or []
    pre_cd_recs = _load_json(PRE_CD).get("records") or []
    sim_rows = _load_json(SIM_SNAP).get("rows") or []

    pre_by: dict[str, list] = defaultdict(list)
    for rec in pre_cd_recs:
        if not isinstance(rec, dict):
            continue
        tk = str(rec.get("ticker") or "").strip().upper()
        if tk:
            pre_by[tk].append(rec)

    clin_by: dict[str, list] = defaultdict(list)
    for row in clinical_rows:
        if not isinstance(row, dict):
            continue
        tk = str(row.get("ticker") or "").strip().upper()
        if tk:
            clin_by[tk].append(row)

    sim_tickers: list[str] = []
    for row in sim_rows:
        if not isinstance(row, dict):
            continue
        tk = str(row.get("Ticker") or row.get("ticker") or "").strip().upper()
        if tk and tk not in sim_tickers:
            sim_tickers.append(tk)

    if args.ticker:
        filt = args.ticker.strip().upper()
        sim_tickers = [t for t in sim_tickers if t == filt]

    print("=== Clinical / EIS gap audit (all Simulation tickers) ===\n")
    print(f"Simulation tickers: {len(sim_tickers)}")
    print(f"Medtech universe: {len(medtech)}")
    print(
        f"Snapshots: sim={os.path.isfile(SIM_SNAP)}  "
        f"clinical_sim={os.path.isfile(CLINICAL_SIM)}  "
        f"pre_cd={os.path.isfile(PRE_CD)}  "
        f"(pre_cd records={len(pre_cd_recs)})\n"
    )

    rows_out: list[dict] = []
    empty_ui: list[dict] = []
    ok_rows: list[dict] = []

    for tk in sorted(sim_tickers):
        info = _assess_ticker(tk, pre_by=pre_by, clin_by=clin_by)
        info["kind"] = _ticker_kind(tk, medtech)
        rows_out.append(info)
        if info["ui_empty_clinical"]:
            empty_ui.append(info)
        elif not info["gaps"]:
            ok_rows.append(info)

    print(f"--- UI-empty clinical (no EIS events or no KPIs): {len(empty_ui)} ---\n")
    for info in empty_ui:
        gaps_s = ", ".join(info["gaps"]) if info["gaps"] else "—"
        print(
            f"  {info['ticker']:6}  {info['kind']:8}  "
            f"enrich={info['enrich_count']}  clin_sim={info['clinical_sim_rows']}  "
            f"eis={info['has_eis']}  kpis={info['has_kpis']}  | {gaps_s}"
        )

    print(f"\n--- Fully populated: {len(ok_rows)} ---")
    if args.include_ok:
        for info in ok_rows:
            print(f"  {info['ticker']:6}  {info['kind']:8}  enrich={info['enrich_count']}")

    print("\n--- By sector ---")
    for kind in ("biotech", "medtech"):
        subset = [r for r in empty_ui if r["kind"] == kind]
        total = sum(1 for r in rows_out if r["kind"] == kind)
        print(f"  {kind}: {len(subset)}/{total} with empty clinical UI")

    if args.csv:
        os.makedirs(os.path.dirname(args.csv) or ".", exist_ok=True)
        fields = [
            "ticker",
            "kind",
            "ui_empty_clinical",
            "has_enrich",
            "enrich_count",
            "clinical_sim_rows",
            "has_nct",
            "has_eis",
            "has_kpis",
            "gaps",
        ]
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            for r in rows_out:
                w.writerow({**r, "gaps": ";".join(r["gaps"])})
        print(f"\nCSV written: {args.csv}")

    # Tickers in pre_cd but not in simulation (informational)
    orphan = sorted(set(pre_by) - set(sim_tickers))
    if orphan:
        print(f"\n--- Pre-CD records without Simulation row: {len(orphan)} (sample) ---")
        for tk in orphan[:15]:
            info = _assess_ticker(tk, pre_by=pre_by, clin_by=clin_by)
            print(f"  {tk:6}  enrich={info['enrich_count']}  eis={info['has_eis']}  kpis={info['has_kpis']}")
        if len(orphan) > 15:
            print(f"  ... +{len(orphan) - 15} more")

    if not os.path.isfile(PRE_CD):
        print("\nHint: refresh clinical pre-CD on VPS:")
        print("  py -3 launch_simulation_cd_scan.py")
        print("  curl -X POST http://HOST:8765/api/clinical-pre-cd/refresh?portfolio_only=1")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
