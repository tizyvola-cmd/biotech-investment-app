/**
 * Capital & Diversification — orchestrator.
 *
 * Top: capital pot · approved weights panel · three-portfolio compare.
 * Bottom: breakeven vs success-rate chart for the 3 experiments.
 *
 * PERF: all heavy shared computations (calibrationSnapshot, sdsBreakdown,
 * phaseA, approvedPattern, frozenWeights, comparison, patternMatchByRowKey)
 * are computed ONCE here and passed down as props to the child panels, which
 * used to duplicate them (up to 5× computeCalibrationSnapshot and 4×
 * buildThreePortfolioComparison per open of the tab).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";
import { ThreePortfolioCompareView } from "./ThreePortfolioCompareView";
import { ApprovedWeightsAllocationPanel } from "./ApprovedWeightsAllocationPanel";
import { useLang } from "../shared/i18n";
import { loadInvestSimInputs } from "../sheet/investSimStorage";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { buildThreePortfolioComparison } from "../sheet/threePortfolioCompare";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import {
  extractAllRowFeatures,
  runUnivariateScreening,
} from "../riskPattern/lossRiskScreening";
import { matchPattern } from "../riskPattern/lossRiskPattern";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import { loadFrozenWeights } from "../calibration/proposalStore";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";
import type { ComparisonDeal } from "../sheet/threePortfolioCompare";

export function PortfolioDiversificationLabPanel({
  closedRows,
  simTable,
  sdsRows,
  investInputs,
  pointsBySeriesKey,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  investInputs?: InvestSimInputs;
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const [frozenWeightsTick, setFrozenWeightsTick] = useState(0);
  useEffect(() => {
    const onFrozen = () => setFrozenWeightsTick((v) => v + 1);
    window.addEventListener("supernova:frozen-weights-updated", onFrozen);
    return () => window.removeEventListener("supernova:frozen-weights-updated", onFrozen);
  }, []);

  const TOP_CAPITAL_DEFAULT = 5000;
  const isCapitalUserSetRef = useRef(false);
  const [topCapital, setTopCapital] = useState<number>(() => {
    const v = loadUiPrefsLocal().topCapital;
    if (v != null && Number.isFinite(v) && v >= 0) {
      isCapitalUserSetRef.current = true;
      return v;
    }
    return TOP_CAPITAL_DEFAULT;
  });
  useEffect(() => {
    if (isCapitalUserSetRef.current) return;
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || !disk) return;
      if (
        disk.topCapital != null &&
        Number.isFinite(disk.topCapital) &&
        disk.topCapital >= 0
      ) {
        isCapitalUserSetRef.current = true;
        setTopCapital(disk.topCapital);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!isCapitalUserSetRef.current) return;
    saveUiPrefs({ topCapital });
  }, [topCapital]);

  // ── Shared heavy computations — done ONCE, propagated to child panels.
  // Before this refactor, each of ApprovedWeightsAllocationPanel,
  // ThreePortfolioCompareView and (indirectly) buildSynthCurveAllocation
  // independently recomputed all of these.

  const calibrationSnapshot = useMemo(() => {
    try {
      return computeCalibrationSnapshot(closedRows, {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      });
    } catch {
      return null;
    }
    // frozenWeightsTick invalidates when Learning Lab approves new weights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedRows, simTable, sdsRows, frozenWeightsTick]);

  const sdsBreakdown = useMemo(
    () =>
      computeSdsGainBreakdown(closedRows, {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      }),
    [closedRows, simTable, sdsRows],
  );

  const phaseA = useMemo(() => {
    try {
      return runUnivariateScreening(closedRows, {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      });
    } catch {
      return null;
    }
  }, [closedRows, simTable, sdsRows]);

  const approvedPattern = useMemo(() => {
    try {
      return loadApprovedPattern().current ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozenWeightsTick]);

  const frozenWeights = useMemo(
    () => loadFrozenWeights(),
    // frozenWeightsTick fires on the "supernova:frozen-weights-updated" event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frozenWeightsTick],
  );

  const patternMatchByRowKey = useMemo(() => {
    const map = new Map<string, boolean>();
    if (!approvedPattern) return map;
    try {
      const features = extractAllRowFeatures(closedRows, {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      });
      for (const [fk, fc] of features) {
        const ticker = fk.split("|")[0]?.toUpperCase();
        if (!ticker) continue;
        if (matchPattern(approvedPattern, fc)) map.set(ticker, true);
      }
    } catch {
      /* swallow — empty map keeps deals at neutral patternPenalty=1.0 */
    }
    return map;
  }, [approvedPattern, closedRows, simTable, sdsRows]);

  const matchesStep2Pattern = useMemo(
    () => (deal: ComparisonDeal) =>
      patternMatchByRowKey.get(deal.ticker.toUpperCase()) === true,
    [patternMatchByRowKey],
  );

  // Single `buildThreePortfolioComparison` call for the whole tab. The old
  // orchestrator computed only `simLoopDealsForWeights` here and let the
  // children recompute the full comparison independently 3 more times.
  const comparison = useMemo(() => {
    try {
      return buildThreePortfolioComparison({
        closedRows,
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
        inputs: investInputs ?? loadInvestSimInputs(),
        pointsBySeriesKey: pointsBySeriesKey ?? new Map(),
        lang,
        calibrationSnapshot,
        sdsBreakdown,
        totalCapitalEur: topCapital,
        phaseA,
        approvedPattern,
        matchesStep2Pattern,
        paperPortfolio: loadDecisionSimState().paperPortfolio,
      });
    } catch {
      return null;
    }
  }, [
    closedRows,
    simTable,
    sdsRows,
    investInputs,
    pointsBySeriesKey,
    lang,
    calibrationSnapshot,
    sdsBreakdown,
    phaseA,
    approvedPattern,
    matchesStep2Pattern,
    topCapital,
  ]);

  const simLoopDealsForWeights = comparison?.simLoopDeals ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-indigo-200/50 dark:border-indigo-800/40 bg-white/60 dark:bg-surface/60 p-3 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 tracking-wider">
              {it ? "Capitale del portafoglio" : "Portfolio capital pot"}
            </p>
            <p className="text-[11px] text-ink-muted max-w-2xl mt-0.5">
              {it
                ? "Capitale ipotetico condiviso dai confronti e dal grafico breakeven sotto."
                : "Shared hypothetical capital for comparisons and the breakeven chart below."}
            </p>
          </div>
          <label className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-ink">{it ? "Capitale pot" : "Capital pot"}</span>
            <span className="text-ink-muted">€</span>
            <input
              type="number"
              min={500}
              step={500}
              value={topCapital}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) {
                  isCapitalUserSetRef.current = true;
                  setTopCapital(v);
                }
              }}
              className="w-24 rounded-md border border-[rgb(var(--border))]/60 px-2 py-1 text-right tabular-nums bg-white/80 dark:bg-surface/80"
            />
          </label>
        </div>
      </div>

      <ApprovedWeightsAllocationPanel
        deals={simLoopDealsForWeights}
        outcomes={closedRows}
        simTable={simTable}
        sdsRows={sdsRows}
        universeLabelIt="Sim loop (raccomandazioni BUY + paper book)"
        universeLabelEn="Sim loop (BUY recommendations + paper book)"
        defaultOpen
        sharedCalibrationSnapshot={calibrationSnapshot}
        sharedFrozenWeights={frozenWeights}
        totalCapitalEur={topCapital}
        investInputs={investInputs ?? loadInvestSimInputs()}
        pointsBySeriesKey={pointsBySeriesKey}
        paperPortfolio={loadDecisionSimState().paperPortfolio}
      />

      <ThreePortfolioCompareView
        closedRows={closedRows}
        simTable={simTable}
        sdsRows={sdsRows}
        investInputs={investInputs}
        pointsBySeriesKey={pointsBySeriesKey}
        totalCapitalEur={topCapital}
        patternStoreVersion={0}
        frozenWeightsTick={frozenWeightsTick}
        sharedComparison={comparison}
        sharedCalibrationSnapshot={calibrationSnapshot}
        sharedSdsBreakdown={sdsBreakdown}
        sharedPhaseA={phaseA}
        sharedApprovedPattern={approvedPattern}
        sharedPatternMatchByRowKey={patternMatchByRowKey}
      />

    </div>
  );
}
