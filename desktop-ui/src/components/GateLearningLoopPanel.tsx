import { useCallback, useEffect, useState } from "react";
import type { SheetTable } from "../types";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import type { ChartBundle } from "../types";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import { buildAdviceCalibrationForLearnings } from "./DecisionSimAdviceCalibrationPanel";
import {
  GATE_LEARNING_BASELINE,
  GATE_LEARNING_CHANGED_EVENT,
  applyGateLearningProposals,
  clearGateLearningPending,
  loadGateLearningState,
  refreshGateLearningProposals,
  revertGateLearningToBaseline,
  thresholdsDifferFromBaseline,
  type GateLearningState,
} from "../sheet/gateLearningLoop";

type Props = {
  simTable: SheetTable | null | undefined;
  chartBundle?: ChartBundle | null;
  lang: "it" | "en";
};

export function GateLearningLoopPanel({ simTable, chartBundle, lang }: Props) {
  const it = lang === "it";
  const inputs = useInvestSimInputs(simTable ?? null);
  const [state, setState] = useState<GateLearningState>(() => loadGateLearningState());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () => setState(loadGateLearningState());
    window.addEventListener(GATE_LEARNING_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(GATE_LEARNING_CHANGED_EVENT, onChange);
  }, []);

  const recompute = useCallback(() => {
    if (!simTable?.rows?.length) {
      setNote(it ? "Serve la tabella Simulation." : "Simulation sheet required.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const pointsBySeriesKey = chartBundle ? chartPointsMapFromBundle(chartBundle) : new Map();
      const ds = loadDecisionSimState();
      const monitorRows = buildSuggestionMonitorRows({
        simTable,
        inputs,
        pointsBySeriesKey,
        lang,
        paperPortfolio: ds.paperPortfolio,
      });
      const points = buildAdviceCalibrationForLearnings({
        monitorRows,
        paperPortfolio: ds.paperPortfolio,
        decisionSimTicks: ds.ticks,
        liveEvaluations: monitorRows,
        simTable,
        lang,
      });
      const next = refreshGateLearningProposals(points);
      setState(next);
      setNote(
        next.pending.length
          ? it
            ? `${next.pending.length} proposta/e da ${next.lastScoredN} advice scored.`
            : `${next.pending.length} proposal(s) from ${next.lastScoredN} scored advices.`
          : it
            ? `Nessuna proposta (n=${next.lastScoredN} scored). Soglie ok o campione insufficiente.`
            : `No proposals (n=${next.lastScoredN} scored). Gates ok or sample too small.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [simTable, chartBundle, inputs, lang, it]);

  // Auto-evaluate once when the Lab opens with a sim table.
  useEffect(() => {
    if (!simTable?.rows?.length) return;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / simTable identity only
  }, [simTable?.rows?.length]);

  const onApply = () => {
    const next = applyGateLearningProposals();
    setState(next);
    setNote(it ? "Soglie applicate. Ricarica Decision Chart per vedere BUY/SELL." : "Gates applied. Reload Decision Chart to see BUY/SELL.");
  };

  const onRevert = () => {
    const next = revertGateLearningToBaseline();
    setState(next);
    setNote(it ? "Ripristinato baseline Reg 45 / SDS 40." : "Reverted to baseline Reg 45 / SDS 40.");
  };

  const onClear = () => {
    setState(clearGateLearningPending());
    setNote(null);
  };

  const appliedOff = thresholdsDifferFromBaseline(state.applied);

  return (
    <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/40 dark:bg-indigo-950/20 dark:border-indigo-800/40 px-3 py-2.5 space-y-2 shrink-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[9px] uppercase tracking-wide text-indigo-700/80 dark:text-indigo-300/80 font-semibold">
            {it ? "Gate learning loop v1" : "Gate learning loop v1"}
          </p>
          <p className="text-[11px] font-semibold text-ink leading-snug">
            {it
              ? "Auto-soglie da advice scored (con Apply / Revert)"
              : "Auto-thresholds from scored advice (Apply / Revert)"}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug max-w-prose">
            {it
              ? "Reg SELL in Rescue e SDS studio BUY. Non tocca P(plan) ≥ 65. Guardrail: Reg 40–55, SDS 35–50."
              : "Rescue Reg SELL floor and study SDS BUY floor. Does not touch P(plan) ≥ 65. Guardrails: Reg 40–55, SDS 35–50."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <button
            type="button"
            className="rounded-md border border-slate-300/80 bg-white px-2 py-1 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={busy || !simTable?.rows?.length}
            onClick={recompute}
          >
            {busy ? (it ? "Calcolo…" : "Computing…") : it ? "Ricalcola" : "Recompute"}
          </button>
          <button
            type="button"
            className="rounded-md border border-indigo-400/70 bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            disabled={state.pending.length === 0}
            onClick={onApply}
          >
            {it ? "Applica" : "Apply"}
            {state.pending.length ? ` (${state.pending.length})` : ""}
          </button>
          <button
            type="button"
            className="rounded-md border border-rose-300/70 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            disabled={!appliedOff && state.pending.length === 0}
            onClick={onRevert}
          >
            {it ? "Ripristina baseline" : "Revert baseline"}
          </button>
          {state.pending.length > 0 ? (
            <button
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 text-[10px] text-ink-muted hover:bg-white/80"
              onClick={onClear}
            >
              {it ? "Scarta proposte" : "Discard"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[10px] tabular-nums">
        <span className="rounded-md border border-white/80 bg-white/80 px-1.5 py-0.5">
          Reg SELL ≥ <strong>{state.applied.rescueSellRegMin}</strong>
          {state.applied.rescueSellRegMin !== GATE_LEARNING_BASELINE.rescueSellRegMin ? (
            <span className="text-indigo-700"> (base {GATE_LEARNING_BASELINE.rescueSellRegMin})</span>
          ) : null}
        </span>
        <span className="rounded-md border border-white/80 bg-white/80 px-1.5 py-0.5">
          SDS studio ≥ <strong>{state.applied.studySdsMin}</strong>
          {state.applied.studySdsMin !== GATE_LEARNING_BASELINE.studySdsMin ? (
            <span className="text-indigo-700"> (base {GATE_LEARNING_BASELINE.studySdsMin})</span>
          ) : null}
        </span>
        {state.lastEvaluatedAt ? (
          <span className="text-ink-muted">
            n={state.lastScoredN} ·{" "}
            {new Date(state.lastEvaluatedAt).toLocaleString(it ? "it-IT" : "en-US", {
              month: "short",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </div>

      {state.pending.length > 0 ? (
        <ul className="space-y-1.5 text-[10px] leading-snug">
          {state.pending.map((p) => (
            <li
              key={`${p.kind}-${p.to}-${p.computedAt}`}
              className="rounded-md border border-indigo-300/50 bg-white/70 px-2 py-1.5"
            >
              <p className="font-semibold text-indigo-900 dark:text-indigo-200">
                {p.kind === "rescue_reg" ? "Rescue Reg SELL" : "Study SDS"}: {p.from} → {p.to}
                <span className="font-normal text-ink-muted ml-1">
                  ({p.evidenceRate}% · n={p.evidenceN})
                </span>
              </p>
              <p className="text-ink mt-0.5">{it ? p.reasonIt : p.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {note ? <p className="text-[10px] text-ink-muted">{note}</p> : null}

      {state.log.length > 0 ? (
        <details className="text-[9px] text-ink-muted">
          <summary className="cursor-pointer font-medium">
            {it ? `Log (${state.log.length})` : `Log (${state.log.length})`}
          </summary>
          <ul className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
            {[...state.log].reverse().slice(0, 12).map((e) => (
              <li key={`${e.at}-${e.action}-${e.detail}`}>
                <span className="tabular-nums">
                  {new Date(e.at).toLocaleString(it ? "it-IT" : "en-US", {
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>{" "}
                · <span className="font-semibold">{e.action}</span> — {e.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
