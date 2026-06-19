import type { WeightedSizingGateStatus } from "../calibration/weightedSizingGate";
import {
  WEIGHTED_SIZING_MIN_TRADES,
  weightedSizingGateMessage,
  weightedSizingGateTitle,
} from "../calibration/weightedSizingGate";

export function WeightedSizingGateBanner({
  gate,
  lang,
  compact = false,
}: {
  gate: WeightedSizingGateStatus;
  lang: "it" | "en";
  compact?: boolean;
}) {
  if (gate.ok) return null;
  const it = lang === "it";
  return (
    <div
      className={`rounded-lg border border-amber-300/70 dark:border-amber-700/50 bg-amber-50/90 dark:bg-amber-950/30 ${
        compact ? "px-3 py-2" : "px-3 py-2.5"
      }`}
      role="status"
    >
      <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-100">
        {weightedSizingGateTitle(lang)}
      </p>
      <p className="text-[10.5px] leading-snug text-amber-900/85 dark:text-amber-100/85 mt-0.5">
        {weightedSizingGateMessage(gate, lang)}
      </p>
      {!compact ? (
        <p className="text-[9.5px] text-amber-800/70 dark:text-amber-200/60 mt-1 tabular-nums">
          {it ? "Stato attuale" : "Current status"}: {gate.totalTrades}/{WEIGHTED_SIZING_MIN_TRADES}{" "}
          {it ? "trade" : "trades"} · {gate.highConfidenceCellCount}{" "}
          {it ? "bucket HIGH" : "HIGH buckets"}
        </p>
      ) : null}
    </div>
  );
}
