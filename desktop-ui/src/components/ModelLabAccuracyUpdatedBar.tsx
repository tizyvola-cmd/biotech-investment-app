import { formatDataRefreshTimestamp } from "../shared/dataFreshness";
import { useLang, useT } from "../shared/i18n";

export function ModelLabAccuracyUpdatedBar({
  updatedAt,
}: {
  updatedAt?: string | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "it" ? "it" : "en";
  const formatted = formatDataRefreshTimestamp(updatedAt, locale);

  return (
    <div
      style={{
        marginBottom: 6,
        padding: "8px 12px",
        borderRadius: 10,
        border: "0.5px solid var(--sn-border)",
        background: "linear-gradient(168deg, #ffffff 0%, #f8fafc 55%, #f5f3ff 100%)",
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 600, color: "var(--sn-text)", margin: 0 }}>
        {formatted
          ? t("modelLab.accuracyLastUpdated", { at: formatted })
          : t("modelLab.accuracyLastUpdatedPending")}
      </p>
      <p
        style={{
          fontSize: 10,
          color: "var(--sn-text-3)",
          margin: "4px 0 0",
          lineHeight: 1.4,
          fontStyle: "italic",
        }}
      >
        {t("modelLab.accuracyScheduleNote")}
      </p>
    </div>
  );
}
