import { useEffect, useMemo, useState } from "react";
import { AppModal } from "./AppModal";
import {
  ackEarlyPeakMinAlert,
  collectEarlyPeakMinHitAlerts,
  loadEarlyPeakMinAcks,
  type EarlyPeakMinHitAlert,
} from "../sheet/earlyPeakMinPriceAlerts";
import type { EarlyPeakBuyMinTarget } from "../sheet/earlyPeakBuyMinTarget";

type Props = {
  targets: Map<string, EarlyPeakBuyMinTarget>;
  rowByKey: Map<string, Record<string, unknown>>;
  lang: "it" | "en";
  onOpenEvaluation?: (focus: { ticker: string; rowKey?: string }) => void;
};

export function EarlyPeakMinPriceAlertModal({
  targets,
  rowByKey,
  lang,
  onOpenEvaluation,
}: Props) {
  const it = lang === "it";
  const queue = useMemo(
    () => collectEarlyPeakMinHitAlerts(targets, rowByKey, loadEarlyPeakMinAcks()),
    [targets, rowByKey],
  );
  const [active, setActive] = useState<EarlyPeakMinHitAlert | null>(null);

  useEffect(() => {
    if (active) return;
    if (!queue.length) return;
    setActive(queue[0]!);
  }, [queue, active]);

  if (!active) return null;

  const dismiss = () => {
    ackEarlyPeakMinAlert(active.id);
    setActive(null);
  };

  const openEval = () => {
    onOpenEvaluation?.({ ticker: active.target.ticker, rowKey: active.target.key });
    dismiss();
  };

  return (
    <AppModal
      open
      onClose={dismiss}
      aria-label={
        it
          ? `Alert prezzo minimo ${active.target.ticker}`
          : `Minimum price alert ${active.target.ticker}`
      }
      panelClassName="max-w-md w-full"
    >
      <div className="rounded-xl border-2 border-emerald-500/70 bg-[rgb(var(--surface))] shadow-2xl overflow-hidden">
        <div className="bg-emerald-600/15 px-4 py-3 border-b border-emerald-500/40">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            {it ? "Picco nascente · minimo settimanale" : "Early peak · weekly minimum"}
          </p>
          <p className="text-lg font-bold text-ink mt-0.5 tabular-nums">
            {active.target.ticker}
            <span className="ml-2 text-emerald-700 dark:text-emerald-300">
              BUY @ {active.formattedTarget}
            </span>
          </p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <p className="text-sm text-ink leading-snug">
            {it
              ? `Il prezzo corrente (${active.formattedCurrent}) ha raggiunto il minimo degli ultimi 7 giorni (${active.formattedTarget}). Punto d'ingresso suggerito per il Soft BUY picco nascente.`
              : `Current price (${active.formattedCurrent}) reached the 7-day low (${active.formattedTarget}). Suggested entry for the early-peak Soft BUY.`}
          </p>
          {active.target.signalDayPct != null ? (
            <p className="text-[11px] text-ink-muted tabular-nums">
              {it ? "Segnale con Δ giorno" : "Signal day Δ"}{" "}
              {active.target.signalDayPct >= 0 ? "+" : ""}
              {active.target.signalDayPct.toFixed(1)}%
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onOpenEvaluation ? (
              <button
                type="button"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 transition"
                onClick={openEval}
              >
                {it ? "Apri Evaluation →" : "Open Evaluation →"}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-md border border-[rgb(var(--border))] px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-[rgb(var(--accent))]/8 transition ml-auto"
              onClick={dismiss}
            >
              {it ? "Chiudi" : "Dismiss"}
            </button>
          </div>
          {queue.length > 1 ? (
            <p className="text-[10px] text-ink-muted">
              {it
                ? `+${queue.length - 1} altri alert minimo in coda`
                : `+${queue.length - 1} more minimum alerts queued`}
            </p>
          ) : null}
        </div>
      </div>
    </AppModal>
  );
}
