#!/usr/bin/env python3
"""Detailed clinical gap reasons (portfolio_only, work_list, etc.)."""
from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from clinical_pre_cd_enrichment import (  # noqa: E402
    _build_work_list,
    _enrichment_scope_ticker_set,
    _portfolio_ticker_set,
)
from medtech_universe import CURATED_MEDTECH, MEDTECH_SYMBOLS_JSON, load_json_list  # noqa: E402

DATA = os.path.join(ROOT, "data")


def main() -> int:
    med = set(load_json_list(MEDTECH_SYMBOLS_JSON)) | set(CURATED_MEDTECH)
    scope = _enrichment_scope_ticker_set()
    pt = _portfolio_ticker_set()
    work = {w["ticker"] for w in _build_work_list()}

    with open(os.path.join(DATA, "simulation_sheet_snapshot.json"), encoding="utf-8") as fh:
        sim = json.load(fh)
    with open(os.path.join(DATA, "clinical_pre_cd_enrichment_snapshot.json"), encoding="utf-8") as fh:
        precd = json.load(fh)

    pre_by: dict[str, list] = defaultdict(list)
    for r in precd.get("records") or []:
        tk = str(r.get("ticker") or "").upper()
        if tk:
            pre_by[tk].append(r)

    sim_tks: list[str] = []
    for r in sim.get("rows") or []:
        tk = str(r.get("Ticker") or r.get("ticker") or "").strip().upper()
        if tk and tk not in sim_tks:
            sim_tks.append(tk)

    print("Enrichment scope (Simulation + portfolio):", ", ".join(sorted(scope)))
    print("Portfolio-only positions:", ", ".join(sorted(pt)))
    print()
    print(f"{'Ticker':6} {'Kind':8} {'Status':6} {'Reason':24} enrich in_scope in_work")
    rows = []
    for tk in sorted(sim_tks):
        if tk == "TOTALE PORTAFOGLIO":
            continue
        enrich = pre_by.get(tk, [])
        has_eis = any((r.get("clinical_events") or r.get("timeline_events")) for r in enrich)
        has_kpis = any(r.get("clinical_indicators") for r in enrich)
        kind = "medtech" if tk in med else "biotech"
        if has_eis and has_kpis:
            status, reason = "OK", "ok"
        elif not enrich:
            if tk not in work:
                status, reason = "GAP", "not_in_work_list"
            elif tk not in scope:
                status, reason = "GAP", "outside_scope"
            else:
                status, reason = "GAP", "not_enriched_yet"
        elif not has_eis:
            status, reason = "GAP", "enrich_no_eis"
        else:
            status, reason = "GAP", "enrich_no_kpis"
        rows.append((tk, kind, status, reason, len(enrich), tk in pt, tk in work))
        print(
            f"{tk:6} {kind:8} {status:6} {reason:24} {len(enrich):6} "
            f"{str(tk in scope):9} {str(tk in work)}"
        )

    print()
    c = Counter((kind, reason) for _, kind, status, reason, *_ in rows if status == "GAP")
    print("Gap reasons by kind:")
    for (kind, reason), n in sorted(c.items()):
        print(f"  {kind} / {reason}: {n}")

    ok = sum(1 for *_, status, _, _, _, _, _ in [(*r,) for r in rows] if False)
    ok = sum(1 for r in rows if r[2] == "OK")
    gap = sum(1 for r in rows if r[2] == "GAP")
    print(f"\nSummary: {ok} OK, {gap} GAP out of {len(rows)} simulation tickers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
