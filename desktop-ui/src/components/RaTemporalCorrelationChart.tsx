import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  classifyPearsonR,
  EIS_CORRELATION_STRENGTH_COLORS,
} from "../sheet/eisCorrelationVisual";
import { SOLIDITY_COMPONENT_COLORS } from "../sheet/entrySolidityComposite";
import type { RaComponentPriceDirection } from "../sheet/rascoreComponentPolarity";
import type { SolidityCompositeComponentId } from "../sheet/entrySolidityComposite";
import { RA_INVERSE_COMPONENT_IDS } from "../sheet/rascoreInversePattern";
import type {
  RaTemporalCorrelationResult,
  RaTemporalMetricId,
} from "../sheet/rascoreTemporalCorrelation";
import { RA_CALIB_MIN_SAMPLE_N } from "../sheet/rascoreCalibrationCompute";
import {
  formatCorrelationWithStars,
  formatPValueWithStars,
} from "../sheet/statSignificance";
import { useT, type TranslationKey } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

const COMPONENT_LABEL_KEYS = {
  reliability: "sim.solidity.composite.reliability",
  timing: "sim.solidity.composite.timing",
  align: "sim.solidity.composite.align",
  roi_target: "sim.solidity.composite.roiTarget",
  sds: "sim.solidity.composite.sds",
  precat: "sim.solidity.composite.precat",
  mii: "sim.solidity.composite.mii",
  calib: "sim.solidity.composite.calib",
  momentum_accel: "sim.solidity.composite.momentum_accel",
} as const satisfies Record<
  (typeof RA_INVERSE_COMPONENT_IDS)[number],
  TranslationKey
>;

function metricLabel(
  t: (k: TranslationKey, vars?: Record<string, string>) => string,
  id: RaTemporalMetricId,
): string {
  if (id === "full_ra") return t("modelLab.raCalibration.temporalCorr.legendFullRa");
  if (id === "normalized_ra") return t("modelLab.raCalibration.temporalCorr.legendNormalizedRa");
  return t(COMPONENT_LABEL_KEYS[id]);
}

function metricColor(id: RaTemporalMetricId): string {
  if (id === "full_ra") return "var(--sn-text-3)";
  if (id === "normalized_ra") return "var(--sn-primary)";
  return SOLIDITY_COMPONENT_COLORS[id];
}

function directionLabel(
  t: (k: TranslationKey) => string,
  direction: RaComponentPriceDirection,
): string {
  switch (direction) {
    case "positive":
      return t("modelLab.raCalibration.polarity.positive");
    case "negative":
      return t("modelLab.raCalibration.polarity.negative");
    case "neutral":
      return t("modelLab.raCalibration.polarity.neutral");
    default:
      return t("modelLab.raCalibration.polarity.unknown");
  }
}

type RaTemporalCorrelationChartProps = {
  analysis: RaTemporalCorrelationResult;
  hasComponentData: boolean;
};

export function RaTemporalCorrelationChart({
  analysis,
  hasComponentData,
}: RaTemporalCorrelationChartProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const [showComponents, setShowComponents] = useState(true);
  const [showNormalized, setShowNormalized] = useState(true);
  const [showAlignedRho, setShowAlignedRho] = useState(true);

  const fullRa = analysis.fullRaSeries;
  const normalizedRa = analysis.normalizedFullRaSeries;
  const peakNorm = analysis.peakPreCdNormalized;
  const polarities = analysis.componentPolarities;
  const invertedN = polarities.filter((p) => p.invertForPrice).length;
  const hasPooledData =
    analysis.pooledRho.some((p) => p.rho != null && p.n >= 3) ||
    polarities.some((p) => p.rho != null && p.n >= 3);
  const hasTimelineRho = analysis.timelineAnchorRhoCount > 0;
  const hasData = hasPooledData || hasTimelineRho;

  const polarityById = useMemo(
    () => new Map(polarities.map((p) => [p.id, p])),
    [polarities],
  );

  const isComponentMetric = (id: RaTemporalMetricId): id is SolidityCompositeComponentId =>
    (RA_INVERSE_COMPONENT_IDS as readonly string[]).includes(id);

  const pooledBarData = useMemo(() => {
    const ids: RaTemporalMetricId[] = showComponents
      ? ["full_ra", ...(showNormalized && hasComponentData ? (["normalized_ra"] as const) : []), ...RA_INVERSE_COMPONENT_IDS]
      : ["full_ra", ...(showNormalized && hasComponentData ? (["normalized_ra"] as const) : [])];
    return analysis.pooledRho
      .filter((p) => ids.includes(p.metricId) && p.rho != null)
      .map((p) => {
        const pol = isComponentMetric(p.metricId) ? polarityById.get(p.metricId) : undefined;
        const rawRho = p.rho as number;
        const useAligned = showAlignedRho && pol?.rhoPriceAligned != null;
        const displayRho = useAligned ? pol!.rhoPriceAligned! : rawRho;
        return {
          id: p.metricId,
          label: metricLabel(t, p.metricId),
          rho: displayRho,
          rawRho,
          n: p.n,
          inverted: pol?.invertForPrice ?? false,
          fill: metricColor(p.metricId),
        };
      });
  }, [analysis.pooledRho, showComponents, showNormalized, showAlignedRho, hasComponentData, polarityById, t]);

  const chartData = useMemo(
    () =>
      analysis.chartRows.map((row) => {
        const base: Record<string, number | string | null> = {
          ...row,
          label: String(row.offsetLabel),
        };
        if (showAlignedRho && hasComponentData) {
          for (const id of RA_INVERSE_COMPONENT_IDS) {
            const pol = polarityById.get(id);
            const rho = row[id];
            if (pol?.invertForPrice && typeof rho === "number" && Number.isFinite(rho)) {
              base[id] = -rho;
            }
          }
        }
        return base;
      }),
    [analysis.chartRows, showAlignedRho, hasComponentData, polarityById],
  );

  const peak = analysis.peakPreCd;

  if (!hasData) {
    return (
      <div className="sn-chart-section">
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
          {t("modelLab.raCalibration.temporalCorr.title")}
        </h3>
        <p style={{ fontSize: 11, color: "var(--sn-text-3)", margin: "8px 0 0" }}>
          {t("modelLab.raCalibration.temporalCorr.empty")}
        </p>
      </div>
    );
  }

  return (
    <ViewErrorBoundary label={t("modelLab.raCalibration.temporalCorr.title")}>
      <div className="sn-chart-section">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
              {t("modelLab.raCalibration.temporalCorr.title")}
            </h3>
            <p style={{ fontSize: 11, color: "var(--sn-text-2)", margin: "6px 0 0", maxWidth: 720 }}>
              {t("modelLab.raCalibration.temporalCorr.desc")}
            </p>
            <p
              style={{
                fontSize: 10,
                color: "var(--sn-long-text)",
                margin: "8px 0 0",
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--sn-long-bg)",
                maxWidth: 720,
                lineHeight: 1.4,
              }}
            >
              {t("modelLab.raCalibration.temporalCorr.harmonizationBanner")}
            </p>
          </div>
          <button
            type="button"
            className="text-[10px] text-ink-muted hover:text-ink shrink-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? t("modelLab.raCalibration.temporalCorr.collapse")
              : t("modelLab.raCalibration.temporalCorr.expand")}
          </button>
        </div>

        {peakNorm && hasComponentData ? (
          <p
            style={{
              fontSize: 10,
              color: "var(--sn-long-text)",
              margin: "10px 0 0",
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--sn-long-bg)",
            }}
          >
            {t("modelLab.raCalibration.temporalCorr.peakEntryRaInsight", {
              anchor: peakNorm.offsetLabel,
              rho: formatCorrelationWithStars(peakNorm.rho, peakNorm.n),
              n: String(peakNorm.n),
              p: formatPValueWithStars(peakNorm.pValue),
            })}
          </p>
        ) : null}
        {peak ? (
          <p
            style={{
              fontSize: 10,
              color: peakNorm && hasComponentData ? "var(--sn-text-3)" : "var(--sn-primary)",
              margin: "8px 0 0",
              padding: "8px 10px",
              borderRadius: 8,
              background:
                peakNorm && hasComponentData ? "var(--sn-surface-raised)" : "var(--sn-primary-pale)",
            }}
          >
            {peakNorm && hasComponentData
              ? t("modelLab.raCalibration.temporalCorr.peakRawRaInsight", {
                  anchor: peak.offsetLabel,
                  rho: formatCorrelationWithStars(peak.rho, peak.n),
                })
              : t("modelLab.raCalibration.temporalCorr.peakInsight", {
                  anchor: peak.offsetLabel,
                  rho: formatCorrelationWithStars(peak.rho, peak.n),
                  n: String(peak.n),
                  p: formatPValueWithStars(peak.pValue),
                })}
            {peakNorm && hasComponentData ? (
              <>
                {" "}
                {t("modelLab.raCalibration.temporalCorr.peakNormalizedInsight", {
                  anchor: peakNorm.offsetLabel,
                  rho: formatCorrelationWithStars(peakNorm.rho, peakNorm.n),
                  inverted: String(invertedN),
                })}
              </>
            ) : null}
          </p>
        ) : (
          <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "8px 0 0" }}>
            {t("modelLab.raCalibration.temporalCorr.peakNone", {
              minN: String(RA_CALIB_MIN_SAMPLE_N),
            })}
          </p>
        )}

        {!hasComponentData ? (
          <p style={{ fontSize: 10, color: "var(--sn-accent)", margin: "8px 0 0" }}>
            {t("modelLab.raCalibration.temporalCorr.componentsFallback")}
          </p>
        ) : null}

        {expanded ? (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                margin: "10px 0",
                alignItems: "center",
              }}
            >
              {hasComponentData ? (
                <>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10,
                      color: "var(--sn-text-2)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showAlignedRho}
                      onChange={(e) => setShowAlignedRho(e.target.checked)}
                    />
                    {t("modelLab.raCalibration.temporalCorr.toggleAlignedRho")}
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10,
                      color: "var(--sn-text-2)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showNormalized}
                      onChange={(e) => setShowNormalized(e.target.checked)}
                    />
                    {t("modelLab.raCalibration.temporalCorr.toggleNormalized")}
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10,
                      color: "var(--sn-text-2)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showComponents}
                      onChange={(e) => setShowComponents(e.target.checked)}
                    />
                    {t("modelLab.raCalibration.temporalCorr.toggleComponents")}
                  </label>
                </>
              ) : null}
            </div>

            {hasComponentData && polarities.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 600, margin: "0 0 6px" }}>
                  {t("modelLab.raCalibration.polarity.title")}
                </p>
                <p style={{ fontSize: 9, color: "var(--sn-text-3)", margin: "0 0 8px" }}>
                  {t("modelLab.raCalibration.polarity.desc")}
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                    <thead>
                      <tr style={{ color: "var(--sn-text-3)", textAlign: "left" }}>
                        <th style={{ padding: "4px 8px" }}>
                          {t("modelLab.raCalibration.polarity.colIndex")}
                        </th>
                        <th style={{ padding: "4px 8px" }}>
                          {t("modelLab.raCalibration.polarity.colRhoRaw")}
                        </th>
                        <th style={{ padding: "4px 8px" }}>
                          {t("modelLab.raCalibration.polarity.colRhoAligned")}
                        </th>
                        <th style={{ padding: "4px 8px" }}>
                          {t("modelLab.raCalibration.polarity.colSign")}
                        </th>
                        <th style={{ padding: "4px 8px" }}>
                          {t("modelLab.raCalibration.polarity.colAction")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {polarities.map((p) => {
                        const tier = classifyPearsonR(p.rho);
                        const rhoColor = EIS_CORRELATION_STRENGTH_COLORS[tier];
                        const alignedTier = classifyPearsonR(p.rhoPriceAligned);
                        const alignedColor = EIS_CORRELATION_STRENGTH_COLORS[alignedTier];
                        return (
                          <tr
                            key={p.id}
                            style={{ borderTop: "1px solid var(--sn-border)" }}
                          >
                            <td style={{ padding: "6px 8px", color: metricColor(p.id) }}>
                              {metricLabel(t, p.id)}
                            </td>
                            <td
                              style={{
                                padding: "6px 8px",
                                fontVariantNumeric: "tabular-nums",
                                color: rhoColor,
                              }}
                            >
                              {p.rho != null
                                ? `${formatCorrelationWithStars(p.rho, p.n)} · n=${p.n}`
                                : "n/d"}
                            </td>
                            <td
                              style={{
                                padding: "6px 8px",
                                fontVariantNumeric: "tabular-nums",
                                color: alignedColor,
                              }}
                              title={
                                p.invertForPrice
                                  ? "100% − fill% then ρ recalculated"
                                  : undefined
                              }
                            >
                              {p.rhoPriceAligned != null
                                ? `${formatCorrelationWithStars(p.rhoPriceAligned, p.n)}${p.invertForPrice ? " · −ρ" : ""}`
                                : "n/d"}
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              {directionLabel(t, p.direction)}
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              {p.invertForPrice
                                ? t("modelLab.raCalibration.polarity.actionInvert")
                                : t("modelLab.raCalibration.polarity.actionKeep")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {pooledBarData.length > 0 ? (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 10, fontWeight: 600, margin: "0 0 4px" }}>
                  {showAlignedRho
                    ? t("modelLab.raCalibration.temporalCorr.pooledBarsAlignedTitle", {
                        pairs: String(analysis.totalObservations),
                      })
                    : t("modelLab.raCalibration.temporalCorr.pooledBarsTitle", {
                        pairs: String(analysis.totalObservations),
                      })}
                </p>
                <p style={{ fontSize: 9, color: "var(--sn-text-3)", margin: "0 0 4px" }}>
                  {t("modelLab.raCalibration.temporalCorr.pooledBarsCohort", {
                    simRows: String(analysis.cohortStats.simRows),
                    eligible: String(analysis.cohortStats.eligibleTickers),
                    chart: String(analysis.cohortStats.withChartSeries),
                    tickers: String(analysis.cohortStats.tickersWithPairs),
                  })}
                </p>
                <p style={{ fontSize: 9, color: "var(--sn-text-3)", margin: "0 0 6px", lineHeight: 1.35 }}>
                  {t("modelLab.raCalibration.temporalCorr.pooledBarsNote")}
                </p>
                <div style={{ width: "100%", height: Math.max(160, pooledBarData.length * 22) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={pooledBarData}
                      layout="vertical"
                      margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--sn-border)" opacity={0.4} />
                      <XAxis
                        type="number"
                        domain={[-1, 1]}
                        tick={{ fontSize: 9, fill: "var(--sn-text-2)" }}
                        tickFormatter={(v) => Number(v).toFixed(1)}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={118}
                        tick={{ fontSize: 9, fill: "var(--sn-text-2)" }}
                      />
                      <ReferenceLine x={0} stroke="var(--sn-border)" />
                      <Tooltip
                        formatter={(_value: number, _name, item) => {
                          const row = item.payload as (typeof pooledBarData)[number];
                          const main = `${formatCorrelationWithStars(row.rho, row.n)} · n=${row.n}`;
                          if (row.inverted && row.rawRho !== row.rho) {
                            return [
                              `${main} (raw ${formatCorrelationWithStars(row.rawRho, row.n)})`,
                              row.label,
                            ];
                          }
                          return [main, row.label];
                        }}
                      />
                      <Bar dataKey="rho" radius={[0, 3, 3, 0]} barSize={14}>
                        {pooledBarData.map((entry) => (
                          <Cell key={entry.id} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}

            <p style={{ fontSize: 10, fontWeight: 600, margin: "0 0 6px" }}>
              {t("modelLab.raCalibration.temporalCorr.timelineTitle")}
            </p>
            {!hasTimelineRho ? (
              <p style={{ fontSize: 9, color: "var(--sn-accent)", margin: "0 0 8px" }}>
                {t("modelLab.raCalibration.temporalCorr.timelineSparse", {
                  total: String(analysis.totalObservations),
                })}
              </p>
            ) : null}

            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--sn-border)" opacity={0.5} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 8, fill: "var(--sn-text-2)" }}
                    axisLine={{ stroke: "var(--sn-border)" }}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={52}
                  />
                  <YAxis
                    domain={[-1, 1]}
                    tick={{ fontSize: 10, fill: "var(--sn-text-2)" }}
                    axisLine={{ stroke: "var(--sn-border)" }}
                    tickFormatter={(v) => Number(v).toFixed(1)}
                    label={{
                      value: t("modelLab.raCalibration.temporalCorr.yAxis"),
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "var(--sn-text-3)" },
                    }}
                  />
                  <ReferenceLine y={0} stroke="var(--sn-border)" strokeDasharray="4 4" />
                  {peak ? (
                    <ReferenceLine
                      x={peak.offsetLabel}
                      stroke="var(--sn-accent)"
                      strokeDasharray="5 3"
                      strokeWidth={1.5}
                    />
                  ) : null}
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const offsetRow = fullRa?.anchors.find((a) => a.offsetLabel === label);
                      return (
                        <div
                          className="rounded border bg-surface-raised px-2 py-1.5 text-[10px] shadow-sm tabular-nums"
                          style={{ borderColor: "var(--sn-border)" }}
                        >
                          <p className="font-semibold mb-1">{label}</p>
                          {payload.map((p) => {
                            const id = String(p.dataKey) as RaTemporalMetricId;
                            const anchor = analysis.series
                              .find((s) => s.metricId === id)
                              ?.anchors.find((a) => a.offsetLabel === label);
                            if (!anchor) return null;
                            return (
                              <p key={id} style={{ color: p.color }}>
                                {metricLabel(t, id)}:{" "}
                                {anchor.rho != null
                                  ? formatCorrelationWithStars(anchor.rho, anchor.nUsed)
                                  : "n/d"}{" "}
                                · n={anchor.n}
                                {anchor.nUsed !== anchor.n ? ` (${anchor.nUsed} pooled)` : ""}
                                {anchor.windowPooled
                                  ? ` · ${t("modelLab.raCalibration.temporalCorr.tooltipWindowPooled")}`
                                  : ""}
                                {anchor.reliable ? "" : ` · <${RA_CALIB_MIN_SAMPLE_N}`}
                              </p>
                            );
                          })}
                          {offsetRow ? (
                            <p className="text-ink-muted mt-1">
                              {t("modelLab.raCalibration.temporalCorr.tooltipPreCd", {
                                pre: offsetRow.isPreCd
                                  ? t("modelLab.raCalibration.temporalCorr.preCdYes")
                                  : t("modelLab.raCalibration.temporalCorr.preCdNo"),
                              })}
                            </p>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="full_ra"
                    name={metricLabel(t, "full_ra")}
                    stroke={metricColor("full_ra")}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    strokeOpacity={0.65}
                    dot={{ r: 2.5, fill: metricColor("full_ra") }}
                    connectNulls
                  />
                  {showNormalized && hasComponentData && normalizedRa ? (
                    <Line
                      type="monotone"
                      dataKey="normalized_ra"
                      name={metricLabel(t, "normalized_ra")}
                      stroke={metricColor("normalized_ra")}
                      strokeWidth={3}
                      dot={{ r: 4, fill: metricColor("normalized_ra") }}
                      connectNulls
                    />
                  ) : null}
                  {showComponents && hasComponentData
                    ? RA_INVERSE_COMPONENT_IDS.map((id) => (
                        <Line
                          key={id}
                          type="monotone"
                          dataKey={id}
                          name={metricLabel(t, id)}
                          stroke={metricColor(id)}
                          strokeWidth={1.5}
                          strokeOpacity={0.85}
                          dot={{ r: 2.5, fill: metricColor(id) }}
                          connectNulls
                        />
                      ))
                    : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 8 }}>
              {showNormalized && hasComponentData ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    color: metricColor("normalized_ra"),
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 3,
                      borderRadius: 2,
                      background: metricColor("normalized_ra"),
                    }}
                  />
                  {metricLabel(t, "normalized_ra")}
                </span>
              ) : null}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10,
                  fontWeight: 600,
                  color: metricColor("full_ra"),
                  opacity: 0.85,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 0,
                    borderTop: `2px dashed ${metricColor("full_ra")}`,
                  }}
                />
                {metricLabel(t, "full_ra")}
              </span>
              {showNormalized && hasComponentData ? null : (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    color: metricColor("normalized_ra"),
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 0,
                      borderTop: `3px dashed ${metricColor("normalized_ra")}`,
                    }}
                  />
                  {metricLabel(t, "normalized_ra")}
                </span>
              )}
              {showComponents && hasComponentData
                ? RA_INVERSE_COMPONENT_IDS.map((id) => {
                    const series = analysis.series.find((s) => s.metricId === id);
                    const isSnap = series?.isSnapshot;
                    return (
                      <span
                        key={id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 9,
                          color: metricColor(id),
                          opacity: isSnap ? 0.75 : 1,
                        }}
                        title={
                          isSnap
                            ? t("modelLab.raCalibration.temporalCorr.snapshotHint")
                            : undefined
                        }
                      >
                        <span
                          style={{
                            width: 14,
                            height: 2,
                            borderRadius: 2,
                            background: metricColor(id),
                          }}
                        />
                        {metricLabel(t, id)}
                        {isSnap ? " †" : ""}
                      </span>
                    );
                  })
                : null}
            </div>

            <p style={{ fontSize: 9, color: "var(--sn-text-3)", margin: "8px 0 0" }}>
              {t("modelLab.raCalibration.temporalCorr.footnote")}
            </p>

            {Object.keys(analysis.bucketCounts).length > 0 ? (
              <p style={{ fontSize: 9, color: "var(--sn-text-2)", margin: "6px 0 0" }}>
                {t("modelLab.raCalibration.temporalCorr.bucketCounts")}{" "}
                {analysis.fullRaSeries?.anchors
                  .filter((a) => (analysis.bucketCounts[a.offset] ?? 0) > 0)
                  .map((a) => `${a.offsetLabel} (${analysis.bucketCounts[a.offset]})`)
                  .join(" · ")}
              </p>
            ) : null}

            {fullRa ? (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 600, margin: "0 0 6px" }}>
                  {t("modelLab.raCalibration.scatter.rhoRowTitle")}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {fullRa.anchors.map((a) => {
                    const tier = classifyPearsonR(a.rho);
                    const color =
                      a.rho != null
                        ? EIS_CORRELATION_STRENGTH_COLORS[tier]
                        : "var(--sn-text-3)";
                    return (
                      <span
                        key={a.offset}
                        style={{
                          fontSize: 9,
                          padding: "3px 8px",
                          borderRadius: 999,
                          border: `1px solid ${a.offset === peak?.offset ? "var(--sn-accent)" : "var(--sn-border)"}`,
                          background:
                            a.offset === peak?.offset ? "var(--sn-watch-bg)" : "var(--sn-surface-raised)",
                          color,
                          fontVariantNumeric: "tabular-nums",
                        }}
                        title={t("modelLab.raCalibration.scatter.rhoChipHint", {
                          n: String(a.n),
                          pct:
                            a.rho != null
                              ? formatCorrelationWithStars(a.rho, a.n)
                              : t("modelLab.raCalibration.scatter.rhoChipNa"),
                        })}
                      >
                        {a.offsetLabel}{" "}
                        {a.rho != null ? formatCorrelationWithStars(a.rho, a.n) : "n/d"}
                        {a.reliable ? "" : ` (n=${a.n})`}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        ) : peak ? (
          <p className="text-[10px] text-ink-muted mt-2 tabular-nums">
            {peak.offsetLabel} · ρ {formatCorrelationWithStars(peak.rho, peak.n)} · n={peak.n}
          </p>
        ) : null}
      </div>
    </ViewErrorBoundary>
  );
}
