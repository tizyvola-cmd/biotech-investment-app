/**
 * Resolves sim loop · synth share map for dashboard charts (same pipeline as
 * Three-Portfolio / Cap Div Step 3).
 */
import { useEffect, useMemo, useState } from "react";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  closedValidationOutcomeRowsFromDoc,
} from "../sheet/simOutcomeCycleDedup";
import {
  loadInvestmentSimOutcomes,
  type SimOutcomeRow,
} from "../data/investmentSimOutcomesData";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { buildSynthCurveAllocation } from "../sheet/buildSynthCurveAllocation";
import { buildSimLoopSynthCapDivTotals } from "../sheet/simLoopSynthCapDivTotals";
import type { SimLoopPulseTotals } from "../sheet/simLoopPulseView";
import { runUnivariateScreening } from "../riskPattern/lossRiskScreening";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import { matchPattern } from "../riskPattern/lossRiskPattern";
import { extractAllRowFeatures } from "../riskPattern/lossRiskScreening";
import type { ComparisonDeal } from "../sheet/threePortfolioCompare";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { useLang } from "../shared/i18n";
import type { PaperPosition } from "../sheet/investDecisionSimLoop";
import type { SimTableApprovedWeightMaps } from "../sheet/simTableApprovedWeightHints";

export type SimLoopSynthAllocation = {
  /** Sim loop BUY deals — Weight Sim Exp synth shares. */
  shareByRowKey: Record<string, number>;
  /** Sim loop BUY deals — Learning Lab approved weights (no 24h target). */
  simLoopApprovedShareByRowKey: Record<string, number>;
  /** Open portfolio positions — Weight Sim Exp synth shares. */
  portfolioShareByRowKey: Record<string, number>;
  /** Same pipeline, capped at 25%/name for Simulation table hints. */
  portfolioDisplayShareByRowKey: Record<string, number>;
  simLoopDisplayShareByRowKey: Record<string, number>;
  totalCapitalEur: number;
  targetGainEur: number;
  /** Cap Div snapshot totals — same basis as 3-experiment synth curve. */
  capDivTotals: SimLoopPulseTotals | null;
  /** Approved-weight Rec $ column + Sync → Synth targets (not Weight Sim Exp). */
  simTableApprovedWeightMaps: SimTableApprovedWeightMaps;
};

export function useSimLoopSynthAllocation(args: {
  simTable: SheetTable | null;
  sdsRows: SdsRow[] | null;
  investInputs?: InvestSimInputs;
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  totalCapitalEur: number;
  paperPortfolio?: PaperPosition[];
  enabled?: boolean;
}): SimLoopSynthAllocation | null {
  const { lang } = useLang();
  const [closedRows, setClosedRows] = useState<SimOutcomeRow[]>([]);

  useEffect(() => {
    if (args.enabled === false || !args.simTable?.rows?.length) return;
    let cancelled = false;
    void loadInvestmentSimOutcomes().then((doc) => {
      if (cancelled) return;
      setClosedRows(closedValidationOutcomeRowsFromDoc(doc));
    });
    return () => {
      cancelled = true;
    };
  }, [args.simTable, args.enabled]);

  const approvedPattern = useMemo(() => {
    try {
      return loadApprovedPattern().current ?? null;
    } catch {
      return null;
    }
  }, [closedRows]);

  const matchesStep2Pattern = useMemo(() => {
    if (!approvedPattern) return () => false;
    const map = new Map<string, boolean>();
    try {
      const features = extractAllRowFeatures(closedRows, {
        simTable: args.simTable,
        sdsRows: args.sdsRows,
      });
      for (const [fk, fc] of features) {
        const ticker = fk.split("|")[0]?.toUpperCase();
        if (!ticker) continue;
        if (matchPattern(approvedPattern, fc)) map.set(ticker, true);
      }
    } catch {
      /* empty */
    }
    return (deal: ComparisonDeal) => map.get(deal.ticker.toUpperCase()) === true;
  }, [approvedPattern, closedRows, args.simTable, args.sdsRows]);

  return useMemo(() => {
    if (args.enabled === false || !args.simTable?.rows?.length || args.totalCapitalEur <= 0) {
      return null;
    }
    const targetGainEur = Math.max(50, Math.round(args.totalCapitalEur * 0.005));
    let calibrationSnapshot = null;
    try {
      calibrationSnapshot = computeCalibrationSnapshot(closedRows, {
        simTable: args.simTable,
        sdsRows: args.sdsRows,
      });
    } catch {
      return null;
    }
    let phaseA = null;
    try {
      phaseA = runUnivariateScreening(closedRows, {
        simTable: args.simTable,
        sdsRows: args.sdsRows,
      });
    } catch {
      phaseA = null;
    }
    const sdsBreakdown = computeSdsGainBreakdown(closedRows, {
      simTable: args.simTable,
      sdsRows: args.sdsRows,
    });
    const payload = buildSynthCurveAllocation({
      closedRows,
      simTable: args.simTable,
      sdsRows: args.sdsRows,
      investInputs: args.investInputs,
      pointsBySeriesKey: args.pointsBySeriesKey,
      lang: lang === "it" ? "it" : "en",
      calibrationSnapshot,
      sdsBreakdown,
      totalCapitalEur: args.totalCapitalEur,
      targetGainEur,
      phaseA,
      approvedPattern,
      matchesStep2Pattern,
      paperPortfolio: args.paperPortfolio,
    });
    if (!payload?.simLoopSharesByRowKey && !payload?.portfolioSharesByRowKey) return null;

    const capDivTotals =
      args.paperPortfolio != null
        ? buildSimLoopSynthCapDivTotals({
            closedRows,
            simTable: args.simTable,
            sdsRows: args.sdsRows,
            investInputs: args.investInputs,
            pointsBySeriesKey: args.pointsBySeriesKey ?? new Map(),
            totalCapitalEur: args.totalCapitalEur,
            paperPortfolio: args.paperPortfolio,
            lang: lang === "it" ? "it" : "en",
          })
        : null;

    return {
      shareByRowKey: payload.simLoopSharesByRowKey ?? {},
      simLoopApprovedShareByRowKey: payload.simLoopApprovedSharesByRowKey ?? {},
      portfolioShareByRowKey: payload.portfolioSharesByRowKey ?? {},
      portfolioDisplayShareByRowKey: payload.portfolioDisplaySharesByRowKey ?? {},
      simLoopDisplayShareByRowKey: payload.simLoopDisplaySharesByRowKey ?? {},
      simTableApprovedWeightMaps: payload.simTableApprovedWeightMaps ?? {
        portfolioApprovedShareByRowKey: payload.portfolioApprovedSharesByRowKey ?? {},
        opportunityApprovedShareByRowKey: payload.simLoopApprovedSharesByRowKey ?? {},
        multiplierByRowKey: {},
        patternPenaltyByRowKey: {},
      },
      totalCapitalEur: args.totalCapitalEur,
      targetGainEur,
      capDivTotals,
    };
  }, [
    args.enabled,
    args.simTable,
    args.sdsRows,
    args.investInputs,
    args.pointsBySeriesKey,
    args.totalCapitalEur,
    args.paperPortfolio,
    closedRows,
    approvedPattern,
    matchesStep2Pattern,
    lang,
  ]);
}
