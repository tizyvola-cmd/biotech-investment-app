import {
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint } from "../types";
import type { K8ChartMarker } from "../sheet/k8ChartLinks";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import {
  interpolateAtOffset,
  type NowOffsetMarker,
} from "../sheet/chartNowOffset";
import { SIM_VAR_HORIZON_LABELS } from "../sheet/simulationStyles";

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
  /** Deviazione standard (aggregazione per offset o portafoglio). */
  ySd?: number;
  /** ErrorBar Recharts: [sdDown, sdUp]. */
  yErr?: [number, number];
  n?: number;
};

export type PricePathChartMode = "series" | "portfolio-mean";

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

/** Più punti (es. K-8) sullo stesso offset → media ± SD. */
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
 * Media portafoglio su nodi standard: indice T−60 = 100 per ticker, poi μ ± σ tra ticker.
 */
function portfolioMeanRows(
  lines: { points: ChartPoint[] }[],
  field: PriceField,
  opts: { standardOnly: boolean }
): PriceChartRow[] {
  const byOffset = new Map<number, number[]>();

  for (const line of lines) {
    const raw = pricePointsFromSeries(line.points, field, {
      includeK8: field === "price_usd" && !opts.standardOnly,
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
  if (p.sort?.length === 2) return [p.sort[0], p.sort[1]];
  const nodo = p.nodo ?? "standard";
  const tier = nodo === "K-8" ? 1 : 0;
  return [tier, p.offset];
}

function offsetLabel(offset: number): string {
  return offset > 0 ? `+${offset}` : String(offset);
}

const NOW_LINE_STROKE = "rgb(var(--warn))";
const NOW_DOT_FILL = "#f59e0b";

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
          stroke={NOW_LINE_STROKE}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          ifOverflow="extendDomain"
          label={{
            value: m.label,
            position: "insideTopLeft",
            fontSize: 9,
            fill: NOW_LINE_STROKE,
          }}
        />
      ))}
    </>
  );
}

function pctForPriceField(p: ChartPoint, field: PriceField): number | null {
  for (const key of PCT_FOR_PRICE[field]) {
    const raw = p[key];
    if (raw != null && raw === raw) return Number(raw);
  }
  return null;
}

/** Base $ a T−60: prezzo al nodo −60 oppure ricavato da prezzo/(1+pct/100). */
function baseM60Usd(
  points: ChartPoint[],
  field: PriceField,
  includeK8: boolean
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
        (includeK8 || (p.nodo ?? "standard") === "standard")
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
    const nodo = p.nodo ?? "standard";
    if (!includeK8 && nodo !== "standard") continue;
    if (includeK8 && nodo !== "standard" && nodo !== "K-8") continue;
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

/** Due serie con prezzi su scale molto diverse (es. ANIK ~15 vs TELA ~1). */
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

/** Allinea i grafici $ al motore DPG (`_xy_price_from_points`): un punto per riga, senza aggregare per offset. */
export function pricePointsFromSeries(
  points: ChartPoint[],
  field: PriceField,
  opts: { includeK8?: boolean; standardOnly?: boolean } = {}
): PriceChartRow[] {
  const includeK8 = opts.includeK8 ?? false;
  const standardOnly = opts.standardOnly ?? false;
  const sorted = [...points].sort((a, b) => {
    const [a0, a1] = pointSortKey(a);
    const [b0, b1] = pointSortKey(b);
    return a0 - b0 || a1 - b1;
  });
  const base = baseM60Usd(sorted, field, includeK8);
  const rows: PriceChartRow[] = [];
  for (const p of sorted) {
    const nodo = p.nodo ?? "standard";
    if (standardOnly && nodo !== "standard") continue;
    if (!includeK8 && nodo !== "standard") continue;
    if (includeK8 && nodo !== "standard" && nodo !== "K-8") continue;
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
  field: keyof Pick<ChartPoint, "pct_curva" | "pct_foglio" | "pct_modello" | "pct_reale">;
};

function pointsToRows(
  points: ChartPoint[],
  field: CurveLineSpec["field"]
): { offset: number; xLabel: string; y: number }[] {
  return points
    .filter((p) => (p.nodo === "standard" || !p.nodo))
    .map((p) => {
      let raw = p[field];
      if (field === "pct_foglio" && (raw == null || raw !== raw)) {
        raw = p.pct_curva;
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
  if (!Number.isFinite(v)) return "";
  return (Math.round(v * 100) / 100).toFixed(2);
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
  const k8 = payload.find((p) => {
    const pl = p.payload as K8ChartMarker | undefined;
    return pl != null && typeof pl.k8Session === "number" && pl.k8Session >= 1;
  })?.payload as K8ChartMarker | undefined;

  if (k8) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))] bg-surface-elevated px-3 py-2 text-xs shadow-lg max-w-[240px]">
        <p className="font-semibold text-ink">{k8.ticker} · {k8.label}</p>
        <p className="text-ink-muted mt-0.5">Giorni da CD: {k8.offset > 0 ? `+${k8.offset}` : k8.offset}</p>
        <p className="tabular-nums mt-1">Δ% storico: {fmtPctAxis(k8.y)}%</p>
        {k8.filingDate && <p className="text-[10px] text-ink-muted mt-0.5">Filing: {k8.filingDate}</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          {k8.edgarHref && (
            <button
              type="button"
              className="text-accent hover:underline text-[10px]"
              onClick={(e) => openExternalUrl(k8.edgarHref!, e)}
            >
              Leggi filing SEC →
            </button>
          )}
          {k8.browseHref && (
            <button
              type="button"
              className="text-accent hover:underline text-[10px]"
              onClick={(e) => openExternalUrl(k8.browseHref!, e)}
            >
              Elenco 8-K →
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
              Foglio SEC K-8 →
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-surface-elevated px-3 py-2 text-xs shadow-lg">
      <p className="text-ink-muted mb-1">Giorni da CD: {label}</p>
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
  specs: { spec: CurveLineSpec; points: ChartPoint[] }[]
): Record<string, string | number>[] {
  const byOff = new Map<number, Record<string, string | number>>();
  for (const { spec, points } of specs) {
    for (const row of pointsToRows(points, spec.field)) {
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

function buildNowPctDots(
  active: { spec: CurveLineSpec; points: ChartPoint[] }[],
  markers: NowOffsetMarker[]
): { offset: number; y: number; name: string }[] {
  const dots: { offset: number; y: number; name: string }[] = [];
  const predFields = new Set<CurveLineSpec["field"]>(["pct_foglio", "pct_curva", "pct_modello"]);
  for (const { spec, points } of active) {
    if (!predFields.has(spec.field)) continue;
    for (const m of markers) {
      const rows = pointsToRows(points, spec.field);
      const y = interpolateAtOffset(
        rows.map((r) => ({ offset: r.offset, y: r.y })),
        m.offset
      );
      if (y == null) continue;
      dots.push({ offset: m.offset, y, name: `● ${spec.label}` });
    }
  }
  return dots;
}

export function SimulationCurveChart({
  title,
  lines,
  k8Markers = [],
  nowMarkers = [],
  yLabel = "% vs T−60",
  height = 280,
  onOpenSecK8,
}: {
  title: string;
  lines: { spec: CurveLineSpec; points: ChartPoint[] }[];
  /** Marker Δ% storici post K-8 (sedute +1/+2/+3). */
  k8Markers?: K8ChartMarker[];
  /** Linea verticale «oggi» sul calendario CD (da Completion Date Simulation). */
  nowMarkers?: NowOffsetMarker[];
  yLabel?: string;
  height?: number;
  onOpenSecK8?: (ticker: string) => void;
}) {
  const active = lines.filter((l) => l.points?.length);
  const data = mergeRows(active);
  const k8Active = k8Markers.filter((m) => Number.isFinite(m.y));
  const nowDots = buildNowPctDots(active, nowMarkers);
  const allOffsets = [
    ...data.map((d) => Number(d.offset)),
    ...k8Active.map((m) => m.offset),
    ...nowMarkers.map((m) => m.offset),
  ];
  const [xMin, xMax] = extendXDomain(
    allOffsets.length ? Math.min(...allOffsets) : -60,
    allOffsets.length ? Math.max(...allOffsets) : 7,
    nowMarkers
  );

  if (data.length < 2 && k8Active.length === 0) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/50 p-4">
        <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
        <p className="text-xs text-ink-muted py-6 text-center">
          Dati insufficienti per il grafico (servono almeno 2 nodi).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/50 p-3 flex flex-col min-h-0">
      <h3 className="text-sm font-semibold text-ink mb-2 shrink-0">{title}</h3>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: nowMarkers.length ? 20 : 8, right: 12, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            <XAxis
              type="number"
              dataKey="offset"
              domain={[xMin, xMax]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => offsetLabel(Number(v))}
            />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtPctAxis} unit="%" width={48} />
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
              wrapperStyle={{
                fontSize: 11,
                maxHeight: active.length + k8Active.length > 8 ? 88 : undefined,
                overflowY: active.length + k8Active.length > 8 ? "auto" : undefined,
              }}
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
            {nowDots.length > 0 && (
              <Scatter
                data={nowDots}
                dataKey="y"
                name="Posizione attuale (pred.)"
                fill={NOW_DOT_FILL}
                stroke="#fff"
                strokeWidth={1}
                legendType="circle"
              />
            )}
            {k8Active.length > 0 && (
              <Scatter
                data={k8Active}
                dataKey="y"
                name="K-8 post-filing (Δ% storico)"
                legendType="none"
                shape={(props: { cx?: number; cy?: number; payload?: K8ChartMarker }) => (
                  <K8DiamondShape cx={props.cx} cy={props.cy} payload={props.payload} />
                )}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-ink-muted mt-1 shrink-0">
        {yLabel}
        {nowMarkers.length > 0
          ? " · linea tratteggiata = oggi sul calendario CD · ● = valore pred. interpolato"
          : ""}
        {k8Active.length > 0
          ? " · ◆ = Δ% storico post K-8 (colore = curva pred del ticker · tooltip → SEC)"
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
      const h = s.horizons.find((x) => x.label === lab);
      if (h?.pct != null && h.pct === h.pct) row[s.id] = h.pct;
    }
    return row;
  });

  const hasData = series.some((s) =>
    s.horizons.some((h) => h.pct != null && h.pct === h.pct)
  );

  if (!hasData) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/50 p-4">
        <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
        <p className="text-xs text-ink-muted py-4 text-center">Variazioni non disponibili.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/50 p-3">
      <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            <XAxis dataKey="horizon" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit="%" width={44} />
            <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, ""]} />
            <Legend
              wrapperStyle={{
                fontSize: 11,
                maxHeight: series.length > 8 ? 88 : undefined,
                overflowY: series.length > 8 ? "auto" : undefined,
              }}
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
    </div>
  );
}

function buildNowPriceDots(
  active: { id: string; label: string; rows: PriceChartRow[] }[],
  markers: NowOffsetMarker[]
): { x: number; y: number; name: string }[] {
  const dots: { x: number; y: number; name: string }[] = [];
  for (const s of active) {
    for (const m of markers) {
      const y = interpolateAtOffset(
        s.rows.map((r) => ({ offset: r.x, y: r.y })),
        m.offset
      );
      if (y == null) continue;
      dots.push({ x: m.offset, y, name: `● ${s.label}` });
    }
  }
  return dots;
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
}: {
  title: string;
  lines: { id: string; label: string; color: string; points: ChartPoint[] }[];
  field: PriceField;
  height?: number;
  /** ``portfolio-mean``: una curva μ±σ (indice T−60=100) tra i ticker. */
  mode?: PricePathChartMode;
  /** Solo nodi calendario (no K-8) — meno caotico su multi-ticker. */
  standardNodesOnly?: boolean;
  /** Un punto per offset (media se più K-8 sullo stesso giorno). */
  aggregateByOffset?: boolean;
  nowMarkers?: NowOffsetMarker[];
}) {
  const includeK8 = field === "price_usd" && !standardNodesOnly;
  const usePortfolio = mode === "portfolio-mean" && lines.length >= 2;

  const seriesData = usePortfolio
    ? [
        {
          id: "portfolio_mean",
          label: `Media portafoglio (n=${lines.length})`,
          color: "#00dc96",
          rows: portfolioMeanRows(lines, field, { standardOnly: true }),
        },
      ]
    : lines.map((l) => {
        let rows = pricePointsFromSeries(l.points, field, { includeK8, standardOnly: standardNodesOnly });
        if (aggregateByOffset || (includeK8 && rows.length > 12)) {
          rows = aggregateRowsByOffset(rows);
        }
        return { ...l, rows };
      });

  const active = seriesData.filter((s) => s.rows.length >= 2);
  const allX = active.flatMap((s) => s.rows.map((r) => r.x));
  const dualAxis = !usePortfolio && needsDualPriceAxis(active);
  const flatSeries = active.filter((s) => priceSpreadPct(s.rows) < 0.75);
  const allFlat = active.length > 0 && flatSeries.length === active.length;

  if (active.length === 0 || allX.length < 2) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/50 p-4">
        <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
        <p className="text-xs text-ink-muted py-4 text-center">Prezzi non disponibili.</p>
      </div>
    );
  }

  const [xMin, xMax] = extendXDomain(Math.min(...allX), Math.max(...allX), nowMarkers);
  const nowDots = buildNowPriceDots(active, nowMarkers);
  const sharedDomain = dualAxis
    ? undefined
    : yDomainForRows(active.flatMap((s) => s.rows));

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/50 p-3">
      <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: nowMarkers.length ? 20 : 8, right: dualAxis ? 48 : 12, left: 48, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[xMin, xMax]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => offsetLabel(Number(v))}
            />
            <ChartNowMarkersLayer markers={nowMarkers} />
            {dualAxis ? (
              <>
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tick={{ fontSize: 10 }}
                  tickFormatter={fmtPriceAxis}
                  allowDecimals
                  width={52}
                  domain={yDomainForRows(active[0]?.rows ?? [])}
                  stroke={active[0]?.color}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickFormatter={fmtPriceAxis}
                  allowDecimals
                  width={52}
                  domain={yDomainForRows(active[1]?.rows ?? active[0]?.rows ?? [])}
                  stroke={active[1]?.color ?? active[0]?.color}
                />
              </>
            ) : (
              <YAxis
                tick={{ fontSize: 10 }}
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
                const val = usePortfolio
                  ? `${fmtPriceAxis(v)} idx`
                  : `$${v.toFixed(2)}`;
                if (sd != null && sd > 0) {
                  return [`${val} ± ${sd.toFixed(2)}${usePortfolio ? " idx" : ""}`, ""];
                }
                return [val, ""];
              }}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as PriceChartRow | undefined;
                if (!row) return "";
                const nNote = row.n && row.n > 1 ? ` · n=${row.n}` : "";
                return `Giorni da CD: ${row.xLabel}${nNote}`;
              }}
            />
            <Legend
              wrapperStyle={{
                fontSize: 11,
                maxHeight: active.length > 8 ? 88 : undefined,
                overflowY: active.length > 8 ? "auto" : undefined,
              }}
            />
            {active.map((s, idx) => {
              const showErr = s.rows.some((r) => (r.ySd ?? 0) > 0);
              return (
                <Line
                  key={s.id}
                  data={s.rows}
                  type="monotone"
                  dataKey="y"
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={usePortfolio ? 2.5 : 2}
                  dot={{ r: showErr ? 4 : 2 }}
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
            {nowDots.length > 0 && (
              <Scatter
                data={nowDots}
                dataKey="y"
                name="Posizione attuale"
                fill={NOW_DOT_FILL}
                stroke="#fff"
                strokeWidth={1}
                legendType="circle"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {nowMarkers.length > 0 && (
        <p className="text-[10px] text-ink-muted mt-1">
          Linea tratteggiata = oggi sul calendario CD (giorni da Completion Date).
        </p>
      )}
      {usePortfolio && (
        <p className="text-[10px] text-ink-muted mt-1">
          Indice T−60 = 100 per ogni ticker; linea = media portafoglio sui nodi di ricalibrazione (barre = ±1 σ).
        </p>
      )}
      {dualAxis && (
        <p className="text-[10px] text-ink-muted mt-1">
          Asse Y sinistro / destro: scale $ diverse tra le due società (es. ~$15 vs ~$1).
        </p>
      )}
      {allFlat && (
        <p className="text-[10px] text-ink-muted mt-1">
          Curva $ quasi piatta: variazione &lt;0,75% sui nodi — i Δ% vs T−60 sono molto piccoli o
          il prezzo storico è costante. Usa il grafico % sopra per vedere il movimento relativo.
        </p>
      )}
      {includeK8 && !usePortfolio && (
        <p className="text-[10px] text-ink-muted mt-1">
          Nodi K-8 aggregati per offset (media ± σ se più filing sullo stesso giorno).
        </p>
      )}
    </div>
  );
}
