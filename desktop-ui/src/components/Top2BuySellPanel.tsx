/**
 * Top 2 BUY / Top 2 SELL — card decisionali compatte (Dashboard).
 * Risponde a: investire? perché? rendimento? giorni? solidità? fase? feed clinico.
 */

import type { ChartPoint } from "../types";
import { useEffect, useMemo, useState } from "react";
import { readLocalSdsSnapshot } from "../api/supernova";
import { useLang, useT } from "../shared/i18n";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { DealRankBadge } from "./DealRankBadge";
import {
  DEFAULT_PLAN_CAPITAL_EUR,
  expectedGainEurFromPct,
  formatGainEurSigned,
  formatSignedPct,
} from "../sheet/expectedRoiDisplay";
import { resolveModelTargetDisplay } from "../sheet/simRowTargetStop";
import { formatPositionPnlSummary, portfolioPnlTone } from "../sheet/portfolioGainLossStyle";
import { resolveExpectedGainPlan, type ExpectedGainSource } from "../sheet/simulationPlanGain";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import type { StabilityVerdict } from "../sheet/slopeStability";
import { currentPriceFromRow } from "../sheet/simulationPosition";
import {
  declineInputFromSignalLike,
  isCurveRisingForHold,
  isSustainedDeclineSignal,
} from "../sheet/portfolioDeclineSell";
import { resolveTop2HeadlineRoi } from "../sheet/top2DecisionHelpers";
import { SdsScoreCompactCell } from "./SdsScoreCompactCell";
import { SimulationSolidityBadge } from "./SimulationSolidityBadge";
import {
  buildSdsByTicker,
  getCachedSdsForTopOpps,
  setCachedSdsForTopOpps,
  type SdsGateInfo,
} from "../sheet/sdsTopOppGate";
import type { MigSoliditySnapshot } from "../sheet/entrySolidityMig";
import {
  resolveSimulationEntrySolidity,
  simulationSolidityVisible,
} from "../sheet/simulationEntrySolidity";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import { pickSignalFromSimRow } from "../sheet/top2FromSimulation";
import type { Top2PickSignal } from "../sheet/top2PortfolioPick";
import type { Top2PrioritySignal } from "../sheet/top2BuySellStore";

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 3 : 2) : 2;
  return `$${v.toFixed(d)}`;
}

function sideCountLabel(side: "buy" | "sell", count: number, it: boolean): string {
  if (side === "buy") {
    return count >= 2
      ? it ? "Top 2 BUY" : "Top 2 BUY"
      : it ? "Top BUY" : "Top BUY";
  }
  return count >= 2
    ? it ? "Top 2 SELL" : "Top 2 SELL"
    : it ? "Top SELL" : "Top SELL";
}

function enrichPlan(
  signal: Top2PrioritySignal,
  chartPoints?: ChartPoint[],
) {
  const cap =
    (signal.planCapitalEur ?? 0) > 0
      ? signal.planCapitalEur!
      : DEFAULT_PLAN_CAPITAL_EUR;
  const row = signal.simRow;
  if (row && typeof row === "object" && Object.keys(row).length > 0) {
    const plan = resolveExpectedGainPlan(row, cap, { chartPoints });
    return {
      returnPct: plan.targetReturnPct ?? signal.planReturnPct ?? null,
      cdReturnPct: plan.expectedReturnPct,
      targetReturnPct: plan.targetReturnPct,
      targetDays: plan.daysToTarget,
      targetGainEur: plan.targetGainEur,
      days: plan.daysToCd ?? signal.planDays ?? signal.days,
      gainEur: plan.targetGainEur ?? expectedGainEurFromPct(plan.targetReturnPct, cap),
      source: (plan.source ?? signal.planGainSource) as ExpectedGainSource | undefined,
      capitalEur: cap,
    };
  }
  const ret = signal.planReturnPct ?? null;
  return {
    returnPct: ret,
    cdReturnPct: null,
    targetReturnPct: ret,
    targetDays: null,
    targetGainEur: null,
    days: signal.planDays ?? signal.days,
    gainEur: expectedGainEurFromPct(ret, cap),
    source: signal.planGainSource as ExpectedGainSource | undefined,
    capitalEur: cap,
  };
}

function PriorityOpportunityCard({
  signal,
  side,
  rankIndex,
  rankTotal,
  chartPoints,
  onOpenPredictionCharts,
  sdsInfo,
  onOpenSupernovaTab,
  onOpenSimulationRow,
  investSimInputs,
  portfolioHistory,
  solidityOpts,
}: {
  signal: Top2PrioritySignal;
  side: "buy" | "sell";
  rankIndex: number;
  rankTotal: number;
  chartPoints?: ChartPoint[];
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  sdsInfo?: SdsGateInfo | null;
  onOpenSupernovaTab?: (ticker: string) => void;
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  investSimInputs: InvestSimInputs;
  portfolioHistory: InvestSimHistoryPoint[];
  solidityOpts?: { sdsByTicker?: Map<string, SdsGateInfo>; migByKey?: Map<string, MigSoliditySnapshot> };
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  const pickForRa: Top2PickSignal | null =
    signal.simRow && Object.keys(signal.simRow).length > 0
      ? pickSignalFromSimRow(
          signal.simRow,
          investSimInputs,
          chartPoints,
          portfolioHistory,
        )
      : null;
  const raSolidity = resolveSimulationEntrySolidity(
    pickForRa ?? ({ ...signal, upsideScore: signal.score ?? 0 } as Top2PickSignal),
    solidityOpts,
    it ? "it" : "en",
    signal.hasPosition ? "rascore" : "entry",
  );
  const raVisible = simulationSolidityVisible(raSolidity) ? raSolidity : null;

  const plan = enrichPlan(signal, chartPoints);
  const declineCtx = declineInputFromSignalLike({
    planReturnPct: plan.returnPct,
    planCdReturnPct: plan.cdReturnPct ?? null,
    pred5: signal.pred5,
    slope20d: signal.slope20d,
    stabilityVerdict: signal.stabilityVerdict as StabilityVerdict | undefined,
    slopeRotationFlag: undefined,
    simRow: signal.simRow,
  });
  const slopeDeclining = side === "sell" && isSustainedDeclineSignal({
    planReturnPct: plan.returnPct,
    pred5: signal.pred5,
    slope20d: signal.slope20d,
    stabilityVerdict: signal.stabilityVerdict as StabilityVerdict | undefined,
    simRow: signal.simRow,
  });
  const curveRisingHold = side === "sell" && isCurveRisingForHold(declineCtx);
  const portfolioPnlLoss =
    side === "sell" && portfolioPnlTone(signal.pnlEur, signal.pnlPct) === "loss";

  const roiHeadline = resolveTop2HeadlineRoi(
    side,
    plan.cdReturnPct ?? null,
    plan.targetReturnPct ?? plan.returnPct,
    plan.days,
    plan.targetDays,
    curveRisingHold,
  );

  const price =
    signal.currentPriceUsd ?? currentPriceFromRow(signal.simRow);
  const headlinePct = roiHeadline.headlinePct;
  const headlineGain = roiHeadline.useTarget ? plan.targetGainEur : plan.gainEur;
  const headlineDays = roiHeadline.headlineDays;

  const targetDisplay =
    signal.simRow && typeof signal.simRow === "object"
      ? resolveModelTargetDisplay(signal.simRow, price, undefined, headlinePct)
      : null;
  const targetPriceUsd =
    targetDisplay?.targetPriceUsd ??
    (price != null && headlinePct != null
      ? price * (1 + headlinePct / 100)
      : null);

  const retCls =
    headlinePct == null
      ? "text-ink-muted"
      : headlinePct > 0
        ? "text-[rgb(var(--signal-up))]"
        : headlinePct < 0
          ? "text-[rgb(var(--signal-down))]"
          : "text-ink-muted";

  const cardTone =
    side === "buy"
      ? "border-[rgb(var(--signal-up))]/30 bg-[rgb(var(--signal-up))]/[0.04]"
      : slopeDeclining || portfolioPnlLoss
        ? "border-[rgb(var(--signal-down))]/30 bg-[rgb(var(--signal-down))]/[0.04]"
        : "border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/[0.06]";

  const openCharts = () => {
    onOpenPredictionCharts?.({
      ticker: signal.ticker,
      seriesKey: simulationRowSeriesKey(signal.simRow) ?? null,
    });
  };

  const sellTodayPnl =
    side === "sell" && signal.hasPosition
      ? formatPositionPnlSummary(signal.pnlEur, signal.pnlPct, {
          pnlEur24h: signal.pnlEur24h,
          pnlPct24h: signal.pnlPct24h,
        })
      : null;
  const sellTodayTone =
    sellTodayPnl?.tone === "gain"
      ? "text-[rgb(var(--signal-up))]"
      : sellTodayPnl?.tone === "loss"
        ? "text-[rgb(var(--signal-down))]"
        : "text-ink-muted";

  const roiRowLabel = roiHeadline.useTarget
    ? side === "sell"
      ? it
        ? "Atteso"
        : "Expected"
      : "Target"
    : it
      ? "ROI CD"
      : "CD ROI";

  const targetPriceToneCls =
    price != null && targetPriceUsd != null
      ? targetPriceUsd > price
        ? "text-[rgb(var(--signal-up))]"
        : targetPriceUsd < price
          ? "text-[rgb(var(--signal-down))]"
          : "text-ink"
      : "text-ink";

  const priceArrowTitle =
    targetDisplay && targetPriceUsd != null
      ? it
        ? targetDisplay.tooltipIt
        : targetDisplay.tooltipEn
      : price != null && targetPriceUsd != null
        ? it
          ? `Prezzo attuale ${fmtUsd(price)} → ${
              side === "sell" ? "prezzo atteso" : "target"
            } ${fmtUsd(targetPriceUsd)}`
          : `Current ${fmtUsd(price)} → ${
              side === "sell" ? "expected" : "target"
            } ${fmtUsd(targetPriceUsd)}`
        : t("signals.priority.openChartsTitle");

  const targetLine = (
    <>
      <span className="text-ink">{signal.ticker}</span>
      <span className="text-ink-muted">, </span>
      <span>{roiRowLabel}</span>
      {formatSignedPct(headlinePct)}
      {headlineGain != null || headlineDays != null ? (
        <span className="text-xs font-semibold">
          (
          {headlineGain != null ? formatGainEurSigned(headlineGain) : ""}
          {headlineGain != null && headlineDays != null ? ", " : ""}
          {headlineDays != null && headlineDays > 0
            ? `${headlineDays}${it ? "g" : "d"}`
            : ""}
          )
        </span>
      ) : null}
      {targetPriceUsd == null && targetDisplay?.mode === "fall" ? (
        <span className="ml-1 text-xs font-semibold text-[rgb(var(--signal-down))]">↓</span>
      ) : null}
    </>
  );

  return (
    <div className={`rounded-md border px-2 py-1.5 ${cardTone}`}>
      <div className="flex gap-2 items-stretch min-w-0">
        <button
          type="button"
          className="top2-opp-sparkline-wrap shrink-0 w-[88px] h-[4.5rem] rounded border border-[rgb(var(--border))]/35 bg-white/60 dark:bg-black/10 p-0.5 flex items-center justify-center self-center"
          onClick={() => (onOpenPredictionCharts ? openCharts() : undefined)}
          title={t("signals.priority.openChartsTitle")}
        >
          <SimulationSparkline
            row={signal.simRow}
            points={chartPoints}
            width={160}
            height={64}
            showCdZones
            showZoneLabels={false}
            portfolio={
              signal.hasPosition && signal.pnlPct != null
                ? {
                    pnlPct: signal.pnlPct,
                    buyPriceUsd: signal.buyPriceUsd ?? null,
                  }
                : null
            }
            className="w-full h-full min-h-[3.75rem] max-h-[4.25rem]"
          />
        </button>

        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-start justify-end min-w-0">
            <button
              type="button"
              onClick={() => (onOpenPredictionCharts ? openCharts() : undefined)}
              className="text-sm font-bold tabular-nums text-ink hover:text-[rgb(var(--accent))] leading-tight text-right"
              title={priceArrowTitle}
            >
              {price != null ? fmtUsd(price) : "—"}
              {targetPriceUsd != null && price != null ? (
                <>
                  <span className="text-ink-muted font-semibold mx-0.5">→</span>
                  <span className={targetPriceToneCls}>{fmtUsd(targetPriceUsd)}</span>
                </>
              ) : null}
            </button>
          </div>

          <p
            className={`text-sm font-bold tabular-nums leading-snug flex items-center gap-1 min-w-0 ${retCls}`}
            title={
              targetDisplay
                ? it
                  ? targetDisplay.tooltipIt
                  : targetDisplay.tooltipEn
                : undefined
            }
          >
            <DealRankBadge
              rankIndex={rankIndex}
              total={rankTotal}
              lang={lang}
              rankOrder={side === "sell" ? "worst_first" : "best_first"}
              labelMode="deal"
              showLabel={false}
            />
            <span className="min-w-0 truncate">{targetLine}</span>
          </p>

          <div className="flex items-center gap-3 leading-tight">
            <SdsScoreCompactCell
              info={sdsInfo}
              size={30}
              onOpenSupernova={
                onOpenSupernovaTab ? () => onOpenSupernovaTab(signal.ticker) : undefined
              }
            />
            {raVisible ? (
              <SimulationSolidityBadge
                result={raVisible}
                variant="column"
                onOpenDetail={
                  onOpenSimulationRow
                    ? () =>
                        onOpenSimulationRow({
                          ticker: signal.ticker,
                          cd: signal.cd,
                        })
                    : undefined
                }
              />
            ) : (
              <span className="text-[10px] text-ink-muted/60 tabular-nums">RA —</span>
            )}
          </div>

          {side === "sell" && signal.hasPosition ? (
            <p
              className={`text-xs tabular-nums leading-snug pt-0.5 ${sellTodayTone}`}
              title={
                it
                  ? "P&L mark-to-market se chiudi oggi"
                  : "Mark-to-market P&L if you close today"
              }
            >
              <span className="text-ink-muted font-semibold uppercase text-[10px] mr-1">
                {it ? "Uscita ora" : "Exit now"}
              </span>
              {sellTodayPnl && (sellTodayPnl.pct !== "—" || sellTodayPnl.amount !== "—") ? (
                <>
                  {sellTodayPnl.pct !== "—" ? sellTodayPnl.pct : sellTodayPnl.amount}
                  {sellTodayPnl.pct !== "—" && sellTodayPnl.amount !== "—" ? (
                    <span className="font-semibold"> ({sellTodayPnl.amount})</span>
                  ) : null}
                </>
              ) : (
                <span className="text-ink-muted font-normal">
                  {it ? "Imposta buy in Simulation" : "Set buy in Simulation"}
                </span>
              )}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Top2BuySellPanel({
  buy,
  sell,
  chartPointsBySeriesKey,
  onOpenPredictionCharts,
  onOpenSupernovaTab,
  onOpenSimulationRow,
  investSimInputs,
  portfolioHistory,
  sdsByTicker: sdsByTickerProp,
  migSolidityByKey,
  className = "",
}: {
  buy: Top2PrioritySignal[];
  sell: Top2PrioritySignal[];
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>;
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  onOpenSupernovaTab?: (ticker: string) => void;
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  investSimInputs: InvestSimInputs;
  portfolioHistory: InvestSimHistoryPoint[];
  sdsByTicker?: Map<string, SdsGateInfo>;
  migSolidityByKey?: Map<string, MigSoliditySnapshot>;
  className?: string;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [sdsByTickerLocal, setSdsByTickerLocal] = useState<Map<string, SdsGateInfo>>(
    () => getCachedSdsForTopOpps() ?? new Map(),
  );

  useEffect(() => {
    if (sdsByTickerProp) return;
    void readLocalSdsSnapshot().then((doc) => {
      const map = buildSdsByTicker(doc?.rows);
      setCachedSdsForTopOpps(map);
      setSdsByTickerLocal(map);
    });
  }, [buy.length, sell.length, sdsByTickerProp]);

  const sdsByTicker = sdsByTickerProp ?? sdsByTickerLocal;
  const solidityOpts = useMemo(
    () =>
      migSolidityByKey || sdsByTicker.size > 0
        ? { sdsByTicker, migByKey: migSolidityByKey }
        : undefined,
    [sdsByTicker, migSolidityByKey],
  );

  const chartFor = (signal: Top2PrioritySignal) => {
    const key = simulationRowSeriesKey(signal.simRow) ?? "";
    return chartPointsBySeriesKey?.get(key);
  };

  const hasBuy = buy.length > 0;
  const hasSell = sell.length > 0;
  const twoCol = hasBuy && hasSell;
  const gridClass = twoCol
    ? "grid md:grid-cols-2 gap-1.5 items-start"
    : "grid grid-cols-1 gap-1 items-start";
  const panelWidthClass = twoCol ? "w-full" : "w-full sm:w-1/2 sm:max-w-[50%]";

  const renderBuyColumn = hasBuy || !hasSell;
  const renderSellColumn = hasSell || !hasBuy;

  return (
    <section
      className={`card shrink-0 px-2 py-1.5 space-y-1 ${panelWidthClass} ${className}`.trim()}
      aria-label={lang === "it" ? "Top 2 acquisti e vendite" : "Top 2 buy and sell"}
      title={
        lang === "it"
          ? "BUY = fuori portafoglio (ROI/g) · SELL = monitora (ambra) o esci (rosso se pendenza ↓) · SDS → SuperNova · RA → Simulation"
          : "BUY = off-portfolio (ROI/day) · SELL = monitor (amber) or exit (red when slope ↓) · SDS → SuperNova · RA → Simulation"
      }
    >
      <div className={gridClass}>
        {renderBuyColumn ? (
        <div className="rounded-md border border-[rgb(var(--border))]/40 px-1.5 py-1 space-y-1">
          <p className="text-xs uppercase tracking-wide text-[rgb(var(--signal-up))] font-semibold leading-none">
            {sideCountLabel("buy", buy.length, it)}
          </p>
          <div className="flex flex-col gap-1">
            {buy.length === 0 ? (
              <p className="text-[11px] text-ink-muted/70 text-center py-1.5 border border-dashed rounded">
                {lang === "it"
                  ? "Nessuna opportunità fuori portafoglio"
                  : "No off-portfolio opportunity"}
              </p>
            ) : (
              buy.slice(0, 2).map((r, i) => (
                <PriorityOpportunityCard
                  key={`buy-${r.ticker}-${r.cd}`}
                  signal={r}
                  side="buy"
                  rankIndex={i}
                  rankTotal={buy.length}
                  chartPoints={chartFor(r)}
                  onOpenPredictionCharts={onOpenPredictionCharts}
                  sdsInfo={sdsByTicker.get(r.ticker.trim().toUpperCase()) ?? null}
                  onOpenSupernovaTab={onOpenSupernovaTab}
                  onOpenSimulationRow={onOpenSimulationRow}
                  investSimInputs={investSimInputs}
                  portfolioHistory={portfolioHistory}
                  solidityOpts={solidityOpts}
                />
              ))
            )}
          </div>
        </div>
        ) : null}

        {renderSellColumn ? (
        <div className="rounded-md border border-[rgb(var(--border))]/40 px-1.5 py-1 space-y-1">
          <p className="text-xs uppercase tracking-wide text-[rgb(var(--warn))] font-semibold leading-none">
            {sideCountLabel("sell", sell.length, it)}
          </p>
          <div className="flex flex-col gap-1">
            {sell.length === 0 ? (
              <p className="text-[11px] text-ink-muted/70 text-center py-1.5 border border-dashed rounded">
                {lang === "it"
                  ? "Nessuna posizione da evidenziare"
                  : "No position to highlight"}
              </p>
            ) : (
              sell.slice(0, 2).map((r, i) => (
                <PriorityOpportunityCard
                  key={`sell-${r.ticker}-${r.cd}`}
                  signal={r}
                  side="sell"
                  rankIndex={i}
                  rankTotal={sell.length}
                  chartPoints={chartFor(r)}
                  onOpenPredictionCharts={onOpenPredictionCharts}
                  sdsInfo={sdsByTicker.get(r.ticker.trim().toUpperCase()) ?? null}
                  onOpenSupernovaTab={onOpenSupernovaTab}
                  onOpenSimulationRow={onOpenSimulationRow}
                  investSimInputs={investSimInputs}
                  portfolioHistory={portfolioHistory}
                  solidityOpts={solidityOpts}
                />
              ))
            )}
          </div>
        </div>
        ) : null}
      </div>

      {buy.length === 0 && sell.length === 0 ? (
        <p className="text-xs text-ink-muted/70 text-center">
          {lang === "it"
            ? "Nessun candidato Top 2 al momento: fuori portafoglio senza ROI positivo, o in portafoglio senza pendenza ↓ né perdita P&L."
            : "No Top 2 candidates right now: no off-portfolio name with positive ROI, or no held position with declining slope or P&L loss."}
        </p>
      ) : null}

    </section>
  );
}
