#!/usr/bin/env python3
"""
Audit opportunità pipeline perse: catalyst clinici con sponsor Exact/Partial o
lead_sponsor risolvibile via SEC, assenti dal foglio Simulation.

Esporta CSV in data_exports/pipeline_missed_opportunities.csv

Uso:
  py scripts/audit_pipeline_missed_opportunities.py
  py scripts/audit_pipeline_missed_opportunities.py --past-days 365 --future-days 120
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_orchestrator import (  # noqa: E402
    _load_sec_cik_map,
    _resolve_lead_sponsor_sec_ticker,
)

DATA = ROOT / "data"
EXPORT = ROOT / "data_exports"
DEFAULT_TODAY = date.today()


def parse_date(s: str | None) -> date | None:
    if not s or str(s).strip().lower() in ("", "nan", "none"):
        return None
    s = str(s).strip()
    if len(s) == 7 and s[4] == "-":
        s += "-01"
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def load_json_rows(path: Path, sym_key: str) -> set[str]:
    if not path.is_file():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("rows") if isinstance(data, dict) else data
    out: set[str] = set()
    if not isinstance(rows, list):
        return out
    for r in rows:
        if not isinstance(r, dict):
            continue
        s = str(r.get(sym_key) or r.get("Ticker") or "").strip().upper()
        if s:
            out.add(s)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit pipeline missed opportunities")
    ap.add_argument("--today", default=DEFAULT_TODAY.isoformat())
    ap.add_argument("--past-days", type=int, default=365)
    ap.add_argument("--future-days", type=int, default=120)
    ap.add_argument("--out", default=str(EXPORT / "pipeline_missed_opportunities.csv"))
    args = ap.parse_args()
    today = date.fromisoformat(args.today)

    clin_path = DATA / "outputs" / "biotech_clinical_openfda.csv"
    if not clin_path.is_file():
        print(f"Missing {clin_path}")
        return 1

    with clin_path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    sim_tickers = load_json_rows(DATA / "simulation_sheet_snapshot.json", "Ticker")
    fin_syms = load_json_rows(DATA / "financial_sheet_snapshot.json", "symbol")
    yf_syms: set[str] = set()
    yf_path = DATA / "yf.json"
    if yf_path.is_file():
        yfd = json.loads(yf_path.read_text(encoding="utf-8"))
        if isinstance(yfd, list):
            for it in yfd:
                if isinstance(it, dict) and it.get("symbol"):
                    yf_syms.add(str(it["symbol"]).strip().upper())

    _, sec_nt = _load_sec_cik_map()

    out_rows: list[dict] = []
    reason_counts: Counter[str] = Counter()

    for row in rows:
        cd_raw = row.get("primary_completion_date") or row.get("completion_date")
        d = parse_date(cd_raw)
        if not d:
            continue
        days = (d - today).days
        if days < -args.past_days or days > args.future_days:
            continue

        tk = str(row.get("ticker") or "").strip().upper()
        sm = str(row.get("sponsor_match") or "").strip()
        sm_l = sm.lower()
        sponsor = str(row.get("lead_sponsor") or "")
        nct = str(row.get("nct_id") or row.get("nct") or "")

        if tk in sim_tickers:
            continue

        bucket = "past_cd" if days <= 0 else "future_cd"
        sec_tk = _resolve_lead_sponsor_sec_ticker(sponsor, sec_nt) if sec_nt else None

        reason = ""
        effective_tk = tk

        if sm_l in ("exact", "partial"):
            if tk in fin_syms:
                reason = "exact_partial_in_financial_not_in_sim"
            else:
                reason = "exact_partial_ticker_not_in_financial"
        elif sec_tk and sec_tk != tk:
            effective_tk = sec_tk
            if sec_tk in fin_syms:
                reason = "sec_sponsor_resolvable_in_financial_not_in_sim"
            else:
                reason = "sec_sponsor_resolvable_not_in_financial"
        elif sm_l in ("no match", "n/d", ""):
            if tk and tk not in fin_syms and tk not in yf_syms:
                reason = "no_match_ticker_not_in_universe"
            else:
                reason = "no_match_sponsor"
        else:
            reason = "other"

        if not reason:
            continue

        reason_counts[reason] += 1
        out_rows.append(
            {
                "reason": reason,
                "bucket": bucket,
                "days_to_cd": days,
                "ticker_csv": tk,
                "ticker_sec_resolved": sec_tk or "",
                "effective_ticker": effective_tk,
                "in_financial": effective_tk in fin_syms or tk in fin_syms,
                "in_yf": effective_tk in yf_syms or tk in yf_syms,
                "query_company": row.get("query_company", ""),
                "lead_sponsor": sponsor,
                "sponsor_match": sm,
                "primary_completion_date": cd_raw,
                "phase": row.get("phase", ""),
                "nct_id": nct,
            }
        )

    out_rows.sort(key=lambda r: (r["reason"], r["days_to_cd"]))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(out_rows[0].keys()) if out_rows else [
        "reason", "bucket", "days_to_cd", "ticker_csv", "ticker_sec_resolved",
        "effective_ticker", "in_financial", "in_yf", "query_company",
        "lead_sponsor", "sponsor_match", "primary_completion_date", "phase", "nct_id",
    ]
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(out_rows)

    print(f"Clinical rows scanned: {len(rows)}")
    print(f"Simulation tickers: {len(sim_tickers)}  |  financial: {len(fin_syms)}  |  yf: {len(yf_syms)}")
    print(f"MRNA in sim={('MRNA' in sim_tickers)} fin={('MRNA' in fin_syms)} yf={('MRNA' in yf_syms)}")
    print(f"\nMissed opportunities (CD [{-args.past_days}, +{args.future_days}d], not in Simulation): {len(out_rows)}")
    print("By reason:")
    for k, v in reason_counts.most_common():
        print(f"  {k}: {v}")

    actionable = [
        r for r in out_rows
        if r["reason"] in (
            "exact_partial_in_financial_not_in_sim",
            "sec_sponsor_resolvable_in_financial_not_in_sim",
        )
    ]
    print(f"\nActionable leaks (in financial, fixable via sim cohort): {len(actionable)}")
    sec_moderna = [r for r in out_rows if r["ticker_sec_resolved"] == "MRNA"]
    print(f"ModernaTX → MRNA rows: {len(sec_moderna)}")
    for r in sec_moderna[:8]:
        print(
            f"  [{r['reason']}] csv={r['ticker_csv']} CD={r['primary_completion_date']} "
            f"days={r['days_to_cd']} fin={r['in_financial']}"
        )

    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
