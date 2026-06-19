import { useMemo } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileCurveChartsPayload } from "../dashboardTypes";
import { countFilledPolygonAxes, radarSeriesForChart } from "../mobilePolygonUtils";
import { MOBILE_CHART_H } from "./mobileChartTheme";

const MODEL = "#a78bfa";
const TARGET = "#86efac";
const GRID = "rgba(255, 255, 255, 0.22)";
const GRID_MAJOR = "rgba(255, 255, 255, 0.38)";
const TICK = "#94a3b8";
const MISSING = "#64748b";

function matchTone(pct: number): string {
  if (pct >= 85) return "curve-radar-match--strong";
  if (pct >= 65) return "curve-radar-match--watch";
  if (pct >= 45) return "curve-radar-match--weak";
  return "curve-radar-match--blocked";
}

function polar(cx: number, cy: number, radius: number, axisIndex: number, n: number) {
  const angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / n;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
    angle,
  };
}

function ringPoints(cx: number, cy: number, maxR: number, pct: number, n: number) {
  const r = (pct / 100) * maxR;
  return Array.from({ length: n }, (_, i) => {
    const p = polar(cx, cy, r, i, n);
    return `${p.x},${p.y}`;
  }).join(" ");
}

function pathFromIndices(
  cx: number,
  cy: number,
  maxR: number,
  values: (number | null)[],
  indices: number[],
): string {
  if (indices.length < 2) return "";
  const n = values.length;
  return indices
    .map((i, idx) => {
      const pct = values[i] ?? 0;
      const r = Math.max(2, (pct / 100) * maxR);
      const p = polar(cx, cy, r, i, n);
      return `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    })
    .join(" ");
}

function filledIndices(values: (number | null)[]): number[] {
  return values.map((v, i) => (v != null && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
}

export function MobileCdPatternRadarChart({
  polygon,
  height = MOBILE_CHART_H,
}: {
  polygon: NonNullable<MobileCurveChartsPayload["polygon"]>;
  height?: number;
}) {
  const { t } = useMobileLang();
  const filledCount = countFilledPolygonAxes(polygon);
  const totalAxes = polygon.axes?.length ?? polygon.labels.length;
  const incomplete = filledCount < totalAxes;

  const svg = useMemo(() => {
    const width = 320;
    const padTop = 18;
    const padBottom = 8;
    const cx = width / 2;
    const cy = padTop + (height - padTop - padBottom) / 2;
    const maxR = Math.min(width, height - padTop - padBottom) * 0.34;
    const n = polygon.labels.length;
    const current = radarSeriesForChart(polygon);
    const filled = filledIndices(current);

    const targetPoly = ringPoints(cx, cy, maxR, 100, n);
    const currentPoly =
      filled.length >= 3
        ? filled
            .map((i, idx) => {
              const pct = current[i] ?? 0;
              const r = Math.max(2, (pct / 100) * maxR);
              const p = polar(cx, cy, r, i, n);
              return `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
            })
            .join(" ") + " Z"
        : null;

    const segmentPaths: string[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (current[i] != null && current[j] != null) {
        segmentPaths.push(pathFromIndices(cx, cy, maxR, current, [i, j]));
      }
    }

    return {
      width,
      cx,
      cy,
      maxR,
      n,
      current,
      filled,
      targetPoly,
      currentPoly,
      segmentPaths,
    };
  }, [polygon, height]);

  return (
    <div className="curve-radar-wrap">
      <div className="curve-radar-match-row">
        <span className={`curve-radar-match-badge ${matchTone(polygon.matchPct)}`}>
          {t("curve.radarSimilarity", { pct: polygon.matchPct })}
        </span>
        {incomplete ? (
          <span className="curve-radar-incomplete">
            {t("curve.radarIncomplete", { filled: filledCount, total: totalAxes })}
          </span>
        ) : null}
      </div>
      <div className="curve-chart-plot-wrap">
        <div
          className="curve-chart-tile-panel invest-trend-chart-panel"
          style={{ height, minHeight: height }}
        >
          <svg
            className="curve-chart-svg curve-chart-svg--radar"
            viewBox={`0 0 ${svg.width} ${height}`}
            width="100%"
            height={height}
            role="img"
            aria-label={t("curve.radarSimilarity", { pct: polygon.matchPct })}
          >
            {[25, 50, 75, 100].map((pct) => (
              <polygon
                key={`ring-${pct}`}
                points={ringPoints(svg.cx, svg.cy, svg.maxR, pct, svg.n)}
                fill="none"
                stroke={pct === 100 ? GRID_MAJOR : GRID}
                strokeWidth={pct === 100 ? 1 : 0.75}
              />
            ))}

            {Array.from({ length: svg.n }, (_, i) => {
              const outer = polar(svg.cx, svg.cy, svg.maxR, i, svg.n);
              return (
                <line
                  key={`spoke-${i}`}
                  x1={svg.cx}
                  y1={svg.cy}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={GRID_MAJOR}
                  strokeWidth={0.85}
                />
              );
            })}

            <polygon
              points={svg.targetPoly}
              fill={`${TARGET}18`}
              stroke={TARGET}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />

            {svg.currentPoly ? (
              <path
                d={svg.currentPoly}
                fill={`${MODEL}40`}
                stroke={MODEL}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ) : (
              svg.segmentPaths.map((d, i) => (
                <path
                  key={`seg-${i}`}
                  d={d}
                  fill="none"
                  stroke={MODEL}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ))
            )}

            {svg.current.map((pct, i) => {
              if (pct == null) {
                const outer = polar(svg.cx, svg.cy, svg.maxR * 0.55, i, svg.n);
                return (
                  <g key={`miss-${i}`}>
                    <circle cx={outer.x} cy={outer.y} r={3.5} fill="none" stroke={MISSING} strokeWidth={1.2} strokeDasharray="2 2" />
                  </g>
                );
              }
              const r = Math.max(2, (pct / 100) * svg.maxR);
              const p = polar(svg.cx, svg.cy, r, i, svg.n);
              return (
                <circle
                  key={`pt-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  fill={MODEL}
                  stroke="#fff"
                  strokeWidth={1}
                />
              );
            })}

            {polygon.labels.map((label, i) => {
              const p = polar(svg.cx, svg.cy, svg.maxR + 16, i, svg.n);
              const missing = !polygon.axes?.[i]?.currentText || polygon.axes[i].currentText === "—";
              return (
                <text
                  key={`lbl-${i}`}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fontWeight={500}
                  fill={missing ? MISSING : TICK}
                >
                  {label}
                </text>
              );
            })}
          </svg>
          <div className="curve-radar-legend" aria-hidden>
            <span className="curve-legend-item">
              <i style={{ borderTopColor: MODEL }} /> {t("curve.radarLegendCurrent")}
            </span>
            <span className="curve-legend-item curve-legend-item--target">
              <i /> {t("curve.radarLegendTarget")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
