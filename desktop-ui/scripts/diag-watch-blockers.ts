/**
 * Diagnose watch Enter blockers on historical gainers (polygon match).
 */
import fs from "node:fs";
import path from "node:path";
import { parseBacktestPolygonMatchDoc } from "../src/sheet/cdPatternPolygonRetro";
import {
  evaluateWatchBacktestPoint,
  type PastCatalystCloseRecord,
} from "../src/sheet/watchZoneEnterBacktest";
import { computeTimingPredictabilityPct } from "../src/sheet/cdHorizons";
import { qualifiesWatchZoneEnter, resolveWatchEntryThresholds } from "../src/sheet/watchZoneEntryPolicy";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function loadRows() {
  const raw = JSON.parse(
    fs.readFileSync(path.join(DATA, "past_catalyst_predictions.json"), "utf8"),
  ) as { rows?: Record<string, PastCatalystCloseRecord> };
  return raw.rows ?? {};
}

const anchor = {
  id: "T-90" as const,
  daysToCd: 90,
  entryKey: "close_m60" as const,
  nextKey: "close_m30" as const,
  cdKey: "close_m7" as const,
};

function main() {
  const map = parseBacktestPolygonMatchDoc(
    JSON.parse(fs.readFileSync(path.join(DATA, "backtest_polygon_match.json"), "utf8")),
  );
  const rows = loadRows();
  const blockers: Record<string, number> = {};
  const timingGaps: number[] = [];
  let gainers = 0;
  let detected = 0;

  for (const rec of Object.values(rows)) {
    const pt = evaluateWatchBacktestPoint(rec, anchor, { polygonMatchMap: map });
    if (!pt || pt.zone !== "watch" || !pt.isGainer) continue;
    gainers += 1;
    if (pt.enterDecision === "hold") {
      detected += 1;
      continue;
    }
    const drift = pt.dailyDriftPct;
    const affid = rec.affidabilita;
    let affN = typeof affid === "number" ? affid : Number(affid);
    if (affN <= 1) affN *= 100;
    const simRow = {
      "Var. Giorn. %": drift ?? 0,
      "R²": affN != null && Number.isFinite(affN) ? Math.min(0.95, affN / 100 + 0.1) : 0.35,
      "Affidabilità %": affN ?? 50,
      "Slope 20g": rec.slope_20d ?? 0.05,
    };
    const th = resolveWatchEntryThresholds(90, {
      targetProvisional: pt.targetProvisional,
      dailyPct24h: drift,
      matchPct: pt.matchPct,
    });
    const r2 = simRow["R²"] as number;
    const timingPred = computeTimingPredictabilityPct(90, r2, r2 * 0.9, null);
    if (th) timingGaps.push(timingPred - th.timingPredMin);
    const q = qualifiesWatchZoneEnter({
      daysToCd: 90,
      probPct: pt.probPct,
      forwardPct: pt.forwardPct,
      dailyPct24h: drift,
      matchPct: pt.matchPct,
      targetProvisional: pt.targetProvisional,
      simRow,
    });
    const reason = q.reason ?? "enter_decision";
    blockers[reason] = (blockers[reason] ?? 0) + 1;
  }

  console.log(`Watch gainers @ T-90: ${gainers}, detected: ${detected}, recall ${((detected / gainers) * 100).toFixed(1)}%`);
  if (timingGaps.length) {
    timingGaps.sort((a, b) => a - b);
    const med = timingGaps[Math.floor(timingGaps.length / 2)]!;
    console.log(`Timing gap (actual - floor) median: ${med.toFixed(1)} pp (negative = blocked)`);
  }
  console.log("\nBlocker breakdown (missed gainers):");
  for (const [k, v] of Object.entries(blockers).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
}

main();
