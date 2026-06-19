import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SheetTable } from "../types";
import { tickersFromSimulationTable } from "../sheet/simulationTickers";
import type { SheetCellRenderer } from "./ConfigurableSheetGrid";
import { SheetDataGrid } from "./SheetDataGrid";

function tickerOnRow(row: Record<string, unknown>): string {
  return String(row.ticker ?? row.Ticker ?? row.symbol ?? row.Symbol ?? "")
    .trim()
    .toUpperCase();
}

export function SimulationPortfolioSheetView({
  title,
  sourceHint,
  simTable,
  dataTable,
  loading,
  error,
  onReload,
  countLabel = "rows",
  layoutSheetId,
  renderCell,
  formatColumnHeader,
  initialSelectedTicker,
  onInitialSelectionConsumed,
  simCdByTicker,
  emptyTickerHint,
}: {
  title: string;
  sourceHint: ReactNode;
  simTable: SheetTable | null;
  dataTable: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  countLabel?: string;
  /** localStorage key for table layout (default: API sheet name). */
  layoutSheetId?: string;
  renderCell?: SheetCellRenderer;
  formatColumnHeader?: (column: string) => string;
  /** Pre-select ticker (e.g. from K-8 chart link). */
  initialSelectedTicker?: string | null;
  onInitialSelectionConsumed?: () => void;
  /** CD/NCT banner from Simulation sheet (Clinical tab). */
  simCdByTicker?: Record<
    string,
    {
      ticker: string;
      completionDateDisplay: string;
      nct: string | null;
      company: string;
      studyHref: string | null;
      daysToCd: number | null;
    }
  >;
  emptyTickerHint?: string;
}) {
  const tickers = useMemo(() => {
    if (simCdByTicker && Object.keys(simCdByTicker).length > 0) {
      return Object.keys(simCdByTicker).sort();
    }
    const fromData = dataTable?.tickers?.filter(Boolean) ?? [];
    if (fromData.length) return fromData;
    return tickersFromSimulationTable(simTable);
  }, [simCdByTicker, dataTable?.tickers, simTable]);

  const [selected, setSelected] = useState<string | "all">("all");

  useEffect(() => {
    if (!initialSelectedTicker) return;
    const tk = initialSelectedTicker.trim().toUpperCase();
    if (tk) setSelected(tk);
    onInitialSelectionConsumed?.();
  }, [initialSelectedTicker, onInitialSelectionConsumed]);

  const filteredTable = useMemo((): SheetTable | null => {
    if (!dataTable) return null;
    const rows =
      selected === "all"
        ? dataTable.rows
        : dataTable.rows.filter((r) => tickerOnRow(r) === selected);
    return {
      ...dataTable,
      rows,
      row_count: rows.length,
    };
  }, [dataTable, selected]);

  const countsByTicker = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of dataTable?.rows ?? []) {
      const t = tickerOnRow(r);
      if (!t) continue;
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [dataTable?.rows]);

  const simNameByTicker = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of simTable?.rows ?? []) {
      const t = String(r.Ticker ?? "").trim().toUpperCase();
      if (!t) continue;
      const name = String(r.Nome ?? r.Company ?? "").trim();
      if (name) m.set(t, name);
    }
    return m;
  }, [simTable?.rows]);

  const selectedCatalyst =
    selected !== "all" ? simCdByTicker?.[selected] : undefined;

  return (
    <div className="sim-harmonize flex flex-1 min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-[rgb(var(--border))] bg-surface px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="text-xs text-ink-muted mt-1">
          {simCdByTicker && Object.keys(simCdByTicker).length > 0
            ? `${Object.keys(simCdByTicker).length} Simulation catalysts (upcoming CD ≤60 d)`
            : `Only the ${tickers.length} companies in Simulation`}
          {" — "}
          {sourceHint}.{" "}
          {dataTable?.row_count != null && (
            <>
              {dataTable.row_count} total {countLabel}
              {selected !== "all" && filteredTable
                ? ` · ${filteredTable.row_count} for ${selected}`
                : ""}
              .
            </>
          )}
        </p>
        {dataTable?.simulation_error && (
          <p className="text-xs text-ink-muted mt-1">
            Simulation warning: {dataTable.simulation_error}
          </p>
        )}
      </div>

      {selectedCatalyst && (
        <ClinicalCatalystBanner entry={selectedCatalyst} />
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`rounded-md px-2.5 py-1 text-xs border transition ${
            selected === "all"
              ? "bg-accent text-white border-accent"
              : "border-[rgb(var(--border))] text-ink-muted hover:text-ink"
          }`}
          onClick={() => setSelected("all")}
        >
          All ({dataTable?.row_count ?? 0})
        </button>
        {tickers.map((tk) => {
          const n = countsByTicker.get(tk) ?? 0;
          const label = simNameByTicker.get(tk);
          return (
            <button
              key={tk}
              type="button"
              title={
                n === 0 && emptyTickerHint
                  ? `${label || tk}: ${emptyTickerHint}`
                  : label || tk
              }
              className={`rounded-md px-2.5 py-1 text-xs border transition ${
                selected === tk
                  ? "bg-accent text-white border-accent"
                  : n === 0
                    ? "border-[rgb(var(--border))]/60 text-ink-muted/50"
                    : "border-[rgb(var(--border))] text-ink-muted hover:text-ink"
              }`}
              onClick={() => setSelected(tk)}
            >
              {tk}
              {simCdByTicker ? (n > 0 ? " ✓" : " ·0") : n > 0 ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <SheetDataGrid
          table={filteredTable}
          loading={loading}
          error={error}
          onReload={onReload}
          sheetId={layoutSheetId ?? dataTable?.sheet}
          renderCell={renderCell}
          formatColumnHeader={formatColumnHeader}
        />
      </div>
    </div>
  );
}

function ClinicalCatalystBanner({
  entry,
}: {
  entry: NonNullable<
    Parameters<typeof SimulationPortfolioSheetView>[0]["simCdByTicker"]
  >[string];
}) {
  const href =
    entry.studyHref ??
    (entry.nct ? `https://clinicaltrials.gov/study/${entry.nct}` : null);
  const daysLabel =
    entry.daysToCd == null
      ? null
      : entry.daysToCd === 0
        ? "today"
        : entry.daysToCd > 0
          ? `in ${entry.daysToCd} d`
          : `${Math.abs(entry.daysToCd)} d ago`;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-accent font-semibold">
        Catalyst Simulation
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-ink">{entry.ticker}</span>
        {entry.company ? (
          <span className="text-xs text-ink-muted">{entry.company}</span>
        ) : null}
      </div>
      <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Completion Date (Simulation)</dt>
          <dd className="font-medium text-ink">
            {entry.completionDateDisplay}
            {daysLabel ? (
              <span className="ml-1.5 font-normal text-ink-muted">
                ({daysLabel})
              </span>
            ) : null}
          </dd>
        </div>
        {entry.nct ? (
          <div>
            <dt className="text-ink-muted">NCT</dt>
            <dd className="font-mono text-ink">{entry.nct}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2 flex flex-wrap gap-2 items-center">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Open study on ClinicalTrials.gov
            </a>
          ) : null}
        </div>
      </dl>
    </div>
  );
}
