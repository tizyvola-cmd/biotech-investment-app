import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { InstallHelp } from "./InstallHelp";
import { BrandMark } from "./components/MobileUi";
import { OwnershipDisclaimer } from "./components/OwnershipDisclaimer";
import { ThemeToggle } from "./components/ThemeToggle";
import { fetchRefreshStatus, runRefreshProfile } from "./api";
import { useMobileLang } from "./hooks/useMobileLang";
import type { MobileLang } from "./langStorage";
import type { MobileTheme } from "./hooks/useTheme";
import {
  disableActionPush,
  enableActionPush,
  getActionPushStatus,
  isPushPrefEnabled,
  refreshActionPushStatus,
  type ActionPushStatus,
} from "./mobilePushClient";

/** Mobile companion is dashboard-only (desktop keeps Piggy / trades). */
export type TabId = "dashboard";

type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  apiBaseInput: string;
  setApiBaseInput: (v: string) => void;
  apiTokenInput: string;
  setApiTokenInput: (v: string) => void;
  inputsUpdatedAt: string | null;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
  onPipelineDone?: () => void;
  connectionLabel: string;
  apiOk?: boolean | null;
  testerEmail?: string | null;
  onSignOutTester?: () => void;
};

export function SettingsSheet({
  open,
  onClose,
  apiBaseInput,
  setApiBaseInput,
  apiTokenInput,
  setApiTokenInput,
  inputsUpdatedAt,
  busy,
  onSave,
  onReset,
  onPipelineDone,
  connectionLabel,
  apiOk,
  testerEmail,
  onSignOutTester,
}: SettingsSheetProps) {
  const { lang, setLang, t, locale } = useMobileLang();
  const [pipeRunning, setPipeRunning] = useState(false);
  const [pipeProfile, setPipeProfile] = useState<string | null>(null);
  const [pipeMsg, setPipeMsg] = useState<string | null>(null);
  const [pipeErr, setPipeErr] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const wasRunningRef = useRef(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState<ActionPushStatus>(() => getActionPushStatus());
  const [pushErr, setPushErr] = useState<string | null>(null);
  const pushEnabled = isPushPrefEnabled() && pushStatus.permission === "granted" && pushStatus.subscribed;

  const syncRefreshStatus = useCallback(async () => {
    try {
      const st = await fetchRefreshStatus();
      setPipeRunning(!!st.running);
      setPipeProfile(st.profile ?? null);
      if (st.message) setPipeMsg(st.message);
      return st;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPipeErr(null);
    setPushErr(null);
    setPushStatus(getActionPushStatus());
    void refreshActionPushStatus().then(setPushStatus);
    void syncRefreshStatus();
  }, [open, syncRefreshStatus]);

  useEffect(() => {
    if (!open || !pipeRunning) return;
    const id = window.setInterval(() => void syncRefreshStatus(), 4000);
    return () => window.clearInterval(id);
  }, [open, pipeRunning, syncRefreshStatus]);

  useEffect(() => {
    if (wasRunningRef.current && !pipeRunning) {
      onPipelineDone?.();
    }
    wasRunningRef.current = pipeRunning;
  }, [pipeRunning, onPipelineDone]);

  const startProfile = async (profile: "daily" | "sunday") => {
    if (profile === "sunday" && !window.confirm(t("refresh.full.confirm"))) return;
    setPipeErr(null);
    setRefreshBusy(true);
    try {
      const res = await runRefreshProfile(profile);
      setPipeRunning(true);
      setPipeProfile(profile);
      setPipeMsg(res.hint ?? t("refresh.started"));
    } catch (e) {
      setPipeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshBusy(false);
    }
  };

  const pipelineBlocked = refreshBusy || pipeRunning || apiOk === false;

  if (!open) return null;

  return (
    <div className="sheet-root" role="dialog" aria-modal="true" aria-label={t("common.settings")}>
      <button type="button" className="sheet-backdrop" aria-label={t("common.close")} onClick={onClose} />
      <div className="sheet-panel">
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <h2>{t("common.settings")}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="hint sheet-connection">{connectionLabel}</p>
          {testerEmail ? (
            <p className="hint tester-settings-email">
              {t("tester.signedInAs")} <strong>{testerEmail}</strong>
            </p>
          ) : null}
          <div className="card sheet-card">
            <h3>{t("common.language")}</h3>
            <div className="lang-toggle-row" role="group" aria-label={t("common.language")}>
              {(["en", "it"] as MobileLang[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={lang === code ? "lang-toggle-btn active" : "lang-toggle-btn"}
                  aria-pressed={lang === code}
                  onClick={() => setLang(code)}
                >
                  {t(code === "en" ? "common.lang.en" : "common.lang.it")}
                </button>
              ))}
            </div>
          </div>
          <div className="card sheet-card">
            <h3>{t("connection.section")}</h3>
            <div className="field">
              <label>{t("connection.apiUrl")}</label>
              <input value={apiBaseInput} onChange={(e) => setApiBaseInput(e.target.value)} />
            </div>
            <div className="field">
              <label>{t("connection.apiToken")}</label>
              <input
                type="password"
                value={apiTokenInput}
                onChange={(e) => setApiTokenInput(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="hint">
              {t("connection.lastSync")}{" "}
              {inputsUpdatedAt ? new Date(inputsUpdatedAt).toLocaleString(locale) : "—"}
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>
                {busy ? "…" : t("connection.saveReload")}
              </button>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={onReset}>
                {t("connection.reconfigure")}
              </button>
            </div>
          </div>
          <div className="card sheet-card">
            <h3>{t("push.section")}</h3>
            <p className="hint">{t("push.sectionHint")}</p>
            <p className="hint">{t("push.iosNote")}</p>
            <p className="hint">
              {!pushStatus.supported
                ? t("push.status.unsupported")
                : pushStatus.permission === "denied"
                  ? t("push.status.denied")
                  : pushEnabled
                    ? t("push.status.subscribed")
                    : pushStatus.permission === "granted"
                      ? t("push.status.granted")
                      : t("push.status.default")}
            </p>
            {pushErr ? <p className="err">{t("push.status.error", { err: pushErr })}</p> : null}
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={pushBusy || !pushStatus.supported || pushStatus.permission === "denied"}
                onClick={() => {
                  setPushBusy(true);
                  setPushErr(null);
                  void enableActionPush()
                    .then((st) => setPushStatus(st))
                    .catch((e) => {
                      setPushErr(e instanceof Error ? e.message : String(e));
                      setPushStatus(getActionPushStatus());
                    })
                    .finally(() => setPushBusy(false));
                }}
              >
                {pushBusy ? "…" : t("push.enable")}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={pushBusy || !pushEnabled}
                onClick={() => {
                  setPushBusy(true);
                  setPushErr(null);
                  void disableActionPush()
                    .then((st) => setPushStatus(st))
                    .catch((e) => {
                      setPushErr(e instanceof Error ? e.message : String(e));
                      setPushStatus(getActionPushStatus());
                    })
                    .finally(() => setPushBusy(false));
                }}
              >
                {t("push.disable")}
              </button>
            </div>
          </div>
          <div className="card sheet-card">
            <h3>{t("refresh.section")}</h3>
            <p className="hint">{t("refresh.sectionHint")}</p>
            <div className="refresh-profile-card">
              <div className="refresh-profile-copy">
                <strong>{t("refresh.daily.title")}</strong>
                <p className="hint">{t("refresh.daily.detail")}</p>
                <p className="hint refresh-eta">{t("refresh.daily.eta")}</p>
              </div>
              <button
                type="button"
                className="btn btn-primary refresh-run-btn"
                disabled={pipelineBlocked}
                onClick={() => void startProfile("daily")}
              >
                {pipeRunning && pipeProfile === "daily" ? t("refresh.running") : t("refresh.daily.run")}
              </button>
            </div>
            <div className="refresh-profile-card refresh-profile-card--full">
              <div className="refresh-profile-copy">
                <strong>{t("refresh.full.title")}</strong>
                <p className="hint">{t("refresh.full.detail")}</p>
                <p className="hint refresh-eta">{t("refresh.full.eta")}</p>
              </div>
              <button
                type="button"
                className="btn btn-outline refresh-run-btn"
                disabled={pipelineBlocked}
                onClick={() => void startProfile("sunday")}
              >
                {pipeRunning && pipeProfile === "sunday" ? t("refresh.running") : t("refresh.full.run")}
              </button>
            </div>
            {pipeRunning ? (
              <p className="hint refresh-status refresh-status--running">
                {pipeProfile === "sunday" ? t("refresh.full.running") : t("refresh.daily.running")}
              </p>
            ) : null}
            {pipeMsg && !pipeErr ? (
              <p className="hint refresh-status">{pipeMsg}</p>
            ) : null}
            {pipeErr ? <p className="err refresh-status">{pipeErr}</p> : null}
          </div>
          {onSignOutTester ? (
            <div className="card sheet-card">
              <h3>{t("tester.account")}</h3>
              <p className="hint">{t("tester.signOutHint")}</p>
              <button type="button" className="btn btn-outline" onClick={onSignOutTester}>
                {t("tester.changeAccount")}
              </button>
            </div>
          ) : null}
          <InstallHelp compact />
          <div className="card sheet-card ownership-disclaimer-card">
            <OwnershipDisclaimer />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppHeader({
  tab,
  title,
  subtitle,
  onBack,
  onSettings,
  apiOk,
  theme,
  onToggleTheme,
  headerExtra,
}: {
  tab?: TabId;
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  onSettings?: () => void;
  apiOk?: boolean | null;
  theme?: MobileTheme;
  onToggleTheme?: () => void;
  headerExtra?: ReactNode;
}) {
  const { t } = useMobileLang();
  const heading = title ?? (tab === "dashboard" ? t("nav.dashboard") : "SuperNova");

  if (onBack) {
    return (
      <header className="app-header">
        <button type="button" className="back-btn" onClick={onBack} aria-label={t("common.back")}>
          ←
        </button>
        <div className="app-header-screen">
          <h1>{heading}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {theme && onToggleTheme ? <ThemeToggle theme={theme} onToggle={onToggleTheme} /> : null}
      </header>
    );
  }

  return (
    <header className="app-header">
      <BrandMark size="sm" />
      <div className="app-header-screen">
        <h1>{heading}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {headerExtra ? <div className="app-header-extra">{headerExtra}</div> : null}
      {apiOk === true ? <span className="status-pill">{t("common.online")}</span> : null}
      {theme && onToggleTheme ? <ThemeToggle theme={theme} onToggle={onToggleTheme} /> : null}
      {onSettings ? (
        <button type="button" className="gear-btn" aria-label={t("common.settings")} onClick={onSettings}>
          ⚙
        </button>
      ) : null}
    </header>
  );
}
