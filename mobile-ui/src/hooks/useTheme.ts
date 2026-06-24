import { useEffect, useState } from "react";

const THEME_KEY = "supernova-mobile-theme";
export type MobileTheme = "dark" | "light";

export function getStoredTheme(): MobileTheme {
  if (typeof window === "undefined") return "dark";
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" ? "light" : "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<MobileTheme>(() => getStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));

  return { theme, setTheme: setThemeState, toggleTheme };
}
