import { useThemeContext } from "../../context/ThemeContext";
import { useLang, useT } from "../../shared/i18n";
import type { ThemeId } from "../../hooks/useTheme";

const THEMES: {
  id: ThemeId;
  labelKey:
    | "settings.appearance.violet"
    | "settings.appearance.mint"
    | "settings.appearance.supernova";
  descKey:
    | "settings.appearance.violetDesc"
    | "settings.appearance.mintDesc"
    | "settings.appearance.supernovaDesc";
  sidebar: string;
  primary: string;
  accent: string;
  bg: string;
  surface: string;
  darkPreview?: boolean;
}[] = [
  {
    id: "violet",
    labelKey: "settings.appearance.violet",
    descKey: "settings.appearance.violetDesc",
    sidebar: "#4A3296",
    primary: "#6B4FC8",
    accent: "#C8508A",
    bg: "#F2F0F8",
    surface: "#FFFFFF",
  },
  {
    id: "mint",
    labelKey: "settings.appearance.mint",
    descKey: "settings.appearance.mintDesc",
    sidebar: "#134F3D",
    primary: "#3BAF8A",
    accent: "#C8924A",
    bg: "#F0F8F5",
    surface: "#FFFFFF",
  },
  {
    id: "supernova",
    labelKey: "settings.appearance.supernova",
    descKey: "settings.appearance.supernovaDesc",
    sidebar: "#05070f",
    primary: "#7c3aed",
    accent: "#7dd3fc",
    bg: "#05070f",
    surface: "#12141f",
    darkPreview: true,
  },
];

export function ThemeSelector() {
  const { theme } = useThemeContext();
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const opt = THEMES.find((x) => x.id === "supernova")!;
  const active = theme === "supernova";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[var(--sn-text-2)] leading-snug">
        {it
          ? "Tutti gli account usano il layout SuperNova."
          : "All accounts use the SuperNova layout."}
      </p>
      <div className="flex flex-col lg:flex-row gap-3">
        <div
          className="flex-1 text-left rounded-xl p-3.5"
          style={{
            border: active
              ? `2px solid ${opt.primary}`
              : "1px solid var(--sn-border)",
            background: "var(--sn-surface-raised)",
          }}
        >
          <div
            className="flex h-14 rounded-lg overflow-hidden mb-2.5"
            style={{ border: "1px solid var(--sn-border-subtle)" }}
          >
            <div
              className="w-7 shrink-0 flex flex-col gap-1 p-1.5"
              style={{ background: opt.sidebar }}
            >
              <div
                className="h-1 rounded-sm"
                style={{ background: opt.primary, opacity: 0.9 }}
              />
              <div className="h-0.5 rounded-sm bg-white/25" />
              <div className="h-0.5 rounded-sm bg-white/25" />
            </div>
            <div className="flex-1 p-1.5" style={{ background: opt.bg }}>
              <div className="flex gap-0.5 mb-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex-1 h-3.5 rounded-sm"
                    style={{
                      background: opt.surface,
                      border: "0.5px solid rgba(255,255,255,0.12)",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: opt.primary }}
            />
            <span className="text-[13px] font-medium text-[var(--sn-text)]">
              {t(opt.labelKey)}
            </span>
            <span
              className="ml-auto text-[10px] font-semibold text-white rounded-full px-2 py-px"
              style={{ background: opt.primary }}
            >
              {it ? "attivo" : "active"}
            </span>
          </div>
          <p className="text-[11px] text-[var(--sn-text-3)] leading-snug">
            {t(opt.descKey)}
          </p>
        </div>
      </div>
    </div>
  );
}
