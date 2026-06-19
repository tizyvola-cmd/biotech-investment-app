import type { MobileTargetProgressTone } from "../mobileTargetProgress";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function MobileTargetDistanceDonut({
  ratio,
  tone,
  size = 20,
  title,
}: {
  ratio: number | null;
  tone: MobileTargetProgressTone;
  size?: number;
  title?: string;
}) {
  const r = size / 2 - 3;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const fill = ratio != null ? clamp01(ratio) : 0;
  const pct = Math.round(fill * 100);
  const label =
    title ??
    (ratio == null ? "Progress verso target non disponibile" : `${pct}% verso target`);

  return (
    <span className="actions-target-donut-wrap" title={label}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={`actions-target-donut actions-target-donut--${tone}`}
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <circle className="actions-target-donut-track" cx={c} cy={c} r={r} />
        <circle
          className="actions-target-donut-fill"
          cx={c}
          cy={c}
          r={r}
          strokeDasharray={`${circ * fill} ${circ}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      {ratio != null ? <span className="actions-target-pct">{pct}%</span> : null}
    </span>
  );
}
