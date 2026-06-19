import { useLang, useT } from "../shared/i18n";
import type { OrchestratorRunSummary } from "../api/refresh";
import type { SundayRefreshResult } from "../shared/refreshStatusStore";

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function newTickerList(summary: OrchestratorRunSummary | null | undefined): string[] {
  if (!summary) return [];
  const d = summary.new_tickers_discovery ?? [];
  const e = summary.new_tickers_extra ?? [];
  const i = summary.new_tickers_ipo ?? [];
  return [...new Set([...d, ...e, ...i])].sort();
}

export function SundayRefreshResultModal({
  open,
  result,
  onClose,
}: {
  open: boolean;
  result: SundayRefreshResult | null;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  if (!open || !result) return null;

  const ok = result.success;
  const summary = result.summary;
  const it = lang === "it";
  const exitNote =
    result.exitCode != null && result.exitCode !== 0
      ? it
        ? `Codice uscita processo: ${result.exitCode}`
        : `Process exit code: ${result.exitCode}`
      : null;

  const finished =
    summary?.finished_at_display ??
    summary?.finished_at ??
    null;
  const started = summary?.started_at_display ?? summary?.started_at ?? null;
  const elapsed = summary?.elapsed_sec ?? result.elapsedSec;
  const newTickers = newTickerList(summary);
  const newCd = summary?.new_catalyst_rows ?? [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg flex flex-col overflow-hidden shadow-xl max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/60 flex items-start gap-3 shrink-0">
          <span className="text-2xl leading-none" aria-hidden>
            🕰️
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-ink">
              {ok ? t("sundayRefresh.popup.titleOk") : t("sundayRefresh.popup.titleErr")}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {t("sundayRefresh.popup.subtitle")}
            </p>
          </div>
        </div>
        <div className="px-4 py-3 space-y-3 text-sm overflow-y-auto min-h-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <p className="tabular-nums">
              <span className="text-ink-muted">{t("sundayRefresh.popup.elapsed")} </span>
              <span className="font-semibold text-ink">{fmtElapsed(elapsed)}</span>
            </p>
            {finished ? (
              <p>
                <span className="text-ink-muted">
                  {it ? "Terminato: " : "Finished: "}
                </span>
                <span className="font-medium text-ink tabular-nums">{finished}</span>
              </p>
            ) : null}
            {started ? (
              <p className="sm:col-span-2">
                <span className="text-ink-muted">{it ? "Avvio: " : "Started: "}</span>
                <span className="font-medium text-ink tabular-nums">{started}</span>
              </p>
            ) : null}
          </div>

          <p
            className={`rounded-md border px-3 py-2 text-xs leading-snug ${
              ok
                ? "border-[rgb(var(--signal-up))]/35 bg-[rgb(var(--signal-up))]/8 text-ink"
                : "border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/8 text-ink"
            }`}
          >
            {result.message || (ok ? t("sundayRefresh.popup.okDefault") : t("sundayRefresh.popup.errDefault"))}
          </p>

          {summary ? (
            <div className="rounded-md border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2 space-y-2 text-[11px] leading-snug">
              <p className="font-semibold text-ink text-xs">
                {it ? "Novità rispetto al run precedente" : "Changes vs previous run"}
              </p>
              <p className="text-ink-muted">
                {newTickers.length > 0 ? (
                  <>
                    <span className="text-ink font-medium">
                      {it ? "Nuovi ticker biotech: " : "New biotech tickers: "}
                    </span>
                    {newTickers.join(", ")}
                  </>
                ) : (
                  <span>
                    {it
                      ? "Nessun nuovo ticker in biotech_symbols (discovery/extra)."
                      : "No new tickers in biotech_symbols (discovery/extra)."}
                  </span>
                )}
              </p>
              {newCd.length > 0 ? (
                <div>
                  <p className="text-ink font-medium mb-1">
                    {it
                      ? `Nuove CD (Exact/Partial · rel. diretta/collab./subsidiary): ${newCd.length}`
                      : `New catalyst dates (Exact/Partial · direct/collab./subsidiary): ${newCd.length}`}
                  </p>
                  <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {newCd.map((row) => (
                      <li
                        key={row.key}
                        className="rounded border border-[rgb(var(--border))]/50 bg-white/60 dark:bg-surface-elevated/80 px-2 py-1"
                      >
                        <span className="font-semibold text-ink">{row.ticker}</span>
                        <span className="text-ink-muted"> · CD </span>
                        <span className="tabular-nums">{row.completion_date}</span>
                        <span className="text-ink-muted"> · </span>
                        <span
                          className={
                            row.sponsor_match === "Exact"
                              ? "text-positive font-medium"
                              : "text-[rgb(var(--warn))] font-medium"
                          }
                        >
                          {row.sponsor_match}
                        </span>
                        <span className="text-ink-muted"> · {row.nct_relation_type}</span>
                        {(row.company || row.sponsor) && (
                          <p className="text-ink-muted/90 mt-0.5 truncate" title={`${row.company} ↔ ${row.sponsor}`}>
                            {row.company || "—"}
                            <span className="opacity-70"> ↔ </span>
                            {row.sponsor || "—"}
                            {row.nct_id ? ` · ${row.nct_id}` : ""}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-ink-muted">
                  {it
                    ? "Nessuna nuova coppia ticker|CD in coorte (Exact/Partial con relazione sponsor valida)."
                    : "No new ticker|CD pairs in cohort (Exact/Partial with valid sponsor relation)."}
                </p>
              )}
            </div>
          ) : null}

          {exitNote ? <p className="text-[10px] text-ink-muted/80">{exitNote}</p> : null}
        </div>
        <div className="px-4 py-3 border-t border-[rgb(var(--border))]/60 flex justify-end shrink-0">
          <button type="button" className="btn-primary text-xs" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
