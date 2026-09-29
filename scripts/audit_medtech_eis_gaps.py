#!/usr/bin/env python3
"""
Cross-check medtech tickers in Simulation vs clinical pre-CD enrichment (EIS feed gaps).

Usage:
  py -3 scripts/audit_medtech_eis_gaps.py
  py -3 scripts/audit_medtech_eis_gaps.py --ticker CERS
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from medtech_universe import (  # noqa: E402
    CURATED_MEDTECH,
    MEDTECH_SYMBOLS_JSON,
    discover_ctgov_sponsor_studies,
    load_json_list,
)

DATA = os.path.join(ROOT, "data")
CLINICAL_SIM = os.path.join(DATA, "clinical_simulation_snapshot.json")
PRE_CD = os.path.join(DATA, "clinical_pre_cd_enrichment_snapshot.json")
SIM_SNAP = os.path.join(DATA, "simulation_sheet_snapshot.json")


def _load_json(path: str) -> dict:
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _parse_iso(raw: str) -> date | None:
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit medtech EIS / clinical feed gaps")
    ap.add_argument("--ticker", help="Single ticker (e.g. CERS)")
    ap.add_argument("--horizon", type=int, default=120, help="CD horizon days")
    args = ap.parse_args()

    med = set(load_json_list(MEDTECH_SYMBOLS_JSON)) | set(CURATED_MEDTECH)
    if args.ticker:
        med = {args.ticker.strip().upper()} & med

    clinical_rows = (_load_json(CLINICAL_SIM).get("rows") or [])
    pre_cd_recs = (_load_json(PRE_CD).get("records") or [])
    sim_rows = (_load_json(SIM_SNAP).get("rows") or [])

    pre_by_tk: dict[str, list] = {}
    for rec in pre_cd_recs:
        if not isinstance(rec, dict):
            continue
        tk = str(rec.get("ticker") or "").strip().upper()
        if tk:
            pre_by_tk.setdefault(tk, []).append(rec)

    clinical_by_tk: dict[str, list] = {}
    for row in clinical_rows:
        if not isinstance(row, dict):
            continue
        tk = str(row.get("ticker") or "").strip().upper()
        if tk:
            clinical_by_tk.setdefault(tk, []).append(row)

    sim_by_tk: dict[str, dict] = {}
    for row in sim_rows:
        if not isinstance(row, dict):
            continue
        tk = str(row.get("Ticker") or row.get("ticker") or "").strip().upper()
        if tk and tk not in sim_by_tk:
            sim_by_tk[tk] = row

    today = date.today()
    horizon = today.toordinal() + args.horizon

    _, ctgov_rows = discover_ctgov_sponsor_studies(horizon_days=args.horizon)
    ctgov_by_tk: dict[str, list] = {}
    for r in ctgov_rows:
        tk = str(r.get("ticker") or "").strip().upper()
        if tk:
            ctgov_by_tk.setdefault(tk, []).append(r)

    print("=== MedTech EIS / clinical feed gap audit ===\n")
    print(f"Medtech universe: {len(med)} tickers")
    print(f"Snapshots: clinical_sim={os.path.isfile(CLINICAL_SIM)}  pre_cd={os.path.isfile(PRE_CD)}  sim={os.path.isfile(SIM_SNAP)}\n")

    gaps = []
    for tk in sorted(med):
        sim = sim_by_tk.get(tk)
        clin = clinical_by_tk.get(tk, [])
        enrich = pre_by_tk.get(tk, [])
        ctgov = ctgov_by_tk.get(tk, [])

        cd_sim = None
        if sim:
            cd_raw = str(sim.get("Completion Date") or sim.get("completion_date") or "")
            for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
                try:
                    cd_sim = datetime.strptime(cd_raw[:10], fmt).date()
                    break
                except ValueError:
                    continue

        has_nct_clinical = any(str(r.get("nct_id") or "").startswith("NCT") for r in clin)
        has_eis_events = any(
            (r.get("clinical_events") or r.get("timeline_events"))
            for r in enrich
        )
        has_kpis = any(r.get("clinical_indicators") for r in enrich)

        issue = []
        if sim and not has_nct_clinical:
            issue.append("no NCT in clinical_simulation")
        if sim and not enrich:
            issue.append("no pre_cd enrichment record")
        if enrich and not has_eis_events:
            issue.append("enrichment without EIS events")
        if enrich and not has_kpis:
            issue.append("no quantifiable KPIs")
        if ctgov and not sim:
            issue.append(f"CT.gov CD≤{args.horizon}d but not in Simulation")

        if issue or args.ticker:
            gaps.append((tk, issue, cd_sim, len(ctgov), len(enrich)))
            flag = " [!]" if issue else " [ok]"
            cd_s = cd_sim.isoformat() if cd_sim else "—"
            print(
                f"{flag} {tk:6}  sim_cd={cd_s}  ctgov={len(ctgov)}  "
                f"clinical_rows={len(clin)}  enrich={len(enrich)}"
            )
            if issue:
                print(f"         gaps: {', '.join(issue)}")
            if ctgov:
                for r in ctgov[:2]:
                    print(
                        f"         CT.gov {r.get('nct_id')} T-{r.get('days_to_cd')}d "
                        f"{(r.get('brief_title') or '')[:60]}"
                    )

    print(f"\n--- Summary: {len(gaps)} tickers reviewed, "
          f"{sum(1 for _, iss, *_ in gaps if iss)} with gaps ---")
    if not os.path.isfile(PRE_CD):
        print("\nHint: run clinical pre-CD refresh on VPS after CD scan:")
        print("  py -3 launch_simulation_cd_scan.py")
        print("  curl -X POST http://HOST:8765/api/clinical-pre-cd/refresh?portfolio_only=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
