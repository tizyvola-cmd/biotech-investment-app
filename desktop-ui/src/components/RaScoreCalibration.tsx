import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  RadarController,
  Filler,
  Legend,
  Tooltip,
} from "chart.js";
import { Line, Radar } from "react-chartjs-2";
import {
  chartDevicePixelRatio,
  chartGrad,
  chartScaleStyle,
  thresholdLowSampleZonePlugin,
  thresholdZonePlugin,
} from "../utils/chartGrad";
import { useTheme } from "../hooks/useTheme";
import {
  buildThresholdCurveAtOffset,
  buildRaThresholdHeatmap,
  computeCalibrationKpis,
  computeConfidenceChecks,
  computeRadarScores,
  RA_CALIB_MIN_SAMPLE_N,
  formatRaTemporalBestValue,
  formatRaTemporalLongTarget,
  formatRaTemporalShortTarget,
  RADAR_TARGET,
  type RaCalibrationSignal,
  type RaConfidenceCheck,
} from "../sheet/rascoreCalibrationCompute";
import { raCalibOffsetLabel } from "../sheet/rascoreCdHorizons";
import {
  buildRaInversePatternAnalysis,
  buildRaInverseTickerRows,
  cohortRaCompressionHint,
  downloadRaInversePatternCsv,
  listRaInverseAnchorEligibility,
  raInverseEligibilityKey,
  resolveRaInverseAnchorSelection,
  RA_INVERSE_COMPONENT_IDS,
  type RaInverseTickerRow,
} from "../sheet/rascoreInversePattern";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import { SOLIDITY_COMPONENT_COLORS } from "../sheet/entrySolidityComposite";
import type { RascoreCohortSummary } from "../sheet/rascoreSignalImpactView";
import {
  correlationSignificance,
  formatCorrelationWithStars,
  formatPValue,
  formatPValueWithStars,
} from "../sheet/statSignificance";
import { useT, type TranslationKey } from "../shared/i18n";
import { RaInverseCumulativeChart } from "./RaInverseCumulativeChart";
import { RaThresholdHeatmap } from "./RaThresholdHeatmap";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  RadarController,
  Filler,
  Legend,
  Tooltip,
);

export type RaInverseBuildArgs = {
  simTable: SheetTable | null | undefined;
  chartBundle: ChartBundle | null | undefined;
  sdsRows: SdsRow[] | null | undefined;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  lang?: "it" | "en";
};

export type RaScoreCalibrationProps = {
  signals: RaCalibrationSignal[];
  weeklyRho: Array<{ week: string; rho: number | null; rhoN?: number | null }>;
  /** Legacy: today RA rows. Ignored when inverseBuildArgs is set. */
  inverseRows?: RaInverseTickerRow[];
  inverseBuildArgs?: RaInverseBuildArgs | null;
  cohort?: RascoreCohortSummary | null;
};

const INVERSE_COMPONENT_LABEL_KEYS = {
  reliability: "sim.solidity.composite.reliability",
  timing: "sim.solidity.composite.timing",
  align: "sim.solidity.composite.align",
  roi_target: "sim.solidity.composite.roiTarget",
  sds: "sim.solidity.composite.sds",
  precat: "sim.solidity.composite.precat",
  mii: "sim.solidity.composite.mii",
  calib: "sim.solidity.composite.calib",
} as const satisfies Record<
  (typeof RA_INVERSE_COMPONENT_IDS)[number],
  TranslationKey
>;

function snVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function chipBtnStyle(active: boolean): CSSProperties {
  return {
    padding: "2px 8px",
    borderRadius: 999,
    border: active ? "2px solid var(--sn-primary)" : "1px solid var(--sn-border)",
    background: active ? "var(--sn-primary-pale)" : "var(--sn-surface-raised)",
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    fontSize: 9,
    color: active ? "var(--sn-text)" : "var(--sn-text-2)",
    fontWeight: active ? 600 : 400,
  };
}

function rgbaFromVar(cssVar: string, alpha: number, fallback: string): string {
  const raw = snVar(cssVar);
  if (!raw) return fallback;
  if (raw.startsWith("#") && raw.length === 7) {
    const r = parseInt(raw.slice(1, 3), 16);
    const g = parseInt(raw.slice(3, 5), 16);
    const b = parseInt(raw.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return fallback;
}

const sectionClass = "sn-chart-section";
const kpiSectionClass = "sn-chart-section sn-chart-section--kpi";

const insightStyle: CSSProperties = {
  background: "var(--sn-primary-pale)",
  borderLeft: "3px solid var(--sn-primary)",
  borderRadius: "0 8px 8px 0",
  padding: "10px 14px",
  fontSize: 12,
  color: "var(--sn-text-2)",
};

function KpiCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string | number;
  sub: string;
  valueColor: string;
}) {
  return (
    <div className={kpiSectionClass} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--sn-primary)", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, color: valueColor, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: "var(--sn-text-3)" }}>{sub}</span>
    </div>
  );
}

const CHECK_LABEL_KEYS: Record<RaConfidenceCheck["key"], TranslationKey> = {
  rho: "modelLab.raCalibration.check.rho",
  bands: "modelLab.raCalibration.check.bands",
  priceup: "modelLab.raCalibration.check.priceUp",
  threshold: "modelLab.raCalibration.check.threshold",
  trend: "modelLab.raCalibration.check.trend",
};

function confidenceCheckStatus(
  check: RaConfidenceCheck,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  switch (check.key) {
    case "rho":
      return check.met ? `✓ ${check.monotonicityRho}` : `✗ ${check.monotonicityRho}`;
    case "bands":
      return check.met
        ? `✓ ${check.bandsWithN2}/3`
        : `✗ ${check.bandsWithN2}/3`;
    case "priceup":
      return check.met
        ? t("modelLab.raCalibration.check.status.found")
        : t("modelLab.raCalibration.check.status.zeroPct");
    case "threshold":
      return check.met ? `✓ ${check.investThreshold}` : `✗ ${t("modelLab.raCalibration.nd")}`;
    case "trend":
      if (check.trendPending) return t("modelLab.raCalibration.check.status.pending");
      return check.met ? "✓" : "✗";
    default:
      return "—";
  }
}

const CHART_H = {
  threshold: 320,
  trend: 300,
  radar: 280,
} as const;

const anchorEmptyPanelStyle: CSSProperties = {
  minHeight: CHART_H.threshold,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "24px 20px",
  borderRadius: 12,
  border: "1px dashed var(--sn-border)",
  background: "var(--sn-surface, #fafafa)",
  textAlign: "center",
};

function AnchorEmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={anchorEmptyPanelStyle}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--sn-text-2)", margin: 0 }}>{title}</p>
      <p style={{ fontSize: 11, color: "var(--sn-text-3)", margin: 0, maxWidth: 520, lineHeight: 1.45 }}>
        {detail}
      </p>
    </div>
  );
}

export function RaScoreCalibration({
  signals,
  weeklyRho,
  inverseRows: inverseRowsProp = [],
  inverseBuildArgs = null,
  cohort = null,
}: RaScoreCalibrationProps) {
  const t = useT();
  const { theme } = useTheme();

  useEffect(() => {
    ChartJS.defaults.devicePixelRatio = chartDevicePixelRatio();
  }, [theme]);

  const kpis = useMemo(() => computeCalibrationKpis(signals, weeklyRho), [signals, weeklyRho]);
  const checks = useMemo(
    () => computeConfidenceChecks(signals, weeklyRho, kpis),
    [signals, weeklyRho, kpis],
  );
  const radarScores = useMemo(() => computeRadarScores(signals, weeklyRho, kpis), [signals, weeklyRho, kpis]);

  const scaleStyle = useMemo(() => chartScaleStyle(), [theme]);
  const accentColor = rgbaFromVar("--sn-accent", 0.75, "rgba(200,146,74,0.75)");
  const modelHex = snVar("--chart-model", "#6B4FC8");
  const greenLine = snVar("--sn-long-text", "#5A9A18");

  const rhoValueColor =
    kpis.monotonicityRhoNum != null && kpis.monotonicityRhoNum >= 0.6
      ? "var(--sn-long-text)"
      : kpis.monotonicityRhoNum != null
        ? "var(--sn-accent)"
        : "var(--sn-text-3)";
  const bestBandColor = kpis.bestBand ? "var(--sn-accent)" : "var(--sn-text-3)";
  const investColor = kpis.investThresholdNum != null ? "var(--sn-long-text)" : "var(--sn-text-3)";

  const confidencePct = Math.round((checks.filter((c) => c.met).length / 5) * 100);
  const confidenceBg =
    confidencePct >= 60
      ? "var(--sn-long-bg)"
      : confidencePct >= 30
        ? "var(--sn-watch-bg)"
        : "var(--sn-short-bg)";
  const confidencePhase =
    confidencePct >= 60
      ? t("modelLab.raCalibration.confidence.phase.calibrated")
      : confidencePct >= 30
        ? t("modelLab.raCalibration.confidence.phase.calibrating")
        : t("modelLab.raCalibration.confidence.phase.insufficient");

  const [inverseOffset, setInverseOffset] = useState(-30);
  const [inverseTableOpen, setInverseTableOpen] = useState(false);

  const inverseRowsForEligibility = useMemo(() => {
    if (!inverseBuildArgs) return inverseRowsProp;
    return buildRaInverseTickerRows({ ...inverseBuildArgs, asOfOffset: null });
  }, [inverseBuildArgs, inverseRowsProp]);

  const inverseRows = useMemo(() => {
    if (inverseBuildArgs) {
      return buildRaInverseTickerRows({
        ...inverseBuildArgs,
        asOfOffset: inverseOffset,
      });
    }
    return inverseRowsProp;
  }, [inverseBuildArgs, inverseOffset, inverseRowsProp]);

  const inverseEligibility = useMemo(
    () => listRaInverseAnchorEligibility(inverseRowsForEligibility, signals),
    [inverseRowsForEligibility, signals],
  );

  const inverseEligibilityKey = useMemo(
    () => raInverseEligibilityKey(inverseEligibility),
    [inverseEligibility],
  );

  useEffect(() => {
    setInverseOffset((prev) =>
      resolveRaInverseAnchorSelection(prev, inverseEligibility),
    );
  }, [inverseEligibilityKey, inverseEligibility]);

  useEffect(() => {
    setInverseTableOpen(false);
  }, [inverseOffset]);
  const inversePattern = useMemo(
    () =>
      inverseRows.length
        ? buildRaInversePatternAnalysis(inverseRows, signals, { offset: inverseOffset })
        : null,
    [inverseRows, signals, inverseOffset],
  );
  const selectedInverseEligibility = useMemo(
    () => inverseEligibility.find((row) => row.offset === inverseOffset) ?? null,
    [inverseEligibility, inverseOffset],
  );
  const anchorAtSelectedReady = selectedInverseEligibility?.tableReady ?? false;
  const thresholdCurve = useMemo(
    () => buildThresholdCurveAtOffset(signals, inverseOffset),
    [signals, inverseOffset],
  );
  const thresholdHeatmap = useMemo(
    () => buildRaThresholdHeatmap(signals),
    [signals],
  );
  const thresholdHeatmapHasData = useMemo(
    () => thresholdHeatmap.cells.some((c) => c.sampleN > 0),
    [thresholdHeatmap],
  );
  const anchorEmptyDetail = useMemo(() => {
    if (selectedInverseEligibility && selectedInverseEligibility.total > 0) {
      return t("modelLab.raCalibration.inverse.emptyDetail", {
        anchor: selectedInverseEligibility.offsetLabel,
        n: String(selectedInverseEligibility.total),
        up: String(selectedInverseEligibility.upN),
        down: String(selectedInverseEligibility.downN),
        flat: String(selectedInverseEligibility.flatN),
        need: String(
          Math.max(0, 4 - selectedInverseEligibility.upN - selectedInverseEligibility.downN),
        ),
      });
    }
    return t("modelLab.raCalibration.inverse.empty");
  }, [selectedInverseEligibility, t]);
  const showCompressionHint = cohortRaCompressionHint(cohort);
  const thresholdPlugin = useMemo(
    () => thresholdZonePlugin(55, "55%", greenLine),
    [greenLine],
  );
  const thresholdLowNIndices = useMemo(
    () =>
      thresholdCurve
        .map((p, i) => (p.sampleN < RA_CALIB_MIN_SAMPLE_N ? i : -1))
        .filter((i) => i >= 0),
    [thresholdCurve],
  );
  const thresholdChartPlugins = useMemo(
    () => [
      thresholdLowSampleZonePlugin(thresholdLowNIndices),
      thresholdPlugin,
    ],
    [thresholdLowNIndices, thresholdPlugin],
  );
  const lowSampleGray = snVar("--sn-text-3", "#94a3b8");
  const rhoPlugin = useMemo(
    () => thresholdZonePlugin(0.6, "ρ=0.6", greenLine),
    [greenLine],
  );

  const thresholdData = useMemo(() => {
    const rates = thresholdCurve.map((p) => p.successRate);
    const counts = thresholdCurve.map((p) => p.sampleN);
    const lowN = (n: number) => n < RA_CALIB_MIN_SAMPLE_N;
    return {
      labels: thresholdCurve.map((p) => String(p.threshold)),
      datasets: [
        {
          label: t("modelLab.raCalibration.threshold.legend.successRate"),
          data: rates,
          borderColor: thresholdCurve.map((p) =>
            lowN(p.sampleN) ? lowSampleGray : modelHex,
          ),
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; height: number }; dataIndex: number }) => {
            const n = thresholdCurve[ctx.dataIndex]?.sampleN ?? 0;
            const hex = lowN(n) ? lowSampleGray : modelHex;
            return chartGrad(ctx.chart.ctx, hex, lowN(n) ? 0.12 : 0.25, ctx.chart.height);
          },
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          pointBackgroundColor: thresholdCurve.map((p) =>
            lowN(p.sampleN) ? lowSampleGray : modelHex,
          ),
          pointBorderColor: thresholdCurve.map((p) =>
            lowN(p.sampleN) ? "var(--sn-border)" : "var(--sn-surface-raised)",
          ),
          pointBorderWidth: 2,
          yAxisID: "y",
        },
        {
          label: t("modelLab.raCalibration.threshold.legend.sampleN"),
          data: counts,
          borderColor: accentColor,
          borderDash: [5, 4],
          pointRadius: 3,
          fill: false,
          tension: 0.2,
          yAxisID: "yn",
        },
      ],
    };
  }, [thresholdCurve, modelHex, accentColor, lowSampleGray, t]);

  const trendData = useMemo(() => {
    const labels = weeklyRho.map((w) => w.week);
    const data = weeklyRho.map((w) => w.rho);
    return {
      labels,
      datasets: [
        {
          label: t("modelLab.raCalibration.radar.monotonicity"),
          data,
          borderColor: modelHex,
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; height: number } }) =>
            chartGrad(ctx.chart.ctx, modelHex, 0.25, ctx.chart.height),
          fill: true,
          tension: 0.3,
          spanGaps: false,
          pointRadius: 6,
          pointBackgroundColor: modelHex,
          pointBorderColor: "var(--sn-surface-raised)",
          pointBorderWidth: 2,
        },
      ],
    };
  }, [weeklyRho, modelHex, t]);

  const radarData = useMemo(
    () => ({
      labels: [
        t("modelLab.raCalibration.radar.monotonicity"),
        t("modelLab.raCalibration.radar.sampleSize"),
        t("modelLab.raCalibration.radar.bandCoverage"),
        t("modelLab.raCalibration.radar.priceUp55"),
        t("modelLab.raCalibration.radar.risingTrend"),
      ],
      datasets: [
        {
          label: t("modelLab.raCalibration.radar.current"),
          data: radarScores,
          borderColor: modelHex,
          backgroundColor: rgbaFromVar("--chart-model", 0.2, "rgba(107,79,200,0.2)"),
          pointBackgroundColor: modelHex,
        },
        {
          label: t("modelLab.raCalibration.radar.target"),
          data: RADAR_TARGET,
          borderColor: greenLine,
          backgroundColor: "transparent",
          borderDash: [4, 3],
          pointRadius: 0,
        },
      ],
    }),
    [radarScores, modelHex, greenLine, t],
  );

  const thresholdInsight = (() => {
    const anchor = raCalibOffsetLabel(inverseOffset);
    const reliable = thresholdCurve.find(
      (p) =>
        p.successRate != null &&
        p.successRate >= 55 &&
        p.sampleN >= RA_CALIB_MIN_SAMPLE_N,
    );
    if (reliable) {
      return t("modelLab.raCalibration.threshold.insightFound", {
        threshold: String(reliable.threshold),
        rate: String(reliable.successRate),
        n: String(reliable.sampleN),
        anchor,
      });
    }
    const greenButSparse = thresholdCurve.find(
      (p) => p.successRate != null && p.successRate >= 55,
    );
    if (greenButSparse) {
      return t("modelLab.raCalibration.threshold.insightLowN", {
        threshold: String(greenButSparse.threshold),
        rate: String(greenButSparse.successRate),
        n: String(greenButSparse.sampleN),
        minN: String(RA_CALIB_MIN_SAMPLE_N),
        anchor,
      });
    }
    return t("modelLab.raCalibration.threshold.insightNone", { anchor });
  })();

  const rhoNonNull = weeklyRho.filter((w) => w.rho != null);
  const trendInsight =
    rhoNonNull.length < 3
      ? t("modelLab.raCalibration.trend.insightNeedWeeks", { n: String(rhoNonNull.length) })
      : (() => {
          const recent = rhoNonNull.slice(-3).map((w) => w.rho!);
          if (recent[2]! > recent[0]! + 0.04) {
            return t("modelLab.raCalibration.trend.insightImproving");
          }
          if (recent[2]! < recent[0]! - 0.04) {
            return t("modelLab.raCalibration.trend.insightDeclining");
          }
          return t("modelLab.raCalibration.trend.insightStable");
        })();

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: chartDevicePixelRatio(),
    plugins: { legend: { display: false } },
  };

  const trendChartOptions = useMemo(
    () => ({
      ...chartOpts,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: { parsed: { y: number | null }; dataIndex: number }) => {
              const w = weeklyRho[ctx.dataIndex];
              if (!w || ctx.parsed.y == null) return "";
              const { p, stars } = correlationSignificance(ctx.parsed.y, w.rhoN ?? null);
              const lines = [
                `${t("modelLab.raCalibration.radar.monotonicity")}: ${formatCorrelationWithStars(ctx.parsed.y, w.rhoN ?? null)}`,
              ];
              if (p != null) {
                lines.push(t("modelLab.sdsAccuracy.stat.pValue", { p: formatPValue(p) }));
              }
              lines.push(t("modelLab.sdsAccuracy.stat.starsMeaning", { stars }));
              return lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: scaleStyle.ticks, grid: scaleStyle.grid },
        y: {
          min: -1,
          max: 1,
          ticks: scaleStyle.ticks,
          grid: scaleStyle.grid,
        },
      },
    }),
    [chartOpts, weeklyRho, scaleStyle, t],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        color: "var(--sn-text)",
        overflowY: "auto",
        flex: 1,
        minHeight: 0,
        paddingRight: 4,
      }}
    >
      {/* Section A — KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <KpiCard
          label={t("modelLab.raCalibration.kpi.totalSignals")}
          value={kpis.totalSignals}
          sub={t("modelLab.raCalibration.kpi.totalSignalsSub")}
          valueColor="var(--sn-text)"
        />
        <KpiCard
          label={t("modelLab.raCalibration.kpi.bestBand")}
          value={
            kpis.bestTemporal
              ? formatRaTemporalBestValue(kpis.bestTemporal)
              : kpis.bestBand ?? t("modelLab.raCalibration.nd")
          }
          sub={
            kpis.bestTemporal
              ? t("modelLab.raCalibration.kpi.bestBandTemporalSub", {
                  range: kpis.bestTemporal.raRange,
                  longTarget: formatRaTemporalLongTarget(),
                  longPct: `${kpis.bestTemporal.longPct}%`,
                  shortPct:
                    kpis.bestTemporal.shortPct != null
                      ? `${kpis.bestTemporal.shortPct}%`
                      : "—",
                  shortTarget: formatRaTemporalShortTarget(kpis.bestTemporal.offset) ?? "—",
                  n: String(kpis.bestTemporal.n),
                })
              : kpis.bestBandPct
                ? t("modelLab.raCalibration.kpi.bestBandSub", {
                    pct: kpis.bestBandPct,
                    pct24h: kpis.bestBandPct24h ?? "—",
                  })
                : "—"
          }
          valueColor={bestBandColor}
        />
        <KpiCard
          label={t("modelLab.raCalibration.kpi.monotonicity")}
          value={kpis.monotonicityRho}
          sub={t("modelLab.raCalibration.kpi.monotonicitySub")}
          valueColor={rhoValueColor}
        />
        <KpiCard
          label={t("modelLab.raCalibration.kpi.investThreshold")}
          value={kpis.investThreshold}
          sub={t("modelLab.raCalibration.kpi.investThresholdSub")}
          valueColor={investColor}
        />
      </div>

      {/* Section B — inverse pattern: price outcome → RA indices */}
      <div className={sectionClass}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--sn-text)", margin: 0 }}>
          {t("modelLab.raCalibration.inverse.title")}
        </h3>
        <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "6px 0 8px" }}>
          {t("modelLab.raCalibration.inverse.desc")}
        </p>
        {inverseBuildArgs ? (
          <p
            style={{
              fontSize: 10,
              color: "var(--sn-primary)",
              margin: "0 0 10px",
              padding: "6px 10px",
              borderRadius: 8,
              background: "var(--sn-primary-pale)",
            }}
          >
            {t("modelLab.raCalibration.inverse.asOfBanner", {
              anchor: raCalibOffsetLabel(inverseOffset),
            })}
          </p>
        ) : null}
        {showCompressionHint ? (
          <p
            style={{
              fontSize: 10,
              color: "var(--sn-accent)",
              margin: "0 0 10px",
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--sn-watch-bg)",
            }}
          >
            {t("modelLab.raCalibration.inverse.compressionBanner", {
              max: cohort?.scoreMax != null ? String(Math.round(cohort.scoreMax)) : "—",
            })}
          </p>
        ) : null}
        {inverseEligibility.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px 8px",
              marginBottom: 10,
              fontSize: 9,
              color: "var(--sn-text-2)",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--sn-text)" }}>
              {t("modelLab.raCalibration.inverse.anchorLabel")}
            </span>
            {inverseEligibility.map((row) => (
              <button
                key={row.offset}
                type="button"
                aria-pressed={inverseOffset === row.offset}
                style={{
                  ...chipBtnStyle(inverseOffset === row.offset),
                  opacity: row.tableReady ? 1 : 0.88,
                }}
                title={
                  row.tableReady
                    ? t("modelLab.raCalibration.inverse.anchorChipReady", {
                        n: String(row.total),
                        up: String(row.upN),
                        down: String(row.downN),
                      })
                    : t("modelLab.raCalibration.inverse.anchorChipSparse", {
                        n: String(row.total),
                        up: String(row.upN),
                        down: String(row.downN),
                        flat: String(row.flatN),
                      })
                }
                onClick={() => setInverseOffset(row.offset)}
              >
                {row.offsetLabel}
                {row.tableReady ? "" : ` · n=${row.total}`}
              </button>
            ))}
          </div>
        ) : null}
        {inversePattern ? (
          <>
            <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "0 0 10px" }}>
              {t("modelLab.raCalibration.inverse.summary", {
                anchor: inversePattern.offsetLabel,
                upN: String(inversePattern.upN),
                downN: String(inversePattern.downN),
                upRa:
                  inversePattern.upMeanRa != null ? String(inversePattern.upMeanRa) : "—",
                downRa:
                  inversePattern.downMeanRa != null ? String(inversePattern.downMeanRa) : "—",
                raDelta:
                  inversePattern.raDelta != null
                    ? `${inversePattern.raDelta >= 0 ? "+" : ""}${inversePattern.raDelta}`
                    : "—",
                top: inversePattern.topDiscriminators
                  .map((id) => t(INVERSE_COMPONENT_LABEL_KEYS[id]))
                  .join(", ") || "—",
              })}
            </p>
            {inversePattern.raDelta != null && inversePattern.raDelta < 0 ? (
              <p
                style={{
                  fontSize: 10,
                  color: "var(--sn-watch-text, var(--sn-accent))",
                  margin: "0 0 10px",
                  lineHeight: 1.45,
                }}
              >
                {t("modelLab.raCalibration.inverse.negativeDeltaHint")}
              </p>
            ) : null}
            <RaInverseCumulativeChart pattern={inversePattern} />
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginBottom: inverseTableOpen ? 8 : 0,
              }}
            >
              <button
                type="button"
                style={{
                  ...chipBtnStyle(false),
                  fontSize: 10,
                  padding: "4px 12px",
                  fontWeight: 600,
                }}
                aria-expanded={inverseTableOpen}
                onClick={() => setInverseTableOpen((open) => !open)}
              >
                {inverseTableOpen ? "▾" : "▸"}{" "}
                {t(
                  inverseTableOpen
                    ? "modelLab.raCalibration.inverse.tableHide"
                    : "modelLab.raCalibration.inverse.tableShow",
                )}
              </button>
              <button
                type="button"
                style={{
                  ...chipBtnStyle(false),
                  fontSize: 10,
                  padding: "4px 12px",
                }}
                onClick={() => downloadRaInversePatternCsv(inversePattern)}
              >
                {t("modelLab.raCalibration.inverse.exportCsv")}
              </button>
            </div>
            {inverseTableOpen ? (
              <>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 10,
                  color: "var(--sn-text-2)",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--sn-border)" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>
                      {t("modelLab.raCalibration.inverse.colIndex")}
                    </th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600 }}>
                      {t("modelLab.raCalibration.inverse.colUp")} (n={inversePattern.upN})
                    </th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600 }}>
                      {t("modelLab.raCalibration.inverse.colDown")} (n={inversePattern.downN})
                    </th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600 }}>
                      {t("modelLab.raCalibration.inverse.colDelta")}
                    </th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600 }}>
                      {t("modelLab.raCalibration.inverse.colP")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--sn-border-soft, var(--sn-border))" }}>
                    <td style={{ padding: "8px", fontWeight: 600, color: "var(--sn-text)" }}>
                      {t("modelLab.raCalibration.inverse.raTotal")}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {inversePattern.upMeanRa ?? "—"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {inversePattern.downMeanRa ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        color:
                          (inversePattern.raDelta ?? 0) > 2
                            ? "var(--sn-long-text)"
                            : (inversePattern.raDelta ?? 0) < -2
                              ? "var(--sn-short-text)"
                              : "var(--sn-text-2)",
                      }}
                    >
                      {inversePattern.raDelta != null
                        ? `${inversePattern.raDelta >= 0 ? "+" : ""}${inversePattern.raDelta}`
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: inversePattern.raStars !== "ns" ? 600 : 400,
                        color:
                          inversePattern.raStars !== "ns"
                            ? "var(--sn-primary)"
                            : "var(--sn-text-3)",
                      }}
                    >
                      {formatPValueWithStars(inversePattern.raPValue)}
                    </td>
                  </tr>
                  {inversePattern.components.map((row) => (
                    <tr
                      key={row.id}
                      style={{ borderBottom: "1px solid var(--sn-border-soft, var(--sn-border))" }}
                    >
                      <td style={{ padding: "8px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: SOLIDITY_COMPONENT_COLORS[row.id],
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ color: "var(--sn-text)" }}>
                            {t(INVERSE_COMPONENT_LABEL_KEYS[row.id])}
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {row.upMeanPts != null
                          ? `${row.upMeanPts}/${row.maxPoints} (${row.upMeanPct}%)`
                          : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {row.downMeanPts != null
                          ? `${row.downMeanPts}/${row.maxPoints} (${row.downMeanPct}%)`
                          : "—"}
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 600,
                          color:
                            (row.deltaPct ?? 0) > 8
                              ? "var(--sn-long-text)"
                              : (row.deltaPct ?? 0) < -8
                                ? "var(--sn-short-text)"
                                : "var(--sn-text-2)",
                        }}
                      >
                        {row.deltaPct != null
                          ? `${row.deltaPct >= 0 ? "+" : ""}${row.deltaPct}%`
                          : "—"}
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: row.stars !== "ns" ? 600 : 400,
                          color:
                            row.stars !== "ns" ? "var(--sn-primary)" : "var(--sn-text-3)",
                        }}
                      >
                        {formatPValueWithStars(row.pValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 9, color: "var(--sn-text-3)", margin: "8px 0 0" }}>
              {t("modelLab.raCalibration.inverse.pFootnote")}
            </p>
              </>
            ) : null}
          </>
        ) : (
          <AnchorEmptyPanel
            title={t("modelLab.raCalibration.inverse.emptyTitle")}
            detail={anchorEmptyDetail}
          />
        )}
      </div>

      {/* Section C — Threshold finder */}
      <div className={sectionClass}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
          {t("modelLab.raCalibration.threshold.title")}
        </h3>
        <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "6px 0 4px" }}>
          {t("modelLab.raCalibration.threshold.desc", {
            anchor: raCalibOffsetLabel(inverseOffset),
          })}
        </p>
        <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "0 0 8px", lineHeight: 1.45 }}>
          {t("modelLab.raCalibration.threshold.anchorScope", {
            anchor: raCalibOffsetLabel(inverseOffset),
            minN: String(RA_CALIB_MIN_SAMPLE_N),
          })}
        </p>
        {thresholdHeatmapHasData ? (
          <RaThresholdHeatmap
            heatmap={thresholdHeatmap}
            selectedOffset={inverseOffset}
            onSelectOffset={setInverseOffset}
          />
        ) : null}
        {anchorAtSelectedReady ? (
          <>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 20px",
            fontSize: 11,
            color: "var(--sn-text-2)",
            marginBottom: 10,
            marginTop: thresholdHeatmapHasData ? 12 : 0,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 420 }}>
            <span
              style={{
                width: 22,
                height: 3,
                borderRadius: 2,
                background: modelHex,
                flexShrink: 0,
              }}
            />
            <span>{t("modelLab.raCalibration.threshold.legend.successRate")}</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 420 }}>
            <span
              style={{
                width: 22,
                height: 0,
                borderTop: `2px dashed ${accentColor}`,
                flexShrink: 0,
              }}
            />
            <span>{t("modelLab.raCalibration.threshold.legend.sampleN")}</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: 420 }}>
            <span
              style={{
                width: 22,
                height: 14,
                borderRadius: 3,
                background: "rgba(148,163,184,0.25)",
                border: "1px solid var(--sn-border)",
                flexShrink: 0,
              }}
            />
            <span>{t("modelLab.raCalibration.threshold.legend.lowN", { minN: String(RA_CALIB_MIN_SAMPLE_N) })}</span>
          </span>
        </div>
        <div style={{ height: CHART_H.threshold }}>
          <Line
            data={thresholdData}
            options={{
              ...chartOpts,
              layout: { padding: { top: 4 } },
              plugins: {
                legend: { display: false },
                tooltip: {
                  backgroundColor: snVar("--sn-surface-raised", "#ede9f6"),
                  titleColor: snVar("--sn-text", "#1e1530"),
                  bodyColor: snVar("--sn-text-2", "#5e5080"),
                  borderColor: snVar("--sn-border", "#c2bae0"),
                  borderWidth: 1,
                  padding: 10,
                  callbacks: {
                    afterBody: (items) => {
                      const idx = items[0]?.dataIndex;
                      if (idx == null) return [];
                      const pt = thresholdCurve[idx];
                      if (!pt || pt.sampleN >= RA_CALIB_MIN_SAMPLE_N) return [];
                      return [
                        t("modelLab.raCalibration.threshold.tooltipLowN", {
                          minN: String(RA_CALIB_MIN_SAMPLE_N),
                        }),
                      ];
                    },
                  },
                },
              },
              scales: {
                x: {
                  ticks: scaleStyle.ticks,
                  grid: scaleStyle.grid,
                  title: {
                    display: true,
                    text: t("modelLab.raCalibration.threshold.xAxis"),
                    color: scaleStyle.ticks.color,
                    font: { size: 10, weight: "bold" },
                  },
                },
                y: {
                  min: 0,
                  max: 100,
                  position: "left",
                  ticks: { ...scaleStyle.ticks, callback: (v) => `${v}%` },
                  grid: scaleStyle.grid,
                },
                yn: {
                  position: "right",
                  min: 0,
                  max: Math.max(10, ...thresholdCurve.map((p) => p.sampleN)) * 1.1,
                  ticks: scaleStyle.ticks,
                  grid: { display: false },
                },
              },
            }}
            plugins={thresholdChartPlugins}
          />
        </div>
        <div style={{ ...insightStyle, marginTop: 10 }}>{thresholdInsight}</div>
          </>
        ) : (
          <AnchorEmptyPanel
            title={t("modelLab.raCalibration.inverse.emptyTitle")}
            detail={anchorEmptyDetail}
          />
        )}
      </div>

      {/* Section D — Trend + Confidence */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className={sectionClass}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            {t("modelLab.raCalibration.trend.title")}
          </h3>
          <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "6px 0 0" }}>
            {t("modelLab.sdsAccuracy.stat.legend")}
          </p>
          <div style={{ height: CHART_H.trend, marginTop: 10 }}>
            <Line
              data={trendData}
              options={trendChartOptions}
              plugins={[rhoPlugin]}
            />
          </div>
          <div style={{ ...insightStyle, marginTop: 10 }}>{trendInsight}</div>
        </div>

        <div className={sectionClass}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            {t("modelLab.raCalibration.confidence.title")}
          </h3>
          <div style={{ height: CHART_H.radar, marginTop: 10 }}>
            <Radar
              data={radarData}
              options={{
                ...chartOpts,
                scales: {
                  r: {
                    min: 0,
                    max: 100,
                    ticks: { display: false },
                    grid: { color: scaleStyle.grid.color },
                    pointLabels: { color: scaleStyle.ticks.color, font: { size: 9 } },
                  },
                },
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {checks.map((c) => (
              <div
                key={c.key}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--sn-text-2)" }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background:
                      c.dotColor === "green"
                        ? "var(--sn-long-text)"
                        : c.dotColor === "amber"
                          ? "var(--sn-accent)"
                          : "var(--sn-short-text)",
                  }}
                />
                <span style={{ flex: 1 }}>{t(CHECK_LABEL_KEYS[c.key])}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--sn-text)" }}>
                  {confidenceCheckStatus(c, t)}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: confidenceBg,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--sn-text)",
              textAlign: "center",
            }}
          >
            {t("modelLab.raCalibration.confidence.global", {
              pct: String(confidencePct),
              phase: confidencePhase,
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
