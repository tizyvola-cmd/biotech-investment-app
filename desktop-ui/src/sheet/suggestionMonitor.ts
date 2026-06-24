/**
 * Monitor unificato suggerimenti buy/sell — arricchisce le valutazioni del loop
 * con score RA, SDS, MII, match poligono e pipeline step-by-step.
 */
import type { ChartPoint } from "../types";
import type { SdsRow } from "../api/supernova";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  buildDecisionSimEvaluations,
  explainBuyBlockReason,
  explainBuyReason,
  explainBuyWarning,
  explainHoldThesis,
  explainSellReason,
  type DecisionSimContext,
  type PaperPosition,
  type TickerSimEvaluation,
} from "./investDecisionSimLoop";
import {
  buildLossAnalysisItems,
  buildRecoveryProbContextForAlert,
  type PortfolioLossAnalysisItem,
} from "./portfolioLossAnalysis";
import { computeCompositeForLossItem } from "./investDecisionSimLoop";
import { signalMetricsFromSimRow } from "./investSignalScore";
import type { MigSoliditySnapshot } from "./entrySolidityMig";
import { formatTop2VerdictDisplay, top2VerdictColumnLabel } from "./top2DecisionHelpers";
import {
  applyAdviceFeedback,
  type AdviceFeedback,
  type AdviceCorrectionRecord,
} from "./adviceFeedback";
import type { SimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import {
  applySynthExposureBridge,
  isSynthExposureUrgentAlert,
  type SynthExposureKind,
  synthExposureRationale,
} from "./synthExposureBridge";

export type SuggestedActionKind = TickerSimEvaluation["suggestedAction"];

/** BUY, SELL e HOLD portafoglio con tesi recupero generano popup/monitor. */
export function isRecommendedAction(action: SuggestedActionKind): boolean {
  return action === "buy" || action === "sell";
}

export function isAlertableRecommendation(
  row: Pick<SuggestionMonitorRow, "suggestedAction" | "profile" | "holdThesis" | "hasPosition" | "inPaperPortfolio" | "synthExposureKind">,
): boolean {
  if (isSynthExposureUrgentAlert(row)) return true;
  if (row.suggestedAction === "buy" || row.suggestedAction === "sell") return true;
  return row.suggestedAction === "hold" && row.profile === "portfolio" && Boolean(row.holdThesis);
}

/** BUY su riga portafoglio già aperta → mostra HOLD/MANTIENI in UI (azione interna resta buy). */
export function isPortfolioHoldDisplay(
  action: SuggestedActionKind,
  hasPosition: boolean,
): boolean {
  return action === "buy" && hasPosition;
}

export function uiSuggestedAction(
  action: SuggestedActionKind,
  hasPosition: boolean,
): SuggestedActionKind {
  return isPortfolioHoldDisplay(action, hasPosition) ? "hold" : action;
}

export function suggestedActionLabel(
  action: SuggestedActionKind,
  lang: "it" | "en",
  hasPosition = false,
): string {
  const ui = uiSuggestedAction(action, hasPosition);
  switch (ui) {
    case "buy":
      return "BUY";
    case "sell":
      return "SELL";
    case "hold":
      return lang === "it" ? "MANTIENI" : "HOLD";
    case "review":
      return "REVIEW";
    case "none":
    default:
      return lang === "it" ? "—" : "—";
  }
}

export function formatSuggestedActionUpper(
  action: SuggestedActionKind | null | undefined,
): string {
  return (action ?? "none").toUpperCase();
}

export function suggestedActionToneClass(
  action: SuggestedActionKind,
  hasPosition = false,
): string {
  const ui = uiSuggestedAction(action, hasPosition);
  switch (ui) {
    case "buy":
      return "text-emerald-700 dark:text-emerald-300";
    case "sell":
      return "text-rose-700 dark:text-rose-300";
    case "hold":
      return "text-sky-700 dark:text-sky-300";
    case "review":
      return "text-amber-700 dark:text-amber-300";
    default:
      return "text-ink-muted font-normal";
  }
}

/** Testo motivazione per tabella monitor (exit / hold / buy / block). */
export function recommendationRationale(
  row: Pick<
    SuggestionMonitorRow,
    | "suggestedAction"
    | "holdThesis"
    | "buyReason"
    | "sellReason"
    | "buyBlockReason"
    | "exitReason"
    | "synthExposureRationale"
  >,
): string | null {
  if (row.suggestedAction === "hold" && row.holdThesis) return row.holdThesis;
  if (row.suggestedAction === "buy" && row.buyReason) return row.buyReason;
  if (row.suggestedAction === "review" && row.synthExposureRationale) {
    return row.synthExposureRationale;
  }
  if (row.suggestedAction === "sell") {
    return row.synthExposureRationale ?? row.sellReason ?? row.exitReason ?? null;
  }
  if (row.buyBlockReason) return row.buyBlockReason;
  if (row.exitReason?.trim()) return row.exitReason;
  return null;
}

export type SuggestionPipelineStep = {
  id: string;
  labelIt: string;
  labelEn: string;
  value: string;
  tone?: "good" | "bad" | "warn" | "neutral";
};

export type SuggestionMonitorRow = TickerSimEvaluation & {
  company: string;
  profile: "portfolio" | "opportunity";
  side: "buy" | "sell";
  raScore: number | null;
  affidPct: number | null;
  r2: number | null;
  matchPct: number | null;
  sdsScore: number | null;
  miiAngleDeg: number | null;
  calibPreScore: number | null;
  migVerdict: string | null;
  eisScore: number | null;
  planCdReturnPct: number | null;
  recoveryExpectedValuePct: number | null;
  inLoss: boolean;
  curveRisingHold: boolean;
  precatLabel: string;
  stabilityVerdict: string;
  pipelineSteps: SuggestionPipelineStep[];
  buyBlockReason: string | null;
  buyReason: string | null;
  buyWarning: string | null;
  sellReason: string | null;
  holdThesis: string | null;
  /**
   * Raw probability before the advice-feedback bucket correction was applied.
   * Equal to `probPct` when no correction is active.
   */
  probPctRaw: number | null;
  /**
   * Raw suggested action before any action demotion was applied.
   * Equal to `suggestedAction` when no demotion is active.
   */
  suggestedActionRaw: SuggestedActionKind;
  /** Active advice-feedback correction record, or null when none applied. */
  adviceCorrection: AdviceCorrectionRecord | null;
  /** Synth gap bridge — trim / sell promotion (Fase A+B). */
  synthExposureKind: SynthExposureKind;
  synthTargetCapEur: number | null;
  synthExposureRationale: string | null;
};

export type SuggestionMonitorContext = Omit<
  Pick<
    DecisionSimContext,
    "simTable" | "inputs" | "pointsBySeriesKey" | "lang" | "probOptions" | "paperPortfolio"
  >,
  "paperPortfolio"
> & {
  paperPortfolio?: PaperPosition[];
  /**
   * Active advice-feedback snapshot — when provided, each row's probPct and
   * suggestedAction are corrected/demoted according to the snapshot before
   * being returned. Raw values are preserved in `probPctRaw` and
   * `suggestedActionRaw`.
   */
  adviceFeedback?: AdviceFeedback | null;
  /** Weight Sim Exp allocation — abilita synth exposure bridge in Actions. */
  synthAlloc?: SimLoopSynthAllocation | null;
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}pp`;
}

function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function sdsForTicker(sdsRows: SdsRow[] | null | undefined, ticker: string): number | null {
  const tk = String(ticker ?? "").trim().toUpperCase();
  const row = sdsRows?.find((r) => String(r.ticker ?? "").trim().toUpperCase() === tk);
  return row?.sds ?? null;
}

function stepToneForVerdict(v: string): SuggestionPipelineStep["tone"] {
  if (v === "yes" || v === "hold" || v === "enter" || v === "accumulate") return "good";
  if (v === "no" || v === "exit" || v === "avoid" || v === "sell") return "bad";
  if (v === "wait" || v === "review" || v === "watch") return "warn";
  return "neutral";
}

function stepToneForAction(a: TickerSimEvaluation["suggestedAction"]): SuggestionPipelineStep["tone"] {
  if (a === "buy") return "good";
  if (a === "sell") return "bad";
  if (a === "review") return "warn";
  return "neutral";
}

export function buildSuggestionPipelineSteps(
  row: Pick<
    SuggestionMonitorRow,
    | "side"
    | "profile"
    | "precatLabel"
    | "stabilityVerdict"
    | "investVerdict"
    | "probPct"
    | "exitDecision"
    | "exitReason"
    | "suggestedAction"
    | "matchPct"
    | "sdsScore"
    | "miiAngleDeg"
    | "calibPreScore"
    | "migVerdict"
    | "planReturnPct"
    | "planCdReturnPct"
    | "readings"
    | "precatVerdictAgree"
    | "misalignmentLabels"
    | "inLoss"
    | "pnlPct"
    | "curveRisingHold"
    | "compositeScore"
    | "scoringZone"
    | "compositeDampened"
  >,
  lang: "it" | "en",
): SuggestionPipelineStep[] {
  const it = lang === "it";
  const r = row.readings;
  const steps: SuggestionPipelineStep[] = [
    {
      id: "profile",
      labelIt: "Profilo",
      labelEn: "Profile",
      value: it
        ? row.profile === "portfolio"
          ? "Portafoglio reale"
          : "Opportunità hot-zone"
        : row.profile === "portfolio"
          ? "Real portfolio"
          : "Hot-zone opportunity",
      tone: "neutral",
    },
    {
      id: "precat",
      labelIt: "Segnale Precat",
      labelEn: "Precat signal",
      value: `${row.readings.precatKind} · ${row.precatLabel}`,
      tone: stepToneForVerdict(row.readings.precatKind),
    },
    {
      id: "stability",
      labelIt: "Stabilità pendenza",
      labelEn: "Slope stability",
      value: row.stabilityVerdict,
      tone: stepToneForVerdict(row.stabilityVerdict),
    },
    {
      id: "top2",
      labelIt: top2VerdictColumnLabel(row.profile, "it"),
      labelEn: top2VerdictColumnLabel(row.profile, "en"),
      value: formatTop2VerdictDisplay(row.profile, row.investVerdict, it ? "it" : "en"),
      tone: stepToneForVerdict(row.investVerdict),
    },
    {
      id: "prob",
      labelIt: "P(plan) / recupero",
      labelEn: "P(plan) / recovery",
      value: row.probPct != null ? `${Math.round(row.probPct)}%` : "—",
      tone: row.probPct != null && row.probPct >= 55 ? "good" : row.probPct != null && row.probPct < 40 ? "bad" : "warn",
    },
    {
      id: "exit",
      labelIt: "Exit decision",
      labelEn: "Exit decision",
      value: `${row.exitDecision} — ${row.exitReason}`,
      tone: stepToneForVerdict(row.exitDecision),
    },
    {
      id: "composite",
      labelIt: "Score composito (zona CD)",
      labelEn: "Composite score (CD zone)",
      value: `${row.compositeScore ?? "—"}/100 · ${row.scoringZone ?? "—"}${row.compositeDampened ? " · damp" : ""}`,
      tone:
        row.compositeScore != null && row.compositeScore >= 55
          ? "good"
          : row.compositeScore != null && row.compositeScore < 40
            ? "bad"
            : "warn",
    },
    {
      id: "action",
      labelIt: "Azione sim loop",
      labelEn: "Sim loop action",
      value: formatSuggestedActionUpper(row.suggestedAction),
      tone: stepToneForAction(row.suggestedAction ?? "none"),
    },
    {
      id: "target",
      labelIt: "Target / CD ROI",
      labelEn: "Target / CD ROI",
      value: `${fmtPct(row.planReturnPct)} target · ${fmtPct(row.planCdReturnPct)} @ CD`,
      tone: "neutral",
    },
    {
      id: "curve",
      labelIt: "Curva (slope / pred / gap)",
      labelEn: "Curve (slope / pred / gap)",
      value: `s5 ${fmtPp(r.slope5d)} · s20 ${fmtPp(r.slope20d)} · pred+5 ${fmtPp(r.pred5Pp)} · gap ${fmtPct(r.curveGapPct)}`,
      tone: "neutral",
    },
    {
      id: "harmony",
      labelIt: "Harmony overlay↔slope",
      labelEn: "Harmony overlay↔slope",
      value:
        r.harmonyAligned == null
          ? "—"
          : r.harmonyAligned
            ? it
              ? "Allineato"
              : "Aligned"
            : `Δ ${fmtNum(r.harmonyMaxGapPp, 2)} pp`,
      tone: r.harmonyAligned ? "good" : r.harmonyAligned === false ? "bad" : "neutral",
    },
    {
      id: "sn",
      labelIt: "Picco SuperNova vs piano",
      labelEn: "SuperNova peak vs plan",
      value: `${fmtPct(r.planTargetPct)} plan · ${fmtPct(r.supernovaPeakPct)} SN`,
      tone: "neutral",
    },
    {
      id: "scores",
      labelIt: "Score Decision Lab",
      labelEn: "Decision Lab scores",
      value: `Match ${row.matchPct != null ? `${Math.round(row.matchPct)}%` : "—"} · SDS ${row.sdsScore ?? "—"} · MII ${row.miiAngleDeg != null ? `${Math.round(row.miiAngleDeg)}°` : "—"} · Calib ${row.calibPreScore ?? "—"} · ${row.migVerdict ?? "—"}`,
      tone: "neutral",
    },
    {
      id: "precat_agree",
      labelIt: "Precat ↔ verdetto",
      labelEn: "Precat ↔ verdict",
      value: row.precatVerdictAgree ? (it ? "Concordi" : "Agree") : it ? "Discordi" : "Disagree",
      tone: row.precatVerdictAgree ? "good" : "bad",
    },
  ];

  if (row.profile === "portfolio") {
    steps.push({
      id: "pnl",
      labelIt: "P&L posizione",
      labelEn: "Position P&L",
      value: `${row.inLoss ? (it ? "In perdita" : "In loss") : it ? "In guadagno/piatto" : "Gain/flat"} · ${fmtPct(row.pnlPct)}`,
      tone: row.inLoss ? "bad" : "good",
    });
  }

  if (row.curveRisingHold) {
    steps.push({
      id: "rising",
      labelIt: "Curva in salita (hold thesis)",
      labelEn: "Rising curve (hold thesis)",
      value: it ? "Attivo — non uscire solo per pendenza" : "Active — do not exit on slope alone",
      tone: "good",
    });
  }

  if (row.misalignmentLabels.length > 0) {
    steps.push({
      id: "misalign",
      labelIt: "Disallineamenti rilevati",
      labelEn: "Misalignments detected",
      value: row.misalignmentLabels.join(" · "),
      tone: "warn",
    });
  }

  return steps;
}

function lossItemsByKey(
  ctx: SuggestionMonitorContext,
): Map<string, PortfolioLossAnalysisItem & { profile: "portfolio" | "opportunity" }> {
  const map = new Map<string, PortfolioLossAnalysisItem & { profile: "portfolio" | "opportunity" }>();
  for (const it of buildLossAnalysisItems(
    "portfolio",
    ctx.simTable,
    ctx.inputs,
    ctx.pointsBySeriesKey,
    ctx.lang,
    null,
    ctx.probOptions,
  )) {
    map.set(it.key, { ...it, profile: "portfolio" });
  }
  for (const it of buildLossAnalysisItems(
    "opportunities",
    ctx.simTable,
    ctx.inputs,
    ctx.pointsBySeriesKey,
    ctx.lang,
    null,
    ctx.probOptions,
    "watch",
  )) {
    if (!map.has(it.key)) {
      map.set(it.key, { ...it, profile: "opportunity" });
    }
  }
  return map;
}

export function buildSuggestionMonitorRows(ctx: SuggestionMonitorContext): SuggestionMonitorRow[] {
  if (!ctx.simTable?.rows?.length) return [];

  const evaluations = buildDecisionSimEvaluations({
    ...ctx,
    paperPortfolio: ctx.paperPortfolio ?? [],
  });
  const itemsByKey = lossItemsByKey(ctx);
  const simRowByKey = buildSimRowByKeyMap(ctx.simTable.rows);
  const columns = ctx.simTable.columns ?? Object.keys(ctx.simTable.rows[0] ?? {});
  const migByKey = ctx.probOptions?.migSolidityByKey ?? new Map<string, MigSoliditySnapshot>();
  const sdsRows = ctx.probOptions?.sdsRows;

  return evaluations.map((ev) => {
    const item = itemsByKey.get(ev.key);
    const profile = item?.profile ?? (ev.hasPosition ? "portfolio" : "opportunity");
    const simRow = simRowByKey.get(ev.key) ?? null;
    const sk = item?.seriesKey ?? (simRow ? simulationRowSeriesKey(simRow) : null);
    const chartPts: ChartPoint[] | null = sk ? ctx.pointsBySeriesKey.get(sk) ?? null : null;

    const metrics = simRow ? signalMetricsFromSimRow(simRow, columns, { chartPoints: chartPts }) : null;
    const mig = migByKey.get(ev.key);
    const probCtx =
      item && simRow
        ? buildRecoveryProbContextForAlert(
            item,
            simRow,
            chartPts,
            ctx.inputs,
            ctx.simTable!.rows,
            ctx.lang,
            ctx.probOptions,
          )
        : undefined;

    const composite = item
      ? computeCompositeForLossItem(item, {
          signalScore: metrics?.score ?? null,
          sdsScore: probCtx?.sdsScore ?? sdsForTicker(sdsRows, ev.ticker),
          eisSuperScore: probCtx?.eisSuperScore ?? null,
          matchPct: probCtx?.matchPct ?? null,
          miiAngleDeg: probCtx?.miiAngleDeg ?? mig?.slopeAngleDeg ?? null,
        })
      : null;

    const baseAction = ev.suggestedAction ?? "none";
    const actualCapital = ctx.inputs[ev.key]?.capital ?? 0;
    const bridged = applySynthExposureBridge(baseAction, {
      rowKey: ev.key,
      hasPosition: ev.hasPosition,
      inPaperPortfolio: ev.inPaperPortfolio,
      actualCapitalEur: actualCapital,
      totalPnlPct: item?.pnlPct ?? ev.pnlPct ?? null,
      baseSuggestedAction: baseAction,
      item,
      synthAlloc: ctx.synthAlloc,
    });
    const bridgedAction = bridged.suggestedAction;
    const side: "buy" | "sell" = bridgedAction === "sell" ? "sell" : "buy";
    const synthRationale = synthExposureRationale(
      bridged.verdict,
      ctx.lang,
      bridged.rationaleIt,
      bridged.rationaleEn,
    );

    const base = {
      ...ev,
      suggestedAction: bridgedAction,
      compositeScore: composite?.score ?? ev.compositeScore,
      scoringZone: composite?.zone ?? ev.scoringZone,
      scoreBreakdown: composite?.breakdown ?? ev.scoreBreakdown,
      compositeDampened: composite?.dampened ?? ev.compositeDampened,
      company: item?.company ?? "",
      profile,
      side,
      raScore: metrics?.score ?? null,
      affidPct: metrics?.affidPct ?? null,
      r2: metrics?.r2 ?? null,
      matchPct: probCtx?.matchPct ?? null,
      sdsScore: probCtx?.sdsScore ?? sdsForTicker(sdsRows, ev.ticker),
      miiAngleDeg: probCtx?.miiAngleDeg ?? mig?.slopeAngleDeg ?? null,
      calibPreScore: mig?.calibPreScore ?? null,
      migVerdict: mig?.verdict ?? null,
      eisScore: probCtx?.eisSuperScore ?? null,
      planCdReturnPct: item?.planCdReturnPct ?? ev.readings.planCdPct,
      recoveryExpectedValuePct: item?.recoveryExpectedValuePct ?? null,
      inLoss: item?.inLoss ?? false,
      curveRisingHold: item?.curveRisingHold ?? false,
      precatLabel: item?.precatLabel ?? ev.readings.precatKind,
      stabilityVerdict: item?.stabilityVerdict ?? ev.readings.stabilityVerdict,
    } satisfies Omit<
      SuggestionMonitorRow,
      | "pipelineSteps"
      | "buyBlockReason"
      | "buyReason"
      | "buyWarning"
      | "sellReason"
      | "holdThesis"
      | "probPctRaw"
      | "suggestedActionRaw"
      | "adviceCorrection"
      | "synthExposureKind"
      | "synthTargetCapEur"
      | "synthExposureRationale"
    >;

    const blockReason = item
      ? explainBuyBlockReason(item, ev.inPaperPortfolio, ctx.lang)
      : null;
    const buyReason =
      item && bridgedAction === "buy"
        ? explainBuyReason(item, ev.inPaperPortfolio, ctx.lang)
        : null;
    const buyWarning =
      item && bridgedAction === "buy"
        ? explainBuyWarning(item, ev.inPaperPortfolio, ctx.lang)
        : null;
    const sellReason =
      item && bridgedAction === "sell"
        ? explainSellReason(item, ev.inPaperPortfolio, ctx.lang) ??
          synthRationale
        : null;
    const holdThesis = item ? explainHoldThesis(item, ctx.lang) : null;
    const pipelineSteps = buildSuggestionPipelineSteps(
      { ...base, suggestedAction: bridgedAction },
      ctx.lang,
    );
    if (synthRationale && bridged.verdict.kind !== "none") {
      pipelineSteps.unshift({
        id: "synth_exposure",
        labelIt: "Synth · esposizione",
        labelEn: "Synth · exposure",
        value: synthRationale,
        tone: bridgedAction === "sell" ? "bad" : "warn",
      });
    }
    if (holdThesis && bridgedAction !== "sell") {
      pipelineSteps.unshift({
        id: "hold_thesis",
        labelIt: "Tesi hold / recupero",
        labelEn: "Hold / recovery thesis",
        value: holdThesis,
        tone: "good",
      });
    }
    if (buyReason) {
      pipelineSteps.unshift({
        id: "buy_reason",
        labelIt: "Perché BUY",
        labelEn: "Why BUY",
        value: buyReason,
        tone: "good",
      });
    }
    if (buyWarning) {
      pipelineSteps.unshift({
        id: "buy_warning",
        labelIt: "Avviso BUY",
        labelEn: "BUY warning",
        value: buyWarning,
        tone: "warn",
      });
    }
    if (blockReason) {
      pipelineSteps.push({
        id: "buy_block",
        labelIt: "Perché non BUY",
        labelEn: "Why not BUY",
        value: blockReason,
        tone: "warn",
      });
    }
    if (sellReason) {
      pipelineSteps.unshift({
        id: "sell_reason",
        labelIt: "Perché SELL",
        labelEn: "Why SELL",
        value: sellReason,
        tone: "bad",
      });
    }

    const adviceCorrection =
      ctx.adviceFeedback && bridgedAction !== "none"
        ? applyAdviceFeedback(bridgedAction, base.probPct, ctx.adviceFeedback)
        : null;
    const probPctRaw = base.probPct ?? null;
    const suggestedActionRaw = baseAction;
    const correctedProbPct =
      adviceCorrection?.probPctApplied && Number.isFinite(adviceCorrection.probPctCorrected)
        ? adviceCorrection.probPctCorrected
        : probPctRaw;
    const effectiveAction = adviceCorrection?.actionEffective ?? bridgedAction;

    return {
      ...base,
      probPct: correctedProbPct,
      suggestedAction: effectiveAction,
      pipelineSteps,
      buyBlockReason: blockReason,
      buyReason,
      buyWarning,
      sellReason,
      holdThesis,
      probPctRaw,
      suggestedActionRaw,
      adviceCorrection: adviceCorrection ?? null,
      synthExposureKind: bridged.verdict.kind,
      synthTargetCapEur:
        bridged.verdict.kind !== "none" ? bridged.verdict.synthTargetEur : null,
      synthExposureRationale: synthRationale,
    };
  });
}
