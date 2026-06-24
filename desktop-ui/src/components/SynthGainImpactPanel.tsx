import type { SynthGainImpact } from "../sheet/threePortfolioCompare";
import type { PortfolioSizingSuccessComparison } from "../sheet/portfolioWeightedSizing";
import type { DealUniverseRealizedSuccess } from "../sheet/portfolioSuccessBridge";
import type { AdviceActionAccuracySummary } from "../sheet/investDecisionSimAdviceCalibration";

export type PortfolioBalancingSuccessRow = {
  success: PortfolioSizingSuccessComparison;
  realized: DealUniverseRealizedSuccess;
  /** Extra 24h P&L vs equal € from approved weights (same date as chart). */
  gainWeight24h: SynthGainImpact;
  /** Extra 24h P&L vs equal € from synth mix (same date as chart). */
  gainSynth24h: SynthGainImpact;
};

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function fmtPct(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)}%` : "—";
}
function fmtDelta(d: number | null | undefined): string | null {
  return d != null ? `${d > 0 ? "+" : ""}${d.toFixed(1)} pp` : null;
}
function fmtErr(v: number | null | undefined): string {
  return v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—";
}
function deltaClass(d: number | null | undefined): string {
  if (d == null) return "text-ink-muted";
  if (d > 0) return "text-emerald-600 dark:text-emerald-400 font-semibold";
  if (d < 0) return "text-rose-600 dark:text-rose-400 font-semibold";
  return "text-ink-muted";
}
function winRateClass(pct: number | null | undefined): string {
  if (pct == null) return "text-ink-muted";
  if (pct >= 60) return "text-emerald-700 dark:text-emerald-300";
  if (pct >= 45) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

/* ─── Unified compact KPI panel ────────────────────────────────────────── */

function KpiCell({
  label,
  value,
  valueCls,
  sub,
  subCls,
  hint,
}: {
  label: string;
  value: string;
  valueCls?: string;
  sub?: string | null;
  subCls?: string;
  hint?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 min-w-0 px-3 py-2 rounded-lg border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-surface/50"
      title={hint}
    >
      <span className="text-[10px] uppercase tracking-wide text-ink-muted font-medium truncate">{label}</span>
      <span className={`text-[15px] font-bold tabular-nums ${valueCls ?? "text-ink"}`}>{value}</span>
      {sub != null && (
        <span className={`text-[10px] tabular-nums ${subCls ?? "text-ink-muted"}`}>{sub}</span>
      )}
    </div>
  );
}

export function SynthGainImpactPanel({
  mineSuccess,
  simSuccess,
  adviceAccuracy,
  it,
}: {
  mine24h: SynthGainImpact;
  sim24h: SynthGainImpact;
  mineTotal: SynthGainImpact;
  simTotal: SynthGainImpact;
  mineSuccess: PortfolioBalancingSuccessRow | null;
  simSuccess: PortfolioBalancingSuccessRow | null;
  adviceAccuracy?: AdviceActionAccuracySummary | null;
  synthAvailable: boolean;
  it: boolean;
}) {
  if (!mineSuccess || !simSuccess) return null;

  const mine = mineSuccess.realized;
  const sim  = simSuccess.realized;
  const n    = mine.sampleSize;

  const mineEq = mine.winRatePct;
  const mineWt = mine.weightedWinRatePct;
  const simWt  = sim.weightedWinRatePct;
  const mineDelta = mine.weightingImpactPp;
  const simDelta  = sim.weightingImpactPp;

  const hasAdvice = adviceAccuracy != null && adviceAccuracy.scoredCount > 0;

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/30 dark:bg-surface/30 px-4 py-3 space-y-2">
      {/* Header */}
      <p className="text-[11px] font-semibold text-ink uppercase tracking-wide">
        {it ? "Statistiche sistema" : "System statistics"}
      </p>
      <p className="text-[10px] text-ink-muted leading-snug">
        {it
          ? `Win rate su ${n} trade chiusi (equal = globale, weighted = pesata per capitale corrente). ${hasAdvice ? `Accuracy su ${adviceAccuracy!.scoredCount} consigli valutati.` : ""}`
          : `Win rate across ${n} closed trades (equal = global, weighted = capital-weighted). ${hasAdvice ? `Accuracy across ${adviceAccuracy!.scoredCount} scored advice points.` : ""}`}
      </p>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCell
          label={it ? "Win rate equal" : "Win rate equal"}
          value={fmtPct(mineEq)}
          valueCls={winRateClass(mineEq)}
          hint={it
            ? `Win rate globale del sistema su ${n} round-trip chiusi. Uguale per Portfolio e Sim loop (stesso universo).`
            : `Global system win rate across ${n} closed round-trips. Same for Portfolio and Sim loop (same universe).`}
        />
        <KpiCell
          label={it ? "Weighted portf." : "Weighted portf."}
          value={fmtPct(mineWt)}
          valueCls={winRateClass(mineWt)}
          sub={fmtDelta(mineDelta)}
          subCls={deltaClass(mineDelta)}
          hint={it
            ? `Win rate ponderata per il capitale allocato su ogni ticker nel tuo portfolio. ${mineDelta != null ? `Δ vs equal: ${fmtDelta(mineDelta)} — ${mineDelta < 0 ? "il weighting orienta verso titoli storicamente più deboli" : "orienta verso titoli più forti"}.` : ""}`
            : `Win rate weighted by capital allocated per ticker in your portfolio. ${mineDelta != null ? `Δ vs equal: ${fmtDelta(mineDelta)} — ${mineDelta < 0 ? "weighting shifts toward historically weaker tickers" : "shifts toward stronger tickers"}.` : ""}`}
        />
        <KpiCell
          label={it ? "Weighted sim loop" : "Weighted sim loop"}
          value={fmtPct(simWt)}
          valueCls={winRateClass(simWt)}
          sub={fmtDelta(simDelta)}
          subCls={deltaClass(simDelta)}
          hint={it
            ? `Win rate ponderata per il capitale allocato su ogni ticker nel sim loop. ${simDelta != null ? `Δ vs equal: ${fmtDelta(simDelta)}.` : ""}`
            : `Win rate weighted by capital allocated per ticker in the sim loop. ${simDelta != null ? `Δ vs equal: ${fmtDelta(simDelta)}.` : ""}`}
        />
        {hasAdvice ? (
          <KpiCell
            label={it ? "Accuracy consigli" : "Advice accuracy"}
            value={fmtPct(adviceAccuracy!.overallPct)}
            valueCls={winRateClass(adviceAccuracy!.overallPct)}
            sub={adviceAccuracy!.avgForecastErrorPct != null
              ? `${it ? "err. prev." : "forecast err."} ${fmtErr(adviceAccuracy!.avgForecastErrorPct)}`
              : `${adviceAccuracy!.overallGood}✓ ${adviceAccuracy!.overallBad}✗`}
            subCls={adviceAccuracy!.avgForecastErrorPct != null
              ? (adviceAccuracy!.avgForecastErrorPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")
              : "text-ink-muted"}
            hint={it
              ? `Su ${adviceAccuracy!.scoredCount} consigli: ${adviceAccuracy!.overallGood} corretti, ${adviceAccuracy!.overallBad} errati. BUY corretto = stock sale ≥ 0.5%; SELL corretto = stock scende ≥ 0.5%. Errore previsione medio: ${fmtErr(adviceAccuracy!.avgForecastErrorPct)}.`
              : `Across ${adviceAccuracy!.scoredCount} scored points: ${adviceAccuracy!.overallGood} correct, ${adviceAccuracy!.overallBad} wrong. BUY correct = stock up ≥ 0.5%; SELL correct = stock down ≥ 0.5%. Avg forecast error: ${fmtErr(adviceAccuracy!.avgForecastErrorPct)}.`}
          />
        ) : (
          <KpiCell
            label={it ? "Accuracy consigli" : "Advice accuracy"}
            value="—"
            hint={it ? "Nessun consiglio ancora valutato." : "No advice points scored yet."}
          />
        )}
      </div>
    </div>
  );
}
