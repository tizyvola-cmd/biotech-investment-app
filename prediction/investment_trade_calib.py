"""
Fase B — ricalibrazione soglie buy/sell dai trade reali (Simulation + decision log).

Legge le posizioni costruite da ``investment_sim_outcomes`` (entry/exit slope, P&L)
e stima soglie ottimali con griglia + vincolo minimo campioni.

Output: ``data/investment_trade_calib.json``
La UI Decision Lab legge il JSON via API e applica le soglie a Action / ranking.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import INVESTMENT_TRADE_CALIB_JSON

MIN_CASES_RELIABLE = 5
PNL_WIN_PCT = 1.0
PNL_WIN_EUR = 25.0

# Default allineati a investment_sim_outcomes QA + InvestmentSignalsPanel
DEFAULTS: dict[str, float] = {
    "buy_slope20d_min_pp_per_day": 0.10,
    "sell_slope20d_max_pp_per_day": -0.30,
    "slope_significant_pp_per_day": 0.30,
    "slope_flat_pp_per_day": 0.10,
    "pred_significant_pp": 0.50,
    "score_forte_min": 60.0,
    "score_watch_min": 40.0,
    "score_monitor_min": 28.0,
    "affid_min_pct_for_quality": 40.0,
    "expected_hit_min_pct": 70.0,
    "dynamic_slope_flat_pp_per_day": 0.05,
}


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _is_win(pnl_pct: float | None, pnl_eur: float | None) -> bool:
    pe = pnl_eur if pnl_eur is not None else 0.0
    pp = pnl_pct if pnl_pct is not None else 0.0
    return pe > PNL_WIN_EUR or pp > PNL_WIN_PCT


def _entry_slope20(p: dict) -> float | None:
    for k in ("entry_slope_20d", "pre_cd_slope_20d", "latest_slope_20d"):
        v = _num(p.get(k))
        if v is not None:
            return v
    return None


def _mirror_entry_score(p: dict) -> float | None:
    """Approssimazione ``computeScore`` TS per taratura soglie Action."""
    aff_raw = _num(p.get("entry_affidabilita_pct")) or _num(p.get("affidabilita_pct"))
    r2 = _num(p.get("entry_r2_fit")) or _num(p.get("r2_fit"))
    pred5 = _num(p.get("entry_pred5_pp")) or _num(p.get("pred5_pp"))
    days = p.get("days_to_cd")
    s5 = _num(p.get("entry_slope_5d")) or _num(p.get("latest_slope_5d"))

    if aff_raw is None and r2 is None:
        return None
    aff = aff_raw / 100.0 if aff_raw is not None and aff_raw > 1.5 else aff_raw
    affid_score = min(1.0, max(0.0, aff or 0)) * 35
    r2_score = min(1.0, max(0.0, r2 or 0)) * 20
    timing_score = 0.0
    if isinstance(days, (int, float)) and days >= 0:
        d = int(days)
        if d <= 7:
            timing_score = 20
        elif d <= 14:
            timing_score = 17
        elif d <= 30:
            timing_score = 14
        elif d <= 45:
            timing_score = 13
        elif d <= 60:
            timing_score = 6
        else:
            timing_score = 2
    slope_align = 0.0
    pred_sig = DEFAULTS["pred_significant_pp"]
    if s5 is not None and pred5 is not None:
        aligned = (s5 > 0) == (pred5 > 0)
        if not aligned:
            slope_align = -15 if abs(pred5) >= 1 else (-10 if abs(pred5) >= pred_sig else -4)
        elif abs(pred5) >= 1:
            slope_align = 8
        elif abs(pred5) >= pred_sig:
            slope_align = 5
        elif abs(pred5) >= 0.15:
            slope_align = 2
    pred_score = 0.0
    if pred5 is not None and pred5 > 0:
        trust = 0.5 * min(1.0, max(0.0, r2 or 0)) + 0.5 * min(1.0, max(0.0, aff or 0))
        pred_score = min(12.0, (pred5 / 5.0) * 12.0 * (0.5 + 0.5 * trust))
    return round(affid_score + r2_score + timing_score + slope_align + pred_score)


def _grid_pick(
    candidates: list[float],
    cases: list[dict],
    *,
    apply_threshold,
    min_n: int = MIN_CASES_RELIABLE,
) -> tuple[float, dict[str, Any]]:
    """Sceglie la soglia con miglior win_rate tra i casi che la attivano."""
    best_t = candidates[0]
    best_stats: dict[str, Any] = {
        "n": 0,
        "win_rate_pct": None,
        "score": -1.0,
    }
    for t in candidates:
        triggered = [c for c in cases if apply_threshold(c, t)]
        n = len(triggered)
        if n < 1:
            continue
        wins = sum(1 for c in triggered if c.get("_win"))
        wr = wins / n
        # Preferisce win_rate alta; a parità, più campioni
        score = wr + min(n, 20) * 0.002
        if score > best_stats.get("score", -1):
            best_t = t
            best_stats = {
                "n": n,
                "win_rate_pct": round(100.0 * wr, 1),
                "score": score,
            }
    reliable = best_stats["n"] >= min_n
    return best_t, {**best_stats, "reliable": reliable}


def compute_trade_calibration(positions: list[dict] | None) -> dict[str, Any]:
    """
    Calibra soglie buy/sell/action da posizioni Simulation (aperte + cicli chiusi).
    """
    rows = [p for p in (positions or []) if isinstance(p, dict)]
    for p in rows:
        p["_win"] = _is_win(_num(p.get("pnl_pct")), _num(p.get("pnl_eur")))

    buy_cases = [
        p
        for p in rows
        if _entry_slope20(p) is not None and _num(p.get("pnl_pct")) is not None
    ]
    sell_cases = [
        p
        for p in rows
        if _num(p.get("exit_slope_20d")) is not None
        and (
            _num(p.get("pnl_pct")) is not None
            or p.get("sell_signal_after_move_pct") is not None
        )
    ]
    score_cases = [
        p
        for p in rows
        if _mirror_entry_score(p) is not None and _num(p.get("pnl_pct")) is not None
    ]

    buy_t, buy_stats = _grid_pick(
        [round(x * 0.025, 3) for x in range(2, 11)],  # 0.05 .. 0.25
        buy_cases,
        apply_threshold=lambda c, t: (_entry_slope20(c) or 0) >= t,
    )
    if not buy_stats.get("reliable"):
        buy_t = DEFAULTS["buy_slope20d_min_pp_per_day"]
        buy_stats["note"] = "default (pochi trade con slope entry + P&L)"

    sell_t, sell_stats = _grid_pick(
        [round(-0.15 - i * 0.05, 2) for i in range(7)],  # -0.15 .. -0.45
        sell_cases,
        apply_threshold=lambda c, t: (_num(c.get("exit_slope_20d")) or 0) <= t,
        min_n=max(3, MIN_CASES_RELIABLE - 2),
    )
    if not sell_stats.get("reliable"):
        sell_t = DEFAULTS["sell_slope20d_max_pp_per_day"]
        sell_stats["note"] = "default (pochi exit con slope)"

    # Soglie score: massimizza win_rate su bucket forte/watch
    forte_t = DEFAULTS["score_forte_min"]
    watch_t = DEFAULTS["score_watch_min"]
    forte_stats: dict[str, Any] = {"n": 0, "reliable": False}
    watch_stats: dict[str, Any] = {"n": 0, "reliable": False}
    if len(score_cases) >= MIN_CASES_RELIABLE:
        best_f, best_fs = DEFAULTS["score_forte_min"], {"score": -1.0, "n": 0}
        for t in range(45, 76, 5):
            chunk = [c for c in score_cases if (_mirror_entry_score(c) or 0) >= t]
            if len(chunk) < 3:
                continue
            wr = sum(1 for c in chunk if c.get("_win")) / len(chunk)
            sc = wr + len(chunk) * 0.001
            if sc > best_fs["score"]:
                best_f, best_fs = float(t), {"score": sc, "n": len(chunk), "win_rate_pct": round(100 * wr, 1)}
        if best_fs["n"] >= MIN_CASES_RELIABLE:
            forte_t, forte_stats = best_f, {**best_fs, "reliable": True}

        best_w, best_ws = DEFAULTS["score_watch_min"], {"score": -1.0, "n": 0}
        for t in range(28, 56, 4):
            chunk = [c for c in score_cases if (_mirror_entry_score(c) or 0) >= t]
            if len(chunk) < 3:
                continue
            wr = sum(1 for c in chunk if c.get("_win")) / len(chunk)
            sc = wr + len(chunk) * 0.001
            if sc > best_ws["score"]:
                best_w, best_ws = float(t), {"score": sc, "n": len(chunk), "win_rate_pct": round(100 * wr, 1)}
        if best_ws["n"] >= MIN_CASES_RELIABLE:
            watch_t, watch_stats = best_w, {**best_ws, "reliable": True}
        if forte_t <= watch_t:
            watch_t = max(28.0, forte_t - 12.0)

    # Affidabilità minima: soglia più bassa con win_rate >= 50% e n>=3
    aff_cases = [
        p for p in rows if _num(p.get("entry_affidabilita_pct") or p.get("affidabilita_pct")) is not None
        and _num(p.get("pnl_pct")) is not None
    ]
    aff_min = DEFAULTS["affid_min_pct_for_quality"]
    aff_stats: dict[str, Any] = {"n": 0, "reliable": False}
    if len(aff_cases) >= MIN_CASES_RELIABLE:
        scored_aff = sorted(
            (
                (_num(p.get("entry_affidabilita_pct") or p.get("affidabilita_pct")), p)
                for p in aff_cases
            ),
            key=lambda t: t[0] or 0,
        )
        for threshold in (35, 40, 45, 50, 55, 60, 65, 70):
            chunk = [p for a, p in scored_aff if a is not None and a >= threshold]
            if len(chunk) < 3:
                continue
            wr = sum(1 for c in chunk if c.get("_win")) / len(chunk)
            if wr >= 0.5:
                aff_min = float(threshold)
                aff_stats = {
                    "n": len(chunk),
                    "win_rate_pct": round(100 * wr, 1),
                    "reliable": len(chunk) >= MIN_CASES_RELIABLE,
                }
                break

    n_closed = sum(1 for p in rows if p.get("cd_passed") or "#cycle" in str(p.get("row_key", "")))
    n_open = sum(1 for p in rows if not p.get("cd_passed") and "#cycle" not in str(p.get("row_key", "")))

    thresholds = {
        "buy_slope20d_min_pp_per_day": {
            "value": round(buy_t, 3),
            "default": DEFAULTS["buy_slope20d_min_pp_per_day"],
            **buy_stats,
        },
        "sell_slope20d_max_pp_per_day": {
            "value": round(sell_t, 3),
            "default": DEFAULTS["sell_slope20d_max_pp_per_day"],
            **sell_stats,
        },
        "slope_significant_pp_per_day": {
            "value": round(min(0.45, max(0.15, buy_t * 2.5)), 3),
            "default": DEFAULTS["slope_significant_pp_per_day"],
            "reliable": buy_stats.get("reliable", False),
            "note": "derivato da buy_slope (≈2.5×) se calib buy affidabile",
        },
        "slope_flat_pp_per_day": {
            "value": DEFAULTS["slope_flat_pp_per_day"],
            "default": DEFAULTS["slope_flat_pp_per_day"],
            "reliable": False,
            "note": "fisso (histlib 5330 traiettorie)",
        },
        "pred_significant_pp": {
            "value": DEFAULTS["pred_significant_pp"],
            "default": DEFAULTS["pred_significant_pp"],
            "reliable": False,
        },
        "score_forte_min": {
            "value": round(forte_t, 1),
            "default": DEFAULTS["score_forte_min"],
            **forte_stats,
        },
        "score_watch_min": {
            "value": round(watch_t, 1),
            "default": DEFAULTS["score_watch_min"],
            **watch_stats,
        },
        "score_monitor_min": {
            "value": DEFAULTS["score_monitor_min"],
            "default": DEFAULTS["score_monitor_min"],
            "reliable": False,
        },
        "affid_min_pct_for_quality": {
            "value": round(aff_min, 1),
            "default": DEFAULTS["affid_min_pct_for_quality"],
            **aff_stats,
        },
        "expected_hit_min_pct": {
            "value": DEFAULTS["expected_hit_min_pct"],
            "default": DEFAULTS["expected_hit_min_pct"],
            "reliable": False,
            "note": "filtro Top Opp — ancora da cohort; trade-calib non lo modifica",
        },
        "dynamic_slope_flat_pp_per_day": {
            "value": DEFAULTS["dynamic_slope_flat_pp_per_day"],
            "default": DEFAULTS["dynamic_slope_flat_pp_per_day"],
            "reliable": False,
        },
    }

    any_reliable = any(
        thresholds[k].get("reliable") for k in ("buy_slope20d_min_pp_per_day", "sell_slope20d_max_pp_per_day")
    )

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "investment_sim_outcomes positions + decision_log",
        "n_positions": len(rows),
        "n_buy_cases": len(buy_cases),
        "n_sell_cases": len(sell_cases),
        "n_closed": n_closed,
        "n_open": n_open,
        "calibration_reliable": any_reliable,
        "min_cases_for_calibration": MIN_CASES_RELIABLE,
        "thresholds": thresholds,
        "note": (
            "Soglie tarate sui trade Simulation (entry/exit log). "
            "Rigenerare con rebuild sim-outcomes dopo buy/sell."
        ),
    }


def write_investment_trade_calibration(
    positions: list[dict] | None,
    path: str | Path | None = None,
) -> dict[str, Any]:
    payload = compute_trade_calibration(positions)
    out = Path(path or INVESTMENT_TRADE_CALIB_JSON)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"[TradeCalib] n={payload.get('n_positions')} buy_cases={payload.get('n_buy_cases')} "
        f"buy_slope>={payload['thresholds']['buy_slope20d_min_pp_per_day']['value']} "
        f"sell_slope<={payload['thresholds']['sell_slope20d_max_pp_per_day']['value']} "
        f"-> {out}",
        flush=True,
    )
    return payload


def read_investment_trade_calibration(path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path or INVESTMENT_TRADE_CALIB_JSON)
    if not p.is_file():
        return {
            "schema_version": 1,
            "thresholds": {
                k: {"value": v, "default": v, "reliable": False}
                for k, v in DEFAULTS.items()
            },
            "error": "file_missing",
        }
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"schema_version": 1, "error": str(exc), "thresholds": {}}


def get_threshold(name: str, calib: dict | None = None) -> float:
    doc = calib if isinstance(calib, dict) else read_investment_trade_calibration()
    th = (doc.get("thresholds") or {}).get(name) or {}
    v = th.get("value")
    if v is not None:
        try:
            return float(v)
        except (TypeError, ValueError):
            pass
    return float(DEFAULTS.get(name, 0.0))
