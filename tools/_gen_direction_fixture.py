"""One-off generator for tests/fixtures/direction_ensemble_cases.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prediction.direction_ensemble import direction_ensemble_detail

CASES = [
    {
        "id": "phase3_strong_bull",
        "kwargs": dict(
            ph_num=3,
            exc_slope=2.0,
            slope=1.8,
            rsi_val=50,
            vol_ratio=2.5,
            vol_accel=2.2,
            run_up=3,
            slope_5d=1.0,
            slope_20d=0.8,
            pcr=0.55,
            exp_move_pct=30.0,
        ),
    },
    {
        "id": "phase3_strong_bear",
        "kwargs": dict(
            ph_num=3,
            exc_slope=-0.2,
            slope=-0.1,
            rsi_val=75,
            vol_ratio=1.0,
            vol_accel=1.0,
            run_up=22,
            slope_5d=-0.5,
            slope_20d=-0.4,
            run_up_7d=18,
            ath_prox=0.95,
        ),
    },
    {
        "id": "phase2_mixed_signals",
        "kwargs": dict(
            ph_num=2,
            exc_slope=2.0,
            slope=2.0,
            rsi_val=80,
            vol_ratio=2.5,
            vol_accel=2.0,
            run_up=25,
            slope_5d=1.0,
            slope_20d=1.0,
        ),
    },
    {
        "id": "phase3_neutral_flat",
        "kwargs": dict(
            ph_num=3,
            exc_slope=0.1,
            slope=0.1,
            rsi_val=50,
            vol_ratio=1.0,
            vol_accel=1.0,
            run_up=0,
            slope_5d=0.1,
            slope_20d=0.1,
        ),
    },
    {
        "id": "phase3_rsi_oversold",
        "kwargs": dict(
            ph_num=3,
            exc_slope=0.5,
            slope=0.4,
            rsi_val=25,
            vol_ratio=1.2,
            vol_accel=1.1,
            run_up=-5,
            slope_5d=0.3,
            slope_20d=0.2,
        ),
    },
    {
        "id": "phase3_pcr_panic_bull",
        "kwargs": dict(
            ph_num=3,
            exc_slope=0.8,
            slope=0.7,
            rsi_val=45,
            vol_ratio=1.3,
            vol_accel=1.2,
            run_up=2,
            slope_5d=0.4,
            slope_20d=0.3,
            pcr=2.8,
        ),
    },
    {
        "id": "phase3_pcr_call_frenzy_bear",
        "kwargs": dict(
            ph_num=3,
            exc_slope=1.0,
            slope=0.9,
            rsi_val=68,
            vol_ratio=1.4,
            vol_accel=1.3,
            run_up=12,
            slope_5d=0.6,
            slope_20d=0.5,
            pcr=0.45,
        ),
    },
    {
        "id": "phase3_price_not_ok",
        "kwargs": dict(
            ph_num=3,
            exc_slope=1.8,
            slope=1.5,
            rsi_val=48,
            vol_ratio=2.0,
            vol_accel=1.8,
            run_up=5,
            slope_5d=0.8,
            slope_20d=0.6,
            price_ok=False,
        ),
    },
    {
        "id": "phase3_low_data_quality",
        "kwargs": dict(
            ph_num=3,
            exc_slope=1.8,
            slope=1.5,
            rsi_val=48,
            vol_ratio=2.0,
            vol_accel=1.8,
            run_up=5,
            slope_5d=0.8,
            slope_20d=0.6,
            data_quality_score=0.3,
        ),
    },
    {
        "id": "phase2_strong_bull",
        "kwargs": dict(
            ph_num=2,
            exc_slope=2.0,
            slope=1.8,
            rsi_val=50,
            vol_ratio=2.5,
            vol_accel=2.2,
            run_up=3,
            slope_5d=1.0,
            slope_20d=0.8,
        ),
    },
    {
        "id": "phase3_priced_in_near_t",
        "kwargs": dict(
            ph_num=3,
            exc_slope=1.2,
            slope=1.0,
            rsi_val=55,
            vol_ratio=1.5,
            vol_accel=1.4,
            run_up=8,
            slope_5d=0.7,
            slope_20d=0.6,
            days_to_t=5,
        ),
    },
    {
        "id": "phase1_mild_bull",
        "kwargs": dict(
            ph_num=1,
            exc_slope=0.6,
            slope=0.55,
            rsi_val=42,
            vol_ratio=1.6,
            vol_accel=1.5,
            run_up=1,
            slope_5d=0.5,
            slope_20d=0.4,
        ),
    },
]

out_cases = []
for c in CASES:
    d = direction_ensemble_detail(**c["kwargs"])
    label = d.direction_label
    if "\u2191" in label or label.startswith("\u2191"):
        sub = "\u2191"
    elif "\u2193" in label or label.startswith("\u2193"):
        sub = "\u2193"
    else:
        sub = "\u2192"
    out_cases.append(
        {
            "id": c["id"],
            "kwargs": c["kwargs"],
            "expect": {
                "direction_label": label,
                "direction_substring": sub,
                "confidence": d.confidence,
                "confidence_min": max(0.05, round(d.confidence - 0.001, 3)),
                "confidence_max": min(1.0, round(d.confidence + 0.001, 3)),
                "phase": d.phase,
                "net_score": d.net_score,
            },
        }
    )

fix = ROOT / "tests" / "fixtures" / "direction_ensemble_cases.json"
fix.parent.mkdir(parents=True, exist_ok=True)
fix.write_text(
    json.dumps({"version": 1, "cases": out_cases}, indent=2, ensure_ascii=False),
    encoding="utf-8",
)
print(f"wrote {fix} ({len(out_cases)} cases)")
