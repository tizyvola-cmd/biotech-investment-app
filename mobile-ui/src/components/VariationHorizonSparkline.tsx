/** Inline 1d / 7d / 1M price variation bars — same as desktop Simulation table. */
export function VariationHorizonSparkline({
  d1,
  d7,
  m1,
  width = 58,
  height = 32,
}: {
  d1: number | null;
  d7: number | null;
  m1: number | null;
  width?: number;
  height?: number;
}) {
  const bars = [
    { label: "1d", v: d1 },
    { label: "7d", v: d7 },
    { label: "1M", v: m1 },
  ];
  const present = bars.filter((b): b is { label: string; v: number } => b.v != null && Number.isFinite(b.v));
  if (!present.length) {
    return <span className="var-spark-empty">—</span>;
  }

  const maxAbs = Math.max(0.8, ...present.map((b) => Math.abs(b.v)));
  const padX = 2;
  const padY = 3;
  const gap = 3;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2 - 8;
  const barW = (innerW - gap * (bars.length - 1)) / bars.length;
  const midY = padY + innerH / 2;

  const tip = present
    .map((b) => `${b.label}: ${b.v >= 0 ? "+" : ""}${b.v.toFixed(2)}%`)
    .join(" · ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="var-spark-svg"
      role="img"
      aria-label={tip}
    >
      <title>{tip}</title>
      {bars.map((b, i) => {
        const x = padX + i * (barW + gap);
        if (b.v == null || !Number.isFinite(b.v)) {
          return (
            <g key={b.label}>
              <rect x={x} y={midY - 1} width={barW} height={2} fill="rgb(var(--border))" opacity={0.35} />
              <text x={x + barW / 2} y={height - 1} textAnchor="middle" fontSize={6} fill="rgb(var(--ink-muted))">
                {b.label}
              </text>
            </g>
          );
        }
        const h = Math.max(2, (Math.abs(b.v) / maxAbs) * (innerH / 2));
        const y = b.v >= 0 ? midY - h : midY;
        const color = b.v >= 0 ? "rgb(34,197,94)" : "rgb(239,68,68)";
        return (
          <g key={b.label}>
            <line x1={x} x2={x + barW} y1={midY} y2={midY} stroke="rgb(var(--border))" strokeWidth={0.5} opacity={0.5} />
            <rect x={x + 0.5} y={y} width={Math.max(1, barW - 1)} height={h} rx={1} fill={color} opacity={0.9} />
            <text x={x + barW / 2} y={height - 1} textAnchor="middle" fontSize={6} fill="rgb(var(--ink-muted))">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
