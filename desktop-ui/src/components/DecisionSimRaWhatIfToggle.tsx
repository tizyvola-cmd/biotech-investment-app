import { useT } from "../shared/i18n";

export function DecisionSimRaWhatIfToggle({
  active,
  onToggle,
  stats,
  className = "",
}: {
  active: boolean;
  onToggle: () => void;
  stats?: {
    blockedBuys: number;
    raTrades: number;
    baselineTrades: number;
    raReturnPct: number | null;
    baselineReturnPct: number | null;
  } | null;
  className?: string;
}) {
  const t = useT();

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
          active
            ? "border-violet-400/70 bg-violet-50 text-violet-900 dark:border-violet-500/50 dark:bg-violet-950/50 dark:text-violet-200"
            : "border-[rgb(var(--border))]/50 bg-surface/40 text-ink-muted hover:text-ink hover:border-violet-300/50"
        }`}
        title={t("testerMonitor.decisionSim.raWhatIf.toggleTip")}
      >
        {active
          ? t("testerMonitor.decisionSim.raWhatIf.toggleOn")
          : t("testerMonitor.decisionSim.raWhatIf.toggleOff")}
      </button>
      {active && stats ? (
        <span
          className="text-[9px] text-ink-muted leading-snug max-w-[520px]"
          title={t("testerMonitor.decisionSim.raWhatIf.banner")}
        >
          {t("testerMonitor.decisionSim.raWhatIf.banner")}{" "}
          {t("testerMonitor.decisionSim.raWhatIf.stats", {
            blocked: stats.blockedBuys,
            trades: stats.raTrades,
            baselineTrades: stats.baselineTrades,
            raReturn:
              stats.raReturnPct != null
                ? `${stats.raReturnPct >= 0 ? "+" : ""}${stats.raReturnPct}%`
                : "—",
            baselineReturn:
              stats.baselineReturnPct != null
                ? `${stats.baselineReturnPct >= 0 ? "+" : ""}${stats.baselineReturnPct}%`
                : "—",
          })}
        </span>
      ) : null}
    </div>
  );
}
