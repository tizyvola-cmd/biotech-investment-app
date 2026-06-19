/**
 * Continuous-feature linear-regression panel.
 *
 * Mostra, per i parametri continui usati per valutare un'opportunità (P(plan)
 * a entry, slope 20d a entry, giorni al CD a entry, SDS score), QUALI sono
 * affidabilmente bassi quando il trade va in perdita.
 *
 * Visualizzazione: bar chart orizzontale ordinato per |loss indicator|. Una
 * barra ROSSA verso destra = "il feature è basso nelle perdite" (Cohen's d
 * positivo) — il segnale che l'utente cerca. Una barra ARANCIO verso
 * sinistra = "il feature è alto nelle perdite" (è il caso di daysToCd, dove
 * un valore alto = poco tempo per recuperare = correlato a perdita).
 *
 * Sotto la barra: tooltip con mean(loss), mean(win), correlazione, n.
 *
 * Anti-leakage: solo feature entry-state già congelati sul SimOutcomeRow.
 */
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  runContinuousLossRegression,
  type ContinuousFeatureStat,
} from "../riskPattern/continuousFeatureRegression";
import { useLang } from "../shared/i18n";

function fmtNum(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtSigned(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}`;
}

function indicatorTone(li: number): string {
  // Positive lossIndicator = feature low in losses = the user's "red flag".
  // Negative lossIndicator = feature high in losses = an inverted red flag.
  const abs = Math.abs(li);
  if (abs < 0.2) return "#94a3b8"; // slate-400 — non-discriminating
  if (li > 0) {
    if (li >= 0.8) return "#dc2626"; // red-600 — big effect, low feature = loss
    if (li >= 0.5) return "#f97316"; // orange-500 — medium effect
    return "#fbbf24"; // amber-400 — small effect
  }
  // li < 0 → high feature = loss (e.g. high daysToCd correlates with loss)
  if (li <= -0.8) return "#7c3aed"; // violet-600 — big inverted effect
  if (li <= -0.5) return "#a78bfa"; // violet-400
  return "#c4b5fd"; // violet-300
}

function confTone(c: "low" | "medium" | "high"): string {
  if (c === "high") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (c === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200";
}

export function ContinuousFeatureRegressionPanel({
  closedRows,
  simTable,
  sdsRows,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [buyRecOnly, setBuyRecOnly] = useState(false);

  const result = useMemo(
    () => runContinuousLossRegression(closedRows, { simTable, sdsRows }, { buyRecOnly }),
    [closedRows, simTable, sdsRows, buyRecOnly],
  );

  const chartData = useMemo(
    () =>
      result.features.map((f) => ({
        ...f,
        label: it ? f.labelIt : f.labelEn,
      })),
    [result.features, it],
  );

  return (
    <div className="rounded-xl border border-indigo-200/60 dark:border-indigo-800/40 bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30 dark:from-indigo-950/15 dark:via-surface dark:to-violet-950/15">
      <header className="px-3 py-2 border-b border-indigo-200/40 dark:border-indigo-800/30 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold text-ink flex items-center gap-2">
            <span>📉</span>
            {it
              ? "Phase A-bis — Regressione continua: quali score sono bassi nelle perdite?"
              : "Phase A-bis — Continuous regression: which scores are low in losses?"}
          </h3>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
            {it
              ? `n=${result.totalTrades} trade chiusi · base loss rate ${(result.baseLossRate * 100).toFixed(1)}% · per ogni feature continuo: mean(loss), mean(win), correlazione Pearson(feature, P&L), slope OLS standardizzato. Ordinati per |Cohen's d|.`
              : `n=${result.totalTrades} closed trades · base loss rate ${(result.baseLossRate * 100).toFixed(1)}% · per feature: mean(loss), mean(win), Pearson(feature, P&L), standardised OLS slope. Ranked by |Cohen's d|.`}
          </p>
        </div>
        <label className="shrink-0 flex items-center gap-1.5 text-[10px] cursor-pointer">
          <input
            type="checkbox"
            checked={buyRecOnly}
            onChange={(e) => setBuyRecOnly(e.target.checked)}
          />
          <span className="text-ink">
            {it ? "Solo trade dove era raccomandato BUY (P(plan) ≥ 50%)" : "Only trades where BUY was recommended (P(plan) ≥ 50%)"}
          </span>
        </label>
      </header>

      <div className="p-3 space-y-3">
        {chartData.length === 0 ? (
          <p className="text-[11px] text-ink-muted py-4 text-center">
            {it ? "Nessun dato per la regressione." : "No data for regression."}
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 36)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 8, right: 64, bottom: 8, top: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis
                  type="number"
                  domain={[-2, 2]}
                  tick={{ fontSize: 10 }}
                  ticks={[-2, -1, 0, 1, 2]}
                  label={{
                    value: it
                      ? "Loss indicator (mean(win) − mean(loss)) / stdDev — positivo = feature più basso nelle perdite"
                      : "Loss indicator (mean(win) − mean(loss)) / stdDev — positive = feature lower in losses",
                    position: "insideBottom",
                    offset: -2,
                    style: { fontSize: 9, fill: "rgb(100 116 139)" },
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  width={180}
                  interval={0}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(_v, _name, item) => {
                    const d = (item as { payload?: ContinuousFeatureStat }).payload;
                    if (!d) return [_v as number, ""];
                    return [
                      `${fmtSigned(d.lossIndicator)} σ`,
                      it ? "Loss indicator" : "Loss indicator",
                    ];
                  }}
                  labelFormatter={(_l, items) => {
                    const d = (items?.[0] as { payload?: ContinuousFeatureStat } | undefined)?.payload;
                    if (!d) return _l as string;
                    return (
                      it
                        ? `${d.labelIt} · n=${d.n} (${d.nLosses}L / ${d.nWins}W) · Pearson ${fmtSigned(d.corrWithPnl)} · slope std. ${fmtSigned(d.regressionSlopeStdized)} · mean(L)=${fmtNum(d.meanLoss)} mean(W)=${fmtNum(d.meanWin)}`
                        : `${d.labelEn} · n=${d.n} (${d.nLosses}L / ${d.nWins}W) · Pearson ${fmtSigned(d.corrWithPnl)} · std. slope ${fmtSigned(d.regressionSlopeStdized)} · mean(L)=${fmtNum(d.meanLoss)} mean(W)=${fmtNum(d.meanWin)}`
                    );
                  }}
                />
                <ReferenceLine x={0} stroke="rgba(148,163,184,0.6)" />
                <ReferenceLine
                  x={0.5}
                  stroke="rgba(249,115,22,0.4)"
                  strokeDasharray="3 3"
                  label={{ value: it ? "effetto medio" : "medium effect", position: "top", fontSize: 8, fill: "#f97316" }}
                />
                <ReferenceLine
                  x={0.8}
                  stroke="rgba(220,38,38,0.4)"
                  strokeDasharray="3 3"
                  label={{ value: it ? "effetto grande" : "large effect", position: "top", fontSize: 8, fill: "#dc2626" }}
                />
                <Bar dataKey="lossIndicator" minPointSize={1}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={indicatorTone(d.lossIndicator)} />
                  ))}
                  <LabelList
                    dataKey="lossIndicator"
                    position="right"
                    formatter={(v: number) => `${fmtSigned(v)}σ`}
                    style={{ fontSize: 9, fill: "rgb(100 116 139)" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Mini detail table */}
            <details className="rounded-md border border-indigo-200/30">
              <summary className="px-2 py-1.5 cursor-pointer text-[10px] font-medium text-ink-muted hover:bg-surface/50">
                {it ? "Tabella numerica dettagliata" : "Detailed numeric table"}
              </summary>
              <div className="p-2">
                <table className="w-full text-[10px] tabular-nums">
                  <thead className="text-ink-muted">
                    <tr>
                      <th className="text-left font-medium pr-2 pb-1">{it ? "Feature" : "Feature"}</th>
                      <th className="text-right font-medium pr-2 pb-1">n</th>
                      <th className="text-right font-medium pr-2 pb-1">mean(L)</th>
                      <th className="text-right font-medium pr-2 pb-1">mean(W)</th>
                      <th className="text-right font-medium pr-2 pb-1">σ</th>
                      <th className="text-right font-medium pr-2 pb-1">Pearson</th>
                      <th className="text-right font-medium pr-2 pb-1">slope std.</th>
                      <th className="text-right font-medium pr-2 pb-1">Cohen's d</th>
                      <th className="text-left font-medium pl-2 pb-1">{it ? "Conf." : "Conf."}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.features.map((f) => (
                      <tr key={f.key} className="border-t border-indigo-200/20">
                        <td className="text-left pr-2 py-1">{it ? f.labelIt : f.labelEn}</td>
                        <td className="text-right pr-2 py-1">{f.n}</td>
                        <td className="text-right pr-2 py-1">{fmtNum(f.meanLoss)}</td>
                        <td className="text-right pr-2 py-1">{fmtNum(f.meanWin)}</td>
                        <td className="text-right pr-2 py-1">{fmtNum(f.stdDev)}</td>
                        <td className="text-right pr-2 py-1">{fmtSigned(f.corrWithPnl)}</td>
                        <td className="text-right pr-2 py-1">{fmtSigned(f.regressionSlopeStdized)}</td>
                        <td
                          className={`text-right pr-2 py-1 font-semibold ${
                            f.lossIndicator >= 0.5
                              ? "text-rose-700 dark:text-rose-300"
                              : f.lossIndicator <= -0.5
                                ? "text-violet-700 dark:text-violet-300"
                                : "text-ink-muted"
                          }`}
                        >
                          {fmtSigned(f.lossIndicator)}
                        </td>
                        <td className="text-left pl-2 py-1">
                          <span className={`text-[8px] px-1 rounded uppercase font-semibold ${confTone(f.confidence)}`}>
                            {f.confidence}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <p className="text-[9px] text-ink-muted leading-snug px-1">
              {it ? (
                <>
                  Lettura: <span className="text-rose-700 font-semibold">barra rossa verso destra</span> = feature alto nelle vincite e basso nelle perdite, è il "red flag se basso". <span className="text-violet-700 font-semibold">Barra viola verso sinistra</span> = feature alto nelle perdite (es. tanti giorni al CD = poco tempo per recuperare). Soglie convenzionali: |d|≥0.5 effetto medio, |d|≥0.8 effetto grande (Cohen). Slope std. è la variazione di P&L (%) per +1σ di feature.
                </>
              ) : (
                <>
                  Reading: <span className="text-rose-700 font-semibold">red bar to the right</span> = feature high in wins and low in losses, that's the "red flag if low". <span className="text-violet-700 font-semibold">Violet bar to the left</span> = feature high in losses (e.g. many days to CD = little time to recover). Conventional thresholds: |d|≥0.5 medium effect, |d|≥0.8 large effect (Cohen). Std. slope = P&L (%) change per +1σ of feature.
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
