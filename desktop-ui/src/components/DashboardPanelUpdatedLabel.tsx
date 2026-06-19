import { formatDataRefreshTimestamp } from "../shared/dataFreshness";
import { useLang, useT } from "../shared/i18n";

export function DashboardPanelUpdatedLabel({
  updatedAt,
  className = "",
}: {
  updatedAt?: string | null;
  className?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const formatted = formatDataRefreshTimestamp(updatedAt, lang === "it" ? "it" : "en");

  return (
    <p className={`text-[10px] text-ink-muted/80 mt-0.5 tabular-nums leading-snug ${className}`}>
      {formatted
        ? t("dashboard.charts.lastUpdated", { at: formatted })
        : t("dashboard.charts.lastUpdatedPending")}
    </p>
  );
}
