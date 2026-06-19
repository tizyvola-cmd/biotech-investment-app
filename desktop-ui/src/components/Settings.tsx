import { THEME_OPTIONS, applyThemeToDocument, type ResolvedTheme } from "../sheet/themePrefs";
import { getStoredToken, hasStoredApiToken, setStoredToken, verifyApiToken } from "../api/supernova";
import type { ApiStatus } from "../types";
import { useLang, useT, type AppLang } from "../shared/i18n";
import {
  defaultRemoteHostHint,
  initialRemoteUrl,
  isRemoteDataMode,
  isLocalDesktopShell,
  resolveApiBase,
  setRemoteApiBase,
} from "../shared/remoteHost";
import { useState } from "react";
import {
  loadMarketGateBypass,
  saveMarketGateBypass,
} from "../sheet/marketContextGate";
import { ThemeSelector } from "./settings/ThemeSelector";

export function Settings({
  apiOk,
  status,
  log,
  onRefreshStatus,
  busy,
  theme,
  onTheme,
  refreshError,
}: {
  apiOk: boolean | null;
  status: ApiStatus | null;
  log: string;
  onRefreshStatus: () => void;
  busy: boolean;
  theme: ResolvedTheme;
  onTheme: (t: ResolvedTheme) => void;
  refreshError?: string | null;
}) {
  const t = useT();
  const { lang, setLang } = useLang();

  const [remoteUrl, setRemoteUrl] = useState(() => initialRemoteUrl());
  const [gateBypass, setGateBypass] = useState(() => loadMarketGateBypass());
  const [apiTokenInput, setApiTokenInput] = useState(() => getStoredToken());
  const [tokenSaved, setTokenSaved] = useState(() => hasStoredApiToken());
  const [tokenTestMsg, setTokenTestMsg] = useState<string | null>(null);
  const [tokenTestErr, setTokenTestErr] = useState<string | null>(null);
  const [tokenTesting, setTokenTesting] = useState(false);
  const remoteActive = isRemoteDataMode();
  const electronLocal = isLocalDesktopShell();
  const serverNeedsToken = status?.api_token_required === true;
  const serverTokenBroken = status?.api_token_is_placeholder === true;
  const remotePlaceholder = t("settings.remote.urlPlaceholder");

  const applyRemoteHost = (url: string) => {
    setRemoteApiBase(url);
    window.location.reload();
  };

  const connectRemote = () => {
    const url = remoteUrl.trim() || defaultRemoteHostHint();
    if (!url) return;
    applyRemoteHost(url);
  };

  const LANG_OPTIONS: { id: AppLang; labelKey: "settings.language.en" | "settings.language.it" }[] = [
    { id: "en", labelKey: "settings.language.en" },
    { id: "it", labelKey: "settings.language.it" },
  ];

  async function handleTestToken() {
    setTokenTesting(true);
    setTokenTestMsg(null);
    setTokenTestErr(null);
    setStoredToken(apiTokenInput);
    setTokenSaved(hasStoredApiToken());
    try {
      await verifyApiToken();
      setTokenTestMsg(t("settings.api.tokenTestOk"));
    } catch (e) {
      setTokenTestErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTokenTesting(false);
    }
  }

  return (
    <section className="card p-5 space-y-5 max-w-2xl pb-8">
      <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
      <p className="text-xs text-ink-muted -mt-3">{t("settings.intro")}</p>

      {refreshError ? (
        <p className="text-xs text-negative rounded-lg border border-negative/30 bg-negative/5 px-3 py-2">
          {refreshError}
        </p>
      ) : null}

      {/* ── Market context gate override ── */}
      <div className="rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-3 space-y-2">
        <h3 className="text-sm font-semibold text-amber-300">{t("settings.marketGate.title")}</h3>
        <p className="text-xs text-ink-muted leading-snug">{t("settings.marketGate.hint")}</p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={gateBypass}
            onChange={(e) => {
              const on = e.target.checked;
              setGateBypass(on);
              saveMarketGateBypass(on);
            }}
          />
          {t("settings.marketGate.bypass")}
        </label>
      </div>

      {/* ── Language toggle ── */}
      <div>
        <p className="text-sm text-ink-muted mb-2">{t("settings.section.language")}</p>
        <div className="flex flex-wrap gap-2">
          {LANG_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`btn-ghost ${lang === opt.id ? "ring-2 ring-accent" : ""}`}
              onClick={() => setLang(opt.id)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-muted">{t("settings.language.hint")}</p>
      </div>

      <div>
        <p className="text-sm text-ink-muted mb-2">{t("settings.section.theme")}</p>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ id, label, hint }) => {
            const active = theme === id;
            return (
              <button
                key={id}
                type="button"
                title={hint}
                className="theme-mode-btn rounded-lg px-3 py-1.5 text-sm font-medium transition"
                style={{
                  border: active
                    ? "2px solid var(--sn-primary, #6b4fc8)"
                    : "1px solid var(--sn-border, #c2bae0)",
                  background: active
                    ? "var(--sn-primary-pale, #ede9f9)"
                    : "var(--sn-surface-raised, #fff)",
                  color: active ? "var(--sn-primary-dark, #4a3296)" : "var(--sn-text)",
                }}
                onClick={() => {
                  applyThemeToDocument(id);
                  onTheme(id);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-ink-muted">{t("settings.theme.modeHint")}</p>
      </div>

      <section className="rounded-lg border border-[var(--sn-border-subtle)] bg-[rgb(var(--surface-elevated))] px-3 py-3 space-y-2">
        <h3 className="text-sm font-semibold text-[var(--sn-text)]">
          {t("settings.section.appearance")}
        </h3>
        <ThemeSelector />
      </section>

      {/* ── Remote VPS ── */}
      <div className="settings-cursor-panel rounded-lg border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/8 px-3 py-3 space-y-2">
        <h3 className="text-sm font-semibold text-[rgb(var(--accent))]">
          {t("settings.section.remote")}
        </h3>
        <p className="text-xs text-ink-muted leading-snug">
          {remoteActive ? t("settings.remote.active") : t("settings.remote.inactive")}
        </p>
        {!remoteActive && remoteUrl.trim() ? (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400 leading-snug">
            {t("settings.remote.pendingConnect")}
          </p>
        ) : null}
        <label className="text-xs text-ink-muted block" htmlFor="remote-server-url">
          {t("settings.remote.urlLabel")}
        </label>
        <input
          id="remote-server-url"
          className="input font-mono text-xs w-full"
          type="url"
          value={remoteUrl}
          placeholder={remotePlaceholder}
          onChange={(e) => setRemoteUrl(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={connectRemote}
          >
            {t("settings.remote.connect")}
          </button>
          {remoteActive ? (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => applyRemoteHost("")}
            >
              {t("settings.remote.disconnect")}
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setRemoteUrl(defaultRemoteHostHint())}
            >
              VPS
            </button>
          )}
        </div>
        <p className="text-[10px] text-ink-muted leading-snug">{t("settings.remote.hint")}</p>
        {electronLocal ? (
          <p className="text-[10px] text-emerald-700 dark:text-emerald-400 leading-snug">
            {t("settings.remote.electronLocal")}
          </p>
        ) : null}
      </div>

      <div>
        <p className="text-sm text-ink-muted mb-2">
          {remoteActive
            ? t("settings.section.apiRemote", { host: resolveApiBase() })
            : t("settings.section.api")}
        </p>
        <p className="text-sm">
          {t("settings.api.status")}{" "}
          <span className={apiOk ? "text-positive" : "text-negative"}>
            {apiOk === null ? "—" : apiOk ? t("common.online") : t("common.offline")}
          </span>
        </p>
        {!remoteActive ? (
          <p className="mt-1 text-[10px] text-ink-muted leading-snug">
            {t("settings.api.localOnlyHint")}
          </p>
        ) : null}
        {status && (
          <ul className="mt-2 text-sm text-ink-muted space-y-1">
            <li>
              {t("settings.api.dailyRefresh")}{" "}
              {status.refresh_running ? t("settings.api.running") : t("settings.api.stopped")}
            </li>
            <li>
              {t("settings.api.orchestrator")}{" "}
              {status.orchestrator_running
                ? t("settings.api.running")
                : t("settings.api.stopped")}
            </li>
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-muted">{t("settings.api.refreshTabHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onRefreshStatus}>
            {t("settings.api.refreshStatus")}
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm text-ink-muted block mb-1" htmlFor="api-token">
          {t("settings.api.tokenLabel")}
        </label>
        {serverNeedsToken ? (
          <p
            className={`mb-2 text-xs rounded-lg border px-3 py-2 ${
              tokenSaved && !serverTokenBroken
                ? "border-emerald-500/35 bg-emerald-500/8 text-emerald-800 dark:text-emerald-200"
                : "border-amber-500/35 bg-amber-500/8 text-amber-900 dark:text-amber-100"
            }`}
          >
            {serverTokenBroken
              ? t("settings.api.tokenServerPlaceholder")
              : tokenSaved
                ? t("settings.api.tokenSavedOk")
                : t("settings.api.tokenMissingHint")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            id="api-token"
            className="input font-mono text-xs flex-1 min-w-[12rem]"
            type="password"
            value={apiTokenInput}
            placeholder={t("settings.api.tokenPlaceholder")}
            autoComplete="off"
            onChange={(e) => setApiTokenInput(e.target.value)}
          />
          <button
            type="button"
            className="btn-ghost shrink-0"
            onClick={() => {
              setStoredToken(apiTokenInput);
              setTokenSaved(hasStoredApiToken());
              setTokenTestMsg(null);
              setTokenTestErr(null);
            }}
          >
            {t("settings.api.tokenSave")}
          </button>
          <button
            type="button"
            className="btn-ghost shrink-0"
            disabled={tokenTesting || !apiTokenInput.trim()}
            onClick={() => void handleTestToken()}
          >
            {tokenTesting ? "…" : t("settings.api.tokenTest")}
          </button>
          {tokenSaved ? (
            <button
              type="button"
              className="btn-ghost shrink-0 text-ink-muted"
              onClick={() => {
                setApiTokenInput("");
                setStoredToken("");
                setTokenSaved(false);
              }}
            >
              {t("settings.api.tokenClear")}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {t("settings.api.tokenHint", {
            var: "VITE_SUPERNOVA_API_TOKEN",
            file: ".env.local",
          })}
        </p>
        <p className="mt-1 text-[10px] text-ink-muted leading-snug">
          {t("settings.api.tokenPersistHint")}
        </p>
        {tokenTestMsg ? (
          <p className="mt-2 text-xs text-positive">{tokenTestMsg}</p>
        ) : null}
        {tokenTestErr ? (
          <p className="mt-2 text-xs text-negative leading-snug">{tokenTestErr}</p>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">{t("settings.section.orchLog")}</h3>
        <pre className="max-h-40 min-h-[5rem] overflow-auto rounded-lg bg-surface p-3 text-xs text-ink-muted whitespace-pre-wrap">
          {log || t("settings.log.empty")}
        </pre>
      </div>

      <div className="text-xs text-ink-muted border-t border-[rgb(var(--border))] pt-4 space-y-1">
        <p>
          {t("settings.footer.localData", { file: "data/*_sheet_snapshot.json" })}
        </p>
        <p>{t("settings.footer.dashboard", { file: "data/past_catalyst_predictions.json" })}</p>
        <p>
          {t("settings.footer.afterRefresh", {
            script: "scripts\\Export_Desktop_Snapshots.bat",
          })}
        </p>
        <p>{t("settings.footer.startApp", { script: "scripts\\Avvia_Biotech_Desktop.bat" })}</p>
      </div>
    </section>
  );
}
