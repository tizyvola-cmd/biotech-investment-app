"""Compare sign-curve daily hit%: price@CD anchor vs m60-anchored pred."""
from __future__ import annotations

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import data_orchestrator as orch
from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_map, normalize_past_pred_record
from prediction.sign_curve_daily import (
    PRE_CD_CALENDAR_DAYS,
    _daily_pairs_for_record,
    _sign_hit_daily,
    build_sign_curve_daily_snapshot,
)


def _pairs_m60_anchored(rec: dict, today) -> tuple[tuple[int, int], tuple[int, int]]:
    import pandas as pd
    from datetime import date

    cd = rec.get("completion_date")
    if isinstance(cd, str):
        cd = date.fromisoformat(cd[:10])
    if cd is None or cd >= today:
        return (0, 0), (0, 0)
    tk = str(rec.get("ticker") or "").strip().upper()
    if not tk:
        return (0, 0), (0, 0)
    ser_cache: dict = {}
    ser = orch._histlib_accuracy_sim_resolve_close_series(tk, ser_cache)
    if ser is None or ser.empty:
        return (0, 0), (0, 0)
    s = ser.dropna().sort_index()
    tscd = pd.Timestamp(cd)
    lo = tscd - pd.Timedelta(days=PRE_CD_CALENDAR_DAYS)
    window = s[(s.index >= lo) & (s.index <= tscd)]
    if len(window) < 2:
        return (0, 0), (0, 0)
    m60 = orch._pred_curve_close_cal(s, cd, -60)
    if m60 is None or float(m60) <= 0:
        return (0, 0), (0, 0)
    m60 = float(m60)
    dd = dict(rec)
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(dd)

    def _pred_px(d, k):
        return orch._acc_sim_pred_px_at_pct_key(d, k)

    def _pred_pct_m60(cal_off: int) -> float | None:
        px60 = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, -60, _pred_px)
        if px60 is None or px60 <= 0:
            return None
        px = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, cal_off, _pred_px)
        if px is None or px <= 0:
            return None
        return (float(px) / float(px60) - 1.0) * 100.0

    dates, act_px, pred_px = [], [], []
    for ix in window.index:
        d = pd.Timestamp(ix).normalize().date()
        c = float(window.loc[ix])
        if c <= 0:
            continue
        cal_off = (d - cd).days
        pp = _pred_pct_m60(cal_off)
        if pp is None:
            continue
        dates.append(d)
        act_px.append(c)
        pred_px.append(m60 * (1.0 + pp / 100.0))

    hits_price = n_price = hits_pp = n_pp = 0
    for i in range(1, len(dates)):
        a0, a1 = act_px[i - 1], act_px[i]
        p0, p1 = pred_px[i - 1], pred_px[i]
        if p0 <= 0 or a0 <= 0:
            continue
        act_ret = (a1 - a0) / a0 * 100.0
        pred_ret = (p1 - p0) / p0 * 100.0
        if _sign_hit_daily(pred_ret, act_ret):
            hits_price += 1
        n_price += 1
        cal_i = (dates[i] - cd).days
        cal_im1 = (dates[i - 1] - cd).days
        pp_i = _pred_pct_m60(cal_i)
        pp_im1 = _pred_pct_m60(cal_im1)
        if pp_i is None or pp_im1 is None:
            continue
        act_pp_i = (a1 / m60 - 1.0) * 100.0
        act_pp_im1 = (a0 / m60 - 1.0) * 100.0
        if _sign_hit_daily(pp_i - pp_im1, act_pp_i - act_pp_im1):
            hits_pp += 1
        n_pp += 1
    return (hits_price, n_price), (hits_pp, n_pp)


def main() -> None:
    from datetime import date

    ref = date.today()
    rows = [
        normalize_past_pred_record(v)
        for v in load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON).values()
        if isinstance(v, dict)
    ]
    sample = [r for r in rows if r.get("completion_date") and r.get("completion_date") < ref]
    random.seed(42)
    random.shuffle(sample)
    sample = sample[:400]

    old_h = old_n = new_price_h = new_price_n = new_pp_h = new_pp_n = 0
    for rec in sample:
        pairs = _daily_pairs_for_record(rec, today=ref)
        old_h += sum(1 for p in pairs if p.get("zone") == "pre_cd" and p.get("hit"))
        old_n += sum(1 for p in pairs if p.get("zone") == "pre_cd")
        (h, n), (hp, np) = _pairs_m60_anchored(rec, ref)
        new_price_h += h
        new_price_n += n
        new_pp_h += hp
        new_pp_n += np

    print(f"OLD pre-CD hit: {old_h/old_n*100:.1f}% n={old_n}" if old_n else "OLD: no pairs")
    if new_price_n:
        print(f"NEW price DoD hit: {new_price_h/new_price_n*100:.1f}% n={new_price_n}")
    if new_pp_n:
        print(f"NEW delta pct-vs-m60 hit: {new_pp_h/new_pp_n*100:.1f}% n={new_pp_n}")

    snap = build_sign_curve_daily_snapshot(max_rows=500)
    print(f"Current JSON pre_cd: {snap['overall'].get('hit_pct_pre_cd')}% n={snap['overall'].get('n_pairs_pre_cd')}")


if __name__ == "__main__":
    main()
