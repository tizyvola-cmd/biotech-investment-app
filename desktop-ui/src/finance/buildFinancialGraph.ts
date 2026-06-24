import type { Edge, Node } from "@xyflow/react";
import {
  CAP_TIER_LABELS,
  type CapTierId,
  capTierFromMarketCap,
  type FinancialRowNorm,
  formatMarketCap,
  formatPct,
} from "./financialRow";
import type { FinancialNodeTemplateId } from "./templates";

export type FinancialNodeKind = "ticker" | "sector" | "cap-tier";

export type FinancialTickerNodeData = {
  kind: "ticker";
  row: FinancialRowNorm;
};

export type FinancialGroupNodeData = {
  kind: "sector" | "cap-tier";
  label: string;
  count: number;
  tierId?: CapTierId;
};

export type FinancialFlowNodeData = FinancialTickerNodeData | FinancialGroupNodeData;

const CARD_W = 200;
const CARD_H = 108;
const GAP_X = 28;
const GAP_Y = 24;
const HUB_GAP_X = 48;
const CHILD_DY = 130;
/** Colonne sotto ogni hub — evita torri verticali (es. 100+ ticker Healthcare). */
const HUB_CHILD_COLS = 5;

const MAX_TICKERS = 120;

export type BuildGraphResult = {
  nodes: Node<FinancialFlowNodeData>[];
  edges: Edge[];
  capped: boolean;
  totalTickers: number;
};

function takeRows(rows: FinancialRowNorm[]): { rows: FinancialRowNorm[]; capped: boolean } {
  if (rows.length <= MAX_TICKERS) return { rows, capped: false };
  return { rows: rows.slice(0, MAX_TICKERS), capped: true };
}

function tickerNode(id: string, row: FinancialRowNorm, x: number, y: number): Node<FinancialFlowNodeData> {
  return {
    id,
    type: "financialTicker",
    position: { x, y },
    data: { kind: "ticker", row },
  };
}

function groupNode(
  id: string,
  kind: "sector" | "cap-tier",
  label: string,
  count: number,
  x: number,
  y: number,
  tierId?: CapTierId
): Node<FinancialFlowNodeData> {
  return {
    id,
    type: "financialGroup",
    position: { x, y },
    data: { kind, label, count, tierId },
  };
}

function edge(source: string, target: string): Edge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: "smoothstep",
    animated: false,
  };
}

export function buildTickerGridGraph(allRows: FinancialRowNorm[]): BuildGraphResult {
  const { rows, capped } = takeRows(allRows);
  const cols = Math.max(1, Math.ceil(Math.sqrt(rows.length)));
  const nodes: Node<FinancialFlowNodeData>[] = rows.map((row, i) => {
    const col = i % cols;
    const rowIdx = Math.floor(i / cols);
    return tickerNode(`tk-${row.symbol}`, row, col * (CARD_W + GAP_X), rowIdx * (CARD_H + GAP_Y));
  });
  return { nodes, edges: [], capped, totalTickers: allRows.length };
}

export function buildSectorHubGraph(allRows: FinancialRowNorm[]): BuildGraphResult {
  const { rows, capped } = takeRows(allRows);
  const bySector = new Map<string, FinancialRowNorm[]>();
  for (const r of rows) {
    const list = bySector.get(r.sector) ?? [];
    list.push(r);
    bySector.set(r.sector, list);
  }
  const sectors = [...bySector.entries()].sort((a, b) => b[1].length - a[1].length);

  const nodes: Node<FinancialFlowNodeData>[] = [];
  const edges: Edge[] = [];
  let hubX = 0;

  for (const [sector, tickers] of sectors) {
    const hubId = `sec-${sector.replace(/\W+/g, "_")}`;
    nodes.push(groupNode(hubId, "sector", sector, tickers.length, hubX, 0));
    tickers.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    const cols = Math.min(HUB_CHILD_COLS, Math.max(1, Math.ceil(Math.sqrt(tickers.length))));
    tickers.forEach((row, i) => {
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      const tid = `tk-${row.symbol}`;
      nodes.push(
        tickerNode(
          tid,
          row,
          hubX + col * (CARD_W + GAP_X),
          CHILD_DY + rowIdx * (CARD_H + GAP_Y)
        )
      );
      edges.push(edge(hubId, tid));
    });
    const gridCols = Math.min(cols, tickers.length);
    hubX += gridCols * (CARD_W + GAP_X) + HUB_GAP_X;
  }

  return { nodes, edges, capped, totalTickers: allRows.length };
}

const TIER_ORDER: CapTierId[] = ["mega", "large", "mid", "small", "micro", "unknown"];

export function buildCapTiersGraph(allRows: FinancialRowNorm[]): BuildGraphResult {
  const { rows, capped } = takeRows(allRows);
  const byTier = new Map<CapTierId, FinancialRowNorm[]>();
  for (const id of TIER_ORDER) byTier.set(id, []);
  for (const r of rows) {
    const t = capTierFromMarketCap(r.marketCap);
    byTier.get(t)!.push(r);
  }

  const nodes: Node<FinancialFlowNodeData>[] = [];
  const edges: Edge[] = [];
  let hubX = 0;

  for (const tierId of TIER_ORDER) {
    const tickers = byTier.get(tierId) ?? [];
    if (tickers.length === 0) continue;
    const hubId = `tier-${tierId}`;
    const label = CAP_TIER_LABELS[tierId];
    nodes.push(groupNode(hubId, "cap-tier", label, tickers.length, hubX, 0, tierId));
    tickers.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    const cols = Math.min(HUB_CHILD_COLS, Math.max(1, Math.ceil(Math.sqrt(tickers.length))));
    tickers.forEach((row, i) => {
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      const tid = `tk-${row.symbol}`;
      nodes.push(
        tickerNode(
          tid,
          row,
          hubX + col * (CARD_W + GAP_X),
          CHILD_DY + rowIdx * (CARD_H + GAP_Y)
        )
      );
      edges.push(edge(hubId, tid));
    });
    const gridCols = Math.min(cols, tickers.length);
    hubX += gridCols * (CARD_W + GAP_X) + HUB_GAP_X;
  }

  return { nodes, edges, capped, totalTickers: allRows.length };
}

export function buildFinancialGraph(
  template: FinancialNodeTemplateId,
  rows: FinancialRowNorm[]
): BuildGraphResult {
  switch (template) {
    case "ticker-grid":
      return buildTickerGridGraph(rows);
    case "sector-hub":
      return buildSectorHubGraph(rows);
    case "cap-tiers":
      return buildCapTiersGraph(rows);
    default:
      return buildSectorHubGraph(rows);
  }
}

/** Testo secondario per card ticker (condiviso dai nodi). */
export function tickerCardLines(row: FinancialRowNorm): { primary: string; lines: string[] } {
  const lines: string[] = [];
  if (row.companyName) lines.push(row.companyName.slice(0, 36));
  lines.push(`Cap ${formatMarketCap(row.marketCap)}`);
  if (row.currentPrice != null) lines.push(`$${row.currentPrice.toFixed(2)}`);
  if (row.dailyChangePct != null) lines.push(`Δ giorno ${formatPct(row.dailyChangePct)}`);
  if (row.beta != null) lines.push(`β ${row.beta.toFixed(2)}`);
  if (row.liquidita) lines.push(row.liquidita);
  return { primary: row.symbol, lines };
}
