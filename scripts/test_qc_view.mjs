/** Smoke test: build Q&C view from VPS JSON (no React). */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://91.99.15.48:8765/project-data";

const files = [
  "model_sign_curve_daily.json",
  "accuracy_v4_v5_summary.json",
  "model_accuracy_monitor_history.json",
  "model_calibration_state.json",
  "investment_decision_cohort.json",
  "signal_calibration.json",
  "accuracy_directional_calibration.json",
  "evaluation_results.json",
  "sds_snapshot.json",
];

const data = {};
for (const f of files) {
  const res = await fetch(`${base}/${f}`);
  data[f] = res.ok ? await res.json() : null;
  console.log(f, res.status);
}

const sources = {
  monitor: data["model_accuracy_monitor_history.json"],
  calibState: data["model_calibration_state.json"],
  cohort: data["investment_decision_cohort.json"],
  cohortHistory: null,
  signalCalib: data["signal_calibration.json"],
  directional: data["accuracy_directional_calibration.json"],
  cohortAccuracy: null,
  accuracySummary: data["accuracy_v4_v5_summary.json"],
  signCurveDaily: data["model_sign_curve_daily.json"],
};

writeFileSync(join(root, "_qc_sources.json"), JSON.stringify(sources, null, 0));

console.log("ok — saved _qc_sources.json for manual import");
