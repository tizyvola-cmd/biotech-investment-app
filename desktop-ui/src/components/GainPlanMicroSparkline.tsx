import { useMemo } from "react";
import type { InvestSimHistoryPoint } from "../sheet/investSimStorage";
import {
  buildGainPlanSeries,
  type PortfolioGainChartRow,
} from "./PortfolioGainPlanChart";

/** Mini sparkline gain vs plan — actual vs planned € nel tempo. */
export function GainPlanMicroSparkline({
  row,
  history,
  width = 92,
  height = 30,
}: {
  row: PortfolioGainChartRow;
  history: InvestSimHistoryPoint[];
  width?: number;
  height?: number;
}) {
  const series = useMemo(() => buildGainPlanSeries(row, history), [row, history]);

  const paths = useMemo(() => {
    const pts = series.filter(
      (p) => (p.planned != null && Number.isFinite(p.planned)) || (p.actual != null && Number.isFinite(p.actual)),
    );
    if (pts.length < 2) return null;

    let min = 0;
    let max = 0;
    for (const p of pts) {
      for (const v of [p.planned, p.actual]) {
        if (v == null || !Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    const range = max - min || Math.max(Math.abs(max), 500);
    const padX = 2;
    const padY = 3;
    const w = width - padX * 2;
    const h = height - padY * 2;
    const maxDay = pts[pts.length - 1]?.day ?? 1;

    const xy = (day: number, val: number) => ({
      x: padX + (day / Math.max(maxDay, 0.01)) * w,
      y: padY + (1 - (val - min) / range) * h,
    });

    const line = (key: "planned" | "actual") => {
      const seg: string[] = [];
      for (const p of pts) {
        const v = p[key];
        if (v == null || !Number.isFinite(v)) continue;
        const { x, y } = xy(p.day, v);
        seg.push(`${seg.length ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return seg.join(" ");
    };

    const lastActual = [...pts].reverse().find((p) => p.actual != null)?.actual ?? 0;
    return {
      planned: line("planned"),
      actual: line("actual"),
      actualTone: lastActual >= -0.01 ? "up" : "down",
    };
  }, [series, width, height]);

  if (!paths?.actual && !paths?.planned) {
    return (
      <span className="text-[9px] text-ink-muted/60 tabular-nums">—</span>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="gain-plan-micro-spark shrink-0"
      aria-hidden
    >
      {paths.planned ? (
        <path
          d={paths.planned}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeDasharray="2 2"
          className="text-ink-muted/45"
        />
      ) : null}
      {paths.actual ? (
        <path
          d={paths.actual}
          fill="none"
          strokeWidth="1.6"
          stroke={
            paths.actualTone === "up"
              ? "rgb(var(--signal-up))"
              : "rgb(var(--signal-down))"
          }
        />
      ) : null}
    </svg>
  );
}
