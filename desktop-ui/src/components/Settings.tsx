import { THEME_OPTIONS, type ResolvedTheme } from "../sheet/themePrefs";
import { getStoredToken, setStoredToken } from "../api/supernova";
import type { ApiStatus } from "../types";

export function Settings({
  apiOk,
  status,
  log,
  refreshLog,
  onRunQuick,
  onRefreshStatus,
  busy,
  theme,
  onTheme,
}: {
  apiOk: boolean | null;
  status: ApiStatus | null;
  log: string;
  refreshLog: string;
  onRunQuick: () => void;
  onRefreshStatus: () => void;
  busy: boolean;
  theme: ResolvedTheme;
  onTheme: (t: ResolvedTheme) => void;
}) {
  return (
    <section className="card p-5 space-y-5 max-w-2xl">
      <h2 className="text-lg font-semibold">Impostazioni</h2>

      <div>
        <p className="text-sm text-ink-muted mb-2">Tema</p>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ id, label, hint }) => (
            <button
              key={id}
              type="button"
              title={hint}
              className={`btn-ghost ${theme === id ? "ring-2 ring-accent" : ""}`}
              onClick={() => onTheme(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm text-ink-muted mb-2">API SuperNova (proxy → 127.0.0.1:8765)</p>
        <p className="text-sm">
          Stato:{" "}
          <span className={apiOk ? "text-positive" : "text-negative"}>
            {apiOk === null ? "—" : apiOk ? "online" : "offline"}
          </span>
        </p>
        {status && (
          <ul className="mt-2 text-sm text-ink-muted space-y-1">
            <li>Workbook: {status.workbook ?? "—"}</li>
            <li>Percorso: {status.workbook_path ?? "—"}</li>
            <li>Aggiornato: {status.workbook_mtime ?? "—"}</li>
            <li>Refresh giornaliero: {status.refresh_running ? "in corso" : "fermo"}</li>
            <li>Orchestrator: {status.orchestrator_running ? "in corso" : "fermo"}</li>
            {status.refresh_status?.message ? (
              <li>Ultimo refresh: {status.refresh_status.message}</li>
            ) : null}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Tutti i profili refresh (Giornaliero, Simulation, Accuracy, SEC K-8, Domenica) sono nella
          tab <strong>Refresh</strong>. Qui resta solo l&apos;orchestrator rapido.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onRefreshStatus}>
            Aggiorna stato API
          </button>
          <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={onRunQuick}>
            Orchestrator (quick)
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm text-ink-muted block mb-1" htmlFor="api-token">
          X-SuperNova-Token (POST mutanti)
        </label>
        <input
          id="api-token"
          className="input font-mono text-xs"
          type="password"
          defaultValue={getStoredToken()}
          placeholder="opzionale — SUPERNOVA_API_TOKEN"
          onBlur={(e) => setStoredToken(e.target.value)}
        />
        <p className="mt-1 text-xs text-ink-muted">
          Oppure variabile <code className="text-accent">VITE_SUPERNOVA_API_TOKEN</code> in{" "}
          <code>.env.local</code>
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Log refresh giornaliero</h3>
        <pre className="max-h-40 overflow-auto rounded-lg bg-surface p-3 text-xs text-ink-muted">
          {refreshLog || "(vuoto — avvia «Refresh giornaliero»)"}
        </pre>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Log orchestrator</h3>
        <pre className="max-h-32 overflow-auto rounded-lg bg-surface p-3 text-xs text-ink-muted">
          {log || "(vuoto)"}
        </pre>
      </div>

      <div className="text-xs text-ink-muted border-t border-[rgb(var(--border))] pt-4 space-y-1">
        <p>
          <strong>Dati locali (stabile):</strong> Simulation / Accuracy / Financial leggono solo{" "}
          <code>data/*_sheet_snapshot.json</code> — non l&apos;API HTTP.
        </p>
        <p>Dashboard: <code>data/past_catalyst_predictions.json</code> (o ui_snapshot.json)</p>
        <p>Dopo refresh: gli snapshot si aggiornano da soli; oppure{" "}
          <code>scripts\Export_Desktop_Snapshots.bat</code>.</p>
        <p>Avvia l&apos;app con <code>scripts\Avvia_Biotech_Desktop.bat</code> (Electron).</p>
      </div>
    </section>
  );
}
