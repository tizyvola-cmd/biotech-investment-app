/**
 * slopeErrorCharts — gestione visualizzazione grafici slope error (dismiss + TTL).
 */

import { loadContrarianLog, type ContrarianEventRecord } from "./contrarianLog";
import { loadSlopeLog, type SlopeEventKind, type SlopeEventRecord } from "./slopeEventLog";

const DISMISS_KEY = "supernova_slope_chart_dismiss_v1";
/** Slope deceleration / reversal charts. */
export const SLOPE_CHART_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** Contrarian pred vs curve — stesso TTL (prima esclusi del tutto). */
export const CONTRARIAN_CHART_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export type SlopeChartDismissMap = Record<string, number>;

export function loadDismissedSlopeCharts(): SlopeChartDismissMap {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as SlopeChartDismissMap;
  } catch {
    return {};
  }
}

export function dismissSlopeErrorChart(id: string): void {
  const map = loadDismissedSlopeCharts();
  map[id] = Date.now();
  localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
}

export function isContrarianChartKind(_kind: "contrarian"): boolean {
  return true;
}

export function isSlopeErrorKind(kind: SlopeEventKind): boolean {
  return kind === "slope_dec" || kind === "slope_rev";
}

/** Lista interna — nessuna purge (evita ricorsione con purgeExpiredSlopeChartDismiss). */
function filterActiveSlopeErrorEvents(
  map: SlopeChartDismissMap,
  now: number,
): SlopeEventRecord[] {
  return loadSlopeLog()
    .events.filter((e) => {
      if (!isSlopeErrorKind(e.kind)) return false;
      if (now - e.detected_at > SLOPE_CHART_RETENTION_MS) return false;
      if (map[e.id]) return false;
      return true;
    })
    .sort((a, b) => b.detected_at - a.detected_at);
}

function filterActiveContrarianEvents(
  map: SlopeChartDismissMap,
  now: number,
): ContrarianEventRecord[] {
  return loadContrarianLog()
    .events.filter((e) => {
      if (now - e.detected_at > CONTRARIAN_CHART_RETENTION_MS) return false;
      if (map[e.id]) return false;
      return true;
    })
    .sort((a, b) => b.detected_at - a.detected_at);
}

function activeChartIds(now: number): Set<string> {
  const map = loadDismissedSlopeCharts();
  const ids = new Set<string>();
  for (const e of filterActiveSlopeErrorEvents(map, now)) ids.add(e.id);
  for (const e of filterActiveContrarianEvents(map, now)) ids.add(e.id);
  return ids;
}

/** Rimuove dismiss scaduti oltre retention (pulizia opzionale). */
export function purgeExpiredSlopeChartDismiss(now = Date.now()): void {
  const map = loadDismissedSlopeCharts();
  const activeIds = activeChartIds(now);
  let changed = false;
  for (const id of Object.keys(map)) {
    if (!activeIds.has(id)) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
}

export function listActiveSlopeErrorEvents(
  dismissed?: SlopeChartDismissMap,
  now = Date.now(),
): SlopeEventRecord[] {
  purgeExpiredSlopeChartDismiss(now);
  const map = dismissed ?? loadDismissedSlopeCharts();
  return filterActiveSlopeErrorEvents(map, now);
}

export function listActiveContrarianEvents(
  dismissed?: SlopeChartDismissMap,
  now = Date.now(),
): ContrarianEventRecord[] {
  purgeExpiredSlopeChartDismiss(now);
  const map = dismissed ?? loadDismissedSlopeCharts();
  return filterActiveContrarianEvents(map, now);
}

export function daysUntilSlopeChartExpiry(
  detectedAt: number,
  now = Date.now(),
  retentionMs = SLOPE_CHART_RETENTION_MS,
): number {
  const left = retentionMs - (now - detectedAt);
  return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}

export function daysUntilContrarianChartExpiry(detectedAt: number, now = Date.now()): number {
  return daysUntilSlopeChartExpiry(detectedAt, now, CONTRARIAN_CHART_RETENTION_MS);
}

export function magnifiedSlopeDomain(values: Array<number | null | undefined>): [number, number] {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!finite.length) return [-0.4, 0.4];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  const pad = Math.max(0.2, span * 0.3, Math.abs(max) * 0.15, Math.abs(min) * 0.15);
  return [Math.round((min - pad) * 100) / 100, Math.round((max + pad) * 100) / 100];
}

/** Extra headroom so Recharts dot markers (r≈5px) are not clipped at plot edges. */
const TRAJECTORY_DOT_DOMAIN_PP = 1.2;

/** Y domain for % trajectory (model vs real), with padding. */
export function magnifiedPctDomain(values: Array<number | null | undefined>): [number, number] {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!finite.length) return [-5, 5];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  const pad = Math.max(2, span * 0.12, Math.abs(max) * 0.08, Math.abs(min) * 0.08);
  return [
    Math.round((min - pad) * 10) / 10,
    Math.round((max + pad + TRAJECTORY_DOT_DOMAIN_PP) * 10) / 10,
  ];
}

export function slopeChartDomId(eventId: string): string {
  return `slope-chart-${eventId}`;
}

export function slopeCompanyDomId(ticker: string): string {
  return `slope-company-${ticker.trim().toUpperCase()}`;
}

/** Asse X: include sempre «oggi» e CD anche se i nodi curva partono più a destra (es. T−20). */
export function slopeTrajectoryXDomain(
  points: { offset: number }[],
  todayOffset: number,
): [number, number] {
  const dataMin = points.length ? Math.min(...points.map((p) => p.offset)) : todayOffset;
  const dataMax = points.length ? Math.max(...points.map((p) => p.offset)) : 0;
  const lo = Math.min(dataMin, todayOffset);
  const hi = Math.max(dataMax, 0);
  const padLeft = lo === todayOffset ? Math.min(4, Math.max(2, Math.round((hi - lo) * 0.06))) : 0;
  return [lo - padLeft, hi];
}

const TRAJECTORY_AXIS_STEPS = [-60, -45, -30, -20, -15, -10, -7, -5, -3, 0, 30, 60, 90] as const;

export function slopeTrajectoryAxisTicks(
  domain: [number, number],
  todayOffset: number,
): number[] {
  const ticks = new Set<number>([todayOffset, 0]);
  for (const d of TRAJECTORY_AXIS_STEPS) {
    if (d >= domain[0] && d <= domain[1]) ticks.add(d);
  }
  return [...ticks].sort((a, b) => a - b);
}

export function formatSlopeTrajectoryAxisTick(
  d: number,
  todayOffset: number,
  lang: "it" | "en",
): string {
  if (d === 0) return "CD";
  if (d === todayOffset) return lang === "it" ? "Oggi" : "Today";
  if (d > 0) return `+${d}d`;
  return `${d}d`;
}
