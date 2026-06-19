"""
Curva Pred su fogli Simulation / Accuracy (storico e **CD ≥ oggi**).

- Nodi T−60…+7: close reali (HistLib / ``seq_curve_pct_vs_m60``) dove disponibili.
- 8‑K (finestra ``SEC_K8_LOOKBACK_DAYS``, default 180 gg): nodi a **data filing** e sedute
  +1/+2/+3; interpolazione lineare tra ancoraggi (``PRED_K8_DISPLAY_OVERLAY``).
- Storico Accuracy: stessa base **live seq** (close reali) + overlay 8‑K; non solo interp. K‑8.
"""
from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any, Mapping, Sequence


def calendar_offset_reached(
    completion_date: date | None,
    cal_offset: int,
    today: date | None = None,
) -> bool:
    """True se il giorno calendario ``CD + offset`` è già passato (close reale disponibile)."""
    if completion_date is None:
        return False
    _t = today or date.today()
    try:
        return _t >= completion_date + timedelta(days=int(cal_offset))
    except (TypeError, ValueError):
        return False


def mask_seq_pts_to_realized_calendar(
    seq_pts: Sequence[float | None] | None,
    completion_date: date | None,
    *,
    today: date | None = None,
    offsets: Sequence[int] | None = None,
) -> list[float | None]:
    """
    Azzera nodi ``seq_curve`` su orizzonti calendario non ancora raggiunti.

    I valori futuri (ultimo close + incremento modello) non devono bloccare
    l'interp. lineare tra nodi 8‑K né la curva polinomio ``model_dm*``.
    """
    import data_orchestrator as orch

    offs = offsets if offsets is not None else orch.SIMULATION_PRED_CAL_OFFSETS
    n = len(offs)
    base = list(seq_pts) if isinstance(seq_pts, (list, tuple)) else []
    if len(base) < n:
        base.extend([None] * (n - len(base)))
    else:
        base = base[:n]
    if completion_date is None:
        return base
    out: list[float | None] = []
    for i, off in enumerate(offs):
        v = base[i] if i < len(base) else None
        if not calendar_offset_reached(completion_date, int(off), today):
            out.append(None)
            continue
        out.append(v)
    return out

def simulation_post_cd_model_display_enabled() -> bool:
    """
    Post-CD **senza** close reale ancora: usa modello v4 (anti-appiattimento seq), non
    il plateau ``last_close + Δmodello``. Se il nodo calendario è già passato, resta
    il dato storico/ricalib. Disattiva: ``SIMULATION_POST_CD_MODEL_DISPLAY=0``.
    """
    return os.environ.get("SIMULATION_POST_CD_MODEL_DISPLAY", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _pred_node_has_realized_history(
    completion_date: date | None,
    cal_offset: int,
    display_val: float | None,
    *,
    today: date | None = None,
) -> bool:
    """True se il giorno CD+offset è passato e abbiamo un % da seq/live/K-8."""
    if completion_date is None:
        return False
    if display_val is None or display_val != display_val:
        return False
    return calendar_offset_reached(completion_date, int(cal_offset), today)


def merge_pred_display_historical_and_model(
    display_pts: Sequence[float | None] | None,
    model_pts: Sequence[float | None] | None,
    completion_date: date | None,
    *,
    today: date | None = None,
    offsets: Sequence[int] | None = None,
    accuracy: bool = False,
) -> list[float | None]:
    """
    Regola unificata foglio Simulation (Δ% Pred):

    1. **Storico / ricalib** — nodo calendario già raggiunto (e/o K-8 nel percorso
       ``display_pts``): mantieni il valore ricalibrato.
    2. **Predizione** — nodo futuro o senza dato: curva **modello v4** interpolata.
    3. **Post-CD predittivo** — se ``SIMULATION_POST_CD_MODEL_DISPLAY`` (default on) e
       offset > 0 senza storico: modello (no plateau seq); quando T+4/T+7 diventano
       storici, al refresh successivo passano al punto 1.

    Pre-CD senza storico: modello (non si forza 0%). Accuracy: nessun override qui.
    """
    import data_orchestrator as orch

    if accuracy:
        return list(display_pts) if isinstance(display_pts, (list, tuple)) else []
    offs = offsets if offsets is not None else orch.SIMULATION_PRED_CAL_OFFSETS
    n = len(offs)
    _t = today or date.today()
    base = list(display_pts) if isinstance(display_pts, (list, tuple)) else []
    if len(base) < n:
        base.extend([None] * (n - len(base)))
    else:
        base = base[:n]
    model = list(model_pts) if isinstance(model_pts, (list, tuple)) else []
    if len(model) < n:
        model.extend([None] * (n - len(model)))
    else:
        model = model[:n]
    _post_cd_model = simulation_post_cd_model_display_enabled()
    out: list[float | None] = []
    if completion_date is None:
        for i, off in enumerate(offs):
            bv = base[i] if i < len(base) else None
            try:
                bf = float(bv) if bv is not None and bv == bv else None
            except (TypeError, ValueError):
                bf = None
            mv = model[i] if i < len(model) else None
            try:
                mf = float(mv) if mv is not None and mv == mv else None
            except (TypeError, ValueError):
                mf = None
            if bf is not None:
                out.append(round(bf, 2))
            elif mf is not None:
                out.append(round(mf, 2))
            else:
                out.append(None)
        return out

    for i, off in enumerate(offs):
        o = int(off)
        bv = base[i] if i < len(base) else None
        try:
            bf = float(bv) if bv is not None and bv == bv else None
        except (TypeError, ValueError):
            bf = None
        mv = model[i] if i < len(model) else None
        try:
            mf = float(mv) if mv is not None and mv == mv else None
        except (TypeError, ValueError):
            mf = None

        if _pred_node_has_realized_history(completion_date, o, bf, today=_t):
            out.append(round(bf, 2))  # type: ignore[arg-type]
            continue

        if mf is not None:
            if o > 0 and not _post_cd_model:
                pass
            else:
                out.append(round(mf, 2))
                continue

        out.append(bf if bf is None else round(bf, 2))
    return out


def overlay_model_post_cd_pred_display(
    display_pts: Sequence[float | None] | None,
    model_pts: Sequence[float | None] | None,
    offsets: Sequence[int] | None = None,
    *,
    accuracy: bool = False,
    completion_date: date | None = None,
    today: date | None = None,
) -> list[float | None]:
    """Compat: delega a ``merge_pred_display_historical_and_model``."""
    return merge_pred_display_historical_and_model(
        display_pts,
        model_pts,
        completion_date,
        today=today,
        offsets=offsets,
        accuracy=accuracy,
    )


def finalize_simulation_pred_display(
    display_pts: Sequence[float | None] | None,
    pred: Mapping[str, Any] | None,
    pw: Mapping[str, Any] | None,
    *,
    completion_date: date | None = None,
    today: date | None = None,
    log_row_key: str | None = None,
    pair_empty_logged: set[str] | None = None,
) -> list[float | None]:
    """Storico dove disponibile; modello v4 sui gap e su post-CD non ancora realizzato."""
    import data_orchestrator as orch

    _dd = dict(pw if isinstance(pw, dict) else (pred if isinstance(pred, dict) else {}))
    _pred = pred if isinstance(pred, dict) else {}
    model = orch._interp_pred_pct_vs_m60_calendar(
        {**_pred, **_dd},
        orch.SIMULATION_PRED_CAL_OFFSETS,
        log_row_key=log_row_key,
        pair_empty_logged=pair_empty_logged,
    )
    return merge_pred_display_historical_and_model(
        display_pts,
        model,
        completion_date,
        today=today,
        offsets=orch.SIMULATION_PRED_CAL_OFFSETS,
        accuracy=False,
    )


def is_current_catalyst_row(completion_date: date | None, today: date | None = None) -> bool:
    """True se il CD non è ancora passato (coorte «sopra la linea» Accuracy)."""
    if completion_date is None:
        return False
    _t = today or date.today()
    try:
        return completion_date >= _t
    except TypeError:
        return False


def k8_filing_summary_from_workbook(
    wb: Any,
    ticker: str,
    cd: date | None,
    pw: Mapping[str, Any] | None = None,
    *,
    ser_cache: dict | None = None,
    sub_cache: dict | None = None,
    financial_df=None,
    cik_map: dict[str, str] | None = None,
) -> tuple[int, str]:
    """
    Returns ``(n_filings, dates_text)`` per colonne Excel.

    ``dates_text``: una riga per filing — data filing e sedute +1/+2/+3 (trade date se nota).
    Foglio «SEC K-8» se presente; altrimenti SEC live (``REFRESH_K8_LIVE_FALLBACK``, default on).
    """
    if cd is None or not str(ticker or "").strip():
        return 0, "—"
    try:
        import data_orchestrator as orch

        _cik = cik_map
        if _cik is None and isinstance(ser_cache, dict):
            _cik = ser_cache.get("__cik_map__")
        _sub = sub_cache
        if _sub is None and isinstance(ser_cache, dict):
            _sub = ser_cache.setdefault("__k8_sub__", {})
        rows = orch._ristretta_k8_rows_resolved(
            wb,
            ticker,
            cd,
            pw=dict(pw) if pw else None,
            ser_cache=ser_cache,
            sub_cache=_sub,
            financial_df=financial_df,
            cik_map=_cik,
        )
    except Exception:
        return 0, "—"
    if not rows:
        return 0, "—"

    by_filing: dict[date, list[dict]] = {}
    for r in rows:
        fd = r.get("k8_filing_date") or r.get("data_cal")
        if fd is None:
            continue
        if hasattr(fd, "date") and callable(getattr(fd, "date", None)):
            try:
                fd = fd.date()
            except Exception:
                pass
        if not isinstance(fd, date):
            continue
        by_filing.setdefault(fd, []).append(r)

    if not by_filing:
        return 0, "—"

    parts: list[str] = []
    for fd in sorted(by_filing.keys()):
        fd_s = fd.strftime("%d/%m/%Y")
        sess_bits: list[str] = []
        for r in sorted(by_filing[fd], key=lambda x: int(x.get("k8_session") or 0)):
            sess = r.get("k8_session")
            raw = r.get("data_raw")
            pct = r.get("pct_curva")
            if raw is not None and hasattr(raw, "strftime"):
                d_s = raw.strftime("%d/%m")
            else:
                d_s = "?"
            pct_s = ""
            if pct is not None:
                try:
                    pct_s = f" {float(pct):+.1f}%"
                except (TypeError, ValueError):
                    pass
            if sess is not None:
                sess_bits.append(f"+{int(sess)} {d_s}{pct_s}")
        if sess_bits:
            parts.append(f"{fd_s} ({'; '.join(sess_bits)})")
        else:
            parts.append(fd_s)

    return len(by_filing), " | ".join(parts) if parts else "—"


def live_recalib_pct_vs_m60_from_pairwise(
    pw: dict,
    cd: date,
    *,
    today: date | None = None,
    offsets: Sequence[int] | None = None,
    ser_cache: dict | None = None,
) -> list[float | None]:
    """
    Ricalcola % vs T−60 sui nodi calendario raggiunti (close reali + extrap modello).

    Scrive anche ``seq_curve_pct_vs_m60`` su ``pw`` se calcolato da HistLib.
    """
    import data_orchestrator as orch

    if offsets is None:
        offsets = orch.SIMULATION_PRED_CAL_OFFSETS
    _pw = dict(pw)
    _cache = ser_cache if ser_cache is not None else {}
    _rk = f"{_pw.get('ticker') or ''}|{cd.isoformat()}"
    orch._grafici_ensure_seq_curve_on_pairwise(
        _pw,
        cd,
        row_key=_rk,
        today=today,
        ser_cache=_cache,
        sub_cache=_cache.setdefault("__k8_sub__", {}),
    )
    pw.update(_pw)
    _seq = pw.get("seq_curve_pct_vs_m60")
    n = len(offsets)
    if isinstance(_seq, (list, tuple)) and len(_seq) >= n:
        out: list[float | None] = []
        for i in range(n):
            x = _seq[i] if i < len(_seq) else None
            if x is None or x != x:
                out.append(None)
            else:
                try:
                    out.append(round(float(x), 2))
                except (TypeError, ValueError):
                    out.append(None)
        return out
    return orch._interp_pred_pct_vs_m60_calendar(
        _pw, tuple(offsets), log_row_key=None, pair_empty_logged=None
    )


def _float_pct(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def _linear_interp_pct_at_offsets(
    target_offsets: Sequence[int],
    knots: list[tuple[int, float]],
) -> list[float | None]:
    """Interpola % vs T−60 sui nodi calendario ``target_offsets`` tra ancoraggi (offset, %)."""
    if not knots:
        return [None] * len(target_offsets)
    _kn = sorted(knots, key=lambda z: z[0])
    xs = [k[0] for k in _kn]
    ys = [k[1] for k in _kn]
    out: list[float | None] = []
    for off in target_offsets:
        t = int(off)
        if t <= xs[0]:
            out.append(round(ys[0], 2))
            continue
        if t >= xs[-1]:
            out.append(round(ys[-1], 2))
            continue
        placed = False
        for j in range(len(xs) - 1):
            x0, y0 = xs[j], ys[j]
            x1, y1 = xs[j + 1], ys[j + 1]
            if x0 <= t <= x1 and x1 != x0:
                y = y0 + (t - x0) / (x1 - x0) * (y1 - y0)
                out.append(round(float(y), 2))
                placed = True
                break
        if not placed:
            out.append(None)
    return out


def k8_pct_vs_m60_at_calendar_offset(
    ticker: str,
    cd: date,
    cal_offset: int,
    pw: Mapping[str, Any] | None = None,
    ser_cache: dict | None = None,
) -> float | None:
    """% vs T−60 al giorno calendario ``cd + cal_offset`` (close HistLib o snapshot JSON)."""
    import data_orchestrator as orch

    tk = str(ticker or "").strip().upper()
    if not tk or cd is None:
        return None
    cache = ser_cache if ser_cache is not None else {}
    p60: float | None = None
    try:
        ser = orch._histlib_accuracy_sim_resolve_close_series(tk, cache)
        if ser is not None and not getattr(ser, "empty", True):
            p60f = orch._pred_curve_close_cal(ser, cd, -60)
            if p60f is not None and float(p60f) > 0:
                p60 = float(p60f)
                po = orch._pred_curve_close_cal(ser, cd, int(cal_offset))
                if po is not None and float(po) > 0:
                    return round((float(po) / p60 - 1.0) * 100.0, 2)
    except Exception:
        pass
    _dd = pw if isinstance(pw, dict) else {}
    if p60 is None:
        for _k in ("seq_curve_t60_usd", "close_m60", "model_close_m60"):
            try:
                _px = _dd.get(_k)
                if _px is not None and float(_px) > 0:
                    p60 = float(_px)
                    break
            except (TypeError, ValueError):
                pass
    return None


def k8_recalib_knots_from_workbook(
    wb: Any,
    ticker: str,
    cd: date,
    pw: Mapping[str, Any] | None = None,
    *,
    anchor_t60_zero: bool = True,
    ser_cache: dict | None = None,
    sub_cache: dict | None = None,
    financial_df=None,
) -> list[tuple[int, float]]:
    """
    Ancoraggi ricalibrazione 8‑K: (gg cal. da CD, % vs T−60).

    Per ogni filing: nodo alla **data filing** (movimento vs T−60) + sedute +1/+2/+3.
    """
    if not str(ticker or "").strip():
        return [(-60, 0.0)] if anchor_t60_zero else []

    try:
        import data_orchestrator as orch

        _sc = ser_cache if ser_cache is not None else {}
        _sub = sub_cache
        if _sub is None and isinstance(_sc, dict):
            _sub = _sc.setdefault("__k8_sub__", {})
        rows = orch._ristretta_k8_rows_resolved(
            wb,
            ticker,
            cd,
            pw=dict(pw) if pw else None,
            ser_cache=_sc,
            sub_cache=_sub,
            financial_df=financial_df,
        )
    except Exception:
        rows = []

    by_off: dict[int, list[float]] = {}
    if anchor_t60_zero:
        by_off[-60] = [0.0]

    _tk = str(ticker).strip().upper()
    _filing_done: set[int] = set()
    for r in rows:
        _fd = r.get("k8_filing_date") or r.get("data_cal")
        if _fd is not None:
            try:
                if hasattr(_fd, "date") and callable(getattr(_fd, "date", None)):
                    _fd = _fd.date()
            except Exception:
                pass
            if isinstance(_fd, date) and cd is not None:
                try:
                    _off_f = int((_fd - cd).days)
                except Exception:
                    _off_f = None
                if _off_f is not None and _off_f not in _filing_done:
                    _filing_done.add(_off_f)
                    _pf = k8_pct_vs_m60_at_calendar_offset(
                        _tk, cd, _off_f, pw=pw, ser_cache=ser_cache
                    )
                    if _pf is None:
                        try:
                            _off_f = int(r.get("offset_filing"))
                            _pf = k8_pct_vs_m60_at_calendar_offset(
                                _tk, cd, _off_f, pw=pw, ser_cache=ser_cache
                            )
                        except (TypeError, ValueError):
                            pass
                    if _pf is not None:
                        by_off.setdefault(_off_f, []).append(_pf)
        try:
            off = int(r.get("offset"))
        except (TypeError, ValueError):
            continue
        pct = _float_pct(r.get("pct_curva"))
        if pct is None:
            pct = _float_pct(r.get("pct_reale"))
        if pct is None:
            continue
        by_off.setdefault(off, []).append(pct)

    knots: list[tuple[int, float]] = []
    for off, vals in sorted(by_off.items()):
        if vals:
            knots.append((off, round(sum(vals) / len(vals), 2)))
    return knots


def k8_interp_pct_points_in_knot_range(
    knots: list[tuple[int, float]],
    *,
    offsets: Sequence[int] | None = None,
    fallback_pts: Sequence[float | None] | None = None,
    prefer_base: Sequence[float | None] | None = None,
    completion_date: date | None = None,
    today: date | None = None,
) -> list[float | None]:
    """
    Curva display: **polinomio** (``fallback_pts`` = ``model_dm*`` interpolati) come base;
    tra i nodi 8‑K (filing + sedute +1/+2/+3) **interp. lineare**; sui giorni calendario
    già passati, ``prefer_base`` (close reale) sostituisce il nodo.

    Fuori dal range dei nodi K‑8 resta il modello (non una ``seq_curve`` piatta futura).
    """
    import data_orchestrator as orch

    if offsets is None:
        offsets = orch.SIMULATION_PRED_CAL_OFFSETS
    _fb = list(fallback_pts or [])
    _base = list(prefer_base or [])
    n = len(offsets)
    if len(_fb) < n:
        _fb.extend([None] * (n - len(_fb)))
    if len(_base) < n:
        _base.extend([None] * (n - len(_base)))

    out: list[float | None] = []
    for i in range(n):
        v_fb = _fb[i] if i < len(_fb) else None
        if v_fb is not None and v_fb == v_fb:
            try:
                out.append(round(float(v_fb), 2))
            except (TypeError, ValueError):
                out.append(None)
        else:
            out.append(None)

    _k8_only = [k for k in knots if k[0] != -60]
    if len(_k8_only) >= 1 and len(knots) >= 2:
        _from_k8 = _linear_interp_pct_at_offsets(offsets, knots)
        _min_off = min(k[0] for k in knots)
        _max_off = max(k[0] for k in knots)
        for i, off in enumerate(offsets):
            if _min_off <= int(off) <= _max_off:
                v_k8 = _from_k8[i] if i < len(_from_k8) else None
                if v_k8 is not None and v_k8 == v_k8:
                    out[i] = round(float(v_k8), 2)

    _t = today or date.today()
    for i, off in enumerate(offsets):
        if completion_date is not None and not calendar_offset_reached(
            completion_date, int(off), _t
        ):
            continue
        _live = _base[i] if i < len(_base) else None
        if _live is not None and _live == _live:
            out[i] = round(float(_live), 2)
    return out


def past_accuracy_model_pred_pct_points(
    pred: dict | None,
    pw: dict | None,
    *,
    log_row_key: str | None = None,
    pair_empty_logged: set[str] | None = None,
) -> list[float | None]:
    """
  Accuracy **storico** (CD < oggi): curva **modello v4** interpolata — confronto con
    «Storico %» (close HistLib). Non usare ``live_recalib`` qui: Pred ≈ Storico.

    Opt-in legacy (Pred = mercato anche sotto la linea): ``ACCURACY_PAST_PRED_USE_LIVE=1``.
    """
    import data_orchestrator as orch

    _dd = dict(pw if isinstance(pw, dict) else (pred if isinstance(pred, dict) else {}))
    _pred = pred if isinstance(pred, dict) else {}
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(_dd)
    orch._accuracy_sim_synthesize_interp_nodes_from_post_d_only(_dd)
    return orch._interp_pred_pct_vs_m60_calendar(
        {**_pred, **_dd},
        orch.SIMULATION_PRED_CAL_OFFSETS,
        log_row_key=log_row_key,
        pair_empty_logged=pair_empty_logged,
    )


def past_accuracy_k8_recalib_pct_points(
    pred: dict | None,
    pw: dict | None,
    completion_date: date,
    *,
    wb: Any = None,
    ser_cache: dict | None = None,
    log_row_key: str | None = None,
    pair_empty_logged: set[str] | None = None,
) -> list[float | None]:
    """
    Close reali (``live_recalib``) + overlay 8‑K — per Simulation storico, **non** per
    Pred Accuracy sotto la linea viola (usare ``past_accuracy_model_pred_pct_points``).
    """
    import data_orchestrator as orch
    from prediction.config import pred_k8_display_overlay_enabled

    _dd = dict(pw if isinstance(pw, dict) else (pred if isinstance(pred, dict) else {}))
    _pred = pred if isinstance(pred, dict) else {}
    _tk = str(_dd.get("ticker") or _pred.get("ticker") or "").strip().upper()
    if not _tk and log_row_key and "|" in str(log_row_key):
        _tk = str(log_row_key).split("|", 1)[0].strip().upper()

    offsets = orch.SIMULATION_PRED_CAL_OFFSETS
    pts = live_recalib_pct_vs_m60_from_pairwise(
        _dd,
        completion_date,
        today=date.today(),
        offsets=offsets,
        ser_cache=ser_cache,
    )
    if wb is not None and pred_k8_display_overlay_enabled() and _tk:
        _model = orch._interp_pred_pct_vs_m60_calendar(
            {**_pred, **_dd},
            offsets,
            log_row_key=log_row_key,
            pair_empty_logged=pair_empty_logged,
        )
        _knots = k8_recalib_knots_from_workbook(
            wb, _tk, completion_date, pw=_dd, ser_cache=ser_cache
        )
        pts = k8_interp_pct_points_in_knot_range(
            _knots,
            offsets=offsets,
            fallback_pts=_model,
            prefer_base=mask_seq_pts_to_realized_calendar(
                pts, completion_date, today=date.today(), offsets=offsets
            ),
            completion_date=completion_date,
            today=date.today(),
        )
    return pts


def sheet_pred_pct_points(
    pred: dict | None,
    pw: dict | None,
    *,
    completion_date: date | None,
    is_past: bool,
    accuracy: bool = False,
    today: date | None = None,
    wb: Any = None,
    ser_cache: dict | None = None,
    log_row_key: str | None = None,
    pair_empty_logged: set[str] | None = None,
) -> list[float | None]:
    """
    Punti % Pred per foglio Simulation / Accuracy.

    - **Nodo calendario passato** (e/o K-8 già nel workbook): close / seq ricalibrata.
    - **Nodo futuro o senza dato**: modello v4; al passaggio del nodo il refresh
      sostituisce con lo storico (``seq_curve``, HistLib, overlay 8-K).
    - **Simulation**: ``finalize_simulation_pred_display`` — post-CD ancora predittivo
      usa il modello (anti-appiattimento); post-CD già realizzato resta storico.
    """
    import data_orchestrator as orch
    from prediction.config import pred_k8_display_overlay_enabled

    _dd = dict(pw if isinstance(pw, dict) else (pred if isinstance(pred, dict) else {}))
    _pred = pred if isinstance(pred, dict) else {}
    _tk = str(_dd.get("ticker") or _pred.get("ticker") or "").strip().upper()
    if not _tk and log_row_key and "|" in str(log_row_key):
        _tk = str(log_row_key).split("|", 1)[0].strip().upper()

    if is_past and completion_date is not None:
        if accuracy:
            _use_live_past = os.environ.get(
                "ACCURACY_PAST_PRED_USE_LIVE", ""
            ).strip().lower() in ("1", "true", "yes", "on")
            if _use_live_past:
                _past_pts = past_accuracy_k8_recalib_pct_points(
                    _pred,
                    _dd,
                    completion_date,
                    wb=wb,
                    ser_cache=ser_cache,
                    log_row_key=log_row_key,
                    pair_empty_logged=pair_empty_logged,
                )
            else:
                _past_pts = past_accuracy_model_pred_pct_points(
                    _pred,
                    _dd,
                    log_row_key=log_row_key,
                    pair_empty_logged=pair_empty_logged,
                )
            return _past_pts
        _past_pts = past_accuracy_k8_recalib_pct_points(
            _pred,
            _dd,
            completion_date,
            wb=wb,
            ser_cache=ser_cache,
            log_row_key=log_row_key,
            pair_empty_logged=pair_empty_logged,
        )
        return finalize_simulation_pred_display(
            _past_pts,
            _pred,
            _dd,
            completion_date=completion_date,
            today=today,
            log_row_key=log_row_key,
            pair_empty_logged=pair_empty_logged,
        )

    if not is_past and completion_date is not None:
        pts = live_recalib_pct_vs_m60_from_pairwise(
            _dd,
            completion_date,
            today=today,
            offsets=orch.SIMULATION_PRED_CAL_OFFSETS,
            ser_cache=ser_cache,
        )
        try:
            from prediction.pipeline import apply_v5_sim_display_to_pred_points

            pts = apply_v5_sim_display_to_pred_points(
                pts, {**_pred, **_dd}, offsets=orch.SIMULATION_PRED_CAL_OFFSETS
            )
        except Exception:
            pass
        if accuracy:
            _has_pt = any(
                p is not None and p == p for p in (pts or [])
            )
            if not _has_pt:
                pts = orch._interp_pred_pct_vs_m60_calendar(
                    {**_pred, **_dd},
                    orch.SIMULATION_PRED_CAL_OFFSETS,
                    log_row_key=log_row_key,
                    pair_empty_logged=pair_empty_logged,
                )
        if wb is not None and pred_k8_display_overlay_enabled() and _tk:
            _model = orch._interp_pred_pct_vs_m60_calendar(
                {**_pred, **_dd},
                orch.SIMULATION_PRED_CAL_OFFSETS,
                log_row_key=log_row_key,
                pair_empty_logged=pair_empty_logged,
            )
            _knots = k8_recalib_knots_from_workbook(
                wb, _tk, completion_date, pw=_dd, ser_cache=ser_cache
            )
            pts = k8_interp_pct_points_in_knot_range(
                _knots,
                fallback_pts=_model,
                prefer_base=mask_seq_pts_to_realized_calendar(
                    pts, completion_date, today=today, offsets=orch.SIMULATION_PRED_CAL_OFFSETS
                ),
                completion_date=completion_date,
                today=today,
            )
        if accuracy:
            return pts
        return finalize_simulation_pred_display(
            pts,
            _pred,
            _dd,
            completion_date=completion_date,
            today=today,
            log_row_key=log_row_key,
            pair_empty_logged=pair_empty_logged,
        )

    _legacy = orch._sheet_blended_pred_pct_vs_m60(
        _pred,
        _dd,
        accuracy=accuracy,
        log_row_key=log_row_key,
        pair_empty_logged=pair_empty_logged,
    )
    if (
        wb is not None
        and completion_date is not None
        and pred_k8_display_overlay_enabled()
        and _tk
    ):
        _model = orch._interp_pred_pct_vs_m60_calendar(
            {**_pred, **_dd},
            orch.SIMULATION_PRED_CAL_OFFSETS,
            log_row_key=log_row_key,
            pair_empty_logged=pair_empty_logged,
        )
        _knots = k8_recalib_knots_from_workbook(
            wb, _tk, completion_date, pw=_dd, ser_cache=ser_cache
        )
        _pts = k8_interp_pct_points_in_knot_range(
            _knots,
            fallback_pts=_model,
            prefer_base=mask_seq_pts_to_realized_calendar(
                _legacy,
                completion_date,
                today=today,
                offsets=orch.SIMULATION_PRED_CAL_OFFSETS,
            ),
            completion_date=completion_date,
            today=today,
        )
    else:
        _pts = _legacy
    if accuracy:
        return _pts
    return finalize_simulation_pred_display(
        _pts,
        _pred,
        _dd,
        completion_date=completion_date,
        today=today,
        log_row_key=log_row_key,
        pair_empty_logged=pair_empty_logged,
    )


def simulation_pred_node_kinds(
    pred: Mapping[str, Any] | None,
    pw: Mapping[str, Any] | None,
    completion_date: date | None,
    display_pts: Sequence[float | None] | None,
    *,
    today: date | None = None,
    ser_cache: dict | None = None,
    match_tol_pp: float = 0.2,
) -> list[str | None]:
    """
    Per ogni nodo ``SIMULATION_PRED_CAL_OFFSETS`` sul foglio Simulation:

    - ``historical``: % mostrata coincide con il close reale a quel giorno calendario
      (sostituzione con dato di mercato).
    - ``recalibrated``: valore presente ma non ancorato al solo close (extrap modello,
      blend seq→modello, 8‑K senza close, orizzonte futuro).
    - ``None``: cella vuota / non classificabile — styling predefinito.
    """
    import data_orchestrator as orch
    from datetime import timedelta as _td

    offsets = orch.SIMULATION_PRED_CAL_OFFSETS
    n = len(offsets)
    _disp = list(display_pts or [])
    if len(_disp) < n:
        _disp.extend([None] * (n - len(_disp)))
    if completion_date is None:
        return [None] * n

    _dd = dict(pw if isinstance(pw, dict) else (pred if isinstance(pred, dict) else {}))
    _tk = str(_dd.get("ticker") or (pred or {}).get("ticker") or "").strip().upper()
    if not _tk:
        return [None] * n

    _t = today or date.today()
    _cache = ser_cache if ser_cache is not None else {}
    _ser = None
    try:
        _ser = orch._histlib_accuracy_sim_resolve_close_series(_tk, _cache)
    except Exception:
        _ser = None

    _p60 = None
    if _ser is not None and not getattr(_ser, "empty", True):
        try:
            _p60f = orch._pred_curve_close_cal(_ser, completion_date, -60)
            if _p60f is not None and float(_p60f) > 0:
                _p60 = float(_p60f)
        except Exception:
            _p60 = None
    if _p60 is None:
        _px = _dd.get("seq_curve_t60_usd") or (pred or {}).get("seq_curve_t60_usd")
        try:
            if _px is not None and float(_px) > 0:
                _p60 = float(_px)
        except (TypeError, ValueError):
            _p60 = None

    kinds: list[str | None] = []
    for i, off in enumerate(offsets):
        _shown = _float_pct(_disp[i] if i < len(_disp) else None)
        if _shown is None:
            kinds.append(None)
            continue
        try:
            _reached = _t >= completion_date + _td(days=int(off))
        except TypeError:
            _reached = False
        if not _reached:
            kinds.append("recalibrated")
            continue
        if int(off) == -60:
            kinds.append("historical" if _p60 is not None else "recalibrated")
            continue
        _hist_pp: float | None = None
        if _ser is not None and _p60 is not None:
            try:
                _po = orch._pred_curve_close_cal(_ser, completion_date, int(off))
                if _po is not None and float(_po) > 0:
                    _hist_pp = round((float(_po) / float(_p60) - 1.0) * 100.0, 2)
            except Exception:
                _hist_pp = None
        if _hist_pp is not None and abs(float(_shown) - float(_hist_pp)) <= float(match_tol_pp):
            kinds.append("historical")
        else:
            kinds.append("recalibrated")
    return kinds
