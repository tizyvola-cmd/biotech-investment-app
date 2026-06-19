/** Mini donut: progress verso target (0–100%). */

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export type TargetDonutTone = "up" | "down" | "warn" | "muted";

export function TargetDistanceDonut({
  ratio,
  tone,
  size = 20,
  title,
}: {
  ratio: number | null;
  tone: TargetDonutTone;
  size?: number;
  title?: string;
}) {
  const r = size / 2 - 2.5;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const fill = ratio != null ? clamp01(ratio) : 0;
  const stroke =
    tone === "warn"
      ? "rgb(var(--warn))"
      : tone === "down"
        ? "rgb(var(--signal-down))"
        : tone === "up"
          ? "rgb(var(--signal-up))"
          : "rgb(var(--ink-muted))";
  const defaultLabel =
    ratio == null
      ? "Progress toward target not available"
      : `${Math.round(fill * 100)}% toward target`;
  const label = title ?? defaultLabel;

  return (
    <svg
      width={size}
      height={size}
      className="shrink-0"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="rgb(var(--border))"
        strokeWidth="2.5"
        opacity={0.5}
      />
      {fill > 0 ? (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeDasharray={`${circ * fill} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
        />
      ) : null}
    </svg>
  );
}
