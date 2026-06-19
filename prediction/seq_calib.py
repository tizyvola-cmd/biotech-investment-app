"""
Sequential curve calibration state, knot metrics, and in-place prediction updates.
"""
from __future__ import annotations

import json
import pathlib

from prediction.config import (
    CURVE_SEQ_STATE_PATH,
    get_config,
    pred_curve_k8_seq_merge_enabled,
    pred_curve_seq_env_enabled,
)



def pred_curve_seq_snap_cal_day_to_offset_index(
    off_cal: int,
    offsets: tuple[int, ...],
    *,
    max_slack_days: int = 7,
) -> int | None:
    """Indice del nodo la cui distanza |offset−off_cal| è minima, con slack massima."""
    best_i: int | None = None
    best_d: int | None = None
    for i, o in enumerate(offsets):
        d = abs(int(o) - int(off_cal))
        if d > int(max_slack_days):
            continue
        if best_d is None or d < best_d:
            best_d, best_i = d, i
        elif d == best_d and best_i is not None:
            if abs(int(o)) < abs(int(offsets[best_i])):
                best_i = i
    return best_i


def pred_curve_seq_load(path: pathlib.Path | str | None = None) -> dict:
    p = pathlib.Path(path or CURVE_SEQ_STATE_PATH)
    if not p.is_file():
        return {"version": 1, "events": {}}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(d, dict):
            return {"version": 1, "events": {}}
        d.setdefault("version", 1)
        if not isinstance(d.get("events"), dict):
            d["events"] = {}
        return d
    except Exception:
        return {"version": 1, "events": {}}


def pred_curve_seq_save(doc: dict, path: pathlib.Path | str | None = None) -> None:
    p = pathlib.Path(path or CURVE_SEQ_STATE_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


DEFAULT_CAL_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4, 7)


def pred_curve_close_cal(close_series, cd, cal_off: int):
    import data_orchestrator as orch
    """Close reale vicina al giorno di calendario ``CD + cal_off`` (gg cal.)."""
    if close_series is None or getattr(close_series, "empty", True):
        return None
    from datetime import timedelta as _td
    try:
        tgt = cd + _td(days=int(cal_off))
    except Exception:
        return None
    td = orch._nearest_hist_trade_date_to_calendar(
        close_series, tgt, max_snap_days=5)
    if td is None:
        return None
    return orch._histlib_close_on_trade_date(close_series, td)


def pred_curve_trade_date_at_offset(close_series, cd, cal_off: int):
    import data_orchestrator as orch
    """Data di negoziazione (calendario) usata per il nodo ``CD+cal_off`` — senza close."""
    if close_series is None or getattr(close_series, "empty", True):
        return None
    from datetime import timedelta as _td
    try:
        tgt = cd + _td(days=int(cal_off))
    except Exception:
        return None
    return orch._nearest_hist_trade_date_to_calendar(
        close_series, tgt, max_snap_days=5)


def pred_curve_series_upto_trade_date(ser, end_trade_date) -> "object | None":
    """
    Restituisce ``ser`` ristretta alle sole barre con giorno di calendario
    ``<= end_trade_date`` (nessun dato successivo al nodo — anti look-ahead).
    """
    if ser is None or getattr(ser, "empty", True) or end_trade_date is None:
        return ser
    import pandas as pd
    try:
        out = ser.copy()
        mask = []
        for ix in out.index:
            try:
                id_ = pd.Timestamp(ix).normalize().date()
            except Exception:
                mask.append(False)
                continue
            mask.append(id_ <= end_trade_date)
        out = out.loc[mask]
        return out if not getattr(out, "empty", True) else None
    except Exception:
        return None


def pred_curve_knot_metrics_asof(
    close_upto: "object | None",
    vol_upto: "object | None",
    xbi_upto: "object | None",
) -> dict:
    """
    RSI, volume, pendenza vs XBI calcolati **solo** sulle serie già troncate
    alla seduta del nodo (stesso arco temporale del punto).
    """
    import numpy as np
    import pandas as pd

    out: dict = {}
    if close_upto is None or getattr(close_upto, "empty", True):
        return out
    c = close_upto.dropna().astype(float)
    if len(c) < 5:
        return out

    def _rsi14_local(s: pd.Series):
        try:
            dlt = s.diff().dropna()
            if len(dlt) < 14:
                return None
            gain = dlt.clip(lower=0).rolling(14).mean()
            loss = (-dlt.clip(upper=0)).rolling(14).mean()
            rs = gain / loss.replace(0, float("nan"))
            rsi = 100 - 100 / (1 + rs)
            val = rsi.iloc[-1]
            return float(val) if pd.notna(val) else None
        except Exception:
            return None

    def _vol_ratio_local(v: pd.Series):
        try:
            v = v.dropna().astype(float)
            if len(v) < 20:
                return None
            avg5 = float(v.iloc[-5:].mean())
            avg15 = float(v.iloc[-20:-5].mean())
            return round(avg5 / avg15, 3) if avg15 > 0 else None
        except Exception:
            return None

    def _vol_accel_local(v: pd.Series):
        try:
            v = v.dropna().astype(float)
            if len(v) < 10:
                return None
            last5 = float(v.tail(5).mean())
            prev5 = float(v.tail(10).head(5).mean())
            return round(last5 / prev5, 2) if prev5 > 0 else None
        except Exception:
            return None

    def _slope_pct_local(s: pd.Series):
        try:
            s = s.dropna().astype(float).tail(45)
            if len(s) < 5:
                return None
            x = np.arange(len(s), dtype=float)
            y = s.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            coef = np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)
            return round(float(coef[0]), 4)
        except Exception:
            return None

    def _vol_px_div_local(cs: pd.Series, vs: pd.Series, n: int = 20):
        try:
            ix = cs.index.intersection(vs.index)
            if len(ix) < max(6, n // 2):
                return None
            cs2 = cs.loc[ix].sort_index().astype(float).tail(n)
            vs2 = vs.loc[ix].sort_index().astype(float).tail(n)
            if len(cs2) < max(3, n // 2) or len(vs2) < max(3, n // 2):
                return None
            x = np.arange(len(cs2), dtype=float)
            y = cs2.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            p_sl = float(np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)[0])
            xv = np.arange(len(vs2), dtype=float)
            yv = vs2.values.astype(float)
            v_sl = float(np.polyfit(xv, yv / (yv.mean() or 1.0), 1)[0]) * 100.0
            if p_sl < -0.3 and v_sl > 0.5:
                return 1
            if p_sl > 0.3 and v_sl < -0.5:
                return -1
            return 0
        except Exception:
            return None

    rsi = _rsi14_local(c)
    if rsi is not None:
        out["rsi_14"] = round(rsi, 2)
    sl = _slope_pct_local(c)
    if sl is not None:
        out["slope_pct_45d"] = sl
    if xbi_upto is not None and not getattr(xbi_upto, "empty", True):
        xb = xbi_upto.dropna().astype(float)
        common = c.index.intersection(xb.index)
        if len(common) >= 5:
            try:
                s_tk = _slope_pct_local(c.loc[common].sort_index())
                s_xb = _slope_pct_local(xb.loc[common].sort_index())
                if s_tk is not None and s_xb is not None:
                    out["exc_slope_vs_xbi"] = round(float(s_tk) - float(s_xb), 4)
            except Exception:
                pass
    if vol_upto is not None and not getattr(vol_upto, "empty", True):
        v0 = vol_upto.dropna().astype(float)
        ixv = c.index.intersection(v0.index)
        if len(ixv) >= 20:
            v1 = v0.loc[ixv].sort_index()
            vr = _vol_ratio_local(v1)
            if vr is not None:
                out["vol_ratio"] = vr
            va = _vol_accel_local(v1)
            if va is not None:
                out["vol_accel"] = va
            if len(ixv) >= 10:
                vpd = _vol_px_div_local(c.loc[ixv].sort_index(), v1)
                if vpd is not None:
                    out["vol_price_div"] = int(vpd)
    out["close_last"] = round(float(c.iloc[-1]), 4) if len(c) else None
    return out


def _recompute_adj_from_act(
    act: list[float | None],
    raw: list[float | None],
    n: int,
) -> tuple[list[float | None], int]:
    last = -1
    for i in range(n):
        if act[i] is not None:
            last = i
    if last < 0:
        return [None] * n, -1
    adj: list[float | None] = [None] * n
    for j in range(n):
        if j <= last:
            adj[j] = act[j] if act[j] is not None else raw[j]
        else:
            L = last
            a_l = act[L]
            if (
                a_l is not None
                and j < len(raw)
                and L < len(raw)
                and raw[j] is not None
                and raw[L] is not None
            ):
                try:
                    adj[j] = round(float(a_l) + float(raw[j]) - float(raw[L]), 4)
                except Exception:
                    adj[j] = raw[j]
            else:
                adj[j] = raw[j] if j < len(raw) else None
    return adj, last


def _merge_node_snapshots(
    existing: dict | None,
    incoming: dict | None,
) -> dict:
    out = dict(existing) if isinstance(existing, dict) else {}
    if not isinstance(incoming, dict):
        return out
    for key, snap in incoming.items():
        if key not in out and isinstance(snap, dict):
            out[key] = snap
    return out


def compute_seq_curve_asof(
    *,
    close_series,
    cd,
    today,
    raw_model: list[float | None],
    p60: float,
    offsets: tuple[int, ...] | None = None,
    beta_seq: float | None = None,
) -> dict | None:
    """
    Ricostruisce act/adj seq (% vs T−60) **senza look-ahead**: solo nodi con
    ``CD + offset <= today`` (calendario) vengono ancorati ai close reali.
    """
    import data_orchestrator as orch
    from datetime import date as _date, timedelta as _td

    if close_series is None or getattr(close_series, "empty", True):
        return None
    if p60 is None or float(p60) <= 0:
        return None
    if today is None:
        _today = _date.today()
    elif hasattr(today, "date"):
        _today = today.date()
    else:
        _today = today
    try:
        cd_d = cd if isinstance(cd, _date) else _date.fromisoformat(str(cd)[:10])
    except Exception:
        return None

    offs = offsets if offsets is not None else DEFAULT_CAL_OFFSETS
    n = len(offs)
    if not isinstance(raw_model, list) or len(raw_model) < n:
        return None

    raw = list(raw_model)
    act: list[float | None] = [None] * n
    for i, off in enumerate(offs):
        if _today < cd_d + _td(days=int(off)):
            continue
        if int(off) == -60:
            act[i] = 0.0
            continue
        po = pred_curve_close_cal(close_series, cd_d, int(off))
        if po is not None and float(po) > 0:
            try:
                _pct_obs = round((float(po) / float(p60) - 1.0) * 100.0, 4)
                act[i] = orch._seq_curve_act_pct_lock_with_beta(
                    _pct_obs, raw, i, beta_seq, cd=cd_d, today=_today,
                )
            except Exception:
                act[i] = None

    last = -1
    for i in range(n):
        if act[i] is not None:
            last = i
    if last < 0:
        return None

    adj, last = _recompute_adj_from_act(act, raw, n)

    trade_dates: dict[str, str] = {}
    for i, off in enumerate(offs):
        td_i = pred_curve_trade_date_at_offset(close_series, cd_d, int(off))
        if td_i is not None:
            trade_dates[str(int(off))] = td_i.isoformat()

    return {
        "raw": raw,
        "act": act,
        "adj": adj,
        "last_locked_idx": last,
        "p60": float(p60),
        "trade_dates": trade_dates,
        "as_of": _today.isoformat(),
    }


def pred_curve_seq_apply_to_predictions(
    result: dict,
    closes_long: dict,
    volumes_long: dict | None,
    xbi_long: "object | None",
    *,
    today,
    financial_df=None,
    offsets: tuple[int, ...] | None = None,
) -> None:
    """
    Aggiorna in-place i record predizione (chiavi ``TICKER|CD``) con:

    - ``seq_curve_pct_vs_m60``: lista allineata a ``SIMULATION_PRED_CAL_OFFSETS`` — % vs
      prezzo **reale** a T−60; ogni nodo calendario già raggiunto (−60…+7) blendato col
      modello tramite β ticker (``ACC_K8_RECALIB_BETA``); nodi futuri estrapolati dal modello;
    - ``seq_curve_t60_usd``: prezzo reale (USD) al nodo T−60 quando disponibile;
    - ``seq_curve_knot_snapshots``: per ogni offset **già raggiunto** nel calendario, metriche
      (RSI, vol_ratio, vol_accel, slope vs XBI, …) calcolate **solo** su serie troncate alla
      seduta del nodo — nessun dato «di oggi» applicato a −60/−30/…;
    - ``seq_curve_recalib_note``: riepilogo sintetico.

    Con ``ORCH_SKIP_SEC_K8`` disattivo e CIK disponibile (Financial o cache SEC), gli 8‑K in
    [CD−60, CD] aggiungono punti % vs T−60 ai **soli** nodi ancora senza close storico
    (stesso schema della curva storica, senza sovrascrivere i nodi già ancorati).

    Persistenza non bloccante: ``data/pred_curve_seq_state.json``.
    """
    if not result or not closes_long:
        return
    import data_orchestrator as orch
    from datetime import date as _date, timedelta as _td

    if today is None:
        _today = _date.today()
    elif hasattr(today, "date"):
        _today = today.date()
    else:
        _today = today

    if offsets is None:
        offsets = getattr(
            orch, 'SIMULATION_PRED_CAL_OFFSETS', DEFAULT_CAL_OFFSETS
        )
    n = len(offsets)
    doc = pred_curve_seq_load()
    ev = doc.setdefault("events", {})
    dirty_state = False
    n_seq_events = 0
    from prediction.ai_feed_recalib import (
        get_ai_feed_index,
        merge_ai_feed_observations_into_act,
    )

    _ai_feed_idx = get_ai_feed_index()
    _cfg = get_config()
    _k8_merge = _cfg.pred_curve_k8_seq_merge_enabled()
    _sub_cache_k8: dict[str, dict | None] = {}
    _tk_cik_fb: dict[str, str] = {}
    _sec_sleep_k8 = _cfg.sec_k8_submissions_sleep_sec if _k8_merge else 0.0
    if _k8_merge:
        try:
            _tk_cik_fb = orch._build_ticker_cik_map()
        except Exception:
            _tk_cik_fb = {}

    for k, pred in list(result.items()):
        if not isinstance(k, str) or "|" not in k or not isinstance(pred, dict):
            continue
        part = k.split("|", 1)
        if len(part) != 2:
            continue
        tk = part[0].strip().upper()
        cd_s = part[1].strip()
        if not tk:
            continue
        try:
            cd = _date.fromisoformat(cd_s)
        except Exception:
            continue
        ser = closes_long.get(tk)
        if ser is None or getattr(ser, "empty", True):
            continue
        if _today < cd + _td(days=-60):
            continue
        p60 = pred_curve_close_cal(ser, cd, -60)
        if p60 is None or float(p60) <= 0:
            continue
        pw = dict(pred)
        orch._accuracy_sim_impute_missing_pre_cd_model_pcts(pw)
        orch._accuracy_sim_synthesize_interp_nodes_from_post_d_only(pw)
        raw = orch._interp_pred_pct_vs_m60_calendar(
            pw,
            offsets,
            log_row_key=None,
            pair_empty_logged=None,
        )
        if not isinstance(raw, list) or len(raw) < n:
            continue
        _beta_seq = (
            orch._resolve_ticker_beta_for_recalib(tk, pred, financial_df)
            if orch._accuracy_recalib_beta_applies_for_cd(cd, today=_today)
            else None
        )
        vol_long = None
        if isinstance(volumes_long, dict):
            vol_long = volumes_long.get(tk)
        curve = compute_seq_curve_asof(
            close_series=ser,
            cd=cd,
            today=_today,
            raw_model=raw,
            p60=float(p60),
            offsets=offsets,
            beta_seq=_beta_seq,
        )
        if curve is None:
            continue
        act = curve["act"]
        adj = curve["adj"]
        last = curve["last_locked_idx"]
        _n_k8_nodes = 0
        if _k8_merge:
            try:
                _fr_k8 = orch._financial_series_for_ticker(financial_df, tk)
                _cik_raw = orch._accuracy_cik_str_from_financial_row(_fr_k8)
            except Exception:
                _cik_raw = None
            if not _cik_raw:
                _cik_raw = (_tk_cik_fb.get(tk) or None)
            _cik10 = orch._sec_cik_pad_10(str(_cik_raw or ""))
            if len(_cik10) == 10:
                if _cik10 not in _sub_cache_k8:
                    _sub_cache_k8[_cik10] = orch._fetch_sec_company_submissions_json(_cik10)
                    if _sec_sleep_k8 > 0:
                        import time as _time_sub_k8
                        _time_sub_k8.sleep(_sec_sleep_k8)
                _sub_k8 = _sub_cache_k8.get(_cik10)
                try:
                    _n_k8_nodes = int(orch._pred_curve_seq_merge_k8_observations_into_act(
                        tk=tk,
                        cd=cd,
                        p60=float(p60),
                        sub=_sub_k8,
                        today=_today,
                        offsets=offsets,
                        act=act,
                        filing_lookback_days=orch._sec_k8_lookback_days(),
                    ))
                except Exception:
                    _n_k8_nodes = 0
        _n_ai_nodes = 0
        _ai_filled_idx: list[int] = []
        try:
            _n_ai_nodes = int(merge_ai_feed_observations_into_act(
                tk=tk,
                cd=cd,
                p60=float(p60),
                today=_today,
                offsets=offsets,
                act=act,
                close_series=ser,
                index=_ai_feed_idx,
                snap_cal_day_to_offset_index=pred_curve_seq_snap_cal_day_to_offset_index,
                filled_offset_indices=_ai_filled_idx,
            ))
        except Exception:
            _n_ai_nodes = 0
            _ai_filled_idx = []
        adj, last = _recompute_adj_from_act(act, raw, n)
        if last < 0:
            continue
        knot_snapshots: list = []
        knots_export: dict = {}
        existing_snaps = dict((ev.get(k) or {}).get("node_snapshots") or {})
        node_snapshots: dict = {}
        for i, off in enumerate(offsets):
            if _today < cd + _td(days=int(off)):
                knot_snapshots.append(None)
                continue
            td_i = pred_curve_trade_date_at_offset(ser, cd, int(off))
            if td_i is None:
                knot_snapshots.append(None)
                continue
            c_u = pred_curve_series_upto_trade_date(ser, td_i)
            v_u = (
                pred_curve_series_upto_trade_date(vol_long, td_i)
                if vol_long is not None
                else None
            )
            x_u = (
                pred_curve_series_upto_trade_date(xbi_long, td_i)
                if xbi_long is not None
                else None
            )
            mets = pred_curve_knot_metrics_asof(c_u, v_u, x_u)
            mets["trade_date"] = td_i.isoformat()
            mets["cal_offset"] = int(off)
            if act[i] is not None:
                mets["pct_vs_p60"] = act[i]
            if i < len(raw) and raw[i] is not None:
                mets["model_pct_vs_m60"] = raw[i]
            if i < len(adj) and adj[i] is not None:
                mets["seq_pct_vs_m60"] = adj[i]
            knot_snapshots.append(mets)
            knots_export[str(int(off))] = mets
            snap_key = str(int(off))
            if snap_key not in existing_snaps:
                as_of_cal = cd + _td(days=int(off))
                sub = compute_seq_curve_asof(
                    close_series=ser,
                    cd=cd,
                    today=as_of_cal,
                    raw_model=raw,
                    p60=float(p60),
                    offsets=offsets,
                    beta_seq=_beta_seq,
                )
                if sub is not None and i < len(sub["adj"]):
                    node_snapshots[snap_key] = {
                        "as_of_date": as_of_cal.isoformat(),
                        "trade_date": td_i.isoformat(),
                        "model_pct_vs_m60": raw[i] if i < len(raw) else None,
                        "seq_pct_vs_m60": sub["adj"][i],
                        "actual_pct_vs_m60": sub["act"][i] if i < len(sub["act"]) else None,
                    }
        pred["seq_curve_pct_vs_m60"] = [
            (round(float(x), 2) if x is not None and x == x else None)
            for x in adj
        ]
        pred["seq_curve_t60_usd"] = round(float(p60), 6)
        pred["seq_curve_knot_snapshots"] = knot_snapshots
        if _ai_filled_idx:
            pred["seq_curve_ai_feed_offsets"] = [
                int(offsets[ii]) for ii in _ai_filled_idx if 0 <= ii < n
            ]
        _note_k8 = (
            f" | 8‑K: {_n_k8_nodes} nodi da chiusure −1/+1…+3 (solo dove mancava il close)"
            if _n_k8_nodes
            else "")
        _note_ai = (
            f" | AI feed: {_n_ai_nodes} nodi pub. T…T+3 (solo nodi liberi)"
            if _n_ai_nodes
            else "")
        pred["seq_curve_recalib_note"] = (
            f"seq T−60 reale; ultimo nodo oss. offset={offsets[last]}; "
            f"metriche per nodo su serie ≤ trade_date nodo "
            f"({_today.isoformat()}){_note_k8}{_note_ai}"
        )
        ev[k] = {
            "ticker": tk,
            "completion_date": cd.isoformat(),
            "p60_usd": float(p60),
            "locked_pct": {
                str(offsets[ii]): act[ii]
                for ii in range(n)
                if act[ii] is not None
            },
            "knots": knots_export,
            "node_snapshots": _merge_node_snapshots(
                (ev.get(k) or {}).get("node_snapshots"), node_snapshots,
            ),
            "last_run": _today.isoformat(),
        }
        dirty_state = True
        n_seq_events += 1

    if dirty_state:
        try:
            pred_curve_seq_save(doc)
            print(
                f"[Pred/seq_curve] Ricalibrati {n_seq_events} eventi "
                f"(stato audit → {CURVE_SEQ_STATE_PATH})",
                flush=True,
            )
        except Exception as _se:
            print(f"[Pred/seq_curve] salvataggio stato: {_se}", flush=True)



__all__ = [
    "DEFAULT_CAL_OFFSETS",
    "compute_seq_curve_asof",
    "merge_node_snapshots",
    "pred_curve_close_cal",
    "pred_curve_k8_seq_merge_enabled",
    "pred_curve_knot_metrics_asof",
    "pred_curve_seq_apply_to_predictions",
    "pred_curve_seq_env_enabled",
    "pred_curve_seq_load",
    "pred_curve_seq_save",
    "pred_curve_seq_snap_cal_day_to_offset_index",
    "pred_curve_series_upto_trade_date",
    "pred_curve_trade_date_at_offset",
]

merge_node_snapshots = _merge_node_snapshots

