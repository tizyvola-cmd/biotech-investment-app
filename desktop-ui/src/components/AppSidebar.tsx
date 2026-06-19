import type { AppScreen } from "../types";
import { useT, type TranslationKey } from "../shared/i18n";

type NavItem = {
  id: AppScreen;
  icon: string;
  labelKey: TranslationKey;
  badge?: number;
};

type NavSection = {
  titleKey: TranslationKey;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    titleKey: "sidebar.section.overview",
    items: [
      { id: "main", icon: "🏠", labelKey: "sidebar.item.mainDashboard" },
    ],
  },
  {
    titleKey: "sidebar.section.portfolio",
    items: [
      { id: "simulation", icon: "💼", labelKey: "sidebar.item.simulation" },
      { id: "decisionLab", icon: "🎯", labelKey: "sidebar.item.decisionLab" },
    ],
  },
  {
    titleKey: "sidebar.section.market",
    items: [
      { id: "catalyst", icon: "⚡", labelKey: "sidebar.item.catalystHub", badge: 5 },
    ],
  },
  {
    titleKey: "sidebar.section.analyze",
    items: [
      { id: "models", icon: "🧠", labelKey: "sidebar.item.modelAnalysis" },
    ],
  },
  {
    titleKey: "sidebar.section.research",
    items: [
      { id: "clinical", icon: "🔬", labelKey: "sidebar.item.clinical" },
      { id: "catalystFeed", icon: "📰", labelKey: "sidebar.item.catalystFeed" },
      { id: "financial", icon: "💰", labelKey: "sidebar.item.financial" },
    ],
  },
  {
    titleKey: "sidebar.section.collab",
    items: [
      { id: "testerMonitor", icon: "📱", labelKey: "sidebar.item.testerMonitor" },
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
  financial: "sidebar.item.financial",
  models: "sidebar.item.modelAnalysis",
  catalystFeed: "sidebar.item.catalystFeed",
  testerMonitor: "sidebar.item.testerMonitor",
  system: "sidebar.item.system",
};

export { SCREEN_LABEL_KEYS };

export function AppSidebar({
  screen,
  onScreen,
  apiOk,
  mobileOpen = false,
  onCloseMobile,
}: {
  screen: AppScreen;
  onScreen: (s: AppScreen) => void;
  apiOk: boolean | null;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const t = useT();
  return (
    <aside
      className={`app-sidebar flex flex-col flex-shrink-0 border-r border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] min-w-[220px] w-[var(--sidebar-w,220px)]${
        mobileOpen ? " app-sidebar--open" : ""
      }`}
      aria-hidden={onCloseMobile != null && !mobileOpen ? true : undefined}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-[rgb(var(--border))]/60 mb-1">
        <div
          className="w-7 h-7 rounded-[7px] flex items-center justify-center text-sm shadow-[0_0_12px_rgb(var(--accent)/0.4)]"
          style={{ background: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--purple-soft)))" }}
        >
          ✦
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[15px] tracking-tight leading-tight">SuperNova</p>
          <p className="text-[9px] text-ink-muted uppercase tracking-[0.12em]">{t("sidebar.brand.tagline")}</p>
        </div>
        {onCloseMobile ? (
          <button
            type="button"
            className="app-sidebar-close lg:hidden shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[rgb(var(--border))]/60 text-ink-muted hover:text-ink hover:bg-[rgb(var(--panel-feed-row-hover))]/80 transition"
            onClick={onCloseMobile}
            aria-label={t("topbar.closeMenu")}
          >
            ✕
          </button>
        ) : null}
      </div>

      <nav className="app-sidebar-nav flex flex-col flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 min-h-0">
        {SECTIONS.map((section) => (
          <div key={section.titleKey} className="mb-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted/70 px-3 py-2">
              {t(section.titleKey)}
            </p>
            {section.items.map((item) => {
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 mb-0.5 text-xs font-medium transition ${
                    active
                      ? "bg-accent/15 text-accent"
                      : "text-ink-muted hover:bg-[rgb(var(--panel-feed-row-hover))]/80 hover:text-accent"
                  }`}
                  onClick={() => onScreen(item.id)}
                >
                  <span className="text-sm opacity-90">{item.icon}</span>
                  <span className="truncate text-left">{t(item.labelKey)}</span>
                  {item.badge != null && (
                    <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent/20 text-accent">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-[rgb(var(--border))]/60 px-2 pt-2 pb-3">
        <button
          type="button"
          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
            screen === "system"
              ? "bg-accent/15 text-accent"
              : "text-ink-muted hover:bg-[rgb(var(--panel-feed-row-hover))]/80 hover:text-accent"
          }`}
          onClick={() => onScreen("system")}
        >
          <span className="text-sm">⚙</span>
          {t("sidebar.item.system")}
        </button>
        <ModelStatusCard apiOk={apiOk} />
      </div>
    </aside>
  );
}

function ModelStatusCard({ apiOk }: { apiOk: boolean | null }) {
  return (
    <div className="sidebar-model-status mx-1 mt-2 px-2.5 py-2 rounded-lg bg-[rgb(var(--panel-feed-row-hover))]/70 border border-[rgb(var(--panel-feed-border))]/40 flex items-center gap-2">
      <span
        className={`w-[7px] h-[7px] rounded-full shrink-0 ${
          apiOk === false ? "bg-[rgb(var(--signal-down))]" : "bg-[rgb(var(--signal-up))] animate-pulse"
        }`}
        style={
          apiOk !== false ? { boxShadow: "0 0 6px rgb(var(--signal-up))" } : undefined
        }
      />
      <span className="text-[11px] text-ink-muted">Model v4</span>
      <span className="sidebar-model-status-value text-[11px] font-semibold ml-auto tabular-nums">MAE 13pp</span>
    </div>
  );
}
