import { useMemo } from "react";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  RadarController,
} from "chart.js";
import { Radar } from "react-chartjs-2";
import { useTheme } from "../hooks/useTheme";
import { chartScaleStyle } from "../utils/chartGrad";
import { useT } from "../shared/i18n";
import type { CdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  RadarController,
);

function snVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function CdPatternRadarChart({
  rec,
  height = 260,
  compact = false,
  mini = false,
}: {
  rec: CdPatternTickerRecommendation;
  height?: number;
  compact?: boolean;
  mini?: boolean;
}) {
  const t = useT();
  const { theme } = useTheme();
  const scaleStyle = useMemo(() => chartScaleStyle(), [theme]);
  const modelHex = snVar("--chart-model", "#6B4FC8");
  const targetHex = snVar("--sn-long-text", "#5A9A18");

  const compactLabelSize = mini
    ? 8
    : compact
      ? Math.min(12, Math.max(9, Math.round(height / 32)))
      : 9;
  const compactPointRadius = compact || mini ? Math.max(2, Math.round(height / 80)) : 3;
  const showLegend = !compact || mini;

  const data = useMemo(
    () => ({
      labels: rec.axes.map((a) => a.label),
      datasets: [
        {
          label: t("decisionLab.pattern.radar.current"),
          data: rec.radarCurrent,
          borderColor: modelHex,
          backgroundColor: `${modelHex}33`,
          borderWidth: compact ? Math.max(2, Math.round(height / 120)) : 2,
          pointRadius: compactPointRadius,
        },
        {
          label: t("decisionLab.pattern.radar.target"),
          data: rec.radarTarget,
          borderColor: targetHex,
          backgroundColor: `${targetHex}18`,
          borderWidth: compact ? Math.max(1.5, height / 180) : 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
        },
      ],
    }),
    [rec, t, modelHex, targetHex, compact, mini, compactPointRadius, height],
  );

  return (
    <div
      style={{ height, width: compact && !mini ? height : "100%" }}
      className={compact && !mini ? "shrink-0" : undefined}
      title={compact && !mini ? `${rec.matchPct}%` : undefined}
    >
      <Radar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          layout: mini ? { padding: { top: -2, bottom: 0, left: 0, right: 0 } } : undefined,
          plugins: {
            legend: {
              display: showLegend,
              labels: {
                color: scaleStyle.ticks.color,
                boxWidth: mini ? 8 : 10,
                font: { size: mini ? 7 : 10 },
                padding: mini ? 4 : 10,
              },
            },
          },
          scales: {
            r: {
              min: 0,
              max: 100,
              ticks: { display: false },
              grid: { color: scaleStyle.grid.color },
              pointLabels: {
                color: scaleStyle.ticks.color,
                font: { size: compactLabelSize },
              },
            },
          },
        }}
      />
    </div>
  );
}
