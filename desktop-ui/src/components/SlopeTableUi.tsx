import type { SlopeKindMeta, SlopeEventSummary } from "../sheet/slopeEventSummary";
import { severityBadgeCls, severityLabel } from "../sheet/slopeEventSummary";
import type { SlopeEventSeverity } from "../sheet/slopeEventSummary";
import { useT, type TranslationKey } from "../shared/i18n";

export type SlopeTableColId =
  | "trajectory"
  | "ticker"
  | "company"
  | "errorType"
  | "slopeDelta"
  | "expectedStock"
  | "actualStock"
  | "capitalLoss"
  | "severity"
  | "log"
  | "chart"
  | "detected";

/** Intestazione colonna con menu a scomparsa (definizione indice). */
export function SlopeColumnHeader({
  colId,
  align = "left",
}: {
  colId: SlopeTableColId;
  align?: "left" | "center" | "right";
}) {
  const t = useT();
  const labelKey =
    colId === "trajectory"
      ? ("signals.slope.col.trajectory.labelShort" as TranslationKey)
      : (`signals.slope.col.${colId}.label` as TranslationKey);
  const bodyKey = `signals.slope.col.${colId}.body` as TranslationKey;

  const panelPos =
    align === "center"
      ? "left-1/2 -translate-x-1/2"
      : align === "right"
        ? "right-0"
        : "left-0";

  return (
    <details className="relative inline-block max-w-full">
      <summary
        className={`cursor-pointer list-none select-none inline-flex items-center gap-0.5 max-w-full hover:text-[rgb(var(--panel-feed-accent-strong))] ${
          align === "center" ? "justify-center w-full" : ""
        } [&::-webkit-details-marker]:hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{t(labelKey)}</span>
        <span
          className="text-[7px] opacity-50 font-normal shrink-0 leading-none"
          aria-hidden
        >
          ▾
        </span>
      </summary>
      <div
        role="note"
        className={`absolute z-40 top-[calc(100%+3px)] ${panelPos} w-[min(17rem,calc(100vw-1.5rem))] rounded-lg border border-[rgb(var(--panel-feed-border))]/65 bg-[rgb(var(--surface-elevated))] px-2.5 py-2 text-[10px] normal-case tracking-normal font-normal text-ink/85 shadow-[0_4px_16px_rgb(99_102_241/0.12)] leading-snug`}
        onClick={(e) => e.stopPropagation()}
      >
        {t(bodyKey)}
      </div>
    </details>
  );
}

import {
  SHEET_GRID_TABLE_CLASS,
  SLOPE_OVERVIEW_GRID_COL_PCT,
  sheetGridTdClassAlign,
  sheetGridThClassAlign,
} from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

const TH_EXTRA = "py-1.5 font-medium";
const TD_EXTRA = "py-1.5";

export const SLOPE_TH_TRAJECTORY = `${sheetGridThClassAlign("center")} ${TH_EXTRA}`;
export const SLOPE_TH_TICKER = `${sheetGridThClassAlign("left")} ${TH_EXTRA}`;
export const SLOPE_TH_COMPANY = `${sheetGridThClassAlign("left")} ${TH_EXTRA}`;
export const SLOPE_TH_ERROR_TYPE = `${sheetGridThClassAlign("left")} ${TH_EXTRA}`;
export const SLOPE_TH_SLOPE_DELTA = `${sheetGridThClassAlign("left")} ${TH_EXTRA}`;
export const SLOPE_TH_STOCK = `${sheetGridThClassAlign("center")} ${TH_EXTRA}`;
export const SLOPE_TH_SEVERITY = `${sheetGridThClassAlign("center")} ${TH_EXTRA}`;
export const SLOPE_TH_COMPACT = `${sheetGridThClassAlign("center")} ${TH_EXTRA}`;
export const SLOPE_TH_ACTION = `${sheetGridThClassAlign("center")} ${TH_EXTRA}`;

export const SLOPE_TD_TRAJECTORY = `${sheetGridTdClassAlign("center")} ${TD_EXTRA}`;
export const SLOPE_TD_TICKER = `${sheetGridTdClassAlign("left")} ${TD_EXTRA} whitespace-nowrap`;
export const SLOPE_TD_COMPANY = `${sheetGridTdClassAlign("left")} ${TD_EXTRA} max-w-[10rem]`;
/** Tipo errore — spazio a destra prima di Δ pendenza. */
export const SLOPE_TD_ERROR_TYPE = `${sheetGridTdClassAlign("left")} ${TD_EXTRA} align-top`;
export const SLOPE_TD_SLOPE_DELTA = `${sheetGridTdClassAlign("left")} ${TD_EXTRA} align-top max-w-0`;
export const SLOPE_TD_STOCK = `${sheetGridTdClassAlign("right")} ${TD_EXTRA} tabular-nums`;
export const SLOPE_TD_STOCK_EXPECTED = `${SLOPE_TD_STOCK} font-semibold`;
export const SLOPE_TD_STOCK_ACTUAL = `${SLOPE_TD_STOCK} font-semibold text-ink`;
export const SLOPE_TD_SEVERITY = `${sheetGridTdClassAlign("center")} ${TD_EXTRA}`;
/** Log / Chart — contatori stretti e adiacenti. */
export const SLOPE_TD_COMPACT = `${sheetGridTdClassAlign("center")} ${TD_EXTRA}`;
export const SLOPE_TD_ACTION = `${sheetGridTdClassAlign("center")} ${TD_EXTRA}`;

/** @deprecated use SLOPE_TD_COMPACT */
export const SLOPE_TD_COMPACT_CENTER = SLOPE_TD_COMPACT;

/** Intestazioni condivise tab overview + dettaglio eventi. */
export function SlopeTableHeadRow({
  variant,
  showTickerColumn = true,
  showCompanyColumn = false,
  showChartActionColumn = false,
  showStockColumns = false,
  showCapitalLossColumn = false,
}: {
  variant: "overview" | "events";
  showTickerColumn?: boolean;
  showCompanyColumn?: boolean;
  showChartActionColumn?: boolean;
  /** Overview: colonne prezzo modello vs reale. */
  showStockColumns?: boolean;
  showCapitalLossColumn?: boolean;
}) {
  const identityFirst = variant === "events" && showTickerColumn;
  const tickerHeader = showTickerColumn ? (
    <th className={SLOPE_TH_TICKER}>
      <SlopeColumnHeader colId="ticker" />
    </th>
  ) : null;
  const companyHeader = showCompanyColumn ? (
    <th className={SLOPE_TH_COMPANY}>
      <SlopeColumnHeader colId="company" />
    </th>
  ) : null;

  return (
    <tr className={variant === "overview" ? SLOPE_TABLE_OVERVIEW_HEAD : SLOPE_TABLE_HEAD}>
      {identityFirst ? (
        <>
          {tickerHeader}
          {companyHeader}
        </>
      ) : null}
      <th className={SLOPE_TH_TRAJECTORY}>
        <SlopeColumnHeader colId="trajectory" align="center" />
      </th>
      {!identityFirst && showTickerColumn ? tickerHeader : null}
      {!identityFirst && showCompanyColumn ? companyHeader : null}
      <th className={SLOPE_TH_ERROR_TYPE}>
        <SlopeColumnHeader colId="errorType" />
      </th>
      <th className={SLOPE_TH_SLOPE_DELTA}>
        <SlopeColumnHeader colId="slopeDelta" />
      </th>
      {showStockColumns ? (
        <>
          <th className={SLOPE_TH_STOCK}>
            <SlopeColumnHeader colId="expectedStock" align="right" />
          </th>
          <th className={SLOPE_TH_STOCK}>
            <SlopeColumnHeader colId="actualStock" align="right" />
          </th>
        </>
      ) : null}
      {showCapitalLossColumn ? (
        <th className={SLOPE_TH_STOCK}>
          <SlopeColumnHeader colId="capitalLoss" align="right" />
        </th>
      ) : null}
      <th className={SLOPE_TH_SEVERITY}>
        <SlopeColumnHeader colId="severity" align="center" />
      </th>
      {variant === "events" ? (
        <th className={`${SLOPE_TH_COMPACT} min-w-[4.5rem] text-left`}>
          <SlopeColumnHeader colId="detected" />
        </th>
      ) : (
        <th className={SLOPE_TH_COMPACT}>
          <SlopeColumnHeader colId="log" align="center" />
        </th>
      )}
      <th className={SLOPE_TH_COMPACT}>
        <SlopeColumnHeader colId="chart" align="center" />
      </th>
      {showChartActionColumn || variant === "overview" ? (
        <th className={SLOPE_TH_ACTION} aria-hidden />
      ) : null}
    </tr>
  );
}

type SlopeColWidth = number;

function slopeOverviewColWidths(
  showStockColumns: boolean,
  showCapitalLossColumn: boolean,
): SlopeColWidth[] {
  if (showStockColumns && !showCapitalLossColumn) {
    return [...SLOPE_OVERVIEW_GRID_COL_PCT];
  }
  const w: SlopeColWidth[] = [4, 8, 20, 20];
  if (showStockColumns) w.push(10, 10);
  if (showCapitalLossColumn) w.push(10);
  w.push(10, 6, 6, 6);
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum === 100) return w;
  const scale = 100 / sum;
  return w.map((x) => Math.round(x * scale * 10) / 10);
}

function slopeEventsColWidths(opts: {
  showTickerColumn?: boolean;
  showCompanyColumn?: boolean;
  showStockColumns?: boolean;
  showCapitalLossColumn?: boolean;
  showChartActionColumn?: boolean;
}): SlopeColWidth[] {
  const parts: SlopeColWidth[] = [];
  if (opts.showTickerColumn) {
    parts.push(7);
    if (opts.showCompanyColumn) parts.push(14);
  }
  parts.push(4, 16, 16);
  if (opts.showStockColumns) parts.push(10, 10);
  if (opts.showCapitalLossColumn) parts.push(8);
  parts.push(10, 10, 6);
  if (opts.showChartActionColumn) parts.push(6);
  const sum = parts.reduce((a, b) => a + b, 0);
  return parts.map((x) => Math.round((x * 1000) / sum) / 10);
}

export function slopeTableColumnCount(opts: {
  showTickerColumn?: boolean;
  showCompanyColumn?: boolean;
  showStockColumns?: boolean;
  showCapitalLossColumn?: boolean;
  showChartActionColumn?: boolean;
  variant: "overview" | "events";
}): number {
  let n = 4;
  if (opts.showTickerColumn) n += 1;
  if (opts.showCompanyColumn) n += 1;
  if (opts.showStockColumns) n += 2;
  if (opts.showCapitalLossColumn) n += 1;
  n += 2;
  if (opts.variant === "overview" || opts.showChartActionColumn) n += 1;
  return n;
}

function SlopeColGroup({ widths }: { widths: SlopeColWidth[] }) {
  return <SheetGridColgroup widths={widths} />;
}

export function SlopeFeedColGroup(opts: {
  variant: "overview" | "events";
  showTickerColumn?: boolean;
  showCompanyColumn?: boolean;
  showStockColumns?: boolean;
  showCapitalLossColumn?: boolean;
  showChartActionColumn?: boolean;
}) {
  const widths =
    opts.variant === "overview"
      ? slopeOverviewColWidths(
          opts.showStockColumns !== false,
          opts.showCapitalLossColumn === true,
        )
      : slopeEventsColWidths(opts);
  return <SlopeColGroup widths={widths} />;
}

/** Overview società — 10 colonne dati + azione (→). */
export function SlopeOverviewColGroup({
  showStockColumns = true,
  showCapitalLossColumn = false,
}: {
  showStockColumns?: boolean;
  showCapitalLossColumn?: boolean;
}) {
  return (
    <SlopeColGroup widths={slopeOverviewColWidths(showStockColumns, showCapitalLossColumn)} />
  );
}

export function SlopeErrorKindBadge({
  meta,
  label,
  hint,
}: {
  meta: SlopeKindMeta;
  label: string;
  hint?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span
        className={`inline-flex items-center gap-1.5 w-fit max-w-full text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.pillCls}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotCls}`} />
        {label}
      </span>
      {hint ? (
        <span className="text-[10px] text-ink-muted/80 pl-0.5 truncate">{hint}</span>
      ) : null}
    </div>
  );
}

export function SlopeChangeCell({ summary }: { summary: SlopeEventSummary }) {
  return (
    <span
      className={`block font-semibold tabular-nums truncate max-w-full ${summary.shiftCls}`}
      title={[summary.shiftLine, summary.subLine].filter(Boolean).join(" · ")}
    >
      {summary.shiftLine}
    </span>
  );
}

export function SlopeSeverityBadge({
  severity,
  lang,
}: {
  severity: SlopeEventSeverity;
  lang: "it" | "en";
}) {
  return (
    <span
      className={`inline-block text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${severityBadgeCls(severity)}`}
    >
      {severityLabel(severity, lang)}
    </span>
  );
}

export function SlopeCountChip({
  count,
  active,
  title,
}: {
  count: number;
  active?: boolean;
  title?: string;
}) {
  if (!count) {
    return (
      <span
        className="text-[10px] text-[rgb(var(--panel-feed-accent-strong))]/35 tabular-nums"
        title={title}
      >
        0
      </span>
    );
  }
  return (
    <span
      className={`inline-flex min-w-[1.35rem] h-[1.35rem] items-center justify-center text-[10px] font-bold tabular-nums rounded-full ${
        active
          ? "bg-[rgb(var(--warn))]/14 text-[rgb(var(--warn))]"
          : "bg-[rgb(var(--panel-feed-accent))]/22 text-[rgb(var(--panel-feed-accent-strong))]"
      }`}
      title={title}
    >
      {count}
    </span>
  );
}

export const SLOPE_TABLE_CLASS = `${SHEET_GRID_TABLE_CLASS} text-[11px] table-zebra-violet`;

export const SLOPE_TABLE_OVERVIEW_CLASS = `${SHEET_GRID_TABLE_CLASS} text-[11px] table-zebra-violet`;

export const SLOPE_TABLE_HEAD =
  "sticky top-0 z-10 bg-[rgb(var(--panel-feed-header-bg))] text-[10px] uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]/85 border-b border-[rgb(var(--panel-feed-border))]/40";

/** Stesso violetto feed — non emerald. */
export const SLOPE_TABLE_OVERVIEW_HEAD = SLOPE_TABLE_HEAD;

export const SLOPE_TABLE_WRAP =
  "overflow-x-auto rounded-xl border border-[rgb(var(--panel-feed-border))]/55 bg-[rgb(var(--clinical-panel))]/60 shadow-[0_1px_6px_rgb(99_102_241/0.06)]";

/** Overview società — finestra violetta, bordo verdino esterno (verde solo sul bordo). */
export const SLOPE_TABLE_WRAP_OVERVIEW =
  "slope-overview-table-wrap overflow-x-auto rounded-xl border-2 border-[rgb(var(--panel-mint-border))]/75 bg-[rgb(var(--panel-feed-bg))] shadow-[0_1px_6px_rgb(99_102_241/0.08)]";

export const SLOPE_OVERVIEW_ROW =
  "border-t border-[rgb(var(--panel-feed-border))]/35 hover:bg-[rgb(var(--panel-feed-row-hover))]/65 cursor-pointer align-middle transition-colors";
