/** Mini-curva predizione (Δ% vs Pred per offset) — stesso disegno della Main Dashboard. */

export function extractSparklinePoints(
  row: Record<string, unknown>
): { offset: number; val: number }[] {
  return Object.entries(row)
    .filter(([k]) => k.startsWith("Δ%") && k.includes("Pred\n"))
    .map(([k, v]) => {
      const m = k.match(/([+−-])(\d+)\s*$/u);
      if (!m) return null;
      const sign = m[1] === "+" ? 1 : -1;
      const offset = Number(m[2]) * sign;
      const val = Number(v);
      return Number.isFinite(offset) && Number.isFinite(val) ? { offset, val } : null;
    })
    .filter((x): x is { offset: number; val: number } => x !== null)
    .sort((a, b) => a.offset - b.offset);
}

export function SimulationSparkline({
  row,
  width = 80,
  height = 26,
}: {
  row: Record<string, unknown>;
  width?: number;
  height?: number;
}) {
  const pts = extractSparklinePoints(row);
  if (pts.length < 2) {
    return <span className="text-ink-muted/30 text-[10px]">—</span>;
  }

  const vals = pts.map((p) => p.val);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 0.01;

  const padX = 2;
  const padY = 3;

  const svgPts = pts
    .map((p, i) => {
      const x = padX + (i / (pts.length - 1)) * (width - 2 * padX);
      const y = padY + (1 - (p.val - min) / range) * (height - 2 * padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = vals[vals.length - 1];
  const color = last >= 0 ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))";

  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" aria-hidden>
      <polyline
        points={svgPts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}
