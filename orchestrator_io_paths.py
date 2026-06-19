"""
Percorsi I/O **centralizzati** per la pipeline e per l’app desktop **SuperNova**.

- Importabile senza pandas / senza caricare ``data_orchestrator`` (file molto grande).
- ``data_orchestrator`` e gli script di refresh/CLI importano da qui ``DATA_DIR``,
  ``FINAL_XLSX``, ``FINAL_JSON``, ``PAST_CATALYST_PREDICTIONS_JSON``, ecc., così
  workbook e JSON restano allineati a SuperNova e alle app Streamlit.
"""
from __future__ import annotations

import os
import sys

_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
FINAL_XLSX = os.path.join(DATA_DIR, "biotech_orchestrated_output.xlsx")
FINAL_JSON = os.path.join(DATA_DIR, "biotech_orchestrated_output.json")
PAST_CATALYST_PREDICTIONS_JSON = os.path.join(DATA_DIR, "past_catalyst_predictions.json")
FALLBACK_XLSX = os.path.join(DATA_DIR, "biotech_orchestrated_output_write_fallback.xlsx")
LAST_ORCH_LOG = os.path.join(DATA_DIR, "last_orchestrator_log.txt")
ORCHESTRATOR_RUN_SUMMARY_JSON = os.path.join(DATA_DIR, "orchestrator_run_summary.json")
FINANCIAL_SHEET_SNAPSHOT_JSON = os.path.join(DATA_DIR, "financial_sheet_snapshot.json")
ACCURACY_SHEET_SNAPSHOT_JSON = os.path.join(DATA_DIR, "accuracy_sheet_snapshot.json")
SIMULATION_SHEET_SNAPSHOT_JSON = os.path.join(DATA_DIR, "simulation_sheet_snapshot.json")
SIMULATION_CHARTS_SNAPSHOT_JSON = os.path.join(DATA_DIR, "simulation_charts_snapshot.json")
SIM_LIVE_PRED_SNAPSHOT_JSON = os.path.join(DATA_DIR, "sim_live_pred_snapshot.json")
ACCURACY_V4_V5_SUMMARY_JSON = os.path.join(DATA_DIR, "accuracy_v4_v5_summary.json")
MODEL_ACCURACY_MONITOR_JSON = os.path.join(DATA_DIR, "model_accuracy_monitor_history.json")
MODEL_COHORT_ACCURACY_JSON = os.path.join(DATA_DIR, "model_cohort_accuracy.json")
MODEL_SIGN_CURVE_DAILY_JSON = os.path.join(DATA_DIR, "model_sign_curve_daily.json")
CLINICAL_XLSX = os.path.join(DATA_DIR, "biotech_clinical_openfda.xlsx")
CLINICAL_CSV = os.path.join(DATA_DIR, "biotech_clinical_openfda.csv")
CLINICAL_SIMULATION_SNAPSHOT_JSON = os.path.join(
    DATA_DIR, "clinical_simulation_snapshot.json"
)
SEC_K8_SIMULATION_SNAPSHOT_JSON = os.path.join(
    DATA_DIR, "sec_k8_simulation_snapshot.json"
)
DESKTOP_DATA_MANIFEST_JSON = os.path.join(DATA_DIR, "desktop_data_manifest.json")
INVESTMENT_DECISION_COHORT_JSON = os.path.join(DATA_DIR, "investment_decision_cohort.json")
INVESTMENT_DECISION_COHORT_HISTORY_JSON = os.path.join(
    DATA_DIR, "investment_decision_cohort_history.json"
)
INVESTMENT_SIM_OUTCOMES_JSON = os.path.join(DATA_DIR, "investment_sim_outcomes.json")
INVESTMENT_TRADE_CALIB_JSON = os.path.join(DATA_DIR, "investment_trade_calib.json")
INVEST_SIM_INPUTS_JSON = os.path.join(DATA_DIR, "invest_sim_inputs.json")
INVEST_SIM_HISTORY_JSON = os.path.join(DATA_DIR, "invest_sim_history.json")
TESTER_FEEDBACK_STORE_JSON = os.path.join(DATA_DIR, "tester_feedback_store.json")
TESTER_FEEDBACK_CALIB_JSON = os.path.join(DATA_DIR, "tester_feedback_calibration.json")
MARKET_CONTEXT_JSON = os.path.join(DATA_DIR, "market_context.json")
CLUSTER_CAL_FACTORS_JSON = os.path.join(DATA_DIR, "cluster_cal_factors.json")
REGIME_MULTIPLIERS_JSON = os.path.join(DATA_DIR, "regime_multipliers.json")
OUTCOMES_WITH_REGIME_JSON = os.path.join(DATA_DIR, "outcomes_with_regime.json")
LEARNING_HISTORY_JSON = os.path.join(DATA_DIR, "learning_history.json")
LEARNING_LOG_JSON = os.path.join(DATA_DIR, "learning_log.json")
TICKER_PERFORMANCE_JSON = os.path.join(DATA_DIR, "ticker_performance.json")
FEEDBACK_SUMMARY_JSON = os.path.join(DATA_DIR, "feedback_summary.json")
FEEDBACK_HISTORY_JSON = os.path.join(DATA_DIR, "feedback_history.json")
PRED_CURVE_SEQ_STATE_JSON = os.path.join(DATA_DIR, "pred_curve_seq_state.json")
SDS_ROI_BACKTEST_SCORES_JSON = os.path.join(DATA_DIR, "sds_roi_backtest_scores.json")
SDS_ROI_FORECAST_LOG_JSON = os.path.join(DATA_DIR, "sds_roi_forecast_log.json")
ORCHESTRATOR_SCRIPT = os.path.join(_PROJECT_ROOT, "data_orchestrator.py")


def _resolve_python_venv_exe() -> str:
    """Windows: ``.venv/Scripts/python.exe`` — Linux/macOS: ``.venv/bin/python``."""
    if sys.platform == "win32":
        return os.path.join(_PROJECT_ROOT, ".venv", "Scripts", "python.exe")
    linux_py = os.path.join(_PROJECT_ROOT, ".venv", "bin", "python")
    if os.path.isfile(linux_py):
        return linux_py
    return sys.executable


PYTHON_VENV_EXE = _resolve_python_venv_exe()
APP_ICON_PNG = os.path.join(_PROJECT_ROOT, "assets", "supernova_app_icon.png")
RETROSPECTIVE_CONFIG_JSON = os.path.join(_PROJECT_ROOT, "retrospective_config.json")

__all__ = (
    "DATA_DIR",
    "FINAL_XLSX",
    "FINAL_JSON",
    "PAST_CATALYST_PREDICTIONS_JSON",
    "FALLBACK_XLSX",
    "LAST_ORCH_LOG",
    "ORCHESTRATOR_RUN_SUMMARY_JSON",
    "FINANCIAL_SHEET_SNAPSHOT_JSON",
    "ACCURACY_SHEET_SNAPSHOT_JSON",
    "SIMULATION_SHEET_SNAPSHOT_JSON",
    "SIMULATION_CHARTS_SNAPSHOT_JSON",
    "ACCURACY_V4_V5_SUMMARY_JSON",
    "MODEL_ACCURACY_MONITOR_JSON",
    "MODEL_COHORT_ACCURACY_JSON",
    "MODEL_SIGN_CURVE_DAILY_JSON",
    "CLINICAL_XLSX",
    "CLINICAL_CSV",
    "CLINICAL_SIMULATION_SNAPSHOT_JSON",
    "SEC_K8_SIMULATION_SNAPSHOT_JSON",
    "DESKTOP_DATA_MANIFEST_JSON",
    "INVESTMENT_DECISION_COHORT_JSON",
    "INVESTMENT_DECISION_COHORT_HISTORY_JSON",
    "INVESTMENT_SIM_OUTCOMES_JSON",
    "INVESTMENT_TRADE_CALIB_JSON",
    "INVEST_SIM_INPUTS_JSON",
    "INVEST_SIM_HISTORY_JSON",
    "TESTER_FEEDBACK_STORE_JSON",
    "TESTER_FEEDBACK_CALIB_JSON",
    "MARKET_CONTEXT_JSON",
    "CLUSTER_CAL_FACTORS_JSON",
    "REGIME_MULTIPLIERS_JSON",
    "OUTCOMES_WITH_REGIME_JSON",
    "LEARNING_HISTORY_JSON",
    "LEARNING_LOG_JSON",
    "TICKER_PERFORMANCE_JSON",
    "FEEDBACK_SUMMARY_JSON",
    "FEEDBACK_HISTORY_JSON",
    "PRED_CURVE_SEQ_STATE_JSON",
    "SDS_ROI_BACKTEST_SCORES_JSON",
    "SDS_ROI_FORECAST_LOG_JSON",
    "ORCHESTRATOR_SCRIPT",
    "PYTHON_VENV_EXE",
    "APP_ICON_PNG",
    "RETROSPECTIVE_CONFIG_JSON",
    "project_root",
)


def project_root() -> str:
    return _PROJECT_ROOT
