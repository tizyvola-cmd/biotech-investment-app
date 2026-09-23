import { fetchProjectJson } from "./projectData";
import {
  loadAccuracyMonitorDocument,
  loadDirectionalCalibDoc,
  type AccuracyMonitorDoc,
  type DirectionalCalibDoc,
} from "./accuracyModelData";
import { loadSignalCalibration, type SignalCalibrationDoc } from "./signalCalibrationData";
import {
  loadInvestmentDecisionCohort,
  type DecisionCohortDoc,
} from "./investmentDecisionData";

const CALIB_STATE_FILE = "model_calibration_state.json";
const COHORT_HISTORY_FILE = "investment_decision_cohort_history.json";

export type ModelCalibrationStateDoc = {
  current?: {
    timestamp?: string;
    n_retro_total?: number;
    cal_factor?: Record<string, number | null>;
    population_filter?: string;
    [key: string]: unknown;
  };
  history?: Array<{
    timestamp?: string;
    n_retro_total?: number;
    cal_factor?: Record<string, number | null>;
  }>;
};

export type CohortHistorySnapshot = {
  generated_at?: string;
  env_fingerprint?: string;
  summary?: {
    n_events?: number;
    hit_rate_pct?: number | null;
    ic_spearman?: number | null;
  };
};

export type CohortHistoryDoc = {
  schema_version?: number;
  updated_at?: string;
  snapshots?: CohortHistorySnapshot[];
};

export async function loadModelCalibrationState(): Promise<{
  doc: ModelCalibrationStateDoc | null;
  error?: string;
}> {
  const { data } = await fetchProjectJson<ModelCalibrationStateDoc>(CALIB_STATE_FILE);
  if (data?.current) return { doc: data };
  return { doc: null, error: `File assente (${CALIB_STATE_FILE}). Serve un refresh con ricalibrazione.` };
}

export async function loadCohortHistory(): Promise<{
  doc: CohortHistoryDoc | null;
  error?: string;
}> {
  const { data } = await fetchProjectJson<CohortHistoryDoc>(COHORT_HISTORY_FILE);
  if (data?.snapshots?.length) return { doc: data };
  return { doc: null };
}

export type ModelLearningsRaw = {
  monitor: Awaited<ReturnType<typeof loadAccuracyMonitorDocument>>;
  calibState: Awaited<ReturnType<typeof loadModelCalibrationState>>;
  cohort: Awaited<ReturnType<typeof loadInvestmentDecisionCohort>>;
  cohortHistory: Awaited<ReturnType<typeof loadCohortHistory>>;
  signalCalib: Awaited<ReturnType<typeof loadSignalCalibration>>;
  directional: Awaited<ReturnType<typeof loadDirectionalCalibDoc>>;
};

export type ModelLearningsSources = {
  monitor: AccuracyMonitorDoc | null;
  calibState: ModelCalibrationStateDoc | null;
  cohort: DecisionCohortDoc | null;
  cohortHistory: CohortHistoryDoc | null;
  signalCalib: SignalCalibrationDoc | null;
  directional: DirectionalCalibDoc | null;
};

export async function loadModelLearningsBundle(): Promise<{
  sources: ModelLearningsSources;
  errors: string[];
  monitorSource: string;
}> {
  const [monitor, calibState, cohort, cohortHistory, signalCalib, directional] =
    await Promise.all([
      loadAccuracyMonitorDocument(),
      loadModelCalibrationState(),
      loadInvestmentDecisionCohort(),
      loadCohortHistory(),
      loadSignalCalibration(),
      loadDirectionalCalibDoc(),
    ]);

  const errors = [
    monitor.error,
    calibState.error,
    cohort.error,
    cohortHistory.error,
    signalCalib.error,
    directional.error,
  ].filter((e): e is string => !!e);

  return {
    sources: {
      monitor: monitor.doc,
      calibState: calibState.doc,
      cohort: cohort.doc,
      cohortHistory: cohortHistory.doc,
      signalCalib: signalCalib.doc,
      directional: directional.doc,
    },
    errors,
    monitorSource: monitor.source,
  };
}
