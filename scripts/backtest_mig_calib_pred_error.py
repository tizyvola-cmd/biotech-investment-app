#!/usr/bin/env python3
"""
Mini backtest: MII / Calib tier vs errore Pred forward e post-CD.

Usa ``past_catalyst_predictions.json`` (8410+ righe) al punto decisionale
T−10 (RETRO_DECISION_DAYS_BEFORE_CD), stessa logica di ``marketInterestGate.ts``.

Orizzonti:
  - fwd5  : T−10 → T−5  (model_dm5_pct vs close_m5/close_m10)
  - post5 : CD+5        (model_d5_pct vs d5_pct)
  - post20: CD+20       (model_d30_pct vs d30_pct — proxy lungo; etichettato)

Output: tabella per tier Calib + quartili score + gate MII |°|≥20.
"""
from __future__ import annotations

import argparse
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from statistics import mean, median
from typing import Any

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON  # noqa: E402
from past_pred_io import load_past_pred_map  # noqa: E402

# ── MII / Calib (mirror desktop-ui/src/sheet/marketInterestGate.ts) ───────────
NORM_FACTOR = 15.0
LOW_VOL_THRESH = 0.8
CALIB_MAX_GAP_DEG = 28.0
CALIB_ALIGNED_DEG = 8.0
CALIB_DRIFT_DEG = 18.0
CALIB_CONTRARIAN_MIN_DEG = 5.0
GATE_MIN_ANGLE = 20.0


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def compute_mii_raw(delta_pct: float, vol_ratio: float) -> tuple[float, bool]:
    vr = max(0.0, vol_ratio)
    low_pen = False
    raw = delta_pct * math.log(vr + 1.0) * math.sqrt(vr)
    if delta_pct > 0 and vr < LOW_VOL_THRESH:
        raw *= 0.55
        low_pen = True
    return round(raw, 4), low_pen


def slope_angle_from_raw(mii_raw: float) -> float:
    return round(math.degrees(math.atan(mii_raw / NORM_FACTOR)), 2)


def slope_angle_from_delta_vol(delta_pct: float, vol_ratio: float) -> float:
    raw, _ = compute_mii_raw(delta_pct, vol_ratio)
    return slope_angle_from_raw(raw)


def compute_calib(
    market_angle: float,
    model_slope_pp_per_day: float | None,
    vol_ratio: float,
) -> dict[str, Any]:
    if model_slope_pp_per_day is None:
        return {
            "model_angle": None,
            "gap_deg": None,
            "score": None,
            "tier": "unknown",
        }
    model_delta = model_slope_pp_per_day * 5.0
    model_angle = slope_angle_from_delta_vol(model_delta, vol_ratio)
    gap = round(market_angle - model_angle, 2)
    gap_abs = abs(gap)
    opp = (
        abs(market_angle) >= CALIB_CONTRARIAN_MIN_DEG
        and abs(model_angle) >= CALIB_CONTRARIAN_MIN_DEG
        and math.copysign(1.0, market_angle) != math.copysign(1.0, model_angle)
    )
    score = max(0.0, min(100.0, 100.0 - (gap_abs / CALIB_MAX_GAP_DEG) * 100.0))
    if opp:
        score = max(0.0, score * 0.55 - 12.0)
    score = round(score, 2)
    if opp:
        tier = "contrarian"
    elif gap_abs < CALIB_ALIGNED_DEG:
        tier = "aligned"
    elif gap_abs < CALIB_DRIFT_DEG:
        tier = "drift"
    else:
        tier = "diverge"
    return {
        "model_angle": model_angle,
        "gap_deg": gap,
        "score": score,
        "tier": tier,
    }


def sign_hit(pred: float | None, actual: float | None, *, min_abs: float = 1.0) -> bool | None:
    if pred is None or actual is None:
        return None
    if abs(pred) < min_abs and abs(actual) < min_abs:
        return True
    if pred == 0 or actual == 0:
        return pred == actual
    return (pred > 0) == (actual > 0)


def _sponsor_ok(rec: dict) -> bool:
    sm = str(rec.get("sponsor_match") or "").strip().lower()
    return sm in ("exact", "partial")


@dataclass
class Case:
    ticker: str
    cd: str
    market_angle: float
    mii_delta_source: str
    calib_score: float
    calib_tier: str
    gate_pass: bool
    market_delta_5d: float | None
    model_dm5: float | None
    act_fwd5: float | None
    model_d5: float | None
    act_d5: float | None
    err_fwd5: float | None
    err_post5: float | None
    err_post20: float | None
    hit_fwd5: bool | None
    hit_post5: bool | None
    hit_post20: bool | None


def build_cases(rows: dict, *, today: date | None = None, all_sponsors: bool = False) -> list[Case]:
    today = today or date.today()
    out: list[Case] = []

    for _key, rec in rows.items():
        cd = rec.get("completion_date")
        if not isinstance(cd, date) or cd >= today:
            continue
        if rec.get("non_quotata_al_tempo"):
            continue
        if not all_sponsors and not _sponsor_ok(rec):
            continue

        slope5 = _num(rec.get("slope_5d"))
        vol = _num(rec.get("vol_ratio"))
        if slope5 is None or vol is None:
            continue

        # Storico: no Var.1M nel JSON → slope5d×5 (come fallback UI)
        delta_pct = round(slope5 * 5.0, 2)
        delta_src = "slope5d×5"

        mii_raw, _ = compute_mii_raw(delta_pct, vol)
        market_angle = slope_angle_from_raw(mii_raw)
        gate_pass = abs(market_angle) >= GATE_MIN_ANGLE

        # Model forward Pred+5 pp/g da model_dm5_pct (T−10→T−5)
        mdm5 = _num(rec.get("model_dm5_pct"))
        model_slope_fwd = (mdm5 / 5.0) if mdm5 is not None else None
        calib = compute_calib(market_angle, model_slope_fwd, vol)

        # Actual forward 5d T−10→T−5
        c10, c5 = _num(rec.get("close_m10")), _num(rec.get("close_m5"))
        act_fwd5 = None
        if c10 and c5 and c10 > 0:
            act_fwd5 = round((c5 / c10 - 1.0) * 100.0, 2)

        err_fwd5 = None
        hit_fwd5 = None
        if mdm5 is not None and act_fwd5 is not None:
            err_fwd5 = abs(mdm5 - act_fwd5)
            hit_fwd5 = sign_hit(mdm5, act_fwd5)

        md5, d5 = _num(rec.get("model_d5_pct")), _num(rec.get("d5_pct"))
        err_post5 = abs(md5 - d5) if md5 is not None and d5 is not None else None
        hit_post5 = sign_hit(md5, d5) if md5 is not None and d5 is not None else None
        market_delta = round(delta_pct, 2)

        md30, d30 = _num(rec.get("model_d30_pct")), _num(rec.get("d30_pct"))
        err_post20 = abs(md30 - d30) if md30 is not None and d30 is not None else None
        hit_post20 = sign_hit(md30, d30) if md30 is not None and d30 is not None else None

        if calib["score"] is None:
            continue

        out.append(
            Case(
                ticker=str(rec.get("ticker") or ""),
                cd=cd.isoformat(),
                market_angle=market_angle,
                mii_delta_source=delta_src,
                calib_score=float(calib["score"]),
                calib_tier=str(calib["tier"]),
                gate_pass=gate_pass,
                market_delta_5d=market_delta,
                model_dm5=mdm5,
                act_fwd5=act_fwd5,
                model_d5=md5,
                act_d5=d5,
                err_fwd5=err_fwd5,
                err_post5=err_post5,
                err_post20=err_post20,
                hit_fwd5=hit_fwd5,
                hit_post5=hit_post5,
                hit_post20=hit_post20,
            )
        )
    return out


def nudge_pred(model_pct: float, market_delta_5d: float, weight: float) -> float:
    """Blend model verso delta mercato (~5g) — proxy MII slope."""
    w = max(0.0, min(1.0, weight))
    return round(model_pct * (1.0 - w) + market_delta_5d * w, 2)


def case_err_fwd5_nudged(c: Case, weight: float, *, contrarian_only: bool = True) -> float | None:
    if c.model_dm5 is None or c.act_fwd5 is None or c.market_delta_5d is None:
        return None
    if contrarian_only and c.calib_tier != "contrarian":
        pred = c.model_dm5
    else:
        pred = nudge_pred(c.model_dm5, c.market_delta_5d, weight)
    return abs(pred - c.act_fwd5)


def case_err_post5_nudged(c: Case, weight: float, *, contrarian_only: bool = True) -> float | None:
    if c.model_d5 is None or c.act_d5 is None or c.market_delta_5d is None:
        return None
    if contrarian_only and c.calib_tier != "contrarian":
        pred = c.model_d5
    else:
        pred = nudge_pred(c.model_d5, c.market_delta_5d, weight)
    return abs(pred - c.act_d5)


def agg_nudged_mae(
    cases: list[Case],
    weight: float,
    *,
    horizon: str,
    contrarian_only: bool = True,
    subset: list[Case] | None = None,
) -> dict[str, Any]:
    pool = subset if subset is not None else cases
    errs: list[float] = []
    for c in pool:
        if horizon == "fwd5":
            e = case_err_fwd5_nudged(c, weight, contrarian_only=contrarian_only)
        elif horizon == "post5":
            e = case_err_post5_nudged(c, weight, contrarian_only=contrarian_only)
        else:
            continue
        if e is not None:
            errs.append(e)
    if not errs:
        return {"n": 0}
    return {"n": len(errs), "mae": round(mean(errs), 2), "medae": round(median(errs), 2)}


def _agg(cases: list[Case], err_key: str, hit_key: str) -> dict[str, Any]:
    errs = [getattr(c, err_key) for c in cases if getattr(c, err_key) is not None]
    hits = [getattr(c, hit_key) for c in cases if getattr(c, hit_key) is not None]
    if not errs:
        return {"n": 0}
    return {
        "n": len(errs),
        "mae": round(mean(errs), 2),
        "medae": round(median(errs), 2),
        "hit_rate": round(sum(1 for h in hits if h) / len(hits), 3) if hits else None,
    }


def _print_group(title: str, cases: list[Case]) -> None:
    if not cases:
        print(f"\n=== {title} (n=0) ===")
        return
    a_fwd = _agg(cases, "err_fwd5", "hit_fwd5")
    a_p5 = _agg(cases, "err_post5", "hit_post5")
    a_p20 = _agg(cases, "err_post20", "hit_post20")
    print(f"\n=== {title} (n={len(cases)}) ===")
    print(
        f"  fwd5  T-10->T-5 : n={a_fwd['n']:4d}  MAE={a_fwd.get('mae', 'n/a'):>6}  "
        f"med={a_fwd.get('medae', 'n/a'):>6}  hit={a_fwd.get('hit_rate', 'n/a')}"
    )
    print(
        f"  post5 CD+5     : n={a_p5['n']:4d}  MAE={a_p5.get('mae', 'n/a'):>6}  "
        f"med={a_p5.get('medae', 'n/a'):>6}  hit={a_p5.get('hit_rate', 'n/a')}"
    )
    print(
        f"  post20 CD+30*  : n={a_p20['n']:4d}  MAE={a_p20.get('mae', 'n/a'):>6}  "
        f"med={a_p20.get('medae', 'n/a'):>6}  hit={a_p20.get('hit_rate', 'n/a')}"
    )


def _quartile_label(q: int) -> str:
    return {1: "Q1 basso (0–25)", 2: "Q2 (25–50)", 3: "Q3 (50–75)", 4: "Q4 alto (75–100)"}[q]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", default=PAST_CATALYST_PREDICTIONS_JSON)
    ap.add_argument("--all-sponsors", action="store_true", help="Include all sponsor_match values")
    args = ap.parse_args()

    rows = load_past_pred_map(args.json)
    cases = build_cases(rows, all_sponsors=args.all_sponsors)
    print("Cohort: past_pred CD passate, sponsor exact/partial, quotate @ T-10")
    print(f"Righe analizzabili: {len(cases)} / {len(rows)} totali JSON")
    print(f"dP MII: {cases[0].mii_delta_source if cases else '-'} (storico, no Var.1M nel JSON)")

    # Baseline globale
    _print_group("BASELINE tutti", cases)

    # Per tier Calib
    tiers = ["aligned", "drift", "diverge", "contrarian"]
    for tier in tiers:
        sub = [c for c in cases if c.calib_tier == tier]
        _print_group(f"Calib tier = {tier}", sub)

    # Quartili score
    scores = sorted(c.calib_score for c in cases)
    if scores:
        def qcut(s: float) -> int:
            idx = sum(1 for x in scores if x <= s)
            pct = idx / len(scores)
            if pct <= 0.25:
                return 1
            if pct <= 0.50:
                return 2
            if pct <= 0.75:
                return 3
            return 4

        by_q: dict[int, list[Case]] = defaultdict(list)
        for c in cases:
            by_q[qcut(c.calib_score)].append(c)
        for q in (1, 2, 3, 4):
            _print_group(f"Calib score {_quartile_label(q)}", by_q[q])

    # Gate MII
    _print_group("MII Gate PASS (|deg|>=20)", [c for c in cases if c.gate_pass])
    _print_group("MII Gate BLOCK/WATCH (|deg|<20)", [c for c in cases if not c.gate_pass])

    # Contrarian deep-dive: chi vince fwd5?
    contra = [c for c in cases if c.calib_tier == "contrarian" and c.err_fwd5 is not None]
    if contra:
        mae = mean(c.err_fwd5 for c in contra if c.err_fwd5 is not None)
        print(f"\n=== Contrarian: errore medio fwd5 = {mae:.2f} pp (n={len(contra)}) ===")

    # Delta vs aligned MAE post5
    aligned = [c for c in cases if c.calib_tier == "aligned" and c.err_post5 is not None]
    diverge = [c for c in cases if c.calib_tier == "diverge" and c.err_post5 is not None]
    if aligned and diverge:
        m_a = mean(c.err_post5 for c in aligned)
        m_d = mean(c.err_post5 for c in diverge)
        print(
            f"\n=== Lift post5 MAE: aligned {m_a:.2f} vs diverge {m_d:.2f} pp "
            f"(delta={m_d - m_a:+.2f} pp peggiore se diverge) ==="
        )

    print("\n* post20 usa model_d30/d30_pct (proxy orizzonte lungo; non esattamente CD+20)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
