import type {
  ManualAllocationSynthesizerBundle,
  ManualAllocationSynthesizerBundleResult,
} from "../sheet/manualAllocationPatternSynthesizer";
import type { WeightSimExpResult } from "../sheet/weightSimExpOptimizer";
import { ManualAllocationSynthesizerPanel } from "./ManualAllocationSynthesizerPanel";

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Relative uplift of `value` vs `baseline` (e.g. weighted vs uniform gain). */
function gainUpliftPct(value: number, baseline: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return null;
  const delta = value - baseline;
  if (Math.abs(delta) < 0.01) return 0;
  if (Math.abs(baseline) < 1) {
    return value > baseline ? null : delta < 0 ? -100 : null;
  }
  return Math.round((delta / Math.abs(baseline)) * 1000) / 10;
}

function fmtUpliftPct(pct: number | null, it: boolean): string {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}% ${it ? "vs uniforme" : "vs uniform"}`;
}

export function WeightSimExpPanel({
  it,
  targetEur,
  portfolioResult,
  simLoopResult,
  portfolioDeals,
  simLoopDeals,
  synthBundle,
  synthOutcomes,
  weightedGateOk,
  chartGains,
  onApplyPortfolio,
  onApplySimLoop,
  onPatternApproved,
}: {
  it: boolean;
  targetEur: number;
  portfolioResult: WeightSimExpResult | null;
  simLoopResult: WeightSimExpResult | null;
  portfolioDeals: Array<{ ticker: string; rowKey: string }>;
  simLoopDeals: Array<{ ticker: string; rowKey: string }>;
  synthBundle: ManualAllocationSynthesizerBundle;
  synthOutcomes: ManualAllocationSynthesizerBundleResult;
  weightedGateOk: boolean;
  chartGains: {
    portfolioWeighted: number;
    portfolioUniform: number;
    portfolioWeightSimExp: number;
    simLoopWeighted: number;
    simLoopWeightSimExp: number;
    simLoopUniform: number;
  };
  onApplyPortfolio?: () => void;
  onApplySimLoop?: () => void;
  onPatternApproved?: () => void;
}) {
  if (!portfolioResult && !simLoopResult) return null;

  const fmtDelta = (v: number) =>
    `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("it-IT")} €`;

  const simLoopWeightedUplift = gainUpliftPct(
    chartGains.simLoopWeighted,
    chartGains.simLoopUniform,
  );
  const simLoopMixUplift = gainUpliftPct(
    chartGains.simLoopWeightSimExp,
    chartGains.simLoopWeighted,
  );
  const portfolioWeightedUplift = gainUpliftPct(
    chartGains.portfolioWeighted,
    chartGains.portfolioUniform,
  );
  const portfolioMixUplift = gainUpliftPct(
    chartGains.portfolioWeightSimExp,
    chartGains.portfolioWeighted,
  );

  return (
    <section className="rounded-xl border border-rose-300/50 bg-rose-50/25 dark:bg-rose-950/15 px-3 py-3 space-y-3">
      <div>
        <p className="text-[12px] font-semibold text-rose-900 dark:text-rose-100">
          {it ? "Weight Sim Exp — obiettivo dalla curva" : "Weight Sim Exp — goal from chart"}
        </p>
        <p className="text-[10px] text-rose-800/80 dark:text-rose-200/70 mt-0.5 max-w-3xl">
          {it
            ? `Target +${Math.round(targetEur).toLocaleString("it-IT")} € — mix ottimale sui ritorni 24h reali partendo dai pesi approvati (Learning Lab / sizingRules). Le curve rosa/fucsia alimentano Mine (synth) e Sim loop (synth) nel confronto tre portafogli.`
            : `Target +€${Math.round(targetEur).toLocaleString("it-IT")} — optimal mix on real 24h returns from Learning Lab approved weights (sizingRules). Rose/fuchsia curves feed Mine (synth) and Sim loop (synth) on the three-portfolio comparison.`}
        </p>
        {weightedGateOk ? (
          <div className="mt-2 flex flex-col gap-1 text-[10px] tabular-nums">
            {simLoopResult ? (
              <p className="text-ink-muted leading-snug">
                <span className="font-semibold text-amber-800 dark:text-amber-200">
                  {it ? "Sim loop" : "Sim loop"}:
                </span>{" "}
                {it ? "pesato" : "weighted"}{" "}
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {fmtDelta(chartGains.simLoopWeighted)}
                </span>
                {simLoopWeightedUplift != null ? (
                  <span
                    className={`font-semibold ${
                      simLoopWeightedUplift >= 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-rose-700 dark:text-rose-300"
                    }`}
                    title={
                      it
                        ? "Quanto il sizing pesato Step 2 aumenta il gain cumulato rispetto all'allocazione uniforme (stesso universo sim loop)."
                        : "How much Step 2 weighted sizing lifts cumulative gain vs equal-weight allocation (same sim loop universe)."
                    }
                  >
                    {" "}
                    ({fmtUpliftPct(simLoopWeightedUplift, it)})
                  </span>
                ) : null}
                {" · "}
                Weight Sim Exp{" "}
                <span className="font-semibold text-fuchsia-700 dark:text-fuchsia-300">
                  {fmtDelta(chartGains.simLoopWeightSimExp)}
                </span>
                {simLoopMixUplift != null ? (
                  <span className="font-semibold text-fuchsia-800/90 dark:text-fuchsia-200/90">
                    {" "}
                    ({simLoopMixUplift >= 0 ? "+" : ""}
                    {simLoopMixUplift.toFixed(1)}% {it ? "vs pesato" : "vs weighted"})
                  </span>
                ) : null}
                {" · "}
                <span
                  className={
                    chartGains.simLoopWeightSimExp - chartGains.simLoopWeighted >= 0
                      ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                      : "text-rose-700 dark:text-rose-300 font-semibold"
                  }
                >
                  Δ mix {fmtDelta(chartGains.simLoopWeightSimExp - chartGains.simLoopWeighted)}
                </span>
                {" · "}
                {it ? "vs uniforme" : "vs uniform"}{" "}
                <span className="font-semibold">
                  {fmtDelta(chartGains.simLoopWeighted - chartGains.simLoopUniform)}
                </span>
              </p>
            ) : null}
            {portfolioResult ? (
              <p className="text-ink-muted leading-snug">
                <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                  {it ? "Portfolio reale" : "Real portfolio"}:
                </span>{" "}
                {it ? "pesato" : "weighted"}{" "}
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  {fmtDelta(chartGains.portfolioWeighted)}
                </span>
                {portfolioWeightedUplift != null ? (
                  <span
                    className={`font-semibold ${
                      portfolioWeightedUplift >= 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-rose-700 dark:text-rose-300"
                    }`}
                    title={
                      it
                        ? "Quanto il sizing pesato Step 2 aumenta il gain cumulato rispetto all'allocazione uniforme (portfolio reale)."
                        : "How much Step 2 weighted sizing lifts cumulative gain vs equal-weight allocation (real portfolio)."
                    }
                  >
                    {" "}
                    ({fmtUpliftPct(portfolioWeightedUplift, it)})
                  </span>
                ) : null}
                {" · "}
                Weight Sim Exp{" "}
                <span className="font-semibold text-rose-700 dark:text-rose-300">
                  {fmtDelta(chartGains.portfolioWeightSimExp)}
                </span>
                {portfolioMixUplift != null ? (
                  <span className="font-semibold text-rose-800/90 dark:text-rose-200/90">
                    {" "}
                    ({portfolioMixUplift >= 0 ? "+" : ""}
                    {portfolioMixUplift.toFixed(1)}% {it ? "vs pesato" : "vs weighted"})
                  </span>
                ) : null}
                {" · "}
                <span
                  className={
                    chartGains.portfolioWeightSimExp - chartGains.portfolioWeighted >= 0
                      ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                      : "text-rose-700 dark:text-rose-300 font-semibold"
                  }
                >
                  Δ mix {fmtDelta(chartGains.portfolioWeightSimExp - chartGains.portfolioWeighted)}
                </span>
                {" · "}
                {it ? "vs uniforme" : "vs uniform"}{" "}
                <span className="font-semibold">
                  {fmtDelta(chartGains.portfolioWeighted - chartGains.portfolioUniform)}
                </span>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-1.5 text-[10px] text-amber-800 dark:text-amber-200">
            {it
              ? "Curva sim loop pesata disabilitata — calibrazione insufficiente. Resta visibile solo Weight Sim Exp."
              : "Sim loop weighted curve disabled — insufficient calibration. Only Weight Sim Exp remains."}
          </p>
        )}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {portfolioResult ? (
          <WeightSimExpUniverseCard
            it={it}
            title={it ? "Portfolio reale" : "Real portfolio"}
            result={portfolioResult}
            deals={portfolioDeals}
            onApply={onApplyPortfolio}
          />
        ) : null}
        {simLoopResult ? (
          <WeightSimExpUniverseCard
            it={it}
            title={it ? "Sim loop BUY" : "Sim loop BUY"}
            result={simLoopResult}
            deals={simLoopDeals}
            onApply={onApplySimLoop}
          />
        ) : null}
      </div>

      {(synthBundle.portfolio?.enabled || synthBundle.simLoop?.enabled) ? (
        <div className="pt-1 border-t border-rose-200/50 dark:border-rose-800/40">
          <p className="text-[10px] font-semibold text-rose-900 dark:text-rose-100 mb-2">
            {it
              ? "Pattern sintetizzato dalla mix Weight Sim Exp"
              : "Pattern synthesized from Weight Sim Exp mix"}
          </p>
          <ManualAllocationSynthesizerPanel
            bundle={synthBundle}
            outcomes={synthOutcomes}
            it={it}
            onPatternApproved={onPatternApproved}
          />
        </div>
      ) : null}
    </section>
  );
}

function WeightSimExpUniverseCard({
  it,
  title,
  result,
  deals,
  onApply,
}: {
  it: boolean;
  title: string;
  result: WeightSimExpResult;
  deals: Array<{ ticker: string; rowKey: string }>;
  onApply?: () => void;
}) {
  const gainLabel = `${result.finalGainEur >= 0 ? "+" : ""}${Math.round(result.finalGainEur).toLocaleString("it-IT")} €`;
  const statusLabel = result.targetReached
    ? it
      ? "target OK"
      : "target OK"
    : it
      ? "target NO"
      : "target NO";

  return (
    <details className="rounded-lg border border-rose-200/60 bg-white/60 dark:bg-surface/50 group">
      <summary className="cursor-pointer select-none list-none px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-rose-800 dark:text-rose-200 inline-flex items-center gap-1.5 min-w-0">
            <span aria-hidden className="text-[9px] opacity-60 group-open:rotate-0">
              ▸
            </span>
            <span className="uppercase tracking-wide">{title}</span>
            <span
              className={`font-bold tabular-nums normal-case ${
                result.finalGainEur >= 0
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-rose-700 dark:text-rose-300"
              }`}
            >
              {gainLabel}
            </span>
            <span
              className={`font-normal normal-case ${
                result.targetReached
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-amber-700 dark:text-amber-300"
              }`}
            >
              · {statusLabel}
            </span>
          </span>
          {onApply ? (
            <button
              type="button"
              className="btn-secondary text-[10px] shrink-0"
              onClick={(e) => {
                e.preventDefault();
                onApply();
              }}
            >
              {it ? "Applica agli slider" : "Apply to sliders"}
            </button>
          ) : null}
        </div>
      </summary>

      <div className="px-3 pb-2.5 pt-0 space-y-2 border-t border-rose-100/80 dark:border-rose-900/30">
        <p className="text-[10px] text-ink-muted pt-2">
          {result.targetReached ? (
            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
              {it ? "Target raggiungibile con questa mix" : "Target reachable with this mix"}
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-300 font-semibold">
              {it ? "Target non raggiungibile" : "Target unreachable"}
              {result.unreachableReason ? ` · ${result.unreachableReason}` : ""}
            </span>
          )}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] text-[10px] tabular-nums">
            <thead>
              <tr className="text-left text-ink-muted border-b border-[rgb(var(--border))]/40">
                <th className="font-medium py-1 pr-2">Ticker</th>
                <th className="font-medium py-1 pr-2 text-right">
                  {it ? "% ottimale" : "Optimal %"}
                </th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, i) => (
                <tr key={d.rowKey}>
                  <td className="py-1 pr-2 font-semibold">{d.ticker}</td>
                  <td className="py-1 pr-2 text-right">{fmtPct(result.shares[i] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
