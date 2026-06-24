import { useMobileLang } from "../hooks/useMobileLang";

export function RefreshButton({
  loading,
  lastUpdate,
  onClick,
  label,
}: {
  loading?: boolean;
  lastUpdate?: Date | null;
  onClick: () => void;
  label?: string;
}) {
  const { t } = useMobileLang();
  const refreshLabel = label ?? t("common.refresh");

  const age =
    lastUpdate != null
      ? (() => {
          const mins = Math.round((Date.now() - lastUpdate.getTime()) / 60000);
          if (mins < 1) return t("common.updatedNow");
          if (mins < 60) return t("common.minAgo", { n: mins });
          return t("common.hAgo", { n: Math.round(mins / 60) });
        })()
      : null;

  return (
    <div className="refresh-btn-wrap">
      <button type="button" className="refresh-btn" onClick={onClick} disabled={loading}>
        <span className={loading ? "refresh-icon spin" : "refresh-icon"} aria-hidden>
          ↻
        </span>
        {loading ? t("common.refreshing") : refreshLabel}
      </button>
      {age ? <span className="snapshot-age">{age}</span> : null}
    </div>
  );
}
