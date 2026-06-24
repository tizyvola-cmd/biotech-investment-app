import {
  SOLIDITY_COMPONENT_COLORS,
  solidityCompositeTierColor,
  type EntrySolidityComposite,
} from "../sheet/entrySolidityComposite";

type SolidityPieIconProps = {
  composite: EntrySolidityComposite;
  size?: number;
  className?: string;
};

/** Donut compatta: anello totale + fette componenti (score composito solidità). */
export function SolidityPieIcon({ composite, size = 18, className = "" }: SolidityPieIconProps) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(2, size * 0.14);
  const r = (size - stroke) / 2 - 0.5;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const segments = composite.components.map((comp) => {
    const sliceLen = (comp.maxPoints / 100) * c;
    const filledLen = (Math.max(0, comp.points) / comp.maxPoints) * sliceLen;
    const seg = {
      id: comp.id,
      color: SOLIDITY_COMPONENT_COLORS[comp.id],
      gap: 0.8,
      filledLen: Math.max(0, filledLen - 0.8),
      sliceLen,
      offset,
    };
    offset += sliceLen;
    return seg;
  });

  const tierColor = solidityCompositeTierColor(composite.tier);
  const trackOpacity = 0.2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-hidden
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-slate-300/80 dark:text-slate-600/80"
      />
      {segments.map((seg) => (
        <g key={seg.id}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeOpacity={trackOpacity}
            strokeDasharray={`${Math.max(0, seg.sliceLen - seg.gap)} ${c}`}
            strokeDashoffset={-seg.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
          {seg.filledLen > 0.5 ? (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${seg.filledLen} ${c}`}
              strokeDashoffset={-seg.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ) : null}
        </g>
      ))}
      <circle cx={cx} cy={cy} r={Math.max(1, r * 0.38)} fill={tierColor} opacity={0.95} />
    </svg>
  );
}

type SolidityCompositePieChartProps = {
  composite: EntrySolidityComposite;
  size?: number;
  label?: string;
};

/** Torta grande per il modal — fette proporzionali ai punti guadagnati. */
export function SolidityCompositePieChart({
  composite,
  size = 140,
  label,
}: SolidityCompositePieChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR * 0.52;

  let angle = -90;
  const slices = composite.components.map((comp) => {
    const sweep = (Math.max(0, comp.points) / 100) * 360;
    const start = angle;
    angle += sweep;
    return { ...comp, start, sweep, color: SOLIDITY_COMPONENT_COLORS[comp.id] };
  });

  function arcPath(startDeg: number, sweepDeg: number, outer: number, inner: number): string {
    if (sweepDeg <= 0.05) return "";
    const endDeg = startDeg + sweepDeg;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const x1 = cx + outer * Math.cos(toRad(startDeg));
    const y1 = cy + outer * Math.sin(toRad(startDeg));
    const x2 = cx + outer * Math.cos(toRad(endDeg));
    const y2 = cy + outer * Math.sin(toRad(endDeg));
    const x3 = cx + inner * Math.cos(toRad(endDeg));
    const y3 = cy + inner * Math.sin(toRad(endDeg));
    const x4 = cx + inner * Math.cos(toRad(startDeg));
    const y4 = cy + inner * Math.sin(toRad(startDeg));
    const large = sweepDeg > 180 ? 1 : 0;
    return [
      `M ${x1} ${y1}`,
      `A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
      "Z",
    ].join(" ");
  }

  const tierColor = solidityCompositeTierColor(composite.tier);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={cx} cy={cy} r={outerR} fill="#f1f5f9" className="dark:fill-slate-800" />
        {slices.map((sl) =>
          sl.sweep > 0.05 ? (
            <path
              key={sl.id}
              d={arcPath(sl.start, sl.sweep - 0.4, outerR, innerR)}
              fill={sl.color}
              opacity={0.92}
            />
          ) : null,
        )}
        <circle cx={cx} cy={cy} r={innerR - 2} fill="white" className="dark:fill-slate-900" />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-ink text-[22px] font-bold"
          style={{ fontSize: size * 0.18 }}
        >
          {composite.total}
        </text>
        <text
          x={cx}
          y={cy + size * 0.1}
          textAnchor="middle"
          fill={tierColor}
          style={{ fontSize: size * 0.08, fontWeight: 600 }}
        >
          /100
        </text>
      </svg>
      {label ? (
        <p className="text-[11px] font-semibold text-center text-ink-muted">{label}</p>
      ) : null}
    </div>
  );
}
