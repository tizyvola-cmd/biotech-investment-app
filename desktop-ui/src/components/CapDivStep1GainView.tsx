import { useMemo, useState, useCallback } from "react";
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
import {
  loadSimLoopPolicy,
  saveSimLoopPolicy,
  type SimLoopAcceptancePolicy,
} from "../sheet/simLoopAcceptancePolicy";

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
function fmtExpectancy(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} €`;
}

const BUCKET_COLOR: Record<string, string> = {
  "SDS <40 (Low)": "#f97316",
  "SDS 40-55 (Mid)": "#eab308",
  "SDS 55-70 (High)": "#22c55e",
  "SDS ≥70 (Premium)": "#0ea5e9",
  "No SDS": "#94a3b8",
};

type UniverseTab = "all" | "real" | "simloop";

function filterByUniverse(rows: SimOutcomeRow[], tab: UniverseTab): SimOutcomeRow[] {
  if (tab === "all") return rows;
  return rows.filter((r) => {
    const u = (r as SimOutcomeRow & { universe?: string }).universe;
    if (tab === "real") return u === "real";
    if (tab === "simloop") return u === "simloop" || !u;
    return true;
  });
}

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
  const [universeTab, setUniverseTab] = useState<UniverseTab>("all");
  const [showPolicy, setShowPolicy] = useState(false);
  const [policy, setPolicy] = useState<SimLoopAcceptancePolicy>(() => loadSimLoopPolicy());

  const handlePolicySave = useCallback((p: SimLoopAcceptancePolicy) => {
    saveSimLoopPolicy(p);
    setPolicy({ ...p });
  }, []);

  const nReal = useMemo(() => closedRows.filter((r) => (r as SimOutcomeRow & { universe?: string }).universe === "real").length, [closedRows]);
  const nSimLoop = useMemo(() => closedRows.filter((r) => { const u = (r as SimOutcomeRow & { universe?: string }).universe; return u === "simloop" || !u; }).length, [closedRows]);

  const filteredRows = useMemo(
    () => filterByUniverse(closedRows, universeTab),
    [closedRows, universeTab],
  );

  const stats = useMemo(
    () => extractTradeStatsFromClosedOutcomes(filteredRows),
    [filteredRows],
  );

  const breakdown = useMemo(
    () => computeSdsGainBreakdown(filteredRows, { simTable, sdsRows }),
    [filteredRows, simTable, sdsRows],
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
      <header className="flex items-start gap-3 flex-wrap">
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
        {/* Universe tab selector */}
        <div className="ml-auto flex items-center gap-1 self-start mt-0.5">
          {([
            { id: "all" as UniverseTab, label: it ? "Tutti" : "All", n: closedRows.length },
            { id: "real" as UniverseTab, label: it ? "Portafoglio" : "Real Portfolio", n: nReal },
            { id: "simloop" as UniverseTab, label: "Sim Loop", n: nSimLoop },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setUniverseTab(tab.id)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
                universeTab === tab.id
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white/60 dark:bg-surface/50 text-ink-muted border-[rgb(var(--border))]/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
              }`}
            >
              {tab.label}
              <span className={`ml-1 text-[9px] ${universeTab === tab.id ? "opacity-80" : "opacity-60"}`}>
                n={tab.n}
              </span>
            </button>
          ))}
          {nReal === 0 && (
            <span className="text-[9px] text-amber-600 dark:text-amber-400 ml-1" title={it ? "Nessun trade con tag universe=real. Il tag viene assegnato ai nuovi acquisti dopo questo aggiornamento." : "No trades tagged universe=real yet. Tags are assigned to new buys after this update."}>
              ⚠ {it ? "Tag in attesa" : "Tags pending"}
            </span>
          )}
        </div>
      </header>

      {/* Sim Loop Policy panel */}
      {universeTab === "simloop" && (
        <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/10 px-3 py-2">
          <button
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setShowPolicy((v) => !v)}
          >
            <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
              {it ? "Sim Loop Acceptance Policy" : "Sim Loop Acceptance Policy"}
            </span>
            <span className="text-[10px] text-amber-700/70 dark:text-amber-300/70 ml-1">
              {it
                ? `SDS ≥ ${policy.minSds || "—"} · P(plan) ≥ ${policy.minPplanPct || "—"}%`
                : `SDS ≥ ${policy.minSds || "—"} · P(plan) ≥ ${policy.minPplanPct || "—"}%`}
            </span>
            <span className="ml-auto text-[10px] text-ink-muted">{showPolicy ? "▲" : "▼"}</span>
          </button>
          {showPolicy && (
            <SimLoopPolicyEditor
              policy={policy}
              onSave={handlePolicySave}
              it={it}
            />
          )}
        </div>
      )}

      {/* KPI strip — gain + expectancy */}
      {stats ? (
        <>
          {/* Row 1: win/loss summary */}
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
              label={it ? "Avg loss (loss)" : "Avg loss (loss)"}
              value={fmtEur(-stats.avgLossEur)}
              sub={`−${stats.avgLossPct.toFixed(1)}%`}
              tone="rose"
            />
            <KpiCard
              label={it ? "Avg hold days" : "Avg hold days"}
              value={fmtDays(stats.avgHoldDays)}
              sub={it ? "round-trip" : "round-trip"}
              tone="neutral"
            />
            <KpiCard
              label={it ? "Win/Loss ratio" : "Win/Loss ratio"}
              value={
                stats.avgLossEur > 0
                  ? `${(stats.avgWinEur / stats.avgLossEur).toFixed(2)}×`
                  : "—"
              }
              sub={it ? "avg gain ÷ avg loss" : "avg gain ÷ avg loss"}
              tone={stats.avgWinEur / Math.max(0.01, stats.avgLossEur) >= 1.5 ? "emerald" : "warn"}
            />
          </div>
          {/* Row 2: expectancy + breakeven */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiCard
              label={it ? "Expectancy €/trade" : "Expectancy €/trade"}
              value={fmtExpectancy(stats.expectancyEurPerTrade)}
              sub={
                it
                  ? `E[trade] = winRate×avgWin − lossRate×avgLoss`
                  : `E[trade] = winRate×avgWin − lossRate×avgLoss`
              }
              tone={stats.expectancyEurPerTrade >= 0 ? "emerald" : "danger"}
            />
            <KpiCard
              label={it ? "Breakeven win rate" : "Breakeven win rate"}
              value={
                stats.breakevenWinRate != null
                  ? fmtPct01(stats.breakevenWinRate)
                  : "—"
              }
              sub={
                stats.breakevenWinRate != null
                  ? it
                    ? `attuale: ${fmtPct01(stats.winRate)} — ${stats.winRate >= stats.breakevenWinRate ? "✓ sopra" : "✗ sotto"}`
                    : `current: ${fmtPct01(stats.winRate)} — ${stats.winRate >= stats.breakevenWinRate ? "✓ above" : "✗ below"}`
                  : undefined
              }
              tone={
                stats.breakevenWinRate != null && stats.winRate >= stats.breakevenWinRate
                  ? "emerald"
                  : "danger"
              }
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
        </>
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
          <p className="text-[10px] text-ink-muted leading-relaxed">
            {it
              ? "Ogni riga raggruppa i deal per fascia SDS (forza del segnale di momentum). " +
                "Le colonne \"Aperte\" mostrano le opportunità ancora aperte e il loro ROI atteso. " +
                "Le colonne \"Chiusi\" mostrano i trade già conclusi e la performance reale. " +
                "Confronta E[ROI] (previsto) con ROI realizzato per vedere se la fascia \"mantiene le promesse\"."
              : "Each row groups deals by SDS bucket (momentum signal strength). " +
                "\"Open\" columns show still-open opportunities and their expected ROI. " +
                "\"Closed\" columns show completed trades and their actual performance. " +
                "Compare E[ROI] (expected) with Realized ROI to see whether the bucket \"delivers on its promises\"."}
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <colgroup>
              <col style={{ width: "16%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "7%" }} />
            </colgroup>
            <thead className="text-[10px] uppercase text-ink-muted bg-emerald-50/50 dark:bg-emerald-950/20">
              <tr>
                <th className="text-left px-2 py-1.5" title={it ? "Fascia SDS: classifica il momentum del titolo (es. SDS <40 = segnale debole, SDS 40-55 = medio, SDS ≥70 = forte)" : "SDS bucket: classifies the stock's momentum signal (e.g. SDS <40 = weak signal, SDS 40-55 = mid, SDS ≥70 = strong)"}>{it ? "Fascia" : "Bucket"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "Numero di opportunità aperte in questa fascia SDS" : "Number of still-open opportunities in this SDS bucket"}>{it ? "Aperte" : "Open"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "ROI atteso medio delle posizioni aperte (planReturn medio della fascia)" : "Average expected ROI of open positions (mean planReturn for this bucket)"}>{it ? "ROI att." : "Prom. ROI"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "P(plan): probabilità media che il piano vada a target (da 0% a 100%)" : "P(plan): average probability that the plan reaches its target (0% to 100%)"}>{it ? "P(plan)" : "P(plan)"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "E[ROI] = ROI atteso × P(plan) / 100 — ROI medio corretto per la probabilità di successo" : "E[ROI] = expected ROI × P(plan) / 100 — probability-adjusted expected return"}>{it ? "E[ROI]" : "E[ROI]"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "Numero di trade chiusi (con esito noto) in questa fascia" : "Number of closed trades (with known outcome) in this bucket"}>{it ? "Chiusi (n)" : "Closed (n)"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "Win rate = % di trade chiusi in guadagno · ✓ = winner, ✗ = loser" : "Win rate = % of closed trades that ended in profit · ✓ = winner, ✗ = loser"}>{it ? "Win rate (✓/✗)" : "Win rate (✓/✗)"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "Guadagno medio % sui trade chiusi in profitto" : "Average % gain on closed trades that were profitable"}>{it ? "Avg win%" : "Avg win%"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "Perdita media % sui trade chiusi in perdita" : "Average % loss on closed trades that ended in loss"}>{it ? "Avg loss%" : "Avg loss%"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "ROI medio realizzato su tutti i trade chiusi della fascia (mix di win e loss)" : "Mean realized ROI across all closed trades in this bucket (mix of wins and losses)"}>{it ? "ROI realiz." : "Realized ROI"}</th>
                <th className="text-center px-2 py-1.5" title={it ? "ROI per giorno = ROI realizzato / durata media del trade in giorni — misura l'efficienza temporale" : "ROI per day = realized ROI / average trade duration in days — measures time efficiency"}>{it ? "ROI/g" : "ROI/d"}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((r) => {
                const lowSample = r.deliveredN > 0 && r.deliveredN < 5;
                const winPct = r.deliveredWinRate != null ? r.deliveredWinRate * 100 : null;
                const wins = r.deliveredN > 0 && r.deliveredWinRate != null
                  ? Math.round(r.deliveredN * r.deliveredWinRate)
                  : null;
                const losses = wins != null ? r.deliveredN - wins : null;
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
                    {/* Win rate con bar visiva + conteggio win/loss */}
                    <td className={`text-center px-2 py-1.5 ${lowSample ? "text-ink-muted/60 italic" : ""}`}>
                      {r.deliveredN > 0 && winPct != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="tabular-nums text-[11px] font-semibold">
                            {fmtPct01(r.deliveredWinRate)}
                          </span>
                          <div className="w-full h-1.5 rounded-full bg-rose-200 dark:bg-rose-900/40 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${Math.min(100, winPct)}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-ink-muted tabular-nums">
                            {wins}✓ {losses}✗
                          </span>
                        </div>
                      ) : "—"}
                    </td>
                    {/* Avg win% */}
                    <td className={`text-center px-2 py-1.5 tabular-nums text-emerald-600 ${lowSample ? "opacity-50 italic" : "font-semibold"}`}>
                      {r.deliveredN > 0 && r.deliveredAvgWinPct != null
                        ? `+${r.deliveredAvgWinPct.toFixed(1)}%`
                        : "—"}
                    </td>
                    {/* Avg loss% */}
                    <td className={`text-center px-2 py-1.5 tabular-nums text-rose-600 ${lowSample ? "opacity-50 italic" : "font-semibold"}`}>
                      {r.deliveredN > 0 && r.deliveredAvgLossPct != null
                        ? `−${Math.abs(r.deliveredAvgLossPct).toFixed(1)}%`
                        : "—"}
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

function SimLoopPolicyEditor({
  policy,
  onSave,
  it,
}: {
  policy: SimLoopAcceptancePolicy;
  onSave: (p: SimLoopAcceptancePolicy) => void;
  it: boolean;
}) {
  const [minSds, setMinSds] = useState(policy.minSds);
  const [minPplan, setMinPplan] = useState(policy.minPplanPct);
  const [rejectPattern, setRejectPattern] = useState(policy.rejectOnLossPattern);
  const [note, setNote] = useState(policy.note);

  const isDirty =
    minSds !== policy.minSds ||
    minPplan !== policy.minPplanPct ||
    rejectPattern !== policy.rejectOnLossPattern ||
    note !== policy.note;

  return (
    <div className="mt-2 space-y-2 border-t border-amber-200/50 dark:border-amber-800/30 pt-2">
      <p className="text-[10px] text-amber-700/80 dark:text-amber-300/70 leading-relaxed">
        {it
          ? "Definisci le soglie minime che un segnale BUY deve superare per essere accettato automaticamente dal Sim Loop. 0 = nessun filtro (comportamento attuale)."
          : "Set the minimum thresholds a BUY signal must pass to be automatically accepted by the Sim Loop. 0 = no filter (current behaviour)."}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium text-ink-muted">
            {it ? "SDS minimo (0 = disabilitato)" : "Min SDS (0 = disabled)"}
          </span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={minSds}
            onChange={(e) => setMinSds(Number(e.target.value))}
            className="w-full rounded border border-[rgb(var(--border))]/50 bg-white/70 dark:bg-surface/60 px-2 py-1 text-[11px] tabular-nums"
          />
          <span className="text-[9px] text-ink-muted">
            {it ? "es. 40 = solo Mid/High/Premium" : "e.g. 40 = Mid/High/Premium only"}
          </span>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium text-ink-muted">
            {it ? "P(plan) minimo % (0 = disabilitato)" : "Min P(plan) % (0 = disabled)"}
          </span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={minPplan}
            onChange={(e) => setMinPplan(Number(e.target.value))}
            className="w-full rounded border border-[rgb(var(--border))]/50 bg-white/70 dark:bg-surface/60 px-2 py-1 text-[11px] tabular-nums"
          />
          <span className="text-[9px] text-ink-muted">
            {it ? "es. 50 = solo segnali con affidabilità ≥ 50%" : "e.g. 50 = only signals with P(plan) ≥ 50%"}
          </span>
        </label>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={rejectPattern}
          onChange={(e) => setRejectPattern(e.target.checked)}
          className="rounded"
        />
        <span className="text-[10px] text-ink-muted">
          {it
            ? "Rifiuta BUY se il ticker matcha il pattern di rischio approvato (Step 2)"
            : "Reject BUY if ticker matches approved loss-risk pattern (Step 2)"}
        </span>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium text-ink-muted">
          {it ? "Nota (opzionale)" : "Note (optional)"}
        </span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={it ? "es. calibrata da analisi errori giugno 2026" : "e.g. calibrated from June 2026 error analysis"}
          className="w-full rounded border border-[rgb(var(--border))]/50 bg-white/70 dark:bg-surface/60 px-2 py-1 text-[11px]"
        />
      </label>
      <div className="flex items-center gap-2 pt-1">
        <button
          disabled={!isDirty}
          onClick={() => onSave({ ...policy, minSds, minPplanPct: minPplan, rejectOnLossPattern: rejectPattern, note })}
          className="px-3 py-1 rounded-md text-[10px] font-medium bg-amber-600 text-white disabled:opacity-40 hover:bg-amber-700 transition-colors"
        >
          {it ? "Salva policy" : "Save policy"}
        </button>
        {policy.updatedAt && (
          <span className="text-[9px] text-ink-muted">
            {it ? "Aggiornata" : "Updated"}: {new Date(policy.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
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
  tone: "emerald" | "indigo" | "teal" | "neutral" | "rose" | "warn" | "danger";
  lowSample?: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "indigo"
        ? "text-indigo-700 dark:text-indigo-300"
        : tone === "teal"
          ? "text-teal-700 dark:text-teal-300"
          : tone === "rose"
            ? "text-rose-700 dark:text-rose-300"
            : tone === "warn"
              ? "text-amber-700 dark:text-amber-300"
              : tone === "danger"
                ? "text-rose-700 dark:text-rose-300 font-bold"
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
