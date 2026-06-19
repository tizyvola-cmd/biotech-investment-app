import type { SdsRow } from "../api/supernova";
import {
  buildHypotheticalGainPlanRow,
  buildPortfolioGainPlanRowFromSim,
  buildGainPlanSeries,
} from "../components/PortfolioGainPlanChart";
import type { ChartPoint } from "../types";
import { buildCdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { canonicalTodayOffset, transformOverlayVsToday, transformBlendVsToday } from "../sheet/assessmentChartHarmony";
import { buildOverlayCurve } from "../sheet/sdsCompareOverlay";
import { blendCurveFromSimChart, type SdsRoiProfileId } from "../sheet/sdsRoiBlend";
import { buildSlopeTrajectory, canRenderSlopeTrajectory } from "../sheet/slopeRecalibCurve";
import { buildMigResultByKey } from "../sheet/entrySolidityMig";
import { dailyChangePctFromRow } from "../sheet/simulationPosition";
import { miiModelGapPct } from "../sheet/marketInterestGate";
import { migPrePostSlopesSame } from "../components/MigCalibVisual";
import { extractCurveInputs } from "../sheet/precatCurve";
import { migSolidityKey } from "../sheet/entrySolidityMig";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import type { EisSuperScoreState } from "../api/eisSuperScore";
import { supernovaOffsetLabel } from "../sheet/sdsHistoryCurve";
import { t } from "../shared/i18n";
import type { ChartBundle, SheetTable } from "../types";

export type MobileCurveChartsPayload = {
  polygon: {
    matchPct: number;
    verdictLabel: string;
    arcPositionLabel: string;
    segmentLabel: string;
    labels: string[];
    radarCurrent: number[];
    radarTarget: number[];
    axes: Array<{ label: string; currentText: string; targetText: string }>;
  } | null;
  predBlend: Array<{ offset: number; label: string; model: number | null; blend: number | null }> | null;
  predCaption: string | null;
  slopeTrajectory: Array<{
    offset: number;
    label: string;
    pred: number | null;
    actual: number | null;
  }> | null;
  todayOffset: number | null;
  slope5d: number | null;
  slope20d: number | null;
  dailyMovePct: number | null;
  gainPlan: Array<{
    day: number;
    planned: number | null;
    actual: number | null;
    historical: number | null;
  }> | null;
  gainPlanHypothetical: boolean;
  marketModel: {
    miiDeg: number | null;
    modelDeg: number | null;
    preModelDeg?: number | null;
    postModelDeg?: number | null;
    gapPct?: number | null;
  } | null;
};

function fmtAxisRaw(
  rawValue: number | null | undefined,
  unit: string,
  decimals = 0,
): string {
  if (rawValue == null || !Number.isFinite(rawValue)) return "—";
  return `${rawValue.toFixed(decimals)}${unit}`;
}

function verdictLabel(verdict: string): string {
  const key = `decisionLab.pattern.verdict.${verdict}` as "decisionLab.pattern.verdict.strong";
  return t(key);
}

export function buildMobileCurveChartsPayload(opts: {
  key: string;
  simRow: Record<string, unknown> | null;
  chartPts: ChartPoint[] | null | undefined;
  simTable: SheetTable | null;
  chartBundle: ChartBundle | null;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  sdsRows: SdsRow[] | null | undefined;
  migByKey: Map<string, import("../sheet/entrySolidityMig").MigSoliditySnapshot>;
  eisState: EisSuperScoreState | null | undefined;
  hasPosition: boolean;
  daysToCd: number | null;
  lang: "it" | "en";
  refCurves?: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
}): MobileCurveChartsPayload | null {
  const { simRow, chartPts, lang } = opts;
  if (!simRow) return null;

  const it = lang === "it";
  const todayOff = canonicalTodayOffset(simRow, opts.daysToCd);
  const tickerUpper = String(simRow.Ticker ?? "").trim().toUpperCase();
  const sdsRow =
    opts.sdsRows?.find((r) => String(r.ticker ?? "").trim().toUpperCase() === tickerUpper) ?? null;

  const patternRec = buildCdPatternTickerRecommendation({
    row: simRow,
    chartPoints: chartPts,
    investInputs: opts.inputs,
    sdsRows: opts.sdsRows,
    migByKey: opts.migByKey,
    lang,
    includeEis: false,
    eisSuperScoreState: opts.eisState,
  });

  const polygon = patternRec
    ? {
        matchPct: patternRec.matchPct,
        verdictLabel: verdictLabel(patternRec.verdict),
        arcPositionLabel: patternRec.arcPositionLabel,
        segmentLabel: patternRec.window.label,
        labels: patternRec.axes.map((a) => a.label),
        radarCurrent: patternRec.radarCurrent,
        radarTarget: patternRec.radarTarget,
        axes: patternRec.axes.map((ax) => ({
          label: ax.label,
          currentText: fmtAxisRaw(ax.rawValue, ax.unit, ax.id === "mii" || ax.id === "slope" ? 2 : 0),
          targetText: `${ax.threshold}${ax.unit}`,
        })),
      }
    : null;

  let predBlend: MobileCurveChartsPayload["predBlend"] = null;
  let predCaption: string | null = null;
  if (chartPts?.length) {
    const ticker = String(simRow.Ticker ?? "").trim().toUpperCase();
    const rawOverlay = buildOverlayCurve(ticker, chartPts, simRow, 0, { extendedPostCd: true });
    const overlay =
      rawOverlay && todayOff != null ? transformOverlayVsToday(rawOverlay, todayOff) : rawOverlay;
    if (overlay) {
      const offsets = overlay.offsets ?? [];
      let blendValues: (number | null)[] | null = null;
      if (opts.refCurves && sdsRow) {
        const rawBlend = blendCurveFromSimChart(chartPts, simRow, opts.refCurves, {
          sds: sdsRow.sds,
          days_to_cd: sdsRow.days_to_cd,
          cluster_scores: sdsRow.cluster_scores,
          cluster_a: sdsRow.cluster_a,
          cluster_b: sdsRow.cluster_b,
          cluster_c: sdsRow.cluster_c,
          cluster_d: sdsRow.cluster_d,
        }, {
          extendedPostCd: true,
          nowOffset: todayOff,
          offsets,
        });
        blendValues =
          rawBlend && todayOff != null ? transformBlendVsToday(rawBlend, todayOff) : rawBlend;
      }
      predBlend = offsets.map((offset, i) => ({
        offset,
        label: supernovaOffsetLabel(offset),
        model: overlay.values[i] ?? null,
        blend: blendValues?.[i] ?? null,
      }));
      const peak = overlay.peakRoi;
      const peakOff = overlay.peakOffset;
      predCaption =
        peak != null && peakOff != null
          ? `${it ? "Modello + blend SDS" : "Model + SDS blend"} · ${todayOff != null ? supernovaOffsetLabel(todayOff) : ""}${
              peak != null
                ? ` · ${it ? "picco" : "peak"} ${peak >= 0 ? "+" : ""}${peak.toFixed(1)}% @ ${supernovaOffsetLabel(peakOff)}`
                : ""
            }`
          : null;
    }
  }

  let slopeTrajectory: MobileCurveChartsPayload["slopeTrajectory"] = null;
  const days = opts.daysToCd ?? Math.abs(todayOff ?? 30);
  if (chartPts?.length && canRenderSlopeTrajectory({ chartPoints: chartPts, simRow, daysToCd: days })) {
    const built = buildSlopeTrajectory({ chartPoints: chartPts, simRow, daysToCd: days });
    slopeTrajectory = built.points.map((p) => ({
      offset: p.offset,
      label: p.label,
      pred: p.pred,
      actual: p.actual,
    }));
  }

  const live = extractCurveInputs(simRow);

  const gainPlanRow = opts.hasPosition
    ? buildPortfolioGainPlanRowFromSim(opts.key, simRow, opts.inputs, opts.history, chartPts)
    : buildHypotheticalGainPlanRow(opts.key, simRow, chartPts);
  const gainPlan = gainPlanRow
    ? buildGainPlanSeries(gainPlanRow, opts.history).map((p) => ({
        day: p.day,
        planned: p.planned,
        actual: p.actual,
        historical: p.historical,
      }))
    : null;

  const migMap = buildMigResultByKey(opts.simTable, opts.chartBundle, opts.sdsRows);
  const cd = String(simRow["Completion Date"] ?? "").trim();
  const ticker = String(simRow.Ticker ?? "").trim().toUpperCase();
  const mig = migMap.get(migSolidityKey(ticker, cd)) ?? null;
  let marketModel: MobileCurveChartsPayload["marketModel"] = null;
  if (mig) {
    const same = migPrePostSlopesSame(
      mig.calibPreDaily.modelSlopeAngleDeg,
      mig.calibPostDaily.modelSlopeAngleDeg,
    );
    const preDeg = mig.calibPreDaily.modelSlopeAngleDeg;
    const postDeg = mig.calibPostDaily.modelSlopeAngleDeg;
    const modelDeg = same ? postDeg ?? preDeg : postDeg ?? preDeg;
    const gapPct =
      miiModelGapPct(mig.slopeAngleDeg, preDeg) ??
      miiModelGapPct(mig.slopeAngleDeg, postDeg) ??
      miiModelGapPct(mig.slopeAngleDeg, modelDeg);
    marketModel = {
      miiDeg: mig.slopeAngleDeg,
      modelDeg,
      preModelDeg: preDeg,
      postModelDeg: postDeg,
      gapPct,
    };
  }

  return {
    polygon,
    predBlend,
    predCaption,
    slopeTrajectory,
    todayOffset: todayOff,
    slope5d: live?.slope5d ?? null,
    slope20d: live?.slope20d ?? null,
    dailyMovePct: dailyChangePctFromRow(simRow),
    gainPlan,
    gainPlanHypothetical: !opts.hasPosition,
    marketModel,
  };
}
