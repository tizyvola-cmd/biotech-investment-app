import { useEffect, useState } from "react";

export type ThemeId = "violet" | "mint";

export const APPEARANCE_THEME_STORAGE_KEY = "sn-theme";
const DEFAULT: ThemeId = "violet";

export function loadAppearanceTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)?.trim();
    if (raw === "violet" || raw === "mint") return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function applyAppearanceThemeToDocument(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => loadAppearanceTheme());

  useEffect(() => {
    applyAppearanceThemeToDocument(theme);
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (t: ThemeId) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === "violet" ? "mint" : "violet"));

  return { theme, setTheme, toggleTheme };
}
