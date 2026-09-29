/**
 * Tabella eventi slope / contrarian — overview e dettaglio per company.
 */

import type { ChartBundle, SheetTable } from "../types";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { UnifiedSlopeFeedRow } from "../sheet/slopeEventsFeed";
import { companyNameFromSimRow, resolveSlopeChartContext } from "../sheet/slopeEventsFeed";
import { summarizeSlopeFeedRow, slopeSignTransition } from "../sheet/slopeEventSummary";
import {
  fmtSlopeCapitalLossEur,
  fmtStockUsd,
  resolveSlopeCapitalImpact,
  resolveSlopeStockPrices,
  slopeAccelPriceHint,
  slopeCapitalLossTone,
  slopeStockActualTitle,
  slopeStockExpectedTitle,
} from "../sheet/slopeStockPrices";
import { extractCurveInputs } from "../sheet/precatCurve";
import { SlopeTrendDiagram, ContrarianMiniDiagram } from "./SlopeTrendDiagram";
import {
  SlopeChangeCell,
  SlopeErrorKindBadge,
  SlopeSeverityBadge,
  SLOPE_TABLE_CLASS,
  SLOPE_TABLE_WRAP,
  SlopeFeedColGroup,
  SlopeTableHeadRow,
  SLOPE_TD_ACTION,
  SLOPE_TD_COMPACT,
  SLOPE_TD_ERROR_TYPE,
  SLOPE_TD_SEVERITY,
  SLOPE_TD_SLOPE_DELTA,
  SLOPE_TD_STOCK,
  SLOPE_TD_STOCK_ACTUAL,
  SLOPE_TD_STOCK_EXPECTED,
  SLOPE_TD_COMPANY,
  SLOPE_TD_TICKER,
  SLOPE_TD_TRAJECTORY,
} from "./SlopeTableUi";
import { TickerWithCdLifecycle } from "./CdLifecycleBadge";
import { useLang } from "../shared/i18n";
import { daysFromToday } from "../sheet/simulationPlanGain";

function fmtDetected(ts: number, it: boolean): string {
  return new Date(ts).toLocaleString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SlopeEventsTable({
  rows,
  simTable,
  chartsBundle,
  selectedRowId,
  onSelectRow,
  onTickerClick,
  onOpenChart,
  showTickerColumn = true,
  showCompanyColumn = false,
  showStockColumns = false,
  showCapitalLossColumn = false,
  inputs,
  compact = false,
}: {
  rows: UnifiedSlopeFeedRow[];
  simTable?: SheetTable | null;
  chartsBundle?: ChartBundle | null;
  inputs?: InvestSimInputs | null;
  selectedRowId?: string | null;
  onSelectRow?: (row: UnifiedSlopeFeedRow) => void;
  onTickerClick?: (ticker: string) => void;
  onOpenChart?: (row: UnifiedSlopeFeedRow) => void;
  showTickerColumn?: boolean;
  showCompanyColumn?: boolean;
  showStockColumns?: boolean;
  showCapitalLossColumn?: boolean;
  compact?: boolean;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const showCapLoss = showCapitalLossColumn && Boolean(inputs);
  const identityFirst = showTickerColumn;
  const feedColOpts = {
    variant: "events" as const,
    showTickerColumn,
    showCompanyColumn,
    showStockColumns,
    showCapitalLossColumn: showCapLoss,
    showChartActionColumn: Boolean(onOpenChart),
  };

  if (!rows.length) {
    return (
      <p className="text-xs text-ink-muted py-6 text-center">
        {it ? "Nessun evento nel log." : "No events in the log."}
      </p>
    );
  }

  return (
    <div className={SLOPE_TABLE_WRAP}>
      <table className={`${SLOPE_TABLE_CLASS} ${compact ? "text-[11px]" : ""}`}>
        <SlopeFeedColGroup {...feedColOpts} />
        <thead>
          <SlopeTableHeadRow
            variant="events"
            showTickerColumn={showTickerColumn}
            showCompanyColumn={showCompanyColumn}
            showStockColumns={showStockColumns}
            showCapitalLossColumn={showCapLoss}
            showChartActionColumn={Boolean(onOpenChart)}
          />
        </thead>
        <tbody>
          {rows.map((row) => {
            const summary = summarizeSlopeFeedRow(row, lang);
            const cfg = summary.kindMeta;
            const selected = selectedRowId === row.id;
            const chartable = row.hasActiveChart;
            const chartCtx = resolveSlopeChartContext(
              row.ticker,
              row.cd,
              simTable ?? null,
              chartsBundle ?? null,
            );
            const { simRow: eventSimRow, chartPts, logStaleNoSimRow } = chartCtx;
            const liveCurve = eventSimRow ? extractCurveInputs(eventSimRow) : null;
            const stock = resolveSlopeStockPrices(eventSimRow, chartPts, row, {
              simRowStale: logStaleNoSimRow,
              eventCd: row.cd,
            });
            const { actual, expected } = stock;
            const capImpact = resolveSlopeCapitalImpact(
              eventSimRow,
              inputs ?? undefined,
              actual,
              expected,
            );
            const revHint =
              row.kind === "slope_rev"
                ? slopeSignTransition(summary.slope5d, summary.slope20d, lang, "words")
                : slopeAccelPriceHint(lang, row.kind, stock);
            const companyName = companyNameFromSimRow(eventSimRow);

            const tickerCell = showTickerColumn ? (
              <td className={SLOPE_TD_TICKER}>
                {onTickerClick ? (
                  <button
                    type="button"
                    className="font-bold text-[rgb(var(--accent))] hover:underline tracking-wide"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTickerClick(row.ticker);
                    }}
                  >
                    <TickerWithCdLifecycle ticker={row.ticker} cd={row.cd} days={daysFromToday(row.cd)} />
                  </button>
                ) : (
                  <TickerWithCdLifecycle
                    ticker={row.ticker}
                    cd={row.cd}
                    days={daysFromToday(row.cd)}
                    tickerClassName="font-bold text-ink"
                  />
                )}
              </td>
            ) : null;

            const companyCell = showCompanyColumn ? (
              <td className={SLOPE_TD_COMPANY} title={companyName || undefined}>
                <span className="block truncate text-ink-muted text-[10px] leading-snug max-w-[10rem]">
                  {companyName || "—"}
                </span>
              </td>
            ) : null;

            const trajectoryCell = (
              <td className={SLOPE_TD_TRAJECTORY}>
                {row.source === "contrarian" ? (
                  <ContrarianMiniDiagram
                    slope5d={row.contrarianEvent.slope5d}
                    pred5={row.contrarianEvent.pred5}
                    slope20d={liveCurve?.slope20d ?? null}
                    divergenceType={row.contrarianEvent.divergence_type}
                    title={summary.diagramTitle}
                  />
                ) : summary.slope5d != null && summary.slope20d != null ? (
                  <SlopeTrendDiagram
                    variant="mini"
                    slope5d={summary.slope5d}
                    slope20d={summary.slope20d}
                    errorKind={row.kind}
                    title={summary.diagramTitle}
                  />
                ) : (
                  <span className="text-ink-muted/35">—</span>
                )}
              </td>
            );

            return (
              <tr
                key={row.id}
                className={`border-t border-[rgb(var(--panel-feed-border))]/25 transition-colors align-middle ${
                  selected
                    ? "bg-[rgb(var(--panel-feed-row-hover))]/90"
                    : ""
                } ${onSelectRow ? "cursor-pointer" : ""}`}
                onClick={() => onSelectRow?.(row)}
              >
                {identityFirst ? (
                  <>
                    {tickerCell}
                    {companyCell}
                  </>
                ) : null}
                {trajectoryCell}
                {!identityFirst ? tickerCell : null}
                {!identityFirst ? companyCell : null}
                <td className={SLOPE_TD_ERROR_TYPE}>
                  <SlopeErrorKindBadge
                    meta={cfg}
                    label={it ? cfg.labelIt : cfg.labelEn}
                    hint={revHint}
                  />
                </td>
                <td
                  className={SLOPE_TD_SLOPE_DELTA}
                  title={
                    !eventSimRow && row.source === "slope"
                      ? it
                        ? "Δ e pendenze salvate nel log al rilevamento (ticker assente dal foglio Simulation attuale)"
                        : "Δ and slopes saved in the log at detection (ticker not on current Simulation sheet)"
                      : undefined
                  }
                >
                  <SlopeChangeCell summary={summary} />
                </td>
                {showStockColumns ? (
                  <>
                    <td
                      className={`${SLOPE_TD_STOCK_EXPECTED} ${summary.shiftCls}`}
                      title={
                        stock.gap5pp != null
                          ? `${slopeStockExpectedTitle(stock, lang)} · gap 5g ${stock.gap5pp >= 0 ? "+" : ""}${stock.gap5pp.toFixed(2)} pp`
                          : slopeStockExpectedTitle(stock, lang)
                      }
                    >
                      {fmtStockUsd(expected)}
                    </td>
                    <td
                      className={SLOPE_TD_STOCK_ACTUAL}
                      title={slopeStockActualTitle(stock, lang)}
                    >
                      {fmtStockUsd(actual)}
                    </td>
                  </>
                ) : null}
                {showCapLoss ? (
                  <td
                    className={`${SLOPE_TD_STOCK} text-[10px] leading-snug ${slopeCapitalLossTone(capImpact.modelGapLossEur)}`}
                    title={
                      capImpact.hasPosition && capImpact.capitalEur != null
                        ? it
                          ? `Capitale €${capImpact.capitalEur.toLocaleString("en-US", { maximumFractionDigits: 0 })} · impatto scostamento modello T+5 vs spot${
                              capImpact.positionPnlEur != null
                                ? ` · P&L totale ${fmtSlopeCapitalLossEur(capImpact.positionPnlEur, lang)}`
                                : ""
                            }`
                          : `Capital €${capImpact.capitalEur.toLocaleString("en-US", { maximumFractionDigits: 0 })} · model T+5 vs spot gap impact${
                              capImpact.positionPnlEur != null
                                ? ` · total P&L ${fmtSlopeCapitalLossEur(capImpact.positionPnlEur, lang)}`
                                : ""
                            }`
                        : it
                          ? "Nessuna posizione aperta in Simulation"
                          : "No open Simulation position"
                    }
                  >
                    {capImpact.hasPosition
                      ? fmtSlopeCapitalLossEur(capImpact.modelGapLossEur, lang)
                      : "—"}
                  </td>
                ) : null}
                <td className={SLOPE_TD_SEVERITY}>
                  <SlopeSeverityBadge severity={summary.severity} lang={lang} />
                </td>
                <td className={`${SLOPE_TD_COMPACT} min-w-[4.5rem] tabular-nums text-ink-muted whitespace-nowrap text-[10px] text-left`}>
                  {fmtDetected(row.detected_at, it)}
                </td>
                <td className={SLOPE_TD_COMPACT}>
                  {chartable ? (
                    <span
                      className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-[rgb(var(--warn))]/12 text-[rgb(var(--warn))] text-[10px] font-bold"
                      title={it ? "Grafico attivo" : "Active chart"}
                    >
                      ↓
                    </span>
                  ) : (
                    <span className="text-ink-muted/30">—</span>
                  )}
                </td>
                {onOpenChart ? (
                  <td className={SLOPE_TD_ACTION}>
                    {chartable ? (
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline whitespace-nowrap"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChart(row);
                        }}
                      >
                        {it ? "Grafico →" : "Chart →"}
                      </button>
                    ) : (
                      <span className="text-ink-muted/30">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
