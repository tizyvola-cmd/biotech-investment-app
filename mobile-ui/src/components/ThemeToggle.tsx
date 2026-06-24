import type { MobileTheme } from "../hooks/useTheme";

export function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: MobileTheme;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Passa a tema chiaro" : "Passa a tema scuro"}
      title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
