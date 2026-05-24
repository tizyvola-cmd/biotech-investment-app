import type { SheetTable } from "../types";
import { PredictionGuidePanel } from "./PredictionGuidePanel";

/** Scheda top-level Modelli — predizione-guida (distribuzione CD, curve μ, confronto settimanale). */
export function ModelliView({
  accTable,
  loading,
  error,
  onReload,
  onOpenAnalisiModelli,
  accuracyDataStale,
  manifestUpdatedAt,
}: {
  accTable: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onOpenAnalisiModelli?: () => void;
  /** Snapshot Accuracy su disco più recente del foglio in memoria. */
  accuracyDataStale?: boolean;
  manifestUpdatedAt?: string | null;
}) {
  return (
    <section className="card flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Modelli</h2>
          <p className="text-xs text-ink-muted">
            Distribuzione % attorno al CD · curve μ macro-gruppi · confronto settimanale (
            <strong>Predizione — guida</strong>)
            {onOpenAnalisiModelli && (
              <>
                {" "}
                ·{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={onOpenAnalisiModelli}
                >
                  Analisi modelli (accuratezza)
                </button>
              </>
            )}
          </p>
        </div>
        <button type="button" className="btn-ghost text-xs ml-auto" onClick={onReload}>
          Ricarica Accuracy
        </button>
      </div>

      <div className="flex flex-col flex-1 min-h-0 p-4 overflow-hidden">
        {error && !accTable?.rows?.length && (
          <p className="text-sm text-negative shrink-0 mb-2">{error}</p>
        )}
        <PredictionGuidePanel
          accTable={accTable}
          sheetLoading={loading}
          accuracyDataStale={accuracyDataStale}
          manifestUpdatedAt={manifestUpdatedAt}
          onReloadAccuracy={onReload}
        />
      </div>
    </section>
  );
}
