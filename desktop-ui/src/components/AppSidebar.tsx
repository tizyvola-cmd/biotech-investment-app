import type { AppScreen } from "../types";

type NavItem = {
  id: AppScreen;
  icon: string;
  label: string;
  badge?: number;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { id: "main", icon: "🏠", label: "Main Dashboard" },
    ],
  },
  {
    title: "Watch",
    items: [
      { id: "catalyst", icon: "⚡", label: "Catalyst Hub", badge: 5 },
      { id: "simulation", icon: "📈", label: "Simulation" },
    ],
  },
  {
    title: "Analyze",
    items: [
      { id: "decisionLab", icon: "📐", label: "Decision Lab" },
      { id: "models", icon: "🧠", label: "Model Analysis" },
      { id: "modelli", icon: "📊", label: "Distribuzione & curve" },
    ],
  },
  {
    title: "Research",
    items: [
      { id: "clinical", icon: "🔬", label: "Clinical Trials" },
      { id: "secK8", icon: "📄", label: "SEC 8-K" },
      { id: "financial", icon: "💰", label: "Financial" },
    ],
  },
];

const SCREEN_LABELS: Record<AppScreen, string> = {
  main: "Main Dashboard",
  catalyst: "Catalyst Hub",
  simulation: "Simulation",
  clinical: "Clinical Trials",
  secK8: "SEC 8-K",
  decisionLab: "Decision Lab",
  financial: "Financial",
  models: "Model Analysis",
  modelli: "Distribuzione & curve",
  system: "System",
};

export { SCREEN_LABELS };

export function AppSidebar({
  screen,
  onScreen,
  apiOk,
}: {
  screen: AppScreen;
  onScreen: (s: AppScreen) => void;
  apiOk: boolean | null;
}) {
  return (
    <aside
      className="app-sidebar flex flex-col flex-shrink-0 border-r border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] min-w-[220px] w-[var(--sidebar-w,220px)]"
    >
      <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-[rgb(var(--border))]/60 mb-1">
        <div
          className="w-7 h-7 rounded-[7px] flex items-center justify-center text-sm shadow-[0_0_12px_rgb(var(--accent)/0.4)]"
          style={{ background: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--purple-soft)))" }}
        >
          ✦
        </div>
        <div>
          <p className="font-bold text-[15px] tracking-tight leading-tight">SuperNova</p>
          <p className="text-[9px] text-ink-muted uppercase tracking-[0.12em]">Biotech Intel</p>
        </div>
      </div>

      <nav className="app-sidebar-nav flex flex-col flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 min-h-0">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted/70 px-3 py-2">
              {section.title}
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
                      : "text-ink-muted hover:bg-[rgb(var(--surface-3))] hover:text-white"
                  }`}
                  onClick={() => onScreen(item.id)}
                >
                  <span className="text-sm opacity-90">{item.icon}</span>
                  <span className="truncate text-left">{item.label}</span>
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
              : "text-ink-muted hover:bg-[rgb(var(--surface-3))] hover:text-white"
          }`}
          onClick={() => onScreen("system")}
        >
          <span className="text-sm">⚙</span>
          System
        </button>
        <ModelStatusCard apiOk={apiOk} />
      </div>
    </aside>
  );
}

function ModelStatusCard({ apiOk }: { apiOk: boolean | null }) {
  return (
    <div className="mx-1 mt-2 px-2.5 py-2 rounded-lg bg-[rgb(var(--surface-3))]/40 flex items-center gap-2">
      <span
        className={`w-[7px] h-[7px] rounded-full shrink-0 ${
          apiOk === false ? "bg-[rgb(var(--signal-down))]" : "bg-[rgb(var(--signal-up))] animate-pulse"
        }`}
        style={
          apiOk !== false ? { boxShadow: "0 0 6px rgb(var(--signal-up))" } : undefined
        }
      />
      <span className="text-[11px] text-ink-muted">Model v4</span>
      <span className="text-[11px] font-semibold ml-auto tabular-nums">MAE 13pp</span>
    </div>
  );
}
