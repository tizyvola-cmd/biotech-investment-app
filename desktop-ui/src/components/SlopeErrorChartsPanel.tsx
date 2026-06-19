import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  loadSimulationChartsBundle,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import { resolveRecalibratedChartPoints } from "../sheet/predictionCurveDailyRecalib";
import type { ChartBundle, ChartPoint } from "../types";
import { SlopeTrendDiagram } from "./SlopeTrendDiagram";
import { SlopeTrajectoryChart } from "./SlopeTrajectoryChart";
import type { SheetTable } from "../types";
import { buildPrecatEntry, extractCurveInputs, regimeLabel, type PrecatRegime } from "../sheet/precatCurve";
import { POST_CD_WATCH_CAL_DAYS } from "../sheet/cdLifecycle";
import { daysFromToday } from "../sheet/simulationPlanGain";
import {
  buildSlopeTrajectory,
  canRenderSlopeTrajectory,
  segmentSlopePpD,
  slopeGapsFromTrajectory,
} from "../sheet/slopeRecalibCurve";
import {
  computeSlopeRotationFlag,
  computeSlopeStability,
  stabilityVerdict,
  slopeStabilityLabel,
  verdictLabel,
  type StabilityVerdict,
} from "../sheet/slopeStability";
import {
  daysUntilContrarianChartExpiry,
  daysUntilSlopeChartExpiry,
  dismissSlopeErrorChart,
  loadDismissedSlopeCharts,
  slopeChartDomId,
  slopeCompanyDomId,
  type SlopeChartDismissMap,
} from "../sheet/slopeErrorCharts";
import type { ContrarianEventRecord } from "../sheet/contrarianLog";
import type { SlopeEventRecord } from "../sheet/slopeEventLog";
import {
  CHART_CURVES_FOOTER,
  CHART_CURVES_PANEL,
  CHART_CURVES_TITLE,
  CHART_LAB_LINE_ACTUAL,
  CHART_LAB_LINE_PRED,
} from "../sheet/chartTheme";
import { useLang, useT } from "../shared/i18n";
import { useRefreshStatus } from "../shared/refreshStatusStore";
import {
  SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY,
  slopeThresholdSummary,
} from "../sheet/slopeThresholds";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import {
  fmtSlopeCapitalLossEur,
  resolveSlopeCapitalImpact,
  resolveSlopeStockPrices,
} from "../sheet/slopeStockPrices";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { SlopeCompanyOverviewTable } from "./SlopeCompanyOverviewTable";
import { MarketInterestPanel } from "./MarketInterestPanel";
import {
  buildSlopeFeedForPanel,
  companyNameFromSimRow,
  feedLogCounts,
  groupSlopeFeedByTicker,
  resolveSlopeChartContext,
  type UnifiedSlopeFeedRow,
} from "../sheet/slopeEventsFeed";
import {
  severityLabel,
  summarizeSlopeFeedRow,
} from "../sheet/slopeEventSummary";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { slopePriceGapFromSimRow } from "../sheet/slopeStockPrices";
import {
  filterAndSortCompanies,
} from "../sheet/slopeCompanyRank";
import {
  loadSlopeSeverityFloor,
  saveSlopeSeverityFloor,
  type SlopeSeverityFloor,
} from "../sheet/slopeSeverityPrefs";

function toNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

function fmtSlope(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} pp/d`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = Math.abs(v) > 0 && Math.abs(v) < 0.5 ? 2 : digits;
  return `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function parseDMY(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysFromCdString(cd: string): number | null {
  const d = parseDMY(cd);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function extractSimSheetMetrics(
  row: Record<string, unknown> | null,
  cdFallback: string,
): { r2: number | null; affid: number | null; pred5: number | null; days: number | null } {
  if (!row) {
    return { r2: null, affid: null, pred5: null, days: daysFromCdString(cdFallback) };
  }
  let r2 = toNum(findCol(row, "r²", "r2", "fit r"));
  if (r2 != null && r2 > 1) r2 = r2 / 100;

  let affid = toNum(findCol(row, "confidence", "affid", "affidabilit"));
  if (affid != null && affid > 1) affid = affid / 100;

  let pred5 = toNum(findCol(row, "pred +5", "pred+5", "pred 5"));
  if (pred5 != null && Math.abs(pred5) <= 1.5) pred5 = pred5 * 100;

  const cdStr = String(findCol(row, "cd", "completion date", "data cd") ?? cdFallback).trim();
  const daysRaw = toNum(findCol(row, "giorni", "days to", "days_to"));
  const days = daysRaw ?? daysFromCdString(cdStr);

  return { r2, affid, pred5, days };
}

type Top2SellInfo = { eligible: boolean; reasons: string[] };

function evaluateTop2Sell(
  hasPosition: boolean,
  verdict: StabilityVerdict,
  pred5: number | null,
  lang: "it" | "en",
): Top2SellInfo {
  if (!hasPosition) {
    return {
      eligible: false,
      reasons: [
        lang === "it"
          ? "Nessuna posizione aperta — Top 2 SELL solo portafoglio"
          : "No open position — Top 2 SELL is portfolio-only",
      ],
    };
  }
  const reasons: string[] = [];
  if (verdict === "exit") {
    reasons.push(lang === "it" ? "Verdetto stabilità: exit (rotazione)" : "Stability verdict: exit (rotation)");
  }
  if (verdict === "avoid") {
    reasons.push(
      lang === "it"
        ? "Verdetto stabilità: avoid (trend 20d negativo stabile)"
        : "Stability verdict: avoid (stable negative 20d trend)",
    );
  }
  if (pred5 != null && pred5 < 0) {
    reasons.push(lang === "it" ? `Pred +5 negativa (${fmtPct(pred5)})` : `Negative Pred +5 (${fmtPct(pred5)})`);
  }
  return { eligible: reasons.length > 0, reasons };
}

function buildCardExplanation(
  lang: "it" | "en",
  event: SlopeEventRecord,
  actual5: number | null,
  actual20: number | null,
  deltaPpPerDay: number,
  rotation: boolean,
  verdict: StabilityVerdict,
  precatExpected: number | null,
  pred5: number | null,
  r2: number | null,
  top2: Top2SellInfo,
  usedRecalibPath: boolean,
  maxModelActualGap: number | null,
): string[] {
  const lines: string[] = [];
  const delta = deltaPpPerDay;

  if (usedRecalibPath) {
    lines.push(
      lang === "it"
        ? "Grafico: traiettoria % vs oggi (linea tratteggiata = modello ricalibrato, continua = prezzo reale). La decelerazione si vede quando la reale si appiattisce rispetto al modello o quando slope 5g < 20g (KPI sotto)."
        : "Chart: % vs today (dashed = recalibrated model, solid = actual price). Deceleration shows when actual flattens vs model or when 5d slope < 20d slope (KPIs below).",
    );
    if (maxModelActualGap != null) {
      lines.push(
        lang === "it"
          ? `Scostamento max reale−modello sulla traiettoria: ${maxModelActualGap >= 0 ? "+" : ""}${maxModelActualGap.toFixed(1)}%.`
          : `Max actual−model deviation on path: ${maxModelActualGap >= 0 ? "+" : ""}${maxModelActualGap.toFixed(1)}%.`,
      );
    }
  }

  if (rotation) {
    lines.push(
      lang === "it"
        ? "Rotazione pendenza (5d e 20d con segno opposto, entrambe ≥ 0,10 pp/g): verdetto exit — non è semplice decelerazione."
        : "Slope rotation (5d and 20d opposite sign, both ≥ 0.10 pp/d): exit verdict — not simple deceleration.",
    );
  } else if (event.kind === "slope_dec" && actual20 != null && actual20 >= 0) {
    lines.push(
      lang === "it"
        ? `Evento registrato: decelerazione (Δ 5d−20d = ${fmtSlope(delta)}). Con slope 20d ancora ≥ 0 il banner suggerisce monitoraggio; non implica Top 2 SELL da solo.`
        : `Logged event: deceleration (Δ 5d−20d = ${fmtSlope(delta)}). With slope 20d still ≥ 0 the banner suggests monitoring; does not imply Top 2 SELL on its own.`,
    );
  } else if (event.kind === "slope_dec") {
    lines.push(
      lang === "it"
        ? `Decelerazione registrata (Δ = ${fmtSlope(delta)}), ma slope 20d = ${fmtSlope(actual20)} — il trend medio è già negativo.`
        : `Deceleration logged (Δ = ${fmtSlope(delta)}), but slope 20d = ${fmtSlope(actual20)} — the medium-term trend is already negative.`,
    );
  }

  if (actual5 != null && rotation) {
    lines.push(
      lang === "it"
        ? `Pendenza 5d (${fmtSlope(actual5)}) vs 20d (${fmtSlope(actual20)}): rotazione confermata.`
        : `5d slope (${fmtSlope(actual5)}) vs 20d (${fmtSlope(actual20)}): rotation confirmed.`,
    );
  }

  if (actual20 != null && actual20 < 0) {
    lines.push(
      lang === "it"
        ? `Pendenza 20d negativa (${fmtSlope(actual20)}): con R² ${r2 != null ? r2.toFixed(2) : "—"} il verdetto è tipicamente «${verdictLabel(verdict).split("—")[0].trim()}».`
        : `Negative 20d slope (${fmtSlope(actual20)}): with R² ${r2 != null ? r2.toFixed(2) : "—"} the verdict is typically «${verdictLabel(verdict).split("—")[0].trim()}».`,
    );
  }

  if (precatExpected != null) {
    lines.push(
      lang === "it"
        ? `Rendimento atteso pre-CD (buildPrecatEntry): ${fmtPct(precatExpected)} — pendenza effettiva × giorni al CD (non è Pred +5).`
        : `Pre-CD expected return (buildPrecatEntry): ${fmtPct(precatExpected)} — effective slope × days to CD (not Pred +5).`,
    );
  }

  if (pred5 != null) {
    lines.push(
      lang === "it"
        ? `Pred +5 (foglio Simulation): ${fmtPct(pred5)} — usata tra i criteri Top 2 SELL se < 0.`
        : `Pred +5 (Simulation sheet): ${fmtPct(pred5)} — used in Top 2 SELL criteria when < 0.`,
    );
  }

  if (top2.eligible) {
    lines.push(
      lang === "it"
        ? `Idoneo a Top 2 SELL: ${top2.reasons.join(" · ")}.`
        : `Eligible for Top 2 SELL: ${top2.reasons.join(" · ")}.`,
    );
  } else if (event.had_open_position) {
    lines.push(
      lang === "it"
        ? "In portafoglio ma non idoneo a Top 2 SELL con i criteri attuali (verdetto / pred5)."
        : "In portfolio but not eligible for Top 2 SELL under current criteria (verdict / pred5).",
    );
  }

  return lines;
}

function SlopeChartsGuidePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="decision-lab-block rounded-lg border px-3 py-3 space-y-2 shrink-0">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold decision-lab-text">{t("signals.slopeCharts.guide.title")}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--panel-lab-border))] decision-lab-muted hover:decision-lab-text shrink-0"
        >
          {t("signals.slopeCharts.guide.close")}
        </button>
      </div>
      <div className="text-[11px] decision-lab-muted leading-relaxed whitespace-pre-line">
        {t("signals.slopeCharts.guide.body")}
      </div>
    </div>
  );
}

function kindLabel(kind: SlopeEventRecord["kind"], lang: "it" | "en"): string {
  if (kind === "slope_rev") return lang === "it" ? "Inversione" : "Reversal";
  if (kind === "slope_dec") return lang === "it" ? "Decelerazione" : "Deceleration";
  return lang === "it" ? "Accelerazione" : "Acceleration";
}

function kindTone(kind: SlopeEventRecord["kind"]): string {
  if (kind === "slope_rev") return "text-[rgb(var(--signal-down))]";
  if (kind === "slope_dec") return "text-[rgb(var(--warn))]";
  return "text-[rgb(var(--signal-up))]";
}

function recommendedAction(kind: SlopeEventRecord["kind"], lang: "it" | "en"): string {
  if (kind === "slope_rev") return lang === "it" ? "Valuta uscita — pendenza invertita" : "Consider exit — slope reversed";
  if (kind === "slope_dec") return lang === "it" ? "Monitora — trend in rallentamento" : "Monitor — trend slowing";
  return lang === "it" ? "Trend in rafforzamento" : "Trend strengthening";
}

/** Where to read reversal vs deceleration (sign flip vs same-sign slowdown). */
function SlopeEventSignReadout({
  kind,
  slope5d,
  slope20d,
  rotation,
  liveDelta,
}: {
  kind: SlopeEventRecord["kind"];
  slope5d: number | null;
  slope20d: number | null;
  rotation: boolean;
  liveDelta: number;
}) {
  const t = useT();
  const showRev = kind === "slope_rev" || rotation;
  const showDec = kind === "slope_dec" && !rotation;

  if (!showRev && !showDec) return null;

  const toneCls = showRev
    ? "border-[rgb(var(--signal-down))]/45 bg-[rgb(var(--signal-down))]/[0.08]"
    : "border-[rgb(var(--warn))]/45 bg-[rgb(var(--warn))]/[0.08]";
  const titleCls = showRev ? "text-[rgb(var(--signal-down))]" : "text-[rgb(var(--warn))]";

  return (
    <div className={`rounded-lg border px-3 py-2.5 flex flex-wrap items-center gap-3 ${toneCls}`}>
      <SlopeTrendDiagram slope5d={slope5d} slope20d={slope20d} />
      <div className="flex-1 min-w-[12rem] space-y-0.5">
        <p className={`text-xs font-bold ${titleCls}`}>
          {showRev ? t("signals.slopeCharts.readout.reversal.title") : t("signals.slopeCharts.readout.deceleration.title")}
        </p>
        <p className="text-[11px] decision-lab-muted leading-snug">
          {showRev
            ? t("signals.slopeCharts.readout.reversal.body", {
                s5: fmtSlope(slope5d),
                s20: fmtSlope(slope20d),
              })
            : t("signals.slopeCharts.readout.deceleration.body", {
                delta: fmtSlope(liveDelta),
              })}
        </p>
      </div>
    </div>
  );
}

type ChartCardProps = {
  event: SlopeEventRecord;
  simRow: Record<string, unknown> | null;
  chartPoints: ChartPoint[] | null;
  onDismiss: (id: string) => void;
  highlight?: boolean;
  showDismiss?: boolean;
  /** Ticker assente dal foglio Simulation — metriche da log / curva da snapshot. */
  chartStaleFromLog?: boolean;
  investInputs?: InvestSimInputs | null;
};

function SlopeErrorChartCard({
  event,
  simRow,
  chartPoints,
  onDismiss,
  highlight,
  showDismiss = true,
  chartStaleFromLog = false,
  investInputs,
}: ChartCardProps) {
  const { lang } = useLang();
  const t = useT();
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  const live = simRow ? extractCurveInputs(simRow) : null;
  const sheet = useMemo(
    () => extractSimSheetMetrics(simRow, event.cd),
    [simRow, event.cd],
  );

  const actual5 = live?.slope5d ?? event.slope5d;
  const actual20 = live?.slope20d ?? event.slope20d;
  const actual45 = live?.slope45d ?? null;
  const runUp30d = live?.runUp30d ?? event.run_up_30d;
  const daysToCd = sheet.days ?? event.days_to_cd_at_detection;

  const trajectoryBuild = useMemo(
    () =>
      buildSlopeTrajectory({
        chartPoints,
        simRow,
        daysToCd: daysToCd ?? event.days_to_cd_at_detection ?? 30,
      }),
    [chartPoints, simRow, daysToCd, event.days_to_cd_at_detection],
  );
  const curveData = trajectoryBuild.points;
  const slopeGaps = useMemo(() => slopeGapsFromTrajectory(curveData), [curveData]);

  const modelSeg5 = segmentSlopePpD(curveData, "pred", -5, -10);
  const actualSeg5 = segmentSlopePpD(curveData, "actual", -5, -10);
  const liveDelta =
    actual5 != null && actual20 != null
      ? Math.round((actual5 - actual20) * 100) / 100
      : event.delta_pp_per_day;

  const stability = computeSlopeStability(actual5, actual20, actual45);
  const verdict = stabilityVerdict(stability, actual20);
  const rotation = computeSlopeRotationFlag(actual5, actual20) === 1;
  const precat = useMemo(
    () => buildPrecatEntry(actual5, actual20, runUp30d, daysToCd),
    [actual5, actual20, runUp30d, daysToCd],
  );
  const top2 = useMemo(
    () =>
      evaluateTop2Sell(event.had_open_position === true, verdict, sheet.pred5, lang),
    [event.had_open_position, verdict, sheet.pred5, lang],
  );
  const explainLines = useMemo(
    () =>
      buildCardExplanation(
        lang,
        event,
        actual5,
        actual20,
        liveDelta,
        rotation,
        verdict,
        precat.expectedReturnPct,
        sheet.pred5,
        sheet.r2,
        top2,
        trajectoryBuild.usedRecalibPath,
        slopeGaps.maxAbs,
      ),
    [
      lang,
      event,
      actual5,
      actual20,
      liveDelta,
      rotation,
      verdict,
      precat.expectedReturnPct,
      sheet.pred5,
      sheet.r2,
      top2,
      trajectoryBuild.usedRecalibPath,
      slopeGaps.maxAbs,
    ],
  );

  const daysLeft = daysUntilSlopeChartExpiry(event.detected_at);
  const detectedDate = new Date(event.detected_at).toLocaleString(lang === "it" ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const pnlCol = simRow
    ? Object.keys(simRow).find((k) => /pnl|guadagno|perdita/i.test(k) && /%/i.test(k))
    : undefined;
  const pnlRaw = pnlCol ? toNum(simRow![pnlCol]) : null;
  const pnlPct = pnlRaw != null && Math.abs(pnlRaw) <= 1.5 ? pnlRaw * 100 : pnlRaw;

  const stockPrices = useMemo(
    () => resolveSlopeStockPrices(simRow, chartPoints, null),
    [simRow, chartPoints],
  );
  const capImpact = useMemo(
    () =>
      resolveSlopeCapitalImpact(
        simRow,
        investInputs ?? undefined,
        stockPrices.actual,
        stockPrices.expected,
      ),
    [simRow, investInputs, stockPrices.actual, stockPrices.expected],
  );

  const predName =
    lang === "it" ? "Modello (Pred calib.)" : "Model (Pred calib.)";
  const actualName = lang === "it" ? "Reale (curva)" : "Actual (curve)";

  return (
    <article
      className={`slope-chart-card rounded-xl border p-4 space-y-3 transition scroll-mt-28 ${
        highlight ? "ring-2 ring-[rgb(var(--warn))]/50" : ""
      }`}
      id={slopeChartDomId(event.id)}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-extrabold tracking-wide text-ink">{event.ticker}</span>
            <span className={`text-xs font-bold uppercase ${kindTone(event.kind)}`}>
              {kindLabel(event.kind, lang)}
            </span>
            {event.had_open_position && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[rgb(var(--panel-lab-border))] text-[rgb(var(--panel-lab-label-ink))] bg-[rgb(var(--panel-lab-block-bg))]">
                {lang === "it" ? "Portafoglio" : "Portfolio"}
              </span>
            )}
          </div>
          <p className="text-[11px] decision-lab-muted mt-0.5">
            CD {event.cd}
            {event.days_to_cd_at_detection >= 0
              ? ` · ${t("signals.slope.cdInDays", { n: event.days_to_cd_at_detection })}`
              : ""}
            {" · "}
            {detectedDate}
          </p>
        </div>
        {showDismiss ? (
          <button
            type="button"
            onClick={() => onDismiss(event.id)}
            className="text-[10px] px-2.5 py-1 rounded-md border border-[rgb(var(--panel-lab-border))] decision-lab-muted hover:decision-lab-text hover:bg-[rgb(var(--panel-lab-block-bg))] transition shrink-0"
            title={lang === "it" ? "Rimuovi grafico dopo visione" : "Dismiss chart after review"}
          >
            {lang === "it" ? "✓ Visionato" : "✓ Reviewed"}
          </button>
        ) : null}
      </div>

      <SlopeEventSignReadout
        kind={event.kind}
        slope5d={actual5}
        slope20d={actual20}
        rotation={rotation}
        liveDelta={liveDelta}
      />

      <div className={`${CHART_CURVES_PANEL} min-h-[240px]`}>
        <h4 className={CHART_CURVES_TITLE}>
          {lang === "it"
            ? "Traiettoria % — modello ricalibrato vs reale"
            : "% trajectory — recalibrated model vs actual"}
        </h4>
        {chartStaleFromLog ? (
          <p className="text-[10px] text-[rgb(var(--warn))] px-0.5 -mt-0.5 mb-1 leading-snug">
            {lang === "it"
              ? `${event.ticker} non è nel foglio Simulation caricato: Δ e pendenze in tabella sono lo snapshot del log al rilevamento; la curva usa lo snapshot grafici se disponibile.`
              : `${event.ticker} is not on the loaded Simulation sheet: table Δ/slopes are from the log snapshot at detection; the curve uses the chart snapshot when available.`}
          </p>
        ) : null}
        <div className="flex-1 min-h-[200px]">
          <SlopeTrajectoryChart
            points={curveData}
            todayOffset={trajectoryBuild.todayOffset}
            lang={lang}
            predName={predName}
            actualName={actualName}
            showSlopeWindows
            slope5d={actual5}
            slope20d={actual20}
          />
        </div>
        <p className={CHART_CURVES_FOOTER}>
          <span style={{ color: CHART_LAB_LINE_PRED }}>●</span> {predName}
          {trajectoryBuild.usedRecalibPath ? (
            <>
              {" "}
              ({lang === "it" ? "ricalib." : "recalib."}{" "}
              {trajectoryBuild.knotCount > 0
                ? `${trajectoryBuild.knotCount} ${lang === "it" ? "nodi" : "knots"}`
                : lang === "it"
                  ? "curva completa"
                  : "full curve"}
              )
            </>
          ) : null}
          {slopeGaps.at5 != null && (
            <>
              {" · "}
              {lang === "it" ? "scost. T−5" : "dev. T−5"} {slopeGaps.at5 >= 0 ? "+" : ""}
              {slopeGaps.at5.toFixed(1)}%
            </>
          )}
          {slopeGaps.at20 != null && (
            <>
              {" · "}
              {lang === "it" ? "scost. T−20" : "dev. T−20"} {slopeGaps.at20 >= 0 ? "+" : ""}
              {slopeGaps.at20.toFixed(1)}%
            </>
          )}
          {" · "}
          <span style={{ color: CHART_LAB_LINE_ACTUAL }}>●</span> {actualName}
          {(actualSeg5 != null || modelSeg5 != null) && (
            <>
              {" · "}
              {lang === "it" ? "pend. 5g" : "slope 5d"} reale {fmtSlope(actualSeg5 ?? actual5)} / mod{" "}
              {fmtSlope(modelSeg5)}
            </>
          )}
          {" · "}
          Δ 5d−20d (sheet) {fmtSlope(liveDelta)}
          {event.kind === "slope_rev" && rotation && (
            <span className="text-[rgb(var(--signal-down))] font-semibold">
              {" "}
              · {lang === "it" ? "INVERSIONE: 5g e 20g segno opposto" : "REVERSAL: 5d and 20d opposite sign"}
            </span>
          )}
          {event.kind === "slope_dec" && actual5 != null && actual20 != null && actual5 < actual20 && (
            <span className="text-[rgb(var(--warn))]">
              {" "}
              · {lang === "it" ? "decelerazione" : "deceleration"}: 5g &lt; 20g
            </span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setMetricsOpen((o) => !o)}
        className="text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[rgb(var(--panel-lab-border))] text-[rgb(var(--panel-lab-label-ink))] hover:bg-[rgb(var(--panel-lab-block-bg))] transition"
        aria-expanded={metricsOpen}
      >
        {metricsOpen ? "▾" : "▸"} {t("signals.slopeCharts.metricsTable.btn")}
      </button>

      {metricsOpen ? (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <Metric label={t("signals.slopeCharts.kpi.slope5d")} value={fmtSlope(actual5)} tone={actual5 != null && actual5 < 0 ? "down" : actual5 != null && actual5 > 0 ? "up" : "neutral"} />
        <Metric label={t("signals.slopeCharts.kpi.slope20d")} value={fmtSlope(actual20)} tone={actual20 != null && actual20 < 0 ? "down" : actual20 != null && actual20 > 0 ? "up" : "neutral"} />
        <Metric label={t("signals.slopeCharts.kpi.slope45d")} value={fmtSlope(actual45)} tone="neutral" />
        <Metric
          label={t("signals.slopeCharts.kpi.r2")}
          value={sheet.r2 != null ? sheet.r2.toFixed(2) : "—"}
          tone={sheet.r2 != null && sheet.r2 >= 0.65 ? "up" : sheet.r2 != null && sheet.r2 < 0.3 ? "warn" : "neutral"}
        />
        <Metric
          label={t("signals.slopeCharts.kpi.confidence")}
          value={sheet.affid != null ? `${Math.round(sheet.affid * 100)}%` : "—"}
          tone="neutral"
        />
        <Metric
          label={t("signals.slopeCharts.kpi.expectedPrecat")}
          value={fmtPct(precat.expectedReturnPct)}
          tone={precat.expectedReturnPct != null && precat.expectedReturnPct < 0 ? "down" : precat.expectedReturnPct != null && precat.expectedReturnPct > 0 ? "up" : "neutral"}
        />
        <Metric
          label={t("signals.slopeCharts.kpi.pred5")}
          value={fmtPct(sheet.pred5)}
          tone={sheet.pred5 != null && sheet.pred5 < 0 ? "down" : sheet.pred5 != null && sheet.pred5 > 0 ? "up" : "neutral"}
        />
        <Metric
          label={lang === "it" ? "Δ 5d−20d" : "Δ 5d−20d"}
          value={fmtSlope(liveDelta)}
          tone={
            liveDelta <= -SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY
              ? "warn"
              : event.kind === "slope_rev"
                ? "down"
                : "neutral"
          }
        />
        <Metric
          label={t("signals.slopeCharts.kpi.rotation")}
          value={rotation ? t("signals.slopeCharts.yes") : t("signals.slopeCharts.no")}
          tone={rotation ? "down" : "neutral"}
        />
        <Metric
          label={t("signals.slopeCharts.kpi.eventKind")}
          value={kindLabel(event.kind, lang)}
          tone={event.kind === "slope_rev" ? "down" : event.kind === "slope_dec" ? "warn" : "up"}
        />
        <Metric
          label={lang === "it" ? "Coerenza slope" : "Slope consistency"}
          value={stability.consistency != null ? `${Math.round(stability.consistency * 100)}%` : "—"}
          tone={stability.rotationFlag ? "down" : "neutral"}
        />
        <Metric
          label={lang === "it" ? "Regime" : "Regime"}
          value={regimeLabel(event.regime as PrecatRegime, event.run_up_30d)}
          tone="neutral"
        />
        <Metric
          label="P&L"
          value={pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}
          tone={pnlPct != null && pnlPct < 0 ? "down" : pnlPct != null && pnlPct > 0 ? "up" : "neutral"}
        />
        {capImpact.hasPosition ? (
          <>
            <Metric
              label={t("signals.slope.col.capitalLoss.label")}
              value={fmtSlopeCapitalLossEur(capImpact.modelGapLossEur, lang)}
              tone={
                capImpact.modelGapLossEur != null && capImpact.modelGapLossEur < 0
                  ? "down"
                  : capImpact.modelGapLossEur != null && capImpact.modelGapLossEur > 0
                    ? "up"
                    : "neutral"
              }
            />
            <Metric
              label={t("signals.slope.col.capitalLoss.pnlTotal")}
              value={fmtSlopeCapitalLossEur(capImpact.positionPnlEur, lang)}
              tone={
                capImpact.positionPnlEur != null && capImpact.positionPnlEur < 0
                  ? "down"
                  : capImpact.positionPnlEur != null && capImpact.positionPnlEur > 0
                    ? "up"
                    : "neutral"
              }
            />
          </>
        ) : null}
        <Metric
          label={lang === "it" ? "Stabilità" : "Stability"}
          value={slopeStabilityLabel(stability.stabilityClass)}
          tone={stability.rotationFlag ? "down" : "neutral"}
        />
        <Metric
          label={lang === "it" ? "Verdetto" : "Verdict"}
          value={verdictLabel(verdict).split("—")[0].trim()}
          tone={verdict === "exit" || verdict === "avoid" ? "down" : verdict === "entry" || verdict === "persistent" ? "up" : "neutral"}
        />
        <Metric
          label={t("signals.slopeCharts.kpi.top2Sell")}
          value={top2.eligible ? t("signals.slopeCharts.yes") : t("signals.slopeCharts.no")}
          tone={top2.eligible ? "down" : "neutral"}
          className="col-span-2"
        />
        <Metric
          label={lang === "it" ? "Azione suggerita" : "Suggested action"}
          value={recommendedAction(event.kind, lang)}
          tone={event.kind === "slope_rev" ? "down" : event.kind === "slope_dec" ? "warn" : "up"}
          className="col-span-2"
        />
        <Metric
          label={lang === "it" ? "Scadenza grafico" : "Chart expires"}
          value={
            daysLeft <= 1
              ? lang === "it"
                ? "≤ 1 giorno"
                : "≤ 1 day"
              : lang === "it"
                ? `${daysLeft} giorni`
                : `${daysLeft} days`
          }
          tone="neutral"
        />
      </div>
      ) : null}

      {metricsOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setExplainOpen((o) => !o)}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[rgb(var(--panel-lab-border))] text-[rgb(var(--panel-lab-label-ink))] hover:bg-[rgb(var(--panel-lab-block-bg))] transition"
            aria-expanded={explainOpen}
          >
            {explainOpen ? "▾" : "▸"} {t("signals.slopeCharts.cardExplain.btn")}
          </button>
          {top2.eligible && top2.reasons.length > 0 && !explainOpen ? (
            <span className="text-[10px] decision-lab-muted truncate max-w-full">
              {top2.reasons[0]}
            </span>
          ) : null}
        </div>
      ) : null}

      {metricsOpen && explainOpen ? (
        <div className="decision-lab-block rounded-lg border px-3 py-2.5 space-y-1.5 text-[11px] decision-lab-muted leading-relaxed">
          {explainLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          {explainLines.length === 0 ? (
            <p>{lang === "it" ? "Nessuna nota aggiuntiva per questo evento." : "No additional notes for this event."}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function contrarianDivLabel(type: ContrarianEventRecord["divergence_type"], lang: "it" | "en"): string {
  if (type === "model_up") {
    return lang === "it" ? "Modello ↑ · curva ↓" : "Model ↑ · curve ↓";
  }
  return lang === "it" ? "Modello ↓ · curva ↑" : "Model ↓ · curve ↑";
}

function ContrarianErrorChartCard({
  event,
  simRow,
  chartPoints,
  onDismiss,
  highlight,
  showDismiss = true,
}: {
  event: ContrarianEventRecord;
  simRow: Record<string, unknown> | null;
  chartPoints: ChartPoint[] | null;
  onDismiss: (id: string) => void;
  highlight?: boolean;
  showDismiss?: boolean;
}) {
  const { lang } = useLang();
  const t = useT();
  const [metricsOpen, setMetricsOpen] = useState(false);
  const sheet = useMemo(() => extractSimSheetMetrics(simRow, event.cd), [simRow, event.cd]);
  const live = simRow ? extractCurveInputs(simRow) : null;
  const slope5d = live?.slope5d ?? event.slope5d;
  const pred5 = sheet.pred5 ?? event.pred5;
  const daysToCd = sheet.days ?? event.days_to_cd_at_detection;

  const trajectoryBuild = useMemo(
    () =>
      buildSlopeTrajectory({
        chartPoints,
        simRow,
        daysToCd: daysToCd ?? event.days_to_cd_at_detection ?? 30,
      }),
    [chartPoints, simRow, daysToCd, event.days_to_cd_at_detection],
  );
  const curveData = trajectoryBuild.points;
  const slopeGaps = useMemo(() => slopeGapsFromTrajectory(curveData), [curveData]);
  const modelSeg5 = segmentSlopePpD(curveData, "pred", -5, -10);
  const actualSeg5 = segmentSlopePpD(curveData, "actual", -5, -10);
  const daysLeft = daysUntilContrarianChartExpiry(event.detected_at);
  const detectedDate = new Date(event.detected_at).toLocaleString(lang === "it" ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const predName = lang === "it" ? "Modello (Pred calib.)" : "Model (Pred calib.)";
  const actualName = lang === "it" ? "Reale (curva)" : "Actual (curve)";

  return (
    <article
      className={`slope-chart-card rounded-xl border p-4 space-y-3 transition scroll-mt-28 ${
        highlight ? "ring-2 ring-[rgb(var(--warn))]/50" : ""
      }`}
      id={slopeChartDomId(event.id)}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-extrabold tracking-wide text-ink">{event.ticker}</span>
            <span className="text-xs font-bold uppercase text-[rgb(var(--warn))]">
              {lang === "it" ? "Contrarian" : "Contrarian"}
            </span>
          </div>
          <p className="text-[11px] decision-lab-muted mt-0.5">
            CD {event.cd}
            {event.days_to_cd_at_detection >= 0
              ? ` · ${lang === "it" ? `${event.days_to_cd_at_detection}g al CD` : `${event.days_to_cd_at_detection}d to CD`}`
              : ""}
            {" · "}
            {detectedDate}
          </p>
        </div>
        {showDismiss ? (
          <button
            type="button"
            onClick={() => onDismiss(event.id)}
            className="text-[10px] px-2.5 py-1 rounded-md border border-[rgb(var(--panel-lab-border))] decision-lab-muted hover:decision-lab-text hover:bg-[rgb(var(--panel-lab-block-bg))] transition shrink-0"
          >
            {lang === "it" ? "✓ Visionato" : "✓ Reviewed"}
          </button>
        ) : null}
      </div>

      <div className="rounded-lg border border-[rgb(var(--warn))]/45 bg-[rgb(var(--warn))]/[0.08] px-3 py-2.5 flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-semibold text-[rgb(var(--warn))]">
          {contrarianDivLabel(event.divergence_type, lang)}
        </span>
        <span className="text-[11px] decision-lab-muted tabular-nums">
          {lang === "it" ? "Pendenza 5g" : "5d slope"} {fmtSlope(slope5d)}
        </span>
        <span className="text-[11px] decision-lab-muted tabular-nums">
          Pred +5 {fmtPct(pred5)}
        </span>
      </div>

      <div className={`${CHART_CURVES_PANEL} min-h-[240px]`}>
        <h4 className={CHART_CURVES_TITLE}>
          {lang === "it"
            ? "Traiettoria % — modello ricalibrato vs reale"
            : "% trajectory — recalibrated model vs actual"}
        </h4>
        <div className="flex-1 min-h-[200px]">
          <SlopeTrajectoryChart
            points={curveData}
            todayOffset={trajectoryBuild.todayOffset}
            lang={lang}
            predName={predName}
            actualName={actualName}
          />
        </div>
        <p className={CHART_CURVES_FOOTER}>
          {slopeGaps.at5 != null && (
            <>
              {lang === "it" ? "scost. T−5" : "dev. T−5"} {slopeGaps.at5 >= 0 ? "+" : ""}
              {slopeGaps.at5.toFixed(1)}%
            </>
          )}
          {(actualSeg5 != null || modelSeg5 != null) && (
            <>
              {" · "}
              {lang === "it" ? "pend. 5g" : "slope 5d"} {fmtSlope(actualSeg5 ?? slope5d)} / mod{" "}
              {fmtSlope(modelSeg5)}
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setMetricsOpen((o) => !o)}
        className="text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[rgb(var(--panel-lab-border))] text-[rgb(var(--panel-lab-label-ink))] hover:bg-[rgb(var(--panel-lab-block-bg))] transition"
        aria-expanded={metricsOpen}
      >
        {metricsOpen ? "▾" : "▸"} {t("signals.slopeCharts.metricsTable.btn")}
      </button>

      {metricsOpen ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
          <Metric label={lang === "it" ? "Pendenza 5g" : "5d slope"} value={fmtSlope(slope5d)} tone="neutral" />
          <Metric label="Pred +5" value={fmtPct(pred5)} tone="neutral" />
          <Metric label={lang === "it" ? "Regime" : "Regime"} value={regimeLabel(event.regime as PrecatRegime, null)} tone="neutral" />
          <Metric
            label={lang === "it" ? "Scadenza grafico" : "Chart expires"}
            value={
              showDismiss
                ? daysLeft <= 1
                  ? lang === "it"
                    ? "≤ 1 giorno"
                    : "≤ 1 day"
                  : lang === "it"
                    ? `${daysLeft} giorni`
                    : `${daysLeft} days`
                : lang === "it"
                  ? "Solo consultazione"
                  : "View only"
            }
            tone="neutral"
          />
        </div>
      ) : null}
    </article>
  );
}

function SlopeFeedRowChart({
  row,
  simTable,
  chartsBundle,
  investInputs,
  onDismiss,
  highlight,
}: {
  row: UnifiedSlopeFeedRow;
  simTable: SheetTable | null;
  chartsBundle: ChartBundle | null;
  investInputs: InvestSimInputs;
  onDismiss: (id: string) => void;
  highlight?: boolean;
}) {
  const chartCtx = resolveSlopeChartContext(row.ticker, row.cd, simTable, chartsBundle);
  const daysToCd = daysFromToday(row.cd) ?? 30;
  const canRender = canRenderSlopeTrajectory({
    chartPoints: chartCtx.chartPts,
    simRow: chartCtx.simRow,
    daysToCd,
  });
  if (!canRender) return null;

  if (row.source === "slope") {
    return (
      <SlopeErrorChartCard
        event={row.slopeEvent}
        simRow={chartCtx.simRow}
        chartPoints={chartCtx.chartPts}
        chartStaleFromLog={chartCtx.logStaleNoSimRow}
        investInputs={investInputs}
        onDismiss={onDismiss}
        highlight={highlight}
        showDismiss={row.hasActiveChart}
      />
    );
  }

  return (
    <ContrarianErrorChartCard
      event={row.contrarianEvent}
      simRow={chartCtx.simRow}
      chartPoints={chartCtx.chartPts}
      onDismiss={onDismiss}
      highlight={highlight}
      showDismiss={row.hasActiveChart}
    />
  );
}

function scrollToSlopeChart(eventId: string) {
  requestAnimationFrame(() => {
    document.getElementById(slopeChartDomId(eventId))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function Metric({
  label,
  value,
  tone,
  className = "",
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "warn" | "neutral";
  className?: string;
}) {
  const toneCls =
    tone === "up"
      ? "text-[rgb(var(--signal-up))]"
      : tone === "down"
        ? "text-[rgb(var(--signal-down))]"
        : tone === "warn"
          ? "text-[rgb(var(--warn))]"
          : "decision-lab-text";
  return (
    <div className={`decision-lab-block rounded-lg border px-2 py-1.5 ${className}`}>
      <p className="decision-lab-label uppercase tracking-wide text-[9px]">{label}</p>
      <p className={`font-semibold mt-0.5 leading-tight ${toneCls}`}>{value}</p>
    </div>
  );
}

export function SlopeErrorChartsPanel({
  simTable,
  chartsBundle: chartsBundleProp,
  focusTicker,
  onFocusTickerConsumed,
  slotAboveOverview,
  onOpenPredictionCharts,
  slopeErrorsOnly = false,
}: {
  simTable: SheetTable | null;
  /** Se passato (es. da Decision Lab), evita doppio fetch e resta allineato al reload. */
  chartsBundle?: ChartBundle | null;
  focusTicker?: string | null;
  onFocusTickerConsumed?: () => void;
  /** Banner slope error sopra la tabella Δ (Decision Lab). */
  slotAboveOverview?: ReactNode;
  onOpenPredictionCharts?: (focus: { ticker: string; seriesKey: string | null }) => void;
  /** Catalyst → Curves → Slope errors: solo analisi pendenza, no Market Interest. */
  slopeErrorsOnly?: boolean;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const [dismissed, setDismissed] = useState<SlopeChartDismissMap>(() => loadDismissedSlopeCharts());
  const [filter, setFilter] = useState<"all" | "portfolio">("portfolio");
  const [severityFloor, setSeverityFloor] = useState<SlopeSeverityFloor>(() =>
    loadSlopeSeverityFloor(),
  );
  const [guideOpen, setGuideOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"slopeErrors" | "marketInterest">(
    slopeErrorsOnly ? "slopeErrors" : "marketInterest",
  );
  const [chartsBundleLocal, setChartsBundleLocal] = useState<ChartBundle | null>(null);
  const chartsBundle = chartsBundleProp ?? chartsBundleLocal;
  const { lastReloadAt, finishedAt } = useRefreshStatus();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [highlightedTicker, setHighlightedTicker] = useState<string | null>(null);
  const [logTick, setLogTick] = useState(0);
  const investInputs = useInvestSimInputs(simTable);

  const chartsReloadKey = `${simTable?.rows?.length ?? 0}:${lastReloadAt?.getTime() ?? 0}:${finishedAt?.getTime() ?? 0}`;

  useEffect(() => {
    if (chartsBundleProp !== undefined) return;
    let cancelled = false;
    void loadSimulationChartsBundle().then(({ bundle }) => {
      if (!cancelled) setChartsBundleLocal(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [chartsBundleProp, chartsReloadKey]);

  const refresh = useCallback(() => {
    setDismissed({ ...loadDismissedSlopeCharts() });
    setLogTick((n) => n + 1);
  }, []);

  useEffect(() => {
    refresh();
    const iv = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(iv);
  }, [refresh]);

  const priceGapByTicker = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!simTable?.rows?.length) return m;
    const cols =
      simTable.columns?.length ? simTable.columns : Object.keys(simTable.rows[0] ?? {});
    const colTicker =
      cols.find((c) => c.toLowerCase().includes("ticker")) ?? "Ticker";
    const series = chartsBundle?.series;
    for (const row of simTable.rows) {
      const tk = String(row[colTicker] ?? "").trim().toUpperCase();
      if (!tk) continue;
      const sk = simulationRowSeriesKey(row);
      const rawPts = sk && series?.[sk]?.points ? series[sk].points : null;
      const chartPts = rawPts ? resolveRecalibratedChartPoints(rawPts, row) : null;
      m.set(tk, slopePriceGapFromSimRow(row, chartPts));
    }
    return m;
  }, [simTable, chartsBundle]);

  const feedRows = useMemo(() => {
    void logTick;
    return buildSlopeFeedForPanel({
      dismissed,
      portfolioOnly: filter === "portfolio",
      simTable,
      chartsBundle,
      inputs: investInputs,
      resolveGapUsd: (tk) => priceGapByTicker.get(tk) ?? null,
    });
  }, [dismissed, filter, logTick, priceGapByTicker, simTable, chartsBundle, investInputs]);

  const overviewRanked = useMemo(() => {
    const grouped = groupSlopeFeedByTicker(feedRows);
    return filterAndSortCompanies(grouped, severityFloor);
  }, [feedRows, severityFloor]);

  const overviewCompanies = overviewRanked.visible;

  const companyChartSections = useMemo(() => {
    return overviewCompanies.map((co) => {
      const primary = co.displayRow;
      const chartableRows = primary
        ? (() => {
            const ctx = resolveSlopeChartContext(primary.ticker, primary.cd, simTable, chartsBundle);
            const days = daysFromToday(primary.cd) ?? 30;
            const ok = canRenderSlopeTrajectory({
              chartPoints: ctx.chartPts,
              simRow: ctx.simRow,
              daysToCd: days,
            });
            return ok ? [primary] : [];
          })()
        : [];
      const displayCtx = co.displayRow
        ? resolveSlopeChartContext(co.displayRow.ticker, co.displayRow.cd, simTable, chartsBundle)
        : null;
      const companyName = companyNameFromSimRow(displayCtx?.simRow ?? null);
      return { company: co, chartableRows, companyName };
    });
  }, [overviewCompanies, simTable, chartsBundle]);

  const totalChartCount = useMemo(
    () => companyChartSections.reduce((n, s) => n + s.chartableRows.length, 0),
    [companyChartSections],
  );

  const jumpToCompanyChart = useCallback(
    (ticker: string, eventId?: string | null) => {
      const up = ticker.trim().toUpperCase();
      setHighlightedTicker(up);
      const section = companyChartSections.find((s) => s.company.ticker.toUpperCase() === up);
      const targetId =
        eventId ??
        section?.chartableRows.find((r) => r.hasActiveChart)?.id ??
        section?.chartableRows[0]?.id ??
        section?.company.displayRow?.id ??
        null;
      if (targetId) {
        setSelectedEventId(targetId);
        scrollToSlopeChart(targetId);
        return;
      }
      requestAnimationFrame(() => {
        document.getElementById(slopeCompanyDomId(up))?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    },
    [companyChartSections],
  );

  useEffect(() => {
    if (slopeErrorsOnly) setPanelMode("slopeErrors");
  }, [slopeErrorsOnly]);

  useEffect(() => {
    if (focusTicker) setPanelMode("slopeErrors");
  }, [focusTicker]);

  useEffect(() => {
    if (!focusTicker) return;
    const id = window.setTimeout(() => {
      jumpToCompanyChart(focusTicker);
      onFocusTickerConsumed?.();
    }, 120);
    return () => window.clearTimeout(id);
  }, [focusTicker, jumpToCompanyChart, onFocusTickerConsumed]);

  const handleDismiss = useCallback(
    (id: string) => {
      dismissSlopeErrorChart(id);
      refresh();
    },
    [refresh],
  );

  const counts = useMemo(() => {
    void logTick;
    return feedLogCounts();
  }, [logTick]);

  return (
    <div className="slope-charts-panel flex flex-col flex-1 min-h-0 gap-3 overflow-auto rounded-lg p-3">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {!slopeErrorsOnly ? (
          <>
            <button
              type="button"
              onClick={() => setPanelMode("slopeErrors")}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition shrink-0 ${
                panelMode === "slopeErrors"
                  ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))]"
                  : "border-[rgb(var(--panel-lab-border))] text-ink-muted hover:text-ink hover:bg-[rgb(var(--surface-3))]/35"
              }`}
              title={it ? "Tabella pendenza modello vs mercato" : "Model vs market slope table"}
            >
              {t("signals.slope.tab")}
              {counts.slope + counts.contrarian > 0 ? (
                <span className="tabular-nums opacity-85"> · {counts.slope + counts.contrarian}</span>
              ) : null}
            </button>
            <SelectionChipGroup>
              <SelectionChip
                active={panelMode === "marketInterest"}
                onClick={() => setPanelMode("marketInterest")}
              >
                {t("signals.mig.tab")}
              </SelectionChip>
            </SelectionChipGroup>
          </>
        ) : null}
      </div>

      {panelMode === "marketInterest" ? (
        <MarketInterestPanel
          simTable={simTable}
          chartsBundle={chartsBundle}
          onOpenPredictionCharts={onOpenPredictionCharts}
        />
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-2 shrink-0 rounded-xl border border-slate-200/60 invest-trend-chart-panel px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {t("signals.slope.panelTitle")}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
            {it
              ? `${overviewCompanies.length} società · ${counts.slope} eventi · ${counts.contrarian} contrarian`
              : `${overviewCompanies.length} companies · ${counts.slope} events · ${counts.contrarian} contrarian`}
            {overviewRanked.hiddenCount > 0 ? (
              <span className="text-ink-muted/70">
                {" "}
                · {t("signals.slope.severityFloor.hidden", { n: overviewRanked.hiddenCount })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <span className="text-[9px] font-medium uppercase tracking-wide text-ink-muted/70 px-0.5">
            {t("signals.slope.severityFloor.label")}
          </span>
          <SelectionChipGroup>
            {(
              [
                ["critical", "signals.slope.severityFloor.critical"],
                ["high", "signals.slope.severityFloor.high"],
                ["medium", "signals.slope.severityFloor.medium"],
                ["low", "signals.slope.severityFloor.low"],
              ] as const
            ).map(([floor, key]) => (
              <SelectionChip
                key={floor}
                active={severityFloor === floor}
                onClick={() => {
                  setSeverityFloor(floor);
                  saveSlopeSeverityFloor(floor);
                }}
              >
                {t(key)}
              </SelectionChip>
            ))}
          </SelectionChipGroup>
        </div>
        <SelectionChipGroup className="shrink-0">
          <SelectionChip active={filter === "portfolio"} onClick={() => setFilter("portfolio")}>
            {it ? "Portafoglio" : "Portfolio"}
          </SelectionChip>
          <SelectionChip active={filter === "all"} onClick={() => setFilter("all")}>
            {it ? "Tutti" : "All"}
          </SelectionChip>
        </SelectionChipGroup>
        <button
          type="button"
          onClick={() => setGuideOpen((o) => !o)}
          className={`text-[10px] font-semibold px-2.5 py-1 rounded-md border transition shrink-0 ${
            guideOpen
              ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))]"
              : "border-[rgb(var(--panel-lab-border))] decision-lab-muted hover:decision-lab-text"
          }`}
          aria-expanded={guideOpen}
        >
          {guideOpen ? "▾" : "▸"} {t("signals.slopeCharts.guide.btn")}
        </button>
      </div>

      <SlopeChartsGuidePanel open={guideOpen} onClose={() => setGuideOpen(false)} />

      <p className="text-[10px] text-ink-muted/80 shrink-0 px-1">
        {slopeThresholdSummary(lang)}
      </p>
      <p className="text-[10px] text-[rgb(var(--panel-feed-accent-strong))]/80 leading-snug shrink-0 px-1 border-l-2 border-[rgb(var(--panel-feed-accent))]/35 pl-2">
        {t("signals.slopeHarmonyNote")}
      </p>
      <p className="text-[10px] text-ink-muted/85 leading-snug shrink-0 px-1 border-l-2 border-[rgb(var(--warn))]/35 pl-2">
        {t("signals.slope.postCdWatchNote", { days: POST_CD_WATCH_CAL_DAYS })}
      </p>

      {slotAboveOverview}
      {overviewCompanies.length === 0 ? (
        <div className="decision-lab-card rounded-xl border p-8 flex-1 flex items-center justify-center">
          <div className="text-center max-w-md space-y-3">
            <p className="text-xs text-ink-muted">
              {overviewRanked.total === 0
                ? it
                  ? "Nessun evento pendenza nel log. Compare dopo un SLOPE ERROR nel Decision Lab."
                  : "No slope events in the log. Appears after a SLOPE ERROR in Decision Lab."
                : it
                  ? `Nessuna società con gravità ≥ ${t(`signals.slope.severityFloor.${severityFloor === "low" ? "low" : severityFloor}`)} (${overviewRanked.total} sotto soglia).`
                  : `No companies at ≥ ${t(`signals.slope.severityFloor.${severityFloor === "low" ? "low" : severityFloor}`)} severity (${overviewRanked.total} below threshold).`}
            </p>
            {overviewRanked.total > 0 && severityFloor !== "low" ? (
              <button
                type="button"
                className="text-[11px] font-semibold rounded-md border border-[rgb(var(--accent))]/40 bg-[rgb(var(--accent))]/10 px-3 py-1.5 text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/15 transition"
                onClick={() => {
                  setSeverityFloor("low");
                  saveSlopeSeverityFloor("low");
                }}
              >
                {it ? "Mostra tutte le società" : "Show all companies"}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="sticky top-0 z-20 shrink-0 rounded-xl border border-[rgb(var(--panel-feed-border))]/55 bg-[rgb(var(--panel-feed-header-bg))]/95 backdrop-blur-sm px-3 py-2.5 shadow-[0_2px_10px_rgb(99_102_241/0.08)]">
            <p className="text-[9px] text-ink-muted leading-snug mb-2">
              {t("signals.slopeCharts.nav.hint")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {overviewCompanies.map((co) => {
                const summary = co.displayRow ? summarizeSlopeFeedRow(co.displayRow, lang) : null;
                const active = highlightedTicker === co.ticker.toUpperCase();
                return (
                  <button
                    key={co.ticker}
                    type="button"
                    onClick={() => jumpToCompanyChart(co.ticker, co.displayRow?.id)}
                    className={`text-left max-w-[14rem] rounded-lg border px-2.5 py-1.5 transition ${
                      active
                        ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/10"
                        : "border-[rgb(var(--panel-feed-border))]/50 bg-white/70 hover:bg-[rgb(var(--panel-feed-row-hover))]/60"
                    }`}
                    title={
                      summary
                        ? `${summary.shiftLine}${summary.subLine ? ` · ${summary.subLine}` : ""}`
                        : co.ticker
                    }
                  >
                    <span className="block text-[11px] font-bold text-ink tracking-wide">
                      {co.ticker}
                    </span>
                    {summary ? (
                      <span className="block text-[9px] text-ink-muted leading-snug truncate mt-0.5">
                        {it ? summary.kindMeta.labelIt : summary.kindMeta.labelEn}
                        {" · "}
                        {severityLabel(summary.severity, lang)}
                        {" · "}
                        <span className="tabular-nums">{summary.shiftLine}</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <SlopeCompanyOverviewTable
            companies={overviewCompanies}
            simTable={simTable}
            chartsBundle={chartsBundle}
            onOpenCompany={(tk) => {
              const co = overviewCompanies.find((c) => c.ticker.toUpperCase() === tk.toUpperCase());
              jumpToCompanyChart(tk, co?.displayRow?.id);
            }}
          />

          <section className="space-y-4 shrink-0 pb-6">
            <div className="px-0.5">
              <h4 className="text-[11px] font-semibold decision-lab-text">
                {t("signals.slopeCharts.curvesSection")}
                {totalChartCount > 0 ? (
                  <span className="text-ink-muted font-normal tabular-nums">
                    {" "}
                    · {totalChartCount}
                  </span>
                ) : null}
              </h4>
              <p className="text-[10px] decision-lab-muted leading-snug mt-0.5">
                {t("signals.slopeCharts.curvesSectionHint")}
              </p>
            </div>

            {totalChartCount === 0 ? (
              <div className="decision-lab-card rounded-xl border p-6 text-center">
                <p className="text-xs decision-lab-muted max-w-md mx-auto">
                  {t("signals.slopeCharts.noCurves")}
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {companyChartSections.map(({ company, chartableRows, companyName }) => {
                  if (!chartableRows.length) return null;
                  return (
                    <div
                      key={company.ticker}
                      id={slopeCompanyDomId(company.ticker)}
                      className="scroll-mt-28 space-y-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5 border-b border-[rgb(var(--panel-feed-border))]/35 pb-2">
                        <h5 className="text-sm font-bold decision-lab-text tracking-wide">
                          {company.ticker}
                        </h5>
                        {companyName ? (
                          <span className="text-[11px] text-ink-muted truncate max-w-[20rem]">
                            {companyName}
                          </span>
                        ) : null}
                        <span className="text-[10px] text-ink-muted tabular-nums ml-auto">
                          {chartableRows.length}{" "}
                          {it
                            ? chartableRows.length === 1
                              ? "curva"
                              : "curve"
                            : chartableRows.length === 1
                              ? "curve"
                              : "curves"}
                        </span>
                      </div>
                      <div className="space-y-4">
                        {chartableRows.map((row) => (
                          <SlopeFeedRowChart
                            key={row.id}
                            row={row}
                            simTable={simTable}
                            chartsBundle={chartsBundle}
                            investInputs={investInputs}
                            onDismiss={handleDismiss}
                            highlight={selectedEventId === row.id}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
        </>
      )}
    </div>
  );
}
