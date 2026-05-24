import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FinancialGroupNodeData } from "../buildFinancialGraph";

export function FinancialGroupNode({ data, selected }: NodeProps) {
  const d = data as FinancialGroupNodeData;
  const isSector = d.kind === "sector";

  return (
    <div
      className={`rounded-xl border-2 px-4 py-3 min-w-[9rem] text-center shadow-md ${
        selected ? "ring-2 ring-accent/40" : ""
      } ${
        isSector
          ? "border-accent/60 bg-accent/10"
          : "border-positive/50 bg-positive/10"
      }`}
    >
      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2.5 !h-2.5 !border-0" />
      <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium">
        {isSector ? "Settore" : "Fascia cap."}
      </div>
      <div className="font-semibold text-sm text-ink mt-0.5 leading-tight">{d.label}</div>
      <div className="text-xs text-ink-muted mt-1">{d.count} titoli</div>
    </div>
  );
}
