import type { ClinicalPreCdRecord } from "./api";
import { buildTickerEisDetail, type TickerEisEventDetail } from "./eis/tickerEisSummary";
import {
  classifyTickerEisEvent,
  type ImpactEventKind,
} from "./eis/tickerImpactEvents";
import { computeSimulationPosition, rowHasActivePortfolio } from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";

const MS_DAY = 24 * 60 * 60 * 1000;

export type PortfolioImpactEventRow = {
  key: string;
  ticker: string;
  kind: ImpactEventKind;
  event: TickerEisEventDetail;
};

export type PortfolioImpactWindow = {
  eis: PortfolioImpactEventRow[];
  regulatory: PortfolioImpactEventRow[];
};

export type PortfolioImpactNews = {
  h24: PortfolioImpactWindow;
  d7: PortfolioImpactWindow;
  portfolioCount: number;
};

function eventKey(ev: TickerEisEventDetail): string {
  return `${ev.eventDate ?? ""}|${ev.title}`;
}

function collectPortfolioEvents(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  clinicalRecords: ClinicalPreCdRecord[],
  lang: "it" | "en",
): PortfolioImpactEventRow[] {
  const out: PortfolioImpactEventRow[] = [];
  const seen = new Set<string>();

  for (const row of sheet?.rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const pos = computeSimulationPosition(row, inputs);
    if (!pos || pos.capital <= 0) continue;

    const detail = buildTickerEisDetail(pos.ticker, clinicalRecords, lang);
    for (const ev of detail.events) {
      const dedupe = `${pos.key}|${eventKey(ev)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        key: pos.key,
        ticker: pos.ticker,
        kind: classifyTickerEisEvent(ev),
        event: ev,
      });
    }
  }

  return out;
}

function sliceWindow(
  rows: PortfolioImpactEventRow[],
  days: 1 | 7,
  maxPerLane: number,
  nowMs = Date.now(),
): PortfolioImpactWindow {
  const cutoff = nowMs - days * MS_DAY;
  const inWindow = rows
    .filter((r) => {
      const d = r.event.eventDate;
      if (!d) return false;
      const ms = Date.parse(`${d}T12:00:00`);
      return Number.isFinite(ms) && ms >= cutoff;
    })
    .sort((a, b) => {
      const da = Date.parse(`${a.event.eventDate}T12:00:00`);
      const db = Date.parse(`${b.event.eventDate}T12:00:00`);
      if (db !== da) return db - da;
      return Math.abs(b.event.breakdown.score) - Math.abs(a.event.breakdown.score);
    });

  const eis = inWindow.filter((r) => r.kind === "clinical").slice(0, maxPerLane);
  const regulatory = inWindow.filter((r) => r.kind === "regulatory").slice(0, maxPerLane);
  return { eis, regulatory };
}

export function buildPortfolioImpactNews(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  clinicalRecords: ClinicalPreCdRecord[],
  lang: "it" | "en" = "it",
  maxPerLane = 6,
): PortfolioImpactNews {
  const rows = collectPortfolioEvents(sheet, inputs, clinicalRecords, lang);
  let portfolioCount = 0;
  for (const row of sheet?.rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const pos = computeSimulationPosition(row, inputs);
    if (pos && pos.capital > 0) portfolioCount += 1;
  }

  return {
    h24: sliceWindow(rows, 1, maxPerLane),
    d7: sliceWindow(rows, 7, maxPerLane),
    portfolioCount,
  };
}
