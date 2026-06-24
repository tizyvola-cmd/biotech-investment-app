/**
 * Tabella riepilogo società — overview tab Slope errors (un click sul ticker apre il dettaglio).
 */

import type { ChartBundle, SheetTable } from "../types";
import type { RankedCompanySlope } from "../sheet/slopeCompanyRank";
import { resolveSlopeChartContext } from "../sheet/slopeEventsFeed";
import { summarizeSlopeFeedRow, slopeSignTransition } from "../sheet/slopeEventSummary";
import {
  fmtStockUsd,
  resolveSlopeStockPrices,
  slopeAccelPriceHint,
  slopeStockActualTitle,
  slopeStockExpectedTitle,
} from "../sheet/slopeStockPrices";
import { extractCurveInputs } from "../sheet/precatCurve";
import { SlopeTrendDiagram, ContrarianMiniDiagram } from "./SlopeTrendDiagram";
import {
  SlopeChangeCell,
  SlopeCountChip,
  SlopeErrorKindBadge,
  SlopeSeverityBadge,
  SLOPE_TABLE_OVERVIEW_CLASS,
  SLOPE_TABLE_WRAP_OVERVIEW,
  SLOPE_OVERVIEW_ROW,
  SlopeOverviewColGroup,
  SlopeTableHeadRow,
  SLOPE_TD_ACTION,
  SLOPE_TD_COMPACT,
  SLOPE_TD_ERROR_TYPE,
  SLOPE_TD_SEVERITY,
  SLOPE_TD_SLOPE_DELTA,
  SLOPE_TD_STOCK_ACTUAL,
  SLOPE_TD_STOCK_EXPECTED,
  SLOPE_TD_TICKER,
  SLOPE_TD_TRAJECTORY,
} from "./SlopeTableUi";
import { TickerWithCdLifecycle } from "./CdLifecycleBadge";
import { useLang } from "../shared/i18n";
import { daysFromToday } from "../sheet/simulationPlanGain";

export function SlopeCompanyOverviewTable({
  companies,
  simTable,
  chartsBundle,
  onOpenCompany,
}: {
  companies: RankedCompanySlope[];
  simTable?: SheetTable | null;
  chartsBundle?: ChartBundle | null;
  onOpenCompany: (ticker: string) => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  if (!companies.length) {
    return (
      <p className="text-xs text-ink-muted py-4 text-center">
        {it
          ? "Nessuna società sopra la soglia di gravità selezionata."
          : "No companies above the selected severity threshold."}
      </p>
    );
  }

  return (
    <div className={SLOPE_TABLE_WRAP_OVERVIEW}>
      <table className={SLOPE_TABLE_OVERVIEW_CLASS}>
        <SlopeOverviewColGroup showStockColumns />
        <thead>
          <SlopeTableHeadRow variant="overview" showStockColumns />
        </thead>
        <tbody>
          {companies.map((co) => {
            const latest = co.displayRow;
            const summary = latest ? summarizeSlopeFeedRow(latest, lang) : null;
            const cfg = summary?.kindMeta;
            const chartCtx = resolveSlopeChartContext(
              co.ticker,
              latest?.cd ?? "",
              simTable ?? null,
              chartsBundle ?? null,
            );
            const { simRow, chartPts, logStaleNoSimRow } = chartCtx;
            const liveCurve = simRow ? extractCurveInputs(simRow) : null;
            const stock = resolveSlopeStockPrices(simRow, chartPts, latest, {
              simRowStale: logStaleNoSimRow,
              eventCd: latest?.cd,
            });
            const { actual, expected } = stock;
            const revHint =
              latest?.kind === "slope_rev" && summary
                ? slopeSignTransition(summary.slope5d, summary.slope20d, lang, "words")
                : latest
                  ? slopeAccelPriceHint(lang, latest.kind, stock)
                  : null;

            return (
              <tr
                key={co.ticker}
                className={SLOPE_OVERVIEW_ROW}
                onClick={() => onOpenCompany(co.ticker)}
              >
                <td className={SLOPE_TD_TRAJECTORY}>
                  {latest?.source === "contrarian" ? (
                    <ContrarianMiniDiagram
                      slope5d={latest.contrarianEvent.slope5d}
                      pred5={latest.contrarianEvent.pred5}
                      slope20d={liveCurve?.slope20d ?? null}
                      divergenceType={latest.contrarianEvent.divergence_type}
                      title={summary?.diagramTitle}
                    />
                  ) : summary && summary.slope5d != null && summary.slope20d != null ? (
                    <SlopeTrendDiagram
                      variant="mini"
                      slope5d={summary.slope5d}
                      slope20d={summary.slope20d}
                      errorKind={latest?.kind}
                      title={summary.diagramTitle}
                    />
                  ) : (
                    <span className="text-ink-muted/35">—</span>
                  )}
                </td>

                <td className={SLOPE_TD_TICKER}>
                  <button
                    type="button"
                    className="font-bold text-[rgb(var(--panel-feed-accent-strong))] hover:underline tracking-wide text-[11px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCompany(co.ticker);
                    }}
                  >
                    <TickerWithCdLifecycle
                      ticker={co.ticker}
                      cd={latest?.cd}
                      days={latest?.cd ? daysFromToday(latest.cd) : null}
                    />
                  </button>
                </td>

                <td className={SLOPE_TD_ERROR_TYPE}>
                  {cfg && summary ? (
                    <SlopeErrorKindBadge
                      meta={cfg}
                      label={it ? cfg.labelIt : cfg.labelEn}
                      hint={revHint}
                    />
                  ) : (
                    "—"
                  )}
                </td>

                <td className={SLOPE_TD_SLOPE_DELTA}>
                  {summary ? (
                    <SlopeChangeCell summary={summary} />
                  ) : (
                    "—"
                  )}
                </td>

                <td
                  className={`${SLOPE_TD_STOCK_EXPECTED} ${summary?.shiftCls ?? "text-ink-muted"}`}
                  title={slopeStockExpectedTitle(stock, lang)}
                >
                  {fmtStockUsd(expected)}
                </td>

                <td
                  className={SLOPE_TD_STOCK_ACTUAL}
                  title={slopeStockActualTitle(stock, lang)}
                >
                  {fmtStockUsd(actual)}
                </td>

                <td className={SLOPE_TD_SEVERITY}>
                  {summary ? (
                    <SlopeSeverityBadge severity={summary.severity} lang={lang} />
                  ) : (
                    "—"
                  )}
                </td>

                <td className={SLOPE_TD_COMPACT}>
                  <SlopeCountChip count={co.eventCount} />
                </td>

                <td className={SLOPE_TD_COMPACT}>
                  <SlopeCountChip
                    count={co.activeChartCount}
                    active={co.activeChartCount > 0}
                    title={it ? "Grafici pendenza attivi" : "Active slope charts"}
                  />
                </td>

                <td className={SLOPE_TD_ACTION}>
                  <button
                    type="button"
                    className="text-[10px] font-semibold text-[rgb(var(--panel-feed-accent-strong))]/70 hover:text-[rgb(var(--panel-feed-accent-strong))] transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCompany(co.ticker);
                    }}
                    aria-label={it ? "Apri dettaglio" : "Open detail"}
                  >
                    →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
