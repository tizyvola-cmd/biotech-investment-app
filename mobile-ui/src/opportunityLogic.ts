import {
  normalizedRowKey,
  parseNum,
  pred5FromRow,
  rowHasActivePortfolio,
} from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";

export type OppZone = "hot" | "watch";

export type MobileOpportunity = {
  key: string;
  ticker: string;
  name: string;
  completionDate: string;
  daysToCd: number | null;
  pred5: number | null;
  planReturnPct: number | null;
  affidPct: number | null;
  roiPerDay: number | null;
  zone: OppZone;
};

const HOT_MAX_DAYS = 60;
const WATCH_MAX_DAYS = 120;
const MIN_PRED5 = 0.8;
const MIN_AFFID = 35;

function parseDMY(s: string): Date | null {
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysFromCompletionDate(cd: string): number | null {
  if (!cd || cd === "—" || cd === "-") return null;
  const d = parseDMY(cd.trim());
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

function planReturnFromRow(r: Record<string, unknown>): number | null {
  const cols = Object.keys(r);
  for (const kw of ["roi target", "target roi", "gain target", "roi plan", "roi→cd"]) {
    const col = findCol(cols, kw);
    if (!col) continue;
    const v = parseNum(r[col]);
    if (v != null) return Math.abs(v) <= 1.5 ? v * 100 : v;
  }
  const slope =
    parseNum(r["Slope 20d (%)"]) ??
    parseNum(r["Pendenza 20g (%)"]) ??
    parseNum(r["Slope 20d"]);
  if (slope != null && slope > 0) return slope;
  return null;
}

function affidFromRow(r: Record<string, unknown>): number | null {
  const col = findCol(Object.keys(r), "Affidabilit");
  if (!col) return null;
  let v = parseNum(r[col]);
  if (v == null) return null;
  if (v <= 1.5) v *= 100;
  return v;
}

function roiPerDay(ret: number | null, days: number | null): number | null {
  if (ret == null || days == null || days <= 0) return null;
  return ret / days;
}

function zoneForDays(days: number | null): OppZone | null {
  if (days == null || days < -3) return null;
  if (days <= HOT_MAX_DAYS) return "hot";
  if (days <= WATCH_MAX_DAYS) return "watch";
  return null;
}

function passesFilter(
  r: Record<string, unknown>,
  inputs: InvestSimInputs,
  days: number | null,
  pred5: number | null,
  planReturn: number | null,
  affid: number | null,
): boolean {
  if (rowHasActivePortfolio(r, inputs)) return false;
  if (zoneForDays(days) == null) return false;
  const predOk = pred5 != null && pred5 >= MIN_PRED5;
  const planOk = planReturn != null && planReturn > 0;
  if (!predOk && !planOk) return false;
  if (affid != null && affid < MIN_AFFID) return false;
  const precat = String(r["Precat"] ?? r["Pre-Cat"] ?? "").toLowerCase();
  if (precat.includes("avoid") || precat.includes("sell")) return false;
  return true;
}

function sortOpps(a: MobileOpportunity, b: MobileOpportunity): number {
  const rda = a.roiPerDay ?? -1;
  const rdb = b.roiPerDay ?? -1;
  if (Math.abs(rda - rdb) > 0.0001) return rdb - rda;
  return (b.pred5 ?? 0) - (a.pred5 ?? 0);
}

export function buildMobileOpportunities(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
): { hot: MobileOpportunity[]; watch: MobileOpportunity[]; all: MobileOpportunity[] } {
  const hot: MobileOpportunity[] = [];
  const watch: MobileOpportunity[] = [];

  for (const r of sheet?.rows ?? []) {
    const ticker = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;

    const cd = String(r["Completion Date"] ?? "—");
    const days = daysFromCompletionDate(cd);
    const pred5 = pred5FromRow(r);
    const planReturn = planReturnFromRow(r);
    const affid = affidFromRow(r);
    if (!passesFilter(r, inputs, days, pred5, planReturn, affid)) continue;

    const zone = zoneForDays(days);
    if (!zone) continue;

    const item: MobileOpportunity = {
      key: normalizedRowKey(ticker, cd),
      ticker,
      name: String(r.Nome ?? r.Company ?? r["Società"] ?? ""),
      completionDate: cd,
      daysToCd: days,
      pred5,
      planReturnPct: planReturn,
      affidPct: affid,
      roiPerDay: roiPerDay(planReturn ?? (pred5 != null && pred5 > 0 ? pred5 : null), days),
      zone,
    };

    if (zone === "hot") hot.push(item);
    else watch.push(item);
  }

  hot.sort(sortOpps);
  watch.sort(sortOpps);
  return { hot, watch, all: [...hot, ...watch] };
}
