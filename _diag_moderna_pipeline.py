"""Diagnose Moderna / missed pipeline opportunities."""
from __future__ import annotations

import csv
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
TODAY = date(2026, 8, 19)
HORIZON_DAYS = 120


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


def is_exact_or_partial(sm: str | None) -> bool:
    v = str(sm or "").strip().lower()
    return v in ("exact", "partial")


def load_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def main() -> None:
    clin_path = DATA / "outputs" / "biotech_clinical_openfda.csv"
    if not clin_path.is_file():
        print("Missing", clin_path)
        return

    rows = load_csv(clin_path)
    print(f"Clinical CSV rows: {len(rows)}")

    # Moderna-related
    moderna_rows = []
    for row in rows:
        blob = " ".join(str(v) for v in row.values()).lower()
        if "modernatx" in blob or "moderna, inc" in blob or row.get("ticker", "").upper() == "MRNA":
            moderna_rows.append(row)

    print(f"\n=== Moderna-related trials: {len(moderna_rows)} ===")
    for row in moderna_rows:
        cd = row.get("primary_completion_date") or row.get("completion_date")
        d = parse_date(cd)
        days = (d - TODAY).days if d else None
        print(
            f"  ticker={row.get('ticker')} qc={row.get('query_company')} "
            f"sponsor={row.get('lead_sponsor')} match={row.get('sponsor_match')} "
            f"CD={cd} days={days} phase={row.get('phase')} "
            f"nct={row.get('nct_id') or row.get('nct')}"
        )

    # Simulation snapshot tickers
    sim_path = DATA / "simulation_sheet_snapshot.json"
    sim_tickers: set[str] = set()
    if sim_path.is_file():
        sim = json.loads(sim_path.read_text(encoding="utf-8"))
        for r in sim.get("rows") or []:
            t = str(r.get("Ticker") or "").strip().upper()
            if t and t.isascii() and len(t) <= 6:
                sim_tickers.add(t)
        print(f"\nSimulation sheet: {len(sim_tickers)} tickers, MRNA={'MRNA' in sim_tickers}")

    # Missed opportunities scan: Exact/Partial sponsor, CD in [-365, +120], not in sim
    horizon_past = 365
    horizon_future = HORIZON_DAYS
    missed: list[dict] = []
    reason_counts: dict[str, int] = {}

    fin_syms: set[str] = set()
    fin_path = DATA / "financial_sheet_snapshot.json"
    if fin_path.is_file():
        fin = json.loads(fin_path.read_text(encoding="utf-8"))
        for r in fin.get("rows") or []:
            s = str(r.get("symbol") or "").strip().upper()
            if s:
                fin_syms.add(s)

    yf_syms: set[str] = set()
    yf_path = DATA / "yf.json"
    if yf_path.is_file():
        yfd = json.loads(yf_path.read_text(encoding="utf-8"))
        for it in yfd:
            if isinstance(it, dict) and it.get("symbol"):
                yf_syms.add(str(it["symbol"]).strip().upper())

    for row in rows:
        cd_raw = row.get("primary_completion_date") or row.get("completion_date")
        d = parse_date(cd_raw)
        if not d:
            continue
        days = (d - TODAY).days
        if days < -horizon_past or days > horizon_future:
            continue

        tk = str(row.get("ticker") or "").strip().upper()
        sm = str(row.get("sponsor_match") or "")
        qc = str(row.get("query_company") or "")
        sponsor = str(row.get("lead_sponsor") or "")

        if tk in sim_tickers:
            continue

        if is_exact_or_partial(sm):
            reason = "exact_partial_not_in_sim"
            missed.append({**row, "_days": days, "_reason": reason})
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
            continue

        # Wrong ticker attribution: sponsor is a known biotech but ticker is another company
        if "modernatx" in sponsor.lower() and tk != "MRNA":
            reason = "sponsor_modernatx_wrong_ticker"
            missed.append({**row, "_days": days, "_reason": reason})
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
            continue

        if sm.lower() in ("no match", "n/d", ""):
            # Would-be if sponsor resolved
            if tk and tk not in fin_syms and tk not in yf_syms:
                reason = "no_match_ticker_not_in_financial"
            else:
                reason = "no_match_sponsor"
            if days <= 0:  # past CD — most relevant for "completed study missed"
                missed.append({**row, "_days": days, "_reason": reason})
                reason_counts[reason] = reason_counts.get(reason, 0) + 1

    print(f"\n=== Missed scan CD in [-{horizon_past}, +{horizon_future}] not in Simulation ===")
    print("Reason counts:", dict(sorted(reason_counts.items(), key=lambda x: -x[1])))

    # Top missed past CDs (completed recently)
    past = [m for m in missed if m["_days"] <= 0]
    past.sort(key=lambda x: x["_days"], reverse=True)
    print(f"\nPast CD missed (recent first): {len(past)}")
    for m in past[:25]:
        print(
            f"  [{m['_reason']}] {m.get('ticker')} {m.get('query_company')} "
            f"sponsor={m.get('lead_sponsor')} match={m.get('sponsor_match')} "
            f"CD={m.get('primary_completion_date')} days={m['_days']} phase={m.get('phase')}"
        )

    # Future Exact/Partial not in sim
    future_exact = [m for m in missed if m["_days"] > 0 and m["_reason"] == "exact_partial_not_in_sim"]
    future_exact.sort(key=lambda x: x["_days"])
    print(f"\nFuture Exact/Partial NOT in Simulation: {len(future_exact)}")
    for m in future_exact[:20]:
        print(
            f"  {m.get('ticker')} {m.get('query_company')} CD={m.get('primary_completion_date')} "
            f"days={m['_days']} phase={m.get('phase')}"
        )

    # Refined: Exact/Partial in financial universe but absent from Simulation
    from collections import Counter

    refined: list[tuple] = []
    for row in rows:
        sm = str(row.get("sponsor_match") or "").strip().lower()
        if sm not in ("exact", "partial"):
            continue
        cd_raw = row.get("primary_completion_date") or row.get("completion_date")
        d = parse_date(cd_raw)
        if not d:
            continue
        days = (d - TODAY).days
        if days < -horizon_past or days > horizon_future:
            continue
        tk = str(row.get("ticker") or "").strip().upper()
        if tk in sim_tickers:
            continue
        if tk not in fin_syms:
            continue
        bucket = "past_cd" if days <= 0 else "future_cd"
        refined.append(
            (bucket, days, tk, row.get("query_company"), row.get("lead_sponsor"), cd_raw, row.get("phase"), sm)
        )

    print(f"\n=== TRUE LEAKS: Exact/Partial + in financial_df + NOT in Simulation ===")
    print("Buckets:", Counter(b for b, *_ in refined))
    past_leaks = sorted([x for x in refined if x[0] == "past_cd"], key=lambda x: x[1], reverse=True)
    fut_leaks = sorted([x for x in refined if x[0] == "future_cd"], key=lambda x: x[1])
    print(f"Past CD leaks: {len(past_leaks)} (Catalyst Completati / retro cohort candidates)")
    for x in past_leaks[:20]:
        print(f"  {x[2]} {x[3]} sponsor={x[4]} CD={x[5]} days={x[1]} {x[6]} {x[7]}")
    print(f"Future CD leaks (≤120d): {len(fut_leaks)}")
    for x in fut_leaks[:20]:
        print(f"  {x[2]} {x[3]} sponsor={x[4]} CD={x[5]} days={x[1]} {x[6]} {x[7]}")

    # Sponsor is major pharma but ticker is wrong (collaborator trials)
    print("\n=== SPONSOR MISATTRIBUTION (lead sponsor ≠ query_company ticker) ===")
    big_sponsors = ("modernatx", "merck", "pfizer", "roche", "novartis", "gilead", "abbvie")
    misattrib = []
    for row in rows:
        sponsor = str(row.get("lead_sponsor") or "").lower()
        if not any(b in sponsor for b in big_sponsors):
            continue
        cd_raw = row.get("primary_completion_date") or row.get("completion_date")
        d = parse_date(cd_raw)
        if not d:
            continue
        days = (d - TODAY).days
        if days < -horizon_past or days > horizon_future:
            continue
        sm = str(row.get("sponsor_match") or "")
        if is_exact_or_partial(sm):
            continue
        misattrib.append((days, row.get("ticker"), row.get("query_company"), row.get("lead_sponsor"), cd_raw, row.get("phase")))
    misattrib.sort(key=lambda x: x[0], reverse=True)
    print(f"Count: {len(misattrib)}")
    for x in misattrib[:25]:
        print(f"  days={x[0]} tk={x[1]} qc={x[2]} sponsor={x[3]} CD={x[4]} {x[5]}")


if __name__ == "__main__":
    main()
