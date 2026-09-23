import { fmtDailyLabel } from "../sheet/priceVariationSeries";

const MUTED = "#475569";
const YEAR = "#0B0D17";

/** Year on the first tick and on January — same cadence as the clinical-lane axis. */
export function chartTickShowsYear(iso: string, tickIndex: number): boolean {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return false;
  return tickIndex === 0 || dt.getMonth() === 0;
}

type Props = {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
  index?: number;
  it: boolean;
  /** Daily ISO keys — 24h uses clock ticks instead. */
  daily: boolean;
};

export function ChartIsoDateTick({ x, y, payload, index = 0, it, daily }: Props) {
  if (x == null || y == null) return null;
  const s = String(payload?.value ?? "");
  if (!daily) {
    const hm = /T(\d{2}:\d{2})/.exec(s);
    return (
      <text x={x} y={y} dy={10} textAnchor="middle" fontSize={9} fill={MUTED}>
        {hm?.[1] ?? s}
      </text>
    );
  }
  const iso = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
  const showYear = chartTickShowsYear(iso, index);
  const dateLbl = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? fmtDailyLabel(iso, it) : s;
  return (
    <g transform={`translate(${x},${y})`}>
      {showYear ? (
        <text textAnchor="middle" dy={8} fontSize={10} fontWeight={700} fill={YEAR}>
          {iso.slice(0, 4)}
        </text>
      ) : null}
      <text textAnchor="middle" dy={showYear ? 20 : 10} fontSize={9} fill={MUTED}>
        {dateLbl}
      </text>
    </g>
  );
}
