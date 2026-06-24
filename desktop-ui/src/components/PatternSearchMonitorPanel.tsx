/**
 * Pattern Combination Search Engine — Monitor Panel.
 *
 * Displays the results of the last PCSE run and the stability history
 * of the top combinations over time.
 *
 * Data flow (read-only here — writes happen in CapDivStep2RiskView):
 *   PcseRunResult  →  table ranked by stabilityScore
 *   PatternSearchHistory  →  lift-over-time chart for top 5
 */
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PcseRunResult, CombinationResult } from "../sheet/patternCombinationSearch";
import {
  MIN_HISTORICAL_N_FILTER,
  PROMOTION_MIN_LIFT,
} from "../sheet/patternCombinationSearch";
import { liftHistoryForLabel } from "../sheet/patternSearchHistory";
import { useLang } from "../shared/i18n";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtLift(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}×`;
}

function confidenceBadge(c: CombinationResult["confidence"]): string {
  if (c === "HIGH") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (c === "MEDIUM") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
}

function stabilityColor(score: number): string {
  if (score >= 75) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 50) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

function liftDeltaBadge(delta: number | null): string {
  if (delta == null) return "text-ink-muted";
  if (Math.abs(delta) <= 0.15) return "text-emerald-700 dark:text-emerald-300";
  if (Math.abs(delta) <= 0.5) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300 font-semibold";
}

const LINE_COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
];

// ── Sub-components ─────────────────────────────────────────────────────────

function LiftEvolutionChart({ topResults }: { topResults: CombinationResult[] }) {
  const top5 = topResults.slice(0, 5);

  const seriesData = useMemo(() => {
    return top5.map((r) => ({
      label: r.label,
      points: liftHistoryForLabel(r.label),
    }));
  }, [top5]);

  // Merge all timestamps into a unified X-axis
  const allTs = useMemo(() => {
    const set = new Set<string>();
    for (const s of seriesData) s.points.forEach((p) => set.add(p.ts));
    return [...set].sort();
  }, [seriesData]);

  if (allTs.length < 2) {
    return (
      <p className="text-[11px] text-ink-muted italic py-2">
        Lift evolution chart available after ≥ 2 PCSE runs.
      </p>
    );
  }

  const chartData = allTs.map((ts) => {
    const point: Record<string, string | number> = {
      ts: ts.slice(0, 10),
    };
    seriesData.forEach((s, i) => {
      const match = s.points.find((p) => p.ts === ts);
      if (match) point[`lift_${i}`] = match.lift;
    });
    return point;
  });

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,100,120,0.12)" />
          <XAxis
            dataKey="ts"
            tick={{ fontSize: 9 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}×`}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 6 }}
            formatter={(value: number, name: string) => {
              const idx = parseInt(name.replace("lift_", ""), 10);
              return [`${value.toFixed(2)}×`, seriesData[idx]?.label ?? name];
            }}
          />
          <ReferenceLine
            y={PROMOTION_MIN_LIFT}
            stroke="#6366f1"
            strokeDasharray="4 2"
            label={{ value: "promo", fontSize: 8, fill: "#6366f1" }}
          />
          {seriesData.map((_, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`lift_${i}`}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function PatternSearchMonitorPanel({
  runResult,
  onPromote,
}: {
  runResult: PcseRunResult | null;
  /** Called when the user clicks "Promote" on a promotion-ready combination. */
  onPromote?: (result: CombinationResult) => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const [showAll, setShowAll] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());

  const MAX_COMPARE = 5;

  function toggleSelected(label: string) {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else if (next.size < MAX_COMPARE) {
        next.add(label);
      }
      return next;
    });
  }

  // Engine already requires historicalN >= MIN_HISTORICAL_N_FILTER and a
  // minimum lift before a candidate is included in runResult.results, so no
  // further filtering is needed here. We deliberately do NOT require a live
  // match: candidates with zero currently-open matches are still useful to
  // compare historically (e.g. against a pattern that does have live data).
  const filteredResults = useMemo(() => {
    if (!runResult) return [];
    return runResult.results;
  }, [runResult]);

  const displayResults = showAll ? filteredResults : filteredResults.slice(0, 15);

  if (!runResult) {
    return (
      <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/40 bg-white/50 dark:bg-surface/50 px-4 py-6 text-center">
        <p className="text-[12px] text-ink-muted">
          {it
            ? "Nessun run PCSE ancora. Il primo run si avvia automaticamente dopo almeno 3 trade chiusi."
            : "No PCSE run yet. The first run triggers automatically after at least 3 closed trades."}
        </p>
      </div>
    );
  }

  const promotionCandidates = filteredResults.filter((r) => r.promotionReady);
  const degradedCount = filteredResults.filter(
    (r) => r.liftDelta != null && r.liftDelta > 0.5,
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-ink uppercase tracking-wider">
            {it ? "Pattern Combination Search — monitor" : "Pattern Combination Search — monitor"}
          </p>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {it
              ? `Run: ${runResult.computedAt.slice(0, 16).replace("T", " ")} · ${runResult.totalHistoricalN} trade chiusi · tasso perdita medio: ${runResult.globalLossRate.toFixed(1)}% (base di riferimento per il lift)`
              : `Run: ${runResult.computedAt.slice(0, 16).replace("T", " ")} · ${runResult.totalHistoricalN} closed trades · avg loss rate: ${runResult.globalLossRate.toFixed(1)}% (baseline for lift)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {degradedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              ⚠ {degradedCount} {it ? "degradati" : "degraded"}
            </span>
          )}
          {promotionCandidates.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              ★ {promotionCandidates.length} {it ? "pronti" : "ready to promote"}
            </span>
          )}
        </div>
      </div>

      {/* Lift evolution chart — selected combinations, or top-5 by default */}
      <div className="rounded-xl border border-slate-200/40 dark:border-slate-700/30 bg-white/40 dark:bg-surface/40 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <p className="text-[10px] text-ink-muted uppercase tracking-wide">
            {selectedLabels.size > 0
              ? it
                ? `Confronto (${selectedLabels.size} selezionate)`
                : `Comparison (${selectedLabels.size} selected)`
              : it
                ? "Evoluzione lift (top 5 combinazioni)"
                : "Lift evolution (top 5 combinations)"}
          </p>
          {selectedLabels.size > 0 && (
            <button
              className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline"
              onClick={() => setSelectedLabels(new Set())}
            >
              {it ? "Pulisci selezione" : "Clear selection"}
            </button>
          )}
        </div>
        <p className="text-[10px] text-ink-muted/70 mb-2 leading-relaxed">
          {it
            ? `Il lift misura quanto un pattern è discriminante: 1.5× significa che i deal che lo matchano perdono 1.5 volte più spesso della media (${runResult.globalLossRate.toFixed(1)}%). ` +
              `La curva che scende è normale: il lift si stabilizza man mano che si accumulano dati. La linea tratteggiata è la soglia minima per promuovere il pattern allo score. ` +
              `Clicca fino a ${MAX_COMPARE} righe nella tabella sotto per confrontarne le curve direttamente.`
            : `Lift measures how discriminating a pattern is: 1.5× means matched deals lose 1.5× more often than average (${runResult.globalLossRate.toFixed(1)}%). ` +
              `A declining curve is normal: lift stabilises as more data accumulates. The dashed line is the minimum threshold to promote the pattern to the score. ` +
              `Click up to ${MAX_COMPARE} rows in the table below to compare their curves directly.`}
        </p>
        <LiftEvolutionChart
          topResults={
            selectedLabels.size > 0
              ? filteredResults.filter((r) => selectedLabels.has(r.label))
              : filteredResults
          }
        />
      </div>

      {/* Results table */}
      <div className="rounded-xl border border-slate-200/40 dark:border-slate-700/30 bg-white/40 dark:bg-surface/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-slate-200/40 dark:border-slate-700/30 bg-slate-50/60 dark:bg-slate-800/30">
                <th className="text-left px-3 py-2 font-semibold text-ink-muted whitespace-nowrap">
                  {it ? "Combinazione" : "Combination"}
                </th>
                <th className="text-right px-2 py-2 font-semibold text-ink-muted whitespace-nowrap"
                  title={it ? "Quanti trade chiusi storici matchano questa combinazione" : "How many historical closed trades match this combination"}>
                  {it ? "n storico" : "Hist n"}
                </th>
                <th className="text-right px-2 py-2 font-semibold text-ink-muted whitespace-nowrap"
                  title={it ? `Lift storico = tasso perdita di questa combinazione ÷ tasso medio (${runResult.globalLossRate.toFixed(1)}%). Es. 1.56× = perde 1.56 volte più spesso della media` : `Historical lift = loss rate of this combination ÷ avg rate (${runResult.globalLossRate.toFixed(1)}%). E.g. 1.56× = loses 1.56× more often than average`}>
                  {it ? "Lift storico" : "Hist lift"}
                </th>
                <th className="text-right px-2 py-2 font-semibold text-ink-muted whitespace-nowrap"
                  title={it ? "Quante posizioni APERTE attualmente matchano questa combinazione" : "How many currently OPEN positions match this combination"}>
                  {it ? "Match live" : "Live match"}
                </th>
                <th className="text-right px-2 py-2 font-semibold text-ink-muted whitespace-nowrap"
                  title={it ? "Lift calcolato sui dati live (posizioni aperte recenti) — conferma se il pattern regge sui nuovi deal" : "Lift computed on live data (recent open positions) — confirms whether the pattern holds on new deals"}>
                  {it ? "Lift live" : "Live lift"}
                </th>
                <th className="text-right px-2 py-2 font-semibold text-ink-muted whitespace-nowrap"
                  title={it ? "Δ lift = lift live − lift storico. Positivo = pattern si sta degradando sui nuovi dati. Valori piccoli (≤0.15) sono ottimi." : "Δ lift = live lift − historical lift. Positive = pattern degrading on new data. Small values (≤0.15) are excellent."}>
                  Δ lift
                </th>
                <th className="text-right px-2 py-2 font-semibold text-ink-muted"
                  title={it ? "Punteggio di stabilità 0-100: misura quanto il lift è rimasto consistente nel tempo. ≥75 = stabile, 50-75 = accettabile, <50 = instabile" : "Stability score 0-100: measures how consistently the lift held over time. ≥75 = stable, 50-75 = acceptable, <50 = unstable"}>
                  {it ? "Stabilità" : "Stability"}
                </th>
                <th className="text-center px-2 py-2 font-semibold text-ink-muted"
                  title={it ? "Confidenza statistica basata su n e stabilità: HIGH = affidabile, MEDIUM = usare con cautela, LOW = dati insufficienti" : "Statistical confidence based on n and stability: HIGH = reliable, MEDIUM = use with caution, LOW = insufficient data"}>
                  Conf
                </th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {displayResults.map((r, i) => {
                const liveLifted =
                  r.liveLossPct != null && runResult.globalLossRate > 0
                    ? r.liveLossPct / runResult.globalLossRate
                    : null;
                const isSelected = selectedLabels.has(r.label);
                const selectDisabled = !isSelected && selectedLabels.size >= MAX_COMPARE;
                return (
                  <tr
                    key={r.label}
                    className={`border-b border-slate-100/60 dark:border-slate-800/30 transition-colors ${
                      isSelected
                        ? "bg-indigo-50/60 dark:bg-indigo-950/20"
                        : i % 2 === 0
                        ? "bg-white/30 dark:bg-transparent"
                        : "bg-slate-50/30 dark:bg-slate-900/10"
                    } ${
                      selectDisabled
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-indigo-950/15"
                    }`}
                    title={
                      selectDisabled
                        ? it
                          ? `Massimo ${MAX_COMPARE} combinazioni a confronto`
                          : `Max ${MAX_COMPARE} combinations compared at once`
                        : undefined
                    }
                    onClick={() => {
                      if (selectDisabled) return;
                      toggleSelected(r.label);
                    }}
                  >
                    <td className="px-3 py-1.5 font-mono text-[10px] text-ink max-w-[260px] truncate" title={r.label}>
                      {isSelected && (
                        <span className="mr-1 text-indigo-600 dark:text-indigo-400">✓</span>
                      )}
                      {r.label}
                      {r.promotionReady && (
                        <span className="ml-1.5 text-[9px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-1 py-0.5 rounded">★</span>
                      )}
                      {r.liftDelta != null && r.liftDelta > 0.5 && (
                        <span className="ml-1 text-[9px] bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-1 py-0.5 rounded">⚠</span>
                      )}
                      {r.liveMatchCount === 0 && (
                        <span
                          className="ml-1 text-[9px] bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 px-1 py-0.5 rounded"
                          title={it ? "Nessuna posizione aperta matcha oggi — solo storico" : "No currently open position matches — historical only"}
                        >
                          {it ? "no live" : "no live"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{r.historicalN}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-ink">{fmtLift(r.historicalLift)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{r.liveMatchCount}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                      {liveLifted != null ? fmtLift(liveLifted) : "—"}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${liftDeltaBadge(r.liftDelta)}`}>
                      {r.liftDelta != null ? (r.liftDelta >= 0 ? "+" : "") + r.liftDelta.toFixed(2) : "—"}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${stabilityColor(r.stabilityScore)}`}>
                      {r.stabilityScore}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${confidenceBadge(r.confidence)}`}>
                        {r.confidence}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.promotionReady && onPromote && (
                        <button
                          className="text-[9px] font-semibold px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors whitespace-nowrap"
                          onClick={(e) => { e.stopPropagation(); onPromote(r); }}
                        >
                          {it ? "Promuovi" : "Promote"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredResults.length > 15 && (
          <div className="px-3 py-2 border-t border-slate-100/60 dark:border-slate-800/30">
            <button
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? it ? "Mostra meno" : "Show fewer"
                : it
                ? `Mostra tutti (${filteredResults.length})`
                : `Show all (${filteredResults.length})`}
            </button>
          </div>
        )}
        {filteredResults.length === 0 && (
          <p className="text-[11px] text-ink-muted italic px-3 py-4 text-center">
            {it
              ? `Nessuna combinazione con n ≥ ${MIN_HISTORICAL_N_FILTER} trade chiusi.`
              : `No combinations with n ≥ ${MIN_HISTORICAL_N_FILTER} closed trades.`}
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="text-[10px] text-ink-muted space-y-0.5 px-1">
        <p>
          <span className="font-semibold">Δ lift</span>{" "}
          {it
            ? "= degradazione del pattern sui nuovi casi (positivo = peggiora sui dati live)."
            : "= pattern degradation on new cases (positive = weaker on live data)."}
        </p>
        <p>
          <span className="font-semibold">★</span>{" "}
          {it
            ? `= pronto per promozione (lift ≥ ${PROMOTION_MIN_LIFT}×, conf HIGH, match live ≥ 5, |Δ lift| ≤ 3pp).`
            : `= ready to promote (lift ≥ ${PROMOTION_MIN_LIFT}×, conf HIGH, live matches ≥ 5, |Δ lift| ≤ 3pp).`}
        </p>
        <p>
          <span className="font-semibold text-rose-600">⚠</span>{" "}
          {it
            ? "= pattern degradato sui nuovi casi (Δ lift > 0.5×)."
            : "= pattern degraded on new cases (Δ lift > 0.5×)."}
        </p>
        <p>
          <span className="font-semibold text-slate-500">no live</span>{" "}
          {it
            ? "= nessuna posizione aperta matcha oggi questa combinazione — solo dato storico, utile per confronto ma non promuovibile finché non ci sono match live."
            : "= no currently open position matches this combination — historical data only, useful for comparison but not promotable until it has live matches."}
        </p>
      </div>
    </div>
  );
}
