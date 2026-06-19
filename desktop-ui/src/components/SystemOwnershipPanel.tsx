import { useT } from "../shared/i18n";

export function SystemOwnershipPanel() {
  const t = useT();

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto py-6 px-4">
      <div
        className="w-[200px] h-[200px] rounded-[22px] overflow-hidden shrink-0 mb-4 shadow-lg"
        style={{
          boxShadow:
            "0 12px 36px rgba(0,0,0,0.35), 0 0 0 1px rgba(125, 211, 252, 0.12)",
        }}
      >
        <img
          src="/favicon.ico"
          alt="SuperNova"
          className="w-full h-full object-cover"
          width={200}
          height={200}
        />
      </div>
      <h3 className="text-[22px] font-bold tracking-wide text-sky-200 mb-4">SuperNova</h3>
      <div className="w-full text-left text-[11px] leading-relaxed text-ink-muted space-y-2">
        <p className="text-center text-[13px] font-semibold text-ink mb-3">
          {t("system.ownership.title")}
        </p>
        <p>
          <strong className="text-ink font-semibold">{t("system.ownership.conceptLabel")}</strong>{" "}
          {t("system.ownership.author")}
        </p>
        <p>
          <strong className="text-ink font-semibold">{t("system.ownership.descriptionLabel")}</strong>{" "}
          {t("system.ownership.description")}
        </p>
        <p>
          <strong className="text-ink font-semibold">{t("system.ownership.noticeLabel")}</strong>{" "}
          {t("system.ownership.notice")}
        </p>
        <p>
          <strong className="text-ink font-semibold">{t("system.ownership.responsibilityLabel")}</strong>{" "}
          {t("system.ownership.responsibility")}
        </p>
      </div>
    </div>
  );
}
