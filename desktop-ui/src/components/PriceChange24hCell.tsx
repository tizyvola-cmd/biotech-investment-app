/** Triangle + % for 24h price change (KPI snapshot table). */

export function formatPriceChange24h(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.05) return "0.0%";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function PriceChange24hCell({
  pct,
  className = "",
  uniform = false,
}: {
  pct: number | null | undefined;
  className?: string;
  /** Match KPI snapshot table typography (10px medium). */
  uniform?: boolean;
}) {
  if (pct == null || !Number.isFinite(pct)) {
    return <span className={`text-ink-muted/60 tabular-nums ${className}`.trim()}>—</span>;
  }

  const up = pct > 0.5;
  const down = pct < -0.5;
  const color = up
    ? "text-[rgb(var(--signal-up))]"
    : down
      ? "text-[rgb(var(--signal-down))]"
      : "text-ink-muted";
  const icon = up ? "▲" : down ? "▼" : "◆";
  const weight = uniform ? "font-medium" : "font-semibold";
  const size = uniform ? "text-[10px]" : "text-[10px]";

  return (
    <span
      className={`inline-flex items-center gap-0.5 tabular-nums ${weight} ${size} ${color} ${className}`.trim()}
      title={formatPriceChange24h(pct)}
    >
      <span className={`${uniform ? "text-[10px]" : "text-[8px]"} leading-none`} aria-hidden>
        {icon}
      </span>
      {formatPriceChange24h(pct)}
    </span>
  );
}
