import { useEffect, useRef, useState, memo, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import type { AppScreen } from "../types";
import { useT, type TranslationKey } from "../shared/i18n";
import {
  canOpenScreenInNewWindow,
  openScreenInNewWindow,
} from "../shared/screenDeepLink";
import type { LossAnalysisProfile } from "../sheet/portfolioLossAnalysis";

type NavItem = {
  id: AppScreen;
  labelKey: TranslationKey;
  badge?: number;
};

type NavSection = {
  titleKey: TranslationKey;
  items: NavItem[];
};

/** Brand mark — readable supernova burst (not a tiny glyph on a gradient). */
function SuperNovaBrandMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--warn))]">
      <path
        fill="currentColor"
        d="M12 2l1.2 5.4 4.8-2.8-2.2 5.1 5.4.6-4.6 2.7 3.2 4.4-5.2-1.5-.6 5.4-2.8-4.7-2.8 4.7-.6-5.4-5.2 1.5 3.2-4.4L2.8 10.3l5.4-.6L6 4.6l4.8 2.8L12 2z"
      />
    </svg>
  );
}

const SECTIONS: NavSection[] = [
  {
    titleKey: "sidebar.section.overview",
    items: [
      {
        id: "catalystDesk",
        labelKey: "sidebar.item.catalystDesk",
      },
    ],
  },
  {
    titleKey: "sidebar.section.research",
    items: [
      { id: "calendar", labelKey: "sidebar.item.calendar" },
      { id: "discovery", labelKey: "sidebar.item.discovery" },
    ],
  },
];

const SCREEN_LABEL_KEYS: Record<AppScreen, TranslationKey> = {
  main: "sidebar.item.mainDashboard",
  catalyst: "sidebar.item.catalystHub",
  simulation: "sidebar.item.simulation",
  clinical: "sidebar.item.clinical",
  secK8: "sidebar.item.secK8",
  decisionLab: "sidebar.item.decisionLab",
  catalystDesk: "sidebar.item.catalystDesk",
  wind: "sidebar.item.wind",
  piggyBank: "sidebar.item.piggyBank",
  financial: "sidebar.item.financial",
  models: "sidebar.item.modelAnalysis",
  catalystFeed: "sidebar.item.catalystFeed",
  eisDeepDive: "sidebar.item.eisDeepDive",
  calendar: "sidebar.item.calendar",
  discovery: "sidebar.item.discovery",
  testerMonitor: "sidebar.item.testerMonitor",
  system: "sidebar.item.system",
};

export { SCREEN_LABEL_KEYS };

type CtxMenu = { screen: AppScreen; x: number; y: number };

/** Cursor-style top navigation — tabs across the top, not a left rail. */
export const AppSidebar = memo(function AppSidebar({
  screen,
  onScreen,
  onEvalLabNav: _onEvalLabNav,
  apiOk: _apiOk,
  showAccessAdmin = false,
  showSystemAdmin = false,
  accountEmail = null,
  onSignOut,
  accessAlertCount = 0,
}: {
  screen: AppScreen;
  onScreen: (s: AppScreen) => void;
  onEvalLabNav?: (profile: LossAnalysisProfile) => void;
  apiOk: boolean | null;
  /** Owner-only Access admin tab (approve users + usage minutes). */
  showAccessAdmin?: boolean;
  /** Owner-only System tab (themes, remote, token). */
  showSystemAdmin?: boolean;
  accountEmail?: string | null;
  onSignOut?: () => void;
  /** Pending Access inbox items (Basic / Premium / Contact / UI issues) → 🔔. */
  accessAlertCount?: number;
  /** Kept for App.tsx compatibility; top nav is always visible. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const t = useT();
  const allowPopout = canOpenScreenInNewWindow();
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  /** Paint the clicked tab immediately — App's screen update can lag Home. */
  const [pendingScreen, setPendingScreen] = useState<AppScreen | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pendingScreen != null && pendingScreen === screen) {
      setPendingScreen(null);
    }
  }, [screen, pendingScreen]);

  const visualScreen = pendingScreen ?? screen;
  /** Set on pointerdown so the following click does not call navigate twice. */
  const pointerNavRef = useRef<AppScreen | null>(null);

  const go = (id: AppScreen) => {
    if (id === screen && pendingScreen == null) return;
    // Already arming this tab — ignore duplicate (mousedown + click used to fire twice).
    if (pendingScreen === id) return;
    // Highlight this tab before App swaps the heavy desk (navigateTo waits for paint).
    flushSync(() => setPendingScreen(id));
    onScreen(id);
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [ctxMenu]);

  const openPopout = (id: AppScreen) => {
    setCtxMenu(null);
    openScreenInNewWindow(id);
  };

  const navButtonProps = (
    id: AppScreen,
    active: boolean,
    variant: "pill" | "link" = "pill",
  ) => ({
    type: "button" as const,
    className: `app-sidebar-nav-btn ${variant === "link" ? "app-sidebar-nav-btn--link" : ""} relative z-10 cursor-pointer inline-flex items-center gap-1.5 shrink-0 text-[13px] font-medium transition-[color,background-color] duration-75 ${
      variant === "pill"
        ? `rounded-full px-3.5 py-1.5 ${
            active
              ? "bg-[rgb(var(--accent))] text-white"
              : "text-ink-muted hover:text-ink hover:bg-[rgb(var(--accent))]/12"
          }`
        : `rounded-md px-2 py-1 ${
            active
              ? "text-[rgb(var(--purple-soft))]"
              : "text-ink-muted hover:text-ink"
          }`
    }`,
    "aria-current": active ? ("page" as const) : undefined,
    "data-screen": id,
    onMouseDown: (e: MouseEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      pointerNavRef.current = id;
      go(id);
    },
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      // Mouse: already handled on mousedown. Keyboard (Enter/Space): no prior arm.
      if (pointerNavRef.current === id) {
        pointerNavRef.current = null;
        return;
      }
      go(id);
    },
    onAuxClick: (e: MouseEvent<HTMLButtonElement>) => {
      if (!allowPopout || e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      openPopout(id);
    },
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
      if (!allowPopout) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ screen: id, x: e.clientX, y: e.clientY });
    },
    title: allowPopout ? t("sidebar.openInNewWindowTip") : undefined,
  });

  return (
    <aside
      className="app-sidebar relative z-[60] isolate pointer-events-auto flex shrink-0 items-center gap-3 h-12 min-h-12 w-full border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--bg-deep))] px-3 sm:px-4"
      aria-label="Main"
    >
      <div className="flex items-center gap-2 shrink-0">
        <SuperNovaBrandMark />
        <p className="font-bold text-[13px] tracking-[0.2em] leading-none hidden sm:block uppercase">
          SuperNova
        </p>
      </div>

      <nav className="app-sidebar-nav flex flex-1 items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden py-0.5">
        {SECTIONS.flatMap((section) => section.items).map((item) => {
          const active = visualScreen === item.id;
          return (
            <button key={item.id} {...navButtonProps(item.id, active)}>
              <span className="whitespace-nowrap pointer-events-none">{t(item.labelKey)}</span>
              {item.badge != null && (
                <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-accent/20 text-accent">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {showAccessAdmin || showSystemAdmin || onSignOut ? (
        <div className="flex items-center gap-1.5 shrink-0">
          {showAccessAdmin ? (
            <button
              {...navButtonProps("testerMonitor", visualScreen === "testerMonitor", "link")}
              title={
                accessAlertCount > 0
                  ? t("sidebar.accessAlertTip", { n: accessAlertCount })
                  : allowPopout
                    ? t("sidebar.openInNewWindowTip")
                    : undefined
              }
            >
              <span className="pointer-events-none inline-flex items-center gap-1">
                {t("sidebar.item.testerMonitor")}
                {accessAlertCount > 0 ? (
                  <span
                    className="inline-flex items-center gap-0.5 text-[12px] leading-none"
                    aria-label={t("sidebar.accessAlertTip", { n: accessAlertCount })}
                  >
                    <span aria-hidden>🔔</span>
                    {accessAlertCount > 1 ? (
                      <span className="text-[9px] font-bold tabular-nums text-[rgb(var(--warn))]">
                        {accessAlertCount > 99 ? "99+" : accessAlertCount}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </button>
          ) : null}
          {showSystemAdmin ? (
            <button {...navButtonProps("system", visualScreen === "system", "link")}>
              <span className="pointer-events-none">{t("sidebar.item.system")}</span>
            </button>
          ) : null}
          {onSignOut ? (
            <button
              type="button"
              className="app-sidebar-nav-btn app-sidebar-nav-btn--link relative z-10 cursor-pointer inline-flex items-center gap-1.5 shrink-0 rounded-md px-2 py-1 text-[13px] font-medium text-ink-muted hover:text-ink"
              title={accountEmail || t("sidebar.item.system")}
              onClick={onSignOut}
            >
              <span className="pointer-events-none">{t("topbar.signOut")}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {ctxMenu ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[80] min-w-[11rem] rounded-lg border border-[rgb(var(--border))]/70 bg-[rgb(var(--surface-elevated))] shadow-lg py-1 text-[11px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="w-full text-left px-3 py-1.5 hover:bg-[rgb(var(--panel-feed-row-hover))]/90 text-ink"
            onClick={() => openPopout(ctxMenu.screen)}
          >
            {t("sidebar.openInNewWindow")}
          </button>
        </div>
      ) : null}
    </aside>
  );
});
