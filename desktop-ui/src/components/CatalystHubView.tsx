import { useEffect, useMemo, useState } from "react";
import type { SdsRow } from "../api/supernova";
import type { SheetTable } from "../types";
import { SimulationAnalysisView } from "./SimulationAnalysisView";
import { SlopeErrorChartsPanel } from "./SlopeErrorChartsPanel";
import { MarketInterestPanel } from "./MarketInterestPanel";
import { countPortfolioSlopeFeedRows } from "../sheet/slopeEventsFeed";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import { loadDismissedSlopeCharts } from "../sheet/slopeErrorCharts";
import { RefreshControls } from "./RefreshControls";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { useT } from "../shared/i18n";
import { useRefreshStatus } from "../shared/refreshStatusStore";

export type CatalystChartsSubPanel = "curves" | "slopeErrors" | "marketInterest";

export function CatalystHubView({
  simTable,
  simLoading,
  onReloadSimulation,
  secK8Table = null,
  onOpenSecK8,
  chartsFocusSeriesKey,
  chartsFocusTicker,
  onChartsFocusConsumed,
  chartsSubPanelFocus,
  slopeChartsFocusTicker,
  onChartsSubPanelFocusConsumed,
  onSlopeChartsFocusTickerConsumed,
  onOpenPredictionCharts,
  sdsRows: _sdsRows = null,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  simError?: string | null;
  onReloadSimulation: () => void;
  secK8Table?: SheetTable | null;
  onOpenSecK8?: (ticker: string) => void;
  /** From Simulation: selects this series in Charts. */
  chartsFocusSeriesKey?: string | null;
  chartsFocusTicker?: string | null;
  onChartsFocusConsumed?: () => void;
  /** Opens the Slope errors sub-tab in Charts (e.g. from Decision Lab banner). */
  chartsSubPanelFocus?: CatalystChartsSubPanel | null;
  slopeChartsFocusTicker?: string | null;
  onChartsSubPanelFocusConsumed?: () => void;
  onSlopeChartsFocusTickerConsumed?: () => void;
  onOpenPredictionCharts?: (focus: { ticker: string; seriesKey: string | null }) => void;
  sdsRows?: SdsRow[] | null;
}) {
  const t = useT();
  const [chartsSub, setChartsSub] = useState<CatalystChartsSubPanel>("curves");
  const investInputs = useInvestSimInputs(simTable);
  const [chartsBundle, setChartsBundle] = useState<Awaited<
    ReturnType<typeof loadSimulationChartsBundle>
  >["bundle"] | null>(null);
  const { lastReloadAt, finishedAt } = useRefreshStatus();
  const chartsReloadKey = `${simTable?.rows?.length ?? 0}:${lastReloadAt?.getTime() ?? 0}:${finishedAt?.getTime() ?? 0}`;

  useEffect(() => {
    let cancelled = false;
    void loadSimulationChartsBundle().then(({ bundle }) => {
      if (!cancelled) setChartsBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [chartsReloadKey]);

  const slopeErrorsCount = useMemo(
    () =>
      countPortfolioSlopeFeedRows(
        simTable,
        chartsBundle,
        investInputs,
        loadDismissedSlopeCharts(),
      ),
    [simTable, chartsBundle, investInputs],
  );

  useEffect(() => {
    if (chartsSubPanelFocus === "slopeErrors") {
      setChartsSub("slopeErrors");
      onChartsSubPanelFocusConsumed?.();
      return;
    }
    if (chartsFocusSeriesKey || chartsFocusTicker) {
      setChartsSub("curves");
    }
  }, [
    chartsFocusSeriesKey,
    chartsFocusTicker,
    chartsSubPanelFocus,
    onChartsSubPanelFocusConsumed,
  ]);

  const openPredictionCharts = (focus: {
    ticker: string;
    seriesKey: string | null;
  }) => {
    onOpenPredictionCharts?.(focus);
    setChartsSub("curves");
  };

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 gap-0 ${
        chartsSub === "curves" ? "sim-harmonize" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--border))]/60 pb-2 shrink-0">
        <SelectionChipGroup>
          {(
            [
              ["curves", t("catalystHub.tab.curves")],
              [
                "slopeErrors",
                slopeErrorsCount > 0
                  ? t("catalystHub.tab.slopeErrorsCount", { n: slopeErrorsCount })
                  : t("catalystHub.tab.slopeErrors"),
              ],
              ["marketInterest", t("catalystHub.tab.marketSlopes")],
            ] as const
          ).map(([id, label]) => (
            <SelectionChip
              key={id}
              active={chartsSub === id}
              onClick={() => setChartsSub(id)}
            >
              {label}
            </SelectionChip>
          ))}
        </SelectionChipGroup>
        <div className="ml-auto">
          <RefreshControls
            onLocalReload={onReloadSimulation}
            localLoading={simLoading}
            reloadTooltip={t("refresh.page.catalyst.tooltip")}
            extraInfo={
              simTable
                ? t("catalystHub.simRows", { n: (simTable.rows ?? []).length })
                : undefined
            }
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col pt-3">
        {chartsSub === "curves" ? (
          <SimulationAnalysisView
            simTable={simTable}
            simLoading={simLoading}
            secK8Table={secK8Table}
            onOpenSecK8={onOpenSecK8}
            focusSeriesKey={chartsFocusSeriesKey}
            focusTicker={chartsFocusTicker}
            onFocusConsumed={onChartsFocusConsumed}
          />
        ) : chartsSub === "marketInterest" ? (
          <div className="slope-charts-panel mii-charts-panel flex flex-1 min-h-0 flex-col rounded-lg overflow-hidden p-3">
            <MarketInterestPanel
              simTable={simTable}
              chartsBundle={chartsBundle}
              onOpenPredictionCharts={openPredictionCharts}
            />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col rounded-lg overflow-hidden">
            <SlopeErrorChartsPanel
              simTable={simTable}
              chartsBundle={chartsBundle}
              focusTicker={slopeChartsFocusTicker}
              onFocusTickerConsumed={onSlopeChartsFocusTickerConsumed}
              onOpenPredictionCharts={openPredictionCharts}
              slopeErrorsOnly
            />
          </div>
        )}
      </div>
    </div>
  );
}
