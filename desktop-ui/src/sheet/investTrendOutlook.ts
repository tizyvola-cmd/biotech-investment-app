/**
 * Messaggio e colori per Investment trend — allineato a tab P&L e modal perdita.
 */
import type { ChartPoint } from "../types";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  declineInputFromSignalLike,
  isCurveRisingForHold,
  isSustainedDeclineSell,
} from "./portfolioDeclineSell";
import { extractCurveInputs } from "./precatCurve";
import { portfolioPnlTone } from "./portfolioGainLossStyle";
import { resolveExpectedGainPlan, daysFromToday } from "./simulationPlanGain";
import { planRoiBundleFromGainPlan } from "./canonicalRoi";

/** Soglia |P&L %| oltre cui la perdita è «materiale» (rosso). */
export const INVEST_TREND_MATERIAL_LOSS_PCT = 8;

export type InvestTrendOutlookKind =
  | "gain"
  | "flat"
  | "loss_wait"
  | "loss_monitor"
  | "loss_urgent";

export type InvestTrendOutlook = {
  kind: InvestTrendOutlookKind;
  icon: string;
  title: string;
  body: string;
  lineColor: string;
  fillColor: string;
  bannerShell: string;
  bannerTitle: string;
  bannerBody: string;
  panelAccent: string;
};

function slopeFromRow(simRow: Record<string, unknown> | null | undefined) {
  if (!simRow) return { slope5d: null as number | null, slope20d: null as number | null };
  const c = extractCurveInputs(simRow);
  return { slope5d: c.slope5d ?? null, slope20d: c.slope20d ?? null };
}

function planReturnPctForRow(
  simRow: Record<string, unknown> | null | undefined,
  capital: number,
  chartPts: ChartPoint[] | null | undefined,
  completionDate: string,
): number | null {
  if (!simRow || capital <= 0) return null;
  const gainPlan = resolveExpectedGainPlan(simRow, capital, { chartPoints: chartPts ?? null });
  if (!gainPlan) return null;
  const bundle = planRoiBundleFromGainPlan(gainPlan, capital, daysFromToday(completionDate));
  return bundle.planReturnPct;
}

export function resolveInvestTrendOutlook(params: {
  scopeLabel: string;
  pnlEur: number;
  pnlPct: number;
  pnlUnavailable?: boolean;
  simRow?: Record<string, unknown> | null;
  chartPts?: ChartPoint[] | null;
  capital?: number;
  completionDate?: string;
  lang: "it" | "en";
  /** Vista «All portfolio» — niente segnali di uscita basati su un singolo ticker. */
  aggregateScope?: boolean;
}): InvestTrendOutlook {
  const it = params.lang === "it";
  const scope = params.scopeLabel;
  const pct = params.pnlPct;
  const pctFmt = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

  if (params.pnlUnavailable) {
    return neutralOutlook(it, scope);
  }

  const tone = portfolioPnlTone(params.pnlEur, pct);
  if (params.aggregateScope) {
    if (tone === "gain") return gainOutlook(it, scope, pctFmt);
    if (tone === "flat") return flatOutlook(it, scope);
    return lossMonitorOutlook(it, scope, pctFmt);
  }

  const { slope20d } = slopeFromRow(params.simRow);
  const planReturnPct = planReturnPctForRow(
    params.simRow,
    params.capital ?? 0,
    params.chartPts,
    params.completionDate ?? "",
  );

  const declineInput = declineInputFromSignalLike({
    simRow: params.simRow ?? undefined,
    planReturnPct,
    pred5: null,
    slope20d,
  });
  const slopeDeclining = isSustainedDeclineSell(declineInput);
  const curveRisingHold = isCurveRisingForHold(declineInput);

  if (tone === "gain") return gainOutlook(it, scope, pctFmt);
  if (tone === "flat") return flatOutlook(it, scope);

  const material = pct <= -INVEST_TREND_MATERIAL_LOSS_PCT;
  if (slopeDeclining || material) {
    return lossUrgentOutlook(it, scope, pctFmt, material, slopeDeclining);
  }
  if (curveRisingHold) return lossWaitOutlook(it, scope, pctFmt);
  return lossMonitorOutlook(it, scope, pctFmt);
}

function gainOutlook(it: boolean, scope: string, pctFmt: string): InvestTrendOutlook {
  return {
    kind: "gain",
    icon: "📈",
    title: it ? `${scope} in guadagno` : `${scope} in profit`,
    body: it
      ? `Il portafoglio vale più del capitale investito (${pctFmt}). Trend positivo — continua a monitorare.`
      : `Portfolio value is above invested capital (${pctFmt}). Positive trend — keep monitoring.`,
    lineColor: "#22c55e",
    fillColor: "#22c55e",
    bannerShell: "border-[rgb(var(--signal-up))]/45 bg-[rgb(var(--signal-up))]/8",
    bannerTitle: "text-[rgb(var(--signal-up))]",
    bannerBody: "text-ink-muted",
    panelAccent: "border-t-[rgb(var(--signal-up))]/55",
  };
}

function flatOutlook(it: boolean, scope: string): InvestTrendOutlook {
  return {
    kind: "flat",
    icon: "➖",
    title: it ? `${scope} in pari` : `${scope} at breakeven`,
    body: it
      ? "Valore attuale ≈ capitale investito. Nessun guadagno o perdita significativa."
      : "Current value ≈ invested capital. No meaningful gain or loss yet.",
    lineColor: "#2563eb",
    fillColor: "#3b82f6",
    bannerShell: "border-[rgb(var(--border))]/55 bg-[rgb(var(--surface-elevated))]/50",
    bannerTitle: "text-ink",
    bannerBody: "text-ink-muted",
    panelAccent: "border-t-[rgb(var(--border))]/60",
  };
}

function lossWaitOutlook(it: boolean, scope: string, pctFmt: string): InvestTrendOutlook {
  return {
    kind: "loss_wait",
    icon: "⏳",
    title: it ? `${scope} in perdita contenuta` : `${scope} — small loss`,
    body: it
      ? `Perdita ${pctFmt} ma la curva punta ancora verso il target. Nessuna urgenza di vendere — osserva la pendenza.`
      : `Loss ${pctFmt} but the curve still points toward target. No rush to sell — watch the slope.`,
    lineColor: "#f59e0b",
    fillColor: "#f59e0b",
    bannerShell: "border-[rgb(var(--warn))]/45 bg-[rgb(var(--warn))]/8",
    bannerTitle: "text-[rgb(var(--warn))]",
    bannerBody: "text-ink-muted",
    panelAccent: "border-t-[rgb(var(--warn))]/55",
  };
}

function lossMonitorOutlook(it: boolean, scope: string, pctFmt: string): InvestTrendOutlook {
  return {
    kind: "loss_monitor",
    icon: "👀",
    title: it ? `${scope} in perdita` : `${scope} in loss`,
    body: it
      ? `Perdita ${pctFmt} — non critica. Controlla curve e slope errors prima di decidere.`
      : `Loss ${pctFmt} — not critical. Review curves and slope errors before deciding.`,
    lineColor: "#f59e0b",
    fillColor: "#f59e0b",
    bannerShell: "border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))]/6",
    bannerTitle: "text-[rgb(var(--warn))]",
    bannerBody: "text-ink-muted",
    panelAccent: "border-t-[rgb(var(--warn))]/45",
  };
}

function lossUrgentOutlook(
  it: boolean,
  scope: string,
  pctFmt: string,
  material: boolean,
  slopeDeclining: boolean,
): InvestTrendOutlook {
  const reason =
    material && slopeDeclining
      ? it
        ? "Perdita ampia e pendenza in calo"
        : "Large loss and declining slope"
      : material
        ? it
          ? "Perdita ampia sul capitale"
          : "Large loss on capital"
        : it
          ? "Pendenza in calo sostenuta"
          : "Sustained declining slope";
  return {
    kind: "loss_urgent",
    icon: "🛑",
    title: it ? `${scope} — valuta l'uscita` : `${scope} — consider exit`,
    body: it
      ? `${reason} (${pctFmt}). Valuta vendita per limitare ulteriori perdite.`
      : `${reason} (${pctFmt}). Consider selling to limit further drawdown.`,
    lineColor: "#ef4444",
    fillColor: "#ef4444",
    bannerShell: "border-[rgb(var(--signal-down))]/50 bg-[rgb(var(--signal-down))]/10",
    bannerTitle: "text-[rgb(var(--signal-down))]",
    bannerBody: "text-ink-muted",
    panelAccent: "border-t-[rgb(var(--signal-down))]/55",
  };
}

function neutralOutlook(it: boolean, scope: string): InvestTrendOutlook {
  return {
    kind: "flat",
    icon: "—",
    title: scope,
    body: it
      ? "P&L non disponibile — imposta prezzo di acquisto o aggiorna i prezzi."
      : "P&L unavailable — set buy price or refresh prices.",
    lineColor: "#2563eb",
    fillColor: "#3b82f6",
    bannerShell: "border-[rgb(var(--border))]/55 bg-[rgb(var(--surface-elevated))]/50",
    bannerTitle: "text-ink-muted",
    bannerBody: "text-ink-muted",
    panelAccent: "border-t-[rgb(var(--border))]/50",
  };
}

/** Riduce letture ravvicinate (stesso giorno) per grafici più leggibili. */
export function compressInvestTrendHistory(
  history: InvestSimHistoryPoint[],
): InvestSimHistoryPoint[] {
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
  const compressed = [...byDay.values()].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
  );
  if (compressed.length >= 2) return compressed;
  return history;
}

/** Dominio P&L % che include sempre lo 0% (linea pareggio visibile). */
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

/** Dominio P&L € che include sempre lo 0 (pareggio visibile). */
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

function snap2(v: number): number {
  return Math.round(v * 100) / 100;
}
