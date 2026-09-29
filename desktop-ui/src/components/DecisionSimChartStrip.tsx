import { useMemo, useState, type ReactNode } from "react";
import type { SheetTable } from "../types";
import type { ExperimentPiggyBank } from "../sheet/investDecisionSimExperiment";
import type { AdviceCalibrationPoint } from "../sheet/investDecisionSimAdviceCalibration";
import type { AdviceErrorHorizon } from "../sheet/adviceErrorTimelineCharts";
import { summarizeBuySellAdviceWindow } from "../sheet/adviceErrorTimelineCharts";
import type {
  DecisionSimTick,
  PaperPosition,
  TickerSimEvaluation,
} from "../sheet/investDecisionSimLoop";
import type { SimLoopSynthMaturationPoint } from "../sheet/simLoopSynthMaturation";
import type { SimLoopSizingVariant } from "../sheet/simLoopSizingVariant";
import {
  AdviceBuySellErrorChart,
  AdviceBuySellLegend,
  AdviceErrorHorizonBar,
  AdviceErrorUniverseBar,
  useAdviceBuySellErrorModel,
} from "./AdviceErrorTimelineCharts";
import {
  filterAdviceCalibrationByUniverse,
  type AdviceErrorUniverseView,
} from "../sheet/investDecisionSimAdviceCalibration";
import { DecisionSimPnlCharts } from "./DecisionSimPnlCharts";
import { DecisionSimMaturationChart } from "./DecisionSimMaturationChart";
import { SimLoopSizingVariantToggle } from "./SimLoopSizingVariantToggle";
import {
  DECISION_SIM_EXPERIMENT_CHART_HEIGHT,
  DECISION_SIM_EXPERIMENT_ROW_PX,
  DECISION_SIM_TOP_ERROR_CHART_HEIGHT,
} from "./decisionSimChartLayout";

function StripChartCard({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <div className="tester-monitor-panel rounded-xl p-2 flex flex-col min-w-0 h-full overflow-hidden">
      <p className="text-[10px] font-semibold text-ink truncate shrink-0" title={title}>
        {title}
      </p>
      <div className="flex-1 min-h-0 mt-1">{children}</div>
      {footer ? (
        <p className="text-[8px] text-ink-muted/70 mt-1 tabular-nums shrink-0 min-h-[12px] truncate">
          {footer}
        </p>
      ) : (
        <span className="block min-h-[12px] shrink-0" aria-hidden />
      )}
    </div>
  );
}

/** Unified BUY/SELL signed-error chart — dashboard top row. */
export function AdviceErrorChartsCard({
  points,
  lang,
  chartHeight = DECISION_SIM_TOP_ERROR_CHART_HEIGHT,
  className,
}: {
  points: AdviceCalibrationPoint[];
  lang: "it" | "en";
  chartHeight?: number;
  className?: string;
}) {
  const it = lang === "it";
  const [horizon, setHorizon] = useState<AdviceErrorHorizon>("24h");
  const [universe, setUniverse] = useState<AdviceErrorUniverseView>("all");
  const filteredPoints = useMemo(
    () => filterAdviceCalibrationByUniverse(points, universe),
    [points, universe],
  );
  const model = useAdviceBuySellErrorModel(filteredPoints, lang, horizon);

  const summary = useMemo(
    () => summarizeBuySellAdviceWindow(filteredPoints, horizon),
    [filteredPoints, horizon],
  );

  const footer = useMemo(() => {
    const universeLabel =
      universe === "portfolio"
        ? it
          ? "portafoglio"
          : "portfolio"
        : universe === "simloop"
          ? "sim loop"
          : it
            ? "tutti"
            : "all";
    if (summary.totalBuy + summary.totalSell === 0 && !model.hasData) return "";
    if (it) {
      return (
        `Errori ${summary.errorTotal}/${summary.totalBuy + summary.totalSell} · ` +
        `BUY ${summary.errorBuy}/${summary.totalBuy} (eseguiti ${summary.executedBuy}) · ` +
        `SELL ${summary.errorSell}/${summary.totalSell} (eseguiti ${summary.executedSell}) · ${universeLabel}`
      );
    }
    return (
      `Errors ${summary.errorTotal}/${summary.totalBuy + summary.totalSell} · ` +
      `BUY ${summary.errorBuy}/${summary.totalBuy} (executed ${summary.executedBuy}) · ` +
      `SELL ${summary.errorSell}/${summary.totalSell} (executed ${summary.executedSell}) · ${universeLabel}`
    );
  }, [summary, model.hasData, universe, it]);

  return (
    <div className={`flex flex-col min-h-0 h-full gap-1.5 ${className ?? ""}`}>
      <div className="flex flex-col gap-1 shrink-0">
        <AdviceErrorHorizonBar lang={lang} horizon={horizon} onHorizonChange={setHorizon} />
        <AdviceErrorUniverseBar lang={lang} universe={universe} onUniverseChange={setUniverse} />
        <AdviceBuySellLegend lang={lang} />
      </div>
      {summary.totalBuy + summary.totalSell > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-[9px] tabular-nums shrink-0">
          <span className="rounded-md border border-rose-200/70 bg-rose-50/60 px-2 py-0.5 font-semibold text-rose-800">
            {it ? "Errori" : "Errors"} {summary.errorTotal}
          </span>
          <span className="rounded-md border border-slate-200/70 bg-slate-50/60 px-2 py-0.5 text-ink">
            BUY {summary.errorBuy}/{summary.totalBuy}
            <span className="text-ink-muted font-normal">
              {" "}
              ({it ? "eseg." : "exec."} {summary.executedBuy})
            </span>
          </span>
          <span className="rounded-md border border-slate-200/70 bg-slate-50/60 px-2 py-0.5 text-ink">
            SELL {summary.errorSell}/{summary.totalSell}
            <span className="text-ink-muted font-normal">
              {" "}
              ({it ? "eseg." : "exec."} {summary.executedSell})
            </span>
          </span>
        </div>
      ) : null}
      <StripChartCard
        title={it ? "Errore consigli BUY/SELL" : "BUY/SELL advice error"}
        footer={footer || undefined}
      >
        <AdviceBuySellErrorChart model={model} lang={lang} chartHeight={chartHeight} />
      </StripChartCard>
    </div>
  );
}

/** Bottom row — 24h gain + open/closed maturation across equal · weight · synth. */
export function DecisionSimChartsStrip({
  points: _points,
  lang,
  ticks,
  livePiggy,
  liveEvaluations,
  paperPortfolio,
  simTable,
  capitalPerTrade,
  maxOpenPositions,
  actualPortfolioSeries,
  simLoopSynthMaturation,
  simLoopWeightedMaturation,
  sizingVariant,
  onSizingVariantChange,
}: {
  points: AdviceCalibrationPoint[];
  lang: "it" | "en";
  ticks: DecisionSimTick[];
  livePiggy: ExperimentPiggyBank;
  liveEvaluations: TickerSimEvaluation[];
  paperPortfolio: PaperPosition[];
  simTable: SheetTable | null | undefined;
  capitalPerTrade: number;
  maxOpenPositions?: number;
  actualPortfolioSeries: {
    closed: Array<{ at: string; totalPnlEur: number }>;
    open: Array<{ at: string; totalPnlEur: number }>;
  };
  simLoopSynthMaturation: SimLoopSynthMaturationPoint[] | null;
  simLoopWeightedMaturation: SimLoopSynthMaturationPoint[] | null;
  sizingVariant: SimLoopSizingVariant;
  onSizingVariantChange: (v: SimLoopSizingVariant) => void;
}) {
  const it = lang === "it";
  const chartH = DECISION_SIM_EXPERIMENT_CHART_HEIGHT;

  return (
    <div className="space-y-1.5 shrink-0 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
        <p className="text-[10px] text-ink-muted leading-snug max-w-[min(100%,42rem)]">
          {it
            ? "Confronto tre esperimenti sim loop (equal · weight · synth): gain 24h, deal aperti e chiusi."
            : "Three sim-loop experiments (equal · weight · synth): 24h gain, open and closed deals."}
        </p>
        <SimLoopSizingVariantToggle
          value={sizingVariant}
          onChange={onSizingVariantChange}
          compact
        />
      </div>
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-2 min-w-0 [&>*]:min-w-0"
        style={{ gridAutoRows: `${DECISION_SIM_EXPERIMENT_ROW_PX}px` }}
      >
        <DecisionSimPnlCharts
          ticks={ticks}
          livePiggy={livePiggy}
          liveEvaluations={liveEvaluations}
          paperPortfolio={paperPortfolio}
          simTable={simTable}
          capitalPerTrade={capitalPerTrade}
          maxOpenPositions={maxOpenPositions}
          lang={lang}
          stripMode
          experimentChartHeight={chartH}
          simLoopSynthMaturation={simLoopSynthMaturation}
          simLoopWeightedMaturation={simLoopWeightedMaturation}
          sizingVariant={sizingVariant}
          onSizingVariantChange={onSizingVariantChange}
        />

        <DecisionSimMaturationChart
          ticks={ticks}
          livePiggy={livePiggy}
          liveEvaluations={liveEvaluations}
          paperPortfolio={paperPortfolio}
          actualPortfolioSeries={actualPortfolioSeries}
          simLoopSynthSeries={simLoopSynthMaturation ?? undefined}
          simLoopWeightedSeries={simLoopWeightedMaturation ?? undefined}
          sizingVariant={sizingVariant}
          onSizingVariantChange={onSizingVariantChange}
          stripMode
          experimentChartHeight={chartH}
          className="min-w-0 h-full"
        />
      </div>
    </div>
  );
}
