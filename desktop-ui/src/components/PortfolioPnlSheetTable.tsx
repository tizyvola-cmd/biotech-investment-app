import type { ChartPoint } from "../types";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";
import {
  SHEET_GRID_TABLE_CLASS,
  sheetGridTdClassAlign,
  sheetGridThClassAlign,
} from "../sheet/sheetGridTable";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { sparklineTargetStopFromSimRow } from "../sheet/simRowTargetStop";
import { extractCurveInputs } from "../sheet/precatCurve";
import { resolveExpectedGainPlan } from "../sheet/simulationPlanGain";
import { primaryReturnPctFromGainPlan } from "../sheet/canonicalRoi";
import {
  portfolioDailyPnlValues,
  portfolioPnlTone,
  portfolioPnlEurClass,
  portfolioPnlValueClass,
  portfolioTableOutlookClass,
  portfolioTotalDisplayValues,
  resolvePnlRowOutlook,
  fmtSignedEurPnl,
  type PortfolioTableOutlook,
} from "../sheet/portfolioGainLossStyle";
import { pnlTableRankIcon } from "../sheet/dealRankIcon";
import { resolveSupernovaTargetRoi } from "../sheet/supernovaTargetRoi";
import { currentPriceFromRow } from "../sheet/simulationPosition";
import { ModelTargetPriceCell } from "./ModelTargetPriceCell";
import { isPlanTargetReached } from "./PortfolioPlanTargetChip";
import { SupernovaTargetRoiCell } from "./SupernovaTargetRoiCell";
import { RankAnimalIcon } from "./DealRankBadge";
import { useT } from "../shared/i18n";

const PNL_TABLE_COL_PCT = [12, 11, 9, 10, 9, 9, 12, 12, 16];

export type PortfolioPnlSheetRow = {
  key: string;
  ticker: string;
  name: string;
  completionDate?: string;
  holdDaysElapsed: number | null;
  expectedHoldDays: number | null;
  currentPriceUsd: number | null;
  buyPriceUsd: number | null;
  capital: number;
  pnlUnavailable: boolean;
  pnlPct: number | null;
  pnlEur: number | null;
  pnlPctToday: number | null;
  pnlEurToday: number | null;
  hasToday: boolean;
  purchaseDateLabel: string | null;
  targetGainPct: number | null;
  expectedGainPct: number | null;
  simRow?: Record<string, unknown>;
  chartPoints?: ChartPoint[] | null;
  seriesKey?: string | null;
};

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtMaturity(elapsed: number | null, expected: number | null): string {
  if (elapsed == null && expected == null) return "—";
  if (elapsed != null && expected != null) return `${elapsed}d / ${expected}d`;
  if (elapsed != null) return `${elapsed}d`;
  return `${expected}d`;
}

export function PortfolioPnlSheetTable({
  rows,
  rankByKey,
  rankTotal,
  simTableColumns,
  lang,
  onOpenCurve,
  onSell,
}: {
  rows: PortfolioPnlSheetRow[];
  rankByKey: Map<string, number>;
  rankTotal: number;
  simTableColumns?: string[];
  lang: "it" | "en";
  onOpenCurve: (row: PortfolioPnlSheetRow) => void;
  onSell: (key: string, simRow?: Record<string, unknown> | null) => void;
}) {
  const t = useT();
  const it = lang === "it";
  const headers = it
    ? [
        "Ticker",
        "Curva pred+recalib",
        "Prezzo stimato",
        "Prezzo atteso",
        "Data invest.",
        "Maturazione",
        "P&L totale",
        "P&L 24h",
        "ROI-Target",
      ]
    : [
        "Ticker",
        "Pred+recalib curve",
        "Est. price",
        "Target price",
        "Invest date",
        "Hold days",
        "Total P&L",
        "24h P&L",
        "ROI-Target",
      ];

  return (
    <div className="portfolio-pnl-sheet-table overflow-x-auto rounded-lg border border-[rgb(var(--border))]/70 bg-[rgb(var(--surface-elevated))] shadow-sm">
      <table className={`${SHEET_GRID_TABLE_CLASS} portfolio-pnl-sheet-grid`}>
        <colgroup>
          {PNL_TABLE_COL_PCT.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="portfolio-pnl-sheet-head">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`${sheetGridThClassAlign(i === 0 ? "left" : "center")} py-2.5 px-2 font-bold`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, listIdx) => {
            const rankIndex = rankByKey.get(row.key) ?? listIdx;
            const simRow = row.simRow;
            const chartPts = row.chartPoints ?? null;
            const curvesForTone = simRow ? extractCurveInputs(simRow) : null;
            const gainPlan = simRow
              ? resolveExpectedGainPlan(simRow, row.capital, { chartPoints: chartPts })
              : null;
            const planReturnPct =
              row.targetGainPct ??
              row.expectedGainPct ??
              (gainPlan ? primaryReturnPctFromGainPlan(gainPlan) : null);
            // Colore riga = P&L corrente (verde gain / rosso loss),
            // armonizzato con la tabella Pick stocks. Non più la traiettoria
            // forward verso la CD.
            const rowOutlook: PortfolioTableOutlook = resolvePnlRowOutlook({
              inPortfolio: true,
              pnlUnavailable: row.pnlUnavailable,
              pnlEur: row.pnlUnavailable ? null : row.pnlEur,
              pnlPct: row.pnlUnavailable ? null : row.pnlPct,
            });
            const totalTone = portfolioPnlTone(row.pnlEur, row.pnlPct);
            const rankIcon = pnlTableRankIcon(rankIndex, rankTotal, totalTone);
            const totalDisp = portfolioTotalDisplayValues(
              row.pnlEur,
              row.pnlPct,
              row.pnlEurToday,
              row.pnlPctToday,
            );
            const dailyDisp = portfolioDailyPnlValues(row.pnlEurToday, row.pnlPctToday);
            const rowCls = TABLE_COLORS_ENABLED
              ? portfolioTableOutlookClass(rowOutlook) || "hover:bg-surface/80"
              : "hover:bg-surface/80";
            const targetStop =
              simRow && simTableColumns?.length
                ? sparklineTargetStopFromSimRow(simRow, simTableColumns)
                : null;
            const spotUsd = simRow
              ? currentPriceFromRow(simRow) ?? row.currentPriceUsd
              : row.currentPriceUsd;
            const snTargetRoi = resolveSupernovaTargetRoi(row.ticker, simRow, chartPts);

            return (
              <tr
                key={row.key}
                data-ticker={row.ticker}
                data-pnl-outlook={rowOutlook !== "flat" ? rowOutlook : undefined}
                className={`border-t border-[rgb(var(--border))]/40 ${rowCls}`}
              >
                <td className={`${sheetGridTdClassAlign("left")} py-2.5 px-2 align-middle`}>
                  <div className="flex items-center gap-2 min-w-0">
                    {rankIcon ? (
                      <RankAnimalIcon visual={rankIcon} basePx={18} />
                    ) : (
                      <span className="inline-block w-[18px] shrink-0" aria-hidden />
                    )}
                    <div className="min-w-0 flex flex-col gap-1">
                      <p className="font-bold text-[13px] text-ink truncate leading-tight">{row.ticker}</p>
                      {row.completionDate && row.completionDate !== "—" ? (
                        <p className="text-[10px] text-ink-muted truncate leading-tight">
                          {row.completionDate}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="self-start text-[10px] font-semibold text-[rgb(var(--signal-down))] hover:underline px-0 py-0.5"
                        title={t("sim.pnl.sellTitle", { ticker: row.ticker })}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onSell(row.key, simRow ?? null);
                        }}
                      >
                        {t("sim.pnl.sell")}
                      </button>
                    </div>
                  </div>
                </td>
                <td className={`${sheetGridTdClassAlign("center")} py-2 px-1.5 overflow-hidden`}>
                  <div className="flex justify-center min-w-0">
                    <button
                      type="button"
                      className="rounded-md border border-transparent p-0.5 transition hover:border-accent/35 hover:bg-[rgb(var(--surface-3))]/35 cursor-pointer"
                      title={
                        it
                          ? `Apri curva pred+recalib · ${row.ticker}`
                          : `Open pred+recalib curve · ${row.ticker}`
                      }
                      onClick={() => onOpenCurve(row)}
                    >
                      <SimulationSparkline
                        row={simRow ?? {}}
                        points={chartPts}
                        width={94}
                        height={30}
                        showCdZones
                        showZoneLabels={false}
                        targetStop={targetStop}
                        portfolio={
                          row.pnlUnavailable || row.buyPriceUsd == null
                            ? null
                            : {
                                pnlPct: row.pnlPct,
                                buyPriceUsd: row.buyPriceUsd,
                              }
                        }
                      />
                    </button>
                  </div>
                </td>
                <td className={`${sheetGridTdClassAlign("center")} py-2.5 px-2 tabular-nums text-[12px] font-semibold text-ink`}>
                  {fmtUsd(spotUsd)}
                </td>
                <td className={`${sheetGridTdClassAlign("center")} py-2 px-1.5`}>
                  <ModelTargetPriceCell
                    simRow={simRow}
                    columns={simTableColumns}
                    currPriceUsd={spotUsd}
                    planReturnPct={planReturnPct}
                    buyPriceUsd={row.buyPriceUsd}
                    inPortfolio
                    showProgress={false}
                    suggestedAction={isPlanTargetReached(row.pnlPct, planReturnPct) ? "sell" : null}
                    pnlPct={row.pnlPct}
                    pnlUsd={row.pnlEur}
                    shares={row.buyPriceUsd && row.buyPriceUsd > 0 ? row.capital / row.buyPriceUsd : null}
                  />
                </td>
                <td className={`${sheetGridTdClassAlign("center")} py-2.5 px-2 text-[11px] tabular-nums text-ink`}>
                  {row.purchaseDateLabel ?? "—"}
                </td>
                <td
                  className={`${sheetGridTdClassAlign("center")} py-2.5 px-2 text-[11px] tabular-nums font-medium text-ink`}
                  title={
                    it
                      ? "Giorni trascorsi / durata prevista fino a uscita"
                      : "Elapsed days / planned hold to exit"
                  }
                >
                  {fmtMaturity(row.holdDaysElapsed, row.expectedHoldDays)}
                </td>
                <td className={`${sheetGridTdClassAlign("center")} py-2.5 px-2`}>
                  {row.pnlUnavailable ? (
                    <span className="text-ink-muted text-[11px]">—</span>
                  ) : (
                    <div className="flex flex-col items-center gap-1 leading-tight">
                      <p
                        className={
                          TABLE_COLORS_ENABLED
                            ? portfolioPnlValueClass(totalDisp.tone)
                            : "text-[12px] font-bold tabular-nums text-ink"
                        }
                      >
                        {fmtPct(totalDisp.pct)}
                      </p>
                      <p
                        className={
                          TABLE_COLORS_ENABLED
                            ? portfolioPnlEurClass(totalDisp.tone)
                            : "text-[10px] tabular-nums font-semibold text-ink-muted"
                        }
                      >
                        {totalDisp.eur != null ? fmtSignedEurPnl(totalDisp.eur) : "—"}
                      </p>
                    </div>
                  )}
                </td>
                <td className={`${sheetGridTdClassAlign("center")} py-2.5 px-2`}>
                  {!row.hasToday ? (
                    <span className="text-ink-muted text-[11px]">—</span>
                  ) : (
                    <div className="flex flex-col items-center gap-1 leading-tight">
                      <p
                        className={
                          TABLE_COLORS_ENABLED
                            ? portfolioPnlValueClass(dailyDisp.tone)
                            : "text-[12px] font-bold tabular-nums text-ink"
                        }
                      >
                        {fmtPct(row.pnlPctToday)}
                      </p>
                      <p
                        className={
                          TABLE_COLORS_ENABLED
                            ? portfolioPnlEurClass(dailyDisp.tone)
                            : "text-[10px] tabular-nums font-semibold text-ink-muted"
                        }
                      >
                        {row.pnlEurToday != null ? fmtSignedEurPnl(row.pnlEurToday) : "—"}
                      </p>
                    </div>
                  )}
                </td>
                <td className={`${sheetGridTdClassAlign("center")} py-2 px-1.5`}>
                  <SupernovaTargetRoiCell
                    roi={snTargetRoi}
                    capitalEur={row.capital}
                    slope5d={curvesForTone?.slope5d ?? null}
                    slope20d={curvesForTone?.slope20d ?? null}
                    currentPriceUsd={spotUsd}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
