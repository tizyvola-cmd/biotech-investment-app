import { useMobileLang } from "../hooks/useMobileLang";

type Props = {
  backLabel: string;
  onBack: () => void;
  onMenu?: () => void;
};

export function OpportunityScreenNav({ backLabel, onBack, onMenu }: Props) {
  const { t } = useMobileLang();
  return (
    <header className="opp-screen-nav">
      <button type="button" className="opp-nav-back" onClick={onBack}>
        ← {backLabel}
      </button>
      <span className="opp-nav-title">{t("nav.opportunity")}</span>
      <button type="button" className="opp-nav-menu" onClick={onMenu} aria-label={t("common.menu")}>
        ⋯
      </button>
    </header>
  );
}
