import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { isSimOutcomeOpen, type SimOutcomeRow, type SimOutcomesDoc } from "../data/investmentSimOutcomesData";
import { fetchProjectJson } from "../data/projectData";
import { loadPolygonMatchRetroMap } from "../data/polygonMatchData";
import { resolveBacktestPolygonMatchPct, type BacktestPolygonMatchMap } from "../sheet/cdPatternPolygonRetro";
import type { BacktestAnchorId } from "../sheet/watchZoneEnterBacktest";
import { pearsonR } from "../sheet/statSignificance";
import type { CdPatternPolygonOverview } from "../sheet/cdPatternPolygonAccuracyView";
import { useLang } from "../shared/i18n";

// ── Types ────────────────────────────────────────────────────────────────────

type ScatterPt = {
  ticker: string;
  x: number; // polygon match %
  y: number; // pnl %
  isOpen: boolean;
  isWin: boolean;
};

type CdWindow = {
  id: string;
  label: string;
  sublabel: string;
  anchor: BacktestAnchorId;
  test: (d: number) => boolean;
};

type DatasetFilter = "all" | "closed" | "open";

// ── Constants ────────────────────────────────────────────────────────────────

const CD_WINDOWS: CdWindow[] = [
  { id: "w1", label: "120→60 gg", sublabel: "Pre-CD lontano", anchor: "T-90", test: (d) => d > 60 },
  { id: "w2", label: "60→10 gg", sublabel: "Hot zone", anchor: "T-30", test: (d) => d > 10 && d <= 60 },
  { id: "w3", label: "10→0 gg", sublabel: "Peak zone", anchor: "T-14", test: (d) => d >= 0 && d <= 10 },
  { id: "w4", label: "Post-CD", sublabel: "0→+30 gg dopo CD", anchor: "T-14", test: (d) => d < 0 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMatchPct(
  row: SimOutcomeRow,
  anchor: BacktestAnchorId,
  map: BacktestPolygonMatchMap | null,
): { matchPct: number | null; source: "polygon" | "proxy" | "none" } {
  return resolveBacktestPolygonMatchPct(
    row.ticker,
    row.completion_date,
    anchor,
    map,
    row.affidabilita_pct,
  );
}

function scatterYDomain(pts: ScatterPt[]): [number, number] {
  const ys = pts.map((p) => p.y).filter((y) => Number.isFinite(y) && Math.abs(y) <= 200);
  if (!ys.length) return [-20, 20];
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const pad = Math.max(5, (max - min) * 0.15 || 5);
  return [Math.min(min - pad, -3), Math.max(max + pad, 3)];
}

function pointColor(pt: ScatterPt): string {
  if (pt.isOpen) return pt.y >= 0 ? "#34d399" : "#fbbf24";
  return pt.isWin ? "#10b981" : "#f43f5e";
}

// ── Mini scatter panel ───────────────────────────────────────────────────────

function WindowPanel({ window: win, pts }: { window: CdWindow; pts: ScatterPt[] }) {
  const { lang } = useLang();
  const it = lang === "it";
  const n = pts.length;
  const rho =
    n >= 3
      ? pearsonR(
          pts.map((p) => p.x),
          pts.map((p) => p.y),
        )
      : null;
  const yDomain = scatterYDomain(pts);

  const highScorePts = pts.filter((p) => p.x >= 50);
  const highWinRate =
    highScorePts.length >= 2
      ? Math.round((highScorePts.filter((p) => p.y > 0).length / highScorePts.length) * 100)
      : null;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/80 p-2.5 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-1 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-ink leading-tight">{win.label}</p>
          <p className="text-[9px] text-ink-muted">{win.sublabel}</p>
        </div>
        <div className="flex gap-2 text-[9px] text-ink-muted flex-wrap">
          {rho != null && (
            <span title={it ? "Pearson r — correlazione polygon match vs P&L" : "Pearson r — polygon match vs P&L correlation"}>
              r={" "}
              <strong
                className={`tabular-nums ${
                  rho >= 0.3
                    ? "text-emerald-600"
                    : rho <= -0.3
                      ? "text-rose-500"
                      : "text-amber-500"
                }`}
              >
                {rho.toFixed(2)}
              </strong>
            </span>
          )}
          {highWinRate != null && (
            <span title={it ? "Win rate quando polygon ≥50%" : "Win rate when polygon ≥50%"}>
              W≥50%:{" "}
              <strong className="text-ink tabular-nums">{highWinRate}%</strong>
            </span>
          )}
          <span>
            n=<strong className="text-ink tabular-nums">{n}</strong>
          </span>
        </div>
      </div>

      {n < 2 ? (
        <p className="text-[10px] text-ink-muted text-center py-4">
          {it ? `Dati insufficienti (${n} posizioni)` : `Insufficient data (${n} positions)`}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <ScatterChart margin={{ top: 4, right: 8, bottom: 22, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 100]}
              tick={{ fontSize: 8 }}
              label={{
                value: "Polygon match %",
                position: "bottom",
                offset: 10,
                style: { fontSize: 8, fill: "#94a3b8" },
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={yDomain}
              tick={{ fontSize: 8 }}
              tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
              width={36}
            />
            <ZAxis range={[28, 28]} />
            <ReferenceLine x={50} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={0.8} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={0.8} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as ScatterPt | undefined;
                if (!p) return null;
                return (
                  <div className="rounded border border-[rgb(var(--border))]/60 bg-white px-2 py-1 text-[10px] shadow">
                    <p className="font-semibold">{p.ticker}</p>
                    <p>Match: {p.x.toFixed(1)}%</p>
                    <p>P&L: {p.y >= 0 ? "+" : ""}{p.y.toFixed(1)}%</p>
                    <p className="text-ink-muted">{p.isOpen ? "aperta" : p.isWin ? "chiusa +win" : "chiusa -loss"}</p>
                  </div>
                );
              }}
            />
            <Scatter
              data={pts}
              shape={(props: { cx?: number; cy?: number; payload?: ScatterPt }) => {
                const cx = props.cx ?? 0;
                const cy = props.cy ?? 0;
                const pt = props.payload;
                const color = pt ? pointColor(pt) : "#94a3b8";
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={color}
                    fillOpacity={0.75}
                    stroke={color}
                    strokeWidth={1}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Legend chip ──────────────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-0.5 text-[9px] text-ink-muted">
      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function CdPatternPolygonAccuracySection({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  overview: _overview,
}: {
  overview?: CdPatternPolygonOverview | null | undefined;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [rows, setRows] = useState<SimOutcomeRow[]>([]);
  const [polygonMap, setPolygonMap] = useState<BacktestPolygonMatchMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DatasetFilter>("closed");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchProjectJson<SimOutcomesDoc>("investment_sim_outcomes.json"),
      loadPolygonMatchRetroMap(),
    ])
      .then(([{ data, detail }, map]) => {
        setRows(data?.rows ?? []);
        setPolygonMap(map);
        if (!data?.rows?.length && detail) setError(detail);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const hasRetroMap = polygonMap != null && Object.keys(polygonMap).length > 0;

  const filteredRows = useMemo(() => {
    if (filter === "closed") return rows.filter((r) => !isSimOutcomeOpen(r));
    if (filter === "open") return rows.filter((r) => isSimOutcomeOpen(r));
    return rows;
  }, [rows, filter]);

  // Build all scatter points once, then split per window
  const allPoints = useMemo<(ScatterPt & { daysToCd: number | null; anchor: BacktestAnchorId })[]>(
    () =>
      filteredRows.flatMap((r) => {
        if (r.pnl_pct == null) return [];
        const d = r.days_to_cd;
        // pick anchor closest to the CD window
        const anchor: BacktestAnchorId =
          d != null && d > 60 ? "T-90" : d != null && d > 10 ? "T-30" : "T-14";
        const { matchPct } = getMatchPct(r, anchor, polygonMap);
        if (matchPct == null) return [];
        return [
          {
            ticker: r.ticker,
            x: matchPct,
            y: r.pnl_pct,
            isOpen: isSimOutcomeOpen(r),
            isWin: r.is_win,
            daysToCd: d ?? null,
            anchor,
          },
        ];
      }),
    [filteredRows, polygonMap],
  );

  const proxyCount = useMemo(
    () =>
      hasRetroMap
        ? 0
        : allPoints.length, // when no retro map, all points are proxy
    [hasRetroMap, allPoints.length],
  );

  const windowPoints = useMemo(
    () =>
      CD_WINDOWS.map((w) => ({
        window: w,
        pts: allPoints.filter((p) => p.daysToCd != null && w.test(p.daysToCd)),
      })),
    [allPoints],
  );

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-4">
        <p className="text-[11px] text-ink-muted animate-pulse">
          {it ? "Caricamento dati..." : "Loading data..."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* ── Grafico 1 ── */}
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {it ? "Grafico 1" : "Chart 1"} — Polygon score vs P&amp;L (%)
            </h3>
            <p className="text-[10px] text-ink-muted mt-0.5 max-w-xl">
              {it
                ? "Per ogni posizione: X = polygon match% al momento dell'entrata, Y = P&L% finale. Un r positivo indica che un punteggio poligono alto correla con P&L positivo."
                : "For each position: X = polygon match% at entry time, Y = final P&L%. A positive r indicates a high polygon score correlates with positive P&L."}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            {(["all", "closed", "open"] as DatasetFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                  filter === f
                    ? "bg-[rgb(var(--accent))] text-white border-[rgb(var(--accent))]"
                    : "border-[rgb(var(--border))]/50 text-ink-muted hover:bg-surface/40"
                }`}
              >
                {it
                  ? f === "all" ? "Tutte" : f === "closed" ? "Chiuse" : "Aperte"
                  : f === "all" ? "All" : f === "closed" ? "Closed" : "Open"}
              </button>
            ))}
          </div>
        </div>

        {/* Proxy warning */}
        {proxyCount > 0 && !hasRetroMap && (
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[10px] text-amber-700">
            <span className="shrink-0">⚠</span>
            <span>
              <strong>{it ? "Dati proxy" : "Proxy data"}</strong>{" "}
              {it ? "— manca il file " : "— missing file "}
              <code className="bg-amber-100 px-0.5 rounded">backtest_polygon_match.json</code>.{" "}
              {it
                ? <>Il polygon match% è stimato da <em>affidabilità</em> (×0.88), non dalla valutazione poligono reale al momento dell'entrata. Richiedere export Python per dati precisi.</>
                : <>Polygon match% is estimated from <em>reliability</em> (×0.88), not the real polygon evaluation at entry time. Request Python export for precise data.</>}
            </span>
          </div>
        )}

        {error && (
          <p className="text-[10px] text-rose-500 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-2.5">
          <LegendDot color="#10b981" label={it ? "Chiusa +win" : "Closed +win"} />
          <LegendDot color="#f43f5e" label={it ? "Chiusa -loss" : "Closed -loss"} />
          <LegendDot color="#34d399" label={it ? "Aperta (P&L+)" : "Open (P&L+)"} />
          <LegendDot color="#fbbf24" label={it ? "Aperta (P&L-)" : "Open (P&L-)"} />
        </div>

        {/* 4 CD windows in 2×2 grid */}
        <div className="grid grid-cols-2 gap-2">
          {windowPoints.map(({ window, pts }) => (
            <WindowPanel key={window.id} window={window} pts={pts} />
          ))}
        </div>

        <p className="text-[9px] text-ink-muted/70">
          {it
            ? "La riga verticale tratteggiata a x=50 separa pattern a bassa corrispondenza (sx) da alta (dx)."
            : "The dashed vertical line at x=50 separates low-match patterns (left) from high-match (right)."}
          {!hasRetroMap && (it
            ? " I dati proxy sottostimano leggermente il match reale."
            : " Proxy data slightly underestimates the real match.")}
        </p>
      </div>

      {/* ── Grafico 2 — placeholder ── */}
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/40 p-3 space-y-2">
        <h3 className="text-sm font-semibold text-ink">
          {it
            ? "Grafico 2 — Polygon score vs variazione prezzo (bloccato)"
            : "Chart 2 — Polygon score vs price change (blocked)"}
        </h3>
        <p className="text-[10px] text-ink-muted max-w-xl leading-relaxed">
          {it
            ? <>Questo grafico mostra la correlazione tra polygon match% e variazione prezzo a 1 gg / 7 gg per <em>tutti</em> i ticker × data valutati (non solo posizioni aperte).</>
            : <>This chart shows the correlation between polygon match% and 1d / 7d price change for <em>all</em> ticker × date evaluations (not just open positions).</>}
        </p>
        <div className="rounded-lg border border-amber-300/60 bg-white/70 px-3 py-3 text-[10px] space-y-1.5">
          <p className="font-semibold text-amber-700">
            {it ? "Prerequisito: export Python mancante" : "Prerequisite: Python export missing"}
          </p>
          <p className="text-ink-muted">
            {it ? "Serve un file " : "Requires a file "}
            <code className="bg-amber-100 px-0.5 rounded">polygon_score_vs_price_log.json</code>{" "}
            {it ? "con campi per ogni valutazione: " : "with fields for each evaluation: "}
            <code className="bg-amber-100 px-0.5 rounded">
              ticker, eval_date, match_pct, price_change_1d, price_change_7d
            </code>
            .
          </p>
          <p className="text-ink-muted">
            Richiedere al backend Python di aggiungere questo export al ciclo di calcolo del poligono.
            Una volta disponibile, questo placeholder sarà sostituito con lo scatter completo.
          </p>
        </div>
      </div>
    </div>
  );
}
