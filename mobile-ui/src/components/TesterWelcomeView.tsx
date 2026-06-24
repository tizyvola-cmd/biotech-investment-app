import { InstallHelp } from "../InstallHelp";
import { useMobileLang } from "../hooks/useMobileLang";

export function TesterWelcomeView({ onContinue }: { onContinue: () => void }) {
  const { t } = useMobileLang();

  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="card tester-welcome-card">
          <h2>{t("tester.welcomeTitle")}</h2>
          <p className="hint">{t("tester.welcomeBody")}</p>
          <InstallHelp />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={onContinue}>
              {t("tester.welcomeContinue")}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
