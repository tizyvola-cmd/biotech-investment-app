import { useState } from "react";
import type { ResolvedTheme } from "../sheet/themePrefs";
import type { ApiStatus } from "../types";
import { RefreshView } from "./RefreshView";
import { Settings } from "./Settings";

export function SystemView({
  apiOk,
  busy,
  onBusyChange,
  onRefreshComplete,
  status,
  log,
  refreshLog,
  onRunQuick,
  onRefreshStatus,
  theme,
  onTheme,
}: {
  apiOk: boolean | null;
  busy: boolean;
  onBusyChange: (b: boolean) => void;
  onRefreshComplete: () => void;
  status: ApiStatus | null;
  log: string;
  refreshLog: string;
  onRunQuick: () => void;
  onRefreshStatus: () => void;
  theme: ResolvedTheme;
  onTheme: (t: ResolvedTheme) => void;
}) {
  const [panel, setPanel] = useState<"refresh" | "settings">("refresh");

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--border))]/60 pb-3 shrink-0">
        <div className="mr-2">
          <h2 className="text-lg font-semibold">Sistema</h2>
          <p className="text-xs text-ink-muted">Refresh dati, orchestrator e impostazioni app</p>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg bg-surface border border-[rgb(var(--border))]/60 ml-auto">
          {(
            [
              ["refresh", "Refresh"],
              ["settings", "Impostazioni"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs transition ${
                panel === id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setPanel(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col pt-3">
        {panel === "refresh" && (
          <RefreshView
            apiOk={apiOk}
            busy={busy}
            onBusyChange={onBusyChange}
            onRefreshComplete={onRefreshComplete}
          />
        )}
        {panel === "settings" && (
          <Settings
            apiOk={apiOk}
            status={status}
            log={log}
            onRunQuick={onRunQuick}
            onRefreshStatus={onRefreshStatus}
            refreshLog={refreshLog}
            busy={busy}
            theme={theme}
            onTheme={onTheme}
          />
        )}
      </div>
    </div>
  );
}
