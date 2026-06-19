"""
Post‑processing opzionale per ``model_dm10_pct`` / ``model_dm30_pct`` / ``model_dm60_pct``.

Usa pieghe strutturali (curvatura su log‑prezzo) **solo** su storia pre‑CD escludendo le ultime
7 sedute prima della CD, e combina con il fit polinomiale esistente (``p_baseline``).

Attivazione: ``PRED_DM_STRUCT_BLEND=1`` (o ``true``/``yes``/``on``). Campione opzionale:
``PRED_DM_STRUCT_BLEND_TICKERS=TICK1,TICK2``.

Versione logica: ``price_structure_v1`` — vedi metadati ``struct_*`` nel record pred.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

_STRUCT_METHOD_VERSION = "price_structure_v1"
_CAP_ABS = 25.0
_MIN_DET_LEN = 15
_MIN_PRE_LEN = 40
_LAM_MAX = 0.5
_Z_CAP = 3.0
_COHER_DM10_VS_DM7 = 8.0  # pp: se superato, dimezza λ su dm10 una volta


def _env_blend_enabled() -> bool:
    v = os.environ.get("PRED_DM_STRUCT_BLEND", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _env_ticker_allowed(ticker: str) -> bool:
    raw = os.environ.get("PRED_DM_STRUCT_BLEND_TICKERS", "").strip().upper()
    if not raw:
        return True
    allow = {x.strip() for x in raw.split(",") if x.strip()}
    return str(ticker or "").strip().upper() in allow


def _to_date(d: Any) -> date | None:
    if d is None:
        return None
    if isinstance(d, date) and not isinstance(d, datetime):
        return d
    if isinstance(d, datetime):
        return d.date()
    try:
        return pd.Timestamp(d).date()
    except Exception:
        return None


def _days_between(a: date, b: date) -> int:
    return int((a - b).days)


def try_blend_pred_dm10_30_60(
    dm10: float | None,
    dm30: float | None,
    dm60: float | None,
    *,
    dm7: float | None,
    close_ser: pd.Series,
    ref_day: date,
    comp_day: date,
    gap_days: int,
    anchor_px: float,
    ticker: str,
) -> tuple[float | None, float | None, float | None, dict[str, Any]]:
    """
    Ritorna ``(dm10, dm30, dm60, meta)`` con meta diagnostici (solo se blend attivo e usato).
    """
    meta: dict[str, Any] = {"struct_method_version": _STRUCT_METHOD_VERSION}
    if not _env_blend_enabled():
        meta["struct_blend"] = "off"
        return dm10, dm30, dm60, meta
    if not _env_ticker_allowed(ticker):
        meta["struct_blend"] = "skipped_ticker_filter"
        return dm10, dm30, dm60, meta
    if anchor_px is None or float(anchor_px) <= 0:
        meta["struct_blend"] = "skipped_bad_anchor"
        return dm10, dm30, dm60, meta
    rd = _to_date(ref_day)
    cd = _to_date(comp_day)
    if rd is None or cd is None:
        meta["struct_blend"] = "skipped_bad_dates"
        return dm10, dm30, dm60, meta
    _ = gap_days  # API legacy; x_orizzonte = (CD−h)−ref (calendario), come nel fit main.
    if dm10 is None and dm30 is None and dm60 is None:
        meta["struct_blend"] = "skipped_no_baseline"
        return dm10, dm30, dm60, meta

    s = close_ser.dropna().sort_index()
    if s.empty or len(s) < 5:
        meta["struct_blend"] = "skipped_short_series"
        return dm10, dm30, dm60, meta

    try:
        cd_ts = pd.Timestamp(cd)
        pre = s[s.index < cd_ts].astype(float)
    except Exception:
        meta["struct_blend"] = "skipped_slice"
        return dm10, dm30, dm60, meta
    if len(pre) < _MIN_PRE_LEN:
        meta["struct_blend"] = "skipped_pre_cd_short"
        return dm10, dm30, dm60, meta
    if len(pre) <= 7:
        meta["struct_blend"] = "skipped_pre_cd_le7"
        return dm10, dm30, dm60, meta

    det = pre.iloc[:-7]
    if len(det) < _MIN_DET_LEN:
        meta["struct_blend"] = "skipped_det_short"
        return dm10, dm30, dm60, meta

    logp = np.log(np.clip(det.values.astype(float), 1e-12, None))
    idx = det.index
    try:
        sm = pd.Series(logp, index=idx).rolling(3, center=True, min_periods=1).mean().values
    except Exception:
        sm = logp
    d1 = np.diff(sm, prepend=np.nan)
    curv = np.diff(d1, prepend=np.nan)
    finite = curv[np.isfinite(curv)]
    if finite.size < 5:
        meta["struct_blend"] = "skipped_no_curv"
        return dm10, dm30, dm60, meta
    z_mu, z_sd = float(np.mean(finite)), float(np.std(finite))
    if z_sd < 1e-12:
        meta["struct_blend"] = "skipped_z_flat"
        return dm10, dm30, dm60, meta
    z_curv = (curv - z_mu) / z_sd
    z_curv = np.where(np.isfinite(z_curv), z_curv, 0.0)

    try:
        ret = det.astype(float).pct_change()
        vol5 = ret.rolling(5, min_periods=3).std()
        vthr = float(vol5.quantile(0.65))
    except Exception:
        vol5 = pd.Series(0.0, index=det.index)
        vthr = 0.0

    vol_ok = np.zeros(len(det), dtype=bool)
    for ii in range(len(det)):
        try:
            vv = vol5.iloc[ii]
            vol_ok[ii] = bool(np.isfinite(vv) and float(vv) > vthr)
        except Exception:
            vol_ok[ii] = False

    lam_dist = {10: 0.20, 30: 0.35, 60: 0.50}

    def _x_for_bar(ix) -> int | None:
        try:
            dd = pd.Timestamp(ix).normalize().date()
            return _days_between(dd, rd)
        except Exception:
            return None

    candidates: list[tuple[float, int, float]] = []
    for i in range(5, len(det) - 5):
        if not vol_ok[i]:
            continue
        sc = abs(float(z_curv[i]))
        if sc < 1.2:
            continue
        candidates.append((sc * (1.2 if vol_ok[i] else 0.5), i, float(z_curv[i])))
    candidates.sort(key=lambda t: -t[0])
    top_idx = [c[1] for c in candidates[:3]]
    if not top_idx:
        meta["struct_blend"] = "skipped_no_candidates"
        return dm10, dm30, dm60, meta

    def _p_struct_for_h(h: int) -> tuple[float | None, int | None, float | None]:
        # Allineato al fit main: giorni da ref_day alla data calendario (CD − h),
        # non (gap ref→CD) − h (con ref=T−7 il secondo quasi annulla −10/−30).
        x_t = int((cd - timedelta(days=int(h)) - rd).days)
        best_p: float | None = None
        best_k: int | None = None
        best_z: float | None = None
        d_lo = -h - 25
        d_hi = -h + 25
        for rank_i in top_idx:
            xd = _x_for_bar(det.index[rank_i])
            if xd is None:
                continue
            if xd < d_lo or xd > d_hi:
                continue
            lo = max(0, rank_i - 4)
            hi = min(len(det), rank_i + 5)
            win = det.iloc[lo:hi]
            if len(win) < 5:
                continue
            xs = []
            ys = []
            for ix in win.index:
                xv = _x_for_bar(ix)
                if xv is None:
                    continue
                try:
                    pv = float(win.loc[ix])
                except Exception:
                    continue
                if pv <= 0:
                    continue
                xs.append(float(xv))
                ys.append(np.log(pv))
            if len(xs) < 5:
                continue
            xa = np.array(xs, dtype=float)
            ya = np.array(ys, dtype=float)
            try:
                a, b = np.polyfit(xa, ya, 1)
                pred_log = float(a) * float(x_t) + float(b)
                p_pct = (np.exp(pred_log) / float(anchor_px) - 1.0) * 100.0
            except Exception:
                continue
            zz = abs(float(z_curv[rank_i]))
            if best_p is None or zz > (best_z or -1.0):
                best_p, best_k, best_z = p_pct, rank_i, zz
        return best_p, best_k, best_z

    out10, out30, out60 = dm10, dm30, dm60
    knots: dict[str, Any] = {}
    lambdas: dict[str, float] = {}

    for h, cur in ((-10, dm10), (-30, dm30), (-60, dm60)):
        if cur is None:
            continue
        p_s, k_i, z_u = _p_struct_for_h(abs(h))
        if p_s is None or z_u is None:
            continue
        lam_q = min(1.0, float(z_u) / _Z_CAP)
        lam = min(_LAM_MAX, lam_dist[abs(h)] * lam_q)
        if lam <= 0:
            continue
        blended = (1.0 - lam) * float(cur) + lam * float(p_s)
        if h == -10 and dm7 is not None:
            if abs(blended - float(dm7)) > _COHER_DM10_VS_DM7:
                lam *= 0.5
                blended = (1.0 - lam) * float(cur) + lam * float(p_s)
        blended = round(max(-_CAP_ABS, min(_CAP_ABS, blended)), 1)
        if h == -10:
            out10 = blended
        elif h == -30:
            out30 = blended
        else:
            out60 = blended
        knots[str(abs(h))] = k_i
        lambdas[str(abs(h))] = round(lam, 4)

    if not lambdas:
        meta["struct_blend"] = "skipped_no_blend_applied"
        return dm10, dm30, dm60, meta

    meta["struct_blend"] = "on"
    meta["struct_knots"] = knots
    meta["struct_lambda"] = lambdas
    return out10, out30, out60, meta
