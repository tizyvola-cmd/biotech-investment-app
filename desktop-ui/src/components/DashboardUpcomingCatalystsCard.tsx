import type { ReactNode } from "react";
import { useLang, useT } from "../shared/i18n";

export type UpcomingCatalystRow = {
  ticker: string;
  cd: string;
  days: number | null;
  pred7: number | null;
};

function fmtPctSigned(v: number): string {
  const pct = v * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function DashboardUpcomingCatalystsCard({
  rows,
  simLoading,
  listMode,
  scopeLabel,
  listModeToggle,
  onOpenCatalystHub,
  className,
}: {
  rows: UpcomingCatalystRow[];
  simLoading: boolean;
  listMode: "portfolio" | "topOpps";
  scopeLabel: string;
  listModeToggle: ReactNode;
  onOpenCatalystHub: () => void;
  className?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  return (
    <div
      className={`card dashboard-feed-card flex flex-col min-h-0 min-w-0 ${className ?? ""}`}
    >
      <div className="dashboard-feed-card-head flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 border-b shrink-0">
        <h2 className="font-semibold text-xs text-slate-900">
          Upcoming Catalysts
          <span className="ml-1 font-medium text-slate-600">· {scopeLabel}</span>
        </h2>
        {listModeToggle}
        <button
          type="button"
          className="ml-auto text-[10px] text-accent/80 hover:text-accent transition shrink-0"
          onClick={onOpenCatalystHub}
        >
          → {t("sidebar.item.catalystHub")}
        </button>
      </div>
      <div className="px-2 py-1.5 space-y-0.5 flex-1 min-h-0 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-ink-muted text-[11px] p-1.5">
            {simLoading
              ? "Loading..."
              : it
                ? `Nessun catalizzatore imminente in ${listMode === "portfolio" ? "Portafoglio" : "Opportunità"}.`
                : `No upcoming catalysts in ${listMode === "portfolio" ? "Portfolio" : "Opportunities"}.`}
          </p>
        ) : (
          rows.map((r) => {
            const urgent = r.days != null && r.days <= 7;
            const direction = r.pred7 == null ? "neutral" : r.pred7 >= 0 ? "up" : "down";
            const signalClass =
              direction === "up"
                ? "signal-up"
                : direction === "down"
                  ? "signal-down"
                  : "signal-neutral";
            const signalLabel =
              direction === "up" ? "▲ Long" : direction === "down" ? "▼ Short" : "● Neutral";

            return (
              <div
                key={r.ticker + r.cd}
                className={`flex items-center gap-2 rounded-md px-2 py-1 border transition dashboard-feed-row ${
                  urgent ? "!border-[rgb(var(--warn))]/50 !bg-[rgb(var(--warn))]/8" : ""
                }`}
              >
                <span className={`${signalClass} text-[10px] shrink-0`}>{signalLabel}</span>
                <span className="font-bold text-xs tracking-wide text-slate-900 shrink-0">{r.ticker}</span>
                {r.pred7 != null && (
                  <span
                    className={`text-[10px] font-semibold tabular-nums shrink-0 ${
                      r.pred7 >= 0
                        ? "text-[rgb(var(--signal-up))]"
                        : "text-[rgb(var(--signal-down))]"
                    }`}
                  >
                    {fmtPctSigned(r.pred7)}
                  </span>
                )}
                <span className="text-[10px] font-semibold text-slate-600 ml-auto tabular-nums shrink-0">
                  {r.days == null ? "—" : urgent ? `⚡ ${r.days}d` : `${r.days} d`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
