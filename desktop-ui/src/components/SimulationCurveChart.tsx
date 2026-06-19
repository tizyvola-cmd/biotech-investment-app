import {
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint } from "../types";
import type { AiFeedChartMarker, K8ChartMarker } from "../sheet/k8ChartLinks";
import { AI_FEED_MARKER_COLOR, openExternalUrl } from "../sheet/k8ChartLinks";
import {
  chartPointSortKey,
  includeChartNode,
  isRecalibExtraNode,
} from "../sheet/chartNodes";
import { fmtAxisPctTick } from "../sheet/chartAxisFormat";
import { referenceMatchLabel } from "../sheet/referenceVerification";
import {
  interpolateAtOffset,
  type NowOffsetMarker,
} from "../sheet/chartNowOffset";
import {
  ChartNowPinLabel,
  NOW_MARKER_FILL,
  NowCurvePinShape,
} from "../sheet/nowTimelineMarker";
import {
  resolveVarHorizonPct,
  SIM_VAR_HORIZON_LABELS,
} from "../sheet/simulationStyles";
import { chartXAnchorRows, renderCdZones } from "../sheet/chartCdZones";
import {
  CHART_CURVES_AXIS_TICK,
  CHART_CURVES_EMPTY_MSG,
  CHART_CURVES_FOOTER,
  CHART_CURVES_GRID,
  CHART_CURVES_PANEL,
  CHART_CURVES_PANEL_EMPTY,
  CHART_CURVES_PANEL_PAD,
  CHART_CURVES_TITLE,
  CHART_CURVES_TITLE_SIMPLE,
  CHART_CURVES_TOOLTIP,
  CHART_CURVES_TOOLTIP_MUTED,
  CHART_CURVES_TOOLTIP_TITLE,
  chartCurvesLegendStyle,
} from "../sheet/chartTheme";

export type { NowOffsetMarker } from "../sheet/chartNowOffset";

type PriceField = "price_usd" | "price_storico_usd" | "price_model_usd";

const PCT_FOR_PRICE: Record<
  PriceField,
  ("pct_foglio" | "pct_curva" | "pct_reale" | "pct_modello")[]
> = {
  price_usd: ["pct_foglio", "pct_curva"],
  price_storico_usd: ["pct_reale"],
  price_model_usd: ["pct_modello"],
};

export type PriceChartRow = {
  x: number;
  y: number;
  xLabel: string;
  /** Standard deviation (aggregation per offset or portfolio). */
  ySd?: number;
  /** Recharts ErrorBar: [sdDown, sdUp]. */
  yErr?: [number, number];
  n?: number;
};

export type PricePathChartMode = "series" | "portfolio-mean";

/** Normalize a series of absolute prices to index T−60=100 for each ticker. */
function normalizeSeriesToIndex(rows: PriceChartRow[]): PriceChartRow[] {
  const base = rows.find((r) => r.x === -60)?.y ?? rows[0]?.y;
  if (!base || base <= 0) return rows;
  return rows.map((r) => ({
    ...r,
    y: roundPrice((r.y / base) * 100),
    ySd: r.ySd != null ? roundPrice((r.ySd / base) * 100) : undefined,
    yErr: r.yErr
      ? [roundPrice((r.yErr[0] / base) * 100), roundPrice((r.yErr[1] / base) * 100)] as [number, number]
      : undefined,
  }));
}

function fmtPriceAxis(v: number): string {
  if (!Number.isFinite(v)) return "";
  return (Math.round(v * 100) / 100).toFixed(2);
}

function roundPrice(v: number): number {
  return Math.round(v * 100) / 100;
}

function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length;
  return Math.sqrt(v);
}

/** Multiple points (e.g. K-8) at the same offset → mean ± SD. */
function aggregateRowsByOffset(rows: PriceChartRow[]): PriceChartRow[] {
  const byX = new Map<number, number[]>();
  for (const r of rows) {
    const ys = byX.get(r.x) ?? [];
    ys.push(r.y);
    byX.set(r.x, ys);
  }
  return [...byX.entries()]
    .sort(([a], [b]) => a - b)
    .map(([x, ys]) => {
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sd = stdDev(ys);
      return {
        x,
        y: Math.round(mean * 100) / 100,
        ySd: Math.round(sd * 100) / 100,
        yErr: [sd, sd] as [number, number],
        n: ys.length,
        xLabel: offsetLabel(x),
      };
    });
}

/**
 * Portfolio mean over standard nodes: index T−60 = 100 per ticker, then μ ± σ across tickers.
 */
function portfolioMeanRows(
  lines: { points: ChartPoint[] }[],
  field: PriceField,
  opts: { standardOnly: boolean }
): PriceChartRow[] {
  const byOffset = new Map<number, number[]>();

  for (const line of lines) {
    const raw = pricePointsFromSeries(line.points, field, {
      includeRecalibExtras: field === "price_usd" && !opts.standardOnly,
      standardOnly: opts.standardOnly,
    });
    if (raw.length === 0) continue;
    const baseRow = raw.find((r) => r.x === -60) ?? raw[0];
    const base = baseRow?.y ?? 0;
    if (base <= 0) continue;
    for (const r of raw) {
      const idx = (r.y / base) * 100;
      const bucket = byOffset.get(r.x) ?? [];
      bucket.push(idx);
      byOffset.set(r.x, bucket);
    }
  }

  return [...byOffset.entries()]
    .sort(([a], [b]) => a - b)
    .map(([x, indices]) => {
      const mean = indices.reduce((a, b) => a + b, 0) / indices.length;
      const sd = stdDev(indices);
      return {
        x,
        y: Math.round(mean * 100) / 100,
        ySd: Math.round(sd * 100) / 100,
        yErr: [sd, sd] as [number, number],
        n: indices.length,
        xLabel: offsetLabel(x),
      };
    });
}

function pointSortKey(p: ChartPoint): [number, number] {
  return chartPointSortKey(p);
}

function offsetLabel(offset: number): string {
  return offset > 0 ? `+${offset}` : String(offset);
}

function K8DiamondShape(props: {
  cx?: number;
  cy?: number;
  payload?: K8ChartMarker;
}) {
  const { cx = 0, cy = 0, payload } = props;
  const fill = payload?.color ?? "#f59e0b";
  const s = 5;
  return (
    <path
      d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`}
      fill={fill}
      stroke="rgba(255,255,255,0.9)"
      strokeWidth={1}
    />
  );
}

function AiFeedTriangleShape(props: {
  cx?: number;
  cy?: number;
  payload?: AiFeedChartMarker;
}) {
  const { cx = 0, cy = 0, payload } = props;
  const fill = payload?.color ?? AI_FEED_MARKER_COLOR;
  const s = 5;
  const showBadge = payload?.verified !== false;
  return (
    <g>
      <path
        d={`M${cx},${cy - s} L${cx + s},${cy + s} L${cx - s},${cy + s} Z`}
        fill={fill}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={1}
      />
      {showBadge && (
        <g transform={`translate(${cx + s - 1}, ${cy - s - 1})`}>
          <circle r={4.5} fill="#16a34a" stroke="#fff" strokeWidth={1} />
          <path
            d="M -1.8 0.2 L -0.6 1.4 L 1.8 -1.2"
            fill="none"
            stroke="#fff"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </g>
  );
}

function extendXDomain(
  xMin: number,
  xMax: number,
  markers: NowOffsetMarker[]
): [number, number] {
  const offs = markers.map((m) => m.offset);
  if (!offs.length) return [xMin, xMax];
  return [Math.min(xMin, ...offs), Math.max(xMax, ...offs)];
}

function ChartNowMarkersLayer({ markers }: { markers: NowOffsetMarker[] }) {
  if (!markers.length) return null;
  return (
    <>
      {markers.map((m, i) => (
        <ReferenceLine
          key={`now-line-${m.offset}-${i}`}
          x={m.offset}
          stroke="none"
          ifOverflow="extendDomain"
          label={<ChartNowPinLabel text={i === 0 ? m.label : undefined} />}
        />
      ))}
    </>
  );
}

type NowCurveDot = { offset: number; y: number; id: string };

function pctForPriceField(p: ChartPoint, field: PriceField): number | null {
  for (const key of PCT_FOR_PRICE[field]) {
    const raw = p[key];
    if (raw != null && raw === raw) return Number(raw);
  }
  return null;
}

/** Base $ at T−60: price at node −60 or derived from price/(1+pct/100). */
function baseM60Usd(
  points: ChartPoint[],
  field: PriceField,
  includeRecalibExtras: boolean
): number | null {
  const sorted = [...points].sort((a, b) => {
    const [a0, a1] = pointSortKey(a);
    const [b0, b1] = pointSortKey(b);
    return a0 - b0 || a1 - b1;
  });
  const anchor =
    sorted.find(
      (p) =>
        p.offset === -60 &&
        includeChartNode(p, { includeRecalibExtras }),
    ) ?? null;
  if (anchor) {
    const px = anchor[field];
    const pct = pctForPriceField(anchor, field);
    if (px != null && px === px && px > 0) {
      if (pct == null || Math.abs(pct) < 1e-9) return Number(px);
      return Number(px) / (1 + pct / 100);
    }
  }
  for (const p of sorted) {
    if (!includeChartNode(p, { includeRecalibExtras })) continue;
    const px = p[field];
    const pct = pctForPriceField(p, field);
    if (px == null || px !== px || px <= 0 || pct == null) continue;
    const base = Number(px) / (1 + pct / 100);
    if (base > 0 && base === base) return base;
  }
  return null;
}

function priceFromPct(base: number, pct: number): number {
  return roundPrice(base * (1 + pct / 100));
}

function priceSpreadPct(rows: PriceChartRow[]): number {
  if (rows.length < 2) return 0;
  const ys = rows.map((r) => r.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  if (min <= 0) return 0;
  return ((max - min) / min) * 100;
}

function yDomainForRows(rows: PriceChartRow[]): [number, number] {
  const ys = rows.flatMap((r) => {
    const sd = r.ySd ?? 0;
    return [roundPrice(r.y - sd), roundPrice(r.y + sd)];
  });
  if (!ys.length) return [0, 1];
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.015, 0.01);
    return [roundPrice(min - pad), roundPrice(max + pad)];
  }
  const span = max - min;
  const pad = Math.max(span * 0.12, Math.abs(min) * 0.002, 0.01);
  return [roundPrice(min - pad), roundPrice(max + pad)];
}

/**
 * Compute Y domain for the % chart from ALL sources: merged line data,
 * K-8 markers, AI feed markers, and "now" interpolation dots.
 * Without this, Recharts auto-domain ignores Scatter points and clips them.
 */
function yDomainAllSources(
  data: Record<string, string | number>[],
  extra: { y: number }[],
): [number, number] {
  const ys: number[] = [];
  for (const row of data) {
    for (const [k, v] of Object.entries(row)) {
      if (k === "offset" || k === "xLabel") continue;
      if (typeof v === "number" && Number.isFinite(v)) ys.push(v);
    }
  }
  for (const m of extra) {
    if (Number.isFinite(m.y)) ys.push(m.y);
  }
  if (!ys.length) return [-5, 5];
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.15, 1);
    return [min - pad, max + pad];
  }
  const span = max - min;
  const pad = Math.max(span * 0.12, 0.5);
  return [
    Math.round((min - pad) * 100) / 100,
    Math.round((max + pad) * 100) / 100,
  ];
}

/** Two series with prices on very different scales (e.g. ANIK ~15 vs TELA ~1). */
function needsDualPriceAxis(
  series: { rows: PriceChartRow[]; id: string }[]
): boolean {
  const active = series.filter((s) => s.rows.length >= 2);
  if (active.length < 2) return false;
  const mids = active
    .map((s) => {
      const ys = s.rows.map((r) => r.y);
      return (Math.min(...ys) + Math.max(...ys)) / 2;
    })
    .filter((m) => m > 0);
  if (mids.length < 2) return false;
  const lo = Math.min(...mids);
  const hi = Math.max(...mids);
  return hi / lo > 4;
}

/** Aligns $ charts with the DPG engine (`_xy_price_from_points`): one point per row, without aggregating by offset. */
export function pricePointsFromSeries(
  points: ChartPoint[],
  field: PriceField,
  opts: { includeRecalibExtras?: boolean; includeK8?: boolean; standardOnly?: boolean } = {}
): PriceChartRow[] {
  const includeRecalibExtras =
    opts.includeRecalibExtras ?? opts.includeK8 ?? false;
  const standardOnly = opts.standardOnly ?? false;
  const sorted = [...points].sort((a, b) => {
    const [a0, a1] = pointSortKey(a);
    const [b0, b1] = pointSortKey(b);
    return a0 - b0 || a1 - b1;
  });
  const base = baseM60Usd(sorted, field, includeRecalibExtras && !standardOnly);
  const rows: PriceChartRow[] = [];
  for (const p of sorted) {
    if (!includeChartNode(p, { standardOnly, includeRecalibExtras })) continue;
    let v = p[field];
    if ((v == null || v !== v) && base != null) {
      const pct = pctForPriceField(p, field);
      if (pct != null) v = priceFromPct(base, pct);
    }
    if (v == null || v !== v) continue;
    rows.push({
      x: p.offset,
      y: roundPrice(Number(v)),
      xLabel: offsetLabel(p.offset),
    });
  }
  return rows;
}

export type CurveLineSpec = {
  id: string;
  label: string;
  color: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  field: keyof Pick<
    ChartPoint,
    "pct_curva" | "pct_foglio" | "pct_modello" | "pct_modello_raw" | "pct_reale" | "pct_eis_plus"
  >;
};

export type ChartLineBundle = {
  spec: CurveLineSpec;
  points: ChartPoint[];
  /** «Today» offset (days from CD) for this ticker. */
  nowOffset?: number | null;
};

export type PriceLineBundle = {
  id: string;
  label: string;
  color: string;
  points: ChartPoint[];
  nowOffset?: number | null;
};

function pointsToRows(
  points: ChartPoint[],
  field: CurveLineSpec["field"],
  opts: { includeRecalibExtras?: boolean } = {}
): { offset: number; xLabel: string; y: number }[] {
  const includeRecalibExtras = opts.includeRecalibExtras ?? true;
  return points
    .filter((p) => includeChartNode(p, { includeRecalibExtras }))
    .map((p) => {
      let raw = p[field];
      if (field === "pct_modello_raw" && (raw == null || raw !== raw)) {
        raw = p.pct_modello;
      }
      if (field === "pct_foglio" && (raw == null || raw !== raw)) {
        raw = p.pct_curva;
      }
      if (field === "pct_eis_plus" && (raw == null || raw !== raw)) {
        raw = p.pct_foglio ?? p.pct_curva;
      }
      if ((raw == null || raw !== raw) && isRecalibExtraNode(p)) {
        raw = p.pct_reale ?? p.pct_curva;
      }
      return { p, raw };
    })
    .filter(({ raw }) => raw != null && raw === raw)
    .map(({ p, raw }) => ({
      offset: p.offset,
      xLabel: p.offset > 0 ? `+${p.offset}` : String(p.offset),
      y: Number(raw),
    }))
    .sort((a, b) => a.offset - b.offset);
}

function fmtPctAxis(v: number): string {
  return fmtAxisPctTick(v);
}

function CurveTooltipBody({
  label,
  payload,
  onOpenSecK8,
}: {
  label?: string;
  payload?: { dataKey?: string; value?: number; payload?: Record<string, unknown> }[];
  onOpenSecK8?: (ticker: string) => void;
}) {
  if (!payload?.length) return null;
  const aiFeed = payload.find((p) => {
    const pl = p.payload as AiFeedChartMarker | undefined;
    return pl != null && typeof pl.session === "number" && pl.session >= 1;
  })?.payload as AiFeedChartMarker | undefined;

  if (aiFeed) {
    return (
      <div className={`${CHART_CURVES_TOOLTIP} max-w-[260px]`}>
        <p className={CHART_CURVES_TOOLTIP_TITLE}>{aiFeed.ticker} · {aiFeed.label}</p>
        <p className={`${CHART_CURVES_TOOLTIP_MUTED} mt-0.5 text-[10px] leading-snug`}>{aiFeed.eventTitle}</p>
        <p className={`${CHART_CURVES_TOOLTIP_MUTED} mt-0.5`}>Days from CD: {aiFeed.offset > 0 ? `+${aiFeed.offset}` : aiFeed.offset}</p>
        <p className="tabular-nums mt-1">Δ% at publication: {fmtPctAxis(aiFeed.y)}%</p>
        {aiFeed.verified && (
          <p className="text-[10px] font-semibold mt-1" style={{ color: "#16a34a" }}>
            ✓ {referenceMatchLabel(aiFeed.referenceMatch, false)}
          </p>
        )}
        {aiFeed.eventDate && <p className={`text-[10px] ${CHART_CURVES_TOOLTIP_MUTED} mt-0.5`}>Event: {aiFeed.eventDate}</p>}
        {aiFeed.link && (
          <button
            type="button"
            className="text-accent hover:underline text-[10px] mt-2 block"
            onClick={(e) => openExternalUrl(aiFeed.link!, e)}
          >
            Source →
          </button>
        )}
      </div>
    );
  }

  const k8 = payload.find((p) => {
    const pl = p.payload as K8ChartMarker | undefined;
    return pl != null && typeof pl.k8Session === "number" && pl.k8Session >= 1;
  })?.payload as K8ChartMarker | undefined;

  if (k8) {
    return (
      <div className={`${CHART_CURVES_TOOLTIP} max-w-[240px]`}>
        <p className={CHART_CURVES_TOOLTIP_TITLE}>{k8.ticker} · {k8.label}</p>
        <p className={`${CHART_CURVES_TOOLTIP_MUTED} mt-0.5`}>Days from CD: {k8.offset > 0 ? `+${k8.offset}` : k8.offset}</p>
        <p className="tabular-nums mt-1">Δ% historical: {fmtPctAxis(k8.y)}%</p>
        {k8.filingDate && <p className={`text-[10px] ${CHART_CURVES_TOOLTIP_MUTED} mt-0.5`}>Filing: {k8.filingDate}</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          {k8.edgarHref && (
            <button
              type="button"
              className="text-accent hover:underline text-[10px]"
              onClick={(e) => openExternalUrl(k8.edgarHref!, e)}
            >
              Read SEC filing →
            </button>
          )}
          {k8.browseHref && (
            <button
              type="button"
              className="text-accent hover:underline text-[10px]"
              onClick={(e) => openExternalUrl(k8.browseHref!, e)}
            >
              8-K list →
            </button>
          )}
          {onOpenSecK8 && (
            <button
              type="button"
              className="text-accent hover:underline text-[10px]"
              onClick={(e) => {
                e.preventDefault();
                onOpenSecK8(k8.ticker);
              }}
            >
              SEC 8-K sheet →
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={CHART_CURVES_TOOLTIP}>
      <p className={`${CHART_CURVES_TOOLTIP_MUTED} mb-1`}>Days from CD: {label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="tabular-nums">
          <span style={{ color: (p as { color?: string }).color }}>{p.dataKey}: </span>
          {fmtPctAxis(Number(p.value))}%
        </p>
      ))}
    </div>
  );
}

function mergeRows(
  specs: { spec: CurveLineSpec; points: ChartPoint[] }[],
  includeRecalibExtras = true
): Record<string, string | number>[] {
  const byOff = new Map<number, Record<string, string | number>>();
  for (const { spec, points } of specs) {
    for (const row of pointsToRows(points, spec.field, { includeRecalibExtras })) {
      let rec = byOff.get(row.offset);
      if (!rec) {
        rec = { offset: row.offset, xLabel: row.xLabel };
        byOff.set(row.offset, rec);
      }
      rec[spec.id] = row.y;
    }
  }
  return [...byOff.values()].sort(
    (a, b) => Number(a.offset) - Number(b.offset)
  );
}

function buildNowPctDots(active: ChartLineBundle[]): NowCurveDot[] {
  const dots: NowCurveDot[] = [];
  const dotFields = new Set<CurveLineSpec["field"]>([
    "pct_foglio",
    "pct_curva",
    "pct_modello",
    "pct_reale",
    "pct_eis_plus",
  ]);
  for (const { spec, points, nowOffset } of active) {
    if (!dotFields.has(spec.field)) continue;
    if (nowOffset == null || !Number.isFinite(nowOffset)) continue;
    const rows = pointsToRows(points, spec.field, { includeRecalibExtras: true });
    const y = interpolateAtOffset(
      rows.map((r) => ({ offset: r.offset, y: r.y })),
      nowOffset
    );
    if (y == null) continue;
    dots.push({ offset: nowOffset, y, id: spec.id });
  }
  return dots;
}

export function SimulationCurveChart({
  title,
  lines,
  k8Markers = [],
  aiFeedMarkers = [],
  nowMarkers = [],
  yLabel = "% vs T−60",
  height = 280,
  onOpenSecK8,
  includeRecalibExtrasInCurves = true,
}: {
  title: string;
  lines: ChartLineBundle[];
  /** Historical Δ% markers post K-8 (sessions +1/+2/+3). */
  k8Markers?: K8ChartMarker[];
  /** AI feed publication recalibration knots (violet ▲). */
  aiFeedMarkers?: AiFeedChartMarker[];
  /** Vertical «today» line on the CD calendar (from Simulation Completion Date). */
  nowMarkers?: NowOffsetMarker[];
  yLabel?: string;
  height?: number;
  onOpenSecK8?: (ticker: string) => void;
  /** Include standard grid + K-8 +1/+2/+3 + AI pub +1/+2/+3 in % line paths (not only scatter). */
  includeRecalibExtrasInCurves?: boolean;
}) {
  const active = lines.filter((l) => l.points?.length);
  const data = mergeRows(active, includeRecalibExtrasInCurves);
  const k8Active = k8Markers.filter((m) => Number.isFinite(m.y));
  const aiFeedActive = aiFeedMarkers.filter((m) => Number.isFinite(m.y));
  const nowDots = buildNowPctDots(active);
  const legendPayload = [
    ...active.map(({ spec }) => ({
      value: spec.label,
      type: "line" as const,
      color: spec.color,
      id: spec.id,
    })),
    ...(nowDots.length
      ? [{ value: "📍 Today on curve", type: "circle" as const, color: NOW_MARKER_FILL, id: "now-legend" }]
      : []),
    ...(k8Active.length
      ? [{ value: "8-K post-filing (historical Δ%)", type: "diamond" as const, color: "#f59e0b", id: "k8-legend" }]
      : []),
    ...(aiFeedActive.length
      ? [{ value: "AI feed · ref. verificata (▲✓)", type: "triangle" as const, color: AI_FEED_MARKER_COLOR, id: "aifeed-legend" }]
      : []),
  ];
  const allOffsets = [
    ...data.map((d) => Number(d.offset)),
    ...k8Active.map((m) => m.offset),
    ...aiFeedActive.map((m) => m.offset),
    ...nowMarkers.map((m) => m.offset),
    ...nowDots.map((d) => d.offset),
  ];
  const [xMin, xMax] = extendXDomain(
    allOffsets.length ? Math.min(...allOffsets) : -60,
    allOffsets.length ? Math.max(...allOffsets) : 7,
    nowMarkers
  );
  const yDomain = yDomainAllSources(data, [...k8Active, ...aiFeedActive, ...nowDots]);

  if (data.length < 2 && k8Active.length === 0 && aiFeedActive.length === 0) {
    return (
      <div className={CHART_CURVES_PANEL_EMPTY}>
        <h3 className={CHART_CURVES_TITLE_SIMPLE}>{title}</h3>
        <p className={CHART_CURVES_EMPTY_MSG}>
          Not enough data for the chart (at least 2 nodes are required).
        </p>
      </div>
    );
  }

  return (
    <div className={CHART_CURVES_PANEL_PAD}>
      <h3 className={CHART_CURVES_TITLE}>{title}</h3>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: nowMarkers.length ? 20 : 8, right: 12, left: 4, bottom: 4 }}
          >
            {renderCdZones({
              cdX: 0,
              xMin,
              xMax,
              todayX: null,
              hideBadges: true,
            })}
            <CartesianGrid {...CHART_CURVES_GRID} />
            <XAxis
              type="number"
              dataKey="offset"
              domain={[xMin, xMax]}
              tick={CHART_CURVES_AXIS_TICK}
              tickFormatter={(v) => offsetLabel(Number(v))}
            />
            <YAxis tick={CHART_CURVES_AXIS_TICK} tickFormatter={fmtPctAxis} unit="%" width={48} domain={yDomain} />
            <ChartNowMarkersLayer markers={nowMarkers} />
            <Tooltip
              content={({ label, payload }) => (
                <CurveTooltipBody
                  label={typeof label === "number" ? offsetLabel(label) : String(label ?? "")}
                  payload={payload as Parameters<typeof CurveTooltipBody>[0]["payload"]}
                  onOpenSecK8={onOpenSecK8}
                />
              )}
            />
            <Legend
              payload={legendPayload}
              {...chartCurvesLegendStyle({
                maxHeight: active.length + k8Active.length + aiFeedActive.length > 8 ? 88 : undefined,
                overflowY: active.length + k8Active.length + aiFeedActive.length > 8 ? "auto" : undefined,
              })}
            />
            {active.map(({ spec }) => (
              <Line
                key={spec.id}
                type="monotone"
                dataKey={spec.id}
                name={spec.label}
                stroke={spec.color}
                strokeWidth={spec.strokeWidth ?? 2}
                strokeDasharray={spec.strokeDasharray}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
            {nowDots.map((d) => (
              <ReferenceDot
                key={`now-curve-${d.id}`}
                x={d.offset}
                y={d.y}
                ifOverflow="extendDomain"
                isFront
                shape={(props: { cx?: number; cy?: number }) => (
                  <NowCurvePinShape cx={props.cx} cy={props.cy} />
                )}
              />
            ))}
            {k8Active.length > 0 && (
              <Scatter
                data={k8Active}
                dataKey="y"
                name="8-K post-filing (historical Δ%)"
                legendType="none"
                shape={(props: { cx?: number; cy?: number; payload?: K8ChartMarker }) => (
                  <K8DiamondShape cx={props.cx} cy={props.cy} payload={props.payload} />
                )}
              />
            )}
            {aiFeedActive.length > 0 && (
              <Scatter
                data={aiFeedActive}
                dataKey="y"
                name="AI feed publication (recalibration)"
                legendType="none"
                shape={(props: { cx?: number; cy?: number; payload?: AiFeedChartMarker }) => (
                  <AiFeedTriangleShape cx={props.cx} cy={props.cy} payload={props.payload} />
                )}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className={CHART_CURVES_FOOTER}>
        {yLabel}
        {nowMarkers.length > 0
          ? " · 📍 pin = today on the CD calendar · value on the visible curve at today"
          : ""}
        {k8Active.length > 0
          ? " · ◆ = historical Δ% post 8-K (color = ticker pred curve · tooltip → SEC)"
          : ""}
        {aiFeedActive.length > 0
          ? " · ▲ viola + ✓ verde = pubblicazione clinica con referenza verificata (società/farmaco)"
          : ""}
      </p>
    </div>
  );
}

export function VariationHorizonChart({
  title,
  series,
  height = 180,
}: {
  title: string;
  series: {
    id: string;
    label: string;
    color: string;
    horizons: { label: string; pct: number | null }[];
  }[];
  height?: number;
}) {
  const labels = [...SIM_VAR_HORIZON_LABELS];
  const data = labels.map((lab, i) => {
    const row: Record<string, string | number> = { horizon: lab, idx: i };
    for (const s of series) {
      const pct = resolveVarHorizonPct(s.horizons, lab);
      if (pct != null) row[s.id] = pct;
    }
    return row;
  });

  const hasData = series.some((s) =>
    labels.some((lab) => resolveVarHorizonPct(s.horizons, lab) != null),
  );

  const longHorizonsMissing = series.every((s) =>
    (["6M", "3M", "1M"] as const).every(
      (lab) => resolveVarHorizonPct(s.horizons, lab) == null,
    ),
  );

  if (!hasData) {
    return (
      <div className={CHART_CURVES_PANEL_EMPTY}>
        <h3 className={CHART_CURVES_TITLE_SIMPLE}>{title}</h3>
        <p className={`${CHART_CURVES_EMPTY_MSG} py-4`}>
          Variations not available (6M / 3M / 1M / 1d empty in Simulation — run
          fetch_variations or refresh data).
        </p>
      </div>
    );
  }

  return (
    <div className={CHART_CURVES_PANEL}>
      <h3 className={CHART_CURVES_TITLE_SIMPLE}>{title}</h3>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid {...CHART_CURVES_GRID} />
            <XAxis dataKey="horizon" tick={CHART_CURVES_AXIS_TICK} />
            <YAxis tick={CHART_CURVES_AXIS_TICK} tickFormatter={(v) => `${fmtAxisPctTick(v)}%`} width={44} />
            <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, ""]} />
            <Legend
              {...chartCurvesLegendStyle({
                maxHeight: series.length > 8 ? 88 : undefined,
                overflowY: series.length > 8 ? "auto" : undefined,
              })}
            />
            {series.map((s) => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={s.id}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {longHorizonsMissing ? (
        <p className={CHART_CURVES_FOOTER}>
          6M · 3M · 1M missing — often no Yahoo price history in variations.json;
          only daily % may appear after refresh.
        </p>
      ) : null}
    </div>
  );
}

function buildNowPriceDots(
  active: { id: string; rows: PriceChartRow[]; nowOffset?: number | null }[]
): { x: number; y: number; id: string }[] {
  const dots: { x: number; y: number; id: string }[] = [];
  for (const s of active) {
    if (s.nowOffset == null || !Number.isFinite(s.nowOffset)) continue;
    const y = interpolateAtOffset(
      s.rows.map((r) => ({ offset: r.x, y: r.y })),
      s.nowOffset
    );
    if (y == null) continue;
    dots.push({ x: s.nowOffset, y, id: s.id });
  }
  return dots;
}

// Alternative palette for the "overlay" series (e.g. recalibrated path drawn
// on top of historical closes). Picked to contrast with the primary palette
// used in seriesColor() / MULTI_PALETTE so that the two lines for the same
// ticker remain visually distinct.
const OVERLAY_PALETTE = [
  "#10b981", // emerald
  "#a855f7", // purple
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#ef4444", // red
  "#0ea5e9", // sky
];

function pickOverlayColor(baseColor: string, idx: number): string {
  const base = (baseColor || "").toLowerCase();
  for (let off = 0; off < OVERLAY_PALETTE.length; off++) {
    const cand = OVERLAY_PALETTE[(idx + off) % OVERLAY_PALETTE.length];
    if (cand.toLowerCase() !== base) return cand;
  }
  return OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length];
}

export function PricePathChart({
  title,
  lines,
  field,
  height = 200,
  mode = "series",
  standardNodesOnly = false,
  aggregateByOffset = false,
  nowMarkers = [],
  indexNormalized = false,
  overlayField,
  primaryLabel,
  overlayLabel,
  primaryColorOverride,
  overlayColorOverride,
}: {
  title: string;
  lines: PriceLineBundle[];
  field: PriceField;
  height?: number;
  /** ``portfolio-mean``: a single μ±σ curve (index T−60=100) across tickers. */
  mode?: PricePathChartMode;
  /** Only calendar nodes (no K-8) — less cluttered on multi-ticker. */
  standardNodesOnly?: boolean;
  /** One point per offset (mean if multiple K-8 on the same day). */
  aggregateByOffset?: boolean;
  nowMarkers?: NowOffsetMarker[];
  /**
   * Normalize every series to index T−60=100.
   * Removes the dual Y axis when absolute prices are on different scales.
   * Automatically applied in "series" mode with more than one ticker.
   */
  indexNormalized?: boolean;
  /**
   * Optional second field to draw on the same chart. When set, every line is
   * rendered twice: once with ``field`` (solid, base color) and once with
   * ``overlayField`` (dashed, contrasting color from {@link OVERLAY_PALETTE}).
   *
   * Use to compare historical closes ("price_storico_usd") with the
   * recalibrated path ("price_usd") on a single chart instead of stacking two.
   */
  overlayField?: PriceField;
  /** Suffix appended to legend label of primary series (e.g. "historical"). */
  primaryLabel?: string;
  /** Suffix appended to legend label of overlay series (e.g. "recalibrated path (+ K-8)"). */
  overlayLabel?: string;
  /**
   * Force a fixed color for every primary series, overriding the per-ticker
   * palette. Use for single-ticker overlay charts where the goal is to make
   * the two curves (primary vs overlay) stand out by color, not by ticker.
   */
  primaryColorOverride?: string;
  /**
   * Force a fixed color for every overlay series (paired with
   * {@link primaryColorOverride}). Ignored when ``overlayField`` is not set.
   */
  overlayColorOverride?: string;
}) {
  // Include K-8 nodes (SEC filings with real price at filing) also for the
  // historical curve: tickers with a future CD often only have the T-60 standard
  // node before "today", and without the K-8 we would end up with 1 single
  // point → curve discarded (>=2 required). The K-8 provide real historical
  // prices at filing dates, which is exactly what "historical closes" shows.
  const includeRecalibExtras = !standardNodesOnly;
  const includeK8Overlay =
    includeRecalibExtras &&
    overlayField != null &&
    (overlayField === "price_usd" || overlayField === "price_storico_usd");
  const includeK8Primary =
    includeRecalibExtras &&
    (field === "price_usd" || field === "price_storico_usd") &&
    !standardNodesOnly;
  const usePortfolio = mode === "portfolio-mean" && lines.length >= 2;
  // Index-normalize when explicitly requested OR in series mode with multiple tickers
  const doIndex = indexNormalized || (!usePortfolio && lines.length > 1);
  const hasOverlay = !!overlayField && !usePortfolio;

  // Build rows for a given (field, includeK8) — used both for the primary and
  // the overlay series so the same line is rendered twice with two metrics.
  const buildRows = (
    points: PriceLineBundle["points"],
    fld: PriceField,
    recalibExtras: boolean,
  ): PriceChartRow[] => {
    let rows = pricePointsFromSeries(points, fld, {
      includeRecalibExtras: recalibExtras,
      standardOnly: standardNodesOnly,
    });
    if (aggregateByOffset || recalibExtras) {
      rows = aggregateRowsByOffset(rows);
    }
    if (doIndex) rows = normalizeSeriesToIndex(rows);
    return rows;
  };

  type PathSeries = PriceLineBundle & {
    rows: PriceChartRow[];
    /** ``true`` = overlay series (dashed, contrasting color). */
    isOverlay?: boolean;
  };

  const seriesData: PathSeries[] = usePortfolio
    ? [
        {
          id: "portfolio_mean",
          label: `Portfolio mean (n=${lines.length})`,
          color: "#00dc96",
          points: [],
          rows: portfolioMeanRows(lines, field, { standardOnly: true }),
        } as PathSeries,
      ]
    : lines.flatMap((l, idx): PathSeries[] => {
        const primaryLabelText = primaryLabel
          ? `${l.label.split(" · historical")[0].split(" · path")[0]} · ${primaryLabel}`
          : l.label;
        const primary: PathSeries = {
          ...l,
          label: primaryLabelText,
          color: primaryColorOverride ?? l.color,
          rows: buildRows(l.points, field, includeK8Primary),
        };
        if (!hasOverlay || !overlayField) return [primary];
        const overlayColor =
          overlayColorOverride ?? pickOverlayColor(l.color, idx);
        const overlayLabelText = overlayLabel
          ? `${l.label.split(" · historical")[0].split(" · path")[0]} · ${overlayLabel}`
          : `${l.label} · overlay`;
        const overlay: PathSeries = {
          ...l,
          id: `${l.id}_ov`,
          label: overlayLabelText,
          color: overlayColor,
          rows: buildRows(l.points, overlayField, includeK8Overlay),
          isOverlay: true,
        };
        return [primary, overlay];
      });

  const active = seriesData.filter((s) => s.rows.length >= 2);
  // List of excluded series (for a diagnostic message in the UI when the chart
  // displays fewer lines than the user selected).
  const excluded = usePortfolio
    ? []
    : seriesData
        .filter((s) => s.rows.length < 2)
        .map((s) => ({
          id: s.id,
          label: s.label,
          reason:
            s.rows.length === 0
              ? "no historical price available"
              : "only 1 historical point (≥ 2 required to draw a line)",
        }));
  const allX = [
    ...active.flatMap((s) => s.rows.map((r) => r.x)),
    ...lines.map((l) => l.nowOffset).filter((x): x is number => x != null && Number.isFinite(x)),
  ];
  // With index normalization the dual Y axis is never needed
  const dualAxis = !usePortfolio && !doIndex && needsDualPriceAxis(active);
  const flatSeries = active.filter((s) => priceSpreadPct(s.rows) < 0.75);
  const allFlat = active.length > 0 && flatSeries.length === active.length;

  if (active.length === 0 || allX.length < 2) {
    return (
      <div className={CHART_CURVES_PANEL_EMPTY}>
        <h3 className={CHART_CURVES_TITLE_SIMPLE}>{title}</h3>
        <p className={`${CHART_CURVES_EMPTY_MSG} py-4`}>Prices not available.</p>
      </div>
    );
  }

  const [xMin, xMax] = extendXDomain(Math.min(...allX), Math.max(...allX), nowMarkers);
  const nowDots = buildNowPriceDots(active);
  const priceLegendPayload = [
    ...active.map((s) => ({
      value: s.label,
      type: "line" as const,
      color: s.color,
      id: s.id,
    })),
    ...(nowDots.length
      ? [{ value: "📍 Today", type: "circle" as const, color: NOW_MARKER_FILL, id: "now-legend" }]
      : []),
  ];
  const allPriceRows: PriceChartRow[] = [
    ...active.flatMap((s) => s.rows),
    ...nowDots.map((d) => ({ x: d.x, y: d.y, xLabel: String(d.x) })),
  ];
  const sharedDomain = dualAxis
    ? undefined
    : yDomainForRows(allPriceRows);

  return (
    <div className={CHART_CURVES_PANEL}>
      <h3 className={CHART_CURVES_TITLE_SIMPLE}>{title}</h3>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartXAnchorRows(xMin, xMax)}
            margin={{ top: nowMarkers.length ? 24 : 8, right: dualAxis ? 48 : 12, left: 48, bottom: 4 }}
          >
            {renderCdZones({
              cdX: 0,
              xMin,
              xMax,
              todayX: null,
              hideBadges: true,
            })}
            <CartesianGrid {...CHART_CURVES_GRID} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[xMin, xMax]}
              tick={CHART_CURVES_AXIS_TICK}
              tickFormatter={(v) => offsetLabel(Number(v))}
            />
            <ChartNowMarkersLayer markers={nowMarkers} />
            {dualAxis ? (
              <>
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tick={CHART_CURVES_AXIS_TICK}
                  tickFormatter={fmtPriceAxis}
                  allowDecimals
                  width={52}
                  domain={yDomainForRows(active[0]?.rows ?? [])}
                  stroke={active[0]?.color}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={CHART_CURVES_AXIS_TICK}
                  tickFormatter={fmtPriceAxis}
                  allowDecimals
                  width={52}
                  domain={yDomainForRows(active[1]?.rows ?? active[0]?.rows ?? [])}
                  stroke={active[1]?.color ?? active[0]?.color}
                />
              </>
            ) : (
              <YAxis
                tick={CHART_CURVES_AXIS_TICK}
                tickFormatter={fmtPriceAxis}
                allowDecimals
                width={52}
                domain={sharedDomain}
                allowDataOverflow
              />
            )}
            <Tooltip
              formatter={(v: number, _name: string, item) => {
                const row = item?.payload as PriceChartRow | undefined;
                const sd = row?.ySd;
                const val = (usePortfolio || doIndex)
                  ? `${fmtPriceAxis(v)} idx`
                  : `$${v.toFixed(2)}`;
                if (sd != null && sd > 0) {
                  return [`${val} ± ${sd.toFixed(2)} idx`, ""];
                }
                return [val, ""];
              }}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as PriceChartRow | undefined;
                if (!row) return "";
                const nNote = row.n && row.n > 1 ? ` · n=${row.n}` : "";
                return `Days from CD: ${row.xLabel}${nNote}`;
              }}
            />
            <Legend
              payload={priceLegendPayload}
              wrapperStyle={{
                fontSize: 11,
                maxHeight: active.length > 8 ? 88 : undefined,
                overflowY: active.length > 8 ? "auto" : undefined,
              }}
            />
            {active.map((s, idx) => {
              const showErr = s.rows.some((r) => (r.ySd ?? 0) > 0);
              const isOv = !!s.isOverlay;
              return (
                <Line
                  key={s.id}
                  data={s.rows}
                  type="monotone"
                  dataKey="y"
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={usePortfolio ? 2.5 : isOv ? 1.8 : 2}
                  strokeDasharray={isOv ? "6 4" : undefined}
                  dot={{ r: showErr ? 4 : isOv ? 1.6 : 2 }}
                  opacity={isOv ? 0.92 : 1}
                  connectNulls
                  yAxisId={dualAxis ? (idx === 0 ? "left" : "right") : undefined}
                >
                  {showErr && (
                    <ErrorBar
                      dataKey="yErr"
                      width={10}
                      strokeWidth={1.5}
                      stroke={s.color}
                      opacity={0.55}
                    />
                  )}
                </Line>
              );
            })}
            {nowDots.map((d) => {
              const sIdx = active.findIndex((s) => s.id === d.id);
              return (
                <ReferenceDot
                  key={`now-price-${d.id}`}
                  x={d.x}
                  y={d.y}
                  yAxisId={dualAxis ? (sIdx === 0 ? "left" : "right") : undefined}
                  ifOverflow="extendDomain"
                  isFront
                  shape={(props: { cx?: number; cy?: number }) => (
                    <NowCurvePinShape cx={props.cx} cy={props.cy} />
                  )}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {nowMarkers.length > 0 && (
        <p className={CHART_CURVES_FOOTER}>
          📍 Orange pin = today's position on the CD calendar (days from Completion Date).
        </p>
      )}
      {usePortfolio && (
        <p className={CHART_CURVES_FOOTER}>
          Index T−60 = 100 for each ticker; line = portfolio mean on recalibration nodes (bars = ±1 σ).
        </p>
      )}
      {doIndex && !usePortfolio && (
        <p className={CHART_CURVES_FOOTER}>
          Index T−60 = 100 for each ticker — prices normalized for comparison on a common scale (single Y axis).
        </p>
      )}
      {allFlat && (
        <p className={CHART_CURVES_FOOTER}>
          $ curve nearly flat: variation &lt;0.75% across nodes — the Δ% vs T−60 are very small or
          the historical price is constant. Use the % chart above to see relative movement.
        </p>
      )}
      {(includeK8Primary || includeK8Overlay) && !usePortfolio && (
        <p className={CHART_CURVES_FOOTER}>
          8-K nodes aggregated by offset (mean ± σ if multiple filings on the same day).
          AI feed nodes = verified publication sessions (T…T+3) on the recalibrated path.
        </p>
      )}
      {hasOverlay && (
        <p className={CHART_CURVES_FOOTER}>
          Solid line = <span className="font-medium">{primaryLabel ?? field}</span>; dashed line = <span className="font-medium">{overlayLabel ?? overlayField}</span> (same ticker, contrasting color).
        </p>
      )}
      {excluded.length > 0 && (
        <p className="text-[10px] text-warn mt-1">
          ⚠ {active.length}/{active.length + excluded.length} tickers drawn. Excluded:{" "}
          {excluded.map((e) => `${e.label.split(" · ")[0]} (${e.reason})`).join(", ")}
          {field === "price_storico_usd" && (
            <> · For tickers with a future CD and no recent 8-K filing the historical
            prices may be insufficient.</>
          )}
        </p>
      )}
    </div>
  );
}
