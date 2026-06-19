import { useMobileLang } from "../hooks/useMobileLang";

const ICON_SRC = `${import.meta.env.BASE_URL}supernova-icon.png`;

export function OwnershipDisclaimer() {
  const { t } = useMobileLang();

  return (
    <div className="ownership-disclaimer">
      <div className="ownership-disclaimer-icon-wrap">
        <img
          src={ICON_SRC}
          alt="SuperNova"
          className="ownership-disclaimer-icon"
          width={120}
          height={120}
        />
      </div>
      <h3 className="ownership-disclaimer-brand">SuperNova</h3>
      <p className="ownership-disclaimer-title">{t("settings.ownership.title")}</p>
      <div className="ownership-disclaimer-body">
        <p>
          <strong>{t("settings.ownership.conceptLabel")}</strong> {t("settings.ownership.author")}
        </p>
        <p>
          <strong>{t("settings.ownership.descriptionLabel")}</strong>{" "}
          {t("settings.ownership.description")}
        </p>
        <p>
          <strong>{t("settings.ownership.noticeLabel")}</strong> {t("settings.ownership.notice")}
        </p>
        <p>
          <strong>{t("settings.ownership.responsibilityLabel")}</strong>{" "}
          {t("settings.ownership.responsibility")}
        </p>
      </div>
    </div>
  );
}
