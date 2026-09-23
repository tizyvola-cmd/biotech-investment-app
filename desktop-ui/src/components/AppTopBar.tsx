import type { AppScreen } from "../types";
import { SCREEN_LABEL_KEYS } from "./AppSidebar";
import { RefreshLiveBadge } from "./RefreshDataModal";
import {
  setRefreshModalOpen,
  setWeeklyFullServerRunningOpen,
  useRefreshStatus,
} from "../shared/refreshStatusStore";
import { useLang, useT } from "../shared/i18n";
import { getRemoteApiBase, isRemoteDataMode } from "../shared/remoteHost";
import { CatalystTopRefresh } from "./CatalystTopRefresh";
import { DESK_CALENDAR_HORIZON_DAYS } from "../sheet/deskCalendarEvents";

export function AppTopBar({
  screen,
  desktopManifest: _desktopManifest,
  apiOk,
  status: _status,
  canGoBack = false,
  previousScreen = null,
  onGoBack,
  accountEmail: _accountEmail = null,
  onSwitchAccount: _onSwitchAccount,
  onSignOutAccount: _onSignOutAccount,
  showApiOffline = false,
}: {
  screen: AppScreen;
  desktopManifest: string | null;
  apiOk: boolean | null;
  status: { workbook_mtime?: string | null } | null;
  canGoBack?: boolean;
  previousScreen?: AppScreen | null;
  onGoBack?: () => void;
  /** @deprecated Top nav replaced the hamburger menu. */
  onMenuOpen?: () => void;
  /**
   * Email still required at login and stored in the tester registry —
   * intentionally not shown in the top bar (server / shared UI).
   */
  accountEmail?: string | null;
  onSwitchAccount?: () => void;
  onSignOutAccount?: () => void;
  /** Owner/admin only — testers must not see operational «API offline» signals. */
  showApiOffline?: boolean;
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
  const catalystTopRefresh = screen === "catalystDesk";

  const backTitle =
    previousScreen != null
      ? t("topbar.backTo", { screen: t(SCREEN_LABEL_KEYS[previousScreen]) })
      : t("topbar.back");

  return (
    <header className="h-[48px] shrink-0 flex items-center gap-3 px-4 sm:px-5 bg-[rgb(var(--bg-deep))]">
      <div className="flex items-center gap-2 min-w-0">
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
          <h1 className="text-[18px] font-semibold tracking-tight truncate text-ink">
            {screen === "catalystDesk"
              ? lang === "it"
                ? `Prossimi ${DESK_CALENDAR_HORIZON_DAYS} Catalyst Days`
                : `Next ${DESK_CALENDAR_HORIZON_DAYS} Catalyst Days`
              : t(SCREEN_LABEL_KEYS[screen])}
          </h1>
          <span className="text-[12px] text-ink-muted hidden sm:inline">{today}</span>
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
            onOpenModal={() => {
              if (life.fromServerWeeklyFull && life.state === "running") {
                setWeeklyFullServerRunningOpen(true);
                return;
              }
              setRefreshModalOpen(true);
            }}
          />
        )}
        {apiOk === false && showApiOffline && (
          <span className="text-[10px] text-[rgb(var(--signal-down))] font-medium">{t("topbar.apiOffline")}</span>
        )}
        {/* Catalyst: Refresh top-right. Signal bell removed. Zoom lives bottom-right. */}
        {catalystTopRefresh ? <CatalystTopRefresh /> : null}
      </div>
    </header>
  );
}
