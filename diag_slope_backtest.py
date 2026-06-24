"""Walk-forward backtest of the slope_20d BUY/SELL trade rule (read-only).

Why: the live rule (BUY if slope_20d >= +0.10, SELL if <= -0.30) is calibrated
by investment_trade_calib on ~40 closed trades, with a POSITIVE-ONLY grid and an
IN-SAMPLE threshold pick. On 40 trades the contrarian "buy falling" bucket beat
the momentum BUY signal. This script tests the rule honestly on the full event
pool (~thousands), out-of-sample, with a FREE grid (negative thresholds and BOTH
polarities allowed), so we can see whether the rule survives deployment.

Data join (read-only, writes nothing):
  - entry feature: pre-CD slope_20d from histlib (T-1..T-10 snapshot),
    via investment_sim_outcomes._build_slope_indices.
  - outcome (forward move %): the realized post-CD move from
    cluster_cal_factor.collect_resolved_outcomes_from_sources (signal scatter +
    past_pred d{N}_pct), keyed by TICKER|CD + node.

P&L proxy = the realized catalyst move % (long = +move, short/sell = -move).
This is the cleanest available proxy; it is the same outcome pool the model is
graded on. Sign of the move = win/lose for the chosen side.

    .venv\\Scripts\\python.exe diag_slope_backtest.py
"""
from __future__ import annotations

import statistics
from typing import Any, Callable

from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources
from prediction.investment_sim_outcomes import _build_slope_indices, _load_histlib

# One node per event to avoid correlated duplicates; prefer this horizon.
PREFERRED_NODES = ("T+5", "T+10", "T+3", "T+7", "T+1")


def _build_events() -> list[dict[str, Any]]:
    """Join outcomes to pre-CD slope_20d. One row per (ticker, CD), best node."""
    histlib = _load_histlib()
    _latest, at_cd = _build_slope_indices(histlib)
    if not at_cd:
        return []

    # at_cd is keyed by the raw histlib key "TICKER|CD..."; index by (ticker, cd-prefix).
    slope_by_tk_cd: dict[tuple[str, str], float] = {}
    for key, blob in at_cd.items():
        parts = str(key).split("|", 1)
        tk = parts[0].strip().upper()
        cd = (blob.get("asof") or "")[:10]
        # asof is the pre-CD trade date; also index by the CD embedded in the key.
        cd_key = parts[1].strip()[:10] if len(parts) > 1 else cd
        s20 = blob.get("slope_20d")
        if s20 is None:
            continue
        if cd_key:
            slope_by_tk_cd[(tk, cd_key)] = float(s20)

    outcomes = collect_resolved_outcomes_from_sources()

    # pick one outcome per (ticker, cd) by preferred node
    best_by_event: dict[tuple[str, str], dict[str, Any]] = {}
    node_rank = {n: i for i, n in enumerate(PREFERRED_NODES)}
    for o in outcomes:
        raw_tk = str(o.get("ticker") or "")
        tk = raw_tk.split("|", 1)[0].strip().upper()
        cd = str(o.get("date") or "")[:10]
        node = str(o.get("node") or "")
        act = o.get("actual")
        if not tk or not cd or act is None:
            continue
        ev = (tk, cd)
        prev = best_by_event.get(ev)
        if prev is None or node_rank.get(node, 99) < node_rank.get(prev["node"], 99):
            best_by_event[ev] = {"ticker": tk, "cd": cd, "node": node, "actual": float(act)}

    events: list[dict[str, Any]] = []
    for ev, row in best_by_event.items():
        s20 = slope_by_tk_cd.get(ev)
        if s20 is None:
            continue
        row["slope_20d"] = s20
        events.append(row)
    events.sort(key=lambda r: r["cd"])
    return events


def _corr(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 1e-12 or syy <= 1e-12:
        return None
    return sxy / (sxx ** 0.5 * syy ** 0.5)


def _seg_stats(rows: list[dict[str, Any]], *, side: str) -> dict[str, Any]:
    """side='long' wins if move>0; side='short' wins if move<0. P&L = signed move."""
    if not rows:
        return {"n": 0}
    pnl = [r["actual"] if side == "long" else -r["actual"] for r in rows]
    wins = sum(1 for p in pnl if p > 0)
    n = len(rows)
    return {
        "n": n,
        "win_rate": round(wins / n, 3),
        "mean_pnl": round(statistics.mean(pnl), 2),
        "median_pnl": round(statistics.median(pnl), 2),
        "total_pnl": round(sum(pnl), 1),
    }


def _grid_pick(
    train: list[dict[str, Any]],
    *,
    rule: Callable[[float, float], bool],
    grid: list[float],
    side: str,
    min_n: int,
) -> tuple[float, dict[str, Any]]:
    """Pick threshold maximizing TRAIN mean P&L among triggered (>=min_n)."""
    best_t, best = grid[0], {"n": 0, "mean_pnl": float("-inf")}
    for t in grid:
        trig = [r for r in train if rule(r["slope_20d"], t)]
        if len(trig) < min_n:
            continue
        st = _seg_stats(trig, side=side)
        if st["mean_pnl"] > best["mean_pnl"]:
            best_t, best = t, st
    return best_t, best


def _eval_rule(
    events: list[dict[str, Any]],
    *,
    label: str,
    rule: Callable[[float, float], bool],
    grid: list[float],
    side: str,
    default_t: float,
    min_n: int = 25,
) -> None:
    n = len(events)
    cut = int(n * 0.70)
    train, test = events[:cut], events[cut:]
    base_all = _seg_stats(events, side=side)

    # current production threshold, evaluated on TEST
    cur_test = _seg_stats([r for r in test if rule(r["slope_20d"], default_t)], side=side)
    # walk-forward optimal: fit on TRAIN, evaluate SAME threshold on TEST
    opt_t, opt_train = _grid_pick(train, rule=rule, grid=grid, side=side, min_n=min_n)
    opt_test = _seg_stats([r for r in test if rule(r["slope_20d"], opt_t)], side=side)

    print(f"\n--- {label}  (side={side}) ---")
    print(f"  ALL events ({side}): n={base_all['n']}  win%={100*base_all['win_rate']:.1f}  "
          f"mean P&L={base_all['mean_pnl']}  total={base_all['total_pnl']}   <- 'take everything' benchmark")
    if cur_test.get("n"):
        print(f"  CURRENT rule (t={default_t}) on TEST: n={cur_test['n']}  win%={100*cur_test['win_rate']:.1f}  "
              f"mean P&L={cur_test['mean_pnl']}  total={cur_test['total_pnl']}")
    else:
        print(f"  CURRENT rule (t={default_t}) on TEST: no triggers")
    print(f"  WALK-FWD opt t={opt_t} (train n={opt_train['n']}, train mean P&L={opt_train.get('mean_pnl')})")
    if opt_test.get("n"):
        print(f"     -> on TEST: n={opt_test['n']}  win%={100*opt_test['win_rate']:.1f}  "
              f"mean P&L={opt_test['mean_pnl']}  total={opt_test['total_pnl']}")
    else:
        print("     -> on TEST: no triggers")


def main() -> None:
    events = _build_events()
    print("=" * 84)
    print(f"SLOPE_20d RULE WALK-FORWARD BACKTEST (read-only)   matched events={len(events)}")
    print("=" * 84)
    if len(events) < 60:
        print("Not enough matched (slope x outcome) events for a backtest.")
        print("Run on the machine that holds data/model_historical_input_library.json + outcomes.")
        if events:
            print(f"(got {len(events)} — showing they joined, but too few to split)")
        return

    slopes = [r["slope_20d"] for r in events]
    moves = [r["actual"] for r in events]
    r = _corr(slopes, moves)
    pos = [r2 for r2 in events if r2["slope_20d"] >= 0]
    neg = [r2 for r2 in events if r2["slope_20d"] < 0]
    print(f"  date range: {events[0]['cd']} .. {events[-1]['cd']}")
    print(f"  corr(entry slope_20d, forward move) = {r:.3f}" if r is not None else "  corr: n/a")
    print(f"  slope>=0 events: n={len(pos)}  mean move={statistics.mean([e['actual'] for e in pos]):.2f}  "
          f"win%(long)={100*sum(1 for e in pos if e['actual']>0)/max(1,len(pos)):.1f}")
    print(f"  slope< 0 events: n={len(neg)}  mean move={statistics.mean([e['actual'] for e in neg]):.2f}  "
          f"win%(long)={100*sum(1 for e in neg if e['actual']>0)/max(1,len(neg)):.1f}")
    print("  (if corr ~ 0 and the two rows look alike, slope carries no tradable signal)")

    buy_grid = [round(-0.40 + 0.05 * i, 2) for i in range(17)]   # -0.40 .. +0.40
    sell_grid = [round(-0.45 + 0.05 * i, 2) for i in range(13)]  # -0.45 .. +0.15

    # BUY momentum: go long when slope >= t (current production polarity)
    _eval_rule(events, label="BUY momentum (long when slope_20d >= t)",
               rule=lambda s, t: s >= t, grid=buy_grid, side="long", default_t=0.10)
    # BUY contrarian: go long when slope <= t (the hypothesis from the 40 trades)
    _eval_rule(events, label="BUY contrarian (long when slope_20d <= t)",
               rule=lambda s, t: s <= t, grid=buy_grid, side="long", default_t=0.0)
    # SELL momentum-down: go short when slope <= t (current production polarity)
    _eval_rule(events, label="SELL (short when slope_20d <= t)",
               rule=lambda s, t: s <= t, grid=sell_grid, side="short", default_t=-0.30)

    print("\nReading: a rule only adds value if its TEST mean P&L (and win%) beats the")
    print("'take everything' benchmark for that side. If the walk-forward optimum lands")
    print("near the benchmark (or flips polarity each split), the slope rule is noise and")
    print("the live BUY/SELL thresholds are not a real P&L lever.")


if __name__ == "__main__":
    main()
