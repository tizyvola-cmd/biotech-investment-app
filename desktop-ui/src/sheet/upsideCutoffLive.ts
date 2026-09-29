/**
 * Live “upside cutoff” summary for Home: equal-weight $5k what-if,
 * AND SDS×P(plan) sweep on off-book CD-monitor names — updates with the sheet.
 * Growth-streak cutoff: same SDS/P mins + rising ≥2 sessions.
 */
import type { ChartPoint, SheetTable } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import {
  buildSimUniverse24hWhatIf,
  SIM_UNIVERSE_WHATIF_CAPITAL,
  type SimUniverse24hWhatIf,
} from "./simUniverse24hWhatIf";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import { filterOffPortfolioByCdHorizonSimRows } from "./simCdHorizonScope";
import { SOFT_BUY_G1_PPLAN_MIN, SOFT_BUY_G1_SDS_MIN } from "./softSignalGrades";
import {
  SOFT_BUY_RISING_DAYS_MIN,
  countConsecutiveRisingSessionDays,
} from "./softBuyRisingStreak";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { isWarrantTicker } from "./simulationPosition";

export type UpsideCutoffNameScores = {
  key: string;
  sds: number | null;
  pplan: number | null;
};

export type UpsideCutoffRuleResult = {
  rule: string;
  minSds: number;
  minPplan: number;
  n: number;
  nWin: number;
  nLoss: number;
  winEur: number;
  lossEur: number;
  netEur: number;
  coverRatio: number | null;
  /** Selected upside € / universe upside € × 100 */
  capturePct: number | null;
  selectedUpsideEur: number;
  /** Capture if current PF upside + selected off-book upside */
  captureWithPfPct: number | null;
  tickers: string[];
  /** Same order as `tickers` — Simulation row keys for Top KPI deep-link. */
  keys: string[];
};

export type UpsideCutoffLiveSummary = {
  capitalPerTicker: number;
  universeUpsideEur: number;
  pfUpsideEur: number;
  pfCapturePct: number | null;
  pfNetEur: number;
  /** Sweet-spot rule (Soft BUY SDS/P mins) live metrics */
  sweetSpot: UpsideCutoffRuleResult;
  /**
   * Soft BUY SDS/P + rising ≥2 sessions (buy-side growth cutoff).
   * Prefer this for entries; sweetSpot remains the broader SDS/P scan.
   */
  growthStreak: UpsideCutoffRuleResult;
  /** Best AND among shortlist by cover then capture (net>0, n≥2) */
  bestSignificant: UpsideCutoffRuleResult | null;
  whatIf: SimUniverse24hWhatIf;
};

const SDS_CUTS = [20, 25, 30, 35] as const;
const PPLAN_CUTS = [50, 55, 60, 65] as const;
const SIGNIFICANT_COVER = 1.5;

type OffBookRow = {
  key: string;
  ticker: string;
  pnlEur: number;
  sds: number | null;
  pplan: number | null;
  risingDays: number;
};

function coverRatio(winEur: number, lossEur: number): number | null {
  const absLoss = Math.abs(lossEur);
  if (absLoss < 0.5) return winEur > 0 ? Number.POSITIVE_INFINITY : null;
  return Math.round((winEur / absLoss) * 100) / 100;
}

function evalRule(
  offBook: readonly OffBookRow[],
  universeUpside: number,
  pfUpside: number,
  minSds: number,
  minPplan: number,
  opts?: { requireRisingDays?: number; ruleLabel?: string },
): UpsideCutoffRuleResult {
  const needRise = opts?.requireRisingDays ?? 0;
  const selected = offBook.filter(
    (r) =>
      r.sds != null &&
      r.pplan != null &&
      r.sds >= minSds &&
      r.pplan >= minPplan &&
      (needRise <= 0 || r.risingDays >= needRise),
  );
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
  winEur = Math.round(winEur);
  lossEur = Math.round(lossEur);
  selectedUpsideEur = Math.round(selectedUpsideEur);
  const netEur = winEur + lossEur;
  const capturePct =
    universeUpside > 0
      ? Math.round((selectedUpsideEur / universeUpside) * 1000) / 10
      : null;
  const captureWithPfPct =
    universeUpside > 0
      ? Math.round(((pfUpside + selectedUpsideEur) / universeUpside) * 1000) / 10
      : null;
  return {
    rule:
      opts?.ruleLabel ??
      (needRise > 0
        ? `AND SDS≥${minSds} · P≥${minPplan} · ↑≥${needRise}d`
        : `AND SDS≥${minSds} · P≥${minPplan}`),
    minSds,
    minPplan,
    n: selected.length,
    nWin,
    nLoss,
    winEur,
    lossEur,
    netEur,
    coverRatio: coverRatio(winEur, lossEur),
    capturePct,
    selectedUpsideEur,
    captureWithPfPct,
    tickers: selected.map((r) => r.ticker),
    keys: selected.map((r) => r.key),
  };
}

/**
 * @param scoresByKey — SDS / P(plan) for opportunity keys (from loss-analysis / SDS map)
 * @param pointsBySeriesKey — chart prices fallback for rising-streak (≥2 session)
 * @param priorSessionPctByTicker — Yahoo prior-session % (preferred over charts)
 */
export function buildUpsideCutoffLiveSummary(
  simTable: SheetTable | null | undefined,
  inputs: InvestSimInputs,
  scoresByKey: Map<string, UpsideCutoffNameScores> | Record<string, UpsideCutoffNameScores>,
  pointsBySeriesKey?: Map<string, ChartPoint[]> | null,
  priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null,
): UpsideCutoffLiveSummary | null {
  const whatIf = buildSimUniverse24hWhatIf(simTable, inputs, SIM_UNIVERSE_WHATIF_CAPITAL);
  if (!whatIf || !simTable?.rows?.length) return null;

  const scoreMap =
    scoresByKey instanceof Map
      ? scoresByKey
      : new Map(Object.entries(scoresByKey));

  const monitorKeys = new Set(
    filterOffPortfolioByCdHorizonSimRows(simTable.rows, inputs, "all").map((r) =>
      normalizedRowKey(
        String(r.Ticker ?? "").trim().toUpperCase(),
        String(r["Completion Date"] ?? ""),
      ),
    ),
  );

  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const offBook: OffBookRow[] = whatIf.rows
    .filter(
      (r) =>
        !r.inPortfolio &&
        r.pnlEur != null &&
        r.dailyPct24h != null &&
        monitorKeys.has(r.key) &&
        !isWarrantTicker(r.ticker),
    )
    .map((r) => {
      const sc = scoreMap.get(r.key);
      const simRow = rowByKey.get(r.key) ?? null;
      const seriesKey = simRow ? simulationRowSeriesKey(simRow) : null;
      const chartPts =
        seriesKey && pointsBySeriesKey?.size
          ? pointsBySeriesKey.get(seriesKey) ?? null
          : null;
      const tk = r.ticker.trim().toUpperCase();
      const priorPct =
        priorSessionPctByTicker instanceof Map
          ? priorSessionPctByTicker.get(tk)
          : priorSessionPctByTicker?.[tk];
      return {
        key: r.key,
        ticker: r.ticker,
        pnlEur: r.pnlEur!,
        sds: sc?.sds ?? null,
        pplan: sc?.pplan ?? null,
        risingDays: countConsecutiveRisingSessionDays({
          row: simRow,
          chartPoints: chartPts,
          todayPct: r.dailyPct24h,
          priorSessionPcts:
            priorPct != null && Number.isFinite(priorPct) ? [priorPct] : undefined,
        }),
      };
    });

  const universeUpsideEur = whatIf.all.upsideEur;
  const pfUpsideEur = whatIf.portfolio.upsideEur;
  const sweetSpot = evalRule(
    offBook,
    universeUpsideEur,
    pfUpsideEur,
    SOFT_BUY_G1_SDS_MIN,
    SOFT_BUY_G1_PPLAN_MIN,
  );
  const growthStreak = evalRule(
    offBook,
    universeUpsideEur,
    pfUpsideEur,
    SOFT_BUY_G1_SDS_MIN,
    SOFT_BUY_G1_PPLAN_MIN,
    {
      requireRisingDays: SOFT_BUY_RISING_DAYS_MIN,
      ruleLabel: `AND SDS≥${SOFT_BUY_G1_SDS_MIN} · P≥${SOFT_BUY_G1_PPLAN_MIN} · ↑≥${SOFT_BUY_RISING_DAYS_MIN}d`,
    },
  );

  // Sweep only among rising ≥2d names — BUY what-if must not promote red-day books.
  const candidates: UpsideCutoffRuleResult[] = [];
  for (const minSds of SDS_CUTS) {
    for (const minPplan of PPLAN_CUTS) {
      candidates.push(
        evalRule(offBook, universeUpsideEur, pfUpsideEur, minSds, minPplan, {
          requireRisingDays: SOFT_BUY_RISING_DAYS_MIN,
          ruleLabel: `AND SDS≥${minSds} · P≥${minPplan} · ↑≥${SOFT_BUY_RISING_DAYS_MIN}d`,
        }),
      );
    }
  }
  const meaningful = candidates.filter(
    (r) =>
      r.n >= 2 &&
      r.netEur > 0 &&
      r.coverRatio != null &&
      r.coverRatio >= SIGNIFICANT_COVER,
  );
  meaningful.sort((a, b) => {
    const capt = (b.capturePct ?? 0) - (a.capturePct ?? 0);
    if (Math.abs(capt) > 0.5) return capt;
    const cov =
      (b.coverRatio === Number.POSITIVE_INFINITY ? 99 : b.coverRatio ?? 0) -
      (a.coverRatio === Number.POSITIVE_INFINITY ? 99 : a.coverRatio ?? 0);
    if (Math.abs(cov) > 0.05) return cov;
    return b.netEur - a.netEur;
  });

  return {
    capitalPerTicker: SIM_UNIVERSE_WHATIF_CAPITAL,
    universeUpsideEur,
    pfUpsideEur,
    pfCapturePct: whatIf.capturePct,
    pfNetEur: whatIf.portfolio.pnlEur,
    sweetSpot,
    growthStreak,
    bestSignificant: meaningful[0] ?? null,
    whatIf,
  };
}
