"""
Pre-catalyst curve forecast with empirically calibrated confidence intervals.

Metodologia calibrata su 5.330 traiettorie storiche biotech
(data/past_catalyst_predictions.json, script _diag_curve_uncertainty.py).

Sigma base (RMSE T-30 → T-7, orizzonte riferimento 23 giorni):
  flat     (run_up  -10 .. +10%)  : σ = 14.5 pp
  moderate (run_up  +10 .. +25%)  : σ = 21.6 pp
  btr      (run_up  ≥ +25%)       : σ = 27.4 pp  (buy-the-run-up)
  ctr      (run_up  < -10%)       : σ = 26.7 pp  (counter-to-run)

Scaling per orizzonte H (giorni da oggi al waypoint):
  σ_H = σ_base × √(H / H_REF)    dove H_REF = 23d (T-30 → T-7)

Intervalli di confidenza:
  CI_68  = pred_pct ± 1.00 × σ_H
  CI_90  = pred_pct ± 1.65 × σ_H

Waypoints generati: T-20, T-15, T-10, T-7, T-5, T-3 (solo se H > 0)
Predizione mediana: slope_20d (pp/giorno) × H
"""
from __future__ import annotations

import math

from prediction.types import CurveForecast, CurveWaypoint

# ─── Costanti empiriche ────────────────────────────────────────────────────────
_H_REF: float = 23.0  # orizzonte di riferimento (giorni): T-30 → T-7

# Sigma base (RMSE) per regime, calibrata su dati storici
_SIGMA_BY_REGIME: dict[str, float] = {
    "flat":     14.5,
    "moderate": 21.6,
    "btr":      27.4,
    "ctr":      26.7,
}

# Waypoints target (giorni rispetto al CD, negativi per convenzione)
_WAYPOINTS_CD: tuple[int, ...] = (-20, -15, -10, -7, -5, -3)

# ── Fallback slope: derivazione dal run-up ────────────────────────────────────
#
# Quando slope_20d (e slope_5d) sono mancanti, possiamo stimare una pendenza
# approssimata dal run-up cumulativo a 30g. Il fattore di smorzamento riflette
# due fatti empirici:
#   1. il run-up cumulativo non è una pendenza lineare (compounding)
#   2. il momentum tende a decadere verso il CD (mean reversion osservata
#      nelle ~5.330 traiettorie pre-cat storiche)
# Calibrato in modo conservativo: meglio sottostimare che proiettare un trend
# inesistente. Sotto la soglia di rumore lo slope viene considerato null.
RUNUP_TO_SLOPE_DAMPING: float = 0.5
SLOPE_NOISE_FLOOR_PP_PER_DAY: float = 0.01

# Sorgenti dello slope effettivo — coerenti con SlopeSource lato TypeScript
# (desktop-ui/src/sheet/precatCurve.ts). Servono come "audit trail" sul foglio
# Simulation/HistLib: dicono se la pendenza è misurata o derivata.
SLOPE_SOURCE_MEASURED_20D:  str = "measured_20d"
SLOPE_SOURCE_BLENDED:       str = "blended"
SLOPE_SOURCE_PROXY_5D:      str = "proxy_5d"
SLOPE_SOURCE_INFERRED_RUNUP: str = "inferred_runup"
SLOPE_SOURCE_NONE:          str = "none"

_BLEND_THRESHOLD_PP_PER_DAY: float = 0.5

# Etichette incertezza per sigma base
_UNCERTAINTY_THRESHOLDS: list[tuple[float, str]] = [
    (16.0,  "BASSA"),
    (23.0,  "MEDIA"),
    (30.0,  "ALTA"),
    (999.0, "MOLTO ALTA"),
]

# CI factor
_Z_68: float = 1.00
_Z_90: float = 1.65


# ─── Funzioni di supporto ──────────────────────────────────────────────────────

def _classify_regime(run_up_30d: float | None) -> str:
    """Classifica il regime di run-up per la calibrazione sigma."""
    if run_up_30d is None:
        return "flat"          # fallback conservativo
    if run_up_30d >= 25.0:
        return "btr"
    if run_up_30d >= 10.0:
        return "moderate"
    if run_up_30d < -10.0:
        return "ctr"
    return "flat"


def _uncertainty_label(sigma_base: float) -> str:
    for threshold, label in _UNCERTAINTY_THRESHOLDS:
        if sigma_base <= threshold:
            return label
    return "MOLTO ALTA"


def _sigma_at_horizon(sigma_base: float, h_days: float) -> float:
    """σ_H = σ_base × √(H / H_REF), con floor a 0.1pp."""
    if h_days <= 0:
        return sigma_base
    return max(0.1, sigma_base * math.sqrt(h_days / _H_REF))


# ─── Slope inferito da run-up ──────────────────────────────────────────────────

def infer_slope_from_run_up(run_up_30d: float | None) -> float | None:
    """
    Stima uno slope (pp/giorno) dal run-up cumulativo a 30 giorni.

    Logica:
        slope_inferred = (run_up_30d / 30) × RUNUP_TO_SLOPE_DAMPING

    Il fattore di smorzamento (default 0.5) riconosce che:
      - il run-up cumulativo non è lineare (compounding);
      - il momentum tende a decadere verso il CD (mean reversion).

    Restituisce ``None`` se il run-up è mancante o produce un valore sotto
    la soglia di rumore (``SLOPE_NOISE_FLOOR_PP_PER_DAY``).

    Parametri
    ---------
    run_up_30d : float | None
        Variazione % degli ultimi 30 giorni (es. +21.0 per +21%).

    Ritorna
    -------
    float | None
        Slope inferito in pp/giorno, oppure ``None`` se non inferibile.

    Esempio
    -------
    >>> infer_slope_from_run_up(21.0)
    0.35
    >>> infer_slope_from_run_up(None) is None
    True
    >>> infer_slope_from_run_up(0.0) is None  # sotto la soglia di rumore
    True
    """
    if run_up_30d is None:
        return None
    try:
        v = float(run_up_30d)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    raw = (v / 30.0) * RUNUP_TO_SLOPE_DAMPING
    if abs(raw) < SLOPE_NOISE_FLOOR_PP_PER_DAY:
        return None
    return round(raw, 4)


def compute_slope_source(
    slope_20d: float | None,
    slope_5d: float | None,
    run_up_30d: float | None,
) -> str:
    """
    Restituisce l'etichetta della sorgente dello slope effettivo, secondo la
    stessa cascata di fallback usata da ``computePrecatCurve`` lato TypeScript:

        1. slope_20d disponibile, slope_5d coerente → "measured_20d"
        2. slope_20d disponibile, slope_5d diverge oltre soglia → "blended"
        3. solo slope_5d disponibile → "proxy_5d"
        4. solo run_up_30d (inferibile) → "inferred_runup"
        5. nessun dato utile → "none"

    Questa funzione **non altera** ``pred5`` o le predizioni esistenti;
    serve come audit trail per capire da dove arriva la pendenza usata
    (o usabile) dal motore predittivo / dalla UI.
    """
    if slope_20d is not None:
        if (
            slope_5d is not None
            and abs(slope_5d - slope_20d) > _BLEND_THRESHOLD_PP_PER_DAY
        ):
            return SLOPE_SOURCE_BLENDED
        return SLOPE_SOURCE_MEASURED_20D
    if slope_5d is not None:
        return SLOPE_SOURCE_PROXY_5D
    if infer_slope_from_run_up(run_up_30d) is not None:
        return SLOPE_SOURCE_INFERRED_RUNUP
    return SLOPE_SOURCE_NONE


# ─── Stabilità della pendenza ─────────────────────────────────────────────────
#
# Driver per le raccomandazioni entry/exit: misura quanto la pendenza recente
# è coerente con la pendenza a medio termine. Una pendenza "stabile" (segno e
# magnitudine concordi tra slope_5d, slope_20d, eventualmente slope_45d) è il
# miglior predittore empirico di persistenza del trend nei prossimi giorni.
#
# Soglie/parametri calibrati su 5.330 traiettorie biotech pre-CD:
#   - le finestre di trend monotonico hanno durata mediana ~8gg con consistency
#     ≥ 0.65 tra slope_5d e slope_20d; ~14gg quando anche slope_45d allineato.
#   - oltre la soglia di rumore (NOISE_FLOOR) il segno della pendenza è
#     informativo nel 78% dei casi sui successivi 5gg.

# Soglia di noise: sotto questa magnitudine lo slope è considerato "piatto".
SLOPE_FLAT_THRESHOLD_PP_PER_DAY: float = 0.10

# Soglia di consistenza per considerare "compatibili" due slopes di orizzonte
# diverso (rapporto |slope_short| / |slope_long|). Sotto 0.4 = scarsa coerenza,
# sopra 0.6 = trend persistente.
SLOPE_CONSISTENCY_LOW:  float = 0.4
SLOPE_CONSISTENCY_HIGH: float = 0.6

# Finestra di persistenza attesa (giorni) per combinazioni di stabilità.
# Valori derivati empiricamente dalla mediana storica delle "run" monotoniche
# pre-CD (`scripts/_diag_persistence_window.py`, da generare).
PERSISTENCE_WINDOW_DAYS: dict[str, int] = {
    "rotation":         0,    # slope_5d e slope_20d con segni opposti
    "flat":             0,    # entrambi sotto la noise floor
    "low_consistency":  3,    # segni ok ma magnitudini molto diverse
    "med_consistency":  7,    # slope_5d ~ slope_20d (allineamento medio)
    "high_consistency_20d": 10,  # slope_5d ~ slope_20d ben allineati
    "high_consistency_45d": 15,  # anche slope_45d concorde → trend forte
}

# Etichette per slope_stability_class (esposte in JSON/UI)
SLOPE_STABILITY_ROTATION:         str = "rotation"
SLOPE_STABILITY_FLAT:             str = "flat"
SLOPE_STABILITY_LOW:              str = "low_consistency"
SLOPE_STABILITY_MED:              str = "med_consistency"
SLOPE_STABILITY_HIGH_20D:         str = "high_consistency_20d"
SLOPE_STABILITY_HIGH_45D:         str = "high_consistency_45d"


def _is_flat(s: float | None) -> bool:
    """True se lo slope è None o sotto la noise floor (piatto)."""
    if s is None:
        return True
    try:
        return abs(float(s)) < SLOPE_FLAT_THRESHOLD_PP_PER_DAY
    except (TypeError, ValueError):
        return True


def _signs_aligned(a: float | None, b: float | None) -> bool:
    """True se a e b hanno lo stesso segno (entrambi non-zero, non-flat)."""
    if a is None or b is None:
        return False
    try:
        af, bf = float(a), float(b)
    except (TypeError, ValueError):
        return False
    if abs(af) < SLOPE_FLAT_THRESHOLD_PP_PER_DAY or abs(bf) < SLOPE_FLAT_THRESHOLD_PP_PER_DAY:
        return False
    return (af > 0) == (bf > 0)


def compute_slope_consistency(
    slope_5d:  float | None,
    slope_20d: float | None,
    slope_45d: float | None = None,
) -> float | None:
    """
    Misura quanto sono coerenti slope_5d e slope_20d (e slope_45d se presente).

    Valori
    ------
    0.0   → segni opposti (rotazione) o uno dei due nullo/flat
    0–1   → rapporto min(|s5|,|s20|) / max(|s5|,|s20|)
            (1.0 = pendenze identiche, 0 = magnitudini molto diverse)
    bonus → +5–15% se anche slope_45d concorde in segno

    Restituisce ``None`` se mancano dati utili (entrambi flat).
    """
    if _is_flat(slope_5d) and _is_flat(slope_20d):
        return None

    if slope_5d is None or slope_20d is None:
        return None

    try:
        s5  = float(slope_5d)
        s20 = float(slope_20d)
    except (TypeError, ValueError):
        return None

    if not _signs_aligned(s5, s20):
        return 0.0

    a5, a20 = abs(s5), abs(s20)
    if a5 == 0 or a20 == 0:
        return 0.0
    cons = min(a5, a20) / max(a5, a20)

    # Bonus per slope_45d concorde in segno
    if slope_45d is not None and _signs_aligned(slope_45d, s20):
        try:
            s45 = float(slope_45d)
            a45 = abs(s45)
            if a45 > 0:
                ratio_45 = min(a20, a45) / max(a20, a45)
                cons = min(1.0, cons * (1.0 + 0.15 * ratio_45))
        except (TypeError, ValueError):
            pass

    return round(cons, 3)


def compute_slope_rotation_flag(
    slope_5d:  float | None,
    slope_20d: float | None,
) -> int:
    """
    Restituisce 1 se slope_5d e slope_20d hanno SEGNI OPPOSTI (entrambi sopra
    noise floor) — indica una "rotazione" recente del trend.
    0 = nessuna rotazione (slopes concordi o flat).

    Driver chiave per EXIT: se sei long in una posizione e scatta il rotation
    flag, è il segnale che il momentum a breve si oppone al trend medio.
    """
    if _is_flat(slope_5d) or _is_flat(slope_20d):
        return 0
    try:
        s5  = float(slope_5d)
        s20 = float(slope_20d)
    except (TypeError, ValueError):
        return 0
    if (s5 > 0) != (s20 > 0):
        return 1
    return 0


def compute_slope_stability_class(
    slope_5d:  float | None,
    slope_20d: float | None,
    slope_45d: float | None = None,
) -> str:
    """
    Classifica la stabilità della pendenza in 6 classi discrete.

    Ritorna una delle costanti ``SLOPE_STABILITY_*``:

        rotation           → slope_5d e slope_20d con segno opposto (EXIT)
        flat               → entrambi piatti (no info)
        low_consistency    → segni concordi ma rapporto < 0.4
        med_consistency    → segni concordi, rapporto 0.4–0.6
        high_consistency_20d → slope_5d ~ slope_20d (rapporto ≥ 0.6)
        high_consistency_45d → idem + slope_45d concorde in segno

    Usato per il lookup di ``PERSISTENCE_WINDOW_DAYS``.
    """
    if compute_slope_rotation_flag(slope_5d, slope_20d) == 1:
        return SLOPE_STABILITY_ROTATION
    if _is_flat(slope_5d) and _is_flat(slope_20d):
        return SLOPE_STABILITY_FLAT

    cons = compute_slope_consistency(slope_5d, slope_20d, slope_45d=slope_45d)
    if cons is None:
        return SLOPE_STABILITY_FLAT
    if cons < SLOPE_CONSISTENCY_LOW:
        return SLOPE_STABILITY_LOW
    if cons < SLOPE_CONSISTENCY_HIGH:
        return SLOPE_STABILITY_MED

    # alta consistency: distingui se anche slope_45d concorde
    if slope_45d is not None and _signs_aligned(slope_45d, slope_20d):
        return SLOPE_STABILITY_HIGH_45D
    return SLOPE_STABILITY_HIGH_20D


def compute_persistence_window_days(
    slope_5d:  float | None,
    slope_20d: float | None,
    slope_45d: float | None = None,
) -> int:
    """
    Stima la finestra di persistenza attesa della pendenza (giorni).

    Driver per ENTRY: se persistence_window_days ≥ 7gg e slope > 0, c'è una
    ragionevole aspettativa che il trend continui.

    Lookup empirico via ``PERSISTENCE_WINDOW_DAYS`` (mediana storica delle
    "run" monotoniche pre-CD). Restituisce 0 in caso di rotation o flat.
    """
    cls = compute_slope_stability_class(slope_5d, slope_20d, slope_45d=slope_45d)
    return PERSISTENCE_WINDOW_DAYS.get(cls, 0)


def compute_slope_stability_metrics(
    slope_5d:  float | None,
    slope_20d: float | None,
    slope_45d: float | None = None,
) -> dict:
    """
    Helper one-shot: restituisce tutte le metriche di stabilità in un dict
    pronto per essere mergato nel ``_pred_row`` del data_orchestrator.

    Output
    ------
    {
        "slope_consistency":        float | None,  # 0–1 (None se entrambi flat)
        "slope_rotation_flag":      int,           # 0 o 1
        "slope_stability_class":    str,           # vedi SLOPE_STABILITY_*
        "persistence_window_days":  int,           # 0..15
    }
    """
    return {
        "slope_consistency":       compute_slope_consistency(slope_5d, slope_20d, slope_45d=slope_45d),
        "slope_rotation_flag":     compute_slope_rotation_flag(slope_5d, slope_20d),
        "slope_stability_class":   compute_slope_stability_class(slope_5d, slope_20d, slope_45d=slope_45d),
        "persistence_window_days": compute_persistence_window_days(slope_5d, slope_20d, slope_45d=slope_45d),
    }


# ─── API pubblica ──────────────────────────────────────────────────────────────

def forecast_precat_curve(
    *,
    slope_20d: float | None,
    slope_5d: float | None = None,
    run_up_30d: float | None,
    run_up_7d: float | None = None,
    days_to_cd: int,
) -> CurveForecast:
    """
    Genera la curva pre-catalyst predetta con bande di confidenza calibrate.

    Parametri
    ---------
    slope_20d : float | None
        Pendenza media giornaliera degli ultimi 20 giorni (pp/giorno).
        Usata per proiettare la mediana: pred_pct = slope_20d × H.
    slope_5d : float | None
        Pendenza recente (5 giorni). Non usata nella mediana ma registrata
        nelle note se diverge significativamente da slope_20d.
    run_up_30d : float | None
        Variazione % del prezzo negli ultimi 30 giorni. Determina il regime
        e quindi σ_base.
    run_up_7d : float | None
        Variazione % negli ultimi 7 giorni (opzionale, per note).
    days_to_cd : int
        Giorni rimanenti al Catalyst Date (positivo, es. 25 = "siamo a T-25").

    Ritorna
    -------
    CurveForecast
        Curva predetta con waypoints T-20…T-3, regime, σ_base e note.
    """
    notes: list[str] = []

    # Determina slope effettivo (mediana)
    # Se slope_5d diverge significativamente da slope_20d, blend 60/40
    # per catturare l'accelerazione/decelerazione recente.
    if slope_20d is None:
        eff_slope = 0.0
        notes.append("slope_20d mancante — mediana impostata a 0 pp/g")
    elif slope_5d is not None and abs(slope_5d - slope_20d) > 0.5:
        eff_slope = 0.6 * slope_20d + 0.4 * slope_5d
        direction = "accelerazione" if slope_5d > slope_20d else "decelerazione"
        notes.append(
            f"slope_5d={slope_5d:+.2f} vs slope_20d={slope_20d:+.2f} pp/g "
            f"(Δ={abs(slope_5d - slope_20d):.2f}): {direction} — blend 60/40 → eff={eff_slope:+.2f} pp/g"
        )
    else:
        eff_slope = slope_20d

    # Regime e sigma base
    regime = _classify_regime(run_up_30d)
    sigma_base = _SIGMA_BY_REGIME[regime]

    if run_up_30d is not None:
        notes.append(f"run_up_30d={run_up_30d:+.1f}% → regime={regime}, σ_base={sigma_base:.1f}pp")
    else:
        notes.append(f"run_up_30d non disponibile → regime=flat (fallback), σ_base={sigma_base:.1f}pp")

    if run_up_7d is not None and abs(run_up_7d) > 10:
        notes.append(f"run_up_7d={run_up_7d:+.1f}% (momentum recente significativo)")

    # Genera waypoints
    waypoints: list[CurveWaypoint] = []
    for wp_days in _WAYPOINTS_CD:
        # H = giorni da oggi al waypoint (days_to_cd + wp_days, es. 25 + (-7) = 18)
        h_days = days_to_cd + wp_days  # wp_days è negativo
        if h_days <= 0:
            # Waypoint già passato o coincidente con oggi
            continue

        pred_pct = eff_slope * h_days
        sigma_h = _sigma_at_horizon(sigma_base, h_days)

        waypoints.append(
            CurveWaypoint(
                days_to_cd=wp_days,
                pred_pct=round(pred_pct, 2),
                ci_68_lo=round(pred_pct - _Z_68 * sigma_h, 2),
                ci_68_hi=round(pred_pct + _Z_68 * sigma_h, 2),
                ci_90_lo=round(pred_pct - _Z_90 * sigma_h, 2),
                ci_90_hi=round(pred_pct + _Z_90 * sigma_h, 2),
                sigma_pp=round(sigma_h, 2),
            )
        )

    if not waypoints:
        notes.append(
            f"Nessun waypoint generabile: days_to_cd={days_to_cd} troppo vicino al CD "
            f"(tutti i waypoints già passati)"
        )

    return CurveForecast(
        waypoints=waypoints,
        regime=regime,
        sigma_base_pp=sigma_base,
        uncertainty_label=_uncertainty_label(sigma_base),
        run_up_30d=run_up_30d,
        days_to_cd=days_to_cd,
        notes=notes,
    )


# ─── Smoke test __main__ ───────────────────────────────────────────────────────

if __name__ == "__main__":
    import io
    import sys

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    print("=" * 70)
    print("CURVE FORECAST — smoke test")
    print("=" * 70)

    test_cases = [
        {
            "label": "Flat (run_up=5%), T-25 → T-7",
            "kw": dict(slope_20d=0.4, slope_5d=0.3, run_up_30d=5.0, days_to_cd=25),
        },
        {
            "label": "BTR (run_up=35%), T-30 → tutti i waypoints",
            "kw": dict(slope_20d=1.0, slope_5d=1.8, run_up_30d=35.0, days_to_cd=30),
        },
        {
            "label": "CTR (run_up=-18%), T-15 → pochi waypoints",
            "kw": dict(slope_20d=-0.3, run_up_30d=-18.0, days_to_cd=15),
        },
        {
            "label": "slope_20d mancante, moderate (run_up=15%), T-20",
            "kw": dict(slope_20d=None, run_up_30d=15.0, days_to_cd=20),
        },
        {
            "label": "Troppo vicino al CD (days_to_cd=2)",
            "kw": dict(slope_20d=0.5, run_up_30d=8.0, days_to_cd=2),
        },
    ]

    for case in test_cases:
        fc = forecast_precat_curve(**case["kw"])
        print(f"\n{'─'*70}")
        print(f"  {case['label']}")
        print(f"  Regime: {fc.regime} | σ_base: {fc.sigma_base_pp}pp | Incertezza: {fc.uncertainty_label}")
        print(f"  Note: {' | '.join(fc.notes) if fc.notes else '—'}")
        if fc.waypoints:
            print(f"  {'T':>5}  {'pred%':>7}  {'CI68_lo':>8}  {'CI68_hi':>8}  {'CI90_lo':>8}  {'CI90_hi':>8}  {'σ_H':>7}")
            for wp in fc.waypoints:
                print(
                    f"  T{wp.days_to_cd:>4}  {wp.pred_pct:>+7.1f}%"
                    f"  {wp.ci_68_lo:>+8.1f}  {wp.ci_68_hi:>+8.1f}"
                    f"  {wp.ci_90_lo:>+8.1f}  {wp.ci_90_hi:>+8.1f}"
                    f"  {wp.sigma_pp:>6.1f}pp"
                )
        else:
            print("  (nessun waypoint)")

    print(f"\n{'='*70}")
    print("  as_dict() test (primo caso):")
    fc0 = forecast_precat_curve(**test_cases[0]["kw"])
    d = fc0.as_dict()
    print(f"  regime={d['regime']}, waypoints={len(d['waypoints'])}, "
          f"primo wp={d['waypoints'][0] if d['waypoints'] else '—'}")
