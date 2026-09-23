/**
 * Modal persistente mostrato quando l'ultimo refresh EIS ha fallito.
 * Non scompare da solo — richiede click esplicito su "Ho capito".
 * Non blocca l'uso dell'app (usa lo stesso overlay dismissabile di AppModal).
 */
import type { EisStaleWarning } from "../sheet/clinicalFeedRefresh";
import { useLang } from "../shared/i18n";

function fmtDate(iso: string | null, locale: "it-IT" | "en-US"): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export function PipelineStaleWarningModal({
  warning,
  onClose,
}: {
  warning: EisStaleWarning;
  onClose: () => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const dateLocale = it ? "it-IT" : "en-US";
  if (!warning.show) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        className="relative z-10 card w-full max-w-md shadow-xl border border-amber-400/40 dark:border-amber-600/40"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pipeline-stale-title"
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/60">
          <span className="text-xl mt-0.5 shrink-0" aria-hidden>⚠</span>
          <div className="flex-1 min-w-0">
            <h2 id="pipeline-stale-title" className="text-sm font-semibold text-ink">
              {it ? "Aggiornamento EIS non riuscito" : "EIS refresh failed"}
            </h2>
            <p className="text-xs text-ink-muted mt-0.5 leading-snug">
              {it
                ? "L'ultimo refresh schedulato del feed clinico (EIS) ha fallito. I dati visualizzati sono quelli dell'ultimo aggiornamento riuscito."
                : "The last scheduled refresh of the clinical feed (EIS) failed. Displayed data reflects the last successful update."}
            </p>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <Row
            label={it ? "Ultimo tentativo" : "Last attempt"}
            value={fmtDate(warning.lastAttemptAt, dateLocale)}
          />
          <Row
            label={it ? "Ultimo aggiornamento riuscito" : "Last successful update"}
            value={fmtDate(warning.lastSuccessfulUpdate, dateLocale)}
            highlight={!warning.lastSuccessfulUpdate}
          />
          {warning.errorMessage && (
            <div>
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-0.5">
                {it ? "Errore" : "Error"}
              </p>
              <p className="text-[11px] text-rose-600 dark:text-rose-400 font-mono break-all">
                {warning.errorMessage.slice(0, 200)}
              </p>
            </div>
          )}
          <p className="text-[10px] text-ink-muted/80 leading-snug pt-1 border-t border-[rgb(var(--border))]/40">
            {it
              ? "Gli score EIS e Regulatory score rimangono quelli calcolati in precedenza. Verifica i log o rilancia manualmente "
              : "EIS and Regulatory score values remain the ones previously computed. Check the logs or manually rerun "}
            <code className="font-mono">eis_morning_refresh.py</code>.
          </p>
        </div>

        <div className="border-t border-[rgb(var(--border))]/60 px-4 py-3 flex justify-end">
          <button type="button" className="btn text-sm px-5" onClick={onClose}>
            {it ? "Ho capito" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-semibold text-ink-muted w-40 shrink-0">{label}</span>
      <span className={`text-[11px] ${highlight ? "text-ink-muted/50 italic" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}
