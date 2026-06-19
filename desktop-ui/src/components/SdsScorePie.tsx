import { sdsZoneBarColor, sdsZoneTextColor } from "../sheet/sdsZoneColors";

export function SdsScorePie({
  score,
  size = 36,
  onClick,
  title,
  className = "",
}: {
  score: number;
  size?: number;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(3.5, size * 0.13);
  const r = (size - stroke) / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const filledLen = (pct / 100) * c;
  const fillColor = sdsZoneBarColor(score);
  const textColor = sdsZoneTextColor(score);
  const label = Number.isFinite(score) ? score.toFixed(0) : "—";
  const fontSize = label.length >= 2 ? size * 0.3 : size * 0.34;

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden={onClick ? true : undefined}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-slate-200/90 dark:text-slate-600/70"
      />
      {filledLen > 0.5 ? (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={fillColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filledLen} ${c}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ) : null}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        style={{ fontSize, fontWeight: 700 }}
        className="tabular-nums select-none"
      >
        {label}
      </text>
    </svg>
  );

  const baseCls = `inline-flex items-center justify-center shrink-0 rounded-full ${className}`;

  if (onClick) {
    return (
      <button
        type="button"
        className={`${baseCls} cursor-pointer hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[rgb(var(--accent))]/50 transition-opacity`}
        title={title}
        aria-label={title ?? `SDS ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {svg}
      </button>
    );
  }

  return (
    <span
      className={baseCls}
      title={title}
      role="img"
      aria-label={title ?? `SDS ${label}`}
    >
      {svg}
    </span>
  );
}
