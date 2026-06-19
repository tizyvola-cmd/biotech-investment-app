/** SVG sparkline leggero — no Recharts. */
export function MobileSparkline({
  points,
  width = 280,
  height = 56,
  color = "var(--accent)",
  baseline,
  className,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  baseline?: number | null;
  className?: string;
}) {
  if (!points.length) {
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--border)" strokeWidth={1} />
      </svg>
    );
  }
  const pad = 4;
  const min = Math.min(...points, baseline ?? points[0]);
  const max = Math.max(...points, baseline ?? points[0]);
  const span = max - min || 1;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const toY = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${pad + i * step} ${toY(v)}`)
    .join(" ");
  const baseY = baseline != null ? toY(baseline) : height / 2;

  return (
    <svg width={width} height={height} className={className} aria-hidden viewBox={`0 0 ${width} ${height}`}>
      <line
        x1={pad}
        y1={baseY}
        x2={width - pad}
        y2={baseY}
        stroke="var(--text-muted)"
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.6}
      />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
