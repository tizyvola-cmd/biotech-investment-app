import type { InvestSimHistoryPoint } from "./types";

export type TrendChartRow = {
  ts: string;
  pnlPct: number;
  pnlEur: number;
};

export function compressInvestTrendHistory(history: InvestSimHistoryPoint[]): InvestSimHistoryPoint[] {
  if (history.length <= 20) return history;
  const byDay = new Map<string, InvestSimHistoryPoint>();
  for (const h of history) {
    const d = new Date(h.ts);
    const key = Number.isFinite(d.getTime())
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : h.ts;
    const prev = byDay.get(key);
    if (!prev || Date.parse(h.ts) >= Date.parse(prev.ts)) {
      byDay.set(key, h);
    }
  }
  const compressed = [...byDay.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (compressed.length >= 2) return compressed;
  return history;
}

function snap2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function investTrendPnlDomain(
  values: (number | null | undefined)[],
  fallback: [number, number] = [-3, 3],
): [number, number] {
  let min = 0;
  let max = 0;
  let n = 0;
  for (const raw of values) {
    if (raw == null || !Number.isFinite(raw) || Math.abs(raw) > 500) continue;
    min = n === 0 ? raw : Math.min(min, raw);
    max = n === 0 ? raw : Math.max(max, raw);
    n++;
  }
  if (n === 0) return fallback;
  min = Math.min(min, 0);
  max = Math.max(max, 0);
  if (min === max) {
    const pad = Math.max(0.5, Math.abs(min) * 0.15 + 0.5);
    return [snap2(min - pad), snap2(max + pad)];
  }
  const pad = Math.max(0.35, (max - min) * 0.14);
  return [snap2(min - pad), snap2(max + pad)];
}

export function investTrendEurDomain(
  values: (number | null | undefined)[],
  fallback: [number, number] = [-100, 100],
): [number, number] {
  let min = 0;
  let max = 0;
  let n = 0;
  for (const raw of values) {
    if (raw == null || !Number.isFinite(raw)) continue;
    min = n === 0 ? raw : Math.min(min, raw);
    max = n === 0 ? raw : Math.max(max, raw);
    n++;
  }
  if (n === 0) return fallback;
  min = Math.min(min, 0);
  max = Math.max(max, 0);
  if (min === max) {
    const pad = Math.max(25, Math.abs(min) * 0.15 + 25);
    return [snap2(min - pad), snap2(max + pad)];
  }
  const pad = Math.max(20, (max - min) * 0.14);
  return [snap2(min - pad), snap2(max + pad)];
}

export function formatHistoryTsLabel(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatHistoryDayLabel(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}

export function buildTrendChartRows(
  history: InvestSimHistoryPoint[],
  selectedKey: string | null,
  locale: string,
): TrendChartRow[] {
  const compressed = compressInvestTrendHistory(history);
  const useDayLabels = compressed.length < history.length;
  return compressed.map((h) => {
    const label = useDayLabels
      ? formatHistoryDayLabel(h.ts, locale)
      : formatHistoryTsLabel(h.ts, locale);
    if (selectedKey && h.byTicker[selectedKey]) {
      const snap = h.byTicker[selectedKey];
      return {
        ts: label,
        pnlPct: snap2(snap.pnlPct),
        pnlEur: snap2(snap.pnl),
      };
    }
    return {
      ts: label,
      pnlPct: snap2(h.pnlPct),
      pnlEur: snap2(h.pnl),
    };
  });
}

export function trendLineColor(pnlPct: number | null): string {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return "#2563eb";
  if (pnlPct >= 0.35) return "#16a34a";
  if (pnlPct <= -0.35) return "#dc2626";
  return "#2563eb";
}
