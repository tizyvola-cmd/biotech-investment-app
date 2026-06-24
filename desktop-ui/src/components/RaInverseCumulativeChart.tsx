import { useMemo, type CSSProperties } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SOLIDITY_COMPONENT_COLORS } from "../sheet/entrySolidityComposite";
import type { RaComponentPolarity } from "../sheet/rascoreComponentPolarity";
import { invertedComponentIds } from "../sheet/rascoreComponentPolarity";
import {
  buildRaInverseCumulativeRows,
  densifyRaInverseCumulativeRows,
  formatRaDelta2,
  formatRaScore2,
  raInverseCumulativeYMax,
  raInverseCumulativeYMin,
  type RaInverseCumulativeCurveRow,
} from "../sheet/rascoreInverseCumulative";
import type { SolidityCompositeComponentId } from "../sheet/entrySolidityComposite";
import {
  RA_INVERSE_COMPONENT_IDS,
  type RaInversePatternResult,
} from "../sheet/rascoreInversePattern";
import { useT, type TranslationKey } from "../shared/i18n";

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
} as const satisfies Record<(typeof RA_INVERSE_COMPONENT_IDS)[number], TranslationKey>;

const SHORT_LABEL_KEYS = {
  reliability: "modelLab.raCalibration.inverseCumulative.short.reliability",
  timing: "modelLab.raCalibration.inverseCumulative.short.timing",
  align: "modelLab.raCalibration.inverseCumulative.short.align",
  roi_target: "modelLab.raCalibration.inverseCumulative.short.roiTarget",
  sds: "modelLab.raCalibration.inverseCumulative.short.sds",
  precat: "modelLab.raCalibration.inverseCumulative.short.precat",
  mii: "modelLab.raCalibration.inverseCumulative.short.mii",
  calib: "modelLab.raCalibration.inverseCumulative.short.calib",
  momentum_accel: "sim.solidity.composite.momentum_accel",
} as const satisfies Record<(typeof RA_INVERSE_COMPONENT_IDS)[number], TranslationKey>;

type ChartRow = RaInverseCumulativeCurveRow & { label: string };
type Side = "up" | "down";

function CumulativeTooltip({
  active,
  payload,
  side,
  t,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  side: Side;
  t: ReturnType<typeof useT>;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  const stepKey = row.stepKey;
  if (stepKey === "start") {
    return (
      <div style={tooltipBoxStyle}>
        {t("modelLab.raCalibration.inverseCumulative.tooltipStart")}
      </div>
    );
  }

  const comp = RA_INVERSE_COMPONENT_IDS.find((id) => id === stepKey);
  const seg = comp ? row[`${side}_${comp}`] : 0;
  const total = side === "up" ? row.upTotal : row.downTotal;
  const totalColor = side === "up" ? "var(--sn-long-text)" : "var(--sn-short-text)";

  return (
    <div style={tooltipBoxStyle}>
      <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--sn-text)" }}>
        {comp ? t(COMPONENT_LABEL_KEYS[comp]) : stepKey}
      </p>
      <p style={{ margin: "0 0 4px" }}>
        {t("modelLab.raCalibration.inverseCumulative.tooltipSegment")}:{" "}
        <span style={{ color: totalColor, fontWeight: 600 }}>
          {seg >= 0 ? "+" : ""}
          {seg.toFixed(1)} pt
        </span>
      </p>
      <p style={{ margin: 0 }}>
        {t("modelLab.raCalibration.inverseCumulative.tooltipCumulative")}:{" "}
        <span style={{ color: totalColor, fontWeight: 600 }}>{total.toFixed(2)} pt</span>
      </p>
    </div>
  );
}

const tooltipBoxStyle: CSSProperties = {
  fontSize: 11,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--sn-border)",
  background: "var(--sn-surface-raised)",
  color: "var(--sn-text-2)",
  maxWidth: 220,
};

function CumulativeBandPanel({
  rows,
  knotTicks,
  side,
  title,
  totalRa,
  yMax,
  yMin,
  height,
  activeComponentIds,
  invertedIds,
  t,
}: {
  rows: ChartRow[];
  knotTicks: number[];
  side: Side;
  title: string;
  totalRa: number | null;
  yMax: number;
  yMin: number;
  height: number;
  activeComponentIds: SolidityCompositeComponentId[];
  invertedIds: SolidityCompositeComponentId[];
  t: ReturnType<typeof useT>;
}) {
  const lineColor = side === "up" ? "var(--sn-long-text, #5A9A18)" : "var(--sn-short-text, #D64040)";
  const totalKey = side === "up" ? "upTotal" : "downTotal";
  const stackId = side === "up" ? "upStack" : "downStack";
  const tickLabelByIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of rows) {
      if (Math.abs(row.stepPosition - Math.round(row.stepPosition)) < 0.01) {
        map.set(Math.round(row.stepPosition), row.label);
      }
    }
    return map;
  }, [rows]);

  return (
    <div>
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: lineColor,
          margin: "0 0 6px",
        }}
      >
        {title}
        {totalRa != null ? ` · RA ${formatRaScore2(totalRa)}` : ""}
      </p>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--sn-border)" opacity={0.45} />
            <XAxis
              dataKey="stepPosition"
              type="number"
              domain={[0, knotTicks[knotTicks.length - 1] ?? 8]}
              ticks={knotTicks}
              tick={{ fontSize: 8, fill: "var(--sn-text-3)" }}
              interval={0}
              angle={-32}
              textAnchor="end"
              height={48}
              tickFormatter={(v: number) => tickLabelByIndex.get(Math.round(v)) ?? ""}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fontSize: 8, fill: "var(--sn-text-3)" }}
              width={28}
            />
            <Tooltip content={<CumulativeTooltip side={side} t={t} />} />
            {RA_INVERSE_COMPONENT_IDS.filter((id) => activeComponentIds.includes(id)).map((id) => {
              const inverted = invertedIds.includes(id);
              return (
              <Area
                key={`${side}-${id}`}
                type="monotone"
                dataKey={`${side}_${id}`}
                stackId={stackId}
                stroke={SOLIDITY_COMPONENT_COLORS[id]}
                fill={SOLIDITY_COMPONENT_COLORS[id]}
                fillOpacity={inverted ? 0.42 : side === "up" ? 0.82 : 0.68}
                strokeWidth={inverted ? 1 : 0}
                strokeDasharray={inverted ? "4 2" : undefined}
                isAnimationActive={false}
              />
            );
            })}
            <Line
              type="monotone"
              dataKey={totalKey}
              stroke={lineColor}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function RaInverseCumulativeChart({
  pattern,
  polarities,
  panelHeight = 200,
}: {
  pattern: RaInversePatternResult;
  /** When set, bands use price-aligned points (inverted where ρ<0). */
  polarities?: RaComponentPolarity[];
  panelHeight?: number;
}) {
  const t = useT();
  const useAligned = Boolean(polarities?.some((p) => p.reliable));
  const invertedIds = useAligned ? invertedComponentIds(polarities ?? []) : [];

  const { chartRows, knotTicks, yMax, yMin, alignedUpTotal, alignedDownTotal } = useMemo(() => {
    const knots = buildRaInverseCumulativeRows(pattern, useAligned ? polarities : undefined);
    const last = knots[knots.length - 1];
    const knotLabels: ChartRow[] = knots.map((row) => ({
      ...row,
      stepPosition: row.stepIndex,
      label:
        row.stepKey === "start"
          ? t("modelLab.raCalibration.inverseCumulative.axisStart")
          : t(SHORT_LABEL_KEYS[row.stepKey]),
    }));
    const labelByIndex = new Map(knotLabels.map((r) => [r.stepIndex, r.label]));
    const dense = densifyRaInverseCumulativeRows(knots).map((row) => ({
      ...row,
      label:
        labelByIndex.get(Math.round(row.stepPosition)) ??
        (row.stepKey === "start"
          ? t("modelLab.raCalibration.inverseCumulative.axisStart")
          : t(SHORT_LABEL_KEYS[row.stepKey as keyof typeof SHORT_LABEL_KEYS])),
    }));
    return {
      chartRows: dense,
      knotTicks: knots.map((r) => r.stepIndex),
      yMax: raInverseCumulativeYMax(knots),
      yMin: useAligned ? raInverseCumulativeYMin(knots) : 0,
      alignedUpTotal: last?.upTotal ?? null,
      alignedDownTotal: last?.downTotal ?? null,
    };
  }, [pattern, polarities, useAligned, t]);

  const delta =
    pattern.upMeanRa != null && pattern.downMeanRa != null
      ? pattern.upMeanRa - pattern.downMeanRa
      : null;
  const alignedDelta =
    alignedUpTotal != null && alignedDownTotal != null
      ? alignedUpTotal - alignedDownTotal
      : null;

  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--sn-text)", margin: "0 0 4px" }}>
        {t("modelLab.raCalibration.inverseCumulative.title")}
      </p>
      <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "0 0 10px", lineHeight: 1.45 }}>
        {pattern.scoreMode === "curve_only"
          ? t("modelLab.raCalibration.inverseCumulative.descCurveOnly", {
              anchor: pattern.offsetLabel,
              upN: String(pattern.upN),
              downN: String(pattern.downN),
              delta: formatRaDelta2(delta),
            })
          : t("modelLab.raCalibration.inverseCumulative.desc", {
              anchor: pattern.offsetLabel,
              upN: String(pattern.upN),
              downN: String(pattern.downN),
              delta: formatRaDelta2(delta),
            })}
      </p>
      {useAligned ? (
        <p style={{ fontSize: 10, color: "var(--sn-primary)", margin: "0 0 8px", lineHeight: 1.45 }}>
          {t("modelLab.raCalibration.inverseCumulative.alignedBanner", {
            up: formatRaScore2(alignedUpTotal),
            down: formatRaScore2(alignedDownTotal),
            delta: formatRaDelta2(alignedDelta),
            inverted: String(invertedIds.length),
          })}
        </p>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          alignItems: "start",
        }}
      >
        <CumulativeBandPanel
          rows={chartRows}
          knotTicks={knotTicks}
          side="up"
          title={
            useAligned
              ? t("modelLab.raCalibration.inverseCumulative.panelTitleUp")
              : t("modelLab.raCalibration.inverse.colUp")
          }
          totalRa={useAligned ? alignedUpTotal : pattern.upMeanRa}
          yMax={yMax}
          yMin={yMin}
          height={panelHeight}
          activeComponentIds={pattern.activeComponentIds}
          invertedIds={invertedIds}
          t={t}
        />
        <CumulativeBandPanel
          rows={chartRows}
          knotTicks={knotTicks}
          side="down"
          title={
            useAligned
              ? t("modelLab.raCalibration.inverseCumulative.panelTitleDown")
              : t("modelLab.raCalibration.inverse.colDown")
          }
          totalRa={useAligned ? alignedDownTotal : pattern.downMeanRa}
          yMax={yMax}
          yMin={yMin}
          height={panelHeight}
          activeComponentIds={pattern.activeComponentIds}
          invertedIds={invertedIds}
          t={t}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 10px",
          marginTop: 10,
          fontSize: 9,
          color: "var(--sn-text-2)",
        }}
      >
        {pattern.activeComponentIds.map((id) => (
          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: SOLIDITY_COMPONENT_COLORS[id],
                flexShrink: 0,
              }}
            />
            {t(COMPONENT_LABEL_KEYS[id])}
          </span>
        ))}
      </div>
      <p style={{ fontSize: 9, color: "var(--sn-text-3)", margin: "8px 0 0", lineHeight: 1.45 }}>
        {t("modelLab.raCalibration.inverseCumulative.footnote")}
        {useAligned ? ` ${t("modelLab.raCalibration.inverseCumulative.alignedFootnote")}` : ""}
      </p>
    </div>
  );
}
