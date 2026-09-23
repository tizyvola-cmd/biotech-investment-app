/**
 * InvestmentSignalsPanel — "Segnali Attivi" tab del Decision Lab.
 *
 * v2: raccomandazioni testuali complete ancorate allo storico cohort
 * (target, stop loss, range rendimento atteso, confidence).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import {
  loadSimulationChartsBundle,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import { SlopeVerdictBanner } from "./SlopeVerdictBanner";
import { slopeVerdictContextFromSlopes } from "../sheet/slopeVerdictContext";
import { PrecatCurvePanel } from "./PrecatCurvePanel";
import {
  extractCurveInputs,
  classifyRegime,
  buildPrecatEntry,
  type PrecatEntryKind,
  type PrecatRegime,
  type PrecatEntrySignal,
} from "../sheet/precatCurve";
import {
  buildSlopeAwareTargetStop,
  type DynamicTargetMode,
} from "../sheet/dynamicTargetStop";
import {
  computeSlopeStability,
  stabilityVerdict,
  slopeStabilityLabel,
  slopeStabilityTone,
  verdictLabel,
  type SlopeStabilityClass,
  type StabilityVerdict,
} from "../sheet/slopeStability";
import {
  loadInvestmentDecisionCohort,
  type DecisionCohortDoc,
  type DecisionQuintile,
} from "../data/investmentDecisionData";
import {
  loadInvestmentTradeCalib,
  tradeCalibSummary,
  tradeCalibThreshold,
} from "../sheet/investmentTradeCalib";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import {
  currentPriceFromRow,
  rowHasActivePortfolio,
  positionPnlForOpenRow,
} from "../sheet/simulationPosition";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import {
  formatPositionPnlInline,
  formatPositionPnlSummary,
  portfolioDailyPnlValues,
  positionPnlToneClass,
  resolveSellTodayPnl,
} from "../sheet/portfolioGainLossStyle";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { decisionLabSignalDomId, matchDecisionLabSignalFocus, normalizedRowKey } from "../sheet/investSimKeys";
import { planRoiBundleFromGainPlan } from "../sheet/canonicalRoi";
import {
  readPred5RelativePp,
  resolveExpectedGainPlan,
  type ExpectedGainSource,
} from "../sheet/simulationPlanGain";
import {
  DEFAULT_PLAN_CAPITAL_EUR,
  ExpectedRoiCell,
  expectedRoiSourceLabel,
} from "../sheet/expectedRoiDisplay";
import {
  SIM_HOT_ZONE_DAYS,
  SIM_MONITOR_HORIZON_DAYS,
  WATCH_ZONE_MIN_R2,
  computeTimingPredictabilityPct,
  effectiveTimingHitPct,
  isHotZone,
  isWatchZone,
  resolveCdZone,
  type CdZone,
} from "../sheet/cdHorizons";
import {
  daysPastCd,
  isActiveCdMonitoring,
  isPastCatalystArchived,
  isPostCdWatch,
} from "../sheet/cdLifecycle";
import { seriesKeysFromSimRows } from "../sheet/recommendationTiers";
import { setActiveTopOpps } from "../sheet/topOppsStore";
import { setTop2BuySell, type Top2PrioritySignal } from "../sheet/top2BuySellStore";
import { roiPerDayFromPlan } from "../sheet/topOppQuality";
import { readLocalSdsSnapshot, type SdsRow } from "../api/supernova";
import {
  buildSdsByTicker,
  getCachedSdsForTopOpps,
  setCachedSdsForTopOpps,
  sdsExclusionLabel,
  sdsStrictPickFailures,
  isSdsExclusionReason,
  type SdsGateInfo,
} from "../sheet/sdsTopOppGate";
import { pickTop2BuyCandidates, pickTop2SellCandidates, pickWorstPortfolioCandidates, worstPortfolioReasons, type WorstPortfolioReason } from "../sheet/top2PortfolioPick";
import { buildTop2BuyPool } from "../sheet/top2FromSimulation";
import {
  clinicalIndicationFromSimRow,
  clinicalPhaseFromSimRow,
} from "../sheet/simRowClinicalMeta";
import { useT, useLang, t as tStatic, type AppLang, type TranslationKey } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { SignalScoreBar } from "./SignalScoreBar";
import { EisScoreBadge } from "./EisScoreBadge";
import { EisDetailDrawer } from "./EisDetailDrawer";
import {
  computeScoreBreakdown,
  resolveScoreGapPct,
} from "../sheet/investSignalScore";
import { sortByDealRank } from "../sheet/dealRankIcon";
import { upsideScorePipelineAdjust } from "../sheet/pipelineOpportunity";
import { DealRankBadge } from "./DealRankBadge";
import { SlopeAlertBanner } from "./SlopeAlertBanner";
import { buildSlopeAlertsFromSignalRows } from "../sheet/slopePositionAlerts";
import { SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY } from "../sheet/slopeThresholds";
import {
  clampUpsideThresholdPct,
  loadUpsideThresholdPct,
  saveUpsideThresholdPct,
  UPSIDE_THRESHOLD_MIN_PCT,
} from "../sheet/topOppsThreshold";

// ── helpers ────────────────────────────────────────────────────────────────

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

function toNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDMY(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysFromToday(s: string): number | null {
  const d = parseDMY(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  // Avoid misleading "+0.0%" for near-zero values: show 2 decimal places when |v| < 0.5
  const d = Math.abs(v) > 0 && Math.abs(v) < 0.5 ? 2 : digits;
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(d)}%`;
}

function round1(v: number): number { return Math.round(v * 10) / 10; }

/**
 * Formatta un prezzo in dollari. Sotto $10 mostra 3 decimali per i penny
 * stocks (ANIK ~3.20$, BCRX ~7.85$); sopra $10 ne basta 2.
 */
function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 3 : 2) : 2;
  return `$${v.toFixed(d)}`;
}

/** Applica una variazione percentuale (es. +5.0 → 1.05) a un prezzo. */
function applyPct(price: number, pct: number): number {
  return price * (1 + pct / 100);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Prezzo obiettivo mostrato in colonna compatta (high per rialzo, sell per ribasso). */
function targetDisplayUsd(
  rec: Recommendation,
  tgtHighUsd: number | null,
  sellUsd: number | null
): number | null {
  if (rec.dynamicMode === "fall" && sellUsd != null) return sellUsd;
  return tgtHighUsd;
}

/** Riempimento torta: avanzamento verso target (long) o vicinanza allo stop (fall). */
function targetProgressFill(
  rec: Recommendation,
  signal: {
    hasPosition: boolean;
    pnlPct: number | null;
    planReturnPct?: number | null;
    slope5d?: number | null;
    slope20d?: number | null;
    simRow?: Record<string, unknown>;
  }
): { ratio: number | null; tone: "up" | "warn" | "muted" } {
  if (!signal.hasPosition || signal.pnlPct == null) {
    return { ratio: null, tone: "muted" };
  }
  let s5 = signal.slope5d ?? null;
  let s20 = signal.slope20d ?? null;
  if (signal.simRow) {
    const c = extractCurveInputs(signal.simRow);
    if (s5 == null) s5 = c.slope5d;
    if (s20 == null) s20 = c.slope20d;
  }
  const risingHold =
    (signal.planReturnPct != null && signal.planReturnPct > 0) &&
    ((s5 != null && s5 > 0.1) || (s20 != null && s20 > 0.1));
  if (risingHold && rec.targetHighPct != null && rec.targetHighPct > 0) {
    return {
      ratio: clamp01(Math.max(0, signal.pnlPct) / rec.targetHighPct),
      tone: "up",
    };
  }
  if (rec.dynamicMode === "fall" && !risingHold && rec.sellTriggerPct != null && rec.sellTriggerPct < 0) {
    const goal = Math.abs(rec.sellTriggerPct);
    const ratio = goal > 0 ? clamp01(Math.abs(signal.pnlPct) / goal) : null;
    const near = signal.pnlPct <= rec.sellTriggerPct + 0.5;
    return { ratio, tone: near ? "warn" : "muted" };
  }
  if (rec.targetHighPct != null && rec.targetHighPct > 0) {
    return {
      ratio: clamp01(signal.pnlPct / rec.targetHighPct),
      tone: "up",
    };
  }
  return { ratio: null, tone: "muted" };
}

import { TargetDistanceDonut } from "./TargetDistanceDonut";

const AFFID_HIGH_THRESHOLD = 0.65;

function affidHighlightClass(affid: number | null): string {
  if (affid != null && affid >= AFFID_HIGH_THRESHOLD) {
    return "text-[rgb(var(--signal-up))] font-semibold";
  }
  return "";
}


// Soglie cohort coerenti con Diagnostica predittiva e Cohort storica.
const COHORT_HIT_RANDOM_HALFWIDTH_PP = 5; // 50 ± 5 pp
const COHORT_HIT_SOLID_PP = 60;

function isCohortInRandomZone(hit: number | null | undefined): boolean {
  if (hit == null || !Number.isFinite(hit)) return false;
  return Math.abs(hit - 50) <= COHORT_HIT_RANDOM_HALFWIDTH_PP;
}

// Colore della cella "Hit% atteso" — coerente con Cohort storica / Diagnostica.
// Edge solido (≥ 60) verde · random zone (50 ± 5) giallo · inversione (< 45) rosso.
function expectedHitCellClass(r: {
  expectedHitPct: number | null;
  expectedHitN: number;
}): string {
  const v = r.expectedHitPct;
  if (v == null || r.expectedHitN < 5) return "text-ink-muted/70";
  if (v >= COHORT_HIT_SOLID_PP) return "text-[rgb(var(--signal-up))] font-semibold";
  if (Math.abs(v - 50) <= COHORT_HIT_RANDOM_HALFWIDTH_PP) return "text-[rgb(var(--warn))]";
  if (v < 50 - COHORT_HIT_RANDOM_HALFWIDTH_PP) return "text-[rgb(var(--signal-down))]";
  return "text-ink";
}

function expectedHitCellTitle(r: {
  expectedHitPct: number | null;
  expectedHitQuintile: string | null;
  expectedHitN: number;
  expectedHitRandomZone: boolean;
}): string | undefined {
  if (r.expectedHitPct == null) {
    return "No match in historical cohort (Confidence missing or empty cohort)";
  }
  const parts: string[] = [];
  parts.push(`Historical Hit%: ${Math.round(r.expectedHitPct)}%`);
  if (r.expectedHitQuintile) parts.push(`quintile ${r.expectedHitQuintile}`);
  if (r.expectedHitN) parts.push(`n=${r.expectedHitN} events`);
  if (r.expectedHitN < 5) parts.push("⚠ small sample");
  else if (r.expectedHitRandomZone) parts.push("⚠ random zone (no edge)");
  else if (r.expectedHitPct >= COHORT_HIT_SOLID_PP) parts.push("✓ solid edge");
  return parts.join(" · ");
}

// ── Soglia rialzo atteso (Top Opportunità) ────────────────────────────────
//
// La logica predittiva si basa sull'andamento della curva (slope, run-up,
// trend pre-CD) — non più sull'esito clinico. Le Top Opportunità sono perciò
// società per cui ci aspettiamo un AUMENTO del prezzo nelle prossime
// settimane. L'utente può ricalibrare la soglia minima di pred5 dalla tab.

// ── Filtro qualità rigoroso (Top Opportunità) ────────────────────────────
//
// Quando attivo (default), esclude dalle Top:
//   - Segnali con Hit% storico < 50% (sotto random, sample affidabile n≥5)
//   - Segnali con Hit% in zona random (50 ± 5pp, sample affidabile n≥5)
//   - Segnali con stabilityVerdict ∈ {exit, avoid, watch}
//     (trend invertito, ribasso stabile, o pendenza poco coerente)
//
// Le Top Opportunità devono essere VERI candidati di rialzo con setup robusto.
// L'utente può disattivare per vedere anche segnali borderline.

// ── Soglia minima di Affidabilità per Top Opportunità ────────────────────────
//
// Diagnostica cohort (scripts/_diag_filtered_cohort.py) mostra che il modello
// ha edge REALE solo sopra Aff>=85% (Hit% 47–51%, edge +3.8pp vs random).
// Sotto Aff<70% il segnale è rumore o anti-correlato (Hit% 38–40%, sotto random).
//
// Default 70% = compromesso pratico (~ 50% del cohort, edge ≈ random ma non
// invertito). 85% = soglia di edge solido. L'utente può scegliere.

// Versione v2: cambiato default da 70 → 50 (Maggio 2026) perché 70% era troppo
// restrittivo e il portafoglio attivo aveva 0 candidati. 50% è il punto in cui
// almeno qualche posizione del portafoglio compare. L'utente può sempre
// alzarla via slider (consigliato 85% per "edge solido").
// Cambio chiave localStorage per resettare il default a 50 per gli utenti
// esistenti (altrimenti il vecchio 70 sopravvive in localStorage).
const MIN_AFFIDABILITA_KEY = "supernova_top_min_affidabilita_v2";
const MIN_AFFIDABILITA_DEFAULT = 50;

function loadMinAffidabilita(): number {
  if (typeof window === "undefined") return MIN_AFFIDABILITA_DEFAULT;
  try {
    const raw = localStorage.getItem(MIN_AFFIDABILITA_KEY);
    if (!raw) return MIN_AFFIDABILITA_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return MIN_AFFIDABILITA_DEFAULT;
    return Math.round(n);
  } catch {
    return MIN_AFFIDABILITA_DEFAULT;
  }
}

function saveMinAffidabilita(v: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MIN_AFFIDABILITA_KEY, String(v));
  } catch {
    /* ignore */
  }
}

// ── Pin manuale Top Opportunità ──────────────────────────────────────────────
//
// L'utente può forzare segnali specifici dentro le Top (anche se sotto soglia
// o altrimenti esclusi). Le chiavi sono `${ticker}|${cd}`. I segnali pinnati
// appaiono SEMPRE in cima alle Top con badge "📌 Pinned".

const PINNED_TOP_KEY = "supernova_pinned_top_v1";

function loadPinnedTop(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PINNED_TOP_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function savePinnedTop(pinned: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PINNED_TOP_KEY, JSON.stringify(Array.from(pinned)));
  } catch {
    /* ignore */
  }
}

type TopSortKey = "upside" | "pred5" | "affid";

function topSortValue(r: SignalRow, k: TopSortKey): number {
  switch (k) {
    case "upside": return r.upsideScore;
    case "pred5":  return r.pred5 ?? -Infinity;
    case "affid":  return r.affid ?? -Infinity;
  }
}


/**
 * upsideScore — punteggio per il ranking delle Top Opportunità.
 *
 * A differenza di `computeScore` (che pesa anche timing CD e affidabilità
 * generica del modello), questo score è ottimizzato per ordinare le società
 * che ci aspettiamo VEDRANNO un rialzo del titolo nelle prossime settimane:
 *
 *   - magnitudo predizione +5 SOLO se positiva (35 pt)
 *   - allineamento slope curva ↔ predizione (20 pt)
 *   - fit curva R² (20 pt) — perché la pred si basa sulla curva
 *   - affidabilità modello (15 pt) — adesso più debole
 *   - run-up moderato pre-CD ("clean trend", non BTR ipercomprato) (10 pt)
 *
 * Nessun peso al timing CD: la finestra è "prossime settimane", non legata
 * strettamente al catalizzatore (l'utente vuole anche pre-fase se la curva
 * indica upside).
 */
function computeUpsideScore(
  pred5: number | null,
  slope5d: number | null,
  affid: number | null,
  r2: number | null,
  runUp30d: number | null,
): number {
  // Razionale del ranking:
  //   - SLOPE della curva (5d) e QUALITÀ del modello (R² + Affidabilità) sono
  //     i driver primari. Una pred alta su un modello inaffidabile NON deve
  //     vincere su una pred modesta supportata da fit solido e curva in
  //     salita.
  //   - La pred è scalata da un "trust factor" composto da R²+Affidabilità:
  //     se trust = 0, la pred conta al 50%; se trust = 1, conta al 100%.
  //   - La curva in DISCESA penalizza fortemente (anche se pred > 0): il
  //     mercato sta osservando il contrario del modello.

  // ── Qualità composita / trust factor (0..1) ──────────────────────────────
  const r2Norm    = r2    != null ? Math.min(1, Math.max(0, r2))    : 0;
  const affidNorm = affid != null ? Math.min(1, Math.max(0, affid)) : 0;
  const trust = 0.5 * r2Norm + 0.5 * affidNorm;

  // ── Predizione (max 30, scalata da ``trust``) ────────────────────────────
  let predRaw = 0;
  if (pred5 != null && pred5 > 0) {
    if      (pred5 >= 10)  predRaw = 30;
    else if (pred5 >=  5)  predRaw = 25;
    else if (pred5 >=  3)  predRaw = 18;
    else if (pred5 >= 1.5) predRaw = 12;
    else if (pred5 >= 0.5) predRaw =  6;
    else                   predRaw =  1;
  }
  const predScore = predRaw * (0.5 + 0.5 * trust);

  // ── Slope alignment (curva ↔ pred) — max ±25 ─────────────────────────────
  // Slope positivo = curva osservata coerente col rialzo predetto.
  // Slope negativo con pred > 0 = inversione visiva → penalità forte.
  let slopeAlign = 0;
  if (slope5d != null && pred5 != null && pred5 > 0) {
    if      (slope5d >  0.5)  slopeAlign =  25;
    else if (slope5d >  0.2)  slopeAlign =  18;
    else if (slope5d >  0)    slopeAlign =   8;
    else if (slope5d > -0.5)  slopeAlign = -12;
    else                      slopeAlign = -22;
  } else if (slope5d != null && slope5d > 0.3 && pred5 == null) {
    slopeAlign = 8;
  }

  // ── Bonus qualità (additivo) — max 30 ────────────────────────────────────
  // Quando R² e Affidabilità sono alti, il segnale guadagna punti anche se
  // la pred è modesta: il modello sta funzionando per questo ticker.
  const qualityBonus = (r2Norm + affidNorm) * 15;

  // ── Penalità qualità troppo bassa ────────────────────────────────────────
  // Diagnosi cohort: con R² < 0.30 il fit è rumore; con Affidabilità < 0.40
  // il cohort storico non offre edge. Sommiamo le penalità per declassare i
  // segnali "noise" anche se la pred grezza è alta.
  let qualityPenalty = 0;
  if (r2    != null && r2    < 0.30) qualityPenalty -= 10;
  const affMinFrac = tradeCalibThreshold("affid_min_pct_for_quality") / 100;
  if (affid != null && affid < affMinFrac) qualityPenalty -= 10;

  // ── Trend bonus (run-up 30d) ─────────────────────────────────────────────
  let trendBonus = 0;
  if (runUp30d != null) {
    if      (runUp30d >= 5 && runUp30d <= 25) trendBonus =  8;
    else if (runUp30d >  25)                   trendBonus = -5;
    else if (runUp30d < -10)                   trendBonus = -3;
  }

  return Math.round(
    predScore + slopeAlign + qualityBonus + qualityPenalty + trendBonus
  );
}

// ── score ──────────────────────────────────────────────────────────────────

function computeScore(
  affid: number | null, r2: number | null,
  pred5: number | null, days: number | null,
  slope5d: number | null = null,
  gapPct: number | null = null,
  slope20d: number | null = null,
): number {
  return computeScoreBreakdown(affid, r2, pred5, days, slope5d, gapPct, slope20d).total;
}

type ActionKind = "forte" | "watch" | "monitor" | "skip" | "short" | "exit";

function actionKind(
  score: number, pred5: number | null,
  days: number | null, pnlPct: number | null, hasPosition: boolean,
  slope5d: number | null = null,
): ActionKind {
  if (hasPosition && days != null && days <= 3 && pnlPct != null && pnlPct > 5) return "exit";
  if (hasPosition && isPostCdWatch(days)) return "exit";
  if (isPastCatalystArchived(days)) return "skip";
  if (days != null && days < 0) return "skip";

  // Hard block: pred5 chiaramente negativa → mai BUY, nemmeno con posizione aperta.
  // Impedisce che il fallback slope5d promuova a "watch" ticker con predizione bearish.
  const predClearlyNegative =
    pred5 != null && pred5 < -tradeCalibThreshold("pred_significant_pp");
  if (predClearlyNegative) {
    if (hasPosition && days != null && days <= 7) return "exit";
    return "skip";
  }

  // ── Direzione: pred5 se chiara, altrimenti slope come fallback ───────────
  //
  // Quando ``pred5`` è quasi zero (|pred5| < 0.5pp) il modello non offre
  // direzione attendibile; in tal caso usiamo la pendenza recente della curva
  // osservata (``slope5d``, soglia ±0.3 pp/d) come direzione primaria.
  //
  // Senza questo fallback, ticker con curva chiaramente in salita (PTGX
  // pred +0.09% slope ↑↑) o in discesa (CNSP pred +0.03% slope ↓↓) finivano
  // in MONITOR (pillolo WATCH giallo) ignorando il segnale visivo della curva.
  // Ora la curva osservata guida la direzione quando la pred è inconclusiva.
  const predSignificant  = pred5 != null && Math.abs(pred5) >= tradeCalibThreshold("pred_significant_pp");
  const slopeSignificant =
    slope5d != null && Math.abs(slope5d) >= tradeCalibThreshold("slope_significant_pp_per_day");
  let direction: "long" | "short" | null = null;
  if (predSignificant) {
    direction = pred5! > 0 ? "long" : "short";
  } else if (slopeSignificant) {
    direction = slope5d! > 0 ? "long" : "short";
  }
  const isLong  = direction === "long";
  const isShort = direction === "short";

  // Setup contrarian: curva pre-cat e pred5 puntano in direzioni opposte.
  // Cap a convinzione ridotta — "forte" richiede che slope e predizione siano allineati.
  // (Si applica solo quando pred5 è abbastanza grande da avere un segno significativo.)
  const isContrarian =
    slope5d != null && pred5 != null && Math.abs(pred5) >= 1 &&
    (slope5d > 0) !== (pred5 > 0);
  const scoreForte = tradeCalibThreshold("score_forte_min");
  const scoreWatch = tradeCalibThreshold("score_watch_min");
  const scoreMonitor = tradeCalibThreshold("score_monitor_min");
  if (score >= scoreForte && isLong)  return isContrarian ? "watch"   : "forte";
  if (score >= scoreWatch && isLong)  return "watch";
  if (score >= scoreWatch + 8 && isShort) return isContrarian ? "monitor" : "short";
  // Posizione aperta: soglia abbassata — se sei già investito, qualsiasi segnale positivo
  // con score decente merita "watch" per essere visibile nelle card Top Opportunità
  if (hasPosition && score >= scoreMonitor - 6 && isLong)  return "watch";
  if (hasPosition && score >= scoreMonitor - 6 && isShort) return "short";
  if (score >= scoreMonitor) return "monitor";
  return "skip";
}

function timingLabel(days: number | null): string {
  if (days == null) return "—";
  if (isPostCdWatch(days)) {
    const past = daysPastCd(days);
    return past != null
      ? tStatic("signals.timing.postCdWatchDays", { days: past })
      : tStatic("signals.timing.postCdWatch");
  }
  if (isPastCatalystArchived(days)) return tStatic("signals.timing.pastCatalyst");
  if (days < 0) return tStatic("signals.timing.past");
  if (days === 0) return "⚡ " + tStatic("common.now");
  if (days <= 3) return tStatic("signals.timing.lastDays");
  if (days <= 7) return tStatic("signals.timing.urgent");
  if (days <= 14) return "✓ Optimal zone";
  if (days <= 30) return tStatic("signals.timing.openWindow");
  if (days <= SIM_HOT_ZONE_DAYS) return tStatic("signals.timing.prePhase");
  if (days <= SIM_MONITOR_HORIZON_DAYS) return tStatic("signals.timing.watchZone");
  return tStatic("signals.timing.tooEarly");
}

/** Chip timing in card Top Opp: solo finestre urgenti (no Open window / pre-phase). */
function showOpportunityTimingChip(days: number | null): boolean {
  if (days == null || days < 0) return false;
  return days <= 14;
}

function sizeHint(score: number, affid: number | null, r2: number | null): string {
  const a = affid ?? 0, r = r2 ?? 0;
  if (score >= 68 && a >= 0.65 && r >= 0.5) return "8–15%";
  if (score >= 52 && a >= 0.50 && r >= 0.35) return "3–8%";
  if (score >= 38) return "1–3%";
  return "Evita";
}

// ── recommendation builder ─────────────────────────────────────────────────

type Recommendation = {
  entry: string;
  targetRange: string;
  stopLoss: string;
  exitTrigger: string;
  historicalRef: string;
  caveats: string[];
  biasNote: string | null;
  // Valori numerici grezzi per ricostruire target/stop in $
  // a partire dal prezzo corrente del titolo (vedi currentPriceFromRow).
  targetLowPct: number | null;   // % (es. +2.0 oppure -2.0)
  targetHighPct: number | null;  // % (es. +8.0 oppure -1.0)
  stopPct: number | null;        // % (es. -5.0 oppure +5.0 per short)
  targetAvailable: boolean;
  targetSource: "pred" | "cohort" | "slope" | "none";
  isLong: boolean;
  /** Target/stop da pendenza curva (precat), se disponibile. */
  dynamicMode: DynamicTargetMode | null;
  sellTriggerPct: number | null;
  probReboundPct: number | null;
  modelHint: string | null;
  slopeDetail: string | null;
};

function matchQuintile(
  affidFrac: number | null,
  quintiles: DecisionQuintile[]
): DecisionQuintile | null {
  if (!quintiles.length || affidFrac == null) return null;
  const pct = affidFrac * 100;
  return (
    quintiles.find((q) => pct >= q.aff_min && pct <= q.aff_max) ??
    quintiles[quintiles.length - 1]
  );
}

/**
 * Bias correction per segmento.
 * Prova a matchare in ordine: fase clinica (più specifico) → indicazione → direzione.
 * Restituisce il primo match con n ≥ 3 (fase/direzione) o n ≥ 5 (indicazione).
 */
function findBiasForSignal(
  pred5: number | null,
  row: Record<string, unknown>,
  cols: string[],
  segGroups: DecisionCohortDoc["segment_groups"],
): { bias: number; segLabel: string; n: number } | null {
  if (!segGroups?.length) return null;

  const colPhase = cols.find((c) =>
    c.toLowerCase().includes("fase") || c.toLowerCase().includes("phase"),
  );
  const colIndie = cols.find((c) =>
    c.toLowerCase().includes("indicaz") ||
    c.toLowerCase().includes("indication") ||
    c.toLowerCase().includes("terapeutic"),
  );

  const phaseRaw = colPhase ? String(row[colPhase] ?? "").toLowerCase().trim() : "";
  const indieRaw = colIndie ? String(row[colIndie] ?? "").toLowerCase().trim() : "";

  function normPhase(v: string): string {
    return v
      .replace(/\biii\b/g, "3").replace(/\bii\b/g, "2")
      .replace(/\biv\b/g, "4").replace(/\bi\b/g, "1").trim();
  }

  type Candidate = { bias: number; segLabel: string; n: number; priority: number };
  const candidates: Candidate[] = [];

  for (const g of segGroups) {
    const gid    = g.id.toLowerCase();
    const gtitle = g.title.toLowerCase();

    // ① Fase clinica (priority 3 — più specifico)
    if (phaseRaw && (gid.includes("phase") || gid.includes("fase") || gtitle.includes("fase") || gtitle.includes("phase"))) {
      const seg = g.segments.find((s) => {
        if (s.n_ic_pairs < 3 || s.mean_pred_bias_pp == null) return false;
        const sl = normPhase(s.label.toLowerCase());
        const pv = normPhase(phaseRaw);
        return sl.includes(pv) || pv.includes(sl);
      });
      if (seg?.mean_pred_bias_pp != null) {
        candidates.push({ bias: seg.mean_pred_bias_pp, segLabel: `${g.title} → ${seg.label}`, n: seg.n_ic_pairs, priority: 3 });
      }
    }

    // ② Indicazione terapeutica (priority 3, require n ≥ 5 per robustezza)
    if (indieRaw && (gid.includes("indic") || gtitle.includes("indicaz") || gtitle.includes("terapeutic") || gtitle.includes("indication"))) {
      const words = indieRaw.split(/[\s,/]+/).filter((w) => w.length >= 4);
      const seg = g.segments.find((s) => {
        if (s.n_ic_pairs < 5 || s.mean_pred_bias_pp == null) return false;
        const sl = s.label.toLowerCase();
        return words.some((w) => sl.includes(w));
      });
      if (seg?.mean_pred_bias_pp != null) {
        candidates.push({ bias: seg.mean_pred_bias_pp, segLabel: `${g.title} → ${seg.label}`, n: seg.n_ic_pairs, priority: 3 });
      }
    }

    // ③ Direzione predittiva (priority 2 — sempre disponibile)
    if (gid === "direction" || gtitle.includes("direz") || gtitle.includes("direction")) {
      if (pred5 != null) {
        const dirKey = pred5 >= 0.5 ? "long" : pred5 <= -0.5 ? "short" : "neutro";
        const seg = g.segments.find(
          (s) => s.n_ic_pairs >= 3 && s.mean_pred_bias_pp != null &&
                 s.label.toLowerCase().includes(dirKey),
        );
        if (seg?.mean_pred_bias_pp != null) {
          candidates.push({ bias: seg.mean_pred_bias_pp, segLabel: `${g.title} → ${seg.label}`, n: seg.n_ic_pairs, priority: 2 });
        }
      }
    }
  }

  if (!candidates.length) return null;
  // Più specifico prima → poi più dati
  candidates.sort((a, b) => b.priority - a.priority || b.n - a.n);
  return candidates[0];
}

function buildRecommendation(
  signal: SignalRow,
  quintile: DecisionQuintile | null,
): Recommendation {
  const meanR  = quintile?.mean_r_hold_pp ?? null;
  const hitPct = quintile?.hit_rate_pct ?? null;
  const n      = quintile?.n ?? 0;
  const isLongDir = signal.action !== "short";

  // Stima puntuale: usa la predizione GIÀ bias-corretta (pred5) come ancora primaria,
  // con storico quintile come fallback.
  //
  // Soglia abbassata a 0.5pp: predizioni più piccole sono rumore o fallback Excel
  // (es. il caso noto "Pred +5 = +0.08%" per tutti i ticker quando manca
  // calibration_state.json). In quei casi cadiamo sul meanR del cohort, che però
  // è quasi identico per Q2/Q3 e produce target/stop fissi e poco informativi.
  const PRED_USABLE_MAG = 0.5;
  const corrPred = (signal.pred5 != null && Math.abs(signal.pred5) >= PRED_USABLE_MAG) ? signal.pred5 : null;
  // Se anche il meanR del quintile è in zona rumore (< 0.5pp), non lo usiamo:
  // produrrebbe target ingannevoli "tutti uguali" derivati da una media debole.
  const meanRUsable = meanR != null && Math.abs(meanR) >= PRED_USABLE_MAG ? meanR : null;
  const pointEst = corrPred ?? meanRUsable;

  // Source del target: serve per il display ("~cohort" se derivato dal meanR storico).
  let targetSource: "pred" | "cohort" | "slope" | "none" = "none";
  if (corrPred != null) targetSource = "pred";
  else if (meanRUsable != null) targetSource = "cohort";

  let targetLow = 2, targetHigh = 8, stop = -8;
  let targetAvailable = false;
  if (pointEst != null && isLongDir && pointEst > 0) {
    targetLow  = round1(Math.max(1,  pointEst * 0.4));
    targetHigh = round1(pointEst * 1.6);
    stop       = -round1(Math.max(5, pointEst * 0.6));
    // Se c'è storico quintile, allarga il cap superiore al meglio dei due
    if (meanRUsable != null && meanRUsable > 0) targetHigh = round1(Math.max(targetHigh, meanRUsable * 1.8));
    targetAvailable = true;
  } else if (pointEst != null && !isLongDir && pointEst < 0) {
    targetLow  = round1(Math.min(-2, pointEst * 1.4));
    targetHigh = round1(Math.min(-1, pointEst * 0.6));
    stop       = round1(Math.max(5, Math.abs(pointEst) * 0.7));
    targetAvailable = true;
  } else if (meanRUsable != null && isLongDir && meanRUsable > 0) {
    targetLow  = round1(Math.max(1, meanRUsable * 0.5));
    targetHigh = round1(meanRUsable * 2.0);
    stop       = -round1(Math.max(5, meanRUsable * 0.8));
    targetAvailable = true;
  } else if (meanRUsable != null && !isLongDir && meanRUsable < 0) {
    // Short con meanR negativo nel quintile: target negativo, stop positivo
    targetLow  = round1(Math.min(-2, meanRUsable * 1.4));
    targetHigh = round1(Math.min(-1, meanRUsable * 0.6));
    stop       = round1(Math.max(5, Math.abs(meanRUsable) * 0.8));
    targetAvailable = true;
  }
  // Altrimenti targetAvailable resta false → display "—"

  const d = signal.days;
  const { slope20d: s20, slope5d: s5, slope45d: s45, runUp30d: ru30 } =
    extractCurveInputs(signal.simRow);

  // Target/stop dinamici da pendenza (sovrascrive statico quando CD futuro e slope chiara).
  const dynamicTs = buildSlopeAwareTargetStop({
    slope5d: s5,
    slope20d: s20,
    slope45d: s45,
    runUp30d: ru30,
    days: d,
    isLong: isLongDir,
    stabilityVerdict: signal.stabilityVerdict,
    rotationFlag: signal.slopeRotationFlag,
  });
  let dynamicMode: DynamicTargetMode | null = null;
  let sellTriggerPct: number | null = null;
  let probReboundPct: number | null = null;
  let modelHint: string | null = null;
  let slopeDetail: string | null = null;
  if (dynamicTs) {
    targetLow = dynamicTs.targetLowPct;
    targetHigh = dynamicTs.targetHighPct;
    stop = dynamicTs.stopPct;
    targetAvailable = true;
    targetSource = "slope";
    dynamicMode = dynamicTs.mode;
    sellTriggerPct = dynamicTs.sellTriggerPct;
    probReboundPct = dynamicTs.probReboundPct;
    modelHint = dynamicTs.modelHint;
    slopeDetail = dynamicTs.detail;
  }

  // Testo ingresso — arricchito con regime precat (compra basso, vendi alto)
  const regime: PrecatRegime = classifyRegime(ru30);
  const isLong = signal.action !== "short";

  // BTR + CD vicino → sell-the-news probabile
  const isBtrSellZone = regime === "btr" && isLong && d != null && d > 0 && d < 10;

  let entry: string;
  if (isBtrSellZone) {
    entry = `⚠ Sell before CD · stock already priced-in, sell-the-news likely (BTR, CD in ${d} d)`;
  } else {
    const entryWhen =
      d == null ? "soon" :
      d <= 0    ? "IMMEDIATELY — CD imminent" :
      d <= 3    ? `IMMEDIATELY (${d} ${d === 1 ? "day" : "days"} to CD)` :
      d <= 7    ? "Late entry" :
      d <= 15   ? "Optimal window — buy now" :
      d <= 30   ? "Entry zone — accumulate gradually" :
                  "Too early — wait for T-30 zone";
    entry = `${isLong ? "Buy" : "Short"} ${entryWhen} · max ${signal.size} of portfolio`;
  }

  // Target range
  //   - Se non abbiamo dati utili (no pred significativa, no meanR utile) → "—"
  //   - Se è derivato dal cohort (no pred) → marcato con "~cohort"
  //   - Per gli short, prefisso "↓ short" per evitare confusione (target negativi)
  const sourceTag =
    targetSource === "cohort"
      ? " ~cohort"
      : targetSource === "slope"
        ? " · slope"
        : "";
  const directionTag =
    !targetAvailable
      ? ""
      : signal.action === "short"
        ? "↓ "
        : "↑ ";
  const targetRange = !targetAvailable
    ? "—"
    : `${directionTag}${fmtPct(targetLow)} → ${fmtPct(targetHigh)}${sourceTag}`;

  // Testo stop loss e uscita
  const stopLoss = !targetAvailable
    ? "—"
    : signal.action === "short"
      ? `+${stop}%`
      : `${fmtPct(stop)}`;

  const sellAt = sellTriggerPct ?? stop;
  const exitTrigger = !targetAvailable
    ? "No reliable target — prediction too low and cohort not significant"
    : dynamicMode === "fall" && sellAt != null
      ? `Hold while above ${fmtPct(sellAt)} — mandatory sell if P&L drops below (rebound prob ${probReboundPct ?? "—"}%)`
      : dynamicMode === "rise"
        ? `Upside to target ${fmtPct(targetLow)}→${fmtPct(targetHigh)} per model slope — stop ${stopLoss}`
        : signal.hasPosition
          ? (() => {
              const pnl = positionPnlFromSignal(signal);
              if (!pnl) {
                return `Exit if it reaches the target or drops below ${stopLoss}`;
              }
              const pctNum = pnl.pct !== "—" ? parseFloat(pnl.pct.replace("%", "")) : null;
              const pctVal = pctNum != null && Number.isFinite(pctNum) ? pctNum : signal.pnlPct;
              return `Current P&L ${formatPositionPnlInline(signal.pnlEur, signal.pnlPct, {
                pnlEur24h: signal.pnlEur24h,
                pnlPct24h: signal.pnlPct24h,
              }, { dayLabel: "day" })} · ${
                pctVal != null && pctVal >= (targetLow + targetHigh) / 2
                  ? "near target — consider partial exit"
                  : pctVal != null && sellAt != null && pctVal < sellAt
                    ? "below dynamic stop — sell"
                    : "hold until target or stop is reached"
              }`;
            })()
          : `Exit if it reaches the target or drops below ${stopLoss}`;

  // Riferimento storico
  // hitPct = % volte la curva si è mossa nella direzione predetta (↑/↓) — non legato al successo dello studio
  const hitLabel =
    hitPct == null   ? "" :
    hitPct >= 60     ? `${hitPct}% dir.acc.↑/↓ (solid edge)` :
    hitPct >= 52     ? `${hitPct}% dir.acc.↑/↓ (marginal edge)` :
                       `${hitPct}% dir.acc.↑/↓ (no edge)`;
  const historicalRef =
    n > 0 && hitPct != null
      ? `Similar history: ${n} events · avg return ${fmtPct(meanR)} · ${hitLabel}`
      : n > 0
      ? `Similar history: ${n} events · avg return ${fmtPct(meanR)}`
      : "Insufficient historical data for this quintile";

  // Caveats
  const caveats: string[] = [];
  if (signal.r2 != null && signal.r2 < 0.3) caveats.push(tStatic("signals.caveat.weakR2"));
  if (signal.inferenza.toLowerCase().includes("esplorat")) caveats.push(tStatic("signals.caveat.exploratory"));
  if (signal.pred5 != null && Math.abs(signal.pred5) < 1) caveats.push(tStatic("signals.caveat.predNearZero"));
  if (signal.affid != null && signal.affid < 0.40) caveats.push(tStatic("signals.caveat.lowConfidence"));
  if (n < 5) caveats.push(tStatic("signals.caveat.fewEvents"));
  // Regime-specific warnings
  if (regime === "btr") caveats.push(tStatic("signals.caveat.btr"));
  if (regime === "ctr") caveats.push(tStatic("signals.caveat.ctr"));
  if (s20 != null && s5 != null && (s5 - s20) <= -SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY)
    caveats.push(`Slope deceleration (slope5d ${s5 >= 0 ? "+" : ""}${s5.toFixed(2)} < slope20d ${s20 >= 0 ? "+" : ""}${s20.toFixed(2)} pp/d) — monitor`);
  // Setup contrarian: curva e pred5 puntano in direzioni opposte
  if (s5 != null && signal.pred5 != null && Math.abs(signal.pred5) >= 1 && (s5 > 0) !== (signal.pred5 > 0))
    caveats.push(
      `Contrarian setup: curve ${s5 > 0 ? "↑" : "↓"} but pred ${signal.pred5 > 0 ? "↑" : "↓"} — higher risk, score penalised`
    );

  // Nota bias — usa i campi già calcolati sul segnale
  let biasNote: string | null = null;
  if (signal.biasCorrection != null && Math.abs(signal.biasCorrection) >= 1 && signal.pred5Raw != null) {
    const dir = signal.biasCorrection > 0 ? "overestimate" : "underestimate";
    biasNote =
      `Historical bias (${signal.biasSegLabel ?? "segment"}): model ${dir} by ` +
      `${Math.abs(round1(signal.biasCorrection))} pp · ` +
      `prediction corrected from ${fmtPct(signal.pred5Raw)} → ${fmtPct(signal.pred5)} · targets adjusted`;
  }

  return {
    entry, targetRange, stopLoss, exitTrigger, historicalRef, caveats, biasNote,
    targetLowPct:    targetAvailable ? targetLow  : null,
    targetHighPct:   targetAvailable ? targetHigh : null,
    stopPct:         targetAvailable ? stop       : null,
    targetAvailable,
    targetSource,
    isLong,
    dynamicMode,
    sellTriggerPct,
    probReboundPct,
    modelHint,
    slopeDetail,
  };
}

/** Dettaglio completo target/stop (popover al passaggio del mouse). */
function TargetStopDetailPanel({
  rec,
  signal,
  curPrice,
  lang,
  hasUsd,
  tgtLowUsd,
  tgtHighUsd,
  stopUsd,
  sellUsd,
  isSpeculative,
}: {
  rec: Recommendation;
  signal: {
    action: ActionKind;
    hasPosition: boolean;
    pnlPct: number | null;
    pnlEur: number | null;
    pnlEur24h: number | null;
    pnlPct24h: number | null;
    score: number;
  };
  curPrice: number | null;
  lang: AppLang;
  hasUsd: boolean;
  tgtLowUsd: number | null;
  tgtHighUsd: number | null;
  stopUsd: number | null;
  sellUsd: number | null;
  isSpeculative: boolean;
}) {
  const dirTag = rec.isLong ? "↑" : "↓";
  const sourceBadge =
    rec.targetSource === "slope"
      ? lang === "it"
        ? "pendenza"
        : "slope"
      : rec.targetSource === "cohort"
        ? "~cohort"
        : rec.targetSource === "pred"
          ? "pred+5"
          : null;
  const modeBadge =
    rec.dynamicMode === "rise"
      ? lang === "it"
        ? "rialzo"
        : "rise"
      : rec.dynamicMode === "fall"
        ? lang === "it"
          ? "ribasso"
          : "fall"
        : null;
  const tgtCls = isSpeculative
    ? "text-[rgb(var(--signal-up))]/55"
    : "text-[rgb(var(--signal-up))]";
  const stopCls = isSpeculative
    ? "text-[rgb(var(--signal-down))]/55"
    : "text-[rgb(var(--signal-down))]";
  const stopLabel =
    rec.dynamicMode === "fall"
      ? lang === "it"
        ? "Vendi sotto"
        : "Sell below"
      : lang === "it"
        ? "Stop"
        : "Stop";

  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      <p className="text-[10px] font-semibold text-ink border-b border-[rgb(var(--border))]/50 pb-1">
        {lang === "it" ? "Target · Stop — dettaglio" : "Target · Stop — details"}
      </p>
      {(sourceBadge || modeBadge) && (
        <div className="flex flex-wrap gap-1">
          {modeBadge && (
            <span
              className={`text-[8px] uppercase tracking-wide font-bold px-1 py-px rounded border ${
                rec.dynamicMode === "rise"
                  ? "border-[rgb(var(--signal-up))]/35 text-[rgb(var(--signal-up))] bg-[rgb(var(--signal-up))]/8"
                  : "border-[rgb(var(--warn))]/40 text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/10"
              }`}
            >
              {dirTag} {modeBadge}
            </span>
          )}
          {sourceBadge && (
            <span className="text-[8px] uppercase tracking-wide text-ink-muted/70 px-1 py-px rounded border border-[rgb(var(--border))]/40">
              {sourceBadge}
            </span>
          )}
        </div>
      )}
      <div className={tgtCls}>
        <span className="text-[9px] uppercase tracking-wide text-ink-muted/75 mr-1">
          {lang === "it" ? "Intervallo target" : "Target range"}
        </span>
        {hasUsd ? (
          <>
            <span className="tabular-nums font-semibold">
              {fmtUsd(tgtLowUsd)}→{fmtUsd(tgtHighUsd)}
            </span>
            <span className="ml-1 tabular-nums opacity-85">
              ({fmtPct(rec.targetLowPct)}→{fmtPct(rec.targetHighPct)})
            </span>
          </>
        ) : (
          <span>{rec.targetRange}</span>
        )}
      </div>
      <div className={stopCls}>
        <span className="text-[9px] uppercase tracking-wide text-ink-muted/75 mr-1">
          {stopLabel}
        </span>
        {hasUsd ? (
          <>
            <span className="tabular-nums font-semibold">
              {fmtUsd(
                rec.dynamicMode === "fall" && sellUsd != null ? sellUsd : stopUsd
              )}
            </span>
            <span className="ml-1 tabular-nums opacity-85">
              (
              {fmtPct(
                rec.sellTriggerPct != null ? rec.sellTriggerPct : rec.stopPct!
              )}
              )
            </span>
          </>
        ) : (
          <span>{rec.stopLoss}</span>
        )}
      </div>
      {curPrice != null && curPrice > 0 ? (
        <p className="text-[10px] text-ink-muted/80">
          {lang === "it" ? "Prezzo attuale" : "Current price"}:{" "}
          <span className="tabular-nums font-medium text-ink">{fmtUsd(curPrice)}</span>
          {signal.hasPosition ? (() => {
            const pnl = positionPnlFromSignal(signal);
            if (!pnl) return null;
            return (
              <span className={`ml-1 tabular-nums ${positionPnlToneClass(pnl.tone)}`}>
                · P&L {pnl.pct !== "—" ? pnl.pct : pnl.amount}
                {pnl.dailyPart ? (
                  <span className="font-normal opacity-90">
                    {" · "}{lang === "it" ? "Oggi" : "Day"} {pnl.dailyPart}
                  </span>
                ) : pnl.pct !== "—" ? (
                  <span className="font-normal opacity-90"> ({pnl.amount})</span>
                ) : null}
              </span>
            );
          })() : null}
        </p>
      ) : null}
      {rec.modelHint ? (
        <p
          className={`text-[10px] leading-snug ${
            rec.dynamicMode === "rise"
              ? "text-[rgb(var(--signal-up))]/90"
              : rec.dynamicMode === "fall"
                ? "text-[rgb(var(--warn))]"
                : "text-ink-muted/70"
          }`}
        >
          {rec.modelHint}
        </p>
      ) : rec.targetSource !== "slope" ? (
        <p className="text-[10px] text-ink-muted/70 leading-snug">
          {lang === "it"
            ? "Usa «Aggiorna segnali» per target da pendenza live"
            : "Use «Update signals» for slope-based targets"}
        </p>
      ) : null}
      {rec.slopeDetail ? (
        <p className="text-[10px] text-ink-muted/75 leading-snug border-t border-[rgb(var(--border))]/40 pt-1">
          {rec.slopeDetail}
        </p>
      ) : null}
      {rec.exitTrigger ? (
        <p className="text-[10px] text-ink-muted/80 leading-snug">{rec.exitTrigger}</p>
      ) : null}
      {isSpeculative ? (
        <p className="text-[10px] text-ink-muted/60 italic">
          {lang === "it"
            ? `Stima indicativa — ${signal.action} (score ${signal.score})`
            : `Speculative — ${signal.action} (score ${signal.score})`}
        </p>
      ) : null}
    </div>
  );
}

/** Colonna compatta: prezzo obiettivo + torta distanza; dettagli al hover. */
function TargetStopTableCell({
  rec,
  signal,
  curPrice,
  lang,
}: {
  rec: Recommendation;
  signal: {
    action: ActionKind;
    pred5: number | null;
    days: number | null;
    hasPosition: boolean;
    pnlPct: number | null;
    pnlEur: number | null;
    pnlEur24h: number | null;
    pnlPct24h: number | null;
    score: number;
    planReturnPct?: number | null;
    slope5d?: number | null;
    slope20d?: number | null;
    simRow?: Record<string, unknown>;
  };
  curPrice: number | null;
  lang: AppLang;
}) {
  const t = useT();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(
    null
  );

  const isUncomputable =
    signal.pred5 == null || (signal.days != null && signal.days < -3);
  const isSpeculative = signal.action === "monitor" || signal.action === "skip";

  const openPopover = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 288;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    setPopoverPos({ top: r.bottom + 6, left: Math.max(8, left) });
    setHoverOpen(true);
  }, []);

  if (isUncomputable) {
    return (
      <span
        className="text-ink-muted/50"
        title={
          signal.pred5 == null
            ? lang === "it"
              ? "Target/Stop non calcolabile: manca predizione +5g"
              : "Target/Stop not calculable: +5d prediction missing"
            : lang === "it"
              ? "CD passato da >3 giorni — finestra operativa chiusa"
              : "CD passed more than 3 days ago — operational window closed"
        }
      >
        —
      </span>
    );
  }

  const hasUsd =
    curPrice != null &&
    curPrice > 0 &&
    rec.targetLowPct != null &&
    rec.targetHighPct != null &&
    rec.stopPct != null;
  const tgtLowUsd = hasUsd ? applyPct(curPrice!, rec.targetLowPct!) : null;
  const tgtHighUsd = hasUsd ? applyPct(curPrice!, rec.targetHighPct!) : null;
  const stopUsd = hasUsd ? applyPct(curPrice!, rec.stopPct!) : null;
  const sellUsd =
    hasUsd && rec.sellTriggerPct != null
      ? applyPct(curPrice!, rec.sellTriggerPct)
      : null;
  const displayUsd = targetDisplayUsd(rec, tgtHighUsd, sellUsd);
  const { ratio, tone } = targetProgressFill(rec, signal);
  const nearSell =
    rec.dynamicMode !== "rise" &&
    tone !== "up" &&
    signal.hasPosition &&
    signal.pnlPct != null &&
    rec.sellTriggerPct != null &&
    signal.pnlPct <= rec.sellTriggerPct + 0.5;
  const isFallExit = rec.dynamicMode === "fall" && tone !== "up";
  const primaryCls = isFallExit
    ? nearSell
      ? "text-[rgb(var(--signal-down))]"
      : "text-[rgb(var(--warn))]"
    : isSpeculative
      ? "text-[rgb(var(--signal-up))]/55"
      : "text-[rgb(var(--signal-up))]";

  const hoverHint =
    lang === "it"
      ? "Passa il mouse per intervallo, stop e note"
      : "Hover for range, stop and notes";

  return (
    <>
      <div
        ref={anchorRef}
        className={`inline-flex flex-wrap items-end gap-x-2.5 gap-y-1 min-w-0 cursor-help ${
          nearSell ? "rounded-md ring-1 ring-[rgb(var(--signal-down))]/45 px-1 py-0.5" : ""
        }`}
        onMouseEnter={openPopover}
        onMouseLeave={() => setHoverOpen(false)}
        onFocus={openPopover}
        onBlur={() => setHoverOpen(false)}
        tabIndex={0}
        title={hoverHint}
        role="button"
        aria-label={hoverHint}
      >
        {curPrice != null && curPrice > 0 ? (
          <div className="flex flex-col leading-tight shrink-0">
            <span className="text-[8px] uppercase tracking-wide text-ink-muted/70">
              {t("signals.targetStop.spotToday")}
            </span>
            <span className="tabular-nums font-bold text-[12px] text-ink">
              {fmtUsd(curPrice)}
            </span>
          </div>
        ) : null}
        <div className="inline-flex items-center gap-1.5 min-w-0">
          <TargetDistanceDonut ratio={ratio} tone={tone} />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[8px] uppercase tracking-wide text-ink-muted/70">
              {isFallExit
                ? lang === "it"
                  ? "Uscita"
                  : "Exit"
                : lang === "it"
                  ? "Target"
                  : "Target"}
            </span>
            <span className={`tabular-nums font-semibold text-[12px] ${primaryCls}`}>
              {displayUsd != null ? fmtUsd(displayUsd) : rec.targetRange}
            </span>
          </div>
        </div>
      </div>
      {hoverOpen &&
        popoverPos &&
        createPortal(
          <div
            className="fixed z-[200] w-72 max-w-[calc(100vw-16px)] rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] shadow-xl p-3"
            style={{ top: popoverPos.top, left: popoverPos.left }}
            onMouseEnter={() => setHoverOpen(true)}
            onMouseLeave={() => setHoverOpen(false)}
          >
            <TargetStopDetailPanel
              rec={rec}
              signal={signal}
              curPrice={curPrice}
              lang={lang}
              hasUsd={hasUsd}
              tgtLowUsd={tgtLowUsd}
              tgtHighUsd={tgtHighUsd}
              stopUsd={stopUsd}
              sellUsd={sellUsd}
              isSpeculative={isSpeculative}
            />
          </div>,
          document.body
        )}
    </>
  );
}

// ── types ──────────────────────────────────────────────────────────────────

type SignalRow = {
  ticker: string; cd: string; days: number | null;
  affid: number | null; r2: number | null;
  pred5: number | null;        // bias-corrected (usato per score e classificazione)
  pred5Raw: number | null;     // predizione grezza dal foglio
  biasCorrection: number | null; // quanto è stato sottratto (= bias stimato)
  biasSegLabel: string | null;   // segmento che ha prodotto la correzione
  inferenza: string; stars: string;
  score: number; action: ActionKind;
  upsideScore: number;            // ranking per Top Opportunità (rialzi attesi)
  // Hit% storico del quintile cohort corrispondente all'Affidabilità del
  // segnale corrente. Misura empirica: nei segnali storici con questa stessa
  // fascia di Affidabilità, quante volte la curva pred ha azzeccato la
  // direzione del movimento reale.
  expectedHitPct: number | null;
  expectedHitQuintile: string | null;  // es. "Q3" — quintile cohort matchato
  expectedHitN: number;                // numerosità del quintile (eventi storici)
  expectedHitRandomZone: boolean;      // quintile dentro 50 ± 5pp?
  // ── Stabilità della pendenza (driver entry/exit) ────────────────────────────
  // Misura quanto la pendenza recente è coerente con quella a medio termine.
  // Driver chiave per le raccomandazioni del Decision Lab: trend stabili e
  // persistenti → ENTRY/PERSISTENT, rotazioni di pendenza → EXIT.
  slopeConsistency: number | null;          // 0..1 (null se entrambi flat)
  slopeRotationFlag: 0 | 1;                 // 1 se slope_5d e slope_20d opposti
  slopeStabilityClass: SlopeStabilityClass;
  persistenceWindowDays: number;            // 0..15 (mediana storica)
  stabilityVerdict: StabilityVerdict;
  timing: string; size: string;
  hasPosition: boolean; pnlPct: number | null;
  /** Mark-to-market P&L € if position open (sell-today gain). */
  pnlEur: number | null;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
  buyPriceUsd: number | null;
  currentPriceUsd: number | null;
  slope20d: number | null;
  clinicalKpi: number | null;
  k8Kpi: number | null;
  // Pre-catalyst entry verdict (same engine that renders the card body):
  // ``enter`` / ``accumulate``  → valid opportunity
  // ``avoid`` / ``too_early`` / ``late`` / ``sell`` → NOT an opportunity right now
  // Surfaced on ``SignalRow`` so the Top Opportunities filter can stay coherent
  // with what the card itself shows ("🚫 Non entrare" / "🔴 Sell" / "⚠ Late").
  precatKind: PrecatEntryKind;
  precatLabel: string;
  precatExpectedReturn: number | null; // % expected return from today to CD
  precatProbPositive: number | null;   // P(rise) % from calibrated σ
  /** ROI target (decisioni / ranking). */
  planReturnPct: number | null;
  planGainEur: number | null;
  planDays: number | null;
  planCapitalEur: number;
  planGainSource: ExpectedGainSource;
  planTargetReturnPct: number | null;
  planTargetDays: number | null;
  planTargetHighPct: number | null;
  /** ROI→CD informativo. */
  planCdReturnPct: number | null;
  planCdDays: number | null;
  planCdGainEur: number | null;
  simRow: Record<string, unknown>;
  /** hot ≤60d · watch 61–120d · oltre = beyond monitor. */
  cdZone: CdZone;
  /** 0–100: peso operativo su predictibilità curva (↓ lontano dal CD). */
  timingPredictabilityPct: number;
  /** Hit% cohort × peso timing (accuracy attesa oggi). */
  effectiveHitPct: number | null;
};

function positionPnlFromSignal(
  signal: Pick<SignalRow, "pnlEur" | "pnlPct" | "pnlEur24h" | "pnlPct24h">,
) {
  return formatPositionPnlSummary(signal.pnlEur, signal.pnlPct, {
    pnlEur24h: signal.pnlEur24h,
    pnlPct24h: signal.pnlPct24h,
  });
}

function signalRowToTop2(s: SignalRow): Top2PrioritySignal {
  return {
    ticker: s.ticker,
    cd: s.cd,
    days: s.days,
    pred5: s.pred5,
    affid: s.affid,
    r2: s.r2,
    slope20d: s.slope20d,
    precatExpectedReturn: s.precatExpectedReturn,
    score: s.score,
    planReturnPct: s.planReturnPct,
    planDays: s.planTargetDays ?? s.planDays ?? s.days,
    planCapitalEur: s.planCapitalEur,
    planGainSource: s.planGainSource,
    clinicalPhase: clinicalPhaseFromSimRow(s.simRow),
    clinicalIndication: clinicalIndicationFromSimRow(s.simRow),
    action: s.action,
    precatKind: s.precatKind,
    precatLabel: s.precatLabel,
    precatProbPositive: s.precatProbPositive,
    expectedHitPct: s.expectedHitPct,
    effectiveHitPct: s.effectiveHitPct,
    stabilityVerdict: s.stabilityVerdict,
    timing: s.timing,
    hasPosition: s.hasPosition,
    pnlPct: s.pnlPct,
    pnlEur: s.pnlEur,
    pnlEur24h: s.pnlEur24h,
    pnlPct24h: s.pnlPct24h,
    buyPriceUsd: s.buyPriceUsd,
    currentPriceUsd: s.currentPriceUsd,
    clinicalKpi: s.clinicalKpi,
    k8Kpi: s.k8Kpi,
    simRow: s.simRow,
  };
}

// ── sub-components ─────────────────────────────────────────────────────────

function buildColumnGuide(lang: AppLang): { col: string; body: string }[] {
  if (lang === "it") {
    return [
      { col: "Ticker", body: "Simbolo del titolo, mini-curva, prezzo corrente ($) e data/ora dell'ultimo aggiornamento prezzi (snapshot Excel). Il punto colorato indica una posizione gia aperta in portafoglio. Il rating numerico e nella colonna Score." },
      { col: "Curve", body: "% movimento vs T−60 lungo il calendario CD (da −60 a +7 giorni). Verde se il tratto recente e rialzista, rosso se ribassista. Il pin arancione indica «oggi» rispetto alla Completion Date." },
      { col: "CD · Timing", body: "Data attesa del catalyst clinico (readout trial). Sotto: tempo residuo al CD — ⚡ Entrata urgente (≤7 g), 🔴 Ultimi giorni (≤3 g), ✓ Finestra ottimale (≤14 g), Finestra aperta (≤30 g), Pre-fase (>30 g)." },
      { col: "Confidence", body: "Affidabilita 0–100% del motore predittivo sul trend curva (fit storico, qualita dati, coerenza cohort). Sotto ~40% aumenta il rischio di errore direzionale." },
      { col: "Expected Hit%", body: "Hit% direzionale misurata sul cohort storico per il quintile di Confidence del segnale corrente. ≥60% edge solido, 50 ± 5pp zona random, <45% inversione." },
      { col: "R²", body: "Coefficiente di determinazione (0–1): quanto la curva predittiva spiega i punti osservati. ≥0.50 buono, 0.30–0.50 medio, <0.30 debole." },
      { col: "Pred +5", body: "Variazione % attesa del titolo a +5 giorni rispetto alla curva pre-catalyst (predizione empirica ricalibrata)." },
      { col: "Score", body: "Score composito 0–100: Confidence, R², prossimita CD e allineamento segno slope ↔ pred. Pred +5 e solo informativo e non entra nel totale." },
      { col: "Action", body: "Derivata da score e direzione curva: ⚡ Segnale forte, ▲ Watch Long, ▼ Watch Short, ● Monitora, — Salta, ↩ Valuta uscita." },
      { col: "Size", body: "Allocazione % di portafoglio consigliata in base a score, confidence e R²." },
      { col: "Target · Stop", body: "Dinamico da pendenza curva: se sale, target verso CD dal modello (slope×giorni + bande σ); se scende, max drawdown tollerato (P(rebound)) poi vendita sotto sell <." },
      { col: "ROI target", body: "Giorni al target (fine tratto in salita / cambio pendenza), rendimento % al target, moltiplicatore e € sul capitale piano. Guida score, Action, Top 2 e colori. ROI→CD in seconda riga è solo informativo." },
      { col: "P&L", body: "Profit & Loss % della posizione gia aperta in portafoglio." },
    ];
  }
  return [
    { col: "Ticker", body: "Stock symbol, mini curve, current price ($) and last price-update timestamp (Excel snapshot). A colored dot indicates an open portfolio position. Numeric rating is in the Score column." },
    { col: "Curve", body: "% movement vs T−60 along the CD calendar (from −60 to +7 days). Green if the latest segment is bullish, red if bearish. The orange pin marks «today» relative to the Completion Date." },
    { col: "CD · Timing", body: "Expected date of the clinical catalyst (trial readout). Below: time remaining to CD — ⚡ Urgent entry (≤7 d), 🔴 Last days (≤3 d), ✓ Optimal window (≤14 d), Open window (≤30 d), Pre-phase (>30 d)." },
    { col: "Confidence", body: "0–100% confidence of the predictive engine on the curve trend (historical fit, data quality, cohort coherence). Below ~40% directional-error risk is high." },
    { col: "Expected Hit%", body: "Directional Hit% measured on the historical cohort for the confidence quintile of the current signal. ≥60% solid edge, 50 ± 5pp random zone, <45% inversion." },
    { col: "R²", body: "Coefficient of determination (0–1): how well the predictive curve explains observed points. ≥0.50 good fit; 0.30–0.50 moderate; <0.30 weak fit." },
    { col: "Pred +5", body: "Expected % stock change at +5 days relative to the pre-cat curve (recalibrated empirical prediction)." },
    { col: "Score", body: "Composite score 0–100: confidence, R², CD proximity and slope ↔ pred sign alignment. Pred +5 is informational only and not included in this score." },
    { col: "Action", body: "Derived from score and curve direction: ⚡ Strong Signal, ▲ Watch Long, ▼ Watch Short, ● Monitor, — Skip, ↩ Consider exit." },
    { col: "Size", body: "Recommended portfolio % allocation based on score, confidence and R²." },
    { col: "Target · Stop", body: "Dynamic from curve slope: rising → model upside to CD; falling → max dip allowed (rebound prob) then mandatory sell below sell <." },
    { col: "Target ROI", body: "Days to target (end of rise segment / slope turn-down), % return to target, multiplier and € on plan capital. Drives score, Action, Top 2 and colors. ROI→CD on the second line is informational only." },
    { col: "P&L", body: "Profit & Loss % of the already open portfolio position." },
  ];
}

function ColumnGuidePanel({ guide }: { guide: { col: string; body: string }[] }) {
  return (
    <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {guide.map((g) => (
        <div
          key={g.col}
          className="rounded-md border border-[rgb(var(--border))]/40 p-2.5 space-y-0.5"
        >
          <p className="font-semibold text-ink text-[11px]">{g.col}</p>
          <p className="text-[10px] text-ink-muted/80 leading-snug">{g.body}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * StabilityBadge — visualizza la classe di stabilità della pendenza e la
 * finestra di persistenza attesa. Driver visivo del verdetto entry/exit.
 *
 *   "Trend stabile · persistenza ≈ 10gg"  (positivo, slope > 0)
 *   "ROTAZIONE pendenza"                  (negativo, exit signal)
 *   "Pendenza piatta"                     (neutro, no info)
 */
function StabilityBadge({ signal, compact = false }: { signal: SignalRow; compact?: boolean }) {
  const cls = signal.slopeStabilityClass;
  const verdict = signal.stabilityVerdict;
  const persistence = signal.persistenceWindowDays;
  // Nascondiamo se piatto/no-data (niente di utile da dire)
  if (cls === "flat" && verdict === "none") return null;

  const tone = slopeStabilityTone(cls);
  const toneCls =
    tone === "positive" ? "bg-[rgb(var(--signal-up))]/12 text-[rgb(var(--signal-up))] border-[rgb(var(--signal-up))]/35" :
    tone === "negative" ? "bg-[rgb(var(--signal-down))]/12 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/35" :
    tone === "warn"     ? "bg-[rgb(var(--warn))]/10 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/30" :
                          "text-ink-muted border-[rgb(var(--border))]/30";

  const icon =
    signal.slopeRotationFlag === 1 ? "↻" :
    cls === "high_consistency_45d"  ? "▲▲" :
    cls === "high_consistency_20d"  ? "▲"  :
    cls === "med_consistency"       ? "↗"  :
    cls === "low_consistency"       ? "~"  :
                                       "•";

  const persistenceTxt =
    signal.slopeRotationFlag === 1 ? "rotation" :
    persistence >= 7 ? `≈ ${persistence}d` :
    "unstable";

  const consistencyTxt =
    signal.slopeConsistency != null
      ? ` · consistency ${Math.round(signal.slopeConsistency * 100)}%`
      : "";

  const title =
    `${slopeStabilityLabel(cls)} · expected persistence ${persistenceTxt}${consistencyTxt}\n` +
    `Verdict: ${verdictLabel(verdict)}`;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${toneCls}`}
        title={title}
      >
        {icon}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneCls}`}
      title={title}
    >
      <span className="text-[11px]">{icon}</span>
      {signal.slopeRotationFlag === 1
        ? "SLOPE ROTATION"
        : `${slopeStabilityLabel(cls)} · ${persistenceTxt}`}
    </span>
  );
}

// ── UpsideBreakdownStrip ──────────────────────────────────────────────────────
//
// Mini-dashboard sotto le Top Opportunità che mostra il breakdown delle
// esclusioni: quanti segnali sotto soglia, quanti con azione skip/short/exit,
// quanti con CD passata, ecc. Aiuta a capire perché alcune società con
// previsione di crescita non appaiono nelle Top.

type UpsideBreakdown = {
  total: number;
  included: number;
  pinned: number;
  excludedBelowThreshold: number;
  excludedNegativePred: number;
  excludedAction: number;
  excludedCdPast: number;
  excludedLowHit: number;
  excludedRankCap: number;
  // Filtro qualità rigoroso
  excludedHitBelowRandom: number;
  excludedHitRandomZone: number;
  excludedVerdictExit: number;
  excludedVerdictAvoid: number;
  excludedVerdictWatch: number;
  // Filtro Affidabilità minima (sempre attivo se soglia > 0)
  excludedBelowMinAff: number;
  excludedOutsideHot: number;
  excludedSds: number;
};

function UpsideBreakdownStrip({
  breakdown,
  upsideThresholdPct,
  expectedHitThreshold,
  qualityStrict,
  minAffidabilita,
}: {
  breakdown: UpsideBreakdown;
  upsideThresholdPct: number;
  expectedHitThreshold: number;
  qualityStrict: boolean;
  minAffidabilita: number;
}) {
  const totalExcluded =
    breakdown.excludedBelowThreshold +
    breakdown.excludedNegativePred +
    breakdown.excludedAction +
    breakdown.excludedCdPast +
    breakdown.excludedLowHit +
    breakdown.excludedRankCap +
    breakdown.excludedHitBelowRandom +
    breakdown.excludedHitRandomZone +
    breakdown.excludedVerdictExit +
    breakdown.excludedVerdictAvoid +
    breakdown.excludedVerdictWatch +
    breakdown.excludedBelowMinAff +
    breakdown.excludedOutsideHot +
    breakdown.excludedSds;

  if (breakdown.total === 0) return null;

  const cells: { label: string; value: number; tone: string; tip: string }[] = [
    {
      label: "In Top",
      value: breakdown.included,
      tone: "text-[rgb(var(--signal-up))]",
      tip: "Signals that passed all filters and are visible as Top Opportunities (including pinned).",
    },
    ...(breakdown.pinned > 0 ? [{
      label: "📌 Pinned",
      value: breakdown.pinned,
      tone: "text-[rgb(var(--accent))]",
      tip: "Signals forced into Top via the ★ button in the excluded panel. Bypass all filters.",
    }] : []),
    {
      label: "Below threshold",
      value: breakdown.excludedBelowThreshold,
      tone: "text-[rgb(var(--warn))]",
      tip: `Signals with positive pred +5 but < threshold +${upsideThresholdPct.toFixed(1)}%. Lower the slider to recover them.`,
    },
    {
      label: "Pred ≤ 0",
      value: breakdown.excludedNegativePred,
      tone: "text-ink-muted",
      tip: "Signals without a growth forecast (pred +5 ≤ 0 or missing). Never upside candidates.",
    },
    {
      label: "Action skip/short/exit",
      value: breakdown.excludedAction,
      tone: "text-[rgb(var(--signal-down))]/70",
      tip: "Excluded because classified as Skip (CD passed or low score), Short (expected decline) or Exit (consider exiting).",
    },
    {
      label: "CD passed",
      value: breakdown.excludedCdPast,
      tone: "text-ink-muted",
      tip: "Excluded because the Completion Date is more than 3 days in the past.",
    },
    ...(expectedHitThreshold > 0
      ? [{
          label: `Hit% < ${expectedHitThreshold}%`,
          value: breakdown.excludedLowHit,
          tone: "text-[rgb(var(--warn))]",
          tip: `Excluded because the historical Hit% of the corresponding cohort quintile is < ${expectedHitThreshold}% (expected Hit% filter).`,
        }]
      : []),
    ...(qualityStrict && breakdown.excludedHitBelowRandom > 0
      ? [{
          label: "Hit% < 45%",
          value: breakdown.excludedHitBelowRandom,
          tone: "text-[rgb(var(--signal-down))]/80",
          tip: "Excluded: historical Hit% of cohort quintile below random (worse than coin flip). Disable quality filter to recover them.",
        }]
      : []),
    ...(qualityStrict && breakdown.excludedHitRandomZone > 0
      ? [{
          label: "Hit% random",
          value: breakdown.excludedHitRandomZone,
          tone: "text-[rgb(var(--warn))]",
          tip: "Excluded: historical Hit% in random zone (50 ± 5 pp). Model indistinguishable from chance. Disable quality filter to see them.",
        }]
      : []),
    ...(qualityStrict && breakdown.excludedVerdictExit > 0
      ? [{
          label: "Slope rotation",
          value: breakdown.excludedVerdictExit,
          tone: "text-[rgb(var(--signal-down))]",
          tip: "Excluded: recent slope (5d) reversed against the medium-term slope (20d). Verdict EXIT.",
        }]
      : []),
    ...(qualityStrict && breakdown.excludedVerdictAvoid > 0
      ? [{
          label: "Avoid",
          value: breakdown.excludedVerdictAvoid,
          tone: "text-[rgb(var(--signal-down))]",
          tip: "Excluded: consistently negative trend. Verdict AVOID.",
        }]
      : []),
    ...(qualityStrict && breakdown.excludedVerdictWatch > 0
      ? [{
          label: "Watch (coherence)",
          value: breakdown.excludedVerdictWatch,
          tone: "text-[rgb(var(--warn))]",
          tip: "Excluded: inconsistent slope (slope_5d and slope_20d misaligned in magnitude). Verdict WATCH — wait for confirmation.",
        }]
      : []),
    ...(minAffidabilita > 0 && breakdown.excludedBelowMinAff > 0
      ? [{
          label: `Conf < ${minAffidabilita}%`,
          value: breakdown.excludedBelowMinAff,
          tone: "text-[rgb(var(--signal-down))]/70",
          tip: `Excluded: model Confidence < ${minAffidabilita}%. Cohort diagnostic: below 70% the model is noise or anti-correlated. Lower the threshold to see them.`,
        }]
      : []),
    ...(breakdown.excludedRankCap > 0
      ? [{
          label: "Outside top",
          value: breakdown.excludedRankCap,
          tone: "text-ink-muted",
          tip: "Valid candidates but with upside score too low to enter the Top.",
        }]
      : []),
    ...(breakdown.excludedOutsideHot > 0
      ? [{
          label: `CD > ${SIM_HOT_ZONE_DAYS}d`,
          value: breakdown.excludedOutsideHot,
          tone: "text-ink-muted",
          tip: `Excluded from hot zone: catalyst more than ${SIM_HOT_ZONE_DAYS} days away (or CD missing). Shown in watch zone (61–${SIM_MONITOR_HORIZON_DAYS}d) when eligible.`,
        }]
      : []),
    ...(breakdown.excludedSds > 0
      ? [{
          label: "SDS gate",
          value: breakdown.excludedSds,
          tone: "text-[rgb(var(--warn))]",
          tip: "Excluded: SuperNova SDS below entry threshold (≥55 hot / ≥30 watch), veto active, low confidence, or not in SDS cohort.",
        }]
      : []),
  ];

  return (
    <div className="decision-lab-block rounded-lg border p-2.5 mt-3">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <p className="text-[10px] uppercase tracking-wide decision-lab-label font-semibold">
          Filter breakdown ({breakdown.total} total tickers)
        </p>
        <p className="text-[10px] decision-lab-muted">
          {breakdown.included} included · {totalExcluded} excluded
        </p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {cells.map((c) => (
          <div
            key={c.label}
            className="decision-lab-block rounded-md border px-2 py-1.5 cursor-help"
            title={c.tip}
          >
            <p className={`text-base font-bold tabular-nums leading-tight ${c.tone}`}>
              {c.value}
            </p>
            <p className="text-[9px] decision-lab-muted leading-tight mt-0.5">
              {c.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ExcludedFromTopPanel ──────────────────────────────────────────────────────
//
// Tabella espandibile dei segnali esclusi dalle Top Opportunità, con motivo.
// Permette all'utente di capire esattamente perché ogni società con
// previsione di crescita non è entrata, e di agire (es. abbassare la soglia,
// disattivare filtro Hit%).

type ExcludedItem = {
  signal: SignalRow;
  reason:
    | "below_threshold" | "cd_past" | "action_skip" | "action_short"
    | "action_exit" | "action_monitor" | "low_hit"
    | "no_pred" | "negative_pred" | "rank_cap"
    | "hit_below_random" | "hit_random_zone"
    | "verdict_exit" | "verdict_avoid" | "verdict_watch"
    | "below_min_aff"
    | "precat_avoid" | "precat_late" | "precat_sell" | "precat_too_early"
    | "precat_zero_return"
    | "outside_hot_zone"
    | "sds_veto"
    | "sds_low_confidence"
    | "sds_below_hot"
    | "sds_below_watch"
    | "sds_unavailable";
  reasonLabel: string;
};

function ExcludedFromTopPanel({
  excluded,
  upsideThresholdPct,
  onLowerThreshold,
  onPin,
}: {
  excluded: ExcludedItem[];
  upsideThresholdPct: number;
  onLowerThreshold: () => void;
  /** Callback per pinnare un segnale escluso (lo promuove nelle Top) */
  onPin: (key: string) => void;
}) {
  const { lang } = useLang();
  const [showAll, setShowAll] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<"all" | ExcludedItem["reason"]>("all");

  // Ordina per "potenziale upside perso": prima quelli con pred5 alta che
  // sono stati esclusi per motivi non-direzionali (es. solo sotto soglia).
  const sorted = useMemo(() => {
    const priorityOf = (r: ExcludedItem["reason"]): number => {
      if (r === "below_threshold") return 0;   // più recuperabili
      if (r === "below_min_aff") return 1;     // recuperabile abbassando soglia Aff
      if (r === "low_hit") return 2;
      if (r === "rank_cap") return 3;
      if (r === "outside_hot_zone") return 4;
      if (r === "cd_past") return 5;
      if (r === "action_exit") return 5;
      if (r === "action_skip") return 6;
      if (r === "action_short") return 7;
      if (r === "action_monitor") return 4.5;
      if (r === "precat_avoid") return 4.6;
      if (r === "precat_late") return 4.7;
      if (r === "precat_sell") return 4.8;
      if (r === "precat_too_early") return 4.9;
      if (r === "precat_zero_return") return 4.4;
      if (r === "negative_pred") return 8;
      if (isSdsExclusionReason(r)) return 4.55;
      return 9;
    };
    return [...excluded].sort((a, b) => {
      const dp = priorityOf(a.reason) - priorityOf(b.reason);
      if (dp !== 0) return dp;
      return (b.signal.pred5 ?? -999) - (a.signal.pred5 ?? -999);
    });
  }, [excluded]);

  const filtered = useMemo(() => {
    if (reasonFilter === "all") return sorted;
    return sorted.filter((e) => e.reason === reasonFilter);
  }, [sorted, reasonFilter]);

  // Conteggio "facili da recuperare" (sotto soglia con pred5 alto)
  const recoverable = useMemo(() =>
    excluded.filter((e) =>
      e.reason === "below_threshold" &&
      e.signal.pred5 != null &&
      e.signal.pred5 >= 0.5
    ),
    [excluded]
  );

  const displayed = showAll ? filtered : filtered.slice(0, 15);

  return (
    <details className="mt-3 rounded-lg border border-[rgb(var(--border))]/40 bg-white">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink flex items-center gap-2 flex-wrap">
        <span>📋 {lang === "it" ? "Esclusi dalle Top" : "Excluded from Top"}</span>
        <span className="text-[10px] text-ink-muted/70 font-normal">
          ({excluded.length} signals · click to expand)
        </span>
        {recoverable.length > 0 && (
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-[rgb(var(--warn))]/15 text-[rgb(var(--warn))] font-semibold">
            ⚡ {recoverable.length} recoverable by lowering threshold
          </span>
        )}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">
        {recoverable.length > 0 && (
          <div className="rounded-md border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))]/8 px-3 py-2 flex items-start gap-2 text-[11px]">
            <span className="text-base shrink-0">💡</span>
            <div className="flex-1">
              <p>
                <strong>{recoverable.length}</strong> stocks have positive pred +5 ≥ 0.5% but below the current threshold
                (<strong>+{upsideThresholdPct.toFixed(1)}%</strong>).
              </p>
              <p className="text-ink-muted/80 mt-0.5">
                Highest excluded pred5: <strong className="tabular-nums">
                  {fmtPct(Math.max(...recoverable.map((r) => r.signal.pred5 ?? 0)))}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={onLowerThreshold}
              className="shrink-0 text-[10px] px-2 py-1 rounded border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))]/15 text-[rgb(var(--warn))] hover:bg-[rgb(var(--warn))]/25 transition font-semibold"
            >
              ↓ Lower threshold by 0.5%
            </button>
          </div>
        )}

        {/* Filtro per motivo */}
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <span className="text-ink-muted uppercase tracking-wide mr-1">Filter reason:</span>
          {(
            [
              ["all", `All (${excluded.length})`],
              ["below_threshold", `Below threshold (${excluded.filter((e) => e.reason === "below_threshold").length})`],
              ["action_short", `Short (${excluded.filter((e) => e.reason === "action_short").length})`],
              ["action_skip", `Skip (${excluded.filter((e) => e.reason === "action_skip").length})`],
              ["action_exit", `Exit (${excluded.filter((e) => e.reason === "action_exit").length})`],
              ["action_monitor", `Monitor (${excluded.filter((e) => e.reason === "action_monitor").length})`],
              ["precat_avoid", `Pre-CD avoid (${excluded.filter((e) => e.reason === "precat_avoid").length})`],
              ["precat_late", `Pre-CD late (${excluded.filter((e) => e.reason === "precat_late").length})`],
              ["precat_sell", `Pre-CD sell (${excluded.filter((e) => e.reason === "precat_sell").length})`],
              ["precat_too_early", `Pre-CD too early (${excluded.filter((e) => e.reason === "precat_too_early").length})`],
              ["precat_zero_return", `Pre-CD zero return (${excluded.filter((e) => e.reason === "precat_zero_return").length})`],
              ["cd_past", `CD passed (${excluded.filter((e) => e.reason === "cd_past").length})`],
              ["low_hit", `Low Hit% (${excluded.filter((e) => e.reason === "low_hit").length})`],
              ["rank_cap", `Outside top (${excluded.filter((e) => e.reason === "rank_cap").length})`],
              ["negative_pred", `Pred ≤ 0 (${excluded.filter((e) => e.reason === "negative_pred" || e.reason === "no_pred").length})`],
            ] as [typeof reasonFilter, string][]
          ).filter(([_, label]) => !label.endsWith("(0)")).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setReasonFilter(key)}
              className={`px-2 py-0.5 rounded border transition ${
                reasonFilter === key
                  ? "bg-accent/15 text-accent border-accent/30 font-semibold"
                  : "text-ink-muted border-[rgb(var(--border))]/40 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tabella esclusi */}
        <div className="overflow-auto rounded-md border border-[rgb(var(--border))]/30">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px] border-collapse`}>
            <SheetGridColgroup columnCount={7} />
            <thead className="bg-white">
              <tr className="text-[9px] uppercase tracking-wide text-ink-muted">
                <th className={gridTh("left", "font-medium")}>Ticker</th>
                <th className={gridTh("left", "font-medium")}>CD</th>
                <th className={gridTh("center", "font-medium")}>Pred +5</th>
                <th className={gridTh("center", "font-medium")}>Affid.</th>
                <th className={gridTh("center", "font-medium")}>Upside</th>
                <th className={gridTh("left", "font-medium")}>Exclusion reason</th>
                <th
                  className={gridTh("center", "font-medium")}
                  title="Pin manually: forces the signal into Top Opportunities, bypassing all filters."
                >
                  Pin
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((e, i) => {
                const r = e.signal;
                const pred5Color =
                  r.pred5 == null ? "text-ink-muted" :
                  r.pred5 > 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]";
                return (
                  <tr
                    key={r.ticker + r.cd + i}
                    className="border-t border-[rgb(var(--border))]/20 hover:bg-[rgb(var(--surface-3))]/20"
                  >
                    <td className={`${gridTd("left", "py-1")} font-semibold`}>{r.ticker}</td>
                    <td className={`${gridTd("left", "py-1")} text-ink-muted`}>
                      {r.cd}
                      {r.days != null && (
                        <span className="ml-1 text-[9px] text-ink-muted/60">
                          (T{r.days >= 0 ? "−" : "+"}{Math.abs(r.days)})
                        </span>
                      )}
                    </td>
                    <td className={`${gridTd("center", "py-1")} ${pred5Color}`}>
                      {r.pred5 != null ? fmtPct(r.pred5) : "—"}
                    </td>
                    <td className={`${gridTd("center", "py-1")} ${affidHighlightClass(r.affid)}`}>
                      {r.affid != null ? `${Math.round(r.affid * 100)}%` : "—"}
                    </td>
                    <td className={`${gridTd("center", "py-1")} text-ink-muted`}>
                      {r.upsideScore}
                    </td>
                    <td className={`${gridTd("left", "py-1")} text-ink-muted/90 leading-tight`}>
                      {e.reasonLabel}
                    </td>
                    <td className={gridTd("center", "py-1")}>
                      <button
                        type="button"
                        onClick={() => onPin(r.ticker + "|" + r.cd)}
                        title="Promote to Top Opportunities (force in, bypass filters)"
                        className="text-[12px] px-1.5 py-0.5 rounded border border-[rgb(var(--accent))]/30 text-[rgb(var(--accent))]/70 hover:text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10 transition leading-none"
                      >
                        ★
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > 15 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[10px] text-accent hover:underline"
          >
            {showAll
              ? `Show first 15 only`
              : `Show all (${filtered.length})`}
          </button>
        )}

        {filtered.length === 0 && (
          <p className="text-[11px] text-ink-muted/70 italic px-2 py-3 text-center">
            No excluded signals for this filter.
          </p>
        )}
      </div>
    </details>
  );
}

function fmtSlopePp(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

/** Exit review — P&L mark-to-market se vendi oggi. */
function ExitReviewSellTodayPanel({
  signal,
  lang,
}: {
  signal: SignalRow;
  lang: AppLang;
}) {
  const t = useT();
  const sell = resolveSellTodayPnl({
    pnlEur: signal.pnlEur,
    pnlPct: signal.pnlPct,
    buyPriceUsd: signal.buyPriceUsd,
    currentPriceUsd: signal.currentPriceUsd,
    capitalEur: signal.planCapitalEur,
  });
  const daily = portfolioDailyPnlValues(signal.pnlEur24h, signal.pnlPct24h);
  const dailyInline =
    daily.tone !== "flat"
      ? formatPositionPnlInline(signal.pnlEur24h, signal.pnlPct24h, {
          pnlEur24h: signal.pnlEur24h,
          pnlPct24h: signal.pnlPct24h,
        })
      : null;
  const showDailyNote =
    dailyInline != null &&
    dailyInline !== "—" &&
    (sell == null || sell.tone === "flat" || Math.abs(sell.pct ?? 0) < EPS_PCT);

  if (!sell) {
    return (
      <div className="decision-lab-opp-sell-today decision-lab-opp-sell-today--flat">
        <p className="text-[10px] uppercase tracking-wide decision-lab-label font-bold">
          {t("signals.worst.sellToday.title")}
        </p>
        <p className="text-xs decision-lab-muted mt-1">{t("signals.worst.sellToday.unavailable")}</p>
      </div>
    );
  }

  const toneCls =
    sell.tone === "gain"
      ? "decision-lab-opp-sell-today--gain"
      : sell.tone === "loss"
        ? "decision-lab-opp-sell-today--loss"
        : "decision-lab-opp-sell-today--flat";

  return (
    <div className={`decision-lab-opp-sell-today ${toneCls}`}>
      <p className="text-[10px] uppercase tracking-wide decision-lab-label font-bold leading-none">
        {t("signals.worst.sellToday.title")}
      </p>
      <p
        className={`text-xl font-extrabold tabular-nums leading-tight mt-1 ${positionPnlToneClass(sell.tone)}`}
      >
        {sell.eurFormatted}
        {sell.pctFormatted !== "—" ? (
          <span className="text-base font-bold ml-1.5">({sell.pctFormatted})</span>
        ) : null}
      </p>
      {sell.capitalEur != null ? (
        <p className="text-[11px] decision-lab-muted tabular-nums mt-0.5">
          {t("signals.worst.sellToday.onCapital", {
            amount: sell.capitalEur.toLocaleString(lang === "it" ? "it-IT" : "en-US", {
              maximumFractionDigits: 0,
            }),
          })}
        </p>
      ) : null}
      {showDailyNote ? (
        <p className="text-[10px] decision-lab-muted mt-1.5 leading-snug">
          {t("signals.worst.sellToday.dailyNote")}:{" "}
          <span className={`font-semibold tabular-nums ${positionPnlToneClass(daily.tone)}`}>
            {dailyInline}
          </span>
        </p>
      ) : null}
    </div>
  );
}

const EPS_PCT = 0.05;

// ── OpportunityCard ────────────────────────────────────────────────────────────

/** Card di raccomandazione completa per le top opportunità */
function OpportunityCard({
  signal, rec, isPinned = false, onUnpin, onNavigateToSimulation,
  onOpenPredictionCharts,
  onOpenEisDetail,
  chartPoints,
  simTable,
  sdsRows,
  rankIndex, rankTotal,
  zone = "hot",
  rankOrder,
  exitReasons,
  domId,
  isNavFocused = false,
}: {
  signal: SignalRow;
  rec: Recommendation;
  isPinned?: boolean;
  onUnpin?: () => void;
  onNavigateToSimulation?: (ticker: string, action: "buy" | "sell", cd?: string) => void;
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  onOpenEisDetail?: (ticker: string, clinicalKpi?: number | null) => void;
  chartPoints?: ChartPoint[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  rankIndex: number;
  rankTotal: number;
  zone?: "hot" | "watch" | "worst";
  /** worst_first for exit review list; best_first for top buy candidates */
  rankOrder?: "best_first" | "worst_first";
  exitReasons?: WorstPortfolioReason[];
  domId?: string;
  isNavFocused?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const [showCurve,    setShowCurve]    = useState(false);
  const [showPostCat,  setShowPostCat]  = useState(false);

  // Pre-catalyst timing signal
  const { slope5d, slope20d, runUp30d } = extractCurveInputs(signal.simRow);
  const precat: PrecatEntrySignal = buildPrecatEntry(slope5d, slope20d, runUp30d, signal.days, {
    hasPosition: signal.hasPosition,
  });
  const roiSlopeTension =
    signal.planReturnPct != null &&
    signal.planReturnPct > 0 &&
    (precat.kind === "avoid" || precat.kind === "late") &&
    ((slope5d != null && slope5d <= 0) || (slope20d != null && slope20d <= 0));

  // Border accent based on pre-cat signal kind (background = decision-lab-card)
  const accentBorderCls =
    precat.kind === "enter"      ? "border-[rgb(var(--signal-up))]/55" :
    precat.kind === "accumulate" ? "border-[rgb(var(--accent))]/45" :
    precat.kind === "sell"       ? "border-[rgb(var(--signal-down))]/55" :
    precat.kind === "late"       ? "border-[rgb(var(--warn))]/40" :
    precat.kind === "avoid"      ? "border-[rgb(var(--signal-down))]/25" :
                                   "border-[rgb(var(--border))]/40";

  const kindCls: Record<PrecatEntryKind, string> = {
    enter:      "text-[rgb(var(--signal-up))]",
    accumulate: "text-[rgb(var(--accent))]",
    late:       "text-[rgb(var(--warn))]",
    sell:       "text-[rgb(var(--signal-down))] font-bold",
    too_early:  "decision-lab-muted",
    avoid:      "text-[rgb(var(--signal-down))]/70",
  };

  const isLong    = signal.action !== "short";
  const pred5Color = isLong ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]";

  // Probability bar color
  const probCls =
    (precat.probPositive ?? 0) >= 70 ? "bg-[rgb(var(--signal-up))]" :
    (precat.probPositive ?? 0) >= 50 ? "bg-[rgb(var(--accent))]" :
    (precat.probPositive ?? 0) >= 35 ? "bg-[rgb(var(--warn))]" :
                                        "bg-[rgb(var(--signal-down))]";

  const resolvedRankOrder =
    rankOrder ?? (zone === "worst" ? "worst_first" : "best_first");

  const slopeCtx = slopeVerdictContextFromSlopes({
    ticker: signal.ticker,
    cd: signal.cd,
    slope5d,
    slope20d,
    pred5Pp: signal.pred5,
    stabilityVerdict: signal.stabilityVerdict,
  });

  return (
    <div
      id={domId}
      className={`decision-lab-card rounded-xl border p-2 space-y-2 ${accentBorderCls} ${zone === "watch" ? "decision-lab-opp-watch-card" : ""} ${zone === "worst" ? "decision-lab-opp-worst-card" : ""} ${isPinned ? "ring-1 ring-[rgb(var(--accent))]/40" : ""} ${isNavFocused ? "ring-2 ring-[rgb(var(--accent))]/70 shadow-md" : ""}`}
    >

      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <DealRankBadge rankIndex={rankIndex} total={rankTotal} lang={lang} rankOrder={resolvedRankOrder} />
            <span className="text-lg sm:text-xl font-bold tracking-tight decision-lab-text">{signal.ticker}</span>
            <SlopeVerdictBanner
              ctx={slopeCtx}
              simRow={signal.simRow}
              simTable={simTable ?? null}
              chartPts={chartPoints}
              sdsRows={sdsRows}
              variant="inline"
            />
            {zone === "worst" && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-[rgb(var(--signal-down))]/40 bg-[rgb(var(--signal-down))]/10 text-[rgb(var(--signal-down))] font-semibold"
                title={t("signals.worst.subtitle")}
              >
                📉 {t("signals.worst.zoneBadge")}
              </span>
            )}
            {exitReasons?.map((reason) => (
              <span
                key={reason}
                className="text-[9px] px-1.5 py-0.5 rounded-full border border-[rgb(var(--signal-down))]/30 bg-[rgb(var(--signal-down))]/5 text-[rgb(var(--signal-down))]/90 font-medium"
              >
                {t(`signals.worst.reason.${reason}` as TranslationKey)}
              </span>
            ))}
            {signal.hasPosition && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[rgb(var(--accent))]/30 text-[rgb(var(--accent))] font-semibold">
                💼 {t("signals.badge.openPosition")}
              </span>
            )}
            {isPinned && (
              <button
                type="button"
                onClick={onUnpin}
                title="Pinned manually by user — click to remove pin"
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))] border border-[rgb(var(--accent))]/40 font-semibold hover:bg-[rgb(var(--accent))]/25 transition cursor-pointer"
              >
                📌 Pinned ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="decision-lab-opp-meta-chip decision-lab-text font-medium tabular-nums">
              CD {signal.cd}
            </span>
            {showOpportunityTimingChip(signal.days) ? (
              <span
                className={`decision-lab-opp-meta-chip font-semibold ${
                  signal.days != null && signal.days <= 7
                    ? "text-[rgb(var(--warn))] border-[rgb(var(--warn))]/35"
                    : "decision-lab-muted"
                }`}
              >
                {signal.timing}
              </span>
            ) : null}
            <span className={`decision-lab-opp-meta-chip ${affidHighlightClass(signal.affid)}`}>
              Conf. {signal.affid != null ? `${Math.round(signal.affid * 100)}%` : "—"}
            </span>
            {signal.expectedHitPct != null && (
              <span
                className={`decision-lab-opp-meta-chip ${expectedHitCellClass(signal)}`}
                title={expectedHitCellTitle(signal)}
              >
                Hit% {Math.round(signal.expectedHitPct)}%
                {signal.expectedHitQuintile ? ` (${signal.expectedHitQuintile})` : ""}
              </span>
            )}
            {zone === "watch" && (
              <span
                className="decision-lab-opp-meta-chip tabular-nums font-semibold text-[rgb(var(--accent))]"
                title={t("signals.watch.predictabilityTip")}
              >
                {t("signals.watch.predictability")} {signal.timingPredictabilityPct}%
              </span>
            )}
            {zone === "watch" && signal.effectiveHitPct != null && (
              <span
                className="decision-lab-opp-meta-chip tabular-nums decision-lab-muted"
                title={t("signals.watch.effectiveHitTip")}
              >
                {t("signals.watch.effectiveHit")} {signal.effectiveHitPct}%
              </span>
            )}
            <span className="decision-lab-opp-meta-chip decision-lab-muted tabular-nums">
              R² {signal.r2?.toFixed(2) ?? "—"}
            </span>
            <StabilityBadge signal={signal} />
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5 w-full sm:w-auto sm:min-w-[5.5rem]">
          <div className="w-full flex flex-col items-end gap-0.5">
            <span className="text-[9px] uppercase tracking-wide decision-lab-muted font-semibold">
              Score
            </span>
            <SignalScoreBar score={signal.score} />
          </div>
          {onOpenEisDetail ? (
            <div className="w-full flex flex-col items-end gap-0.5">
              <span className="text-[9px] uppercase tracking-wide decision-lab-muted font-semibold">
                EIS
              </span>
              <EisScoreBadge
                ticker={signal.ticker}
                clinicalKpi={signal.clinicalKpi}
                it={lang === "it"}
                compact
                onClick={() => onOpenEisDetail(signal.ticker, signal.clinicalKpi)}
              />
            </div>
          ) : null}
        </div>
      </div>

      {signal.stabilityVerdict !== "none" &&
      (signal.stabilityVerdict === "exit" ||
        signal.stabilityVerdict === "avoid" ||
        zone === "worst") ? (
        <SlopeVerdictBanner
          ctx={slopeCtx}
          simRow={signal.simRow}
          simTable={simTable ?? null}
          chartPts={chartPoints}
          sdsRows={sdsRows}
          variant="card"
        />
      ) : null}

      {/* ── Timing pre-catalyst (PRIMARIO) ── */}
      <div className="decision-lab-block rounded-lg border p-1.5 space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider decision-lab-label font-bold leading-none">
          📈 {t("signals.card.timingPrecat")}
        </p>

        {zone === "worst" && signal.hasPosition ? (
          <ExitReviewSellTodayPanel signal={signal} lang={lang} />
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 items-stretch">
          {/* ROI */}
          <div className="decision-lab-opp-roi-panel decision-lab-block rounded-md border p-1.5 space-y-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide decision-lab-label font-bold leading-none">
              {t("signals.card.roiTarget")}
            </p>
            {signal.planReturnPct != null ? (
              <ExpectedRoiCell
                lang={lang}
                days={signal.planTargetDays ?? signal.planDays ?? signal.days}
                returnPct={signal.planReturnPct}
                capitalEur={signal.planCapitalEur}
                source="slope_target"
                variant="hero"
                dense
                slope5d={slope5d}
                slope20d={slope20d}
              />
            ) : (
              <p className="text-sm decision-lab-muted">—</p>
            )}
            {signal.planCdReturnPct != null ? (
              <p
                className="text-[9px] decision-lab-muted leading-tight tabular-nums border-t border-[rgb(var(--panel-lab-border))]/35 pt-1"
                title={
                  lang === "it"
                    ? "ROI verso CD — solo informativo, non guida BUY/SELL"
                    : "ROI to CD — informational only, not used for BUY/SELL"
                }
              >
                {lang === "it" ? "ROI→CD" : "ROI→CD"}:{" "}
                <span className="font-semibold text-ink-muted/90">
                  {signal.planCdReturnPct >= 0 ? "+" : ""}
                  {signal.planCdReturnPct.toFixed(1)}%
                </span>
                {signal.planCdDays != null ? (
                  <span>
                    {" · "}
                    {signal.planCdDays}d
                  </span>
                ) : null}
              </p>
            ) : null}
            {precat.probPositive != null ? (
              <div
                className="flex items-center gap-1.5 pt-0.5 border-t border-[rgb(var(--panel-lab-border))]/40"
                title={t("signals.card.basedOnCohort", { n: "5,330" })}
              >
                <div className="flex-1 min-w-0 h-1 rounded-full bg-[rgb(var(--panel-lab-border))] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${probCls}`}
                    style={{ width: `${precat.probPositive}%` }}
                  />
                </div>
                <span className="text-[9px] decision-lab-muted tabular-nums shrink-0 leading-none">
                  P↑ {precat.probPositive}%
                </span>
              </div>
            ) : null}
            <p
              className="text-[8px] decision-lab-muted italic leading-tight line-clamp-1"
              title={expectedRoiSourceLabel(lang, signal.planGainSource)}
            >
              {expectedRoiSourceLabel(lang, signal.planGainSource)}
            </p>
            {roiSlopeTension ? (
              <p
                className="text-[8px] text-[rgb(var(--signal-down))]/85 leading-tight"
                title={t("signals.card.roiVsSlopeHint")}
              >
                {t("signals.card.roiVsSlopeHint")}
              </p>
            ) : signal.planCdReturnPct != null &&
              signal.planCdReturnPct > 0 &&
              (signal.planReturnPct == null || signal.planReturnPct <= 0) &&
              (slope5d != null && slope5d < -0.1 || slope20d != null && slope20d < -0.1) ? (
              <p className="text-[8px] text-[rgb(var(--signal-down))]/85 leading-tight">
                {lang === "it"
                  ? "ROI→CD positivo ma target assente/↓ · pendenza ↓"
                  : "CD ROI positive but target missing/↓ · slope ↓"}
              </p>
            ) : null}
          </div>

          {/* Segnale + curva */}
          <div className="decision-lab-opp-signal-panel decision-lab-block rounded-md border p-1.5 flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between gap-1 min-h-0">
              <p className="text-[10px] uppercase tracking-wide decision-lab-label font-bold leading-none shrink-0">
                {t("signals.card.signal")}
              </p>
              {(precat.kind === "enter" || precat.kind === "accumulate" || precat.kind === "sell") && onNavigateToSimulation ? (
                <button
                  type="button"
                  onClick={() => onNavigateToSimulation(signal.ticker, precat.kind === "sell" ? "sell" : "buy", signal.cd)}
                  className={`text-[11px] font-bold leading-none hover:underline truncate max-w-[55%] ${kindCls[precat.kind]}`}
                  title={`→ Simulation: ${signal.ticker}`}
                >
                  {precat.label} →
                </button>
              ) : (
                <p className={`text-[11px] font-bold leading-none truncate max-w-[55%] ${kindCls[precat.kind]}`}>
                  {precat.label}
                </p>
              )}
            </div>

            <div
              className="decision-lab-opp-signal-chart decision-lab-opp-signal-chart--compact w-full rounded border border-[rgb(var(--panel-lab-border))]/50 bg-white/60 dark:bg-black/10 py-0.5 px-0.5"
              title={
                lang === "it"
                  ? "Grigio/rosso = prezzo reale · tratteggiato = modello (se mercato ↓ il solido segue il reale)"
                  : "Gray/red = actual price · dashed = model (when market ↓ solid line follows actual)"
              }
            >
              <SimulationSparkline
                row={signal.simRow}
                points={chartPoints}
                width={320}
                height={52}
                showCdZones
                showZoneLabels
                className="w-full h-auto block"
                portfolio={
                  signal.hasPosition
                    ? {
                        pnlPct: signal.pnlPct,
                        buyPriceUsd: signal.buyPriceUsd,
                      }
                    : null
                }
              />
            </div>

            <p className="text-[11px] tabular-nums decision-lab-muted text-center leading-none">
              <span className="opacity-70">20d {fmtSlopePp(slope20d)}</span>
              <span className="mx-0.5 opacity-50">→</span>
              <span
                className={
                  slope5d != null && slope5d < 0
                    ? "text-[rgb(var(--signal-down))] font-semibold"
                    : slope5d != null && slope5d > 0
                      ? "text-[rgb(var(--signal-up))] font-semibold"
                      : ""
                }
              >
                5d {fmtSlopePp(slope5d)}
              </span>
              {(slope5d != null && slope5d < -0.1) || (slope20d != null && slope20d < -0.1) ? (
                <span className="block text-[9px] text-[rgb(var(--signal-down))]/85 mt-0.5 font-medium">
                  {lang === "it"
                    ? "Mercato ↓ — curva solida = reale; tratteggio = modello verso CD"
                    : "Market ↓ — solid = actual; dashed = model path to CD"}
                </span>
              ) : null}
            </p>
          </div>

          {/* Target · Stop */}
          <div className="decision-lab-block rounded-md border p-1.5 flex flex-col gap-1 min-w-0 justify-center">
            <p className="text-[8px] uppercase tracking-wide decision-lab-label font-bold leading-none">
              {t("signals.card.targetStop")}
            </p>
            <TargetStopTableCell
              rec={rec}
              signal={signal}
              curPrice={signal.currentPriceUsd}
              lang={lang}
            />
            <div className="text-[9px] leading-snug space-y-0.5 tabular-nums">
              <p className="decision-lab-muted">
                <span className="font-semibold text-[rgb(var(--signal-up))]/90">
                  {lang === "it" ? "Target" : "Target"}
                </span>{" "}
                <span className="decision-lab-text font-medium">{rec.targetRange}</span>
              </p>
              <p className="decision-lab-muted">
                <span className="font-semibold text-[rgb(var(--signal-down))]/90">
                  {rec.dynamicMode === "fall"
                    ? lang === "it"
                      ? "Vendi sotto"
                      : "Sell below"
                    : lang === "it"
                      ? "Stop"
                      : "Stop"}
                </span>{" "}
                <span className="font-medium text-[rgb(var(--signal-down))]">{rec.stopLoss}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Uscita — riga compatta */}
        <div className="decision-lab-opp-exit-panel decision-lab-block rounded-md border px-2 py-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[9px] uppercase tracking-wide decision-lab-label font-bold shrink-0">
            {t("signals.card.whenToExit")}
          </span>
          <span className="text-xs leading-snug decision-lab-text font-medium flex-1 min-w-[12rem]">
            {precat.exitNote}
          </span>
          {signal.hasPosition && zone !== "worst" ? (() => {
            const pnl = positionPnlFromSignal(signal);
            if (!pnl) return null;
            return (
              <span
                className={`text-xs font-bold tabular-nums shrink-0 ${positionPnlToneClass(pnl.tone)}`}
              >
                {t("signals.card.currentPnl")}{" "}
                {pnl.pct !== "—" ? pnl.pct : pnl.amount}
                {pnl.dailyPart ? (
                  <span className="font-semibold">
                    {" · "}{lang === "it" ? "Oggi" : "Day"} {pnl.dailyPart}
                  </span>
                ) : pnl.pct !== "—" ? (
                  <span className="font-normal opacity-90"> ({pnl.amount})</span>
                ) : null}
              </span>
            );
          })() : null}
        </div>
      </div>

      {/* ── Caveats ── */}
      {rec.caveats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rec.caveats.map((c) => (
            <span key={c} className="text-[10px] px-2 py-0.5 rounded-full border border-[rgb(var(--warn))]/30 text-[rgb(var(--warn))]">
              ⚠ {c}
            </span>
          ))}
        </div>
      )}

      {/* ── Contesto post-catalyst (SECONDARIO, collassabile) ── */}
      <details onToggle={(e) => setShowPostCat((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer select-none text-[11px] decision-lab-muted hover:decision-lab-text flex items-center gap-1.5 border-t border-[rgb(var(--panel-lab-border))] pt-2">
          <span>{showPostCat ? "▾" : "▸"}</span>
          <span className="font-medium decision-lab-text">
            {t("signals.card.postCatContext")}
          </span>
          <span className="text-[10px] decision-lab-muted">
            · pred {signal.pred5 != null
              ? `${signal.pred5 > 0 ? "▲ " : "▼ "}${fmtPct(signal.pred5)}`
              : "—"
            } · {rec.historicalRef.split("·")[0].trim()}
          </span>
        </summary>
        <div className="mt-2 space-y-2">
          {/* pred5 + target/stop */}
          <div className="grid sm:grid-cols-3 gap-2 text-sm">
            <div className="decision-lab-block rounded-lg border p-2.5">
              <p className="text-[9px] uppercase tracking-wide decision-lab-label font-semibold mb-1">Post-CD action</p>
              <p className="text-xs font-medium leading-snug decision-lab-text">{rec.entry}</p>
            </div>
            <div className="decision-lab-block rounded-lg border p-2.5">
              <p className="text-[9px] uppercase tracking-wide decision-lab-label font-semibold mb-1">Expected target post-CD</p>
              {(() => {
                const curPrice = currentPriceFromRow(signal.simRow as Record<string, unknown>);
                const hasUsd =
                  curPrice != null && curPrice > 0 &&
                  rec.targetLowPct != null && rec.targetHighPct != null && rec.stopPct != null;
                const tgtLowUsd  = hasUsd ? applyPct(curPrice!, rec.targetLowPct!)  : null;
                const tgtHighUsd = hasUsd ? applyPct(curPrice!, rec.targetHighPct!) : null;
                const stopUsd    = hasUsd ? applyPct(curPrice!, rec.stopPct!)       : null;
                const tgtCls = isLong ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]";
                const dirTag = isLong ? "↑" : "↓";
                return (
                  <>
                    <p className="text-[10px] decision-lab-muted mb-0.5">
                      now <span className="tabular-nums decision-lab-text">{curPrice != null ? fmtUsd(curPrice) : "—"}</span>
                    </p>
                    <p className={`font-bold text-sm tabular-nums ${tgtCls}`}>
                      {hasUsd ? (
                        <>
                          {dirTag} {fmtUsd(tgtLowUsd)}→{fmtUsd(tgtHighUsd)}
                        </>
                      ) : (
                        rec.targetRange
                      )}
                    </p>
                    {hasUsd && (
                      <p className={`text-[10px] tabular-nums ${tgtCls} opacity-80`}>
                        ({fmtPct(rec.targetLowPct)} → {fmtPct(rec.targetHighPct)})
                      </p>
                    )}
                    <p className="text-[10px] decision-lab-muted mt-0.5">
                      Stop:{" "}
                      <span className="text-[rgb(var(--signal-down))] font-semibold tabular-nums">
                        {hasUsd ? (
                          <>
                            {fmtUsd(stopUsd)} ({fmtPct(rec.stopPct)})
                          </>
                        ) : (
                          rec.stopLoss
                        )}
                      </span>
                    </p>
                  </>
                );
              })()}
            </div>
            <div className="decision-lab-block rounded-lg border p-2.5">
              <p className="text-[9px] uppercase tracking-wide decision-lab-label font-semibold mb-1">Post-CD pred</p>
              <p className={`font-bold text-sm tabular-nums ${pred5Color}`}>
                {signal.pred5 != null ? `${signal.pred5 > 0 ? "▲ " : "▼ "}${fmtPct(signal.pred5)}` : "—"}
              </p>
              {signal.biasCorrection != null && Math.abs(signal.biasCorrection) >= 1 && (
                <p className="text-[9px] text-[rgb(var(--warn))] mt-0.5">
                  ⚖ bias {signal.biasCorrection > 0 ? "−" : "+"}{Math.abs(round1(signal.biasCorrection))} pp
                </p>
              )}
            </div>
          </div>

          <p className="text-[11px] decision-lab-muted">📊 {rec.historicalRef}</p>

          {rec.biasNote && (
            <p className="text-[11px] text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/8 rounded-md px-2.5 py-1.5">
              ⚖ {rec.biasNote}
            </p>
          )}
        </div>
      </details>

      {/* ── Curva pre-catalyst ── */}
      {signal.days != null && signal.days > 0 && (
        <div className="border-t border-[rgb(var(--panel-lab-border))] pt-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowCurve((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] decision-lab-muted hover:decision-lab-text transition"
            >
              <span>{showCurve ? "▾" : "▸"}</span>
              <span className="font-medium">
                {showCurve ? "Hide curve" : `📉 ${t("signals.card.predictionCurve")}`}
              </span>
            </button>
            {onOpenPredictionCharts && (
              <button
                type="button"
                onClick={() =>
                  onOpenPredictionCharts({
                    ticker: signal.ticker,
                    seriesKey: simulationRowSeriesKey(signal.simRow) ?? null,
                  })
                }
                className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline"
                title={t("signals.priority.openChartsTitle")}
              >
                📈 {t("signals.priority.openCharts")}
              </button>
            )}
          </div>
          {showCurve && (
            <div className="mt-2">
              <PrecatCurvePanel
                simRow={signal.simRow}
                daysToCd={signal.days}
                chartPoints={chartPoints}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export function InvestmentSignalsPanel({
  simTable,
  simLoading,
  simError,
  onReload,
  reloadToken,
  onNavigateToSimulation,
  onOpenCatalystFeed: _onOpenCatalystFeed,
  onOpenClinicalFeed: _onOpenClinicalFeed,
  onOpenSlopeErrorCharts,
  onOpenPredictionCharts,
  focusSignal,
  onFocusSignalConsumed,
  slopeBannerPlacement = "inline",
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  simError?: string | null;
  onReload?: () => void;
  /** Incrementato dal parent al click "Ricarica" → forza re-fetch della cohort interna. */
  reloadToken?: number;
  onNavigateToSimulation?: (ticker: string, action: "buy" | "sell", cd?: string) => void;
  onOpenCatalystFeed?: () => void;
  onOpenClinicalFeed?: (ticker: string) => void;
  onOpenSlopeErrorCharts?: (ticker?: string) => void;
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  focusSignal?: { ticker: string; cd?: string } | null;
  onFocusSignalConsumed?: () => void;
  /** `header` = banner nel titolo; `inline` = sopra Top Opps; `none` = tab slope dedicata. */
  slopeBannerPlacement?: "header" | "inline" | "none";
}) {
  const { lang } = useLang();
  const t = useT();
  const columnGuide = useMemo(() => buildColumnGuide(lang), [lang]);
  // Real portfolio state (user inputs from localStorage + ``data/invest_sim_inputs.json``).
  // Without this, ``hasPosition`` is read only from the Excel sheet column
  // ``Capitale Investito ($)``, which contains a single row (ANIK) and misses
  // every position the user has entered via the Investment Simulation UI.
  const inputs = useInvestSimInputs(simTable, reloadToken);
  const portfolioHistory = useInvestSimPortfolioHistory(reloadToken);
  const [cohortDoc, setCohortDoc] = useState<DecisionCohortDoc | null>(null);
  const [sdsByTicker, setSdsByTicker] = useState<Map<string, SdsGateInfo>>(
    () => getCachedSdsForTopOpps() ?? new Map(),
  );
  const [sdsRowsForMig, setSdsRowsForMig] = useState<SdsRow[] | null>(null);
  const [upsideThresholdPct, setUpsideThresholdPct] = useState<number>(loadUpsideThresholdPct);
  const expectedHitThreshold = 0;
  const qualityStrict = true;
  const [minAffidabilita, setMinAffidabilitaState] = useState<number>(loadMinAffidabilita);
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(loadPinnedTop);
  const topSortKey: TopSortKey = "upside";
  const [eisDrawer, setEisDrawer] = useState<{
    ticker: string;
    clinicalKpi: number | null;
  } | null>(null);

  const openEisDetail = useCallback((ticker: string, clinicalKpi?: number | null) => {
    setEisDrawer({ ticker, clinicalKpi: clinicalKpi ?? null });
  }, []);

  // Bundle grafici densi (curva modello ricalibrato) per le sparkline della tabella.
  // Senza questo le sparkline cadono sul fallback (8 colonne foglio in frazioni)
  // e risultano tutte grigie con la nuova logica colore basata su trend forward
  // in pp. Caricando il bundle ottieni gli stessi mini-grafici di Tuo Portafoglio
  // e Main Dashboard (curva modello v4 ricalibrato + overlay prezzo reale).
  const [signalsChartBundle, setSignalsChartBundle] = useState<ChartBundle | null>(null);

  const simTablePriceSig = useMemo(() => {
    if (!simTable?.rows?.length) return "";
    const parts: string[] = [String(simTable.row_count ?? simTable.rows.length)];
    for (const row of simTable.rows.slice(0, 12)) {
      const tk = String(row.Ticker ?? "");
      if (!tk || tk.includes("TOTALE")) continue;
      parts.push(`${tk}:${String(row["Prezzo Corrente ($)"] ?? "")}`);
    }
    return parts.join("|");
  }, [simTable]);

  useEffect(() => {
    let cancelled = false;
    void loadSimulationChartsBundle().then((res) => {
      if (cancelled) return;
      setSignalsChartBundle(res.bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, simTablePriceSig]);

  const signalsPointsBySeriesKey = useMemo(() => {
    const map = new Map<string, ChartPoint[]>();
    const series = signalsChartBundle?.series;
    if (!series) return map;
    for (const [k, s] of Object.entries(series)) {
      if (!k.startsWith("co:")) continue;
      if (Array.isArray(s?.points) && s.points.length > 0) {
        map.set(k, s.points);
      }
    }
    return map;
  }, [signalsChartBundle]);

  // Stato ricalibrazioni curva pred (pred_curve_seq_state.json):


  const setMinAffidabilita = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setMinAffidabilitaState(clamped);
    saveMinAffidabilita(clamped);
  }, []);

  // ── Live signals: refresh avviato dal pulsante pagina Decision Lab ──

  const togglePin = useCallback((key: string) => {
    setPinnedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      savePinnedTop(next);
      return next;
    });
  }, []);

  const clearAllPins = useCallback(() => {
    setPinnedKeys(() => {
      const next = new Set<string>();
      savePinnedTop(next);
      return next;
    });
  }, []);


  const updateUpsideThreshold = useCallback((v: number) => {
    const clamped = clampUpsideThresholdPct(v);
    setUpsideThresholdPct(clamped);
    saveUpsideThresholdPct(clamped);
  }, []);


  const [tradeCalibTick, setTradeCalibTick] = useState(0);
  const [cohortLoaded, setCohortLoaded] = useState(false);

  const loadCohort = useCallback(async () => {
    const res = await loadInvestmentDecisionCohort();
    if (res.doc) setCohortDoc(res.doc);
    setCohortLoaded(true);
  }, []);

  const loadTradeCalib = useCallback(async () => {
    await loadInvestmentTradeCalib();
    setTradeCalibTick((t) => t + 1);
  }, []);

  useEffect(() => {
    void loadCohort();
    void loadTradeCalib();
  }, [loadCohort, loadTradeCalib]);

  useEffect(() => {
    let cancelled = false;
    void readLocalSdsSnapshot().then((doc) => {
      if (cancelled) return;
      const map = buildSdsByTicker(doc?.rows);
      setCachedSdsForTopOpps(map);
      setSdsByTicker(map);
      setSdsRowsForMig(doc?.rows?.length ? doc.rows : null);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Re-trigger della cohort interna quando il parent "Ricarica" incrementa il token.
  // Senza questo, premere "Ricarica" nell'header del Decision Lab NON aggiornava
  // expectedHitPct e i quintili usati per upsideScore.
  useEffect(() => {
    if (reloadToken !== undefined && reloadToken > 0) {
      void loadCohort();
      void loadTradeCalib();
    }
  }, [reloadToken, loadCohort, loadTradeCalib]);

  const tradeCalibHint = useMemo(() => tradeCalibSummary(), [tradeCalibTick]);

  /** Data dell'ultimo refresh live segnali (snapshot Simulation). */
  const signalsDataAsOf = useMemo(() => {
    let max = "";
    for (const row of simTable?.rows ?? []) {
      const d = String(row["live_updated_at"] ?? "").trim().slice(0, 10);
      if (d && d > max) max = d;
    }
    const snap = String(
      (simTable as { live_signals_updated_at?: string } | null)?.live_signals_updated_at ?? "",
    ).trim().slice(0, 10);
    return max || snap || null;
  }, [simTable?.rows, simTable]);

  // Devono stare PRIMA di signals useMemo (che le usa come dipendenza)
  const quintiles = cohortDoc?.quintiles ?? [];
  const segGroups = cohortDoc?.segment_groups ?? [];

  const signals = useMemo((): SignalRow[] => {
    if (!simTable) return [];
    const cols = simTable.columns;
    const colTicker   = findCol(cols, "Ticker") ?? "Ticker";
    const colCD       = findCol(cols, "Completion Date") ?? "Completion Date";
    const colAffid    = findCol(cols, "Affidabilit") ?? "";
    const colR2       = findCol(cols, "R²") ?? findCol(cols, "R2") ?? "";
    // ── Pred a +5 gg: TICKER-SPECIFICA ────────────────────────────────────
    //
    // BUG STORICO: la UI leggeva "Pred empirica +5gg (%)" come pred ticker-
    // specifica. In realtà quella colonna è documentata come:
    //
    //   "mediana storica di coorte a +5 gg dalla curva empirica
    //    (success/failure/neutral/control). Benchmark statistico,
    //    NON il rendimento osservato del titolo."
    //
    // Cioè: tutti i ticker della stessa categoria (es. 'neutral') ottenevano
    // lo stesso valore mediano (~+0.04%), producendo "Pred +5 +0.04%" per
    // tutti — mascherando completamente le pred ticker-specifiche.
    //
    // La pred VERA del modello v4 ticker-specifica sta in:
    //   - "Δ% vs Pred−60 Pred +4"  (T+4)
    //   - "Δ% vs Pred−60 Pred +7"  (T+7)
    //
    // Interpoliamo linearmente a T+5: pred5 = pred4 + (pred7 - pred4) * (1/3)
    // Fallback: pred7 da solo, poi "Pred empirica" (legacy) se mancano entrambe.
    const colClinicalKpi = findCol(cols, "Clinical KPI")
      ?? findCol(cols, "KPI clin")
      ?? findCol(cols, "EIS")
      ?? "";
    const colK8Kpi = findCol(cols, "8-K KPI")
      ?? findCol(cols, "K8 KPI")
      ?? findCol(cols, "K-8 KPI")
      ?? findCol(cols, "SEC 8-K")
      ?? findCol(cols, "SEC K-8")
      ?? "";
    const colInfer    = findCol(cols, "Inferenza") ?? "";
    const colStars    = findCol(cols, "stelle") ?? findCol(cols, "segnale") ?? "";
    const colCapitale = findCol(cols, "Capitale Investito") ?? "";
    const colPnl      = findCol(cols, "P&L (%)") ?? "";

    return simTable.rows.map((row) => {
      const ticker = String(row[colTicker] ?? "");
      const cd     = String(row[colCD] ?? "");
      const days   = daysFromToday(cd);
      let affidRaw = toNum(row[colAffid]);
      if (affidRaw != null && affidRaw > 1) affidRaw /= 100;
      const r2 = toNum(row[colR2]);
      const seriesKey = simulationRowSeriesKey(row);
      const chartPts = seriesKey ? signalsPointsBySeriesKey.get(seriesKey) ?? null : null;
      const pred5Raw = readPred5RelativePp(row, { chartPoints: chartPts });

      const inferenza   = String(row[colInfer] ?? "");
      const stars       = String(row[colStars] ?? "");
      const clinicalKpi = toNum(row[colClinicalKpi]);
      const k8Kpi = toNum(row[colK8Kpi]);
      const currentPriceUsd = currentPriceFromRow(row);
      // ``hasPosition`` must honor the user's local InvestSimInputs (live
      // portfolio), not just the Excel sheet column. ``rowHasActivePortfolio``
      // merges sheet + local state and respects ``ignoreSheet`` overrides.
      const hasPosition = rowHasActivePortfolio(row, inputs);
      // Prefer the freshly-computed P&L for portfolio rows (uses the current
      // price + local buyPrice/capital); fall back to the sheet column otherwise.
      let pnlPct: number | null = null;
      let pnlEur: number | null = null;
      let pnlEur24h: number | null = null;
      let pnlPct24h: number | null = null;
      let buyPriceUsd: number | null = null;
      if (hasPosition) {
        const m = positionPnlForOpenRow(row, inputs, portfolioHistory);
        if (m.buyPriceUsd != null) buyPriceUsd = m.buyPriceUsd;
        if (m.pnlPct != null) pnlPct = m.pnlPct;
        if (m.pnlEur != null) pnlEur = m.pnlEur;
        if (m.pnlEur24h != null) pnlEur24h = m.pnlEur24h;
        if (m.pnlPct24h != null) pnlPct24h = m.pnlPct24h;
      } else {
        pnlPct = toNum(row[colPnl]);
        if (pnlPct != null && Math.abs(pnlPct) <= 1.5) pnlPct *= 100;
        pnlEur = toNum(row["P&L ($)"]);
      }
      if (buyPriceUsd == null && !hasPosition) {
        buyPriceUsd = toNum(row["Prezzo Acquisto ($)"]);
      }
      // ``colCapitale`` may be referenced elsewhere in the future; keep the
      // lookup so the dependency check below stays accurate.
      void colCapitale;

      // ── Bias correction dal Decision Lab ──────────────────────────────────
      const biasInfo = findBiasForSignal(pred5Raw, row, cols, segGroups);
      const biasCorrection = biasInfo?.bias ?? null;
      const biasSegLabel   = biasInfo?.segLabel ?? null;
      // Correzione: pred_corretta = pred_grezza − bias_sistematico
      const pred5 =
        cohortLoaded && pred5Raw != null && biasCorrection != null
          ? pred5Raw - biasCorrection
          : pred5Raw;

      // Direzione curva pre-catalyst (per allineamento slope↔pred)
      const {
        slope5d: curveSlope5d,
        slope20d: curveSlope20d,
        slope45d: curveSlope45d,
        runUp30d,
      } = extractCurveInputs(row);

      // Hit% atteso dal cohort storico — empirico: nei segnali storici con
      // la stessa fascia di Affidabilità, quante volte la curva pred ha
      // azzeccato la direzione del movimento reale.
      const quintile = matchQuintile(affidRaw, quintiles);
      const expectedHitPct = quintile?.hit_rate_pct ?? null;
      const expectedHitQuintile = quintile?.label ?? null;
      const expectedHitN = quintile?.n ?? 0;
      const expectedHitRandomZone = isCohortInRandomZone(expectedHitPct);

      // ── Pre-catalyst entry verdict (stesso engine della card body) ────────
      // Calcoliamo qui ``precat.kind`` per renderlo disponibile come filtro
      // delle Top Opportunità: se la card mostra "🚫 Non entrare" / "⚠ Late" /
      // "🔴 Sell" / "⏰ Too early" allora il banner NON è un'opportunità.
      const precatEntry = buildPrecatEntry(curveSlope5d, curveSlope20d, runUp30d, days, {
        hasPosition,
      });

      const simKey = normalizedRowKey(ticker, cd);
      const planCapital =
        inputs[simKey]?.capital > 0 ? inputs[simKey].capital : DEFAULT_PLAN_CAPITAL_EUR;
      const gainPlan = resolveExpectedGainPlan(row, planCapital, { chartPoints: chartPts });
      const roiBundle = planRoiBundleFromGainPlan(gainPlan, planCapital, days);

      // ── Stabilità della pendenza (driver entry/exit) ──────────────────────
      // Calcola consistency, rotation_flag, stability_class, persistence_window
      // dalle slopes 5d/20d (e opzionalmente 45d). Stessa logica di
      // prediction.curve_forecast.compute_slope_stability_metrics (Python).
      const stab = computeSlopeStability(curveSlope5d, curveSlope20d, curveSlope45d);
      // Slope "effettivo" per il verdetto (preferenza 20d, fallback 5d)
      const effSlopeForVerdict =
        curveSlope20d != null && Number.isFinite(curveSlope20d)
          ? curveSlope20d
          : curveSlope5d ?? null;
      const verdict: StabilityVerdict = stabilityVerdict(stab, effSlopeForVerdict);

      // Score e classificazione usano la predizione corretta + allineamento slope
      const gapPct = resolveScoreGapPct(row, chartPts);
      const score  = computeScore(affidRaw, r2, pred5, days, curveSlope5d, gapPct, curveSlope20d);
      const action = actionKind(score, pred5, days, pnlPct, hasPosition, curveSlope5d);
      let upsideScore = computeUpsideScore(pred5, curveSlope5d, affidRaw, r2, runUp30d);
      upsideScore = upsideScorePipelineAdjust(upsideScore, roiBundle.planReturnPct);
      // Penalità random zone: se storicamente la fascia di Affidabilità
      // corrispondente non offre edge direzionale, declassiamo il segnale.
      if (expectedHitRandomZone && expectedHitN >= 5) upsideScore -= 20;
      // Bonus quando il quintile cohort mostra edge solido (≥ 60%): conferma
      // empirica che il modello in questa fascia funziona.
      if (
        expectedHitPct != null &&
        expectedHitPct >= COHORT_HIT_SOLID_PP &&
        expectedHitN >= 5
      ) {
        upsideScore += 8;
      }
      // ── Bonus / penalità da stabilità pendenza ───────────────────────────
      // Trend stabile e crescente = il driver più forte per ENTRY.
      // Rotazione di pendenza = segnale di EXIT (penalizza forte).
      if (stab.rotationFlag === 1) {
        upsideScore -= 25;            // rotazione: pendenza recente flipped
      } else if (stab.stabilityClass === "high_consistency_45d") {
        upsideScore += 12;            // trend stabile 5d+20d+45d
      } else if (stab.stabilityClass === "high_consistency_20d") {
        upsideScore += 8;             // trend stabile 5d+20d
      } else if (stab.stabilityClass === "med_consistency") {
        upsideScore += 3;
      }
      // Direzione del bonus: se slope > 0 il bonus rimane, se slope < 0 lo
      // invertiamo (un trend negativo stabile NON è un'opportunità di entry).
      if (effSlopeForVerdict != null && effSlopeForVerdict < 0) {
        // Sottrai il bonus appena aggiunto (se positivo): il trend stabile
        // negativo è invece un segnale di AVOID.
        if (stab.stabilityClass === "high_consistency_45d") upsideScore -= 24; // 12 +12
        else if (stab.stabilityClass === "high_consistency_20d") upsideScore -= 16;
        else if (stab.stabilityClass === "med_consistency") upsideScore -= 6;
      }

      const timingPredictabilityPct = computeTimingPredictabilityPct(
        days, r2, affidRaw, stab.consistency,
      );
      const effectiveHit = effectiveTimingHitPct(expectedHitPct, timingPredictabilityPct);

      return {
        ticker, cd, days, affid: affidRaw, r2,
        pred5,           // bias-corrected (usato per scoring e target)
        pred5Raw,        // valore grezzo dal foglio
        biasCorrection,  // entità della correzione
        biasSegLabel,    // segmento che ha prodotto la correzione
        inferenza, stars,
        score, action, upsideScore,
        expectedHitPct, expectedHitQuintile, expectedHitN, expectedHitRandomZone,
        slopeConsistency:      stab.consistency,
        slopeRotationFlag:     stab.rotationFlag,
        slopeStabilityClass:   stab.stabilityClass,
        persistenceWindowDays: stab.persistenceWindowDays,
        stabilityVerdict:      verdict,
        timing: timingLabel(days), size: sizeHint(score, affidRaw, r2),
        hasPosition, pnlPct, pnlEur, pnlEur24h, pnlPct24h, buyPriceUsd,
        currentPriceUsd,
        slope20d: curveSlope20d,
        clinicalKpi,
        k8Kpi,
        precatKind: precatEntry.kind,
        precatLabel: precatEntry.label,
        precatExpectedReturn: precatEntry.expectedReturnPct,
        precatProbPositive: precatEntry.probPositive,
        planReturnPct: roiBundle.planReturnPct,
        planGainEur: roiBundle.planGainEur,
        planDays: roiBundle.planDays,
        planCapitalEur: planCapital,
        planGainSource: gainPlan.source,
        planTargetReturnPct: roiBundle.planTargetReturnPct,
        planTargetDays: roiBundle.planTargetDays,
        planTargetHighPct: roiBundle.planTargetHighPct,
        planCdReturnPct: roiBundle.planCdReturnPct,
        planCdDays: roiBundle.planCdDays,
        planCdGainEur: roiBundle.planCdGainEur,
        simRow: row,
        cdZone: resolveCdZone(days),
        timingPredictabilityPct,
        effectiveHitPct: effectiveHit,
      };
    }).filter(
      (r) =>
        r.ticker &&
        r.cd &&
        r.days != null &&
        isActiveCdMonitoring(r.days) &&
        r.days <= SIM_MONITOR_HORIZON_DAYS,
    );
  // segGroups + quintiles come dipendenze: i segnali vengono ricalcolati
  // appena il cohort è caricato (per bias correction + Hit% atteso).
  // ``inputs`` dipendenza: garantisce che ``hasPosition`` e ``pnlPct`` si
  // aggiornino subito quando l'utente apre/chiude una posizione nella
  // Simulation tab. ``lang`` come dep: ricalcola ``timingLabel`` quando
  // l'utente cambia lingua (le label sono lette via ``tStatic`` che è
  // sincronizzato col language store).
  }, [
    simTable,
    segGroups,
    quintiles,
    inputs,
    portfolioHistory,
    lang,
    tradeCalibTick,
    cohortLoaded,
    signalsPointsBySeriesKey,
  ]);

  // Top Opportunità — SOLO società con rialzo atteso nelle prossime settimane.
  // Filtri:
  //  - pred5 (bias-corrected) ≥ soglia configurabile
  //  - CD non passata (>= 0 gg) — se non c'è CD imminente va bene comunque
  //    finché la curva indica upside (pre-fase è ammessa)
  //  - escludiamo le short e le "exit" (uscita = non upside)
  // Ranking: ROI/g al target (primario), poi upsideScore / pred5.
  // Aggiunta separata: posizioni aperte con upside positivo (continui a vederle).
  // Classificazione dei segnali per le Top Opportunità.
  //
  // Per ogni segnale, oltre a includerlo o escluderlo, registriamo il MOTIVO
  // dell'esclusione. Questo permette di mostrare un pannello dedicato
  // "Esclusi dalle Top" sotto le card principali, così l'utente vede subito
  // quali società con previsione di crescita sono state filtrate e perché.
  const TOP_OPPORTUNITY_CAP = 20;
  const WATCH_OPPORTUNITY_CAP = 10;

  const upsideClassification = useMemo(() => {
    type Excluded = ExcludedItem;

    const keyOf = (r: SignalRow): string => `${r.ticker}|${r.cd}`;

    // Estrai i pinnati dai segnali correnti. Vengono SEMPRE in cima alle Top,
    // ignorando i normali filtri (l'utente li ha forzati esplicitamente).
    const pinnedSignals: SignalRow[] = [];
    const pinnedKeysSet = new Set<string>();
    for (const r of signals) {
      const k = keyOf(r);
      if (pinnedKeys.has(k) && isHotZone(r.days)) {
        pinnedSignals.push(r);
        pinnedKeysSet.add(k);
      }
    }
    // Ordina i pinnati per la STESSA chiave scelta (così anche dentro i
    // pinned l'ordine va dal "migliore al peggiore"). Tiebreaker upsideScore.
    const sortByTop = (a: SignalRow, b: SignalRow): number => {
      const rda = roiPerDayFromPlan(
        a.planReturnPct ?? a.planTargetReturnPct,
        a.planTargetDays ?? a.planDays ?? a.days,
      );
      const rdb = roiPerDayFromPlan(
        b.planReturnPct ?? b.planTargetReturnPct,
        b.planTargetDays ?? b.planDays ?? b.days,
      );
      if (Math.abs(rda - rdb) > 0.0001) return rdb - rda;
      const va = topSortValue(a, topSortKey);
      const vb = topSortValue(b, topSortKey);
      if (va !== vb) return vb - va;
      return b.upsideScore - a.upsideScore;
    };
    pinnedSignals.sort(sortByTop);

    const eligible: SignalRow[] = [];
    const excluded: Excluded[] = [];

    for (const r of signals) {
      // Pinnati: già contati come "Top", saltiamo classification
      if (pinnedKeysSet.has(keyOf(r))) continue;
      // Zona watch (61–120 gg): gestita nel pannello dedicato sotto
      if (isWatchZone(r.days)) continue;
      // Solo CD entro la hot zone (≤60 gg): le card sotto sono etichettate "Hot zone"
      if (!isHotZone(r.days)) {
        const zone = resolveCdZone(r.days);
        const zoneLabel =
          zone === "beyond"
            ? `CD > ${SIM_MONITOR_HORIZON_DAYS}d — outside hot zone (see watch / Simulation)`
            : zone === "past"
              ? "CD passed — outside hot zone"
              : zone === "unknown"
                ? "CD date missing — outside hot zone"
                : `Outside hot zone (need CD within ${SIM_HOT_ZONE_DAYS}d)`;
        excluded.push({
          signal: r,
          reason: "outside_hot_zone",
          reasonLabel: zoneLabel,
        });
        continue;
      }
      // 1. Nessuna predizione
      if (r.pred5 == null) {
        excluded.push({
          signal: r,
          reason: "no_pred",
          reasonLabel: "Pred +5 mancante",
        });
        continue;
      }
      // 2. Predizione negativa o nulla
      if (r.pred5 <= 0) {
        excluded.push({
          signal: r,
          reason: "negative_pred",
          reasonLabel: `Pred +5 ≤ 0 (${fmtPct(r.pred5)})`,
        });
        continue;
      }
      // 3. Sotto soglia rialzo atteso
      if (r.pred5 < upsideThresholdPct) {
        excluded.push({
          signal: r,
          reason: "below_threshold",
          reasonLabel: `Pred +5 ${fmtPct(r.pred5)} < soglia +${upsideThresholdPct.toFixed(1)}%`,
        });
        continue;
      }
      // 4. Archivio past catalyst (>7 gg post-CD)
      if (isPastCatalystArchived(r.days)) {
        excluded.push({
          signal: r,
          reason: "cd_past",
          reasonLabel: `Past catalyst (CD +${Math.abs(r.days ?? 0)}d)`,
        });
        continue;
      }
      // 5. Azione skip / short / exit
      if (r.action === "skip") {
        excluded.push({
          signal: r,
          reason: "action_skip",
          reasonLabel: "Action: — Skip (CD passed or low score)",
        });
        continue;
      }
      if (r.action === "short") {
        excluded.push({
          signal: r,
          reason: "action_short",
          reasonLabel: "Action: ▼ Watch Short (expected decline)",
        });
        continue;
      }
      if (r.action === "exit") {
        excluded.push({
          signal: r,
          reason: "action_exit",
          reasonLabel: "Action: ↩ Consider exit",
        });
        continue;
      }
      // 5b. Action MONITOR (rendered as "WATCH" warn-colored badge):
      //     significa "score basso, segnale ambiguo, non è un buy". Le Top
      //     Opportunità devono restare riservate a ``forte`` (Strong Signal)
      //     e ``watch`` (Watch Long, score ≥ 40). Senza questo filtro entrano
      //     anche segnali con score 30-39 e Hit% storico basso (es. PLSE
      //     score 36 hit 38%, BCAB score 38 hit 38%).
      if (r.action === "monitor") {
        excluded.push({
          signal: r,
          reason: "action_monitor",
          reasonLabel: "Action: ● Monitor (score below 40 — ambiguous)",
        });
        continue;
      }
      // 6. Hit% atteso sotto soglia (solo se filtro attivo)
      if (
        expectedHitThreshold > 0 &&
        r.expectedHitPct != null &&
        r.expectedHitN >= 5 &&
        r.expectedHitPct < expectedHitThreshold
      ) {
        excluded.push({
          signal: r,
          reason: "low_hit",
          reasonLabel: `Historical Hit% ${Math.round(r.expectedHitPct)}% < threshold ${expectedHitThreshold}%`,
        });
        continue;
      }
      // 7. Filtro qualità rigoroso (default ON):
      //    Top Opportunità deve essere un VERO candidato di rialzo. Escludiamo
      //    segnali con Hit% sotto random, in zona random, o con verdetto
      //    di stabilità non-positivo (watch/exit/avoid).
      if (qualityStrict) {
        // 7a. Hit% storico inequivocabilmente sotto random (n sufficiente)
        if (
          r.expectedHitPct != null &&
          r.expectedHitN >= 5 &&
          r.expectedHitPct < (50 - COHORT_HIT_RANDOM_HALFWIDTH_PP)
        ) {
          excluded.push({
            signal: r,
            reason: "hit_below_random",
            reasonLabel: `Historical Hit% ${Math.round(r.expectedHitPct)}% < 45% (below random, n=${r.expectedHitN})`,
          });
          continue;
        }
        // 7b. Hit% in zona random (50 ± 5pp): salta se ROI→CD chiaramente positivo
        if (
          r.expectedHitPct != null &&
          r.expectedHitN >= 5 &&
          isCohortInRandomZone(r.expectedHitPct) &&
          !(r.planReturnPct != null && r.planReturnPct >= 1.5)
        ) {
          excluded.push({
            signal: r,
            reason: "hit_random_zone",
            reasonLabel: `Historical Hit% ${Math.round(r.expectedHitPct)}% in random zone 50±${COHORT_HIT_RANDOM_HALFWIDTH_PP}pp (n=${r.expectedHitN})`,
          });
          continue;
        }
        // 7c. Stabilità della pendenza: rotazione recente → exit
        if (r.stabilityVerdict === "exit") {
          excluded.push({
            signal: r,
            reason: "verdict_exit",
            reasonLabel: "Slope rotation (5d↔20d inverted) — verdict EXIT",
          });
          continue;
        }
        // 7d. Trend negativo persistente
        if (r.stabilityVerdict === "avoid") {
          excluded.push({
            signal: r,
            reason: "verdict_avoid",
            reasonLabel: "Persistently negative trend — verdict AVOID",
          });
          continue;
        }
        // 7e. Coerenza bassa: ammetti WATCH se ROI→CD > 1%
        if (r.stabilityVerdict === "watch") {
          if (r.planReturnPct == null || r.planReturnPct <= 1) {
            excluded.push({
              signal: r,
              reason: "verdict_watch",
              reasonLabel: "Low slope coherence — verdict WATCH (wait for confirmation)",
            });
            continue;
          }
        }
      }

      // 7f. Coerenza con il pre-catalyst entry verdict.
      //
      // La card body usa lo stesso engine (``buildPrecatEntry``) e dichiara
      // esplicitamente "🚫 Non entrare" / "🔴 Sell" / "⚠ Late" / "⏰ Too early"
      // quando il setup pre-CD NON è un'opportunità. Mostrare quella stessa
      // card come "Top Opportunity" è incoerente: l'utente vede il banner ma
      // il contenuto dice "non entrare".
      //
      // Da adesso una card entra nelle Top SOLO se ``precatKind`` è ``enter``
      // o ``accumulate``. Gli altri verdetti vanno nei rispettivi excluded.
      if (r.precatKind === "avoid") {
        excluded.push({
          signal: r,
          reason: "precat_avoid",
          reasonLabel: "Pre-CD: 🚫 Do not enter — non-positive slope (no entry signal)",
        });
        continue;
      }
      if (r.precatKind === "sell") {
        excluded.push({
          signal: r,
          reason: "precat_sell",
          reasonLabel: "Pre-CD: 🔴 Sell — BTR terminal zone (sell-the-news risk)",
        });
        continue;
      }
      if (r.precatKind === "late") {
        excluded.push({
          signal: r,
          reason: "precat_late",
          reasonLabel: "Pre-CD: ⚠ Late entry — high risk of buying near top",
        });
        continue;
      }
      if (r.precatKind === "too_early") {
        excluded.push({
          signal: r,
          reason: "precat_too_early",
          reasonLabel: "Pre-CD: ⏰ Too early — outside optimal window (T-30/T-40)",
        });
        continue;
      }
      // 7g. Sicurezza ulteriore: anche se ``precatKind`` è enter/accumulate,
      // se il rendimento atteso verso CD è ≤ 0 il sistema sta dicendo
      // "non ti aspettare un rialzo" — non è una Top Opp.
      if (r.planReturnPct != null && r.planReturnPct <= 0) {
        excluded.push({
          signal: r,
          reason: "precat_zero_return",
          reasonLabel: `ROI target ${r.planReturnPct.toFixed(1)}% ≤ 0 — no rise segment upside`,
        });
        continue;
      }

      // 8. Filtro Affidabilità minima (sempre attivo se soglia > 0).
      //
      // Diagnosi cohort: edge reale solo sopra Aff>=85% (Hit% 47-51%).
      // Sotto Aff<70% il modello è rumore o anti-correlato (Hit% 38-40%).
      // Default UI 70%; raccomandato 85% per edge solido.
      if (minAffidabilita > 0) {
        const affPct = r.affid != null ? r.affid * 100 : null;
        if (affPct == null || affPct < minAffidabilita) {
          excluded.push({
            signal: r,
            reason: "below_min_aff",
            reasonLabel: affPct == null
              ? `Confidence n/a (required ≥ ${minAffidabilita}%)`
              : `Confidence ${Math.round(affPct)}% < threshold ${minAffidabilita}%`,
          });
          continue;
        }
      }

      const sdsFails = sdsStrictPickFailures(r.ticker, "hot", sdsByTicker);
      if (sdsFails.length > 0) {
        const f = sdsFails[0];
        excluded.push({
          signal: r,
          reason: f.code as ExcludedItem["reason"],
          reasonLabel: sdsExclusionLabel(f, t),
        });
        continue;
      }

      eligible.push(r);
    }

    // Open positions: vogliono comparire in Top SOLO se il segnale è davvero
    // buono — non basta ``pred5 > 0``. In passato bastava una pred quasi nulla
    // (es. PTGX +0.09%) per finire tra le Top con action ``Monitor`` e verdetto
    // "Do not enter": un'inclusione fuorviante.
    //
    // Adesso applichiamo lo STESSO bar di qualità degli eligible naturali:
    //   - pred5 ≥ upsideThresholdPct (soglia utente)
    //   - action positiva (forte / watch) — Monitor / Short / Exit / Skip esclusi
    //   - CD non passata da più di 7 giorni
    // Una posizione aperta che NON passa rimane visibile come riga "Open
    // position" nella tabella sotto, ma non occupa uno slot nelle Top.
    // L'utente può forzare la visibilità con il pin (📌).
    const pinnedKeysOnlySet = new Set(pinnedSignals.map(keyOf));
    const openPositions = signals.filter((r) => {
      if (!r.hasPosition) return false;
      if (pinnedKeysOnlySet.has(keyOf(r))) return false; // già nei pinned
      if (!isHotZone(r.days)) return false;
      if (r.days == null || isPastCatalystArchived(r.days)) return false;
      if (r.pred5 == null) return false;
      if (r.pred5 < upsideThresholdPct) return false;
      if (r.action !== "forte" && r.action !== "watch") return false;
      // Stesso bar pre-cat applicato agli eligible naturali: anche una
      // posizione aperta non rientra nelle Top se la card direbbe
      // "Non entrare" / "Late" / "Sell" / "Too early".
      if (r.precatKind !== "enter" && r.precatKind !== "accumulate") return false;
      if (r.planReturnPct != null && r.planReturnPct <= 0) return false;
      return true;
    });

    // Le eligible naturali + le open positions vengono ORDINATE INSIEME, così
    // l'utente vede la lista dalla migliore alla peggiore secondo la chiave
    // scelta (upside / pred / affid / hit). Prima invece le open positions
    // erano accodate dopo gli eligible senza ordinamento — un'open position
    // con upsideScore alto finiva in fondo dietro eligible con score basso.
    // I segnali pinned restano sempre in cima (decisione esplicita utente),
    // ma ordinati anche loro tra di sé con la stessa chiave.
    const eligibleSet = new Set(eligible.map(keyOf));
    const combinedNaturals: SignalRow[] = [
      ...eligible,
      ...openPositions.filter((r) => !eligibleSet.has(keyOf(r))),
    ].sort(sortByTop);

    // Cap dei "naturali" tiene conto degli slot già occupati dai pinnati,
    // così il numero totale di card resta ≤ TOP_OPPORTUNITY_CAP.
    const remainingSlots = Math.max(0, TOP_OPPORTUNITY_CAP - pinnedSignals.length);
    const topEligible = combinedNaturals.slice(0, remainingSlots);
    combinedNaturals.slice(remainingSlots).forEach((r, idx) => {
      const rank = remainingSlots + 1 + idx + pinnedSignals.length;
      const sortDesc = topSortKey === "upside" ? `upside ${r.upsideScore}` :
                       topSortKey === "pred5"  ? `pred5 ${(r.pred5 ?? 0).toFixed(1)}%` :
                       topSortKey === "affid"  ? `affid ${Math.round((r.affid ?? 0) * 100)}%` :
                                                 `hit ${r.expectedHitPct == null ? "—" : Math.round(r.expectedHitPct) + "%"}`;
      excluded.push({
        signal: r,
        reason: "rank_cap",
        reasonLabel: `Rank ${rank} — outside top ${TOP_OPPORTUNITY_CAP} (${sortDesc})`,
      });
    });

    // Merge finale: pinnati in cima (ordinati tra loro per la stessa chiave),
    // poi gli altri dal migliore al peggiore.
    const merged = [...pinnedSignals, ...topEligible];

    // Counter per la mini-dashboard sotto la sezione Top.
    // ``included`` ora conta esattamente le card mostrate (pinned + topEligible);
    // le open positions sono già fuse dentro topEligible dall'ordinamento unico.
    void openPositions; // tenuto come variabile esplicita per chiarezza del flusso
    const breakdown = {
      total: signals.length,
      included: pinnedSignals.length + topEligible.length,
      pinned: pinnedSignals.length,
      excludedBelowThreshold: excluded.filter((e) => e.reason === "below_threshold").length,
      excludedNegativePred: excluded.filter((e) => e.reason === "negative_pred" || e.reason === "no_pred").length,
      excludedAction: excluded.filter((e) =>
        e.reason === "action_short" || e.reason === "action_exit" ||
        e.reason === "action_skip" || e.reason === "action_monitor"
      ).length,
      excludedPrecat: excluded.filter((e) =>
        e.reason === "precat_avoid" || e.reason === "precat_late" ||
        e.reason === "precat_sell"  || e.reason === "precat_too_early" ||
        e.reason === "precat_zero_return"
      ).length,
      excludedCdPast: excluded.filter((e) => e.reason === "cd_past").length,
      excludedLowHit: excluded.filter((e) => e.reason === "low_hit").length,
      excludedRankCap: excluded.filter((e) => e.reason === "rank_cap").length,
      // Filtro qualità rigoroso
      excludedHitBelowRandom: excluded.filter((e) => e.reason === "hit_below_random").length,
      excludedHitRandomZone: excluded.filter((e) => e.reason === "hit_random_zone").length,
      excludedVerdictExit: excluded.filter((e) => e.reason === "verdict_exit").length,
      excludedVerdictAvoid: excluded.filter((e) => e.reason === "verdict_avoid").length,
      excludedVerdictWatch: excluded.filter((e) => e.reason === "verdict_watch").length,
      excludedBelowMinAff: excluded.filter((e) => e.reason === "below_min_aff").length,
      excludedOutsideHot: excluded.filter((e) => e.reason === "outside_hot_zone").length,
      excludedSds: excluded.filter((e) => isSdsExclusionReason(e.reason)).length,
    };

    return { top: merged, excluded, breakdown, pinnedKeysSet };
  }, [signals, upsideThresholdPct, expectedHitThreshold, qualityStrict, minAffidabilita, pinnedKeys, topSortKey, tradeCalibTick, sdsByTicker, t]);

  const topSignals  = upsideClassification.top;
  const excludedFromTop = upsideClassification.excluded;
  const upsideBreakdown = upsideClassification.breakdown;
  const pinnedKeysSet = upsideClassification.pinnedKeysSet;

  /** Watch zone (61–120 gg): stessi criteri di qualità ma ammette too_early e pesa predictibilità. */
  const watchClassification = useMemo(() => {
    type Excluded = {
      signal: SignalRow;
      reason: string;
      reasonLabel: string;
    };
    const keyOf = (r: SignalRow) => `${r.ticker}|${r.cd}`;
    const sortWatch = (a: SignalRow, b: SignalRow) => {
      const wa = a.upsideScore * (a.timingPredictabilityPct / 100);
      const wb = b.upsideScore * (b.timingPredictabilityPct / 100);
      if (wa !== wb) return wb - wa;
      return (b.r2 ?? 0) - (a.r2 ?? 0);
    };

    const pinnedWatch: SignalRow[] = [];
    const pinnedWatchKeys = new Set<string>();
    for (const r of signals) {
      const k = keyOf(r);
      if (pinnedKeys.has(k) && isWatchZone(r.days)) {
        pinnedWatch.push(r);
        pinnedWatchKeys.add(k);
      }
    }
    pinnedWatch.sort(sortWatch);

    const eligible: SignalRow[] = [];
    const excluded: Excluded[] = [];

    const reject = (r: SignalRow, reason: string, reasonLabel: string) => {
      excluded.push({ signal: r, reason, reasonLabel });
    };

    for (const r of signals) {
      if (!isWatchZone(r.days)) continue;
      if (pinnedWatchKeys.has(keyOf(r))) continue;

      if (r.pred5 == null) {
        reject(r, "no_pred", "Pred +5 mancante");
        continue;
      }
      if (r.pred5 <= 0) {
        reject(r, "negative_pred", `Pred +5 ≤ 0 (${fmtPct(r.pred5)})`);
        continue;
      }
      if (r.pred5 < upsideThresholdPct) {
        reject(r, "below_threshold", `Pred +5 ${fmtPct(r.pred5)} < soglia +${upsideThresholdPct.toFixed(1)}%`);
        continue;
      }
      if (r.r2 == null || r.r2 < WATCH_ZONE_MIN_R2) {
        reject(
          r,
          "watch_low_r2",
          `R² ${r.r2?.toFixed(2) ?? "—"} < ${WATCH_ZONE_MIN_R2} (curva poco affidabile lontano dal CD)`,
        );
        continue;
      }
      if (r.timingPredictabilityPct < 28) {
        reject(
          r,
          "watch_low_predictability",
          `Predictibilità timing ${r.timingPredictabilityPct}% troppo bassa per la watch zone`,
        );
        continue;
      }
      if (r.action === "skip" || r.action === "short" || r.action === "exit" || r.action === "monitor") {
        reject(r, "action", `Action: ${r.action}`);
        continue;
      }
      if (r.precatKind === "avoid" || r.precatKind === "sell" || r.precatKind === "late") {
        reject(r, "precat", `Pre-CD: ${r.precatLabel}`);
        continue;
      }
      if (r.planReturnPct != null && r.planReturnPct <= 0) {
        reject(r, "precat_zero_return", `ROI target ≤ 0`);
        continue;
      }
      if (minAffidabilita > 0) {
        const affPct = r.affid != null ? r.affid * 100 : null;
        if (affPct == null || affPct < minAffidabilita) {
          reject(r, "below_min_aff", `Conf. ${affPct == null ? "—" : Math.round(affPct)}% < ${minAffidabilita}%`);
          continue;
        }
      }
      if (qualityStrict) {
        const effHit = r.effectiveHitPct;
        if (effHit != null && r.expectedHitN >= 5 && effHit < 45) {
          reject(
            r,
            "watch_low_effective_hit",
            `Hit% eff. ${effHit}% < 45% (cohort ${Math.round(r.expectedHitPct ?? 0)}% × predict. ${r.timingPredictabilityPct}%)`,
          );
          continue;
        }
        if (r.stabilityVerdict === "exit" || r.stabilityVerdict === "avoid") {
          reject(r, "verdict", `Verdetto pendenza: ${r.stabilityVerdict}`);
          continue;
        }
      }

      const sdsWatchFails = sdsStrictPickFailures(r.ticker, "watch", sdsByTicker, r.days);
      if (sdsWatchFails.length > 0) {
        const f = sdsWatchFails[0];
        reject(r, f.code, sdsExclusionLabel(f, t));
        continue;
      }

      eligible.push(r);
    }

    eligible.sort(sortWatch);
    const remaining = Math.max(0, WATCH_OPPORTUNITY_CAP - pinnedWatch.length);
    const topWatch = [...pinnedWatch, ...eligible.slice(0, remaining)];
    return { topWatch, excludedWatch: excluded };
  }, [signals, upsideThresholdPct, qualityStrict, minAffidabilita, pinnedKeys, sdsByTicker, t]);

  const watchSignalsRanked = useMemo(
    () => watchClassification.topWatch,
    [watchClassification.topWatch],
  );

  // Top 2 BUY: miglior ROI/giorno al target tra Top Opp (non in portafoglio).
  // Top 2 SELL: decrescita sostenuta (target/CD + pendenze).
  const bestBuySell = useMemo(() => {
    const portfolioTickers = new Set(
      signals.filter((s) => s.hasPosition).map((s) => s.ticker.trim().toUpperCase()),
    );
    const buyPool = buildTop2BuyPool(signals, topSignals, portfolioTickers, {
      allowUnfilteredFallback: false,
    });
    const buy = pickTop2BuyCandidates(buyPool, portfolioTickers);
    const buyTickers = new Set(buy.map((s) => s.ticker));
    const sell = pickTop2SellCandidates(signals, buyTickers);
    return { buy, sell };
  }, [topSignals, signals]);

  const topSignalsRanked = useMemo(
    () => sortByDealRank(topSignals, "buy"),
    [topSignals],
  );

  const portfolioPositionCount = useMemo(
    () => signals.filter((s) => s.hasPosition).length,
    [signals],
  );

  const worstPortfolioRanked = useMemo(() => {
    const buyTickers = new Set(bestBuySell.buy.map((s) => s.ticker));
    return pickWorstPortfolioCandidates(signals, buyTickers);
  }, [signals, bestBuySell.buy]);

  const focusedExternalSignal = useMemo(() => {
    if (!focusSignal) return null;
    const inLists = [...topSignalsRanked, ...watchSignalsRanked].some((s) =>
      matchDecisionLabSignalFocus(s.ticker, s.cd, focusSignal),
    );
    if (inLists) return null;
    return signals.find((s) => matchDecisionLabSignalFocus(s.ticker, s.cd, focusSignal)) ?? null;
  }, [focusSignal, topSignalsRanked, watchSignalsRanked, signals]);

  const panelRootRef = useRef<HTMLDivElement>(null);

  const isNavFocusedSignal = useCallback(
    (s: SignalRow) =>
      focusSignal != null && matchDecisionLabSignalFocus(s.ticker, s.cd, focusSignal),
    [focusSignal],
  );

  useEffect(() => {
    if (!focusSignal) return;

    const tickerUp = focusSignal.ticker.trim().toUpperCase();
    const domId = focusSignal.cd?.trim()
      ? decisionLabSignalDomId(focusSignal.ticker, focusSignal.cd)
      : null;

    const raf = window.requestAnimationFrame(() => {
      const el =
        (domId && document.getElementById(domId)) ||
        panelRootRef.current?.querySelector<HTMLElement>(
          `[id^="decision-lab-signal-${CSS.escape(tickerUp)}-"]`,
        );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const t = window.setTimeout(() => onFocusSignalConsumed?.(), 4000);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [
    focusSignal,
    focusedExternalSignal,
    topSignalsRanked.length,
    watchSignalsRanked.length,
    onFocusSignalConsumed,
  ]);

  // Publish recommendation tiers (hot / watch / top2 buy) for Dashboard + Simulation.
  useEffect(() => {
    const rowKey = (row: Record<string, unknown>) => simulationRowSeriesKey(row);
    setActiveTopOpps(
      {
        hotKeys: seriesKeysFromSimRows(topSignals, rowKey),
        watchKeys: seriesKeysFromSimRows(watchSignalsRanked, rowKey),
        top2BuyKeys: seriesKeysFromSimRows(bestBuySell.buy, rowKey),
      },
      { publishedBy: "decision-lab" },
    );
  }, [topSignals, watchSignalsRanked, bestBuySell.buy]);

  useEffect(() => {
    setTop2BuySell(
      bestBuySell.buy.map((s) => signalRowToTop2(s as SignalRow)),
      bestBuySell.sell.map((s) => signalRowToTop2(s as SignalRow)),
    );
  }, [bestBuySell]);

  // [Rimosso] fallbackSignal: in passato mostravamo la OpportunityCard del
  // "miglior candidato sotto-soglia" quando le Top erano vuote, ma quella card
  // induceva in errore — appariva PTGX/ANIK come "raccomandazione" anche se
  // aveva "Non entrare", Hit% sotto random e Pred~0.
  // Ora se topSignals è vuoto mostriamo SOLO il riepilogo filtri + suggerimenti.

  const slopeAlerts = useMemo(
    () => buildSlopeAlertsFromSignalRows(signals, signalsPointsBySeriesKey),
    [signals, signalsPointsBySeriesKey],
  );

  if (simLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
        <p className="text-sm text-ink-muted">Caricamento dati simulation…</p>
      </div>
    );
  }
  if (!simTable) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <span className="text-4xl">📊</span>
        <p className="text-sm font-medium text-ink-muted">
          Dati Simulation non ancora caricati
        </p>
        {simError && (
          <p className="text-xs text-[rgb(var(--signal-down))] max-w-xs">{simError}</p>
        )}
        {onReload && (
          <button
            type="button"
            className="mt-1 px-4 py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold hover:bg-accent/25 transition"
            onClick={onReload}
          >
            Carica dati ora
          </button>
        )}
        {!onReload && (
          <p className="text-xs text-ink-muted/60">
            Vai alla tab <strong>Simulation</strong> e ricarica il foglio.
          </p>
        )}
      </div>
    );
  }

  return (
    <div ref={panelRootRef} className="space-y-5">

      {slopeBannerPlacement === "inline" ? (
        <SlopeAlertBanner
          alerts={slopeAlerts}
          onOpenSlopeErrorCharts={onOpenSlopeErrorCharts}
          onNavigateToSimulation={onNavigateToSimulation}
        />
      ) : null}

      {tradeCalibHint ? (
        <p className="text-[10px] text-[rgb(var(--signal-up))] border border-[rgb(var(--signal-up))]/25 rounded-lg px-2.5 py-1.5 bg-[rgb(var(--signal-up))]/[0.06]">
          {tradeCalibHint}
          <span className="text-ink-muted ml-1">
            — soglie Action tarate dagli esiti trade Simulation (rebuild dopo buy/sell).
          </span>
        </p>
      ) : null}

      {/* ── Top Opportunità cards ── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            ⚡ {t("signals.top.title")}
            <span className="text-[10px] text-ink-muted font-normal">
              {t("signals.top.subtitle")}
            </span>
          </h3>
        </div>
        {pinnedKeys.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-muted">
              📌 <strong>{pinnedKeys.size}</strong> {t("signals.top.pinned")}
            </span>
            <button
              type="button"
              onClick={clearAllPins}
              className="text-[10px] text-accent/70 hover:text-accent transition"
            >
              {t("signals.top.removeAll")}
            </button>
          </div>
        )}

        {/* Filtro Top Opportunità — affidabilità + soglia rialzo */}
        <div className="decision-lab-block rounded-lg border px-3 py-2 space-y-2">
          {/* Riga 1: Affidabilità */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold w-28 shrink-0">
              {lang === "it" ? "Affidabilità" : "Confidence"}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { v: 0,  hint: lang === "it" ? "Nessun filtro affidabilità" : "No confidence filter" },
                { v: 60, hint: lang === "it" ? "Affidabilità accettabile ≥ 60% (default)" : "Acceptable confidence ≥ 60% (default)" },
                { v: 70, hint: lang === "it" ? "Affidabilità buona ≥ 70%" : "Good confidence ≥ 70%" },
                { v: 85, hint: lang === "it" ? "Edge solido: Conf ≥ 85%, hit% storico ~47-51%" : "Solid edge: Conf ≥ 85%, historical hit% ~47-51%" },
                { v: 90, hint: lang === "it" ? "Conservativo: pochi segnali, massima fiducia" : "Conservative: few signals, maximum confidence" },
              ].map(({ v, hint }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMinAffidabilita(v)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition tabular-nums ${
                    minAffidabilita === v
                      ? "bg-accent/15 text-accent border-accent/30 font-semibold"
                      : "text-ink-muted border-[rgb(var(--border))]/40 hover:text-ink hover:border-[rgb(var(--border))]"
                  }`}
                  title={hint}
                >
                  {v === 0 ? "off" : `${v}%`}
                </button>
              ))}
            </div>
            <span
              className="text-[10px] text-ink-muted ml-auto tabular-nums text-right leading-snug"
              title={
                lang === "it"
                  ? "Card visibili sotto con i filtri attuali (hot · watch · Top 2 BUY/SELL). La sezione Worst portfolio ignora questi filtri."
                  : "Cards visible below with current filters (hot · watch · Top 2 BUY/SELL). Worst portfolio section ignores these filters."
              }
            >
              {t("signals.filter.panelCounts", {
                hot: topSignalsRanked.length,
                watch: watchSignalsRanked.length,
                top2: bestBuySell.buy.length + bestBuySell.sell.length,
              })}
            </span>
          </div>

          {/* Riga 2: Soglia rialzo pred +5 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold w-28 shrink-0">
              {lang === "it" ? "Rialzo minimo" : "Min upside"}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { v: 0.5, hint: lang === "it" ? "Permissivo: qualsiasi previsione positiva (≥ +0.5%)" : "Permissive: any positive prediction (≥ +0.5%)" },
                { v: 1.0, hint: lang === "it" ? "Moderato: rialzo atteso ≥ +1.0%" : "Moderate: expected upside ≥ +1.0%" },
                { v: 1.5, hint: lang === "it" ? "Default: rialzo atteso ≥ +1.5%" : "Default: expected upside ≥ +1.5%" },
                { v: 2.0, hint: lang === "it" ? "Selettivo: rialzo atteso ≥ +2.0%" : "Selective: expected upside ≥ +2.0%" },
                { v: 3.0, hint: lang === "it" ? "Conservativo: solo segnali con rialzo atteso ≥ +3.0%" : "Conservative: signals with expected upside ≥ +3.0% only" },
              ].map(({ v, hint }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => updateUpsideThreshold(v)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition tabular-nums ${
                    Math.abs(upsideThresholdPct - v) < 0.01
                      ? "bg-accent/15 text-accent border-accent/30 font-semibold"
                      : "text-ink-muted border-[rgb(var(--border))]/40 hover:text-ink hover:border-[rgb(var(--border))]"
                  }`}
                  title={hint}
                >
                  +{v.toFixed(1)}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Always-visible opportunity banner with best 2 BUY + best 2 SELL */}
        <div className="decision-lab-card rounded-xl border px-5 py-6 space-y-3">
            {/* Riepilogo filtri + guida — collassabile (chiuso di default) */}
            <details className="decision-lab-block rounded-md border text-[11px]">
              <summary className="cursor-pointer select-none px-3 py-2 font-semibold decision-lab-label flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
                <span className="text-[9px] text-ink-muted/80" aria-hidden>
                  ▼
                </span>
                <span>
                  {lang === "it" ? "Filtri attivi e guida" : "Active filters & guide"}
                </span>
                <span className="text-[10px] font-normal decision-lab-muted ml-auto tabular-nums">
                  {t("signals.filter.summaryLine", {
                    shown: topSignalsRanked.length + watchSignalsRanked.length,
                    total: signals.length,
                  })}
                </span>
              </summary>
              <div className="px-3 pb-2 pt-0 space-y-2 decision-lab-muted border-t border-[rgb(var(--panel-lab-border))]/40">
                <div className="space-y-1">
                  <p className="font-semibold decision-lab-label">{lang === "it" ? "Filtri attivi:" : "Active filters:"}</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    <li>{lang === "it" ? "Previsione rialzo" : "Upside prediction"}: pred +5 ≥ <strong className="decision-lab-text">+{upsideThresholdPct.toFixed(1)}%</strong></li>
                    {minAffidabilita > 0 && (
                      <li>{lang === "it" ? "Affidabilità combinata" : "Combined confidence"} ≥ <strong className="decision-lab-text">{minAffidabilita}%</strong></li>
                    )}
                    <li>
                      {lang === "it"
                        ? "Top 2 BUY = stesse regole delle card Top Opportunità sotto"
                        : "Top 2 BUY = same rules as Top Opportunity cards below"}
                    </li>
                    <li>
                      {lang === "it"
                        ? "Worst portfolio = tutte le posizioni in portafoglio da rivedere per uscita (non filtrate da Affidabilità / Rialzo minimo)"
                        : "Worst portfolio = all open positions flagged for exit review (not filtered by Confidence / Min upside)"}
                    </li>
                  </ul>
                  {signalsDataAsOf && (
                    <p className="text-[10px] decision-lab-muted pt-0.5">
                      {lang === "it" ? "Segnali congelati al" : "Signals frozen on"}{" "}
                      <strong className="decision-lab-text tabular-nums">{signalsDataAsOf}</strong>
                      {lang === "it"
                        ? " (ultimo refresh live / snapshot). A mercato chiuso le raccomandazioni restano fisse finché non premi «Aggiorna dati»."
                        : " (last live refresh / snapshot). While markets are closed, picks stay fixed until you press «Refresh data»."}
                    </p>
                  )}
                  {!cohortLoaded && (
                    <p className="text-[10px] text-[rgb(var(--warn))]">
                      {lang === "it" ? "Calibrazione cohort in corso…" : "Loading cohort calibration…"}
                    </p>
                  )}
                  <p className="pt-1 decision-lab-muted">
                    {signals.length} {lang === "it" ? "ticker totali" : "total tickers"} ·{" "}
                    {signals.filter(s => s.pred5 != null && s.pred5 > 0).length} {lang === "it" ? "con pred > 0" : "with pred > 0"} ·{" "}
                    {signals.filter(s => s.action === "short").length} {lang === "it" ? "attesi in calo" : "expected to fall"}
                    {signals.filter(s => s.hasPosition).length > 0 &&
                      ` · ${signals.filter(s => s.hasPosition).length} ${lang === "it" ? "posizioni aperte" : "open positions"}`}
                  </p>
                </div>

                <div className="leading-relaxed">
                  <span className="font-semibold decision-lab-label">{lang === "it" ? "Cosa fare:" : "What to do:"}</span>{" "}
                  {minAffidabilita >= 85 && (
                    <>{lang === "it" ? "abbassa la soglia Affidabilità a 70% per includere segnali con edge debole · " : "lower the Confidence threshold to 70% to include signals with weak edge · "}</>
                  )}
                  {upsideThresholdPct > 1 && (
                    <>{lang === "it" ? "abbassa la soglia Rialzo minimo per includere candidati sotto-soglia · " : "lower the Min upside threshold to include sub-threshold candidates · "}</>
                  )}
                  {qualityStrict && (
                    <>{lang === "it" ? "i segnali borderline sono esclusi dal filtro qualità interno · " : "borderline signals are excluded by the internal quality filter · "}</>
                  )}
                  {lang === "it"
                    ? 'ricarica i dati con "🔄 Aggiorna dati" se bloccati su oggi · elenco completo in Simulation → tabella All.'
                    : 'reload data with "🔄 Refresh data" if stuck on today · full list in Simulation → All table.'}
                </div>

                <p className="text-[10px] text-[rgb(var(--panel-feed-accent-strong))]/80 leading-snug border-l-2 border-[rgb(var(--accent))]/30 pl-2 py-1">
                  {t("signals.slopeHarmonyNote")}
                </p>
                <p className="text-[10px] text-ink-muted/75 px-1 border border-dashed border-[rgb(var(--border))]/50 rounded-md py-2 text-center">
                  {lang === "it"
                    ? "Top 2 BUY / SELL sono in Dashboard, sotto il salvadanaio."
                    : "Top 2 BUY / SELL are on the Dashboard, below the piggy bank."}
                </p>
              </div>
            </details>

            {signals.length === 0 && (
              <p className="text-xs text-[rgb(var(--warn))] text-center">
                {lang === "it"
                  ? '⚠ Nessuna riga letta — verifica che siano presenti le colonne "Ticker" e "Completion Date".'
                  : '⚠ No rows read — verify that "Ticker" and "Completion Date" columns are present.'}
              </p>
            )}
          </div>
        {focusedExternalSignal && (
          <div className="space-y-2 pb-2 border-b border-[rgb(var(--panel-lab-border))]/60">
            <p className="text-[10px] text-[rgb(var(--accent))] font-medium px-1">
              {t("signals.focus.fromSimulation")}
            </p>
            <OpportunityCard
              key={`focus-${focusedExternalSignal.ticker}-${focusedExternalSignal.cd}`}
              signal={focusedExternalSignal}
              rec={buildRecommendation(
                focusedExternalSignal,
                matchQuintile(focusedExternalSignal.affid, quintiles),
              )}
              rankIndex={0}
              rankTotal={1}
              domId={decisionLabSignalDomId(focusedExternalSignal.ticker, focusedExternalSignal.cd)}
              isNavFocused
              onNavigateToSimulation={onNavigateToSimulation}
              onOpenPredictionCharts={onOpenPredictionCharts}
              onOpenEisDetail={openEisDetail}
              simTable={simTable}
              sdsRows={sdsRowsForMig}
              chartPoints={
                signalsPointsBySeriesKey.get(
                  simulationRowSeriesKey(focusedExternalSignal.simRow) ?? "",
                ) ?? undefined
              }
              zone="watch"
            />
          </div>
        )}

        <div className="space-y-3">
            <div className="px-1">
              <h4 className="text-sm font-semibold decision-lab-text">
                🔥 {t("signals.hot.title")}
              </h4>
              <p className="text-[10px] decision-lab-muted leading-snug">
                {t("signals.hot.subtitle", { days: SIM_HOT_ZONE_DAYS })}
              </p>
            </div>
            {topSignalsRanked.length === 0 ? (
              <p className="text-xs decision-lab-muted px-1 py-3 text-center border border-dashed border-[rgb(var(--border))]/40 rounded-lg">
                {t("signals.hot.emptyFiltered")}
              </p>
            ) : (
            topSignalsRanked.map((s, rankIndex) => {
              const q   = matchQuintile(s.affid, quintiles);
              const rec = buildRecommendation(s, q);
              const key = s.ticker + "|" + s.cd;
              const isPinned = pinnedKeysSet.has(key);
              return (
                <OpportunityCard
                  key={s.ticker + s.cd}
                  signal={s}
                  rec={rec}
                  rankIndex={rankIndex}
                  rankTotal={topSignalsRanked.length}
                  isPinned={isPinned}
                  onUnpin={() => togglePin(key)}
                  onNavigateToSimulation={onNavigateToSimulation}
                  onOpenPredictionCharts={onOpenPredictionCharts}
                  onOpenEisDetail={openEisDetail}
                  simTable={simTable}
                  sdsRows={sdsRowsForMig}
                  domId={decisionLabSignalDomId(s.ticker, s.cd)}
                  isNavFocused={isNavFocusedSignal(s)}
                  chartPoints={
                    signalsPointsBySeriesKey.get(
                      simulationRowSeriesKey(s.simRow) ?? "",
                    ) ?? undefined
                  }
                  zone="hot"
                />
              );
            })
            )}
          </div>

        <div className="space-y-3 pt-2 border-t border-[rgb(var(--panel-lab-border))]/60">
          <div className="px-1">
            <h4 className="text-sm font-semibold text-[rgb(var(--signal-down))]">
              📉 {t("signals.worst.title")}
            </h4>
            <p className="text-[10px] decision-lab-muted leading-snug">
              {t("signals.worst.subtitle")}
            </p>
            {portfolioPositionCount > 0 && (
              <p className="text-[10px] decision-lab-muted mt-0.5 tabular-nums">
                {worstPortfolioRanked.length} / {portfolioPositionCount}{" "}
                {lang === "it" ? "posizioni in analisi exit" : "positions flagged for exit review"}
              </p>
            )}
          </div>

          {portfolioPositionCount === 0 ? (
            <p className="text-xs decision-lab-muted px-1 py-2 text-center border border-dashed border-[rgb(var(--border))]/40 rounded-lg">
              {t("signals.worst.emptyNone")}
            </p>
          ) : worstPortfolioRanked.length === 0 ? (
            <p className="text-xs text-[rgb(var(--signal-up))] px-1 py-2 text-center border border-[rgb(var(--signal-up))]/25 bg-[rgb(var(--signal-up))]/[0.06] rounded-lg">
              {t("signals.worst.emptyOk", { n: portfolioPositionCount })}
            </p>
          ) : (
            worstPortfolioRanked.map((s, rankIndex) => {
              const q = matchQuintile(s.affid, quintiles);
              const rec = buildRecommendation(s, q);
              const reasons = worstPortfolioReasons(s);
              return (
                <OpportunityCard
                  key={`worst-${s.ticker}-${s.cd}`}
                  signal={s}
                  rec={rec}
                  rankIndex={rankIndex}
                  rankTotal={worstPortfolioRanked.length}
                  rankOrder="worst_first"
                  exitReasons={reasons}
                  onNavigateToSimulation={onNavigateToSimulation}
                  onOpenPredictionCharts={onOpenPredictionCharts}
                  onOpenEisDetail={openEisDetail}
                  simTable={simTable}
                  sdsRows={sdsRowsForMig}
                  domId={decisionLabSignalDomId(s.ticker, s.cd)}
                  isNavFocused={isNavFocusedSignal(s)}
                  chartPoints={
                    signalsPointsBySeriesKey.get(
                      simulationRowSeriesKey(s.simRow) ?? "",
                    ) ?? undefined
                  }
                  zone="worst"
                />
              );
            })
          )}
        </div>

        {watchSignalsRanked.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-[rgb(var(--panel-lab-border))]/60">
            <div className="px-1">
              <h4 className="text-sm font-semibold decision-lab-text">
                👁 {t("signals.watch.title")}
              </h4>
              <p className="text-[10px] decision-lab-muted leading-snug">
                {t("signals.watch.subtitle", {
                  hot: SIM_HOT_ZONE_DAYS,
                  monitor: SIM_MONITOR_HORIZON_DAYS,
                })}
              </p>
            </div>
            {watchSignalsRanked.map((s, rankIndex) => {
              const q   = matchQuintile(s.affid, quintiles);
              const rec = buildRecommendation(s, q);
              const key = s.ticker + "|" + s.cd;
              const isPinned = pinnedKeys.has(key);
              return (
                <OpportunityCard
                  key={`watch-${s.ticker}-${s.cd}`}
                  signal={s}
                  rec={rec}
                  rankIndex={rankIndex}
                  rankTotal={watchSignalsRanked.length}
                  isPinned={isPinned}
                  onUnpin={() => togglePin(key)}
                  onNavigateToSimulation={onNavigateToSimulation}
                  onOpenPredictionCharts={onOpenPredictionCharts}
                  onOpenEisDetail={openEisDetail}
                  simTable={simTable}
                  sdsRows={sdsRowsForMig}
                  domId={decisionLabSignalDomId(s.ticker, s.cd)}
                  isNavFocused={isNavFocusedSignal(s)}
                  chartPoints={
                    signalsPointsBySeriesKey.get(
                      simulationRowSeriesKey(s.simRow) ?? "",
                    ) ?? undefined
                  }
                  zone="watch"
                />
              );
            })}
          </div>
        )}

        {/* Mini-dashboard breakdown esclusioni */}
        <UpsideBreakdownStrip
          breakdown={upsideBreakdown}
          upsideThresholdPct={upsideThresholdPct}
          expectedHitThreshold={expectedHitThreshold}
          qualityStrict={qualityStrict}
          minAffidabilita={minAffidabilita}
        />

        {/* Pannello "Esclusi dalle Top" — espandibile */}
        {excludedFromTop.length > 0 && (
          <ExcludedFromTopPanel
            excluded={excludedFromTop}
            upsideThresholdPct={upsideThresholdPct}
            onLowerThreshold={() =>
              updateUpsideThreshold(Math.max(UPSIDE_THRESHOLD_MIN_PCT, upsideThresholdPct - 0.5))
            }
            onPin={(key) => togglePin(key)}
          />
        )}
      </section>

      {/* ── Legenda colonne e scoring ── */}
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer select-none font-medium text-ink-muted/80 hover:text-ink">
          {lang === "it" ? "Come leggere punteggi e Simulation" : "How to read scoring and Simulation"}
        </summary>
        <p className="mt-2 text-[11px] text-ink-muted/90">
          {lang === "it"
            ? "Ticker, curve, target/stop e azioni sono in Simulation → All. L’analisi score si apre da Simulation. Log eventi slope e divergenze contrarian: Catalyst Hub → Grafici → Slope errors."
            : "Tickers, curves, target/stop and actions are in Simulation → All. Score analysis opens from Simulation. Slope event logs: Catalyst Hub → Charts → Slope errors."}
        </p>
        <ColumnGuidePanel guide={columnGuide} />
        <div className="mt-4 grid sm:grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-md border border-[rgb(var(--border))]/40 p-2.5 space-y-1">
            <p className="font-semibold text-ink">{lang === "it" ? "Score segnale 0–100" : "Signal score 0–100"}</p>
            <p>{lang === "it" ? "35 pt · Confidence (affidabilita modello)" : "35 pt · Confidence (model confidence)"}</p>
            <p>{lang === "it" ? "20 pt · Fit R² (qualita curva predittiva)" : "20 pt · R² fit (prediction curve quality)"}</p>
            <p>{lang === "it" ? "20 pt · Prossimita CD (timing)" : "20 pt · CD proximity (timing)"}</p>
            <p>{lang === "it" ? "±8 / −15 pt · Allineamento segno slope ↔ pred (non magnitudine)" : "±8 / −15 pt · Slope ↔ pred sign alignment (not magnitude)"}</p>
            <p className="text-ink-muted/70 mt-1">
              {lang === "it"
                ? "Pred +5 visibile solo in hover — non conteggiata (post-CD ~50% random). Usata per badge azione in Simulation (Strong / Watch / etc.)."
                : "Pred +5 shown on hover only — not counted (post-CD ~50% random). Used for action badges in Simulation (Strong / Watch / etc.)."}
            </p>
          </div>
          <div className="rounded-md border border-[rgb(var(--accent))]/40 bg-[rgb(var(--accent))]/8 p-2.5 space-y-1">
            <p className="font-semibold text-[rgb(var(--accent))]">{lang === "it" ? "⚡ Upside score (Top & Worst)" : "⚡ Upside score (Top & Worst)"}</p>
            <p className="text-ink-muted/80 italic">
              {lang === "it"
                ? "Curva (slope) + accuratezza modello (R²·Affidabilità) sono i driver primari. La pred grezza è scalata da un \"trust factor\": un pred alto su un modello inaffidabile NON sovrasta una pred modesta supportata da fit solido e curva in salita."
                : "Curve (slope) + model accuracy (R²·Confidence) are the primary drivers. The raw pred is scaled by a \"trust factor\": a high pred on an unreliable model does NOT override a modest pred backed by solid fit and rising curve."}
            </p>
            <p>{lang === "it" ? "+25 / +18 / +8 pt · Slope ↑ (curva osservata sale: +0.5 / +0.2 / >0 pp/d)" : "+25 / +18 / +8 pt · Slope ↑ (observed curve rising: +0.5 / +0.2 / >0 pp/d)"}</p>
            <p>{lang === "it" ? "−12 / −22 pt · Slope ↓ con pred > 0 (curva osservata scende: inversione vs modello)" : "−12 / −22 pt · Slope ↓ with pred > 0 (observed curve falling: reversal vs model)"}</p>
            <p>{lang === "it" ? "up to 30 pt · Pred +5 positivo (graduato a fasce), scalato 50–100% dal trust = (R² + Affidabilità)/2" : "up to 30 pt · Positive Pred +5 (graduated by band), scaled 50–100% by trust = (R² + Confidence)/2"}</p>
            <p>{lang === "it" ? "up to 30 pt · Bonus qualità additivo (R² + Affidabilità)" : "up to 30 pt · Additive quality bonus (R² + Confidence)"}</p>
            <p>{lang === "it" ? "+8 / −5 / −3 pt · Run-up 30d pulito (+5/+25% bonus, >25% BTR overbought, <−10% CTR)" : "+8 / −5 / −3 pt · Clean 30d run-up (+5/+25% bonus, >25% BTR overbought, <−10% CTR)"}</p>
            <p className="text-[rgb(var(--signal-down))] font-medium mt-1">
              {lang === "it" ? "Penalità qualità (additivi):" : "Quality penalties (additive):"}
            </p>
            <p>{lang === "it" ? "−10 pt · R² < 0.30 (fit della curva = rumore)" : "−10 pt · R² < 0.30 (curve fit = noise)"}</p>
            <p>{lang === "it" ? "−10 pt · Affidabilità < 40% (cohort storico non offre edge)" : "−10 pt · Confidence < 40% (historical cohort offers no edge)"}</p>
            <p className="text-[rgb(var(--warn))] font-medium mt-1">
              {lang === "it" ? "+ validazione storica (cohort):" : "+ historical validation (cohort):"}
            </p>
            <p>{lang === "it" ? "+8 pt · quintile cohort con Hit% ≥ 60% (edge solido confermato)" : "+8 pt · cohort quintile with Hit% ≥ 60% (confirmed solid edge)"}</p>
            <p>{lang === "it" ? "−20 pt · quintile cohort in zona random 50 ± 5pp (nessun edge modello)" : "−20 pt · cohort quintile in random zone 50 ± 5pp (no model edge in this band)"}</p>
            <p className="text-ink-muted/70 mt-1">
              {lang === "it"
                ? "Entrano solo titoli con Pred +5 ≥ soglia configurabile (default +1.5%) e, se alzi il filtro Hit%, solo quelli con Hit% storica ≥ soglia. Niente short, niente sell-the-news."
                : "Only stocks with Pred +5 ≥ configurable threshold (default +1.5%) enter, and — if the expected Hit% filter is raised — only those with historical Hit% ≥ threshold. No shorts, no sell-the-news."}
            </p>
          </div>
          <div className="rounded-md border border-[rgb(var(--border))]/40 p-2.5 space-y-1">
            <p className="font-semibold text-ink">{lang === "it" ? "Pred corretta e target" : "Corrected pred and target"}</p>
            <p>{lang === "it" ? "⚖ La pred grezza viene corretta sottraendo il bias sistematico del segmento corrispondente (fase > indicazione > direzione)" : "⚖ The raw prediction is corrected by subtracting the systematic bias of the corresponding segment (phase > indication > direction)"}</p>
            <p>{lang === "it" ? "Target = media di [0.4×P, 1.6×P] dove P = pred corretta (o mean_R storico se P non disponibile)" : "Target = avg of [0.4×P, 1.6×P] where P = corrected pred (or historical mean_R if P unavailable)"}</p>
            <p>{lang === "it" ? "Stop = −0.6×|P| (min −5%) · valori di bias visibili in hover sulla cella ⚖" : "Stop = −0.6×|P| (min −5%) · bias values visible by hovering on the ⚖ cell"}</p>
          </div>
        </div>
      </details>

      <EisDetailDrawer
        open={eisDrawer != null}
        onClose={() => setEisDrawer(null)}
        ticker={eisDrawer?.ticker ?? null}
        clinicalKpi={eisDrawer?.clinicalKpi}
        it={lang === "it"}
      />
    </div>
  );
}
