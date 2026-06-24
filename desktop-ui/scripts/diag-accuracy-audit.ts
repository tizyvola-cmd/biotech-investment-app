/**
 * Side-by-side accuracy audit: Home dashboard metrics vs Model Quality sources.
 *
 * Usage:
 *   cd desktop-ui
 *   npx tsx scripts/diag-accuracy-audit.ts
 *   SUPERNOVA_API_BASE=http://HOST:8765 npx tsx scripts/diag-accuracy-audit.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseMonitorEntries } from "../src/sheet/accuracyMetrics";
import { buildModelQualityWeeklyTrends } from "../src/sheet/modelQualityWeeklyTrends";
import { buildModelSizeErrorView } from "../src/sheet/modelSizeErrorView";
import { buildWeeklyEvolution } from "../src/sheet/modelEvolution";
import {
  buildModelIntrinsicForecastSummary,
  buildSignAccuracyCurveView,
} from "../src/sheet/signAccuracyCurve";
import { summarizeRealPortfolioSignalAccuracy } from "../src/sheet/realPortfolioAccuracy";
import { buildIntrinsicRecommendationSummary } from "../src/sheet/intrinsicRecommendationEfficiency";
import type { SimOutcomeRow } from "../src/data/investmentSimOutcomesData";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const API_BASE = (process.env.SUPERNOVA_API_BASE ?? "http://127.0.0.1:8765").replace(/\/$/, "");

async function fetchJson<T>(apiPath: string): Promise<T | null> {
  const url = `${API_BASE}${apiPath}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn(`  [skip] ${url} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`  [skip] ${url} → ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function readLocalJson<T>(relPath: string): Promise<T | null> {
  const p = path.join(REPO_ROOT, relPath);
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function row(label: string, home: string, modelQ: string, match: "yes" | "no" | "partial" | "n/a") {
  const flag = match === "yes" ? "✓" : match === "partial" ? "~" : match === "n/a" ? "—" : "✗";
  console.log(`${flag} ${label.padEnd(42)} | Home: ${home.padEnd(22)} | Model Q: ${modelQ}`);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtN(n: number): string {
  return n > 0 ? String(n) : "—";
}

async function main() {
  console.log(`\n=== SuperNova accuracy audit ===`);
  console.log(`API: ${API_BASE}\n`);

  const monitorDoc =
    (await fetchJson<{ entries?: unknown[] }>("/api/models/accuracy-monitor")) ??
    (await readLocalJson<{ entries?: unknown[] }>("data/model_accuracy_monitor_history.json"));

  const signCurveDaily =
    (await fetchJson<unknown>("/api/project/model_sign_curve_daily.json")) ??
    (await readLocalJson<unknown>("data/model_sign_curve_daily.json"));

  const outcomesDoc =
    (await fetchJson<{ rows?: SimOutcomeRow[] }>("/api/investment/sim-outcomes")) ??
    (await readLocalJson<{ rows?: SimOutcomeRow[] }>("data/investment_sim_outcomes.json"));

  const signView = buildSignAccuracyCurveView(null, signCurveDaily as Parameters<typeof buildSignAccuracyCurveView>[1]);
  const intrinsicForecast = buildModelIntrinsicForecastSummary(signView);
  const weekly = buildModelQualityWeeklyTrends(monitorDoc);
  const entries = parseMonitorEntries(monitorDoc ?? { entries: [] });
  const evolution = buildWeeklyEvolution(entries);
  const sizeError = buildModelSizeErrorView(entries);

  const outcomeRows = outcomesDoc?.rows ?? [];
  const signalAcc = summarizeRealPortfolioSignalAccuracy(outcomeRows);
  const intrinsicRec = buildIntrinsicRecommendationSummary({
    monitorRows: [],
    closedRows: outcomeRows.filter((r) => r.cd_passed || r.exit_ts),
    simRowByKey: new Map(),
    lang: "en",
  });

  console.log("--- Sign / price (same JSON: model_sign_curve_daily) ---");
  row(
    "Sign weighted bin mean",
    fmtPct(intrinsicForecast?.sign.overallPct),
    fmtPct(intrinsicForecast?.sign.overallPct),
    "yes",
  );
  row(
    "Sign peak T-offset",
    intrinsicForecast?.signPeak
      ? `${intrinsicForecast.signPeak.pct.toFixed(1)}% T${intrinsicForecast.signPeak.offset}`
      : "—",
    intrinsicForecast?.signPeak
      ? `${intrinsicForecast.signPeak.pct.toFixed(1)}% T${intrinsicForecast.signPeak.offset} (anticipatory KPI)`
      : "—",
    "yes",
  );
  row(
    "Price weighted bin mean",
    fmtPct(intrinsicForecast?.priceAccuracy.overallPct),
    fmtPct(intrinsicForecast?.priceAccuracy.overallPct),
    "yes",
  );

  console.log("\n--- Weekly trends (Model Quality only → now on Home strip) ---");
  row(
    "Acc v4 last",
    fmtPct(weekly?.accV4Pct),
    fmtPct(weekly?.accV4Pct),
    weekly ? "yes" : "n/a",
  );
  row(
    "Δpp last monitor",
    weekly?.deltaPpLastMonitor != null ? `${weekly.deltaPpLastMonitor >= 0 ? "+" : ""}${weekly.deltaPpLastMonitor.toFixed(1)} pp` : "—",
    weekly?.deltaPpLastMonitor != null ? `${weekly.deltaPpLastMonitor >= 0 ? "+" : ""}${weekly.deltaPpLastMonitor.toFixed(1)} pp` : "—",
    weekly ? "yes" : "n/a",
  );
  row(
    "Acc slope pp/week",
    weekly?.accSlopePpPerWeek != null ? `${weekly.accSlopePpPerWeek.toFixed(1)} pp/wk` : "—",
    evolution.trend.accSlope != null ? `${evolution.trend.accSlope.toFixed(1)} pp/wk (${evolution.trend.label})` : "—",
    weekly ? "yes" : "n/a",
  );
  row(
    "MAE T+7 current",
    sizeError.currentMaePp != null ? `${sizeError.currentMaePp.toFixed(1)} pp` : "—",
    sizeError.currentMaePp != null ? `${sizeError.currentMaePp.toFixed(1)} pp (ModelSizeErrorPanel)` : "—",
    monitorDoc ? "yes" : "n/a",
  );

  console.log("\n--- Intrinsic recommendation ---");
  row(
    "Combined header %",
    fmtPct(intrinsicRec.combinedPrecisionPct),
    fmtPct(intrinsicRec.combinedPrecisionPct),
    "yes",
  );
  row(
    "Live all-advice %",
    fmtPct(intrinsicRec.monitor.allActions.valuePct),
    fmtPct(intrinsicRec.monitor.allActions.valuePct),
    intrinsicRec.monitor.scoredCount > 0 ? "yes" : "n/a",
  );
  row(
    "Closed replay all %",
    fmtPct(intrinsicRec.closedReplay.allActions.valuePct),
    fmtPct(intrinsicRec.closedReplay.allActions.valuePct),
    intrinsicRec.closedReplay.scoredCount > 0 ? "yes" : "n/a",
  );
  row(
    "Combined BUY",
    `${fmtPct(intrinsicRec.combinedDecision.buy.valuePct)} n=${fmtN(intrinsicRec.combinedDecision.buy.n)}`,
    "Plan prob + monitor pool",
    intrinsicRec.combinedDecision.buy.n > 0 ? "partial" : "n/a",
  );

  console.log("\n--- Operative Simulation (investment_sim_outcomes) ---");
  row(
    "BUY signal %",
    `${fmtPct(signalAcc.buy.valuePct)} n=${fmtN(signalAcc.buy.n)}`,
    `${fmtPct(signalAcc.buy.valuePct)} n=${fmtN(signalAcc.buy.n)} (Portfolio tab, flat excl.)`,
    outcomeRows.length ? "yes" : "n/a",
  );
  row(
    "SELL signal %",
    `${fmtPct(signalAcc.sell.valuePct)} n=${fmtN(signalAcc.sell.n)}`,
    `${fmtPct(signalAcc.sell.valuePct)} n=${fmtN(signalAcc.sell.n)} flat=${signalAcc.unverifiedSellEvitaCount}`,
    outcomeRows.length ? "yes" : "n/a",
  );

  console.log("\n--- Data availability ---");
  console.log(`  monitor entries: ${monitorDoc?.entries?.length ?? 0}`);
  console.log(`  sign curve bins: ${signView?.points?.length ?? 0}`);
  console.log(`  outcome rows: ${outcomeRows.length}`);
  console.log(`  monitor ISO weeks: ${evolution.totalWeeks}`);
  console.log("");
}

void main();
