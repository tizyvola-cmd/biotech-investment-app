"""
slope_contrarian_calib — feedback loop per il segnale slope5d.

Legge past_catalyst_predictions.json, identifica i setup contrarian
(slope5d forte e dir_v4 in direzione opposta) e calcola quanto spesso
il segnale slope5d era più affidabile del modello complessivo.

Output: data/slope_contrarian_calib.json
Il file viene poi letto da direction_ensemble.py per scalare il peso
del segnale s5d in modo adattivo.

Logica:
  model_down: slope5d ≥ +1.5  ma  dir_v4 è ↓/↓↓  → chi aveva ragione?
  model_up  : slope5d ≤ -1.5  ma  dir_v4 è ↑/↑↑  → chi aveva ragione?

  slope_win_rate → s5d_weight (0.6–2.0):
    50% → 1.0  (neutro — slope e modello si equivalgono)
    70% → 1.4  (slope più affidabile → dargli più peso)
    30% → 0.6  (modello più affidabile → ridurre peso slope5d)
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

# ── Percorsi ──────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PREDICTIONS_PATH = _DATA_DIR / "past_catalyst_predictions.json"
CALIB_OUT_PATH   = _DATA_DIR / "slope_contrarian_calib.json"

# ── Costanti ─────────────────────────────────────────────────────────────────
SLOPE5D_THRESHOLD   = 1.5    # pp/g — soglia "forte" (allineata a direction_ensemble.py)
OUTCOME_HORIZON     = "d5_pct"
OUTCOME_THRESHOLD   = 2.0    # ±2 pp per classificare outcome come ↑/↓ (filtra rumore)
MIN_CASES           = 8      # casi minimi per usare il weight calibrato
WEIGHT_NEUTRAL      = 1.0
WEIGHT_MIN          = 0.6
WEIGHT_MAX          = 2.0

# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_bearish(label: str) -> bool:
    d = str(label or "")
    return d.startswith("↓") or "calo" in d.lower()


def _is_bullish(label: str) -> bool:
    d = str(label or "")
    return d.startswith("↑") or "crescita" in d.lower()


def _slope_win_to_weight(slope_win_rate: float) -> float:
    """Mappa slope_win_rate (0-1) → weight (0.6-2.0).

    50% = neutro → 1.0
    70% → 1.4
    30% → 0.6
    Interpolazione lineare attorno a 50%.
    """
    if not math.isfinite(slope_win_rate):
        return WEIGHT_NEUTRAL
    raw = slope_win_rate / 0.50  # 0.5→1.0, 0.7→1.4, 0.3→0.6
    return round(max(WEIGHT_MIN, min(WEIGHT_MAX, raw)), 4)


def _stats_for(cases: list[dict]) -> dict:
    n = len(cases)
    if n == 0:
        return {"n": 0, "model_win_rate": None, "slope_win_rate": None,
                "s5d_weight": WEIGHT_NEUTRAL, "reliable": False}
    model_wins = sum(1 for c in cases if c["model_won"])
    slope_wins = sum(1 for c in cases if c["slope_won"])
    model_rate = model_wins / n
    slope_rate = slope_wins / n
    reliable   = n >= MIN_CASES
    weight     = _slope_win_to_weight(slope_rate) if reliable else WEIGHT_NEUTRAL
    return {
        "n":              n,
        "model_win_rate": round(model_rate, 4),
        "slope_win_rate": round(slope_rate, 4),
        "s5d_weight":     weight,
        "reliable":       reliable,
    }


# ── Core ──────────────────────────────────────────────────────────────────────

def compute_contrarian_calibration(rows: list[dict]) -> dict:
    """Analizza i record con esito noto e restituisce il dizionario di calibrazione."""
    model_down: list[dict] = []  # slope5d ↑ ma modello ↓
    model_up:   list[dict] = []  # slope5d ↓ ma modello ↑

    for r in rows:
        s5_raw = r.get("slope_5d")
        dir_v4 = str(r.get("dir_v4") or "")
        d5_raw = r.get(OUTCOME_HORIZON)

        if s5_raw is None or d5_raw is None:
            continue
        try:
            s5  = float(s5_raw)
            d5  = float(d5_raw)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(s5) and math.isfinite(d5)):
            continue

        is_contrarian_down = s5 >= SLOPE5D_THRESHOLD  and _is_bearish(dir_v4)
        is_contrarian_up   = s5 <= -SLOPE5D_THRESHOLD and _is_bullish(dir_v4)

        if is_contrarian_down:
            model_down.append({
                "slope5d": s5, "dir_v4": dir_v4, "d5": d5,
                # slope diceva ↑ (forte) → vinceva se price > +threshold
                "slope_won": d5 >  OUTCOME_THRESHOLD,
                # modello diceva ↓ → vinceva se price < -threshold
                "model_won": d5 < -OUTCOME_THRESHOLD,
            })
        elif is_contrarian_up:
            model_up.append({
                "slope5d": s5, "dir_v4": dir_v4, "d5": d5,
                # slope diceva ↓ (forte negativo) → vinceva se price < -threshold
                "slope_won": d5 < -OUTCOME_THRESHOLD,
                # modello diceva ↑ → vinceva se price > +threshold
                "model_won": d5 >  OUTCOME_THRESHOLD,
            })

    down_stats = _stats_for(model_down)
    up_stats   = _stats_for(model_up)

    n_total = down_stats["n"] + up_stats["n"]
    if n_total >= MIN_CASES:
        # Media pesata per numero di casi
        w_comb = (
            down_stats["n"] * down_stats["s5d_weight"] +
            up_stats["n"]   * up_stats["s5d_weight"]
        ) / n_total
    else:
        w_comb = WEIGHT_NEUTRAL

    return {
        "schema_version":           1,
        "generated_at":             datetime.now(timezone.utc).isoformat(),
        "outcome_horizon":          OUTCOME_HORIZON,
        "outcome_threshold_pct":    OUTCOME_THRESHOLD,
        "slope5d_threshold":        SLOPE5D_THRESHOLD,
        "n_contrarian_total":       n_total,
        "model_down":               down_stats,   # slope↑ ma modello↓
        "model_up":                 up_stats,     # slope↓ ma modello↑
        "combined_s5d_weight":      round(max(WEIGHT_MIN, min(WEIGHT_MAX, w_comb)), 4),
        "min_cases_for_calibration": MIN_CASES,
        "note": (
            "weight > 1: slope5d più affidabile del modello in setup contrarian → aumentare peso. "
            "weight < 1: modello più affidabile → ridurre peso slope5d."
        ),
    }


def run_contrarian_calibration(
    predictions_path: Path | str | None = None,
    output_path: Path | str | None = None,
) -> dict:
    """Entry point per l'orchestrator. Legge, calcola, scrive. Non lancia eccezioni."""
    pred_path = Path(predictions_path or PREDICTIONS_PATH)
    out_path  = Path(output_path or CALIB_OUT_PATH)

    if not pred_path.exists():
        print(f"[ContrarianCalib] File non trovato: {pred_path} — skip.")
        return {}

    try:
        data = json.loads(pred_path.read_text(encoding="utf-8"))
        rows_raw = data.get("rows", {})
        rows = list(rows_raw.values()) if isinstance(rows_raw, dict) else list(rows_raw)
        # Solo record con esito (d5_pct presente)
        past_rows = [r for r in rows if r.get(OUTCOME_HORIZON) is not None]
    except Exception as exc:
        print(f"[ContrarianCalib] Lettura fallita: {exc} — skip.")
        return {}

    result = compute_contrarian_calibration(past_rows)
    result["n_past_rows_analyzed"] = len(past_rows)

    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        w = result.get("combined_s5d_weight", WEIGHT_NEUTRAL)
        n = result.get("n_contrarian_total", 0)
        reliable = (result.get("model_down", {}).get("reliable") or
                    result.get("model_up",   {}).get("reliable"))
        print(
            f"[ContrarianCalib] {len(past_rows)} record passati · "
            f"{n} contrarian · s5d_weight={w:.3f}"
            + ("" if reliable else " (dati insufficienti — peso=1.0 default)")
        )
    except Exception as exc:
        print(f"[ContrarianCalib] Salvataggio KO (non bloccante): {exc}")

    return result


if __name__ == "__main__":
    run_contrarian_calibration()
