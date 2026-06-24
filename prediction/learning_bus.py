"""
Learning Bus — single source of truth for *every* learning / calibration /
feedback loop in the system.

Why this module exists
----------------------
Until now the "Learning Lab" UI surfaced only ~8 loops out of ~30 that the
system actually runs.  The remaining ones live scattered across Python
modules (`prediction/seq_calib.py`, `slope_contrarian_calib.py`, etc.) and
several frontend-only mechanisms in `desktop-ui/src/calibration/` and
`desktop-ui/src/sheet/`.

`learning_bus` provides a **uniform taxonomy** for all of them:

* `LoopMetadata`  → static descriptor (id, family, file, schedule, …)
* `LoopStatus`    → live status read from the loop's persisted JSON
* `LOOPS`         → the registry (~33 entries today)

The status readers are intentionally **best-effort**: each loop persists
state in its own way, so we wrap each JSON read in `_safe_read_json` and
return ``verdict="unknown"`` when we can't infer anything.  The UI will
display the placeholder rather than break.

This is **Phase 1** of the Learning Lab v2 refactor.  Future phases will
add the audit log (Phase 2), the portfolio-error loop (Phase 3) and per-loop
preview/apply/reset adapters (Phase 4).
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Literal

from orchestrator_io_paths import (
    CLUSTER_CAL_FACTORS_JSON,
    DATA_DIR,
    FEEDBACK_HISTORY_JSON,
    FEEDBACK_SUMMARY_JSON,
    INVESTMENT_TRADE_CALIB_JSON,
    LEARNING_HISTORY_JSON,
    LEARNING_LOG_JSON,
    MODEL_ACCURACY_MONITOR_JSON,
    MODEL_SIGN_CURVE_DAILY_JSON,
    OUTCOMES_WITH_REGIME_JSON,
    REGIME_MULTIPLIERS_JSON,
    SDS_ROI_BACKTEST_SCORES_JSON,
    TICKER_PERFORMANCE_JSON,
)

# ── Types ────────────────────────────────────────────────────────────────────

Family = Literal["A_magnitude", "B_pre_cd", "C_portfolio", "D_monitoring"]
"""The 4 families used by the Learning Lab v2 UI to group cards visually.

* **A_magnitude**  — corrects the model's magnitude bias post-CD (cluster
  CF, regime, global CF, validation feedback, …).
* **B_pre_cd**     — corrects/augments pre-CD signals & curve layers
  (signal audit, curve impact, seq calib, slope contrarian, EIS super, …).
* **C_portfolio**  — learns sizing / advice / portfolio decisions (Bayesian
  shrinkage, proposal engine, advice feedback, RA calib, …).
* **D_monitoring** — quality gates and reporting that *describe* the
  system's accuracy but do not auto-tune anything.
"""

Verdict = Literal[
    "collecting_data",
    "improving",
    "stable",
    "neutral",
    "not_helping",
    "stalled",
    "unknown",
]
"""Health verdict shown as a coloured pill in the UI card."""

Schedule = Literal[
    "weekly_sunday",
    "post_refresh_daily",
    "every_refresh",
    "every_30_days",
    "every_pred_live",
    "on_demand_user",
    "on_demand",
    "frontend_localstorage",
]
"""Coarse-grained execution cadence.  Stored as plain string so the UI can
group by it (e.g. "what runs on Sunday?")."""


@dataclass(frozen=True)
class LoopMetadata:
    """Static descriptor.  Never changes at runtime."""

    id: str
    family: Family
    name_en: str
    name_it: str
    description_en: str
    description_it: str
    primary_file: str
    """Path (relative to project root) of the module that owns the loop."""
    schedule: Schedule
    has_preview: bool
    has_apply: bool
    has_reset: bool
    downstream: tuple[str, ...]
    """What modules consume the loop's output (free-form labels)."""
    state_files: tuple[str, ...]
    """JSON files where the loop persists its state.  Used by
    `read_loop_status` to infer last_run_at + key metrics."""
    api_endpoint: str | None
    """Existing API endpoint that already exposes the loop (or None)."""
    inactive_reason: str | None = None
    """If set the loop is wired but *its output is not consumed* anywhere.
    Surfaced in the UI as a warning chip so the user sees the orphan."""
    planned: bool = False
    """True for loops we have not yet built (e.g. portfolio_error_loop in
    Phase 3).  The UI shows them as "Coming soon" placeholders."""


@dataclass
class LoopStatus:
    """Live status snapshot for one loop, read from disk best-effort."""

    id: str
    last_run_at: str | None
    """ISO-8601 timestamp of the most recent successful run, or None."""
    verdict: Verdict
    primary_metric: dict[str, Any] | None
    """A single ``{name, value, unit, trend}`` dict shown as the headline
    figure on the card.  ``trend`` is one of ``"up", "down", "flat"``."""
    n_samples: int | None
    message: str | None
    """Short human-readable status line (e.g. "8 cells active · 2 stalled")."""
    raw_excerpt: dict[str, Any] | None
    """Tiny dict with up to a handful of top-level fields from the source
    JSON.  Used by the drill-down modal so the UI doesn't need a dedicated
    endpoint for every loop."""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ── Registry ─────────────────────────────────────────────────────────────────
# IMPORTANT: keep this list in sync with `LEARNING_LOOPS_DOC.md` (auto-gen
# planned) and with the Learning Lab v2 UI grid.  When you add a new loop
# also add an entry here.

LOOPS: tuple[LoopMetadata, ...] = (
    # ── A. MAGNITUDE (post-CD bias correction) ───────────────────────────
    LoopMetadata(
        id="cluster_cf",
        family="A_magnitude",
        name_en="Cluster cal_factor",
        name_it="Cluster cal_factor",
        description_en=(
            "Per-cohort magnitude bias correction (10 phase × area clusters). "
            "Blends 60/40 cluster vs global when n ≥ 5."
        ),
        description_it=(
            "Correzione del bias di magnitudo per coorte (10 cluster phase × area). "
            "Mescola 60/40 cluster vs global quando n ≥ 5."
        ),
        primary_file="prediction/cluster_cal_factor.py",
        schedule="weekly_sunday",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("learning_apply.apply_magnitude_learning", "curve_display"),
        state_files=(CLUSTER_CAL_FACTORS_JSON, LEARNING_HISTORY_JSON),
        api_endpoint="/api/models/learning-lab/overview",
    ),
    LoopMetadata(
        id="regime_mult",
        family="A_magnitude",
        name_en="Regime multiplier",
        name_it="Multiplier regime",
        description_en=(
            "Adjusts over/undershoot per market regime (RISK_ON / NEUTRAL / "
            "RISK_OFF inferred from XBI, TLT, VIX)."
        ),
        description_it=(
            "Corregge over/undershoot per regime di mercato (RISK_ON / NEUTRAL / "
            "RISK_OFF da XBI, TLT, VIX)."
        ),
        primary_file="prediction/regime_calibration.py",
        schedule="weekly_sunday",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("learning_apply.apply_regime_multiplier",),
        state_files=(REGIME_MULTIPLIERS_JSON, OUTCOMES_WITH_REGIME_JSON),
        api_endpoint="/api/models/learning-lab/overview",
    ),
    LoopMetadata(
        id="global_cf",
        family="A_magnitude",
        name_en="Global cal_factor (v4)",
        name_it="Global cal_factor (v4)",
        description_en=(
            "v4 magnitude master correction (acc_real/acc_expected, clipped "
            "0.5–1.5). Refreshed by the orchestrator every ~30 days — NOT "
            "by the weekly Apply button."
        ),
        description_it=(
            "Correzione magnitudo master del modello v4 (acc_reale/acc_attesa, "
            "clip 0.5–1.5). Ricalcolata dall'orchestrator ogni ~30 giorni — NON "
            "dal bottone Apply settimanale."
        ),
        primary_file="data_orchestrator.py (_compute_calibration_state)",
        schedule="every_30_days",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("live_predictions", "display_curves", "cluster_blend"),
        state_files=(os.path.join(DATA_DIR, "model_calibration_state.json"),),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="validation_feedback",
        family="A_magnitude",
        name_en="Validation feedback loop",
        name_it="Loop feedback validazione",
        description_en=(
            "Per-ticker MAE/dir on T−10/T−5/T−3 nodes; proposes per-event "
            "cal_factor stored in the sequential curve state."
        ),
        description_it=(
            "MAE/dir per ticker sui nodi T−10/T−5/T−3; propone cal_factor "
            "per evento salvato nello stato della curva sequenziale."
        ),
        primary_file="prediction/validation_feedback_loop.py",
        schedule="weekly_sunday",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("sequential_curve_recalib",),
        state_files=(
            TICKER_PERFORMANCE_JSON,
            FEEDBACK_SUMMARY_JSON,
            FEEDBACK_HISTORY_JSON,
        ),
        api_endpoint="/api/models/feedback-loop/summary",
    ),
    LoopMetadata(
        id="emp_precat_blend",
        family="A_magnitude",
        name_en="Empirical pre-CD blend",
        name_it="Blend empirico pre-CD",
        description_en=(
            "Blends pre-CD polynomial with empirical cohort curve (λ 0.28–0.65). "
            "Evaluated via blend_ab_eval (A/B), not auto-tuned."
        ),
        description_it=(
            "Mescola il polinomio pre-CD con la curva empirica della coorte "
            "(λ 0.28–0.65). Valutato in A/B via blend_ab_eval, non auto-tunato."
        ),
        primary_file="prediction/empirical_precat_blend.py",
        schedule="every_pred_live",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("pred_pipeline",),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="fundamental_shrink",
        family="A_magnitude",
        name_en="Fundamental shrink",
        name_it="Shrink fondamentale",
        description_en=(
            "Reduces post-CD magnitude based on liquidity (FY) + beta. "
            "Static rule (not learning)."
        ),
        description_it=(
            "Riduce la magnitudo post-CD da liquidità FY + beta. "
            "Regola statica, non apprende."
        ),
        primary_file="prediction/fundamental_shrink.py",
        schedule="every_pred_live",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("pred_pipeline",),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="v5_fan_cal",
        family="A_magnitude",
        name_en="V5 fan calibration",
        name_it="Calibrazione fan V5",
        description_en=(
            "Scales the σ of the q05/q95 Monte-Carlo fan using empirical MAE "
            "from retrospective predictions."
        ),
        description_it=(
            "Scala la σ del fan q05/q95 Monte-Carlo usando la MAE empirica "
            "delle predizioni retrospettive."
        ),
        primary_file="prediction/v5/calibration.py",
        schedule="every_pred_live",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("v5_predictions",),
        state_files=(os.path.join(DATA_DIR, "pred_v5_calibration.json"),),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="posthoc_mag_calib",
        family="A_magnitude",
        name_en="Post-hoc + magnitude bucket calib",
        name_it="Calibrazione post-hoc + magnitude bucket",
        description_en=(
            "Post-hoc linear regression and per-|pred| bucket recalibration "
            "embedded in the orchestrator's model_calibration_state."
        ),
        description_it=(
            "Regressione lineare post-hoc e ricalibrazione per fascia |pred| "
            "dentro lo stato di calibrazione dell'orchestrator."
        ),
        primary_file="data_orchestrator.py (_posthoc_calibrate_pct, _mag_bucket_calibrate_pct)",
        schedule="every_30_days",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("display_curves",),
        state_files=(os.path.join(DATA_DIR, "model_calibration_state.json"),),
        api_endpoint=None,
    ),
    # ── B. PRE-CD / PATTERN / SIGNAL LAYERS ──────────────────────────────
    LoopMetadata(
        id="signal_audit",
        family="B_pre_cd",
        name_en="Pre-CD signal hit rate",
        name_it="Hit rate segnali pre-CD",
        description_en=(
            "Append-only log of live pre-CD signals; closes outcome at T+5; "
            "tracks hit-rate cohorts Raw / Useful / Strong."
        ),
        description_it=(
            "Log append-only dei segnali live pre-CD; chiude outcome a T+5; "
            "traccia hit-rate cohort Raw / Useful / Strong."
        ),
        primary_file="prediction/signal_audit.py",
        schedule="post_refresh_daily",
        has_preview=False,
        has_apply=True,
        has_reset=False,
        downstream=("curve_impact_cumulative",),
        state_files=(
            os.path.join(DATA_DIR, "signal_calibration.json"),
            os.path.join(DATA_DIR, "signal_audit_log.jsonl"),
        ),
        api_endpoint="/api/models/signal-calibration",
    ),
    LoopMetadata(
        id="curve_impact",
        family="B_pre_cd",
        name_en="Daily curve recalib (curve impact)",
        name_it="Recalib curva giornaliera",
        description_en=(
            "Compares base vs daily seq vs K8 vs EIS curve layers; cumulative "
            "RMSE/MAE/hit per layer."
        ),
        description_it=(
            "Confronta i layer curva base vs daily seq vs K8 vs EIS; "
            "RMSE/MAE/hit cumulativi per layer."
        ),
        primary_file="prediction/pre_cd_curve_impact.py",
        schedule="post_refresh_daily",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("simulation_display", "accuracy_display"),
        state_files=(os.path.join(DATA_DIR, "curve_impact_cumulative_state.json"),),
        api_endpoint="/api/models/eis-cohort-comparison",
    ),
    LoopMetadata(
        id="polygon_accuracy",
        family="B_pre_cd",
        name_en="CD pattern polygon accuracy",
        name_it="Accuracy polygon pattern CD",
        description_en=(
            "Pearson ρ between polygon match % (RA/SDS/MII/calib/slope) and "
            "stock % vs T−60 for each pre-CD window."
        ),
        description_it=(
            "ρ Pearson tra polygon match % (RA/SDS/MII/calib/slope) e "
            "stock % vs T−60 per ogni finestra pre-CD."
        ),
        primary_file="prediction/cd_pattern_polygon_accuracy.py",
        schedule="weekly_sunday",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("learning_lab_overview",),
        state_files=(os.path.join(DATA_DIR, "cd_pattern_polygon_accuracy.json"),),
        api_endpoint="/api/models/learning-lab/overview",
        inactive_reason=(
            "Persists ρ to JSON but no recommendation engine consumes it — "
            "analytics-only today."
        ),
    ),
    LoopMetadata(
        id="seq_calib",
        family="B_pre_cd",
        name_en="Sequential curve calibration",
        name_it="Calibrazione curva sequenziale",
        description_en=(
            "Anchors curve knots to real closes T−60…T+7; merges K8 + AI "
            "feed knots; per-event cal_factor."
        ),
        description_it=(
            "Ancora i nodi della curva alle chiusure reali T−60…T+7; "
            "include K8 + AI feed knot; cal_factor per evento."
        ),
        primary_file="prediction/seq_calib.py",
        schedule="every_refresh",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("live_pred", "validation_feedback"),
        state_files=(os.path.join(DATA_DIR, "pred_curve_seq_state.json"),),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="ai_feed_recalib",
        family="B_pre_cd",
        name_en="AI feed seq merge",
        name_it="Merge AI feed nella curva",
        description_en=(
            "Adds knots T / T+1 / T+3 from clinical publications "
            "pre-CD into the sequential curve."
        ),
        description_it=(
            "Aggiunge knot T / T+1 / T+3 dalle pubblicazioni cliniche "
            "pre-CD nella curva sequenziale."
        ),
        primary_file="prediction/ai_feed_recalib.py",
        schedule="every_refresh",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("seq_calib",),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="direction_ensemble",
        family="B_pre_cd",
        name_en="Direction ensemble v4.1",
        name_it="Ensemble direzione v4.1",
        description_en=(
            "Direction ensemble with liquidity/beta penalty + adaptive "
            "slope5d weight (calibrated by slope_contrarian)."
        ),
        description_it=(
            "Ensemble direzione con penalità liquidità/beta + peso slope5d "
            "adattivo (calibrato da slope_contrarian)."
        ),
        primary_file="prediction/direction_ensemble.py",
        schedule="every_pred_live",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("live_pred",),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="slope_contrarian",
        family="B_pre_cd",
        name_en="Slope contrarian calibration",
        name_it="Calibrazione slope contrarian",
        description_en=(
            "Adaptive slope5d weight (0.6–2.0) learned from historical "
            "contrarian setups; feeds direction_ensemble."
        ),
        description_it=(
            "Peso slope5d adattivo (0.6–2.0) appreso da setup contrarian "
            "storici; alimenta direction_ensemble."
        ),
        primary_file="prediction/slope_contrarian_calib.py",
        schedule="post_refresh_daily",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("direction_ensemble",),
        state_files=(os.path.join(DATA_DIR, "slope_contrarian_calib.json"),),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="eis_super_score",
        family="B_pre_cd",
        name_en="EIS Super Score learning",
        name_it="EIS Super Score learning",
        description_en=(
            "Calibrates per-CD-distance factors; super score = blend(raw "
            "EIS × CD factor, learned cal). Mirrored in desktop UI — "
            "potential drift risk."
        ),
        description_it=(
            "Calibra fattori per finestra CD-distance; super score = "
            "blend(raw EIS × CD, learned). Logica duplicata anche nel "
            "frontend — rischio drift."
        ),
        primary_file="prediction/eis_super_score_learning.py",
        schedule="weekly_sunday",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("desktop_catalyst_ui", "desktop_eis_ui"),
        state_files=(os.path.join(DATA_DIR, "eis_super_score_learning.json"),),
        api_endpoint="/api/models/learning-lab/overview",
    ),
    # ── C. PORTFOLIO / SIZING / ADVICE ──────────────────────────────────
    LoopMetadata(
        id="bayesian_shrinkage",
        family="C_portfolio",
        name_en="Bayesian win-rate shrinkage",
        name_it="Bayesian shrinkage win-rate",
        description_en=(
            "Win-rate per cell (clinicalPhase × indication × sdsBucket × "
            "pplanBucket) with shrinkage (n·p + k·prior)/(n+k). Server-side "
            "since Phase 5 — sync optional from desktop Calibration Center."
        ),
        description_it=(
            "Win-rate per cella (clinicalPhase × indicazione × sdsBucket × "
            "pplanBucket) con shrinkage (n·p + k·prior)/(n+k). Lato server "
            "dalla Fase 5 — sync opzionale dal Calibration Center desktop."
        ),
        primary_file="prediction/bayesian_shrinkage.py",
        schedule="on_demand",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("proposal_engine", "sizing_rules", "three_portfolio_weighted"),
        state_files=(
            os.path.join(DATA_DIR, "calibration_feature_snapshots.json"),
            os.path.join(DATA_DIR, "calibration_shrinkage_history.json"),
        ),
        api_endpoint="/api/learning/loops/bayesian_shrinkage",
    ),
    LoopMetadata(
        id="proposal_engine",
        family="C_portfolio",
        name_en="Calibration proposal engine",
        name_it="Engine proposte calibrazione",
        description_en=(
            "Compares new shrinkage snapshot vs frozen weights; proposes "
            "Δ when |Δweight| > 0.02 or confidence tier changes. "
            "Mai auto-apply — needs human approval in Calibration Center."
        ),
        description_it=(
            "Confronta il nuovo snapshot di shrinkage vs i pesi frozen; "
            "propone Δ se |Δweight| > 0.02 o cambia il tier di confidence. "
            "Mai auto-apply — richiede approvazione in Calibration Center."
        ),
        primary_file="prediction/calibration_proposal.py",
        schedule="on_demand",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("sizing_rules",),
        state_files=(
            os.path.join(DATA_DIR, "calibration_proposals.json"),
            os.path.join(DATA_DIR, "calibration_frozen_weights.json"),
        ),
        api_endpoint="/api/learning/loops/proposal_engine",
    ),
    LoopMetadata(
        id="advice_feedback",
        family="C_portfolio",
        name_en="Advice feedback (P(plan))",
        name_it="Feedback advice (P(plan))",
        description_en=(
            "P(plan) bucket multipliers learned from advice-vs-outcome "
            "calibration; demotes BUY/SELL → REVIEW on bad-rate buckets."
        ),
        description_it=(
            "Moltiplicatori P(plan) per bucket appresi dalla calibrazione "
            "advice vs outcome; demosse BUY/SELL → REVIEW per bucket "
            "ad alto bad-rate."
        ),
        primary_file="prediction/advice_feedback_loop.py",
        schedule="on_demand",
        has_preview=False,
        has_apply=True,
        has_reset=True,
        downstream=("suggestion_monitor",),
        state_files=(os.path.join(DATA_DIR, "advice_feedback_state.json"),),
        api_endpoint="/api/learning/loops/advice_feedback",
    ),
    LoopMetadata(
        id="ra_calibration",
        family="C_portfolio",
        name_en="RA Score calibration",
        name_it="Calibrazione RA Score",
        description_en=(
            "Spearman ρ, success bins, invest threshold (≥55), inverse "
            "pattern, polarity store. Tunes RA thresholds used by entry "
            "solidity, CD pattern recommendation, dashboard pulse."
        ),
        description_it=(
            "ρ Spearman, success bin, soglia invest (≥55), inverse pattern, "
            "polarity store. Tara le soglie RA usate da entry solidity, "
            "CD pattern recommendation e dashboard pulse."
        ),
        primary_file="desktop-ui/src/components/RaScoreCalibration.tsx",
        schedule="frontend_localstorage",
        has_preview=False,
        has_apply=True,
        has_reset=True,
        downstream=("entry_solidity", "cd_pattern_recommendation", "dashboard_pulse"),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="plan_prob_audit",
        family="C_portfolio",
        name_en="Plan P(plan) calibration",
        name_it="Calibrazione P(plan)",
        description_en=(
            "Calibration bins of predicted vs actual hit rate; scatter "
            "prob vs success. Reads sim-outcomes from backend, learns "
            "client-side."
        ),
        description_it=(
            "Bin di calibrazione predicted vs actual hit rate; scatter "
            "prob vs success. Legge sim-outcomes dal backend, apprende "
            "lato client."
        ),
        primary_file="desktop-ui/src/components/PlanProbLearningPanel.tsx",
        schedule="frontend_localstorage",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("advice_feedback",),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="mig_calibration",
        family="C_portfolio",
        name_en="MIG / MII slope calibration",
        name_it="Calibrazione slope MIG / MII",
        description_en=(
            "Tier classification aligned/drift/diverge/contrarian from "
            "angle gap (model vs market); pre/post daily recalib."
        ),
        description_it=(
            "Classificazione tier aligned/drift/diverge/contrarian dal "
            "gap di angolo (modello vs mercato); pre/post recalib "
            "giornaliero."
        ),
        primary_file="desktop-ui/src/sheet/entrySolidityMig.ts",
        schedule="frontend_localstorage",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("entry_solidity", "market_gate"),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="daily_open_recalib",
        family="C_portfolio",
        name_en="Daily open recalib badge",
        name_it="Badge recalib daily open",
        description_en=(
            "Displays the pp shift of the latest daily anchor vs the "
            "model curve (informational, no auto-correction)."
        ),
        description_it=(
            "Mostra lo shift pp dell'ultimo anchor daily vs la curva "
            "del modello (informativo, nessuna auto-correzione)."
        ),
        primary_file="desktop-ui/src/sheet/predictionCurveDailyRecalib.ts",
        schedule="frontend_localstorage",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("simulation_display",),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="sds_roi_calibration",
        family="C_portfolio",
        name_en="SDS ROI calibration",
        name_it="Calibrazione SDS ROI",
        description_en=(
            "Median ROI profiles per SDS macro-cluster; correlation "
            "SDS ↔ realized return; blend ROI curves."
        ),
        description_it=(
            "Profili ROI mediani per macro-cluster SDS; correlazione "
            "SDS ↔ rendimento realizzato; blend curve ROI."
        ),
        primary_file="prediction/sds_roi_calibration.py",
        schedule="post_refresh_daily",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("sds_view",),
        state_files=(
            os.path.join(DATA_DIR, "sds_roi_calibration.json"),
            SDS_ROI_BACKTEST_SCORES_JSON,
        ),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="investment_trade_calib",
        family="C_portfolio",
        name_en="Investment trade calibration",
        name_it="Calibrazione trade investment",
        description_en=(
            "Grid-search of buy/sell/slope/score thresholds from sim "
            "trades. Feeds the Decision Lab."
        ),
        description_it=(
            "Grid-search delle soglie buy/sell/slope/score da trade "
            "simulati. Alimenta il Decision Lab."
        ),
        primary_file="prediction/investment_trade_calib.py",
        schedule="post_refresh_daily",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("decision_lab",),
        state_files=(INVESTMENT_TRADE_CALIB_JSON,),
        api_endpoint="/api/investment/trade-calib",
    ),
    LoopMetadata(
        id="portfolio_error_loop",
        family="C_portfolio",
        name_en="Portfolio error loop",
        name_it="Loop errore portafoglio",
        description_en=(
            "Weekly snapshot of counterfactual P&L (mine / equal / weighted) on "
            "closed sim positions; proposes Δ to confidence multipliers and "
            "pattern penalty when weighted sizing underperforms."
        ),
        description_it=(
            "Snapshot settimanale P&L controfattuale (mine / equal / weighted) "
            "su posizioni chiuse; propone Δ ai moltiplicatori confidence e "
            "pattern penalty quando il weighted underperforma."
        ),
        primary_file="prediction/portfolio_error_loop.py",
        schedule="weekly_sunday",
        has_preview=True,
        has_apply=True,
        has_reset=True,
        downstream=("portfolio_sizing_widget", "three_portfolio_weighted"),
        state_files=(os.path.join(DATA_DIR, "portfolio_sizing_calibration.json"),),
        api_endpoint="/api/learning/loops/portfolio_error_loop",
    ),
    # ── D. MONITORING / QUALITY (no auto-tuning) ─────────────────────────
    LoopMetadata(
        id="data_quality",
        family="D_monitoring",
        name_en="Data quality gate",
        name_it="Gate qualità dati",
        description_en=(
            "Scores 0–1 on price/volume/XBI/options/5y completeness. "
            "Filters and confidence-weights — does not learn."
        ),
        description_it=(
            "Score 0–1 su completezza prezzo/volume/XBI/opzioni/5y. "
            "Filtra e pesa la confidence — non apprende."
        ),
        primary_file="prediction/data_quality.py",
        schedule="every_refresh",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=("filters", "confidence_weights"),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="accuracy_monitor",
        family="D_monitoring",
        name_en="Accuracy monitor",
        name_it="Monitor accuracy",
        description_en=(
            "Time-series snapshot of model accuracy on the cohort after "
            "each recalibration. Reporting only."
        ),
        description_it=(
            "Snapshot temporale di accuracy del modello sulla coorte dopo "
            "ogni ricalibrazione. Solo reporting."
        ),
        primary_file="prediction/accuracy_monitor_run.py",
        schedule="post_refresh_daily",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=(),
        state_files=(MODEL_ACCURACY_MONITOR_JSON,),
        api_endpoint="/api/models/accuracy-monitor",
    ),
    LoopMetadata(
        id="sign_curve_daily",
        family="D_monitoring",
        name_en="Sign curve daily snapshot",
        name_it="Snapshot daily curva segno",
        description_en=(
            "Daily snapshot of the model's sign curve vs realized. "
            "Diagnostic monitoring."
        ),
        description_it=(
            "Snapshot giornaliero della curva di segno del modello vs "
            "realized. Monitoring diagnostico."
        ),
        primary_file="prediction/sign_curve_daily.py",
        schedule="every_refresh",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=(),
        state_files=(MODEL_SIGN_CURVE_DAILY_JSON,),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="accuracy_v4_v5",
        family="D_monitoring",
        name_en="Accuracy v4 vs v5",
        name_it="Accuracy v4 vs v5",
        description_en=(
            "Comparison metrics v4 interpolated vs v5 q50 on the Accuracy "
            "sheet. Metrics only, no learning."
        ),
        description_it=(
            "Metriche di confronto v4 interpolato vs v5 q50 sul foglio "
            "Accuracy. Solo metriche, no learning."
        ),
        primary_file="prediction/accuracy_v4_v5.py",
        schedule="post_refresh_daily",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=(),
        state_files=(os.path.join(DATA_DIR, "accuracy_v4_v5_summary.json"),),
        api_endpoint="/api/sheets/accuracy/v4-v5-summary",
    ),
    LoopMetadata(
        id="kpi_signal_analysis",
        family="D_monitoring",
        name_en="KPI signal analysis",
        name_it="Analisi KPI signal",
        description_en=(
            "Compares old vs new indicator scoring on enrichment records. "
            "Quality analysis, no closed loop."
        ),
        description_it=(
            "Confronto scoring indicatori old vs new su record di "
            "arricchimento. Analisi qualità, non chiude loop."
        ),
        primary_file="prediction/kpi_signal_analysis.py",
        schedule="on_demand_user",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=(),
        state_files=(),
        api_endpoint="/api/models/kpi-signal-analysis",
    ),
    LoopMetadata(
        id="blend_ab_eval",
        family="D_monitoring",
        name_en="Empirical blend A/B eval",
        name_it="A/B eval blend empirico",
        description_en=(
            "Compares empirical pre-CD blend ON vs OFF. Evaluation only "
            "— does not write weights back."
        ),
        description_it=(
            "Confronta blend empirico pre-CD ON vs OFF. Solo valutazione "
            "— non scrive pesi."
        ),
        primary_file="prediction/blend_ab_eval.py",
        schedule="on_demand_user",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=(),
        state_files=(),
        api_endpoint=None,
    ),
    LoopMetadata(
        id="evaluation_framework",
        family="D_monitoring",
        name_en="Evaluation framework (Q&C)",
        name_it="Evaluation framework (Q&C)",
        description_en=(
            "Q&C Validation batch runner; baseline / compare flows. "
            "Manual A/B, no auto-apply."
        ),
        description_it=(
            "Runner batch Q&C Validation; baseline / compare flow. "
            "A/B manuale, no auto-apply."
        ),
        primary_file="prediction/evaluationFramework.py",
        schedule="on_demand_user",
        has_preview=False,
        has_apply=False,
        has_reset=False,
        downstream=(),
        state_files=(),
        api_endpoint="/api/evaluation/*",
    ),
)


# Map id → metadata for O(1) lookup.
LOOPS_BY_ID: dict[str, LoopMetadata] = {m.id: m for m in LOOPS}


# ── Status readers (best-effort) ─────────────────────────────────────────────


def _safe_read_json(path: str) -> dict[str, Any] | None:
    """Read a JSON file, returning ``None`` on any error or missing path."""
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else {"_raw": data}


def _mtime_iso(path: str) -> str | None:
    """File mtime as ISO-8601 UTC, or None if missing."""
    if not path or not os.path.isfile(path):
        return None
    try:
        ts = os.path.getmtime(path)
    except OSError:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _newest_mtime(paths: Iterable[str]) -> str | None:
    candidates: list[str] = []
    for p in paths:
        iso = _mtime_iso(p)
        if iso:
            candidates.append(iso)
    return max(candidates) if candidates else None


def _generic_status(meta: LoopMetadata) -> LoopStatus:
    """Default reader: uses file mtime as last_run_at; verdict=unknown."""
    return LoopStatus(
        id=meta.id,
        last_run_at=_newest_mtime(meta.state_files),
        verdict="unknown",
        primary_metric=None,
        n_samples=None,
        message=None,
        raw_excerpt=None,
    )


def _planned_status(meta: LoopMetadata) -> LoopStatus:
    """Placeholder for loops not yet implemented (e.g. portfolio_error_loop)."""
    return LoopStatus(
        id=meta.id,
        last_run_at=None,
        verdict="unknown",
        primary_metric=None,
        n_samples=None,
        message="Coming soon (planned for Phase 3)",
        raw_excerpt=None,
    )


def _frontend_status(meta: LoopMetadata) -> LoopStatus:
    """Frontend-only loops have no server-side state (yet).  Phase 5 will
    move them to backend.  For now we tag them so the UI shows the
    localStorage badge instead of stale numbers."""
    return LoopStatus(
        id=meta.id,
        last_run_at=None,
        verdict="unknown",
        primary_metric=None,
        n_samples=None,
        message="Frontend-only (localStorage) — backend migration in Phase 5",
        raw_excerpt=None,
    )


# Per-loop specialised readers.  Each returns LoopStatus or None to fall
# back to the generic reader.  All readers are *defensive* — any missing /
# malformed JSON falls through to ``verdict='unknown'``.

def _read_cluster_cf_status(meta: LoopMetadata) -> LoopStatus | None:
    data = _safe_read_json(CLUSTER_CAL_FACTORS_JSON) or {}
    factors = data.get("cluster_cal_factors") or data.get("clusters") or {}
    if not factors:
        return None
    active = sum(
        1
        for f in factors.values()
        if isinstance(f, dict) and (f.get("status") == "active" or f.get("n_samples", 0) >= 5)
    )
    total = len(factors)
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(CLUSTER_CAL_FACTORS_JSON),
        verdict="improving" if active >= max(1, total // 2) else "collecting_data",
        primary_metric={
            "name": "Active clusters",
            "value": active,
            "unit": f"/{total}",
            "trend": "flat",
        },
        n_samples=sum(
            int(f.get("n_samples", 0) or 0) for f in factors.values() if isinstance(f, dict)
        ),
        message=f"{active}/{total} clusters active",
        raw_excerpt={
            "global_cal_factor": data.get("global_cal_factor"),
            "n_clusters": total,
        },
    )


def _read_regime_status(meta: LoopMetadata) -> LoopStatus | None:
    data = _safe_read_json(REGIME_MULTIPLIERS_JSON) or {}
    multipliers = data.get("multipliers") or {}
    if not multipliers:
        return None
    active = sum(
        1 for v in multipliers.values() if isinstance(v, dict) and v.get("n_samples", 0) >= 8
    )
    total = len(multipliers)
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(REGIME_MULTIPLIERS_JSON),
        verdict="improving" if active == total else "collecting_data",
        primary_metric={
            "name": "Regimes calibrated",
            "value": active,
            "unit": f"/{total}",
            "trend": "flat",
        },
        n_samples=sum(
            int(v.get("n_samples", 0) or 0) for v in multipliers.values() if isinstance(v, dict)
        ),
        message=f"{active}/{total} regimes ≥ 8 samples",
        raw_excerpt={k: v for k, v in list(multipliers.items())[:3]},
    )


def _read_validation_feedback_status(meta: LoopMetadata) -> LoopStatus | None:
    summary = _safe_read_json(FEEDBACK_SUMMARY_JSON) or {}
    if not summary:
        return None
    mae = summary.get("portfolio_avg_mae")
    dir_acc = summary.get("portfolio_direction_acc")
    metric = None
    if mae is not None:
        metric = {
            "name": "Portfolio MAE",
            "value": round(float(mae), 2),
            "unit": "pp",
            "trend": "flat",
        }
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(FEEDBACK_SUMMARY_JSON),
        verdict="improving" if (mae is not None and float(mae) < 6) else "collecting_data",
        primary_metric=metric,
        n_samples=int(summary.get("n_tickers", 0) or 0) or None,
        message=(
            f"MAE {mae:.2f}pp · dir {float(dir_acc) * 100:.0f}%"
            if mae is not None and dir_acc is not None
            else None
        ),
        raw_excerpt={
            "portfolio_avg_mae": mae,
            "portfolio_direction_acc": dir_acc,
            "n_tickers": summary.get("n_tickers"),
            "cal_factor_changes": summary.get("cal_factor_changes"),
        },
    )


def _read_polygon_status(meta: LoopMetadata) -> LoopStatus | None:
    path = os.path.join(DATA_DIR, "cd_pattern_polygon_accuracy.json")
    data = _safe_read_json(path) or {}
    if not data:
        return None
    rho = data.get("mean_corr_match_stock")
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(path),
        verdict="neutral",  # analytics-only — never "improving" in production
        primary_metric=(
            {"name": "Mean ρ", "value": round(float(rho), 3), "unit": "", "trend": "flat"}
            if rho is not None
            else None
        ),
        n_samples=int(data.get("n_samples", 0) or 0) or None,
        message="Analytics-only (no recommender consumes ρ today)",
        raw_excerpt={"mean_corr_match_stock": rho, "n_samples": data.get("n_samples")},
    )


def _read_curve_impact_status(meta: LoopMetadata) -> LoopStatus | None:
    path = os.path.join(DATA_DIR, "curve_impact_cumulative_state.json")
    data = _safe_read_json(path) or {}
    if not data:
        return None
    mae_base = data.get("mae_base_pp")
    mae_daily = data.get("mae_daily_pp")
    delta = None
    verdict: Verdict = "collecting_data"
    if mae_base is not None and mae_daily is not None:
        delta = float(mae_daily) - float(mae_base)
        verdict = "improving" if delta < -0.1 else ("stable" if abs(delta) < 0.5 else "not_helping")
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(path),
        verdict=verdict,
        primary_metric=(
            {
                "name": "Δ MAE (daily−base)",
                "value": round(delta, 2),
                "unit": "pp",
                "trend": "down" if delta < 0 else ("up" if delta > 0 else "flat"),
            }
            if delta is not None
            else None
        ),
        n_samples=int(data.get("n_events", 0) or 0) or None,
        message=(
            f"base {mae_base:.2f} → daily {mae_daily:.2f} pp"
            if mae_base is not None and mae_daily is not None
            else None
        ),
        raw_excerpt={
            "mae_base_pp": mae_base,
            "mae_daily_pp": mae_daily,
            "mae_k8_pp": data.get("mae_k8_pp"),
            "mae_eis_pp": data.get("mae_eis_pp"),
            "n_events": data.get("n_events"),
        },
    )


def _read_signal_audit_status(meta: LoopMetadata) -> LoopStatus | None:
    path = os.path.join(DATA_DIR, "signal_calibration.json")
    data = _safe_read_json(path) or {}
    if not data:
        return None
    hit = data.get("useful_hit_pct")
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(path),
        verdict="improving" if (hit is not None and float(hit) >= 60) else "collecting_data",
        primary_metric=(
            {
                "name": "Useful hit-rate",
                "value": round(float(hit), 1),
                "unit": "%",
                "trend": "flat",
            }
            if hit is not None
            else None
        ),
        n_samples=int(data.get("useful_n", 0) or 0) or None,
        message=(
            f"useful hit {hit:.1f}% · pending {data.get('pending_outcomes', 0)}"
            if hit is not None
            else None
        ),
        raw_excerpt={
            "useful_hit_pct": hit,
            "useful_n": data.get("useful_n"),
            "pending_outcomes": data.get("pending_outcomes"),
        },
    )


def _read_eis_super_status(meta: LoopMetadata) -> LoopStatus | None:
    path = os.path.join(DATA_DIR, "eis_super_score_learning.json")
    data = _safe_read_json(path) or {}
    if not data:
        return None
    lift = data.get("mean_lift_7d")
    rho_raw = data.get("mean_corr_raw_7d")
    rho_super = data.get("mean_corr_super_7d")
    verdict: Verdict = "collecting_data"
    if rho_raw is not None and rho_super is not None:
        verdict = "improving" if float(rho_super) > float(rho_raw) + 0.02 else "stable"
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(path),
        verdict=verdict,
        primary_metric=(
            {
                "name": "Lift 7d",
                "value": round(float(lift), 3),
                "unit": "",
                "trend": "up" if (lift or 0) > 0 else "flat",
            }
            if lift is not None
            else None
        ),
        n_samples=None,
        message=(
            f"ρ super {rho_super:.3f} vs raw {rho_raw:.3f}"
            if rho_raw is not None and rho_super is not None
            else None
        ),
        raw_excerpt={
            "mean_lift_7d": lift,
            "mean_corr_raw_7d": rho_raw,
            "mean_corr_super_7d": rho_super,
        },
    )


def _read_global_cf_status(meta: LoopMetadata) -> LoopStatus | None:
    path = os.path.join(DATA_DIR, "model_calibration_state.json")
    data = _safe_read_json(path) or {}
    if not data:
        return None
    cal = (data.get("cal_factor") or {}).get("v4_options")
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(path),
        verdict="stable" if cal is not None else "collecting_data",
        primary_metric=(
            {"name": "Cal factor", "value": round(float(cal), 3), "unit": "", "trend": "flat"}
            if cal is not None
            else None
        ),
        n_samples=None,
        message=(f"v4_options cal_factor = {cal:.3f}" if cal is not None else None),
        raw_excerpt={"cal_factor_v4_options": cal},
    )


def _read_trade_calib_status(meta: LoopMetadata) -> LoopStatus | None:
    data = _safe_read_json(INVESTMENT_TRADE_CALIB_JSON) or {}
    if not data:
        return None
    return LoopStatus(
        id=meta.id,
        last_run_at=_mtime_iso(INVESTMENT_TRADE_CALIB_JSON),
        verdict="stable" if data.get("thresholds") else "collecting_data",
        primary_metric=None,
        n_samples=int(data.get("n_trades", 0) or 0) or None,
        message=(f"n trades calibrated: {data.get('n_trades')}" if data.get("n_trades") else None),
        raw_excerpt={"thresholds": data.get("thresholds")},
    )


def _read_portfolio_error_loop_status(meta: LoopMetadata) -> LoopStatus | None:
    from prediction.portfolio_error_loop import build_status_excerpt

    try:
        st = build_status_excerpt()
    except Exception:
        return None
    verdict = st.get("verdict") or "collecting_data"
    delta = st.get("weighted_vs_equal_delta_eur")
    metric = None
    if delta is not None:
        try:
            metric = {
                "name": "weighted−equal €",
                "value": float(delta),
                "unit": "€",
                "trend": "up" if float(delta) > 0 else ("down" if float(delta) < 0 else "flat"),
            }
        except (TypeError, ValueError):
            metric = None
    history = (st.get("doc") or {}).get("history") if isinstance(st.get("doc"), dict) else []
    last_run = None
    if isinstance(history, list) and history:
        last_run = history[-1].get("run_at") if isinstance(history[-1], dict) else None
    return LoopStatus(
        id=meta.id,
        last_run_at=last_run or st.get("updated_at"),
        verdict=verdict if verdict in (
            "collecting_data", "improving", "stable", "neutral", "not_helping", "stalled", "unknown"
        ) else "unknown",
        primary_metric=metric,
        n_samples=int(st.get("n_closed") or 0) or None,
        message=st.get("pending_proposal", {}).get("reason") if isinstance(st.get("pending_proposal"), dict) else None,
        raw_excerpt={
            "params": st.get("params"),
            "latest": st.get("latest"),
            "pending_proposal": st.get("pending_proposal"),
        },
    )


def _read_bayesian_shrinkage_status(meta: LoopMetadata) -> LoopStatus | None:
    from prediction.bayesian_shrinkage import build_status_excerpt

    st = build_status_excerpt()
    n = int(st.get("total_trades") or 0)
    if n == 0:
        return None
    return LoopStatus(
        id=meta.id,
        last_run_at=st.get("last_run_at"),
        verdict="collecting_data" if n < 8 else "stable",
        primary_metric={
            "name": "Global prior",
            "value": round(float(st.get("global_prior") or 0) * 100, 1),
            "unit": "%",
            "trend": "flat",
        },
        n_samples=n,
        message=f"{st.get('cells_with_data', 0)} cells with data",
        raw_excerpt=st,
    )


def _read_proposal_engine_status(meta: LoopMetadata) -> LoopStatus | None:
    from prediction.calibration_proposal import build_status_excerpt

    st = build_status_excerpt()
    pending = int(st.get("pending_proposals") or 0)
    return LoopStatus(
        id=meta.id,
        last_run_at=st.get("updated_at"),
        verdict="collecting_data" if pending == 0 and int(st.get("frozen_cells") or 0) == 0 else "stable",
        primary_metric={
            "name": "Pending proposals",
            "value": pending,
            "unit": "",
            "trend": "flat",
        },
        n_samples=int(st.get("frozen_cells") or 0) or None,
        message=f"{pending} pending · {st.get('frozen_cells', 0)} frozen cells",
        raw_excerpt=st,
    )


def _read_advice_feedback_status(meta: LoopMetadata) -> LoopStatus | None:
    from prediction.advice_feedback_loop import build_status_excerpt

    st = build_status_excerpt()
    if not st.get("generated_at") and int(st.get("scored_points") or 0) == 0:
        return None
    return LoopStatus(
        id=meta.id,
        last_run_at=st.get("generated_at"),
        verdict="collecting_data" if int(st.get("scored_points") or 0) < 8 else "stable",
        primary_metric={
            "name": "Bucket corrections",
            "value": int(st.get("bucket_corrections") or 0),
            "unit": "",
            "trend": "flat",
        },
        n_samples=int(st.get("scored_points") or 0) or None,
        message=f"{st.get('action_demotions', 0)} demotions",
        raw_excerpt=st,
    )


# id → specialised reader.  Any id missing from this map uses the generic
# reader (file mtime only, verdict=unknown).
_STATUS_READERS: dict[str, Any] = {
    "cluster_cf": _read_cluster_cf_status,
    "regime_mult": _read_regime_status,
    "global_cf": _read_global_cf_status,
    "validation_feedback": _read_validation_feedback_status,
    "polygon_accuracy": _read_polygon_status,
    "curve_impact": _read_curve_impact_status,
    "signal_audit": _read_signal_audit_status,
    "eis_super_score": _read_eis_super_status,
    "investment_trade_calib": _read_trade_calib_status,
    "portfolio_error_loop": _read_portfolio_error_loop_status,
    "bayesian_shrinkage": _read_bayesian_shrinkage_status,
    "proposal_engine": _read_proposal_engine_status,
    "advice_feedback": _read_advice_feedback_status,
}


def read_loop_status(meta: LoopMetadata) -> LoopStatus:
    """Best-effort status reader for one loop.

    Falls back to:
    * `_planned_status` for loops marked ``planned=True``
    * `_frontend_status` for loops whose schedule is ``frontend_localstorage``
    * the specialised reader from `_STATUS_READERS` if registered
    * `_generic_status` (mtime only, ``verdict='unknown'``) otherwise
    """
    if meta.planned:
        return _planned_status(meta)
    if meta.schedule == "frontend_localstorage":
        return _frontend_status(meta)
    reader = _STATUS_READERS.get(meta.id)
    if reader is not None:
        try:
            specialised = reader(meta)
            if specialised is not None:
                return specialised
        except Exception:
            # Defensive — never let a single reader bring down the bus.
            pass
    return _generic_status(meta)


# ── Aggregated views ─────────────────────────────────────────────────────────


def list_loops() -> list[dict[str, Any]]:
    """Return every loop metadata as plain dicts (JSON-ready)."""
    return [asdict(m) for m in LOOPS]


def list_loops_with_status() -> list[dict[str, Any]]:
    """Return ``[{...metadata, status: {...}}, …]`` for every loop."""
    out: list[dict[str, Any]] = []
    for meta in LOOPS:
        status = read_loop_status(meta)
        merged = asdict(meta)
        merged["status"] = status.to_dict()
        out.append(merged)
    return out


def get_loop(loop_id: str) -> dict[str, Any] | None:
    """Return one loop's metadata + live status, or None if id unknown."""
    meta = LOOPS_BY_ID.get(loop_id)
    if meta is None:
        return None
    status = read_loop_status(meta)
    merged = asdict(meta)
    merged["status"] = status.to_dict()
    return merged


@dataclass
class FamilyHealth:
    family: Family
    total: int
    active: int
    collecting: int
    stalled: int
    planned: int
    frontend_only: int


def _classify(status: LoopStatus, meta: LoopMetadata) -> str:
    if meta.planned:
        return "planned"
    if meta.schedule == "frontend_localstorage":
        return "frontend_only"
    if status.verdict in ("improving", "stable"):
        return "active"
    if status.verdict in ("collecting_data", "neutral", "unknown"):
        return "collecting"
    return "stalled"  # not_helping, stalled


def get_health_overview() -> dict[str, Any]:
    """Aggregated health view consumed by the Learning Lab v2 landing."""
    by_family: dict[Family, dict[str, int]] = {
        "A_magnitude": {"total": 0, "active": 0, "collecting": 0, "stalled": 0, "planned": 0, "frontend_only": 0},
        "B_pre_cd": {"total": 0, "active": 0, "collecting": 0, "stalled": 0, "planned": 0, "frontend_only": 0},
        "C_portfolio": {"total": 0, "active": 0, "collecting": 0, "stalled": 0, "planned": 0, "frontend_only": 0},
        "D_monitoring": {"total": 0, "active": 0, "collecting": 0, "stalled": 0, "planned": 0, "frontend_only": 0},
    }
    last_runs: list[str] = []
    for meta in LOOPS:
        status = read_loop_status(meta)
        by_family[meta.family]["total"] += 1
        by_family[meta.family][_classify(status, meta)] += 1
        if status.last_run_at:
            last_runs.append(status.last_run_at)
    return {
        "computed_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "newest_run_at": max(last_runs) if last_runs else None,
        "total_loops": len(LOOPS),
        "by_family": [
            {"family": fam, **counts} for fam, counts in by_family.items()
        ],
    }


__all__ = (
    "Family",
    "Verdict",
    "Schedule",
    "LoopMetadata",
    "LoopStatus",
    "LOOPS",
    "LOOPS_BY_ID",
    "read_loop_status",
    "list_loops",
    "list_loops_with_status",
    "get_loop",
    "get_health_overview",
)
