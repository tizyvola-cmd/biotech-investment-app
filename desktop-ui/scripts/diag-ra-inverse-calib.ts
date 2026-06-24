/**
 * Offline RA inverse-pattern + weight proposal from project snapshots.
 * Run: npx tsx scripts/diag-ra-inverse-calib.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import { buildRascoreObservations, buildRascoreSignalImpactView } from "../src/sheet/rascoreSignalImpactView";
import { observationsToSignals, buildThresholdCurve } from "../src/sheet/rascoreCalibrationCompute";
import {
  buildRaInversePatternAnalysis,
  buildRaInversePatternCsv,
  RA_INVERSE_COMPONENT_IDS,
  type RaInversePatternResult,
} from "../src/sheet/rascoreInversePattern";
import { buildRaInverseTickerRows } from "../src/sheet/rascoreInversePattern";
import { SOLIDITY_COMPONENT_MAX, type SolidityCompositeComponentId } from "../src/sheet/entrySolidityComposite";
import type { InvestSimInputs, InvestSimHistoryPoint } from "../src/sheet/investSimStorage";
import { formatPValueWithStars } from "../src/sheet/statSignificance";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function loadSimTable(): SheetTable {
  const snap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>("simulation_sheet_snapshot.json");
  return { sheet: "Simulation", columns: snap.columns ?? [], rows: snap.rows ?? [] };
}

function loadInputs(): InvestSimInputs {
  const raw = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json");
  return raw.inputs ?? {};
}

function loadHistory(): InvestSimHistoryPoint[] {
  try {
    const raw = readJson<{ history?: InvestSimHistoryPoint[] }>("invest_sim_history.json");
    return raw.history ?? [];
  } catch {
    return [];
  }
}

function loadSdsRows(): SdsRow[] {
  const snap = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json");
  return snap.rows ?? [];
}

function loadCharts(): ChartBundle {
  return readJson<ChartBundle>("simulation_charts_snapshot.json");
}

const COMPONENT_LABEL: Record<SolidityCompositeComponentId, string> = {
  reliability: "reliability",
  timing: "timing",
  align: "align",
  roi_target: "roi_target",
  sds: "sds",
  precat: "precat",
  mii: "mii",
  calib: "calib",
};

function printAnalysis(offset: number, result: RaInversePatternResult | null) {
  const label = offset === -60 ? "T-60" : offset === -30 ? "T-30" : String(offset);
  console.log(`\n=== ${label} ===`);
  if (!result) {
    console.log("  (insufficient data)");
    return;
  }
  console.log(
    `  ↑${result.upN} ↓${result.downN} flat ${result.flatN} · RA ${result.upMeanRa} vs ${result.downMeanRa} (Δ ${result.raDelta}) p=${formatPValueWithStars(result.raPValue)}`,
  );
  for (const c of result.components) {
    const sign = (c.deltaPct ?? 0) >= 0 ? "+" : "";
    console.log(
      `  ${COMPONENT_LABEL[c.id].padEnd(12)} ↑${c.upMeanPct ?? "—"}% ↓${c.downMeanPct ?? "—"}% Δ${sign}${c.deltaPct ?? "—"}% p=${formatPValueWithStars(c.pValue)} ${c.stars !== "ns" ? c.stars : ""}`,
    );
  }
}

/** Pro-rata weight shift from T−60 (primary) + T−30 when n adequate. */
function proposeWeights(
  t60: RaInversePatternResult | null,
  _t30: RaInversePatternResult | null,
): Record<SolidityCompositeComponentId, number> {
  // RA calib v1 — implemented in entrySolidityComposite.ts (T−60 driven).
  return { ...SOLIDITY_COMPONENT_MAX };
}

function main() {
  const simTable = loadSimTable();
  const chartBundle = loadCharts();
  const sdsRows = loadSdsRows();
  const inputs = loadInputs();
  const history = loadHistory();

  const inverseRows = buildRaInverseTickerRows({
    simTable,
    chartBundle,
    sdsRows,
    inputs,
    history,
    lang: "it",
  });

  const observations = buildRascoreObservations({
    simTable,
    chartBundle,
    sdsRows,
    inputs,
    history,
    lang: "it",
  });
  const view = buildRascoreSignalImpactView(observations);
  const signals = observationsToSignals(view.observations);

  console.log(`Cohort: ${inverseRows.length} RA rows · ${signals.length} calibration signals`);
  console.log(`RA range: ${view.cohort?.scoreMin ?? "—"} – ${view.cohort?.scoreMax ?? "—"}`);

  const t60 = buildRaInversePatternAnalysis(inverseRows, signals, { offset: -60 });
  const t30 = buildRaInversePatternAnalysis(inverseRows, signals, { offset: -30 });
  printAnalysis(-60, t60);
  const t60AsOf = buildRaInversePatternAnalysis(
    buildRaInverseTickerRows({
      simTable,
      chartBundle,
      sdsRows,
      inputs,
      history,
      lang: "it",
      asOfOffset: -60,
    }),
    signals,
    { offset: -60 },
  );
  if (t60AsOf) {
    console.log(
      `\n  [v2 as-of T-60] RA Δ ↑−↓ = ${t60AsOf.raDelta ?? "—"} (legacy today-RA Δ ${t60?.raDelta ?? "—"})`,
    );
  }
  printAnalysis(-30, t30);

  const proposed = proposeWeights(t60, t30);
  const baselineMax = {
    reliability: 25,
    timing: 18,
    align: 13,
    roi_target: 13,
    sds: 9,
    precat: 8,
    mii: 8,
    calib: 6,
  } satisfies Record<SolidityCompositeComponentId, number>;

  console.log("\n=== RA CALIB v1 weights (T−60 driven) ===");
  for (const id of RA_INVERSE_COMPONENT_IDS) {
    const cur = baselineMax[id];
    const next = proposed[id];
    const d = next - cur;
    console.log(
      `  ${id.padEnd(12)} ${String(cur).padStart(2)} → ${String(next).padStart(2)} (${d >= 0 ? "+" : ""}${d})`,
    );
  }

  if (t60) {
    const outPath = path.join(DATA, "ra_inverse_T-60_export.csv");
    fs.writeFileSync(outPath, buildRaInversePatternCsv(t60), "utf8");
    console.log(`\nWrote ${outPath}`);
  }

  const threshold = buildThresholdCurve(signals);
  const best = threshold.find((p) => p.successRate != null && p.successRate >= 55);
  console.log(`\nThreshold (current RA): first ≥55% at RA≥${best?.threshold ?? "none"} (n=${best?.sampleN ?? 0})`);
}

main();
