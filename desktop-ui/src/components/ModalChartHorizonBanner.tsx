import { useT } from "../shared/i18n";

export function ModalChartHorizonBanner({
  variant = "modals",
}: {
  /** modals = sparkline popup; lossAnalysis = pred blend + slope tiles */
  variant?: "modals" | "lossAnalysis";
}) {
  const t = useT();
  const key =
    variant === "lossAnalysis"
      ? "modalCharts.horizonBanner.lossAnalysis"
      : "modalCharts.horizonBanner.modals";
  return (
    <p className="text-[10px] text-ink-muted leading-snug border border-[rgb(var(--border))]/40 bg-surface/60 rounded-md px-2.5 py-1.5">
      {t(key)}
    </p>
  );
}
