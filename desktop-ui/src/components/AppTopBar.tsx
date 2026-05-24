import type { AppScreen } from "../types";
import { SCREEN_LABELS } from "./AppSidebar";

export function AppTopBar({
  screen,
  desktopManifest,
  apiOk,
  status,
  onReloadData,
}: {
  screen: AppScreen;
  desktopManifest: string | null;
  apiOk: boolean | null;
  status: { workbook_mtime?: string | null } | null;
  onReloadData: () => void;
}) {
  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <header className="h-[52px] shrink-0 flex items-center gap-3 px-5 border-b border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))]">
      <div className="flex items-baseline gap-3 min-w-0">
        <h1 className="text-[15px] font-bold tracking-tight truncate">
          {SCREEN_LABELS[screen]}
        </h1>
        <span className="text-[11px] text-ink-muted hidden sm:inline">{today}</span>
      </div>

      {screen === "catalyst" && (
        <div className="hidden md:flex items-center gap-1.5 ml-2">
          {["All", "↑ Long", "↓ Short", "⭐ High conf."].map((pill, i) => (
            <span
              key={pill}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border cursor-default ${
                i === 0
                  ? "bg-accent/20 text-accent border-accent/40"
                  : "border-[rgb(var(--border))]/40 text-ink-muted bg-[rgb(var(--surface-3))]/30"
              }`}
            >
              {pill}
            </span>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {apiOk === false && (
          <span className="text-[10px] text-[rgb(var(--signal-down))] font-medium">API offline</span>
        )}
        {desktopManifest && (
          <span className="text-[10px] text-ink-muted hidden lg:inline tabular-nums">
            snapshot {new Date(desktopManifest).toLocaleString("it-IT")}
          </span>
        )}
        {!desktopManifest && status?.workbook_mtime && (
          <span className="text-[10px] text-ink-muted hidden lg:inline tabular-nums">
            wb {new Date(status.workbook_mtime).toLocaleString("it-IT")}
          </span>
        )}
        <button type="button" className="btn-ghost text-[11px] px-2 py-1" onClick={onReloadData}>
          Ricarica JSON
        </button>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--purple-soft)))" }}
          title="Utente"
        >
          TR
        </div>
      </div>
    </header>
  );
}
