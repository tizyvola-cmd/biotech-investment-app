"""Shared types for the prediction package."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PredictionRunConfig:
    """Runtime options for a prediction pass (Phase B pipeline; not env flags)."""
    calibration_state: dict | None = None
    apply_seq_curve: bool = True
    apply_bias_correction: bool = True
    financial_df: Any = None


# Backward-compatible alias (per-run options; env flags: ``prediction.config.PredictionConfig``)
PredictionConfig = PredictionRunConfig


@dataclass
class DirectionResult:
    """Output of the direction ensemble (v4.1 — scores + confidence)."""
    direction_label: str
    notes: list[str] = field(default_factory=list)
    confidence: float = 0.0
    bull_score: int = 0
    bear_score: int = 0
    net_score: int = 0
    phase: int | None = None
    dir_liquidity_risk: int = 0
    dir_beta_risk: int = 0

    @property
    def direction(self) -> str:
        """Alias per compatibilità con codice che usa ``.direction``."""
        return self.direction_label

    @property
    def direction_confidence(self) -> float:
        """Alias esplicito per JSON predizione live."""
        return self.confidence


@dataclass
class CurveWaypoint:
    """
    Punto della curva predetta pre-catalyst con intervalli di confidenza.
    ``days_to_cd`` è negativo per convenzione (T-7 = -7).
    ``pred_pct`` è la variazione % attesa dal prezzo corrente.
    """
    days_to_cd: int        # es. -20, -15, -10, -7, -5, -3
    pred_pct: float        # mediana predetta (%)
    ci_68_lo: float        # intervallo 68% inferiore
    ci_68_hi: float        # intervallo 68% superiore
    ci_90_lo: float        # intervallo 90% inferiore
    ci_90_hi: float        # intervallo 90% superiore
    sigma_pp: float        # sigma in pp a questo orizzonte


@dataclass
class CurveForecast:
    """
    Curva predetta pre-catalyst con bande di confidenza calibrate empiricamente
    su 5.330 traiettorie storiche biotech.
    """
    waypoints: list[CurveWaypoint]
    regime: str            # "flat" | "moderate" | "btr" | "ctr"
    sigma_base_pp: float   # sigma base (RMSE storico per questo regime, T-30→T-7)
    uncertainty_label: str # "BASSA" | "MEDIA" | "ALTA" | "MOLTO ALTA"
    run_up_30d: float | None = None
    days_to_cd: int | None = None   # distanza dal CD al momento della prediction
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "regime": self.regime,
            "sigma_base_pp": round(self.sigma_base_pp, 2),
            "uncertainty_label": self.uncertainty_label,
            "run_up_30d": self.run_up_30d,
            "days_to_cd": self.days_to_cd,
            "notes": self.notes,
            "waypoints": [
                {
                    "days_to_cd": wp.days_to_cd,
                    "pred_pct": round(wp.pred_pct, 2),
                    "ci_68_lo": round(wp.ci_68_lo, 2),
                    "ci_68_hi": round(wp.ci_68_hi, 2),
                    "ci_90_lo": round(wp.ci_90_lo, 2),
                    "ci_90_hi": round(wp.ci_90_hi, 2),
                    "sigma_pp": round(wp.sigma_pp, 2),
                }
                for wp in self.waypoints
            ],
        }


@dataclass
class PrecatFitResult:
    """Raw precatalyst curve fit (before reversion cap / bias)."""
    best_name: str
    best_r2: float | None
    best_type: str  # lin | pol | exp
    best_coeffs: Any
    model_dm7_pct: float | None = None
    model_dm5_pct: float | None = None
    model_dm3_pct: float | None = None
    model_dm10_pct: float | None = None
    model_dm30_pct: float | None = None
    model_dm60_pct: float | None = None
    d3_pct: float | None = None
    d5_pct: float | None = None
    d10_pct: float | None = None
    d30_pct: float | None = None
    model_d4_pct: float | None = None
    model_d7_pct: float | None = None
