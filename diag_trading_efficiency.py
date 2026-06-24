"""Measure (read-only) trading efficiency per lever: win-rate + P&L.

Frame (from the loop->output tracing): the prediction-curve learning loops barely
touch trading. The levers that actually move trades are:
  1. trade-calib slope_20d thresholds (BUY if slope>=+0.10, SELL if <=-0.30)
  2. the pred-magnitude gates (pred>=5% boosts timing, pred<3% -> HOLD)
  3. the affidabilita/confidence gate (conf>=75%)
  4. the SDS score tier (the real action/sizing arbiter) — now logged at entry
  5. the entry market regime (RISK_OFF/CRISIS -> HOLD gate) — now logged at entry

This script ONLY reads. It loads the persisted sim outcomes (falls back to an
in-memory build that does not persist) and reports, per lever bucket:
  n, win-rate, mean & median P&L%, total P&L EUR, and lift vs the whole book.

    .venv\\Scripts\\python.exe diag_trading_efficiency.py
"""
from __future__ import annotations

import statistics
from typing import Any


def _load_positions() -> list[dict[str, Any]]:
    from prediction.investment_sim_outcomes import (
        build_investment_sim_outcomes,
        read_investment_sim_outcomes,
    )

    doc = read_investment_sim_outcomes()
    rows = doc.get("rows") or []
    if not rows:
        doc = build_investment_sim_outcomes()  # no persist
        rows = doc.get("rows") or []
    return rows


def _agg(rows: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(rows)
    if n == 0:
        return {"n": 0}
    wins = sum(1 for r in rows if r.get("is_win"))
    pcts = [float(r["pnl_pct"]) for r in rows if r.get("pnl_pct") is not None]
    eurs = [float(r["pnl_eur"]) for r in rows if r.get("pnl_eur") is not None]
    dh = [bool(r["pred_direction_hit"]) for r in rows if r.get("pred_direction_hit") is not None]
    return {
        "n": n,
        "win_rate": round(wins / n, 3),
        "mean_pnl_pct": round(statistics.mean(pcts), 2) if pcts else None,
        "median_pnl_pct": round(statistics.median(pcts), 2) if pcts else None,
        "total_pnl_eur": round(sum(eurs), 0) if eurs else None,
        "dir_hit": round(sum(dh) / len(dh), 3) if dh else None,
    }


def _print_lever(title: str, buckets: list[tuple[str, list[dict[str, Any]]]], base: dict[str, Any]) -> None:
    print("\n" + "=" * 84)
    print(title)
    print("=" * 84)
    print(f"  {'bucket':28s} {'n':>5s} {'win%':>6s} {'meanP&L%':>9s} {'medP&L%':>8s} "
          f"{'totEUR':>9s} {'dirHit':>7s} {'win_lift':>9s}")
    for label, rows in buckets:
        a = _agg(rows)
        if a["n"] == 0:
            print(f"  {label:28s} {0:>5d}  (empty)")
            continue
        lift = a["win_rate"] - base["win_rate"] if base.get("win_rate") is not None else None
        print(f"  {label:28s} {a['n']:>5d} {100*a['win_rate']:>6.1f} "
              f"{(a['mean_pnl_pct'] if a['mean_pnl_pct'] is not None else float('nan')):>9.2f} "
              f"{(a['median_pnl_pct'] if a['median_pnl_pct'] is not None else float('nan')):>8.2f} "
              f"{(a['total_pnl_eur'] if a['total_pnl_eur'] is not None else float('nan')):>9.0f} "
              f"{(a['dir_hit'] if a['dir_hit'] is not None else float('nan')):>7.3f} "
              f"{(100*lift if lift is not None else float('nan')):>+8.1f}")


def main() -> None:
    rows = _load_positions()
    print("=" * 84)
    print(f"TRADING EFFICIENCY PER LEVER (read-only)   n_positions={len(rows)}")
    print("=" * 84)
    if not rows:
        print("No sim positions found (run on the machine that holds data/).")
        return
    base = _agg(rows)
    print(f"  WHOLE BOOK: win%={100*base['win_rate']:.1f}  mean P&L%={base['mean_pnl_pct']}  "
          f"median P&L%={base['median_pnl_pct']}  total EUR={base['total_pnl_eur']}  "
          f"dir_hit={base['dir_hit']}")

    def bget(r: dict[str, Any], *keys: str) -> float | None:
        for k in keys:
            v = r.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return None
        return None

    # ── Lever 1: trade-calib slope_20d (BUY threshold +0.10 pp/day) ──────────
    s_neg, s_flat, s_buy = [], [], []
    for r in rows:
        s = bget(r, "entry_slope_20d", "pre_cd_slope_20d", "latest_slope_20d")
        if s is None:
            continue
        (s_buy if s >= 0.10 else s_flat if s >= 0.0 else s_neg).append(r)
    _print_lever(
        "LEVER 1 — trade-calib slope_20d (BUY rule: slope >= +0.10)",
        [("slope_20d < 0 (falling)", s_neg),
         ("0 <= slope < 0.10 (flat)", s_flat),
         ("slope >= 0.10 (BUY signal)", s_buy)],
        base,
    )

    # ── Lever 2: pred-magnitude gates (3% HOLD gate, 5% timing boost) ────────
    p_dn, p_lo, p_mid, p_hi = [], [], [], []
    for r in rows:
        p = bget(r, "entry_pred5_pp", "pred5_pp")
        if p is None:
            continue
        ap = abs(p)
        (p_dn if p < 0 else p_lo if ap < 3 else p_mid if ap < 5 else p_hi).append(r)
    _print_lever(
        "LEVER 2 — pred5 magnitude gates (|pred|<3 = HOLD gate, |pred|>=5 = timing boost)",
        [("pred5 < 0 (down call)", p_dn),
         ("0 <= |pred5| < 3 (gated out)", p_lo),
         ("3 <= |pred5| < 5", p_mid),
         ("|pred5| >= 5 (boost tier)", p_hi)],
        base,
    )

    # ── Lever 3: affidabilita / confidence gate (75%) ───────────────────────
    a_lo, a_hi = [], []
    for r in rows:
        a = bget(r, "affidabilita_pct", "entry_affidabilita_pct")
        if a is None:
            continue
        (a_hi if a >= 75 else a_lo).append(r)
    _print_lever(
        "LEVER 3 — affidabilita/confidence gate (conf >= 75%)",
        [("affidabilita < 75%", a_lo), ("affidabilita >= 75%", a_hi)],
        base,
    )

    # ── Lever 4: SDS score tier (the real action/sizing arbiter) ────────────
    # Now measurable: entry_sds_score is logged in the decision log (and current
    # SDS is attached to live positions). FULL size at SDS>=75, else HALF.
    sds_rows = [r for r in rows if bget(r, "entry_sds_score", "sds_score") is not None]
    if sds_rows:
        d_lo, d_mid, d_hi = [], [], []
        for r in sds_rows:
            v = bget(r, "entry_sds_score", "sds_score") or 0.0
            (d_hi if v >= 75 else d_mid if v >= 50 else d_lo).append(r)
        _print_lever(
            "LEVER 4 — SDS score tier (entry; FULL size >=75)",
            [("SDS < 50", d_lo), ("50 <= SDS < 75 (HALF)", d_mid),
             ("SDS >= 75 (FULL)", d_hi)],
            base,
        )
    else:
        print("\nLEVER 4 — SDS score tier: no positions carry entry_sds_score yet.")
        print("  (will populate on the next sim rebuild after this logging change)")

    # ── Lever 5: entry market regime (RISK_OFF/CRISIS -> HOLD gate) ──────────
    reg_rows = [r for r in rows if (r.get("entry_regime") or r.get("market_regime"))]
    if reg_rows:
        by_reg: dict[str, list[dict[str, Any]]] = {}
        for r in reg_rows:
            reg = str(r.get("entry_regime") or r.get("market_regime"))
            by_reg.setdefault(reg, []).append(r)
        _print_lever(
            "LEVER 5 — entry market regime",
            sorted(by_reg.items(), key=lambda kv: -len(kv[1])),
            base,
        )
    else:
        print("\nLEVER 5 — entry market regime: no positions carry entry_regime yet.")
        print("  (will populate on the next sim rebuild after this logging change)")

    # ── Signal QA already computed by the sim (BUY/SELL result tallies) ──────
    print("\n" + "=" * 84)
    print("BUY/SELL signal QA (as computed by the sim's trade-calib thresholds)")
    print("=" * 84)
    for side in ("buy", "sell"):
        tally: dict[str, int] = {}
        for r in rows:
            res = r.get(f"{side}_signal_result")
            if res and res != "not_applicable":
                tally[res] = tally.get(res, 0) + 1
        total = sum(tally.values())
        print(f"  {side.upper()}: {dict(sorted(tally.items()))}  (n_applicable={total})")


if __name__ == "__main__":
    main()
