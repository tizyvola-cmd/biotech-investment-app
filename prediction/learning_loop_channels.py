"""Quantify each learning loop's impact across the THREE channels that actually
matter for the app, as structured data for the redesigned Model Recalibration tab:

  1. PREDICTION CURVE -> direction-hit % + calibration error (signed bias / MAE)
  2. RECOMMENDATION   -> directional follow-through by action: BUY -> P(price up),
                         SELL -> P(price down) after exit (by exit reason),
                         HOLD -> rescue-score vs rebound (computed in the UI sheet)
  3. TRADING (output) -> P&L per trade + win-rate

This mirrors the read-only diagnostic (``diag_loop_channel_impact.py``) but returns
numbers instead of printing them, exposes a per-channel WEEKLY series, and persists
a weekly snapshot (``data/learning_loop_weekly_impact.json``) so each channel's
contribution can be tracked over time.

Design notes baked in (kept honest):
  * The magnitude loops (global cal_factor, cluster cal_factor, regime multiplier)
    are multiplicative on |pred| and PRESERVE SIGN, so they cannot move
    direction-hit (delta is exactly 0 by construction). Their only
    prediction-channel lever is the calibration error, bounded by |factor-1|.
    The walk-forward measurement showed these contributions are ~0 or slightly
    negative, hence they are flagged as guardrails, not levers.
  * The only prediction loop that can move direction-hit is the daily curve
    recalibration (it reshapes the curve and can flip sign).
  * Recommendation & trading channels read the sim/decision-log positions, which
    carry entry SDS + regime once the sim is rebuilt after the logging change.
"""
from __future__ import annotations

import datetime as _dt
import json
import statistics
from pathlib import Path
from typing import Any, Callable

from orchestrator_io_paths import DATA_DIR, MODEL_SIGN_CURVE_DAILY_JSON

LEARNING_LOOP_WEEKLY_IMPACT_JSON = Path(DATA_DIR) / "learning_loop_weekly_impact.json"

# Noise bands (pp): a calibration MAE move smaller than this is treated as noise.
_MAE_NOISE_PP = 0.5

# Pre-CD weekly improvement: a week needs this many sessions to be trusted, and the
# week-over-week sign-hit must move at least this much to be flagged "significant".
_PRED_WEEK_MIN_N = 20
_PRED_SIGNIFICANT_PP = 3.0

# Recommendation channel: a |move| under this band (pp) is treated as flat (no
# direction), matching the sim's PNL_FLAT_PCT. SELL exits classified by these
# reasons count as rule-driven SELL recommendations (see sds_investment_decision).
_REC_FLAT_PCT = 1.0
_SELL_REASONS = ("stop_loss", "sds_below_40", "pre_cd_exit")


# ────────────────────────── numeric helpers ──────────────────────────
def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def _round(v: float | None, n: int = 2) -> float | None:
    return round(v, n) if v is not None else None


def _round_pct(v: float | None, n: int = 1) -> float | None:
    return round(100.0 * v, n) if v is not None else None


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat()


def _current_iso_week() -> str:
    y, w, _ = _dt.date.today().isocalendar()
    return f"{y}-W{w:02d}"


def _iso_week(date_str: str | None) -> str | None:
    if not date_str:
        return None
    try:
        d = _dt.datetime.strptime(str(date_str)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _first_date(r: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = r.get(k)
        if v:
            return str(v)[:10]
    return None


# ────────────────────────── prediction metrics ──────────────────────────
def _bias(pairs: list[tuple[float, float]]) -> float | None:
    return statistics.mean(p - a for p, a in pairs) if pairs else None


def _mae(pairs: list[tuple[float, float]]) -> float | None:
    return statistics.mean(abs(p - a) for p, a in pairs) if pairs else None


# ────────────────────────── loaders ──────────────────────────
def _load_outcomes() -> list[dict[str, Any]]:
    from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources

    rows: list[dict[str, Any]] = []
    for r in collect_resolved_outcomes_from_sources():
        p, a = _num(r.get("pred")), _num(r.get("actual"))
        if p is None or a is None:
            continue
        rows.append({**r, "pred": p, "actual": a})
    return rows


def _load_sign_curve() -> dict[str, Any]:
    """Read the pre-CD/post-CD sign-curve snapshot (read-only). Built by the
    refresh pipeline (``sign_curve_daily.save_sign_curve_daily_json``)."""
    p = Path(MODEL_SIGN_CURVE_DAILY_JSON)
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return doc if isinstance(doc, dict) else {}


def _load_positions() -> list[dict[str, Any]]:
    from prediction.investment_sim_outcomes import (
        build_investment_sim_outcomes,
        read_investment_sim_outcomes,
    )

    doc = read_investment_sim_outcomes()
    rows = doc.get("rows") or []
    if not rows:
        rows = build_investment_sim_outcomes().get("rows") or []
    return rows


def _global_factor_fn() -> tuple[float | None, Callable[[dict[str, Any]], float]]:
    try:
        from prediction.cluster_cal_factor import get_global_cal_factor

        g: float | None = float(get_global_cal_factor())
    except Exception:
        g = None
    f = g if g is not None else 1.0
    return g, (lambda _r: f)


def _cluster_factor_fn() -> Callable[[dict[str, Any]], float]:
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

        return fn
    except Exception:
        return lambda _r: 1.0


# ────────────────────────── recommendation/trading helpers ──────────────────────────
def _recommended_action(r: dict[str, Any]) -> str:
    """Mirror sds_investment_decision: regime gate first, then SDS sizing."""
    regime = str(r.get("entry_regime") or r.get("market_regime") or "").upper()
    if "RISK_OFF" in regime or "CRISIS" in regime:
        return "HOLD"
    sds = _num(r.get("entry_sds_score"))
    if sds is None:
        sds = _num(r.get("sds_score"))
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


def _winrate(rows: list[dict[str, Any]]) -> float | None:
    wins = [w for r in rows if (w := _is_win(r)) is not None]
    return (sum(wins) / len(wins)) if wins else None


# ────────────────────────── directional follow-through (recommendation) ──────────────────────────
def _price_up(r: dict[str, Any]) -> bool | None:
    """Realized direction after a BUY: True if the price rose past the flat band,
    False if it fell, None when flat/unknown (excluded from the hit-rate)."""
    pnl = _num(r.get("pnl_pct"))
    if pnl is None or abs(pnl) <= _REC_FLAT_PCT:
        return None
    return pnl > 0


def _buy_up_rate(rows: list[dict[str, Any]]) -> tuple[float | None, int]:
    """P(price up | BUY) over BUY positions with a non-flat realized move."""
    graded = [u for r in rows if (u := _price_up(r)) is not None]
    return ((sum(graded) / len(graded)) if graded else None, len(graded))


def _sell_down_hit(r: dict[str, Any]) -> bool | None:
    """Whether a rule-driven SELL was followed by a price drop, from the
    post-exit move already scored in the sim (``sell_signal_result``).
    None when still pending/flat (excluded from the hit-rate)."""
    res = r.get("sell_signal_result")
    if res == "success":
        return True
    if res == "failure":
        return False
    return None


def _sell_down_rate(rows: list[dict[str, Any]]) -> tuple[float | None, int]:
    graded = [d for r in rows if (d := _sell_down_hit(r)) is not None]
    return ((sum(graded) / len(graded)) if graded else None, len(graded))


def _mean_pnl(rows: list[dict[str, Any]]) -> float | None:
    pnls = [p for r in rows if (p := _num(r.get("pnl_pct"))) is not None]
    return statistics.mean(pnls) if pnls else None


def _sum_eur(rows: list[dict[str, Any]]) -> float | None:
    eurs = [e for r in rows if (e := _num(r.get("pnl_eur"))) is not None]
    return sum(eurs) if eurs else None


# ────────────────────────── regime attribution (trading) ──────────────────────────
_REGIME_ORDER = ("RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS")


def _regime_label(r: dict[str, Any]) -> str:
    """Normalize the regime state recorded at entry into a fixed bucket."""
    norm = str(r.get("entry_regime") or r.get("market_regime") or "").upper().replace("-", "_").replace(" ", "_")
    if not norm:
        return "UNKNOWN"
    if "CRISIS" in norm:
        return "CRISIS"
    if "RISK_OFF" in norm:
        return "RISK_OFF"
    if "RISK_ON" in norm:
        return "RISK_ON"
    if "NEUTRAL" in norm:
        return "NEUTRAL"
    return "UNKNOWN"


def _regime_breakdown(rows: list[dict[str, Any]], book_wr: float | None) -> tuple[list[dict[str, Any]], int]:
    """Split closed trades by the regime state at entry, with win-rate lift vs the whole book.

    This is observational attribution (P&L grouped by the regime that was active at entry),
    NOT a counterfactual of the regime multiplier. It only fills in for trades that actually
    carry an entry regime, so it populates as new cycles close after the logging change.
    """
    buckets: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        buckets.setdefault(_regime_label(r), []).append(r)
    out: list[dict[str, Any]] = []
    for reg in _REGIME_ORDER:
        rs = buckets.get(reg)
        if not rs:
            continue
        wr = _winrate(rs)
        lift = (wr - book_wr) if (wr is not None and book_wr is not None) else None
        out.append(
            {
                "regime": reg,
                "n": len(rs),
                "win_pct": _round_pct(wr),
                "mean_pnl_pct": _round(_mean_pnl(rs)),
                "total_eur": _round(_sum_eur(rs)),
                "lift_vs_book_pp": _round_pct(lift),
            }
        )
    known_n = sum(len(v) for k, v in buckets.items() if k != "UNKNOWN")
    return out, known_n


# ────────────────────────── weekly series ──────────────────────────
def _weekly_series(
    rows: list[dict[str, Any]],
    key_dates: tuple[str, ...],
    metric_fn: Callable[[list[dict[str, Any]]], dict[str, Any]],
    limit: int = 12,
) -> list[dict[str, Any]]:
    by_week: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        wk = _iso_week(_first_date(r, key_dates))
        if wk:
            by_week.setdefault(wk, []).append(r)
    out: list[dict[str, Any]] = []
    for wk in sorted(by_week)[-limit:]:
        rs = by_week[wk]
        cell = metric_fn(rs)
        cell["week"] = wk
        cell["n"] = len(rs)
        out.append(cell)
    return out


def _recommendation_week(rs: list[dict[str, Any]]) -> dict[str, Any]:
    buy = [r for r in rs if _recommended_action(r).startswith("BUY")]
    rate, graded_n = _buy_up_rate(buy)
    return {
        "buy_n": len(buy),
        "buy_up_hit_pct": _round_pct(rate),
        "buy_graded_n": graded_n,
    }


def _trading_week(rs: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "win_pct": _round_pct(_winrate(rs)),
        "mean_pnl_pct": _round(_mean_pnl(rs)),
        "total_eur": _round(_sum_eur(rs)),
    }


# ────────────────────────── per-channel builders ──────────────────────────
def _calibration_verdict(d_mae: float | None) -> str:
    if d_mae is None:
        return "collecting_data"
    if d_mae <= -_MAE_NOISE_PP:
        return "improving"
    if d_mae >= _MAE_NOISE_PP:
        return "not_helping"
    return "neutral"


def _loop_effect(
    loop_id: str,
    label: str,
    outcomes: list[dict[str, Any]],
    shown_factor: float | None,
    fn: Callable[[dict[str, Any]], float],
    base_pairs: list[tuple[float, float]],
) -> dict[str, Any]:
    new_pairs = [(r["pred"] * fn(r), r["actual"]) for r in outcomes]
    b0, b1 = _bias(base_pairs), _bias(new_pairs)
    m0, m1 = _mae(base_pairs), _mae(new_pairs)
    ab1 = abs(b1) if b1 is not None else None
    d_ab = (abs(b1) - abs(b0)) if (b0 is not None and b1 is not None) else None
    d_m = (m1 - m0) if (m0 is not None and m1 is not None) else None
    return {
        "loop": loop_id,
        "label": label,
        "factor": _round(shown_factor) if shown_factor is not None else None,
        "abs_bias_after_pp": _round(ab1),
        "d_bias_pp": _round(d_ab),
        "mae_after_pp": _round(m1),
        "d_mae_pp": _round(d_m),
        "d_dir_hit_pp": 0.0,  # multiplicative + sign-preserving -> cannot move direction
        "is_lever": False,
        "verdict": _calibration_verdict(d_m),
    }


def _weekly_improvement(weekly: list[dict[str, Any]]) -> tuple[float | None, bool]:
    """Week-over-week change of the pre-CD sign-hit, using the last two weeks that
    clear the min-sample guard. Returns (delta_pp, is_significant)."""
    usable = [
        w for w in weekly
        if (w.get("n") or 0) >= _PRED_WEEK_MIN_N and w.get("sign_hit_pct") is not None
    ]
    if len(usable) < 2:
        return None, False
    delta = float(usable[-1]["sign_hit_pct"]) - float(usable[-2]["sign_hit_pct"])
    return _round(delta, 1), abs(delta) >= _PRED_SIGNIFICANT_PP


def _prediction_loops(outcomes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pairs = [(r["pred"], r["actual"]) for r in outcomes]
    loops: list[dict[str, Any]] = []
    if outcomes:
        g, gfn = _global_factor_fn()
        loops.append(_loop_effect("global_cal_factor", "Global cal factor", outcomes, g, gfn, pairs))
        loops.append(
            _loop_effect("cluster_cal_factor", "Cluster cal factor", outcomes, None, _cluster_factor_fn(), pairs)
        )
    loops.append(
        {
            "loop": "regime_multiplier",
            "label": "Regime multiplier",
            "factor": None,
            "d_bias_pp": None,
            "d_mae_pp": None,
            "d_dir_hit_pp": 0.0,
            "is_lever": False,
            "verdict": "not_measurable",
            "note": "effetto del regime mostrato come ripartizione del P&L per stato di regime nel canale Trading",
        }
    )
    loops.append(
        {
            "loop": "daily_curve_recalib",
            "label": "Daily curve recalib",
            "factor": None,
            "d_bias_pp": None,
            "d_mae_pp": None,
            "d_dir_hit_pp": None,
            "is_lever": True,
            "verdict": "direction_lever",
            "note": "ricalibra ogni giorno la curva pre-CD: l'unico loop che puo' muovere la direzione",
        }
    )
    return loops


def _prediction_channel(outcomes: list[dict[str, Any]], sign_curve: dict[str, Any]) -> dict[str, Any]:
    """Pre-CD curve quality (sign-hit + price accuracy) of the Simulation cohort vs
    the historical cohort, with a weekly-improvement signal.

    The model targets the pre-CD window (~−60d → CD day); post-CD movement is
    near coin-flip, so we measure the pre-CD sign-hit here, NOT the post-CD outcome.
    """
    cohorts = (sign_curve or {}).get("cohorts") or {}
    sim = cohorts.get("simulation") or {}
    retro = cohorts.get("retro") or {}
    weekly = [w for w in (sim.get("weekly_pre_cd") or []) if isinstance(w, dict)]
    sign_hit = _num(sim.get("overall_sign_hit_pre_cd_pct"))
    delta, significant = _weekly_improvement(weekly)
    available = sign_hit is not None
    return {
        "available": available,
        "n_events": sim.get("n_events"),
        "n_sessions": sim.get("n_sessions_pre_cd"),
        "pre_cd_sign_hit_pct": sign_hit,
        "pre_cd_price_accuracy_pct": _num(sim.get("overall_price_accuracy_pre_cd_pct")),
        "benchmark_sign_hit_pct": _num(retro.get("overall_sign_hit_pre_cd_pct")),
        "benchmark_price_accuracy_pct": _num(retro.get("overall_price_accuracy_pre_cd_pct")),
        "weekly_delta_pp": delta,
        "weekly_significant": significant,
        "weekly": weekly,
        "loops": _prediction_loops(outcomes),
        "note": None if available else "curva pre-CD non disponibile: rigenera model_sign_curve_daily.json (cohorte Simulation)",
    }


def _recommendation_channel(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Directional follow-through of the recommendation, by action.

    BUY  -> P(price up | BUY): share of BUY positions whose realized move rose.
    SELL -> P(price down | SELL): share of rule-driven exits (stop_loss /
            sds_below_40 / pre_cd_exit) followed by a price drop, from the
            post-exit move scored in the sim. Populates forward.
    HOLD -> rescue-score vs actual rebound: computed in the UI sheet (the rescue
            score lives there); the backend only reports the HOLD count here.
    """
    buy_rows = [r for r in rows if _recommended_action(r).startswith("BUY")]
    hold_rows = [r for r in rows if _recommended_action(r) == "HOLD"]
    sell_rows = [r for r in rows if r.get("exit_reason") in _SELL_REASONS]

    buy_rate, buy_graded = _buy_up_rate(buy_rows)
    sell_rate, sell_graded = _sell_down_rate(sell_rows)
    sell_pending = sum(1 for r in sell_rows if _sell_down_hit(r) is None)

    by_reason: list[dict[str, Any]] = []
    for reason in _SELL_REASONS:
        rs = [r for r in sell_rows if r.get("exit_reason") == reason]
        if not rs:
            continue
        rate, graded = _sell_down_rate(rs)
        by_reason.append(
            {
                "reason": reason,
                "n": len(rs),
                "graded_n": graded,
                "down_hit_pct": _round_pct(rate),
            }
        )

    available = bool(buy_graded or sell_graded)
    return {
        "available": available,
        "buy": {
            "n": len(buy_rows),
            "graded_n": buy_graded,
            "up_hit_pct": _round_pct(buy_rate),
        },
        "sell": {
            "n": len(sell_rows),
            "graded_n": sell_graded,
            "pending_n": sell_pending,
            "down_hit_pct": _round_pct(sell_rate),
            "by_reason": by_reason,
        },
        "hold": {
            "n": len(hold_rows),
            "rescue_available": False,
            "note": "rimbalzo vs rescue score calcolato nella UI sheet",
        },
        "weekly": _weekly_series(buy_rows, ("entry_ts", "entry_date", "exit_ts"), _recommendation_week),
        "note": None if available else (
            "nessun BUY/SELL valutabile ancora — si popola con i cicli chiusi"
        ),
    }


def _trading_channel(rows: list[dict[str, Any]]) -> dict[str, Any]:
    pnls = [p for r in rows if (p := _num(r.get("pnl_pct"))) is not None]
    book_wr = _winrate(rows)
    regimes, regime_known_n = _regime_breakdown(rows, book_wr)
    return {
        "n": len(rows),
        "win_pct": _round_pct(book_wr),
        "mean_pnl_pct": _round(_mean_pnl(rows)),
        "median_pnl_pct": _round(statistics.median(pnls)) if pnls else None,
        "total_eur": _round(_sum_eur(rows)),
        "weekly": _weekly_series(rows, ("entry_ts", "entry_date", "exit_ts"), _trading_week),
        "regimes": regimes,
        "regime_available": regime_known_n > 0,
        "regime_n": regime_known_n,
    }


# ────────────────────────── public API ──────────────────────────
def compute_channel_impact() -> dict[str, Any]:
    """Live, read-only computation of the 3-channel learning-loop impact."""
    outcomes = _load_outcomes()
    positions = _load_positions()
    sign_curve = _load_sign_curve()
    return {
        "generated_at": _now_iso(),
        "prediction": _prediction_channel(outcomes, sign_curve),
        "recommendation": _recommendation_channel(positions),
        "trading": _trading_channel(positions),
    }


def _load_weekly_doc() -> dict[str, Any]:
    if not LEARNING_LOOP_WEEKLY_IMPACT_JSON.is_file():
        return {"schema_version": 1, "weeks": {}}
    try:
        doc = json.loads(LEARNING_LOOP_WEEKLY_IMPACT_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"schema_version": 1, "weeks": {}}
    if not isinstance(doc, dict):
        return {"schema_version": 1, "weeks": {}}
    doc.setdefault("weeks", {})
    return doc


def _save_weekly_doc(doc: dict[str, Any]) -> None:
    LEARNING_LOOP_WEEKLY_IMPACT_JSON.parent.mkdir(parents=True, exist_ok=True)
    tmp = LEARNING_LOOP_WEEKLY_IMPACT_JSON.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(LEARNING_LOOP_WEEKLY_IMPACT_JSON)


def persist_weekly_channel_snapshot(impact: dict[str, Any] | None = None) -> dict[str, Any]:
    """Snapshot the current per-channel headline metrics into the current ISO week.

    Stores one row per ISO week (last write wins within the week) so the redesigned
    tab can show how each channel evolves over time, plus the per-loop calibration
    contribution that justified keeping/dropping each loop.
    """
    impact = impact or compute_channel_impact()
    pred = impact.get("prediction") or {}
    rec = impact.get("recommendation") or {}
    trd = impact.get("trading") or {}
    doc = _load_weekly_doc()
    weeks: dict[str, Any] = doc["weeks"]
    weeks[_current_iso_week()] = {
        "updated_at": _now_iso(),
        "prediction": {
            "n_sessions": pred.get("n_sessions"),
            "pre_cd_sign_hit_pct": pred.get("pre_cd_sign_hit_pct"),
            "pre_cd_price_accuracy_pct": pred.get("pre_cd_price_accuracy_pct"),
            "benchmark_sign_hit_pct": pred.get("benchmark_sign_hit_pct"),
        },
        "recommendation": {
            "available": rec.get("available"),
            "buy_up_hit_pct": (rec.get("buy") or {}).get("up_hit_pct"),
            "buy_n": (rec.get("buy") or {}).get("graded_n"),
            "sell_down_hit_pct": (rec.get("sell") or {}).get("down_hit_pct"),
            "sell_n": (rec.get("sell") or {}).get("graded_n"),
        },
        "trading": {
            "n": trd.get("n"),
            "win_pct": trd.get("win_pct"),
            "mean_pnl_pct": trd.get("mean_pnl_pct"),
            "total_eur": trd.get("total_eur"),
        },
        "loops": {
            loop["loop"]: {"d_mae_pp": loop.get("d_mae_pp"), "verdict": loop.get("verdict")}
            for loop in (pred.get("loops") or [])
        },
    }
    doc["schema_version"] = 1
    doc["updated_at"] = _now_iso()
    # keep the file bounded — last ~104 weeks (2 years)
    if len(weeks) > 104:
        for wk in sorted(weeks)[:-104]:
            weeks.pop(wk, None)
    _save_weekly_doc(doc)
    return doc


def load_weekly_channel_history() -> list[dict[str, Any]]:
    """Return persisted weekly snapshots, oldest-first, each tagged with its week."""
    doc = _load_weekly_doc()
    weeks = doc.get("weeks") or {}
    out: list[dict[str, Any]] = []
    for wk in sorted(weeks):
        row = dict(weeks[wk])
        row["week"] = wk
        out.append(row)
    return out
