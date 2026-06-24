import { Handle, Position, type NodeProps } from "@xyflow/react";
import { tickerCardLines, type FinancialTickerNodeData } from "../buildFinancialGraph";

function changeClass(pct: number | null): string {
  if (pct === null) return "text-ink-muted";
  if (pct > 0) return "text-positive";
  if (pct < 0) return "text-negative";
  return "text-ink-muted";
}

export function FinancialTickerNode({ data, selected }: NodeProps) {
  const d = data as FinancialTickerNodeData;
  const row = d.row;
  const { primary, lines } = tickerCardLines(row);
  const daily = row.dailyChangePct;

  return (
    <div
      className={`rounded-lg border bg-surface-elevated shadow-sm px-3 py-2 min-w-[11rem] max-w-[12.5rem] text-xs ${
        selected
          ? "border-accent ring-2 ring-accent/30"
          : "border-[rgb(var(--border))]"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2 !border-0" />
      <div className="font-semibold text-sm tracking-wide text-ink">{primary}</div>
      {lines.map((line, i) => (
        <div
          key={i}
          className={`truncate leading-snug mt-0.5 ${
            i === 0 ? "text-ink-muted" : i === 3 && daily != null ? changeClass(daily) : "text-ink"
          }`}
          title={line}
        >
          {line}
        </div>
      ))}
      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2 !border-0" />
    </div>
  );
}
