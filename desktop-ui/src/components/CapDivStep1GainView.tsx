import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { extractTradeStatsFromClosedOutcomes } from "../sheet/portfolioDiversificationLab";
import { useLang } from "../shared/i18n";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}
function fmtPct01(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString("it-IT")} €`;
}
function fmtDays(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(0)} d`;
}
function fmtRoiPerDay(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%/d`;
}

const BUCKET_COLOR: Record<string, string> = {
  "SDS <40 (Low)": "#f97316",
  "SDS 40-55 (Mid)": "#eab308",
  "SDS 55-70 (High)": "#22c55e",
  "SDS ≥70 (Premium)": "#0ea5e9",
  "No SDS": "#94a3b8",
};

export function CapDivStep1GainView({
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

  const stats = useMemo(
    () => extractTradeStatsFromClosedOutcomes(closedRows),
    [closedRows],
  );

  const breakdown = useMemo(
    () => computeSdsGainBreakdown(closedRows, { simTable, sdsRows }),
    [closedRows, simTable, sdsRows],
  );

  // Chart data: ROI/day promesso vs delivered per SDS bucket (only buckets
  // with at least some data on either side).
  const chartData = useMemo(
    () =>
      breakdown.rows
        .filter((r) => r.deliveredN > 0 || r.promisedOpenN > 0)
        .map((r) => ({
          bucket: r.bucket,
          promisedRoiPerDay:
            r.promisedExpectedRoiPerDay != null
              ? Number(r.promisedExpectedRoiPerDay.toFixed(2))
              : null,
          deliveredRoiPerDay:
            r.deliveredAvgRoiPerDay != null
              ? Number(r.deliveredAvgRoiPerDay.toFixed(2))
              : null,
        })),
    [breakdown],
  );

  return (
    <section className="rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/30 dark:from-emerald-950/15 dark:via-surface dark:to-teal-950/15 px-4 py-4 space-y-4">
      {/* Header */}
      <header className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-emerald-500/15 dark:bg-emerald-400/20 flex items-center justify-center text-emerald-700 dark:text-emerald-200 font-bold">
          1
        </div>
        <div>
          <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-100">
            {it ? "Step 1 — Potenziale di guadagno (SDS × tempo)" : "Step 1 — Gain potential (SDS × time)"}
          </h2>
          <p className="text-[11px] leading-relaxed text-emerald-800/75 dark:text-emerald-200/75 max-w-3xl">
            {it
              ? "Quanto promette il sistema in termini di ROI e quanto effettivamente delivera, segmentato per fascia SDS. Confidence-aware: i numeri con n basso sono marcati in grigio."
              : "What the system promises in ROI terms and what it actually delivered, segmented by SDS bucket. Confidence-aware: low-n numbers are greyed out."}
          </p>
        </div>
      </header>

      {/* KPI strip — gain side only */}
      {stats ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <KpiCard
            label={it ? "Win rate" : "Win rate"}
            value={fmtPct01(stats.winRate)}
            sub={`${stats.winCount}✓ · ${stats.lossCount}✗ · n=${stats.sampleSize}`}
            tone="emerald"
            lowSample={stats.sampleSize < 8}
          />
          <KpiCard
            label={it ? "Avg gain (win)" : "Avg gain (win)"}
            value={fmtEur(stats.avgWinEur)}
            sub={`+${stats.avgWinPct.toFixed(1)}%`}
            tone="emerald"
          />
          <KpiCard
            label={it ? "Avg hold days" : "Avg hold days"}
            value={fmtDays(stats.avgHoldDays)}
            sub={it ? "round-trip" : "round-trip"}
            tone="neutral"
          />
          <KpiCard
            label={it ? "ROI atteso / op." : "Expected ROI / op."}
            value={fmtPct(breakdown.globalPromisedExpectedRoiPct)}
            sub={it ? "media su opp. aperte" : "average on open opps"}
            tone="indigo"
          />
          <KpiCard
            label={it ? "ROI realizzato medio" : "Avg realized ROI"}
            value={fmtPct(breakdown.globalDeliveredAvgPnlPct)}
            sub={it ? "media su trade chiusi" : "average on closed trades"}
            tone="teal"
          />
        </div>
      ) : (
        <p className="text-xs text-ink-muted py-3">
          {it ? "Nessun trade chiuso ancora — KPI non disponibili." : "No closed trades yet — KPIs not available."}
        </p>
      )}

      {/* SDS breakdown table */}
      <div className="rounded-xl border border-emerald-200/40 dark:border-emerald-800/30 bg-white/60 dark:bg-surface/60">
        <header className="px-3 py-2 border-b border-emerald-200/40 dark:border-emerald-800/30">
          <h3 className="text-[12px] font-semibold text-ink">
            {it ? "Breakdown per fascia SDS" : "Breakdown by SDS bucket"}
          </h3>
          <p className="text-[10px] text-ink-muted">
            {it
              ? "Promesso = media (planReturn × planProb / 100) sulle opp aperte · Delivered = media pnl% sui chiusi (frozen)."
              : "Promised = mean (planReturn × planProb / 100) on open opps · Delivered = mean pnl% on closed (frozen)."}
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead className="text-[10px] uppercase text-ink-muted bg-emerald-50/50 dark:bg-emerald-950/20">
              <tr>
                <th className="text-left px-2 py-1.5">{it ? "Fascia" : "Bucket"}</th>
                <th className="text-center px-2 py-1.5">{it ? "Op. aperte" : "Open opps"}</th>
                <th className="text-center px-2 py-1.5">{it ? "ROI atteso" : "Promised ROI"}</th>
                <th className="text-center px-2 py-1.5">{it ? "P(plan) avg" : "P(plan) avg"}</th>
                <th className="text-center px-2 py-1.5">{it ? "Atteso E[ROI]" : "E[ROI]"}</th>
                <th className="text-center px-2 py-1.5">{it ? "Chiusi (n)" : "Closed (n)"}</th>
                <th className="text-center px-2 py-1.5">{it ? "Win rate" : "Win rate"}</th>
                <th className="text-center px-2 py-1.5">{it ? "ROI realizzato" : "Realized ROI"}</th>
                <th className="text-center px-2 py-1.5">{it ? "ROI/giorno" : "ROI/day"}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((r) => {
                const lowSample = r.deliveredN > 0 && r.deliveredN < 5;
                return (
                  <tr key={r.bucket} className="border-t border-[rgb(var(--border))]/30">
                    <td className="text-left px-2 py-1.5 font-medium">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                        style={{ backgroundColor: BUCKET_COLOR[r.bucket] ?? "#94a3b8" }}
                      />
                      {r.bucket}
                    </td>
                    <td className="text-center px-2 py-1.5 tabular-nums">{r.promisedOpenN || "—"}</td>
                    <td className="text-center px-2 py-1.5 tabular-nums">{fmtPct(r.promisedAvgRoiPct)}</td>
                    <td className="text-center px-2 py-1.5 tabular-nums">{fmtPct(r.promisedAvgProbPct)}</td>
                    <td className="text-center px-2 py-1.5 tabular-nums font-semibold text-indigo-700 dark:text-indigo-400">
                      {fmtPct(r.promisedExpectedRoiPct)}
                    </td>
                    <td className={`text-center px-2 py-1.5 tabular-nums ${lowSample ? "text-ink-muted/60 italic" : ""}`}>
                      {r.deliveredN || "—"}
                    </td>
                    <td className={`text-center px-2 py-1.5 tabular-nums ${lowSample ? "text-ink-muted/60 italic" : ""}`}>
                      {r.deliveredN > 0 ? fmtPct01(r.deliveredWinRate) : "—"}
                    </td>
                    <td className={`text-center px-2 py-1.5 tabular-nums ${lowSample ? "text-ink-muted/60 italic" : "font-semibold"} ${
                      r.deliveredAvgPnlPct != null && r.deliveredAvgPnlPct >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}>
                      {fmtPct(r.deliveredAvgPnlPct)}
                    </td>
                    <td className={`text-center px-2 py-1.5 tabular-nums ${lowSample ? "text-ink-muted/60 italic" : ""}`}>
                      {fmtRoiPerDay(r.deliveredAvgRoiPerDay)}
                    </td>
                  </tr>
                );
              })}
              {breakdown.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center px-2 py-6 text-ink-muted italic">
                    {it ? "Nessun dato ancora disponibile." : "No data available yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Promised vs Delivered ROI/day chart */}
      {chartData.length > 0 ? (
        <div className="rounded-xl border border-emerald-200/40 dark:border-emerald-800/30 bg-white/70 dark:bg-surface/70 p-3">
          <h3 className="text-[12px] font-semibold text-ink mb-1">
            {it
              ? "ROI/giorno — Promesso (aperte) vs Delivered (chiuse) per fascia SDS"
              : "ROI/day — Promised (open) vs Delivered (closed) per SDS bucket"}
          </h3>
          <p className="text-[10px] text-ink-muted mb-2">
            {it
              ? "Differenza visiva tra ROI/giorno atteso dal modello (blu) e ROI/giorno realizzato (verde se positivo, rosso se negativo). Fasce senza dati su un lato mostrano una sola barra."
              : "Visual gap between model-expected ROI/day (blue) and realized ROI/day (green if positive, red if negative). Buckets without data on one side show only one bar."}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ left: 4, right: 8, bottom: 0, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={50} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v, name) => {
                  if (v == null) return [it ? "n/d" : "n/a", String(name)];
                  return [`${Number(v).toFixed(2)}%/${it ? "g" : "d"}`, String(name)];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar
                dataKey="promisedRoiPerDay"
                name={it ? "Promesso (E[ROI]/giorno)" : "Promised (E[ROI]/day)"}
                fill="#6366f1"
              />
              <Bar
                dataKey="deliveredRoiPerDay"
                name={it ? "Delivered (storico)" : "Delivered (historical)"}
              >
                {chartData.map((entry, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={
                      entry.deliveredRoiPerDay == null
                        ? "rgba(0,0,0,0)"
                        : entry.deliveredRoiPerDay >= 0
                          ? "#10b981"
                          : "#ef4444"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  lowSample,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "emerald" | "indigo" | "teal" | "neutral";
  lowSample?: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "indigo"
        ? "text-indigo-700 dark:text-indigo-300"
        : tone === "teal"
          ? "text-teal-700 dark:text-teal-300"
          : "text-ink";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-white/60 dark:bg-surface/50 px-2 py-2">
      <p className="text-[9px] uppercase font-medium text-ink-muted">{label}</p>
      <p className={`text-base font-bold tabular-nums ${toneClass}`}>{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted tabular-nums">{sub}</p> : null}
      {lowSample ? (
        <p className="text-[8px] text-amber-700 dark:text-amber-300 leading-tight mt-0.5">
          n basso — confidence LOW
        </p>
      ) : null}
    </div>
  );
}
