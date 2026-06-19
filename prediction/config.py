"""
Environment flags and default paths for the prediction package.

Single source of truth for prediction-related ``os.environ`` knobs (names match
``data_orchestrator`` / legacy scripts). Load once via ``PredictionConfig.from_env()``
or ``get_config()``; inspect with ``python -m prediction.config --show``.

Environment variable reference
==============================

+-------------------------------+----------+------------------------------------------+
| Name                          | Default  | Effect (summary)                         |
+===============================+==========+==========================================+
| PRED_CURVE_SEQ_CALIB          | 1        | Sequential curve recalibration on/off    |
| PRED_AI_FEED_SEQ_MERGE        | 1        | AI feed pub. T/T+1/T+3 as seq knots      |
| PRED_EIS_POLY_ENABLED         | 1        | EIS shift + extra knots in precat poly   |
| PRED_EIS_POLY_ALPHA           | 0.15     | pp shift per EIS point on polynomial     |
| PRED_EIS_POLY_MAX_SHIFT       | 8.0      | Max |EIS| shift on model horizons (pp)   |
| ORCH_SKIP_SEC_K8              | (off)    | Skip 8-K merge into seq curve            |
| PRED_POSTHOC_REG              | 1        | Post-hoc regression bias correction      |
| PRED_POSTHOC_MIN_N            | 8        | Min pred/actual pairs for post-hoc       |
| PRED_POSTHOC_REPLACE_BIAS     | 1        | Replace calib bias with post-hoc       |
| PRED_POSTHOC_BETA_MAX/MIN     | 2.0/0.25 | Clamp post-hoc beta                    |
| PRED_POSTHOC_ALPHA_ABS_MAX    | 20       | Clamp post-hoc alpha                   |
| PRED_MAG_BUCKET*              | see code | Magnitude bucket calibration           |
| CALIB_REFRESH_DAYS            | 30       | Days between model calib refresh         |
| FORCE_CALIB_REFRESH           | (off)    | Force immediate calib refresh            |
| PRED_CURVE_ALIGN_EPSILON      | 0.5      | Flat curve threshold (pp)                |
| PRED_CURVE_ALIGN_MODE         | hybrid   | scale / downgrade / hybrid reconcile     |
| PRED_CURVE_ALIGN_STRONG_PP    | (auto)   | Strong mismatch threshold (pp)           |
| PRED_REQUIRE_OPTIONS          | 0        | Block if options missing                 |
| PRED_REQUIRE_PRICE            | 1        | Skip curve if price series missing       |
| PRED_NCT_STRICT               | 0        | No silent full-JSON NCT fallback         |
| PRED_STRICT_ERRORS            | 0        | Re-raise after logging prediction errors |
| CLINICAL_PRED_OVERLAY         | (off)    | Clinical CT/PubMed direction overlay     |
| CLINICAL_PRED_CT_FETCH        | (off)    | Network CT.gov in overlay                |
| CLINICAL_PRED_PUBMED_NETWORK  | (off)    | Network PubMed in overlay                |
| PAST_PRED_YF_PERIOD           | 10y      | Yahoo window for past predictions        |
| FORCE_PAST_PRED_FULL_REBUILD  | (off)    | Recompute all past-pred pairs            |
| PAST_PRED_DISABLE_DISK        | (off)    | Session-only past pred cache             |
| HISTLIB_INCLUDE_CLINICAL_*    | 1 / 0    | Extra clinical pairs in hist lib         |
| PRICE_TAIL_TRIM_DAYS          | 120      | Calendar trim for live price tail        |
| ORCH_OPTIONS_WORKERS          | (auto)   | Parallel options fetch (0=sequential)    |
| SEC_K8_SUBMISSIONS_SLEEP_SEC  | 0.15     | Sleep between SEC 8-K requests           |
| V4_ADAPTIVE*                  | see code | Adaptive direction rules from history    |
| PRED_EXPLAIN_*                | see code | Predizione guida chart / clustering      |
| PRED_DM_STRUCT_BLEND*         | (off)    | Structural blend for model_dm nodes      |
| IPO_SNAPSHOT_PRED_MODE        | show     | IPO snapshot column filter               |
| CALIB_CONTROL_CLINICAL_MAX_ROWS | (none) | Cap clinical rows in calib control     |
| PRED_ENGINE                   | v4       | Prediction engine: v4 (default) or v5   |
| PRED_CURVE_FY_LIQ             | 0        | (legacy) superseded by PRED_FUNDAMENTAL_SHRINK |
| PRED_FUNDAMENTAL_SHRINK       | 1        | v4 curve shrink from FY liq + beta (5Y)      |
| PRED_DIR_FUND_PENALTY         | 1        | Direction confidence penalties (liq/beta)      |
| PRED_V5_FUND_RISK             | 1        | v5 MRM/PCG sigma & fan width from liq/beta   |
| PRED_V5_ALIGN_SIGN_V4       | 1        | Allinea segno q50 v5 a v4 se |q50|>0.5 pp     |
| PRED_V5_COHORT_PRIOR          | 1        | Prior PCG da coorte NCT (past_catalyst JSON)   |
| PRED_V5_ANCHOR_Q50_V4         | 1        | q50 v5 = v4; fan q05/q95 = banda MC intorno   |
| PRED_V5_CALIB                 | 1        | Calibra larghezza fan v5 su storico past JSON  |
| PRED_V5_EXCEL_FAN             | 0        | (legacy) non usato su foglio Accuracy (sempre 8×q50) |
| PRED_V5_SIM_DISPLAY           | v4       | Simulation Δ% Pred: v4 | v5 | blend            |
| PRED_V5_GRAFICI_FAN           | 1        | Grafici: pct_v5_lo/hi su nodi curva            |
| PRED_V4_CURVE_SCALE           | 1.0      | Moltiplicatore finale curva v4 (es. 1.05)    |
+-------------------------------------------------------------------------------+

Paths (not env): ``data/pred_calibration.json``, ``data/pred_curve_seq_state.json``,
``data/model_calibration_state.json``.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
from dataclasses import dataclass, fields
from typing import Any, ClassVar

# ── Paths (same defaults as data_orchestrator) ───────────────────────────────
CALIB_PATH = pathlib.Path("data") / "pred_calibration.json"
CURVE_SEQ_STATE_PATH = pathlib.Path("data") / "pred_curve_seq_state.json"
CALIB_STATE_PATH = pathlib.Path("data") / "model_calibration_state.json"

_TRUTHY_OFF = frozenset({"0", "false", "no", "off"})
_TRUTHY_ON = frozenset({"1", "true", "yes", "on"})


def _env_raw(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_truthy(name: str, default: str = "1") -> bool:
    v = os.environ.get(name, default).strip().lower()
    return v not in _TRUTHY_OFF


def _env_explicit_on(name: str) -> bool:
    return _env_raw(name).lower() in _TRUTHY_ON


def _env_optional_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() not in _TRUTHY_OFF


def _env_int(name: str, default: int, *, lo: int | None = None, hi: int | None = None) -> int:
    try:
        n = int(os.environ.get(name, str(default)).strip() or str(default))
    except ValueError:
        n = default
    if lo is not None:
        n = max(lo, n)
    if hi is not None:
        n = min(hi, n)
    return n


def _env_float(name: str, default: float, *, lo: float | None = None, hi: float | None = None) -> float:
    try:
        v = float(os.environ.get(name, str(default)).strip() or str(default))
    except ValueError:
        v = default
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


def _env_optional_float(name: str) -> float | None:
    raw = _env_raw(name)
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


@dataclass(frozen=True)
class PredictionConfig:
    """All prediction-related environment flags (loaded once per process)."""

    # Sequential curve calibration
    pred_curve_seq_calib: bool  # PRED_CURVE_SEQ_CALIB — ricalibrazione sequenziale curva
    orch_skip_sec_k8: bool  # ORCH_SKIP_SEC_K8 — salta merge 8-K nella curva seq
    pred_ai_feed_seq_merge: bool  # PRED_AI_FEED_SEQ_MERGE — nodi AI feed su seq curve
    pred_eis_poly_enabled: bool  # PRED_EIS_POLY_ENABLED — EIS nel polinomio prediction
    pred_eis_poly_alpha: float  # PRED_EIS_POLY_ALPHA — pp per punto EIS sul polinomio
    pred_eis_poly_max_shift: float  # PRED_EIS_POLY_MAX_SHIFT — clamp shift EIS (pp)
    pred_ai_feed_verified_only: bool  # PRED_AI_FEED_VERIFIED_ONLY — solo eventi ref. verificata
    pred_clinical_indicators_poly: bool  # PRED_CLINICAL_INDICATORS_POLY — KPI clinici nel polinomio
    pred_clinical_indicators_alpha: float  # PRED_CLINICAL_INDICATORS_ALPHA — pp per unità KPI
    pred_clinical_indicators_max_pp: float  # PRED_CLINICAL_INDICATORS_MAX_PP — clamp shift KPI

    # Post-hoc regression
    pred_posthoc_reg: bool  # PRED_POSTHOC_REG — correzione post-hoc attiva
    pred_posthoc_min_n: int  # PRED_POSTHOC_MIN_N — coppie minime per regressione
    pred_posthoc_replace_bias: bool  # PRED_POSTHOC_REPLACE_BIAS — sostituisce bias calib
    pred_posthoc_beta_max: float  # PRED_POSTHOC_BETA_MAX
    pred_posthoc_beta_min: float  # PRED_POSTHOC_BETA_MIN
    pred_posthoc_alpha_abs_max: float  # PRED_POSTHOC_ALPHA_ABS_MAX

    # Magnitude buckets
    pred_mag_bucket: bool  # PRED_MAG_BUCKET — bucket per grandezza movimento
    pred_mag_bucket_min_n: int  # PRED_MAG_BUCKET_MIN_N
    pred_mag_bucket_after_posthoc: bool  # PRED_MAG_BUCKET_AFTER_POSTHOC
    pred_mag_bucket_replace_posthoc: bool  # PRED_MAG_BUCKET_REPLACE_POSTHOC

    # Model calibration refresh
    calib_refresh_days: int  # CALIB_REFRESH_DAYS — giorni tra refresh stato modello
    force_calib_refresh: bool  # FORCE_CALIB_REFRESH — refresh immediato

    # Direction ↔ curve reconcile (live only)
    pred_curve_align_epsilon: float  # PRED_CURVE_ALIGN_EPSILON — soglia curva «flat» (%)
    pred_curve_align_mode: str  # PRED_CURVE_ALIGN_MODE — scale|downgrade|hybrid
    pred_curve_align_strong_pp_raw: float | None  # PRED_CURVE_ALIGN_STRONG_PP (vuoto=auto)

    # Data requirements
    pred_require_options: bool  # PRED_REQUIRE_OPTIONS — errore se opzioni assenti
    pred_require_price: bool  # PRED_REQUIRE_PRICE — salta curva senza prezzo

    # NCT cohort / errors
    pred_nct_strict: bool  # PRED_NCT_STRICT — no fallback JSON completo
    pred_strict_errors: bool  # PRED_STRICT_ERRORS — log + re-raise

    # Clinical overlay (live predictions)
    clinical_pred_overlay: bool  # CLINICAL_PRED_OVERLAY
    clinical_pred_ct_fetch: bool  # CLINICAL_PRED_CT_FETCH — rete CT.gov
    clinical_pred_pubmed_network: bool  # CLINICAL_PRED_PUBMED_NETWORK

    # Past predictions / hist lib
    past_pred_yf_period: str  # PAST_PRED_YF_PERIOD — finestra Yahoo (10y, max, …)
    force_past_pred_full_rebuild: bool  # FORCE_PAST_PRED_FULL_REBUILD
    past_pred_disable_disk: bool  # PAST_PRED_DISABLE_DISK — solo sessione
    histlib_include_clinical_completions: bool  # HISTLIB_INCLUDE_CLINICAL_COMPLETIONS
    histlib_max_extra_clinical_pairs: int  # HISTLIB_MAX_EXTRA_CLINICAL_PAIRS (0=illimitato)

    # Market data / orchestrator (prediction path)
    price_tail_trim_days: int  # PRICE_TAIL_TRIM_DAYS — trim coda prezzi live
    orch_options_workers_parallel: bool  # ORCH_OPTIONS_WORKERS — 0=sequenziale
    sec_k8_submissions_sleep_sec: float  # SEC_K8_SUBMISSIONS_SLEEP_SEC
    sec_k8_lookback_days: int  # SEC_K8_LOOKBACK_DAYS — finestra filing pre-CD (default 180)
    pred_k8_display_overlay: bool  # PRED_K8_DISPLAY_OVERLAY — interp. 8-K su Pred (anche CD≥oggi)

    # V4 adaptive direction
    v4_adaptive: bool  # V4_ADAPTIVE
    v4_adaptive_min_bucket_n: int  # V4_ADAPTIVE_MIN_BUCKET_N
    v4_adaptive_bad_accuracy: float  # V4_ADAPTIVE_BAD_ACCURACY
    v4_adaptive_max_rules: int  # V4_ADAPTIVE_MAX_RULES

    # Predizione guida / explain charts
    pred_explain_flat_threshold_pp: float  # PRED_EXPLAIN_FLAT_THRESHOLD_PP
    pred_explain_n_clusters: int  # PRED_EXPLAIN_N_CLUSTERS
    pred_explain_cluster_min_valid_tp: int  # PRED_EXPLAIN_CLUSTER_MIN_VALID_TP
    pred_explain_cluster_use_deltas: bool  # PRED_EXPLAIN_CLUSTER_USE_DELTAS
    pred_explain_cluster_row_shape: bool  # PRED_EXPLAIN_CLUSTER_ROW_SHAPE
    pred_explain_cluster_silhouette_min_n: int  # PRED_EXPLAIN_CLUSTER_SILHOUETTE_MIN_N
    pred_explain_cluster_silhouette_k: bool  # PRED_EXPLAIN_CLUSTER_SILHOUETTE_K
    pred_cluster_min_obs: int  # PRED_CLUSTER_MIN_OBS — osservazioni minime per k-means
    pred_cluster_min_k: int  # PRED_CLUSTER_MIN_K — k target minimo per split affidabile
    pred_cluster_min_per_cluster: int  # PRED_CLUSTER_MIN_PER_CLUSTER — membri min per cluster
    pred_cluster_small_n_max_k: int  # PRED_CLUSTER_SMALL_N_MAX_K — k massimo se N≤7
    pred_cluster_canonicalize_supernova: bool  # PRED_CLUSTER_CANONICALIZE_SUPERNOVA
    pred_explain_post_cd_split_eps_pp: float  # PRED_EXPLAIN_POST_CD_SPLIT_EPS_PP
    pred_explain_show_post_cd_block: bool  # PRED_EXPLAIN_SHOW_POST_CD_BLOCK
    pred_explain_post_cd_min_pre: int  # PRED_EXPLAIN_POST_CD_MIN_PRE
    pred_explain_post_cd_min_post: int  # PRED_EXPLAIN_POST_CD_MIN_POST
    pred_explain_chart_fix_yrange: bool  # PRED_EXPLAIN_CHART_FIX_YRANGE
    pred_explain_embed_tre_viste: bool  # PRED_EXPLAIN_EMBED_TRE_VISTE
    pred_explain_tre_viste_dpi: int  # PRED_EXPLAIN_TRE_VISTE_DPI

    # Structural blend (model_dm nodes)
    pred_dm_struct_blend: bool  # PRED_DM_STRUCT_BLEND
    pred_dm_struct_blend_tickers: str  # PRED_DM_STRUCT_BLEND_TICKERS (CSV, maiuscolo)

    # IPO snapshot / calib control
    ipo_snapshot_pred_mode: str  # IPO_SNAPSHOT_PRED_MODE — show|perfect|accurate|…
    calib_control_clinical_max_rows: int | None  # CALIB_CONTROL_CLINICAL_MAX_ROWS

    # Engine selector (v4 orchestrator path vs v5 MRM+PCG prototype)
    pred_engine: str  # PRED_ENGINE — v4 | v5

    # FY balance-sheet liquidity (legacy flag; use pred_fundamental_shrink)
    pred_curve_fy_liq: bool  # PRED_CURVE_FY_LIQ — superseded by PRED_FUNDAMENTAL_SHRINK

    # Fundamental risk: curve shrink (v4), direction penalties, v5 sigma/fan
    pred_fundamental_shrink: bool  # PRED_FUNDAMENTAL_SHRINK
    pred_fundamental_shrink_precd: bool  # PRED_FUNDAMENTAL_SHRINK_PRECD — shrink anche model_dm*
    pred_v4_curve_scale_precd: float  # PRED_V4_CURVE_SCALE_PRECD — scala model_dm* (default 1.05)
    pred_curve_apply_cal_factor: bool  # PRED_CURVE_APPLY_CAL_FACTOR — cal_factor su curva display
    pred_dir_fund_penalty: bool  # PRED_DIR_FUND_PENALTY
    pred_v5_fund_risk: bool  # PRED_V5_FUND_RISK
    pred_v5_align_sign_v4: bool  # PRED_V5_ALIGN_SIGN_V4
    pred_v5_cohort_prior: bool  # PRED_V5_COHORT_PRIOR
    pred_v5_anchor_q50_v4: bool  # PRED_V5_ANCHOR_Q50_V4
    pred_v5_calib: bool  # PRED_V5_CALIB
    pred_v5_excel_fan: bool  # PRED_V5_EXCEL_FAN
    pred_v5_sim_display: str  # PRED_V5_SIM_DISPLAY — v4 | v5 | blend
    pred_v5_grafici_fan: bool  # PRED_V5_GRAFICI_FAN
    pred_v4_curve_scale: float  # PRED_V4_CURVE_SCALE

    _ENV_BY_FIELD: ClassVar[dict[str, str]] = {
        "pred_curve_seq_calib": "PRED_CURVE_SEQ_CALIB",
        "orch_skip_sec_k8": "ORCH_SKIP_SEC_K8",
        "pred_ai_feed_seq_merge": "PRED_AI_FEED_SEQ_MERGE",
        "pred_eis_poly_enabled": "PRED_EIS_POLY_ENABLED",
        "pred_eis_poly_alpha": "PRED_EIS_POLY_ALPHA",
        "pred_eis_poly_max_shift": "PRED_EIS_POLY_MAX_SHIFT",
        "pred_ai_feed_verified_only": "PRED_AI_FEED_VERIFIED_ONLY",
        "pred_clinical_indicators_poly": "PRED_CLINICAL_INDICATORS_POLY",
        "pred_clinical_indicators_alpha": "PRED_CLINICAL_INDICATORS_ALPHA",
        "pred_clinical_indicators_max_pp": "PRED_CLINICAL_INDICATORS_MAX_PP",
        "pred_posthoc_reg": "PRED_POSTHOC_REG",
        "pred_posthoc_min_n": "PRED_POSTHOC_MIN_N",
        "pred_posthoc_replace_bias": "PRED_POSTHOC_REPLACE_BIAS",
        "pred_posthoc_beta_max": "PRED_POSTHOC_BETA_MAX",
        "pred_posthoc_beta_min": "PRED_POSTHOC_BETA_MIN",
        "pred_posthoc_alpha_abs_max": "PRED_POSTHOC_ALPHA_ABS_MAX",
        "pred_mag_bucket": "PRED_MAG_BUCKET",
        "pred_mag_bucket_min_n": "PRED_MAG_BUCKET_MIN_N",
        "pred_mag_bucket_after_posthoc": "PRED_MAG_BUCKET_AFTER_POSTHOC",
        "pred_mag_bucket_replace_posthoc": "PRED_MAG_BUCKET_REPLACE_POSTHOC",
        "calib_refresh_days": "CALIB_REFRESH_DAYS",
        "force_calib_refresh": "FORCE_CALIB_REFRESH",
        "pred_curve_align_epsilon": "PRED_CURVE_ALIGN_EPSILON",
        "pred_curve_align_mode": "PRED_CURVE_ALIGN_MODE",
        "pred_curve_align_strong_pp_raw": "PRED_CURVE_ALIGN_STRONG_PP",
        "pred_require_options": "PRED_REQUIRE_OPTIONS",
        "pred_require_price": "PRED_REQUIRE_PRICE",
        "pred_nct_strict": "PRED_NCT_STRICT",
        "pred_strict_errors": "PRED_STRICT_ERRORS",
        "clinical_pred_overlay": "CLINICAL_PRED_OVERLAY",
        "clinical_pred_ct_fetch": "CLINICAL_PRED_CT_FETCH",
        "clinical_pred_pubmed_network": "CLINICAL_PRED_PUBMED_NETWORK",
        "past_pred_yf_period": "PAST_PRED_YF_PERIOD",
        "force_past_pred_full_rebuild": "FORCE_PAST_PRED_FULL_REBUILD",
        "past_pred_disable_disk": "PAST_PRED_DISABLE_DISK",
        "histlib_include_clinical_completions": "HISTLIB_INCLUDE_CLINICAL_COMPLETIONS",
        "histlib_max_extra_clinical_pairs": "HISTLIB_MAX_EXTRA_CLINICAL_PAIRS",
        "price_tail_trim_days": "PRICE_TAIL_TRIM_DAYS",
        "orch_options_workers_parallel": "ORCH_OPTIONS_WORKERS",
        "sec_k8_submissions_sleep_sec": "SEC_K8_SUBMISSIONS_SLEEP_SEC",
        "sec_k8_lookback_days": "SEC_K8_LOOKBACK_DAYS",
        "pred_k8_display_overlay": "PRED_K8_DISPLAY_OVERLAY",
        "v4_adaptive": "V4_ADAPTIVE",
        "v4_adaptive_min_bucket_n": "V4_ADAPTIVE_MIN_BUCKET_N",
        "v4_adaptive_bad_accuracy": "V4_ADAPTIVE_BAD_ACCURACY",
        "v4_adaptive_max_rules": "V4_ADAPTIVE_MAX_RULES",
        "pred_explain_flat_threshold_pp": "PRED_EXPLAIN_FLAT_THRESHOLD_PP",
        "pred_explain_n_clusters": "PRED_EXPLAIN_N_CLUSTERS",
        "pred_explain_cluster_min_valid_tp": "PRED_EXPLAIN_CLUSTER_MIN_VALID_TP",
        "pred_explain_cluster_use_deltas": "PRED_EXPLAIN_CLUSTER_USE_DELTAS",
        "pred_explain_cluster_row_shape": "PRED_EXPLAIN_CLUSTER_ROW_SHAPE",
        "pred_explain_cluster_silhouette_min_n": "PRED_EXPLAIN_CLUSTER_SILHOUETTE_MIN_N",
        "pred_explain_cluster_silhouette_k": "PRED_EXPLAIN_CLUSTER_SILHOUETTE_K",
        "pred_cluster_min_obs": "PRED_CLUSTER_MIN_OBS",
        "pred_cluster_min_k": "PRED_CLUSTER_MIN_K",
        "pred_cluster_min_per_cluster": "PRED_CLUSTER_MIN_PER_CLUSTER",
        "pred_cluster_small_n_max_k": "PRED_CLUSTER_SMALL_N_MAX_K",
        "pred_cluster_canonicalize_supernova": "PRED_CLUSTER_CANONICALIZE_SUPERNOVA",
        "pred_explain_post_cd_split_eps_pp": "PRED_EXPLAIN_POST_CD_SPLIT_EPS_PP",
        "pred_explain_show_post_cd_block": "PRED_EXPLAIN_SHOW_POST_CD_BLOCK",
        "pred_explain_post_cd_min_pre": "PRED_EXPLAIN_POST_CD_MIN_PRE",
        "pred_explain_post_cd_min_post": "PRED_EXPLAIN_POST_CD_MIN_POST",
        "pred_explain_chart_fix_yrange": "PRED_EXPLAIN_CHART_FIX_YRANGE",
        "pred_explain_embed_tre_viste": "PRED_EXPLAIN_EMBED_TRE_VISTE",
        "pred_explain_tre_viste_dpi": "PRED_EXPLAIN_TRE_VISTE_DPI",
        "pred_dm_struct_blend": "PRED_DM_STRUCT_BLEND",
        "pred_dm_struct_blend_tickers": "PRED_DM_STRUCT_BLEND_TICKERS",
        "ipo_snapshot_pred_mode": "IPO_SNAPSHOT_PRED_MODE",
        "calib_control_clinical_max_rows": "CALIB_CONTROL_CLINICAL_MAX_ROWS",
        "pred_engine": "PRED_ENGINE",
        "pred_curve_fy_liq": "PRED_CURVE_FY_LIQ",
        "pred_fundamental_shrink": "PRED_FUNDAMENTAL_SHRINK",
        "pred_fundamental_shrink_precd": "PRED_FUNDAMENTAL_SHRINK_PRECD",
        "pred_v4_curve_scale_precd": "PRED_V4_CURVE_SCALE_PRECD",
        "pred_curve_apply_cal_factor": "PRED_CURVE_APPLY_CAL_FACTOR",
        "pred_dir_fund_penalty": "PRED_DIR_FUND_PENALTY",
        "pred_v5_fund_risk": "PRED_V5_FUND_RISK",
        "pred_v5_align_sign_v4": "PRED_V5_ALIGN_SIGN_V4",
        "pred_v5_cohort_prior": "PRED_V5_COHORT_PRIOR",
        "pred_v5_anchor_q50_v4": "PRED_V5_ANCHOR_Q50_V4",
        "pred_v5_calib": "PRED_V5_CALIB",
        "pred_v5_excel_fan": "PRED_V5_EXCEL_FAN",
        "pred_v5_sim_display": "PRED_V5_SIM_DISPLAY",
        "pred_v5_grafici_fan": "PRED_V5_GRAFICI_FAN",
        "pred_v4_curve_scale": "PRED_V4_CURVE_SCALE",
    }

    _IT_DESC: ClassVar[dict[str, str]] = {
        "pred_curve_seq_calib": "Ricalibrazione sequenziale curva vs prezzi reali",
        "orch_skip_sec_k8": "Salta download/merge SEC 8-K (anche nella curva seq)",
        "pred_ai_feed_seq_merge": "Nodi ricalibrazione da AI feed (pubblicazioni pre-CD)",
        "pred_eis_poly_enabled": "EIS nel polinomio di prediction (shift + nodi extra)",
        "pred_eis_poly_alpha": "Peso EIS sul polinomio (pp per punto EIS)",
        "pred_eis_poly_max_shift": "Clamp massimo shift EIS sul polinomio (pp)",
        "pred_ai_feed_verified_only": "Polinomio/seq: solo eventi Catalyst Feed con ref. verificata",
        "pred_clinical_indicators_poly": "Shift polinomio da KPI clinici (ORR, endpoint, direction)",
        "pred_clinical_indicators_alpha": "Peso KPI clinici (pp per unità score aggregato)",
        "pred_clinical_indicators_max_pp": "Clamp shift KPI clinici sul polinomio (pp)",
        "pred_posthoc_reg": "Regressione post-hoc su errori storici",
        "pred_posthoc_min_n": "Coppie minime per post-hoc",
        "pred_posthoc_replace_bias": "Sostituisce bias calib con post-hoc",
        "pred_posthoc_beta_max": "Clamp massimo beta post-hoc",
        "pred_posthoc_beta_min": "Clamp minimo beta post-hoc",
        "pred_posthoc_alpha_abs_max": "Clamp |alpha| post-hoc",
        "pred_mag_bucket": "Calibrazione per bucket di magnitudine",
        "pred_mag_bucket_min_n": "N minimo per bucket magnitudine",
        "pred_mag_bucket_after_posthoc": "Bucket dopo post-hoc",
        "pred_mag_bucket_replace_posthoc": "Bucket sostituisce post-hoc",
        "calib_refresh_days": "Giorni tra refresh stato calibrazione modello",
        "force_calib_refresh": "Forza refresh calibrazione subito",
        "pred_curve_align_epsilon": "Soglia % per curva considerata piatta",
        "pred_curve_align_mode": "Modalità riconciliazione direzione-curva",
        "pred_curve_align_strong_pp_raw": "Soglia mismatch forte (pp); vuoto = max(2, 3×epsilon)",
        "pred_require_options": "Blocca predizione se opzioni assenti",
        "pred_require_price": "Salta curva se serie prezzo assente",
        "pred_nct_strict": "Vieta fallback silenzioso coorte NCT su refresh",
        "pred_strict_errors": "Dopo log, rilancia eccezioni prediction",
        "clinical_pred_overlay": "Overlay direzione da CT/PubMed/FDA",
        "clinical_pred_ct_fetch": "Consente fetch di rete CT.gov nell'overlay",
        "clinical_pred_pubmed_network": "Consente fetch PubMed nell'overlay",
        "past_pred_yf_period": "Periodo Yahoo per Past Catalyst / accuratezza",
        "force_past_pred_full_rebuild": "Ricalcola tutte le coppie past pred",
        "past_pred_disable_disk": "Past pred solo in sessione (no disco)",
        "histlib_include_clinical_completions": "Coppie extra da clinical in HistLib",
        "histlib_max_extra_clinical_pairs": "Tappo coppie clinical extra (0=nessun tappo)",
        "price_tail_trim_days": "Giorni calendario trim coda prezzi live",
        "orch_options_workers_parallel": "Fetch opzioni parallelo (0/false = sequenziale)",
        "sec_k8_submissions_sleep_sec": "Pausa tra richieste SEC 8-K (secondi)",
        "sec_k8_lookback_days": "Giorni calendario [CD−N, CD] per 8-K (sheet SEC K-8 e merge seq)",
        "pred_k8_display_overlay": "Interp. lineare 8-K su curva Pred (filing + sedute; anche CD≥oggi)",
        "v4_adaptive": "Regole direzione adattive da storico v4",
        "v4_adaptive_min_bucket_n": "N minimo bucket per regola adattiva",
        "v4_adaptive_bad_accuracy": "Soglia accuratezza «scarsa» per adattivo",
        "v4_adaptive_max_rules": "Numero massimo regole adattive",
        "pred_explain_flat_threshold_pp": "Soglia pp per cluster «flat» in guida",
        "pred_explain_n_clusters": "Target cluster k-means guida",
        "pred_explain_cluster_min_valid_tp": "Timepoint validi minimi per cluster",
        "pred_explain_cluster_use_deltas": "Feature cluster: delta tra TP",
        "pred_explain_cluster_row_shape": "Feature cluster: forma per riga",
        "pred_explain_cluster_silhouette_min_n": "N minimo per silhouette k",
        "pred_explain_cluster_silhouette_k": "Scegli k via silhouette",
        "pred_cluster_min_obs": "Osservazioni minime per clustering guida",
        "pred_cluster_min_k": "k minimo per split cluster affidabile",
        "pred_cluster_min_per_cluster": "Membri minimi per cluster (affidabilità)",
        "pred_cluster_small_n_max_k": "k massimo con campione piccolo (N≤7)",
        "pred_cluster_canonicalize_supernova": "Riallinea id 1 = minoranza SuperNova",
        "pred_explain_post_cd_split_eps_pp": "Tolleranza split post-CD (pp)",
        "pred_explain_show_post_cd_block": "Mostra blocco post-CD nei grafici",
        "pred_explain_post_cd_min_pre": "Osservazioni minime pre-CD per split",
        "pred_explain_post_cd_min_post": "Osservazioni minime post-CD per split",
        "pred_explain_chart_fix_yrange": "Asse Y fisso nei grafici guida",
        "pred_explain_embed_tre_viste": "Incorpora tre viste nel foglio guida",
        "pred_explain_tre_viste_dpi": "DPI immagini tre viste",
        "pred_dm_struct_blend": "Blend strutturale nodi model_dm",
        "pred_dm_struct_blend_tickers": "Ticker ammessi al blend (CSV)",
        "ipo_snapshot_pred_mode": "Filtro colonne pred su snapshot IPO",
        "calib_control_clinical_max_rows": "Cap righe clinical in controllo calib",
        "pred_engine": "Motore predizione: v4 (legacy) o v5 (MRM+PCG)",
        "pred_curve_fy_liq": "(Legacy) shrink curva FY — usare PRED_FUNDAMENTAL_SHRINK",
        "pred_fundamental_shrink": "Shrink curva v4 post-CD (d*, model_d*) da liquidità FY + beta",
        "pred_fundamental_shrink_precd": "Shrink anche orizzonti pre-CD (model_dm*); default off",
        "pred_v4_curve_scale_precd": "Moltiplicatore model_dm* dopo shrink (default 1.05)",
        "pred_curve_apply_cal_factor": "Scala curva modello/display per cal_factor v4",
        "pred_dir_fund_penalty": "Penalità confidence direzione (liq/beta)",
        "pred_v5_fund_risk": "v5: sigma regime e larghezza fan da liq/beta",
        "pred_v5_align_sign_v4": "Allinea segno q50 v5 a riferimento v4 (direzione/curva)",
        "pred_v5_cohort_prior": "v5: prior mediano coorte NCT (past_catalyst JSON)",
        "pred_v5_anchor_q50_v4": "v5: q50 ancorato a v4, larghezza fan da Monte Carlo",
        "pred_v5_calib": "v5: scala σ fan da MAE storico (pred_v5_calibration.json)",
        "pred_v5_excel_fan": "(legacy) il foglio Accuracy usa sempre solo q50 (8 colonne)",
        "pred_v5_sim_display": "Foglio Simulation: curva Pred da v4, v5 o blend 50/50",
        "pred_v5_grafici_fan": "Grafici: bande pct_v5_lo / pct_v5_hi sui nodi",
        "pred_v4_curve_scale": "Moltiplicatore finale %% curva v4 dopo shrink fondamentale",
    }

    @classmethod
    def from_env(cls) -> PredictionConfig:
        mode = _env_raw("PRED_CURVE_ALIGN_MODE", "hybrid").lower()
        if mode not in ("scale", "downgrade", "hybrid"):
            mode = "hybrid"
        ows = _env_raw("ORCH_OPTIONS_WORKERS").lower()
        _ccap_raw = _env_raw("CALIB_CONTROL_CLINICAL_MAX_ROWS")
        calib_clinical_cap: int | None
        if _ccap_raw:
            try:
                calib_clinical_cap = max(500, int(_ccap_raw))
            except ValueError:
                calib_clinical_cap = None
        else:
            calib_clinical_cap = None
        _eng = _env_raw("PRED_ENGINE", "v4").lower() or "v4"
        if _eng not in ("v4", "v5"):
            _eng = "v4"
        return cls(
            pred_curve_seq_calib=_env_truthy("PRED_CURVE_SEQ_CALIB", "1"),
            orch_skip_sec_k8=_env_explicit_on("ORCH_SKIP_SEC_K8"),
            pred_ai_feed_seq_merge=_env_truthy("PRED_AI_FEED_SEQ_MERGE", "1"),
            pred_eis_poly_enabled=_env_truthy("PRED_EIS_POLY_ENABLED", "1"),
            pred_eis_poly_alpha=_env_float("PRED_EIS_POLY_ALPHA", 0.15),
            pred_eis_poly_max_shift=_env_float("PRED_EIS_POLY_MAX_SHIFT", 8.0),
            pred_ai_feed_verified_only=_env_truthy("PRED_AI_FEED_VERIFIED_ONLY", "1"),
            pred_clinical_indicators_poly=_env_truthy("PRED_CLINICAL_INDICATORS_POLY", "1"),
            pred_clinical_indicators_alpha=_env_float("PRED_CLINICAL_INDICATORS_ALPHA", 0.35),
            pred_clinical_indicators_max_pp=_env_float("PRED_CLINICAL_INDICATORS_MAX_PP", 4.0),
            pred_posthoc_reg=_env_truthy("PRED_POSTHOC_REG", "1"),
            pred_posthoc_min_n=_env_int("PRED_POSTHOC_MIN_N", 8, lo=5),
            pred_posthoc_replace_bias=_env_truthy("PRED_POSTHOC_REPLACE_BIAS", "1"),
            pred_posthoc_beta_max=_env_float("PRED_POSTHOC_BETA_MAX", 2.0),
            pred_posthoc_beta_min=_env_float("PRED_POSTHOC_BETA_MIN", 0.25),
            pred_posthoc_alpha_abs_max=_env_float("PRED_POSTHOC_ALPHA_ABS_MAX", 20.0),
            pred_mag_bucket=_env_truthy("PRED_MAG_BUCKET", "1"),
            pred_mag_bucket_min_n=_env_int("PRED_MAG_BUCKET_MIN_N", 4, lo=3),
            pred_mag_bucket_after_posthoc=_env_truthy(
                "PRED_MAG_BUCKET_AFTER_POSTHOC", "1"
            ),
            pred_mag_bucket_replace_posthoc=_env_explicit_on(
                "PRED_MAG_BUCKET_REPLACE_POSTHOC"
            ),
            calib_refresh_days=_env_int("CALIB_REFRESH_DAYS", 30, lo=7, hi=366),
            force_calib_refresh=_env_explicit_on("FORCE_CALIB_REFRESH"),
            pred_curve_align_epsilon=_env_float("PRED_CURVE_ALIGN_EPSILON", 0.5, lo=0.0),
            pred_curve_align_mode=mode,
            pred_curve_align_strong_pp_raw=_env_optional_float(
                "PRED_CURVE_ALIGN_STRONG_PP"
            ),
            pred_require_options=_env_truthy("PRED_REQUIRE_OPTIONS", "0"),
            pred_require_price=_env_truthy("PRED_REQUIRE_PRICE", "1"),
            pred_nct_strict=_env_explicit_on("PRED_NCT_STRICT"),
            pred_strict_errors=_env_explicit_on("PRED_STRICT_ERRORS"),
            clinical_pred_overlay=_env_explicit_on("CLINICAL_PRED_OVERLAY"),
            clinical_pred_ct_fetch=_env_explicit_on("CLINICAL_PRED_CT_FETCH"),
            clinical_pred_pubmed_network=_env_explicit_on("CLINICAL_PRED_PUBMED_NETWORK"),
            past_pred_yf_period=_env_raw("PAST_PRED_YF_PERIOD", "10y").lower() or "10y",
            force_past_pred_full_rebuild=_env_explicit_on("FORCE_PAST_PRED_FULL_REBUILD"),
            past_pred_disable_disk=_env_explicit_on("PAST_PRED_DISABLE_DISK"),
            histlib_include_clinical_completions=_env_truthy(
                "HISTLIB_INCLUDE_CLINICAL_COMPLETIONS", "1"
            ),
            histlib_max_extra_clinical_pairs=_env_int(
                "HISTLIB_MAX_EXTRA_CLINICAL_PAIRS", 0, lo=0
            ),
            price_tail_trim_days=_env_int("PRICE_TAIL_TRIM_DAYS", 120, lo=1),
            orch_options_workers_parallel=ows not in _TRUTHY_OFF,
            sec_k8_submissions_sleep_sec=_env_float(
                "SEC_K8_SUBMISSIONS_SLEEP_SEC", 0.15, lo=0.0
            ),
            sec_k8_lookback_days=_env_int("SEC_K8_LOOKBACK_DAYS", 180, lo=30, hi=365),
            pred_k8_display_overlay=_env_truthy("PRED_K8_DISPLAY_OVERLAY", "1"),
            v4_adaptive=_env_explicit_on("V4_ADAPTIVE"),
            v4_adaptive_min_bucket_n=_env_int("V4_ADAPTIVE_MIN_BUCKET_N", 35, lo=15),
            v4_adaptive_bad_accuracy=_env_float("V4_ADAPTIVE_BAD_ACCURACY", 0.42),
            v4_adaptive_max_rules=_env_int("V4_ADAPTIVE_MAX_RULES", 6, lo=1),
            pred_explain_flat_threshold_pp=_env_float(
                "PRED_EXPLAIN_FLAT_THRESHOLD_PP", 1.0
            ),
            pred_explain_n_clusters=_env_int("PRED_EXPLAIN_N_CLUSTERS", 2, lo=2),
            pred_explain_cluster_min_valid_tp=_env_int(
                "PRED_EXPLAIN_CLUSTER_MIN_VALID_TP", 6, lo=1
            ),
            pred_explain_cluster_use_deltas=_env_optional_bool(
                "PRED_EXPLAIN_CLUSTER_USE_DELTAS", True
            ),
            pred_explain_cluster_row_shape=_env_optional_bool(
                "PRED_EXPLAIN_CLUSTER_ROW_SHAPE", False
            ),
            pred_explain_cluster_silhouette_min_n=_env_int(
                "PRED_EXPLAIN_CLUSTER_SILHOUETTE_MIN_N", 8, lo=2
            ),
            pred_explain_cluster_silhouette_k=_env_optional_bool(
                "PRED_EXPLAIN_CLUSTER_SILHOUETTE_K", True
            ),
            pred_cluster_min_obs=_env_int("PRED_CLUSTER_MIN_OBS", 4, lo=2),
            pred_cluster_min_k=_env_int("PRED_CLUSTER_MIN_K", 2, lo=2),
            pred_cluster_min_per_cluster=_env_int(
                "PRED_CLUSTER_MIN_PER_CLUSTER", 2, lo=1
            ),
            pred_cluster_small_n_max_k=_env_int(
                "PRED_CLUSTER_SMALL_N_MAX_K", 2, lo=1, hi=3
            ),
            pred_cluster_canonicalize_supernova=_env_optional_bool(
                "PRED_CLUSTER_CANONICALIZE_SUPERNOVA", False
            ),
            pred_explain_post_cd_split_eps_pp=_env_float(
                "PRED_EXPLAIN_POST_CD_SPLIT_EPS_PP", 0.25
            ),
            pred_explain_show_post_cd_block=_env_optional_bool(
                "PRED_EXPLAIN_SHOW_POST_CD_BLOCK", True
            ),
            pred_explain_post_cd_min_pre=_env_int("PRED_EXPLAIN_POST_CD_MIN_PRE", 2, lo=1),
            pred_explain_post_cd_min_post=_env_int(
                "PRED_EXPLAIN_POST_CD_MIN_POST", 2, lo=1
            ),
            pred_explain_chart_fix_yrange=_env_optional_bool(
                "PRED_EXPLAIN_CHART_FIX_YRANGE", False
            ),
            pred_explain_embed_tre_viste=_env_truthy("PRED_EXPLAIN_EMBED_TRE_VISTE", "1"),
            pred_explain_tre_viste_dpi=_env_int("PRED_EXPLAIN_TRE_VISTE_DPI", 96, lo=72),
            pred_dm_struct_blend=_env_explicit_on("PRED_DM_STRUCT_BLEND"),
            pred_dm_struct_blend_tickers=_env_raw("PRED_DM_STRUCT_BLEND_TICKERS").upper(),
            ipo_snapshot_pred_mode=_env_raw("IPO_SNAPSHOT_PRED_MODE", "show").lower()
            or "show",
            calib_control_clinical_max_rows=calib_clinical_cap,
            pred_engine=_eng,
            pred_curve_fy_liq=_env_explicit_on("PRED_CURVE_FY_LIQ"),
            pred_fundamental_shrink=_env_truthy("PRED_FUNDAMENTAL_SHRINK", "1"),
            pred_fundamental_shrink_precd=_env_truthy(
                "PRED_FUNDAMENTAL_SHRINK_PRECD", "0"
            ),
            pred_v4_curve_scale_precd=_env_float(
                "PRED_V4_CURVE_SCALE_PRECD", 1.05
            ),
            pred_curve_apply_cal_factor=_env_truthy(
                "PRED_CURVE_APPLY_CAL_FACTOR", "1"
            ),
            pred_dir_fund_penalty=_env_truthy("PRED_DIR_FUND_PENALTY", "1"),
            pred_v5_fund_risk=_env_truthy("PRED_V5_FUND_RISK", "1"),
            pred_v5_align_sign_v4=_env_truthy("PRED_V5_ALIGN_SIGN_V4", "1"),
            pred_v5_cohort_prior=_env_truthy("PRED_V5_COHORT_PRIOR", "1"),
            pred_v5_anchor_q50_v4=_env_truthy("PRED_V5_ANCHOR_Q50_V4", "1"),
            pred_v5_calib=_env_truthy("PRED_V5_CALIB", "1"),
            pred_v5_excel_fan=_env_truthy("PRED_V5_EXCEL_FAN", "0"),
            pred_v5_sim_display=_env_raw("PRED_V5_SIM_DISPLAY", "v4").strip().lower()
            or "v4",
            pred_v5_grafici_fan=_env_truthy("PRED_V5_GRAFICI_FAN", "1"),
            pred_v4_curve_scale=_env_float("PRED_V4_CURVE_SCALE", 1.0),
        )

    def pred_curve_k8_seq_merge_enabled(self) -> bool:
        """8-K merge into seq curve; off if ``ORCH_SKIP_SEC_K8`` or seq calib off."""
        if self.orch_skip_sec_k8:
            return False
        return self.pred_curve_seq_calib

    def pred_curve_align_strong_pp(self, epsilon: float | None = None) -> float:
        """Soglia |segnale curva| per mismatch forte (default max(2.0, 3×epsilon))."""
        eps = epsilon if epsilon is not None else self.pred_curve_align_epsilon
        raw = self.pred_curve_align_strong_pp_raw
        if raw is not None:
            return max(eps, raw)
        return max(2.0, 3.0 * eps)

    def as_rows(self) -> list[tuple[str, str, str, str]]:
        """(env_name, value_repr, tipo, descrizione_it) per tabella CLI."""
        rows: list[tuple[str, str, str, str]] = []
        for f in fields(self):
            env = self._ENV_BY_FIELD.get(f.name, "—")
            val = getattr(self, f.name)
            if isinstance(val, bool):
                disp = "1" if val else "0"
                typ = "bool"
            elif isinstance(val, float):
                disp = f"{val:g}"
                typ = "float"
            elif isinstance(val, int):
                disp = str(val)
                typ = "int"
            elif val is None:
                disp = "(auto)"
                typ = "optional"
            else:
                disp = str(val) if val else "(vuoto)"
                typ = "str"
            rows.append((env, disp, typ, self._IT_DESC.get(f.name, f.name)))
        rows.append(("—", str(CALIB_PATH), "path", "Log predizioni pending/complete"))
        rows.append(("—", str(CURVE_SEQ_STATE_PATH), "path", "Stato audit curva sequenziale"))
        rows.append(("—", str(CALIB_STATE_PATH), "path", "Stato calibrazione modello aggregate"))
        return rows


_config: PredictionConfig | None = None


def get_config(*, reload: bool = False) -> PredictionConfig:
    """Process-wide singleton loaded from environment."""
    global _config
    if _config is None or reload:
        _config = PredictionConfig.from_env()
    return _config


def reset_config() -> None:
    """Clear cached config (tests)."""
    global _config
    _config = None


def print_config_table(cfg: PredictionConfig | None = None) -> None:
    """Stampa tabella leggibile su stdout (italiano)."""
    c = cfg or get_config()
    print("Configurazione prediction (env corrente)")
    print("Modulo: prediction.config — carica con PredictionConfig.from_env() / get_config()")
    print()
    hdr = f"{'Variabile':<42} {'Valore':<12} {'Tipo':<8} Descrizione"
    print(hdr)
    print("-" * len(hdr))
    for env, val, typ, desc in c.as_rows():
        print(f"{env:<42} {val:<12} {typ:<8} {desc}")


# ── Thin wrappers (backward compatibility) ───────────────────────────────────

def pred_curve_seq_env_enabled() -> bool:
    return get_config().pred_curve_seq_calib


def pred_curve_k8_seq_merge_enabled() -> bool:
    return get_config().pred_curve_k8_seq_merge_enabled()


def pred_ai_feed_seq_merge_enabled() -> bool:
    return get_config().pred_ai_feed_seq_merge


def pred_eis_poly_enabled() -> bool:
    return get_config().pred_eis_poly_enabled


def posthoc_regression_enabled() -> bool:
    return get_config().pred_posthoc_reg


def posthoc_min_pairs() -> int:
    return get_config().pred_posthoc_min_n


def posthoc_replace_bias() -> bool:
    return get_config().pred_posthoc_replace_bias


def calib_refresh_days() -> int:
    return get_config().calib_refresh_days


def force_calib_refresh() -> bool:
    return get_config().force_calib_refresh


def pred_curve_align_epsilon() -> float:
    return get_config().pred_curve_align_epsilon


def pred_curve_align_mode() -> str:
    return get_config().pred_curve_align_mode


def pred_require_options() -> bool:
    return get_config().pred_require_options


def pred_require_price() -> bool:
    return get_config().pred_require_price


def pred_nct_strict() -> bool:
    return get_config().pred_nct_strict


def pred_strict_errors() -> bool:
    return get_config().pred_strict_errors


def pred_engine() -> str:
    """``v4`` (default) or ``v5`` (MRM+PCG prototype)."""
    return get_config().pred_engine


def pred_curve_fy_liq_enabled() -> bool:
    """Legacy FY liquidity flag (superseded by ``pred_fundamental_shrink_enabled``)."""
    return get_config().pred_curve_fy_liq


def pred_fundamental_shrink_enabled() -> bool:
    """v4 curve magnitude shrink from FY liquidity + market beta."""
    return get_config().pred_fundamental_shrink


def pred_fundamental_shrink_precd_enabled() -> bool:
    """Also shrink pre-CD ``model_dm*`` horizons (default off)."""
    return get_config().pred_fundamental_shrink_precd


def pred_v4_curve_scale_precd() -> float:
    """Multiplier on pre-CD ``model_dm*`` after shrink (default 1.05)."""
    return get_config().pred_v4_curve_scale_precd


def pred_curve_apply_cal_factor_enabled() -> bool:
    """Apply ``cal_factor`` v4 to model/display % curve (not raw seq closes)."""
    return get_config().pred_curve_apply_cal_factor


def pred_dir_fund_penalty_enabled() -> bool:
    """Direction ensemble confidence penalties for illiquid / high-beta names."""
    return get_config().pred_dir_fund_penalty


def pred_v5_fund_risk_enabled() -> bool:
    """v5 MRM sigma and PCG fan width adjustments from fundamentals."""
    return get_config().pred_v5_fund_risk


def pred_v5_fund_sigma_enabled() -> bool:
    """Alias for ``pred_v5_fund_risk_enabled`` (v5 MRM σ from liq/beta)."""
    return pred_v5_fund_risk_enabled()


def pred_v5_align_sign_v4_enabled() -> bool:
    """When True, flip v5 q50 sign to match v4 when magnitudes disagree."""
    return get_config().pred_v5_align_sign_v4


def pred_v5_cohort_prior_enabled() -> bool:
    """Blend PCG toward NCT-restricted cohort median curve."""
    return get_config().pred_v5_cohort_prior


def pred_v5_anchor_q50_v4_enabled() -> bool:
    """Place v5 q50 on v4 horizon %; keep MC half-width for q05/q95."""
    return get_config().pred_v5_anchor_q50_v4


def pred_v5_calib_enabled() -> bool:
    """Retroactive fan width calibration from past_catalyst_predictions."""
    return get_config().pred_v5_calib


def pred_v5_excel_fan_enabled() -> bool:
    """Deprecato: il foglio Accuracy esporta sempre solo q50 (8 colonne), mai q05/q95."""
    return False


def pred_v5_sim_display_mode() -> str:
    """``v4`` (default), ``v5``, or ``blend`` for Simulation / Accuracy display curve."""
    mode = (get_config().pred_v5_sim_display or "v4").strip().lower()
    return mode if mode in ("v4", "v5", "blend") else "v4"


def pred_v5_grafici_fan_enabled() -> bool:
    """Attach pct_v5_lo / pct_v5_hi on Grafici curve nodes."""
    return get_config().pred_v5_grafici_fan


def pred_v4_curve_scale() -> float:
    """Global multiplier on final v4 horizon %% (default 1.0)."""
    return get_config().pred_v4_curve_scale


def sec_k8_lookback_days() -> int:
    """Calendar days [CD−N, CD] for SEC 8-K sheet, seq merge, and display knots."""
    return get_config().sec_k8_lookback_days


def pred_k8_display_overlay_enabled() -> bool:
    """Linear 8-K interpolation on Pred curve when workbook is available."""
    return get_config().pred_k8_display_overlay


def pred_curve_align_strong_pp(epsilon: float | None = None) -> float:
    return get_config().pred_curve_align_strong_pp(epsilon)


def _main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Mostra configurazione prediction da env.")
    p.add_argument(
        "--show",
        action="store_true",
        help="Stampa tabella valori correnti (default se nessun altro argomento).",
    )
    args = p.parse_args(argv)
    if args.show or len(sys.argv) <= 1:
        print_config_table()
        return 0
    p.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())


__all__ = [
    "CALIB_PATH",
    "CALIB_STATE_PATH",
    "CURVE_SEQ_STATE_PATH",
    "PredictionConfig",
    "calib_refresh_days",
    "force_calib_refresh",
    "get_config",
    "posthoc_min_pairs",
    "posthoc_replace_bias",
    "posthoc_regression_enabled",
    "pred_curve_align_epsilon",
    "pred_curve_align_mode",
    "pred_curve_align_strong_pp",
    "pred_curve_k8_seq_merge_enabled",
    "pred_ai_feed_seq_merge_enabled",
    "pred_eis_poly_enabled",
    "pred_curve_seq_env_enabled",
    "pred_curve_fy_liq_enabled",
    "pred_dir_fund_penalty_enabled",
    "pred_engine",
    "pred_fundamental_shrink_enabled",
    "pred_v5_fund_risk_enabled",
    "pred_v5_fund_sigma_enabled",
    "pred_v5_align_sign_v4_enabled",
    "pred_v5_cohort_prior_enabled",
    "pred_v5_anchor_q50_v4_enabled",
    "pred_v5_calib_enabled",
    "pred_v5_excel_fan_enabled",
    "pred_v5_sim_display_mode",
    "pred_v5_grafici_fan_enabled",
    "pred_v4_curve_scale",
    "pred_nct_strict",
    "pred_require_options",
    "pred_require_price",
    "pred_strict_errors",
    "print_config_table",
    "reset_config",
]
