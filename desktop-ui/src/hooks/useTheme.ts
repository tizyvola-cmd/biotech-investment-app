import { useEffect, useState } from "react";

export const APPEARANCE_THEMES = ["violet", "mint", "supernova"] as const;
export type ThemeId = (typeof APPEARANCE_THEMES)[number];

export const APPEARANCE_THEME_STORAGE_KEY = "sn-theme";
/** All users use SuperNova layout only (violet/mint retired for product UI). */
const LOCKED_THEME: ThemeId = "supernova";

function isThemeId(raw: string | null | undefined): raw is ThemeId {
  return raw === "violet" || raw === "mint" || raw === "supernova";
}

export function loadAppearanceTheme(): ThemeId {
  if (typeof window === "undefined") return LOCKED_THEME;
  try {
    // Migrate any prior violet/mint choice to SuperNova.
    const raw = localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)?.trim();
    if (isThemeId(raw) && raw !== LOCKED_THEME) {
      localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, LOCKED_THEME);
    }
  } catch {
    /* ignore */
  }
  return LOCKED_THEME;
}

export function applyAppearanceThemeToDocument(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", LOCKED_THEME);
  void theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => loadAppearanceTheme());

  useEffect(() => {
    applyAppearanceThemeToDocument(LOCKED_THEME);
    try {
      localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, LOCKED_THEME);
    } catch {
      /* ignore */
    }
    if (theme !== LOCKED_THEME) setThemeState(LOCKED_THEME);
  }, [theme]);

  const setTheme = (_t: ThemeId) => {
    setThemeState(LOCKED_THEME);
  };
  const toggleTheme = () => setThemeState(LOCKED_THEME);

  return { theme: LOCKED_THEME, setTheme, toggleTheme };
}
