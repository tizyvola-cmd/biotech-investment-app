/**
 * SDS Gain Breakdown — Step 1 of Capital & Diversification.
 *
 * Two views per SDS bucket:
 *   1. PROMISED — for currently open opportunities (simTable rows): aggregate
 *      (planReturnPct × planProbPct / 100) — the expected ROI the model is
 *      promising for that bucket of stocks.
 *   2. DELIVERED — for closed trades: aggregate the realised pnl_pct grouped
 *      by SDS bucket (using frozen features, so retroactive sheet changes
 *      don't leak into history).
 *
 * Avg ROI per day uses `hold_days` (derived from entry_ts/exit_ts) when
 * available, falling back to days_to_cd as a proxy.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { bucketSds, LOSS_THRESHOLD_PCT } from "./lossAuditAnalysis";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import { getFrozenFeatures, freezeFeaturesIfMissing } from "../calibration/featureSnapshotStore";
import {
  clinicalIndicationFromSimRow,
  clinicalPhaseFromSimRow,
} from "./simRowClinicalMeta";
import { resolveExpectedGainPlan } from "./simulationPlanGain";
import { primaryReturnPctFromGainPlan } from "./canonicalRoi";

export type SdsGainRow = {
  bucket: string;
  /** Resolved closed trades in this bucket. */
  deliveredN: number;
  /** Win count (pnl_pct > -LOSS_THRESHOLD). */
  deliveredWins: number;
  /** Win rate from delivered. */
  deliveredWinRate: number;
  /** Average pnl_pct across all closed (positive and negative). */
  deliveredAvgPnlPct: number | null;
  /** Average pnl_pct for winning trades only (> +2%). null if no wins. */
  deliveredAvgWinPct: number | null;
  /** Average pnl_pct for losing trades only (< -2%). null if no losses. */
  deliveredAvgLossPct: number | null;
  /** Average pnl_eur across all closed. */
  deliveredAvgPnlEur: number | null;
  /** Average hold days (entry → exit). null if unknown. */
  deliveredAvgHoldDays: number | null;
  /** Avg ROI per day = avgPnlPct / avgHoldDays (returns null if hold days unknown). */
  deliveredAvgRoiPerDay: number | null;
  /** Open opportunities currently in the bucket (from simTable). */
  promisedOpenN: number;
  /** Average promised ROI %: mean(planReturnPct). */
  promisedAvgRoiPct: number | null;
  /** Average planProbPct (0-100). */
  promisedAvgProbPct: number | null;
  /** Expected ROI = mean(planReturnPct × planProbPct / 100). */
  promisedExpectedRoiPct: number | null;
  /** Average days-to-CD. */
  promisedAvgDaysToCd: number | null;
  /** Expected ROI / day = expectedRoiPct / avgDaysToCd. */
  promisedExpectedRoiPerDay: number | null;
};

export type SdsGainBreakdown = {
  computedAt: string;
  totalClosed: number;
  totalOpen: number;
  rows: SdsGainRow[];
  /** Global delivered avg pnl %. */
  globalDeliveredAvgPnlPct: number | null;
  /** Global promised expected ROI %. */
  globalPromisedExpectedRoiPct: number | null;
};

const SDS_SORT: Record<string, number> = {
  "SDS <40 (Low)": 0,
  "SDS 40-55 (Mid)": 1,
  "SDS 55-70 (High)": 2,
  "SDS ≥70 (Premium)": 3,
  "No SDS": 99,
};

function isResolved(r: SimOutcomeRow): boolean {
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function holdDaysFor(r: SimOutcomeRow): number | null {
  const entry = (r as SimOutcomeRow & { entry_ts?: string | null }).entry_ts;
  const exit = (r as SimOutcomeRow & { exit_ts?: string | null }).exit_ts;
  if (entry && exit) {
    const e = new Date(entry).getTime();
    const x = new Date(exit).getTime();
    if (Number.isFinite(e) && Number.isFinite(x) && x >= e) {
      return Math.max(1, Math.round((x - e) / (1000 * 60 * 60 * 24)));
    }
  }
  // Fallback to days_to_cd as a rough proxy
  if (r.days_to_cd != null && Number.isFinite(r.days_to_cd) && r.days_to_cd > 0) {
    return r.days_to_cd;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function computeSdsGainBreakdown(
  closedRows: SimOutcomeRow[],
  ctx: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
  } = {},
): SdsGainBreakdown {
  // SDS lookup by ticker
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of ctx.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }
  const simRowByKey = ctx.simTable
    ? buildSimRowByKeyMap(ctx.simTable.rows ?? [])
    : new Map<string, Record<string, unknown>>();

  // ── Delivered (closed) per SDS bucket ────────────────────────────────────
  type DAgg = {
    n: number;
    wins: number;
    losses: number;
    sumPnlPct: number;
    sumPnlEur: number;
    sumHoldDays: number;
    holdNonNull: number;
    sumWinPct: number;
    sumLossPct: number;
  };
  const delivered = new Map<string, DAgg>();
  function dAgg(b: string): DAgg {
    let a = delivered.get(b);
    if (!a) {
      a = { n: 0, wins: 0, losses: 0, sumPnlPct: 0, sumPnlEur: 0, sumHoldDays: 0, holdNonNull: 0, sumWinPct: 0, sumLossPct: 0 };
      delivered.set(b, a);
    }
    return a;
  }

  let globalSumPnl = 0;
  let globalN = 0;

  for (const r of closedRows) {
    if (!isResolved(r)) continue;
    const rowKey = normalizedRowKey(r.ticker, r.completion_date);
    const simRow = simRowByKey.get(rowKey);
    const livePhaseRaw = simRow ? clinicalPhaseFromSimRow(simRow) : "";
    const liveIndicationRaw = simRow ? clinicalIndicationFromSimRow(simRow, 200) : "";
    const liveSds = sdsByTicker.get(r.ticker.toUpperCase())?.sds ?? null;
    const pplanPctAtEntry =
      (r as SimOutcomeRow & { entry_affidabilita_pct?: number | null }).entry_affidabilita_pct ??
      r.affidabilita_pct ??
      null;
    let frozen = getFrozenFeatures(rowKey);
    if (!frozen) {
      frozen = freezeFeaturesIfMissing(rowKey, {
        sds: liveSds,
        clinicalPhase: livePhaseRaw || null,
        clinicalIndication: liveIndicationRaw || null,
        pplanPct: pplanPctAtEntry,
      });
    }
    const bucket = bucketSds(frozen.sds);
    const agg = dAgg(bucket);
    agg.n += 1;
    const pnlPct = r.pnl_pct ?? 0;
    if (pnlPct > -LOSS_THRESHOLD_PCT) {
      agg.wins += 1;
      agg.sumWinPct += pnlPct;
    } else if (pnlPct < LOSS_THRESHOLD_PCT) {
      agg.losses += 1;
      agg.sumLossPct += pnlPct;
    }
    agg.sumPnlPct += pnlPct;
    agg.sumPnlEur += r.pnl_eur ?? 0;
    const hd = holdDaysFor(r);
    if (hd != null) {
      agg.sumHoldDays += hd;
      agg.holdNonNull += 1;
    }
    globalSumPnl += r.pnl_pct ?? 0;
    globalN += 1;
  }

  // ── Promised (open) per SDS bucket ───────────────────────────────────────
  type PAgg = {
    n: number;
    sumRoiPct: number;
    sumProbPct: number;
    sumDaysToCd: number;
    daysNonNull: number;
    sumExpected: number;
    expectedNonNull: number;
  };
  const promised = new Map<string, PAgg>();
  function pAgg(b: string): PAgg {
    let a = promised.get(b);
    if (!a) {
      a = {
        n: 0,
        sumRoiPct: 0,
        sumProbPct: 0,
        sumDaysToCd: 0,
        daysNonNull: 0,
        sumExpected: 0,
        expectedNonNull: 0,
      };
      promised.set(b, a);
    }
    return a;
  }

  let globalSumExpected = 0;
  let globalExpectedN = 0;

  for (const row of ctx.simTable?.rows ?? []) {
    const r = row as Record<string, unknown>;
    const ticker = String(r["Ticker"] ?? r["ticker"] ?? "").toUpperCase();
    if (!ticker) continue;
    const liveSds = sdsByTicker.get(ticker)?.sds ?? null;
    const bucket = bucketSds(liveSds);

    // planReturnPct: first try literal row fields (legacy), then resolve via
    // simulationPlanGain so we pick up the target-leg of the gain plan
    // computed from the curve. Without this fallback the promised side stays
    // empty in real data (literal field is not present in the new schema).
    let planReturnPct = num(r["planReturnPct"]) ?? num(r["planCdReturnPct"]) ?? null;
    if (planReturnPct == null) {
      try {
        const plan = resolveExpectedGainPlan(r, 0);
        planReturnPct = primaryReturnPctFromGainPlan(plan);
      } catch {
        planReturnPct = null;
      }
    }
    const probPct = num(r["probPct"]) ?? num(r["Plan_Prob_Pct"]) ?? null;
    const dtc = num(r["Days to CD"]) ?? num(r["Days"]) ?? num(r["days_to_cd"]);

    const agg = pAgg(bucket);
    agg.n += 1;
    if (planReturnPct != null) agg.sumRoiPct += planReturnPct;
    if (probPct != null) agg.sumProbPct += probPct;
    if (dtc != null) {
      agg.sumDaysToCd += dtc;
      agg.daysNonNull += 1;
    }
    if (planReturnPct != null && probPct != null) {
      const expected = (planReturnPct * probPct) / 100;
      agg.sumExpected += expected;
      agg.expectedNonNull += 1;
      globalSumExpected += expected;
      globalExpectedN += 1;
    }
  }

  // ── Merge buckets into rows ─────────────────────────────────────────────
  const allBuckets = new Set<string>([...delivered.keys(), ...promised.keys()]);
  const rows: SdsGainRow[] = [];
  for (const bucket of allBuckets) {
    const d = delivered.get(bucket);
    const p = promised.get(bucket);
    const deliveredAvgPnlPct = d && d.n > 0 ? d.sumPnlPct / d.n : null;
    const deliveredAvgWinPct = d && d.wins > 0 ? d.sumWinPct / d.wins : null;
    const deliveredAvgLossPct = d && d.losses > 0 ? d.sumLossPct / d.losses : null;
    const deliveredAvgHold = d && d.holdNonNull > 0 ? d.sumHoldDays / d.holdNonNull : null;
    const deliveredAvgRoiPerDay =
      deliveredAvgPnlPct != null && deliveredAvgHold != null && deliveredAvgHold > 0
        ? deliveredAvgPnlPct / deliveredAvgHold
        : null;
    const promisedAvgRoiPct = p && p.n > 0 ? p.sumRoiPct / p.n : null;
    const promisedAvgProbPct = p && p.n > 0 ? p.sumProbPct / p.n : null;
    const promisedAvgDaysToCd = p && p.daysNonNull > 0 ? p.sumDaysToCd / p.daysNonNull : null;
    const promisedExpectedRoiPct =
      p && p.expectedNonNull > 0 ? p.sumExpected / p.expectedNonNull : null;
    const promisedExpectedRoiPerDay =
      promisedExpectedRoiPct != null && promisedAvgDaysToCd != null && promisedAvgDaysToCd > 0
        ? promisedExpectedRoiPct / promisedAvgDaysToCd
        : null;

    rows.push({
      bucket,
      deliveredN: d?.n ?? 0,
      deliveredWins: d?.wins ?? 0,
      deliveredWinRate: d && d.n > 0 ? d.wins / d.n : 0,
      deliveredAvgPnlPct,
      deliveredAvgWinPct,
      deliveredAvgLossPct,
      deliveredAvgPnlEur: d && d.n > 0 ? d.sumPnlEur / d.n : null,
      deliveredAvgHoldDays: deliveredAvgHold,
      deliveredAvgRoiPerDay,
      promisedOpenN: p?.n ?? 0,
      promisedAvgRoiPct,
      promisedAvgProbPct,
      promisedExpectedRoiPct,
      promisedAvgDaysToCd,
      promisedExpectedRoiPerDay,
    });
  }
  rows.sort((a, b) => (SDS_SORT[a.bucket] ?? 50) - (SDS_SORT[b.bucket] ?? 50));

  return {
    computedAt: new Date().toISOString(),
    totalClosed: globalN,
    totalOpen: ctx.simTable?.rows?.length ?? 0,
    rows,
    globalDeliveredAvgPnlPct: globalN > 0 ? globalSumPnl / globalN : null,
    globalPromisedExpectedRoiPct:
      globalExpectedN > 0 ? globalSumExpected / globalExpectedN : null,
  };
}
