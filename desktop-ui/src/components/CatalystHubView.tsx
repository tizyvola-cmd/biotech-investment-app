import { useEffect, useState } from "react";
import type { CatalystRow, SheetTable } from "../types";
import {
  catalystSignalMeta,
  daysUntilCompletion,
  fmtPctSigned,
  upcomingCatalystStrip,
} from "./catalystUiHelpers";
import { Dashboard } from "./Dashboard";
import { SimulationAnalysisView } from "./SimulationAnalysisView";
import { SimulationSheetGrid } from "./SimulationSheetGrid";
import { TickerDetail } from "./TickerDetail";

export type CatalystHubPanel = "charts" | "table" | "catalysts";

function CatalystStrip({ rows }: { rows: CatalystRow[] }) {
  const upcoming = upcomingCatalystStrip(rows, 5);
  if (upcoming.length === 0) return null;

  return (
    <div className="shrink-0 flex items-center gap-2.5 px-1 py-3 border-b border-[rgb(var(--border))]/40 overflow-x-auto bg-[rgb(var(--bg-deep))]/60">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted/60 whitespace-nowrap pl-1">
        Prossimi
      </span>
      {upcoming.map((r) => {
        const signal = catalystSignalMeta(r);
        const days = daysUntilCompletion(r.completionDate);
        const urgent = days != null && days <= 7;
        const d7 = r.modelD7Pct;
        const d7Class =
          d7 == null ? "text-ink-muted" : d7 >= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]";
        return (
          <div
            key={r.id}
            className={`shrink-0 min-w-[130px] rounded-[10px] border px-3 py-2 bg-[rgb(var(--surface))] cursor-default transition hover:border-accent/50 hover:bg-[rgb(var(--surface-3))]/40 ${
              urgent ? "border-[rgb(var(--warn))]" : "border-[rgb(var(--border))]/40"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-extrabold tracking-wide">{r.ticker}</span>
              <span className={signal.className}>{signal.label.replace("Strong ", "")}</span>
            </div>
            <p className={`text-[11px] mt-0.5 ${urgent ? "text-[rgb(var(--warn))] font-semibold" : "text-ink-muted"}`}>
              {days == null ? "—" : urgent ? `⚡ in ${days} gg` : `in ${days} giorni`}
            </p>
            <p className="text-[11px] text-ink-muted mt-0.5">
              D+7 pred.{" "}
              <span className={`font-semibold ${d7Class}`}>{fmtPctSigned(d7)}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function CatalystHubView({
  simTable,
  simLoading,
  simError,
  onReloadSimulation,
  catalystRows,
  catalystFilter,
  onCatalystFilter,
  catalystSelectedId,
  onCatalystSelect,
  catalystLoading,
  catalystSource,
  catalystTotal,
  onCatalystLoadMore,
  hasMoreCatalysts,
  chartsFocusSeriesKey,
  chartsFocusTicker,
  onChartsFocusConsumed,
  focusPanel,
  onFocusPanelConsumed,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  simError: string | null;
  onReloadSimulation: () => void;
  catalystRows: CatalystRow[];
  catalystFilter: string;
  onCatalystFilter: (v: string) => void;
  catalystSelectedId: string | null;
  onCatalystSelect: (row: CatalystRow) => void;
  catalystLoading: boolean;
  catalystSource: string;
  catalystTotal: number;
  onCatalystLoadMore: () => void;
  hasMoreCatalysts: boolean;
  /** Da Simulation: seleziona questa serie su Grafici. */
  chartsFocusSeriesKey?: string | null;
  chartsFocusTicker?: string | null;
  onChartsFocusConsumed?: () => void;
  /** Da Simulation investimento: apri tab Tabella Simulation. */
  focusPanel?: CatalystHubPanel | null;
  onFocusPanelConsumed?: () => void;
}) {
  const [panel, setPanel] = useState<CatalystHubPanel>("charts");
  const [catalystDetail, setCatalystDetail] = useState<CatalystRow | null>(null);

  useEffect(() => {
    if (chartsFocusSeriesKey || chartsFocusTicker) setPanel("charts");
  }, [chartsFocusSeriesKey, chartsFocusTicker]);

  useEffect(() => {
    if (!focusPanel) return;
    setPanel(focusPanel);
    onFocusPanelConsumed?.();
  }, [focusPanel, onFocusPanelConsumed]);

  if (catalystDetail) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <TickerDetail row={catalystDetail} onBack={() => setCatalystDetail(null)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-0">
      <CatalystStrip rows={catalystRows} />
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--border))]/60 pb-2 shrink-0">
        <div className="flex gap-1 p-0.5 rounded-lg bg-[rgb(var(--surface))] border border-[rgb(var(--border))]/60">
          {(
            [
              ["charts", "Grafici"],
              ["table", "Tabella Simulation"],
              ["catalysts", "Lista Catalyst"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs transition ${
                panel === id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setPanel(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col pt-3">
        {panel === "charts" && (
          <SimulationAnalysisView
            simTable={simTable}
            simLoading={simLoading}
            focusSeriesKey={chartsFocusSeriesKey}
            focusTicker={chartsFocusTicker}
            onFocusConsumed={onChartsFocusConsumed}
          />
        )}
        {panel === "table" && (
          <SimulationSheetGrid
            table={simTable}
            loading={simLoading}
            error={simError}
            onReload={onReloadSimulation}
          />
        )}
        {panel === "catalysts" && (
          <>
            <Dashboard
              rows={catalystRows}
              filter={catalystFilter}
              onFilter={onCatalystFilter}
              selectedId={catalystSelectedId}
              onSelect={(r) => {
                setCatalystDetail(r);
                onCatalystSelect(r);
              }}
              loading={catalystLoading}
              source={catalystSource}
              total={catalystTotal}
            />
            {hasMoreCatalysts && (
              <button
                type="button"
                className="btn-ghost self-center mt-2"
                onClick={onCatalystLoadMore}
              >
                Mostra altre ({catalystTotal - catalystRows.length} rimanenti)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
