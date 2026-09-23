/**
 * Standalone validation: entry risk/benefit indices vs realised P&L on closed trades.
 * Separate from the approved-weights allocation table (open/BUY universe).
 */
import { useMemo } from "react";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { FrozenWeights } from "../calibration/calibrationTypes";
import { loadFrozenWeights } from "../calibration/proposalStore";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { buildClosedDealRiskBenefitPoints } from "../sheet/approvedWeightsClosedCorrelation";
import { mergePortfolioAndSimLoopClosedDeals } from "../sheet/closedDealsUnion";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { runUnivariateScreening } from "../riskPattern/lossRiskScreening";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import type { RiskPattern } from "../riskPattern/riskPatternTypes";
import { RiskBenefitClosedCorrelationPanel } from "./RiskBenefitClosedCorrelationPanel";
import { useLang } from "../shared/i18n";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { loadInvestSimHistory } from "../sheet/investSimStorage";

export function RiskBenefitCorrelationLabPanel({
  outcomes,
  simTable,
  sdsRows,
  investInputs,
  defaultOpen = false,
  sharedFrozenWeights,
  sharedApprovedPattern,
}: {
  outcomes: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  investInputs?: InvestSimInputs | null;
  defaultOpen?: boolean;
  /** PERF: shared-context props from the tab orchestrator. Note: this panel
   *  computes calibrationSnapshot/phaseA against `mergedClosedDeals`
   *  (portfolio ∪ sim loop), a different universe from the other panels, so
   *  those two are NOT shareable — only frozen + approvedPattern are. */
  sharedFrozenWeights?: FrozenWeights;
  sharedApprovedPattern?: RiskPattern | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const frozen = useMemo(
    () => sharedFrozenWeights ?? loadFrozenWeights(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sharedFrozenWeights, outcomes.length],
  );

  const mergedClosedDeals = useMemo(
    () =>
      mergePortfolioAndSimLoopClosedDeals({
        simOutcomeRows: outcomes,
        investInputs: investInputs ?? null,
        investHistory: loadInvestSimHistory(),
      }),
    [outcomes, investInputs],
  );

  const snapshot = useMemo(() => {
    try {
      return computeCalibrationSnapshot(mergedClosedDeals, {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      });
    } catch {
      return null;
    }
  }, [mergedClosedDeals, simTable, sdsRows]);

  const phaseA = useMemo(() => {
    try {
      return runUnivariateScreening(mergedClosedDeals, { simTable, sdsRows });
    } catch {
      return null;
    }
  }, [mergedClosedDeals, simTable, sdsRows]);

  const approvedPattern = useMemo(() => {
    if (sharedApprovedPattern !== undefined) return sharedApprovedPattern;
    try {
      return loadApprovedPattern().current ?? null;
    } catch {
      return null;
    }
  }, [sharedApprovedPattern, outcomes.length]);

  const sdsBreakdown = useMemo(
    () => computeSdsGainBreakdown(mergedClosedDeals, { simTable, sdsRows }),
    [mergedClosedDeals, simTable, sdsRows],
  );

  const points = useMemo(
    () =>
      buildClosedDealRiskBenefitPoints({
        outcomes: mergedClosedDeals,
        simTable,
        sdsRows,
        frozen,
        snapshot,
        sdsBreakdown,
        phaseA,
        approvedPattern,
      }),
    [mergedClosedDeals, simTable, sdsRows, frozen, snapshot, sdsBreakdown, phaseA, approvedPattern],
  );

  const sourceCounts = useMemo(() => {
    let simloop = 0;
    let portfolio = 0;
    for (const p of points) {
      if (p.correlationSource === "portfolio") portfolio += 1;
      else simloop += 1;
    }
    return { simloop, portfolio, total: points.length };
  }, [points]);

  return (
    <details
      open={defaultOpen}
      className="rounded-xl border border-slate-400/35 dark:border-slate-600/40 bg-slate-500/5 overflow-hidden"
    >
      <summary className="cursor-pointer select-none list-none px-4 py-3 hover:bg-slate-500/10 transition-colors [&::-webkit-details-marker]:hidden">
        <p className="text-[10px] uppercase font-semibold text-slate-700 dark:text-slate-300 tracking-wider">
          {it ? "Validazione indici" : "Index validation"}
        </p>
        <h3 className="text-sm font-bold text-ink mt-0.5">
          {it ? "Risk & Benefit vs P&L realizzato (trade chiusi)" : "Risk & Benefit vs realised P&L (closed trades)"}
        </h3>
        <p className="text-[10px] text-ink-muted mt-1 group-open:hidden">
          {it
            ? `n=${sourceCounts.total} chiusure · sim ${sourceCounts.simloop} · portafoglio ${sourceCounts.portfolio}`
            : `n=${sourceCounts.total} closed · sim ${sourceCounts.simloop} · portfolio ${sourceCounts.portfolio}`}
        </p>
      </summary>

      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-400/25">
        <p className="text-[11px] text-ink-muted leading-relaxed max-w-3xl">
          {it
            ? "Questa sezione è indipendente dalla tabella pesi approvati: qui si chiede se gli indici 💀/❤️ calcolati all'ingresso predicono il P&L % finale su deal già chiusi (sim loop + vendite reali con soldAt)."
            : "This section is independent from the approved-weights table: it tests whether 💀/❤️ indices at entry predict final P&L % on closed deals (sim loop + real sells with soldAt)."}
        </p>

        <details className="rounded-lg border border-[rgb(var(--border))]/40 text-[10px]">
          <summary className="px-2 py-1.5 cursor-pointer font-semibold text-ink">
            {it ? "Come si calcolano gli indici (solo entry)" : "How indices are scored (entry only)"}
          </summary>
          <div className="px-2 pb-2 space-y-1 text-ink-muted leading-relaxed border-t border-[rgb(var(--border))]/30 pt-1.5">
            <p>
              <span className="font-semibold text-ink">💀 {it ? "Rischio" : "Risk"}:</span>{" "}
              {it
                ? "Risk v2 (ufficiale): piano · timing · liquidità · regolatorio — pesi provvisori 40/25/25/10. Phase A (loss rate bucket) in overlay sul grafico."
                : "Risk v2 (official): plan · timing · liquidity · regulatory — provisional weights 40/25/25/10. Phase A (bucket loss rate) overlaid on chart."}
            </p>
            <p>
              <span className="font-semibold text-ink">❤️ {it ? "Beneficio" : "Benefit"}:</span>{" "}
              {it
                ? "v2: P(plan) entry 60% + SDS entry 25% + slope 20d 15% + P(win) approvato max 10%. Niente payoff SDS né curve live."
                : "v2: entry P(plan) 60% + entry SDS 25% + entry slope 20d 15% + approved P(win) max 10%. No SDS payoff or live curves."}
            </p>
          </div>
        </details>

        {points.length < 3 ? (
          <p className="text-[11px] text-ink-muted">
            {it
              ? "Servono almeno 3 trade chiusi con P&L e indici entry."
              : "Need at least 3 closed trades with P&L and entry indices."}
          </p>
        ) : (
          <RiskBenefitClosedCorrelationPanel
            points={points}
            sourceCounts={sourceCounts}
            it={it}
          />
        )}
      </div>
    </details>
  );
}
