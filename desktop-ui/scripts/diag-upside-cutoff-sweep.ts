/**
 * Sweep SDS / P(plan) cutoffs on off-book Simulation names (what-if $5k).
 * Goal: find thresholds where 24h wins significantly outweigh losses
 * (gain cover losses) — to raise upside capture without buying everything.
 *
 *   cd desktop-ui
 *   npx tsx scripts/diag-upside-cutoff-sweep.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import {
  buildSimUniverse24hWhatIf,
  SIM_UNIVERSE_WHATIF_CAPITAL,
} from "../src/sheet/simUniverse24hWhatIf";
import { normalizedRowKey } from "../src/sheet/investSimKeys";
import { parseNum, rowHasActivePortfolio } from "../src/sheet/simulationPosition";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { filterOffPortfolioByCdHorizonSimRows } from "../src/sheet/simCdHorizonScope";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJsonOptional<T>(file: string): T | null {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function readJson<T>(file: string): T {
  const v = readJsonOptional<T>(file);
  if (v == null) throw new Error(`Missing: ${path.join(DATA, file)}`);
  return v;
}

type NameRow = {
  key: string;
  ticker: string;
  inPortfolio: boolean;
  pnlEur: number;
  dailyPct: number;
  sds: number | null;
  pplan: number | null;
  inHotOrWatch: boolean;
};

type SweepResult = {
  rule: string;
  minSds: number | null;
  minPplan: number | null;
  n: number;
  nWin: number;
  nLoss: number;
  winEur: number;
  lossEur: number; // negative or 0
  netEur: number;
  /** winEur / |lossEur|; Infinity if no losses */
  coverRatio: number | null;
  capturePct: number | null;
  /** Selected upside € / universe upside € */
  selectedUpsideEur: number;
};

function coverRatio(winEur: number, lossEur: number): number | null {
  const absLoss = Math.abs(lossEur);
  if (absLoss < 0.5) return winEur > 0 ? Infinity : null;
  return Math.round((winEur / absLoss) * 100) / 100;
}

function evalSelection(
  selected: NameRow[],
  universeUpsideEur: number,
  rule: string,
  minSds: number | null,
  minPplan: number | null,
): SweepResult {
  let winEur = 0;
  let lossEur = 0;
  let nWin = 0;
  let nLoss = 0;
  let selectedUpsideEur = 0;
  for (const r of selected) {
    if (r.pnlEur > 0) {
      winEur += r.pnlEur;
      selectedUpsideEur += r.pnlEur;
      nWin += 1;
    } else if (r.pnlEur < 0) {
      lossEur += r.pnlEur;
      nLoss += 1;
    }
  }
  const netEur = Math.round(winEur + lossEur);
  winEur = Math.round(winEur);
  lossEur = Math.round(lossEur);
  selectedUpsideEur = Math.round(selectedUpsideEur);
  return {
    rule,
    minSds,
    minPplan,
    n: selected.length,
    nWin,
    nLoss,
    winEur,
    lossEur,
    netEur,
    coverRatio: coverRatio(winEur, lossEur),
    capturePct:
      universeUpsideEur > 0
        ? Math.round((selectedUpsideEur / universeUpsideEur) * 1000) / 10
        : null,
    selectedUpsideEur,
  };
}

function passesAnd(
  r: NameRow,
  minSds: number | null,
  minPplan: number | null,
): boolean {
  if (minSds != null && (r.sds == null || r.sds < minSds)) return false;
  if (minPplan != null && (r.pplan == null || r.pplan < minPplan)) return false;
  return true;
}

function passesOr(
  r: NameRow,
  minSds: number | null,
  minPplan: number | null,
): boolean {
  const sdsOk = minSds != null && r.sds != null && r.sds >= minSds;
  const pOk = minPplan != null && r.pplan != null && r.pplan >= minPplan;
  if (minSds != null && minPplan != null) return sdsOk || pOk;
  if (minSds != null) return sdsOk;
  if (minPplan != null) return pOk;
  return true;
}

function printTable(rows: SweepResult[], title: string) {
  console.log(`\n=== ${title} ===`);
  console.log(
    [
      "rule".padEnd(28),
      "n".padStart(3),
      "W/L".padStart(6),
      "win€".padStart(7),
      "loss€".padStart(7),
      "net€".padStart(7),
      "cover".padStart(7),
      "capt%".padStart(6),
    ].join(" "),
  );
  for (const r of rows) {
    const cover =
      r.coverRatio == null
        ? "—"
        : r.coverRatio === Infinity
          ? "∞"
          : r.coverRatio.toFixed(2);
    console.log(
      [
        r.rule.slice(0, 28).padEnd(28),
        String(r.n).padStart(3),
        `${r.nWin}/${r.nLoss}`.padStart(6),
        String(r.winEur).padStart(7),
        String(r.lossEur).padStart(7),
        String(r.netEur).padStart(7),
        cover.padStart(7),
        r.capturePct != null ? r.capturePct.toFixed(0).padStart(6) : "—".padStart(6),
      ].join(" "),
    );
  }
}

async function main() {
  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: simSnap.columns ?? [],
    rows: simSnap.rows ?? [],
  };
  const inputs =
    readJsonOptional<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json")?.inputs ??
    {};
  const sdsRows = readJsonOptional<{ rows?: SdsRow[] }>("sds_snapshot.json")?.rows ?? [];
  const charts =
    readJsonOptional<ChartBundle>("simulation_charts_snapshot.json") ??
    ({ series: {} } as ChartBundle);
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);

  const whatIf = buildSimUniverse24hWhatIf(simTable, inputs, SIM_UNIVERSE_WHATIF_CAPITAL);
  if (!whatIf) {
    console.error("No what-if rows");
    process.exit(1);
  }

  const oppItems = buildLossAnalysisItems(
    "opportunities",
    simTable,
    inputs,
    pointsBySeriesKey,
    "en",
    null,
    { migSolidityByKey, sdsRows },
    "all",
  );
  const byKey = new Map(oppItems.map((it) => [it.key, it]));

  const monitorKeys = new Set(
    filterOffPortfolioByCdHorizonSimRows(simTable.rows, inputs, "all").map((r) =>
      normalizedRowKey(
        String(r.Ticker ?? "").trim().toUpperCase(),
        String(r["Completion Date"] ?? ""),
      ),
    ),
  );

  const names: NameRow[] = [];
  for (const r of whatIf.rows) {
    if (r.pnlEur == null || r.dailyPct24h == null) continue;
    const item = byKey.get(r.key);
    const sds =
      item?.sdsScore ??
      (() => {
        const row = simTable.rows.find(
          (x) =>
            normalizedRowKey(
              String(x.Ticker ?? "").trim().toUpperCase(),
              String(x["Completion Date"] ?? ""),
            ) === r.key,
        );
        return row
          ? parseNum(row["SDS"]) ??
              parseNum(row["sds"]) ??
              parseNum(row["SDS Score"])
          : null;
      })();
    names.push({
      key: r.key,
      ticker: r.ticker,
      inPortfolio: r.inPortfolio,
      pnlEur: r.pnlEur,
      dailyPct: r.dailyPct24h,
      sds: sds != null && Number.isFinite(sds) ? sds : null,
      pplan:
        item?.recoveryProbabilityPct != null &&
        Number.isFinite(item.recoveryProbabilityPct)
          ? item.recoveryProbabilityPct
          : null,
      inHotOrWatch: monitorKeys.has(r.key),
    });
  }

  const offBook = names.filter((n) => !n.inPortfolio && n.inHotOrWatch);
  const universeUpside = whatIf.all.upsideEur;
  const pfUpside = whatIf.portfolio.upsideEur;
  const pfNet = whatIf.portfolio.pnlEur;

  console.log("What-if $5k · session snapshot");
  console.log(
    `Universe upside €${universeUpside} · PF upside €${pfUpside} · capture ${(
      whatIf.capturePct ?? 0
    ).toFixed(1)}% · PF net €${pfNet}`,
  );
  console.log(
    `Off-book in CD monitor with 24h: ${offBook.length} (of ${names.filter((n) => !n.inPortfolio).length} off-book)`,
  );

  const sdsCuts = [null, 20, 25, 30, 35, 40, 45, 50] as const;
  const pplanCuts = [null, 35, 40, 45, 50, 55, 60, 65] as const;

  const andResults: SweepResult[] = [];
  const orResults: SweepResult[] = [];

  for (const minSds of sdsCuts) {
    for (const minPplan of pplanCuts) {
      if (minSds == null && minPplan == null) continue;
      const ruleAnd = `AND sds≥${minSds ?? "·"} p≥${minPplan ?? "·"}`;
      const selAnd = offBook.filter((r) => passesAnd(r, minSds, minPplan));
      andResults.push(
        evalSelection(selAnd, universeUpside, ruleAnd, minSds, minPplan),
      );
      if (minSds != null && minPplan != null) {
        const ruleOr = `OR  sds≥${minSds} p≥${minPplan}`;
        const selOr = offBook.filter((r) => passesOr(r, minSds, minPplan));
        orResults.push(
          evalSelection(selOr, universeUpside, ruleOr, minSds, minPplan),
        );
      }
    }
  }

  // Baseline: take all off-book monitor
  const allOff = evalSelection(
    offBook,
    universeUpside,
    "ALL off-book monitor",
    null,
    null,
  );

  // Significant cover: wins ≥ 1.5× |losses| AND net > 0 AND n ≥ 2
  const SIGNIFICANT = 1.5;
  const meaningful = [...andResults, ...orResults].filter(
    (r) =>
      r.n >= 2 &&
      r.netEur > 0 &&
      r.coverRatio != null &&
      r.coverRatio >= SIGNIFICANT,
  );
  meaningful.sort((a, b) => {
    // Prefer higher capture among significant covers, then higher cover ratio, then net
    const capt = (b.capturePct ?? 0) - (a.capturePct ?? 0);
    if (Math.abs(capt) > 0.5) return capt;
    const cov = (b.coverRatio === Infinity ? 99 : b.coverRatio ?? 0) -
      (a.coverRatio === Infinity ? 99 : a.coverRatio ?? 0);
    if (Math.abs(cov) > 0.05) return cov;
    return b.netEur - a.netEur;
  });

  printTable([allOff], "Baseline (no filter)");
  printTable(
    andResults
      .filter((r) => r.n > 0)
      .sort((a, b) => b.netEur - a.netEur)
      .slice(0, 15),
    "Top AND rules by net € (n>0)",
  );
  printTable(
    orResults
      .filter((r) => r.n > 0)
      .sort((a, b) => b.netEur - a.netEur)
      .slice(0, 12),
    "Top OR rules by net € (n>0)",
  );
  printTable(
    meaningful.slice(0, 12),
    `Significant cover (wins ≥ ${SIGNIFICANT}× |losses|, net>0, n≥2) — ranked by capture`,
  );

  // Recommended: best capture among significant; also best net; also soft raise vs status quo
  const bestCapture = meaningful[0] ?? null;
  const bestNet = [...meaningful].sort((a, b) => b.netEur - a.netEur)[0] ?? null;

  // Soft raise: maximize capture with cover≥1.2 and net≥0
  const soft = [...andResults, ...orResults]
    .filter(
      (r) =>
        r.n >= 2 &&
        r.netEur >= 0 &&
        r.coverRatio != null &&
        r.coverRatio >= 1.2,
    )
    .sort((a, b) => (b.capturePct ?? 0) - (a.capturePct ?? 0));

  console.log("\n=== Recommendations ===");
  if (bestCapture) {
    console.log(
      `Best significant capture: ${bestCapture.rule} → capt ${bestCapture.capturePct}% · cover ${bestCapture.coverRatio}× · net €${bestCapture.netEur} · n=${bestCapture.n}`,
    );
  } else {
    console.log("No AND/OR rule hit wins ≥ 1.5× losses with net>0 on this day.");
  }
  if (bestNet && bestNet !== bestCapture) {
    console.log(
      `Best significant net: ${bestNet.rule} → capt ${bestNet.capturePct}% · cover ${bestNet.coverRatio}× · net €${bestNet.netEur}`,
    );
  }
  if (soft[0]) {
    console.log(
      `Soft raise (cover≥1.2): ${soft[0].rule} → capt ${soft[0].capturePct}% · cover ${soft[0].coverRatio}× · net €${soft[0].netEur}`,
    );
  }

  // Implied total capture if we ADD selected off-book to current PF upside
  if (bestCapture) {
    const newUpside = pfUpside + bestCapture.selectedUpsideEur;
    const newCapt =
      universeUpside > 0
        ? Math.round((newUpside / universeUpside) * 1000) / 10
        : null;
    console.log(
      `If PF kept + rule adds off-book winners: upside capture ${(whatIf.capturePct ?? 0).toFixed(1)}% → ${newCapt}% (PF upside €${pfUpside} + selected €${bestCapture.selectedUpsideEur})`,
    );
    console.log(
      `PF net €${pfNet} + rule net €${bestCapture.netEur} → combined day €${pfNet + bestCapture.netEur}`,
    );
  }

  // Detail names for top recommendation
  const pick = bestCapture ?? soft[0];
  if (pick) {
    const sel =
      pick.rule.startsWith("OR")
        ? offBook.filter((r) => passesOr(r, pick.minSds, pick.minPplan))
        : offBook.filter((r) => passesAnd(r, pick.minSds, pick.minPplan));
    console.log(`\nNames under: ${pick.rule}`);
    for (const r of [...sel].sort((a, b) => b.pnlEur - a.pnlEur)) {
      console.log(
        `  ${r.ticker.padEnd(6)} ${r.pnlEur >= 0 ? "+" : ""}${r.pnlEur.toFixed(0).padStart(5)} €  SDS ${r.sds ?? "—"}  P(plan) ${r.pplan ?? "—"}`,
      );
    }
  }

  const out = {
    asOf: new Date().toISOString(),
    capitalPerTicker: SIM_UNIVERSE_WHATIF_CAPITAL,
    universeUpside,
    pfUpside,
    pfNet,
    capturePct: whatIf.capturePct,
    baselineAllOff: allOff,
    significantCoverMin: SIGNIFICANT,
    meaningful: meaningful.slice(0, 20),
    softRaise: soft.slice(0, 10),
    andResults,
    orResults,
  };
  const outPath = path.join(DATA, "diag_upside_cutoff_sweep.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
