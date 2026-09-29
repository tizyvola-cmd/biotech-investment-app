/**
 * Decision-desk leading field — days to next known catalyst × silent money.
 * Display ranking only. Does not change deriveSuggestedAction / Soft BUY-SELL.
 *
 * v1 uses what SuperNova already has: Simulation CD + guidance calendar
 * (PDUFA / readout) + SDS Cluster B/D (13F delta, short squeeze, runway).
 * Form 4, 13D, molecule Trends, congress abstracts are not in this slice.
 */
import type { GuidanceCalendarEvent, SdsRow } from "../api/supernova";
import {
  resolveNextCatalystEvent,
  type NextCatalystEvent,
  type PrecatEventType,
} from "./nextCatalystEvent";

/** Peak lead window: 2–8 weeks before a dated event (before public hype). */
export const DESK_LEAD_MIN_DAYS = 0;
export const DESK_LEAD_MAX_DAYS = 180;

export type DeskSilentMoney = {
  instAccum: boolean;
  premiumFund: boolean;
  instDeltaPct: number | null;
  squeeze: boolean;
  runwayMonths: number | null;
  runwayTight: boolean;
};

export type DeskCatalystLead = {
  event: NextCatalystEvent;
  silent: DeskSilentMoney;
  calendarScore: number;
  silentScore: number;
  leadScore: number;
};

export function silentMoneyFromSds(row: SdsRow | null | undefined): DeskSilentMoney {
  const inst = row?.cluster_b?.institutional_delta;
  const short = row?.cluster_b?.short_interest;
  const runway =
    row?.cluster_d?.cash_runway?.runway_months ??
    row?.cause_attribution?.cash_runway_risk?.cash_runway_months ??
    null;
  const delta = inst?.delta_pct;
  const instScore = inst?.score;
  const instAccum =
    (delta != null && Number.isFinite(delta) && delta > 0) ||
    (instScore != null && Number.isFinite(instScore) && instScore > 0);
  const premiumFund = inst?.premium_fund_present === true;
  const squeeze =
    short?.squeeze_setup === true ||
    (short?.days_to_cover != null &&
      Number.isFinite(short.days_to_cover) &&
      short.days_to_cover >= 5 &&
      (short.score ?? 0) > 0);
  const runwayMonths =
    runway != null && Number.isFinite(runway) ? runway : null;
  return {
    instAccum,
    premiumFund,
    instDeltaPct: delta != null && Number.isFinite(delta) ? delta : null,
    squeeze,
    runwayMonths,
    runwayTight: false,
  };
}

export function calendarHorizonScore(ev: NextCatalystEvent): number {
  const days = ev.daysUntil;
  if (days < DESK_LEAD_MIN_DAYS || days > DESK_LEAD_MAX_DAYS) return -50;
  let horizon = 0;
  if (days <= 7) horizon = 38;
  else if (days <= 21) horizon = 72;
  else if (days <= 56) horizon = 88;
  else if (days <= 90) horizon = 58;
  else horizon = 28;

  let dated = 0;
  if (ev.eventType === "pdufa" || ev.eventType === "approval") dated = 22;
  else if (ev.eventType === "readout" || ev.eventType === "conference_abstract") dated = 14;
  else if (ev.eventType === "submission") dated = 8;
  if (ev.dateType === "actual") dated += 8;
  return horizon + dated;
}

export function silentMoneyScore(silent: DeskSilentMoney, daysUntil: number): number {
  let s = 0;
  if (silent.instAccum) s += 16;
  if (silent.premiumFund) s += 6;
  if (silent.squeeze) s += 12;
  const tight = silent.runwayMonths != null && silent.runwayMonths < 6 && daysUntil <= 90;
  if (tight) s += 8;
  return s;
}

export function buildDeskCatalystLead(args: {
  ticker: string;
  completionDate?: string | null;
  daysToCd?: number | null;
  guidanceEvent?: GuidanceCalendarEvent | null;
  sdsRow?: SdsRow | null;
  today?: Date;
}): DeskCatalystLead | null {
  const event = resolveNextCatalystEvent({
    ticker: args.ticker,
    completionDate: args.completionDate,
    daysToCd: args.daysToCd,
    guidanceEvent: args.guidanceEvent,
    today: args.today,
  });
  if (!event) return null;
  if (event.daysUntil < DESK_LEAD_MIN_DAYS || event.daysUntil > DESK_LEAD_MAX_DAYS) {
    return null;
  }
  const silent = silentMoneyFromSds(args.sdsRow);
  silent.runwayTight =
    silent.runwayMonths != null &&
    silent.runwayMonths < 6 &&
    event.daysUntil <= 90;
  const calendarScore = calendarHorizonScore(event);
  const silentPts = silentMoneyScore(silent, event.daysUntil);
  return {
    event,
    silent,
    calendarScore,
    silentScore: silentPts,
    leadScore: calendarScore + silentPts,
  };
}

export function leadEventShortLabel(type: PrecatEventType, it: boolean): string {
  const map: Record<PrecatEventType, { en: string; it: string }> = {
    trial_primary_completion: { en: "CD", it: "CD" },
    trial_study_completion: { en: "CD", it: "CD" },
    pdufa: { en: "PDUFA", it: "PDUFA" },
    readout: { en: "Readout", it: "Readout" },
    submission: { en: "Submission", it: "Submission" },
    approval: { en: "Approval", it: "Approvazione" },
    conference_abstract: { en: "Abstract", it: "Abstract" },
    cd: { en: "CD", it: "CD" },
    partnership: { en: "Partnership", it: "Partnership" },
    other: { en: "Event", it: "Evento" },
  };
  return map[type][it ? "it" : "en"];
}

export function formatDeskLeadWhy(lead: DeskCatalystLead, it: boolean): string {
  const kind = leadEventShortLabel(lead.event.eventType, it);
  const days = lead.event.daysUntil;
  const when =
    days === 0
      ? it
        ? "oggi"
        : "today"
      : days >= 14 && days % 7 === 0
        ? it
          ? `${days / 7}sett`
          : `${days / 7}w`
        : it
          ? `${days}g`
          : `${days}d`;
  return `${kind} ${when}`;
}
