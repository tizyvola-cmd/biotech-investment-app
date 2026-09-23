import { useMemo } from "react";
import {
  CHART_LAB_LINE_ACTUAL,
  CHART_LAB_LINE_PRED,
} from "../sheet/chartTheme";
import type { SlopeTrajectoryPoint } from "../sheet/slopeRecalibCurve";

const W = 76;
const H = 30;
const PAD = 3;

function polyline(
  pts: { x: number; y: number }[],
): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function SimTableSlopeTrajectoryMini({
  points,
  title,
}: {
  points: SlopeTrajectoryPoint[];
  title?: string;
}) {
  const { predPath, actualPath } = useMemo(() => {
    const rows = points.filter((p) => p.pred != null || p.actual != null);
    if (rows.length < 2) return { predPath: "", actualPath: "" };

    const xs = rows.map((p) => p.offset);
    const preds = rows.map((p) => p.pred).filter((v): v is number => v != null);
    const acts = rows.map((p) => p.actual).filter((v): v is number => v != null);
    const all = [...preds, ...acts];
    if (!all.length) return { predPath: "", actualPath: "" };

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...all);
    const maxY = Math.max(...all);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    const toXY = (offset: number, pct: number) => ({
      x: PAD + ((offset - minX) / spanX) * (W - PAD * 2),
      y: PAD + (1 - (pct - minY) / spanY) * (H - PAD * 2),
    });

    const predPts = rows
      .filter((p) => p.pred != null)
      .map((p) => toXY(p.offset, p.pred as number));
    const actPts = rows
      .filter((p) => p.actual != null)
      .map((p) => toXY(p.offset, p.actual as number));

    return {
      predPath: predPts.length >= 2 ? polyline(predPts) : "",
      actualPath: actPts.length >= 2 ? polyline(actPts) : "",
    };
  }, [points]);

  if (!predPath && !actualPath) {
    return <span className="text-[9px] text-ink-muted/80">—</span>;
  }

  return (
    <div className="shrink-0" title={title}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="overflow-visible block"
        role="img"
        aria-hidden
      >
        {title ? <title>{title}</title> : null}
        {predPath ? (
          <path
            d={predPath}
            fill="none"
            stroke={CHART_LAB_LINE_PRED}
            strokeWidth={1.35}
            strokeDasharray="3 2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {actualPath ? (
          <path
            d={actualPath}
            fill="none"
            stroke={CHART_LAB_LINE_ACTUAL}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </div>
  );
}
