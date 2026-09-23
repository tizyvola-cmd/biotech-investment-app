#!/usr/bin/env python3
"""Audit all trade-efficiency scores from local data/*.json snapshots."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load(name: str):
    p = DATA / name
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def bucket_pplan(p: float | None) -> str:
    if p is None:
        return "n/a"
    if p < 30:
        return "<30"
    if p < 50:
        return "30-50"
    if p < 70:
        return "50-70"
    return ">=70"


def win_band(pnl: float) -> bool:
    return pnl > -2


def win_strict(pnl: float) -> bool:
    return pnl > 0


def chunk_stats(rows: list[dict], label: str) -> None:
    if not rows:
        print(f"  {label}: n=0")
        return
    pnls = [r["pnl_pct"] for r in rows]
    wb = sum(1 for p in pnls if win_band(p))
    ws = sum(1 for p in pnls if win_strict(p))
    print(
        f"  {label}: n={len(rows):2d}  win(-2%)={100 * wb / len(rows):5.1f}%  "
        f"win(>0)={100 * ws / len(rows):5.1f}%  avg_pnl={mean(pnls):+.1f}%"
    )


def parse_pct(x) -> float | None:
    if x in (None, "", "—"):
        return None
    try:
        return float(str(x).replace(",", "."))
    except ValueError:
        return None


def main() -> None:
    print("=" * 72)
    print("SUPERNOVA SCORE / TRADE EFFICIENCY AUDIT")
    print("=" * 72)

    for name in [
        "investment_sim_outcomes.json",
        "investment_trade_calib.json",
        "model_calibration_state.json",
        "invest_sim_inputs.json",
        "investment_decision_cohort_history.json",
        "learning_loop_weekly_impact.json",
        "accuracy_directional_calibration.json",
        "model_accuracy_monitor_history.json",
    ]:
        p = DATA / name
        if p.exists():
            ts = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            print(f"  {name}: mtime={ts}  bytes={p.stat().st_size}")

    raw = load("investment_sim_outcomes.json")
    rows = raw.get("rows", raw) if isinstance(raw, dict) else raw
    if isinstance(rows, dict):
        rows = rows.get("rows", [])
    resolved = [r for r in rows if r.get("pnl_pct") is not None]

    print(f"\n--- CLOSED SIM OUTCOMES (Calibration Center corpus) n={len(resolved)} ---")
    chunk_stats(resolved, "ALL")
    resolved_sorted = sorted(
        resolved, key=lambda r: r.get("completion_date") or r.get("closed_at") or ""
    )
    mid = len(resolved_sorted) // 2
    if mid:
        chunk_stats(resolved_sorted[:mid], "Older half (chronological)")
        chunk_stats(resolved_sorted[mid:], "Recent half (chronological)")

    print("\n--- WIN RATE BY COMPLETION MONTH ---")
    by_month: dict[str, list[float]] = defaultdict(list)
    for r in resolved:
        cd = r.get("completion_date") or r.get("closed_at") or ""
        mk = cd[:7] if cd else "unknown"
        by_month[mk].append(r["pnl_pct"])
    for mk in sorted(by_month):
        rs = by_month[mk]
        wb = sum(1 for p in rs if win_band(p))
        ws = sum(1 for p in rs if win_strict(p))
        print(
            f"  {mk}: n={len(rs):2d}  win(-2%)={100 * wb / len(rs):5.1f}%  "
            f"win(>0)={100 * ws / len(rs):5.1f}%  avg={mean(rs):+.1f}%"
        )

    print("\n--- P(plan) BUCKET (entry affidabilita) ---")
    by_bucket: dict[str, list[float]] = defaultdict(list)
    for r in resolved:
        p = r.get("entry_affidabilita_pct") or r.get("affidabilita_pct")
        by_bucket[bucket_pplan(p)].append(r["pnl_pct"])
    for b in ["<30", "30-50", "50-70", ">=70", "n/a"]:
        rs = by_bucket.get(b, [])
        if not rs:
            continue
        wb = sum(1 for p in rs if win_band(p))
        ws = sum(1 for p in rs if win_strict(p))
        print(
            f"  {b:6s} n={len(rs):3d}  win(-2%)={100 * wb / len(rs):5.1f}%  "
            f"win(>0)={100 * ws / len(rs):5.1f}%  avg={mean(rs):+6.1f}%"
        )

    print("\n--- WORST 12 CLOSED TRADES ---")
    for r in sorted(resolved, key=lambda x: x["pnl_pct"])[:12]:
        pplan = r.get("entry_affidabilita_pct") or r.get("affidabilita_pct")
        print(
            f"  {str(r.get('ticker', '?')):5s}  cd={str(r.get('completion_date', '?')):10s}  "
            f"pnl={r['pnl_pct']:+7.2f}%  eur={float(r.get('pnl_eur') or 0):+8.0f}  "
            f"pplan={pplan}"
        )

    trade_calib = load("investment_trade_calib.json")
    if trade_calib:
        print("\n--- investment_trade_calib.json ---")
        print(json.dumps(trade_calib, indent=2, ensure_ascii=False)[:2500])

    learning = load("learning_loop_weekly_impact.json")
    if learning:
        print("\n--- learning_loop_weekly_impact.json ---")
        print(json.dumps(learning, indent=2, ensure_ascii=False)[:2000])

    acc_dir = load("accuracy_directional_calibration.json")
    if acc_dir:
        print("\n--- accuracy_directional_calibration.json (summary) ---")
        if isinstance(acc_dir, dict):
            for k in ["overall", "summary", "hitRate", "hit_rate", "accuracy", "n"]:
                if k in acc_dir:
                    print(f"  {k}: {acc_dir[k]}")
            # print top-level keys
            print(f"  keys: {list(acc_dir.keys())[:15]}")

    # Real portfolio (nested invest_sim_inputs.inputs)
    raw_inputs = load("invest_sim_inputs.json") or {}
    inputs = raw_inputs.get("inputs", raw_inputs) if isinstance(raw_inputs, dict) else {}
    sim = load("simulation_sheet_snapshot.json") or {}
    sim_rows = {
        str(r.get("Ticker", "")).upper(): r for r in sim.get("rows", [])
    }
    open_pos = {
        k: v
        for k, v in inputs.items()
        if isinstance(v, dict) and float(v.get("capital") or 0) > 0 and not v.get("soldAt")
    }
    print(f"\n--- OPEN REAL PORTFOLIO n={len(open_pos)} ---")
    neg24 = pos24 = neg_tot = pos_tot = 0
    cap_neg24 = cap_pos = 0.0
    for key, ent in sorted(open_pos.items()):
        tk = key.split("|")[0].upper()
        sr = sim_rows.get(tk, {})
        var = sr.get("Var. Giorn. %") or sr.get("Var. Giorn.%")
        tot = sr.get("Var.% totale") or sr.get("Var. % totale")
        cap = float(ent.get("capital") or 0)

        v24 = parse_pct(var)
        vt = parse_pct(tot)
        if v24 is not None:
            pos24 += 1
            cap_pos += cap
            if v24 < 0:
                neg24 += 1
                cap_neg24 += cap
        if vt is not None:
            pos_tot += 1
            if vt < 0:
                neg_tot += 1
        print(
            f"  {tk:5s}  cap={cap:6.0f}  var24h={v24 if v24 is not None else 'n/a':>7}  "
            f"varTot={vt if vt is not None else 'n/a':>7}"
        )
    if pos24:
        print(
            f"  Book 24h: {neg24}/{pos24} tickers red  "
            f"({100 * neg24 / pos24:.0f}% names, {100 * cap_neg24 / cap_pos:.0f}% capital weighted)"
        )
    if pos_tot:
        print(f"  Book MTM: {neg_tot}/{pos_tot} tickers underwater on total var%")
    if open_pos:
        pnl24 = pnl_tot = 0.0
        cap_sum = sum(float(v.get("capital") or 0) for v in open_pos.values())
        for key, ent in open_pos.items():
            tk = key.split("|")[0].upper()
            sr = sim_rows.get(tk, {})
            v24 = parse_pct(sr.get("Var. Giorn. %") or sr.get("Var. Giorn.%"))
            vt = parse_pct(sr.get("Var.% totale") or sr.get("Var. % totale"))
            c = float(ent.get("capital") or 0)
            pnl24 += c * (v24 or 0) / 100
            pnl_tot += c * (vt or 0) / 100
        print(
            f"  Aggregate open book: 24h P&L={pnl24:+.0f}€ ({100 * pnl24 / cap_sum:+.2f}%)  "
            f"MTM={pnl_tot:+.0f}€ ({100 * pnl_tot / cap_sum:+.2f}%)  cap={cap_sum:.0f}€"
        )

    closed_real = [
        (k, v)
        for k, v in inputs.items()
        if isinstance(v, dict) and v.get("soldAt")
    ]
    if closed_real:
        wins = sum(1 for _, v in closed_real if float(v.get("closedPnlEur") or 0) > 0)
        losses = sum(1 for _, v in closed_real if float(v.get("closedPnlEur") or 0) < 0)
        total_pnl = sum(float(v.get("closedPnlEur") or 0) for _, v in closed_real)
        print(f"\n--- REAL PORTFOLIO CLOSED n={len(closed_real)} ---")
        print(
            f"  Win={wins}  Loss={losses}  Win%={100 * wins / len(closed_real):.1f}%  "
            f"Total P&L={total_pnl:+.0f}€"
        )
        print("  Last 8 closes:")
        for k, v in sorted(closed_real, key=lambda x: x[1].get("soldAt", ""))[-8:]:
            print(
                f"    {k.split('|')[0]:5s}  pnl={float(v.get('closedPnlEur') or 0):+7.0f}€  "
                f"sold={str(v.get('soldAt', ''))[:10]}"
            )

    # Cohort history trend if present
    hist = load("investment_decision_cohort_history.json")
    if hist and isinstance(hist, list) and len(hist) >= 2:
        print(f"\n--- COHORT HISTORY snapshots n={len(hist)} ---")
        for snap in hist[-5:]:
            if not isinstance(snap, dict):
                continue
            ts = snap.get("ts") or snap.get("updated_at") or snap.get("date")
            wr = snap.get("winRate") or snap.get("win_rate") or snap.get("winRatePct")
            n = snap.get("n") or snap.get("sampleSize")
            print(f"  {ts}: winRate={wr} n={n}")


if __name__ == "__main__":
    main()
