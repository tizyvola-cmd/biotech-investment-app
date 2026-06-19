"""Tests for prediction.curve_forecast — pre-catalyst curve with calibrated CI."""
import math

import pytest

from prediction.curve_forecast import forecast_precat_curve, _classify_regime, _sigma_at_horizon
from prediction.types import CurveForecast, CurveWaypoint


# ─── Regime classification ─────────────────────────────────────────────────────

class TestClassifyRegime:
    def test_flat_positive(self):
        assert _classify_regime(5.0) == "flat"

    def test_flat_negative_mild(self):
        assert _classify_regime(-5.0) == "flat"

    def test_flat_zero(self):
        assert _classify_regime(0.0) == "flat"

    def test_flat_boundary_low(self):
        assert _classify_regime(-10.0) == "flat"   # bordo superiore CTR non incluso

    def test_moderate(self):
        assert _classify_regime(15.0) == "moderate"

    def test_moderate_boundary_low(self):
        assert _classify_regime(10.0) == "moderate"

    def test_btr(self):
        assert _classify_regime(30.0) == "btr"

    def test_btr_boundary(self):
        assert _classify_regime(25.0) == "btr"

    def test_ctr(self):
        assert _classify_regime(-20.0) == "ctr"

    def test_ctr_just_below_minus10(self):
        assert _classify_regime(-10.1) == "ctr"

    def test_none_fallback_flat(self):
        assert _classify_regime(None) == "flat"


# ─── Sigma scaling ─────────────────────────────────────────────────────────────

class TestSigmaAtHorizon:
    def test_reference_horizon_unchanged(self):
        """σ_H al riferimento (23d) = σ_base."""
        sigma = _sigma_at_horizon(14.5, 23.0)
        assert abs(sigma - 14.5) < 0.01

    def test_shorter_horizon_smaller_sigma(self):
        """Orizzonte più breve → σ più piccola."""
        s_short = _sigma_at_horizon(14.5, 10.0)
        s_long  = _sigma_at_horizon(14.5, 30.0)
        assert s_short < 14.5 < s_long

    def test_zero_horizon_floor(self):
        """Orizzonte 0 → floor, non errore."""
        sigma = _sigma_at_horizon(14.5, 0.0)
        assert sigma >= 0.1

    def test_sqrt_scaling(self):
        """Verifica esplicita: σ_H = σ_base × √(H/23)."""
        sigma_base, h = 21.6, 10
        expected = 21.6 * math.sqrt(10 / 23)
        result = _sigma_at_horizon(sigma_base, h)
        assert abs(result - expected) < 0.01


# ─── forecast_precat_curve — waypoints ────────────────────────────────────────

class TestForecastPrecatCurve:
    def _fc(self, **kw) -> CurveForecast:
        defaults = dict(slope_20d=0.4, run_up_30d=5.0, days_to_cd=25)
        defaults.update(kw)
        return forecast_precat_curve(**defaults)

    def test_returns_curve_forecast_type(self):
        fc = self._fc()
        assert isinstance(fc, CurveForecast)

    def test_waypoints_are_curve_waypoints(self):
        fc = self._fc()
        for wp in fc.waypoints:
            assert isinstance(wp, CurveWaypoint)

    def test_waypoints_negative_days(self):
        """Tutti i days_to_cd dei waypoints sono negativi."""
        fc = self._fc()
        for wp in fc.waypoints:
            assert wp.days_to_cd < 0

    def test_waypoints_in_future_only(self):
        """Solo waypoints con H > 0 vengono generati (T-20..T-3 < days_to_cd=25)."""
        fc = self._fc(days_to_cd=25)
        for wp in fc.waypoints:
            h = 25 + wp.days_to_cd
            assert h > 0

    def test_t30_generates_all_waypoints(self):
        """A T-30 tutti i waypoints standard (-20,-15,-10,-7,-5,-3) sono futuri."""
        fc = self._fc(days_to_cd=30)
        waypoint_days = [wp.days_to_cd for wp in fc.waypoints]
        assert -20 in waypoint_days
        assert -7  in waypoint_days
        assert -3  in waypoint_days
        assert len(fc.waypoints) == 6

    def test_t15_skips_t20(self):
        """A T-15, T-20 è già passato (H=-5 < 0): non deve comparire."""
        fc = self._fc(days_to_cd=15)
        waypoint_days = [wp.days_to_cd for wp in fc.waypoints]
        assert -20 not in waypoint_days
        assert -15 not in waypoint_days
        assert -10 in waypoint_days

    def test_too_close_to_cd_no_waypoints(self):
        """A T-2 tutti i waypoints (-3..-20) sono già passati."""
        fc = self._fc(days_to_cd=2)
        assert fc.waypoints == []
        assert any("nessun waypoint" in n.lower() for n in fc.notes)

    def test_ci_order(self):
        """CI_90 contiene CI_68 (più ampio)."""
        fc = self._fc()
        for wp in fc.waypoints:
            assert wp.ci_90_lo <= wp.ci_68_lo
            assert wp.ci_68_hi <= wp.ci_90_hi

    def test_ci_symmetric_around_pred(self):
        """CI_68 simmetrico attorno alla mediana (entro 0.01pp di tolleranza)."""
        fc = self._fc()
        for wp in fc.waypoints:
            half68 = (wp.ci_68_hi - wp.ci_68_lo) / 2
            center = (wp.ci_68_hi + wp.ci_68_lo) / 2
            assert abs(center - wp.pred_pct) < 0.02

    def test_pred_pct_linear_slope(self):
        """pred_pct = slope_20d × H = slope_20d × (days_to_cd + waypoint.days_to_cd)."""
        slope = 0.5
        days_to_cd = 30
        fc = forecast_precat_curve(slope_20d=slope, run_up_30d=5.0, days_to_cd=days_to_cd)
        for wp in fc.waypoints:
            h = days_to_cd + wp.days_to_cd
            expected = slope * h
            assert abs(wp.pred_pct - expected) < 0.05  # tolleranza arrotondamento

    def test_sigma_increases_with_horizon(self):
        """Waypoints più lontani dal CD hanno σ_H più grande."""
        fc = self._fc(days_to_cd=30)
        # T-20 è più lontano da oggi di T-3 quando siamo a T-30:
        # H(-20) = 10, H(-3) = 27 → σ(-3) > σ(-20)
        wp_dict = {wp.days_to_cd: wp for wp in fc.waypoints}
        if -20 in wp_dict and -3 in wp_dict:
            assert wp_dict[-3].sigma_pp > wp_dict[-20].sigma_pp

    # ─── Regimes ──────────────────────────────────────────────────────────────

    def test_regime_btr_higher_sigma(self):
        fc_flat = forecast_precat_curve(slope_20d=0.4, run_up_30d=5.0, days_to_cd=25)
        fc_btr  = forecast_precat_curve(slope_20d=0.4, run_up_30d=35.0, days_to_cd=25)
        assert fc_btr.sigma_base_pp > fc_flat.sigma_base_pp
        assert fc_btr.regime == "btr"
        assert fc_flat.regime == "flat"

    def test_regime_ctr_higher_sigma_than_flat(self):
        fc_flat = forecast_precat_curve(slope_20d=0.4, run_up_30d=5.0, days_to_cd=25)
        fc_ctr  = forecast_precat_curve(slope_20d=0.4, run_up_30d=-18.0, days_to_cd=25)
        assert fc_ctr.sigma_base_pp > fc_flat.sigma_base_pp
        assert fc_ctr.regime == "ctr"

    def test_uncertainty_labels(self):
        fc_flat = forecast_precat_curve(slope_20d=0.4, run_up_30d=5.0, days_to_cd=25)
        fc_btr  = forecast_precat_curve(slope_20d=0.4, run_up_30d=35.0, days_to_cd=25)
        assert fc_flat.uncertainty_label == "BASSA"
        assert fc_btr.uncertainty_label  == "ALTA"

    # ─── Edge cases ───────────────────────────────────────────────────────────

    def test_slope_none_fallback(self):
        """slope_20d=None → mediana 0, ma CI/σ correttamente calcolate."""
        fc = forecast_precat_curve(slope_20d=None, run_up_30d=5.0, days_to_cd=25)
        for wp in fc.waypoints:
            assert wp.pred_pct == 0.0
        assert any("slope_20d mancante" in n for n in fc.notes)

    def test_run_up_none_fallback_flat(self):
        """run_up_30d=None → regime flat (fallback conservativo)."""
        fc = forecast_precat_curve(slope_20d=0.4, run_up_30d=None, days_to_cd=25)
        assert fc.regime == "flat"
        assert any("non disponibile" in n for n in fc.notes)

    def test_slope5d_divergence_note(self):
        """Se slope_5d diverge molto da slope_20d, blend 60/40 + nota."""
        fc = forecast_precat_curve(
            slope_20d=0.3, slope_5d=1.5, run_up_30d=10.0, days_to_cd=25
        )
        assert any("accelerazione" in n or "decelerazione" in n for n in fc.notes)
        assert any("blend" in n for n in fc.notes)

    def test_slope5d_blend_changes_median(self):
        """Il blend 60/40 deve produrre una mediana diversa da slope_20d puro."""
        fc_pure = forecast_precat_curve(slope_20d=0.3, run_up_30d=10.0, days_to_cd=25)
        fc_blend = forecast_precat_curve(
            slope_20d=0.3, slope_5d=1.5, run_up_30d=10.0, days_to_cd=25
        )
        # eff_slope blend = 0.6*0.3 + 0.4*1.5 = 0.78 > 0.3
        for wp_pure, wp_blend in zip(fc_pure.waypoints, fc_blend.waypoints):
            assert wp_blend.pred_pct > wp_pure.pred_pct

    def test_slope5d_small_divergence_no_blend(self):
        """Se la divergenza è ≤0.5, nessun blend (nota assente)."""
        fc = forecast_precat_curve(
            slope_20d=0.4, slope_5d=0.7, run_up_30d=10.0, days_to_cd=25  # Δ=0.3
        )
        assert not any("blend" in n for n in fc.notes)

    def test_run_up_7d_note(self):
        """run_up_7d significativo (>10%) → nota nel CurveForecast."""
        fc = forecast_precat_curve(
            slope_20d=0.5, run_up_30d=12.0, run_up_7d=15.0, days_to_cd=25
        )
        assert any("run_up_7d" in n for n in fc.notes)

    # ─── as_dict ──────────────────────────────────────────────────────────────

    def test_as_dict_structure(self):
        fc = self._fc()
        d = fc.as_dict()
        assert "regime" in d
        assert "sigma_base_pp" in d
        assert "uncertainty_label" in d
        assert "waypoints" in d
        assert isinstance(d["waypoints"], list)

    def test_as_dict_waypoint_keys(self):
        fc = self._fc()
        d = fc.as_dict()
        wp = d["waypoints"][0]
        assert "days_to_cd" in wp
        assert "pred_pct" in wp
        assert "ci_68_lo" in wp
        assert "ci_68_hi" in wp
        assert "ci_90_lo" in wp
        assert "ci_90_hi" in wp
        assert "sigma_pp" in wp

    def test_as_dict_json_safe(self):
        """Tutti i valori in as_dict devono essere JSON-serializzabili."""
        import json
        fc = self._fc()
        json.dumps(fc.as_dict())  # non deve sollevare eccezioni


# ─── Pipeline integration ─────────────────────────────────────────────────────

class TestForecastPrecatCurveForRow:
    def test_valid_row(self):
        from prediction.pipeline import forecast_precat_curve_for_row
        row = {
            "ticker": "MRNA",
            "slope_20d": 0.5,
            "slope_5d": 0.4,
            "run_up_30d": 8.0,
            "run_up_7d": 3.0,
            "days_to_t": 20,
        }
        result = forecast_precat_curve_for_row(row)
        assert result is not None
        assert "regime" in result
        assert "waypoints" in result

    def test_days_to_t_none_returns_none(self):
        from prediction.pipeline import forecast_precat_curve_for_row
        row = {"ticker": "MRNA", "slope_20d": 0.5, "run_up_30d": 8.0, "days_to_t": None}
        assert forecast_precat_curve_for_row(row) is None

    def test_days_to_t_zero_returns_none(self):
        from prediction.pipeline import forecast_precat_curve_for_row
        row = {"ticker": "MRNA", "slope_20d": 0.5, "run_up_30d": 8.0, "days_to_t": 0}
        assert forecast_precat_curve_for_row(row) is None

    def test_days_to_t_negative_returns_none(self):
        from prediction.pipeline import forecast_precat_curve_for_row
        row = {"ticker": "MRNA", "slope_20d": 0.5, "run_up_30d": 8.0, "days_to_t": -5}
        assert forecast_precat_curve_for_row(row) is None


# ─── infer_slope_from_run_up ─────────────────────────────────────────────────

class TestInferSlopeFromRunUp:
    """Helper di fallback: stima uno slope (pp/g) dal run-up cumulativo 30g."""

    def test_positive_runup_produces_positive_slope(self):
        from prediction.curve_forecast import infer_slope_from_run_up
        # +21% in 30g, smorzato ×0.5 → +0.35 pp/g
        result = infer_slope_from_run_up(21.0)
        assert result is not None
        assert abs(result - 0.35) < 1e-3

    def test_negative_runup_produces_negative_slope(self):
        from prediction.curve_forecast import infer_slope_from_run_up
        # -15% in 30g, smorzato ×0.5 → -0.25 pp/g
        result = infer_slope_from_run_up(-15.0)
        assert result is not None
        assert abs(result - (-0.25)) < 1e-3

    def test_none_returns_none(self):
        from prediction.curve_forecast import infer_slope_from_run_up
        assert infer_slope_from_run_up(None) is None

    def test_zero_runup_below_noise_floor(self):
        from prediction.curve_forecast import infer_slope_from_run_up
        # 0/30 × 0.5 = 0 < 0.01 → None
        assert infer_slope_from_run_up(0.0) is None

    def test_tiny_runup_below_noise_floor(self):
        from prediction.curve_forecast import infer_slope_from_run_up
        # 0.3% in 30g × 0.5 = 0.005 < 0.01 → None
        assert infer_slope_from_run_up(0.3) is None

    def test_non_finite_returns_none(self):
        from prediction.curve_forecast import infer_slope_from_run_up
        assert infer_slope_from_run_up(float("nan")) is None
        assert infer_slope_from_run_up(float("inf")) is None

    def test_invalid_string_returns_none(self):
        from prediction.curve_forecast import infer_slope_from_run_up
        assert infer_slope_from_run_up("abc") is None  # type: ignore[arg-type]


# ─── compute_slope_source ────────────────────────────────────────────────────

class TestComputeSlopeSource:
    """Cascata di fallback per la sorgente dello slope effettivo."""

    def test_measured_when_slope_20d_alone(self):
        from prediction.curve_forecast import compute_slope_source
        assert compute_slope_source(0.4, None, 5.0) == "measured_20d"

    def test_measured_when_slope_5d_coherent(self):
        from prediction.curve_forecast import compute_slope_source
        # divergenza 0.2 < soglia 0.5 → no blend
        assert compute_slope_source(0.4, 0.6, 5.0) == "measured_20d"

    def test_blended_when_divergence_above_threshold(self):
        from prediction.curve_forecast import compute_slope_source
        # divergenza 1.0 > soglia 0.5 → blend
        assert compute_slope_source(0.3, 1.3, 10.0) == "blended"

    def test_proxy_5d_when_only_slope_5d(self):
        from prediction.curve_forecast import compute_slope_source
        assert compute_slope_source(None, 0.7, 5.0) == "proxy_5d"

    def test_inferred_runup_when_only_run_up(self):
        from prediction.curve_forecast import compute_slope_source
        assert compute_slope_source(None, None, 21.0) == "inferred_runup"

    def test_none_when_no_data(self):
        from prediction.curve_forecast import compute_slope_source
        assert compute_slope_source(None, None, None) == "none"

    def test_none_when_runup_below_noise_floor(self):
        from prediction.curve_forecast import compute_slope_source
        # run_up=0.3 → slope inferito 0.005 < noise floor → none
        assert compute_slope_source(None, None, 0.3) == "none"

    def test_does_not_affect_forecast(self):
        """compute_slope_source è solo audit, non altera forecast_precat_curve."""
        from prediction.curve_forecast import compute_slope_source, forecast_precat_curve
        # Caso con tutti i dati: misurato
        src = compute_slope_source(0.4, 0.3, 10.0)
        assert src == "measured_20d"
        # Lo stesso input al forecast resta deterministico
        fc = forecast_precat_curve(slope_20d=0.4, slope_5d=0.3, run_up_30d=10.0, days_to_cd=25)
        assert fc.waypoints[0].pred_pct > 0  # mediana > 0 perché slope_20d > 0


# ─── compute_slope_consistency ────────────────────────────────────────────────

class TestComputeSlopeConsistency:
    """Misura della coerenza tra slope_5d, slope_20d (e opz. slope_45d)."""

    def test_identical_slopes_returns_one(self):
        from prediction.curve_forecast import compute_slope_consistency
        assert compute_slope_consistency(1.0, 1.0) == 1.0

    def test_proportional_slopes(self):
        from prediction.curve_forecast import compute_slope_consistency
        # min(0.5, 1.0)/max = 0.5
        assert compute_slope_consistency(0.5, 1.0) == 0.5

    def test_opposite_signs_returns_zero(self):
        from prediction.curve_forecast import compute_slope_consistency
        # Rotation: segni opposti
        assert compute_slope_consistency(-0.5, 1.0) == 0.0

    def test_one_flat_returns_zero(self):
        from prediction.curve_forecast import compute_slope_consistency
        # slope_5d sotto noise floor (0.05 < 0.1) → trattato come flat
        assert compute_slope_consistency(0.05, 1.0) == 0.0

    def test_both_flat_returns_none(self):
        from prediction.curve_forecast import compute_slope_consistency
        assert compute_slope_consistency(0.02, 0.05) is None

    def test_missing_inputs_return_none(self):
        from prediction.curve_forecast import compute_slope_consistency
        assert compute_slope_consistency(None, 1.0) is None
        assert compute_slope_consistency(1.0, None) is None

    def test_slope_45d_bonus_when_aligned(self):
        from prediction.curve_forecast import compute_slope_consistency
        without = compute_slope_consistency(0.8, 1.0)
        with_45 = compute_slope_consistency(0.8, 1.0, slope_45d=0.9)
        assert with_45 is not None and without is not None
        assert with_45 >= without  # 45d concorde non peggiora mai

    def test_slope_45d_no_bonus_when_opposite(self):
        from prediction.curve_forecast import compute_slope_consistency
        # 45d con segno opposto a 20d → nessun bonus (rimane uguale)
        without = compute_slope_consistency(0.8, 1.0)
        with_45 = compute_slope_consistency(0.8, 1.0, slope_45d=-0.3)
        assert with_45 == without


# ─── compute_slope_rotation_flag ──────────────────────────────────────────────

class TestComputeSlopeRotationFlag:
    """Flag binario: 1 se slope_5d e slope_20d hanno segni opposti."""

    def test_aligned_returns_zero(self):
        from prediction.curve_forecast import compute_slope_rotation_flag
        assert compute_slope_rotation_flag(1.0, 0.5) == 0
        assert compute_slope_rotation_flag(-1.0, -0.5) == 0

    def test_opposite_returns_one(self):
        from prediction.curve_forecast import compute_slope_rotation_flag
        assert compute_slope_rotation_flag(1.0, -0.5) == 1
        assert compute_slope_rotation_flag(-0.8, 0.3) == 1

    def test_flat_returns_zero(self):
        from prediction.curve_forecast import compute_slope_rotation_flag
        # Sotto noise floor: non scatta rotation
        assert compute_slope_rotation_flag(0.05, -0.3) == 0
        assert compute_slope_rotation_flag(0.5, 0.02) == 0

    def test_missing_returns_zero(self):
        from prediction.curve_forecast import compute_slope_rotation_flag
        assert compute_slope_rotation_flag(None, 0.5) == 0
        assert compute_slope_rotation_flag(0.5, None) == 0


# ─── compute_slope_stability_class & persistence_window ──────────────────────

class TestSlopeStabilityClass:
    """Classificazione discreta della stabilità della pendenza."""

    def test_rotation(self):
        from prediction.curve_forecast import compute_slope_stability_class
        assert compute_slope_stability_class(1.0, -0.5) == "rotation"

    def test_flat(self):
        from prediction.curve_forecast import compute_slope_stability_class
        assert compute_slope_stability_class(0.02, 0.03) == "flat"

    def test_low_consistency(self):
        from prediction.curve_forecast import compute_slope_stability_class
        # min/max = 0.2/1.0 = 0.2 < 0.4 → low
        assert compute_slope_stability_class(0.2, 1.0) == "low_consistency"

    def test_med_consistency(self):
        from prediction.curve_forecast import compute_slope_stability_class
        # min/max = 0.5/1.0 = 0.5 ∈ [0.4, 0.6) → med
        assert compute_slope_stability_class(0.5, 1.0) == "med_consistency"

    def test_high_consistency_20d(self):
        from prediction.curve_forecast import compute_slope_stability_class
        # min/max = 0.8/1.0 = 0.8 ≥ 0.6 → high senza slope_45d
        assert compute_slope_stability_class(0.8, 1.0) == "high_consistency_20d"

    def test_high_consistency_45d(self):
        from prediction.curve_forecast import compute_slope_stability_class
        # slope_45d concorde in segno → upgrade a high_consistency_45d
        assert compute_slope_stability_class(0.8, 1.0, slope_45d=0.7) == "high_consistency_45d"


class TestPersistenceWindow:
    """Lookup mediana giorni di persistenza attesi."""

    def test_rotation_zero_days(self):
        from prediction.curve_forecast import compute_persistence_window_days
        assert compute_persistence_window_days(1.0, -0.5) == 0

    def test_flat_zero_days(self):
        from prediction.curve_forecast import compute_persistence_window_days
        assert compute_persistence_window_days(0.02, 0.03) == 0

    def test_high_consistency_20d_default(self):
        from prediction.curve_forecast import compute_persistence_window_days
        # Senza 45d → 10 giorni
        assert compute_persistence_window_days(0.8, 1.0) == 10

    def test_high_consistency_45d_boost(self):
        from prediction.curve_forecast import compute_persistence_window_days
        # Con 45d concorde → 15 giorni
        assert compute_persistence_window_days(0.8, 1.0, slope_45d=0.7) == 15

    def test_low_consistency_short(self):
        from prediction.curve_forecast import compute_persistence_window_days
        assert compute_persistence_window_days(0.2, 1.0) == 3


class TestComputeSlopeStabilityMetrics:
    """One-shot helper restituisce tutte le metriche in un dict."""

    def test_returns_all_keys(self):
        from prediction.curve_forecast import compute_slope_stability_metrics
        out = compute_slope_stability_metrics(0.8, 1.0)
        assert set(out.keys()) == {
            "slope_consistency",
            "slope_rotation_flag",
            "slope_stability_class",
            "persistence_window_days",
        }

    def test_rotation_combo(self):
        from prediction.curve_forecast import compute_slope_stability_metrics
        out = compute_slope_stability_metrics(1.0, -0.5)
        assert out["slope_rotation_flag"] == 1
        assert out["slope_stability_class"] == "rotation"
        assert out["persistence_window_days"] == 0
        assert out["slope_consistency"] == 0.0

    def test_strong_persistence_combo(self):
        from prediction.curve_forecast import compute_slope_stability_metrics
        out = compute_slope_stability_metrics(0.9, 1.0, slope_45d=0.85)
        assert out["slope_rotation_flag"] == 0
        assert out["slope_stability_class"] == "high_consistency_45d"
        assert out["persistence_window_days"] == 15
        assert out["slope_consistency"] is not None and out["slope_consistency"] > 0.85
