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
          Nessun ticker da mostrare — controlla i filtri o usa Vista tabella.
        </p>
      )}
      {nodeCount > 0 && (
        <p className="absolute top-2 left-2 z-20 text-[10px] text-ink-muted bg-surface-elevated/95 border border-[rgb(var(--border))] rounded px-2 py-1 pointer-events-none">
          {nodeCount} nodi · {graph.edges.length} collegamenti
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
          Mostrati i primi 120 ticker su {graph.totalTickers}. Restringi il filtro per vedere
          l&apos;intero universo nel canvas.
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

  const rowCount = table?.row_count ?? table?.rows.length ?? 0;
  const activeMeta = FINANCIAL_NODE_TEMPLATES.find((t) => t.id === template);

  return (
    <section className="card flex flex-col min-h-0 flex-1 overflow-hidden relative">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">Financial · nodi</h2>
          <p className="text-xs text-ink-muted">
            {loading ? "Caricamento…" : `${rowCount} righe dal foglio Excel`}
          </p>
        </div>
        <input
          className="input max-w-[8rem]"
          placeholder="Ticker…"
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          aria-label="Filtra ticker"
        />
        <input
          className="input max-w-[10rem]"
          placeholder="Settore…"
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          aria-label="Filtra settore"
        />
        <div className="flex gap-2 ml-auto">
          {onOpenTable && (
            <button type="button" className="btn-ghost text-xs" onClick={onOpenTable}>
              Vista tabella
            </button>
          )}
          <button type="button" className="btn-ghost text-xs" onClick={onReload}>
            Ricarica
          </button>
        </div>
      </div>

      {error && <p className="px-4 py-2 text-sm text-negative">{error}</p>}

      <div className="px-4 py-3 border-b border-[rgb(var(--border))] bg-surface/50">
        <p className="text-xs font-medium text-ink-muted mb-2">Scegli formato layout</p>
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
            Attivo: <span className="text-ink font-medium">{activeMeta.label}</span> —{" "}
            {activeMeta.id === "sector-hub" &&
              "raggruppa per settore GICS; ogni card è un ticker (cap., prezzo, Δ%). "}
            {activeMeta.id === "ticker-grid" &&
              "griglia di card ticker; utile con pochi simboli filtrati. "}
            {activeMeta.id === "cap-tiers" &&
              "raggruppa per fascia di capitalizzazione. "}
            Trascina, zoom (rotella), mini-mappa in basso a destra.
            {!loading && rowCount > 0 && (
              <span className="block mt-1 text-accent/90">
                Nel grafo: al massimo 120 ticker (filtra per ticker/settore se il canvas è vuoto
                dopo zoom).
              </span>
            )}
          </p>
        )}
      </div>

      {loading && !table?.rows?.length ? (
        <div className="p-6 text-sm text-ink-muted text-center space-y-2 max-w-lg mx-auto">
          <p className="font-medium text-ink">Lettura foglio Excel Financial…</p>
          <p className="text-xs leading-relaxed">
            La prima volta può richiedere 20–60 secondi (file grande). Chiudi Excel sul
            workbook se resta bloccato. Poi usa i filtri Ticker/Settore e scegli un layout
            sotto.
          </p>
        </div>
      ) : !loading && rowCount === 0 ? (
        <p className="p-6 text-sm text-ink-muted text-center">
          Nessun dato — esegui l&apos;orchestrator (salva il foglio Financial) e premi Ricarica.
          Prova anche <strong className="text-ink">Vista tabella</strong> in alto a destra.
        </p>
      ) : (
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-2">
          {!loading && normFinancialRows(table?.rows ?? []).length > 0 && (
            <p className="text-xs text-ink-muted shrink-0">
              Grafo: {normFinancialRows(table?.rows ?? []).length} ticker normalizzati
              {normFinancialRows(table?.rows ?? []).length > 120
                ? " (max 120 nodi nel canvas — restringi il filtro)"
                : ""}
              . Scorri/zoom se non vedi nulla.
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
