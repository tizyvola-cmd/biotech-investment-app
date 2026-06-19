import type { ReactNode } from "react";
import type { AppScreen } from "../types";
import { SCREEN_LABEL_KEYS } from "./AppSidebar";
import { RefreshLiveBadge } from "./InvestmentDecisionLabView";
import { setRefreshModalOpen, useRefreshStatus } from "../shared/refreshStatusStore";
import { useLang, useT } from "../shared/i18n";
import { getRemoteApiBase, isRemoteDataMode } from "../shared/remoteHost";

export function AppTopBar({
  screen,
  desktopManifest: _desktopManifest,
  apiOk,
  status: _status,
  notificationBell,
  canGoBack = false,
  previousScreen = null,
  onGoBack,
  onMenuOpen,
}: {
  screen: AppScreen;
  desktopManifest: string | null;
  apiOk: boolean | null;
  status: { workbook_mtime?: string | null } | null;
  notificationBell?: ReactNode;
  canGoBack?: boolean;
  previousScreen?: AppScreen | null;
  onGoBack?: () => void;
  onMenuOpen?: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const { life, finishedAt } = useRefreshStatus();
  const showRefreshBadge = life.state !== "idle";
  const remoteActive = isRemoteDataMode();
  const remoteHost = getRemoteApiBase();
  const locale = lang === "it" ? "it-IT" : "en-US";
  const today = new Date().toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const backTitle =
    previousScreen != null
      ? t("topbar.backTo", { screen: t(SCREEN_LABEL_KEYS[previousScreen]) })
      : t("topbar.back");

  return (
    <header className="h-[52px] shrink-0 flex items-center gap-3 px-4 sm:px-5 border-b border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))]">
      <div className="flex items-center gap-2 min-w-0">
        {onMenuOpen ? (
          <button
            type="button"
            className="lg:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-2))]/80 text-ink hover:border-[rgb(var(--accent))]/40 hover:bg-[rgb(var(--accent))]/8 transition-colors"
            onClick={onMenuOpen}
            aria-label={t("topbar.openMenu")}
          >
            <span className="text-lg leading-none" aria-hidden>
              ☰
            </span>
          </button>
        ) : null}
        {canGoBack && onGoBack ? (
          <button
            type="button"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-2))]/80 text-ink-muted hover:text-ink hover:border-[rgb(var(--accent))]/40 hover:bg-[rgb(var(--accent))]/8 transition-colors"
            onClick={onGoBack}
            title={backTitle}
            aria-label={backTitle}
          >
            <span className="text-base leading-none" aria-hidden>
              ←
            </span>
          </button>
        ) : null}
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-[15px] font-bold tracking-tight truncate">
            {t(SCREEN_LABEL_KEYS[screen])}
          </h1>
          <span className="text-[11px] text-ink-muted hidden sm:inline">{today}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {remoteActive && remoteHost ? (
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))] border border-[rgb(var(--accent))]/30 hidden sm:inline truncate max-w-[140px]"
            title={remoteHost}
          >
            {t("topbar.remoteServer")} · {remoteHost.replace(/^https?:\/\//, "")}
          </span>
        ) : null}
        {showRefreshBadge && (
          <RefreshLiveBadge
            info={life}
            finishedAt={finishedAt}
            onOpenModal={() => setRefreshModalOpen(true)}
          />
        )}
        {apiOk === false && (
          <span className="text-[10px] text-[rgb(var(--signal-down))] font-medium">{t("topbar.apiOffline")}</span>
        )}
        {notificationBell}
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--purple-soft)))" }}
          title="User"
        >
          TR
        </div>
      </div>
    </header>
  );
}
