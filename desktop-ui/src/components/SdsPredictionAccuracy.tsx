import { useEffect, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Legend,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useTheme } from "../hooks/useTheme";
import { useT } from "../shared/i18n";
import {
  bestAccurateNodePlugin,
  cdZonePlugin,
  chartDevicePixelRatio,
  chartGrad,
  chartScaleStyle,
  refLinePlugin,
  todayNodePlugin,
} from "../utils/chartGrad";
import type { SdsPredictionSignal } from "../sheet/sdsRoiTemporalConvergence";
import {
  NODE_LABELS,
  MIN_NODE_PAIRS_FOR_RANK,
  SDS_CONFIDENCE_COVERAGE_TARGET_PCT,
  SDS_CONFIDENCE_LOOP_SNAPSHOTS,
  SDS_CONFIDENCE_MAE_TARGET_PP,
  SDS_CONFIDENCE_TEMPORAL_WEEKS,
  SDS_GROW_SIGNIFICANT_MIN_PCT,
  SDS_RHO_PRACTICAL_TARGET,
  computeNodeAggregates,
  computeNodeAccuracySummary,
  computeNodeRoiGapCurve,
  computeSdsAccuracyKpis,
  computeSdsSignalImpactInsights,
  countSdsRhoPairs,
  nearestTodayNodeIndex,
  type SdsNodeAccuracyPoint,
  type SdsNodeAccuracyStat,
  type SdsRoiGapPoint,
} from "../sheet/sdsPredictionAccuracyCompute";
import {
  correlationSignificance,
  criticalAbsCorrelation,
  formatPValue,
  formatSignedCorrelation,
} from "../sheet/statSignificance";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Legend, Tooltip);

export type SdsPredictionAccuracyProps = {
  signals: SdsPredictionSignal[];
  weeklyCalibration: Array<{
    week: string;
    mae: number | null;
    coverage: number | null;
    rho: number | null;
    rhoN?: number | null;
  }>;
};

const sectionClass = "sn-chart-section";
const kpiSectionClass = "sn-chart-section sn-chart-section--kpi";

const insightStyle: React.CSSProperties = {
  background: "var(--sn-primary-pale)",
  borderLeft: "3px solid var(--sn-primary)",
  borderRadius: "0 8px 8px 0",
  padding: "10px 14px",
  fontSize: 12,
  color: "var(--sn-text-2)",
};

function snVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Collapsible help — always English (ρ vs MAE). */
function SdsRhoMaeNotMeansPanel({
  maeDisplay,
  rhoDisplay,
}: {
  maeDisplay: string;
  rhoDisplay: string;
}) {
  return (
    <details
      className="sds-rho-mae-not-means group"
      style={{
        marginTop: 10,
        borderRadius: 8,
        border: "1px solid var(--sn-border-subtle)",
        background: "var(--sn-primary-pale, rgba(107,79,200,0.06))",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--sn-primary-dark, #4a3296)",
        }}
      >
        <span
          aria-hidden
          style={{ fontSize: 10, transition: "transform 0.15s ease" }}
          className="group-open:rotate-90"
        >
          ▶
        </span>
        What high ρ does NOT mean
      </summary>
      <div
        style={{
          padding: "0 12px 12px",
          fontSize: 11,
          lineHeight: 1.55,
          color: "var(--sn-text-2)",
        }}
      >
        <p style={{ margin: "0 0 8px" }}>
          A high Spearman ρ does <strong>not</strong> mean predicted numbers are close to actual
          ROI. ρ and MAE answer different questions.
        </p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          <li style={{ marginBottom: 4 }}>
            <strong>MAE {maeDisplay}</strong> — average error on <em>magnitudes</em> (how far off in
            percentage points, globally across all T-nodes).
          </li>
          <li>
            <strong>ρ {rhoDisplay}</strong> — agreement on <em>who ranks higher vs lower</em> (tickers
            ordered correctly), not on exact values.
          </li>
        </ul>
        <p
          style={{
            margin: 0,
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--sn-surface-raised, #fff)",
            border: "1px solid var(--sn-border-subtle)",
            fontSize: 10.5,
            color: "var(--sn-text)",
          }}
        >
          <strong>Example:</strong> SDS predicts <strong>+30%</strong> on ticker A and{" "}
          <strong>+10%</strong> on B. The market delivers <strong>+5%</strong> on A and{" "}
          <strong>−2%</strong> on B. Rank order is correct (A &gt; B), but MAE is still high on both
          because the levels are far from reality.
        </p>
      </div>
    </details>
  );
}

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

function ProgressBar({
  label,
  target,
  value,
  display,
  barColor,
}: {
  label: string;
  target: string;
  value: number;
  display: string;
  barColor: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2, fontSize: 12 }}>
        <span style={{ color: "var(--sn-text-2)" }}>{label}</span>
        <span style={{ color: "var(--sn-text)", fontWeight: 500 }}>{display}</span>
      </div>
      <p style={{ margin: "0 0 4px", fontSize: 10, color: "var(--sn-text-3)" }}>{target}</p>
      <div style={{ background: "var(--sn-surface)", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: 8,
            borderRadius: 4,
            background: barColor,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

const CHART_H = { main: 320, gap: 220, learning: 280 } as const;
const CD_NODE_INDEX = 4.5;

function formatSignedPp(v: number): string {
  return `${v >= 0 ? "+" : ""}${v} pp`;
}

function gapPointForLabel(curve: SdsRoiGapPoint[], label: string): SdsRoiGapPoint | null {
  return curve.find((p) => p.label === label) ?? null;
}

function gapDirectionKey(signedGap: number): "over" | "under" | "aligned" {
  if (signedGap > 0.05) return "under";
  if (signedGap < -0.05) return "over";
  return "aligned";
}

function ChartCrossLinkBridge({
  bestAccurate,
  bestAccurateRanked,
  roiGapCurve,
}: {
  bestAccurate: SdsNodeAccuracyPoint | null;
  bestAccurateRanked: SdsNodeAccuracyPoint | null;
  roiGapCurve: SdsRoiGapPoint[];
}) {
  const t = useT();
  if (!bestAccurate) return null;

  const rows: Array<{
    key: string;
    role: string;
    node: SdsNodeAccuracyPoint;
    highlight: "accent" | "long";
  }> = [
    {
      key: "closest",
      role: t("modelLab.sdsAccuracy.crossLink.roleClosest"),
      node: bestAccurate,
      highlight: "accent",
    },
  ];
  if (bestAccurateRanked && bestAccurateRanked.label !== bestAccurate.label) {
    rows.push({
      key: "ranked",
      role: t("modelLab.sdsAccuracy.crossLink.roleRanked", {
        min: String(MIN_NODE_PAIRS_FOR_RANK),
      }),
      node: bestAccurateRanked,
      highlight: "long",
    });
  }

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px dashed var(--sn-border)",
        background: "var(--sn-surface)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sn-text)", marginBottom: 8 }}>
        {t("modelLab.sdsAccuracy.crossLink.title")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.1fr) 72px minmax(0,1fr) 88px minmax(0,1.2fr)",
          gap: "6px 10px",
          fontSize: 10,
          color: "var(--sn-text-3)",
          marginBottom: 4,
        }}
      >
        <span>{t("modelLab.sdsAccuracy.crossLink.colRole")}</span>
        <span>{t("modelLab.sdsAccuracy.crossLink.colChart1")}</span>
        <span>{t("modelLab.sdsAccuracy.crossLink.colNode")}</span>
        <span>{t("modelLab.sdsAccuracy.crossLink.colChart2")}</span>
        <span>{t("modelLab.sdsAccuracy.crossLink.colMeaning")}</span>
      </div>
      {rows.map((row) => {
        const gap = gapPointForLabel(roiGapCurve, row.node.label);
        const signed = gap?.signedGap;
        const direction =
          signed != null
            ? t(`modelLab.sdsAccuracy.crossLink.direction.${gapDirectionKey(signed)}`)
            : t("modelLab.sdsAccuracy.crossLink.noGapData");
        const borderColor =
          row.highlight === "accent" ? "var(--sn-accent)" : "var(--sn-long-text)";
        return (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.1fr) 72px minmax(0,1fr) 88px minmax(0,1.2fr)",
              gap: "6px 10px",
              alignItems: "center",
              fontSize: 11,
              padding: "6px 0",
              borderTop: "1px solid var(--sn-border)",
            }}
          >
            <span style={{ fontWeight: 600, color: borderColor }}>{row.role}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--sn-text)" }}>
              ±{row.node.mae}pp
            </span>
            <span style={{ fontWeight: 700, color: "var(--sn-text)" }}>{row.node.label}</span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: signed == null ? "var(--sn-text-3)" : "var(--sn-text)",
              }}
            >
              {signed != null ? formatSignedPp(signed) : "n/d"}
            </span>
            <span style={{ color: "var(--sn-text-2)", lineHeight: 1.35 }}>{direction}</span>
          </div>
        );
      })}
      <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "8px 0 0", lineHeight: 1.4 }}>
        {t("modelLab.sdsAccuracy.crossLink.footnote")}
      </p>
    </div>
  );
}

function NodeCoverageStrip({
  nodes,
  bestAccurateLabel,
  densestLabel,
}: {
  nodes: SdsNodeAccuracyStat[];
  bestAccurateLabel: string | null;
  densestLabel: string | null;
}) {
  const t = useT();
  return (
    <div
      style={{
        marginTop: 12,
        display: "grid",
        gridTemplateColumns: `repeat(${nodes.length}, 1fr)`,
        gap: 4,
      }}
    >
      {nodes.map((n) => {
        const isBest = bestAccurateLabel === n.label;
        const isDensest = densestLabel === n.label && densestLabel !== bestAccurateLabel;
        const statusColor =
          n.status === "no_data"
            ? "var(--sn-text-3)"
            : n.status === "insufficient"
              ? "var(--sn-accent)"
              : "var(--sn-long-text)";
        const bg =
          n.status === "no_data"
            ? "var(--sn-surface)"
            : n.status === "insufficient"
              ? "rgba(200, 146, 74, 0.1)"
              : "rgba(59, 175, 138, 0.08)";
        return (
          <div
            key={n.label}
            title={
              n.status === "no_data"
                ? t("modelLab.sdsAccuracy.nodeStrip.tipNoData")
                : n.status === "insufficient"
                  ? t("modelLab.sdsAccuracy.nodeStrip.tipInsufficient", {
                      n: String(n.n),
                      min: String(MIN_NODE_PAIRS_FOR_RANK),
                    })
                  : t("modelLab.sdsAccuracy.nodeStrip.tipMeasured", {
                      mae: n.mae != null ? String(n.mae) : "—",
                      n: String(n.n),
                    })
            }
            style={{
              textAlign: "center",
              padding: "6px 2px",
              borderRadius: 6,
              background: bg,
              border: isBest
                ? "2px solid var(--sn-accent)"
                : isDensest
                  ? "1px dashed var(--sn-text-3)"
                  : "1px solid var(--sn-border)",
              fontSize: 9,
              lineHeight: 1.35,
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--sn-text)" }}>{n.label}</div>
            <div style={{ color: statusColor, fontWeight: 500 }}>
              {n.status === "no_data"
                ? t("modelLab.sdsAccuracy.nodeStrip.noData")
                : t("modelLab.sdsAccuracy.nodeStrip.pairs", { n: String(n.n) })}
            </div>
            {n.status !== "no_data" && n.mae != null && (
              <div style={{ color: "var(--sn-text-2)" }}>
                {t("modelLab.sdsAccuracy.nodeStrip.mae", { mae: String(n.mae) })}
              </div>
            )}
            {isBest && (
              <div style={{ color: "var(--sn-accent)", fontWeight: 700, marginTop: 2 }}>
                {t("modelLab.sdsAccuracy.nodeStrip.bestAccurate")}
              </div>
            )}
            {isDensest && (
              <div style={{ color: "var(--sn-text-3)", marginTop: 2 }}>
                {t("modelLab.sdsAccuracy.nodeStrip.mostData")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SdsPredictionAccuracy({ signals, weeklyCalibration }: SdsPredictionAccuracyProps) {
  const t = useT();
  const { theme } = useTheme();

  useEffect(() => {
    ChartJS.defaults.devicePixelRatio = chartDevicePixelRatio();
  }, [theme]);

  const aggregates = useMemo(() => computeNodeAggregates(signals), [signals]);
  const nodeSummary = useMemo(() => computeNodeAccuracySummary(signals), [signals]);
  const kpis = useMemo(
    () => computeSdsAccuracyKpis(signals, weeklyCalibration),
    [signals, weeklyCalibration],
  );
  const insights = useMemo(
    () => computeSdsSignalImpactInsights(signals, nodeSummary, weeklyCalibration, kpis),
    [signals, nodeSummary, weeklyCalibration, kpis],
  );
  const liveRhoN = useMemo(() => countSdsRhoPairs(signals), [signals]);
  const rhoSigThreshold = useMemo(
    () => criticalAbsCorrelation(liveRhoN) ?? 0.5,
    [liveRhoN],
  );
  const roiGapCurve = useMemo(() => computeNodeRoiGapCurve(signals), [signals]);
  const todayIdx = useMemo(() => nearestTodayNodeIndex(signals), [signals]);

  const scaleStyle = useMemo(() => chartScaleStyle(), [theme]);
  const modelHex = snVar("--chart-model", "#6B4FC8");
  const actualHex = snVar("--chart-actual-long", "#3BAF8A");
  const shortHex = snVar("--chart-actual-short", "#D64040");
  const accentHex = snVar("--sn-accent", "#C8924A");

  const maeColor =
    kpis.mae == null
      ? "var(--sn-text-3)"
      : kpis.mae < 5
        ? "var(--sn-long-text)"
        : kpis.mae <= 15
          ? "var(--sn-accent)"
          : "var(--sn-short-text)";
  const covColor =
    kpis.coveragePct > 60
      ? "var(--sn-long-text)"
      : kpis.coveragePct >= 30
        ? "var(--sn-accent)"
        : "var(--sn-short-text)";
  const rhoColor = (() => {
    const rho = kpis.latestRhoNum;
    if (rho == null) return "var(--sn-text-3)";
    if (rho >= SDS_RHO_PRACTICAL_TARGET) return "var(--sn-long-text)";
    if (rho > 0) return "var(--sn-accent)";
    if (rho < 0) return "var(--sn-short-text)";
    return "var(--sn-text-3)";
  })();
  const rhoKpiValue =
    kpis.latestRhoNum != null
      ? formatSignedCorrelation(kpis.latestRhoNum)
      : t("modelLab.raCalibration.nd");
  const rhoKpiSub = (() => {
    const rho = kpis.latestRhoNum;
    if (rho == null) return t("modelLab.sdsAccuracy.kpi.rhoSub");
    const { p, stars } = correlationSignificance(rho, liveRhoN);
    if (p == null) return t("modelLab.sdsAccuracy.kpi.rhoSub");
    return t("modelLab.sdsAccuracy.kpi.rhoPSub", {
      p: formatPValue(p),
      stars,
      n: String(liveRhoN),
    });
  })();

  const mainChartData = useMemo(
    () => ({
      labels: NODE_LABELS,
      datasets: [
        {
          label: t("modelLab.sdsAccuracy.chart.predicted"),
          data: aggregates.map((a) => a.predictedMean),
          borderColor: modelHex,
          borderDash: [6, 3],
          borderWidth: 2.5,
          fill: false,
          pointRadius: 6,
          pointBackgroundColor: modelHex,
          pointBorderColor: "var(--sn-surface-raised)",
          pointBorderWidth: 2,
          spanGaps: true,
        },
        {
          label: t("modelLab.sdsAccuracy.chart.actual"),
          data: aggregates.map((a) => a.actualMean),
          borderColor: actualHex,
          borderWidth: 2.5,
          fill: false,
          pointRadius: aggregates.map((a) =>
            a.status === "no_data" ? 0 : a.status === "insufficient" ? 5 : 6,
          ),
          pointBackgroundColor: aggregates.map((a) =>
            a.status === "insufficient" ? "transparent" : actualHex,
          ),
          pointBorderColor: aggregates.map((a) =>
            a.status === "no_data" ? "transparent" : actualHex,
          ),
          pointBorderWidth: aggregates.map((a) => (a.status === "insufficient" ? 2.5 : 2)),
          spanGaps: false,
        },
        {
          label: t("modelLab.sdsAccuracy.chart.rangeMax"),
          data: aggregates.map((a) => a.actualMax),
          borderWidth: 0,
          pointRadius: 0,
          fill: "+1",
          backgroundColor: "rgba(107,79,200,0.08)",
          spanGaps: false,
        },
        {
          label: t("modelLab.sdsAccuracy.chart.rangeMin"),
          data: aggregates.map((a) => a.actualMin),
          borderWidth: 0,
          pointRadius: 0,
          spanGaps: false,
        },
      ],
    }),
    [aggregates, modelHex, actualHex, t],
  );

  const learningData = useMemo(
    () => ({
      labels: weeklyCalibration.map((w) => w.week),
      datasets: [
        {
          label: t("modelLab.sdsAccuracy.chart.mae"),
          data: weeklyCalibration.map((w) => w.mae),
          borderColor: shortHex,
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; height: number } }) =>
            chartGrad(ctx.chart.ctx, shortHex, 0.22, ctx.chart.height),
          fill: true,
          borderWidth: 2,
          pointRadius: 4,
          spanGaps: false,
          yAxisID: "ymae",
        },
        {
          label: t("modelLab.sdsAccuracy.chart.rho"),
          data: weeklyCalibration.map((w) => w.rho),
          borderColor: modelHex,
          borderDash: [5, 3],
          borderWidth: 2,
          fill: false,
          pointRadius: 4,
          spanGaps: false,
          yAxisID: "yrho",
        },
      ],
    }),
    [weeklyCalibration, shortHex, modelHex, t],
  );

  const bestAccurateNodeIndex = useMemo(() => {
    const label = nodeSummary.bestAccurate?.label;
    if (!label) return null;
    const idx = NODE_LABELS.indexOf(label);
    return idx >= 0 ? idx : null;
  }, [nodeSummary.bestAccurate?.label]);

  const mainInsight = useMemo(() => {
    const { bestAccurate, bestAccurateRanked, densest, nodesWithoutData, nodesInsufficient } =
      nodeSummary;
    const parts: string[] = [];

    if (bestAccurate) {
      if (bestAccurate.n < MIN_NODE_PAIRS_FOR_RANK) {
        parts.push(
          t("modelLab.sdsAccuracy.main.insightBestAccurateLowN", {
            node: bestAccurate.label,
            mae: String(bestAccurate.mae),
            n: String(bestAccurate.n),
            min: String(MIN_NODE_PAIRS_FOR_RANK),
          }),
        );
      } else {
        parts.push(
          t("modelLab.sdsAccuracy.main.insightBestAccurate", {
            node: bestAccurate.label,
            mae: String(bestAccurate.mae),
            n: String(bestAccurate.n),
            min: String(MIN_NODE_PAIRS_FOR_RANK),
          }),
        );
      }
      if (
        bestAccurateRanked &&
        bestAccurateRanked.label !== bestAccurate.label
      ) {
        parts.push(
          t("modelLab.sdsAccuracy.main.insightBestAccurateRankedAlt", {
            node: bestAccurateRanked.label,
            mae: String(bestAccurateRanked.mae),
            n: String(bestAccurateRanked.n),
            min: String(MIN_NODE_PAIRS_FOR_RANK),
          }),
        );
      }
      if (densest && densest.label !== bestAccurate.label) {
        parts.push(
          t("modelLab.sdsAccuracy.main.insightDensestDiffers", {
            node: densest.label,
            n: String(densest.n),
          }),
        );
      }
    } else if (nodesInsufficient.length) {
      parts.push(
        t("modelLab.sdsAccuracy.main.insightInsufficientOnly", {
          min: String(MIN_NODE_PAIRS_FOR_RANK),
          nodes: nodesInsufficient.join(", "),
        }),
      );
    } else {
      parts.push(t("modelLab.sdsAccuracy.main.insightLowCoverage"));
    }

    if (nodesWithoutData.length && nodesWithoutData.length < NODE_LABELS.length) {
      parts.push(
        t("modelLab.sdsAccuracy.main.insightNoDataNodes", {
          nodes: nodesWithoutData.join(", "),
        }),
      );
    }

    if (kpis.mae != null && kpis.mae < 5) {
      parts.push(t("modelLab.sdsAccuracy.main.insightExcellent"));
    } else if (kpis.mae != null && kpis.mae < 15) {
      parts.push(t("modelLab.sdsAccuracy.main.insightGood", { mae: String(kpis.mae) }));
    } else if (kpis.mae != null) {
      parts.push(t("modelLab.sdsAccuracy.main.insightHigh", { mae: String(kpis.mae) }));
    }

    return parts.join(" ");
  }, [nodeSummary, kpis.mae, t]);

  const bestNodeSub = useMemo(() => {
    const b = insights.bestWindow;
    if (!b) {
      return t("modelLab.sdsAccuracy.kpi.bestNodeSubNone", {
        min: String(MIN_NODE_PAIRS_FOR_RANK),
      });
    }
    const rhoPart =
      insights.scoreActualRhoAtBestWindow != null
        ? t("modelLab.sdsAccuracy.kpi.bestNodeSubScoreRho", {
            rho: formatSignedCorrelation(insights.scoreActualRhoAtBestWindow),
          })
        : "";
    if (b.n < MIN_NODE_PAIRS_FOR_RANK) {
      return t("modelLab.sdsAccuracy.kpi.bestNodeSubLowSample", {
        mae: String(b.mae),
        n: String(b.n),
      }) + rhoPart;
    }
    const rankedNote = insights.bestWindowRanked
      ? ""
      : t("modelLab.sdsAccuracy.kpi.bestNodeSubUnranked");
    return (
      t("modelLab.sdsAccuracy.kpi.bestNodeSubMeasured", {
        mae: String(b.mae),
        n: String(b.n),
      }) + rhoPart + rankedNote
    );
  }, [insights, t]);

  const minSdsKpiValue =
    insights.minSignificantSdsScore != null
      ? `≥${insights.minSignificantSdsScore}`
      : t("modelLab.raCalibration.nd");
  const minSdsKpiSub = (() => {
    if (insights.minSignificantSdsScore == null) {
      return t("modelLab.sdsAccuracy.kpi.minSdsSubNone", {
        pct: String(SDS_GROW_SIGNIFICANT_MIN_PCT),
      });
    }
    return t("modelLab.sdsAccuracy.kpi.minSdsSub", {
      band: insights.minSignificantBandLabel ?? "—",
      grow: String(insights.minSignificantGrowPct ?? "—"),
      window: insights.bestWindow?.label ?? "—",
      n: String(insights.minSignificantN),
      pct: String(SDS_GROW_SIGNIFICANT_MIN_PCT),
    });
  })();
  const minSdsColor =
    insights.minSignificantSdsScore != null
      ? insights.minSignificantSdsScore <= 50
        ? "var(--sn-long-text)"
        : "var(--sn-accent)"
      : "var(--sn-text-3)";

  const learningRhoNote = (() => {
    const rho = kpis.latestRhoNum;
    if (rho == null) return null;
    const abs = Math.abs(rho);
    if (abs >= 0.3 && abs < SDS_RHO_PRACTICAL_TARGET) {
      return t("modelLab.sdsAccuracy.learning.insightRhoModerate", {
        rho: formatSignedCorrelation(rho),
        target: String(SDS_RHO_PRACTICAL_TARGET),
      });
    }
    if (abs >= SDS_RHO_PRACTICAL_TARGET && abs < 0.7) {
      return t("modelLab.sdsAccuracy.learning.insightRhoGood", {
        rho: formatSignedCorrelation(rho),
      });
    }
    if (abs < 0.3) {
      return t("modelLab.sdsAccuracy.learning.insightRhoWeak", {
        rho: formatSignedCorrelation(rho),
        target: String(SDS_RHO_PRACTICAL_TARGET),
      });
    }
    return null;
  })();

  const learningInsight = (() => {
    const withMae = weeklyCalibration.filter((w) => w.mae != null);
    let trend: string;
    if (withMae.length < 3) {
      trend = t("modelLab.sdsAccuracy.learning.insightNeedWeeks");
    } else {
      const first = withMae[0]!;
      const last = withMae[withMae.length - 1]!;
      const rhoFirst = weeklyCalibration.find((w) => w.rho != null)?.rho;
      const rhoLast = [...weeklyCalibration].reverse().find((w) => w.rho != null)?.rho;
      if (
        last.mae != null &&
        first.mae != null &&
        last.mae < first.mae - 0.5 &&
        rhoLast != null &&
        rhoFirst != null &&
        rhoLast > rhoFirst + 0.04
      ) {
        trend = t("modelLab.sdsAccuracy.learning.insightImproving");
      } else if (last.mae != null && first.mae != null && last.mae > first.mae + 1) {
        trend = t("modelLab.sdsAccuracy.learning.insightWorsening");
      } else {
        trend = t("modelLab.sdsAccuracy.learning.insightStable");
      }
    }
    return learningRhoNote ? `${trend} ${learningRhoNote}` : trend;
  })();

  const maeBarVal =
    kpis.mae == null ? 0 : kpis.mae < 5 ? 100 : kpis.mae < 15 ? ((15 - kpis.mae) / 10) * 100 : 0;
  const rhoBarVal = (() => {
    const rho = kpis.latestRhoNum;
    if (rho == null) return 0;
    if (rho >= SDS_RHO_PRACTICAL_TARGET) return 100;
    if (rho > 0) {
      return Math.max(0, Math.min(98, (rho / SDS_RHO_PRACTICAL_TARGET) * 100));
    }
    return 0;
  })();
  const weeksWithMae = weeklyCalibration.filter((w) => w.mae != null).length;
  const temporalVal = Math.min(
    100,
    (weeksWithMae / SDS_CONFIDENCE_TEMPORAL_WEEKS) * 100,
  );
  const loopVal = Math.min(
    100,
    (weeklyCalibration.length / SDS_CONFIDENCE_LOOP_SNAPSHOTS) * 100,
  );
  const coverageBarVal = Math.min(
    100,
    (kpis.coveragePct / SDS_CONFIDENCE_COVERAGE_TARGET_PCT) * 100,
  );

  const confidenceScore = insights.confidencePct;
  const confidenceSummary =
    insights.confidenceTier === "high"
      ? t("modelLab.sdsAccuracy.confidence.summaryHigh")
      : insights.confidenceTier === "mid"
        ? t("modelLab.sdsAccuracy.confidence.summaryMid")
        : t("modelLab.sdsAccuracy.confidence.summaryLow");
  const confidenceColor =
    insights.confidenceTier === "high"
      ? "var(--sn-long-text)"
      : insights.confidenceTier === "mid"
        ? "var(--sn-accent)"
        : "var(--sn-short-text)";

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: chartDevicePixelRatio(),
    plugins: { legend: { display: false } },
  };

  const mainPlugins = useMemo(
    () => [
      cdZonePlugin(CD_NODE_INDEX),
      ...(bestAccurateNodeIndex != null && nodeSummary.bestAccurate
        ? [
            bestAccurateNodePlugin(
              bestAccurateNodeIndex,
              nodeSummary.bestAccurate.label,
              nodeSummary.bestAccurate.mae,
              t("modelLab.sdsAccuracy.chart.bestClosest"),
            ),
          ]
        : []),
      ...(todayIdx != null ? [todayNodePlugin(todayIdx, t("modelLab.sdsAccuracy.chart.today"))] : []),
    ],
    [bestAccurateNodeIndex, nodeSummary.bestAccurate, todayIdx, t],
  );

  const learningChartOptions = useMemo(
    () => ({
      ...chartOpts,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: { datasetIndex: number; parsed: { y: number | null }; dataIndex: number }) => {
              const w = weeklyCalibration[ctx.dataIndex];
              if (!w) return "";
              if (ctx.datasetIndex === 0) {
                return w.mae != null
                  ? `${t("modelLab.sdsAccuracy.chart.mae")}: ±${w.mae}pp`
                  : "";
              }
              if (ctx.parsed.y == null) return "";
              const n = w.rhoN != null && w.rhoN >= 3 ? w.rhoN : liveRhoN;
              const { p, stars } = correlationSignificance(ctx.parsed.y, n);
              const lines = [
                `${t("modelLab.sdsAccuracy.chart.rho")}: ${formatSignedCorrelation(ctx.parsed.y)} · n=${n}`,
              ];
              if (p != null) {
                lines.push(
                  t("modelLab.sdsAccuracy.stat.pValueStars", {
                    p: formatPValue(p),
                    stars,
                  }),
                );
              } else {
                lines.push(t("modelLab.sdsAccuracy.stat.starsMeaning", { stars: "ns" }));
              }
              return lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: scaleStyle.ticks, grid: scaleStyle.grid },
        ymae: {
          type: "linear" as const,
          position: "left" as const,
          min: 0,
          title: { display: true, text: t("modelLab.sdsAccuracy.chart.maeAxis"), color: shortHex },
          ticks: { color: shortHex },
          grid: scaleStyle.grid,
        },
        yrho: {
          type: "linear" as const,
          position: "right" as const,
          min: -1,
          max: 1,
          title: {
            display: true,
            text: t("modelLab.sdsAccuracy.chart.rhoAxis"),
            color: modelHex,
            font: { size: 11, weight: "bold" as const },
          },
          ticks: { color: modelHex },
          grid: { display: false },
        },
      },
    }),
    [chartOpts, weeklyCalibration, liveRhoN, scaleStyle, shortHex, modelHex, t],
  );

  const learningPlugins = useMemo(
    () => [
      refLinePlugin(5, t("modelLab.sdsAccuracy.chart.maeTarget"), accentHex, "ymae"),
      refLinePlugin(
        SDS_RHO_PRACTICAL_TARGET,
        t("modelLab.sdsAccuracy.chart.rhoTarget", {
          r: String(SDS_RHO_PRACTICAL_TARGET),
        }),
        modelHex,
        "yrho",
      ),
      refLinePlugin(0, t("modelLab.sdsAccuracy.chart.rhoZero"), snVar("--sn-text-3", "#9b90be"), "yrho"),
      refLinePlugin(
        rhoSigThreshold,
        t("modelLab.sdsAccuracy.chart.rhoSig", { r: String(rhoSigThreshold) }),
        snVar("--sn-long-text", "#5A9A18"),
        "yrho",
      ),
    ],
    [accentHex, modelHex, rhoSigThreshold, t],
  );

  const gapHighlightLabels = useMemo(() => {
    const labels = new Set<string>();
    if (nodeSummary.bestAccurate) labels.add(nodeSummary.bestAccurate.label);
    if (nodeSummary.bestAccurateRanked) labels.add(nodeSummary.bestAccurateRanked.label);
    return labels;
  }, [nodeSummary.bestAccurate, nodeSummary.bestAccurateRanked]);

  const gapChartData = useMemo(
    () => ({
      labels: NODE_LABELS,
      datasets: [
        {
          label: t("modelLab.sdsAccuracy.gapCurve.series"),
          data: roiGapCurve.map((p) => p.signedGap),
          borderColor: shortHex,
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; height: number } }) =>
            chartGrad(ctx.chart.ctx, shortHex, 0.2, ctx.chart.height),
          fill: true,
          tension: 0.3,
          spanGaps: false,
          pointRadius: roiGapCurve.map((p) => {
            if (p.signedGap == null) return 0;
            if (gapHighlightLabels.has(p.label)) return 8;
            return 5;
          }),
          pointBackgroundColor: roiGapCurve.map((p) => {
            if (p.signedGap == null) return "transparent";
            if (p.label === nodeSummary.bestAccurate?.label) return accentHex;
            if (p.label === nodeSummary.bestAccurateRanked?.label) {
              return snVar("--sn-long-text", "#5A9A18");
            }
            return p.signedGap > 0
              ? snVar("--sn-long-text", "#5A9A18")
              : p.signedGap < 0
                ? shortHex
                : snVar("--sn-text-3", "#9b90be");
          }),
          pointBorderColor: roiGapCurve.map((p) =>
            gapHighlightLabels.has(p.label) ? "var(--sn-text)" : "var(--sn-surface-raised)",
          ),
          pointBorderWidth: roiGapCurve.map((p) => (gapHighlightLabels.has(p.label) ? 3 : 2)),
        },
      ],
    }),
    [
      roiGapCurve,
      shortHex,
      accentHex,
      gapHighlightLabels,
      nodeSummary.bestAccurate?.label,
      nodeSummary.bestAccurateRanked?.label,
      t,
    ],
  );

  const gapPlugins = useMemo(
    () => [
      cdZonePlugin(CD_NODE_INDEX),
      refLinePlugin(0, t("modelLab.sdsAccuracy.gapCurve.zeroLine"), snVar("--sn-text-3", "#9b90be")),
      ...(bestAccurateNodeIndex != null && nodeSummary.bestAccurate
        ? [
            bestAccurateNodePlugin(
              bestAccurateNodeIndex,
              nodeSummary.bestAccurate.label,
              nodeSummary.bestAccurate.mae,
              t("modelLab.sdsAccuracy.chart.bestClosest"),
            ),
          ]
        : []),
      ...(todayIdx != null ? [todayNodePlugin(todayIdx, t("modelLab.sdsAccuracy.chart.today"))] : []),
    ],
    [bestAccurateNodeIndex, nodeSummary.bestAccurate, todayIdx, t],
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <KpiCard
          label={t("modelLab.sdsAccuracy.kpi.signals")}
          value={kpis.totalSignals}
          sub={t("modelLab.sdsAccuracy.kpi.signalsSub")}
          valueColor="var(--sn-text)"
        />
        <KpiCard
          label={t("modelLab.sdsAccuracy.kpi.coverage")}
          value={`${kpis.coveragePct}%`}
          sub={t("modelLab.sdsAccuracy.kpi.coverageSub")}
          valueColor={covColor}
        />
        <KpiCard
          label={t("modelLab.sdsAccuracy.kpi.mae")}
          value={kpis.maeFmt}
          sub={t("modelLab.sdsAccuracy.kpi.maeSub")}
          valueColor={maeColor}
        />
        <KpiCard
          label={t("modelLab.sdsAccuracy.kpi.rho")}
          value={rhoKpiValue}
          sub={rhoKpiSub}
          valueColor={rhoColor}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <KpiCard
          label={t("modelLab.sdsAccuracy.kpi.minSds")}
          value={minSdsKpiValue}
          sub={minSdsKpiSub}
          valueColor={minSdsColor}
        />
        <KpiCard
          label={t("modelLab.sdsAccuracy.kpi.confidenceIndex")}
          value={`${confidenceScore}%`}
          sub={confidenceSummary}
          valueColor={confidenceColor}
        />
        <KpiCard
          label={t("modelLab.sdsAccuracy.kpi.bestNode")}
          value={insights.bestWindow?.label ?? t("modelLab.raCalibration.nd")}
          sub={bestNodeSub}
          valueColor={insights.bestWindow ? "var(--sn-accent)" : "var(--sn-text-3)"}
        />
      </div>

      <div className={sectionClass}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t("modelLab.sdsAccuracy.main.title")}</h3>
        <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "6px 0 8px" }}>
          {t("modelLab.sdsAccuracy.main.desc")}
        </p>
        <p
          style={{
            fontSize: 11,
            color: "var(--sn-text)",
            margin: "0 0 10px",
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--sn-primary-pale, rgba(107,79,200,0.08))",
            borderLeft: "3px solid var(--sn-primary, #6b4fc8)",
            lineHeight: 1.45,
          }}
        >
          {t("modelLab.sdsAccuracy.main.legendLead")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", fontSize: 11, color: "var(--sn-text-2)", marginBottom: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 0, borderTop: `2px dashed ${modelHex}` }} />
            {t("modelLab.sdsAccuracy.legend.predicted")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 3, background: actualHex, borderRadius: 2 }} />
            {t("modelLab.sdsAccuracy.legend.actual")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: `2.5px solid ${actualHex}`,
                background: "transparent",
              }}
            />
            {t("modelLab.sdsAccuracy.legend.actualPartial")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 10, background: "rgba(107,79,200,0.12)", borderRadius: 2 }} />
            {t("modelLab.sdsAccuracy.legend.range")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 10, background: "rgba(200, 146, 74, 0.15)", borderRadius: 2 }} />
            {t("modelLab.sdsAccuracy.legend.cdZone")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 0, height: 14, borderLeft: `2px dashed ${accentHex}` }} />
            {t("modelLab.sdsAccuracy.legend.today")}
          </span>
          {nodeSummary.bestAccurate && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 0, height: 14, borderLeft: `2px dashed ${actualHex}` }} />
              {t("modelLab.sdsAccuracy.legend.bestClosest")}
            </span>
          )}
        </div>
        <div style={{ height: CHART_H.main }}>
          <Line
            data={mainChartData}
            options={{
              ...chartOpts,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const agg = aggregates[ctx.dataIndex];
                      if (!agg) return "";
                      if (ctx.datasetIndex === 0) {
                        const v = agg.predictedMean;
                        return v == null
                          ? t("modelLab.sdsAccuracy.tooltip.noPrediction")
                          : t("modelLab.sdsAccuracy.tooltip.predicted", {
                              value: String(v),
                              n: String(agg.nPred),
                            });
                      }
                      if (ctx.datasetIndex === 1) {
                        if (agg.status === "no_data") {
                          return t("modelLab.sdsAccuracy.tooltip.noHistorical");
                        }
                        return t("modelLab.sdsAccuracy.tooltip.actual", {
                          value: String(agg.actualMean),
                          n: String(agg.n),
                          mae: agg.mae != null ? String(agg.mae) : "—",
                        });
                      }
                      return "";
                    },
                  },
                },
              },
              scales: {
                x: { ticks: scaleStyle.ticks, grid: scaleStyle.grid },
                y: {
                  ticks: { ...scaleStyle.ticks, callback: (v) => `${v}%` },
                  grid: scaleStyle.grid,
                },
              },
            }}
            plugins={mainPlugins}
          />
        </div>
        <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "8px 0 0" }}>
          {t("modelLab.sdsAccuracy.main.nodeStripHint")}
        </p>
        <NodeCoverageStrip
          nodes={nodeSummary.nodes}
          bestAccurateLabel={nodeSummary.bestAccurate?.label ?? null}
          densestLabel={nodeSummary.densest?.label ?? null}
        />
        <div style={{ ...insightStyle, marginTop: 10 }}>{mainInsight}</div>
        <ChartCrossLinkBridge
          bestAccurate={nodeSummary.bestAccurate}
          bestAccurateRanked={nodeSummary.bestAccurateRanked}
          roiGapCurve={roiGapCurve}
        />
      </div>

      <div className={sectionClass}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t("modelLab.sdsAccuracy.gapCurve.title")}</h3>
        <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "6px 0 8px" }}>
          {t("modelLab.sdsAccuracy.gapCurve.desc")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", fontSize: 11, color: "var(--sn-text-2)", marginBottom: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 3, background: shortHex, borderRadius: 2 }} />
            {t("modelLab.sdsAccuracy.gapCurve.legend")}
          </span>
          <span>{t("modelLab.sdsAccuracy.gapCurve.legendZero")}</span>
          {nodeSummary.bestAccurate && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: accentHex,
                  border: "2px solid var(--sn-text)",
                }}
              />
              {t("modelLab.sdsAccuracy.gapCurve.legendClosest")}
            </span>
          )}
          {nodeSummary.bestAccurateRanked &&
            nodeSummary.bestAccurateRanked.label !== nodeSummary.bestAccurate?.label && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: actualHex,
                    border: "2px solid var(--sn-text)",
                  }}
                />
                {t("modelLab.sdsAccuracy.gapCurve.legendRanked", {
                  min: String(MIN_NODE_PAIRS_FOR_RANK),
                })}
              </span>
            )}
        </div>
        <div style={{ height: CHART_H.gap }}>
          <Line
            data={gapChartData}
            options={{
              ...chartOpts,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const pt = roiGapCurve[ctx.dataIndex];
                      if (!pt || pt.signedGap == null) return "";
                      const mae = pt.absGap != null ? String(pt.absGap) : "—";
                      const lines = [
                        t("modelLab.sdsAccuracy.gapCurve.tooltip.signed", {
                          value: formatSignedPp(pt.signedGap),
                        }),
                        t("modelLab.sdsAccuracy.gapCurve.tooltip.maeLink", { mae }),
                      ];
                      if (pt.label === nodeSummary.bestAccurate?.label) {
                        lines.push(t("modelLab.sdsAccuracy.gapCurve.tooltip.closest"));
                      } else if (pt.label === nodeSummary.bestAccurateRanked?.label) {
                        lines.push(
                          t("modelLab.sdsAccuracy.gapCurve.tooltip.ranked", {
                            min: String(MIN_NODE_PAIRS_FOR_RANK),
                          }),
                        );
                      }
                      return lines;
                    },
                  },
                },
              },
              scales: {
                x: { ticks: scaleStyle.ticks, grid: scaleStyle.grid },
                y: {
                  ticks: { ...scaleStyle.ticks, callback: (v) => `${v} pp` },
                  grid: scaleStyle.grid,
                  title: {
                    display: true,
                    text: t("modelLab.sdsAccuracy.gapCurve.yAxis"),
                    color: scaleStyle.ticks.color,
                    font: { size: 10, weight: "bold" },
                  },
                },
              },
            }}
            plugins={gapPlugins}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
        <div className={sectionClass}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t("modelLab.sdsAccuracy.learning.title")}</h3>
          <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "6px 0 4px", lineHeight: 1.45 }}>
            {t("modelLab.sdsAccuracy.learning.desc")}
          </p>
          <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "0 0 2px" }}>
            {t("modelLab.sdsAccuracy.stat.legend")}
          </p>
          <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "0 0 0" }}>
            {t("modelLab.sdsAccuracy.learning.refLegend", {
              target: String(SDS_RHO_PRACTICAL_TARGET),
              r: String(rhoSigThreshold),
              n: String(liveRhoN),
            })}
          </p>
          <div style={{ height: CHART_H.learning, marginTop: 10 }}>
            <Line
              data={learningData}
              options={learningChartOptions}
              plugins={learningPlugins}
            />
          </div>
          <div style={{ ...insightStyle, marginTop: 10 }}>{learningInsight}</div>
          <SdsRhoMaeNotMeansPanel
            maeDisplay={kpis.maeFmt}
            rhoDisplay={rhoKpiValue}
          />
        </div>

        <div className={sectionClass}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t("modelLab.sdsAccuracy.confidence.title")}</h3>
          <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "6px 0 0", lineHeight: 1.45 }}>
            {t("modelLab.sdsAccuracy.confidence.intro")}
          </p>
          <div style={{ marginTop: 12 }}>
            <ProgressBar
              label={t("modelLab.sdsAccuracy.confidence.coverage")}
              target={t("modelLab.sdsAccuracy.confidence.coverageTarget", {
                pct: String(SDS_CONFIDENCE_COVERAGE_TARGET_PCT),
              })}
              value={coverageBarVal}
              display={t("modelLab.sdsAccuracy.confidence.coverageDisplay", {
                current: String(Math.round(kpis.coveragePct)),
                target: String(SDS_CONFIDENCE_COVERAGE_TARGET_PCT),
              })}
              barColor={covColor}
            />
            <ProgressBar
              label={t("modelLab.sdsAccuracy.confidence.mae")}
              target={t("modelLab.sdsAccuracy.confidence.maeTarget", {
                pp: String(SDS_CONFIDENCE_MAE_TARGET_PP),
              })}
              value={maeBarVal}
              display={t("modelLab.sdsAccuracy.confidence.maeDisplay", {
                current: kpis.maeFmt,
                target: String(SDS_CONFIDENCE_MAE_TARGET_PP),
              })}
              barColor={maeColor}
            />
            <ProgressBar
              label={t("modelLab.sdsAccuracy.confidence.rho")}
              target={t("modelLab.sdsAccuracy.confidence.rhoTarget", {
                rho: String(SDS_RHO_PRACTICAL_TARGET),
              })}
              value={rhoBarVal}
              display={t("modelLab.sdsAccuracy.confidence.rhoDisplay", {
                current: rhoKpiValue,
                target: String(SDS_RHO_PRACTICAL_TARGET),
              })}
              barColor={rhoColor}
            />
            <ProgressBar
              label={t("modelLab.sdsAccuracy.confidence.temporal")}
              target={t("modelLab.sdsAccuracy.confidence.temporalTarget", {
                weeks: String(SDS_CONFIDENCE_TEMPORAL_WEEKS),
              })}
              value={temporalVal}
              display={t("modelLab.sdsAccuracy.confidence.temporalDisplay", {
                current: String(weeksWithMae),
                target: String(SDS_CONFIDENCE_TEMPORAL_WEEKS),
              })}
              barColor={
                weeksWithMae >= SDS_CONFIDENCE_TEMPORAL_WEEKS
                  ? "var(--sn-long-text)"
                  : "var(--sn-accent)"
              }
            />
            <ProgressBar
              label={t("modelLab.sdsAccuracy.confidence.loop")}
              target={t("modelLab.sdsAccuracy.confidence.loopTarget", {
                n: String(SDS_CONFIDENCE_LOOP_SNAPSHOTS),
              })}
              value={loopVal}
              display={t("modelLab.sdsAccuracy.confidence.loopDisplay", {
                current: String(weeklyCalibration.length),
                target: String(SDS_CONFIDENCE_LOOP_SNAPSHOTS),
              })}
              barColor={
                weeklyCalibration.length >= SDS_CONFIDENCE_LOOP_SNAPSHOTS
                  ? "var(--sn-long-text)"
                  : "var(--sn-primary)"
              }
            />
          </div>
          <div
            style={{
              marginTop: 8,
              padding: "10px 14px",
              borderRadius: 8,
              background:
                confidenceScore >= 70
                  ? "var(--sn-long-bg)"
                  : confidenceScore >= 40
                    ? "var(--sn-accent-pale)"
                    : "var(--sn-short-bg)",
              color:
                confidenceScore >= 70
                  ? "var(--sn-long-text)"
                  : confidenceScore >= 40
                    ? "var(--sn-accent-dark)"
                    : "var(--sn-short-text)",
              fontSize: 12,
              fontWeight: 500,
              textAlign: "center",
            }}
          >
            {t("modelLab.sdsAccuracy.confidence.score", {
              pct: String(confidenceScore),
              summary: confidenceSummary,
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
