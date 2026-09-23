/**
 * Offline audit: hot Opportunities list on the Dashboard.
 * Replicates the exact filter chain used by DashboardPulseTable so we can
 * see WHICH candidate tickers are considered and WHY each one passes or
 * fails the `isSignificantMiiRising` gate.
 *
 * Run: npx tsx scripts/diag-hot-opps.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { DEFAULT_MIG_CONFIG } from "../src/sheet/marketInterestGate";
import { filterOffPortfolioHotZoneSimRows } from "../src/sheet/simCdHorizonScope";
import { daysFromToday } from "../src/sheet/simulationPlanGain";
import { migSolidityKey } from "../src/sheet/entrySolidityMig";
import { normalizedRowKey } from "../src/sheet/investSimKeys";
import { loadMigMinSlopeAngleDeg } from "../src/sheet/marketInterestPrefs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  const p = path.join(DATA, file);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function loadSimTable(): SheetTable {
  const snap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  return { sheet: "Simulation", columns: snap.columns ?? [], rows: snap.rows ?? [] };
}

function loadInputs(): InvestSimInputs {
  const raw = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json");
  return raw.inputs ?? {};
}

function loadSdsRows(): SdsRow[] {
  try {
    const snap = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json");
    return snap.rows ?? [];
  } catch {
    return [];
  }
}

function loadCharts(): ChartBundle | null {
  try {
    return readJson<ChartBundle>("simulation_charts_snapshot.json");
  } catch {
    return null;
  }
}

function loadPriorAngles(): Record<string, number> {
  // Dashboard visit snapshot is stored in localStorage on the client. In
  // offline mode we skip the delta-rising check by default.
  try {
    const raw = readJson<{
      tickers?: Record<string, { miiAngle?: number }>;
    }>("dashboard_visit_snapshot.json");
    const out: Record<string, number> = {};
    if (raw.tickers) {
      for (const [k, v] of Object.entries(raw.tickers)) {
        if (v?.miiAngle != null && Number.isFinite(v.miiAngle)) {
          out[k] = v.miiAngle;
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

function main() {
  const simTable = loadSimTable();
  const inputs = loadInputs();
  const sdsRows = loadSdsRows();
  const charts = loadCharts();
  const priorAngles = loadPriorAngles();

  const OPPS_FIRST_VISIT_MIN_SLOPE_DEG = 15; // section-specific floor
  const globalMin = loadMigMinSlopeAngleDeg();
  const minPassDeg = Math.min(globalMin, OPPS_FIRST_VISIT_MIN_SLOPE_DEG);
  const migMap = buildMigSolidityByKey(simTable, charts, sdsRows);

  const hotRows = filterOffPortfolioHotZoneSimRows(simTable.rows, inputs);

  console.log("=== Hot Opportunities audit ===");
  console.log(`  simTable rows        : ${simTable.rows.length}`);
  console.log(`  off-portfolio hot    : ${hotRows.length}`);
  console.log(`  minPassDeg (MII)     : ${minPassDeg}`);
  console.log(`  MII_RISING_DELTA_DEG : ${DEFAULT_MIG_CONFIG.minSignificantDeltaDeg}`);
  console.log(`  prior snapshot keys  : ${Object.keys(priorAngles).length}`);
  console.log();

  const rows = hotRows
    .map((row) => {
      const ticker = String(row.Ticker ?? "").trim().toUpperCase();
      const cd = String(row["Completion Date"] ?? "—");
      const days = daysFromToday(cd);
      const key = normalizedRowKey(ticker, cd);
      const mig = migMap.get(migSolidityKey(ticker, cd));
      const priorAngle = priorAngles[key];
      return { ticker, cd, days, key, mig, priorAngle };
    })
    .sort((a, b) => (b.mig?.slopeAngleDeg ?? -999) - (a.mig?.slopeAngleDeg ?? -999));

  console.log("Ticker    CD          days   slope°    verdict     prior°   Δ°     reasonPass?");
  console.log("--------- ----------- -----  -------   ----------  -------  ----  ---------------");

  let passed = 0;
  for (const r of rows) {
    if (!r.mig) {
      console.log(
        `${r.ticker.padEnd(9)} ${r.cd.padEnd(11)} ${String(r.days ?? "?").padStart(5)}  (no MII snapshot)`,
      );
      continue;
    }
    const slope = r.mig.slopeAngleDeg;
    const verdict = r.mig.verdict;

    let reason = "";
    let pass = false;
    if (slope <= 8) {
      reason = "slope<=8°";
    } else if (r.priorAngle != null && Number.isFinite(r.priorAngle)) {
      const delta = slope - r.priorAngle;
      if (delta >= DEFAULT_MIG_CONFIG.minSignificantDeltaDeg) {
        pass = true;
        reason = `rising +${delta.toFixed(1)}°`;
      } else {
        reason = `Δ ${delta.toFixed(1)}° < ${DEFAULT_MIG_CONFIG.minSignificantDeltaDeg}`;
      }
    } else if (slope >= minPassDeg && verdict !== "BLOCK") {
      pass = true;
      reason = `first-visit slope≥${minPassDeg} & not BLOCK`;
    } else if (verdict === "BLOCK") {
      reason = "verdict=BLOCK";
    } else {
      reason = `slope ${slope.toFixed(1)}° < min ${minPassDeg}°`;
    }

    if (pass) passed += 1;

    const priorStr =
      r.priorAngle != null && Number.isFinite(r.priorAngle) ? r.priorAngle.toFixed(1) : "—";
    const deltaStr =
      r.priorAngle != null && Number.isFinite(r.priorAngle)
        ? (slope - r.priorAngle).toFixed(1)
        : "—";

    console.log(
      `${r.ticker.padEnd(9)} ${r.cd.padEnd(11)} ${String(r.days ?? "?").padStart(5)}  ${slope
        .toFixed(1)
        .padStart(6)}°  ${verdict.padEnd(10)}  ${priorStr.padStart(6)}   ${deltaStr.padStart(4)}   ${pass ? "PASS: " : "SKIP: "}${reason}`,
    );
  }

  console.log();
  console.log(`Would show in table: ${passed} tickers (max 6 shown in UI)`);
}

main();
