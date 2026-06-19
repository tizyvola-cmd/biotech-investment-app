import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { buildRascoreObservations, buildRascoreSignalImpactView } from "./rascoreSignalImpactView";
import { observationsToSignals, buildThresholdCurve } from "./rascoreCalibrationCompute";
import { buildRaInversePatternAnalysis, buildRaInverseTickerRows } from "./rascoreInversePattern";
import { SOLIDITY_COMPONENT_MAX } from "./entrySolidityComposite";
import type { InvestSimInputs, InvestSimHistoryPoint } from "./investSimStorage";

const DATA = resolve(process.cwd(), "../data");

function readJson<T>(file: string): T | null {
  const p = join(DATA, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function loadFixture() {
  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const sdsSnap = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json");
  const inputsRaw = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json");
  const historyRaw = readJson<{ history?: InvestSimHistoryPoint[] }>("invest_sim_history.json");
  if (!simSnap?.rows?.length || !charts?.series) return null;
  return {
    simTable: { sheet: "Simulation", columns: simSnap.columns ?? [], rows: simSnap.rows },
    chartBundle: charts,
    sdsRows: sdsSnap?.rows ?? [],
    inputs: inputsRaw?.inputs ?? {},
    history: historyRaw?.history ?? [],
  };
}

describe("RA calib v1 integration (project snapshots)", () => {
  const fx = loadFixture();

  it.skipIf(!fx)("uses recalibrated component max weights summing to 100", () => {
    expect(Object.values(SOLIDITY_COMPONENT_MAX).reduce((a, b) => a + b, 0)).toBe(100);
    expect(SOLIDITY_COMPONENT_MAX.roi_target).toBe(5);
    expect(SOLIDITY_COMPONENT_MAX.align).toBe(17);
  });

  it.skipIf(!fx)("T-60 inverse pattern: RA total separates ↑ vs ↓ better after calib", () => {
    const { simTable, chartBundle, sdsRows, inputs, history } = fx!;
    const inverseRows = buildRaInverseTickerRows({
      simTable,
      chartBundle,
      sdsRows,
      inputs,
      history,
      lang: "it",
      asOfOffset: -60,
    });
    const observations = buildRascoreObservations({
      simTable,
      chartBundle,
      sdsRows,
      inputs,
      history,
      lang: "it",
    });
    const signals = observationsToSignals(
      buildRascoreSignalImpactView(observations).observations,
    );
    const t60 = buildRaInversePatternAnalysis(inverseRows, signals, { offset: -60 });
    expect(t60).not.toBeNull();
    expect(Math.abs(t60!.raDelta ?? 0)).toBeGreaterThan(10);
    expect((t60!.upMeanRa ?? 0) > (t60!.downMeanRa ?? 0)).toBe(true);
  });

  it.skipIf(!fx)("reports threshold curve from recalibrated RA scores", () => {
    const { simTable, chartBundle, sdsRows, inputs, history } = fx!;
    const observations = buildRascoreObservations({
      simTable,
      chartBundle,
      sdsRows,
      inputs,
      history,
      lang: "it",
    });
    const signals = observationsToSignals(
      buildRascoreSignalImpactView(observations).observations,
    );
    const curve = buildThresholdCurve(signals);
    expect(curve.some((p) => p.sampleN > 0)).toBe(true);
  });
});
