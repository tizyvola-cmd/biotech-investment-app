/**
 * P(continuation) chart — rate percentile (X) vs empirical continuation (Y).
 * Sell-only: soft sell when exhaustion edge > 0 (shown in chrome).
 */
import { useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  resolveContG10,
  resolveContPBase,
  resolveContSellEdge,
  resolveContSellUiRegime,
  resolveDisplayPContinuation,
  contSellUiRegimeLabel,
  P_CONT_SELL_MIN_G10,
} from "../sheet/continuationScore";
import {
  estimatePctFromG10,
  findCoinFlipCrossingPct,
  interpolateCurveP,
  mergeDualCurveData,
  resolveContCurveOwn,
  resolveContCurvePop,
  resolveContPctOwn,
  resolveContPctPopRate,
} from "../sheet/continuationPercentileCurve";
import { AppModal, AppModalCloseButton } from "./AppModal";
import {
  contRunHeaderLabel,
  contRunLongLabel,
  G10_HELP_EN,
  G10_HELP_IT,
} from "./ContG10Badge";

export type ContChartPeer = {
  ticker: string;
  /** @deprecated X is now rate percentile; kept for dashboard chip API. */
  p: number;
  belowBase?: boolean;
  pctPop?: number | null;
  edge?: number | null;
};

const STROKE_OWN = "rgb(99 102 241)";
const STROKE_POP = "rgb(14 165 233)";
const FILL_STRONG = "rgb(16 185 129)";
const DOT_OK = "rgb(16 185 129)";
const DOT_LOW = "rgb(244 63 94)";
const COIN_FLIP = 50;

export function ContinuationProbabilityChart({
  simRow,
  it,
  dense = false,
  ticker,
  peers: _peers = [],
  questionAbove: _questionAbove = false,
}: {
  simRow: Record<string, unknown> | null | undefined;
  it: boolean;
  dense?: boolean;
  ticker?: string;
  peers?: ContChartPeer[];
  /** @deprecated Explainer is always shown (aligned Home ↔ Evaluation). */
  questionAbove?: boolean;
}) {
  void _peers;
  void _questionAbove;
  const [legendOpen, setLegendOpen] = useState(false);
  const g10 = resolveContG10(simRow);
  const edge = resolveContSellEdge(simRow);
  const pBase = resolveContPBase(simRow);
  const curveOwn = resolveContCurveOwn(simRow);
  const curvePop = resolveContCurvePop(simRow);
  const pctOwn = resolveContPctOwn(simRow);
  const pctPop = resolveContPctPopRate(simRow);
  const displayPCont = resolveDisplayPContinuation(simRow);
  const runShort = contRunHeaderLabel(it);
  const runLong = contRunLongLabel(it);

  const sellPressure = edge != null && edge > 0;
  const belowThreshold = g10 == null || g10 < P_CONT_SELL_MIN_G10;
  /** Evaluation-level detail needs room for Own + Pop + pins. */
  const height = dense ? 168 : 200;

  const legendButton = (
    <button
      type="button"
      className="rounded-full border border-[rgb(var(--border))]/55 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-50 hover:border-sky-300/60 transition"
      onClick={() => setLegendOpen(true)}
    >
      {it ? "Legenda" : "Legend"}
    </button>
  );

  const legendModal = (
    <AppModal
      open={legendOpen}
      onClose={() => setLegendOpen(false)}
      aria-label={it ? "Legenda P(continuation)" : "P(continuation) legend"}
      panelClassName="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
    >
      <div className="bg-white text-slate-900">
        <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            {it ? "Legenda — P(continuation)" : "Legend — P(continuation)"}
          </h3>
          <AppModalCloseButton
            onClose={() => setLegendOpen(false)}
            className="text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          />
        </div>
        <div className="px-4 py-3 space-y-2.5 text-[12px] leading-snug max-h-[70vh] overflow-y-auto">
          <div>
            <p className="font-semibold text-slate-900">P(cont.)</p>
            <p className="text-slate-600 mt-0.5">
              {it
                ? "Probabilità di continuazione della corsa: tra titoli storici con una corsa simile (stesso percentile di 10g %), quanto spesso il prezzo ha tenuto nei ~5 giorni successivi invece di cedere ≥5% dal close di setup."
                : "Probability the run continues: among historical names with a similar 10d % run (same percentile), how often price held over the next ~5 sessions instead of dropping ≥5% from the setup close."}
            </p>
            <p className="text-slate-600 mt-1">
              {it
                ? "È il numero sul chip P(CONT.), sulla tabella e sul grafico (stesso valore). Alto P(cont.) → la corsa tende ancora a tenere; basso → più rischio di stanca."
                : "Same number on the P(CONT.) chip, the table, and the chart. High P(cont.) → the run still tends to hold; low → more exhaustion risk."}
            </p>
            <p className="text-slate-600 mt-1">
              {it
                ? "Non confondere con P(esaurimento): è il complemento usato per l’edge (P(esaur.) − base bucket). Soft sell take-profit solo se libro verde e edge > 0."
                : "Do not confuse with P(exhaustion): that is the complement used for edge (P(exhaust) − bucket base). Soft sell take-profit only when green book and edge > 0."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              {runLong}{" "}
              <span className="font-normal text-slate-500">({runShort})</span>
            </p>
            <p className="text-slate-600 mt-0.5">{it ? G10_HELP_IT : G10_HELP_EN}</p>
            <p className="text-slate-600 mt-1">
              {it
                ? `Esempio: ${runShort} = +7% → il titolo è salito ~7% in ~2 settimane. Serve ≥ +${P_CONT_SELL_MIN_G10}% per il sell di esaurimento.`
                : `Example: ${runShort} = +7% → the name rose ~7% over ~2 weeks. Needs ≥ +${P_CONT_SELL_MIN_G10}% for exhaustion sell.`}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              {it ? "Asse X — percentile della corsa" : "X axis — run percentile"}
            </p>
            <p className="text-slate-600 mt-0.5">
              {it
                ? "0 = rate tipico (corsa lieve), 100 = più estremo. Pallino = posizione Pop + P(cont)%. In calo: pin a sinistra (solo riferimento). Curva Own = analoghi dello stesso titolo."
                : "0 = typical mild run, 100 = most extreme. Pin = Pop position + P(cont)%. Declining: left-edge reference pin. Own = same-ticker analogues."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              {it ? "Zona verde — vento forte" : "Green zone — strong wind"}
            </p>
            <p className="text-slate-600 mt-0.5">
              {it
                ? `Sotto la curva Pop dove P(cont.) ≥ ${COIN_FLIP}%: probabilità sostenuta che la corsa tenga. Linea tratteggiata verticale = soglia coin-flip sulla distribuzione.`
                : `Under the Pop curve where P(cont.) ≥ ${COIN_FLIP}%: sustained odds the run still holds. Vertical dashed line = coin-flip threshold on the distribution.`}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              {it ? "Asse Y — P(cont.) %" : "Y axis — P(cont.) %"}
            </p>
            <p className="text-slate-600 mt-0.5">
              {it
                ? "Stessa P(cont.) della definizione sopra, letta sulla curva empirica al percentile della corsa del titolo."
                : "Same P(cont.) as above, read from the empirical curve at this name’s run percentile."}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">edge</p>
            <p className="text-slate-600 mt-0.5">
              {it
                ? "P(esaurimento) − base del bucket. Soft sell take-profit se libro verde e edge > 0."
                : "P(exhaustion) − bucket base. Soft sell take-profit when green book and edge > 0."}
            </p>
          </div>
        </div>
      </div>
    </AppModal>
  );

  const chartData = useMemo(
    () => mergeDualCurveData(curveOwn, curvePop, COIN_FLIP),
    [curveOwn, curvePop],
  );

  const coinFlipX = useMemo(
    () => findCoinFlipCrossingPct(curvePop, COIN_FLIP),
    [curvePop],
  );

  /**
   * Chart X on the rising half-bell (g10 ≥ 0). Declining (g&lt;0) sits at the
   * left edge as a reference pin so Own/Pop curves stay readable (Evaluation).
   * Prefer scored pct Pop; else estimate from bin median `g`; legacy fallback
   * maps 0…+5% onto 0…first-bin pct.
   */
  const markerPctPop = useMemo(() => {
    if (g10 == null || !Number.isFinite(g10)) return null;
    if (g10 < 0) {
      if (!curvePop.length) return null;
      return curvePop[0]!.pct;
    }
    if (pctPop != null && Number.isFinite(pctPop)) return pctPop;
    const fromG = estimatePctFromG10(curvePop, g10);
    if (fromG != null) return fromG;
    if (!curvePop.length) return null;
    const floorPct = curvePop[0]!.pct;
    if (g10 >= P_CONT_SELL_MIN_G10) return floorPct;
    return Math.round((g10 / P_CONT_SELL_MIN_G10) * floorPct * 10) / 10;
  }, [pctPop, g10, curvePop]);

  const pContOwn = interpolateCurveP(curveOwn, pctOwn);
  const pContPop = interpolateCurveP(curvePop, markerPctPop);
  /** Same display number as badge / table (curve Pop, else 100 − exhaustion). */
  const pContBlended = displayPCont;

  const yDomain = useMemo((): [number, number] => {
    const vals = chartData.flatMap((d) => [d.ownP, d.popP]).filter((v): v is number => v != null);
    if (pContOwn != null) vals.push(pContOwn);
    if (pContPop != null) vals.push(pContPop);
    if (!vals.length) return [20, 70];
    const lo = Math.min(...vals, COIN_FLIP);
    const hi = Math.max(...vals, COIN_FLIP);
    return [Math.max(0, Math.floor(lo / 5) * 5 - 5), Math.min(100, Math.ceil(hi / 5) * 5 + 5)];
  }, [chartData, pContOwn, pContPop]);

  const hasCurves = chartData.length > 0;
  const regime = resolveContSellUiRegime(g10);
  const g10Label =
    g10 != null ? `${g10 >= 0 ? "+" : ""}${g10.toFixed(1)}%` : "—";
  const outOfRegimeBanner = belowThreshold ? (
    <div
      className={`mb-2 rounded-md border border-dashed px-2 py-1.5 ${
        regime === "declining"
          ? "border-rose-300/50 bg-rose-50/40"
          : regime === "not_run"
            ? "border-amber-300/50 bg-amber-50/40"
            : "border-slate-300/60 bg-slate-50/70"
      }`}
    >
      <p
        className={`text-[12px] font-bold leading-tight ${
          regime === "declining"
            ? "text-rose-800"
            : regime === "not_run"
              ? "text-amber-900"
              : "text-slate-700"
        }`}
      >
        {regime === "declining"
          ? it
            ? "Segnale: in calo"
            : "Signal: declining"
          : regime === "not_run"
            ? it
              ? "Segnale: corsa nascente"
              : "Signal: early run"
            : it
              ? "Segnale: 10g % non disponibile"
              : "Signal: 10d % unavailable"}
      </p>
      <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">
        {contSellUiRegimeLabel(regime, it)}
        {g10 != null ? ` · ${runShort} ${g10Label}` : ""}
        {" · "}
        {regime === "declining"
          ? it
            ? `Fuori dalla mezza campana (g≥0): pallino a sinistra = solo riferimento Pop. Edge sell solo con ${runShort} ≥ +${P_CONT_SELL_MIN_G10}%.`
            : `Off the rising half-bell (g≥0): left pin = Pop reference only. Sell edge only when ${runShort} ≥ +${P_CONT_SELL_MIN_G10}%.`
          : it
            ? `Edge sell solo con ${runShort} ≥ +${P_CONT_SELL_MIN_G10}%. Sotto: curve Own/Pop + pallino (non è un sell).`
            : `Sell edge only when ${runShort} ≥ +${P_CONT_SELL_MIN_G10}%. Below: Own/Pop curves + pin (not a sell).`}
      </p>
    </div>
  ) : null;

  if (!hasCurves && pContBlended == null) {
    return (
      <div
        className={`rounded-lg border border-dashed border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-2))]/20 ${
          dense ? "px-2 py-1.5" : "px-3 py-2"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted/85">
            {ticker ? `P(continuation) · ${ticker}` : "P(continuation)"}
          </p>
          {legendButton}
        </div>
        {outOfRegimeBanner}
        <p className="text-[11px] text-ink-muted mt-0.5">
          {belowThreshold
            ? it
              ? `Fuori regime sell (${runShort} < +${P_CONT_SELL_MIN_G10}%): pct Own/Pop e edge restano vuoti. Curva Pop di riferimento assente in questa riga — ricarica Simulation (overlay snapshot) o rilancia refresh continuation.`
              : `Out of sell regime (${runShort} < +${P_CONT_SELL_MIN_G10}%): pct Own/Pop and edge stay empty. Population reference curve missing on this row — reload Simulation (snapshot overlay) or re-run continuation refresh.`
            : it
              ? "Curva percentile non ancora disponibile — rilancia il refresh segnali (continuation) o arricchisci lo storico prezzi."
              : "Percentile curve not available yet — re-run signal refresh (continuation) or enrich price history."}
        </p>
        {legendModal}
      </div>
    );
  }

  const title = ticker ? `P(continuation) · ${ticker}` : "P(continuation)";
  const tk = ticker?.toUpperCase() ?? "";
  /** Label P(cont): scored display value, else Pop curve at the pin. */
  const markerPContLabel =
    pContBlended != null && Number.isFinite(pContBlended)
      ? pContBlended
      : pContPop;
  /** Pin sits on the Population curve (Evaluation geometry). */
  const markerY = pContPop ?? markerPContLabel;
  const showPopMarker = markerPctPop != null && markerY != null;
  const markerProvisional = belowThreshold;
  const hasStrongWindZone =
    coinFlipX != null && chartData.some((d) => d.popStrong != null);
  const showOwnMarker = pctOwn != null && pContOwn != null;

  return (
    <div
      className={`rounded-lg border border-[rgb(var(--border))]/45 bg-white/90 ${
        dense ? "px-2 py-1.5" : "px-3 py-2"
      }`}
      title={
        it
          ? `X = percentile della ${runLong.toLowerCase()} (0=tipico, 100=estremo). Y = P(continuation) empirica per bucket. Soft sell se edge esaurimento > 0.`
          : `X = ${runLong.toLowerCase()} percentile (0=typical, 100=most extreme). Y = empirical P(continuation) per bucket. Soft sell when exhaustion edge > 0.`
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted/85">
          {title}
        </p>
        {legendButton}
      </div>

      {outOfRegimeBanner}

      <p className="text-[11px] text-ink leading-snug mb-1">
        {it
          ? "Non è il prezzo del titolo. Y = probabilità empirica che la corsa tenga («vento»). X = quanto è estrema la 10g % tra gli analoghi."
          : "Not the stock’s price path. Y = empirical odds the run holds (“wind”). X = how extreme the 10d % is among analogues."}
      </p>
      {!belowThreshold ? (
        <p className="text-[11px] text-ink-muted leading-snug mb-1">
          {it
            ? "Dove cade il rate di crescita di questo titolo, e cosa è successo empiricamente ai titoli in quella stessa posizione?"
            : "Where does this name’s growth rate sit, and what happened empirically to names in that same position?"}
        </p>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] text-ink-muted mb-0.5">
        {g10 != null ? (
          <span className="tabular-nums">
            {runShort} {g10 >= 0 ? "+" : ""}
            {g10.toFixed(1)}%
          </span>
        ) : null}
        {edge != null ? (
          <span
            className={`tabular-nums font-semibold ${
              sellPressure ? "text-rose-700" : "text-emerald-700"
            }`}
          >
            edge {edge > 0 ? "+" : ""}
            {edge.toFixed(1)} pp
            {sellPressure ? (it ? " · pressione sell" : " · sell pressure") : ""}
          </span>
        ) : null}
        {(pctPop != null || markerPctPop != null) && (
          <span className="tabular-nums">
            pct Pop{" "}
            {Math.round(pctPop ?? markerPctPop!)}
          </span>
        )}
        {pctOwn != null ? (
          <span className="tabular-nums">pct Own {pctOwn.toFixed(0)}</span>
        ) : null}
        {markerPContLabel != null ? (
          <span
            className={`tabular-nums font-semibold ${
              markerProvisional ? "text-amber-800" : "text-ink"
            }`}
          >
            P(cont) {Math.round(markerPContLabel)}%
            {markerProvisional ? (it ? " · rif." : " · ref") : ""}
          </span>
        ) : null}
        {pBase != null ? (
          <span className="tabular-nums text-amber-800">
            {it ? "base bucket (exh.)" : "bucket base (exh.)"} {Math.round(pBase)}%
          </span>
        ) : null}
      </div>

      {!hasCurves ? (
        <p className="text-[11px] text-ink-muted py-6 text-center">
          {it
            ? "Curve Own/Population non pronte (n per bin insufficiente)."
            : "Own/Population curves not ready (insufficient n per bin)."}
        </p>
      ) : (
        <div style={{ width: "100%", height }} className="min-w-0">
          <ResponsiveContainer>
            <ComposedChart
              data={chartData}
              margin={{ top: 18, right: 14, left: 0, bottom: 4 }}
            >
              <XAxis
                dataKey="pct"
                type="number"
                domain={[0, 100]}
                tick={{ fontSize: 9, fill: "rgb(var(--ink-muted))" }}
                tickFormatter={(v) => `${v}`}
                axisLine={false}
                tickLine={false}
                label={{
                  value: it
                    ? `percentile ${runShort} (0=tipico, 100=estremo)`
                    : `${runShort} percentile (0=typical, 100=most extreme)`,
                  position: "insideBottom",
                  offset: -2,
                  style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
                }}
              />
              <YAxis
                type="number"
                domain={yDomain}
                width={36}
                tick={{ fontSize: 9, fill: "rgb(var(--ink-muted))" }}
                tickFormatter={(v) => `${v}%`}
                axisLine={false}
                tickLine={false}
                label={{
                  value: it ? "P(continuation) %" : "P(continuation) %",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
                }}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid rgb(var(--border) / 0.5)",
                }}
                formatter={(value: number, name: string) => {
                  const label =
                    name === "ownP"
                      ? it
                        ? "Own"
                        : "Own"
                      : name === "popP"
                        ? it
                          ? "Popolazione"
                          : "Population"
                        : name;
                  return [`${Math.round(Number(value))}%`, label];
                }}
                labelFormatter={(x) =>
                  it
                    ? `Percentile ${runShort} ≈ ${Math.round(Number(x))}`
                    : `${runShort} percentile ≈ ${Math.round(Number(x))}`
                }
              />
              <ReferenceLine
                y={COIN_FLIP}
                stroke="rgb(148 163 184)"
                strokeDasharray="4 3"
                strokeWidth={1.25}
                label={{
                  value: it ? "50% — coin flip" : "50% — coin flip",
                  position: "insideTopRight",
                  fill: "rgb(100 116 139)",
                  fontSize: 9,
                }}
              />
              {hasStrongWindZone && coinFlipX != null ? (
                <ReferenceLine
                  x={coinFlipX}
                  stroke={FILL_STRONG}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  strokeOpacity={0.85}
                  label={{
                    value: it ? "← vento forte" : "← strong wind",
                    position: "insideTopLeft",
                    fill: "rgb(4 120 87)",
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                />
              ) : null}
              {curvePop.length ? (
                <Area
                  type="monotone"
                  dataKey="popP"
                  stroke={STROKE_POP}
                  fill={STROKE_POP}
                  fillOpacity={0.08}
                  strokeWidth={2}
                  isAnimationActive={false}
                  name="popP"
                  dot={false}
                  connectNulls
                />
              ) : null}
              {hasStrongWindZone ? (
                <Area
                  type="monotone"
                  dataKey="popStrong"
                  stroke="none"
                  fill={FILL_STRONG}
                  fillOpacity={0.22}
                  isAnimationActive={false}
                  name="popStrong"
                  dot={false}
                  connectNulls={false}
                  legendType="none"
                />
              ) : null}
              {curveOwn.length ? (
                <Line
                  type="monotone"
                  dataKey="ownP"
                  stroke={STROKE_OWN}
                  strokeWidth={2}
                  isAnimationActive={false}
                  name="ownP"
                  dot={false}
                  connectNulls
                />
              ) : null}
              {showPopMarker ? (
                <>
                  <ReferenceLine
                    x={markerPctPop!}
                    stroke="rgb(148 163 184)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                  <ReferenceDot
                    x={markerPctPop!}
                    y={markerY!}
                    r={markerProvisional ? 6 : 5.5}
                    fill={
                      markerProvisional
                        ? "transparent"
                        : sellPressure || markerY! < COIN_FLIP
                          ? DOT_LOW
                          : DOT_OK
                    }
                    stroke={
                      markerProvisional
                        ? regime === "declining"
                          ? "rgb(190 24 93)"
                          : "rgb(217 119 6)"
                        : "#fff"
                    }
                    strokeWidth={markerProvisional ? 2.25 : 1.5}
                    ifOverflow="extendDomain"
                    label={{
                      value: tk
                        ? markerProvisional
                          ? `${tk}: ${Math.round(markerPContLabel!)}% / ${contSellUiRegimeLabel(regime, it)}`
                          : it
                            ? `${tk}: ${Math.round(markerPContLabel!)}% / ${
                                markerPContLabel! < COIN_FLIP
                                  ? "bassa probabilità"
                                  : "continuation"
                              }`
                            : `${tk}: ${Math.round(markerPContLabel!)}% / ${
                                markerPContLabel! < COIN_FLIP
                                  ? "low continuation"
                                  : "continuation"
                              }`
                        : `${Math.round(markerPContLabel!)}%`,
                      position: "right",
                      fill: markerProvisional
                        ? regime === "declining"
                          ? "rgb(190 24 93)"
                          : "rgb(180 83 9)"
                        : sellPressure || markerY! < COIN_FLIP
                          ? DOT_LOW
                          : "rgb(15 23 42)",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  />
                </>
              ) : null}
              {showOwnMarker ? (
                <ReferenceDot
                  x={pctOwn!}
                  y={pContOwn!}
                  r={4}
                  fill={STROKE_OWN}
                  stroke="#fff"
                  strokeWidth={1.25}
                  ifOverflow="extendDomain"
                  label={{
                    value: `Own ${Math.round(pContOwn!)}%`,
                    position: "top",
                    fill: STROKE_OWN,
                    fontSize: 9,
                    fontWeight: 600,
                  }}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {!curveOwn.length && curvePop.length ? (
        <p className="text-[10px] text-amber-800/90 mt-0.5 leading-snug">
          {it
            ? "Own assente: analoghi del titolo troppo pochi per i bin — mostro solo Popolazione."
            : "Own missing: same-ticker analogues too thin for bins — Population only."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-ink-muted leading-snug mt-0.5">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: STROKE_POP }} />
          {it ? "Popolazione" : "Population"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2 rounded-sm"
            style={{ background: FILL_STRONG, opacity: 0.35 }}
          />
          {it ? `vento forte (P≥${COIN_FLIP}%)` : `strong wind (P≥${COIN_FLIP}%)`}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: STROKE_OWN }} />
          Own
        </span>
        <span>{it ? "50% (coin-flip)" : "50% (coin-flip)"}</span>
        {tk ? (
          <span>
            {it
              ? `${tk} — posizione sulla mezza campana + P(continuation)`
              : `${tk} — position on the half-bell + P(continuation)`}
          </span>
        ) : null}
        <span>
          {it
            ? "Soft sell quando edge esaurimento > 0."
            : "Soft sell when exhaustion edge > 0."}
        </span>
      </div>
      {legendModal}
    </div>
  );
}
