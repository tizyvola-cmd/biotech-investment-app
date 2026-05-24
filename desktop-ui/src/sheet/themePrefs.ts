/** Tema UI — persistito in localStorage (`supernova_theme`). */

export const THEME_STORAGE_KEY = "supernova_theme";

/** Valore salvato (include preferenza sistema). */
export type StoredTheme = "light" | "dark" | "black" | "system";

/** Tema attivo applicato alla UI. */
export type ResolvedTheme = "light" | "dark" | "black";

export const THEME_OPTIONS: {
  id: ResolvedTheme;
  label: string;
  hint: string;
}[] = [
  { id: "light", label: "Chiaro", hint: "Bianco" },
  { id: "dark", label: "Blu", hint: "Scuro con gradienti indaco" },
  { id: "black", label: "Nero", hint: "Schermo nero piatto" },
];

function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(stored: StoredTheme): ResolvedTheme {
  if (stored === "light") return "light";
  if (stored === "dark") return "dark";
  if (stored === "black") return "black";
  if (stored === "system") return prefersDark() ? "dark" : "light";
  return prefersDark() ? "dark" : "light";
}

export function loadStoredTheme(): StoredTheme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)?.trim();
    if (raw === "light" || raw === "dark" || raw === "black" || raw === "system") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "system";
}

export function loadResolvedTheme(): ResolvedTheme {
  return resolveTheme(loadStoredTheme());
}

export function saveStoredTheme(theme: StoredTheme | ResolvedTheme): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/** Applica classi tema su `<html>`. `dark` = blu; `theme-black` = nero piatto. */
export function applyThemeToDocument(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "theme-black");
  if (resolved === "dark" || resolved === "black") {
    root.classList.add("dark");
  }
  if (resolved === "black") {
    root.classList.add("theme-black");
  }
}
