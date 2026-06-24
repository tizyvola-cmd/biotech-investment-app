import {
  recalibCurveStrokeColor,
  resolveTodayOffset,
  sparklineAxisBounds,
  xForCurveOffset,
  yForCurveVal,
  type RecalibCurvePoint,
} from "../mobileRecalibCurve";

type Props = {
  points: RecalibCurvePoint[];
  completionDate?: unknown;
  todayOffset?: number | null;
  daysToCd?: number | null;
  width?: number;
  height?: number;
  className?: string;
};

/** Mini curva di ricalibrazione (Pred ± offset) per tabella Actions. */
export function MobileRecalibSparkline({
  points,
  completionDate,
  todayOffset,
  daysToCd,
  width = 52,
  height = 24,
  className,
}: Props) {
  if (points.length < 2) {
    return <span className="actions-curve-empty">—</span>;
  }

  const nowOff = resolveTodayOffset({ completionDate, todayOffset, daysToCd });
  const padX = 2;
  const padY = 3;
  const vals = points.map((p) => p.val);
  const allVals = [...vals, 0];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 0.01;

  const { minOff, maxOff } = sparklineAxisBounds(points, nowOff);

  const svgPts = points
    .map((p) => {
      const x = xForCurveOffset(p.offset, minOff, maxOff, width, padX);
      const y = yForCurveVal(p.val, minVal, range, height, padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const zeroY = yForCurveVal(0, minVal, range, height, padY);
  const zeroInRange = zeroY > padY && zeroY < height - padY;
  const color = recalibCurveStrokeColor(points, nowOff);

  let nowX: number | null = null;
  let nowY: number | null = null;
  if (nowOff != null && Number.isFinite(nowOff)) {
    const mapped = points.map((p) => ({ offset: p.offset, y: p.val }));
    const sorted = [...mapped].sort((a, b) => a.offset - b.offset);
    let nowVal: number | null = null;
    if (nowOff <= sorted[0].offset) nowVal = sorted[0].y;
    else if (nowOff >= sorted[sorted.length - 1].offset) nowVal = sorted[sorted.length - 1].y;
    else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (nowOff >= a.offset && nowOff <= b.offset) {
          const t = (nowOff - a.offset) / (b.offset - a.offset);
          nowVal = a.y + t * (b.y - a.y);
          break;
        }
      }
    }
    if (nowVal != null) {
      nowX = xForCurveOffset(nowOff, minOff, maxOff, width, padX);
      nowY = yForCurveVal(nowVal, minVal, range, height, padY);
    }
  }

  const cdX =
    maxOff >= -0.5 && minOff <= 0.5
      ? xForCurveOffset(0, minOff, maxOff, width, padX)
      : null;

  const todayStroke = "var(--warn, #fbbf24)";
  const todayFill = "var(--warn, #fbbf24)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className ?? "actions-curve-svg"}
      aria-hidden
    >
      {zeroInRange ? (
        <line
          x1={padX}
          x2={width - padX}
          y1={zeroY}
          y2={zeroY}
          stroke="rgb(var(--ink-muted))"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.35}
        />
      ) : null}
      {cdX != null ? (
        <line
          x1={cdX}
          y1={0}
          x2={cdX}
          y2={height}
          stroke="rgb(var(--ink-muted))"
          strokeWidth={0.75}
          opacity={0.28}
        />
      ) : null}
      <polyline
        points={svgPts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      {nowX != null && nowY != null ? (
        <>
          <line
            x1={nowX}
            y1={0}
            x2={nowX}
            y2={height}
            stroke={todayStroke}
            strokeWidth={1}
            strokeDasharray="2 1.5"
            opacity={0.85}
          />
          <circle
            cx={nowX}
            cy={nowY}
            r={1.75}
            fill={todayFill}
            stroke="rgb(var(--panel-feed-bg))"
            strokeWidth={0.5}
          />
        </>
      ) : null}
    </svg>
  );
}
