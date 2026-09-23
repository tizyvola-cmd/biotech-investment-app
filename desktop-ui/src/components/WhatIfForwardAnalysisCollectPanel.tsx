import { useMemo } from "react";
import {
  evaluateWhatIfForwardAnalysisGate,
  type WhatIfForwardAnalysisGate,
} from "../sheet/whatIfReadoutDailySnapshot";
import type { WhatIfReadoutDailySnapshotStore } from "../sheet/whatIfReadoutDailySnapshot";

function CollectProgressBar({
  label,
  value,
  max,
  tone = "sky",
}: {
  label: string;
  value: number;
  max: number;
  tone?: "sky" | "amber" | "emerald";
}) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const bar =
    tone === "emerald"
      ? "bg-emerald-500/70"
      : tone === "amber"
        ? "bg-amber-500/70"
        : "bg-sky-500/70";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between gap-2 text-[9px] tabular-nums text-ink-muted">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[rgb(var(--border))]/40 overflow-hidden">
        <div className={`h-full rounded-full ${bar} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function gateLabel(gate: WhatIfForwardAnalysisGate, it: boolean): string {
  if (gate.ready) {
    return it ? "Analisi chart forward pronta" : "Chart-forward analysis ready";
  }
  return it ? "Snapshot segnali — in raccolta" : "Signal snapshots — collecting";
}

type Props = {
  store: WhatIfReadoutDailySnapshotStore;
  it: boolean;
  variant: "compact" | "full";
};

export function WhatIfForwardAnalysisCollectPanel({ store, it, variant }: Props) {
  const gate = useMemo(() => evaluateWhatIfForwardAnalysisGate(store), [store]);
  const { summary } = gate;

  if (variant === "compact") {
    return (
      <div
        className={`rounded-lg border px-3 py-2 shrink-0 min-w-[11rem] ${
          gate.ready
            ? "border-emerald-400/60 bg-emerald-50/80 dark:bg-emerald-950/30"
            : "border-sky-400/40 bg-sky-50/60 dark:bg-sky-950/25"
        }`}
        title={
          it
            ? "Snapshot giornalieri SDS/EIS/P(plan) per analisi chart forward non circolare (~2 settimane)."
            : "Daily SDS/EIS/P(plan) snapshots for non-circular chart-forward analysis (~2 weeks)."
        }
      >
        <p className="text-[10px] font-semibold text-ink leading-snug">{gateLabel(gate, it)}</p>
        <p className="text-[9px] text-ink-muted tabular-nums mt-0.5">
          {gate.ready
            ? it
              ? `${summary.sessionDays}g · ${summary.totalTickerSnapshots} righe`
              : `${summary.sessionDays}d · ${summary.totalTickerSnapshots} rows`
            : `${Math.round(gate.progress * 100)}% · ${summary.sessionDays}/${gate.minSessionDays}g`}
        </p>
        {!gate.ready ? (
          <div className="mt-1.5 h-1 rounded-full bg-[rgb(var(--border))]/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-500/70 transition-[width] duration-500"
              style={{ width: `${Math.round(gate.progress * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (gate.ready) {
    return (
      <div className="rounded-lg border-2 border-emerald-400 bg-gradient-to-r from-emerald-100 via-green-50 to-emerald-100 dark:from-emerald-950/50 dark:via-emerald-900/30 dark:to-emerald-950/50 px-3 py-2 shadow-sm">
        <p className="text-[11px] font-bold text-emerald-950 dark:text-emerald-50">
          {it ? "Analisi chart forward — campione pronto" : "Chart-forward analysis — sample ready"}
        </p>
        <p className="text-[10px] leading-snug text-emerald-900/90 dark:text-emerald-100/90 mt-0.5">
          {it
            ? `${summary.sessionDays} giorni sessione · ${summary.totalTickerSnapshots} ticker-giorni · ${summary.completeReadouts} readout completi (SDS+EIS+P plan). Puoi lanciare l’analisi bucket (script diag) — i segnali usano snapshot ◆, non backfill.`
            : `${summary.sessionDays} session days · ${summary.totalTickerSnapshots} ticker-days · ${summary.completeReadouts} complete readouts (SDS+EIS+P plan). You can run bucket analysis (diag script) — signals use snapshot ◆, not backfill.`}
        </p>
        {summary.firstSessionDate && summary.latestSessionDate ? (
          <p className="text-[9px] text-emerald-800/80 tabular-nums mt-1">
            {it ? "Copertura" : "Coverage"}: {summary.firstSessionDate} → {summary.latestSessionDate}
            {summary.medianTickersPerDay > 0
              ? ` · ~${summary.medianTickersPerDay} ticker/g`
              : ""}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-sky-400/45 bg-sky-50/50 dark:bg-sky-950/20 px-2.5 py-1.5"
      title={
        it
          ? "Ogni giorno di borsa la dashboard congela SDS/EIS/P(plan) per ticker. Servono ~2 settimane prima dell’analisi forward."
          : "Each trading day the dashboard freezes SDS/EIS/P(plan) per ticker. ~2 weeks needed before forward analysis."
      }
    >
      <p className="text-[9px] font-semibold uppercase tracking-wide text-sky-900/90 dark:text-sky-100 mb-0.5">
        {gateLabel(gate, it)}
        <span className="normal-case font-normal ml-1 tabular-nums">
          ({Math.round(gate.progress * 100)}%)
        </span>
      </p>
      <p className="text-[9px] text-ink-muted leading-snug mb-1.5">
        {it
          ? "Apri la dashboard almeno una volta per giorno di borsa — gli snapshot si accumulano automaticamente."
          : "Open the dashboard at least once per trading day — snapshots accumulate automatically."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <CollectProgressBar
          label={it ? "Giorni sessione" : "Session days"}
          value={summary.sessionDays}
          max={gate.minSessionDays}
        />
        <CollectProgressBar
          label={it ? "Ticker-giorni" : "Ticker-days"}
          value={summary.totalTickerSnapshots}
          max={gate.minTickerDays}
        />
        <CollectProgressBar
          label={it ? "Readout completi" : "Complete readouts"}
          value={summary.completeReadouts}
          max={gate.minCompleteTickerDays}
        />
      </div>
      {summary.latestSessionDate ? (
        <p className="text-[9px] text-ink-muted/80 tabular-nums mt-1.5">
          {it ? "Ultimo snapshot" : "Latest snapshot"}: {summary.latestSessionDate}
          {summary.sessionDays > 0 ? ` · ${summary.sessionDays}g totali` : ""}
        </p>
      ) : (
        <p className="text-[9px] text-ink-muted/80 mt-1.5">
          {it ? "Nessuno snapshot ancora — attendi il primo giorno di raccolta." : "No snapshots yet — wait for first collection day."}
        </p>
      )}
    </div>
  );
}
