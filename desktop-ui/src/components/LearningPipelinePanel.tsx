import type { LearningPipelineOverview } from "../api/learningBus";

export function LearningPipelinePanel({
  pipeline,
  it,
}: {
  pipeline: LearningPipelineOverview | null;
  it: boolean;
}) {
  if (!pipeline?.steps?.length) {
    return (
      <p className="text-[11px] text-ink-muted py-4">
        {it ? "Pipeline calibrazione non disponibile." : "Calibration pipeline unavailable."}
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/30 p-3 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink">
          {it ? "Pipeline di calibrazione (cascata)" : "Calibration pipeline (cascade)"}
        </h4>
        <p className="text-[10px] text-ink-muted mt-1">
          {it ? pipeline.display_chain_it : pipeline.display_chain_en}
        </p>
      </div>
      <ol className="space-y-1.5">
        {pipeline.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-start gap-2 text-[11px] border-b border-[rgb(var(--border))]/30 pb-1.5 last:border-0"
          >
            <span className="tabular-nums text-ink-muted w-4 shrink-0">{step.order}</span>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-ink">{it ? step.name_it : step.name_en}</span>
              <span
                className={`ml-2 text-[9px] px-1 rounded ${
                  step.status === "active"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : step.status === "no_data"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300"
                }`}
              >
                {step.status}
              </span>
              {step.summary?.value != null && step.id === "global_cal_factor" ? (
                <span className="ml-2 tabular-nums text-indigo-700 dark:text-indigo-300">
                  CF={String(step.summary.value)}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GlobalCalFactorReadOnly({
  value,
  updatedAt,
  it,
}: {
  value: number | null | undefined;
  updatedAt: string | null | undefined;
  it: boolean;
}) {
  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2.5 space-y-1">
      <p className="text-[11px] font-semibold text-ink">
        {it ? "Global cal_factor (v4) — solo lettura" : "Global cal_factor (v4) — read-only"}
      </p>
      <p className="text-lg font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
        {value != null && Number.isFinite(value) ? value.toFixed(3) : "—"}
      </p>
      <p className="text-[10px] text-ink-muted leading-relaxed">
        {it
          ? "Aggiornato dall'orchestrator (~ogni 30 gg). Il pulsante Applica del ciclo settimanale NON modifica questo valore."
          : "Updated by the orchestrator (~every 30 days). The weekly Apply button does NOT change this value."}
        {updatedAt ? ` · ${it ? "Ultimo file" : "Last file"}: ${new Date(updatedAt).toLocaleString()}` : ""}
      </p>
    </div>
  );
}
