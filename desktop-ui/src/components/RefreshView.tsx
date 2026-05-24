import { useCallback, useEffect, useState } from "react";
import {
  exportDesktopSnapshots,
  fetchRefreshProfiles,
  fetchWorkbookStatus,
  runRefreshProfile,
  type RefreshProfile,
  type WorkbookStatus,
} from "../api/refresh";
import { fetchRefreshLog, fetchRefreshStatus } from "../api/supernova";

const PROFILE_LABELS: Record<string, string> = {
  daily: "Giornaliero",
  simulation: "Solo Simulation",
  accuracy: "Solo Accuracy",
  sec_k8: "SEC K-8",
  sunday: "Domenica full",
  dry_run: "Dry-run",
};

export function RefreshView({
  apiOk,
  busy,
  onBusyChange,
  onRefreshComplete,
}: {
  apiOk: boolean | null;
  busy: boolean;
  onBusyChange: (b: boolean) => void;
  onRefreshComplete?: () => void;
}) {
  const [profiles, setProfiles] = useState<RefreshProfile[]>([]);
  const [wb, setWb] = useState<WorkbookStatus | null>(null);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const w = await fetchWorkbookStatus();
      setWb(w);
      const st = await fetchRefreshStatus();
      if (st.running) onBusyChange(true);
      else onBusyChange(false);
      const lg = await fetchRefreshLog(8000);
      setLog(lg.log);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onBusyChange]);

  useEffect(() => {
    if (apiOk !== true) return;
    void fetchRefreshProfiles()
      .then((r) => setProfiles(r.profiles))
      .catch(() => setProfiles([]));
    void refreshStatus();
  }, [apiOk, refreshStatus]);

  useEffect(() => {
    if (!busy || apiOk !== true) return;
    const id = window.setInterval(async () => {
      const st = await fetchRefreshStatus();
      const lg = await fetchRefreshLog(8000);
      setLog(lg.log);
      await refreshStatus();
      if (!st.running) {
        onBusyChange(false);
        try {
          await exportDesktopSnapshots();
        } catch {
          /* optional */
        }
        onRefreshComplete?.();
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [busy, apiOk, onBusyChange, onRefreshComplete, refreshStatus]);

  const startProfile = async (id: string) => {
    setError(null);
    onBusyChange(true);
    setLog(`Avvio profilo ${id}…\n`);
    try {
      const res = await runRefreshProfile(id);
      if (res.error) {
        setError(res.error);
        onBusyChange(false);
        return;
      }
      setLog((prev) => `${prev}${res.hint ?? "Avviato."}\n`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onBusyChange(false);
    }
  };

  const shell = window.supernova?.shell;

  if (apiOk === false) {
    return (
      <section className="card p-6 max-w-2xl">
        <h2 className="text-lg font-semibold">Refresh</h2>
        <p className="text-sm text-negative mt-2">
          API offline — riavvia l&apos;app desktop o libera la porta 8765. I dati in tab
          restano leggibili dagli snapshot in <code>data/</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5 flex flex-col gap-4 max-w-4xl flex-1 min-h-0">
      <div>
        <h2 className="text-lg font-semibold">Refresh workbook</h2>
        <p className="text-sm text-ink-muted mt-1">
          Profili refresh integrati in <strong>SuperNova</strong>. Chiudi
          Excel sul file dati prima del run (Autosave / OneDrive).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={!shell}
          onClick={() => void shell?.openWorkbook()}
        >
          Apri workbook in Excel
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={!shell || !wb?.staged_path}
          onClick={() => wb?.staged_path && void shell?.openPath(wb.staged_path)}
        >
          Apri staged in Excel
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={!shell}
          onClick={() => void shell?.openDataDir()}
        >
          Cartella data
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={() => void refreshStatus()}>
          Aggiorna stato
        </button>
      </div>

      {wb && (
        <div className="text-sm rounded-lg border border-[rgb(var(--border))] bg-surface/50 p-3 space-y-1">
          <p>
            Workbook: <span className="font-medium text-ink">{wb.workbook}</span>
            {wb.workbook_locked ? (
              <span className="text-negative"> — bloccato (chiudi Excel)</span>
            ) : (
              <span className="text-positive"> — scrivibile</span>
            )}
          </p>
          <p className="text-ink-muted">
            Staged: {wb.staged_name ?? "—"}
            {wb.refresh_fast_status?.message
              ? ` · ${wb.refresh_fast_status.message}`
              : ""}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(profiles.length ? profiles : []).map((p) => (
          <button
            key={p.id}
            type="button"
            className="text-left rounded-lg border border-[rgb(var(--border))] px-3 py-3 hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50"
            disabled={busy}
            onClick={() => void startProfile(p.id)}
          >
            <div className="font-semibold text-sm text-ink">
              {PROFILE_LABELS[p.id] ?? p.title}
            </div>
            <div className="text-[11px] text-ink-muted mt-1 leading-snug">{p.detail}</div>
            <div className="text-[10px] text-accent mt-1">{p.eta}</div>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-[12rem] flex flex-col">
        <h3 className="text-sm font-medium mb-2">Log</h3>
        <pre className="flex-1 overflow-auto rounded-lg bg-surface p-3 text-xs text-ink-muted whitespace-pre-wrap">
          {log || (busy ? "In corso…" : "(vuoto)")}
        </pre>
      </div>
    </section>
  );
}
