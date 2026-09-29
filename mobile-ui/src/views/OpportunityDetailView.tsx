import { useEffect, useMemo, useState } from "react";
import { fetchClinicalPreCdSnapshot, fetchMobileCurveChartsForKey, type ClinicalPreCdRecord } from "../api";
import { MobileEisSheet } from "../components/MobileEisSheet";
import { MobileRegulatorySheet } from "../components/MobileRegulatorySheet";
import {
  MobileOpportunityCard,
  type OpportunityDetailSection,
} from "../components/MobileOpportunityCard";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileCurveChartsPayload, MobileDashboardSnapshot } from "../dashboardTypes";
import type { MobileScoreEnrichment } from "../hooks/useMobileScoreEnrichment";
import { findDecisionRowInSnapshot } from "../decisionChartSnapshot";
import { manualEisForTicker } from "../gainStarDisplay";
import { mergeManualStoreIntoClinicalRecords } from "../manualFeedClinicalMerge";
import { buildMobileOpportunityCardProps } from "../mobileOpportunityCardBuild";
import { resolveCurveChartsForRow } from "../mobileCurveChartsBuild";
import { clinicalPhaseFromSimRow } from "../mobileSimRowClinicalMeta";
import { daysFromCompletionDate } from "../opportunityLogic";
import {
  computeSimulationPosition,
  currentPriceFromRow,
  rowHasActivePortfolio,
} from "../simLogic";
import { suggestedInvestEur, suggestedInvestPctForBuy } from "../mobileBuySizing";
import { mobileSimCash } from "../mobilePortfolioCash";
import { resolveMobileDecisionRow } from "../mobileDecisionChartBuild";
import type { ChartBundle, InvestSimInputs, SheetTable } from "../types";

type Props = {
  rowKey: string;
  row: Record<string, unknown>;
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  clinicalRecordsMerged?: ClinicalPreCdRecord[];
  chartBundle: ChartBundle | null;
  enrichment: MobileScoreEnrichment;
  startingCapital: number;
  tradeBusy?: boolean;
  tradeErr?: string | null;
  onOpenSimEdit: () => void;
  onTradeBuy: (capitalEur: number) => void;
  onTradeSell: () => void;
};

export function OpportunityDetailView({
  rowKey,
  row,
  sheet,
  inputs,
  dashSnapshot,
  clinicalRecordsMerged = [],
  chartBundle,
  enrichment,
  startingCapital,
  tradeBusy = false,
  tradeErr = null,
  onOpenSimEdit,
  onTradeBuy,
  onTradeSell,
}: Props) {
  const { lang } = useMobileLang();
  const it = lang === "it";
  const [clinicalByTicker, setClinicalByTicker] = useState<Map<string, import("../api").ClinicalStudyIndicator[]>>(new Map());
  const [clinicalRecords, setClinicalRecords] = useState<ClinicalPreCdRecord[]>(clinicalRecordsMerged);
  const [resolvedCharts, setResolvedCharts] = useState<MobileCurveChartsPayload | null>(null);
  const [eisOpen, setEisOpen] = useState(false);
  const [regulatoryOpen, setRegulatoryOpen] = useState(false);
  const [curvesFocusToken, setCurvesFocusToken] = useState(0);

  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const rec = dashSnapshot?.recommendations?.find((r) => r.key === rowKey);
  const decisionRow = findDecisionRowInSnapshot(dashSnapshot, rowKey);
  const manualEis = manualEisForTicker(dashSnapshot?.manualEisByTicker, ticker);
  const snapshotCharts =
    dashSnapshot?.curveChartsByKey?.[rowKey] ?? rec?.curveCharts ?? null;
  const cd = String(row["Completion Date"] ?? "—");
  const daysToCd = daysFromCompletionDate(cd);
  const hasPosition = rowHasActivePortfolio(row, inputs);

  useEffect(() => {
    if (clinicalRecordsMerged.length) {
      setClinicalRecords(clinicalRecordsMerged);
      const map = new Map<string, import("../api").ClinicalStudyIndicator[]>();
      for (const item of clinicalRecordsMerged) {
        const tk = String(item.ticker ?? "").trim().toUpperCase();
        if (!tk || !item.clinical_indicators?.length) continue;
        map.set(tk, item.clinical_indicators);
      }
      setClinicalByTicker(map);
      return;
    }
    let cancelled = false;
    void fetchClinicalPreCdSnapshot()
      .then((snap) => {
        if (cancelled) return;
        const merged = mergeManualStoreIntoClinicalRecords(snap.records ?? [], null);
        setClinicalRecords(merged);
        const map = new Map<string, import("../api").ClinicalStudyIndicator[]>();
        for (const item of merged) {
          const tk = String(item.ticker ?? "").trim().toUpperCase();
          if (!tk || !item.clinical_indicators?.length) continue;
          map.set(tk, item.clinical_indicators);
        }
        setClinicalByTicker(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clinicalRecordsMerged]);

  useEffect(() => {
    if (
      snapshotCharts &&
      (snapshotCharts.predBlend?.length ||
        snapshotCharts.slopeTrajectory?.length ||
        snapshotCharts.polygon?.labels?.length)
    ) {
      setResolvedCharts(snapshotCharts);
      return;
    }
    let cancelled = false;
    setResolvedCharts(null);
    void (async () => {
      const fromApi = await fetchMobileCurveChartsForKey(rowKey);
      if (cancelled) return;
      if (
        fromApi &&
        (fromApi.predBlend?.length ||
          fromApi.slopeTrajectory?.length ||
          fromApi.polygon?.labels?.length)
      ) {
        setResolvedCharts(fromApi);
        return;
      }
      try {
        const data = await resolveCurveChartsForRow({
          key: rowKey,
          row,
          snapshotCharts: fromApi ?? snapshotCharts,
          inputs,
          daysToCd,
          planReturnPct: rec?.planReturnPct ?? null,
          hasPosition,
          completionDate: cd,
        });
        if (!cancelled) setResolvedCharts(data);
      } catch {
        if (!cancelled) setResolvedCharts(fromApi ?? snapshotCharts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rowKey, row, snapshotCharts, rec?.planReturnPct, inputs, daysToCd, hasPosition, cd]);

  const cardProps = useMemo(
    () =>
      buildMobileOpportunityCardProps({
        row,
        inputs,
        snapshot: dashSnapshot,
        chartBundle,
        enrichment,
        curveCharts: resolvedCharts ?? snapshotCharts,
        decisionRow,
        clinicalIndicators: clinicalByTicker.get(ticker) ?? null,
        clinicalRecords,
        it,
      }),
    [row, inputs, dashSnapshot, chartBundle, enrichment, resolvedCharts, snapshotCharts, decisionRow, clinicalByTicker, clinicalRecords, ticker, it],
  );

  const eisSheetScore = cardProps.eisRaw ?? manualEis?.score ?? rec?.eisScore ?? null;
  const eisSheetHint =
    manualEis?.title ??
    rec?.eisHint ??
    (manualEis?.showProvisionalStar
      ? it
        ? "EIS manuale positivo — conferma capitale in attesa (★)"
        : "Manual positive EIS — capital confirmation pending (★)"
      : null);

  const tradePriceUsd = useMemo(() => {
    const pos = computeSimulationPosition(row, inputs);
    if (pos?.currPrice != null && pos.currPrice > 0) return pos.currPrice;
    return currentPriceFromRow(row);
  }, [row, inputs]);

  const tradeOpenCapitalEur = useMemo(() => {
    const pos = computeSimulationPosition(row, inputs);
    return pos && pos.capital > 0 ? pos.capital : null;
  }, [row, inputs]);

  const tradeSuggestedCapitalEur = useMemo(() => {
    const cash = mobileSimCash(inputs, sheet, startingCapital);
    const base = cash.invested > 0 ? cash.invested : cash.startingCapital;
    const decision = resolveMobileDecisionRow(
      rowKey,
      sheet,
      inputs,
      dashSnapshot,
      enrichment,
    );
    let suggested =
      decision?.rec === "buy"
        ? suggestedInvestEur(base, suggestedInvestPctForBuy(decision.scores))
        : suggestedInvestEur(base, 10);
    const softBuy = dashSnapshot?.softBuys?.find((b) => b.key === rowKey);
    const mult =
      softBuy?.capitalMult != null && softBuy.capitalMult > 0
        ? softBuy.capitalMult
        : softBuy?.gateTier === "strong"
          ? 1
          : softBuy?.gateTier === "mid"
            ? 0.7
            : softBuy?.gateTier === "weak"
              ? 0.4
              : null;
    if (mult != null) {
      suggested = Math.max(50, Math.round((suggested * mult) / 50) * 50);
    }
    return suggested;
  }, [rowKey, sheet, inputs, dashSnapshot, enrichment, startingCapital]);

  const handleOpenDetail = (section: OpportunityDetailSection, _chartSlide?: string | null) => {
    if (section === "eis") {
      setEisOpen(true);
      return;
    }
    if (section === "regulatory") {
      setRegulatoryOpen(true);
      return;
    }
    if (section === "decisionLab") {
      onOpenSimEdit();
      return;
    }
    // Curves fullscreen sheet removed — scroll to inline price / MII charts only.
    if (section === "slopes" || section === "mii" || section === "curves") {
      setCurvesFocusToken((t) => t + 1);
    }
  };

  return (
    <>
      <MobileOpportunityCard
        {...cardProps}
        focusCurvesToken={curvesFocusToken}
        onOpenDetail={handleOpenDetail}
        tradePriceUsd={tradePriceUsd}
        tradeSuggestedCapitalEur={tradeSuggestedCapitalEur}
        tradeOpenCapitalEur={tradeOpenCapitalEur}
        tradeBusy={tradeBusy}
        tradeErr={tradeErr}
        onTradeBuy={onTradeBuy}
        onTradeSell={onTradeSell}
      />

      <MobileEisSheet
        open={eisOpen}
        ticker={ticker}
        eisScore={eisSheetScore}
        eisHint={eisSheetHint}
        clinicalRecords={clinicalRecords}
        onClose={() => setEisOpen(false)}
      />

      <MobileRegulatorySheet
        open={regulatoryOpen}
        ticker={ticker}
        signedScore={cardProps.regSignedScore}
        clinicalPhase={clinicalPhaseFromSimRow(row)}
        initialSnap={enrichment.regSnap}
        onClose={() => setRegulatoryOpen(false)}
      />
    </>
  );
}
