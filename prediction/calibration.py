"""
Prediction calibration JSON helpers and horizon bias.
"""
from __future__ import annotations

import json
import pathlib

from prediction.config import CALIB_PATH
from prediction.errors import log_prediction_error

_PHASE_NORM_SKIP = frozenset(
    s.lower() for s in ("nan", "nat", "none", "null", "n/d")
)


def phase_str_norm(val) -> str:
    """Fase clinica grezza → stringa usabile in Excel/JSON; vuoto se assente/N/A."""
    if val is None:
        return ""
    s = str(val).strip()
    if not s or s.lower() in _PHASE_NORM_SKIP:
        return ""
    if s.upper() == "N/D":
        return ""
    if len(s) == 1 and s in ("\u2014", "-", "\u2013", "\u2212"):
        return ""
    return s


def calib_load(path: pathlib.Path | str | None = None) -> list:
    """Carica il JSON di calibrazione. Restituisce lista (vuota se assente)."""
    p = pathlib.Path(path or CALIB_PATH)
    if not p.exists():
        return []
    try:
        recs = json.loads(p.read_text(encoding="utf-8"))
        for r in recs:
            if isinstance(r, dict):
                r["phase"] = phase_str_norm(r.get("phase"))
        return recs
    except Exception as exc:
        log_prediction_error(f"calib_load:{p}", exc)
        return []


def calib_save(records: list, path: pathlib.Path | str | None = None) -> None:
    """Salva il JSON di calibrazione su disco."""
    p = pathlib.Path(path or CALIB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(records, ensure_ascii=False, default=str, indent=2),
        encoding="utf-8",
    )


def calib_bias(records: list) -> dict:
    """Calcola il bias medio per orizzonte dai record completati (≥5 obs)."""
    done = [r for r in records if r.get("status") == "complete"]
    n = len(done)
    if n == 0:
        return {"n": 0, "d3": 0.0, "d5": 0.0, "d10": 0.0, "d30": 0.0}

    def _m(key):
        vals = [r[key] for r in done if r.get(key) is not None]
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    return {
        "n": n,
        "d3": _m("d3_err"),
        "d5": _m("d5_err"),
        "d10": _m("d10_err"),
        "d30": _m("d30_err"),
    }


def direction_calib_multiplier(records: list | None) -> float:
    """
    Moltiplicatore confidence direzione da storico ``ok_v4`` (se presente).

    Restituisce 1.0 se record assenti o meno di 5 osservazioni con esito noto.
    """
    if not records:
        return 1.0
    scored = [r for r in records if r.get("ok_v4") is not None]
    if len(scored) < 5:
        return 1.0
    hits = sum(1 for r in scored if r.get("ok_v4") is True)
    rate = hits / len(scored)
    # Accuratezza storica ~50% → 1.0; scala leggera ±15%
    return max(0.75, min(1.15, 0.85 + 0.3 * rate))
