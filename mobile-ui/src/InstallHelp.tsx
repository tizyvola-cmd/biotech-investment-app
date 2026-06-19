import { DEFAULT_VPS_HOST } from "./remoteHost";
import { useMobileLang } from "./hooks/useMobileLang";

function mobileInstallHost(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return DEFAULT_VPS_HOST.replace(/\/$/, "");
}

export function InstallHelp({ compact }: { compact?: boolean }) {
  const { t } = useMobileLang();
  const host = mobileInstallHost();

  if (compact) {
    return (
      <details className="install-help-compact">
        <summary>{t("install.compactSummary")}</summary>
        <p className="hint">{t("install.compactHint")}</p>
      </details>
    );
  }

  return (
    <div className="card install-help">
      <h2>{t("install.title")}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("install.hint", { host })}
      </p>

      <details>
        <summary>{t("install.iosTitle")}</summary>
        <ol>
          <li>{t("install.ios1")}</li>
          <li>{t("install.ios2")}</li>
        </ol>
      </details>

      <details>
        <summary>{t("install.androidTitle")}</summary>
        <ol>
          <li>{t("install.android1")}</li>
          <li>{t("install.android2")}</li>
        </ol>
      </details>
    </div>
  );
}
