import type { AppScreen } from "../types";

/**
 * Screens removed from the live desktop app. Deep-links and leftover
 * navigateTo() calls land on the fallback instead of a blank page.
 *
 * To restore Trades / Model quality: see `_archive/parked-desktop-tabs/README.md`.
 */
export const RETIRED_SCREENS: Readonly<Partial<Record<AppScreen, AppScreen>>> = {
  /** Classic Home dashboard retired — Catalyst desk is the landing screen. */
  main: "catalystDesk",
  models: "catalystDesk",
  decisionLab: "simulation",
  piggyBank: "simulation",
  /** EIS lives inside Evaluation deep-dive — never a top-level sidebar tab. */
  eisDeepDive: "simulation",
  /** Wind (What-If) tab removed from sidebar — deep-links land on Catalyst Days. */
  wind: "catalystDesk",
  /** Clinical Feeds tab retired — Calendar + Catalyst Days cover the workflow. */
  catalystFeed: "catalystDesk",
};

export function resolveLiveScreen(screen: AppScreen): AppScreen {
  return RETIRED_SCREENS[screen] ?? screen;
}
