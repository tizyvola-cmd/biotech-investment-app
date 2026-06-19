/**
 * Fase 5 — backtest watch Enter policy on past catalyst cohort.
 * Run: npx tsx scripts/backtest-watch-enter.ts [--sweep]
 */
import fs from "node:fs";
import path from "node:path";
import { parseBacktestPolygonMatchDoc } from "../src/sheet/cdPatternPolygonRetro";
import {
  buildWatchEnterBacktest,
  sweepWatchEnterThresholds,
  type PastCatalystCloseRecord,
} from "../src/sheet/watchZoneEnterBacktest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");
const POLYGON_MATCH_PATH = path.join(DATA, "backtest_polygon_match.json");

function loadPastPredRows(): Record<string, PastCatalystCloseRecord> {
  const raw = JSON.parse(
    fs.readFileSync(path.join(DATA, "past_catalyst_predictions.json"), "utf8"),
  ) as { rows?: Record<string, PastCatalystCloseRecord> };
  const rows = raw.rows ?? {};
  const out: Record<string, PastCatalystCloseRecord> = {};
  for (const [k, rec] of Object.entries(rows)) {
    const tk = String(rec.ticker ?? k.split("|")[0] ?? "").trim();
    out[k] = { ...rec, ticker: tk || rec.ticker };
  }
  return out;
}

function loadPolygonMatchMap() {
  if (!fs.existsSync(POLYGON_MATCH_PATH)) {
    console.warn(
      `\n⚠ Missing ${POLYGON_MATCH_PATH} — run: python scripts/export_backtest_polygon_match.py\n   Falling back to score_v4×0.88 proxy.\n`,
    );
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(POLYGON_MATCH_PATH, "utf8"));
  const map = parseBacktestPolygonMatchDoc(raw);
  const generatedAt =
    raw && typeof raw === "object" && "generated_at" in raw
      ? String((raw as { generated_at?: string }).generated_at ?? "")
      : "";
  console.log(`Polygon match map: ${Object.keys(map).length} keys${generatedAt ? ` (${generatedAt.slice(0, 10)})` : ""}`);
  return map;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function main() {
  const sweep = process.argv.includes("--sweep");
  const rows = loadPastPredRows();
  const polygonMatchMap = loadPolygonMatchMap();
  const summary = buildWatchEnterBacktest(rows, { polygonMatchMap });

  const outPath = path.join(DATA, "backtest_watch_enter.json");
  const payload = {
    ...summary,
    sweep: sweep ? sweepWatchEnterThresholds(rows, undefined, { polygonMatchMap }) : undefined,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log("\n=== FASE 5 — WATCH ENTER BACKTEST ===");
  console.log(`Cohort ${summary.cohortN} past CDs · ${summary.evalPointsN} eval points`);
  console.log(
    `Thresholds P>=${summary.thresholds.pEntryMin} · timingPred>=${summary.thresholds.timingPredMin}`,
  );

  const w = summary.watch;
  const h = summary.hot;
  console.log("\n--- Watch (T-61…T-120 proxy @ m60) ---");
  console.log(
    `Recall ${pct(w.recallPct)} (${w.detectedN}/${w.gainersN}) · Precision ${pct(w.precisionPct)} (${w.enterN - w.falsePositiveN}/${w.enterN}) · FP ${w.falsePositiveN}`,
  );
  console.log(
    `Median ROI all→CD ${pct(w.medianRoiToCdPct)} · Enter→CD ${pct(w.medianRoiEnterToCdPct)}`,
  );

  console.log("\n--- Hot operational (T-14…T-60) ---");
  console.log(
    `Recall ${pct(h.recallPct)} (${h.detectedN}/${h.gainersN}) · Precision ${pct(h.precisionPct)} (${h.enterN - h.falsePositiveN}/${h.enterN})`,
  );
  console.log(`Median ROI Enter→CD ${pct(h.medianRoiEnterToCdPct)}`);

  const a = summary.acceptance;
  console.log("\n--- Acceptance ---");
  console.log(
    `Watch recall >=40%: ${a.watchRecallOk ? "PASS" : "FAIL"} · Watch precision >=55%: ${a.watchPrecisionOk ? "PASS" : "FAIL"} · Hot recall baseline ${pct(a.hotRecallBaseline)}`,
  );

  if (sweep && payload.sweep?.length) {
    console.log("\n--- Top threshold combos (precision) ---");
    for (const row of payload.sweep.slice(0, 8)) {
      console.log(
        `P>=${row.pEntryMin} timing>=${row.timingPredMin} → recall ${pct(row.watchRecallPct)} precision ${pct(row.watchPrecisionPct)} enterN ${row.watchEnterN}`,
      );
    }
  }

  console.log(`\nRecommendation: ${summary.recommendationIt}`);
  console.log(`\nJSON → ${outPath}`);

  console.log("\n--- Sample (gainers + Enter) ---");
  for (const row of summary.sampleRows.slice(0, 12)) {
    console.log(
      `${row.ticker} ${row.anchor} drift ${pct(row.dailyDriftPct)} P ${row.probPct?.toFixed(0) ?? "—"}% fwd ${pct(row.forwardPct)} → ${row.enterDecision} ROI→CD ${pct(row.roiToCdPct)}`,
    );
  }
}

main();
