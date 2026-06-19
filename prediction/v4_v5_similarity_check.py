"""
Diagnostica: perche v4 e v5 appaiono troppo simili su Accuracy / MAE temporale.

Eseguire:
  py -3 -m prediction.v4_v5_similarity_check
"""
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path
from typing import Any

from prediction.accuracy_v4_v5 import ACCURACY_V4_DISPLAY_OFFSETS
from prediction.config import (
    get_config,
    pred_v5_anchor_q50_v4_enabled,
    pred_v5_excel_fan_enabled,
    pred_v5_sim_display_mode,
)
from prediction.pipeline import (
    SIMULATION_V5_Q50_OFFSETS,
    predict_v5_fan_offsets,
    sync_v5_q50_to_accuracy_display_pred,
    v4_pct_at_v5_offsets,
)

_DATA = Path("data")
_PAST = _DATA / "past_catalyst_predictions.json"
_SUMMARY = _DATA / "accuracy_v4_v5_summary.json"


def _float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _v4_display_from_row(row: dict) -> list[float | None]:
    """Proxy colonna Pred % v4 (model_dm* sui nodi, senza seq blend)."""
    keys = (
        "model_dm60_pct",
        "model_dm30_pct",
        "model_dm10_pct",
        "model_dm7_pct",
        "model_dm5_pct",
        "model_dm3_pct",
        "model_d4_pct",
        "model_d7_pct",
    )
    return [_float(row.get(k)) for k in keys]


def _diff_pp(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return abs(float(a) - float(b))


def _compare_row(row: dict, *, anchor: bool) -> dict[str, Any]:
    from unittest.mock import patch

    v4_nodes = v4_pct_at_v5_offsets(row)
    display = _v4_display_from_row(row)
    inp = {k: row.get(k) for k in row}
    for off, v in v4_nodes.items():
        key = {
            -60: "model_dm60_pct",
            -30: "model_dm30_pct",
            -10: "model_dm10_pct",
            -7: "model_dm7_pct",
            -5: "model_dm5_pct",
            -3: "model_dm3_pct",
            4: "model_d4_pct",
            7: "model_d7_pct",
        }.get(off)
        if key and v is not None:
            inp[key] = v
    with (
        patch("prediction.pipeline.pred_v5_anchor_q50_v4_enabled", return_value=anchor),
        patch("prediction.pipeline.pred_v5_cohort_prior_enabled", return_value=False),
        patch("prediction.pipeline.pred_v5_calib_enabled", return_value=False),
        patch("prediction.pipeline.pred_v5_align_sign_v4_enabled", return_value=False),
    ):
        fan = predict_v5_fan_offsets(inp, apply_calibration=False)
    q50 = {str(o): (fan.get(str(o)) or {}).get("q50") for o in SIMULATION_V5_Q50_OFFSETS}
    synced = sync_v5_q50_to_accuracy_display_pred(q50, display) if anchor else q50

    diffs_anchor_v4nodes: list[float] = []
    diffs_sync_display: list[float] = []
    diffs_fan_width: list[float] = []
    for off in SIMULATION_V5_Q50_OFFSETS:
        sk = str(off)
        v4n = v4_nodes.get(off)
        v5r = _float((fan.get(sk) or {}).get("q50"))
        v5s = _float(synced.get(sk))
        v4d = display[ACCURACY_V4_DISPLAY_OFFSETS.index(off)] if off in ACCURACY_V4_DISPLAY_OFFSETS else None
        if v4n is not None and v5r is not None:
            d = _diff_pp(v4n, v5r)
            if d is not None:
                diffs_anchor_v4nodes.append(d)
        if v4d is not None and v5s is not None:
            d = _diff_pp(v4d, v5s)
            if d is not None:
                diffs_sync_display.append(d)
        node = fan.get(sk) or {}
        q05, q95 = _float(node.get("q05")), _float(node.get("q95"))
        q50v = _float(node.get("q50"))
        if q05 is not None and q95 is not None and q50v is not None:
            diffs_fan_width.append((q95 - q05) / 2.0)

    return {
        "ticker": row.get("ticker"),
        "q50_raw_median_abs_vs_v4nodes": (
            round(statistics.median(diffs_anchor_v4nodes), 2)
            if diffs_anchor_v4nodes
            else None
        ),
        "q50_sync_median_abs_vs_display": (
            round(statistics.median(diffs_sync_display), 2) if diffs_sync_display else None
        ),
        "fan_halfwidth_median_pp": (
            round(statistics.median(diffs_fan_width), 2) if diffs_fan_width else None
        ),
        "anchored_v4": bool(inp.get("v5_q50_anchored_v4")),
    }


def _load_past_rows(max_rows: int = 40) -> list[dict]:
    if not _PAST.is_file():
        return []
    raw = json.loads(_PAST.read_text(encoding="utf-8"))
    rows = raw.get("rows") if isinstance(raw, dict) else raw
    if not isinstance(rows, dict):
        return []
    out: list[dict] = []
    for _pk, row in rows.items():
        if not isinstance(row, dict):
            continue
        if not row.get("model_dm60_pct") and row.get("model_dm5_pct") is None:
            continue
        row = dict(row)
        row.setdefault("ticker", str(_pk).split("|")[0])
        out.append(row)
        if len(out) >= max_rows:
            break
    return out


def _latest_summary_mae_parity() -> dict[str, Any]:
    if not _SUMMARY.is_file():
        return {"error": "accuracy_v4_v5_summary.json assente"}
    data = json.loads(_SUMMARY.read_text(encoding="utf-8"))
    hist = data.get("history") or []
    if not hist:
        return {"error": "history vuota"}
    run = hist[-1]
    tot = run.get("total") or {}
    v4 = tot.get("v4") or {}
    v5 = tot.get("v5") or {}
    mae_v4 = (v4.get("mae") or {}) if isinstance(v4, dict) else {}
    mae_v5 = (v5.get("mae") or {}) if isinstance(v5, dict) else {}
    identical_h = 0
    close_h = 0
    diff_h = 0
    for lbl in mae_v4:
        a, b = mae_v4.get(lbl), mae_v5.get(lbl)
        if a is None or b is None:
            continue
        if abs(float(a) - float(b)) < 0.01:
            identical_h += 1
        elif abs(float(a) - float(b)) < 0.5:
            close_h += 1
        else:
            diff_h += 1
    return {
        "run_iso": run.get("run_iso"),
        "n_rows": tot.get("n_rows"),
        "mae_global_v4": v4.get("mae_global") if isinstance(v4, dict) else None,
        "mae_global_v5": v5.get("mae_global") if isinstance(v5, dict) else None,
        "horizons_mae_identical": identical_h,
        "horizons_mae_close_lt_0.5pp": close_h,
        "horizons_mae_different": diff_h,
    }


def run_similarity_check(*, max_rows: int = 30) -> None:
    cfg = get_config()
    print("=" * 72)
    print("CHECK SIMILARITA v4 vs v5")
    print("=" * 72)
    print(
        f"PRED_V5_ANCHOR_Q50_V4={pred_v5_anchor_q50_v4_enabled()}  "
        f"PRED_V5_SIM_DISPLAY={pred_v5_sim_display_mode()}  "
        f"PRED_V5_EXCEL_FAN={pred_v5_excel_fan_enabled()}",
        flush=True,
    )
    print()
    print("--- Cause attese (design) ---", flush=True)
    if pred_v5_anchor_q50_v4_enabled():
        print(
            "1. ANCHOR ON: q50 v5 viene forzato ai nodi v4 (model_dm*), prima del sync.",
            flush=True,
        )
        print(
            "2. SYNC Accuracy: dopo anchor, sync_v5_q50_to_accuracy_display_pred copia "
            "la colonna Pred % (seq+blend) su v5 -> MAE temporale v4 == v5.",
            flush=True,
        )
    else:
        print("ANCHOR OFF: q50 e mediana MC; puo divergere da v4.", flush=True)
    print(
        "3. Simulation default (PRED_V5_SIM_DISPLAY=v4): foglio Sim non usa v5.",
        flush=True,
    )
    print(
        "4. Cio che RESTA diverso con anchor ON: solo q05/q95 (banda), non il centro.",
        flush=True,
    )
    print()

    summ = _latest_summary_mae_parity()
    print("--- Ultimo run Accuratezza temporale (JSON) ---", flush=True)
    for k, v in summ.items():
        print(f"  {k}: {v}", flush=True)
    print()

    rows = _load_past_rows(max_rows=max_rows)
    if not rows:
        print("Nessuna riga past_catalyst con model_dm* — skip campione numerico.", flush=True)
        return

    sync_zero = 0
    anchor_zero = 0
    samples: list[dict] = []
    for row in rows:
        with_anchor = _compare_row(row, anchor=True)
        without = _compare_row(row, anchor=False)
        if (with_anchor.get("q50_sync_median_abs_vs_display") or 99) < 0.02:
            sync_zero += 1
        if (without.get("q50_raw_median_abs_vs_v4nodes") or 0) > 1.0:
            anchor_zero += 1
        samples.append(
            {
                "ticker": row.get("ticker"),
                "sync_med_pp_anchor_on": with_anchor.get("q50_sync_median_abs_vs_display"),
                "raw_med_pp_anchor_off": without.get("q50_raw_median_abs_vs_v4nodes"),
                "fan_hw_pp": with_anchor.get("fan_halfwidth_median_pp"),
            }
        )

    print(f"--- Campione {len(rows)} righe past_catalyst ---", flush=True)
    print(
        f"  Con ANCHOR+SYNC: {sync_zero}/{len(rows)} righe con |v5-v4 display| mediano < 0.02 pp",
        flush=True,
    )
    print(
        f"  Con ANCHOR OFF: {anchor_zero}/{len(rows)} righe con |v5 MC - v4 nodes| mediano > 1 pp",
        flush=True,
    )
    print("  Esempi (ticker, |v5-v4| sync ON, |v5-v4| anchor OFF, semi-larghezza fan):", flush=True)
    for s in samples[:8]:
        print(f"    {s}", flush=True)
    print("=" * 72, flush=True)


def main() -> None:
    run_similarity_check()


if __name__ == "__main__":
    main()
