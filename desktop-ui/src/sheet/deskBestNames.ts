/**
 * Home desk ranking — days to next known catalyst × silent money.
 * Display only. Does not change deriveSuggestedAction / Soft BUY-SELL.
 *
 * Universe = Simulation. Trends is a lagging column, not the rank key.
 */
import type { GuidanceCalendarEvent, SdsRow } from "../api/supernova";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import type { InvestSimInputs } from "./investSimStorage";
import { dailyChangePctFromRow, isWarrantTicker } from "./simulationPosition";
import { normalizedRowKey } from "./investSimKeys";
import { buildPickSignalsFromSimTable } from "./top2FromSimulation";
import type { Top2PickSignal } from "./top2PortfolioPick";
import {
  buildDeskCatalystLead,
  type DeskCatalystLead,
  type DeskSilentMoney,
} from "./deskCatalystLead";
import type { PrecatEventType } from "./nextCatalystEvent";

export const DESK_BEST_CAP = 10;

export type DeskBestSource = "catalyst_lead";

export type DeskTrendLeader = {
  ticker: string;
  zscore_vs_baseline?: number | null;
  interest_score?: number | null;
  search_spike?: boolean;
  zscore_delta?: number | null;
};

export type DeskBestName = {
  key: string;
  ticker: string;
  cd: string;
  score: number;
  source: DeskBestSource;
  sds: number | null;
  pplan: number | null;
  planReturnPct: number | null;
  daysToCd: number | null;
  dayPct: number | null;
  hasPosition: boolean;
  trendZ: number | null;
  trendSpike: boolean;
  trendDelta: number | null;
  lead: DeskCatalystLead;
  leadDays: number;
  leadEventType: PrecatEventType;
  silent: DeskSilentMoney;
};

export type DeskBestSelectInput = {
  signals: Top2PickSignal[];
  guidanceByTicker?: Map<string, GuidanceCalendarEvent>;
  sdsRows?: SdsRow[] | null;
  trendByTicker?: Record<string, DeskTrendLeader>;
  cap?: number;
  today?: Date;
};

export function pplanPctFromSignal(s: Top2PickSignal): number | null {
  const a = s.affid;
  if (a == null || !Number.isFinite(a)) return null;
  return a <= 1.5 ? a * 100 : a;
}

export function sdsFromSignal(
  s: Top2PickSignal,
  sdsByTicker?: Map<string, number>,
): number | null {
  const fromMap = sdsByTicker?.get(s.ticker.trim().toUpperCase());
  if (fromMap != null && Number.isFinite(fromMap)) return fromMap;
  const raw = s.simRow?.SDS ?? s.simRow?.sds;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function dayPctFromSignal(s: Top2PickSignal): number | null {
  if (s.pnlPct24h != null && Number.isFinite(s.pnlPct24h) && !s.hasPosition) {
    return s.pnlPct24h;
  }
  return s.simRow ? dailyChangePctFromRow(s.simRow) : null;
}

export function sdsMapFromRows(sdsRows: SdsRow[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of sdsRows ?? []) {
    const tk = String(r.ticker ?? "").trim().toUpperCase();
    if (!tk || !Number.isFinite(r.sds)) continue;
    m.set(tk, r.sds);
  }
  return m;
}

export function sdsRowByTicker(sdsRows: SdsRow[] | null | undefined): Map<string, SdsRow> {
  const m = new Map<string, SdsRow>();
  for (const r of sdsRows ?? []) {
    const tk = String(r.ticker ?? "").trim().toUpperCase();
    if (!tk) continue;
    if (!m.has(tk)) m.set(tk, r);
  }
  return m;
}

function toRow(
  s: Top2PickSignal,
  lead: DeskCatalystLead,
  sdsByTicker?: Map<string, number>,
  trend?: DeskTrendLeader,
): DeskBestName {
  const ticker = s.ticker.trim().toUpperCase();
  const cd = s.cd || String(s.simRow?.["Completion Date"] ?? "");
  const z = trend?.zscore_vs_baseline;
  const delta = trend?.zscore_delta;
  return {
    key: normalizedRowKey(ticker, cd),
    ticker,
    cd,
    score: Math.round(lead.leadScore * 10) / 10,
    source: "catalyst_lead",
    sds: sdsFromSignal(s, sdsByTicker),
    pplan: pplanPctFromSignal(s),
    planReturnPct: s.planReturnPct ?? null,
    daysToCd: lead.event.daysUntil,
    dayPct: dayPctFromSignal(s),
    hasPosition: Boolean(s.hasPosition),
    trendZ: z != null && Number.isFinite(z) ? z : null,
    trendSpike: Boolean(trend?.search_spike),
    trendDelta: delta != null && Number.isFinite(delta) ? delta : null,
    lead,
    leadDays: lead.event.daysUntil,
    leadEventType: lead.event.eventType,
    silent: lead.silent,
  };
}

export function selectDeskBestNames(input: DeskBestSelectInput): DeskBestName[] {
  const cap = input.cap ?? DESK_BEST_CAP;
  const sdsByTicker = sdsMapFromRows(input.sdsRows);
  const sdsFull = sdsRowByTicker(input.sdsRows);
  const guidance = input.guidanceByTicker;
  const today = input.today;

  const scored: DeskBestName[] = [];
  const seen = new Set<string>();
  for (const s of input.signals) {
    const ticker = s.ticker.trim().toUpperCase();
    if (!ticker || isWarrantTicker(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    const lead = buildDeskCatalystLead({
      ticker,
      completionDate: s.cd || String(s.simRow?.["Completion Date"] ?? ""),
      daysToCd: s.days,
      guidanceEvent: guidance?.get(ticker) ?? null,
      sdsRow: sdsFull.get(ticker) ?? null,
      today,
    });
    if (!lead) continue;
    scored.push(toRow(s, lead, sdsByTicker, input.trendByTicker?.[ticker]));
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.leadDays - b.leadDays;
  });
  return scored.slice(0, cap);
}

export function selectDeskBestNamesFromSim(opts: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  chartBundle?: ChartBundle | null;
  sdsRows?: SdsRow[] | null;
  guidanceByTicker?: Map<string, GuidanceCalendarEvent>;
  trendByTicker?: Record<string, DeskTrendLeader>;
  today?: Date;
}): DeskBestName[] {
  const points = opts.chartBundle
    ? chartPointsMapFromBundle(opts.chartBundle)
    : undefined;
  const signals = buildPickSignalsFromSimTable(
    opts.simTable,
    opts.inputs,
    points,
  );
  return selectDeskBestNames({
    signals,
    sdsRows: opts.sdsRows,
    guidanceByTicker: opts.guidanceByTicker,
    trendByTicker: opts.trendByTicker,
    today: opts.today,
  });
}
