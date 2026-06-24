"""Measure (read-only) each learning loop's impact on the THREE channels that
actually matter for the app, plus a weekly breakdown.

Channels & metrics (confirmed with the user):
  1. PREDICTION CURVE  -> direction-hit % + calibration error (signed bias |E[pred-actual]|)
  2. RECOMMENDATION    -> hit-rate of the recommended action (SDS/regime gate)
  3. TRADING (output)  -> P&L per trade + win-rate

For each channel we report the overall number, a WEEKLY series, and — where it is
methodologically sound — the marginal contribution of each learning loop.

Important, honest caveats baked into the output:
  * The magnitude loops (global cal_factor, cluster cal_factor, regime multiplier)
    are MULTIPLICATIVE on |pred| and PRESERVE SIGN, so they cannot change
    direction-hit at all (that delta is exactly 0 by construction). Their only
    prediction-channel lever is the calibration error, bounded by |factor-1|.
  * Loop attribution on the prediction channel uses the loops' CURRENT factors as
    the toggle (forward counterfactual: metric with factor applied vs not). It
    measures how hard each loop is currently pulling, which is exactly what tells
    us whether a loop is worth keeping on the tab.
  * Recommendation & trading channels read the sim/decision-log positions, which
    now carry entry SDS + regime. Until you rebuild the sim those fields are empty
    and those sections will say so.

This script ONLY reads. It writes nothing.

    .venv\\Scripts\\python.exe diag_loop_channel_impact.py
"""
from __future__ import annotations

import datetime as _dt
import statistics
from typing import Any, Callable


# ────────────────────────── helpers ──────────────────────────
def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def _iso_week(date_str: str | None) -> str | None:
    if not date_str:
        return None
    s = str(date_str)[:10]
    for fmt in ("%Y-%m-%d",):
        try:
            d = _dt.datetime.strptime(s, fmt).date()
            y, w, _ = d.isocalendar()
            return f"{y}-W{w:02d}"
        except ValueError:
            pass
    return None


def _first_date(r: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = r.get(k)
        if v:
            return str(v)[:10]
    return None


def _pct_sign_hit(pred: float, actual: float) -> bool:
    return (pred > 0) == (actual > 0)


# ────────────────────────── channel 1: prediction ──────────────────────────
def _load_outcomes() -> list[dict[str, Any]]:
    from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources

    rows = []
    for r in collect_resolved_outcomes_from_sources():
        p, a = _num(r.get("pred")), _num(r.get("actual"))
        if p is None or a is None:
            continue
        rows.append({**r, "pred": p, "actual": a})
    return rows


def _dir_hit(pairs: list[tuple[float, float]]) -> float | None:
    usable = [(p, a) for p, a in pairs if p != 0 and a != 0]
    if not usable:
        return None
    return sum(1 for p, a in usable if _pct_sign_hit(p, a)) / len(usable)


def _bias(pairs: list[tuple[float, float]]) -> float | None:
    return statistics.mean(p - a for p, a in pairs) if pairs else None


def _mae(pairs: list[tuple[float, float]]) -> float | None:
    return statistics.mean(abs(p - a) for p, a in pairs) if pairs else None


def channel_prediction(outcomes: list[dict[str, Any]]) -> None:
    print("\n" + "=" * 84)
    print("CHANNEL 1 — PREDICTION CURVE   (direction-hit % + calibration error)")
    print("=" * 84)
    if not outcomes:
        print("  no resolved outcomes found (run on the machine that holds data/).")
        return

    pairs = [(r["pred"], r["actual"]) for r in outcomes]
    dh = _dir_hit(pairs)
    bias = _bias(pairs)
    mae = _mae(pairs)
    print(f"  OVERALL  n={len(pairs)}  direction_hit={_fmt_pct(dh)}  "
          f"calibration_bias(E[pred-actual])={_fmt(bias)}pp  |bias|={_fmt(abs(bias) if bias is not None else None)}pp  "
          f"MAE={_fmt(mae)}pp")

    # ---- per-loop marginal contribution on calibration (sign-preserving) ----
    print("\n  per-loop marginal effect (forward counterfactual = factor applied vs not):")
    print(f"  {'loop':26s} {'factor':>8s} {'|bias|->':>9s} {'d|bias|':>8s} {'MAE->':>8s} {'dMAE':>8s} {'dDirHit':>8s}")
    _print_loop_effect("global cal_factor", outcomes, _global_factor_fn(), pairs)
    _print_loop_effect("cluster cal_factor", outcomes, _cluster_factor_fn(), pairs)
    print("  regime multiplier        : not measurable on this pool (regime not")
    print("    logged on historical eval rows) — measured on TRADING channel instead.")
    print("  daily curve recalib      : reshapes the curve (can flip sign) — the only")
    print("    loop that CAN move direction-hit; needs pipeline rerun to toggle, not a")
    print("    simple factor. Tracked via the OVERALL direction-hit trend below.")

    _weekly(outcomes, key_dates=("date",), label="prediction (weekly)",
            metric_fns=[("dirHit%", lambda rs: _fmt_pct(_dir_hit([(r["pred"], r["actual"]) for r in rs]))),
                        ("bias", lambda rs: _fmt(_bias([(r["pred"], r["actual"]) for r in rs]))),
                        ("MAE", lambda rs: _fmt(_mae([(r["pred"], r["actual"]) for r in rs])))])


def _global_factor_fn() -> tuple[float | None, Callable[[dict[str, Any]], float]]:
    try:
        from prediction.cluster_cal_factor import get_global_cal_factor

        g = float(get_global_cal_factor())
    except Exception:
        g = None
    f = (g if g is not None else 1.0)
    return g, (lambda _r: f)


def _cluster_factor_fn() -> tuple[float | None, Callable[[dict[str, Any]], float]]:
    try:
        from prediction.cluster_cal_factor import (
            blended_cluster_cal_factor,
            classify_ticker,
        )

        def fn(r: dict[str, Any]) -> float:
            td = r.get("ticker_data") or {}
            try:
                return float(blended_cluster_cal_factor(classify_ticker(td)))
            except Exception:
                return 1.0

        return None, fn
    except Exception:
        return None, (lambda _r: 1.0)


def _print_loop_effect(
    name: str,
    outcomes: list[dict[str, Any]],
    fac: tuple[float | None, Callable[[dict[str, Any]], float]],
    base_pairs: list[tuple[float, float]],
) -> None:
    shown_factor, fn = fac
    new_pairs = [(r["pred"] * fn(r), r["actual"]) for r in outcomes]
    b0, b1 = _bias(base_pairs), _bias(new_pairs)
    m0, m1 = _mae(base_pairs), _mae(new_pairs)
    ab0 = abs(b0) if b0 is not None else None
    ab1 = abs(b1) if b1 is not None else None
    d_ab = (ab1 - ab0) if (ab0 is not None and ab1 is not None) else None
    d_m = (m1 - m0) if (m0 is not None and m1 is not None) else None
    fac_txt = _fmt(shown_factor) if shown_factor is not None else "per-row"
    print(f"  {name:26s} {fac_txt:>8s} {_fmt(ab1):>9s} {_fmt(d_ab):>8s} "
          f"{_fmt(m1):>8s} {_fmt(d_m):>8s} {'0.0':>8s}")


# ────────────────────────── channels 2 & 3: positions ──────────────────────────
def _load_positions() -> list[dict[str, Any]]:
    from prediction.investment_sim_outcomes import (
        build_investment_sim_outcomes,
        read_investment_sim_outcomes,
    )

    doc = read_investment_sim_outcomes()
    rows = doc.get("rows") or []
    if not rows:
        rows = (build_investment_sim_outcomes().get("rows") or [])
    return rows


def _recommended_action(r: dict[str, Any]) -> str:
    """Mirror sds_investment_decision: regime gate, then SDS sizing."""
    regime = str(r.get("entry_regime") or r.get("market_regime") or "").upper()
    if "RISK_OFF" in regime or "CRISIS" in regime:
        return "HOLD"
    sds = _num(r.get("entry_sds_score")) or _num(r.get("sds_score"))
    if sds is None:
        return "UNKNOWN"
    if sds >= 75:
        return "BUY_FULL"
    if sds >= 50:
        return "BUY_HALF"
    return "HOLD"


def _is_win(r: dict[str, Any]) -> bool | None:
    if r.get("is_win") is not None:
        return bool(r["is_win"])
    pnl = _num(r.get("pnl_pct"))
    return (pnl > 0) if pnl is not None else None


def channel_recommendation(rows: list[dict[str, Any]]) -> None:
    print("\n" + "=" * 84)
    print("CHANNEL 2 — RECOMMENDATION   (hit-rate of the recommended action: SDS + regime)")
    print("=" * 84)
    have = [r for r in rows if _recommended_action(r) != "UNKNOWN"]
    if not have:
        print("  no positions carry entry SDS/regime yet — rebuild the sim first:")
        print("    .venv\\Scripts\\python.exe scripts\\investment_sim_outcomes.py")
        return
    book_wins = [w for r in rows if (w := _is_win(r)) is not None]
    book_wr = (sum(book_wins) / len(book_wins)) if book_wins else None
    print(f"  WHOLE BOOK win-rate={_fmt_pct(book_wr)}  (baseline to beat)")
    print(f"  {'recommended action':22s} {'n':>5s} {'win%':>6s} {'meanP&L%':>9s} {'lift_vs_book':>12s}")
    buckets: dict[str, list[dict[str, Any]]] = {}
    for r in have:
        buckets.setdefault(_recommended_action(r), []).append(r)
    for act in ("BUY_FULL", "BUY_HALF", "HOLD"):
        rs = buckets.get(act, [])
        if not rs:
            continue
        wins = [w for r in rs if (w := _is_win(r)) is not None]
        wr = (sum(wins) / len(wins)) if wins else None
        pnls = [p for r in rs if (p := _num(r.get("pnl_pct"))) is not None]
        mp = statistics.mean(pnls) if pnls else None
        lift = (wr - book_wr) if (wr is not None and book_wr is not None) else None
        print(f"  {act:22s} {len(rs):>5d} {_fmt_pct(wr):>6s} {_fmt(mp):>9s} "
              f"{(_fmt_pct(lift) if lift is not None else 'n/a'):>12s}")
    print("\n  Reading: a positive lift on BUY_FULL/BUY_HALF vs the whole book means the")
    print("  SDS recommendation engine is actually selecting better trades (the REAL lever).")

    _weekly(have, key_dates=("entry_ts", "entry_date", "exit_ts"), label="recommendation (weekly, BUY only)",
            metric_fns=[("BUYn", lambda rs: str(sum(1 for r in rs if _recommended_action(r).startswith("BUY")))),
                        ("BUYwin%", lambda rs: _fmt_pct(_buy_winrate(rs)))])


def _buy_winrate(rs: list[dict[str, Any]]) -> float | None:
    buy = [r for r in rs if _recommended_action(r).startswith("BUY")]
    wins = [w for r in buy if (w := _is_win(r)) is not None]
    return (sum(wins) / len(wins)) if wins else None


def channel_trading(rows: list[dict[str, Any]]) -> None:
    print("\n" + "=" * 84)
    print("CHANNEL 3 — TRADING OUTPUT   (P&L per trade + win-rate)")
    print("=" * 84)
    if not rows:
        print("  no sim positions found.")
        return
    wins = [w for r in rows if (w := _is_win(r)) is not None]
    pnls = [p for r in rows if (p := _num(r.get("pnl_pct"))) is not None]
    eurs = [e for r in rows if (e := _num(r.get("pnl_eur"))) is not None]
    print(f"  OVERALL  n={len(rows)}  win-rate={_fmt_pct(sum(wins)/len(wins) if wins else None)}  "
          f"meanP&L%={_fmt(statistics.mean(pnls) if pnls else None)}  "
          f"medP&L%={_fmt(statistics.median(pnls) if pnls else None)}  "
          f"totEUR={_fmt(sum(eurs) if eurs else None)}")

    _weekly(rows, key_dates=("entry_ts", "entry_date", "exit_ts"), label="trading (weekly)",
            metric_fns=[("win%", lambda rs: _fmt_pct(_winrate(rs))),
                        ("meanP&L%", lambda rs: _fmt(_mean_pnl(rs))),
                        ("totEUR", lambda rs: _fmt(_sum_eur(rs)))])


def _winrate(rs: list[dict[str, Any]]) -> float | None:
    wins = [w for r in rs if (w := _is_win(r)) is not None]
    return (sum(wins) / len(wins)) if wins else None


def _mean_pnl(rs: list[dict[str, Any]]) -> float | None:
    pnls = [p for r in rs if (p := _num(r.get("pnl_pct"))) is not None]
    return statistics.mean(pnls) if pnls else None


def _sum_eur(rs: list[dict[str, Any]]) -> float | None:
    eurs = [e for r in rs if (e := _num(r.get("pnl_eur"))) is not None]
    return sum(eurs) if eurs else None


# ────────────────────────── weekly printer ──────────────────────────
def _weekly(
    rows: list[dict[str, Any]],
    *,
    key_dates: tuple[str, ...],
    label: str,
    metric_fns: list[tuple[str, Callable[[list[dict[str, Any]]], str]]],
) -> None:
    by_week: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        wk = _iso_week(_first_date(r, key_dates))
        if wk:
            by_week.setdefault(wk, []).append(r)
    if not by_week:
        print(f"\n  {label}: no usable dates on rows — weekly series unavailable.")
        return
    print(f"\n  {label}:")
    header = f"  {'week':10s} {'n':>5s}" + "".join(f" {name:>10s}" for name, _ in metric_fns)
    print(header)
    for wk in sorted(by_week)[-12:]:  # last 12 weeks
        rs = by_week[wk]
        cells = "".join(f" {fn(rs):>10s}" for _, fn in metric_fns)
        print(f"  {wk:10s} {len(rs):>5d}{cells}")


# ────────────────────────── formatting ──────────────────────────
def _fmt(v: float | None) -> str:
    return "n/a" if v is None else f"{v:.2f}"


def _fmt_pct(v: float | None) -> str:
    return "n/a" if v is None else f"{100*v:.1f}"


def main() -> None:
    print("=" * 84)
    print("LEARNING-LOOP IMPACT PER CHANNEL (read-only)")
    print("=" * 84)
    outcomes = _load_outcomes()
    positions = _load_positions()
    channel_prediction(outcomes)
    channel_recommendation(positions)
    channel_trading(positions)
    print("\nNOTE: the per-channel weekly trend is now also persisted on every refresh to")
    print("data/learning_loop_weekly_impact.json (prediction.learning_loop_channels) and")
    print("surfaced on the redesigned Model Calibration tab (3-channel panels). This script")
    print("stays as the read-only cross-check of those same numbers.")


if __name__ == "__main__":
    main()
