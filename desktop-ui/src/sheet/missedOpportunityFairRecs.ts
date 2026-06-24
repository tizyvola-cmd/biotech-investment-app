/**
 * «100% raccomandazioni» più equo: stesso cap posizioni del paper sim (max 8),
 * capitale reale per posizioni aperte, Enter solo su titoli acquistabili oggi.
 */
import type { SheetTable } from "../types";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { DEFAULT_MAX_OPEN_POSITIONS } from "./investDecisionSimExperiment";
import type { PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import { normalizedRowKey } from "./investSimKeys";
import type { InvestSimInputs } from "./investSimStorage";
import { pnlEurFrom24hPct, type MissedOppRow } from "./missedOpportunityAudit";
import { computeSimulationPosition, rowHasActivePortfolio } from "./simulationPosition";

export const FAIR_RECS_MAX_POSITIONS = DEFAULT_MAX_OPEN_POSITIONS;

export type FairRecsSlot = {
  key: string;
  capitalEur: number;
  dailyPct24h: number;
  source: "held" | "paper" | "enter";
};

export type FairRecsBuildOptions = {
  maxOpenPositions?: number;
  defaultCapitalEur?: number;
  /** Skip off-portfolio Enter when Var.24h is negative (titolo già in perdita oggi). */
  skipEnterOnNegative24h?: boolean;
};

function rankSuggestedEnters<
  T extends { probPct?: number | null; planReturnPct?: number | null; ticker: string },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (b.probPct ?? 0) - (a.probPct ?? 0) ||
      (b.planReturnPct ?? 0) - (a.planReturnPct ?? 0) ||
      a.ticker.localeCompare(b.ticker),
  );
}

/** Typical stake from active portfolio rows — fallback €5k. */
export function resolveTypicalCapitalEur(
  simTable: SheetTable,
  inputs: InvestSimInputs,
  fallback = DEFAULT_PLAN_CAPITAL_EUR,
): number {
  let sum = 0;
  let n = 0;
  for (const row of simTable.rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const pos = computeSimulationPosition(row, inputs);
    if (pos?.capital != null && pos.capital > 0) {
      sum += pos.capital;
      n += 1;
    }
  }
  return n > 0 ? Math.round(sum / n) : fallback;
}

function simRowByKeyMap(simTable: SheetTable): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of simTable.rows ?? []) {
    const tk = String(row["Ticker"] ?? "").trim().toUpperCase();
    const cd = String(row["Completion Date"] ?? "").trim();
    if (tk && cd && cd !== "—") map.set(normalizedRowKey(tk, cd), row);
  }
  return map;
}

function isEnterCandidate(row: MissedOppRow, skipEnterOnNegative24h: boolean): boolean {
  if (!row.suggested || row.inPortfolio) return false;
  if (row.exitDecision === "exit") return false;
  if (skipEnterOnNegative24h && row.dailyPct24h < 0) return false;
  return true;
}

/** Posizioni reali + Enter ranked fino al cap — Performance tab. */
export function buildFairRecsSlotsFromMissedOppRows(
  rows: MissedOppRow[],
  simTable: SheetTable,
  inputs: InvestSimInputs,
  opts?: FairRecsBuildOptions,
): FairRecsSlot[] {
  const maxOpen = opts?.maxOpenPositions ?? FAIR_RECS_MAX_POSITIONS;
  const defaultCap =
    opts?.defaultCapitalEur ?? resolveTypicalCapitalEur(simTable, inputs);
  const skipNeg = opts?.skipEnterOnNegative24h ?? true;
  const simRows = simRowByKeyMap(simTable);
  const slots: FairRecsSlot[] = [];
  const keys = new Set<string>();

  for (const row of rows) {
    if (!row.inPortfolio) continue;
    const simRow = simRows.get(row.key);
    if (!simRow || !rowHasActivePortfolio(simRow, inputs)) continue;
    const pos = computeSimulationPosition(simRow, inputs);
    const cap = pos?.capital != null && pos.capital > 0 ? pos.capital : defaultCap;
    slots.push({ key: row.key, capitalEur: cap, dailyPct24h: row.dailyPct24h, source: "held" });
    keys.add(row.key);
  }

  const enters = rankSuggestedEnters(rows.filter((r) => isEnterCandidate(r, skipNeg)));
  for (const row of enters) {
    if (slots.length >= maxOpen) break;
    if (keys.has(row.key)) continue;
    slots.push({
      key: row.key,
      capitalEur: defaultCap,
      dailyPct24h: row.dailyPct24h,
      source: "enter",
    });
    keys.add(row.key);
  }

  return slots;
}

/** Paper sim + Enter ranked — Decision Sim backtest line. */
export function buildFairRecsSlotsFromEvaluations(
  evaluations: TickerSimEvaluation[],
  paperPortfolio: PaperPosition[],
  opts: {
    capitalPerTrade: number;
    maxOpenPositions?: number;
    skipEnterOnNegative24h?: boolean;
  },
): FairRecsSlot[] {
  const maxOpen = opts.maxOpenPositions ?? FAIR_RECS_MAX_POSITIONS;
  const defaultCap = opts.capitalPerTrade;
  const skipNeg = opts.skipEnterOnNegative24h ?? true;
  const slots: FairRecsSlot[] = [];
  const keys = new Set<string>();

  for (const pos of paperPortfolio) {
    const ev = evaluations.find((e) => e.key === pos.key);
    if (!ev || ev.pnlPct24h == null || !Number.isFinite(ev.pnlPct24h)) continue;
    slots.push({
      key: pos.key,
      capitalEur: pos.capital,
      dailyPct24h: ev.pnlPct24h,
      source: "paper",
    });
    keys.add(pos.key);
  }

  const enters = rankSuggestedEnters(
    evaluations.filter((ev) => {
      if (keys.has(ev.key) || ev.hasPosition || ev.suggestedAction !== "buy") return false;
      if (ev.exitDecision === "exit") return false;
      if (skipNeg && ev.pnlPct24h != null && ev.pnlPct24h < 0) return false;
      return ev.pnlPct24h != null && Number.isFinite(ev.pnlPct24h);
    }),
  );

  for (const ev of enters) {
    if (slots.length >= maxOpen) break;
    if (keys.has(ev.key) || ev.pnlPct24h == null) continue;
    slots.push({
      key: ev.key,
      capitalEur: defaultCap,
      dailyPct24h: ev.pnlPct24h,
      source: "enter",
    });
    keys.add(ev.key);
  }

  return slots;
}

export function fairRecsPnlFromSlots(slots: FairRecsSlot[]): number {
  let sum = 0;
  for (const s of slots) {
    if (!Number.isFinite(s.dailyPct24h)) continue;
    sum += pnlEurFrom24hPct(s.capitalEur, s.dailyPct24h);
  }
  return Math.round(sum);
}

export function computeFairRecsDailyPnlFromMissedOppRows(
  rows: MissedOppRow[],
  simTable: SheetTable,
  inputs: InvestSimInputs,
  opts?: FairRecsBuildOptions,
): { pnlFairRecommendationsEur: number; fairRecsPositionN: number } {
  const slots = buildFairRecsSlotsFromMissedOppRows(rows, simTable, inputs, opts);
  return {
    pnlFairRecommendationsEur: fairRecsPnlFromSlots(slots),
    fairRecsPositionN: slots.length,
  };
}

export function computeFairRecs24hFromEvaluations(
  evaluations: TickerSimEvaluation[],
  paperPortfolio: PaperPosition[],
  opts: {
    capitalPerTrade: number;
    maxOpenPositions?: number;
    skipEnterOnNegative24h?: boolean;
  },
): number {
  const slots = buildFairRecsSlotsFromEvaluations(evaluations, paperPortfolio, opts);
  return fairRecsPnlFromSlots(slots);
}
