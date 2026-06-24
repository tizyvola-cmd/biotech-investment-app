"""Apply data-quality patches to prediction/pipeline.py."""
from __future__ import annotations

from pathlib import Path

p = Path(__file__).resolve().parents[1] / "prediction" / "pipeline.py"
src = p.read_text(encoding="utf-8")


def rep(old: str, new: str, label: str) -> None:
    global src
    if old not in src:
        raise SystemExit(f"MISSING: {label}")
    src = src.replace(old, new, 1)


rep(
    """from prediction.config import pred_curve_seq_env_enabled
from prediction.curve_fit import fit_precat_from_pairs
from prediction.direction_ensemble import direction_ensemble
from prediction.market_data import close_series_from_raw, options_signals
from prediction.reconcile import reconcile_direction_and_curve""",
    """from prediction.config import (
    pred_curve_seq_env_enabled,
    pred_require_options,
    pred_require_price,
)
from prediction.curve_fit import fit_precat_from_pairs
from prediction.data_quality import (
    build_data_quality_report,
    format_dq_adj_tag,
)
from prediction.direction_ensemble import direction_ensemble
from prediction.market_data import (
    OptionsSignalsResult,
    close_series_from_raw,
    options_signals,
)
from prediction.reconcile import reconcile_direction_and_curve""",
    "imports",
)

rep(
    """    def _one_opt_prefetch(_tkx: str) -> tuple[str, dict]:
        if _tkx not in closes:
            return _tkx, {}
        _pn = _last_close_scalar(closes[_tkx])
        if _pn is None or _pn <= 0:
            return _tkx, {}
        try:
            return _tkx, _options_signals(_tkx, _pn)
        except Exception:
            return _tkx, {}""",
    """    def _one_opt_prefetch(_tkx: str) -> tuple[str, OptionsSignalsResult]:
        if _tkx not in closes:
            return _tkx, OptionsSignalsResult({}, ok=False, error="serie prezzo 60d assente")
        _pn = _last_close_scalar(closes[_tkx])
        if _pn is None or _pn <= 0:
            return _tkx, OptionsSignalsResult({}, ok=False, error="ultimo prezzo non valido")
        return _tkx, _options_signals(_tkx, _pn)""",
    "_one_opt_prefetch",
)

src = src.replace(
    "    _opts_by_ticker: dict[str, dict] = {}",
    "    _opts_by_ticker: dict[str, OptionsSignalsResult] = {}",
    1,
)

rep(
    """    except Exception as _xe:
        print(f"[Pred] XBI non disponibile: {_xe}")

    # ── 5y Close""",
    """    except Exception as _xe:
        print(f"[Pred] XBI non disponibile: {_xe}", flush=True)

    _xbi_batch_ok = _xbi is not None and not getattr(_xbi, "empty", True)

    # ── 5y Close""",
    "xbi_batch_ok",
)

rep(
    """        p_now = _last_close_scalar(hist)
        if p_now is None or p_now <= 0:
            print(f"[Pred] {ticker} — ultimo prezzo non valido (serie corrotta?), skip")
            continue

        # Segnali base""",
    """        p_now = _last_close_scalar(hist)
        if p_now is None or p_now <= 0:
            print(f"[Pred] {ticker} — ultimo prezzo non valido (serie corrotta?), skip")
            continue

        _opt_res = _opts_by_ticker.get(ticker) or OptionsSignalsResult(
            {}, ok=False, error="opzioni non scaricate"
        )
        if not isinstance(_opt_res, OptionsSignalsResult):
            _opt_res = OptionsSignalsResult(
                dict(_opt_res) if _opt_res else {},
                ok=bool(_opt_res),
                error=None if _opt_res else "legacy empty",
            )
        _vol_ok = vol is not None and not getattr(vol, "empty", True) and len(vol.dropna()) >= 10
        _hist5_ok = bool(
            closes_long.get(ticker) is not None
            and not getattr(closes_long.get(ticker), "empty", True)
        )
        _dq = build_data_quality_report(
            price_ok=True,
            volume_ok=_vol_ok,
            xbi_ok=_xbi_batch_ok,
            options_ok=_opt_res.ok,
            hist_5y_ok=_hist5_ok,
            options_error=_opt_res.error,
        )
        if pred_require_options() and not _dq.options_ok:
            print(
                f"[Pred] {ticker} — PRED_REQUIRE_OPTIONS: opzioni assenti "
                f"({_opt_res.error or 'n/d'}); evento saltato.",
                flush=True,
            )
            continue

        # Segnali base""",
    "dq_before_signals",
)

rep(
    """        # ── Segnali da opzioni v4 ─────────────────────────────────────────────
        opts        = _opts_by_ticker.get(ticker) or {}
        pcr_val     = opts.get("pcr")
        exp_mv_val  = opts.get("exp_move_pct")""",
    """        # ── Segnali da opzioni v4 ─────────────────────────────────────────────
        opts        = _opt_res.signals
        pcr_val     = opts.get("pcr")
        exp_mv_val  = opts.get("exp_move_pct")""",
    "opts_extract",
)

rep(
    """        _dir_ens = direction_ensemble(
            ph_num, exc, slope, rsi_val,
            vr, va, run_up, slope_5d, slope_20d,
            run_up_7d=run_up_7d, ath_prox=ath_prox, vol_px_div=vpd,
            pcr=pcr_val, exp_move_pct=exp_mv_val, days_to_t=days_to_t,
            return_detail=True,
            calibration_records=_calib_recs,
        )""",
    """        _dir_ens = direction_ensemble(
            ph_num, exc, slope, rsi_val,
            vr, va, run_up, slope_5d, slope_20d,
            run_up_7d=run_up_7d, ath_prox=ath_prox, vol_px_div=vpd,
            pcr=pcr_val, exp_move_pct=exp_mv_val, days_to_t=days_to_t,
            return_detail=True,
            calibration_records=_calib_recs,
            price_ok=_dq.price_ok,
            data_quality_score=_dq.quality_score,
        )""",
    "direction_ensemble_dq",
)

rep(
    """        adj_notes = "; ".join(_ens_notes)

        _dir_pre_clinical = direction_adj""",
    """        adj_notes = "; ".join(_ens_notes)
        _dq_tag = format_dq_adj_tag(_dq)
        if _dq_tag:
            adj_notes = f"{adj_notes}; {_dq_tag}" if adj_notes else _dq_tag

        _dir_pre_clinical = direction_adj""",
    "dq_tag_adj_notes",
)

# Wrap curve fit: skip when price required but missing (should not happen after continue)
rep(
    """        # Curve fitting (per le estrapolazioni d1/w1/m1 nel tooltip)
        pairs = []
        for d, price in _fit_series.items():
            dx = (d - today).days
            # Finestra precat in gg calendario vs **oggi** (stesso asse usato per T−k).
            if -130 <= dx <= 0 and float(price) > 0:
                pairs.append((float(dx), (float(price) / p_now - 1.0) * 100.0))
        best_r2   = None
        best_name = "N/D"
        model_dm7_pct = model_dm5_pct = model_dm3_pct = None
        model_dm10_pct = model_dm30_pct = model_dm60_pct = None
        model_d4_pct = model_d7_pct = None
        d3_pct = d5_pct = d10_pct = d30_pct = None
        _fit = fit_precat_from_pairs(
            pairs, int(days_to_t), ticker=ticker, log_short_fit=True)
        if _fit is not None:""",
    """        # Curve fitting (per le estrapolazioni d1/w1/m1 nel tooltip)
        pairs = []
        _skip_curve = pred_require_price() and not _dq.price_ok
        if not _skip_curve:
            for d, price in _fit_series.items():
                dx = (d - today).days
                # Finestra precat in gg calendario vs **oggi** (stesso asse usato per T−k).
                if -130 <= dx <= 0 and float(price) > 0:
                    pairs.append((float(dx), (float(price) / p_now - 1.0) * 100.0))
        best_r2   = None
        best_name = "N/D (DQ)" if _skip_curve else "N/D"
        model_dm7_pct = model_dm5_pct = model_dm3_pct = None
        model_dm10_pct = model_dm30_pct = model_dm60_pct = None
        model_d4_pct = model_d7_pct = None
        d3_pct = d5_pct = d10_pct = d30_pct = None
        _fit = None
        if _skip_curve and "curva non stimata" not in adj_notes:
            adj_notes = (
                f"{adj_notes}; DQ: curva non stimata (prezzo)"
                if adj_notes
                else "DQ: curva non stimata (prezzo)"
            )
        if not _skip_curve:
            _fit = fit_precat_from_pairs(
                pairs, int(days_to_t), ticker=ticker, log_short_fit=True)
        if _fit is not None:""",
    "skip_curve_guard",
)

# Add data_quality fields to _pred_row
rep(
    """            "adj_notes":      adj_notes,
            "price_at_cd": (""",
    """            "adj_notes":      adj_notes,
            "data_quality": _dq.to_dict(),
            "data_quality_score": _dq.quality_score,
            "data_missing": list(_dq.missing),
            "price_at_cd": (""",
    "pred_row_dq_fields",
)

p.write_text(src, encoding="utf-8")
print("patched", p)
