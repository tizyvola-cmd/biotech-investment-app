/**
 * Codice colore unificato portfolio: verde chiaro (gain) / rosso chiaro (loss).
 * Usato in Piggy Bank chips, Simulation block cards e griglia portfolio.
 */

import type { ChartPoint } from "../types";
import { forwardBestCurveDeltaToCd } from "./simulationSparkline";
import {
  resolveCurveTrajectoryOutlook,
  resolvePlanRecoveryOutlook,
} from "./curveTrajectoryOutlook";
import {
  declineInputFromSignalLike,
  isSustainedDeclineSell,
} from "./portfolioDeclineSell";
import { pipelineToneFromReturnPct } from "./pipelineOpportunity";

export type PortfolioPnlTone = "gain" | "loss" | "flat";

/** Outlook riga tabella: rosso / verde / giallo / neutro. */
export type PortfolioTableOutlook = "gain" | "loss" | "warn" | "flat";

const EPS_EUR = 0.01;
const EPS_PCT = 0.05;

/** Gain / loss / flat da P&L totale in € (priorità) e % di riserva. */
export function portfolioPnlTone(
  pnlEur: number | null | undefined,
  pnlPct?: number | null,
): PortfolioPnlTone {
  if (pnlEur != null && Number.isFinite(pnlEur)) {
    if (pnlEur < -EPS_EUR) return "loss";
    if (pnlEur > EPS_EUR) return "gain";
  }
  if (pnlPct != null && Number.isFinite(pnlPct)) {
    if (pnlPct < -EPS_PCT) return "loss";
    if (pnlPct > EPS_PCT) return "gain";
  }
  return "flat";
}

/**
 * Ton per chip/righe/card: P&L totale; se pari (≈0), usa movimento giornaliero (24h).
 * Evita chip bianchi con (−$139) in parentesi quando il totale è ~0.
 */
export function resolvePortfolioDisplayTone(
  pnlEur: number | null | undefined,
  pnlPct?: number | null,
  pnlEur24h?: number | null,
  pnlPct24h?: number | null,
): PortfolioPnlTone {
  const total = portfolioPnlTone(pnlEur, pnlPct);
  if (total !== "flat") return total;
  return portfolioPnlTone(pnlEur24h, pnlPct24h);
}

const SLOPE_RISING_PP_PER_DAY = 0.1;

function slopeMeaningfullyNegative(s: number | null | undefined): boolean {
  return s != null && Number.isFinite(s) && s < -SLOPE_RISING_PP_PER_DAY;
}

function slopeMeaningfullyPositive(s: number | null | undefined): boolean {
  return s != null && Number.isFinite(s) && s > SLOPE_RISING_PP_PER_DAY;
}

/** Pendenza mercato (5d/20d) in calo significativo — non confondere con il modello verso CD. */
export function isMarketSlopeDeclining(
  slope5d: number | null | undefined,
  slope20d: number | null | undefined,
): boolean {
  return slopeMeaningfullyNegative(slope5d) || slopeMeaningfullyNegative(slope20d);
}

/** Curva in salita verso CD con ROI modello+ — solo se il mercato conferma (slope ↑). */
export function isRisingTowardTarget(outlook: {
  planReturnPct?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
  forwardDeltaPp?: number | null;
}): boolean {
  const plan = outlook.planReturnPct;
  if (plan == null || !Number.isFinite(plan) || plan <= 0) return false;
  return resolveMarketSlopeTone(outlook.slope5d, outlook.slope20d) === "gain";
}

/** Ton da pendenza mercato 5d/20d — allineato alla curva reale / sparkline. */
export function resolveMarketSlopeTone(
  slope5d: number | null | undefined,
  slope20d: number | null | undefined,
): PortfolioPnlTone {
  if (isMarketSlopeDeclining(slope5d, slope20d)) return "loss";
  if (slopeMeaningfullyPositive(slope5d)) return "gain";
  if (slopeMeaningfullyPositive(slope20d) && !slopeMeaningfullyNegative(slope5d)) {
    return "gain";
  }
  return "flat";
}

/**
 * Riga/card Simulation: pendenza mercato prima; se neutra → P&L totale dall'ingresso.
 * Non usa la var. 24h per colorare (evita verde su LTRN con curva ↓ ma giornata +).
 */
export function resolveSimulationRowTone(outlook: {
  inPortfolio?: boolean;
  pnlEur?: number | null;
  pnlPct?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
}): PortfolioPnlTone {
  const slopeTone = resolveMarketSlopeTone(outlook.slope5d, outlook.slope20d);
  if (slopeTone !== "flat") return slopeTone;
  if (outlook.inPortfolio !== false) {
    return portfolioPnlTone(outlook.pnlEur, outlook.pnlPct);
  }
  return "flat";
}

/** Soglia |P&L %| oltre cui il tab P&L non colora la card verde/rossa solo per pendenza. */
const PNL_CARD_MATERIAL_PCT = 8;

/**
 * Card tab P&L: se il mark-to-market dall'ingresso è una perdita/gain materiale,
 * il bordo/sfondo segue il P&L totale (evita TOTAL −80% su sfondo verde per rimbalzo 5d).
 */
export function resolvePnlCardOutlookTone(outlook: {
  pnlEur?: number | null;
  pnlPct?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
  materialPct?: number;
}): PortfolioPnlTone {
  const threshold = outlook.materialPct ?? PNL_CARD_MATERIAL_PCT;
  const total = portfolioPnlTone(outlook.pnlEur, outlook.pnlPct);
  if (outlook.pnlPct != null && Number.isFinite(outlook.pnlPct)) {
    if (outlook.pnlPct <= -threshold) return "loss";
    if (outlook.pnlPct >= threshold) return "gain";
  }
  if (total !== "flat") return total;
  return resolveSimulationRowTone({
    inPortfolio: true,
    pnlEur: outlook.pnlEur,
    pnlPct: outlook.pnlPct,
    slope5d: outlook.slope5d,
    slope20d: outlook.slope20d,
  });
}

/** Buy molto distante dal prezzo spot — probabile errore di input (es. OLMA 70 vs 14). */
export function buyPriceLooksInconsistent(
  buyUsd: number | null | undefined,
  currUsd: number | null | undefined,
): boolean {
  if (
    buyUsd == null ||
    currUsd == null ||
    !Number.isFinite(buyUsd) ||
    !Number.isFinite(currUsd) ||
    buyUsd <= 0 ||
    currUsd <= 0
  ) {
    return false;
  }
  const ratio = buyUsd / currUsd;
  return ratio > 2.5 || ratio < 0.35;
}

/** Colore metriche modello (ROI-CD): pendenza mercato se significativa, altrimenti segno ROI. */
export function resolveModelMetricTone(
  returnPct: number | null | undefined,
  slope5d?: number | null,
  slope20d?: number | null,
): PortfolioPnlTone {
  const slopeTone = resolveMarketSlopeTone(slope5d, slope20d);
  if (slopeTone !== "flat") return slopeTone;
  if (returnPct == null || !Number.isFinite(returnPct)) return "flat";
  if (returnPct > 0) return "gain";
  if (returnPct < 0) return "loss";
  return "flat";
}

export function portfolioToneSignalClass(tone: PortfolioPnlTone): string {
  if (tone === "gain") return "text-[rgb(var(--signal-up))]";
  if (tone === "loss") return "text-[rgb(var(--signal-down))]";
  return "text-ink-muted";
}

/** @deprecated Alias — usa resolveSimulationRowTone. */
export function resolvePortfolioOutlookTone(outlook: {
  pnlEur?: number | null;
  pnlPct?: number | null;
  pnlEur24h?: number | null;
  pnlPct24h?: number | null;
  planReturnPct?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
  forwardDeltaPp?: number | null;
  inPortfolio?: boolean;
}): PortfolioPnlTone {
  return resolveSimulationRowTone({
    inPortfolio: outlook.inPortfolio !== false,
    pnlEur: outlook.pnlEur,
    pnlPct: outlook.pnlPct,
    slope5d: outlook.slope5d,
    slope20d: outlook.slope20d,
  });
}

export function isPortfolioLosing(
  pnlEur: number | null | undefined,
  pnlPct?: number | null,
): boolean {
  return portfolioPnlTone(pnlEur, pnlPct) === "loss";
}

/** Banner / chip: +$67 o −$139; pari → $0 senza segno +. */
export function fmtSignedUsdPnl(pnlUsd: number | null | undefined): string {
  if (pnlUsd == null || !Number.isFinite(pnlUsd)) return "—";
  const tone = portfolioPnlTone(pnlUsd);
  if (tone === "flat") return `$${Math.abs(pnlUsd).toFixed(2)}`;
  const sign = tone === "gain" ? "+" : "−";
  const abs = Math.abs(pnlUsd);
  const d = abs < 10 ? (abs < 1 ? 2 : 2) : abs < 1000 ? 0 : 0;
  return `${sign}$${abs.toFixed(d)}`;
}

/** P&L $ in card Simulation (allineato a portfolioPnlTone). */
export function fmtPortfolioPnlUsd(pnlUsd: number | null | undefined): string {
  if (pnlUsd == null || !Number.isFinite(pnlUsd)) return "—";
  const tone = portfolioPnlTone(pnlUsd);
  const abs = Math.abs(pnlUsd);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (tone === "flat") return `$ ${body}`;
  const sign = tone === "gain" ? "+" : "-";
  return `${sign}$ ${body}`;
}

/** P&L % in card Simulation. */
export function fmtPortfolioPnlPct(pnlPct: number | null | undefined): string {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return "—";
  const tone = portfolioPnlTone(null, pnlPct);
  if (tone === "flat") return `${pnlPct.toFixed(2)}%`;
  const sign = tone === "gain" ? "+" : "";
  return `${sign}${pnlPct.toFixed(2)}%`;
}

/** Classi testo per valori P&L (tabella / KPI). */
export function portfolioPnlTextClass(
  pnlEur: number | null | undefined,
  pnlPct?: number | null,
  muted = false,
): string {
  const tone = portfolioPnlTone(pnlEur, pnlPct);
  if (tone === "gain") return "text-emerald-700";
  if (tone === "loss") return "text-red-700";
  return muted ? "text-slate-500" : "text-slate-700";
}

export function portfolioPnlAccentClass(
  pnlEur: number | null | undefined,
  pnlPct?: number | null,
  pnlEur24h?: number | null,
  pnlPct24h?: number | null,
): string {
  const tone = resolvePortfolioDisplayTone(pnlEur, pnlPct, pnlEur24h, pnlPct24h);
  if (tone === "gain") return " text-positive";
  if (tone === "loss") return " text-negative";
  return " text-slate-600";
}

export function portfolioFlatBadge(it: boolean): string {
  return it ? "Pari" : "Flat";
}

/** Etichetta compatta colonna «Gain vs loss» (tabella Simulation). */
export function portfolioGainLossStatusLabel(
  tone: PortfolioPnlTone,
  it = false,
): string {
  if (tone === "gain") return it ? "Guadagno" : "Gain";
  if (tone === "loss") return it ? "Perdita" : "Loss";
  return portfolioFlatBadge(it);
}

/** Chip compatti (Piggy Bank, dashboard). */
export type PortfolioChipTone = PortfolioPnlTone | "warn";

export const PORTFOLIO_CHIP_CLS: Record<PortfolioChipTone, string> = {
  gain:
    "inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums pl-1 pr-1.5 py-0.5 rounded border border-emerald-300/80 border-l-[3px] border-l-emerald-600 text-emerald-800 bg-emerald-50/95",
  loss:
    "inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums pl-1 pr-1.5 py-0.5 rounded border border-rose-300/80 border-l-[3px] border-l-red-600 text-rose-800 bg-rose-50/95",
  warn:
    "inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums pl-1 pr-1.5 py-0.5 rounded border border-[rgb(var(--warn))]/45 border-l-[3px] border-l-[rgb(var(--warn))] text-[rgb(var(--warn))] bg-[rgb(var(--panel-warn-bg))]/55",
  flat:
    "inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums pl-1 pr-1.5 py-0.5 rounded border border-slate-200/80 border-l-[3px] border-l-slate-400 text-slate-700 bg-slate-50/90",
};

/** Card intera riga portfolio (Simulation P&L tab + block grid). */
export const PORTFOLIO_ROW_CLS: Record<PortfolioPnlTone, string> = {
  gain: "rounded-xl border border-emerald-300/80 bg-emerald-50/95 p-3 shadow-sm",
  loss: "rounded-xl border border-rose-300/80 bg-rose-50/95 p-3 shadow-sm",
  flat: "rounded-xl border border-slate-200/80 bg-slate-50/95 p-3 shadow-sm",
};

export function portfolioRowArticleClass(tone: PortfolioPnlTone): string {
  return `${portfolioCardSurfaceClass(tone)} min-w-0`;
}

/** Righe tabella Portfolio simulation (`index.css` — verde/rosso chiaro visibile). */
export const PORTFOLIO_TABLE_ROW_CLS: Record<PortfolioPnlTone, string> = {
  gain: "portfolio-row-gain",
  loss: "portfolio-row-loss",
  flat: "portfolio-row-flat",
};

export function portfolioTableRowClass(
  tone: PortfolioPnlTone | null | undefined,
): string {
  if (!tone) return "";
  return PORTFOLIO_TABLE_ROW_CLS[tone];
}

export const PORTFOLIO_TABLE_OUTLOOK_CLS: Record<PortfolioTableOutlook, string> = {
  gain: "portfolio-row-gain",
  loss: "portfolio-row-loss",
  warn: "portfolio-row-warn",
  flat: "portfolio-row-flat",
};

export const PORTFOLIO_CARD_OUTLOOK_CLS: Record<PortfolioTableOutlook, string> = {
  gain: "portfolio-card-gain p-3 shadow-sm",
  loss: "portfolio-card-loss p-3 shadow-sm",
  warn: "portfolio-card-warn p-3 shadow-sm",
  flat: "portfolio-card-flat p-3 shadow-sm",
};

/**
 * Colore riga tabella Simulation / Decision Lab.
 * Base: traiettoria curva modello verso CD (gain / warn / loss / flat).
 * Se la riga è in portafoglio e Entry P&L è negativo, non usare mai verde:
 *   warn (giallo) = in perdita ma curva/target ancora favorevoli (HOLD)
 *   loss (rosso) = in perdita senza segnali di recupero
 */
export function resolvePortfolioTableOutlook(outlook: {
  inPortfolio?: boolean;
  pnlEur?: number | null;
  pnlPct?: number | null;
  planReturnPct?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
  simRow?: Record<string, unknown> | null;
  chartPoints?: ChartPoint[] | null;
}): PortfolioTableOutlook {
  let result: PortfolioTableOutlook = "flat";

  if (outlook.simRow && outlook.chartPoints?.length) {
    const curveOutlook = resolveCurveTrajectoryOutlook(
      outlook.simRow,
      outlook.chartPoints,
    );
    if (curveOutlook) result = curveOutlook;
  }

  if (result === "flat") {
    const declineInput = declineInputFromSignalLike({
      planReturnPct: outlook.planReturnPct ?? null,
      slope5d: outlook.slope5d ?? null,
      slope20d: outlook.slope20d ?? null,
      simRow: outlook.simRow ?? undefined,
    });
    const slopeDeclining = isSustainedDeclineSell(declineInput);

    const fallback = resolvePlanRecoveryOutlook({
      pnlPct: outlook.inPortfolio ? outlook.pnlPct : null,
      planReturnPct: outlook.planReturnPct ?? null,
      slope5d: outlook.slope5d ?? null,
      slope20d: outlook.slope20d ?? null,
      slopeDeclining,
    });
    if (fallback !== "flat") result = fallback;
    else {
      const fwdToCd =
        outlook.simRow && outlook.chartPoints?.length
          ? forwardBestCurveDeltaToCd(outlook.simRow, outlook.chartPoints)
          : null;
      if (fwdToCd != null && fwdToCd <= -1.5) {
        result = "loss";
      } else {
        const slopeTone = resolveMarketSlopeTone(outlook.slope5d, outlook.slope20d);
        if (slopeTone === "gain" && (fwdToCd == null || fwdToCd >= -0.5)) result = "gain";
        else if (slopeTone === "loss") result = "loss";
      }
    }
  }

  if (outlook.simRow && outlook.chartPoints?.length) {
    const fwdToCd = forwardBestCurveDeltaToCd(outlook.simRow, outlook.chartPoints);
    if (fwdToCd != null && fwdToCd <= -1.5 && (result === "gain" || result === "warn")) {
      result = "loss";
    }
  }

  if (result === "flat") {
    const pipeline = pipelineToneFromReturnPct(outlook.planReturnPct);
    if (pipeline === "gain") result = "gain";
    else if (pipeline === "loss") result = "loss";
  }

  return reconcileOpenPositionRowOutlook(outlook, result);
}

/** Posizione aperta in perdita: verde solo se Entry P&L ≥ 0. */
function reconcileOpenPositionRowOutlook(
  outlook: {
    inPortfolio?: boolean;
    pnlEur?: number | null;
    pnlPct?: number | null;
  },
  trajectory: PortfolioTableOutlook,
): PortfolioTableOutlook {
  if (!outlook.inPortfolio || outlook.pnlPct == null) return trajectory;
  if (portfolioPnlTone(outlook.pnlEur ?? 0, outlook.pnlPct) !== "loss") {
    return trajectory;
  }
  if (trajectory === "gain") return "warn";
  if (trajectory === "flat") return "loss";
  return trajectory;
}

export function portfolioTableOutlookClass(
  outlook: PortfolioTableOutlook | null | undefined,
): string {
  if (!outlook) return "";
  return PORTFOLIO_TABLE_OUTLOOK_CLS[outlook];
}

/**
 * Colore riga basato sul P&L corrente (convenzione classica):
 * verde se la posizione è in profitto (Entry P&L ≥ 0), rosso se in perdita.
 * Le righe non in portafoglio (nessuna posizione) restano neutre.
 */
export function resolvePnlRowOutlook(outlook: {
  inPortfolio?: boolean;
  pnlUnavailable?: boolean;
  pnlEur?: number | null;
  pnlPct?: number | null;
}): PortfolioTableOutlook {
  if (!outlook.inPortfolio || outlook.pnlUnavailable) return "flat";
  return portfolioPnlTone(outlook.pnlEur ?? null, outlook.pnlPct) === "loss"
    ? "loss"
    : "gain";
}

/** Colore ticker allineato allo sfondo riga (non al P&L mark-to-market). */
export function portfolioTickerOutlookColor(
  outlook: PortfolioTableOutlook | null | undefined,
): string {
  if (outlook === "gain") return "rgb(var(--signal-up))";
  if (outlook === "loss") return "rgb(var(--signal-down))";
  if (outlook === "warn") return "rgb(var(--warn))";
  return "rgb(var(--ink))";
}

export function portfolioCardOutlookClass(
  outlook: PortfolioTableOutlook | null | undefined,
): string {
  if (!outlook) {
    return "rounded-xl border border-slate-200 bg-white p-3 shadow-sm";
  }
  return PORTFOLIO_CARD_OUTLOOK_CLS[outlook];
}

/** Card griglia portfolio (tab Portfolio / SimulationSheetGrid). */
export const PORTFOLIO_CARD_SURFACE_CLS: Record<PortfolioPnlTone, string> = {
  gain: "portfolio-card-gain p-3 shadow-sm",
  loss: "portfolio-card-loss p-3 shadow-sm",
  flat: "portfolio-card-flat p-3 shadow-sm",
};

export function portfolioCardSurfaceClass(tone: PortfolioPnlTone): string {
  return PORTFOLIO_CARD_SURFACE_CLS[tone];
}

/** € con segno corretto (evita «+€ -0» su −0). */
export function fmtSignedEurPnl(eur: number | null | undefined): string {
  if (eur == null || !Number.isFinite(eur)) return "—";
  const tone = portfolioPnlTone(eur);
  const abs = Math.abs(eur);
  const body = `€ ${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  if (tone === "flat") return body;
  return tone === "gain" ? `+${body}` : `−${body}`;
}

/** Classi blocco TOTAL tab P&L — tono solo da P&L dall'ingresso. */
export function ptfBlockTotalClassName(tone: PortfolioPnlTone): string {
  const t = portfolioPtfBlockTheme(tone);
  return `ptf-block-total ptf-block-total--${tone} ${t.blockTotal}`;
}

/** Classi blocco giornata tab P&L — tono solo da var. 24h / vs ieri. */
export function ptfBlockDayClassName(tone: PortfolioPnlTone): string {
  const t = portfolioPtfDayBlockTheme(tone);
  return `ptf-block-day ptf-block-day--${tone} ${t.blockDay}`;
}

/** Shell neutra per KPI «oggi» in cima al tab — numeri colorati, blocco non invaso da rosso/verde. */
export function ptfBlockDaySecondaryClassName(): string {
  return "rounded-lg border border-[rgb(var(--border))]/55 bg-[rgb(var(--surface))]/45 px-3 py-2 shadow-sm min-w-0";
}

/** Tono card articolo tab P&L: sempre mark-to-market totale (mai pendenza / 24h). */
export function resolvePnlTabCardTone(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
): PortfolioPnlTone {
  return portfolioPnlTone(pnlEur, pnlPct);
}

/** Blocco «giornata / 24h» — rosso/verde/grigio (non ambra). */
export function portfolioPtfDayBlockTheme(tone: PortfolioPnlTone) {
  if (tone === "loss") {
    return {
      blockDay:
        "rounded-lg border border-rose-300/75 bg-rose-50/95 px-2.5 py-2 shadow-sm min-w-0 border-l-[3px] border-l-rose-600",
      blockTitleDay:
        "text-[10px] uppercase tracking-wide text-rose-900/90 font-semibold mb-1.5",
    };
  }
  if (tone === "gain") {
    return {
      blockDay:
        "rounded-lg border border-emerald-300/70 bg-emerald-50/95 px-2.5 py-2 shadow-sm min-w-0 border-l-[3px] border-l-emerald-600",
      blockTitleDay:
        "text-[10px] uppercase tracking-wide text-emerald-900/90 font-semibold mb-1.5",
    };
  }
  return {
    blockDay:
      "rounded-lg border border-slate-200/80 bg-slate-50/95 px-2.5 py-2 shadow-sm min-w-0 border-l-[3px] border-l-slate-400",
    blockTitleDay:
      "text-[10px] uppercase tracking-wide text-slate-700 font-semibold mb-1.5",
  };
}

/** Tema interno blocchi per card P&L Simulation (4 blocchi per ticker). */
export function portfolioPtfBlockTheme(tone: PortfolioPnlTone) {
  if (tone === "loss") {
    return {
      block: "rounded-lg border border-rose-300/70 bg-white/95 px-2.5 py-2 shadow-sm min-w-0",
      blockTotal:
        "rounded-lg border border-rose-400/55 bg-rose-100/40 px-2.5 py-2 shadow-sm min-w-0",
      blockTitle: "text-[10px] uppercase tracking-wide text-rose-900/75 font-semibold mb-1.5",
      blockTitleTotal:
        "text-[10px] uppercase tracking-wide text-rose-950 font-semibold mb-1.5",
      ticker: "font-bold text-rose-950 text-[15px] leading-tight",
      meta: "text-[10px] text-rose-900/65",
      field: "text-[10px] text-rose-900/65 font-medium leading-tight",
    };
  }
  if (tone === "gain") {
    return {
      block: "rounded-lg border border-emerald-200/80 bg-white/95 px-2.5 py-2 shadow-sm min-w-0",
      blockTotal:
        "rounded-lg border border-emerald-400/55 bg-emerald-100/45 px-2.5 py-2 shadow-sm min-w-0",
      blockTitle: "text-[10px] uppercase tracking-wide text-emerald-900/75 font-semibold mb-1.5",
      blockTitleTotal:
        "text-[10px] uppercase tracking-wide text-emerald-950 font-semibold mb-1.5",
      ticker: "font-bold text-emerald-950 text-[15px] leading-tight",
      meta: "text-[10px] text-emerald-900/65",
      field: "text-[10px] text-emerald-900/65 font-medium leading-tight",
    };
  }
  return {
    block: "rounded-lg border border-slate-200/80 bg-white/95 px-2.5 py-2 shadow-sm min-w-0",
    blockTotal:
      "rounded-lg border border-slate-300/60 bg-slate-100/50 px-2.5 py-2 shadow-sm min-w-0",
    blockTitle: "text-[10px] uppercase tracking-wide text-slate-600 font-semibold mb-1.5",
    blockTitleTotal:
      "text-[10px] uppercase tracking-wide text-slate-800 font-semibold mb-1.5",
    ticker: "font-bold text-slate-900 text-[15px] leading-tight",
    meta: "text-[10px] text-slate-600",
    field: "text-[10px] text-slate-600 font-medium leading-tight",
  };
}

export function portfolioGainFieldLabel(it: boolean, tone: PortfolioPnlTone): string {
  if (tone === "loss") return it ? "Perdita attuale" : "Current loss";
  if (tone === "gain") return it ? "Guadagno attuale" : "Current gain";
  return it ? "P&L attuale (pari)" : "Current P&L (flat)";
}

/** Etichetta riepilogo card quando il totale è pari ma la giornata no. */
export function portfolioDailyChangeLabel(it: boolean, tone: PortfolioPnlTone): string {
  if (tone === "loss") return it ? "Var. giorno (perdita)" : "Today (loss)";
  if (tone === "gain") return it ? "Var. giorno (gain)" : "Today (gain)";
  return it ? "Var. giorno" : "Today";
}

/** Titolo blocco «giornata» nel tab P&L (base di calcolo esplicita). */
export function portfolioDailyBlockTitle(
  it: boolean,
  tone: PortfolioPnlTone,
  source: "entry_today" | "history" | "sheet" | "none" | undefined,
): string {
  if (source === "entry_today") {
    if (tone === "loss") return it ? "Oggi (da ingresso · perdita)" : "Today (since entry · loss)";
    if (tone === "gain") return it ? "Oggi (da ingresso · gain)" : "Today (since entry · gain)";
    return it ? "Oggi (da ingresso)" : "Today (since entry)";
  }
  if (source === "history") {
    return portfolioDailyChangeLabel(it, tone) + (it ? " · Δ valore" : " · Δ value");
  }
  if (source === "sheet") {
    return portfolioDailyChangeLabel(it, tone) + (it ? " · vs ieri" : " · vs prev close");
  }
  return portfolioDailyChangeLabel(it, tone);
}

export function portfolioDailyBlockTip(
  it: boolean,
  source: "entry_today" | "history" | "sheet" | "none" | undefined,
): string {
  if (source === "entry_today") {
    return it
      ? "Posizione aperta oggi: la giornata coincide con il P&L totale da ingresso (non la Var. % del titolo vs ieri)."
      : "Opened today: today matches total P&L from entry (not the ticker’s move vs yesterday’s close).";
  }
  if (source === "history") {
    return it
      ? "Variazione del valore della tua posizione rispetto all’ultimo snapshot (solitamente ieri)."
      : "Change in your position value vs the last snapshot (usually yesterday).";
  }
  if (source === "sheet") {
    return it
      ? "Var. Giorn. % del foglio Simulation (titolo vs chiusura precedente), applicata al valore attuale."
      : "Simulation sheet daily % (ticker vs previous close), applied to current position value.";
  }
  return it ? "Dati giornalieri non disponibili." : "Daily data unavailable.";
}

/** Totale dall'ingresso vs tono display (totale, altrimenti 24h se pari). */
export function portfolioToneUsesDailyFallback(
  pnlEur: number | null | undefined,
  pnlPct?: number | null,
  pnlEur24h?: number | null,
  pnlPct24h?: number | null,
): boolean {
  return (
    portfolioPnlTone(pnlEur, pnlPct) === "flat" &&
    resolvePortfolioDisplayTone(pnlEur, pnlPct, pnlEur24h, pnlPct24h) !== "flat"
  );
}

/** Stato display unificato (Portfolio simulation, P&L tab, Dashboard, Decision Lab). */
export type PortfolioPositionDisplay = {
  totalTone: PortfolioPnlTone;
  displayTone: PortfolioPnlTone;
  usesDailyForColor: boolean;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
};

export function buildPortfolioPositionDisplay(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
  daily?: { pnlEur24h?: number | null; pnlPct24h?: number | null },
  opts?: { unavailable?: boolean },
): PortfolioPositionDisplay {
  const pnlEur24h = daily?.pnlEur24h ?? null;
  const pnlPct24h = daily?.pnlPct24h ?? null;
  if (opts?.unavailable) {
    return {
      totalTone: "flat",
      displayTone: "flat",
      usesDailyForColor: false,
      pnlEur24h,
      pnlPct24h,
    };
  }
  const totalTone = portfolioPnlTone(pnlEur, pnlPct);
  const displayTone = resolvePortfolioDisplayTone(
    pnlEur,
    pnlPct,
    pnlEur24h,
    pnlPct24h,
  );
  const usesDailyForColor = portfolioToneUsesDailyFallback(
    pnlEur,
    pnlPct,
    pnlEur24h,
    pnlPct24h,
  );
  return { totalTone, displayTone, usesDailyForColor, pnlEur24h, pnlPct24h };
}

/**
 * P&L dall'ingresso (mark-to-market reale). Non sostituisce mai la var. giornaliera:
 * total e trading day restano metriche distinte (tab P&L, somme header, tabella).
 */
export function portfolioTotalDisplayValues(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
  _pnlEur24h?: number | null,
  _pnlPct24h?: number | null,
): {
  eur: number | null;
  pct: number | null;
  tone: PortfolioPnlTone;
  /** @deprecated Sempre false — total e day non si mescolano più. */
  fromDailyFallback: boolean;
} {
  return {
    eur: pnlEur != null && Number.isFinite(pnlEur) ? pnlEur : null,
    pct: pnlPct != null && Number.isFinite(pnlPct) ? pnlPct : null,
    tone: portfolioPnlTone(pnlEur, pnlPct),
    fromDailyFallback: false,
  };
}

/** Variazione giornaliera (trading day) — separata dal total. */
export function portfolioDailyPnlValues(
  pnlEur24h?: number | null,
  pnlPct24h?: number | null,
): {
  eur: number | null;
  pct: number | null;
  tone: PortfolioPnlTone;
} {
  return {
    eur: pnlEur24h != null && Number.isFinite(pnlEur24h) ? pnlEur24h : null,
    pct: pnlPct24h != null && Number.isFinite(pnlPct24h) ? pnlPct24h : null,
    tone: portfolioPnlTone(pnlEur24h, pnlPct24h),
  };
}

function formatDailyPnlPart(
  pnlEur24h?: number | null,
  pnlPct24h?: number | null,
): string | null {
  const daily = portfolioDailyPnlValues(pnlEur24h, pnlPct24h);
  if (daily.tone === "flat") return null;
  const amt = fmtPortfolioPnlUsd(daily.eur);
  if (amt === "—") return null;
  const pct = daily.pct != null ? fmtPortfolioPnlPct(daily.pct) : null;
  return pct && pct !== "—" ? `${amt} (${pct})` : amt;
}

/** P&L realizzato se chiudi oggi (mark-to-market da ingresso) — exit review. */
export type SellTodayPnlDisplay = {
  tone: PortfolioPnlTone;
  eur: number | null;
  pct: number | null;
  eurFormatted: string;
  pctFormatted: string;
  capitalEur: number | null;
};

export function resolveSellTodayPnl(params: {
  pnlEur?: number | null;
  pnlPct?: number | null;
  buyPriceUsd?: number | null;
  currentPriceUsd?: number | null;
  capitalEur?: number | null;
}): SellTodayPnlDisplay | null {
  let eur = params.pnlEur ?? null;
  let pct = params.pnlPct ?? null;

  if (
    pct == null &&
    eur == null &&
    params.buyPriceUsd != null &&
    params.currentPriceUsd != null &&
    params.buyPriceUsd > 0
  ) {
    pct =
      Math.round(((params.currentPriceUsd / params.buyPriceUsd) - 1) * 10000) / 100;
    if (params.capitalEur != null && params.capitalEur > 0) {
      eur = Math.round((params.capitalEur * pct) / 100 * 100) / 100;
    }
  }

  if (pct == null && eur == null) return null;

  const tone = portfolioPnlTone(eur, pct);
  return {
    tone,
    eur,
    pct,
    eurFormatted: fmtSignedEurPnl(eur),
    pctFormatted: pct != null ? fmtPortfolioPnlPct(pct) : "—",
    capitalEur:
      params.capitalEur != null && params.capitalEur > 0 ? params.capitalEur : null,
  };
}

/** Valori formattati per box riepilogo / chip (totale display unificato). */
export function portfolioSummaryFormatted(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
  display: PortfolioPositionDisplay,
): { usd: string; pct: string; fromDailyFallback: boolean } {
  const total = portfolioTotalDisplayValues(
    pnlEur,
    pnlPct,
    display.pnlEur24h,
    display.pnlPct24h,
  );
  return {
    usd: fmtPortfolioPnlUsd(total.eur),
    pct: total.pct != null ? fmtPortfolioPnlPct(total.pct) : "—",
    fromDailyFallback: total.fromDailyFallback,
  };
}

export type PositionPnlSummary = {
  amount: string;
  pct: string;
  tone: PortfolioPnlTone;
  /** @deprecated Sempre false. */
  fromDailyFallback: boolean;
  /** Se total ≈ pari ma la giornata no — mostrato a parte, non al posto del total. */
  dailyPart: string | null;
};

/** P&L posizione: total dall'ingresso + eventuale riga giorno se total ≈ pari. */
export function formatPositionPnlSummary(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
  daily?: { pnlEur24h?: number | null; pnlPct24h?: number | null },
): PositionPnlSummary | null {
  if (pnlPct == null && pnlEur == null) return null;
  const entry = portfolioTotalDisplayValues(pnlEur, pnlPct);
  const disp = buildPortfolioPositionDisplay(pnlEur, pnlPct, daily);
  const amount = fmtPortfolioPnlUsd(entry.eur);
  const pct = entry.pct != null ? fmtPortfolioPnlPct(entry.pct) : "—";
  if (amount === "—" && pct === "—") return null;
  const dailyPart =
    entry.tone === "flat" ? formatDailyPnlPart(daily?.pnlEur24h, daily?.pnlPct24h) : null;
  return {
    amount,
    pct,
    tone: disp.displayTone,
    fromDailyFallback: false,
    dailyPart,
  };
}

export function formatPositionPnlInline(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
  daily?: { pnlEur24h?: number | null; pnlPct24h?: number | null },
  opts?: { dayLabel?: string },
): string {
  const s = formatPositionPnlSummary(pnlEur, pnlPct, daily);
  if (!s) return "—";
  const base = s.pct !== "—" ? `${s.amount} (${s.pct})` : s.amount;
  if (s.dailyPart) {
    const lbl = opts?.dayLabel ?? "day";
    return `${base} · ${lbl} ${s.dailyPart}`;
  }
  return base;
}

export function positionPnlToneClass(tone: PortfolioPnlTone): string {
  if (tone === "gain") return "text-[rgb(var(--signal-up))]";
  if (tone === "loss") return "text-[rgb(var(--signal-down))]";
  return "text-ink-muted";
}

/**
 * Chip Piggy Bank: colore solo da P&L totale (ingresso → oggi).
 * La var. giorno resta in parentesi ma non colora il chip di verde se il totale è pari/perdita.
 */
/** P&L cumulato prima della var. 24h (se tutte le posizioni hanno Var. Giorn. %). */
export function piggyBankPriorLegFromEntry(
  totalEur: number,
  dailyEur: number | null | undefined,
): number | null {
  if (dailyEur == null || !Number.isFinite(dailyEur)) return null;
  return Math.round((totalEur - dailyEur) * 100) / 100;
}

/** Mostra nota quando oggi in perdita ma totale dall'ingresso ancora positivo. */
export function piggyBankNeedsDayVsTotalNote(
  totalEur: number,
  dailyEur: number | null | undefined,
): boolean {
  if (dailyEur == null || !Number.isFinite(dailyEur) || dailyEur >= 0) return false;
  if (totalEur <= 0) return false;
  return Math.abs(dailyEur) > EPS_EUR;
}

export function portfolioPiggyBankChipDisplay(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
  pnlEur24h?: number | null,
  pnlPct24h?: number | null,
  lang: "it" | "en" = "en",
): {
  mainUsd: string;
  dailySuffixUsd: string | null;
  tone: PortfolioPnlTone;
  title: string;
} {
  const entry = portfolioTotalDisplayValues(pnlEur, pnlPct);
  const tone = portfolioPnlTone(pnlEur, pnlPct);
  const it = lang === "it";
  const totalLabel = it ? "Totale" : "Total";
  const todayLabel = it ? "oggi" : "24h";
  const pctLabel =
    entry.pct != null
      ? ` (${entry.pct >= 0 ? "+" : ""}${entry.pct.toFixed(1)}%)`
      : pnlPct != null
        ? ` (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`
        : "";
  const dailyPctLabel =
    pnlPct24h != null && Number.isFinite(pnlPct24h)
      ? ` (${pnlPct24h >= 0 ? "+" : ""}${pnlPct24h.toFixed(1)}%)`
      : "";
  const hasDaily24h =
    pnlEur24h != null &&
    Number.isFinite(pnlEur24h) &&
    portfolioPnlTone(pnlEur24h, pnlPct24h) !== "flat";
  const title = `${totalLabel}: ${fmtSignedEurPnl(entry.eur)}${pctLabel}${
    hasDaily24h
      ? ` · ${todayLabel}: ${fmtSignedEurPnl(pnlEur24h)}${dailyPctLabel}`
      : ""
  }`;
  return {
    mainUsd: fmtSignedEurPnl(entry.eur),
    dailySuffixUsd: hasDaily24h ? fmtSignedEurPnl(pnlEur24h) : null,
    tone,
    title,
  };
}

/** Testo chip generico: total dall'ingresso + var. giorno tra parentesi se presente. */
export function portfolioChipDisplay(
  pnlEur: number | null | undefined,
  pnlPct: number | null | undefined,
  pnlEur24h?: number | null,
  pnlPct24h?: number | null,
): {
  mainUsd: string;
  dailySuffixUsd: string | null;
  tone: PortfolioPnlTone;
  title: string;
} {
  const entry = portfolioTotalDisplayValues(pnlEur, pnlPct);
  const tone = resolvePortfolioDisplayTone(pnlEur, pnlPct, pnlEur24h, pnlPct24h);
  const pctLabel =
    entry.pct != null
      ? ` (${entry.pct >= 0 ? "+" : ""}${entry.pct.toFixed(1)}%)`
      : pnlPct != null
        ? ` (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`
        : "";
  const dailyPctLabel =
    pnlPct24h != null && Number.isFinite(pnlPct24h)
      ? ` · 24h ${pnlPct24h >= 0 ? "+" : ""}${pnlPct24h.toFixed(1)}%`
      : "";
  const hasDaily24h =
    pnlEur24h != null &&
    Number.isFinite(pnlEur24h) &&
    portfolioPnlTone(pnlEur24h, pnlPct24h) !== "flat";
  const title = `${fmtSignedUsdPnl(entry.eur)}${pctLabel}${
    hasDaily24h ? ` · 24h ${fmtSignedUsdPnl(pnlEur24h)}${dailyPctLabel}` : ""
  }`;
  return {
    mainUsd: fmtSignedUsdPnl(entry.eur),
    dailySuffixUsd: hasDaily24h ? fmtSignedUsdPnl(pnlEur24h) : null,
    tone,
    title,
  };
}

export function portfolioPnlValueClass(tone: PortfolioPnlTone): string {
  if (tone === "gain") return "text-[12px] font-bold tabular-nums text-[rgb(var(--signal-up))]";
  if (tone === "loss") return "text-[12px] font-bold tabular-nums text-[rgb(var(--signal-down))]";
  return "text-[12px] font-bold tabular-nums text-ink";
}

export function portfolioPnlEurClass(tone: PortfolioPnlTone): string {
  if (tone === "gain") return "text-[10px] font-semibold tabular-nums text-[rgb(var(--signal-up))]";
  if (tone === "loss") return "text-[10px] font-semibold tabular-nums text-[rgb(var(--signal-down))]";
  return "text-[10px] font-semibold tabular-nums text-ink-muted";
}

/** Classi card portfolio Simulation (griglia block) per gain / loss / flat. */
export type PortfolioSimulationGridTheme = {
  card: string;
  leftBorder: { borderLeft: string };
  metric: string;
  metricMuted: string;
  label: string;
  fieldLabel: string;
  tickerSize: string;
  company: string;
};

const GRID_GAIN: PortfolioSimulationGridTheme = {
  card: PORTFOLIO_ROW_CLS.gain,
  leftBorder: { borderLeft: "4px solid rgb(22 163 74)" },
  metric: "rounded-lg border border-emerald-300/70 bg-white/95 px-2 py-1.5 shadow-sm min-w-0",
  metricMuted:
    "rounded-lg border border-emerald-200/80 bg-white/90 px-2 py-1.5 shadow-sm min-w-0",
  label: "text-[10px] uppercase tracking-wide text-emerald-900/75 font-semibold",
  fieldLabel:
    "text-[10px] uppercase tracking-wide text-emerald-900/80 flex items-center gap-1 font-semibold",
  tickerSize: "text-[18px] text-emerald-950",
  company: "text-[11px] text-emerald-900/85",
};

const GRID_LOSS: PortfolioSimulationGridTheme = {
  card: PORTFOLIO_ROW_CLS.loss,
  leftBorder: { borderLeft: "4px solid rgb(220 38 38)" },
  metric: "rounded-lg border border-rose-300/70 bg-white/95 px-2 py-1.5 shadow-sm min-w-0",
  metricMuted:
    "rounded-lg border border-rose-200/80 bg-white/90 px-2 py-1.5 shadow-sm min-w-0",
  label: "text-[10px] uppercase tracking-wide text-rose-900/75 font-semibold",
  fieldLabel:
    "text-[10px] uppercase tracking-wide text-rose-900/80 flex items-center gap-1 font-semibold",
  tickerSize: "text-[18px] text-rose-950",
  company: "text-[11px] text-rose-900/85",
};

const GRID_FLAT: PortfolioSimulationGridTheme = {
  card: PORTFOLIO_ROW_CLS.flat,
  leftBorder: { borderLeft: "4px solid rgb(148 163 184)" },
  metric: "rounded-lg border border-slate-200/80 bg-white/95 px-2 py-1.5 shadow-sm min-w-0",
  metricMuted:
    "rounded-lg border border-slate-200/70 bg-white/90 px-2 py-1.5 shadow-sm min-w-0",
  label: "text-[10px] uppercase tracking-wide text-slate-600 font-semibold",
  fieldLabel:
    "text-[10px] uppercase tracking-wide text-slate-600 flex items-center gap-1 font-semibold",
  tickerSize: "text-[18px] text-slate-900",
  company: "text-[11px] text-slate-600",
};

export function portfolioSimulationGridTheme(tone: PortfolioPnlTone): PortfolioSimulationGridTheme {
  if (tone === "loss") return GRID_LOSS;
  if (tone === "gain") return GRID_GAIN;
  return GRID_FLAT;
}

const GRID_WARN: PortfolioSimulationGridTheme = {
  card: "rounded-xl border border-[rgb(var(--warn))]/45 bg-[rgb(var(--panel-warn-bg))]/55 p-3 shadow-sm",
  leftBorder: { borderLeft: "4px solid rgb(var(--warn))" },
  metric:
    "rounded-lg border border-[rgb(var(--warn))]/35 bg-white/95 px-2 py-1.5 shadow-sm min-w-0",
  metricMuted:
    "rounded-lg border border-[rgb(var(--warn))]/25 bg-white/90 px-2 py-1.5 shadow-sm min-w-0",
  label: "text-[10px] uppercase tracking-wide text-[rgb(var(--warn))] font-semibold",
  fieldLabel:
    "text-[10px] uppercase tracking-wide text-[rgb(var(--warn))] flex items-center gap-1 font-semibold",
  tickerSize: "text-[18px] text-[rgb(var(--warn))]",
  company: "text-[11px] text-[rgb(var(--warn))]/85",
};

export function portfolioSimulationGridThemeFromOutlook(
  outlook: PortfolioTableOutlook,
): PortfolioSimulationGridTheme {
  if (outlook === "loss") return GRID_LOSS;
  if (outlook === "gain") return GRID_GAIN;
  if (outlook === "warn") return GRID_WARN;
  return GRID_FLAT;
}

export type PortfolioWinRateSummary = {
  gainCount: number;
  lossCount: number;
  flatCount: number;
  /** Posizioni con gain o loss (esclude flat / P&L non disponibile). */
  decisive: number;
  /** % posizioni in gain su decisive; null se nessuna posizione classificabile. */
  winPct: number | null;
};

export function summarizePortfolioWinRate(
  rows: ReadonlyArray<{
    pnlEur: number | null;
    pnlPct: number | null;
    pnlUnavailable?: boolean;
    pnlEur24h?: number | null;
    pnlPct24h?: number | null;
    /** Alias usato da chartData tab P&L. */
    pnlEurToday?: number | null;
    pnlPctToday?: number | null;
  }>,
): PortfolioWinRateSummary {
  let gainCount = 0;
  let lossCount = 0;
  let flatCount = 0;
  for (const row of rows) {
    if (row.pnlUnavailable) continue;
    const tone = portfolioPnlTone(row.pnlEur, row.pnlPct);
    if (tone === "gain") gainCount += 1;
    else if (tone === "loss") lossCount += 1;
    else flatCount += 1;
  }
  const decisive = gainCount + lossCount;
  const winPct = decisive > 0 ? (gainCount / decisive) * 100 : null;
  return { gainCount, lossCount, flatCount, decisive, winPct };
}

/**
 * Sfondo area blocchi tab P&L: >50% gain → verde chiaro; <50% → rosso; =50% → neutro.
 */
export function portfolioPnlTabShellClass(winPct: number | null): string {
  if (winPct == null) return "";
  if (winPct > 50) {
    return "rounded-xl px-3 py-3 bg-emerald-50/80 border border-emerald-200/70";
  }
  if (winPct < 50) {
    return "rounded-xl px-3 py-3 bg-rose-50/80 border border-rose-200/70";
  }
  return "";
}
