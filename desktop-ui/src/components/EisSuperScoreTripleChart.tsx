import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useT } from "../shared/i18n";
import {
  EIS_SUPER_MIN_N,
  type EisSuperScoreChartRow,
} from "../sheet/eisSuperScoreLearningView";

const SYNC_ID = "eisSuperCdDist";
const MARGIN_LEFT = 44;
const Y_LABEL_OFFSET = 4;
const MARGIN_RIGHT = 14;

const CHART_MARGIN_TOP = { top: 6, right: MARGIN_RIGHT, left: MARGIN_LEFT, bottom: 0 };
const CHART_MARGIN_BOTTOM = { top: 12, right: MARGIN_RIGHT, left: MARGIN_LEFT, bottom: 26 };

function fmtRho(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function axisTickStyle() {
  return { fontSize: 9, fill: "rgb(var(--ink-muted))" };
}

function SuperRhoDot({
  cx,
  cy,
  payload,
  horizon,
}: {
  cx?: number;
  cy?: number;
  payload?: EisSuperScoreChartRow;
  horizon: "7d" | "1d";
}) {
  if (cx == null || cy == null || !payload) return null;
  const rho = horizon === "7d" ? payload.corrSuper7d : payload.corrSuper1d;
  const gated = horizon === "7d" ? payload.nGated : payload.nGated1d;
  if (rho == null) return null;
  if (gated) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="none"
        stroke="rgb(var(--signal-down))"
        strokeWidth={1.5}
        opacity={0.85}
      />
    );
  }
  return <circle cx={cx} cy={cy} r={3} fill="rgb(var(--signal-up))" stroke="rgb(var(--signal-up))" />;
}

function NBarCell({ x, y, width, height, payload }: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: EisSuperScoreChartRow;
}) {
  if (x == null || y == null || width == null || height == null || !payload) return null;
  const low = payload.nGated;
  const fill = low ? "rgb(var(--signal-down) / 0.55)" : "rgb(var(--ink-muted) / 0.35)";
  return <rect x={x} y={y} width={width} height={height} fill={fill} rx={2} />;
}

export function EisSuperScoreTripleChart({ rows }: { rows: EisSuperScoreChartRow[] }) {
  const t = useT();

  const data = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        lift7dBar: r.lift7d,
        lift1dBar: r.lift1d,
      })),
    [rows],
  );

  const xMax = useMemo(() => Math.max(...rows.map((r) => r.daysMid), 1), [rows]);

  const sharedX = (showLabel: boolean) => (
    <XAxis
      dataKey="daysMid"
      type="number"
      reversed
      domain={[0, xMax]}
      tick={axisTickStyle()}
      tickLine={false}
      axisLine={{ stroke: "rgb(var(--border))", strokeOpacity: 0.5 }}
      label={
        showLabel
          ? {
              value: t("learningLab.eisSuper.xAxis"),
              position: "insideBottom",
              offset: -14,
              style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
            }
          : undefined
      }
    />
  );

  const tooltipRho = (
    <Tooltip
      formatter={(v: number) => fmtRho(v)}
      labelFormatter={(_, payload) => {
        const row = payload?.[0]?.payload as EisSuperScoreChartRow | undefined;
        if (!row) return "";
        return `${row.window} · ${row.daysLabel} · n₇=${row.nPrice7d} · n₁=${row.nPrice1d}`;
      }}
      contentStyle={{
        fontSize: 10,
        borderRadius: 8,
        border: "1px solid rgb(var(--border))",
        background: "rgb(var(--surface))",
      }}
    />
  );

  return (
    <div className="space-y-0 w-full">
      {/* Panel 1 — ρ (super) */}
      <div className="space-y-0.5">
        <div>
          <p className="text-[11px] font-semibold text-ink">{t("learningLab.eisSuper.panel1Title")}</p>
          <p className="text-[9px] text-ink-muted">{t("learningLab.eisSuper.panel1Subtitle")}</p>
        </div>
        <div style={{ height: 148 }} className="w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={CHART_MARGIN_TOP} syncId={SYNC_ID}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" strokeOpacity={0.35} vertical={false} />
              {sharedX(false)}
              <YAxis
                tick={axisTickStyle()}
                domain={[-0.2, 1]}
                tickLine={false}
                axisLine={false}
                width={MARGIN_LEFT}
                label={{
                  value: "ρ",
                  angle: -90,
                  position: "insideLeft",
                  offset: Y_LABEL_OFFSET,
                  style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
                }}
              />
              <ReferenceLine y={0} stroke="rgb(var(--border))" strokeDasharray="2 2" />
              <ReferenceLine
                x={0}
                stroke="rgb(var(--signal-up))"
                strokeDasharray="4 3"
                label={{ value: "CD", fontSize: 8, fill: "rgb(var(--signal-up))" }}
              />
              <Area
                type="monotone"
                dataKey="super7dCiHigh"
                stroke="none"
                fill="rgb(var(--signal-up))"
                fillOpacity={0.12}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="super7dCiLow"
                stroke="none"
                fill="rgb(var(--surface))"
                fillOpacity={1}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="corrSuper7dGated"
                name={t("learningLab.eisSuper.lineSuper7d")}
                stroke="rgb(var(--signal-up))"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="corrSuper7d"
                stroke="none"
                dot={<SuperRhoDot horizon="7d" />}
                connectNulls={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="corrSuper1dGated"
                name={t("learningLab.eisSuper.lineSuper1d")}
                stroke="rgb(var(--ink-muted))"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="corrSuper1d"
                stroke="none"
                dot={<SuperRhoDot horizon="1d" />}
                connectNulls={false}
                isAnimationActive={false}
                legendType="none"
              />
              {tooltipRho}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Panel 2 — Δρ */}
      <div className="space-y-0.5 border-t border-[rgb(var(--border))]/40 pt-2">
        <div>
          <p className="text-[11px] font-semibold text-ink">{t("learningLab.eisSuper.panel2Title")}</p>
          <p className="text-[9px] text-ink-muted">{t("learningLab.eisSuper.panel2Subtitle")}</p>
        </div>
        <div style={{ height: 108 }} className="w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={CHART_MARGIN_TOP} syncId={SYNC_ID} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" strokeOpacity={0.35} vertical={false} />
              {sharedX(false)}
              <YAxis
                tick={axisTickStyle()}
                domain={[-0.6, 0.6]}
                tickLine={false}
                axisLine={false}
                width={MARGIN_LEFT}
                label={{
                  value: "Δρ",
                  angle: -90,
                  position: "insideLeft",
                  offset: Y_LABEL_OFFSET,
                  style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
                }}
              />
              <ReferenceLine y={0} stroke="rgb(var(--ink))" strokeWidth={1.5} strokeOpacity={0.45} />
              <Bar
                dataKey="lift7dBar"
                name="Δρ T+7"
                shape={<NBarCell />}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="lift1dBar"
                name="Δρ T+1"
                stroke="rgb(var(--ink-muted))"
                strokeWidth={1}
                strokeDasharray="4 3"
                dot={{ r: 2, fill: "rgb(var(--ink-muted))" }}
                connectNulls
                isAnimationActive={false}
              />
              <Tooltip
                formatter={(v: number, name: string) => [fmtRho(v), name]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as EisSuperScoreChartRow | undefined;
                  return row ? `${row.window} · n₇=${row.nPrice7d}` : "";
                }}
                contentStyle={{
                  fontSize: 10,
                  borderRadius: 8,
                  border: "1px solid rgb(var(--border))",
                  background: "rgb(var(--surface))",
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Panel 3 — n per bucket */}
      <div className="space-y-0.5 border-t border-[rgb(var(--border))]/40 pt-2">
        <div>
          <p className="text-[11px] font-semibold text-ink">{t("learningLab.eisSuper.panel3Title")}</p>
          <p className="text-[9px] text-ink-muted">
            {t("learningLab.eisSuper.panel3Subtitle", { minN: String(EIS_SUPER_MIN_N) })}
          </p>
        </div>
        <div style={{ height: 134 }} className="w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={CHART_MARGIN_BOTTOM} syncId={SYNC_ID} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" strokeOpacity={0.35} vertical={false} />
              {sharedX(true)}
              <YAxis
                tick={axisTickStyle()}
                domain={[0, "auto"]}
                tickLine={false}
                axisLine={false}
                width={MARGIN_LEFT}
                allowDecimals={false}
                label={{
                  value: "n",
                  angle: -90,
                  position: "insideLeft",
                  offset: Y_LABEL_OFFSET,
                  style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
                }}
              />
              <ReferenceLine
                y={EIS_SUPER_MIN_N}
                stroke="rgb(var(--signal-down))"
                strokeDasharray="4 3"
                strokeOpacity={0.7}
                label={{
                  value: `n=${EIS_SUPER_MIN_N}`,
                  position: "insideTopRight",
                  fontSize: 8,
                  fill: "rgb(var(--signal-down))",
                }}
              />
              <Bar dataKey="nPrice7d" shape={<NBarCell />} isAnimationActive={false}>
                <LabelList
                  dataKey="nPrice7d"
                  position="top"
                  offset={3}
                  style={{ fontSize: 8, fill: "rgb(var(--ink-muted))" }}
                />
              </Bar>
              <Tooltip
                formatter={(v: number) => [v, "n T+7"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as EisSuperScoreChartRow | undefined;
                  return row ? `${row.window} · ${row.daysLabel}` : "";
                }}
                contentStyle={{
                  fontSize: 10,
                  borderRadius: 8,
                  border: "1px solid rgb(var(--border))",
                  background: "rgb(var(--surface))",
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
