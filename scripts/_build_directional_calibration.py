"""
Calcola e salva data/accuracy_directional_calibration.json
con hit% separati per Stabile vs Direzionale e tre KPI stratificati:

  - Raw:    tutti i record con affid > 0 (legacy, per retro-compatibilità).
  - Utile:  affid >= 50 e |actual| >= 2%  (esclude la fascia "rumore" dove
            actual=0 o sotto la noise floor del prezzo).
  - Forte:  affid >= 50 e |actual| >= 3%  (segnali ad alta convinzione).

Confronta `dir_v4_tN` con `dN_pct` a orizzonte MATCHATO (T+1, T+3, T+5)
invece di `dir_v4` generico vs first-available actual (vecchio bug).
"""
from __future__ import annotations
import json, os, sys
from datetime import datetime, timezone
from typing import Iterable

# ── Configurazione popolazioni KPI ────────────────────────────────────────────
USEFUL_AFFID_MIN  = 50      # zona "utile" — sotto: data quality
USEFUL_ACT_MIN    = 2.0     # |actual| minimo per "utile" (filtro rumore)
STRONG_ACT_MIN    = 3.0     # |actual| minimo per "segnale forte"
NOISE_FLOOR_PCT   = 1.0     # |actual| < 1% = movimento zero (illiquido)

# ── Orizzonti matched dir_v4_tN <-> dN_pct ────────────────────────────────────
HORIZONS = [
    ("t1",  "dir_v4_t1", "d1_pct"),
    ("t3",  "dir_v4_t3", "d3_pct"),
    ("t5",  "dir_v4_t5", "d5_pct"),
]


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _affid(r: dict) -> int:
    try:
        return int(r.get("affidabilita", 0) or 0)
    except (TypeError, ValueError):
        return 0


def _is_directional_label(s: str) -> bool:
    return s.startswith("\u2191") or s.startswith("\u2193")  # ↑ ↓


def _is_stable_label(s: str) -> bool:
    return s.startswith("\u2192") or "Stab" in s  # →


def _hits_directional(pred: str, actual: float) -> bool | None:
    """True/False solo se label è direzionale, None se Stabile/vuota."""
    if not pred:
        return None
    if pred.startswith("\u2191"):
        return actual > 0
    if pred.startswith("\u2193"):
        return actual < 0
    return None  # Stabile / vuoto


def _hits_with_stable(pred: str, actual: float, stable_band_pct: float = 5.0) -> bool | None:
    """Include valutazione delle 'Stabile' come hit se |actual| < band."""
    if not pred:
        return None
    if pred.startswith("\u2191"):
        return actual > 0
    if pred.startswith("\u2193"):
        return actual < 0
    if _is_stable_label(pred):
        return abs(actual) < stable_band_pct
    return None


def _stat(records: Iterable[dict], *, with_stable: bool = False) -> dict:
    """Statistica generica su (pred_label, actual_pct) tuple ottenuti dai record."""
    h = w = 0
    skipped_no_actual = 0
    for pred, actual in records:
        if actual is None:
            skipped_no_actual += 1
            continue
        res = _hits_with_stable(pred, actual) if with_stable else _hits_directional(pred, actual)
        if res is True:
            h += 1
        elif res is False:
            w += 1
    tot = h + w
    return {
        "n": tot,
        "hits": h,
        "wrong": w,
        "hit_pct": round(h / tot * 100, 1) if tot else None,
        "skipped_no_actual": skipped_no_actual,
    }


def _matched_pairs(rows: list[dict]) -> list[tuple[str, float | None, int]]:
    """
    Genera coppie (pred_label, actual, affid) PER OGNI orizzonte (t1/t3/t5)
    di ogni record. Un record può contribuire fino a 3 osservazioni.

    Questo confronta la prediction direzionale all'orizzonte CORRETTO con
    l'actual misurato allo stesso orizzonte — fix del bug `dir_v4` vs
    `d3_pct OR d5_pct`.
    """
    out = []
    for r in rows:
        aff = _affid(r)
        for _, dkey, akey in HORIZONS:
            pred = str(r.get(dkey) or "")
            if not pred:
                continue
            actual = _safe_float(r.get(akey))
            out.append((pred, actual, aff))
    return out


def _filter_pairs(
    pairs: list[tuple[str, float | None, int]],
    *,
    affid_min: int = 0,
    abs_act_min: float = 0.0,
) -> list[tuple[str, float | None]]:
    out: list[tuple[str, float | None]] = []
    for pred, actual, aff in pairs:
        if aff < affid_min:
            continue
        if actual is None:
            continue
        if abs(actual) < abs_act_min:
            continue
        out.append((pred, actual))
    return out


def _aff_band_stat(
    pairs: list[tuple[str, float | None, int]],
    lo: int,
    hi: int,
) -> dict:
    band = [(p, a, aff) for p, a, aff in pairs if lo <= aff <= hi]
    # Totale
    total_pairs = [(p, a) for p, a, _ in band]
    s = _stat(total_pairs, with_stable=True)
    # Solo direzionali
    dir_pairs = [(p, a) for p, a, _ in band if _is_directional_label(p)]
    sd = _stat(dir_pairs, with_stable=False)
    return {
        "n_total": s["n"],
        "hit_pct": s["hit_pct"],
        "n_directional": sd["n"],
        "hit_pct_directional": sd["hit_pct"],
    }


def _compute(past_pred_json_path: str) -> dict:
    with open(past_pred_json_path, encoding="utf-8") as f:
        doc = json.load(f)
    raw = doc.get("rows", {})
    rows = list(raw.values()) if isinstance(raw, dict) else list(raw)

    aff_gt0 = [r for r in rows if _affid(r) > 0]

    # Coppie (pred_label_matched, actual_matched, affid) — UNA RIGA PER ORIZZONTE
    pairs_all = _matched_pairs(aff_gt0)

    # ── KPI globali ───────────────────────────────────────────────────────────
    # RAW: tutti i pairs con actual presente (riproduce vecchio comportamento
    # ma con orizzonti matched). Include label "Stabile" valutate con band 5%.
    raw_all_pairs = [(p, a) for p, a, _ in pairs_all if a is not None]
    raw_dir_pairs = [(p, a) for p, a, _ in pairs_all
                     if a is not None and _is_directional_label(p)]
    stat_raw_global = _stat(raw_all_pairs, with_stable=True)
    stat_raw_direct = _stat(raw_dir_pairs, with_stable=False)

    # UTILE: affid >= 50 e |actual| >= 2% (esclude rumore data-quality)
    useful_pairs   = _filter_pairs(pairs_all, affid_min=USEFUL_AFFID_MIN, abs_act_min=USEFUL_ACT_MIN)
    useful_dir     = [(p, a) for p, a in useful_pairs if _is_directional_label(p)]
    stat_useful_global = _stat(useful_pairs, with_stable=True)
    stat_useful_direct = _stat(useful_dir, with_stable=False)

    # FORTE: affid >= 50 e |actual| >= 3%
    strong_pairs   = _filter_pairs(pairs_all, affid_min=USEFUL_AFFID_MIN, abs_act_min=STRONG_ACT_MIN)
    strong_dir     = [(p, a) for p, a in strong_pairs if _is_directional_label(p)]
    stat_strong_global = _stat(strong_pairs, with_stable=True)
    stat_strong_direct = _stat(strong_dir, with_stable=False)

    # Sotto-soglia rumore (per diagnostica)
    noise_pairs    = _filter_pairs(pairs_all, affid_min=0, abs_act_min=0.0)
    noise_only     = [(p, a) for p, a in noise_pairs if abs(a) < NOISE_FLOOR_PCT]
    stat_noise     = _stat(noise_only, with_stable=False)

    # ── Per-orizzonte breakdown (matched) ─────────────────────────────────────
    per_horizon: dict[str, dict] = {}
    for hlabel, dkey, akey in HORIZONS:
        pairs = []
        pairs_useful = []
        for r in aff_gt0:
            pred = str(r.get(dkey) or "")
            if not pred:
                continue
            actual = _safe_float(r.get(akey))
            if actual is None:
                continue
            aff = _affid(r)
            pairs.append((pred, actual))
            if aff >= USEFUL_AFFID_MIN and abs(actual) >= USEFUL_ACT_MIN:
                pairs_useful.append((pred, actual))
        dir_pairs = [(p, a) for p, a in pairs if _is_directional_label(p)]
        dir_useful = [(p, a) for p, a in pairs_useful if _is_directional_label(p)]
        per_horizon[hlabel] = {
            "raw":    _stat(dir_pairs, with_stable=False),
            "useful": _stat(dir_useful, with_stable=False),
        }

    # ── Calibrazione per fascia affidabilità (matched) ────────────────────────
    cal: dict[str, dict] = {}
    for label, lo, hi in [
        ("01-29", 1, 29),
        ("30-49", 30, 49),
        ("50-64", 50, 64),
        ("65-79", 65, 79),
        ("80-95", 80, 95),
    ]:
        cal[label] = _aff_band_stat(pairs_all, lo, hi)

    # ── Distribuzione per categoria direzionale (su raw_all) ─────────────────
    by_direction = {
        "up_strong":   _stat([(p, a) for p, a, _ in pairs_all if a is not None and p.startswith("\u2191\u2191")], with_stable=False),
        "up":          _stat([(p, a) for p, a, _ in pairs_all if a is not None and p.startswith("\u2191") and not p.startswith("\u2191\u2191")], with_stable=False),
        "stabile":     _stat([(p, a) for p, a, _ in pairs_all if a is not None and _is_stable_label(p)], with_stable=True),
        "down":        _stat([(p, a) for p, a, _ in pairs_all if a is not None and p.startswith("\u2193") and not p.startswith("\u2193\u2193")], with_stable=False),
        "down_strong": _stat([(p, a) for p, a, _ in pairs_all if a is not None and p.startswith("\u2193\u2193")], with_stable=False),
    }

    # ── % Stabile vs Direzionale (sui pairs_all con actual) ──────────────────
    n_with_actual = sum(1 for _, a, _ in pairs_all if a is not None)
    n_stabile     = sum(1 for p, a, _ in pairs_all if a is not None and _is_stable_label(p))
    n_directional = sum(1 for p, a, _ in pairs_all if a is not None and _is_directional_label(p))

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 2,  # bumped: matched horizons + stratified KPI
        "total_records_json": len(rows),
        "records_aff_gt0": len(aff_gt0),
        # ── KPI globali (3 popolazioni) ──
        "hit_global":         stat_raw_global["hit_pct"],            # include Stabile (legacy)
        "hit_directional":    stat_raw_direct["hit_pct"],            # solo ↑/↓ (legacy)
        "n_directional":      stat_raw_direct["n"],
        "n_stabile":          n_stabile,
        # ── Nuovi KPI stratificati ──
        "useful_hit_pct":              stat_useful_direct["hit_pct"],
        "useful_n_directional":        stat_useful_direct["n"],
        "useful_global_hit_pct":       stat_useful_global["hit_pct"],
        "strong_hit_pct":              stat_strong_direct["hit_pct"],
        "strong_n_directional":        stat_strong_direct["n"],
        "strong_global_hit_pct":       stat_strong_global["hit_pct"],
        # Filtri applicati (per UI/audit)
        "useful_filter": {
            "affid_min":  USEFUL_AFFID_MIN,
            "abs_act_min": USEFUL_ACT_MIN,
        },
        "strong_filter": {
            "affid_min":  USEFUL_AFFID_MIN,
            "abs_act_min": STRONG_ACT_MIN,
        },
        # Diagnostica rumore: fascia |actual| < 1% (data-quality)
        "noise_zone_n": stat_noise["n"],
        "noise_zone_hit_pct": stat_noise["hit_pct"],
        "noise_floor_pct": NOISE_FLOOR_PCT,
        # Composizione
        "pct_stabile":   round(n_stabile / n_with_actual * 100, 1) if n_with_actual else None,
        "n_with_actual_per_horizon": n_with_actual,
        # Breakdown
        "per_horizon": per_horizon,
        "by_direction": by_direction,
        "calibration_by_aff": cal,
    }


def build_and_save(
    past_pred_path: str | None = None,
    out_path: str | None = None,
    *,
    verbose: bool = True,
) -> dict:
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if past_pred_path is None:
        past_pred_path = os.path.join(ROOT, "data", "past_catalyst_predictions.json")
    if out_path is None:
        out_path = os.path.join(ROOT, "data", "accuracy_directional_calibration.json")

    result = _compute(past_pred_path)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    if verbose:
        print(
            f"[DirCalib v2] raw_dir={result['hit_directional']}% (n={result['n_directional']})  "
            f"useful={result['useful_hit_pct']}% (n={result['useful_n_directional']})  "
            f"strong={result['strong_hit_pct']}% (n={result['strong_n_directional']})  "
            f"=> {out_path}"
        )
    return result


if __name__ == "__main__":
    build_and_save(verbose=True)
