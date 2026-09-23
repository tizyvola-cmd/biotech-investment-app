import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import { buildFinancialGraph } from "../finance/buildFinancialGraph";
import { normFinancialRows } from "../finance/financialRow";
import { FinancialGroupNode } from "../finance/nodes/FinancialGroupNode";
import { FinancialTickerNode } from "../finance/nodes/FinancialTickerNode";
import { NewBioIpoModal } from "./NewBioIpoModal";
import { fetchNewBioIpoStatus } from "../api/supernova";
import {
  DEFAULT_FINANCIAL_TEMPLATE,
  FINANCIAL_NODE_TEMPLATES,
  type FinancialNodeTemplateId,
} from "../finance/templates";

const nodeTypes: NodeTypes = {
  financialTicker: FinancialTickerNode,
  financialGroup: FinancialGroupNode,
};

function FitViewOnTemplate({
  template,
  nodeCount,
}: {
  template: FinancialNodeTemplateId;
  nodeCount: number;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodeCount === 0) return;
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.12, duration: 280 });
    }, 120);
    return () => window.clearTimeout(t);
  }, [template, nodeCount, fitView]);
  return null;
}

function FinancialNodesCanvas({
  table,
  template,
  symbolFilter,
  sectorFilter,
}: {
  table: SheetTable | null;
  template: FinancialNodeTemplateId;
  symbolFilter: string;
  sectorFilter: string;
}) {
  const rows = useMemo(() => {
    const all = normFinancialRows(table?.rows ?? []);
    const symQ = symbolFilter.trim().toUpperCase();
    const secQ = sectorFilter.trim().toLowerCase();
    return all.filter((r) => {
      if (symQ && !r.symbol.includes(symQ)) return false;
      if (secQ && !r.sector.toLowerCase().includes(secQ)) return false;
      return true;
    });
  }, [table, symbolFilter, sectorFilter]);

  const graph = useMemo(
    () => buildFinancialGraph(template, rows),
    [template, rows]
  );

  const nodeCount = graph.nodes.length;

  return (
    <div
      className="financial-flow-shell w-full min-h-[22rem] rounded-lg border border-[rgb(var(--border))] overflow-hidden bg-[rgb(var(--surface-elevated))] relative"
      style={{ height: "min(62vh, 560px)" }}
    >
      {nodeCount === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted p-6 text-center z-10">
          No ticker to display — check the filters or use Table view.
        </p>
      )}
      {nodeCount > 0 && (
        <p className="absolute top-2 left-2 z-20 text-[10px] text-ink-muted bg-surface-elevated/95 border border-[rgb(var(--border))] rounded px-2 py-1 pointer-events-none">
          {nodeCount} nodes · {graph.edges.length} edges
        </p>
      )}
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, includeHiddenNodes: false }}
        minZoom={0.08}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        className="financial-flow-canvas"
        style={{ width: "100%", height: "100%" }}
      >
        <Background gap={20} size={1} color="rgb(var(--border))" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) =>
            n.type === "financialGroup" ? "rgb(var(--accent))" : "rgb(var(--ink-muted))"
          }
          maskColor="rgb(var(--surface) / 0.85)"
          className="!bg-surface-elevated !border-[rgb(var(--border))]"
        />
        <FitViewOnTemplate template={template} nodeCount={nodeCount} />
      </ReactFlow>
      {graph.capped && (
        <p className="absolute bottom-3 left-3 right-3 text-xs text-ink-muted bg-surface-elevated/90 border border-[rgb(var(--border))] rounded-md px-3 py-2 pointer-events-none">
          Showing the first 120 tickers out of {graph.totalTickers}. Narrow the filter to see
          the entire universe in the canvas.
        </p>
      )}
    </div>
  );
}

export function FinancialNodesView({
  table,
  loading,
  error,
  onReload,
  onOpenTable,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onOpenTable?: () => void;
}) {
  const [template, setTemplate] = useState<FinancialNodeTemplateId>(DEFAULT_FINANCIAL_TEMPLATE);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [ipoModalOpen, setIpoModalOpen] = useState(false);
  const [ipoLastWindow, setIpoLastWindow] = useState<string | null>(null);
  const [ipoLastAdded, setIpoLastAdded] = useState<number | null>(null);
  const [ipoRunning, setIpoRunning] = useState(false);

  // Hydrate the IPO last-run summary (so the user sees the "last scan" hint
  // even before opening the modal) and detect background runs triggered by
  // the monthly scheduler.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await fetchNewBioIpoStatus();
        if (cancelled) return;
        setIpoRunning(Boolean(st.running));
        if (st.summary) {
          setIpoLastWindow(st.summary.window_to ?? null);
          setIpoLastAdded(st.summary.added_count ?? null);
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const rowCount = table?.row_count ?? table?.rows.length ?? 0;
  const activeMeta = FINANCIAL_NODE_TEMPLATES.find((t) => t.id === template);

  return (
    <section className="card flex flex-col min-h-0 flex-1 overflow-hidden relative">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">Financial · nodes</h2>
          <p className="text-xs text-ink-muted">
            {loading ? "Loading…" : `${rowCount} rows from the Excel sheet`}
          </p>
        </div>
        <input
          className="input max-w-[8rem]"
          placeholder="Ticker…"
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          aria-label="Filter by ticker"
        />
        <input
          className="input max-w-[10rem]"
          placeholder="Sector…"
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          aria-label="Filter by sector"
        />
        <div className="flex gap-2 ml-auto items-center">
          <div className="flex flex-col items-end leading-tight">
            <button
              type="button"
              className="btn-ghost text-xs flex items-center gap-1.5"
              onClick={() => setIpoModalOpen(true)}
              title={
                "Scan Finnhub IPO calendar from the first day of the previous month " +
                "and add new biotech tickers to the local universe. " +
                "Runs automatically on the first of each month."
              }
            >
              {ipoRunning && (
                <span className="inline-block animate-spin" aria-hidden>
                  ⏳
                </span>
              )}
              <span aria-hidden>🧬</span>
              New Bio IPO
              {ipoRunning && (
                <span className="text-[9px] uppercase tracking-wider text-accent">
                  running
                </span>
              )}
            </button>
            {ipoLastWindow && (
              <span className="text-[9px] text-ink-muted/70">
                last scan {ipoLastWindow}
                {ipoLastAdded != null ? ` · +${ipoLastAdded} new` : ""}
              </span>
            )}
          </div>
          {onOpenTable && (
            <button type="button" className="btn-ghost text-xs" onClick={onOpenTable}>
              Table view
            </button>
          )}
          <button type="button" className="btn-ghost text-xs" onClick={onReload}>
            Reload
          </button>
        </div>
      </div>
      <NewBioIpoModal
        open={ipoModalOpen}
        onClose={() => setIpoModalOpen(false)}
        onCompleted={(summary) => {
          setIpoLastWindow(summary.window_to ?? null);
          setIpoLastAdded(summary.added_count ?? null);
          // After a successful run, reload the Financial table so new tickers
          // appear (yf.json was already merged server-side).
          onReload();
        }}
      />

      {error && <p className="px-4 py-2 text-sm text-negative">{error}</p>}

      <div className="px-4 py-3 border-b border-[rgb(var(--border))] bg-surface/50">
        <p className="text-xs font-medium text-ink-muted mb-2">Choose layout format</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {FINANCIAL_NODE_TEMPLATES.map((t) => {
            const active = template === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                className={`text-left rounded-lg border px-3 py-2.5 transition ${
                  active
                    ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                    : "border-[rgb(var(--border))] hover:border-accent/40 bg-surface-elevated"
                }`}
              >
                <div className="font-semibold text-sm text-ink">{t.label}</div>
                <div className="text-[11px] text-accent font-medium">{t.tagline}</div>
                <p className="text-[11px] text-ink-muted mt-1 leading-snug">{t.description}</p>
                <p className="text-[10px] text-ink-muted mt-1 opacity-80">{t.idealCount}</p>
              </button>
            );
          })}
        </div>
        {activeMeta && (
          <p className="text-xs text-ink-muted mt-2">
            Active: <span className="text-ink font-medium">{activeMeta.label}</span> —{" "}
            {activeMeta.id === "sector-hub" &&
              "groups by GICS sector; each card is a ticker (cap, price, Δ%). "}
            {activeMeta.id === "ticker-grid" &&
              "ticker card grid; useful with few filtered symbols. "}
            {activeMeta.id === "cap-tiers" &&
              "groups by market-cap tier. "}
            Drag, zoom (wheel), mini-map in the bottom-right.
            {!loading && rowCount > 0 && (
              <span className="block mt-1 text-accent/90">
                In the graph: max 120 tickers (filter by ticker/sector if the canvas is empty
                after zoom).
              </span>
            )}
          </p>
        )}
      </div>

      {loading && !table?.rows?.length ? (
        <div className="p-6 text-sm text-ink-muted text-center space-y-2 max-w-lg mx-auto">
          <p className="font-medium text-ink">Reading the Financial Excel sheet…</p>
          <p className="text-xs leading-relaxed">
            The first read can take 20–60 seconds (large file). Close Excel on the
            workbook if it gets stuck. Then use the Ticker/Sector filters and pick a layout
            below.
          </p>
        </div>
      ) : !loading && rowCount === 0 ? (
        <p className="p-6 text-sm text-ink-muted text-center">
          No data — run the orchestrator (save the Financial sheet) and press Reload.
          Also try <strong className="text-ink">Table view</strong> at the top-right.
        </p>
      ) : (
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-2">
          {!loading && normFinancialRows(table?.rows ?? []).length > 0 && (
            <p className="text-xs text-ink-muted shrink-0">
              Graph: {normFinancialRows(table?.rows ?? []).length} normalized tickers
              {normFinancialRows(table?.rows ?? []).length > 120
                ? " (max 120 nodes in canvas — narrow the filter)"
                : ""}
              . Scroll/zoom if you see nothing.
            </p>
          )}
          <ReactFlowProvider>
            <FinancialNodesCanvas
              table={table}
              template={template}
              symbolFilter={symbolFilter}
              sectorFilter={sectorFilter}
            />
          </ReactFlowProvider>
        </div>
      )}
    </section>
  );
}
