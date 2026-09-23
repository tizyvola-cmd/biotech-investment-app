#!/usr/bin/env python3
"""SELL W27 audit + directional hit diagnosis."""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

REC_FLAT = 1.0


def load(name: str):
    p = DATA / name
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def iso_week(s: str | None) -> str | None:
    if not s or len(s) < 10:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00")[:19])
    except ValueError:
        try:
            d = datetime.strptime(s[:10], "%Y-%m-%d")
        except ValueError:
            return None
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def sell_hit(r: dict) -> bool | None:
    res = r.get("sell_signal_result")
    if res == "success":
        return True
    if res == "failure":
        return False
    return None


def fmt_pct(n: float | None) -> str:
    if n is None:
        return "n/a"
    return f"{100 * n:.1f}%"


def audit_sell(rows: list[dict]) -> None:
    print("=" * 72)
    print("SELL DIRECTIONAL FOLLOW-THROUGH (sell_signal_result)")
    print("=" * 72)
    print(
        "Metric: after exit, did price DROP (success) or RISE (failure)? "
        "Graded on ALL closed sim positions with sell_signal_result."
    )
    print(
        "NOTE: learning_loop_weekly_impact W26/W27 stores CUMULATIVE headline at "
        "snapshot time — NOT isolated to trades closed that week.\n"
    )

    sell_rows = [
        r
        for r in rows
        if r.get("sell_signal_result") not in (None, "not_applicable", "")
    ]
    graded = [r for r in sell_rows if sell_hit(r) is not None]
    hits = sum(1 for r in graded if sell_hit(r))
    print(f"Total sell-graded: {len(graded)} / {len(sell_rows)} exits")
    print(f"Overall down-hit: {hits}/{len(graded)} = {fmt_pct(hits / len(graded) if graded else None)}")

    by_reason: dict[str, list] = defaultdict(list)
    for r in graded:
        reason = r.get("exit_reason") or "capital_removed"
        by_reason[reason].append(r)

    print("\n--- BY EXIT REASON ---")
    for reason in sorted(by_reason, key=lambda k: -len(by_reason[k])):
        rs = by_reason[reason]
        h = sum(1 for r in rs if sell_hit(r))
        print(f"  {reason:20s} n={len(rs):3d}  down-hit={fmt_pct(h / len(rs))}")

    by_week: dict[str, list] = defaultdict(list)
    for r in graded:
        wk = iso_week(r.get("exit_ts") or r.get("entry_ts"))
        if wk:
            by_week[wk].append(r)

    print("\n--- BY EXIT ISO WEEK (positions closed that week) ---")
    for wk in sorted(by_week)[-8:]:
        rs = by_week[wk]
        h = sum(1 for r in rs if sell_hit(r))
        fails = [r for r in rs if sell_hit(r) is False]
        print(f"  {wk}: n={len(rs):2d}  down-hit={fmt_pct(h / len(rs))}")
        for r in sorted(fails, key=lambda x: x.get("ticker", "")):
            move = r.get("sell_signal_after_move_pct")
            print(
                f"      FAIL {r.get('ticker','?'):5s}  "
                f"exit={str(r.get('exit_ts',''))[:10]}  "
                f"after_move={move}%  reason={r.get('exit_reason')}  "
                f"pnl={r.get('pnl_pct')}%"
            )

    print("\n--- ALL GRADED SELL ROWS (ticker table) ---")
    print(f"{'Ticker':6s} {'Exit':10s} {'Wk':8s} {'Result':8s} {'AfterMv%':9s} {'Reason':18s} {'Pnl%':7s}")
    for r in sorted(graded, key=lambda x: (x.get("exit_ts") or "", x.get("ticker", ""))):
        print(
            f"{str(r.get('ticker','?')):6s} "
            f"{str(r.get('exit_ts',''))[:10]:10s} "
            f"{iso_week(r.get('exit_ts')) or 'n/a':8s} "
            f"{str(r.get('sell_signal_result','')):8s} "
            f"{str(r.get('sell_signal_after_move_pct','')):>9s} "
            f"{str(r.get('exit_reason','')):18s} "
            f"{r.get('pnl_pct','')}"
        )

    # Simulate cumulative headline evolution (order by exit_ts)
    print("\n--- CUMULATIVE down-hit % AFTER EACH NEW GRADED EXIT ---")
    ordered = sorted(
        graded,
        key=lambda x: (x.get("exit_ts") or x.get("entry_ts") or "", x.get("ticker", "")),
    )
    wins = 0
    for i, r in enumerate(ordered, 1):
        if sell_hit(r):
            wins += 1
        rate = wins / i
        if i >= len(ordered) - 8 or i in (10, 20, 30, 40, 50):
            flag = " <-- W27 snapshot zone" if iso_week(r.get("exit_ts")) == "2026-W27" else ""
            print(
                f"  after #{i:2d} ({r.get('ticker')} exit {str(r.get('exit_ts',''))[:10]}): "
                f"{fmt_pct(rate)} ({wins}/{i}){flag}"
            )
    print(f"  final: {fmt_pct(wins / len(ordered))} ({wins}/{len(ordered)})")


def audit_directional() -> None:
    print("\n" + "=" * 72)
    print("DIRECTIONAL HIT (accuracy_directional_calibration.json)")
    print("=" * 72)
    cal = load("accuracy_directional_calibration.json")
    print(f"Generated: {cal.get('generated_at')}")
    print(f"Records affid>0: {cal.get('records_aff_gt0')}")
    print()
    print("KPI layers (matched horizon dir_v4_tN vs dN_pct):")
    print(f"  hit_global (incl. Stabile):     {cal.get('hit_global')}%")
    print(f"  hit_directional (up/down only):   {cal.get('hit_directional')}%  n={cal.get('n_directional')}")
    print(f"  useful_hit (aff>=50, |act|>=2): {cal.get('useful_hit_pct')}%  n={cal.get('useful_n_directional')}")
    print(f"  strong_hit (aff>=50, |act|>=3): {cal.get('strong_hit_pct')}%  n={cal.get('strong_n_directional')}")
    print(f"  noise_zone (<1% move):          {cal.get('noise_zone_hit_pct')}%  n={cal.get('noise_zone_n')}")

    ph = cal.get("per_horizon") or {}
    if ph:
        print("\n--- PER HORIZON (directional only) ---")
        for h, block in ph.items():
            raw = block.get("raw") or {}
            useful = block.get("useful") or {}
            print(
                f"  {h}: raw {raw.get('hit_pct')}% (n={raw.get('n')})  "
                f"useful {useful.get('hit_pct')}% (n={useful.get('n')})"
            )

    aff = cal.get("calibration_by_affid") or cal.get("by_affid") or {}
    if aff:
        print("\n--- BY AFFID BAND (directional) ---")
        for band, block in aff.items():
            if isinstance(block, dict):
                print(
                    f"  {band}: dir hit {block.get('hit_pct_directional')}% "
                    f"(n={block.get('n_directional')})"
                )

    # Sign curve pre-CD (separate from directional calibration)
    try:
        sc = load("model_sign_curve_daily.json")
        sim = sc.get("simulation") or sc.get("cohorts", {}).get("simulation") or {}
        sign_hit = sim.get("overall_sign_hit_pre_cd_pct") or sc.get("overall_sign_hit_pre_cd_pct")
        print(f"\nPre-CD sign hit (model_sign_curve_daily): {sign_hit}%")
    except Exception:
        pass

    hist = load("model_accuracy_monitor_history.json")
    entries = hist.get("entries") or []
    print("\n--- model_accuracy_monitor_history (acc_v4_pct — different metric!) ---")
    for e in entries[-6:]:
        print(
            f"  {str(e.get('run_iso',''))[:10]}  acc_v4={e.get('acc_v4_pct')}%  "
            f"retro={e.get('acc_v4_retro_pct')}%  n={e.get('n_evaluable_ok_v4')}"
        )

    weekly = load("learning_loop_weekly_impact.json").get("weeks", {})
    print("\n--- learning_loop pre_cd_sign_hit (weekly snapshot) ---")
    for wk in sorted(weekly)[-4:]:
        p = weekly[wk].get("prediction") or {}
        r = weekly[wk].get("recommendation") or {}
        print(
            f"  {wk}: pred_sign={p.get('pre_cd_sign_hit_pct')}%  "
            f"sell_down={r.get('sell_down_hit_pct')}% (n={r.get('sell_n')})  "
            f"buy_up={r.get('buy_up_hit_pct')}%"
        )

    print("\n--- WHY hit_directional (~48%) LOOKS LOW vs hit_global (~77%) ---")
    print(
        "  1. hit_global counts Stabile (->) hits when |actual|<5% - inflates headline."
    )
    print(
        "  2. hit_directional is ONLY up/down labels vs sign(actual) - harder metric."
    )
    print(
        "  3. useful_hit (~65%) filters noise (|actual|>=2%, aff>=50) - closer to 'solid'."
    )
    print(
        "  4. acc_v4_pct (~64%) is yet another population (evaluable ok v4 pool)."
    )
    print(
        "  5. W27 sell_down drop is NOT pre-CD prediction - it's post-exit price path."
    )


def main() -> None:
    outcomes = load("investment_sim_outcomes.json")
    rows = outcomes.get("rows", outcomes)
    audit_sell(rows)
    audit_directional()


if __name__ == "__main__":
    main()
