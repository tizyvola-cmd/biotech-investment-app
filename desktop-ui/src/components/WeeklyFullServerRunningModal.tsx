import { useRefreshStatus, setWeeklyFullServerRunningOpen } from "../shared/refreshStatusStore";
import { useLang } from "../shared/i18n";
import { AntiqueClockIcon } from "./AntiqueClockIcon";

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Visible while Saturday WeeklyFull is running on the VPS.
 * Dismissible; top-bar clock badge stays until the job ends.
 * Completion uses SundayRefreshResultModal + beep.
 */
export function WeeklyFullServerRunningModal() {
  const { lang } = useLang();
  const { weeklyFullServerRunningOpen, life } = useRefreshStatus();
  const it = lang === "it";

  if (!weeklyFullServerRunningOpen) return null;
  if (!life.fromServerWeeklyFull || life.state !== "running") return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      onClick={() => setWeeklyFullServerRunningOpen(false)}
    >
      <div
        className="card w-full max-w-md flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/60 flex items-start gap-3">
          <AntiqueClockIcon size={28} ticking />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-ink">
              {it ? "Orchestrator in corso sul server" : "Orchestrator running on server"}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {it
                ? "WeeklyFull sabato — data_orchestrator sul VPS"
                : "Saturday WeeklyFull — data_orchestrator on the VPS"}
            </p>
          </div>
        </div>
        <div className="px-4 py-3 space-y-2 text-sm">
          <p className="text-ink leading-snug">
            {life.message ||
              (it
                ? "Orchestrator settimanale in corso sul server…"
                : "Weekly orchestrator running on the server…")}
          </p>
          <p className="tabular-nums text-lg font-semibold text-ink">
            {fmtElapsed(life.elapsedSec)}
            <span className="text-xs font-normal text-ink-muted ml-2">
              {it ? "da avvio rilevato" : "since detected"}
            </span>
          </p>
          <p className="text-[11px] text-ink-muted leading-snug">
            {it
              ? "Puoi chiudere questa finestra: resta il badge orologio in alto. A fine run l’app apre il riepilogo e suona un segnale."
              : "You can close this window — the clock badge stays in the top bar. When it finishes, the app opens the summary and plays a chime."}
          </p>
        </div>
        <div className="px-4 py-3 border-t border-[rgb(var(--border))]/60 flex justify-end">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setWeeklyFullServerRunningOpen(false)}
          >
            {it ? "Nascondi (resta il badge)" : "Hide (keep badge)"}
          </button>
        </div>
      </div>
    </div>
  );
}
