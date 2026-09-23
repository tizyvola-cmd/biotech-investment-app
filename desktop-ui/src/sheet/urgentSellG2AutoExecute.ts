/**
 * Auto-execute Urgent SELL G2 — no confirm dialog; ack sold keys for the calendar day.
 */
import type { SheetTable } from "../types";
import type { InvestSimInputs, InvestSimHistoryPoint } from "./investSimStorage";
import { loadInvestSimHistory } from "./investSimStorage";
import { buildDashboardPortfolioChips } from "./simulationPosition";
import { buildSimRowByKeyMap } from "./investSimKeys";
import { buildUrgentSellBookLegs } from "./urgentSellBookLegs";
import {
  evaluateUrgentSellGrade2Book,
  type UrgentSellG2Hit,
} from "./softSignalGrades";

const ACK_STORAGE_KEY = "supernova_g2_auto_sold_v1";

export type G2AutoSoldAck = {
  day: string;
  keys: string[];
};

export type G2AutoSoldNotice = {
  key: string;
  ticker: string;
  dayPnlPct: number | null;
  dayPnlEur: number;
  reason: string;
};

/** In-memory fallback when sessionStorage is missing (tests / SSR). */
let ackMemory: G2AutoSoldAck | null = null;

function calendarDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readAckRaw(): G2AutoSoldAck | null {
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(ACK_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as G2AutoSoldAck;
    } catch {
      /* fall through to memory */
    }
  }
  return ackMemory;
}

function writeAckRaw(next: G2AutoSoldAck): void {
  ackMemory = next;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* memory still holds */
  }
}

export function loadG2AutoSoldAck(now: Date = new Date()): G2AutoSoldAck {
  const day = calendarDayKey(now);
  const parsed = readAckRaw();
  if (!parsed || parsed.day !== day || !Array.isArray(parsed.keys)) {
    return { day, keys: [] };
  }
  return { day, keys: [...new Set(parsed.keys.map(String))] };
}

export function markG2AutoSoldKeys(
  keys: readonly string[],
  now: Date = new Date(),
): G2AutoSoldAck {
  const day = calendarDayKey(now);
  const prev = loadG2AutoSoldAck(now);
  const next: G2AutoSoldAck = {
    day,
    keys: [...new Set([...(prev.day === day ? prev.keys : []), ...keys.map(String)])],
  };
  writeAckRaw(next);
  return next;
}

/** Test helper — clear session + memory ack. */
export function resetG2AutoSoldAckForTests(): void {
  ackMemory = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ACK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Pending G2 hits not yet auto-sold (or acked) today. */
export function pendingUrgentSellG2Hits(opts: {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  ackKeys?: ReadonlySet<string> | readonly string[];
}): UrgentSellG2Hit[] {
  const history = opts.history ?? loadInvestSimHistory();
  const chips = buildDashboardPortfolioChips(opts.simTable, opts.inputs, history);
  if (!chips.length) return [];
  const legs = buildUrgentSellBookLegs(chips, history, {
    simRowByKey: buildSimRowByKeyMap(opts.simTable.rows),
  });
  const book = evaluateUrgentSellGrade2Book(legs);
  const acked = new Set(
    opts.ackKeys
      ? [...opts.ackKeys].map(String)
      : loadG2AutoSoldAck().keys,
  );
  return book.hits.filter((h) => !acked.has(h.key));
}

export function toG2AutoSoldNotice(hit: UrgentSellG2Hit): G2AutoSoldNotice {
  return {
    key: hit.key,
    ticker: hit.ticker,
    dayPnlPct: hit.dayPnlPct,
    dayPnlEur: hit.dayPnlEur,
    reason: hit.reason,
  };
}
