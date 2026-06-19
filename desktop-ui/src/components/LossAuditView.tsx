/**
 * Loss Audit — visualization of closed-trade failure modes.
 *
 * Splits realized losses into "expected" (model warned: P(plan) < 50%) vs
 * "surprise" (model expected win: P(plan) ≥ 50%) and breaks them down by
 * clinical phase, indication, SDS bucket and P(plan) bucket.
 *
 * Renders above the Break-Even & Diversification panel so the user sees the
 * statistical risk picture BEFORE picking capital allocation rules.
 */
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SdsRow } from "../api/supernova";
import type { SheetTable } from "../types";
import {
  computeLossAudit,
  LOSS_THRESHOLD_PCT,
  OPTIMISTIC_PPLAN_PCT,
  type CategoryBreakdown,
  type LossAuditResult,
} from "../sheet/lossAuditAnalysis";
import { useLang } from "../shared/i18n";

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString("it-IT")} €`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function toneForSurpriseRate(pct: number, n: number): string {
  if (n === 0) return "text-ink-muted";
  if (pct >= 60) return "text-rose-600 font-bold";
  if (pct >= 40) return "text-amber-600 font-semibold";
  if (pct >= 20) return "text-yellow-700";
  return "text-emerald-700";
}

function toneForLossRate(pct: number, n: number): string {
  if (n === 0) return "text-ink-muted";
  if (pct >= 50) return "text-rose-600 font-bold";
  if (pct >= 30) return "text-amber-600 font-semibold";
  if (pct >= 15) return "text-yellow-700";
  return "text-emerald-700";
}

function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "danger" | "warn" | "ok" | "info";
}) {
  const toneClass = (
    {
      danger: "border-rose-300/60 bg-rose-50/60",
      warn: "border-amber-300/60 bg-amber-50/60",
      ok: "border-emerald-300/60 bg-emerald-50/60",
      info: "border-blue-300/60 bg-blue-50/60",
      neutral: "border-slate-300/60 bg-white",
    } as const
  )[tone];
  const valueClass = (
    {
      danger: "text-rose-700",
      warn: "text-amber-700",
      ok: "text-emerald-700",
      info: "text-blue-700",
      neutral: "text-ink",
    } as const
  )[tone];
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold text-ink-muted">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${valueClass}`}>
        {value}
      </p>
      {sub ? <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

function ConfusionCell({
  value,
  total,
  label,
  tone,
  detail,
}: {
  value: number;
  total: number;
  label: string;
  tone: "ok" | "danger" | "warn" | "info";
  detail: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const toneClass = (
    {
      ok: "bg-emerald-50 border-emerald-300 text-emerald-800",
      danger: "bg-rose-50 border-rose-400 text-rose-800",
      warn: "bg-amber-50 border-amber-300 text-amber-800",
      info: "bg-blue-50 border-blue-300 text-blue-800",
    } as const
  )[tone];
  return (
    <div className={`rounded-lg border-2 p-3 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      <p className="text-[10px] mt-0.5 opacity-75">
        {fmtPct(pct)} of resolved
      </p>
      <p className="text-[10px] mt-1 leading-snug opacity-80">{detail}</p>
    </div>
  );
}

function CategoryTable({
  title,
  subtitle,
  rows,
  it,
}: {
  title: string;
  subtitle: string;
  rows: CategoryBreakdown[];
  it: boolean;
}) {
  const visibleRows = rows.filter((r) => r.n > 0);
  if (visibleRows.length === 0) {
    return (
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <h4 className="text-sm font-bold text-ink">{title}</h4>
        <p className="text-[11px] text-ink-muted mt-2">
          {it ? "Nessun dato per questa segmentazione." : "No data for this slice."}
        </p>
      </div>
    );
  }
  return (
    <div className="invest-trend-chart-panel rounded-xl border p-4">
      <h4 className="text-sm font-bold text-ink mb-1">{title}</h4>
      <p className="text-[11px] text-ink-muted leading-snug mb-3">{subtitle}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead>
            <tr className="border-b border-[rgb(var(--border))]/60 text-ink-muted">
              <th className="text-left font-semibold pb-1.5 pr-2">
                {it ? "Categoria" : "Category"}
              </th>
              <th className="text-right font-semibold pb-1.5 px-2">N</th>
              <th className="text-right font-semibold pb-1.5 px-2">WIN</th>
              <th className="text-right font-semibold pb-1.5 px-2">LOSS</th>
              <th className="text-right font-semibold pb-1.5 px-2">
                {it ? "Loss rate" : "Loss rate"}
              </th>
              <th className="text-right font-semibold pb-1.5 px-2">
                {it ? "Sorprese" : "Surprise"}
              </th>
              <th className="text-right font-semibold pb-1.5 px-2">
                {it ? "% sorpresa" : "Surprise %"}
              </th>
              <th className="text-right font-semibold pb-1.5 pl-2">
                {it ? "P&L medio" : "Avg PnL %"}
              </th>
              <th className="text-right font-semibold pb-1.5 pl-2">
                {it ? "P&L tot" : "Total PnL"}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.key} className="border-b border-[rgb(var(--border))]/30">
                <td className="py-1.5 pr-2 text-ink font-medium">{r.label}</td>
                <td className="py-1.5 px-2 text-right text-ink">{r.n}</td>
                <td className="py-1.5 px-2 text-right text-emerald-700">
                  {r.wins}
                </td>
                <td className="py-1.5 px-2 text-right text-rose-700">
                  {r.losses}
                </td>
                <td
                  className={`py-1.5 px-2 text-right ${toneForLossRate(r.lossRatePct, r.n)}`}
                >
                  {fmtPct(r.lossRatePct)}
                </td>
                <td className="py-1.5 px-2 text-right text-ink">
                  {r.losses > 0 ? r.surpriseLosses : "—"}
                </td>
                <td
                  className={`py-1.5 px-2 text-right ${toneForSurpriseRate(r.surpriseRatePct, r.losses)}`}
                  title={
                    r.losses > 0
                      ? `${r.surpriseLosses} loss su ${r.losses} con P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%`
                      : ""
                  }
                >
                  {r.losses > 0 ? fmtPct(r.surpriseRatePct) : "—"}
                </td>
                <td
                  className={`py-1.5 pl-2 text-right ${
                    r.avgPnlPct >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {fmtPct(r.avgPnlPct)}
                </td>
                <td
                  className={`py-1.5 pl-2 text-right font-semibold ${
                    r.realizedPnlEur >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {fmtEur(r.realizedPnlEur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LossAuditView({
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

  const audit: LossAuditResult | null = useMemo(
    () => computeLossAudit(closedRows, { simTable, sdsRows }),
    [closedRows, simTable, sdsRows],
  );

  if (!audit) {
    return (
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <h3 className="text-sm font-bold text-ink mb-1">
          {it ? "🔬 Audit dei deals in perdita" : "🔬 Loss audit"}
        </h3>
        <p className="text-[11px] text-ink-muted">
          {it
            ? "Nessun trade chiuso disponibile. Chiudi almeno una posizione nel Simulation Lab per attivare l'analisi."
            : "No closed trades available. Close at least one Simulation Lab position to enable this analysis."}
        </p>
      </div>
    );
  }

  const { summary, confusion, byPhase, byIndication, bySds, byPplan, calibration, timing } = audit;

  const calibChartData = calibration.map((b) => ({
    bin: b.binLabel,
    promised: Math.round(b.meanPPlanPct * 10) / 10,
    // CRITICAL: n=0 bins must NOT render the "delivered" bar (no data ≠ 0%).
    // Recharts skips Bar values when they are null/undefined.
    delivered: b.n > 0 ? Math.round(b.actualWinRatePct * 10) / 10 : null,
    n: b.n,
    delta: Math.round(b.deltaPct * 10) / 10,
  }));

  const timingChartData = timing.map((b) => ({
    bin: b.binLabel,
    n: b.n,
    avgLossPct: Math.round(b.avgLossPct * 10) / 10,
    realizedLossEur: Math.round(b.realizedLossEur),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0">🔬</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-ink">
              {it ? "Audit dei deals in perdita" : "Loss audit"}
            </h3>
            <p className="text-[11px] text-ink-muted leading-relaxed mt-1">
              {it
                ? `Analisi statistica dei trade chiusi: separiamo le perdite "secondo le previsioni" (modello aveva avvisato: P(plan) < ${OPTIMISTIC_PPLAN_PCT}%) dalle perdite "nonostante le previsioni" (modello ottimista: P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%). Le seconde sono i veri fallimenti del modello — dove rivedere la diversificazione.`
                : `Statistical analysis of closed trades: we split losses "as predicted" (model warned: P(plan) < ${OPTIMISTIC_PPLAN_PCT}%) from losses "despite the predictions" (model optimistic: P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%). The latter are the real failure modes — where to rethink diversification.`}
            </p>
            <p className="text-[10px] text-ink-muted mt-1 italic">
              {it
                ? `Soglia loss: pnl_pct < ${LOSS_THRESHOLD_PCT}% · Soglia ottimismo modello: P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%`
                : `Loss threshold: pnl_pct < ${LOSS_THRESHOLD_PCT}% · Model optimism threshold: P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%`}
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={it ? "Trade chiusi" : "Closed trades"}
          value={String(summary.totalClosed)}
          sub={
            it
              ? `${summary.totalWins} WIN · ${summary.totalLosses} LOSS · ${summary.totalFlat} FLAT`
              : `${summary.totalWins} WIN · ${summary.totalLosses} LOSS · ${summary.totalFlat} FLAT`
          }
          tone="neutral"
        />
        <KpiCard
          label={it ? "Loss rate" : "Loss rate"}
          value={fmtPct(summary.lossRatePct)}
          sub={
            it
              ? `${summary.totalLosses} su ${summary.totalClosed}`
              : `${summary.totalLosses} of ${summary.totalClosed}`
          }
          tone={summary.lossRatePct >= 40 ? "danger" : summary.lossRatePct >= 25 ? "warn" : "ok"}
        />
        <KpiCard
          label={it ? "Loss nonostante previsioni" : "Surprise losses"}
          value={fmtPct(summary.surpriseRatePct)}
          sub={
            it
              ? `${summary.surpriseLosses} loss con P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%`
              : `${summary.surpriseLosses} losses with P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%`
          }
          tone={summary.surpriseRatePct >= 50 ? "danger" : "warn"}
        />
        <KpiCard
          label={it ? "Perdita realizzata" : "Realized loss"}
          value={fmtEur(summary.realizedLossEur)}
          sub={
            it
              ? `Media: ${fmtEur(summary.avgLossEur)} · ${fmtPct(summary.avgLossPct)}`
              : `Avg: ${fmtEur(summary.avgLossEur)} · ${fmtPct(summary.avgLossPct)}`
          }
          tone={summary.realizedLossEur < 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Confusion matrix */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <h4 className="text-sm font-bold text-ink mb-1">
          {it
            ? "Matrice previsione × outcome reale"
            : "Prediction × actual outcome matrix"}
        </h4>
        <p className="text-[11px] text-ink-muted leading-snug mb-3">
          {it
            ? `Soglia ottimismo: P(plan) iniziale ≥ ${OPTIMISTIC_PPLAN_PCT}%. Trade risolti: ${confusion.totalTrades} (esclusi FLAT e con P(plan) mancante).`
            : `Optimism threshold: initial P(plan) ≥ ${OPTIMISTIC_PPLAN_PCT}%. Resolved trades: ${confusion.totalTrades} (FLAT and missing P(plan) excluded).`}
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div></div>
          <div className="text-center font-semibold text-ink text-[11px]">
            {it ? "Outcome reale: WIN" : "Actual: WIN"}
          </div>
          <div className="text-center font-semibold text-ink text-[11px]">
            {it ? "Outcome reale: LOSS" : "Actual: LOSS"}
          </div>

          <div className="font-semibold text-ink py-2 text-[11px]">
            {it
              ? `Modello ottimista (P ≥ ${OPTIMISTIC_PPLAN_PCT}%)`
              : `Model optimistic (P ≥ ${OPTIMISTIC_PPLAN_PCT}%)`}
          </div>
          <ConfusionCell
            value={confusion.tp}
            total={confusion.totalTrades}
            label={it ? "✓ True positive" : "✓ True positive"}
            tone="ok"
            detail={it ? "Modello giusto: gain previsto e realizzato." : "Model right: predicted win, got win."}
          />
          <ConfusionCell
            value={confusion.fp}
            total={confusion.totalTrades}
            label={
              it
                ? "✗ False positive (nonostante previsioni)"
                : "✗ False positive (despite predictions)"
            }
            tone="danger"
            detail={
              it
                ? "Modello sbagliato: previsto gain, ottenuto loss. Dove rivedere la diversificazione."
                : "Model wrong: predicted win, got loss. Where to rethink diversification."
            }
          />

          <div className="font-semibold text-ink py-2 text-[11px]">
            {it
              ? `Modello pessimista (P < ${OPTIMISTIC_PPLAN_PCT}%)`
              : `Model pessimistic (P < ${OPTIMISTIC_PPLAN_PCT}%)`}
          </div>
          <ConfusionCell
            value={confusion.fn}
            total={confusion.totalTrades}
            label={it ? "△ False negative" : "△ False negative"}
            tone="warn"
            detail={
              it
                ? "Sorpresa positiva: modello scettico ma gain. Gain potenzialmente persi se filtri troppo."
                : "Positive surprise: model skeptical but gain. Missed opportunities if you over-filter."
            }
          />
          <ConfusionCell
            value={confusion.tn}
            total={confusion.totalTrades}
            label={
              it
                ? "✓ True negative (secondo previsioni)"
                : "✓ True negative (as predicted)"
            }
            tone="info"
            detail={
              it
                ? "Modello giusto: warning preso, loss attesa."
                : "Model right: warning heeded, expected loss."
            }
          />
        </div>
      </div>

      {/* Category breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CategoryTable
          title={it ? "Per fase clinica" : "By clinical phase"}
          subtitle={
            it
              ? "Dove la fase clinica concentra il rischio? Più alta la % sorpresa, più il modello sottostima il rischio in quella fase."
              : "Where does clinical phase concentrate risk? Higher surprise % = model underestimates risk in that phase."
          }
          rows={byPhase}
          it={it}
        />
        <CategoryTable
          title={it ? "Per indicazione terapeutica" : "By therapeutic indication"}
          subtitle={
            it
              ? "Aree terapeutiche con loss inattese: candidati a sottopesare nel portafoglio."
              : "Therapeutic areas with surprise losses: candidates to underweight in the portfolio."
          }
          rows={byIndication}
          it={it}
        />
        <CategoryTable
          title={it ? "Per fascia SDS" : "By SDS bucket"}
          subtitle={
            it
              ? "L'SDS dovrebbe predire il rischio: se le sorprese sono concentrate in fasce alte, l'SDS non sta filtrando bene."
              : "SDS should predict risk: if surprises cluster in high buckets, SDS is not filtering well."
          }
          rows={bySds}
          it={it}
        />
        <CategoryTable
          title={it ? "Per fascia P(plan) iniziale" : "By initial P(plan) bucket"}
          subtitle={
            it
              ? "Calibrazione diretta: i bucket P(plan) ≥ 50% con loss rate alto rivelano l'overconfidence del modello."
              : "Direct calibration: P(plan) ≥ 50% buckets with high loss rate reveal model overconfidence."
          }
          rows={byPplan}
          it={it}
        />
      </div>

      {/* Calibration curve + Timing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="invest-trend-chart-panel rounded-xl border p-4">
          <h4 className="text-sm font-bold text-ink mb-1">
            {it
              ? "Calibrazione P(plan) → win rate effettivo"
              : "P(plan) calibration → actual win rate"}
          </h4>
          <p className="text-[11px] text-ink-muted leading-snug mb-3">
            {it
              ? "Confronto diretto: barra blu = promesso dal modello (P(plan) medio del bin), barra arancione = consegnato (win rate reale). Promesso > consegnato = modello overconfident. Bin con n=0 mostrano solo il promesso (non interpoliamo su dati assenti)."
              : "Direct comparison: blue bar = promised by the model (mean P(plan) in the bin), orange bar = delivered (actual win rate). Promised > delivered = overconfident model. Bins with n=0 show only the promised value (we don't interpolate over missing data)."}
          </p>
          <div className="w-full h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={calibChartData}
                margin={{ top: 10, right: 8, left: 0, bottom: 4 }}
                barGap={4}
                barCategoryGap="22%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.16)" vertical={false} />
                <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "#475569" }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "#475569" }}
                  tickFormatter={(v) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(value, name) => {
                    if (value == null) {
                      return [it ? "nessun dato" : "no data", String(name)];
                    }
                    return [`${value}%`, String(name)];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine
                  y={50}
                  stroke="#94a3b8"
                  strokeDasharray="3 3"
                  label={{
                    value: it ? "50% (coin-flip)" : "50% (coin-flip)",
                    fontSize: 9,
                    fill: "#64748b",
                    position: "insideTopRight",
                  }}
                />
                <Bar
                  dataKey="promised"
                  fill="#93c5fd"
                  radius={[3, 3, 0, 0]}
                  name={it ? "Promesso dal modello" : "Promised by model"}
                />
                <Bar
                  dataKey="delivered"
                  fill="#ea580c"
                  radius={[3, 3, 0, 0]}
                  name={it ? "Consegnato (reale)" : "Delivered (actual)"}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            {calibration.map((b) => (
              <div key={b.binLabel} className="text-center text-[10px]">
                <p className="font-semibold text-ink">{b.binLabel}</p>
                <p className="text-ink-muted">n={b.n}</p>
                {b.n === 0 ? (
                  <p className="text-ink-muted italic">
                    {it ? "nessun dato" : "no data"}
                  </p>
                ) : (
                  <p
                    className={
                      b.deltaPct >= -5
                        ? "text-emerald-700 font-semibold"
                        : b.deltaPct >= -15
                          ? "text-amber-700 font-semibold"
                          : "text-rose-700 font-bold"
                    }
                  >
                    Δ {b.deltaPct >= 0 ? "+" : ""}
                    {b.deltaPct.toFixed(1)}%
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="invest-trend-chart-panel rounded-xl border p-4">
          <h4 className="text-sm font-bold text-ink mb-1">
            {it ? "Timing dei collassi" : "Timing of collapses"}
          </h4>
          <p className="text-[11px] text-ink-muted leading-snug mb-3">
            {it
              ? "Quando crollano i deals in perdita? Crash rapidi (0-7d) richiedono stop-loss stretto; crolli lenti (>90d) suggeriscono di rivedere la finestra di hold."
              : "When do losing deals collapse? Fast crashes (0-7d) need tight stop-loss; slow drops (>90d) suggest rethinking the hold window."}
          </p>
          <div className="w-full h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timingChartData} margin={{ top: 10, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.16)" />
                <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "#475569" }} />
                <YAxis
                  tick={{ fontSize: 10, fill: "#475569" }}
                  width={36}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v: number, name: string) => {
                    if (name === "n") return [`${v}`, it ? "Loss in questo bucket" : "Losses in bucket"];
                    if (name === "avgLossPct")
                      return [`${v}%`, it ? "Loss medio %" : "Avg loss %"];
                    if (name === "realizedLossEur")
                      return [fmtEur(v), it ? "Loss realizzata €" : "Realized loss €"];
                    return [`${v}`, name];
                  }}
                />
                <Bar dataKey="n" name={it ? "Loss in bucket" : "Losses"}>
                  {timingChartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={
                        d.bin.startsWith("0-7")
                          ? "#dc2626"
                          : d.bin.startsWith("8-30")
                            ? "#f59e0b"
                            : d.bin.startsWith("31-90")
                              ? "#eab308"
                              : "#6b7280"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            {timing.map((t) => (
              <div key={t.binLabel} className="text-center text-[10px]">
                <p className="font-semibold text-ink">{t.binLabel}</p>
                <p className="text-ink-muted">n={t.n}</p>
                <p
                  className={t.avgLossPct <= -10 ? "text-rose-700 font-bold" : "text-rose-600"}
                >
                  {fmtPct(t.avgLossPct)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Final insight box */}
      <div className="rounded-xl border border-amber-300/60 bg-amber-50/50 p-4">
        <h4 className="text-sm font-bold text-amber-900 mb-2">
          {it ? "🎯 Implicazioni per la diversificazione" : "🎯 Implications for diversification"}
        </h4>
        <ul className="text-[12px] text-amber-900/90 leading-relaxed space-y-1 list-disc list-inside">
          <li>
            {it
              ? `${summary.surpriseLosses} su ${summary.totalLosses} loss (${fmtPct(summary.surpriseRatePct)}) sono arrivate `
              : `${summary.surpriseLosses} of ${summary.totalLosses} losses (${fmtPct(summary.surpriseRatePct)}) came `}
            <strong>
              {it ? "nonostante un P(plan) ottimista" : "despite optimistic P(plan)"}
            </strong>
            {it
              ? ` — sono i veri rischi non catturati dal modello.`
              : ` — these are the real risks the model is missing.`}
          </li>
          {byPhase.filter((p) => p.n > 0 && p.surpriseRatePct >= 50).length > 0 && (
            <li>
              {it ? "Fasi con sorpresa ≥50%: " : "Phases with surprise ≥50%: "}
              <strong>
                {byPhase
                  .filter((p) => p.n > 0 && p.surpriseRatePct >= 50)
                  .map((p) => p.label)
                  .join(", ")}
              </strong>
              {it ? " — sottopesare nel portafoglio." : " — underweight in portfolio."}
            </li>
          )}
          {bySds.filter((p) => p.n > 0 && p.surpriseRatePct >= 50 && p.key !== "No SDS").length > 0 && (
            <li>
              {it ? "Fasce SDS con sorpresa ≥50%: " : "SDS buckets with surprise ≥50%: "}
              <strong>
                {bySds
                  .filter((p) => p.n > 0 && p.surpriseRatePct >= 50 && p.key !== "No SDS")
                  .map((p) => p.label)
                  .join(", ")}
              </strong>
              {it
                ? " — l'SDS in queste fasce non sta filtrando il rischio."
                : " — SDS is not filtering risk in these buckets."}
            </li>
          )}
          {calibration.some((b) => b.n >= 3 && b.deltaPct <= -15) && (
            <li>
              {it ? "Calibrazione P(plan): bin overconfident: " : "P(plan) calibration: overconfident bins: "}
              <strong>
                {calibration
                  .filter((b) => b.n >= 3 && b.deltaPct <= -15)
                  .map((b) => `${b.binLabel} (Δ${b.deltaPct.toFixed(0)}%)`)
                  .join(", ")}
              </strong>
              {it
                ? " — il modello promette più di quanto consegna."
                : " — model promises more than it delivers."}
            </li>
          )}
          {timing[0]?.n != null && timing[0]!.n >= 3 && (
            <li>
              {it
                ? `${timing[0]!.n} loss sono crollati nei primi 7 giorni (avg ${fmtPct(timing[0]!.avgLossPct)}) — valuta stop-loss stretto.`
                : `${timing[0]!.n} losses collapsed within 7 days (avg ${fmtPct(timing[0]!.avgLossPct)}) — consider tight stop-loss.`}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
