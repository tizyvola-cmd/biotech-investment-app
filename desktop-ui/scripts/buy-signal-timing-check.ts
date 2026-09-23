/**
 * BUY signal timing baseline + next-week verify.
 *
 * Capture (today, after BUY threshold relax):
 *   npx tsx scripts/buy-signal-timing-check.ts
 *
 * Verify (next week — was the signal too slow?):
 *   npx tsx scripts/buy-signal-timing-check.ts --verify
 *
 * "Too slow" = at signal time Δ24h was already strong (≥ +5%) AND forward
 * return since baseline is ≤ 0 (chased a spike that faded).
 * "Timely"   = forward return since baseline ≥ +3%.
 * "Waiting"  = forward return between 0 and +3% (still open).
 * "Wrong"    = forward return < 0 without having been a chase.
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow, RegulatoryRiskSnapshot } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { deriveSuggestedAction } from "../src/sheet/investDecisionSimLoop";
import {
  buildDecisionScoreInput,
  resolveRegSignedScoreForTicker,
} from "../src/sheet/decisionChartBuild";
import {
  getRecommendation,
  resolveDecisionChartRec,
  explainRecommendation,
} from "../src/sheet/decisionChartLogic";
import { loadMarketContextSnapshot } from "../src/sheet/marketContextScore";
import { buildLossRiskCatalogSync } from "../src/sheet/lossRiskCatalogBuild";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
} from "../src/hooks/useLossRiskCatalog";
import type { SimOutcomeRow } from "../src/data/investmentSimOutcomesData";
import {
  currentPriceFromRow,
  dailyChangePctFromRow,
} from "../src/sheet/simulationPosition";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");
const BASELINE_PATH = path.join(DATA, "buy_signal_timing_baseline.json");

const CHASE_24H_PCT = 5;
const TIMELY_FWD_PCT = 3;

type BaselineBuy = {
  key: string;
  ticker: string;
  cd: string;
  hasPosition: boolean;
  capturedAt: string;
  price: number | null;
  pnlPct24h: number | null;
  pplan: number | null;
  sds: number | null;
  riskV2: number | null;
  regRisk: number | null;
  scoreRec: string;
  op: string;
  finalRec: string;
  ruleHint: string;
};

type BaselineDoc = {
  schema_version: 1;
  label: string;
  captured_at: string;
  thresholds_note: string;
  n_buy: number;
  buys: BaselineBuy[];
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function collectBuys(): Promise<{
  buys: BaselineBuy[];
  rowByKey: Map<string, Record<string, unknown>>;
}> {
  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: simSnap.columns ?? [],
    rows: simSnap.rows ?? [],
  };
  const inputs =
    readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json").rows ?? [];
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);
  const autoRegSnap =
    readJson<RegulatoryRiskSnapshot>("regulatory_risk_snapshot.json") ?? null;
  const closedRows =
    readJson<{ rows?: SimOutcomeRow[] }>("investment_sim_outcomes.json").rows ??
    [];
  const { catalog: lossRiskCatalog, catalogByRowKey } = buildLossRiskCatalogSync({
    simTable,
    inputs,
    chartBundle: charts,
    sdsRows,
    closedRows,
    lang: "it",
  });

  let mcsDoc = null;
  try {
    mcsDoc = await loadMarketContextSnapshot();
  } catch {
    /* optional */
  }

  const rowByKey = new Map<string, Record<string, unknown>>();
  for (const r of simTable.rows) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const cd = String(r["Completion Date"] ?? "").trim();
    const key = `${tk}|${cd}`;
    rowByKey.set(key, r as Record<string, unknown>);
    rowByKey.set(tk, r as Record<string, unknown>);
  }

  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of sdsRows) {
    const t = String(s.ticker ?? "").trim().toUpperCase();
    if (t) sdsByTicker.set(t, s);
  }

  const items = [];
  for (const profile of ["portfolio", "opportunities"] as const) {
    items.push(
      ...buildLossAnalysisItems(
        profile,
        simTable,
        inputs,
        pointsBySeriesKey,
        "it",
        null,
        { sdsRows, migSolidityByKey },
        profile === "opportunities" ? "hot" : undefined,
      ),
    );
  }
  const byKey = new Map<string, (typeof items)[number]>();
  for (const it of items) byKey.set(it.key, it);

  const now = new Date().toISOString();
  const buys: BaselineBuy[] = [];

  for (const item of byKey.values()) {
    const simRow =
      rowByKey.get(item.key) ??
      rowByKey.get(item.ticker.trim().toUpperCase()) ??
      null;
    const sdsRow = sdsByTicker.get(item.ticker.trim().toUpperCase()) ?? null;
    const chartPts = item.seriesKey
      ? pointsBySeriesKey.get(item.seriesKey) ?? null
      : null;
    const regSigned = resolveRegSignedScoreForTicker(
      item.ticker,
      simRow,
      autoRegSnap,
    );
    const lossRisk =
      lookupLossRiskByRowKey(catalogByRowKey, item.key) ??
      lookupLossRisk(lossRiskCatalog, item.ticker);

    const scores = buildDecisionScoreInput({
      item,
      sdsRow,
      lossRisk,
      regSignedScore: regSigned,
      mcsDoc,
      chartPts,
      simRow,
      lang: "it",
    });

    const scoreRec = getRecommendation(scores);
    const op = deriveSuggestedAction(item, false);
    const finalRec = resolveDecisionChartRec(scores, op);
    if (finalRec !== "buy") continue;

    const ex = explainRecommendation(scores, "buy", false);
    const price =
      (simRow ? currentPriceFromRow(simRow) : null) ??
      parseNum(simRow?.["Prezzo Corrente"]) ??
      parseNum(simRow?.["Prezzo Corrente ($)"]);
    const pnlPct24h =
      scores.pnlPct ??
      (simRow ? dailyChangePctFromRow(simRow) : null) ??
      item.pnlPct24h ??
      null;

    buys.push({
      key: item.key,
      ticker: item.ticker.trim().toUpperCase(),
      cd: item.completionDate ?? "",
      hasPosition: item.hasPosition,
      capturedAt: now,
      price: price != null && Number.isFinite(price) ? Math.round(price * 10000) / 10000 : null,
      pnlPct24h:
        pnlPct24h != null && Number.isFinite(pnlPct24h)
          ? Math.round(pnlPct24h * 100) / 100
          : null,
      pplan: scores.pplan,
      sds: scores.sds,
      riskV2: scores.riskV2,
      regRisk: scores.regRisk,
      scoreRec,
      op: String(op),
      finalRec,
      ruleHint: ex.trigger,
    });
  }

  buys.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { buys, rowByKey };
}

function capture() {
  return collectBuys().then(({ buys }) => {
    const doc: BaselineDoc = {
      schema_version: 1,
      label: "BUY cohort after threshold relax (P≥60 / Loss≤40 / Reg-swing≤45 / no HOLD demote)",
      captured_at: new Date().toISOString(),
      thresholds_note:
        "Baseline for next-week timing check. Compare forward % vs price at capture.",
      n_buy: buys.length,
      buys,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2), "utf8");

    console.log("=== BUY SIGNAL TIMING — BASELINE CAPTURED ===");
    console.log(`File: ${BASELINE_PATH}`);
    console.log(`When: ${doc.captured_at}`);
    console.log(`BUY count: ${doc.n_buy}`);
    console.log("");
    for (const b of buys) {
      const chase =
        b.pnlPct24h != null && b.pnlPct24h >= CHASE_24H_PCT ? " ⚠ already +5%@" : "";
      console.log(
        `  ${b.ticker.padEnd(6)} P=${b.pplan ?? "—"} Loss=${b.riskV2 ?? "—"} Reg=${b.regRisk ?? "—"} ` +
          `px=${b.price ?? "—"} Δ24h=${b.pnlPct24h != null ? `${b.pnlPct24h >= 0 ? "+" : ""}${b.pnlPct24h}%` : "—"}${chase}`,
      );
      console.log(`         ${b.ruleHint}`);
    }
    console.log("");
    console.log("Next week run:");
    console.log("  cd desktop-ui");
    console.log("  npx tsx scripts/buy-signal-timing-check.ts --verify");
    console.log("");
    console.log(
      `Legend: ⚠ = at signal Δ24h ≥ +${CHASE_24H_PCT}% (risk of lagging / chase). Verify checks if price kept rising.`,
    );
  });
}

async function verify() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`No baseline at ${BASELINE_PATH}`);
    console.error("Run without --verify first to capture.");
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as BaselineDoc;
  const { rowByKey } = await collectBuys();

  const captured = new Date(baseline.captured_at);
  const daysElapsed = Math.round(
    (Date.now() - captured.getTime()) / (24 * 3600 * 1000),
  );

  type Row = {
    ticker: string;
    basePrice: number | null;
    nowPrice: number | null;
    fwdPct: number | null;
    delta24hAtSignal: number | null;
    verdict: "timely" | "waiting" | "wrong" | "too_slow" | "no_price";
    ruleHint: string;
  };

  const rows: Row[] = [];
  for (const b of baseline.buys) {
    const simRow = rowByKey.get(b.key) ?? rowByKey.get(b.ticker) ?? null;
    const nowPrice =
      (simRow ? currentPriceFromRow(simRow) : null) ??
      parseNum(simRow?.["Prezzo Corrente"]) ??
      parseNum(simRow?.["Prezzo Corrente ($)"]);
    let fwdPct: number | null = null;
    if (b.price != null && b.price > 0 && nowPrice != null && nowPrice > 0) {
      fwdPct = Math.round(((nowPrice / b.price - 1) * 10000)) / 100;
    }

    let verdict: Row["verdict"] = "no_price";
    if (fwdPct != null) {
      const wasChase = b.pnlPct24h != null && b.pnlPct24h >= CHASE_24H_PCT;
      if (wasChase && fwdPct <= 0) verdict = "too_slow";
      else if (fwdPct >= TIMELY_FWD_PCT) verdict = "timely";
      else if (fwdPct < 0) verdict = "wrong";
      else verdict = "waiting";
    }

    rows.push({
      ticker: b.ticker,
      basePrice: b.price,
      nowPrice,
      fwdPct,
      delta24hAtSignal: b.pnlPct24h,
      verdict,
      ruleHint: b.ruleHint,
    });
  }

  const counts = {
    timely: rows.filter((r) => r.verdict === "timely").length,
    waiting: rows.filter((r) => r.verdict === "waiting").length,
    wrong: rows.filter((r) => r.verdict === "wrong").length,
    too_slow: rows.filter((r) => r.verdict === "too_slow").length,
    no_price: rows.filter((r) => r.verdict === "no_price").length,
  };

  console.log("=== BUY SIGNAL TIMING — VERIFY ===");
  console.log(`Baseline: ${baseline.captured_at} (${daysElapsed}d ago)`);
  console.log(`Cohort:   ${baseline.n_buy} BUY`);
  console.log(
    `Result:   timely=${counts.timely}  waiting=${counts.waiting}  wrong=${counts.wrong}  too_slow=${counts.too_slow}  no_price=${counts.no_price}`,
  );
  console.log("");
  console.log(
    "too_slow = signal fired after a ≥+5% day AND price did not rise further (lag).",
  );
  console.log(`timely   = forward ≥ +${TIMELY_FWD_PCT}% since signal.`);
  console.log("");

  for (const r of rows) {
    const fwd =
      r.fwdPct != null ? `${r.fwdPct >= 0 ? "+" : ""}${r.fwdPct.toFixed(1)}%` : "—";
    const tag =
      r.verdict === "too_slow"
        ? "TOO SLOW"
        : r.verdict === "timely"
          ? "TIMELY  "
          : r.verdict === "wrong"
            ? "WRONG   "
            : r.verdict === "waiting"
              ? "waiting "
              : "no px   ";
    console.log(
      `  ${tag}  ${r.ticker.padEnd(6)}  fwd ${fwd.padStart(7)}  ` +
        `px ${r.basePrice ?? "—"} → ${r.nowPrice ?? "—"}  ` +
        `Δ24h@sig ${r.delta24hAtSignal != null ? `${r.delta24hAtSignal >= 0 ? "+" : ""}${r.delta24hAtSignal}%` : "—"}`,
    );
  }

  const outPath = path.join(DATA, "buy_signal_timing_verify_latest.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        baseline_at: baseline.captured_at,
        days_elapsed: daysElapsed,
        counts,
        rows,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log("");
  console.log(`JSON → ${outPath}`);

  if (counts.too_slow > counts.timely && counts.too_slow > 0) {
    console.log("");
    console.log(
      "⚠ Majority lagged — consider requiring Δ24h < +5% for P(plan) BUY, or a cool-down after spikes.",
    );
  } else if (counts.timely >= Math.max(1, Math.floor(baseline.n_buy / 2))) {
    console.log("");
    console.log("✓ Timing looks acceptable on this cohort (many timely forwards).");
  }
}

const verifyMode = process.argv.includes("--verify");
(verifyMode ? verify() : capture()).catch((e) => {
  console.error(e);
  process.exit(1);
});
